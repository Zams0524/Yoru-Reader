/**
 * Agrupaciones derivadas de la biblioteca local para las vistas del shell nuevo.
 *
 * La plantilla trae vistas de Series, Autores, Colecciones y Estantes que Kavita
 * resuelve con su base de datos. Aquí se calculan desde los campos que ya guarda
 * `db.ts` en cada libro (`series`, `author`, `tags`, `status`, `progress`), así que
 * no hace falta ningún servidor.
 */

export interface ShelfBook {
  id: string;
  title: string;
  author?: string;
  cover?: string;
  hideCover?: boolean;
  series?: string;
  tags?: string[];
  status?: string;
  createdAt?: string;
  lastRead?: string;
  chapters?: unknown[];
  isDeleted?: boolean;
  progress?: {
    currentChapter?: number;
    currentPage?: number;
    percent?: number;
    charactersRead?: number;
    secondsRead?: number;
  };
}

export interface EntityGroup {
  key: string;
  name: string;
  books: ShelfBook[];
}

export type ShelfId = 'reading' | 'want' | 'backlog' | 'completed';

/** El estado efectivo de un libro, con el mismo respaldo por progreso que usa LibraryQuickBar. */
export function bookStatus(book: ShelfBook): string {
  const percent = book.progress?.percent ?? 0;
  return book.status || (percent === 0 ? 'unread' : percent >= 100 ? 'completed' : 'reading');
}

export function visibleBooks(books: ShelfBook[]): ShelfBook[] {
  return books.filter((book) => !book.isDeleted);
}

/** Libros del estante, en el orden en que la vista los muestra. */
export function shelfBooks(books: ShelfBook[], shelf: ShelfId): ShelfBook[] {
  const list = visibleBooks(books);
  if (shelf === 'reading') {
    return list.filter((book) => bookStatus(book) === 'reading').sort(byLastRead);
  }
  if (shelf === 'completed') {
    return list.filter((book) => bookStatus(book) === 'completed').sort(byLastRead);
  }
  if (shelf === 'want') {
    // «Por empezar»: sin abrir todavía, lo más reciente primero.
    return list.filter((book) => bookStatus(book) === 'unread' && !book.lastRead).sort(byCreatedAt);
  }
  // «Pendiente»: empezado y aparcado (pausado, planeado, o sin tocar en 30 días).
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return list
    .filter((book) => {
      const status = bookStatus(book);
      if (status === 'paused' || status === 'planning') return true;
      if (status !== 'reading') return false;
      const last = book.lastRead ? Date.parse(book.lastRead) : NaN;
      return Number.isFinite(last) && last < cutoff;
    })
    .sort(byLastRead);
}

export function byLastRead(a: ShelfBook, b: ShelfBook): number {
  return time(b.lastRead || b.createdAt) - time(a.lastRead || a.createdAt);
}

export function byCreatedAt(a: ShelfBook, b: ShelfBook): number {
  return time(b.createdAt) - time(a.createdAt);
}

function time(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** El libro que el usuario está leyendo ahora mismo: el último abierto sin terminar. */
export function continueReading(books: ShelfBook[]): ShelfBook[] {
  return visibleBooks(books)
    .filter((book) => book.lastRead && (book.progress?.percent ?? 0) < 100)
    .sort(byLastRead)
    .slice(0, 6);
}

export function recentlyAdded(books: ShelfBook[], limit = 18): ShelfBook[] {
  return visibleBooks(books).sort(byCreatedAt).slice(0, limit);
}

/**
 * «Para ti»: lo que queda sin abrir, priorizando series y autores que el usuario ya lee,
 * en lugar de la lista aleatoria de la plantilla.
 */
export function suggestions(books: ShelfBook[], limit = 18): ShelfBook[] {
  const list = visibleBooks(books);
  const readSeries = new Set<string>();
  const readAuthors = new Set<string>();
  for (const book of list) {
    if (!book.lastRead) continue;
    if (book.series) readSeries.add(book.series);
    if (book.author) readAuthors.add(book.author);
  }
  return list
    .filter((book) => !book.lastRead && bookStatus(book) !== 'completed')
    .map((book) => {
      let score = 0;
      if (book.series && readSeries.has(book.series)) score += 2;
      if (book.author && readAuthors.has(book.author)) score += 1;
      return { book, score };
    })
    .sort((a, b) => b.score - a.score || byCreatedAt(a.book, b.book))
    .slice(0, limit)
    .map((entry) => entry.book);
}

function groupBy(books: ShelfBook[], pick: (book: ShelfBook) => string[]): EntityGroup[] {
  const groups = new Map<string, EntityGroup>();
  for (const book of visibleBooks(books)) {
    for (const name of pick(book)) {
      const key = name.trim();
      if (!key) continue;
      let group = groups.get(key);
      if (!group) {
        group = { key, name: key, books: [] };
        groups.set(key, group);
      }
      group.books.push(book);
    }
  }
  return Array.from(groups.values()).sort(
    (a, b) => b.books.length - a.books.length || a.name.localeCompare(b.name, 'ja')
  );
}

export function seriesGroups(books: ShelfBook[]): EntityGroup[] {
  return groupBy(books, (book) => (book.series ? [book.series] : []));
}

export function authorGroups(books: ShelfBook[]): EntityGroup[] {
  return groupBy(books, (book) => (book.author ? [book.author] : []));
}

export function collectionGroups(books: ShelfBook[]): EntityGroup[] {
  return groupBy(books, (book) => book.tags || []);
}

/** Otros volúmenes de la misma serie, ordenados por título para que el tomo 1 vaya primero. */
export function sameSeries(books: ShelfBook[], book: ShelfBook): ShelfBook[] {
  if (!book.series) return [];
  return visibleBooks(books)
    .filter((other) => other.series === book.series && other.id !== book.id)
    .sort((a, b) => a.title.localeCompare(b.title, 'ja', { numeric: true }));
}

export function sameAuthor(books: ShelfBook[], book: ShelfBook): ShelfBook[] {
  if (!book.author) return [];
  return visibleBooks(books)
    .filter((other) => other.author === book.author && other.id !== book.id && other.series !== book.series)
    .sort(byCreatedAt)
    .slice(0, 18);
}

export function searchBooks(books: ShelfBook[], query: string, limit = 30): ShelfBook[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return visibleBooks(books)
    .filter((book) => {
      const haystack = [book.title, book.author, book.series, ...(book.tags || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    })
    .slice(0, limit);
}

export function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
