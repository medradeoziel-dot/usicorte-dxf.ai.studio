/**
 * CAD Viewer & CNC Measurement Tool
 * Supports DXF/DWG files, Interactive Distance Measurement with Key 'C',
 * Selection & Cleaning for CNC Cut, and Regenerated DXF Export.
 */
import { useMemo, useRef, useState, useEffect } from 'react';
import {
  Ruler,
  Scissors,
  Download,
  RotateCcw,
  FileCode,
  FolderOpen,
  Info,
  Layers,
  Sparkles,
  Trash2,
  Maximize2,
  CheckCircle2,
  Crosshair,
  Expand,
  ListOrdered,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  SkipForward,
  CheckCircle,
  Clock,
  Plus,
} from 'lucide-react';
import { DrawingCanvas, type UserMeasurement } from './components/DrawingCanvas';
import { PWAInstallButton } from './components/PWAInstallButton';
import {
  parseDxf,
  exportDxf,
  type DxfModel,
  type DxfExportFormat,
  getShapesBounds,
  getConnectedShapeIds,
  type SelectionBounds,
} from './lib/dxf';
import { SAMPLE_PARTS } from './lib/samples';

export interface QueueItem {
  id: string;
  file: File;
  name: string;
  size: number;
  status: 'pending' | 'active' | 'completed' | 'skipped';
}

function fmt(n: number) {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatFileSize(bytes: number) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function baseName(filename: string) {
  return filename.replace(/\.[^.]+$/, '');
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [model, setModel] = useState<DxfModel | null>(null);
  const [filename, setFilename] = useState<string>('');
  const [outputName, setOutputName] = useState<string>('');
  const [dxfRawText, setDxfRawText] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // CNC entity selection and removal
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [removedIds, setRemovedIds] = useState<Set<number>>(new Set());
  const [hoveredDimId, setHoveredDimId] = useState<number | null>(null);

  // Measurement (C key) mode
  const [measuring, setMeasuring] = useState<boolean>(false);
  const [measurements, setMeasurements] = useState<UserMeasurement[]>([]);
  const [includeMeasurementsInExport, setIncludeMeasurementsInExport] = useState<boolean>(true);
  const [showMeasurementsHistory, setShowMeasurementsHistory] = useState<boolean>(false);
  const [showTechSummary, setShowTechSummary] = useState<boolean>(true);

  // AutoCAD DXF format version (AutoCAD R12 AC1009 as universal standard)
  const [dxfVersion, setDxfVersion] = useState<DxfExportFormat>('AutoCAD R12');

  // Batch processing queue
  const [fileQueue, setFileQueue] = useState<QueueItem[]>([]);
  const [queueIndex, setQueueIndex] = useState<number>(0);
  const [batchCompleted, setBatchCompleted] = useState<boolean>(false);

  // Notification toast
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'success' | 'warning' } | null>(null);

  const showToast = (message: string, type: 'info' | 'success' | 'warning' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4000);
  };

  const completedCount = useMemo(() => {
    return fileQueue.filter((q) => q.status === 'completed').length;
  }, [fileQueue]);

  const progressPct = useMemo(() => {
    if (fileQueue.length === 0) return 0;
    return Math.round((completedCount / fileQueue.length) * 100);
  }, [completedCount, fileQueue.length]);

  // Filtered view model (removes deleted shapes)
  const viewModel = useMemo<DxfModel | null>(() => {
    if (!model) return null;
    if (removedIds.size === 0) return model;
    return {
      ...model,
      shapes: model.shapes.filter((s) => !removedIds.has(s.id)),
      entityCount: model.shapes.filter((s) => !removedIds.has(s.id)).length + model.dims.length,
    };
  }, [model, removedIds]);

  // Load a DXF string into state
  async function loadDxfContent(text: string, name: string) {
    try {
      setStatusMessage('Processando geometria CAD do arquivo…');
      setErrorMessage(null);
      const parsed = await parseDxf(text);
      setModel(parsed);
      setDxfRawText(text);
      setFilename(name);
      setOutputName(baseName(name) + '-corte-cnc');
      setSelectedIds(new Set());
      setRemovedIds(new Set());
      setMeasurements([]);
      setShowTechSummary(true);
      setStatusMessage(null);
      showToast(`Arquivo "${name}" carregado com sucesso! Pressione 'C' para medir distâncias.`, 'success');
    } catch (err: any) {
      setStatusMessage(null);
      setErrorMessage(err?.message || 'Não foi possível interpretar o arquivo DXF.');
    }
  }

  // Load a specific queue item into the active viewport
  async function loadQueueItem(index: number, queueToUse?: QueueItem[]) {
    const list = queueToUse || fileQueue;
    if (index < 0 || index >= list.length) return;
    const item = list[index];
    if (!item) return;

    setQueueIndex(index);
    setFileQueue((prev) =>
      prev.map((q, idx) => {
        if (idx === index) return { ...q, status: 'active' };
        if (q.status === 'active') return { ...q, status: 'pending' };
        return q;
      })
    );

    setErrorMessage(null);
    const lowerName = item.name.toLowerCase();
    if (lowerName.endsWith('.dwg')) {
      showToast(
        `Arquivo "${item.name}": Formato DWG binário proprietário. Para maior precisão, converta para DXF!`,
        'warning'
      );
      setErrorMessage(
        `O arquivo "${item.name}" é um DWG binário. Se houver falha de leitura, utilize arquivos DXF.`
      );
    }

    try {
      setStatusMessage(`Lendo arquivo ${index + 1} de ${list.length}: "${item.name}"…`);
      const text = await item.file.text();
      await loadDxfContent(text, item.name);
      setStatusMessage(null);
    } catch (err: any) {
      setStatusMessage(null);
      setErrorMessage(`Erro ao ler "${item.name}": ` + err?.message);
    }
  }

  // Handle uploaded files (single or multiple)
  async function handleFilesInput(files: FileList | File[], forceLoadFirst = false) {
    setErrorMessage(null);
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    const newItems: QueueItem[] = fileArray.map((f, i) => ({
      id: `${f.name}-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      file: f,
      name: f.name,
      size: f.size,
      status: 'pending',
    }));

    if (fileQueue.length === 0 || forceLoadFirst) {
      newItems[0].status = 'active';
      setFileQueue(newItems);
      setQueueIndex(0);
      setBatchCompleted(false);
      void loadQueueItem(0, newItems);
      if (newItems.length > 1) {
        showToast(`Fila de lote iniciada com ${newItems.length} arquivos! Primeiro arquivo carregado.`, 'info');
      }
    } else {
      setFileQueue((prev) => [...prev, ...newItems]);
      showToast(`+${newItems.length} arquivo(s) adicionado(s) à fila de lote! Total: ${fileQueue.length + newItems.length}`, 'info');
    }
  }

  // Handle single file upload fallback
  async function handleFileInput(file: File) {
    await handleFilesInput([file]);
  }

  // Queue navigation functions
  function handleNextFile() {
    if (fileQueue.length === 0) return;
    if (queueIndex < fileQueue.length - 1) {
      loadQueueItem(queueIndex + 1);
    } else {
      showToast('Você já está no último arquivo da fila.', 'info');
    }
  }

  function handlePreviousFile() {
    if (fileQueue.length === 0) return;
    if (queueIndex > 0) {
      loadQueueItem(queueIndex - 1);
    } else {
      showToast('Você já está no primeiro arquivo da fila.', 'info');
    }
  }

  function handleSkipFile() {
    if (fileQueue.length === 0) return;
    const currentName = fileQueue[queueIndex]?.name;
    setFileQueue((prev) =>
      prev.map((q, idx) => (idx === queueIndex ? { ...q, status: 'skipped' } : q))
    );
    if (queueIndex < fileQueue.length - 1) {
      loadQueueItem(queueIndex + 1);
      showToast(`"${currentName}" ignorado. Próximo arquivo carregado.`, 'info');
    } else {
      showToast(`"${currentName}" marcado como ignorado. Fim da fila atingido.`, 'info');
    }
  }

  function handleRemoveFromQueue(id: string) {
    setFileQueue((prev) => {
      const idxToRemove = prev.findIndex((q) => q.id === id);
      const nextQueue = prev.filter((q) => q.id !== id);
      if (nextQueue.length === 0) {
        setQueueIndex(0);
        setBatchCompleted(false);
      } else if (idxToRemove === queueIndex) {
        const newIdx = Math.min(queueIndex, nextQueue.length - 1);
        setQueueIndex(newIdx);
        void loadQueueItem(newIdx, nextQueue);
      } else if (idxToRemove < queueIndex) {
        setQueueIndex((curr) => curr - 1);
      }
      return nextQueue;
    });
  }

  function handleClearQueue() {
    setFileQueue([]);
    setQueueIndex(0);
    setBatchCompleted(false);
    showToast('Fila de processamento em lote foi limpa.', 'info');
  }

  // Load predefined sample part
  function handleLoadSample(sampleIndex: number) {
    const sample = SAMPLE_PARTS[sampleIndex];
    if (!sample) return;
    loadDxfContent(sample.dxf, sample.filename);
  }

  // Auto-load initial sample part on first open so user immediately sees the CAD viewer & measuring tool!
  useEffect(() => {
    const isShared = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('shared') === 'true';
    if (!model && SAMPLE_PARTS[0] && !isShared) {
      loadDxfContent(SAMPLE_PARTS[0].dxf, SAMPLE_PARTS[0].filename);
    }
  }, []);

  // Native PWA Integration: File Handling API (double-click .dxf/.dwg in OS or open via WhatsApp)
  // and Web Share Target API (files shared into CAD Viewer from other apps)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Web Share Target receiver
    const params = new URLSearchParams(window.location.search);
    if (params.get('shared') === 'true') {
      window.history.replaceState({}, '', window.location.pathname);
      void (async () => {
        try {
          if ('caches' in window) {
            const cache = await caches.open('shared-cad-files');
            const res = await cache.match('/shared-file');
            if (res) {
              const blob = await res.blob();
              const fileName = decodeURIComponent(res.headers.get('x-file-name') || 'desenho-compartilhado.dxf');
              const file = new File([blob], fileName, { type: blob.type || 'application/dxf' });
              await cache.delete('/shared-file');
              void handleFilesInput([file], true);
              showToast(`Arquivo "${fileName}" recebido e aberto na prancheta!`, 'success');
            }
          }
        } catch (e) {
          console.warn('[PWA] Erro ao processar arquivo compartilhado:', e);
        }
      })();
    }

    // 2. Chromium File Handling API (launchQueue for files selected in OS or opened via apps like WhatsApp)
    if ('launchQueue' in window) {
      (window as any).launchQueue.setConsumer(async (launchParams: any) => {
        if (!launchParams || !launchParams.files || !launchParams.files.length) return;
        const files: File[] = [];
        for (const handle of launchParams.files) {
          try {
            const file = await handle.getFile();
            files.push(file);
          } catch (err) {
            console.warn('[PWA] Erro ao obter arquivo do launchQueue:', err);
          }
        }
        if (files.length > 0) {
          void handleFilesInput(files, true);
          showToast(`Arquivo "${files[0].name}" aberto na prancheta!`, 'success');
        }
      });
    }
  }, []);

  // Selection handlers
  function handleSelect(ids: number[], mode: 'replace' | 'toggle') {
    setSelectedIds((prev) => {
      if (mode === 'replace') return new Set(ids);
      const next = new Set(prev);
      for (const id of ids) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  // Delete selected shapes (Clean up for CNC)
  function deleteSelected() {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    setRemovedIds((prev) => new Set([...prev, ...selectedIds]));
    setSelectedIds(new Set());
    showToast(`${count} elemento(s) removido(s) do corte CNC.`, 'info');
  }

  // Restore deleted entities
  function restoreRemoved() {
    setRemovedIds(new Set());
    setSelectedIds(new Set());
    showToast('Todos os elementos foram restaurados.', 'info');
  }

  // Download regenerated DXF file (AutoCAD R12 AC1009) and auto-advance queue
  function handleDownloadDxf() {
    if (!model) return;
    const keptShapes = model.shapes.filter((s) => !removedIds.has(s.id));
    const userMeasuresToExport = includeMeasurementsInExport ? measurements : [];
    
    // Export with full compliance: HEADER, TABLES, BLOCKS, ENTITIES, EOF
    const exportedText = exportDxf(keptShapes, {
      version: dxfVersion,
      userMeasurements: userMeasuresToExport,
    });

    // Pure ASCII export without UTF-8 BOM, compatible with all AutoCAD and CNC systems
    const blob = new Blob([exportedText], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const finalFilename = (outputName.trim() || baseName(filename || 'desenho-cnc')) + '.dxf';
    link.href = url;
    link.download = finalFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    // If working in batch queue mode:
    if (fileQueue.length > 0) {
      // Mark current file as completed
      setFileQueue((prev) =>
        prev.map((q, idx) => (idx === queueIndex ? { ...q, status: 'completed' } : q))
      );

      // Auto-advance to the next file in queue
      if (queueIndex < fileQueue.length - 1) {
        const nextIdx = queueIndex + 1;
        showToast(
          `"${finalFilename}" exportado com sucesso! Carregando próximo (${nextIdx + 1} de ${fileQueue.length})…`,
          'success'
        );
        setTimeout(() => {
          void loadQueueItem(nextIdx);
        }, 400);
      } else {
        // Last file in queue exported!
        setBatchCompleted(true);
        showToast('🎉 Todos os arquivos da fila foram processados com sucesso!', 'success');
      }
    } else {
      showToast(`Arquivo "${finalFilename}" gerado em ${dxfVersion} com sucesso! 100% compatível com AutoCAD e CNC.`, 'success');
    }
  }

  // Toggle measuring with key 'C'
  function toggleMeasuring() {
    const next = !measuring;
    setMeasuring(next);
    if (next) {
      showToast("📐 Modo Medição (Tecla 'C') ATIVO: Clique em 2 pontos do desenho para cotar em mm.", 'info');
    }
  }

  // Selected shapes and automatic bounding box dimensions (X and Y)
  const selectedShapes = useMemo(() => {
    if (!viewModel || selectedIds.size === 0) return [];
    return viewModel.shapes.filter((s) => selectedIds.has(s.id));
  }, [viewModel, selectedIds]);

  const selectionBounds = useMemo(() => {
    return getShapesBounds(selectedShapes);
  }, [selectedShapes]);

  // Select all connected shapes forming a continuous or closed contour
  function handleSelectConnected(initialId?: number) {
    if (!viewModel) return;
    const targetId = initialId ?? Array.from(selectedIds)[0];
    if (targetId == null) return;
    const connected = getConnectedShapeIds(viewModel.shapes, targetId);
    setSelectedIds(new Set(connected));
    showToast(`Contorno fechado/conectado selecionado: ${connected.length} elementos.`, 'info');
  }

  // Fix current selection bounding box dimensions (X and Y) as real permanent measurements
  function handleCreateBBoxDimensions() {
    if (!selectionBounds) return;
    const newMeasures: UserMeasurement[] = [
      {
        id: `bbox_x_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        a: { x: selectionBounds.minX, y: selectionBounds.minY },
        b: { x: selectionBounds.maxX, y: selectionBounds.minY },
        distance: selectionBounds.width,
        dx: selectionBounds.width,
        dy: 0,
        label: `Largura X: ${selectionBounds.width.toFixed(2)} mm`,
        createdAt: Date.now(),
      },
      {
        id: `bbox_y_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        a: { x: selectionBounds.maxX, y: selectionBounds.minY },
        b: { x: selectionBounds.maxX, y: selectionBounds.maxY },
        distance: selectionBounds.height,
        dx: 0,
        dy: selectionBounds.height,
        label: `Comprimento Y: ${selectionBounds.height.toFixed(2)} mm`,
        createdAt: Date.now(),
      },
    ];
    setMeasurements((prev) => [...prev, ...newMeasures]);
    showToast(
      `Cotas totais X (${fmt(selectionBounds.width)} mm) e Y (${fmt(selectionBounds.height)} mm) adicionadas à prancheta e ao DXF!`,
      'success'
    );
  }

  const bounds = viewModel?.bounds;
  const boundWidth = bounds ? Math.max(0, bounds.maxX - bounds.minX) : 0;
  const boundHeight = bounds ? Math.max(0, bounds.maxY - bounds.minY) : 0;

  return (
    <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-5 px-4 py-6 md:px-8">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.25em] text-emerald-400 font-semibold">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            PRANCHETA DIGITAL CNC
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white md:text-3xl flex items-center gap-3">
            DWG → DXF com leitura de medidas
          </h1>
          <p className="mt-1 max-w-2xl text-xs md:text-sm text-slate-400">
            Envie um DWG ou DXF, meça distâncias exatas em mm com a <span className="font-mono text-emerald-400 font-semibold underline underline-offset-2">tecla 'C'</span>, limpe vetores dispensáveis para o corte CNC e baixe o DXF final.
          </p>
        </div>

        {/* Header Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Sample selector */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900/90 p-1">
            <span className="px-2 text-xs font-mono text-slate-400 flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5 text-amber-400" /> Modelos CNC:
            </span>
            {SAMPLE_PARTS.map((sample, idx) => (
              <button
                key={sample.name}
                onClick={() => handleLoadSample(idx)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-all ${
                  filename === sample.filename
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
                title={sample.description}
              >
                {sample.name.split(' ')[0]}
              </button>
            ))}
          </div>

          {/* Measuring Toggle Button (Key C) */}
          <button
            onClick={toggleMeasuring}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold tracking-wide transition-all shadow-md ${
              measuring
                ? 'bg-sky-500 text-slate-950 ring-2 ring-sky-300 ring-offset-2 ring-offset-slate-900 shadow-sky-500/25'
                : 'bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-500/40'
            }`}
            title="Ativar ferramenta de cotagem com dois cliques (Atalho: Tecla 'C')"
          >
            <Ruler className="h-4 w-4" />
            <span>Medir / Cotar</span>
            <kbd className="rounded bg-slate-950/40 px-1.5 py-0.5 font-mono text-[10px] uppercase">
              C
            </kbd>
            {measuring && (
              <span className="flex h-2 w-2 rounded-full bg-slate-950 animate-ping" />
            )}
          </button>

          {/* PWA Install Button */}
          <PWAInstallButton />

          {/* File Picker with Multiple Files Support */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 rounded-lg bg-emerald-400 px-4 py-2 text-xs font-bold text-slate-950 transition-all hover:bg-emerald-300 shadow-lg shadow-emerald-500/15 cursor-pointer"
          >
            <FolderOpen className="h-4 w-4" />
            <span>{fileQueue.length > 0 ? 'Adicionar Arquivos (.DXF)' : 'Carregar Arquivos (.DXF)'}</span>
            {fileQueue.length > 0 && (
              <span className="rounded-full bg-slate-950/25 px-1.5 py-0.5 text-[10px] font-mono font-extrabold text-slate-950">
                {fileQueue.length}
              </span>
            )}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".dxf,.dwg"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                void handleFilesInput(e.target.files);
              }
              e.target.value = '';
            }}
          />
        </div>
      </header>

      {/* Batch Processing Queue Header Bar */}
      {fileQueue.length > 0 && (
        <div className="rounded-xl border border-sky-500/40 bg-sky-950/25 p-3.5 shadow-lg backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Visual Indicator: Arquivo X de Y: peça_01.dxf */}
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-400 border border-sky-500/40 shadow-inner">
                <ListOrdered className="h-5 w-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold text-sky-300 uppercase tracking-wider">
                    Fila de Processamento:
                  </span>
                  <span className="font-mono text-xs font-black text-white bg-sky-900/60 px-2 py-0.5 rounded border border-sky-700/60">
                    Arquivo {queueIndex + 1} de {fileQueue.length}
                  </span>
                  <span className="text-slate-500">·</span>
                  <span
                    className="font-mono text-xs font-semibold text-emerald-300 truncate max-w-[280px]"
                    title={fileQueue[queueIndex]?.name}
                  >
                    {fileQueue[queueIndex]?.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 font-mono text-[10px] text-slate-400 mt-1">
                  <span>
                    Progresso:{' '}
                    <strong className="text-emerald-400">
                      {completedCount} de {fileQueue.length}
                    </strong>{' '}
                    exportado(s) ({progressPct}%)
                  </span>
                  <span>·</span>
                  <span>Tamanho: {formatFileSize(fileQueue[queueIndex]?.size || 0)}</span>
                </div>
              </div>
            </div>

            {/* Manual Navigation Controls (Anterior, Pular, Próximo, Adicionar, Limpar) */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={handlePreviousFile}
                disabled={queueIndex === 0}
                className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 font-mono text-xs text-slate-300 transition-colors hover:bg-slate-700 hover:text-white disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                title="Voltar para o arquivo anterior na fila"
              >
                <ChevronLeft className="h-4 w-4" />
                <span>Anterior</span>
              </button>

              <button
                onClick={handleSkipFile}
                className="flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 font-mono text-xs text-amber-300 transition-colors hover:bg-amber-500/20 cursor-pointer"
                title="Pular este arquivo e carregar o próximo da fila"
              >
                <SkipForward className="h-3.5 w-3.5" />
                <span>Pular</span>
              </button>

              <button
                onClick={handleNextFile}
                disabled={queueIndex >= fileQueue.length - 1}
                className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 font-mono text-xs text-slate-300 transition-colors hover:bg-slate-700 hover:text-white disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                title="Avançar para o próximo arquivo na fila"
              >
                <span>Próximo</span>
                <ChevronRight className="h-4 w-4" />
              </button>

              <div className="h-4 w-px bg-slate-700 mx-1" />

              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/15 px-2.5 py-1.5 font-mono text-xs text-sky-300 transition-colors hover:bg-sky-500/25 cursor-pointer"
                title="Adicionar mais arquivos à fila de espera"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Adicionar</span>
              </button>

              <button
                onClick={handleClearQueue}
                className="rounded-lg p-1.5 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                title="Limpar toda a fila de espera"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Visual Progress Bar */}
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800/80">
            <div
              className="h-full bg-gradient-to-r from-sky-400 via-emerald-400 to-emerald-300 transition-all duration-300 rounded-full"
              style={{ width: `${Math.max(progressPct, fileQueue.length > 0 ? 4 : 0)}%` }}
            />
          </div>
        </div>
      )}

      {/* Completion Notification Banner */}
      {batchCompleted && (
        <div className="rounded-xl border border-emerald-500/60 bg-emerald-950/40 p-4 text-emerald-200 shadow-2xl backdrop-blur-md flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-emerald-300 shrink-0">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <h3 className="font-mono text-sm font-bold text-white flex items-center gap-2">
                <span>Todos os arquivos da fila foram processados com sucesso!</span>
                <span className="text-base">🎉</span>
              </h3>
              <p className="mt-0.5 font-mono text-xs text-emerald-300/90">
                Todos os {fileQueue.length} arquivos foram gerados e salvos no padrão oficial DXF R12 pronto para corte CNC.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 font-mono text-xs">
            <button
              onClick={() => {
                setBatchCompleted(false);
                void loadQueueItem(0);
              }}
              className="rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 px-3 py-1.5 text-emerald-200 transition-colors cursor-pointer"
            >
              Revisar Fila
            </button>
            <button
              onClick={() => {
                setBatchCompleted(false);
                fileInputRef.current?.click();
              }}
              className="rounded-lg bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold px-3.5 py-1.5 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
            >
              Carregar Novo Lote
            </button>
          </div>
        </div>
      )}

      {/* Floating Status / Error Messages */}
      {statusMessage && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-500/50 bg-emerald-950/40 px-4 py-3 font-mono text-xs text-emerald-300 shadow-sm animate-pulse">
          <div className="h-3 w-3 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-rose-500/50 bg-rose-950/40 px-4 py-3 text-xs text-rose-200 shadow-sm">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-rose-400 hover:text-white font-mono text-xs"
          >
            ×
          </button>
        </div>
      )}

      {/* Notification Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 rounded-lg px-4 py-2.5 text-xs font-mono shadow-2xl border backdrop-blur-md transition-all ${
            toast.type === 'success'
              ? 'border-emerald-500/50 bg-[#0c1f17]/95 text-emerald-200'
              : toast.type === 'warning'
                ? 'border-amber-500/50 bg-[#241a08]/95 text-amber-200'
                : 'border-sky-500/50 bg-[#091522]/95 text-sky-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          ) : (
            <Info className="h-4 w-4 text-sky-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Main Workspace Layout */}
      <section className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
        {/* CAD Canvas Viewport */}
        <div
          className="panel relative flex flex-col min-h-[580px] rounded-xl p-2.5 overflow-hidden border border-slate-800"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              void handleFilesInput(e.dataTransfer.files);
            }
          }}
        >
          {viewModel ? (
            <>
              {/* Quick instructions bar */}
              <div className="pointer-events-none absolute left-4 top-4 z-10 max-w-[70%] select-none rounded-lg border border-slate-800/90 bg-[#0f141c]/90 px-3.5 py-2 font-mono text-[11px] text-slate-400 shadow-md backdrop-blur-sm">
                <span className="text-emerald-400 font-semibold">Atalhos CAD: </span>
                <span className="text-sky-300 font-semibold">[Tecla C]</span> medir 2 pontos ·{' '}
                <span className="text-slate-300">esq→dir:</span> janela ·{' '}
                <span className="text-slate-300">dir→esq:</span> cruzamento ·{' '}
                <span className="text-slate-300">Shift:</span> ortogonal/soma ·{' '}
                <span className="text-slate-300">Espaço:</span> arrastar ·{' '}
                <span className="text-amber-400">[Del/E]:</span> apagar ·{' '}
                <span className="text-slate-300">[Esc]:</span> cancelar
              </div>

              {/* Action pill toolbar */}
              <div className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0f141c]/95 p-1 shadow-lg">
                <button
                  onClick={toggleMeasuring}
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    measuring
                      ? 'bg-sky-500 text-slate-950 font-bold'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                  title="Ativar/desativar régua de medição (C)"
                >
                  <Ruler className="h-3.5 w-3.5" />
                  <span>Cotar (C)</span>
                </button>

                <button
                  onClick={deleteSelected}
                  disabled={selectedIds.size === 0}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-amber-300 hover:bg-amber-950/60 disabled:opacity-30 transition-colors"
                  title="Apagar elementos selecionados (Delete ou E)"
                >
                  <Scissors className="h-3.5 w-3.5" />
                  <span>Apagar ({selectedIds.size})</span>
                </button>

                {removedIds.size > 0 && (
                  <button
                    onClick={restoreRemoved}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    title="Restaurar elementos apagados"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* Interactive CAD Canvas */}
              <DrawingCanvas
                model={viewModel}
                highlight={hoveredDimId}
                selected={selectedIds}
                onSelect={handleSelect}
                onDelete={deleteSelected}
                measuring={measuring}
                onMeasuringChange={setMeasuring}
                measurements={measurements}
                onSelectConnected={handleSelectConnected}
                onAddMeasurement={(m) => {
                  setMeasurements((prev) => [...prev, m]);
                  showToast(`Medida exata: ${m.distance.toFixed(2)} mm (ΔX: ${m.dx.toFixed(2)} mm, ΔY: ${m.dy.toFixed(2)} mm)`, 'success');
                }}
                onRemoveMeasurement={(id) => {
                  setMeasurements((prev) => prev.filter((m) => m.id !== id));
                }}
                onClearMeasurements={() => {
                  setMeasurements([]);
                  showToast('Todas as cotas de medição foram limpas.', 'info');
                }}
              />
            </>
          ) : (
            <div className="flex h-full min-h-[500px] flex-col items-center justify-center gap-4 text-center p-6">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
                <FileCode className="h-12 w-12 text-emerald-400 mx-auto stroke-[1.5]" />
              </div>
              <div>
                <p className="font-mono text-base font-semibold text-slate-200">
                  Arraste um arquivo .DXF ou .DWG aqui
                </p>
                <p className="mt-1 max-w-sm text-xs text-slate-400">
                  Visualização vetorial precisa direto no navegador. Nenhum arquivo é enviado a servidores externos.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                <button
                  onClick={() => handleLoadSample(0)}
                  className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 px-3.5 py-2 text-xs font-mono text-emerald-300 hover:bg-emerald-900/50 transition-colors"
                >
                  ⚡ Carregar Flange CNC (200mm)
                </button>
                <button
                  onClick={() => handleLoadSample(1)}
                  className="rounded-lg border border-slate-700 bg-slate-800/80 px-3.5 py-2 text-xs font-mono text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  Carregar Chapa Angular (220×140mm)
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar */}
        <aside className="panel flex flex-col gap-5 rounded-xl p-5 border border-slate-800 bg-[#121822]">
          {/* Batch Processing Waiting List (when files are loaded) */}
          {fileQueue.length > 0 && (
            <div className="rounded-lg border border-sky-500/30 bg-sky-950/20 p-3">
              <div className="flex items-center justify-between pb-2 border-b border-sky-800/40">
                <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-sky-400 font-bold flex items-center gap-1.5">
                  <ListOrdered className="h-3.5 w-3.5" /> FILA DE ESPERA ({completedCount}/{fileQueue.length})
                </h2>
                <span className="font-mono text-[10px] text-sky-300 font-medium">
                  {progressPct}% pronto
                </span>
              </div>

              <div className="mt-2 max-h-[170px] overflow-y-auto space-y-1.5 pr-1 font-mono text-xs">
                {fileQueue.map((item, idx) => {
                  const isActive = idx === queueIndex;
                  return (
                    <div
                      key={item.id}
                      onClick={() => void loadQueueItem(idx)}
                      className={`group flex items-center justify-between rounded-lg px-2.5 py-1.5 transition-all cursor-pointer border ${
                        isActive
                          ? 'border-sky-400 bg-sky-900/50 text-white shadow-sm ring-1 ring-sky-400/40'
                          : item.status === 'completed'
                            ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300 hover:bg-emerald-950/40'
                            : item.status === 'skipped'
                              ? 'border-amber-500/30 bg-amber-950/20 text-amber-300 hover:bg-amber-950/40'
                              : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {item.status === 'completed' ? (
                          <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        ) : item.status === 'skipped' ? (
                          <span className="text-amber-400 font-bold shrink-0 text-xs">⊘</span>
                        ) : isActive ? (
                          <span className="h-2 w-2 rounded-full bg-sky-400 shrink-0 animate-ping" />
                        ) : (
                          <Clock className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                        )}
                        <div className="truncate">
                          <span className="truncate block font-medium text-[11px]">{item.name}</span>
                          <span className="text-[9px] text-slate-500">{formatFileSize(item.size)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 ml-2 shrink-0">
                        {isActive && (
                          <span className="rounded bg-sky-400/25 px-1.5 py-0.5 text-[9px] font-bold text-sky-200 uppercase">
                            Atual
                          </span>
                        )}
                        {item.status === 'completed' && !isActive && (
                          <span className="text-[9px] text-emerald-400 font-semibold">Salvo</span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveFromQueue(item.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 p-0.5 transition-opacity"
                          title="Remover da fila"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Summary Details (Collapsible) */}
          <div>
            <div
              onClick={() => setShowTechSummary((prev) => !prev)}
              className="flex items-center justify-between border-b border-slate-800 pb-2 cursor-pointer select-none group transition-colors hover:border-slate-700"
              title={showTechSummary ? "Recolher Resumo Técnico" : "Expandir Resumo Técnico"}
            >
              <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-400 font-bold flex items-center gap-1.5 group-hover:text-emerald-300 transition-colors">
                <Layers className="h-3.5 w-3.5" /> RESUMO TÉCNICO
              </h2>
              <div className="flex items-center gap-2">
                {filename && (
                  <span className="rounded bg-emerald-950/60 px-2 py-0.5 font-mono text-[10px] text-emerald-300 border border-emerald-800/60">
                    CNC ATIVO
                  </span>
                )}
                <button
                  type="button"
                  aria-label={showTechSummary ? "Recolher Resumo Técnico" : "Expandir Resumo Técnico"}
                  className="rounded p-1 text-slate-400 group-hover:text-white hover:bg-slate-800/80 transition-colors cursor-pointer"
                >
                  {showTechSummary ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {showTechSummary && (
              <dl className="mt-3 space-y-2 font-mono text-xs animate-in fade-in duration-150">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">arquivo</dt>
                  <dd className="truncate text-right font-medium text-slate-200" title={filename}>
                    {filename || '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">unidade</dt>
                  <dd className="text-right text-emerald-400 font-semibold">
                    {viewModel?.units ?? 'Milímetros (mm)'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">total elementos</dt>
                  <dd className="text-right text-slate-200">
                    {model ? model.shapes.length : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">mantidos p/ corte</dt>
                  <dd className="text-right font-semibold text-emerald-400">
                    {model ? model.shapes.length - removedIds.size : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">removidos (limpeza)</dt>
                  <dd className="text-right font-semibold text-amber-400">
                    {removedIds.size > 0 ? `${removedIds.size} removido(s)` : '0'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">extensão X × Y</dt>
                  <dd className="text-right text-sky-300 font-semibold">
                    {bounds ? `${fmt(boundWidth)} × ${fmt(boundHeight)} mm` : '—'}
                  </dd>
                </div>
              </dl>
            )}
          </div>

          {/* Automatic Measurement of Selection Total Dimensions (Bounding Box X and Y) */}
          <div className="border-t border-slate-800 pt-4">
            <div className="flex items-center justify-between pb-2">
              <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-sky-400 font-bold flex items-center gap-1.5">
                <Maximize2 className="h-3.5 w-3.5" /> DIMENSÃO TOTAL DA PEÇA (X × Y)
              </h2>
              {selectedIds.size > 0 && (
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="font-mono text-[10px] text-slate-400 hover:text-white transition-colors cursor-pointer"
                  title="Desmarcar seleção (Esc)"
                >
                  Limpar [Esc]
                </button>
              )}
            </div>

            {selectionBounds ? (
              <div className="space-y-2.5 rounded-xl border border-sky-500/30 bg-sky-950/20 p-3 shadow-inner">
                {/* Large Dynamic Dimensions X & Y */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-sky-500/40 bg-slate-900/90 p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-sky-400">
                        Largura (X)
                      </span>
                      <span className="font-mono text-[9px] text-slate-400">maxX - minX</span>
                    </div>
                    <div className="mt-1 font-mono text-xl font-extrabold text-sky-300">
                      {fmt(selectionBounds.width)} <span className="text-xs font-normal text-sky-400">mm</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[9px] text-slate-400 truncate">
                      {fmt(selectionBounds.minX)} → {fmt(selectionBounds.maxX)} mm
                    </div>
                  </div>

                  <div className="rounded-lg border border-emerald-500/40 bg-slate-900/90 p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                        Comprimento (Y)
                      </span>
                      <span className="font-mono text-[9px] text-slate-400">maxY - minY</span>
                    </div>
                    <div className="mt-1 font-mono text-xl font-extrabold text-emerald-300">
                      {fmt(selectionBounds.height)} <span className="text-xs font-normal text-emerald-400">mm</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[9px] text-slate-400 truncate">
                      {fmt(selectionBounds.minY)} → {fmt(selectionBounds.maxY)} mm
                    </div>
                  </div>
                </div>

                {/* Bounding Box Detailed Metrics */}
                <div className="rounded-lg bg-slate-900/80 p-2 font-mono text-[10px] text-slate-300 space-y-1 border border-slate-800">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Área Externa (X × Y):</span>
                    <span className="font-bold text-slate-200">
                      {fmt(selectionBounds.area)} mm² ({fmt(selectionBounds.area / 100)} cm²)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Diagonal Total:</span>
                    <span className="text-slate-200">{fmt(selectionBounds.diagonal)} mm</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Centro (Xc, Yc):</span>
                    <span className="text-slate-200">
                      ({fmt(selectionBounds.centerX)}, {fmt(selectionBounds.centerY)}) mm
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Objetos Selecionados:</span>
                    <span className="font-semibold text-sky-300">
                      {selectionBounds.count} {selectionBounds.count === 1 ? 'geometria' : 'geometrias'}
                    </span>
                  </div>
                </div>

                {/* Quick actions on the selected element / contour */}
                <div className="flex items-center gap-1.5 pt-0.5">
                  <button
                    onClick={() => handleSelectConnected()}
                    className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1.5 font-mono text-[10px] text-sky-200 flex items-center justify-center gap-1 transition-colors border border-slate-700 cursor-pointer"
                    title="Expandir seleção para o contorno fechado completo desta peça"
                  >
                    <Expand className="h-3 w-3 text-sky-400" />
                    Contorno Inteiro
                  </button>
                  <button
                    onClick={handleCreateBBoxDimensions}
                    className="flex-1 rounded-md bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/50 px-2 py-1.5 font-mono text-[10px] text-sky-300 flex items-center justify-center gap-1 transition-colors cursor-pointer"
                    title="Converter dimensões X e Y em cotas salvas na prancheta e exportação DXF"
                  >
                    <Ruler className="h-3 w-3" />
                    Fixar Cotas X/Y
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-800 p-3 text-center">
                <p className="font-mono text-xs text-slate-400">
                  Nenhum elemento selecionado.
                </p>
                <p className="mt-1 font-mono text-[10px] text-slate-500 leading-relaxed">
                  Clique em qualquer objeto, arraste uma janela ou dê <strong className="text-sky-300">duplo clique</strong> no contorno para exibir instantaneamente as dimensões totais <strong className="text-sky-300">X</strong> e <strong className="text-emerald-300">Y</strong>.
                </p>
              </div>
            )}
          </div>

          {/* Histórico Opcional de Medições e Cotas Nativas (Recolhido por padrão) */}
          <div className="border-t border-slate-800/80 pt-2.5">
            <button
              onClick={() => setShowMeasurementsHistory((prev) => !prev)}
              type="button"
              className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 font-mono text-[11px] text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
              title="Exibir ou recolher o histórico detalhado de medições e cotas do arquivo"
            >
              <span className="flex items-center gap-1.5">
                <Ruler className="h-3.5 w-3.5 text-slate-500" />
                <span>Histórico de Medições & Cotas</span>
                {(measurements.length > 0 || (viewModel && viewModel.dims.length > 0)) && (
                  <span className="rounded bg-slate-800 px-1.5 py-0.2 font-mono text-[9px] text-sky-400 font-semibold border border-slate-700">
                    {measurements.length + (viewModel?.dims.length ?? 0)}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-1 text-[10px] text-slate-500 font-sans">
                <span>{showMeasurementsHistory ? 'Recolher' : 'Expandir'}</span>
                {showMeasurementsHistory ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </span>
            </button>

            {/* Painel Expansível (Exibido apenas quando o usuário desejar) */}
            {showMeasurementsHistory && (
              <div className="mt-2 space-y-3.5 rounded-lg bg-slate-900/60 p-3 border border-slate-800/80">
                {/* Interactive Measurements (Tecla C) */}
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex items-center justify-between">
                    <h3 className="font-mono text-[11px] uppercase tracking-[0.15em] text-sky-400 font-bold flex items-center gap-1.5">
                      <Ruler className="h-3 w-3" /> MEDIÇÕES FEITAS [C] ({measurements.length})
                    </h3>
                    {measurements.length > 0 && (
                      <button
                        onClick={() => setMeasurements([])}
                        className="font-mono text-[10px] text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
                      >
                        Limpar
                      </button>
                    )}
                  </div>

                  <div className="mt-2 max-h-[160px] overflow-auto pr-1">
                    {measurements.length > 0 ? (
                      <div className="space-y-1.5">
                        {measurements.map((m, index) => (
                          <div
                            key={m.id}
                            className="group flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/90 px-2.5 py-1.5 text-xs font-mono hover:border-sky-500/50 hover:bg-slate-900 transition-all"
                          >
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <span className="text-slate-500 text-[10px]">#{index + 1}</span>
                                <span className="text-xs font-bold text-sky-300">
                                  {fmt(m.distance)} mm
                                </span>
                              </div>
                              <span className="text-[9px] text-slate-400">
                                ΔX: {fmt(m.dx)} mm · ΔY: {fmt(m.dy)} mm
                              </span>
                            </div>
                            <button
                              onClick={() => setMeasurements((prev) => prev.filter((item) => item.id !== m.id))}
                              className="rounded p-1 text-slate-500 opacity-70 group-hover:opacity-100 hover:text-rose-400 hover:bg-rose-950/40 transition-all cursor-pointer"
                              title="Remover medição"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-800 p-3 text-center">
                        <Crosshair className="h-4 w-4 text-slate-600 mx-auto mb-1" />
                        <p className="text-[11px] text-slate-400">
                          Pressione <span className="font-semibold text-sky-300">tecla 'C'</span> e clique em dois pontos para medir.
                        </p>
                      </div>
                    )}
                  </div>

                  {measurements.length > 0 && (
                    <label className="mt-2 flex items-center gap-2 text-[10px] text-slate-300 font-mono cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={includeMeasurementsInExport}
                        onChange={(e) => setIncludeMeasurementsInExport(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 text-emerald-400 focus:ring-emerald-400"
                      />
                      <span>Incluir cotas medidas na camada COTAS do DXF</span>
                    </label>
                  )}
                </div>

                {/* Native Dimensions table if available */}
                {viewModel && viewModel.dims.length > 0 && (
                  <div className="border-t border-slate-800/80 pt-2.5">
                    <h3 className="font-mono text-[10px] uppercase tracking-[0.15em] text-emerald-400 font-semibold">
                      Cotas Nativas do Arquivo ({viewModel.dims.length})
                    </h3>
                    <div className="mt-1.5 max-h-[110px] overflow-auto">
                      <table className="w-full font-mono text-[10px]">
                        <thead className="text-slate-500 border-b border-slate-800">
                          <tr className="text-left">
                            <th className="pb-1 font-normal">#</th>
                            <th className="pb-1 font-normal">tipo</th>
                            <th className="pb-1 text-right font-normal">medida</th>
                          </tr>
                        </thead>
                        <tbody>
                          {viewModel.dims.map((d) => (
                            <tr
                              key={d.id}
                              onMouseEnter={() => setHoveredDimId(d.id)}
                              onMouseLeave={() => setHoveredDimId(null)}
                              className="cursor-default border-t border-slate-800/60 hover:bg-slate-800/40 text-slate-300"
                            >
                              <td className="py-1 text-slate-500">{d.id}</td>
                              <td className="py-1">{d.type}</td>
                              <td className="py-1 text-right text-emerald-400 font-semibold">
                                {d.text || (d.value != null ? `${fmt(d.value)} mm` : '—')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* CNC Cleaning & Export Section */}
          {model && (
            <div className="space-y-3.5 border-t border-slate-800 pt-4 mt-auto">
              <div className="flex gap-2">
                <button
                  onClick={deleteSelected}
                  disabled={selectedIds.size === 0}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <Scissors className="h-3.5 w-3.5" />
                  Apagar selecionados ({selectedIds.size})
                </button>
                <button
                  onClick={restoreRemoved}
                  disabled={removedIds.size === 0}
                  className="flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-mono text-slate-300 transition-colors hover:border-slate-500 disabled:opacity-40"
                  title="Restaurar linhas apagadas"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Format & Specification Selector */}
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400 mb-1">
                  Padrão do Arquivo DXF
                </label>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-slate-900 border border-slate-700">
                  <button
                    type="button"
                    onClick={() => setDxfVersion('AutoCAD R12')}
                    className={`rounded px-2 py-1.5 text-xs font-medium font-mono transition-all text-center ${
                      dxfVersion === 'AutoCAD R12'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    AutoCAD R12 (AC1009)
                    <span className="block text-[9px] text-emerald-400/90 font-semibold">Oficial & 100% CNC</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDxfVersion('AutoCAD 2000')}
                    className={`rounded px-2 py-1.5 text-xs font-medium font-mono transition-all text-center ${
                      dxfVersion === 'AutoCAD 2000'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    AutoCAD R12 ASCII
                    <span className="block text-[9px] text-slate-400">Universal Puro</span>
                  </button>
                </div>
              </div>

              {/* Output filename input */}
              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
                  Nome do arquivo DXF de saída
                </span>
                <div className="mt-1 flex rounded-lg border border-slate-700 bg-slate-900 focus-within:border-emerald-400">
                  <input
                    value={outputName}
                    onChange={(e) => setOutputName(e.target.value)}
                    className="w-full bg-transparent px-3 py-2 font-mono text-xs text-white focus:outline-none"
                    placeholder="meu-corte-cnc"
                  />
                  <span className="flex items-center pr-3 font-mono text-xs text-slate-500 select-none">
                    .dxf
                  </span>
                </div>
              </label>

              {/* Validation & Standards Verification Card */}
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 p-2.5 text-[11px] font-mono text-slate-300 space-y-1">
                <div className="flex items-center gap-1.5 text-emerald-400 font-semibold text-[10px] uppercase tracking-wider">
                  <CheckCircle2 className="h-3.5 w-3.5" /> PADRÃO DXF R12 (AC1009) VÁLIDO
                </div>
                <ul className="text-[10px] text-slate-400 space-y-0.5 pl-4 list-disc">
                  <li><strong className="text-slate-300">HEADER:</strong> $ACADVER AC1009</li>
                  <li><strong className="text-slate-300">TABLES:</strong> Tabela LAYER com camada 0</li>
                  <li><strong className="text-slate-300">BLOCKS:</strong> Seção BLOCKS vazia declarada</li>
                  <li><strong className="text-slate-300">ENTITIES:</strong> LINE (10/20, 11/21), CIRCLE (10/20, 40), ARC (10/20, 40, 50, 51)</li>
                  <li><strong className="text-slate-300">EOF:</strong> 0\nEOF final obrigatório</li>
                  <li><strong className="text-slate-300">Anti-NaN:</strong> Coordenadas decimais .toFixed(4) sem NaN</li>
                  <li><strong className="text-slate-300">MIME Type:</strong> application/dxf</li>
                </ul>
              </div>

              {/* Download Clean DXF & Auto-Advance Queue */}
              <button
                onClick={handleDownloadDxf}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-400 px-4 py-2.5 text-xs font-bold text-slate-950 transition-all hover:bg-emerald-300 shadow-lg shadow-emerald-500/20 cursor-pointer"
              >
                <Download className="h-4 w-4" />
                {fileQueue.length > 0 ? (
                  queueIndex < fileQueue.length - 1 ? (
                    <span>Exportar DXF & Carregar Próximo ({queueIndex + 1}/{fileQueue.length}) →</span>
                  ) : (
                    <span>Exportar DXF & Concluir Fila ({fileQueue.length}/{fileQueue.length}) ✓</span>
                  )
                ) : (
                  <span>Exportar DXF ({dxfVersion}) {removedIds.size > 0 ? '— Limpo CNC' : ''}</span>
                )}
              </button>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
