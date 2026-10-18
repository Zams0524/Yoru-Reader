export interface AnkiConnectPayload<T = unknown> {
  result?: T;
  error?: string | null;
  [key: string]: unknown;
}

type ElectronAnkiBridge = {
  ankiRequest?: (host: string, body: Record<string, unknown>) => Promise<AnkiConnectPayload>;
};

function normalizeAnkiHost(host: string): string {
  const value = host.trim() || 'http://127.0.0.1:8765';
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error('La dirección de AnkiConnect no es válida. Usa http://127.0.0.1:8765.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('AnkiConnect debe usar una dirección HTTP o HTTPS.');
  }

  return parsed.toString().replace(/\/$/, '');
}

function parsePayload(value: unknown): AnkiConnectPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AnkiConnect devolvió una respuesta inválida. Comprueba que el servicio esté activo.');
  }

  const payload = value as AnkiConnectPayload;
  if (payload.error) {
    throw new Error(`AnkiConnect: ${payload.error}`);
  }

  return payload;
}

/** Sends a request through Electron's native HTTP bridge, avoiding Chromium CORS. */
export async function ankiConnectRequest<T = unknown>(
  host: string,
  body: Record<string, unknown>
): Promise<AnkiConnectPayload<T>> {
  const endpoint = normalizeAnkiHost(host);
  const electronAPI = (window as Window & { electronAPI?: ElectronAnkiBridge }).electronAPI;

  if (electronAPI?.ankiRequest) {
    try {
      return parsePayload(await electronAPI.ankiRequest(endpoint, body)) as AnkiConnectPayload<T>;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('AnkiConnect:')) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`No se pudo conectar con AnkiConnect en ${endpoint}. Abre Anki, comprueba que AnkiConnect esté instalado y revisa su puerto (8765). ${detail}`);
    }
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`AnkiConnect devolvió una respuesta no válida (HTTP ${response.status}).`);
    }
    if (!response.ok) throw new Error(`AnkiConnect respondió HTTP ${response.status}.`);
    return parsePayload(payload) as AnkiConnectPayload<T>;
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith('AnkiConnect') || error.message.startsWith('La dirección'))) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('AnkiConnect tardó demasiado. Comprueba que Anki esté abierto y que AnkiConnect escuche en el puerto 8765.');
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo conectar con AnkiConnect en ${endpoint}. Abre Anki y comprueba que AnkiConnect esté instalado y activo. ${detail}`);
  } finally {
    window.clearTimeout(timeout);
  }
}
