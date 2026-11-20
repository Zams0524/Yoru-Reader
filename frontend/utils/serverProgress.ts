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
import { db, ABS_LOCAL_PROGRESS_KEY, KAVITA_LOCAL_PROGRESS_KEY, LOCAL_PROGRESS_EVENT } from './db';

const KAVITA_KEY = KAVITA_LOCAL_PROGRESS_KEY;
const ABS_KEY = ABS_LOCAL_PROGRESS_KEY;
export { LOCAL_PROGRESS_EVENT };

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

/** Todo lo guardado, también las marcas de lo que se olvidó (`borrado`). */
function readRaw<T>(base: string): Record<string, T> {
  try {
    const parsed = JSON.parse(localStorage.getItem(profileKey(base)) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Lo guardado que sigue en pie. Lo olvidado no se borra del mapa: se queda como una
 * marca con fecha, porque este mapa viaja a los demás aparatos con la sincronización
 * y, sin la marca, el otro aparato devolvería lo que aquí se quitó.
 */
function readMap<T>(base: string): Record<string, T> {
  const raw = readRaw<T>(base);
  const vivos: Record<string, T> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (entry && !(entry as any).borrado) vivos[key] = entry;
  }
  return vivos;
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
  const map = readRaw<LocalKavitaProgress>(KAVITA_KEY);
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

/**
 * Apunta que este perfil abrió un tomo, antes de que haya leído nada.
 *
 * El lector no avisa de progreso hasta que se pasa de página, y su porcentaje va en
 * enteros: en una novela, el primer 1 % son varias páginas. Hasta entonces el tomo no
 * estaba apuntado en ningún sitio y la Biblioteca no lo enseñaba, aunque ya se
 * estuviera leyendo. Abrirlo ya es empezarlo, así que se apunta al abrir.
 *
 * Nunca baja lo que ya hubiera: reabrir un tomo a medias solo refresca la fecha.
 */
export function markKavitaOpened(entry: Omit<LocalKavitaProgress, 'at' | 'percent'> & { percent?: number }): void {
  if (!entry.chapterId) return;
  const previous = getLocalKavitaProgress(entry.chapterId);
  saveLocalKavitaProgress({
    ...entry,
    pages: entry.pages || previous?.pages || 0,
    percent: Math.max(Number(entry.percent) || 0, previous?.percent || 0),
  });
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

/** Una serie de Kavita que este perfil ha leído, para la Biblioteca. */
export interface LocalKavitaSeries {
  seriesId: number;
  /** El último tomo abierto de la serie, que es el que enseña su portada. */
  volumeId: number;
  title: string;
  seriesName?: string;
  percent: number;
  at: string;
}

/**
 * Las series del servidor que este perfil ha leído, lo último primero.
 *
 * Es «mis libros» del servidor, no el servidor entero: una serie entra aquí en
 * cuanto se abre un tomo y se queda aunque se termine. A diferencia de
 * `localContinueEntries`, los terminados también cuentan: son tuyos igual.
 */
export function localKavitaSeriesRead(limit = 60): LocalKavitaSeries[] {
  const bySeries = new Map<number, LocalKavitaProgress>();
  for (const entry of Object.values(readMap<LocalKavitaProgress>(KAVITA_KEY))) {
    // Sin mirar el porcentaje: un tomo recién abierto va al 0 % y ya es de este perfil.
    if (!entry.seriesId) continue;
    const current = bySeries.get(entry.seriesId);
    if (!current || entry.at > current.at) bySeries.set(entry.seriesId, entry);
  }
  return [...bySeries.values()]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit)
    .map((entry) => ({
      seriesId: entry.seriesId,
      volumeId: entry.volumeId,
      title: entry.seriesName || entry.volumeTitle || 'Kavita',
      seriesName: entry.seriesName,
      percent: Math.round(Math.min(100, Math.max(0, entry.percent))),
      at: entry.at,
    }));
}

/**
 * Olvida lo leído de una serie de Kavita en este perfil.
 *
 * Es lo que hace el «Eliminar» de la Biblioteca: el tomo sigue en el servidor, lo que
 * se borra es la marca de que este perfil lo abrió, así que la serie se cae de
 * «Leyendo» y de «Continuar». Si se vuelve a abrir, vuelve a aparecer.
 */
export function forgetKavitaSeries(seriesId: number): void {
  const map = readRaw<LocalKavitaProgress & { borrado?: boolean }>(KAVITA_KEY);
  const ahora = new Date().toISOString();
  let cambiado = false;
  for (const [key, entry] of Object.entries(map)) {
    if (entry.seriesId !== seriesId || entry.borrado) continue;
    // Queda la marca con su fecha, para que el olvido llegue a los otros aparatos.
    map[key] = { ...entry, percent: 0, borrado: true, at: ahora };
    cambiado = true;
  }
  if (cambiado) writeMap(KAVITA_KEY, map);
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
  const map = readRaw<LocalAudiobookProgress>(ABS_KEY);
  const previous = map[itemId];
  map[itemId] = {
    currentTime: Math.max(0, currentTime),
    // Si el reproductor todavía no sabe cuánto dura, no borramos la duración que
    // ya teníamos: sin ella el porcentaje sale 0 y el audiolibro se cae de «Continuar».
    duration: Number(duration) > 0 ? Number(duration) : (previous?.duration || 0),
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
    // Un tomo apuntado es un tomo abierto (`markKavitaOpened`): al 0 % también está a medias.
    if (!(entry.percent < 99.5)) continue;
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
    // Empezado es «hay un minuto escuchado». Si no sabemos la duración el porcentaje
    // no se puede calcular, pero el audiolibro sigue estando a medias: entra igual.
    .filter(({ entry, percent }) => (entry.duration > 0 ? started(percent) : entry.currentTime > 0))
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
