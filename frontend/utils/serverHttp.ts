import { Capacitor, CapacitorHttp } from '@capacitor/core';

/**
 * HTTP for self-hosted servers on the user's LAN (Kavita, Audiobookshelf).
 * - Android: CapacitorHttp makes the request natively, so the servers need no CORS setup.
 *   Binary bodies come back as base64 (as in wordAudio.ts) and are decoded here.
 * - Electron: the window runs with webSecurity off, so a plain fetch reaches localhost.
 * CapacitorHttp ignores AbortSignal, so every request races a timer instead (as in jitenSync.ts).
 */

export interface ServerResponse<T> {
  status: number;
  /** Header names in lower case. */
  headers: Record<string, string>;
  data: T;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export class ServerHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

/** Trims spaces and trailing slashes and adds http:// when the user typed only host:port. */
export function normalizeServerUrl(url: string): string {
  let value = (url || '').trim().replace(/\/+$/, '');
  if (value && !/^https?:\/\//i.test(value)) value = `http://${value}`;
  return value;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, url: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ServerHttpError(0, `Sin respuesta de ${new URL(url).host} (tiempo agotado)`)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function lowerCaseHeaders(headers: Record<string, string> | Headers | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    (headers as Headers).forEach((value, key) => { result[key.toLowerCase()] = value; });
    return result;
  }
  for (const [key, value] of Object.entries(headers)) result[key.toLowerCase()] = String(value);
  return result;
}

function networkError(url: string, error: unknown): ServerHttpError {
  if (error instanceof ServerHttpError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new ServerHttpError(0, `No se pudo conectar con ${new URL(url).host}: ${detail}`);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function parseJsonBody(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** JSON request. Throws ServerHttpError for network errors and non-2xx answers. */
export async function serverRequest<T>(url: string, options: RequestOptions = {}): Promise<ServerResponse<T>> {
  const method = options.method || 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let response: ServerResponse<unknown>;
  try {
    if (Capacitor.isNativePlatform()) {
      const native = await withTimeout(CapacitorHttp.request({
        url, method, headers, data: options.body, responseType: 'json',
        connectTimeout: timeoutMs, readTimeout: timeoutMs,
      }), timeoutMs, url);
      response = { status: native.status, headers: lowerCaseHeaders(native.headers), data: parseJsonBody(native.data) };
    } else {
      const fetched = await withTimeout(fetch(url, {
        method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body),
      }), timeoutMs, url);
      const text = await fetched.text();
      response = { status: fetched.status, headers: lowerCaseHeaders(fetched.headers), data: parseJsonBody(text) };
    }
  } catch (error) {
    throw networkError(url, error);
  }

  if (response.status < 200 || response.status >= 300) {
    const body = response.data as any;
    const detail = typeof body === 'string' ? body : body?.message || body?.title || '';
    throw new ServerHttpError(response.status, `HTTP ${response.status}${detail ? `: ${String(detail).slice(0, 160)}` : ''}`);
  }
  return response as ServerResponse<T>;
}

/** Binary download (EPUB, ZIP). Returns the bytes and the server's headers. */
export async function serverDownload(url: string, headers: Record<string, string> = {}): Promise<ServerResponse<ArrayBuffer>> {
  try {
    if (Capacitor.isNativePlatform()) {
      const native = await withTimeout(CapacitorHttp.request({
        url, method: 'GET', headers, responseType: 'arraybuffer',
        connectTimeout: DEFAULT_TIMEOUT_MS, readTimeout: DOWNLOAD_TIMEOUT_MS,
      }), DOWNLOAD_TIMEOUT_MS, url);
      if (native.status < 200 || native.status >= 300) throw new ServerHttpError(native.status, `HTTP ${native.status}`);
      const data = typeof native.data === 'string' ? base64ToArrayBuffer(native.data) : new ArrayBuffer(0);
      return { status: native.status, headers: lowerCaseHeaders(native.headers), data };
    }
    const fetched = await withTimeout(fetch(url, { headers }), DOWNLOAD_TIMEOUT_MS, url);
    if (!fetched.ok) throw new ServerHttpError(fetched.status, `HTTP ${fetched.status}`);
    return { status: fetched.status, headers: lowerCaseHeaders(fetched.headers), data: await fetched.arrayBuffer() };
  } catch (error) {
    throw networkError(url, error);
  }
}

/** Short Spanish/English text for an error, for toasts and the "Test connection" result. */
export function describeServerError(error: unknown, es: boolean): string {
  if (error instanceof ServerHttpError) {
    if (error.status === 401 || error.status === 403) {
      return es ? 'Credenciales no válidas (el servidor respondió 401).' : 'Invalid credentials (the server answered 401).';
    }
    if (error.status === 0) return error.message;
    return es ? `El servidor respondió con un error (${error.message}).` : `The server answered with an error (${error.message}).`;
  }
  return error instanceof Error ? error.message : String(error);
}
