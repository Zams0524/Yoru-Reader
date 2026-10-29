import type {
  AudiobookItem,
  AudiobookshelfConfig,
  AudiobookshelfLibrary,
  AudiobookshelfPlaybackSession,
  AudioTrack,
  Chapter,
  ConnectionTestResult,
} from '../types/integrations';
import { describeServerError, normalizeServerUrl, serverRequest, ServerHttpError } from './serverHttp';

/**
 * Audiobookshelf client (https://www.audiobookshelf.org): find the audiobook of the novel being
 * read, stream it while reading and keep the listening position in sync with the server, so the
 * user can carry on from any device. Auth is a Bearer token (an API token, or the one POST /login
 * returns; the password is never stored). Audio and covers take ?token= because an <audio> or
 * <img> cannot send headers.
 */

const CONFIG_KEY = 'yoru_abs_config';
const LINKS_KEY = 'yoru_abs_links';
const DEVICE_KEY = 'yoru_abs_device_id';
export const AUDIOBOOKSHELF_DEFAULT_URL = 'http://localhost:13378';

// ── Config ──────────────────────────────────────────────────────────────

/**
 * Como en Kavita: sin nada guardado ya apunta al servidor de casa. Lo que decide si
 * está listo es `isAudiobookshelfConfigured()`, que exige el token.
 */
export function getAudiobookshelfConfig(): AudiobookshelfConfig {
  const fallback = { serverUrl: AUDIOBOOKSHELF_DEFAULT_URL, token: '' } as AudiobookshelfConfig;
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return fallback;
    const config = JSON.parse(raw) as AudiobookshelfConfig;
    return config?.serverUrl ? config : { ...fallback, ...config, serverUrl: AUDIOBOOKSHELF_DEFAULT_URL };
  } catch {
    return fallback;
  }
}

export function saveAudiobookshelfConfig(config: AudiobookshelfConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...config, serverUrl: normalizeServerUrl(config.serverUrl), token: config.token.trim() }));
  window.dispatchEvent(new Event('yoru-media-servers-changed'));
}

export function clearAudiobookshelfConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
  window.dispatchEvent(new Event('yoru-media-servers-changed'));
}

export function isAudiobookshelfConfigured(): boolean {
  const config = getAudiobookshelfConfig();
  return Boolean(config && config.token);
}

function requireConfig(): AudiobookshelfConfig {
  const config = getAudiobookshelfConfig();
  if (!config || !config.token) throw new Error('Audiobookshelf no está configurado. Añade el servidor en Configuración › Servidores multimedia.');
  return config;
}

function absRequest<T>(path: string, options: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown; config?: AudiobookshelfConfig } = {}) {
  const config = options.config || requireConfig();
  return serverRequest<T>(`${normalizeServerUrl(config.serverUrl)}${path}`, {
    method: options.method,
    body: options.body,
    headers: { Authorization: `Bearer ${config.token.trim()}` },
  });
}

/** Adds the token to a server path so media elements can load it. */
export function absMediaUrl(path: string, config: AudiobookshelfConfig | null = getAudiobookshelfConfig()): string {
  if (!config || !path) return '';
  const absolute = /^https?:\/\//i.test(path) ? path : `${normalizeServerUrl(config.serverUrl)}${path.startsWith('/') ? '' : '/'}${path}`;
  return `${absolute}${absolute.includes('?') ? '&' : '?'}token=${encodeURIComponent(config.token.trim())}`;
}

export function absCoverUrl(itemId: string): string {
  return absMediaUrl(`/api/items/${encodeURIComponent(itemId)}/cover`);
}

// ── Auth ────────────────────────────────────────────────────────────────

export async function loginAudiobookshelf(serverUrl: string, username: string, password: string): Promise<AudiobookshelfConfig> {
  const base = normalizeServerUrl(serverUrl);
  const { data } = await serverRequest<any>(`${base}/login`, { method: 'POST', body: { username: username.trim(), password } });
  const token = data?.user?.token || data?.user?.accessToken;
  if (!token) throw new ServerHttpError(401, 'Audiobookshelf no devolvió un token.');
  return { serverUrl: base, token, username: data.user.username || username.trim() };
}

export async function testAudiobookshelfConnection(config: AudiobookshelfConfig, es: boolean): Promise<ConnectionTestResult> {
  try {
    const { data: me } = await absRequest<any>('/api/me', { config });
    const { data } = await absRequest<any>('/api/libraries', { config });
    const books = (Array.isArray(data?.libraries) ? data.libraries : []).filter((library: any) => library.mediaType === 'book');
    return {
      ok: true,
      message: es
        ? `Conectado como ${me?.username || 'usuario'} · ${books.length} ${books.length === 1 ? 'biblioteca de audiolibros' : 'bibliotecas de audiolibros'}`
        : `Connected as ${me?.username || 'user'} · ${books.length} audiobook ${books.length === 1 ? 'library' : 'libraries'}`,
    };
  } catch (error) {
    return { ok: false, message: describeServerError(error, es) };
  }
}

// ── Browse ──────────────────────────────────────────────────────────────

export async function getAudiobookLibraries(): Promise<AudiobookshelfLibrary[]> {
  const { data } = await absRequest<any>('/api/libraries');
  return (Array.isArray(data?.libraries) ? data.libraries : [])
    .filter((library: any) => library.mediaType === 'book')
    .map((library: any) => ({ id: library.id, name: library.name, mediaType: library.mediaType }));
}

function toChapters(raw: any): Chapter[] {
  return (Array.isArray(raw) ? raw : []).map((chapter: any, index: number) => ({
    id: chapter.id ?? index,
    title: chapter.title || `${index + 1}`,
    start: Number(chapter.start) || 0,
    end: Number(chapter.end) || 0,
  }));
}

export function toAudiobookItem(raw: any): AudiobookItem {
  const metadata = raw?.media?.metadata || {};
  const authors = Array.isArray(metadata.authors) ? metadata.authors.map((author: any) => author.name).join(', ') : '';
  const series = Array.isArray(metadata.series) ? metadata.series.map((s: any) => s.name).join(', ') : '';
  return {
    id: raw.id,
    libraryId: raw.libraryId,
    title: metadata.title || raw.media?.metadata?.titleIgnorePrefix || '',
    author: metadata.authorName || authors,
    series: metadata.seriesName || series || undefined,
    duration: Number(raw.media?.duration) || 0,
    coverUrl: absCoverUrl(raw.id),
    chapters: raw.media?.chapters ? toChapters(raw.media.chapters) : undefined,
  };
}

/**
 * Las estanterias que el propio servidor prepara para el usuario («para ti»).
 * Devuelve los items de la primera estanteria que traiga libros.
 */
export async function getAudiobookPersonalized(libraryId: string, limit = 12): Promise<AudiobookItem[]> {
  const shelves = await absRequest<any[]>('/api/libraries/' + libraryId + '/personalized?limit=' + limit);
  const list = Array.isArray(shelves.data) ? shelves.data : [];
  for (const shelf of list) {
    const entities = Array.isArray(shelf?.entities) ? shelf.entities : [];
    const books = entities.filter((entity: any) => entity?.media);
    if (books.length) return books.slice(0, limit).map(toAudiobookItem);
  }
  return [];
}

/** One page (0-based) of a library's audiobooks, sorted by title. */
export async function getAudiobooks(libraryId: string, page = 0, limit = 50): Promise<{ items: AudiobookItem[]; total: number }> {
  const { data } = await absRequest<any>(`/api/libraries/${encodeURIComponent(libraryId)}/items?limit=${limit}&page=${page}&sort=media.metadata.title&minified=1`);
  const results = Array.isArray(data?.results) ? data.results : [];
  return { items: results.map(toAudiobookItem), total: Number(data?.total) || results.length };
}

/** Searches every audiobook library. */
export async function searchAudiobooks(query: string, limit = 12): Promise<AudiobookItem[]> {
  const q = query.trim();
  if (!q) return [];
  const libraries = await getAudiobookLibraries();
  const results = await Promise.all(libraries.map(async (library) => {
    const { data } = await absRequest<any>(`/api/libraries/${encodeURIComponent(library.id)}/search?q=${encodeURIComponent(q)}&limit=${limit}`);
    return (Array.isArray(data?.book) ? data.book : []).map((entry: any) => toAudiobookItem(entry.libraryItem || entry));
  }));
  const seen = new Set<string>();
  return results.flat().filter((item) => item.id && !seen.has(item.id) && seen.add(item.id));
}

export async function getAudiobook(itemId: string): Promise<AudiobookItem> {
  const { data } = await absRequest<any>(`/api/items/${encodeURIComponent(itemId)}?expanded=1`);
  return toAudiobookItem(data);
}

// ── Playback & progress ─────────────────────────────────────────────────

function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `yoru-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/**
 * Opens a listening session. Direct play (no transcoding): Chromium plays m4b/mp3 itself. The
 * session's tracks are the audiobook's files in order, each with its offset in the whole book.
 */
export async function startAudiobookPlayback(itemId: string): Promise<AudiobookshelfPlaybackSession> {
  const config = requireConfig();
  const { data } = await absRequest<any>(`/api/items/${encodeURIComponent(itemId)}/play`, {
    method: 'POST',
    body: {
      deviceInfo: { clientName: 'Yoru Reader', deviceId: deviceId() },
      forceDirectPlay: true,
      forceTranscode: false,
      mediaPlayer: 'html5',
      supportedMimeTypes: ['audio/mpeg', 'audio/mp4', 'audio/x-m4b', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/webm', 'audio/wav'],
    },
  });
  const tracks: AudioTrack[] = (Array.isArray(data?.audioTracks) ? data.audioTracks : [])
    .map((track: any, index: number) => ({
      index: track.index ?? index,
      startOffset: Number(track.startOffset) || 0,
      duration: Number(track.duration) || 0,
      url: absMediaUrl(track.contentUrl, config),
      mimeType: track.mimeType,
    }))
    .sort((a: AudioTrack, b: AudioTrack) => a.startOffset - b.startOffset);
  if (tracks.length === 0) throw new Error('Audiobookshelf no devolvió pistas de audio para este libro.');
  return {
    id: data.id,
    itemId,
    title: data.displayTitle || data.mediaMetadata?.title || '',
    author: data.displayAuthor || data.mediaMetadata?.authorName || '',
    coverUrl: absCoverUrl(itemId),
    currentTime: Number(data.currentTime) || 0,
    duration: Number(data.duration) || tracks.reduce((sum, track) => sum + track.duration, 0),
    chapters: toChapters(data.chapters),
    tracks,
  };
}

export interface ListeningUpdate {
  currentTime: number;
  /** Seconds actually listened since the last update. */
  timeListened: number;
  duration: number;
}

export async function syncAudiobookSession(sessionId: string, update: ListeningUpdate): Promise<void> {
  await absRequest(`/api/session/${encodeURIComponent(sessionId)}/sync`, { method: 'POST', body: update });
}

export async function closeAudiobookSession(sessionId: string, update: ListeningUpdate): Promise<void> {
  await absRequest(`/api/session/${encodeURIComponent(sessionId)}/close`, { method: 'POST', body: update });
}

export async function updateAudiobookProgress(itemId: string, currentTime: number, duration: number): Promise<void> {
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  await absRequest(`/api/me/progress/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body: { currentTime, duration, progress, isFinished: progress >= 0.995 },
  });
}

/** The track that plays at a time in the whole book, and the time inside that track. */
export function locateTrack(tracks: AudioTrack[], time: number): { trackIndex: number; offset: number } {
  let trackIndex = 0;
  for (let i = 0; i < tracks.length; i++) {
    if (time >= tracks[i].startOffset) trackIndex = i;
  }
  return { trackIndex, offset: Math.max(0, time - (tracks[trackIndex]?.startOffset || 0)) };
}

export function chapterAt(chapters: Chapter[], time: number): number {
  for (let i = chapters.length - 1; i >= 0; i--) {
    if (time >= chapters[i].start) return i;
  }
  return -1;
}

// ── Linking Yoru books to audiobooks ────────────────────────────────────

export interface AudiobookLink {
  itemId: string;
  title: string;
}

function getLinks(): Record<string, AudiobookLink> {
  try {
    return JSON.parse(localStorage.getItem(LINKS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function getAudiobookLink(bookId: string): AudiobookLink | null {
  return getLinks()[bookId] || null;
}

export function setAudiobookLink(bookId: string, link: AudiobookLink | null): void {
  const links = getLinks();
  if (link) links[bookId] = link;
  else delete links[bookId];
  localStorage.setItem(LINKS_KEY, JSON.stringify(links));
}

/** Volume number written in a title: 第3巻, 3巻, Vol. 3, (3), 3 at the end… */
export function volumeNumberOf(title: string): number | null {
  const text = title.normalize('NFKC');
  const match = text.match(/第\s*(\d+)\s*[巻卷部]/) || text.match(/(\d+)\s*[巻卷]/)
    || text.match(/\b(?:vol(?:ume)?|v)\.?\s*(\d+)/i) || text.match(/[(（[［]\s*(\d+)\s*[)）\]］]/)
    || text.match(/(\d+)\s*[」』)）\]］]*\s*$/);
  return match ? Number(match[1]) : null;
}

/** Title reduced for comparison: NFKC, lower case, no bracketed notes, volume marks or punctuation. */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/【[^】]*】|〔[^〕]*〕|\[[^\]]*\]/g, ' ')
    .replace(/第\s*\d+\s*[巻卷部]|\d+\s*[巻卷]|\b(?:vol(?:ume)?|v)\.?\s*\d+/gi, ' ')
    .replace(/(?:オーディオブック|audiobook|audible|朗読)/gi, ' ')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .replace(/\d+$/, '');
}

function bigrams(text: string): Map<string, number> {
  const grams = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const gram = text.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) || 0) + 1);
  }
  return grams;
}

function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const left = bigrams(a);
  const right = bigrams(b);
  let shared = 0;
  for (const [gram, count] of left) shared += Math.min(count, right.get(gram) || 0);
  return (2 * shared) / (a.length - 1 + b.length - 1);
}

/** 0–1: how likely an audiobook is the audio of this book (title first, then volume and author). */
export function audiobookMatchScore(book: { title: string; author?: string }, item: AudiobookItem): number {
  const bookTitle = normalizeTitle(book.title);
  const itemTitle = normalizeTitle(item.title);
  let score = dice(bookTitle, itemTitle);
  if (bookTitle && itemTitle && (bookTitle.includes(itemTitle) || itemTitle.includes(bookTitle))) score = Math.max(score, 0.85);

  const bookVolume = volumeNumberOf(book.title);
  const itemVolume = volumeNumberOf(item.title);
  if (bookVolume !== null && itemVolume !== null) score += bookVolume === itemVolume ? 0.1 : -0.3;

  const author = normalizeTitle(book.author || '');
  if (author && normalizeTitle(item.author).includes(author)) score += 0.05;
  return Math.max(0, Math.min(1, score));
}

/** Text to search Audiobookshelf with: the title without volume marks or bracketed notes. */
export function audiobookSearchQuery(title: string): string {
  return title
    .normalize('NFKC')
    .replace(/【[^】]*】|〔[^〕]*〕|\[[^\]]*\]|[(（][^)）]*[)）]/g, ' ')
    .replace(/第\s*\d+\s*[巻卷部]|\d+\s*[巻卷]|\b(?:vol(?:ume)?|v)\.?\s*\d+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

export const AUDIOBOOK_AUTO_MATCH_SCORE = 0.8;

/** Audiobooks that may be this book, best first. */
export async function findAudiobookMatches(book: { title: string; author?: string }): Promise<{ item: AudiobookItem; score: number }[]> {
  const query = audiobookSearchQuery(book.title) || book.title;
  const items = await searchAudiobooks(query);
  return items
    .map((item) => ({ item, score: audiobookMatchScore(book, item) }))
    .sort((a, b) => b.score - a.score);
}
