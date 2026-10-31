import type {
  ConnectionTestResult,
  KavitaBook,
  KavitaBookSource,
  KavitaConfig,
  KavitaLibrary,
  KavitaPage,
  KavitaSeries,
  KavitaSeriesMetadata,
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
    avgHoursToRead: raw.avgHoursToRead,
    wordCount: raw.wordCount,
    format: raw.format,
    pagesRead: raw.pagesRead,
    latestReadDate: raw.latestReadDate,
  };
}

/** Kavita manda las personas como objetos `{ id, name }`; aquí solo interesa el nombre. */
function personNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry: any) => (typeof entry === 'string' ? entry : entry?.name || ''))
    .map((name: string) => name.trim())
    .filter(Boolean);
}

/**
 * Los metadatos de la serie. Nunca lanza: la ficha se dibuja igual sin ellos, solo que
 * con menos filas, y un servidor viejo que no conozca el endpoint no debe dejarla en
 * blanco.
 */
export async function getKavitaSeriesMetadata(seriesId: number): Promise<KavitaSeriesMetadata> {
  const empty: KavitaSeriesMetadata = {
    genres: [], tags: [], writers: [], coverArtists: [], publishers: [], translators: [], webLinks: [],
  };
  try {
    const { data } = await kavitaRequest<any>(`/api/Series/metadata?seriesId=${seriesId}`);
    if (!data) return empty;
    const links = typeof data.webLinks === 'string'
      ? data.webLinks.split(',').map((link: string) => link.trim()).filter(Boolean)
      : personNames(data.webLinks);
    return {
      summary: typeof data.summary === 'string' ? data.summary.trim() : undefined,
      genres: personNames(data.genres),
      tags: personNames(data.tags),
      writers: personNames(data.writers),
      coverArtists: personNames(data.coverArtists),
      publishers: personNames(data.publishers),
      translators: personNames(data.translators),
      releaseYear: Number(data.releaseYear) > 0 ? Number(data.releaseYear) : undefined,
      language: typeof data.language === 'string' && data.language.trim() ? data.language.trim() : undefined,
      publicationStatus: Number.isFinite(Number(data.publicationStatus)) ? Number(data.publicationStatus) : undefined,
      webLinks: links,
    };
  } catch (error) {
    console.warn('[Kavita] Sin metadatos de la serie:', error);
    return empty;
  }
}

/**
 * La serie entera, con `pagesRead`, que el listado paginado no siempre trae.
 * Devuelve `null` si el servidor no contesta: la ficha ya tiene lo del listado.
 */
export async function getKavitaSeriesById(seriesId: number): Promise<KavitaSeries | null> {
  try {
    const { data } = await kavitaRequest<any>(`/api/Series/${seriesId}`);
    return data ? toSeries(data) : null;
  } catch {
    return null;
  }
}

/** Formato de Kavita (MangaFormat) en palabras. `undefined` si no lo sabemos. */
export function kavitaFormatLabel(format: number | undefined, es: boolean): string | undefined {
  switch (format) {
    case 1: return es ? 'Archivo comprimido' : 'Archive';
    case 2: return 'PDF';
    case 3: return 'EPUB';
    case 4: return es ? 'Imagen' : 'Image';
    default: return undefined;
  }
}

/**
 * Otras series del mismo autor.
 *
 * Kavita no tiene un «dame las series de esta persona» que exista en todas sus
 * versiones, así que se usa su buscador, que sí empareja por personas, y se descarta la
 * serie que ya se está mirando. Si no devuelve nada, la fila no se pinta: mejor ausente
 * que inventada.
 */
export async function getKavitaSeriesByAuthor(author: string, excludeSeriesId: number): Promise<KavitaSeries[]> {
  const name = author.trim();
  if (!name) return [];
  try {
    const found = await searchKavitaSeries(name);
    return found.filter((item) => item.id !== excludeSeriesId);
  } catch {
    return [];
  }
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

/**
 * Lo que el servidor tiene a medias: su propia lista de «seguir leyendo».
 * Dato real de Kavita, no una invencion nuestra.
 */
export async function getKavitaOnDeck(limit = 20): Promise<KavitaSeries[]> {
  const response = await kavitaRequest<any[]>('/api/Series/on-deck?PageNumber=1&PageSize=' + limit, {
    method: 'POST',
    body: {},
  });
  return (Array.isArray(response.data) ? response.data : []).map(toSeries);
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
    pagesRead: raw.pagesRead,
    lastReadingProgressUtc: raw.lastReadingProgressUtc,
    createdUtc: raw.createdUtc ?? raw.created,
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
/**
 * Cómo llamar a un volumen de capítulos sueltos, que es el caso raro.
 *
 * Una serie de un solo tomo llega así desde Kavita, y «Especiales» es engañoso: no son
 * extras, es el libro. Se prefiere el título del capítulo si lo trae, porque suele ser
 * el nombre de la obra.
 */
function looseVolumeLabel(volume: KavitaVolume, totalVolumes: number, es: boolean): string {
  const chapter = volume.chapters?.[0];
  const fromChapter = (chapter?.title || chapter?.range || '').trim();
  if (fromChapter && !/^-?\d+(?:\.\d+)?$/.test(fromChapter)) return fromChapter;
  if (totalVolumes <= 1) return es ? 'Volumen único' : 'Single volume';
  return es ? 'Especiales' : 'Specials';
}

export function kavitaVolumesToBooks(series: KavitaSeries, volumes: KavitaVolume[], es: boolean): KavitaBook[] {
  return [...volumes]
    .sort((a, b) => a.number - b.number)
    .map((volume) => {
      const isLoose = volume.number <= LOOSE_LEAF_VOLUME || volume.number === 0;
      // Kavita no manda aquí un título: manda el número del volumen como texto, y para
      // los capítulos sueltos manda `-100000`, su valor especial. El signo es justo lo
      // que se escapaba de la comprobación anterior (`/^\d+/`), así que `-100000`
      // pasaba por título y se pintaba tal cual en la ficha de la serie.
      const nameIsNumber = !volume.name || /^-?\d+(?:\.\d+)?$/.test(volume.name.trim());
      const volumeLabel = nameIsNumber
        ? (isLoose ? looseVolumeLabel(volume, volumes.length, es)
          : `${es ? 'Volumen' : 'Volume'} ${volume.number}`)
        : volume.name;
      // Los metadatos del fichero (ISBN, fecha de publicación) viven en el capítulo, no
      // en el volumen: se toma el primero que los traiga.
      const withIsbn = volume.chapters.find((chapter) => chapter.isbn);
      const withDate = volume.chapters.find((chapter) => chapter.releaseDate);
      const files = volume.chapters.flatMap((chapter) => (chapter.files || []).map((file) => ({
        name: (file.filePath || '').split(/[\\/]/).pop() || '',
        pages: file.pages,
        bytes: file.bytes,
        format: file.format,
      }))).filter((file) => file.name);
      const wordCount = volume.chapters.reduce((sum, chapter) => sum + (chapter.wordCount || 0), 0);
      return {
        seriesId: series.id,
        seriesName: series.name,
        libraryId: series.libraryId,
        volumeId: volume.id,
        chapterId: volume.chapters[0]?.id ?? 0,
        title: volumeLabel,
        pages: volume.pages || volume.chapters.reduce((sum, chapter) => sum + (chapter.pages || 0), 0),
        coverUrl: kavitaVolumeCoverUrl(volume.id),
        pagesRead: volume.pagesRead,
        lastReadAt: volume.lastReadingProgressUtc || volume.chapters.find((chapter) => chapter.lastReadingProgressUtc)?.lastReadingProgressUtc,
        isbn: withIsbn?.isbn,
        releaseDate: withDate?.releaseDate,
        wordCount: wordCount > 0 ? wordCount : undefined,
        files: files.length ? files : undefined,
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

/**
 * El título con el que cada volumen de Kavita quedó guardado en la biblioteca. Es lo
 * que permite ir del tomo del servidor al libro propio (y a su audiolibro vinculado)
 * sin adivinar el nombre: lo apuntó `importKavitaBook` al descargarlo.
 */
export function kavitaVolumeTitles(libraryTitles: Set<string>): Map<number, string> {
  const titles = new Map<number, string>();
  for (const [title, source] of Object.entries(getKavitaSources())) {
    if (libraryTitles.has(title)) titles.set(source.volumeId, title);
  }
  return titles;
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

/**
 * La vuelta: de la pagina que guarda Kavita al porcentaje nuestro, para poder retomar
 * un libro por donde lo dejo el servidor.
 *
 * Devuelve el PRINCIPIO de esa pagina, no su centro, por dos razones: es lo que se
 * espera al retomar (empezar esa pagina, no caer en mitad de ella) y hace que la ida
 * y vuelta conserve la pagina exacta. Con el centro, una pagina acabada en .5 se iba
 * a la siguiente al redondear.
 *
 * Con `pages` invalido devuelve 0 en vez de NaN o Infinity.
 */
export function kavitaPercentForPage(pages: number, pageNum: number): number {
  if (!Number.isFinite(pages) || pages <= 0) return 0;
  if (!Number.isFinite(pageNum) || pageNum <= 0) return 0;
  if (pageNum >= pages) return 100;
  const percent = (pageNum / pages) * 100;
  return Math.min(100, Math.max(0, Math.round(percent * 100) / 100));
}

/**
 * El progreso que Kavita tiene guardado de ese capitulo, ya traducido a porcentaje
 * nuestro. Devuelve 0 si no hay nada o si el servidor no contesta: retomar es una
 * comodidad, no algo por lo que merezca la pena fallar al abrir un libro.
 */
export async function getKavitaProgressPercent(chapterId: number, pages: number): Promise<number> {
  try {
    const response = await kavitaRequest<any>('/api/Reader/get-progress?chapterId=' + chapterId);
    const pageNum = Number(response.data?.pageNum);
    if (!Number.isFinite(pageNum) || pageNum <= 0) return 0;
    return kavitaPercentForPage(pages, pageNum);
  } catch {
    return 0;
  }
}

/** El capitulo que contiene ese porcentaje, segun las paginas de cada capitulo. */
export function kavitaChapterForPercent(chapterPages: number[], percent: number): number {
  const total = chapterPages.reduce((sum, value) => sum + (value > 0 ? value : 0), 0);
  if (total <= 0) return 0;
  const target = (Math.min(100, Math.max(0, percent)) / 100) * total;
  let seen = 0;
  for (let index = 0; index < chapterPages.length; index += 1) {
    seen += Math.max(0, chapterPages[index]);
    if (target < seen) return index;
  }
  return Math.max(0, chapterPages.length - 1);
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
