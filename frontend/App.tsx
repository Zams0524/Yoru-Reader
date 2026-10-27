import React, { useState, useEffect, useCallback, useRef } from 'react';
import DictionaryInstallToast from './components/DictionaryInstallToast';
import { Capacitor } from '@capacitor/core';
import { isPhoneUI } from './utils/platform';
const Library = React.lazy(() => import('./components/Library'));
const WelcomeScreen = React.lazy(() => import('./components/WelcomeScreen'));
const Reader = React.lazy(() => import('./components/Reader'));
const SettingsModal = React.lazy(() => import('./components/SettingsModal'));
import { db } from './utils/db';
import { ankiConnectRequest } from './utils/ankiConnect';
import { flushJitenQueue, syncJitenWordStatus } from './utils/jitenSync';
import { queueKavitaProgress } from './utils/kavitaService';
import { useConfirm } from './components/ConfirmModal';
import stableManifest from '../stable.json';
import { YoruNotifications, configureUpdateNotices, hasYoruNotifications, refreshSrsReminders, type LaunchAction } from './utils/yoruNotifications';

const isNewerAppVersion = (remoteVersion: string, localVersion: string) => {
  if (!remoteVersion || !localVersion) return false;
  const remote = remoteVersion.replace(/^v/, '').split('.').map(part => Number.parseInt(part, 10) || 0);
  const local = localVersion.replace(/^v/, '').split('.').map(part => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(remote.length, local.length); index += 1) {
    const difference = (remote[index] || 0) - (local[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
};

declare global {
  interface Window {
    __yoruTheme: string;
    electronAPI: any;
  }
}

interface BookVocabCache {
  uniqueWords: Set<string>;
  sentenceWordSets: Set<string>[];
}

/**
 * Resolves once the reader shows the book's first page ('yoru-reader-opened'), or after timeoutMs.
 * Analysing the whole book for its vocabulary stats competes with opening it (Kuromoji on the main
 * thread), so it waits for this.
 */
function afterReaderOpened(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener('yoru-reader-opened', done);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, timeoutMs);
    window.addEventListener('yoru-reader-opened', done);
  });
}

async function buildBookVocabCache(book: any): Promise<BookVocabCache> {
  const { tokenizeText } = await import('./utils/japanese');
  const uniqueWords = new Set<string>();
  const sentenceWordSets: Set<string>[] = [];
  let currentSentenceWords = new Set<string>();

  const finishSentence = () => {
    if (currentSentenceWords.size > 0) sentenceWordSets.push(currentSentenceWords);
    currentSentenceWords = new Set<string>();
  };

  for (const chapter of book.chapters || []) {
    const lines = (chapter.content || '').split(/\r?\n/);
    for (let start = 0; start < lines.length; start += 32) {
      const paragraphBatch = lines.slice(start, start + 32).join('\n');
      const paragraphs = await tokenizeText(paragraphBatch);

      for (const paragraph of paragraphs) {
        for (const token of paragraph) {
          if (token?.isWord && token.basicForm) {
            uniqueWords.add(token.basicForm);
            currentSentenceWords.add(token.basicForm);
          }
          if (token?.isLineBreak || ['。', '！', '？'].includes(token?.surface || '')) {
            finishSentence();
          }
        }
      }

      // Let touch input, navigation and drawing continue between batches.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }

  finishSentence();
  return { uniqueWords, sentenceWordSets };
}


export default function App() {
  const [profiles, setProfiles] = useState<any[]>(db.getProfiles());
  const [activeProfileId, setActiveProfileId] = useState<string | null>(db.getActiveProfileId());
  
  const [books, setBooks] = useState<any[]>([]);
  const [activeBook, setActiveBook] = useState<any | null>(null);
  const [wordStatuses, setWordStatuses] = useState<Record<string, string>>({});
  // The reader's code loads while the library sits idle, so opening the first book does not wait
  // for it ("Loading reader..." before the book's own loading screen).
  useEffect(() => {
    const preload = () => { void import('./components/Reader').catch(() => {}); };
    const idle = (window as any).requestIdleCallback as ((cb: () => void, opts?: { timeout: number }) => number) | undefined;
    if (idle) {
      const handle = idle(preload, { timeout: 4000 });
      return () => (window as any).cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(preload, 2500);
    return () => window.clearTimeout(timer);
  }, []);
  const [libraryTab, setLibraryTab] = useState('library');
  const [settings, setSettings] = useState<any>(() => {
    const s = db.getSettings();
    window.__yoruTheme = s.theme || 'dark';
    return s;
  });
  const lang = settings.appLanguage || 'en';
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [infoBook, setInfoBook] = useState<any | null>(null);
  const [showHotUpdateBanner, setShowHotUpdateBanner] = useState(false);
  const [hotUpdateVersion, setHotUpdateVersion] = useState('');
  // 'ota' | 'installer' when backend/updater.cjs has an update downloaded; null for the legacy OTA banner.
  const [readyUpdateKind, setReadyUpdateKind] = useState<string | null>(null);

  const { showConfirm, confirmModal } = useConfirm();

  // Android notifications. The SRS reminder is worked out again when the app opens, when it is
  // left (after reviewing) and shortly after settings change; update notices follow the settings.
  const [libraryNav, setLibraryNav] = useState<{ tab: string; section?: string; nonce: number } | null>(null);
  const notificationSettingsRef = useRef(settings);
  notificationSettingsRef.current = settings;
  useEffect(() => {
    if (!hasYoruNotifications()) return;
    void configureUpdateNotices(settings);
    const timer = window.setTimeout(() => { void refreshSrsReminders(notificationSettingsRef.current); }, 2000);
    return () => window.clearTimeout(timer);
  }, [settings]);
  useEffect(() => {
    if (!hasYoruNotifications()) return;
    const onVisibility = () => { void refreshSrsReminders(notificationSettingsRef.current); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  // A tapped notification opens the SRS or the updates section.
  useEffect(() => {
    if (!hasYoruNotifications()) return;
    const go = (action: LaunchAction | null) => {
      if (action !== 'srs' && action !== 'updates') return;
      const target = action === 'srs' ? { tab: 'srs' } : { tab: 'settings', section: 'sec-updates' };
      setActiveBook(null);
      setLibraryTab(target.tab);
      setLibraryNav({ ...target, nonce: Date.now() });
    };
    void YoruNotifications.getLaunchAction().then(({ action }) => go(action)).catch(() => {});
    const listener = YoruNotifications.addListener('launchAction', ({ action }) => go(action));
    return () => { void listener.then((handle) => handle.remove()); };
  }, []);

  const uniqueWordsCacheRef = useRef<Record<string, BookVocabCache>>({});
  const vocabCacheInFlightRef = useRef(new Set<string>());
  const [vocabCacheRevision, setVocabCacheRevision] = useState(0);

  // Desktop updates. backend/updater.cjs checks stable.json, downloads the installer or the
  // OTA bundle in the background when automatic updates are on, and installs a downloaded
  // installer when the app quits. Older native builds without it use the legacy IPC below.
  useEffect(() => {
    const updater = window.electronAPI?.updater;
    if (updater) {
      updater.setAutoInstallOnQuit(Boolean(settings.autoUpdate)).catch(() => {});
      const showReady = (state: any) => {
        if (state?.status !== 'ready') return;
        setHotUpdateVersion(state.kind === 'ota' ? state.latest?.hotVersion : state.latest?.appVersion);
        setReadyUpdateKind(state.kind);
        setShowHotUpdateBanner(true);
      };
      const off = updater.onState(showReady);
      updater.getState().then(showReady).catch(() => {});
      const timer = setTimeout(() => {
        updater.check({ autoDownload: Boolean(settings.autoUpdate) }).catch(() => {});
      }, 3500);
      return () => { clearTimeout(timer); off(); };
    }

    const isDev = window.location.href.toLowerCase().includes('dev') ||
                  document.title.toLowerCase().includes('dev') ||
                  (typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('dev'));
    if (isDev) return;

    if (window.electronAPI && window.electronAPI.checkHotUpdate) {
      const timer = setTimeout(async () => {
        try {
          if (settings.autoUpdate && window.electronAPI.downloadAndInstallUpdate && /win/i.test(`${navigator.platform} ${navigator.userAgent}`)) {
            const stableUrls = [
              'https://raw.githubusercontent.com/Zams0524/Yoru-Reader/main/stable.json',
              'https://raw.githubusercontent.com/Zams0524/Yoru-Reader/master/stable.json'
            ];
            for (const url of stableUrls) {
              try {
                const response = await fetch(url, { cache: 'no-store' });
                if (!response.ok) continue;
                const remote = await response.json();
                if (isNewerAppVersion(remote.appVersion, stableManifest.appVersion)) {
                  const installerUrl = remote.windowsUrl || remote.url;
                  if (installerUrl) {
                    await window.electronAPI.downloadAndInstallUpdate(installerUrl);
                    return;
                  }
                }
                break;
              } catch (_) {
                // Try the fallback manifest URL if the primary request fails.
              }
            }
          }

          const res = await window.electronAPI.checkHotUpdate();
          if (res && res.updated) {
            setHotUpdateVersion(res.version);
            setShowHotUpdateBanner(true);
          }
        } catch (e) {
          console.warn('[OTA] Startup check skipped:', e);
        }
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [settings.autoUpdate]);

  // Run background database maintenance tasks exactly once on app startup
  useEffect(() => {
    const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
    let unsubscribeQuery: any = null;
    let unsubscribeSave: any = null;
    let unsubscribeParse: any = null;
    let unsubscribeUpdateStatus: any = null;

    if (window.electronAPI) {
      if (window.electronAPI.onQueryWordStatuses) {
        unsubscribeQuery = window.electronAPI.onQueryWordStatuses((words: string[]) => {
          const statuses = db.getWordStatuses();
          const result: Record<string, string> = {};
          words.forEach(w => {
            result[w] = statuses[w] || 'unknown';
          });
          window.electronAPI.replyQueryWordStatuses(result);
        });
      }

      if (window.electronAPI.onSaveWordToSrs) {
        unsubscribeSave = window.electronAPI.onSaveWordToSrs((wordData: any) => {
          console.log('[Yoru] Mining word from extension locally:', wordData);
          db.setWordStatus(wordData.word, 'learning');
          
          const existingCard = db.getSrsCard(wordData.word);
          if (!existingCard) {
            const newCard = {
              word: wordData.word,
              reading: wordData.reading || '',
              sentence: wordData.sentence || '',
              source: wordData.source || 'Yoru Reader Extension',
              interval: 1,
              ease: 2.5,
              repetitions: 0,
              dueDate: new Date().toISOString()
            };
            db.saveSrsCard(wordData.word, newCard);
            console.log('[Yoru] Saved mined card to local SRS:', newCard);
          }
          
          setWordStatuses(db.getWordStatuses());
          window.electronAPI.replySaveWordToSrs();
        });
      }

      if (window.electronAPI.onUpdateWordStatus) {
        unsubscribeUpdateStatus = window.electronAPI.onUpdateWordStatus((data: any) => {
          const { word, state } = data;
          console.log('[Yoru] Updating word status from extension:', word, state);
          
          let newStatus = 'new';
          if (state === 'learning-add') {
            newStatus = 'learning';
            const existingCard = db.getSrsCard(word);
            if (!existingCard) {
              const now = new Date();
              const newCard = {
                word: word,
                reading: '',
                sentence: '',
                source: 'Yoru Reader Extension',
                interval: 1,
                ease: 2.5,
                repetitions: 0,
                dueDate: now.toISOString(),
                lastReview: now.toISOString(),
                lapses: 0,
                state: 0
              };
              db.saveSrsCard(word, newCard);
            }
          } else if (state === 'known-add') {
            newStatus = 'known';
            db.saveSrsCard(word, null);
          } else if (state === 'ignored-add') {
            newStatus = 'ignored';
            db.saveSrsCard(word, null);
          } else {
            newStatus = 'new';
            db.saveSrsCard(word, null);
          }
          
          db.setWordStatus(word, newStatus);
          setWordStatuses(db.getWordStatuses());
          
          window.electronAPI.replyUpdateWordStatus();
        });
      }

      if (window.electronAPI.onParseTextRequest) {
        unsubscribeParse = window.electronAPI.onParseTextRequest(async ({ requestId, paragraphs }: { requestId: string; paragraphs: string[] }) => {
          try {
            console.log('[Yoru] Parsing text request from extension. Request ID:', requestId);
            const statuses = db.getWordStatuses();
            const { parseExtensionText } = await import('./utils/japanese');
            const result = await parseExtensionText(paragraphs, statuses);
            window.electronAPI.replyParseText({ requestId, result });
          } catch (err: any) {
            console.error('[Yoru] Failed to parse extension text:', err);
            window.electronAPI.replyParseText({ requestId, error: err.message });
          }
        });
      }
    }

    const runMaintenance = async () => {
      try {
        console.log("[App] Running background yomitan database maintenance...");
        const {
          migrateEnglishDictName,
          upgradeTruncatedEnglishJmdict,
          migrateDictFlags,
          cleanOrphanedEntries,
          ensureDefaultDictionaries
        } = await import('./utils/yomitanDB');
        await migrateEnglishDictName();
        await upgradeTruncatedEnglishJmdict();
        await migrateDictFlags();
        // This full-store sweep can walk millions of dictionary rows. Android
        // manages dictionary records through explicit install/delete actions,
        // so avoid doing that expensive cleanup every time the app opens.
        if (!isAndroid) await cleanOrphanedEntries();
        console.log("[App] Yomitan database maintenance completed.");
        
        // Install the bundled lookup and pitch data on first launch. Existing
        // dictionaries and explicit disabled-dictionary preferences are kept.
        try {
          // First run: the welcome guide installs them once the language is chosen.
          if (db.getProfiles().length > 0 && localStorage.getItem('yoru_bundled_dictionary_setup_v1') !== 'done') {
            await ensureDefaultDictionaries(lang === 'es' ? 'es' : 'en');
            localStorage.setItem('yoru_bundled_dictionary_setup_v1', 'done');
          }
        } catch (importErr) {
          console.warn('[App] Bundled dictionary setup failed:', importErr);
        }
      } catch (err) {
        console.warn("[App] Background maintenance failed:", err);
      }
    };
    // Android WebView has a much tighter memory budget than desktop. Importing
    // JMdict/pitch archives a few seconds after launch can terminate the whole
    // process before Android can show a useful JS error. Mobile dictionaries
    // remain available through the explicit dictionary manager; do not perform
    // archive installs or full database migrations during app startup.
    const maintenanceTimer = isAndroid
      ? null
      : window.setTimeout(() => void runMaintenance(), 250);

    return () => {
      if (maintenanceTimer !== null) window.clearTimeout(maintenanceTimer);
      if (unsubscribeQuery) unsubscribeQuery();
      if (unsubscribeSave) unsubscribeSave();
      if (unsubscribeParse) unsubscribeParse();
      if (unsubscribeUpdateStatus) unsubscribeUpdateStatus();
    };
  }, []);

  // Calculate vocab stats ONLY for the currently active book being read
  useEffect(() => {
    if (!activeBook) return;

    let active = true;
    
    const calculateVocabStats = (uniqueWords: Set<string>, sentenceWordSets: Set<string>[], statuses: Record<string, string>) => {
      let knownWordsCount = 0;
      let ignoredWordsCount = 0;
      uniqueWords.forEach(word => {
        const s = statuses[word];
        if (s === 'known' || s === 'starred') {
          knownWordsCount++;
        } else if (s === 'ignored') {
          ignoredWordsCount++;
        }
      });
      const unknownWordsCount = uniqueWords.size - knownWordsCount - ignoredWordsCount;
      const coverage = uniqueWords.size > 0 ? Math.round((knownWordsCount / uniqueWords.size) * 100) : 0;

      let knownSentencesCount = 0;
      let oneUnknownSentencesCount = 0;
      let multipleUnknownSentencesCount = 0;

      sentenceWordSets.forEach(sentenceWords => {
        let unknownInSentence = 0;
        sentenceWords.forEach(w => {
          const s = statuses[w];
          const isKnown = s === 'known' || s === 'starred';
          const isIgnored = s === 'ignored';
          if (!isKnown && !isIgnored) {
            unknownInSentence++;
          }
        });

        if (unknownInSentence === 0) {
          knownSentencesCount++;
        } else if (unknownInSentence === 1) {
          oneUnknownSentencesCount++;
        } else {
          multipleUnknownSentencesCount++;
        }
      });

      const totalSentences = sentenceWordSets.length || 1;

      return {
        coverage,
        knownWords: knownWordsCount,
        unknownWords: unknownWordsCount,
        ignoredWords: ignoredWordsCount,
        uniqueWordsTotal: uniqueWords.size,
        recommendedSentences: oneUnknownSentencesCount,
        sentencesKnownPct: Math.round((knownSentencesCount / totalSentences) * 100),
        sentences1TPct: Math.round((oneUnknownSentencesCount / totalSentences) * 100),
        sentencesMTPct: Math.round((multipleUnknownSentencesCount / totalSentences) * 100)
      };
    };

    const updateActiveBookStats = async () => {
      try {
        const bookId = activeBook.id;
        let cached = uniqueWordsCacheRef.current[bookId];
        if (!cached) {
          if (!vocabCacheInFlightRef.current.has(bookId)) {
            vocabCacheInFlightRef.current.add(bookId);
            void afterReaderOpened(5000)
              .then(() => new Promise((resolve) => window.setTimeout(resolve, 1500)))
              .then(() => buildBookVocabCache(activeBook))
              .then((bookCache) => {
                uniqueWordsCacheRef.current[bookId] = bookCache;
                setVocabCacheRevision((revision) => revision + 1);
              })
              .catch((err) => {
                console.error('Error calculating active book vocabulary:', err);
              })
              .finally(() => {
                vocabCacheInFlightRef.current.delete(bookId);
              });
          }
          return;
        }

        const stats = calculateVocabStats(cached.uniqueWords, cached.sentenceWordSets, wordStatuses);
        const hasChanged = activeBook.vocabularyCoverage !== stats.coverage ||
                           JSON.stringify(activeBook.vocabStats || {}) !== JSON.stringify(stats);

        if (hasChanged && active) {
          const updatedBooks = await db.updateBookDetails(activeBook.id, {
            vocabularyCoverage: stats.coverage,
            vocabStats: stats
          });
          setBooks(updatedBooks);
          setActiveBook((prev: any) => {
            if (prev && prev.id === activeBook.id) {
              return {
                ...prev,
                vocabularyCoverage: stats.coverage,
                vocabStats: stats
              };
            }
            return prev;
          });
        }
      } catch (err) {
        console.error("Error updating active book stats:", err);
      }
    };

    updateActiveBookStats();

    return () => {
      active = false;
    };
  }, [activeBook?.id, wordStatuses, vocabCacheRevision]);

  // 1. Initialize and reload data when active profile changes
  useEffect(() => {
    let isCurrentProfile = true;
    setBooks([]);
    db.getBooks().then(loadedBooks => {
      if (isCurrentProfile) setBooks(loadedBooks);
    }).catch(error => {
      console.error('[App] Failed to load the library:', error);
      if (isCurrentProfile) setBooks([]);
    });

    const loadedStatuses = db.getWordStatuses();

    // Sentence-key cleanup can require loading Kuromoji and tokenizing thousands
    // of legacy entries. Keep Android startup responsive and avoid an OOM on
    // phones; the original statuses remain available and are not discarded.
    if (Capacitor.getPlatform() === 'android') {
      setWordStatuses(loadedStatuses);
      setSettings(db.getSettings());
      return () => { isCurrentProfile = false; };
    }

    const runMigration = async () => {
        const cleanWord = (val: string) => {
          if (!val) return '';
          let s = val.replace(/<[^>]*>/g, '');
          s = s.replace(/\[[^\]]*\]/g, '')
               .replace(/\([^)]*\)/g, '')
               .replace(/（[^）]*）/g, '')
               .replace(/\{[^}]*\}/g, '');
          const parts = s.split(/[\s\-ー:：|]/);
          s = parts[0] || '';
          return s.trim();
        };

        const sanitizedStatuses: Record<string, string> = {};
        let needsMigration = false;

        for (const [key, val] of Object.entries(loadedStatuses)) {
          const cleanKey = cleanWord(key);
          if (!cleanKey) continue;

          const isSentence = cleanKey.length > 5 || 
                             cleanKey.includes('。') || 
                             cleanKey.includes('、') || 
                             cleanKey.includes('？') || 
                             cleanKey.includes('！') ||
                             /[\u3040-\u309F]/.test(cleanKey) && (cleanKey.includes('は') || cleanKey.includes('が') || cleanKey.includes('を') || cleanKey.includes('に') || cleanKey.includes('で'));

          if (isSentence && cleanKey.length > 3) {
            needsMigration = true;
            try {
              const { tokenizeText } = await import('./utils/japanese');
              const paragraphs = await tokenizeText(cleanKey);
              const tokens = paragraphs.flat();
              tokens.forEach(tok => {
                if (tok && tok.isWord && tok.basicForm) {
                  const subClean = cleanWord(tok.basicForm);
                  if (subClean && subClean.length > 0) {
                    const existing = sanitizedStatuses[subClean];
                    if (!existing || val === 'known' || val === 'starred') {
                      sanitizedStatuses[subClean] = val;
                    }
                  }
                }
              });
            } catch (e) {
              console.error("Migration failed to tokenize sentence key:", cleanKey, e);
              sanitizedStatuses[cleanKey] = val;
            }
          } else {
            const existing = sanitizedStatuses[cleanKey];
            if (!existing || val === 'known' || val === 'starred') {
              sanitizedStatuses[cleanKey] = val;
            }
            if (cleanKey !== key) {
              needsMigration = true;
            }
          }
        }

        if (!isCurrentProfile) return;
        if (needsMigration) {
          db.saveWordStatuses(sanitizedStatuses);
        }
        setWordStatuses(sanitizedStatuses);
    };

    runMigration();

    setSettings(db.getSettings());
    return () => { isCurrentProfile = false; };
  }, [activeProfileId]);

  useEffect(() => {
    if (activeBook) {
      document.body.classList.add('reader-active');
    } else {
      document.body.classList.remove('reader-active');
    }
    return () => {
      document.body.classList.remove('reader-active');
    };
  }, [activeBook]);

  const handleSelectBook = async (book: any) => {
    // Start of an open, for the timing line the native reader logs.
    (window as { __yoruOpenRequestedAt?: number }).__yoruOpenRequestedAt = performance.now();
    setActiveBook(book);
    await db.updateBookDetails(book.id, { lastRead: new Date().toISOString() });
    const loadedBooks = await db.getBooks();
    setBooks(loadedBooks);
  };

  const handleUpdateProgress = useCallback(async (bookId: string, currentChapter: number, currentPage: number, percent: number) => {
    const updatedBooks = await db.updateBookProgress(bookId, currentChapter, currentPage, percent);
    setBooks(updatedBooks);
    // Books imported from Kavita send their progress back to the server.
    const title = updatedBooks.find(b => b.id === bookId)?.title;
    if (title) queueKavitaProgress(title, percent);
  }, []);

  const handleIncrementReadingStats = useCallback(async (bookId: string, chars: number, seconds: number) => {
    const updatedBooks = await db.incrementReadingStats(bookId, chars, seconds);
    setBooks(updatedBooks);
  }, []);

  const handleSaveReadingStats = useCallback((title: string, chars: number, seconds: number, sessions = 0) => {
    return db.saveReadingStatsEntry(title, chars, seconds, sessions);
  }, []);

  const handleAddBooks = async (booksData: any[]) => {
    const updatedBooks = await db.addBooks(booksData);
    setBooks(updatedBooks);
  };

  const handleDeleteBook = async (bookId: string) => {
    const updatedBooks = await db.deleteBook(bookId);
    setBooks(updatedBooks);
    if (activeBook && activeBook.id === bookId) {
      setActiveBook(null);
    }
  };

  const handleBulkDeleteBooks = async (bookIds: string[]) => {
    const updatedBooks = await db.deleteBooks(bookIds);
    setBooks(updatedBooks);
    if (activeBook && bookIds.includes(activeBook.id)) {
      setActiveBook(null);
    }
  };

  const handleClearDeletedBooks = async () => {
    const updatedBooks = await db.clearDeletedBooks();
    setBooks(updatedBooks);
  };

  const handleUpdateBookDetails = async (bookId: string, data: any) => {
    const updatedBooks = await db.updateBookDetails(bookId, data);
    setBooks(updatedBooks);
    if (activeBook && activeBook.id === bookId) {
      setActiveBook({ ...activeBook, ...data });
    }
  };

  // Send Jiten anything queued while offline or before the app was closed.
  useEffect(() => {
    void flushJitenQueue();
    const flush = () => { void flushJitenQueue(); };
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, []);

  const handleSetWordStatus = async (word: string, status: string, wordData: any = null) => {
    syncJitenWordStatus(word, wordData?.reading || '', status, wordStatuses[word]);
    const updatedStatuses = db.setWordStatus(word, status);
    setWordStatuses(updatedStatuses);

    if (status === 'learning') {
      const existingCard = db.getSrsCard(word);
      if (!existingCard) {
        db.saveSrsCard(word, {
          word,
          reading: wordData?.reading || '',
          sentence: wordData?.sentence || '',
          source: wordData?.source || activeBook?.title || 'Yoru Reader',
          state: 0, // New
          dueDate: new Date().toISOString(), // Due immediately
          due: new Date().toISOString()
        });
      } else {
        if (wordData?.source) {
          existingCard.source = wordData.source;
          db.saveSrsCard(word, existingCard);
        }
      }
    }

    // Syncing the mark to Anki goes through AnkiConnect, which a phone can't reach.
    if (status !== 'known' || isPhoneUI()) return;

    const savedAnki = localStorage.getItem('anki_settings_v2');
    if (!savedAnki) return;

    let ankiOpts: any;
    try { ankiOpts = JSON.parse(savedAnki); } catch { return; }
    if (!ankiOpts.enabled) return;

    const host = ankiOpts.host || 'http://127.0.0.1:8765';
    const deck = ankiOpts.expression?.deck || 'sentence mining';
    const noteType = ankiOpts.expression?.noteType || 'Lapis';
    const fields = ankiOpts.expression?.fields || {};
    const wordField = ankiOpts.importWordField || Object.keys(fields).find(k => fields[k] === '{expression}') || 'Expression';

    const ankiFetch = async <T = unknown,>(action: string, params: any) => {
      try {
        return await ankiConnectRequest<T>(host, {
          action,
          version: 6,
          params,
          ...(ankiOpts.apiKey ? { key: ankiOpts.apiKey } : {})
        });
      } catch (error) {
        console.warn(`[Yoru] AnkiConnect ${action} failed:`, error);
        return null;
      }
    };

    const COMMON_WORD_FIELDS = [
      wordField,
      'Expression',
      'Vocabulary-Kanji',
      'VocabKanji',
      'Vocabulary',
      'Word',
      'Kanji',
      'Front',
      '表現',
      'Japanese',
      'Vocab',
      'Reading',
    ];
    const fieldsToTry = [...new Set(COMMON_WORD_FIELDS)];

    let noteIds = null;
    for (const field of fieldsToTry) {
      const q = `"${field}:${word}"`;
      const r = await ankiFetch<number[]>('findNotes', { query: q });
      if (r?.result && r.result.length > 0) {
        noteIds = r.result;
        console.log(`[Yoru] Found ${noteIds.length} note(s) for "${word}" in field "${field}"`);
        break;
      }
    }

    const matureCards = async (cIds: number[]) => {
      if (!cIds || cIds.length === 0) return;
      await ankiFetch('setEaseFactors', { cardIds: cIds, easeFactors: cIds.map(() => 2500) });
      const today = Math.floor(Date.now() / 86400000);
      await ankiFetch('setSpecificCardInfo', { cards: cIds.map(id => ({ id, interval: 30, ease: 2500, lapses: 0, reviews: 1 })) });
      console.log(`[Yoru] Matured ${cIds.length} card(s) for word: "${word}"`);
    };

    if (noteIds && noteIds.length > 0) {
      const cardsResult = await ankiFetch<Array<{ cards?: number[] }>>('notesInfo', { notes: noteIds });
      const cardIds = (cardsResult?.result || []).flatMap((n: any) => n.cards || []);
      await matureCards(cardIds);
    } else {
      const noteFields: Record<string, string> = {};
      const reading = wordData?.reading || word;
      const meaning = wordData?.meaning || '';

      for (const [fieldName, tmpl] of Object.entries(fields)) {
        if (!tmpl) { noteFields[fieldName] = ''; continue; }
        noteFields[fieldName] = (tmpl as string)
          .replaceAll('{expression}', word)
          .replaceAll('{furigana}', reading)
          .replaceAll('{reading}', reading)
          .replaceAll('{meaning}', meaning)
          .replaceAll('{glossary}', meaning)
          .replaceAll('{glossary-brief}', meaning)
          .replaceAll('{glossary-first}', meaning)
          .replaceAll('{bilingual}', meaning)
          .replaceAll('{audio}', '')
          .replaceAll('{screenshot}', '')
          .replaceAll('{sentence}', '')
          .replaceAll('{sentence-furigana}', '')
          .replaceAll('{sentence-audio}', '')
          .replaceAll('{sentence-cloze}', '')
          .replaceAll(/\{[^}]+\}/g, '');
      }

      if (Object.keys(noteFields).length === 0) {
        noteFields[wordField] = word;
      }

      const rawTags = ankiOpts.tags || 'yoru_reader';
      const tagsList = rawTags.split(/[\s,]+/).filter((t: string) => t.trim());
      if (!tagsList.includes('yoru_reader')) tagsList.push('yoru_reader');
      if (!tagsList.includes('auto_known')) tagsList.push('auto_known');

      const addResult = await ankiFetch<number | null>('addNote', {
        note: {
          deckName: deck,
          modelName: noteType,
          fields: noteFields,
          options: { allowDuplicate: false, duplicateScope: 'deck' },
          tags: tagsList
        }
      });

      if (addResult?.result) {
        const newNoteInfo = await ankiFetch<Array<{ cards?: number[] }>>('notesInfo', { notes: [addResult.result] });
        const newCardIds = (newNoteInfo?.result || []).flatMap((n: any) => n.cards || []);
        await matureCards(newCardIds);
        console.log(`[Yoru] Created + matured card for word: "${word}"`);
      } else {
        console.warn('[Yoru] Could not create Anki card for:', word, addResult?.error);
      }
    }
  };

  const handleSaveSettings = (newSettings: any) => {
    db.saveSettings(newSettings);
    setSettings(newSettings);
    void import('./utils/yomitanDB')
      .then(({ clearYomitanCache }) => clearYomitanCache())
      .catch(error => console.warn('[App] Could not clear dictionary cache:', error));
  };

  const handleSelectProfile = (profileId: string) => {
    setBooks([]);
    db.setActiveProfileId(profileId);
    setActiveProfileId(profileId);
  };

  const handleAddProfile = (newProfile: any) => {
    setBooks([]);
    const currentSettings = db.getSettings();
    const updatedProfiles = [...profiles, newProfile];
    db.saveProfiles(updatedProfiles);
    setProfiles(updatedProfiles);
    
    db.setActiveProfileId(newProfile.id);
    db.saveSettings(currentSettings);
    setActiveProfileId(newProfile.id);
  };

  const handleDeleteProfile = async (profileId: string) => {
    if (profiles.length <= 1) {
      await showConfirm({
        title: lang === 'es' ? 'Acción no permitida' : 'Action not allowed',
        message: lang === 'es' ? 'No puedes eliminar el único perfil.' : 'You cannot delete the only profile.',
        type: 'warning',
        confirmText: lang === 'es' ? 'Entendido' : 'OK',
        cancelText: '',
      });
      return;
    }
    const ok = await showConfirm({
      title: lang === 'es' ? '¿Eliminar perfil?' : 'Delete profile?',
      message: lang === 'es'
        ? '¿Estás seguro de que deseas eliminar este perfil? Se perderán todos sus libros e historial.'
        : 'Are you sure you want to delete this profile? All books and history will be lost.',
      type: 'danger',
      confirmText: lang === 'es' ? 'Eliminar' : 'Delete',
    });
    if (ok) {
      setBooks([]);
      const updatedProfiles = profiles.filter(p => p.id !== profileId);
      db.saveProfiles(updatedProfiles);
      setProfiles(updatedProfiles);

      if (activeProfileId === profileId) {
        const nextProfileId = updatedProfiles[0].id;
        db.setActiveProfileId(nextProfileId);
        setActiveProfileId(nextProfileId);
      }
    }
  };

  const handleUpdateProfile = (profileId: string, updatedData: any) => {
    const updatedProfiles = profiles.map(p => p.id === profileId ? { ...p, ...updatedData } : p);
    db.saveProfiles(updatedProfiles);
    setProfiles(updatedProfiles);
    
    if (activeProfileId === profileId) {
      setActiveProfileId(null);
      setTimeout(() => {
        setActiveProfileId(profileId);
      }, 0);
    }
  };

  return (
    <div className="app-container" data-theme={settings.theme}>
      <React.Suspense fallback={<div className="app-section-loading" role="status" aria-live="polite"><span className="app-section-loading-indicator" />{activeBook ? (lang === 'es' ? 'Cargando lector...' : 'Loading reader...') : (lang === 'es' ? 'Cargando biblioteca...' : 'Loading library...')}</div>}>
        {profiles.length === 0 ? (
          <WelcomeScreen onCreateProfile={handleAddProfile} settings={settings} onSaveSettings={handleSaveSettings} />
        ) : activeBook ? (
          <Reader 
            book={activeBook}
            onBack={(targetTab) => {
              setActiveBook(null);
              if (targetTab) {
                setLibraryTab(targetTab);
              } else {
                setLibraryTab('library');
              }
            }}
            onUpdateProgress={handleUpdateProgress}
            onIncrementReadingStats={handleIncrementReadingStats}
            onSaveReadingStats={handleSaveReadingStats}
            wordStatuses={wordStatuses}
            onSetWordStatus={handleSetWordStatus}
            settings={settings}
            onSaveSettings={handleSaveSettings}
            onUpdateBookDetails={handleUpdateBookDetails}
          />
        ) : (
          <Library 
          books={books}
          onSelectBook={handleSelectBook}
          onAddBooks={handleAddBooks}
          onDeleteBook={handleDeleteBook}
          onBulkDeleteBooks={handleBulkDeleteBooks}
          onUpdateBookDetails={handleUpdateBookDetails}
          onOpenInfo={(book) => {
            setInfoBook(book);
            setIsInfoOpen(true);
          }}
          profiles={profiles}
          activeProfileId={activeProfileId || ''}
          onSelectProfile={handleSelectProfile}
          onAddProfile={handleAddProfile}
          onDeleteProfile={handleDeleteProfile}
          onUpdateProfile={handleUpdateProfile}
          onClearDeletedBooks={handleClearDeletedBooks}
          settings={settings}
          onSaveSettings={handleSaveSettings}
          wordStatuses={wordStatuses}
          initialTab={libraryTab}
          navigateTo={libraryNav}
          />
        )}
      </React.Suspense>

      {profiles.length > 0 && <DictionaryInstallToast lang={lang} />}

      {/* Manual Guide Modal */}
      <React.Suspense fallback={null}>
        {isInfoOpen && (
          <SettingsModal 
            isOpen={isInfoOpen} 
            onClose={() => {
              setIsInfoOpen(false);
              setInfoBook(null);
            }}
            settings={settings}
            onSaveSettings={handleSaveSettings}
            mode="info"
            book={infoBook}
            onUpdateBookDetails={handleUpdateBookDetails}
          />
        )}
      </React.Suspense>

      {/* Floating OTA Hot Update Notification */}
      {showHotUpdateBanner && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 100000,
          background: 'linear-gradient(135deg, #18181b, #27272a)',
          border: '1px solid #3b82f6',
          borderRadius: '12px',
          padding: '12px 20px',
          boxShadow: '0 10px 35px rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          color: '#fff',
          animation: 'toastIn 0.3s ease-out'
        }}>
          <span style={{ fontSize: '1.2rem' }}>⚡</span>
          <span style={{ fontSize: '0.86rem', fontWeight: 500 }}>
            {readyUpdateKind === 'installer'
              ? (lang === 'es'
                  ? `Yoru Reader v${hotUpdateVersion} está descargada. Se instalará al cerrar la app, o ahora mismo con un reinicio.`
                  : `Yoru Reader v${hotUpdateVersion} is downloaded. It installs when you close the app, or now with a restart.`)
              : readyUpdateKind === 'ota'
                ? (lang === 'es'
                    ? `Actualización v${hotUpdateVersion} lista. Aplícala para ver los cambios.`
                    : `Update v${hotUpdateVersion} is ready. Apply it to see the changes.`)
                : (lang === 'es'
                    ? `Actualización rápida instalada (v${hotUpdateVersion}). Recarga para ver los cambios.`
                    : `Hot update installed (v${hotUpdateVersion}). Reload to apply changes.`)}
          </span>
          <button
            onClick={() => {
              if (readyUpdateKind && window.electronAPI?.updater) {
                setShowHotUpdateBanner(false);
                window.electronAPI.updater.install().catch((err: any) => console.error('[updater] Install failed:', err));
              } else if (window.electronAPI && window.electronAPI.reloadApp) {
                window.electronAPI.reloadApp();
              } else {
                window.location.reload();
              }
            }}
            style={{
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'background 0.2s'
            }}
          >
            {readyUpdateKind === 'installer'
              ? (lang === 'es' ? 'Reiniciar y actualizar' : 'Restart and update')
              : readyUpdateKind === 'ota'
                ? (lang === 'es' ? 'Aplicar ahora' : 'Apply now')
                : (lang === 'es' ? 'Recargar ahora' : 'Reload now')}
          </button>
          <button
            onClick={() => setShowHotUpdateBanner(false)}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '0.9rem', padding: '4px' }}
            title={lang === 'es' ? 'Cerrar' : 'Close'}
          >
            ✕
          </button>
        </div>
      )}

      {/* Styled confirm modal */}
      {confirmModal}
    </div>
  );
}
