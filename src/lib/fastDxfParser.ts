/**
 * Fast & Lightweight DXF Geometry Parser for Thumbnails and Quick Previews.
 * Designed to extract 2D CAD entities (LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE)
 * in milliseconds without allocating heavy AST objects.
 */

export interface FastPt {
  x: number;
  y: number;
}

export type FastShape =
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'circle'; cx: number; cy: number; r: number }
  | { type: 'arc'; cx: number; cy: number; r: number; startAngle: number; endAngle: number }
  | { type: 'polyline'; pts: FastPt[]; closed: boolean };

export interface FastBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface FastDxfResult {
  shapes: FastShape[];
  bounds: FastBounds;
  entityCount: number;
  widthMm: number;
  heightMm: number;
}

// Global in-memory cache to avoid reparsing the same file or string
const cache = new Map<string, FastDxfResult>();

/**
 * Fast linear string scanning parser for DXF content
 */
export function parseDxfFast(dxfText: string, cacheKey?: string): FastDxfResult {
  if (cacheKey && cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  // Quick fallback cache key based on length and first/last chars
  const fallbackKey = cacheKey || `len:${dxfText.length}:h:${dxfText.slice(0, 40)}:${dxfText.slice(-40)}`;
  if (cache.has(fallbackKey)) {
    return cache.get(fallbackKey)!;
  }

  const shapes: FastShape[] = [];
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

  // Line-by-line iterator without large array allocation
  let lineStart = 0;
  const len = dxfText.length;

  function nextLine(): string {
    if (lineStart >= len) return '';
    let lineEnd = dxfText.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = len;
    let line = dxfText.substring(lineStart, lineEnd);
    if (line.endsWith('\r')) line = line.substring(0, line.length - 1);
    lineStart = lineEnd + 1;
    return line.trim();
  }

  let inEntitiesSection = false;
  let currentEntity: string | null = null;

  // Temporary entity fields
  let p1x = 0, p1y = 0, p2x = 0, p2y = 0;
  let cx = 0, cy = 0, radius = 0;
  let startAngle = 0, endAngle = 0;
  let polyPts: FastPt[] = [];
  let polyClosed = false;
  let isParsingPolyline = false;

  function commitEntity() {
    if (!currentEntity) return;

    if (currentEntity === 'LINE') {
      shapes.push({ type: 'line', x1: p1x, y1: p1y, x2: p2x, y2: p2y });
      updateBounds(p1x, p1y);
      updateBounds(p2x, p2y);
    } else if (currentEntity === 'CIRCLE') {
      if (radius > 0) {
        shapes.push({ type: 'circle', cx, cy, r: radius });
        updateBounds(cx - radius, cy - radius);
        updateBounds(cx + radius, cy + radius);
      }
    } else if (currentEntity === 'ARC') {
      if (radius > 0) {
        shapes.push({ type: 'arc', cx, cy, r: radius, startAngle, endAngle });
        // Approximate arc bounds by full circle bounding box or endpoints
        updateBounds(cx - radius, cy - radius);
        updateBounds(cx + radius, cy + radius);
      }
    } else if (currentEntity === 'LWPOLYLINE' || currentEntity === 'POLYLINE') {
      if (polyPts.length > 0) {
        shapes.push({ type: 'polyline', pts: polyPts, closed: polyClosed });
        for (const p of polyPts) {
          updateBounds(p.x, p.y);
        }
      }
    }

    currentEntity = null;
    polyPts = [];
    polyClosed = false;
    radius = 0;
    cx = 0;
    cy = 0;
    startAngle = 0;
    endAngle = 0;
  }

  while (lineStart < len) {
    const codeStr = nextLine();
    if (!codeStr) continue;
    const groupCode = parseInt(codeStr, 10);
    const value = nextLine();

    if (groupCode === 0) {
      const upperVal = value.toUpperCase();

      if (upperVal === 'SECTION') {
        commitEntity();
        inEntitiesSection = false;
      } else if (upperVal === 'ENDSEC' || upperVal === 'EOF') {
        commitEntity();
        if (upperVal === 'EOF') break;
      } else if (inEntitiesSection || !dxfText.includes('ENTITIES')) {
        // We are processing entities
        if (isParsingPolyline && (upperVal === 'VERTEX' || upperVal === 'SEQEND')) {
          if (upperVal === 'SEQEND') {
            commitEntity();
            isParsingPolyline = false;
          }
        } else {
          commitEntity();
          currentEntity = upperVal;
          if (upperVal === 'POLYLINE') {
            isParsingPolyline = true;
          }
        }
      }
      continue;
    }

    if (groupCode === 2) {
      if (value.toUpperCase() === 'ENTITIES') {
        inEntitiesSection = true;
      }
      continue;
    }

    // Parse entity properties if active
    if (currentEntity) {
      if (currentEntity === 'LINE') {
        if (groupCode === 10) p1x = parseFloat(value) || 0;
        else if (groupCode === 20) p1y = parseFloat(value) || 0;
        else if (groupCode === 11) p2x = parseFloat(value) || 0;
        else if (groupCode === 21) p2y = parseFloat(value) || 0;
      } else if (currentEntity === 'CIRCLE') {
        if (groupCode === 10) cx = parseFloat(value) || 0;
        else if (groupCode === 20) cy = parseFloat(value) || 0;
        else if (groupCode === 40) radius = parseFloat(value) || 0;
      } else if (currentEntity === 'ARC') {
        if (groupCode === 10) cx = parseFloat(value) || 0;
        else if (groupCode === 20) cy = parseFloat(value) || 0;
        else if (groupCode === 40) radius = parseFloat(value) || 0;
        else if (groupCode === 50) startAngle = parseFloat(value) || 0;
        else if (groupCode === 51) endAngle = parseFloat(value) || 0;
      } else if (currentEntity === 'LWPOLYLINE') {
        if (groupCode === 70) {
          const flag = parseInt(value, 10) || 0;
          if (flag & 1) polyClosed = true;
        } else if (groupCode === 10) {
          polyPts.push({ x: parseFloat(value) || 0, y: 0 });
        } else if (groupCode === 20 && polyPts.length > 0) {
          polyPts[polyPts.length - 1].y = parseFloat(value) || 0;
        }
      } else if (currentEntity === 'POLYLINE') {
        if (groupCode === 70) {
          const flag = parseInt(value, 10) || 0;
          if (flag & 1) polyClosed = true;
        }
      } else if (currentEntity === 'VERTEX') {
        if (groupCode === 10) {
          polyPts.push({ x: parseFloat(value) || 0, y: 0 });
        } else if (groupCode === 20 && polyPts.length > 0) {
          polyPts[polyPts.length - 1].y = parseFloat(value) || 0;
        }
      }
    }
  }

  commitEntity();

  // If no shapes were found or invalid bounds, fallback to safe defaults
  if (!Number.isFinite(minX)) minX = 0;
  if (!Number.isFinite(minY)) minY = 0;
  if (!Number.isFinite(maxX)) maxX = 100;
  if (!Number.isFinite(maxY)) maxY = 100;

  const widthMm = Math.max(maxX - minX, 0);
  const heightMm = Math.max(maxY - minY, 0);

  const result: FastDxfResult = {
    shapes,
    bounds: { minX, minY, maxX, maxY },
    entityCount: shapes.length,
    widthMm,
    heightMm,
  };

  cache.set(fallbackKey, result);
  return result;
}

/**
 * Renders thumbnail shapes into an HTML5 Canvas with CAD coordinate transformation
 */
export function drawDxfThumbnailToCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  result: FastDxfResult,
  options: {
    strokeColor?: string;
    lineWidth?: number;
    backgroundColor?: string;
    showGrid?: boolean;
    padding?: number;
  } = {}
) {
  const {
    strokeColor = '#00e5a3',
    lineWidth = 1.2,
    backgroundColor = '#0b1017',
    showGrid = true,
    padding = 6,
  } = options;

  // Background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  // Subtle CAD grid background
  if (showGrid) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    const step = Math.max(8, Math.round(width / 6));
    ctx.beginPath();
    for (let x = step; x < width; x += step) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
    }
    for (let y = step; y < height; y += step) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
    }
    ctx.stroke();

    // Subtle center axis marks
    ctx.strokeStyle = 'rgba(0, 229, 163, 0.12)';
    ctx.beginPath();
    ctx.moveTo(width / 2, 2);
    ctx.lineTo(width / 2, height - 2);
    ctx.moveTo(2, height / 2);
    ctx.lineTo(width - 2, height / 2);
    ctx.stroke();
  }

  if (result.shapes.length === 0) {
    // Empty preview indicator
    ctx.fillStyle = 'rgba(148, 163, 184, 0.3)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Sem CAD', width / 2, height / 2);
    return;
  }

  const { minX, minY, maxX, maxY } = result.bounds;
  const bw = Math.max(maxX - minX, 1e-4);
  const bh = Math.max(maxY - minY, 1e-4);

  const availableW = Math.max(width - padding * 2, 10);
  const availableH = Math.max(height - padding * 2, 10);

  const s = Math.min(availableW / bw, availableH / bh);
  const ox = (width - bw * s) / 2 - minX * s;
  const oy = (height + bh * s) / 2 + minY * s;

  const tx = (x: number) => ox + x * s;
  const ty = (y: number) => oy - y * s;

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();

  for (const sItem of result.shapes) {
    if (sItem.type === 'line') {
      ctx.moveTo(tx(sItem.x1), ty(sItem.y1));
      ctx.lineTo(tx(sItem.x2), ty(sItem.y2));
    } else if (sItem.type === 'circle') {
      ctx.moveTo(tx(sItem.cx + sItem.r), ty(sItem.cy));
      ctx.arc(tx(sItem.cx), ty(sItem.cy), Math.max(0.5, sItem.r * s), 0, Math.PI * 2);
    } else if (sItem.type === 'arc') {
      const startRad = (sItem.startAngle * Math.PI) / 180;
      let endRad = (sItem.endAngle * Math.PI) / 180;
      if (endRad < startRad) endRad += Math.PI * 2;
      const steps = Math.max(6, Math.min(24, Math.round(sItem.r * s)));
      ctx.moveTo(tx(sItem.cx + Math.cos(startRad) * sItem.r), ty(sItem.cy + Math.sin(startRad) * sItem.r));
      for (let i = 1; i <= steps; i++) {
        const a = startRad + ((endRad - startRad) * i) / steps;
        ctx.lineTo(tx(sItem.cx + Math.cos(a) * sItem.r), ty(sItem.cy + Math.sin(a) * sItem.r));
      }
    } else if (sItem.type === 'polyline') {
      if (sItem.pts.length > 0) {
        ctx.moveTo(tx(sItem.pts[0].x), ty(sItem.pts[0].y));
        for (let i = 1; i < sItem.pts.length; i++) {
          ctx.lineTo(tx(sItem.pts[i].x), ty(sItem.pts[i].y));
        }
        if (sItem.closed) {
          ctx.closePath();
        }
      }
    }
  }

  ctx.stroke();
}
