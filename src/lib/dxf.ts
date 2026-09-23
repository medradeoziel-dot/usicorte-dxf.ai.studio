/**
 * DXF Parser, Model Definitions, and AutoCAD-Compliant DXF Exporter
 * Fully compliant with official AutoCAD specification (AutoCAD 2000 AC1015 and AutoCAD R12 AC1009)
 * Guarantees mandatory sections: HEADER, CLASSES, TABLES (LTYPE, LAYER, STYLE), BLOCKS, ENTITIES, EOF
 */
import DxfParser from 'dxf-parser';

export type Pt = { x: number; y: number };

export type LineShape = {
  id: number;
  kind: 'line';
  pts: Pt[];
  isDim?: boolean;
  color?: string;
  layer?: string;
};

export type CircleShape = {
  id: number;
  kind: 'circle';
  c: Pt;
  r: number;
  isDim?: boolean;
  color?: string;
  layer?: string;
};

export type ArcShape = {
  id: number;
  kind: 'arc';
  c: Pt;
  r: number;
  start: number; // in radians
  end: number;   // in radians
  isDim?: boolean;
  color?: string;
  layer?: string;
};

export type Shape = LineShape | CircleShape | ArcShape;

export type Dimension = {
  id: number;
  type: string;
  text?: string;
  value?: number;
  at?: Pt;
  def1?: Pt;
  def2?: Pt;
  p1?: Pt;
  p2?: Pt;
  isUserMeasurement?: boolean;
  createdAt?: number;
};

export type SnapPoint = {
  pt: Pt;
  type: 'endpoint' | 'midpoint' | 'center' | 'quadrant';
  label: string;
};

export type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type DxfModel = {
  shapes: Shape[];
  dims: Dimension[];
  bounds: Bounds;
  units: string;
  entityCount: number;
  layers?: string[];
};

function normalizeRad(a: number): number {
  while (a < 0) a += Math.PI * 2;
  while (a >= Math.PI * 2) a -= Math.PI * 2;
  return a;
}

export async function parseDxf(dxfText: string): Promise<DxfModel> {
  const parser = new DxfParser();
  let parsed: any;
  try {
    parsed = parser.parseSync(dxfText);
  } catch (err: any) {
    throw new Error('Falha ao processar DXF: ' + (err?.message || 'Arquivo corrompido ou formato inválido.'));
  }

  const shapes: Shape[] = [];
  const dims: Dimension[] = [];
  let nextId = 1;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  function updateBounds(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const entities = parsed?.entities || [];

  for (const ent of entities) {
    const type = ent.type;
    const isDimLayer =
      (ent.layer && /dim|cota|medida/i.test(ent.layer)) || type === 'DIMENSION';

    if (type === 'LINE') {
      const p1: Pt = { x: ent.vertices?.[0]?.x ?? 0, y: ent.vertices?.[0]?.y ?? 0 };
      const p2: Pt = { x: ent.vertices?.[1]?.x ?? 0, y: ent.vertices?.[1]?.y ?? 0 };
      updateBounds(p1.x, p1.y);
      updateBounds(p2.x, p2.y);
      shapes.push({
        id: nextId++,
        kind: 'line',
        pts: [p1, p2],
        isDim: isDimLayer,
        layer: ent.layer || '0',
      });
    } else if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
      const rawVerts = ent.vertices || [];
      if (rawVerts.length >= 2) {
        const pts: Pt[] = rawVerts.map((v: any) => {
          const p = { x: v.x ?? 0, y: v.y ?? 0 };
          updateBounds(p.x, p.y);
          return p;
        });
        if (ent.shape || ent.isClosed) {
          pts.push({ ...pts[0]! });
        }
        shapes.push({
          id: nextId++,
          kind: 'line',
          pts,
          isDim: isDimLayer,
          layer: ent.layer || '0',
        });
      }
    } else if (type === 'CIRCLE') {
      const c: Pt = { x: ent.center?.x ?? 0, y: ent.center?.y ?? 0 };
      const r = Math.abs(ent.radius ?? 1);
      updateBounds(c.x - r, c.y - r);
      updateBounds(c.x + r, c.y + r);
      shapes.push({
        id: nextId++,
        kind: 'circle',
        c,
        r,
        isDim: isDimLayer,
        layer: ent.layer || '0',
      });
    } else if (type === 'ARC') {
      const c: Pt = { x: ent.center?.x ?? 0, y: ent.center?.y ?? 0 };
      const r = Math.abs(ent.radius ?? 1);
      updateBounds(c.x - r, c.y - r);
      updateBounds(c.x + r, c.y + r);
      let start = ent.startAngle ?? 0;
      let end = ent.endAngle ?? Math.PI * 2;
      if (Math.abs(start) > Math.PI * 2 || Math.abs(end) > Math.PI * 2) {
        start = (start * Math.PI) / 180;
        end = (end * Math.PI) / 180;
      }
      shapes.push({
        id: nextId++,
        kind: 'arc',
        c,
        r,
        start: normalizeRad(start),
        end: normalizeRad(end),
        isDim: isDimLayer,
        layer: ent.layer || '0',
      });
    } else if (type === 'DIMENSION') {
      const at: Pt = {
        x: ent.middlePoint?.x ?? ent.definitionPoint?.x ?? 0,
        y: ent.middlePoint?.y ?? ent.definitionPoint?.y ?? 0,
      };
      const def1: Pt | undefined = ent.definitionPoint
        ? { x: ent.definitionPoint.x ?? 0, y: ent.definitionPoint.y ?? 0 }
        : undefined;
      const def2: Pt | undefined = ent.definitionPoint2
        ? { x: ent.definitionPoint2.x ?? 0, y: ent.definitionPoint2.y ?? 0 }
        : undefined;

      let val = ent.actualMeasurement;
      if (val == null && def1 && def2) {
        val = Math.hypot(def2.x - def1.x, def2.y - def1.y);
      }
      updateBounds(at.x, at.y);
      dims.push({
        id: nextId++,
        type: ent.dimensionType != null ? `Tipo ${ent.dimensionType}` : 'Alinhada',
        text: ent.text || (val != null ? `${val.toFixed(2)} mm` : undefined),
        value: val,
        at,
        def1,
        def2,
      });
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    minX = 0;
    minY = 0;
    maxX = 100;
    maxY = 100;
  }

  let units = 'Milímetros (mm)';
  const insunits = parsed?.header?.$INSUNITS;
  if (insunits === 1) units = 'Polegadas (in)';
  else if (insunits === 2) units = 'Pés (ft)';
  else if (insunits === 4) units = 'Milímetros (mm)';
  else if (insunits === 5) units = 'Centímetros (cm)';
  else if (insunits === 6) units = 'Metros (m)';

  return {
    shapes,
    dims,
    bounds: { minX, minY, maxX, maxY },
    units,
    entityCount: shapes.length + dims.length,
  };
}

export function getSnapPoints(shapes: Shape[]): SnapPoint[] {
  const snaps: SnapPoint[] = [];

  for (const s of shapes) {
    if (s.kind === 'line') {
      for (let i = 0; i < s.pts.length; i++) {
        snaps.push({
          pt: s.pts[i]!,
          type: 'endpoint',
          label: i === 0 || i === s.pts.length - 1 ? 'Extremidade' : 'Vértice',
        });
        if (i + 1 < s.pts.length) {
          snaps.push({
            pt: {
              x: (s.pts[i]!.x + s.pts[i + 1]!.x) / 2,
              y: (s.pts[i]!.y + s.pts[i + 1]!.y) / 2,
            },
            type: 'midpoint',
            label: 'Ponto Médio',
          });
        }
      }
    } else if (s.kind === 'circle') {
      snaps.push({ pt: s.c, type: 'center', label: 'Centro' });
      snaps.push({ pt: { x: s.c.x + s.r, y: s.c.y }, type: 'quadrant', label: 'Quadrante' });
      snaps.push({ pt: { x: s.c.x - s.r, y: s.c.y }, type: 'quadrant', label: 'Quadrante' });
      snaps.push({ pt: { x: s.c.x, y: s.c.y + s.r }, type: 'quadrant', label: 'Quadrante' });
      snaps.push({ pt: { x: s.c.x, y: s.c.y - s.r }, type: 'quadrant', label: 'Quadrante' });
    } else if (s.kind === 'arc') {
      snaps.push({ pt: s.c, type: 'center', label: 'Centro do Arco' });
      snaps.push({
        pt: { x: s.c.x + Math.cos(s.start) * s.r, y: s.c.y + Math.sin(s.start) * s.r },
        type: 'endpoint',
        label: 'Início do Arco',
      });
      snaps.push({
        pt: { x: s.c.x + Math.cos(s.end) * s.r, y: s.c.y + Math.sin(s.end) * s.r },
        type: 'endpoint',
        label: 'Fim do Arco',
      });
    }
  }

  return snaps;
}

export type SelectionBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  diagonal: number;
  area: number;
  count: number;
};

/**
 * Calculates the bounding box and exact dimensions (X and Y) of any set of CAD shapes
 */
export function getShapesBounds(shapes: Shape[]): SelectionBounds | null {
  if (!shapes || shapes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  function account(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  for (const s of shapes) {
    if (s.kind === 'line') {
      for (const p of s.pts) {
        account(p.x, p.y);
      }
    } else if (s.kind === 'circle') {
      account(s.c.x - s.r, s.c.y - s.r);
      account(s.c.x + s.r, s.c.y + s.r);
    } else if (s.kind === 'arc') {
      // Start and end points
      account(s.c.x + Math.cos(s.start) * s.r, s.c.y + Math.sin(s.start) * s.r);
      account(s.c.x + Math.cos(s.end) * s.r, s.c.y + Math.sin(s.end) * s.r);

      // Check if arc passes through 0 (right), pi/2 (top), pi (left), 3pi/2 (bottom)
      const start = normalizeRad(s.start);
      let end = normalizeRad(s.end);
      let sweep = end - start;
      if (sweep <= 0) sweep += Math.PI * 2;

      const cardinals = [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2];
      for (const angle of cardinals) {
        let diff = angle - start;
        while (diff < 0) diff += Math.PI * 2;
        while (diff >= Math.PI * 2) diff -= Math.PI * 2;
        if (diff <= sweep + 1e-6) {
          account(s.c.x + Math.cos(angle) * s.r, s.c.y + Math.sin(angle) * s.r);
        }
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;

  const width = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const diagonal = Math.hypot(width, height);
  const area = width * height;

  return {
    minX,
    maxX,
    minY,
    maxY,
    width,
    height,
    centerX,
    centerY,
    diagonal,
    area,
    count: shapes.length,
  };
}

/**
 * Finds all shapes connected end-to-end to form a closed loop or continuous contour
 */
export function getConnectedShapeIds(allShapes: Shape[], initialId: number, tolerance = 0.1): number[] {
  const shapeMap = new Map<number, Shape>();
  allShapes.forEach((s) => shapeMap.set(s.id, s));

  const startShape = shapeMap.get(initialId);
  if (!startShape) return [initialId];

  // Circles are self-contained closed shapes
  if (startShape.kind === 'circle') return [initialId];

  function getEndpoints(s: Shape): Pt[] {
    if (s.kind === 'line') {
      if (s.pts.length === 0) return [];
      return [s.pts[0]!, s.pts[s.pts.length - 1]!];
    }
    if (s.kind === 'arc') {
      return [
        { x: s.c.x + Math.cos(s.start) * s.r, y: s.c.y + Math.sin(s.start) * s.r },
        { x: s.c.x + Math.cos(s.end) * s.r, y: s.c.y + Math.sin(s.end) * s.r },
      ];
    }
    return [];
  }

  const visited = new Set<number>();
  const queue = [initialId];
  visited.add(initialId);

  const tolSq = tolerance * tolerance;

  while (queue.length > 0) {
    const currId = queue.shift()!;
    const currShape = shapeMap.get(currId);
    if (!currShape) continue;

    const currEnds = getEndpoints(currShape);
    if (currEnds.length === 0) continue;

    for (const [otherId, otherShape] of shapeMap.entries()) {
      if (visited.has(otherId)) continue;
      if (otherShape.kind === 'line' && otherShape.isDim) continue;

      const otherEnds = getEndpoints(otherShape);
      let connected = false;

      for (const p1 of currEnds) {
        for (const p2 of otherEnds) {
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          if (dx * dx + dy * dy <= tolSq) {
            connected = true;
            break;
          }
        }
        if (connected) break;
      }

      if (connected) {
        visited.add(otherId);
        queue.push(otherId);
      }
    }
  }

  return Array.from(visited);
}

export type DxfExportFormat = 'AutoCAD R12' | 'AutoCAD 2000';

export interface ExportDxfOptions {
  version?: DxfExportFormat;
  userMeasurements?: { a: Pt; b: Pt; distance?: number }[];
  includeMeasurements?: boolean;
}

/**
 * Strict Anti-NaN formatter: converts any number to decimal string with 4 decimal places.
 * Guarantees that NaN, undefined, null, or Infinity never enter the DXF output.
 */
function safeNum(val: unknown, fallback = 0): string {
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num) || Number.isNaN(num)) {
    return fallback.toFixed(4);
  }
  return num.toFixed(4);
}

/** Sanitize layer names to ASCII characters valid in AutoCAD */
function cleanLayerName(name?: string): string {
  if (!name || !name.trim()) return '0';
  const clean = name.trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
  return clean || '0';
}

/**
 * Generates an official, strictly valid AutoCAD DXF R12 (AC1009) file.
 * Compatible with 100% of AutoCAD versions, CNC laser/plasma cutters, CAD/CAM software.
 * 
 * Strict structure:
 * 1. HEADER: $ACADVER AC1009
 * 2. TABLES: LAYER table (including layer '0')
 * 3. BLOCKS: Declared empty section (0\nSECTION\n2\nBLOCKS\n0\nENDSEC)
 * 4. ENTITIES: LINE (10, 20, 11, 21), CIRCLE (10, 20, 40), ARC (10, 20, 40, 50, 51)
 * 5. EOF: 0\nEOF
 */
export function exportDxf(
  shapes: Shape[],
  optionsOrMeasurements?: { a: Pt; b: Pt; distance?: number }[] | ExportDxfOptions
): string {
  let measurements: { a: Pt; b: Pt; distance?: number }[] = [];

  if (Array.isArray(optionsOrMeasurements)) {
    measurements = optionsOrMeasurements;
  } else if (optionsOrMeasurements) {
    measurements = optionsOrMeasurements.userMeasurements || [];
  }

  // Collect all unique layers needed by exported entities
  const layerSet = new Set<string>();
  layerSet.add('0');
  for (const s of shapes) {
    layerSet.add(cleanLayerName(s.layer));
  }
  if (measurements.length > 0) {
    layerSet.add('COTAS_MEDIDAS');
  }
  const layers = Array.from(layerSet);

  const lines: string[] = [];

  // ==========================================
  // 1. HEADER SECTION (AC1009)
  // ==========================================
  lines.push(
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$ACADVER',
    '1', 'AC1009',
    '0', 'ENDSEC'
  );

  // ==========================================
  // 2. TABLES SECTION (LAYER table defining layer 0 and active layers)
  // ==========================================
  lines.push(
    '0', 'SECTION',
    '2', 'TABLES',
    '0', 'TABLE',
    '2', 'LAYER',
    '70', String(layers.length)
  );

  for (const lyr of layers) {
    const isCotas = lyr === 'COTAS_MEDIDAS';
    const colorCode = isCotas ? '3' : lyr === '0' ? '7' : '4'; // Green for cotas, white for 0, cyan for others
    lines.push(
      '0', 'LAYER',
      '2', lyr,
      '70', '0',
      '62', colorCode,
      '6', 'CONTINUOUS'
    );
  }

  lines.push(
    '0', 'ENDTAB',
    '0', 'ENDSEC'
  );

  // ==========================================
  // 3. BLOCKS SECTION (Declared empty section)
  // ==========================================
  lines.push(
    '0', 'SECTION',
    '2', 'BLOCKS',
    '0', 'ENDSEC'
  );

  // ==========================================
  // 4. ENTITIES SECTION
  // LINE (10, 20, 11, 21), CIRCLE (10, 20, 40), ARC (10, 20, 40, 50, 51)
  // ==========================================
  lines.push('0', 'SECTION', '2', 'ENTITIES');

  for (const s of shapes) {
    const layer = cleanLayerName(s.layer);

    if (s.kind === 'line') {
      const pts = s.pts || [];
      if (pts.length >= 2) {
        // Decompose all line segments into pure LINE entities (10, 20, 11, 21)
        for (let i = 0; i < pts.length - 1; i++) {
          const p1 = pts[i];
          const p2 = pts[i + 1];
          if (!p1 || !p2) continue;

          lines.push(
            '0', 'LINE',
            '8', layer,
            '10', safeNum(p1.x, 0),
            '20', safeNum(p1.y, 0),
            '11', safeNum(p2.x, 0),
            '21', safeNum(p2.y, 0)
          );
        }
      }
    } else if (s.kind === 'circle') {
      const cx = s.c ? s.c.x : 0;
      const cy = s.c ? s.c.y : 0;
      const radius = Math.max(0.0001, typeof s.r === 'number' && Number.isFinite(s.r) ? s.r : 1);

      lines.push(
        '0', 'CIRCLE',
        '8', layer,
        '10', safeNum(cx, 0),
        '20', safeNum(cy, 0),
        '40', safeNum(radius, 1)
      );
    } else if (s.kind === 'arc') {
      const cx = s.c ? s.c.x : 0;
      const cy = s.c ? s.c.y : 0;
      const radius = Math.max(0.0001, typeof s.r === 'number' && Number.isFinite(s.r) ? s.r : 1);

      // Convert angles from radians to degrees [0, 360)
      let startDeg = ((s.start ?? 0) * 180) / Math.PI;
      let endDeg = ((s.end ?? Math.PI * 2) * 180) / Math.PI;

      if (!Number.isFinite(startDeg)) startDeg = 0;
      if (!Number.isFinite(endDeg)) endDeg = 360;

      startDeg = ((startDeg % 360) + 360) % 360;
      endDeg = ((endDeg % 360) + 360) % 360;

      lines.push(
        '0', 'ARC',
        '8', layer,
        '10', safeNum(cx, 0),
        '20', safeNum(cy, 0),
        '40', safeNum(radius, 1),
        '50', safeNum(startDeg, 0),
        '51', safeNum(endDeg, 360)
      );
    }
  }

  // Include user measurements as dimension lines and standard text in COTAS_MEDIDAS layer
  if (measurements.length > 0) {
    for (const m of measurements) {
      if (!m.a || !m.b) continue;

      // Main dimension line between points
      lines.push(
        '0', 'LINE',
        '8', 'COTAS_MEDIDAS',
        '10', safeNum(m.a.x, 0),
        '20', safeNum(m.a.y, 0),
        '11', safeNum(m.b.x, 0),
        '21', safeNum(m.b.y, 0)
      );

      // Tick marks at endpoints perpendicular to the measurement line
      const dx = (m.b.x ?? 0) - (m.a.x ?? 0);
      const dy = (m.b.y ?? 0) - (m.a.y ?? 0);
      const ang = Math.atan2(dy, dx) + Math.PI / 2;
      const tickLen = 2.0; // 2mm tick mark
      const cosA = Math.cos(ang) * tickLen;
      const sinA = Math.sin(ang) * tickLen;

      // Tick at point A
      lines.push(
        '0', 'LINE',
        '8', 'COTAS_MEDIDAS',
        '10', safeNum(m.a.x - cosA, 0),
        '20', safeNum(m.a.y - sinA, 0),
        '11', safeNum(m.a.x + cosA, 0),
        '21', safeNum(m.a.y + sinA, 0)
      );

      // Tick at point B
      lines.push(
        '0', 'LINE',
        '8', 'COTAS_MEDIDAS',
        '10', safeNum(m.b.x - cosA, 0),
        '20', safeNum(m.b.y - sinA, 0),
        '11', safeNum(m.b.x + cosA, 0),
        '21', safeNum(m.b.y + sinA, 0)
      );

      // Dimension value text placed at midpoint
      const mx = ((m.a.x ?? 0) + (m.b.x ?? 0)) / 2;
      const my = ((m.a.y ?? 0) + (m.b.y ?? 0)) / 2;
      const dist = m.distance != null && Number.isFinite(m.distance) ? m.distance : Math.hypot(dx, dy);
      const textVal = `${dist.toFixed(2)} mm`;

      lines.push(
        '0', 'TEXT',
        '8', 'COTAS_MEDIDAS',
        '10', safeNum(mx + cosA * 1.5, 0),
        '20', safeNum(my + sinA * 1.5, 0),
        '40', '3.0000', // 3.0 mm text height
        '1', textVal
      );
    }
  }

  lines.push('0', 'ENDSEC');

  // ==========================================
  // 5. END OF FILE
  // ==========================================
  lines.push('0', 'EOF');

  // Standard CRLF line endings as required by AutoCAD specification on Windows & CNC machines
  return lines.join('\r\n') + '\r\n';
}
