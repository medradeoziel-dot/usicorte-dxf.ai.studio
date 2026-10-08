/**
 * Full-Stack CAD Server (Express + Vite)
 * Handles DWG to DXF Conversion API using:
 * 1. ODA File Converter CLI (Open Design Alliance) if installed
 * 2. LibreDWG CLI (dwg2dxf) if installed
 * 3. Built-in WebAssembly converter (dwgdxf / acadrust) as universal zero-dep engine
 */
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { convertDwgToDxf } from 'dwgdxf';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

const app = express();
const port = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Multer memory storage for direct buffer conversion (up to 50MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

/**
 * Checks if a CLI binary is available on the machine
 */
async function findExecutable(name: string): Promise<string | null> {
  const possiblePaths = [
    name,
    `/usr/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/opt/oda/${name}`,
    `/opt/libredwg/bin/${name}`,
  ];
  for (const p of possiblePaths) {
    try {
      const { stdout } = await execFileAsync('which', [p]);
      if (stdout.trim()) return stdout.trim();
    } catch {}
  }
  return null;
}

/**
 * Multi-tiered DWG to DXF conversion engine:
 * Priority 1: ODA File Converter (Open Design Alliance)
 * Priority 2: LibreDWG CLI (dwg2dxf)
 * Priority 3: WebAssembly DWG Engine (acadrust/dwgdxf)
 */
async function convertDwgToDxfBuffer(
  buffer: Buffer,
  originalFilename: string
): Promise<{ dxfText: string; engine: string }> {
  const base = path.basename(originalFilename, path.extname(originalFilename));

  // 1. Try ODA File Converter if installed on the host
  const odaBinary = process.env.ODA_CONVERTER_PATH || (await findExecutable('ODAFileConverter'));
  if (odaBinary) {
    try {
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oda-'));
      const inDir = path.join(tempDir, 'in');
      const outDir = path.join(tempDir, 'out');
      await fs.promises.mkdir(inDir, { recursive: true });
      await fs.promises.mkdir(outDir, { recursive: true });

      const inFilePath = path.join(inDir, `${base}.dwg`);
      await fs.promises.writeFile(inFilePath, buffer);

      // ODAFileConverter <inDir> <outDir> <version> <type> <recurse> <audit> [filter]
      await execFileAsync(odaBinary, [inDir, outDir, 'ACAD2018', 'DXF', '0', '1', '*.dwg'], {
        timeout: 30000,
      });

      const outFilePath = path.join(outDir, `${base}.dxf`);
      if (fs.existsSync(outFilePath)) {
        const dxfText = await fs.promises.readFile(outFilePath, 'utf-8');
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        return { dxfText, engine: 'ODA File Converter (Open Design Alliance)' };
      }
    } catch (err) {
      console.warn('[Converter] ODA File Converter indisponível ou falhou, tentando próximo motor:', err);
    }
  }

  // 2. Try LibreDWG CLI (dwg2dxf) if available
  const dwg2dxfBinary = process.env.DWG2DXF_PATH || (await findExecutable('dwg2dxf'));
  if (dwg2dxfBinary) {
    try {
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dwg2dxf-'));
      const inFilePath = path.join(tempDir, `${base}.dwg`);
      const outFilePath = path.join(tempDir, `${base}.dxf`);
      await fs.promises.writeFile(inFilePath, buffer);

      await execFileAsync(dwg2dxfBinary, ['-y', '-o', outFilePath, inFilePath], { timeout: 30000 });

      if (fs.existsSync(outFilePath)) {
        const dxfText = await fs.promises.readFile(outFilePath, 'utf-8');
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        return { dxfText, engine: 'LibreDWG (dwg2dxf)' };
      }
    } catch (err) {
      console.warn('[Converter] dwg2dxf indisponível ou falhou, tentando próximo motor:', err);
    }
  }

  // 3. WebAssembly engine (Rust acadrust / dwgdxf)
  try {
    const rawResult = await convertDwgToDxf(buffer);
    const dxfText = typeof rawResult === 'string' ? rawResult : Buffer.from(rawResult).toString('utf-8');
    if (dxfText && dxfText.length > 20) {
      return { dxfText, engine: 'WebAssembly (acadrust / LibreDWG compatible)' };
    }
  } catch (err: any) {
    console.error('[Converter] Falha no conversor WebAssembly:', err);
    throw new Error(`Falha ao converter DWG para DXF: ${err?.message || 'Arquivo binário corrompido ou formato não suportado'}`);
  }

  throw new Error('Não foi possível converter o arquivo DWG com as ferramentas disponíveis.');
}

// Endpoint: POST /api/convert-dwg
app.post('/api/convert-dwg', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Nenhum arquivo foi enviado. Envie um arquivo .dwg através do campo multipart "file".',
      });
    }

    const originalName = req.file.originalname || 'desenho.dwg';
    const base = path.basename(originalName, path.extname(originalName));
    const targetFilename = `${base}.dxf`;

    console.log(`[API /api/convert-dwg] Recebido arquivo DWG: "${originalName}" (${req.file.size} bytes)`);

    const { dxfText, engine } = await convertDwgToDxfBuffer(req.file.buffer, originalName);

    console.log(`[API /api/convert-dwg] Sucesso! Convertido via ${engine} (${dxfText.length} bytes gerados)`);

    // Direct raw download if query param ?download=1
    if (req.query.download === '1' || req.query.download === 'true') {
      res.setHeader('Content-Type', 'application/dxf');
      res.setHeader('Content-Disposition', `attachment; filename="${targetFilename}"`);
      return res.send(dxfText);
    }

    // Return JSON with the converted DXF string
    return res.json({
      success: true,
      filename: targetFilename,
      originalFilename: originalName,
      engine,
      dxf: dxfText,
      sizeBytes: Buffer.byteLength(dxfText, 'utf-8'),
    });
  } catch (error: any) {
    console.error('[API /api/convert-dwg] Erro na conversão:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao processar e converter o arquivo DWG.',
    });
  }
});

// Endpoint: GET /api/health
app.get('/api/health', async (_req, res) => {
  const odaBinary = process.env.ODA_CONVERTER_PATH || (await findExecutable('ODAFileConverter'));
  const dwg2dxfBinary = process.env.DWG2DXF_PATH || (await findExecutable('dwg2dxf'));
  res.json({
    status: 'ok',
    engines: {
      odaFileConverter: !!odaBinary,
      libredwg: !!dwg2dxfBinary,
      webassembly: true,
    },
  });
});

// Fallback for unhandled /api/* routes - guarantees JSON response, never HTML index fallback
app.all('/api/*', (_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Rota da API não encontrada (HTTP 404). O endpoint solicitado não está ativo.',
  });
});

async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0', port: 3000 },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`[CAD Server] Servidor iniciado em http://0.0.0.0:${port}`);
    console.log(`[CAD Server] Endpoint de conversão DWG: POST /api/convert-dwg`);
  });
}

startServer().catch((err) => {
  console.error('[CAD Server] Erro ao iniciar:', err);
  process.exit(1);
});
