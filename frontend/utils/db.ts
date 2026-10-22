import type { BookHighlight } from './highlights';
// LocalStorage DB manager for the Migaku-style Japanese Reader

export interface Book {
  id: string;
  title: string;
  author: string;
  cover: string;
  chapters: any[];
  progress: {
    currentChapter: number;
    currentPage: number;
    percent: number;
    charactersRead: number;
    secondsRead: number;
  };
  status: 'unread' | 'reading' | 'completed';
  createdAt: string;
  lastRead?: string;
  bookmarks?: any[];
  highlights?: BookHighlight[];
  isDeleted?: boolean;
  vocabularyCoverage?: number;
  vocabStats?: Record<string, any>;
  series?: string;
  tags?: string[];
  hideCover?: boolean;
}

export interface Settings {
  fontSize: number;
  theme: string;
  showFurigana: string;
  showTranslation: boolean;
  autoTTS: boolean;
  showLearningStatus: boolean;
  sentenceHover: boolean;
  pitchAccent: string;
  appLanguage: string;
  audioSpeed: string;
  audioGender: string;
  audioVoiceOption: string;
  readingOrientation: string;
  keepStatsOnDelete?: boolean;
  discordEnabled?: boolean;
  discordInactivityTimer?: number;
  discordIcon?: string;
  discordShowStats?: string;
  discordBlacklist?: string;
  srsNewCardsPerDay?: number;
  srsShowAudioButton?: boolean;
  srsCardFront?: 'word' | 'sentence' | 'audio';
  srsMaxReviewsPerDay?: number;
  fsrsRetentionRate?: number;
  fsrsMaxInterval?: number;
  fsrsEnableFuzz?: boolean;
  autoUpdate?: boolean;
  betaUpdates?: boolean;
  disabledDictionaries?: string[];
  dictionaryOrder?: string[];
}

export interface Profile {
  id: string;
  name: string;
  avatar?: string;
}

const WORD_STATUS_TIMES_KEY = 'yoru_word_status_times';

const STORAGE_KEYS = {
  BOOKS: 'migaku_reader_books',
  WORD_STATUS: 'migaku_reader_word_status',
  SETTINGS: 'migaku_reader_settings',
  PROFILES: 'migaku_reader_profiles',
  ACTIVE_PROFILE: 'migaku_reader_active_profile_id'
};

const DEFAULT_SETTINGS: Settings = {
  fontSize: 22, // default to 22px matching reference app scale
  theme: 'dark', // 'dark', 'light', 'sepia'
  showFurigana: 'unknown-only', // default to 'unknown-only' (Palabras desconocidas)
  showTranslation: true,
  autoTTS: false,
  showLearningStatus: true,
  sentenceHover: false,
  pitchAccent: 'none',
  appLanguage: 'en',
  audioSpeed: '1.0',
  audioGender: 'male',
  audioVoiceOption: 'masaru',
  readingOrientation: 'horizontal',
  autoUpdate: true,
  betaUpdates: false,
  disabledDictionaries: [],
  dictionaryOrder: [],
  discordEnabled: true,
  discordInactivityTimer: 300,
  discordIcon: 'Yoru',
  discordShowStats: 'Cards Mined',
  discordBlacklist: ''
};

let srsDataCache: { storageKey: string; data: Record<string, any> } | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key?.includes('yoru_reader_srs_data')) srsDataCache = null;
  });
}

const DEFAULT_PROFILES: Profile[] = [];

// Simple IndexedDB key-value wrapper to support unlimited storage (bypassing localStorage 5MB limit)
const idb = {
  dbPromise: null as Promise<IDBDatabase> | null,

  _getDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('YoruReaderStore', 1);
      request.onupgradeneeded = (e: any) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('keyvalue')) {
          db.createObjectStore('keyvalue');
        }
      };
      request.onsuccess = (e: any) => resolve(e.target.result);
      request.onerror = (e: any) => reject(e.target.error);
    });
    return this.dbPromise;
  },

  async get(key: string): Promise<any> {
    const dbInstance = await this._getDb();
    return new Promise((resolve, reject) => {
      const tx = dbInstance.transaction('keyvalue', 'readonly');
      const store = tx.objectStore('keyvalue');
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async set(key: string, value: any): Promise<void> {
    const dbInstance = await this._getDb();
    return new Promise((resolve, reject) => {
      const tx = dbInstance.transaction('keyvalue', 'readwrite');
      const store = tx.objectStore('keyvalue');
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  async close(): Promise<void> {
    if (this.dbPromise) {
      const dbInstance = await this.dbPromise;
      dbInstance.close();
      this.dbPromise = null;
    }
  }
};

/** Only readings may change: base text, line breaks, headings and images must stay identical. */
function sameTextExceptReadings(current: any[], incoming: any[]): boolean {
  if (current.length === 0 || current.length !== incoming.length) return false;
  const baseText = (content: string) => content
    .replace(/\r\n/g, '\n')
    .replace(/\{([^|{}]+)\|[^{}]*\}/g, '$1');
  return current.every((chapter, index) => {
    const next = incoming[index];
    return typeof chapter?.content === 'string' && typeof next?.content === 'string'
      && chapter.title === next.title && chapter.isFromToc === next.isFromToc
      && baseText(chapter.content) === baseText(next.content);
  });
}

let bookAccessQueue: Promise<unknown> = Promise.resolve();

// Runs library reads and writes one at a time, in call order.
function serializeBookAccess<T>(task: () => Promise<T>): Promise<T> {
  const run = bookAccessQueue.then(task, task);
  bookAccessQueue = run.catch(() => undefined);
  return run;
}

export const db = {
  async close() {
    await idb.close();
  },

  // --- Profiles Management ---
  getProfiles(): Profile[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PROFILES);
      return data ? JSON.parse(data) : DEFAULT_PROFILES;
    } catch (e) {
      console.error('Error loading profiles:', e);
      return DEFAULT_PROFILES;
    }
  },

  saveProfiles(profiles: Profile[]) {
    try {
      localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(profiles));
    } catch (e) {
      console.error('Error saving profiles:', e);
    }
  },

  getActiveProfileId(): string | null {
    try {
      const id = localStorage.getItem(STORAGE_KEYS.ACTIVE_PROFILE);
      if (id) return id;
      const profiles = this.getProfiles();
      return profiles.length > 0 ? profiles[0].id : null;
    } catch (e) {
      return null;
    }
  },

  setActiveProfileId(id: string) {
    try {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_PROFILE, id);
    } catch (e) {
      console.error('Error setting active profile:', e);
    }
  },

  // Helper to segment keys per profile with backward compatibility
  _getKey(baseKey: string): string {
    const profileId = this.getActiveProfileId();
    const segmentedKey = `${baseKey}_${profileId}`;
    
    // Migrate legacy non-segmented data on first run for default profile
    if (profileId === 'profile-default') {
      const legacyData = localStorage.getItem(baseKey);
      const segmentedData = localStorage.getItem(segmentedKey);
      if (legacyData && !segmentedData) {
        localStorage.setItem(segmentedKey, legacyData);
      }
    }
    return segmentedKey;
  },

  // --- Settings Management ---
  getSettings(): Settings {
    try {
      const data = localStorage.getItem(this._getKey(STORAGE_KEYS.SETTINGS));
      const globalLang = localStorage.getItem('app_language') || 'en';
      const parsed = data ? JSON.parse(data) : {};
      // Ensure globalLang overrides defaults, but settings can override if they exist and match
      return { ...DEFAULT_SETTINGS, appLanguage: globalLang, ...parsed };
    } catch (e) {
      console.error('Error loading settings:', e);
      return DEFAULT_SETTINGS;
    }
  },

  saveSettings(settings: Settings) {
    try {
      if (settings && settings.appLanguage) {
        localStorage.setItem('app_language', settings.appLanguage);
      }
      localStorage.setItem(this._getKey(STORAGE_KEYS.SETTINGS), JSON.stringify(settings));
    } catch (e) {
      console.error('Error saving settings:', e);
    }
  },

  // --- Books Management (IndexedDB powered) ---
  // The whole library is one IndexedDB value, so every change is read-modify-write. All access
  // goes through serializeBookAccess so two changes (e.g. the reading position and the reading
  // stats saved together when leaving a book) never overwrite each other with a stale copy.
  getBooks(): Promise<Book[]> {
    return serializeBookAccess(() => this._readBooks());
  },

  saveBooks(books: Book[]): Promise<void> {
    return serializeBookAccess(() => this._writeBooks(books));
  },

  async _readBooks(): Promise<Book[]> {
    try {
      const key = this._getKey(STORAGE_KEYS.BOOKS);
      let books = await idb.get(key);
      
      // Migration from localStorage to IndexedDB
      if (!books) {
        const localData = localStorage.getItem(key);
        if (localData) {
          try {
            books = JSON.parse(localData);
            await idb.set(key, books);
            localStorage.removeItem(key); // clean up localstorage
            console.log("Migradas las estanterías de libros a IndexedDB.");
          } catch (e) {
            books = [];
          }
        } else {
          // Check legacy global key
          const legacyGlobalData = localStorage.getItem(STORAGE_KEYS.BOOKS);
          if (legacyGlobalData && this.getActiveProfileId() === 'profile-default') {
            try {
              books = JSON.parse(legacyGlobalData);
              await idb.set(key, books);
              localStorage.removeItem(STORAGE_KEYS.BOOKS);
              console.log("Migrados los libros globales legacy a IndexedDB.");
            } catch (e) {
              books = [];
            }
          }
        }
      }
      return books || [];
    } catch (e) {
      console.error('Error loading books from IndexedDB:', e);
      return [];
    }
  },

  async _writeBooks(books: Book[]): Promise<void> {
    try {
      const key = this._getKey(STORAGE_KEYS.BOOKS);
      await idb.set(key, books);
    } catch (e) {
      console.error('Error saving books to IndexedDB:', e);
    }
  },

  addBook(book: Partial<Book>): Promise<Book[]> {
    return serializeBookAccess(async () => {
      const books = await this._readBooks();
      // Check if book already exists by title
      const existingIdx = books.findIndex(b => b.title === book.title);
      if (existingIdx !== -1) {
        if (books[existingIdx].isDeleted
          || sameTextExceptReadings(books[existingIdx].chapters || [], book.chapters || [])) {
          // Restore a deleted book, or refresh readings without changing text positions.
          if (books[existingIdx].isDeleted) books[existingIdx].isDeleted = false;
          books[existingIdx].chapters = book.chapters || [];
          await this._writeBooks(books);
        }
        return books;
      }
      const newBook: Book = {
        id: `book-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        title: book.title || 'Libro sin título',
        author: book.author || 'Desconocido',
        cover: book.cover || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        chapters: book.chapters || [],
        progress: {
          currentChapter: 0,
          currentPage: 0,
          percent: 0,
          charactersRead: 0,
          secondsRead: 0
        },
        status: 'unread', // 'unread', 'reading', 'completed'
        createdAt: new Date().toISOString()
      };
      books.push(newBook);
      await this._writeBooks(books);
      return books;
    });
  },

  addBooks(booksList: Partial<Book>[]): Promise<Book[]> {
    return serializeBookAccess(async () => {
      const books = await this._readBooks();
      console.log("db.addBooks - Libros existentes en DB:", books.map(b => b.title));
      console.log("db.addBooks - Libros nuevos a añadir:", booksList.map(b => b.title));
      let addedCount = 0;
      const now = Date.now();
    
      for (let i = 0; i < booksList.length; i++) {
        const book = booksList[i];
        const existingIdx = books.findIndex(b => b.title === book.title);
        if (existingIdx !== -1) {
          if (books[existingIdx].isDeleted) {
            // Restore/undelete it!
            books[existingIdx].isDeleted = false;
            books[existingIdx].chapters = book.chapters || [];
            addedCount++;
          } else if (sameTextExceptReadings(books[existingIdx].chapters || [], book.chapters || [])) {
            // Refresh readings an older import lost, preserving progress and annotations.
            books[existingIdx].chapters = book.chapters || [];
            addedCount++;
            console.log(`db.addBooks - Lecturas de "${book.title}" actualizadas (mismo texto).`);
          } else {
            console.log(`db.addBooks - Saltando "${book.title}" porque ya existe.`);
          }
          continue;
        }
        const newBook: Book = {
          id: `book-${now}-${i}-${Math.random().toString(36).substr(2, 9)}`,
          title: book.title || 'Libro sin título',
          author: book.author || 'Desconocido',
          cover: book.cover || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          chapters: book.chapters || [],
          progress: {
            currentChapter: 0,
            currentPage: 0,
            percent: 0,
            charactersRead: 0,
            secondsRead: 0
          },
          status: 'unread',
          createdAt: new Date().toISOString()
        };
        books.push(newBook);
        addedCount++;
      }
    
      if (addedCount > 0) {
        console.log("db.addBooks - Guardando libros combinados:", books.map(b => b.title));
        await this._writeBooks(books);
      }
      return books;
    });
  },

  updateBookProgress(bookId: string, currentChapter: number, currentPage: number, percent: number): Promise<Book[]> {
    return serializeBookAccess(async () => {
      const books = await this._readBooks();
      const updatedBooks = books.map(book => {
        if (book.id === bookId) {
          const newStatus = percent >= 99 ? 'completed' : (percent > 0 ? 'reading' : book.status);
          return {
            ...book,
            progress: { 
              ...(book.progress || {}), 
              currentChapter, 
              currentPage, 
              percent 
            },
            status: newStatus as 'unread' | 'reading' | 'completed',
            lastRead: new Date().toISOString()
          };
        }
        return book;
      });
      await this._writeBooks(updatedBooks);
      return updatedBooks;
    });
  },

  incrementReadingStats(bookId: string, charsToAdd: number, secondsToAdd: number): Promise<Book[]> {
    return serializeBookAccess(async () => {
      const books = await this._readBooks();
      const updatedBooks = books.map(book => {
        if (book.id === bookId) {
          const prevProgress = book.progress || {};
          const prevChars = prevProgress.charactersRead || 0;
          const prevSeconds = prevProgress.secondsRead || 0;
          return {
            ...book,
            progress: {
              ...prevProgress,
              charactersRead: prevChars + charsToAdd,
              secondsRead: prevSeconds + secondsToAdd
            },
            lastRead: new Date().toISOString()
          };
        }
        return book;
      });
      await this._writeBooks(updatedBooks);
      return updatedBooks;
    });
  },

  async saveReadingStatsEntry(title: string, charsToAdd: number, secondsToAdd: number, sessionsToAdd = 0): Promise<void> {
    return new Promise((resolve) => {
      const request = indexedDB.open('books', 4);
      request.onupgradeneeded = (e: any) => {
        const dbInstance = e.target.result;
        if (!dbInstance.objectStoreNames.contains('statistic')) {
          const statisticsStore = dbInstance.createObjectStore('statistic', {
            keyPath: ['title', 'dateKey']
          });
          statisticsStore.createIndex('dateKey', 'dateKey');
          statisticsStore.createIndex('completedBook', ['completedBook', 'title']);
        }
      };
      request.onsuccess = (e: any) => {
        const dbInstance = e.target.result;
        if (!dbInstance.objectStoreNames.contains('statistic')) {
          // If version was already >=4 but store didn't exist for some reason, create it by recreating connection (rare fallback)
          dbInstance.close();
          const reqUpgrade = indexedDB.open('books', dbInstance.version + 1);
          reqUpgrade.onupgradeneeded = (ev: any) => {
            const upDb = ev.target.result;
            const statisticsStore = upDb.createObjectStore('statistic', {
              keyPath: ['title', 'dateKey']
            });
            statisticsStore.createIndex('dateKey', 'dateKey');
            statisticsStore.createIndex('completedBook', ['completedBook', 'title']);
          };
          reqUpgrade.onsuccess = (ev: any) => {
            const upDb = ev.target.result;
            const tx = upDb.transaction('statistic', 'readwrite');
            const store = tx.objectStore('statistic');
            const todayStr = new Date().toLocaleDateString('sv').slice(0, 10);
            const req = store.get([title, todayStr]);
            req.onsuccess = () => {
              const record = req.result;
              if (record) {
                record.charactersRead = (record.charactersRead || 0) + charsToAdd;
                record.readingTime = (record.readingTime || 0) + secondsToAdd;
                record.sessionsCount = (record.sessionsCount || 0) + sessionsToAdd;
                record.lastStatisticModified = Date.now();
                store.put(record);
              } else {
                store.put({
                  title,
                  dateKey: todayStr,
                  charactersRead: charsToAdd,
                  readingTime: secondsToAdd,
                  sessionsCount: sessionsToAdd,
                  lastStatisticModified: Date.now()
                });
              }
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
          };
          reqUpgrade.onerror = () => resolve();
          return;
        }

        const tx = dbInstance.transaction('statistic', 'readwrite');
        const store = tx.objectStore('statistic');
        
        const todayStr = new Date().toLocaleDateString('sv').slice(0, 10);
        const req = store.get([title, todayStr]);
        
        req.onsuccess = () => {
          const record = req.result;
          if (record) {
            record.charactersRead = (record.charactersRead || 0) + charsToAdd;
            record.readingTime = (record.readingTime || 0) + secondsToAdd;
            record.sessionsCount = (record.sessionsCount || 0) + sessionsToAdd;
            record.lastStatisticModified = Date.now();
            store.put(record);
          } else {
            store.put({
              title,
              dateKey: todayStr,
              charactersRead: charsToAdd,
              readingTime: secondsToAdd,
              sessionsCount: sessionsToAdd,
              lastStatisticModified: Date.now()
            });
          }
        };
        tx.oncomplete = () => {
          resolve();
        };
        tx.onerror = () => {
          resolve();
        };
      };
      request.onerror = () => {
        resolve();
      };
    });
  },

  async deleteReadingStatsForBook(title: string): Promise<void> {
    return new Promise((resolve) => {
      const request = indexedDB.open('books', 4);
      request.onsuccess = (e: any) => {
        const dbInstance = e.target.result;
        if (!dbInstance.objectStoreNames.contains('statistic')) {
          resolve();
          return;
        }
        const tx = dbInstance.transaction('statistic', 'readwrite');
        const store = tx.objectStore('statistic');
        try {
          const keyRange = IDBKeyRange.bound([title, ''], [title, '\uffff']);
          const req = store.openCursor(keyRange);
          req.onsuccess = (event: any) => {
            const cursor = event.target.result;
            if (cursor) {
              cursor.delete();
              cursor.continue();
            } else {
              resolve();
            }
          };
          req.onerror = () => resolve();
        } catch (err) {
          resolve();
        }
      };
      request.onerror = () => resolve();
    });
  },

  saveBookBookmarks(bookId: string, bookmarks: any[]): Promise<Book[]> {
    return serializeBookAccess(async () => {
      const books = await this._readBooks();
      const updatedBooks = books.map(book => {
        if (book.id === bookId) {
          return {
            ...book,
            bookmarks
          };
        }
        return book;
      });
      await this._writeBooks(updatedBooks);
      return updatedBooks;
    });
  },

  saveBookHighlights(bookId: string, highlights: BookHighlight[]): Promise<Book[]> {
    return serializeBookAccess(async () => {
      const books = await this._readBooks();
      const updatedBooks = books.map(book => (book.id === bookId ? { ...book, highlights } : book));
      await this._writeBooks(updatedBooks);
      return updatedBooks;
    });
  },

  deleteBook(bookId: string): Promise<Book[]> {
    return serializeBookAccess(async () => {
      const books = await this._readBooks();
      const settings = this.getSettings();
      let updatedBooks: Book[];
      if (settings.keepStatsOnDelete !== false) {
        updatedBooks = books.map(b => b.id === bookId ? { ...b, isDeleted: true, chapters: [] } : b);
      } else {
        const book = books.find(b => b.id === bookId);
        if (book && book.title) {
          await this.deleteReadingStatsForBook(book.title);
        }
        updatedBooks = books.filter(b => b.id !== bookId);
      }
      await this._writeBooks(updatedBooks);
      return updatedBooks;
    });
  },

  deleteBooks(bookIds: string[]): Promise<Book[]> {
    return serializeBookAccess(async () => {
      const books = await this._readBooks();
      const settings = this.getSettings();
      let updatedBooks: Book[];
      if (settings.keepStatsOnDelete !== false) {
        updatedBooks = books.map(b => bookIds.includes(b.id) ? { ...b, isDeleted: true, chapters: [] } : b);
      } else {
        const deletedBooks = books.filter(b => bookIds.includes(b.id));
        for (const b of deletedBooks) {
          if (b.title) {
            await this.deleteReadingStatsForBook(b.title);
          }
        }
        updatedBooks = books.filter(b => !bookIds.includes(b.id));
      }
      await this._writeBooks(updatedBooks);
      return updatedBooks;
    });
  },

  clearDeletedBooks(): Promise<Book[]> {
    return serializeBookAccess(async () => {
      const books = await this._readBooks();
      const deletedBooks = books.filter(b => b.isDeleted);
      for (const b of deletedBooks) {
        if (b.title) {
          await this.deleteReadingStatsForBook(b.title);
        }
      }
      const updatedBooks = books.filter(b => !b.isDeleted);
      await this._writeBooks(updatedBooks);
      return updatedBooks;
    });
  },

  updateBookDetails(bookId: string, data: Partial<Book>): Promise<Book[]> {
    return serializeBookAccess(async () => {
      const books = await this._readBooks();
      const updatedBooks = books.map(b => b.id === bookId ? { ...b, ...data, updatedAt: new Date().toISOString() } : b);
      await this._writeBooks(updatedBooks);
      return updatedBooks;
    });
  },

  // --- Word Status Management (Migaku state: 'new' | 'learning' | 'known') ---
  getWordStatuses(): Record<string, string> {
    try {
      const data = localStorage.getItem(this._getKey(STORAGE_KEYS.WORD_STATUS));
      return data ? JSON.parse(data) : {};
    } catch (e) {
      console.error('Error loading word statuses:', e);
      return {};
    }
  },

  saveWordStatuses(statuses: Record<string, string>) {
    try {
      this._stampWordStatusChanges(this.getWordStatuses(), statuses);
      localStorage.setItem(this._getKey(STORAGE_KEYS.WORD_STATUS), JSON.stringify(statuses));
    } catch (e) {
      console.error('Error saving word statuses:', e);
    }
  },

  // When each word's status last changed (or was removed), so cloud sync can merge two devices
  // word by word instead of one side overwriting the other.
  getWordStatusTimes(): Record<string, string> {
    try {
      const data = localStorage.getItem(this._getKey(WORD_STATUS_TIMES_KEY));
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  },

  _stampWordStatusChanges(previous: Record<string, string>, next: Record<string, string>) {
    const now = new Date().toISOString();
    const times = this.getWordStatusTimes();
    let changed = false;
    for (const word of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      if (previous[word] !== next[word]) {
        times[word] = now;
        changed = true;
      }
    }
    if (changed) localStorage.setItem(this._getKey(WORD_STATUS_TIMES_KEY), JSON.stringify(times));
  },

  setWordStatus(word: string, status: string | null) {
    const statuses = this.getWordStatuses();
    if (!status || status === 'unknown') {
      delete statuses[word]; // default is 'unknown' (or 'new' in Migaku term)
      this.saveSrsCard(word, null);
    } else {
      statuses[word] = status; // 'new' (red underline), 'learning' (yellow), 'known' (none)
    }
    this.saveWordStatuses(statuses);
    return statuses;
  },

  cleanVolumeNumber(title: string): string {
    if (!title) return title;
    let cleaned = title.trim();

    // 1. volume indicators: vol. 5, vol 5, volume 5, tomo 5, t. 5, part 5, bk 5, etc.
    cleaned = cleaned.replace(/\s*(?:vol|volume|tomo|t|part|pt|bk|book|巻)\.?\s*([0-9０-９一二三四五六七八九十百]+)\s*$/i, '');

    // 2. Trailing numbers half/full-width (e.g. "冴えない彼女の育てかた 5", "冴えない彼女の育てかた5")
    cleaned = cleaned.replace(/\s*([0-9]+|[０-９]+)\s*$/, '');

    // 3. Trailing kanji numbers (e.g. "冴えない彼女の育てかた 五")
    cleaned = cleaned.replace(/\s*([一二三四五六七八九十]+)\s*$/, '');

    // 4. Trailing Roman numerals (case-insensitive, e.g. "冴えない彼女の育てかた V")
    cleaned = cleaned.replace(/\s+([ivx]+)\s*$/i, '');

    // 5. Brackets/parentheses enclosing numbers (e.g. "(5)", "[5]", "【5】")
    cleaned = cleaned.replace(/\s*(?:\(|\[|【|〈|「|『|《)\s*([0-9０-９一二三四五六七八九十]+)\s*(?:\)|\]|】|〉|」|』|》)\s*$/, '');
    
    // 6. Unicode circled numbers
    cleaned = cleaned.replace(/\s*[①-⑳]\s*$/, '');

    return cleaned.trim() || title;
  },

  // --- SRS Spaced Repetition System Management ---
  getSrsData(): Record<string, any> {
    try {
      const storageKey = this._getKey('yoru_reader_srs_data');
      if (srsDataCache?.storageKey === storageKey) return srsDataCache.data;
      const data = localStorage.getItem(storageKey);
      const srsData = data ? JSON.parse(data) : {};
      
      let updated = false;
      Object.entries(srsData).forEach(([word, card]: [string, any]) => {
        if (word.startsWith('_deck_')) return;
        
        if (card && card.source) {
          const customDeckKey = `_deck_${card.source}`;
          if (!srsData[customDeckKey]) {
            const cleanedSource = this.cleanVolumeNumber(card.source);
            if (cleanedSource !== card.source) {
              card.source = cleanedSource;
              updated = true;
            }
          }
        }
      });
      
      if (updated) {
        this.saveSrsData(srsData);
      } else {
        srsDataCache = { storageKey, data: srsData };
      }
      
      return srsData;
    } catch (e) {
      console.error('Error loading SRS data:', e);
      return {};
    }
  },

  saveSrsData(srsData: Record<string, any>) {
    try {
      const storageKey = this._getKey('yoru_reader_srs_data');
      localStorage.setItem(storageKey, JSON.stringify(srsData));
      srsDataCache = { storageKey, data: srsData };
    } catch (e) {
      console.error('Error saving SRS data:', e);
    }
  },

  getSrsCard(word: string): any {
    const srsData = this.getSrsData();
    const card = srsData[word] || null;
    if (card && card.stability === undefined) {
      // Migrate legacy SM-2 card to FSRS-6 in-memory
      const ease = card.ease ?? 2.5;
      const interval = card.interval ?? 0;
      const reps = card.repetitions ?? 0;
      
      const stability = interval > 0 ? interval : 2.3; // Default Good stability
      const difficulty = Math.max(1, Math.min(10, 5.0 + (2.5 - ease) * 3));
      
      card.stability = stability;
      card.difficulty = difficulty;
      card.elapsed_days = 0;
      card.scheduled_days = interval;
      card.reps = reps;
      card.lapses = card.lapses ?? 0;
      card.state = card.state ?? (reps > 0 ? 2 : 0); // Default to Review if reps > 0
      if (card.dueDate) {
        card.due = new Date(card.dueDate);
      }
      if (card.lastReview) {
        card.last_review = new Date(card.lastReview);
      }
    }
    return card;
  },

  /** Applies one card's save logic onto an in-memory srsData object, without reading/writing storage. */
  _applySrsCardEntry(srsData: Record<string, any>, word: string, cardData: any) {
    if (!cardData) {
      delete srsData[word];
      return;
    }
    const existing = srsData[word] || {};
    // Ensure all fields are JSON serializable and merge with existing data to preserve metadata!
    const serialized = { ...existing, ...cardData };

    // Auto-clean volume numbers if not a custom deck name placeholder
    if (serialized.source && !word.startsWith('_deck_')) {
      const customDeckKey = `_deck_${serialized.source}`;
      if (!srsData[customDeckKey]) {
        serialized.source = this.cleanVolumeNumber(serialized.source);
      }
    }

    if (serialized.due instanceof Date) {
      serialized.dueDate = serialized.due.toISOString();
      serialized.due = serialized.due.toISOString(); // Keep both for compatibility
    }
    if (serialized.last_review instanceof Date) {
      serialized.lastReview = serialized.last_review.toISOString();
      serialized.last_review = serialized.last_review.toISOString();
    }
    // Map FSRS 6 fields to legacy fields for backward compatibility with Library stats
    if (serialized.scheduled_days !== undefined) {
      serialized.interval = serialized.scheduled_days;
    }
    if (serialized.reps !== undefined) {
      serialized.repetitions = serialized.reps;
    }
    if (serialized.difficulty !== undefined) {
      serialized.ease = Math.max(1.3, Math.min(3.0, 3.0 - (serialized.difficulty - 1) * 0.1888));
    }
    srsData[word] = serialized;
  },

  saveSrsCard(word: string, cardData: any) {
    const srsData = this.getSrsData();
    this._applySrsCardEntry(srsData, word, cardData);
    this.saveSrsData(srsData);
  },

  /**
   * Saves many cards in one read-modify-write of the SRS blob, instead of one per card. A bulk
   * import of thousands of cards through saveSrsCard() is O(n^2) - it reads and re-serializes the
   * whole (growing) blob on every single card - which can take long enough to look hung.
   */
  saveSrsCardsBatch(entries: Record<string, any>) {
    const srsData = this.getSrsData();
    for (const word of Object.keys(entries)) {
      this._applySrsCardEntry(srsData, word, entries[word]);
    }
    this.saveSrsData(srsData);
  },

  // --- Export/Import Database for Cloud/Google Drive Sync ---
  async exportFullDatabase(): Promise<any> {
    const profiles = this.getProfiles();
    const activeProfileId = this.getActiveProfileId();
    
    const dbExport: any = {
      version: 2,
      exportDate: new Date().toISOString(),
      activeProfileId,
      profiles,
      profileData: {}
    };

    // Collect data for each profile
    for (const p of profiles) {
      // 1. Books list from IndexedDB
      const booksKey = `books_list_${p.id}`;
      const books = await idb.get(booksKey) || [];
      
      // 2. Settings from localStorage
      const settingsKey = `migaku_reader_settings_${p.id}`;
      const settingsRaw = localStorage.getItem(settingsKey);
      const settings = settingsRaw ? JSON.parse(settingsRaw) : null;
      
      // 3. Word statuses from localStorage
      const statusKey = `migaku_reader_word_status_${p.id}`;
      const statusRaw = localStorage.getItem(statusKey);
      const wordStatuses = statusRaw ? JSON.parse(statusRaw) : null;
      const timesRaw = localStorage.getItem(`${WORD_STATUS_TIMES_KEY}_${p.id}`);
      const wordStatusTimes = timesRaw ? JSON.parse(timesRaw) : null;

      // 4. SRS Data
      const srsKey = `yoru_reader_srs_data_${p.id}`;
      const srsRaw = localStorage.getItem(srsKey);
      const srsData = srsRaw ? JSON.parse(srsRaw) : null;

      dbExport.profileData[p.id] = {
        books,
        settings,
        wordStatuses,
        wordStatusTimes,
        srsData
      };
    }

    return dbExport;
  },

  async importFullDatabase(dbExport: any): Promise<void> {
    if (!dbExport || !dbExport.profiles || !Array.isArray(dbExport.profiles)) {
      throw new Error("Invalid backup format");
    }

    // Save profiles list
    this.saveProfiles(dbExport.profiles);
    
    // Save data for each profile
    for (const p of dbExport.profiles) {
      const pData = dbExport.profileData && dbExport.profileData[p.id];
      if (pData) {
        // 1. Books
        if (pData.books) {
          const booksKey = `books_list_${p.id}`;
          await idb.set(booksKey, pData.books);
        }
        // 2. Settings
        if (pData.settings) {
          const settingsKey = `migaku_reader_settings_${p.id}`;
          localStorage.setItem(settingsKey, JSON.stringify(pData.settings));
        }
        // 3. Word statuses
        if (pData.wordStatuses) {
          const statusKey = `migaku_reader_word_status_${p.id}`;
          localStorage.setItem(statusKey, JSON.stringify(pData.wordStatuses));
        }
        if (pData.wordStatusTimes) {
          localStorage.setItem(`${WORD_STATUS_TIMES_KEY}_${p.id}`, JSON.stringify(pData.wordStatusTimes));
        }
        // 4. SRS data
        if (pData.srsData) {
          const srsKey = `yoru_reader_srs_data_${p.id}`;
          localStorage.setItem(srsKey, JSON.stringify(pData.srsData));
        if (srsDataCache?.storageKey === srsKey) srsDataCache = null;
        }
      }
    }

    // Restore active profile
    if (dbExport.activeProfileId) {
      this.setActiveProfileId(dbExport.activeProfileId);
    }
  },

  getSrsHistory(): any[] {
    try {
      const data = localStorage.getItem(this._getKey('yoru_reader_srs_history'));
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  },

  getSrsDailyReviews(): Record<string, number> {
    try {
      const data = localStorage.getItem(this._getKey('yoru_reader_srs_daily_reviews'));
      return data ? JSON.parse(data) : {};
    } catch (e) {
      return {};
    }
  },

  getSrsDailyReviewStats(): Record<string, { reviews: number; newWords: string[] }> {
    try {
      const data = localStorage.getItem(this._getKey('yoru_reader_srs_daily_review_stats'));
      const parsed = data ? JSON.parse(data) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return parsed;
    } catch (e) {
      return {};
    }
  },

  recordSrsDailyReview(dateStr?: string, details?: { word?: string; isNew?: boolean; reviewState?: number }) {
    try {
      const now = new Date();
      const ymd = dateStr || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const daily = this.getSrsDailyReviews();
      const dailyStats = this.getSrsDailyReviewStats();

      // Seed the structured counters from retained history once, then keep
      // them independent of the 500-entry history display limit.
      if (!dailyStats[ymd] || typeof dailyStats[ymd] !== 'object' || Array.isArray(dailyStats[ymd])) {
        const legacyToday = this.getSrsHistory().filter((entry: any) => {
          if (!entry?.timestamp) return false;
          const date = new Date(entry.timestamp);
          return Number.isFinite(date.getTime())
            && `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` === ymd;
        });
        dailyStats[ymd] = {
          reviews: legacyToday.filter((entry: any) => entry.reviewState !== undefined
            ? entry.reviewState === 2
            : !entry.isNew).length,
          newWords: Array.from(new Set(legacyToday
            .filter((entry: any) => entry.isNew && entry.word)
            .map((entry: any) => String(entry.word))))
        };
      }

      dailyStats[ymd].reviews = Math.max(0, Number(dailyStats[ymd].reviews) || 0);
      if (!Array.isArray(dailyStats[ymd].newWords)) dailyStats[ymd].newWords = [];
      daily[ymd] = (Number(daily[ymd]) || 0) + 1;
      if (details?.isNew && details.word) {
        dailyStats[ymd].newWords = Array.from(new Set([...(dailyStats[ymd].newWords || []), details.word]));
      } else if (details?.reviewState === 2) {
        dailyStats[ymd].reviews = Math.max(0, Number(dailyStats[ymd].reviews) || 0) + 1;
      }
      localStorage.setItem(this._getKey('yoru_reader_srs_daily_reviews'), JSON.stringify(daily));
      localStorage.setItem(this._getKey('yoru_reader_srs_daily_review_stats'), JSON.stringify(dailyStats));
    } catch (e) {
      console.error('Error recording SRS daily review:', e);
    }
  },

  addSrsHistory(word: string, grade: number, interval: number, deckName: string, isNew = false, reviewState?: number) {
    try {
      const history = this.getSrsHistory();
      const entry = {
        word,
        grade,
        interval,
        deckName,
        isNew,
        reviewState,
        timestamp: new Date().toISOString()
      };
      this.recordSrsDailyReview(undefined, { word, isNew, reviewState });
      history.unshift(entry); // Add to the top
      if (history.length > 500) {
        history.length = 500;
      }
      localStorage.setItem(this._getKey('yoru_reader_srs_history'), JSON.stringify(history));
    } catch (e) {
      console.error('Error saving SRS history:', e);
    }
  },

  restoreSrsHistoryState(history: any[], dailyReviews: Record<string, number>, dailyReviewStats?: Record<string, { reviews: number; newWords: string[] }>) {
    try {
      localStorage.setItem(this._getKey('yoru_reader_srs_history'), JSON.stringify(history));
      localStorage.setItem(this._getKey('yoru_reader_srs_daily_reviews'), JSON.stringify(dailyReviews));
      if (dailyReviewStats) {
        localStorage.setItem(this._getKey('yoru_reader_srs_daily_review_stats'), JSON.stringify(dailyReviewStats));
      } else {
        localStorage.removeItem(this._getKey('yoru_reader_srs_daily_review_stats'));
      }
    } catch (e) {
      console.error('Error restoring SRS history:', e);
    }
  },

  clearSrsHistory() {
    try {
      localStorage.removeItem(this._getKey('yoru_reader_srs_history'));
      localStorage.removeItem(this._getKey('yoru_reader_srs_daily_reviews'));
      localStorage.removeItem(this._getKey('yoru_reader_srs_daily_review_stats'));
    } catch (e) {
      console.error('Error clearing SRS history:', e);
    }
  },

  // The two most recent copies of this device's data taken right before a cloud sync changed it.
  async saveSyncBackup(dbExport: any): Promise<void> {
    const key = 'yoru_sync_backups_v1';
    const previous = (await idb.get(key)) || [];
    await idb.set(key, [{ savedAt: new Date().toISOString(), data: dbExport }, ...previous].slice(0, 2));
  },

  async getSyncBackups(): Promise<{ savedAt: string; data: any }[]> {
    return (await idb.get('yoru_sync_backups_v1')) || [];
  },

  async idbGet(key: string): Promise<any> {
    return await idb.get(key);
  },

  async idbSet(key: string, value: any): Promise<void> {
    return await idb.set(key, value);
  }
};

export default db;
