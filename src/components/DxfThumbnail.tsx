import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  parseDxfFast,
  drawDxfThumbnailToCanvas,
  type FastDxfResult,
} from '@/lib/fastDxfParser';
import { convertDwgToDxf } from '@/lib/dwgConverter';
import { FileCode, Loader2, Maximize2 } from 'lucide-react';

export interface DxfThumbnailProps {
  /** Raw DXF text content (optional if file is provided) */
  dxfText?: string;
  /** File object (will be read asynchronously and cached) */
  file?: File;
  /** Display width in pixels (default: 48) */
  width?: number;
  /** Display height in pixels (default: 48) */
  height?: number;
  /** Custom stroke color for vector lines (default: #00e5a3) */
  strokeColor?: string;
  /** Line width in pixels (default: 1.2) */
  lineWidth?: number;
  /** Background color (default: #0a0f16) */
  backgroundColor?: string;
  /** Whether to show a subtle technical CAD grid in the background */
  showGrid?: boolean;
  /** Whether to show a small dimensions badge (e.g. '150×80mm') */
  showBadge?: boolean;
  /** Whether hovering displays an enlarged popover preview */
  showHoverPreview?: boolean;
  /** Optional custom CSS classes */
  className?: string;
  /** Optional click handler */
  onClick?: () => void;
  /** Optional title / tooltip */
  title?: string;
}

// In-memory file text cache to avoid reading file.text() repeatedly
const fileTextCache = new WeakMap<File, string>();

export const DxfThumbnail: React.FC<DxfThumbnailProps> = React.memo(function DxfThumbnail({
  dxfText,
  file,
  width = 48,
  height = 48,
  strokeColor = '#00e5a3',
  lineWidth = 1.2,
  backgroundColor = '#090d14',
  showGrid = true,
  showBadge = false,
  showHoverPreview = false,
  className = '',
  onClick,
  title,
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [content, setContent] = useState<string | null>(dxfText || null);
  const [loading, setLoading] = useState<boolean>(!dxfText && !!file);
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Read file asynchronously if file prop is passed and no dxfText provided
  useEffect(() => {
    if (dxfText) {
      setContent(dxfText);
      setLoading(false);
      setError(null);
      return;
    }

    if (!file) {
      setContent(null);
      setLoading(false);
      return;
    }

    // Check cached file text
    const cached = fileTextCache.get(file);
    if (cached) {
      setContent(cached);
      setLoading(false);
      setError(null);
      return;
    }

    // Check if binary DWG - convert via backend to render live vector thumbnail
    if (file.name.toLowerCase().endsWith('.dwg')) {
      let isMounted = true;
      setLoading(true);
      setError(null);
      convertDwgToDxf(file)
        .then((res) => {
          if (!isMounted) return;
          fileTextCache.set(file, res.dxf);
          setContent(res.dxf);
          setLoading(false);
        })
        .catch(() => {
          if (!isMounted) return;
          setError('DWG');
          setLoading(false);
        });
      return () => {
        isMounted = false;
      };
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    // Read with FileReader
    const reader = new FileReader();
    reader.onload = () => {
      if (!isMounted) return;
      const text = (reader.result as string) || '';
      fileTextCache.set(file, text);
      setContent(text);
      setLoading(false);
    };
    reader.onerror = () => {
      if (!isMounted) return;
      setError('Erro');
      setLoading(false);
    };

    reader.readAsText(file);

    return () => {
      isMounted = false;
      reader.abort();
    };
  }, [file, dxfText]);

  // Parse lightweight geometry
  const parsedData = useMemo<FastDxfResult | null>(() => {
    if (!content) return null;
    const cacheKey = file
      ? `file:${file.name}:${file.size}:${file.lastModified}`
      : undefined;
    try {
      return parseDxfFast(content, cacheKey);
    } catch {
      return null;
    }
  }, [content, file]);

  // Draw on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !parsedData) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawDxfThumbnailToCanvas(ctx, width, height, parsedData, {
      strokeColor,
      lineWidth,
      backgroundColor,
      showGrid,
      padding: Math.max(3, Math.min(6, width * 0.08)),
    });
  }, [parsedData, width, height, strokeColor, lineWidth, backgroundColor, showGrid]);

  const dimensionText = useMemo(() => {
    if (!parsedData) return '';
    const w = Math.round(parsedData.widthMm);
    const h = Math.round(parsedData.heightMm);
    return `${w}×${h}mm`;
  }, [parsedData]);

  return (
    <div
      className={`relative inline-flex items-center justify-center select-none ${
        onClick ? 'cursor-pointer' : ''
      } ${className}`}
      onClick={onClick}
      onMouseEnter={() => showHoverPreview && setIsHovered(true)}
      onMouseLeave={() => showHoverPreview && setIsHovered(false)}
      title={title || (parsedData ? `Peça: ${dimensionText} (${parsedData.entityCount} entidades)` : undefined)}
      style={{ width, height }}
    >
      {loading ? (
        <div
          className="flex items-center justify-center rounded border border-slate-800 bg-[#090d14]"
          style={{ width, height }}
        >
          <Loader2 className="h-3.5 w-3.5 text-slate-500 animate-spin" />
        </div>
      ) : error ? (
        <div
          className="flex flex-col items-center justify-center rounded border border-amber-900/40 bg-amber-950/20 text-amber-400"
          style={{ width, height }}
        >
          <FileCode className="h-4 w-4" />
          <span className="text-[8px] font-mono font-bold leading-tight">{error}</span>
        </div>
      ) : (
        <>
          <canvas
            ref={canvasRef}
            style={{ width: `${width}px`, height: `${height}px` }}
            className="rounded border border-slate-800/80 shadow-inner block"
          />

          {showBadge && dimensionText && (
            <span className="absolute bottom-0.5 right-0.5 rounded bg-slate-950/80 px-1 py-0.2 font-mono text-[8px] text-slate-300 backdrop-blur-sm border border-slate-700/50">
              {dimensionText}
            </span>
          )}

          {/* Interactive Hover Popover Preview */}
          {showHoverPreview && isHovered && parsedData && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none w-48 rounded-lg border border-slate-700 bg-[#0c121c] p-2.5 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-800 text-[10px] font-mono text-slate-400">
                <span className="font-semibold text-emerald-400 flex items-center gap-1">
                  <Maximize2 className="h-3 w-3" /> Preview CAD
                </span>
                <span>{parsedData.entityCount} ent.</span>
              </div>
              <div className="flex justify-center my-1 bg-[#070b10] rounded border border-slate-800 p-1">
                <canvas
                  ref={(c) => {
                    if (!c) return;
                    const ctx = c.getContext('2d');
                    if (!ctx) return;
                    const dpr = window.devicePixelRatio || 1;
                    c.width = 160 * dpr;
                    c.height = 120 * dpr;
                    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    drawDxfThumbnailToCanvas(ctx, 160, 120, parsedData, {
                      strokeColor: '#00e5a3',
                      lineWidth: 1.4,
                      backgroundColor: '#070b10',
                      showGrid: true,
                      padding: 10,
                    });
                  }}
                  style={{ width: '160px', height: '120px' }}
                  className="rounded"
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] font-mono text-slate-300">
                <span>Dimensões:</span>
                <span className="font-bold text-sky-400">{dimensionText}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
});
