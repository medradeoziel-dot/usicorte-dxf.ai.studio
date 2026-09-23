import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type DxfModel, type Pt, type Shape, getShapesBounds, getConnectedShapeIds, type SelectionBounds } from "@/lib/dxf";

export type UserMeasurement = {
  id: string;
  a: Pt;
  b: Pt;
  distance: number;
  dx: number;
  dy: number;
  angleDeg?: number;
  label?: string;
  createdAt?: number;
};

type Props = {
  model: DxfModel;
  highlight?: number | null;
  selected?: Set<number>;
  /** replace = troca a seleção, toggle = adiciona/remove (Shift) */
  onSelect?: (ids: number[], mode: "replace" | "toggle") => void;
  onDelete?: () => void;
  /** modo de medição (cotagem interativa) */
  measuring?: boolean;
  onMeasuringChange?: (v: boolean) => void;
  measurements?: UserMeasurement[];
  onAddMeasurement?: (m: UserMeasurement) => void;
  onRemoveMeasurement?: (id: string) => void;
  onClearMeasurements?: () => void;
  showBoundingBox?: boolean;
  onSelectConnected?: (id: number) => void;
};

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v.trim() || fallback;
}

/** Polyline approximation of any shape, in drawing units. */
function polyOf(s: Shape): Pt[] {
  if (s.kind === "line") return s.pts;
  const steps = 48;
  const from = s.kind === "arc" ? s.start : 0;
  const to = s.kind === "arc" ? (s.end < s.start ? s.end + Math.PI * 2 : s.end) : Math.PI * 2;
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    out.push({ x: s.c.x + Math.cos(a) * s.r, y: s.c.y + Math.sin(a) * s.r });
  }
  return out;
}

/** Distance in drawing units from a point to a shape. */
function hitDist(p: Pt, s: Shape): number {
  if (s.kind === "line") {
    let best = Infinity;
    for (let i = 0; i + 1 < s.pts.length; i++) {
      const a = s.pts[i]!;
      const b = s.pts[i + 1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2
        ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
        : 0;
      best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
    }
    return best;
  }
  const d = Math.hypot(p.x - s.c.x, p.y - s.c.y);
  return Math.abs(d - s.r);
}

type Rect = { minX: number; minY: number; maxX: number; maxY: number };

function inRect(p: Pt, r: Rect) {
  return p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
}

function segIntersect(a: Pt, b: Pt, c: Pt, d: Pt) {
  const cross = (o: Pt, p: Pt, q: Pt) =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  return (
    ((d1 > 0) !== (d2 > 0) || d1 === 0 || d2 === 0) &&
    ((d3 > 0) !== (d4 > 0) || d3 === 0 || d4 === 0)
  );
}

function segCrossesRect(a: Pt, b: Pt, r: Rect) {
  if (inRect(a, r) || inRect(b, r)) return true;
  const c1 = { x: r.minX, y: r.minY };
  const c2 = { x: r.maxX, y: r.minY };
  const c3 = { x: r.maxX, y: r.maxY };
  const c4 = { x: r.minX, y: r.maxY };
  return (
    segIntersect(a, b, c1, c2) ||
    segIntersect(a, b, c2, c3) ||
    segIntersect(a, b, c3, c4) ||
    segIntersect(a, b, c4, c1)
  );
}

function shapeInWindow(s: Shape, r: Rect) {
  return polyOf(s).every((p) => inRect(p, r));
}

function shapeCrossing(s: Shape, r: Rect) {
  const poly = polyOf(s);
  for (let i = 0; i + 1 < poly.length; i++) {
    if (segCrossesRect(poly[i]!, poly[i + 1]!, r)) return true;
  }
  return poly.some((p) => inRect(p, r));
}

type Band = { x0: number; y0: number; x1: number; y1: number };

export function DrawingCanvas({
  model,
  highlight,
  selected,
  onSelect,
  onDelete,
  measuring = false,
  onMeasuringChange,
  measurements = [],
  onAddMeasurement,
  onRemoveMeasurement,
  onClearMeasurements,
  showBoundingBox = true,
  onSelectConnected,
}: Props) {
  const [measures, setMeasures] = useState<{ a: Pt; b: Pt }[]>([]);
  const [pending, setPending] = useState<Pt | null>(null);
  const [hoverPt, setHoverPt] = useState<Pt | null>(null);
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [band, setBand] = useState<Band | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const bandStart = useRef<{ x: number; y: number; shift: boolean } | null>(null);
  const transform = useRef<{ s: number; ox: number; oy: number } | null>(null);

  // Compute selected shapes and automatic bounding box dimensions (X and Y)
  const selectedShapes = useMemo(() => {
    if (!selected || selected.size === 0) return [];
    return model.shapes.filter((s) => selected.has(s.id));
  }, [model.shapes, selected]);

  const selBounds = useMemo(() => {
    return getShapesBounds(selectedShapes);
  }, [selectedShapes]);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [model]);

  const toWorld = useCallback((sx: number, sy: number): Pt => {
    const t = transform.current!;
    return { x: (sx - t.ox) / t.s, y: (t.oy - sy) / t.s };
  }, []);

  // Atalhos estilo AutoCAD
  useEffect(() => {
    const isTyping = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        setSpaceDown(true);
        return;
      }
      if (e.key === "Escape") {
        setBand(null);
        bandStart.current = null;
        setPending(null);
        setHoverPt(null);
        if (measuring) {
          onMeasuringChange?.(false);
          return;
        }
        onSelect?.([], "replace");
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        setPending(null);
        setHoverPt(null);
        onMeasuringChange?.(!measuring);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        onSelect?.(
          model.shapes.filter((s) => !(s.kind === "line" && s.isDim)).map((s) => s.id),
          "replace",
        );
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Delete" || e.key === "Backspace" || e.key.toLowerCase() === "e") {
        e.preventDefault();
        onDelete?.();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [model, onSelect, onDelete, measuring, onMeasuringChange]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const { minX, minY, maxX, maxY } = model.bounds;
    const bw = Math.max(maxX - minX, 1e-6);
    const bh = Math.max(maxY - minY, 1e-6);
    const base = Math.min((w - 48) / bw, (h - 48) / bh);
    const s = base * zoom;
    const ox = (w - bw * s) / 2 - minX * s + pan.x;
    const oy = (h + bh * s) / 2 + minY * s + pan.y;
    transform.current = { s, ox, oy };
    const tx = (x: number) => ox + x * s;
    const ty = (y: number) => oy - y * s;

    const draw = cssVar("--draw", "#cfe6ee");
    const dimColor = cssVar("--dim", "#4fd1c5");
    const selColor = cssVar("--accent", "#f5b453");

    for (const shape of model.shapes) {
      ctx.beginPath();
      const isSel = selected?.has(shape.id);
      ctx.lineWidth = isSel ? 2.5 : shape.kind === "line" && shape.isDim ? 1 : 1.25;
      ctx.strokeStyle = isSel
        ? selColor
        : shape.kind === "line" && shape.isDim
          ? dimColor
          : draw;
      if (shape.kind === "line") {
        shape.pts.forEach((p, i) =>
          i === 0 ? ctx.moveTo(tx(p.x), ty(p.y)) : ctx.lineTo(tx(p.x), ty(p.y)),
        );
      } else if (shape.kind === "circle") {
        ctx.arc(tx(shape.c.x), ty(shape.c.y), shape.r * s, 0, Math.PI * 2);
      } else {
        ctx.arc(tx(shape.c.x), ty(shape.c.y), shape.r * s, -shape.end, -shape.start);
      }
      ctx.stroke();
    }

    model.dims.forEach((d) => {
      if (!d.at) return;
      const active = highlight === d.id;
      ctx.fillStyle = dimColor;
      ctx.globalAlpha = active ? 1 : 0.75;
      ctx.beginPath();
      ctx.arc(tx(d.at.x), ty(d.at.y), active ? 6 : 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (active) {
        ctx.font = "12px monospace";
        ctx.fillText(
          d.text || (d.value != null ? d.value.toFixed(2) : ""),
          tx(d.at.x) + 10,
          ty(d.at.y) - 8,
        );
      }
    });

    // Caixa de seleção (janela = azul, intersecção = verde)
    if (band) {
      const x = Math.min(band.x0, band.x1);
      const y = Math.min(band.y0, band.y1);
      const bwid = Math.abs(band.x1 - band.x0);
      const bhei = Math.abs(band.y1 - band.y0);
      const windowMode = band.x1 >= band.x0;
      ctx.save();
      ctx.fillStyle = windowMode ? "rgba(0, 120, 215, 0.2)" : "rgba(0, 200, 80, 0.2)";
      ctx.strokeStyle = windowMode ? "rgb(0, 120, 215)" : "rgb(0, 200, 80)";
      ctx.lineWidth = 1;
      ctx.setLineDash(windowMode ? [] : [6, 4]);
      ctx.fillRect(x, y, bwid, bhei);
      ctx.strokeRect(x, y, bwid, bhei);
      ctx.restore();
    }

    // Caixa delimitadora e dimensões totais (X e Y) dos elementos selecionados
    if (showBoundingBox && selBounds && (selBounds.width > 0 || selBounds.height > 0)) {
      const minCX = tx(selBounds.minX);
      const maxCX = tx(selBounds.maxX);
      const topCY = ty(selBounds.maxY);
      const botCY = ty(selBounds.minY);

      const leftX = Math.min(minCX, maxCX);
      const rightX = Math.max(minCX, maxCX);
      const topY = Math.min(topCY, botCY);
      const bottomY = Math.max(topCY, botCY);
      const boxW = Math.max(rightX - leftX, 2);
      const boxH = Math.max(bottomY - topY, 2);

      ctx.save();
      // Retângulo tracejado envolvente
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "rgba(56, 189, 248, 0.75)"; // sky-400
      ctx.lineWidth = 1.2;
      ctx.strokeRect(leftX, topY, boxW, boxH);

      // Cantoneiras nos 4 vértices
      const cSize = Math.min(10, Math.max(3, boxW / 4), Math.max(3, boxH / 4));
      ctx.setLineDash([]);
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2;
      // Top-Left
      ctx.beginPath();
      ctx.moveTo(leftX, topY + cSize);
      ctx.lineTo(leftX, topY);
      ctx.lineTo(leftX + cSize, topY);
      ctx.stroke();
      // Top-Right
      ctx.beginPath();
      ctx.moveTo(rightX - cSize, topY);
      ctx.lineTo(rightX, topY);
      ctx.lineTo(rightX, topY + cSize);
      ctx.stroke();
      // Bottom-Left
      ctx.beginPath();
      ctx.moveTo(leftX, bottomY - cSize);
      ctx.lineTo(leftX, bottomY);
      ctx.lineTo(leftX + cSize, bottomY);
      ctx.stroke();
      // Bottom-Right
      ctx.beginPath();
      ctx.moveTo(rightX - cSize, bottomY);
      ctx.lineTo(rightX, bottomY);
      ctx.lineTo(rightX, bottomY - cSize);
      ctx.stroke();

      // Cruz do centro
      const midCX = tx(selBounds.centerX);
      const midCY = ty(selBounds.centerY);
      ctx.strokeStyle = "rgba(56, 189, 248, 0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(midCX - 5, midCY);
      ctx.lineTo(midCX + 5, midCY);
      ctx.moveTo(midCX, midCY - 5);
      ctx.lineTo(midCX, midCY + 5);
      ctx.stroke();

      // --- LINHA DE COTA DE LARGURA (X) ---
      const xOffset = 24;
      const dimY = bottomY + xOffset;
      ctx.strokeStyle = "#38bdf8";
      ctx.fillStyle = "#38bdf8";
      ctx.lineWidth = 1.5;

      // Linhas de chamada
      ctx.beginPath();
      ctx.moveTo(leftX, bottomY + 2);
      ctx.lineTo(leftX, dimY + 4);
      ctx.moveTo(rightX, bottomY + 2);
      ctx.lineTo(rightX, dimY + 4);
      ctx.stroke();

      // Linha horizontal da cota
      ctx.beginPath();
      ctx.moveTo(leftX, dimY);
      ctx.lineTo(rightX, dimY);
      ctx.stroke();

      // Ticks extremos a 45 graus
      ctx.beginPath();
      ctx.moveTo(leftX - 3, dimY - 4);
      ctx.lineTo(leftX + 3, dimY + 4);
      ctx.moveTo(rightX - 3, dimY - 4);
      ctx.lineTo(rightX + 3, dimY + 4);
      ctx.stroke();

      // Etiqueta com valor exato de X em mm
      const labelX = `X: ${selBounds.width.toFixed(2)} mm`;
      ctx.font = "bold 11px monospace";
      ctx.textBaseline = "middle";
      const twX = ctx.measureText(labelX).width;
      const badgeX = (leftX + rightX) / 2;
      ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
      ctx.fillRect(badgeX - twX / 2 - 5, dimY - 9, twX + 10, 18);
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 1;
      ctx.strokeRect(badgeX - twX / 2 - 5, dimY - 9, twX + 10, 18);
      ctx.fillStyle = "#38bdf8";
      ctx.fillText(labelX, badgeX - twX / 2, dimY);

      // --- LINHA DE COTA DE COMPRIMENTO / ALTURA (Y) ---
      const yOffset = 24;
      const dimX = rightX + yOffset;
      ctx.strokeStyle = "#34d399"; // emerald
      ctx.fillStyle = "#34d399";
      ctx.lineWidth = 1.5;

      // Linhas de chamada
      ctx.beginPath();
      ctx.moveTo(rightX + 2, topY);
      ctx.lineTo(dimX + 4, topY);
      ctx.moveTo(rightX + 2, bottomY);
      ctx.lineTo(dimX + 4, bottomY);
      ctx.stroke();

      // Linha vertical da cota
      ctx.beginPath();
      ctx.moveTo(dimX, topY);
      ctx.lineTo(dimX, bottomY);
      ctx.stroke();

      // Ticks extremos a 45 graus
      ctx.beginPath();
      ctx.moveTo(dimX - 4, topY - 3);
      ctx.lineTo(dimX + 4, topY + 3);
      ctx.moveTo(dimX - 4, bottomY - 3);
      ctx.lineTo(dimX + 4, bottomY + 3);
      ctx.stroke();

      // Etiqueta com valor exato de Y em mm
      const labelY = `Y: ${selBounds.height.toFixed(2)} mm`;
      ctx.font = "bold 11px monospace";
      ctx.textBaseline = "middle";
      const twY = ctx.measureText(labelY).width;
      const badgeY = (topY + bottomY) / 2;
      ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
      ctx.fillRect(dimX - twY / 2 - 5, badgeY - 9, twY + 10, 18);
      ctx.strokeStyle = "#34d399";
      ctx.lineWidth = 1;
      ctx.strokeRect(dimX - twY / 2 - 5, badgeY - 9, twY + 10, 18);
      ctx.fillStyle = "#34d399";
      ctx.fillText(labelY, dimX - twY / 2, badgeY);

      ctx.restore();
    }

    // Medições interativas (cotas temporárias)
    const measureColor = cssVar("--accent", "#f5b453");
    // Combinar medidas locais com medições passadas via props para total sincronia
    const live: { a: Pt; b: Pt }[] = [
      ...measures,
      ...measurements.map((m) => ({ a: m.a, b: m.b })),
    ];
    if (pending && hoverPt) live.push({ a: pending, b: hoverPt });
    ctx.save();
    ctx.font = "12px monospace";
    ctx.textBaseline = "middle";
    for (const m of live) {
      const x1 = tx(m.a.x);
      const y1 = ty(m.a.y);
      const x2 = tx(m.b.x);
      const y2 = ty(m.b.y);
      ctx.strokeStyle = measureColor;
      ctx.fillStyle = measureColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      // marcas nas extremidades
      const ang = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
      for (const [px, py] of [
        [x1, y1],
        [x2, y2],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(px - Math.cos(ang) * 5, py - Math.sin(ang) * 5);
        ctx.lineTo(px + Math.cos(ang) * 5, py + Math.sin(ang) * 5);
        ctx.stroke();
      }
      const dist = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y);
      const label = `${dist.toFixed(2)} mm`;
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(mx - tw / 2 - 4, my - 18, tw + 8, 16);
      ctx.fillStyle = measureColor;
      ctx.fillText(label, mx - tw / 2, my - 10);
    }
    if (pending) {
      ctx.fillStyle = measureColor;
      ctx.beginPath();
      ctx.arc(tx(pending.x), ty(pending.y), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }, [model, zoom, pan, highlight, selected, selBounds, showBoundingBox, band, measures, measurements, pending, hoverPt]);

  function pickAt(sx: number, sy: number): number | null {
    if (!transform.current) return null;
    const { s } = transform.current;
    const p = toWorld(sx, sy);
    const tol = 8 / s;
    let bestId: number | null = null;
    let best = tol;
    for (const shape of model.shapes) {
      if (shape.kind === "line" && shape.isDim) continue;
      const d = hitDist(p, shape);
      if (d < best) {
        best = d;
        bestId = shape.id;
      }
    }
    return bestId;
  }

  function areaSelect(b: Band, shift: boolean) {
    if (!transform.current) return;
    const a = toWorld(b.x0, b.y0);
    const c = toWorld(b.x1, b.y1);
    const rect: Rect = {
      minX: Math.min(a.x, c.x),
      maxX: Math.max(a.x, c.x),
      minY: Math.min(a.y, c.y),
      maxY: Math.max(a.y, c.y),
    };
    const windowMode = b.x1 >= b.x0;
    const ids = model.shapes
      .filter((s) => !(s.kind === "line" && s.isDim))
      .filter((s) => (windowMode ? shapeInWindow(s, rect) : shapeCrossing(s, rect)))
      .map((s) => s.id);
    onSelect?.(ids, shift ? "toggle" : "replace");
  }

  const cursor = panning || spaceDown ? "cursor-grabbing" : "cursor-crosshair";

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={ref}
        tabIndex={0}
        className={`h-full w-full select-none touch-none rounded-lg outline-none ${cursor}`}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          e.currentTarget.focus();
          e.currentTarget.setPointerCapture(e.pointerId);
          const rect = e.currentTarget.getBoundingClientRect();
          const isPan = e.button === 1 || (e.button === 0 && spaceDown);
          if (isPan) {
            setPanning(true);
            drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y, moved: false };
            return;
          }
          if (e.button !== 0) return;
          if (measuring) {
            const p = toWorld(e.clientX - rect.left, e.clientY - rect.top);
            if (!pending) setPending(p);
            else {
              const newMeasure = { a: pending, b: p };
              setMeasures((m) => [...m, newMeasure]);
              if (onAddMeasurement) {
                const dist = Math.hypot(p.x - pending.x, p.y - pending.y);
                onAddMeasurement({
                  id: `meas_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  a: pending,
                  b: p,
                  distance: dist,
                  dx: Math.abs(p.x - pending.x),
                  dy: Math.abs(p.y - pending.y),
                  createdAt: Date.now(),
                });
              }
              setPending(null);
            }
            return;
          }
          bandStart.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            shift: e.shiftKey,
          };
        }}
        onPointerMove={(e) => {
          if (drag.current) {
            const nx = e.clientX - drag.current.x;
            const ny = e.clientY - drag.current.y;
            drag.current.moved = true;
            setPan({ x: nx, y: ny });
            return;
          }
          if (measuring) {
            if (!pending) return;
            const r = e.currentTarget.getBoundingClientRect();
            setHoverPt(toWorld(e.clientX - r.left, e.clientY - r.top));
            return;
          }
          const start = bandStart.current;
          if (!start) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          if (Math.hypot(x - start.x, y - start.y) < 4) return;
          setBand({ x0: start.x, y0: start.y, x1: x, y1: y });
        }}
        onPointerUp={(e) => {
          if (drag.current) {
            drag.current = null;
            setPanning(false);
            return;
          }
          const start = bandStart.current;
          bandStart.current = null;
          if (!start) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const shift = start.shift || e.shiftKey;
          if (band) {
            areaSelect({ x0: start.x, y0: start.y, x1: x, y1: y }, shift);
            setBand(null);
            return;
          }
          const id = pickAt(x, y);
          if (id != null) onSelect?.([id], shift ? "toggle" : "replace");
          else if (!shift) onSelect?.([], "replace");
        }}
        onPointerCancel={() => {
          drag.current = null;
          bandStart.current = null;
          setPanning(false);
          setBand(null);
        }}
        onWheel={(e) => {
          e.preventDefault();
          setZoom((z) => Math.min(40, Math.max(0.2, z * (e.deltaY > 0 ? 0.9 : 1.1))));
        }}
        onDoubleClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const id = pickAt(x, y);
          if (id != null) {
            const connected = getConnectedShapeIds(model.shapes, id);
            onSelect?.(connected, "replace");
            onSelectConnected?.(id);
          }
        }}
      />

      {/* Floating selection dimensions badge (Real-time Bounding Box X and Y) */}
      {selBounds && selected && selected.size > 0 && (
        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-3 rounded-lg border border-sky-500/40 bg-[#0c1420]/95 px-3.5 py-2 font-mono text-xs shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-1.5 text-sky-400 font-semibold">
            <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
            <span>DIMENSÃO SELEÇÃO:</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-slate-300">
              Largura <strong className="text-sky-300 font-bold">X: {selBounds.width.toFixed(2)} mm</strong>
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-300">
              Comprimento <strong className="text-emerald-300 font-bold">Y: {selBounds.height.toFixed(2)} mm</strong>
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400 text-[11px]">
              {selBounds.count} {selBounds.count === 1 ? 'elemento' : 'elementos'}
            </span>
          </div>
        </div>
      )}

      <div className="absolute bottom-3 right-3 flex items-center gap-2 rounded-md border border-border bg-card/90 px-3 py-1.5 font-mono text-xs text-muted-foreground shadow-md backdrop-blur">
        <button
          className="text-foreground hover:text-primary transition-colors px-1"
          onClick={() => setZoom((z) => Math.max(0.2, z * 0.8))}
          title="Diminuir Zoom"
        >
          −
        </button>
        <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
        <button
          className="text-foreground hover:text-primary transition-colors px-1"
          onClick={() => setZoom((z) => Math.min(40, z * 1.25))}
          title="Aumentar Zoom"
        >
          +
        </button>
        <button
          className="ml-1 text-foreground hover:text-primary transition-colors"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
          title="Centralizar e ajustar à tela"
        >
          ajustar
        </button>
        {(measures.length > 0 || measurements.length > 0 || pending) && (
          <button
            className="ml-1 text-amber-400 hover:text-amber-300 transition-colors"
            onClick={() => {
              setMeasures([]);
              setPending(null);
              setHoverPt(null);
              onClearMeasurements?.();
            }}
          >
            limpar medições
          </button>
        )}
      </div>
    </div>
  );
}
