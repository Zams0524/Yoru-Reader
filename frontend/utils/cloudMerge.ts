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
  srsData?: Record<string, any> | null;
};

export interface MergeResult {
  merged: DbExport;
  // The merge added or changed something this device does not have yet.
  localChanged: boolean;
  // The merge has something the Drive copy does not have yet.
  cloudChanged: boolean;
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

function mergeSrs(local: Record<string, any> | null | undefined, cloud: Record<string, any> | null | undefined, preferCloud: boolean) {
  if (!local) return cloud ?? null;
  if (!cloud) return local;
  const result: Record<string, any> = { ...cloud, ...local };
  for (const key of Object.keys(cloud)) {
    if (!(key in local)) continue;
    const localTime = cardTime(local[key]);
    const cloudTime = cardTime(cloud[key]);
    if (cloudTime > localTime || (cloudTime === localTime && preferCloud)) result[key] = cloud[key];
  }
  return result;
}

function mergeStatuses(local: Record<string, string> | null | undefined, cloud: Record<string, string> | null | undefined, preferCloud: boolean) {
  if (!local) return cloud ?? null;
  if (!cloud) return local;
  // No per-word dates: on conflict, the side that changed most recently wins.
  return preferCloud ? { ...local, ...cloud } : { ...cloud, ...local };
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
    const l = local.profileData?.[id] || {};
    const c = cloud.profileData?.[id] || {};
    profileData[id] = {
      books: mergeBooks(l.books, c.books),
      settings: l.settings ?? c.settings ?? null,
      wordStatuses: mergeStatuses(l.wordStatuses, c.wordStatuses, preferCloud),
      srsData: mergeSrs(l.srsData, c.srsData, preferCloud),
    };
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
      return !sameJson(s.books, m.books) || !sameJson(s.wordStatuses, m.wordStatuses) || !sameJson(s.srsData, m.srsData);
    });

  return { merged, localChanged: differs(local), cloudChanged: differs(cloud) };
}

/** Books not marked deleted, across all profiles: used to refuse an upload that would lose some. */
export function countLiveBooks(data: DbExport | null | undefined): number {
  if (!data?.profileData) return 0;
  return Object.values(data.profileData).reduce(
    (total, p) => total + (p?.books || []).filter((b: any) => !b?.isDeleted).length,
    0
  );
}
