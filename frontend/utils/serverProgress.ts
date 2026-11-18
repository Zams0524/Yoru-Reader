/**
 * Progreso local frente al progreso del servidor.
 *
 * Kavita y Audiobookshelf guardan el progreso por cuenta, no por persona. Cuando
 * varias personas usan la misma cuenta (cada una con su propia app), el progreso de
 * una pisa el de la otra: abre un tomo y la app la lleva a la página donde lo dejó
 * otra persona, y «Continuar en el servidor» enseña lo que leyó otra.
 *
 * Por eso, salvo que el perfil diga lo contrario (`shareServerProgress`), el
 * progreso se queda en el dispositivo, apartado por perfil:
 *  - Kavita: no se sube nada al servidor y lo que se lee de él se toma de aquí.
 *  - Audiobookshelf: no se sincroniza la sesión ni el progreso; la posición de
 *    escucha se guarda aquí y se retoma desde aquí.
 *
 * Los libros importados ya guardaban su progreso en local (en el propio libro); lo
 * nuevo es lo que solo vivía en el servidor: los tomos leídos sin importar y los
 * audiolibros.
 */
import { db } from './db';

const KAVITA_KEY = 'yoru_kavita_local_progress';
const ABS_KEY = 'yoru_abs_local_progress';

/** Si el perfil activo comparte el progreso con la cuenta del servidor. Por defecto, no. */
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
  map[String(entry.chapterId)] = { ...entry, percent, at: new Date().toISOString() };
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
}

export function getLocalAudiobookProgress(itemId: string): LocalAudiobookProgress | null {
  if (!itemId) return null;
  return readMap<LocalAudiobookProgress>(ABS_KEY)[itemId] || null;
}

export function saveLocalAudiobookProgress(itemId: string, currentTime: number, duration: number): void {
  if (!itemId || !Number.isFinite(currentTime)) return;
  const map = readMap<LocalAudiobookProgress>(ABS_KEY);
  map[itemId] = { currentTime: Math.max(0, currentTime), duration: Number(duration) || 0, at: new Date().toISOString() };
  writeMap(ABS_KEY, map);
}
