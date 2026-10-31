// Types for the self-hosted media servers Yoru talks to: Kavita (EPUB light novels) and
// Audiobookshelf (audiobooks). Only the fields Yoru reads are typed; the servers send more.

// ── Kavita ──────────────────────────────────────────────────────────────

export type KavitaAuthMode = 'apiKey' | 'password';

/** Saved on this device only (localStorage); never part of backups or Google Drive sync. */
export interface KavitaConfig {
  serverUrl: string;
  authMode: KavitaAuthMode;
  /** The user's Kavita API key. With password login, Kavita returns it and Yoru keeps it instead of the password. */
  apiKey: string;
  username: string;
  /** Last JWT, refreshed from the API key when it expires. */
  token?: string;
}

export interface KavitaLibrary {
  id: number;
  name: string;
  /** Kavita LibraryType: 0 Manga, 1 Comic, 2 Book, 3 Image, 4 Light Novel… */
  type: number;
}

export interface KavitaSeries {
  id: number;
  name: string;
  originalName?: string;
  localizedName?: string;
  libraryId: number;
  pages?: number;
  /** Horas estimadas de lectura. Kavita no da el numero de tomos en el listado. */
  avgHoursToRead?: number;
  wordCount?: number;
  /** Kavita MangaFormat: 3 = EPUB. */
  format?: number;
  /** Páginas leídas de toda la serie, para el «seguir leyendo» de la ficha. */
  pagesRead?: number;
  latestReadDate?: string;
}

export interface KavitaChapter {
  id: number;
  title?: string;
  range?: string;
  pages: number;
  files?: { id: number; filePath?: string; pages?: number; format?: number; bytes?: number }[];
  /** Metadatos del fichero, cuando Kavita los sacó del propio EPUB. */
  isbn?: string;
  titleName?: string;
  releaseDate?: string;
  wordCount?: number;
  pagesRead?: number;
  lastReadingProgressUtc?: string;
}

export interface KavitaVolume {
  id: number;
  seriesId: number;
  name: string;
  number: number;
  pages: number;
  chapters: KavitaChapter[];
  /** Páginas que Kavita tiene por leídas de este tomo, y cuándo fue la última vez. */
  pagesRead?: number;
  lastReadingProgressUtc?: string;
  createdUtc?: string;
}

/**
 * Los metadatos que Kavita guarda de una serie (`GET /api/Series/metadata`).
 *
 * Cada lista puede llegar vacía: Kavita rellena lo que venía en el EPUB o lo que el
 * usuario haya escrito, y nada más. Por eso la ficha pregunta por cada campo antes de
 * pintar su fila, en vez de dar por hecho que están.
 */
export interface KavitaSeriesMetadata {
  summary?: string;
  genres: string[];
  tags: string[];
  writers: string[];
  /** Para novela ligera, el ilustrador: Kavita no tiene campo propio para él. */
  coverArtists: string[];
  publishers: string[];
  translators: string[];
  releaseYear?: number;
  /** Etiqueta BCP-47 tal cual la guarda Kavita ("ja", "es"…). */
  language?: string;
  /** Kavita PublicationStatus: 0 En curso, 1 Caducada, 2 Completada, 3 Cancelada, 4 Parada. */
  publicationStatus?: number;
  webLinks: string[];
}

/** One downloadable book: a volume of a series, as shown in the browser. */
export interface KavitaBook {
  seriesId: number;
  seriesName: string;
  libraryId: number;
  volumeId: number;
  chapterId: number;
  title: string;
  pages: number;
  coverUrl: string;
  /** Lo que Kavita sabe de este tomo en concreto; cada campo puede faltar. */
  pagesRead?: number;
  lastReadAt?: string;
  isbn?: string;
  releaseDate?: string;
  wordCount?: number;
  files?: { name: string; pages?: number; bytes?: number; format?: number }[];
}

export interface KavitaPage<T> {
  items: T[];
  page: number;
  totalPages: number;
  totalItems: number;
}

/** Where an imported book came from, so reading progress can be sent back to Kavita. */
export interface KavitaBookSource {
  serverUrl: string;
  seriesId: number;
  volumeId: number;
  chapterId: number;
  libraryId: number;
  pages: number;
}

// ── Audiobookshelf ──────────────────────────────────────────────────────

/** Saved on this device only (localStorage); never part of backups or Google Drive sync. */
export interface AudiobookshelfConfig {
  serverUrl: string;
  /** API token, or the token returned by POST /login (the password itself is never stored). */
  token: string;
  username: string;
}

export interface AudiobookshelfLibrary {
  id: string;
  name: string;
  mediaType: 'book' | 'podcast' | string;
}

export interface Chapter {
  id: number;
  title: string;
  /** Seconds from the start of the audiobook. */
  start: number;
  end: number;
}

export interface AudiobookItem {
  id: string;
  libraryId: string;
  title: string;
  author: string;
  series?: string;
  /** Seconds. */
  duration: number;
  coverUrl: string;
  chapters?: Chapter[];
  /**
   * Lo que Audiobookshelf guarda del libro y Kavita no tiene. Opcional porque su
   * servidor rellena solo lo que venía en el fichero o lo que haya buscado.
   */
  narrator?: string;
  publisher?: string;
  publishedYear?: string;
  language?: string;
  isbn?: string;
  asin?: string;
  description?: string;
}

export interface AudioTrack {
  index: number;
  /** Seconds from the start of the audiobook where this file starts. */
  startOffset: number;
  duration: number;
  /** Absolute URL, with the token in the query string so an <audio> element can load it. */
  url: string;
  mimeType?: string;
}

export interface AudiobookshelfPlaybackSession {
  id: string;
  itemId: string;
  title: string;
  author: string;
  coverUrl: string;
  /** Where the server says the user left off, in seconds. */
  currentTime: number;
  duration: number;
  chapters: Chapter[];
  tracks: AudioTrack[];
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}
