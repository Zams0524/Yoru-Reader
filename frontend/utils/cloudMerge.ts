/**
 * Merge of two full database exports (db.exportFullDatabase): this device's and the copy in
 * Google Drive. Sync never replaces one side with the other: profiles, books, word statuses and
 * SRS cards from both sides are kept, and only when the same item exists on both does one copy
 * win (the more recently read book, the more recently reviewed card).
 */

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
  return Math.max(time(book?.lastRead), time(book?.updatedAt), time(book?.createdAt));
}

// Books get a new random id on each device they are imported on, so match by title too.
function bookTitleKey(book: any): string {
  return `${String(book?.title || '').trim().toLowerCase()}\u0000${String(book?.author || '').trim().toLowerCase()}`;
}

function mergeBook(local: any, cloud: any): any {
  const newer = bookTime(cloud) > bookTime(local) ? cloud : local;
  const older = newer === local ? cloud : local;
  const newerProgress = newer.progress || {};
  const olderProgress = older.progress || {};
  return {
    ...older,
    ...newer,
    // Keep this device's id so open readers and saved positions still match.
    id: local.id,
    chapters: (local.chapters?.length ? local.chapters : cloud.chapters) || [],
    progress: {
      ...olderProgress,
      ...newerProgress,
      // Reading totals only grow; adding both would count shared history twice.
      charactersRead: Math.max(newerProgress.charactersRead || 0, olderProgress.charactersRead || 0),
      secondsRead: Math.max(newerProgress.secondsRead || 0, olderProgress.secondsRead || 0),
    },
  };
}

function mergeBooks(local: any[] = [], cloud: any[] = []): any[] {
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
function cardSavedTime(card: any): number {
  const created = !cardTime(card) && !card?.state ? Math.max(time(card?.due), time(card?.dueDate)) : 0;
  return Math.max(cardTime(card), time(card?.importedAt), created);
}

function mergeSrs(local: ProfileData, cloud: ProfileData, preferCloud: boolean) {
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
    if (time(at) >= cardSavedTime(card)) delete srsData![key];
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
export function mergeProfileData(l: ProfileData, c: ProfileData, preferCloud: boolean): ProfileData {
  const result: ProfileData = {
    books: mergeBooks(l.books, c.books),
    settings: l.settings ?? c.settings ?? null,
    ...mergeStatuses(l, c, preferCloud),
    ...mergeSrs(l, c, preferCloud),
  };
  const serverProgress = mergeServerProgress(l, c);
  if (serverProgress) result.serverProgress = serverProgress;
  return result;
}

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
        || !sameJson(s.srsRemovals, m.srsRemovals);
    });
  const progressDiffers = (side: DbExport) =>
    profiles.some(({ id }) =>
      !sameJson(normalProgress(side.profileData?.[id]?.serverProgress), normalProgress(profileData[id].serverProgress)));

  const localNeedsReload = differs(local);
  return {
    merged,
    localChanged: localNeedsReload || progressDiffers(local),
    cloudChanged: differs(cloud) || progressDiffers(cloud),
    localNeedsReload,
  };
}

/** Books not marked deleted, across all profiles: used to refuse an upload that would lose some. */
export function countLiveBooks(data: DbExport | null | undefined): number {
  if (!data?.profileData) return 0;
  return Object.values(data.profileData).reduce(
    (total, p) => total + (p?.books || []).filter((b: any) => !b?.isDeleted).length,
    0
  );
}
