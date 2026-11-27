/**
 * Merge of two full database exports (db.exportFullDatabase): this device's and the copy in
 * Google Drive. Sync never replaces one side with the other: profiles, books, word statuses and
 * SRS cards from both sides are kept, and only when the same item exists on both does one copy
 * win (the more recently read book, the more recently reviewed card).
 */

import { diaDeMarca, perfilTrasBorrado, ultimaMarca } from './progresoBorrado';
import {
  combinarDiasSrs,
  combinarHistorialSrs,
  combinarPartes,
  combinarQuitados,
  diasSrsDespuesDe,
  historialDespuesDe,
  partesSinQuitados,
  type DiasSrsPorAparato,
  type ParteDiario,
} from './estadisticasSync';
import { claveTituloAutor, conPortadaOriginal } from './textosLibros';
import { combinarMarcasDeLibro, combinarMarcasTemporales, type MarcasTemporales } from './marcasSync';

type DbExport = {
  version?: number;
  exportDate?: string;
  activeProfileId?: string;
  profiles: { id: string; [key: string]: any }[];
  profileData: Record<string, ProfileData>;
};

type ProfileData = {
  books?: any[];
  settings?: any;
  wordStatuses?: Record<string, string> | null;
  wordStatusTimes?: Record<string, string> | null;
  srsData?: Record<string, any> | null;
  /** When each removed SRS card was removed, by key (db.getSrsRemovals). */
  srsRemovals?: Record<string, string> | null;
  /**
   * What this profile has read and listened to straight from Kavita and Audiobookshelf
   * (utils/serverProgress.ts). Each entry carries `at`, the ISO time it was last touched.
   */
  serverProgress?: ServerProgress | null;
  /**
   * When this profile last erased its reading progress (utils/progresoBorrado.ts). Whatever
   * was read before it is dropped from both copies, so the erase is not undone by a device
   * that has not heard of it yet.
   */
  progressResetAt?: string | null;
  /**
   * Marcadores y subrayados de los libros leídos del servidor sin descargar, por id del
   * temporal (`tmp:kavita:<tomo>`, el mismo en todos los aparatos). Ver marcasSync.ts.
   */
  marcasTemporales?: MarcasTemporales | null;
  /**
   * Los partes diarios de lectura (un libro, un día), con lo de cada aparato por separado.
   * Ver estadisticasSync.ts. Van en el perfil activo de cada aparato.
   */
  readingStats?: ParteDiario[] | null;
  /** Cuándo se borraron las estadísticas de un libro, por título. */
  readingStatsRemovals?: Record<string, string> | null;
  /** Los últimos repasos de Yoru SRS (db.getSrsHistory). */
  srsHistory?: any[] | null;
  /** Repasos, palabras nuevas y tiempo de estudio de cada día, por aparato. */
  srsDays?: DiasSrsPorAparato | null;
  /** Cuándo se limpió el historial de repasos por última vez. */
  srsHistoryClearedAt?: string | null;
};

type ServerProgress = {
  kavita?: Record<string, any> | null;
  audiobooks?: Record<string, any> | null;
};

export interface MergeResult {
  merged: DbExport;
  // The merge added or changed something this device does not have yet.
  localChanged: boolean;
  // The merge has something the Drive copy does not have yet.
  cloudChanged: boolean;
  /**
   * The part of localChanged that screens cannot pick up by themselves (books, words, cards,
   * profiles). False when all this device got was server progress, which announces itself
   * with an event, so there is no need to reload the page for it.
   */
  localNeedsReload: boolean;
}

function time(value: unknown): number {
  const ms = typeof value === 'string' ? Date.parse(value) : 0;
  return Number.isNaN(ms) ? 0 : ms;
}

function bookTime(book: any): number {
  return Math.max(time(book?.lastRead), time(book?.updatedAt), time(book?.createdAt), time(book?.deletedAt));
}

/**
 * Cuál de las dos copias de un libro es la más reciente.
 *
 * Con la misma fecha y una de las dos borrada, gana la borrada: hasta el 27 nov 2026 borrar
 * un libro no le ponía fecha (`deletedAt`), así que una copia borrada y la misma sin borrar
 * empataban, aunque el borrado fue lo último que pasó. Sin esto, cada aparato se quedaba
 * con la suya y el PC no podía subir su borrado (zams, 27 nov 2026).
 */
function newerBook(local: any, cloud: any): any {
  const cloudTime = bookTime(cloud);
  const localTime = bookTime(local);
  if (cloudTime !== localTime) return cloudTime > localTime ? cloud : local;
  return cloud?.isDeleted && !local?.isDeleted ? cloud : local;
}

// Books get a new random id on each device they are imported on, so match by title too.
function bookTitleKey(book: any): string {
  return claveTituloAutor(book);
}

/**
 * Cuándo se llegó a la página en la que está esta copia del libro.
 *
 * `lastRead` no sirve para esto: cambia con solo abrir el libro (App.handleSelectBook) y
 * con cada recuento de segundos. Si el teléfono abría el libro en la página vieja —antes
 * de enterarse de lo leído en el PC, o porque se quedó abierto—, su `lastRead` era el más
 * nuevo y su página vieja ganaba, y luego la subía y le quitaba la suya al PC (zams, 27
 * nov 2026). `positionStamp` solo cambia al pasar de página (db.updateBookProgress).
 *
 * El sello vale solo si apunta a la página que tiene la copia: una versión anterior de la
 * app guarda la ficha con el sello que le llegó, pero mueve la página sin tocarlo. Entonces
 * se vuelve a `lastRead`, como antes.
 */
export function selloDePosicion(book: any): number {
  const stamp = book?.positionStamp;
  const progress = book?.progress || {};
  if (stamp && stamp.chapter === progress.currentChapter && stamp.page === progress.currentPage) return time(stamp.at);
  return bookTime(book);
}

function mergeBook(local: any, cloud: any): any {
  const newer = newerBook(local, cloud);
  const older = newer === local ? cloud : local;
  const newerProgress = newer.progress || {};
  const olderProgress = older.progress || {};
  // La página va aparte del resto de la ficha: la lleva la copia que la movió más tarde.
  const placeFrom = selloDePosicion(cloud) > selloDePosicion(local) ? cloud : local;
  const placeProgress = placeFrom.progress || {};
  const place: any = {};
  for (const key of ['currentChapter', 'currentPage', 'percent']) {
    if (key in placeProgress) place[key] = placeProgress[key];
  }
  return conPortadaOriginal({
    ...older,
    ...newer,
    // Keep this device's id so open readers and saved positions still match.
    id: local.id,
    // A deleted book keeps its stats but not its text: without this, the device that still
    // had the text would upload it again on every sync.
    chapters: newer.isDeleted ? [] : ((local.chapters?.length ? local.chapters : cloud.chapters) || []),
    progress: {
      ...olderProgress,
      ...newerProgress,
      ...place,
      // Reading totals only grow; adding both would count shared history twice.
      charactersRead: Math.max(newerProgress.charactersRead || 0, olderProgress.charactersRead || 0),
      secondsRead: Math.max(newerProgress.secondsRead || 0, olderProgress.secondsRead || 0),
    },
    // Sin sello en la copia que lleva la página, ninguno: el de la otra apuntaría a otra.
    positionStamp: placeFrom.positionStamp,
    // Marcadores y subrayados van por su cuenta, uno a uno: poner uno en el PC no cambia
    // lastRead, así que si el teléfono había leído después, su lista (sin el marcador nuevo)
    // ganaba siempre. Ver marcasSync.ts.
    ...combinarMarcasDeLibro(local, cloud, newer === local ? 'local' : 'remoto'),
    // The text never travels in the bundle (textosLibros.ts), so the cover that came with it
    // may be the small one: the device that has the original keeps it.
  }, local, cloud);
}

export function mergeBooks(local: any[] = [], cloud: any[] = []): any[] {
  const result = local.map((book) => ({ ...book }));
  const byId = new Map(result.map((book, index) => [book.id, index]));
  const byTitle = new Map(result.map((book, index) => [bookTitleKey(book), index]));
  for (const cloudBook of cloud) {
    const index = byId.get(cloudBook.id) ?? byTitle.get(bookTitleKey(cloudBook));
    if (index === undefined) {
      result.push(cloudBook);
      byId.set(cloudBook.id, result.length - 1);
      byTitle.set(bookTitleKey(cloudBook), result.length - 1);
    } else {
      result[index] = mergeBook(result[index], cloudBook);
    }
  }
  return result;
}

function cardTime(card: any): number {
  return Math.max(time(card?.lastReview), time(card?.last_review));
}

// When a card was last put in place, to weigh against its removal on another device: its last
// review, its Anki import (cards last reviewed long ago but imported after the removal), or for a
// card never reviewed, its creation, which is when a new card falls due.
function cardSavedTime(card: any, key = ''): number {
  // A deck placeholder falls due a year after it is created, so its due date says nothing:
  // only its creation time counts (none on old placeholders, so a removal always wins).
  if (key.startsWith('_deck_')) return time(card?.createdAt);
  const created = !cardTime(card) && !card?.state ? Math.max(time(card?.due), time(card?.dueDate)) : 0;
  return Math.max(cardTime(card), time(card?.importedAt), created);
}

export function mergeSrs(local: ProfileData, cloud: ProfileData, preferCloud: boolean) {
  const removals: Record<string, string> = { ...(cloud.srsRemovals || {}) };
  for (const [key, at] of Object.entries(local.srsRemovals || {})) {
    if (time(at) > time(removals[key])) removals[key] = at;
  }
  let srsData: Record<string, any> | null;
  const l = local.srsData;
  const c = cloud.srsData;
  if (!l) srsData = c ? { ...c } : null;
  else if (!c) srsData = { ...l };
  else {
    srsData = { ...c, ...l };
    for (const key of Object.keys(c)) {
      if (!(key in l)) continue;
      const localTime = cardTime(l[key]);
      const cloudTime = cardTime(c[key]);
      if (cloudTime > localTime || (cloudTime === localTime && preferCloud)) srsData[key] = c[key];
    }
  }
  // A card removed on one device after it was last saved on the other stays removed; a card
  // saved again after its removal is kept and the removal is forgotten.
  for (const [key, at] of Object.entries(removals)) {
    const card = srsData?.[key];
    if (!card) continue;
    if (time(at) >= cardSavedTime(card, key)) delete srsData![key];
    else delete removals[key];
  }
  return { srsData, srsRemovals: Object.keys(removals).length ? removals : null };
}

// Word by word, the side that changed the word last wins, including removing its status.
// Words with no recorded change (data from before times were kept) fall back to preferCloud.
function mergeStatuses(local: ProfileData, cloud: ProfileData, preferCloud: boolean) {
  const localStatuses = local.wordStatuses || {};
  const cloudStatuses = cloud.wordStatuses || {};
  const localTimes = local.wordStatusTimes || {};
  const cloudTimes = cloud.wordStatusTimes || {};
  const statuses: Record<string, string> = {};
  const times: Record<string, string> = { ...cloudTimes, ...localTimes };
  const words = new Set([...Object.keys(localStatuses), ...Object.keys(cloudStatuses), ...Object.keys(localTimes), ...Object.keys(cloudTimes)]);
  for (const word of words) {
    const localTime = time(localTimes[word]);
    const cloudTime = time(cloudTimes[word]);
    let useCloud: boolean;
    if (localTime || cloudTime) {
      useCloud = cloudTime > localTime;
    } else if (!(word in localStatuses) || !(word in cloudStatuses)) {
      useCloud = !(word in localStatuses); // only one side has it: keep it
    } else {
      useCloud = preferCloud;
    }
    const source = useCloud ? cloudStatuses : localStatuses;
    if (useCloud && cloudTimes[word]) times[word] = cloudTimes[word];
    if (word in source) statuses[word] = source[word];
  }
  if (!local.wordStatuses && !cloud.wordStatuses) return { wordStatuses: null, wordStatusTimes: Object.keys(times).length ? times : null };
  return { wordStatuses: statuses, wordStatusTimes: Object.keys(times).length ? times : null };
}

// Entry by entry, the side that touched it last wins. A removed entry stays as a dated marker
// (`borrado`), so "forget this series" on one device is not undone by the other.
function mergeProgressMap(local?: Record<string, any> | null, cloud?: Record<string, any> | null): Record<string, any> {
  const result: Record<string, any> = { ...(cloud || {}), ...(local || {}) };
  for (const [key, entry] of Object.entries(cloud || {})) {
    if (local && key in local && time(entry?.at) > time(local[key]?.at)) result[key] = entry;
  }
  return result;
}

function mergeServerProgress(local: ProfileData, cloud: ProfileData): ServerProgress | null {
  const l = local.serverProgress;
  const c = cloud.serverProgress;
  // Neither side knows about it (exports from before this existed): leave it out, so the
  // merge does not look different from both copies just for carrying an empty field.
  if (!l && !c) return null;
  return {
    kavita: mergeProgressMap(l?.kavita, c?.kavita),
    audiobooks: mergeProgressMap(l?.audiobooks, c?.audiobooks),
  };
}

function normalProgress(progress?: ServerProgress | null) {
  return { kavita: progress?.kavita || {}, audiobooks: progress?.audiobooks || {} };
}

// Key order does not matter: a merged book spreads both copies and may list keys differently.
function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
      : v
  );
}

function sameJson(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

/**
 * One profile's data from two copies, item by item. It is what mergeDatabaseExports does for
 * each profile, on its own so the Yoru sync can also fold two profiles of the same account
 * into one (reconciliarPerfiles in yoruSyncNucleo.ts) with the very same rules.
 */
export function mergeProfileData(local: ProfileData, cloud: ProfileData, preferCloud: boolean): ProfileData {
  // An erase of the reading progress on either side applies to both before they are merged:
  // reading totals only grow in a merge, so the older copy would otherwise bring them back.
  const progressResetAt = ultimaMarca(local.progressResetAt, cloud.progressResetAt);
  const l = perfilTrasBorrado(local, progressResetAt);
  const c = perfilTrasBorrado(cloud, progressResetAt);
  const result: ProfileData = {
    books: mergeBooks(l.books, c.books),
    settings: l.settings ?? c.settings ?? null,
    ...mergeStatuses(l, c, preferCloud),
    ...mergeSrs(l, c, preferCloud),
  };
  const serverProgress = mergeServerProgress(l, c);
  if (serverProgress) result.serverProgress = serverProgress;
  const marcasTemporales = combinarMarcasTemporales(l.marcasTemporales, c.marcasTemporales);
  if (Object.keys(marcasTemporales).length) result.marcasTemporales = marcasTemporales;
  if (progressResetAt) result.progressResetAt = progressResetAt;
  Object.assign(result, mergeStats(l, c));
  return result;
}

/**
 * Las estadísticas de lectura y de Yoru SRS (estadisticasSync.ts). Cada campo solo sale si
 * alguno de los dos lados lo traía, para que una copia de una versión anterior no parezca
 * distinta solo por no tenerlo.
 */
function mergeStats(l: ProfileData, c: ProfileData): Partial<ProfileData> {
  const result: Partial<ProfileData> = {};
  const has = (key: keyof ProfileData) => l[key] != null || c[key] != null;
  const removals = combinarQuitados(l.readingStatsRemovals, c.readingStatsRemovals);
  if (has('readingStatsRemovals')) result.readingStatsRemovals = removals;
  if (has('readingStats')) result.readingStats = partesSinQuitados(combinarPartes(l.readingStats, c.readingStats), removals, 'local');
  const clearedAt = ultimaMarca(l.srsHistoryClearedAt, c.srsHistoryClearedAt);
  if (clearedAt) result.srsHistoryClearedAt = clearedAt;
  if (has('srsHistory')) {
    const history = combinarHistorialSrs(l.srsHistory, c.srsHistory);
    result.srsHistory = clearedAt ? historialDespuesDe(history, time(clearedAt)) : history;
  }
  if (has('srsDays')) {
    const days = combinarDiasSrs(l.srsDays, c.srsDays);
    result.srsDays = clearedAt ? diasSrsDespuesDe(days, diaDeMarca(clearedAt)) : days;
  }
  return result;
}

const STATS_KEYS = ['readingStats', 'readingStatsRemovals', 'srsHistory', 'srsDays'] as const;
const STATS_EMPTY: Record<(typeof STATS_KEYS)[number], unknown> = {
  readingStats: [],
  readingStatsRemovals: {},
  srsHistory: [],
  srsDays: {},
};

/**
 * @param preferCloud true when another device synced after this one last did, so the Drive copy
 *   holds the most recent changes for items that carry no date of their own (word statuses).
 */
export function mergeDatabaseExports(local: DbExport, cloud: DbExport, preferCloud: boolean): MergeResult {
  const profiles = [...(local.profiles || [])];
  for (const profile of cloud.profiles || []) {
    if (!profiles.some((p) => p.id === profile.id)) profiles.push(profile);
  }

  const profileData: Record<string, ProfileData> = {};
  for (const { id } of profiles) {
    profileData[id] = mergeProfileData(local.profileData?.[id] || {}, cloud.profileData?.[id] || {}, preferCloud);
  }

  const merged: DbExport = {
    ...local,
    exportDate: new Date().toISOString(),
    activeProfileId: local.activeProfileId || cloud.activeProfileId,
    profiles,
    profileData,
  };

  const differs = (side: DbExport) =>
    !sameJson(side.profiles, merged.profiles)
    || profiles.some(({ id }) => {
      const s = side.profileData?.[id] || {};
      const m = profileData[id];
      return !sameJson(s.books, m.books) || !sameJson(s.wordStatuses, m.wordStatuses)
        || !sameJson(s.wordStatusTimes, m.wordStatusTimes) || !sameJson(s.srsData, m.srsData)
        || !sameJson(s.srsRemovals, m.srsRemovals)
        || !sameJson(s.marcasTemporales || {}, m.marcasTemporales || {})
        || (s.progressResetAt || null) !== (m.progressResetAt || null);
    });
  const progressDiffers = (side: DbExport) =>
    profiles.some(({ id }) =>
      !sameJson(normalProgress(side.profileData?.[id]?.serverProgress), normalProgress(profileData[id].serverProgress)));

  // Las estadísticas se leen al abrir cada pantalla: no hace falta recargar por ellas.
  const statsDiffer = (side: DbExport) =>
    profiles.some(({ id }) => {
      const s = side.profileData?.[id] || {};
      const m = profileData[id];
      return STATS_KEYS.some((key) => !sameJson(s[key] ?? STATS_EMPTY[key], m[key] ?? STATS_EMPTY[key]))
        || (s.srsHistoryClearedAt || null) !== (m.srsHistoryClearedAt || null);
    });

  const localNeedsReload = differs(local);
  return {
    merged,
    localChanged: localNeedsReload || progressDiffers(local) || statsDiffer(local),
    cloudChanged: differs(cloud) || progressDiffers(cloud) || statsDiffer(cloud),
    localNeedsReload,
  };
}

/**
 * Libros de `cloud` (vivos) que no están en `merged` ni vivos ni borrados: los que una subida
 * perdería sin que nadie los haya borrado. Es lo que se mira antes de subir.
 *
 * Hasta el 27 nov 2026 se comparaba cuántos libros vivos había a cada lado, y eso cuenta un
 * borrado hecho a propósito como un libro perdido: borrar en el PC un libro que el servidor
 * tenía dejaba la sincronización parada para siempre («No se pudo sincronizar»). Un libro
 * borrado sigue en la lista, marcado `isDeleted`; uno perdido, no está.
 */
export function lostBooks(merged: DbExport | null | undefined, cloud: DbExport | null | undefined): any[] {
  const kept = new Set<string>();
  for (const p of Object.values(merged?.profileData || {})) {
    for (const book of p?.books || []) {
      if (book?.id) kept.add(`id:${book.id}`);
      kept.add(`t:${bookTitleKey(book)}`);
    }
  }
  const lost: any[] = [];
  for (const p of Object.values(cloud?.profileData || {})) {
    for (const book of p?.books || []) {
      if (!book || book.isDeleted) continue;
      if (!kept.has(`id:${book.id}`) && !kept.has(`t:${bookTitleKey(book)}`)) lost.push(book);
    }
  }
  return lost;
}

/** Books not marked deleted, across all profiles. */
export function countLiveBooks(data: DbExport | null | undefined): number {
  if (!data?.profileData) return 0;
  return Object.values(data.profileData).reduce(
    (total, p) => total + (p?.books || []).filter((b: any) => !b?.isDeleted).length,
    0
  );
}
