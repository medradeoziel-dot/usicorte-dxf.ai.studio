import React, { useState, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  convertDwgToDxf,
  downloadDxfString,
  type ConvertDwgResponse,
} from '@/lib/dwgConverter';
import { DxfThumbnail } from '@/components/DxfThumbnail';
import {
  ArrowRightLeft,
  Upload,
  Download,
  Eye,
  CheckCircle,
  AlertCircle,
  Loader2,
  FileCode,
  Sparkles,
} from 'lucide-react';

interface DwgConverterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoadDxf: (dxfText: string, filename: string) => void;
}

export function DwgConverterDialog({
  open,
  onOpenChange,
  onLoadDxf,
}: DwgConverterDialogProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [result, setResult] = useState<ConvertDwgResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);

  function resetState() {
    setSelectedFile(null);
    setIsConverting(false);
    setResult(null);
    setError(null);
  }

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.dwg')) {
      setError('Por favor selecione um arquivo com extensão .dwg.');
      return;
    }
    setSelectedFile(file);
    setError(null);
    setResult(null);

    // Auto-convert on file select
    await doConversion(file);
  }

  async function doConversion(file: File) {
    try {
      setIsConverting(true);
      setError(null);
      const res = await convertDwgToDxf(file);
      setResult(res);
      setIsConverting(false);
    } catch (err: any) {
      setIsConverting(false);
      setError(err?.message || 'Falha ao converter o arquivo DWG.');
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFile(e.dataTransfer.files[0]);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        onOpenChange(val);
        if (!val) resetState();
      }}
    >
      <DialogContent className="max-w-xl border-slate-800 bg-[#0f1520] text-slate-100 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-base text-sky-400">
            <ArrowRightLeft className="h-5 w-5 text-sky-400" /> Conversor Automático DWG → DXF
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-400">
            Envie arquivos proprietários do AutoCAD (.dwg) para converter em formato padrão ASCII DXF (.dxf)
            utilizando o backend com suporte a ODA File Converter, LibreDWG e WebAssembly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* File Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-all cursor-pointer ${
              dragActive
                ? 'border-sky-400 bg-sky-950/40 text-sky-200'
                : 'border-slate-700 bg-slate-900/50 hover:border-sky-500/60 hover:bg-slate-900/80'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".dwg"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  void handleFile(e.target.files[0]);
                }
              }}
            />

            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-500/10 text-sky-400 mb-3 border border-sky-500/30">
              <Upload className="h-6 w-6" />
            </div>

            <p className="text-xs font-semibold text-slate-200">
              {selectedFile ? selectedFile.name : 'Clique para selecionar ou arraste o arquivo .DWG aqui'}
            </p>
            <p className="mt-1 text-[11px] font-mono text-slate-500">
              Suporta formatos AutoCAD DWG R13 até AutoCAD 2018+ (máx 50MB)
            </p>
          </div>

          {/* Progress / Loading Indicator */}
          {isConverting && (
            <div className="flex items-center gap-3 rounded-lg border border-sky-500/30 bg-sky-950/20 p-3.5 text-xs text-sky-300 animate-pulse">
              <Loader2 className="h-5 w-5 animate-spin text-sky-400 shrink-0" />
              <div>
                <p className="font-semibold">Convertendo geometria DWG no servidor…</p>
                <p className="text-[10px] text-slate-400">
                  Executando extração de camadas, blocos e entidades para DXF.
                </p>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-300">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Result Card */}
          {result && !isConverting && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <DxfThumbnail
                    dxfText={result.dxf}
                    width={56}
                    height={56}
                    showBadge={true}
                    className="rounded-lg bg-slate-950 border border-emerald-500/40 shrink-0"
                  />
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                      <CheckCircle className="h-4 w-4 text-emerald-400" />
                      <span>Conversão concluída com sucesso!</span>
                    </div>
                    <p className="font-mono text-[11px] text-slate-200 mt-0.5 truncate max-w-[260px]">
                      {result.filename}
                    </p>
                    <p className="font-mono text-[10px] text-slate-400 mt-0.5">
                      Motor:{' '}
                      <strong className="text-sky-300 font-semibold">{result.engine}</strong> · {(result.sizeBytes / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-emerald-900/40">
                <button
                  type="button"
                  onClick={() => {
                    onLoadDxf(result.dxf, result.filename);
                    onOpenChange(false);
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition-colors shadow-md cursor-pointer"
                >
                  <Eye className="h-3.5 w-3.5" /> Abrir no Visualizador CAD
                </button>

                <button
                  type="button"
                  onClick={() => downloadDxfString(result.dxf, result.filename)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5 text-sky-400" /> Baixar Arquivo .DXF
                </button>
              </div>
            </div>
          )}

          {/* Information box about backend CLI integration */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 font-mono text-[10px] text-slate-400 space-y-1">
            <div className="flex items-center gap-1 text-slate-300 font-semibold">
              <Sparkles className="h-3 w-3 text-amber-400" /> Motores Suportados no Servidor:
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-slate-400 pl-1">
              <li>
                <span className="text-slate-300 font-medium">ODA File Converter</span> (Open Design Alliance CLI se instalado no host)
              </li>
              <li>
                <span className="text-slate-300 font-medium">LibreDWG (dwg2dxf)</span> (GNU LibreDWG CLI)
              </li>
              <li>
                <span className="text-slate-300 font-medium">WebAssembly (acadrust)</span> (Motor nativo integrado com zero dependências externas)
              </li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
