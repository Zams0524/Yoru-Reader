/**
 * Table of contents of a book: how an EPUB's own index (NCX / nav) becomes chapters when the
 * book is imported, and which of those chapters the reader lists.
 *
 * An EPUB is a row of files (the spine), and its index names only some of them: one chapter is
 * often cut into several files, and the illustration pages are files of their own. A file the
 * index does not name is a continuation of the chapter before it, not a chapter: it stays in the
 * book where it was, but it is not listed.
 *
 * No DOM here, so that it runs in the tests (tests/toc.test.ts).
 */

export interface TocParent {
  title: string;
  level: number;
}

/** The fields of a chapter that the table of contents reads. */
export interface TocChapter {
  title?: string;
  isFromToc?: boolean;
  /** Depth in the book's index: 0 for a chapter, 1 for a section inside it, and so on. */
  tocLevel?: number;
  /** A file the index does not name: more of the chapter before it. Not listed. */
  continuation?: boolean;
  /** Index entries that start at the same place as this chapter (a part and its first chapter). */
  tocParents?: TocParent[];
}

export interface TocEntry {
  chapterIndex: number;
  /** As stored; the reader translates the generic names (chapterDisplayTitle). */
  title: string;
  level: number;
}

/** One entry of the EPUB's index, in the order the index gives them. */
export interface TocRef {
  /** Path of the file inside the EPUB, already resolved. */
  path: string;
  /** What follows the # of the link, or ''. */
  fragment: string;
  label: string;
  level: number;
}

/** One file of the spine, already turned into paragraphs. */
export interface SpineDoc<P = any> {
  path: string;
  paragraphs: P[];
  /** Fragment (element id) to the paragraph it is in. */
  anchors: Record<string, number>;
  /** First heading of the file, with its tag ('h1'...). */
  heading?: { text: string; tag: string };
  /** The file's <title>. */
  titleTag?: string;
  /** Characters of text before each paragraph; only its growth is used. */
  textLength?: (paragraph: P) => number;
}

export interface PlannedChapter<P = any> extends TocChapter {
  title: string;
  isFromToc: boolean;
  paragraphs: P[];
}

const cleanPath = (path: string): string => (path || '')
  .toLowerCase()
  .replace(/\\/g, '/')
  .replace(/^\.\//, '')
  .replace(/^\//, '');

const fileName = (path: string): string => cleanPath(path).split('/').pop() || '';

/** Letters and digits only, so that 〝朝顔〟 and "朝顔" compare equal. */
export function normalizeTitle(title: string | undefined): string {
  return (title || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * True when a file's title is just the book's: publishers put the book title in the <title> of
 * every file, often without the imprint that the book's own metadata adds ("(ファミ通文庫)").
 */
export function titleLooksLikeBook(title: string | undefined, bookTitle: string | undefined): boolean {
  const a = normalizeTitle(title);
  const b = normalizeTitle(bookTitle);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.includes(short) && short.length / long.length >= 0.5;
}

const PLACEHOLDER_TITLE = /^Capítulo \d+$/;

/**
 * The entries the reader lists for a book.
 *
 * Books imported before the index was read in full have no `continuation` marks: for those, the
 * files the index did not name are recognised by their title (the book's own, a placeholder, or
 * one that several of them share).
 */
export function buildTocEntries(chapters: TocChapter[] | undefined, bookTitle?: string): TocEntry[] {
  const list = Array.isArray(chapters) ? chapters : [];
  const entries: TocEntry[] = [];
  const marked = list.some((chapter) => chapter && (chapter.continuation !== undefined || chapter.tocLevel !== undefined));

  if (marked) {
    list.forEach((chapter, chapterIndex) => {
      if (!chapter) return;
      if (chapter.continuation && chapterIndex > 0) return;
      for (const parent of chapter.tocParents || []) {
        entries.push({ chapterIndex, title: parent.title, level: Math.max(0, parent.level || 0) });
      }
      entries.push({ chapterIndex, title: chapter.title || '', level: Math.max(0, chapter.tocLevel || 0) });
    });
    return entries;
  }

  const hasToc = list.some((chapter) => chapter?.isFromToc);
  const loose = new Map<string, number>();
  for (const chapter of list) {
    if (chapter && !chapter.isFromToc) loose.set(chapter.title || '', (loose.get(chapter.title || '') || 0) + 1);
  }
  list.forEach((chapter, chapterIndex) => {
    if (!chapter) return;
    const title = chapter.title || '';
    if (chapterIndex > 0 && !chapter.isFromToc) {
      if (title && title === (list[chapterIndex - 1]?.title || '')) return;
      if (hasToc && (
        titleLooksLikeBook(title, bookTitle)
        || PLACEHOLDER_TITLE.test(title)
        || (loose.get(title) || 0) >= 2
      )) return;
    }
    entries.push({ chapterIndex, title, level: 0 });
  });
  return entries;
}

/** The entry the reader is in: the last one that starts at or before the chapter. -1 if none. */
export function activeTocEntry(entries: TocEntry[], chapterIndex: number): number {
  let active = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].chapterIndex <= chapterIndex) active = i;
    else break;
  }
  return active;
}

/** Less text than this before the first anchor of a file is an ornament, not a page of its own. */
const SMALL_PREFIX_CHARS = 200;

/**
 * Turns the spine into chapters, following the EPUB's index.
 *
 * - A file the index names starts a chapter with the index's name for it.
 * - A file with several index entries (a book in one file, sections inside a chapter) is cut at
 *   each of them.
 * - A file the index does not name, with a heading of its own, is a chapter (h1) or a section of
 *   the chapter before it (h2 and below).
 * - Any other file is a continuation of the chapter before it.
 */
export function planChapters<P>(spine: SpineDoc<P>[], toc: TocRef[], bookTitle: string): PlannedChapter<P>[] {
  const docs = spine;
  const refsByDoc: TocRef[][] = docs.map(() => []);
  let matched = 0;
  for (const ref of toc) {
    if (!ref.label) continue;
    const wanted = cleanPath(ref.path);
    let index = docs.findIndex((doc) => cleanPath(doc.path) === wanted);
    if (index === -1) {
      const name = fileName(ref.path);
      index = name ? docs.findIndex((doc) => fileName(doc.path) === name) : -1;
    }
    if (index === -1) continue;
    refsByDoc[index].push(ref);
    matched++;
  }
  const hasToc = matched > 0;

  const titleTagCount = new Map<string, number>();
  for (const doc of docs) {
    const key = normalizeTitle(doc.titleTag);
    if (key) titleTagCount.set(key, (titleTagCount.get(key) || 0) + 1);
  }
  const ownTitleTag = (doc: SpineDoc<P>): string => {
    const text = (doc.titleTag || '').trim();
    const key = normalizeTitle(text);
    if (!key || key === 'untitled' || key === 'untitleddocument' || key === 'unknown') return '';
    if (text === bookTitle || titleLooksLikeBook(text, bookTitle)) return '';
    if ((titleTagCount.get(key) || 0) >= 3) return '';
    return text;
  };

  const chapters: PlannedChapter<P>[] = [];
  let pending: TocRef[] = [];
  let lastTocLevel = -1;

  const continuationOf = (previous: PlannedChapter<P>, paragraphs: P[]): PlannedChapter<P> => ({
    title: previous.title,
    isFromToc: previous.isFromToc,
    continuation: true,
    paragraphs,
  });

  docs.forEach((doc, docIndex) => {
    const refs = [...pending, ...refsByDoc[docIndex]];
    if (doc.paragraphs.length === 0) {
      // Nothing to read here (an empty page): its entries point at what comes next.
      pending = refs.map((ref) => ({ ...ref, fragment: '' }));
      return;
    }
    pending = [];

    if (refs.length === 0) {
      const previous = chapters[chapters.length - 1];
      const heading = (doc.heading?.text || '').trim();
      const ownTitle = heading || ownTitleTag(doc);
      if (!hasToc) {
        chapters.push({
          title: ownTitle || (chapters.length === 0 ? 'Portada' : `Capítulo ${chapters.length + 1}`),
          isFromToc: false,
          paragraphs: doc.paragraphs,
        });
        return;
      }
      if (!ownTitle || (previous && normalizeTitle(ownTitle) === normalizeTitle(previous.title))) {
        chapters.push(previous
          ? continuationOf(previous, doc.paragraphs)
          : { title: 'Portada', isFromToc: false, tocLevel: 0, paragraphs: doc.paragraphs });
        return;
      }
      const nested = Boolean(heading) && doc.heading?.tag !== 'h1' && lastTocLevel >= 0;
      chapters.push({
        title: ownTitle,
        isFromToc: false,
        tocLevel: nested ? lastTocLevel + 1 : 0,
        paragraphs: doc.paragraphs,
      });
      return;
    }

    const length = doc.paragraphs.length;
    const placed = refs.map((ref, order) => {
      const at = ref.fragment ? doc.anchors[ref.fragment] : 0;
      return { ref, order, at: typeof at === 'number' && at >= 0 && at < length ? at : -1 };
    });
    // An anchor that is not in the text starts where the entry before it does.
    placed.forEach((item, i) => { if (item.at === -1) item.at = i === 0 ? 0 : placed[i - 1].at; });
    placed.sort((a, b) => a.at - b.at || a.order - b.order);

    const first = placed[0].at;
    if (first > 0) {
      const measure = doc.textLength;
      const prefixChars = measure
        ? doc.paragraphs.slice(0, first).reduce((sum, paragraph) => sum + measure(paragraph), 0)
        : SMALL_PREFIX_CHARS;
      if (prefixChars < SMALL_PREFIX_CHARS) {
        placed.forEach((item) => { if (item.at === first) item.at = 0; });
      } else {
        const previous = chapters[chapters.length - 1];
        const prefix = doc.paragraphs.slice(0, first);
        chapters.push(previous
          ? continuationOf(previous, prefix)
          : { title: 'Portada', isFromToc: false, tocLevel: 0, paragraphs: prefix });
      }
    }

    for (let i = 0; i < placed.length;) {
      let end = i;
      while (end + 1 < placed.length && placed[end + 1].at === placed[i].at) end++;
      const own = placed[end].ref;
      const parents = placed.slice(i, end).map((item) => ({ title: item.ref.label, level: item.ref.level }));
      const until = end + 1 < placed.length ? placed[end + 1].at : length;
      const chapter: PlannedChapter<P> = {
        title: own.label,
        isFromToc: true,
        tocLevel: own.level,
        paragraphs: doc.paragraphs.slice(placed[i].at, until),
      };
      if (parents.length > 0) chapter.tocParents = parents;
      chapters.push(chapter);
      lastTocLevel = own.level;
      i = end + 1;
    }
  });

  return chapters;
}
