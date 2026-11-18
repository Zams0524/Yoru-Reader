/**
 * Progreso local frente al progreso del servidor.
 *
 * Kavita y Audiobookshelf guardan el progreso por cuenta, no por persona. Cuando
 * varias personas usan la misma cuenta, el progreso de una pisa el de la otra: abre
 * un tomo y la app la lleva a la página donde lo dejó otra persona, y «Continuar»
 * enseña lo que leyó otra.
 *
 * Reglas:
 *  - El progreso de lo leído y escuchado en el servidor se apunta **siempre** aquí,
 *    apartado por perfil. Es lo que pinta «Continuar» en Inicio.
 *  - Solo un perfil que comparte (`shareServerProgress`) lo sube a la cuenta y lee
 *    de ella, y eso hay que encenderlo a mano por perfil. Sin encenderlo, el progreso
 *    se queda en el dispositivo y el perfil no ve el de la cuenta.
 *
 * Los libros importados ya guardaban su progreso en local (en el propio libro); lo
 * nuevo es lo que solo vivía en el servidor: los tomos leídos sin importar y los
 * audiolibros.
 */
import { db } from './db';

const KAVITA_KEY = 'yoru_kavita_local_progress';
const ABS_KEY = 'yoru_abs_local_progress';
/** Avisa a Inicio de que «Continuar» puede haber cambiado. */
export const LOCAL_PROGRESS_EVENT = 'yoru-local-progress-updated';

/**
 * Si el perfil activo comparte el progreso con la cuenta del servidor.
 *
 * Nadie comparte sin decirlo: hace falta encender el ajuste en Ajustes → Perfil →
 * «Progreso del servidor», y se enciende por perfil. Antes se daba por hecho que el
 * primer perfil de la lista era el dueño de la cuenta, y eso fallaba justo donde más
 * molesta: al borrar los perfiles y crear uno nuevo, el nuevo pasaba a ser el primero
 * y heredaba el progreso de la cuenta sin haber leído nada.
 */
export function sharesServerProgress(): boolean {
  try {
    return db.getSettings()?.shareServerProgress === true;
  } catch {
    return false;
  }
}

function profileKey(base: string): string {
  let profileId: string | null = null;
  try { profileId = db.getActiveProfileId(); } catch { /* sin almacenamiento */ }
  return `${base}_${profileId || 'profile-default'}`;
}

function readMap<T>(base: string): Record<string, T> {
  try {
    const parsed = JSON.parse(localStorage.getItem(profileKey(base)) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap<T>(base: string, map: Record<string, T>): void {
  try {
    localStorage.setItem(profileKey(base), JSON.stringify(map));
    window.dispatchEvent(new Event(LOCAL_PROGRESS_EVENT));
  } catch {
    /* almacenamiento lleno: el libro importado conserva su progreso igual */
  }
}

// ── Kavita ──────────────────────────────────────────────────────────────

export interface LocalKavitaProgress {
  chapterId: number;
  volumeId: number;
  seriesId: number;
  /** Páginas del tomo según Kavita, para traducir el porcentaje a páginas leídas. */
  pages: number;
  percent: number;
  /** ISO, cuándo se leyó por última vez. */
  at: string;
  seriesName?: string;
  volumeTitle?: string;
}

/** Por capítulo de Kavita: es lo que identifica un tomo al abrirlo y al listarlo. */
export function getLocalKavitaProgress(chapterId: number): LocalKavitaProgress | null {
  if (!chapterId) return null;
  return readMap<LocalKavitaProgress>(KAVITA_KEY)[String(chapterId)] || null;
}

export function saveLocalKavitaProgress(entry: Omit<LocalKavitaProgress, 'at'>): void {
  if (!entry.chapterId) return;
  const map = readMap<LocalKavitaProgress>(KAVITA_KEY);
  const percent = Math.min(100, Math.max(0, Number(entry.percent) || 0));
  const previous = map[String(entry.chapterId)];
  map[String(entry.chapterId)] = {
    ...entry,
    seriesName: entry.seriesName || previous?.seriesName,
    volumeTitle: entry.volumeTitle || previous?.volumeTitle,
    percent,
    at: new Date().toISOString(),
  };
  writeMap(KAVITA_KEY, map);
}

/** Páginas leídas de un tomo, según el progreso local. */
export function localKavitaPagesRead(chapterId: number, pages: number): number {
  const entry = getLocalKavitaProgress(chapterId);
  if (!entry || !(pages > 0)) return 0;
  return Math.min(pages, Math.round((entry.percent / 100) * pages));
}

/** Páginas leídas de una serie entera, sumando sus tomos leídos en este perfil. */
export function localKavitaSeriesPagesRead(seriesId: number): number {
  if (!seriesId) return 0;
  return Object.values(readMap<LocalKavitaProgress>(KAVITA_KEY))
    .filter((entry) => entry.seriesId === seriesId)
    .reduce((sum, entry) => sum + Math.round((entry.percent / 100) * (entry.pages || 0)), 0);
}

/** Cuándo se leyó por última vez algo de la serie en este perfil. */
export function localKavitaSeriesLastRead(seriesId: number): string | undefined {
  let latest: string | undefined;
  for (const entry of Object.values(readMap<LocalKavitaProgress>(KAVITA_KEY))) {
    if (entry.seriesId === seriesId && (!latest || entry.at > latest)) latest = entry.at;
  }
  return latest;
}

// ── Audiobookshelf ──────────────────────────────────────────────────────

export interface LocalAudiobookProgress {
  currentTime: number;
  duration: number;
  at: string;
  title?: string;
  author?: string;
}

export function getLocalAudiobookProgress(itemId: string): LocalAudiobookProgress | null {
  if (!itemId) return null;
  return readMap<LocalAudiobookProgress>(ABS_KEY)[itemId] || null;
}

export function saveLocalAudiobookProgress(
  itemId: string,
  currentTime: number,
  duration: number,
  meta: { title?: string; author?: string } = {},
): void {
  if (!itemId || !Number.isFinite(currentTime)) return;
  const map = readMap<LocalAudiobookProgress>(ABS_KEY);
  const previous = map[itemId];
  map[itemId] = {
    currentTime: Math.max(0, currentTime),
    duration: Number(duration) || 0,
    at: new Date().toISOString(),
    title: meta.title || previous?.title,
    author: meta.author || previous?.author,
  };
  writeMap(ABS_KEY, map);
}

// ── «Continuar» ─────────────────────────────────────────────────────────

export type LocalContinueEntry =
  | { kind: 'kavita'; key: string; at: string; percent: number; seriesId: number; volumeId: number; title: string; seriesName?: string }
  | { kind: 'audiobook'; key: string; at: string; percent: number; itemId: string; title: string; author?: string };

/**
 * Lo empezado y sin terminar en el servidor por este perfil, lo último primero.
 * Un tomo por serie: el que se leyó más tarde.
 */
export function localContinueEntries(limit = 20): LocalContinueEntry[] {
  const started = (percent: number) => percent > 0 && percent < 99.5;

  const bySeries = new Map<number, LocalKavitaProgress>();
  for (const entry of Object.values(readMap<LocalKavitaProgress>(KAVITA_KEY))) {
    if (!started(entry.percent)) continue;
    const current = bySeries.get(entry.seriesId);
    if (!current || entry.at > current.at) bySeries.set(entry.seriesId, entry);
  }
  const kavita: LocalContinueEntry[] = [...bySeries.values()].map((entry) => ({
    kind: 'kavita',
    key: `kavita-${entry.chapterId}`,
    at: entry.at,
    percent: Math.round(entry.percent),
    seriesId: entry.seriesId,
    volumeId: entry.volumeId,
    title: entry.volumeTitle || entry.seriesName || 'Kavita',
    seriesName: entry.seriesName,
  }));

  const audio: LocalContinueEntry[] = Object.entries(readMap<LocalAudiobookProgress>(ABS_KEY))
    .map(([itemId, entry]) => ({ itemId, entry, percent: entry.duration > 0 ? (entry.currentTime / entry.duration) * 100 : 0 }))
    .filter(({ percent }) => started(percent))
    .map(({ itemId, entry, percent }) => ({
      kind: 'audiobook' as const,
      key: `abs-${itemId}`,
      at: entry.at,
      percent: Math.round(percent),
      itemId,
      title: entry.title || 'Audiolibro',
      author: entry.author,
    }));

  return [...kavita, ...audio].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}
