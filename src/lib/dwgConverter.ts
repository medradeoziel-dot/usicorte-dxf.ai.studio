/**
 * Client-side helper for converting .dwg files to .dxf via the backend API
 * Includes robust response validation, Content-Type inspection, and HTML error prevention.
 */

export interface ConvertDwgResponse {
  success: boolean;
  filename: string;
  originalFilename: string;
  engine: string;
  dxf: string;
  sizeBytes: number;
  error?: string;
}

export function isDwgFile(fileOrName: File | string): boolean {
  const name = typeof fileOrName === 'string' ? fileOrName : fileOrName.name;
  return name.toLowerCase().endsWith('.dwg');
}

/**
 * Sends a .dwg file to the backend Express conversion endpoint POST /api/convert-dwg
 * with robust error handling for HTML/404/500 responses and client fallback protection.
 */
export async function convertDwgToDxf(file: File): Promise<ConvertDwgResponse> {
  const formData = new FormData();
  formData.append('file', file);

  let response: Response | null = null;
  let backendError: Error | null = null;

  try {
    response = await fetch('/api/convert-dwg', {
      method: 'POST',
      body: formData,
    });
  } catch (networkErr: any) {
    backendError = new Error(
      `Não foi possível conectar ao serviço de conversão backend (${networkErr?.message || 'Falha de rede'}). ` +
      'Verifique se o servidor está ativo ou utilize ficheiros .DXF diretamente.'
    );
  }

  // If the backend responded
  if (response) {
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const isJson = contentType.includes('application/json');

    // Case 1: The server responded with HTML (e.g. 404 Not Found, 500 error, or SPA index.html fallback)
    if (!isJson) {
      let htmlSnippet = '';
      try {
        const text = await response.text();
        const trimmed = text.trim();
        if (trimmed.startsWith('<') || trimmed.includes('<!DOCTYPE') || trimmed.includes('<html')) {
          htmlSnippet = `(resposta em formato HTML recebida com status HTTP ${response.status})`;
        } else if (trimmed.length > 0 && trimmed.length < 150) {
          htmlSnippet = `(${trimmed})`;
        }
      } catch {
        // Ignore read error
      }

      if (response.status === 404) {
        backendError = new Error(
          `A rota de conversão DWG não está ativa no servidor (HTTP 404) ${htmlSnippet}. ` +
          'O ficheiro .DWG não pôde ser processado automaticamente. Por favor, converta o ficheiro para .DXF ou certifique-se de que o backend está ativo.'
        );
      } else if (response.status >= 500) {
        backendError = new Error(
          `O servidor de conversão encontrou um erro interno (HTTP ${response.status}) ${htmlSnippet}. ` +
          'O ficheiro .DWG pode estar corrompido ou numa versão proprietária não suportada.'
        );
      } else {
        backendError = new Error(
          `O servidor retornou uma resposta inesperada (HTTP ${response.status}) em formato HTML em vez de JSON ${htmlSnippet}. ` +
          'A rota de conversão DWG pode não estar ativa.'
        );
      }
    } else {
      // Case 2: The server responded with JSON
      let data: any = null;
      try {
        data = await response.json();
      } catch (jsonErr: any) {
        backendError = new Error(
          `Erro ao interpretar a resposta JSON do servidor (HTTP ${response.status}): ${jsonErr?.message || 'JSON inválido'}.`
        );
      }

      if (data) {
        if (!response.ok || !data.success) {
          const msg = data.error || `Erro HTTP ${response.status} retornado pelo serviço de conversão.`;
          backendError = new Error(msg);
        } else if (!data.dxf || typeof data.dxf !== 'string') {
          backendError = new Error('O servidor de conversão não retornou os dados da geometria DXF em formato texto.');
        } else {
          // Success from backend!
          return data as ConvertDwgResponse;
        }
      }
    }
  }

  // Graceful Client-side WebAssembly Fallback:
  // If the backend was unreachable, returned 404 HTML, or failed, attempt client-side wasm conversion
  try {
    const arrayBuffer = await file.arrayBuffer();
    const { convertDwgToDxf: clientConvert } = await import('dwgdxf');
    const rawResult = await clientConvert(new Uint8Array(arrayBuffer));
    const dxfText = typeof rawResult === 'string' ? rawResult : new TextDecoder('utf-8').decode(rawResult);

    if (dxfText && dxfText.length > 20) {
      const base = file.name.replace(/\.[^/.]+$/, '');
      return {
        success: true,
        filename: `${base}.dxf`,
        originalFilename: file.name,
        engine: 'WebAssembly Cliente (acadrust)',
        dxf: dxfText,
        sizeBytes: dxfText.length,
      };
    }
  } catch (clientErr: any) {
    // Client-side fallback also failed or not supported in current environment
    console.warn('[dwgConverter] Tentativa de conversão no cliente também falhou:', clientErr);
  }

  // If both backend and client fallback failed, throw the clear, descriptive backend error
  throw (
    backendError ||
    new Error(
      `O ficheiro DWG "${file.name}" não pôde ser processado. Verifique se o formato é válido ou converta previamente para .DXF.`
    )
  );
}

/**
 * Trigger immediate download of converted DXF file in browser
 */
export function downloadDxfString(dxfContent: string, filename: string) {
  const blob = new Blob([dxfContent], { type: 'application/dxf;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.dxf') ? filename : `${filename}.dxf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
