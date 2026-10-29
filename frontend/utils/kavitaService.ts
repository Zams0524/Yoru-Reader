import type {
  ConnectionTestResult,
  KavitaBook,
  KavitaBookSource,
  KavitaConfig,
  KavitaLibrary,
  KavitaPage,
  KavitaSeries,
  KavitaVolume,
} from '../types/integrations';
import { describeServerError, normalizeServerUrl, serverDownload, serverRequest, ServerHttpError } from './serverHttp';

/**
 * Kavita client (https://www.kavitareader.com): browse the user's light novel libraries, download a
 * volume's EPUB into Yoru's own library (IndexedDB, through the usual import) and send reading
 * progress back. Auth: the user's API key is exchanged for a JWT (POST /api/Plugin/authenticate);
 * password login (POST /api/Account/login) returns the same API key, which Yoru keeps instead of
 * the password. Images use ?apiKey= because an <img> cannot send headers.
 */

const CONFIG_KEY = 'yoru_kavita_config';
const SOURCES_KEY = 'yoru_kavita_sources';
const PLUGIN_NAME = 'YoruReader';
/**
 * Sección que el shell pide por `navigateTo` para que `Library` abra su navegador de
 * Kavita: así «Explorar Kavita» reutiliza el que ya existe en lugar de montar otro.
 */
export const OPEN_KAVITA_BROWSER = 'open-kavita-browser';

export const KAVITA_DEFAULT_URL = 'http://localhost:5000';

// ── Config ──────────────────────────────────────────────────────────────

/**
 * Nunca devuelve `null`: sin nada guardado, la instalación ya apunta al servidor de
 * casa, así que no hay que escribir la URL. Lo que decide si está listo para usar es
 * `isKavitaConfigured()`, que exige además la clave.
 */
export function getKavitaConfig(): KavitaConfig {
  const fallback = { serverUrl: KAVITA_DEFAULT_URL, apiKey: '' } as KavitaConfig;
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return fallback;
    const config = JSON.parse(raw) as KavitaConfig;
    return config?.serverUrl ? config : { ...fallback, ...config, serverUrl: KAVITA_DEFAULT_URL };
  } catch {
    return fallback;
  }
}

export function saveKavitaConfig(config: KavitaConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...config, serverUrl: normalizeServerUrl(config.serverUrl) }));
  window.dispatchEvent(new Event('yoru-media-servers-changed'));
}

export function clearKavitaConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
  window.dispatchEvent(new Event('yoru-media-servers-changed'));
}

export function isKavitaConfigured(): boolean {
  const config = getKavitaConfig();
  return Boolean(config && config.apiKey);
}

// ── Auth ────────────────────────────────────────────────────────────────

interface KavitaUserDto {
  username?: string;
  token?: string;
  apiKey?: string;
}

async function authenticateWithApiKey(serverUrl: string, apiKey: string): Promise<KavitaUserDto> {
  const url = `${normalizeServerUrl(serverUrl)}/api/Plugin/authenticate?apiKey=${encodeURIComponent(apiKey.trim())}&pluginName=${PLUGIN_NAME}`;
  const { data } = await serverRequest<KavitaUserDto>(url, { method: 'POST' });
  if (!data?.token) throw new ServerHttpError(401, 'Kavita no devolvió un token.');
  return data;
}

/**
 * Logs in with username and password and returns a config that keeps the API key and token,
 * never the password.
 */
export async function loginKavita(serverUrl: string, username: string, password: string): Promise<KavitaConfig> {
  const base = normalizeServerUrl(serverUrl);
  const { data } = await serverRequest<KavitaUserDto>(`${base}/api/Account/login`, {
    method: 'POST',
    body: { username: username.trim(), password, apiKey: '' },
  });
  if (!data?.token) throw new ServerHttpError(401, 'Kavita no devolvió un token.');
  return {
    serverUrl: base,
    authMode: 'password',
    username: data.username || username.trim(),
    apiKey: data.apiKey || '',
    token: data.token,
  };
}

async function freshToken(config: KavitaConfig): Promise<string> {
  if (!config.apiKey) throw new ServerHttpError(401, 'Falta la clave API de Kavita.');
  const user = await authenticateWithApiKey(config.serverUrl, config.apiKey);
  saveKavitaConfig({ ...config, token: user.token });
  return user.token as string;
}

function requireConfig(): KavitaConfig {
  const config = getKavitaConfig();
  if (!config || !config.apiKey) throw new Error('Kavita no está configurado. Añade el servidor en Configuración › Servidores multimedia.');
  return config;
}

/** Authorized JSON request; on a 401 it gets a new JWT from the API key and tries once more. */
async function kavitaRequest<T>(path: string, options: { method?: 'GET' | 'POST'; body?: unknown } = {}) {
  const config = requireConfig();
  const url = `${config.serverUrl}${path}`;
  const token = config.token || await freshToken(config);
  try {
    return await serverRequest<T>(url, { ...options, headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    if (!(error instanceof ServerHttpError) || error.status !== 401) throw error;
    const retryToken = await freshToken(config);
    return serverRequest<T>(url, { ...options, headers: { Authorization: `Bearer ${retryToken}` } });
  }
}

export async function testKavitaConnection(config: KavitaConfig, es: boolean): Promise<ConnectionTestResult> {
  try {
    const user = await authenticateWithApiKey(config.serverUrl, config.apiKey);
    const base = normalizeServerUrl(config.serverUrl);
    const { data } = await serverRequest<KavitaLibrary[]>(`${base}/api/Library/libraries`, {
      headers: { Authorization: `Bearer ${user.token}` },
    });
    const count = Array.isArray(data) ? data.length : 0;
    return {
      ok: true,
      message: es
        ? `Conectado como ${user.username || 'usuario'} · ${count} ${count === 1 ? 'biblioteca' : 'bibliotecas'}`
        : `Connected as ${user.username || 'user'} · ${count} ${count === 1 ? 'library' : 'libraries'}`,
    };
  } catch (error) {
    return { ok: false, message: describeServerError(error, es) };
  }
}

// ── Browse ──────────────────────────────────────────────────────────────

export async function getKavitaLibraries(): Promise<KavitaLibrary[]> {
  let data: KavitaLibrary[];
  try {
    ({ data } = await kavitaRequest<KavitaLibrary[]>('/api/Library/libraries'));
  } catch (error) {
    // Kavita before 0.8 lists libraries at /api/Library.
    if (!(error instanceof ServerHttpError) || (error.status !== 404 && error.status !== 405)) throw error;
    ({ data } = await kavitaRequest<KavitaLibrary[]>('/api/Library'));
  }
  return (Array.isArray(data) ? data : []).map((library) => ({ id: library.id, name: library.name, type: library.type }));
}

function readPagination(headers: Record<string, string>, page: number, count: number): Omit<KavitaPage<unknown>, 'items'> {
  try {
    const info = JSON.parse(headers.pagination || '');
    return { page: info.currentPage ?? page, totalPages: info.totalPages ?? page, totalItems: info.totalItems ?? count };
  } catch {
    return { page, totalPages: page, totalItems: count };
  }
}

function toSeries(raw: any): KavitaSeries {
  return {
    id: raw.id ?? raw.seriesId,
    name: raw.name || raw.localizedName || raw.originalName || '',
    originalName: raw.originalName,
    localizedName: raw.localizedName,
    libraryId: raw.libraryId,
    pages: raw.pages,
    format: raw.format,
  };
}

/** One page (1-based) of a library's series, sorted by name. */
export async function getKavitaSeries(libraryId: number, page = 1, pageSize = 30): Promise<KavitaPage<KavitaSeries>> {
  const query = `PageNumber=${page}&PageSize=${pageSize}`;
  let response;
  try {
    // Kavita 0.8+: filter v2. Field 19 = Libraries, comparison 5 = Contains, combination 1 = And, sort 1 = SortName.
    response = await kavitaRequest<any[]>(`/api/Series/v2?${query}`, {
      method: 'POST',
      body: {
        id: 0,
        name: '',
        statements: [{ comparison: 5, field: 19, value: String(libraryId) }],
        combination: 1,
        sortOptions: { sortField: 1, isAscending: true },
        limitTo: 0,
      },
    });
  } catch (error) {
    if (!(error instanceof ServerHttpError) || (error.status !== 404 && error.status !== 405)) throw error;
    response = await kavitaRequest<any[]>(`/api/Series?libraryId=${libraryId}&${query}`, { method: 'POST', body: {} });
  }
  const items = (Array.isArray(response.data) ? response.data : []).map(toSeries);
  return { items, ...readPagination(response.headers, page, items.length) };
}

export async function searchKavitaSeries(query: string): Promise<KavitaSeries[]> {
  const q = query.trim();
  if (!q) return [];
  const { data } = await kavitaRequest<any>(`/api/Search/search?queryString=${encodeURIComponent(q)}`);
  return (Array.isArray(data?.series) ? data.series : []).map(toSeries);
}

export async function getKavitaVolumes(seriesId: number): Promise<KavitaVolume[]> {
  const { data } = await kavitaRequest<any[]>(`/api/Series/volumes?seriesId=${seriesId}`);
  return (Array.isArray(data) ? data : []).map((raw) => ({
    id: raw.id,
    seriesId: raw.seriesId ?? seriesId,
    name: raw.name || '',
    number: raw.minNumber ?? raw.number ?? 0,
    pages: raw.pages ?? 0,
    chapters: Array.isArray(raw.chapters) ? raw.chapters : [],
  }));
}

export function kavitaSeriesCoverUrl(seriesId: number): string {
  const config = getKavitaConfig();
  if (!config.apiKey) return '';
  return `${config.serverUrl}/api/Image/series-cover?seriesId=${seriesId}&apiKey=${encodeURIComponent(config.apiKey)}`;
}

export function kavitaVolumeCoverUrl(volumeId: number): string {
  const config = getKavitaConfig();
  if (!config.apiKey) return '';
  return `${config.serverUrl}/api/Image/volume-cover?volumeId=${volumeId}&apiKey=${encodeURIComponent(config.apiKey)}`;
}

/** Kavita's "loose leaf" volume (chapters outside any volume) has a placeholder number. */
const LOOSE_LEAF_VOLUME = -100000;

/** The volumes of a series as importable books, in reading order. */
export function kavitaVolumesToBooks(series: KavitaSeries, volumes: KavitaVolume[], es: boolean): KavitaBook[] {
  return [...volumes]
    .sort((a, b) => a.number - b.number)
    .map((volume) => {
      const isLoose = volume.number <= LOOSE_LEAF_VOLUME || volume.number === 0;
      const volumeLabel = volume.name && !/^\d+(\.\d+)?$/.test(volume.name)
        ? volume.name
        : isLoose ? (es ? 'Especiales' : 'Specials') : `${es ? 'Volumen' : 'Volume'} ${volume.number}`;
      return {
        seriesId: series.id,
        seriesName: series.name,
        libraryId: series.libraryId,
        volumeId: volume.id,
        chapterId: volume.chapters[0]?.id ?? 0,
        title: volumeLabel,
        pages: volume.pages || volume.chapters.reduce((sum, chapter) => sum + (chapter.pages || 0), 0),
        coverUrl: kavitaVolumeCoverUrl(volume.id),
      };
    });
}

// ── Download & import ───────────────────────────────────────────────────

/** Splits what /api/Download/volume returns into book files: one EPUB/PDF, or a ZIP of several. */
export async function extractKavitaDownload(data: ArrayBuffer): Promise<{ name: string; kind: 'epub' | 'pdf'; data: ArrayBuffer }[]> {
  const head = new Uint8Array(data.slice(0, 5));
  const isPdf = String.fromCharCode(...head) === '%PDF-';
  if (isPdf) return [{ name: 'volume.pdf', kind: 'pdf', data }];
  if (head[0] !== 0x50 || head[1] !== 0x4b) throw new Error('Kavita no devolvió un EPUB ni un PDF.');

  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(data);
  if (zip.file('mimetype') || zip.file('META-INF/container.xml')) return [{ name: 'volume.epub', kind: 'epub', data }];

  // Several files in the volume: Kavita zips them.
  const files: { name: string; kind: 'epub' | 'pdf'; data: ArrayBuffer }[] = [];
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && /\.(epub|pdf)$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const entry of entries) {
    files.push({ name: entry.name, kind: /\.pdf$/i.test(entry.name) ? 'pdf' : 'epub', data: await entry.async('arraybuffer') });
  }
  if (files.length === 0) throw new Error('El volumen de Kavita no contiene EPUB ni PDF.');
  return files;
}

function arrayBufferToBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Kavita's cover as a data URL, so the library shows it offline. undefined if it fails. */
async function downloadCoverDataUrl(coverUrl: string): Promise<string | undefined> {
  if (!coverUrl) return undefined;
  try {
    const { data, headers } = await serverDownload(coverUrl);
    if (data.byteLength === 0) return undefined;
    const type = (headers['content-type'] || 'image/png').split(';')[0];
    return `data:${type};base64,${arrayBufferToBase64(data)}`;
  } catch {
    return undefined;
  }
}

export async function downloadKavitaVolume(volumeId: number): Promise<ArrayBuffer> {
  const config = requireConfig();
  const url = `${config.serverUrl}/api/Download/volume?volumeId=${volumeId}`;
  const token = config.token || await freshToken(config);
  try {
    return (await serverDownload(url, { Authorization: `Bearer ${token}` })).data;
  } catch (error) {
    if (!(error instanceof ServerHttpError) || error.status !== 401) throw error;
    return (await serverDownload(url, { Authorization: `Bearer ${await freshToken(config)}` })).data;
  }
}

/**
 * Downloads a volume and parses it with Yoru's own importer, so it is stored and read exactly like
 * a local file (vertical text, dictionary, mining all work offline afterwards). Remembers where
 * each book came from, so progress can go back to Kavita.
 */
export async function importKavitaBook(book: KavitaBook): Promise<any[]> {
  const { parseEPUB, parsePDF } = await import('./fileImport');
  const files = await extractKavitaDownload(await downloadKavitaVolume(book.volumeId));
  const parsedBooks: any[] = [];
  for (const file of files) {
    const fallbackTitle = files.length === 1 ? `${book.seriesName} ${book.title}` : file.name.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
    const parsed = file.kind === 'pdf' ? await parsePDF(file.data, fallbackTitle) : await parseEPUB(file.data);
    if (!parsed.title) parsed.title = fallbackTitle;
    if (!parsed.cover) parsed.cover = await downloadCoverDataUrl(book.coverUrl);
    parsedBooks.push({ ...parsed, series: book.seriesName, tags: ['Kavita'] });
  }
  const config = requireConfig();
  for (const parsed of parsedBooks) {
    setKavitaSource(parsed.title, {
      serverUrl: config.serverUrl,
      seriesId: book.seriesId,
      volumeId: book.volumeId,
      chapterId: book.chapterId,
      libraryId: book.libraryId,
      pages: book.pages,
    });
  }
  return parsedBooks;
}

// ── Progress back to Kavita ─────────────────────────────────────────────

/** Imported books by title (titles are unique in Yoru's library: db.addBooks dedupes on them). */
function getKavitaSources(): Record<string, KavitaBookSource> {
  try {
    return JSON.parse(localStorage.getItem(SOURCES_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function setKavitaSource(title: string, source: KavitaBookSource): void {
  const sources = getKavitaSources();
  sources[title] = source;
  localStorage.setItem(SOURCES_KEY, JSON.stringify(sources));
}

export function getKavitaSource(title: string): KavitaBookSource | null {
  return getKavitaSources()[title] || null;
}

/** Kavita volumes already in the library (by the titles of the library's books). */
export function importedKavitaVolumeIds(libraryTitles: Set<string>): Set<number> {
  const ids = new Set<number>();
  for (const [title, source] of Object.entries(getKavitaSources())) {
    if (libraryTitles.has(title)) ids.add(source.volumeId);
  }
  return ids;
}

const PROGRESS_DEBOUNCE_MS = 10_000;
const pendingProgress = new Map<string, { timer: ReturnType<typeof setTimeout>; percent: number }>();
const lastSentPage = new Map<string, number>();

export function kavitaPageForPercent(pages: number, percent: number): number {
  const clamped = Math.min(100, Math.max(0, percent));
  return Math.min(pages, Math.max(0, Math.round((pages * clamped) / 100)));
}

async function sendKavitaProgress(title: string, percent: number): Promise<void> {
  const source = getKavitaSource(title);
  const config = getKavitaConfig();
  // Only to the server the book came from.
  if (!source || !config.apiKey || normalizeServerUrl(config.serverUrl) !== normalizeServerUrl(source.serverUrl)) return;
  const pageNum = kavitaPageForPercent(source.pages, percent);
  if (lastSentPage.get(title) === pageNum) return;
  await kavitaRequest('/api/Reader/progress', {
    method: 'POST',
    body: {
      volumeId: source.volumeId,
      chapterId: source.chapterId,
      pageNum,
      seriesId: source.seriesId,
      libraryId: source.libraryId,
    },
  });
  lastSentPage.set(title, pageNum);
}

/**
 * Called on every progress save; sends the latest position after the reader has been still for a
 * few seconds. Silent on failure (the server may simply be off, e.g. away from home).
 */
export function queueKavitaProgress(title: string, percent: number): void {
  if (!title || !getKavitaSource(title) || !isKavitaConfigured()) return;
  const pending = pendingProgress.get(title);
  if (pending) clearTimeout(pending.timer);
  const timer = setTimeout(() => {
    pendingProgress.delete(title);
    sendKavitaProgress(title, percent).catch((error) => console.warn('[Kavita] Progress sync failed:', error));
  }, PROGRESS_DEBOUNCE_MS);
  pendingProgress.set(title, { timer, percent });
}
