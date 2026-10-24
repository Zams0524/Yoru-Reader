import JSZip from 'jszip';

const DB_NAME = 'yoru_yomitan_db';
const DB_VERSION = 4;
const STORE_DICTS = 'dictionaries';
const STORE_TERMS = 'terms';
const STORE_FREQS = 'frequencies';
const STORE_PITCHES = 'pitches';
// Frequencies and pitch accent imported since 1.4.6: one record per (dictionary, kind, partition, bank)
// holding { term: [payload…] }, instead of one IndexedDB row per word (see importYomitanZip).
const STORE_META = 'meta_packs';
const META_PARTS = 64;

let dbInstance: IDBDatabase | null = null;
type DictionaryProgress = (message: string, percent: number) => void;
type BundledInstallTask = { promise: Promise<any>; listeners: Set<DictionaryProgress> };
const bundledInstallTasks = new Map<string, BundledInstallTask>();

// ─── Session-level in-memory caches ─────────────────────────────────────────
const _searchCache = new Map<string, any>();
const _freqCache = new Map<string, any[]>();
const _pitchCache = new Map<string, any[]>();
let _cachedSettings: { disabledDicts: string[]; dictOrder: string[] } | null = null;
let _cachedInstalledTitles: Set<string> | null = null;

/**
 * Invalida todos los caches en memoria.
 * Debe llamarse al instalar/eliminar un diccionario y al guardar settings.
 */
export function clearYomitanCache(): void {
  _searchCache.clear();
  _freqCache.clear();
  _pitchCache.clear();
  _cachedSettings = null;
  _cachedInstalledTitles = null;
}

/** Lee settings de lectura desde localStorage y los caches para la sesión. */
function getCachedSettings(): { disabledDicts: string[]; dictOrder: string[] } {
  if (_cachedSettings) return _cachedSettings;
  try {
    const activeProfile = localStorage.getItem('migaku_reader_active_profile_id') || 'profile-default';
    const settingsKey = `migaku_reader_settings_${activeProfile}`;
    const settingsStr = localStorage.getItem(settingsKey) || localStorage.getItem('migaku_reader_settings');
    if (settingsStr) {
      const parsed = JSON.parse(settingsStr);
      _cachedSettings = {
        disabledDicts: parsed.disabledDictionaries || [],
        dictOrder: parsed.dictionaryOrder || []
      };
    } else {
      _cachedSettings = { disabledDicts: [], dictOrder: [] };
    }
  } catch (_e) {
    _cachedSettings = { disabledDicts: [], dictOrder: [] };
  }
  return _cachedSettings;
}

/** Consulta los títulos de dicts instalados una sola vez y los caches. */
async function getCachedInstalledTitles(): Promise<Set<string>> {
  if (_cachedInstalledTitles) return _cachedInstalledTitles;
  const db = await getDB();
  _cachedInstalledTitles = await new Promise((resolve) => {
    const tx = db.transaction(STORE_DICTS, 'readonly');
    const req = tx.objectStore(STORE_DICTS).getAll();
    req.onsuccess = () => resolve(new Set(
      (req.result || [])
        .filter((dictionary: any) => dictionary.importState !== 'installing')
        .map((dictionary: any) => dictionary.title)
    ));
    req.onerror = () => resolve(new Set<string>());
  });
  return _cachedInstalledTitles;
}

/**
 * Cierra de forma inmediata la conexión de IndexedDB para liberar memoria.
 */
export async function closeDB(): Promise<void> {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    console.log("Conexión a IndexedDB cerrada de forma inmediata para liberar memoria RAM.");
  }
}

/**
 * Obtiene la instancia activa de IndexedDB.
 */
export async function getDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;
  
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = (event: any) => reject('Error opening IndexedDB: ' + event.target.error);
    
    request.onsuccess = (event: any) => {
      dbInstance = event.target.result;
      resolve(dbInstance!);
    };
    
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      
      if (!db.objectStoreNames.contains(STORE_DICTS)) {
        db.createObjectStore(STORE_DICTS, { keyPath: 'title' });
      }
      
      if (!db.objectStoreNames.contains(STORE_TERMS)) {
        const termStore = db.createObjectStore(STORE_TERMS, { keyPath: 'id', autoIncrement: true });
        termStore.createIndex('term', 'term', { unique: false });
        termStore.createIndex('reading', 'reading', { unique: false });
        termStore.createIndex('dictionary', 'dictionary', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_FREQS)) {
        const freqStore = db.createObjectStore(STORE_FREQS, { keyPath: 'id', autoIncrement: true });
        freqStore.createIndex('term', 'term', { unique: false });
        freqStore.createIndex('dictionary', 'dictionary', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_PITCHES)) {
        const pitchStore = db.createObjectStore(STORE_PITCHES, { keyPath: 'id', autoIncrement: true });
        pitchStore.createIndex('term', 'term', { unique: false });
        pitchStore.createIndex('dictionary', 'dictionary', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        const metaStore = db.createObjectStore(STORE_META, { keyPath: 'key' });
        metaStore.createIndex('part', 'part', { unique: false });
        metaStore.createIndex('dictionary', 'dictionary', { unique: false });
      }
    };
  });
}

type MetaKind = 'freq' | 'pitch';

/** Partition of a word in the packed meta store (FNV-1a hash). */
function metaPart(term: string): number {
  let hash = 2166136261;
  for (let i = 0; i < term.length; i++) {
    hash ^= term.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % META_PARTS;
}

const metaPartKey = (dictionary: string, kind: MetaKind, term: string) => `${dictionary}\u0000${kind}\u0000${metaPart(term)}`;

/** Payloads of `word` in the packed meta store, for each of `dictionaries`. */
async function readPackedMeta(kind: MetaKind, word: string, dictionaries: string[]): Promise<{ dictionary: string; payload: any[] }[]> {
  const db = await getDB();
  if (!db.objectStoreNames.contains(STORE_META) || dictionaries.length === 0) return [];
  return new Promise((resolve) => {
    const found: { dictionary: string; payload: any[] }[] = [];
    const tx = db.transaction(STORE_META, 'readonly');
    const index = tx.objectStore(STORE_META).index('part');
    for (const dictionary of dictionaries) {
      const request = index.getAll(IDBKeyRange.only(metaPartKey(dictionary, kind, word)));
      request.onsuccess = () => {
        for (const pack of request.result || []) {
          for (const payload of pack.entries?.[word] || []) found.push({ dictionary, payload });
        }
      };
    }
    tx.oncomplete = () => resolve(found);
    tx.onerror = () => resolve(found);
    tx.onabort = () => resolve(found);
  });
}

/** Deletes every record of `title` from an object store through its 'dictionary' index. */
function deleteByDictionary(db: IDBDatabase, storeName: string, title: string): Promise<void> {
  if (!db.objectStoreNames.contains(storeName)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const request = tx.objectStore(storeName).index('dictionary').openCursor(IDBKeyRange.only(title));
    request.onsuccess = (e: any) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Obtiene la lista de diccionarios instalados y cierra la conexión.
 */
export async function getInstalledDictionaries(): Promise<any[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DICTS, 'readonly');
    const store = tx.objectStore(STORE_DICTS);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** True while a bundled dictionary is being imported in this session. */
export function isBundledInstallRunning(): boolean {
  return bundledInstallTasks.size > 0;
}

/** Instala un recurso Yomitan empaquetado con la app, compartiendo trabajos simultáneos. */
export function installBundledDictionary(
  assetName: string,
  lang: 'es' | 'en' = 'en',
  onProgress: DictionaryProgress = () => undefined
): Promise<any> {
  const runningTask = bundledInstallTasks.get(assetName);
  if (runningTask) {
    runningTask.listeners.add(onProgress);
    return runningTask.promise.finally(() => runningTask.listeners.delete(onProgress));
  }

  const listeners = new Set<DictionaryProgress>([onProgress]);
  const reportProgress = (message: string, percent: number) => {
    listeners.forEach(listener => listener(message, percent));
  };

  const task: BundledInstallTask = {
    listeners,
    promise: Promise.resolve(null)
  };
  task.promise = (async () => {
    const assetUrl = new URL(`dictionaries/${assetName}`, window.location.href);
    let arrayBuffer: ArrayBuffer;

    if (assetUrl.protocol === 'file:' && window.electronAPI?.readLocalFile) {
      let filePath = decodeURIComponent(assetUrl.pathname);
      if (/^\/[a-z]:/i.test(filePath)) filePath = filePath.slice(1).replace(/\//g, '\\');
      const fileBytes = await window.electronAPI.readLocalFile(filePath);
      if (fileBytes instanceof ArrayBuffer) {
        arrayBuffer = fileBytes;
      } else {
        const view = new Uint8Array(fileBytes.buffer || fileBytes, fileBytes.byteOffset || 0, fileBytes.byteLength);
        arrayBuffer = view.slice().buffer;
      }
    } else {
      const response = await fetch(assetUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${assetName}`);
      arrayBuffer = await response.arrayBuffer();
    }

    const file = new File([arrayBuffer], assetName, { type: 'application/zip' });
    const result = await importYomitanZip(file, reportProgress, lang);
    window.dispatchEvent(new Event('yoru-dictionaries-changed'));
    return result;
  })().finally(() => {
    bundledInstallTasks.delete(assetName);
  });
  bundledInstallTasks.set(assetName, task);
  return task.promise.finally(() => listeners.delete(onProgress));
}

/** Deja listo el paquete recomendado (diccionario, frecuencia y acento tonal) en el idioma de la app. */
export async function ensureDefaultDictionaries(lang: 'es' | 'en' = 'en'): Promise<void> {
  const { installRecommendedPack } = await import('./dictionaryPack');
  await installRecommendedPack(lang);
}

/**
 * Migra los diccionarios existentes que no tienen los flags hasTerms/hasFreqs,
 * detectando el tipo real consultando los stores de términos y frecuencias.
 */
export async function migrateDictFlags(): Promise<void> {
  const db = await getDB();
  try {
    const dicts = await new Promise<any[]>((resolve, reject) => {
      const tx = db.transaction(STORE_DICTS, 'readonly');
      const req = tx.objectStore(STORE_DICTS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    const needsMigration = dicts.filter(d => d.hasTerms === undefined || d.hasFreqs === undefined);
    if (needsMigration.length === 0) return;

    for (const dict of needsMigration) {
      const hasTerms = await new Promise<boolean>((resolve) => {
        const tx = db.transaction(STORE_TERMS, 'readonly');
        const idx = tx.objectStore(STORE_TERMS).index('dictionary');
        const req = idx.openCursor(IDBKeyRange.only(dict.title));
        req.onsuccess = (e: any) => resolve(!!e.target.result);
        req.onerror = () => resolve(false);
      });

      const hasPackedMeta = !db.objectStoreNames.contains(STORE_META) ? false : await new Promise<boolean>((resolve) => {
        const req = db.transaction(STORE_META, 'readonly').objectStore(STORE_META).index('dictionary').count(IDBKeyRange.only(dict.title));
        req.onsuccess = () => resolve(req.result > 0);
        req.onerror = () => resolve(false);
      });

      const hasFreqs = hasPackedMeta || await new Promise<boolean>((resolve) => {
        const tx = db.transaction(STORE_FREQS, 'readonly');
        const idx = tx.objectStore(STORE_FREQS).index('dictionary');
        const req = idx.openCursor(IDBKeyRange.only(dict.title));
        req.onsuccess = (e: any) => resolve(!!e.target.result);
        req.onerror = () => resolve(false);
      });

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_DICTS, 'readwrite');
        tx.objectStore(STORE_DICTS).put({ ...dict, hasTerms, hasFreqs });
        tx.oncomplete = () => resolve();
        tx.onerror = reject;
      });
    }
  } catch (err) {
    console.warn('migrateDictFlags failed:', err);
  }
}

/**
 * Elimina entradas huérfanas de términos y frecuencias cuyos diccionarios ya no existen en STORE_DICTS.
 */
export async function cleanOrphanedEntries(): Promise<void> {
  const db = await getDB();
  try {
    const knownTitles = await new Promise<Set<string>>((resolve, reject) => {
      const tx = db.transaction(STORE_DICTS, 'readonly');
      const req = tx.objectStore(STORE_DICTS).getAllKeys();
      req.onsuccess = () => resolve(new Set(req.result as string[]));
      req.onerror = () => reject(req.error);
    });

    if (knownTitles.size === 0) return;

    // Delete orphaned terms
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TERMS, 'readwrite');
      const req = tx.objectStore(STORE_TERMS).openCursor();
      req.onsuccess = (e: any) => {
        const cursor = e.target.result;
        if (cursor) {
          if (!knownTitles.has(cursor.value.dictionary)) cursor.delete();
          cursor.continue();
        } else resolve();
      };
      req.onerror = reject;
    });

    // Delete orphaned frequencies
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_FREQS, 'readwrite');
      const req = tx.objectStore(STORE_FREQS).openCursor();
      req.onsuccess = (e: any) => {
        const cursor = e.target.result;
        if (cursor) {
          if (!knownTitles.has(cursor.value.dictionary)) cursor.delete();
          cursor.continue();
        } else resolve();
      };
      req.onerror = reject;
    });

    // Delete orphaned pitches
    if (db.objectStoreNames.contains(STORE_PITCHES)) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_PITCHES, 'readwrite');
        const req = tx.objectStore(STORE_PITCHES).openCursor();
        req.onsuccess = (e: any) => {
          const cursor = e.target.result;
          if (cursor) {
            if (!knownTitles.has(cursor.value.dictionary)) cursor.delete();
            cursor.continue();
          } else resolve();
        };
        req.onerror = reject;
      });
    }

    if (db.objectStoreNames.contains(STORE_META)) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_META, 'readwrite');
        const req = tx.objectStore(STORE_META).openCursor();
        req.onsuccess = (e: any) => {
          const cursor = e.target.result;
          if (cursor) {
            if (!knownTitles.has(cursor.value.dictionary)) cursor.delete();
            cursor.continue();
          } else resolve();
        };
        req.onerror = reject;
      });
    }

    console.log('[yomitanDB] Orphaned entries cleaned. Active dicts:', [...knownTitles]);
  } catch (err) {
    console.warn('cleanOrphanedEntries failed:', err);
  }
}

/**
 * Elimina un diccionario y sus registros asociados de forma ultra-rápida en una sola transacción.
 */
export async function deleteDictionary(title: string): Promise<void> {
  // Invalidar cachés en memoria porque el inventario de dicts cambió
  clearYomitanCache();
  const db = await getDB();
  
  // 1. Borrar de la tabla de diccionarios
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_DICTS, 'readwrite');
    tx.objectStore(STORE_DICTS).delete(title);
    tx.oncomplete = () => resolve();
    tx.onerror = reject;
  });
  
  // 2. Borrar todos los términos en una sola transacción rápida
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_TERMS, 'readwrite');
    const store = tx.objectStore(STORE_TERMS);
    const index = store.index('dictionary');
    const request = index.openCursor(IDBKeyRange.only(title));
    
    request.onsuccess = (e: any) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = reject;
  });
  
  // 3. Borrar todas las frecuencias en una sola transacción rápida
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_FREQS, 'readwrite');
    const store = tx.objectStore(STORE_FREQS);
    const index = store.index('dictionary');
    const request = index.openCursor(IDBKeyRange.only(title));
    
    request.onsuccess = (e: any) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = reject;
  });

  // 4. Frecuencias y acento tonal empaquetados
  await deleteByDictionary(db, STORE_META, title);

  // 5. Borrar todos los registros de pitch
  if (db.objectStoreNames.contains(STORE_PITCHES)) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PITCHES, 'readwrite');
      const store = tx.objectStore(STORE_PITCHES);
      const index = store.index('dictionary');
      const request = index.openCursor(IDBKeyRange.only(title));
      
      request.onsuccess = (e: any) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = reject;
    });
  }
}

/**
 * Importa un diccionario Yomitan en formato ZIP liberando memoria de forma proactiva.
 */
export async function importYomitanZip(file: File, onProgress: (msg: string, percent: number) => void, lang: 'es' | 'en' = 'en'): Promise<any> {
  let zip: JSZip | null = null;
  try {
    clearYomitanCache();
    const isEs = lang === 'es';
    onProgress(isEs ? 'Leyendo archivo .zip...' : 'Reading .zip archive...', 5);
    zip = await JSZip.loadAsync(file);
    
    let indexData: any = null;
    const indexFile = zip.file('index.json');
    if (indexFile) {
      const indexStr = await indexFile.async('string');
      indexData = JSON.parse(indexStr);
    } else {
      throw new Error(isEs ? 'Archivo index.json no encontrado. ¿Es un diccionario de Yomitan válido?' : 'index.json file not found. Is this a valid Yomitan dictionary?');
    }
    
    let dictTitle: string = indexData.title;
    if (dictTitle.startsWith('JMdict') && !dictTitle.includes('Spanish') && !dictTitle.includes('English') && !dictTitle.includes('Frecuencia')) {
      dictTitle = dictTitle.replace('JMdict', 'JMdict (English)');
    }
    onProgress(isEs ? `Instalando ${dictTitle}...` : `Installing ${dictTitle}...`, 15);
    
    const termFiles = Object.keys(zip.files).filter(name => name.startsWith('term_bank_') && name.endsWith('.json'));
    const metaFiles = Object.keys(zip.files).filter(name => name.startsWith('term_meta_bank_') && name.endsWith('.json'));
    
    if (termFiles.length === 0 && metaFiles.length === 0) {
      throw new Error(isEs ? 'No se encontraron bancos de términos ni metadatos de frecuencia.' : 'No term banks or frequency metadata found.');
    }
    
    const db = await getDB();
    const hasTerms = termFiles.length > 0;
    const hasFreqs = metaFiles.length > 0;

    const existingMetadata = await new Promise<any>((resolve, reject) => {
      const tx = db.transaction(STORE_DICTS, 'readonly');
      const request = tx.objectStore(STORE_DICTS).get(dictTitle);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Failed to read dictionary metadata'));
    });

    // Make a first-time import recoverable after an interrupted app shutdown.
    // Keep an already working dictionary marked ready until its replacement finishes.
    if (!existingMetadata) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_DICTS, 'readwrite');
        tx.objectStore(STORE_DICTS).put({
          title: dictTitle,
          format: indexData.format,
          revision: indexData.revision,
          description: indexData.description,
          importedAt: Date.now(),
          hasTerms,
          hasFreqs,
          importState: 'installing'
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Failed to save dictionary metadata'));
      });
    }

    let totalProcessed = 0;

    // --- 1. Parallel Extraction of All Term Banks ---
    if (termFiles.length > 0) {
      onProgress(isEs ? 'Extrayendo bancos de términos...' : 'Extracting term banks...', 25);
      const WRITE_CHUNK = 15000;
      const writeTerms = async (chunk: any[]) => {
        if (chunk.length === 0) return;
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_TERMS, 'readwrite');
          const store = tx.objectStore(STORE_TERMS);
          for (let c = 0; c < chunk.length; c++) {
            store.add(chunk[c]);
            totalProcessed++;
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('Failed to save dictionary terms'));
          tx.onabort = () => reject(tx.error || new Error('Dictionary term transaction was aborted'));
        });
      };

      // Decompress and persist one bank at a time. This bounds peak memory to
      // one JSON bank plus one IndexedDB batch instead of the entire archive.
      for (let bankIndex = 0; bankIndex < termFiles.length; bankIndex++) {
        const filename = termFiles[bankIndex];
        const termFile = zip.file(filename);
        if (!termFile) continue;
        const bank = JSON.parse(await termFile.async('string', metadata => {
          const progress = (metadata as any).percent || 0;
          const overall = 25 + Math.floor(((bankIndex + progress / 100) / termFiles.length) * 48);
          onProgress(
            isEs
              ? `Extrayendo banco ${bankIndex + 1}/${termFiles.length} (${Math.floor(progress)}%)...`
              : `Extracting bank ${bankIndex + 1}/${termFiles.length} (${Math.floor(progress)}%)...`,
            overall
          );
        }));
        let chunk: any[] = [];
        for (let index = 0; index < bank.length; index++) {
          const termData = bank[index];
          if (!Array.isArray(termData)) continue;
          chunk.push({
            dictionary: dictTitle,
            term: termData[0],
            reading: termData[1] || '',
            definitions: typeof termData[5] === 'string' ? [termData[5]] : termData[5] || [],
            tags: termData[2] || '',
            score: termData[4] || 0
          });
          if (chunk.length >= WRITE_CHUNK) {
            await writeTerms(chunk);
            chunk = [];
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
        await writeTerms(chunk);
        onProgress(
          isEs
            ? `Guardados ${bankIndex + 1}/${termFiles.length} bancos de términos...`
            : `Saved ${bankIndex + 1}/${termFiles.length} term banks...`,
          25 + Math.floor(((bankIndex + 1) / termFiles.length) * 48)
        );
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // --- 2. Frequencies and pitch accent, packed ---
    // One record per (bank, partition) holding { term: [payload…] } instead of one row per word:
    // a 300 000-word list is ~2 000 writes. Row-per-word imports took ~30 s per list.
    if (metaFiles.length > 0) {
      onProgress(isEs ? 'Extrayendo frecuencias...' : 'Extracting frequencies and pitch...', 75);
      for (let bankIndex = 0; bankIndex < metaFiles.length; bankIndex++) {
        const metaFile = zip.file(metaFiles[bankIndex]);
        if (!metaFile) continue;
        const bank = JSON.parse(await metaFile.async('string'));
        const packs = new Map<string, { key: string; part: string; dictionary: string; kind: MetaKind; entries: Record<string, any[]> }>();
        for (const metaData of bank) {
          if (!Array.isArray(metaData)) continue;
          const term = metaData[0];
          const type = metaData[1];
          let kind: MetaKind;
          let payload: any[];
          if (type === 'freq') {
            const freqVal = metaData.length === 3 ? metaData[2] : metaData.length === 4 ? metaData[3] : null;
            let value = 0;
            let displayValue = '';
            if (typeof freqVal === 'number') {
              value = freqVal;
              displayValue = '#' + freqVal;
            } else if (typeof freqVal === 'string') {
              const parsed = parseInt(freqVal, 10);
              value = Number.isNaN(parsed) ? 0 : parsed;
              displayValue = freqVal;
            } else if (freqVal && typeof freqVal === 'object') {
              const inner = freqVal.frequency !== undefined ? freqVal.frequency : freqVal;
              if (typeof inner === 'number') {
                value = inner;
                displayValue = '#' + inner;
              } else if (inner && typeof inner === 'object') {
                if (typeof inner.value === 'number') value = inner.value;
                displayValue = inner.displayValue || '#' + value;
              }
            }
            kind = 'freq';
            payload = [value, displayValue];
          } else if (type === 'pitch') {
            const pitchData = metaData[2];
            if (!pitchData || typeof pitchData !== 'object') continue;
            kind = 'pitch';
            payload = [pitchData.reading || '', pitchData.pitches || []];
          } else {
            continue;
          }
          const part = metaPartKey(dictTitle, kind, term);
          let pack = packs.get(part);
          if (!pack) {
            pack = { key: `${part}\u0000${bankIndex}`, part, dictionary: dictTitle, kind, entries: {} };
            packs.set(part, pack);
          }
          (pack.entries[term] ||= []).push(payload);
          totalProcessed++;
        }
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_META, 'readwrite');
          const store = tx.objectStore(STORE_META);
          packs.forEach(pack => store.put(pack));
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('Failed to save dictionary metadata'));
          tx.onabort = () => reject(tx.error || new Error('Dictionary metadata transaction was aborted'));
        });
        onProgress(
          isEs
            ? `Guardados ${bankIndex + 1}/${metaFiles.length} bancos...`
            : `Saved ${bankIndex + 1}/${metaFiles.length} banks...`,
          75 + Math.floor(((bankIndex + 1) / metaFiles.length) * 24)
        );
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_DICTS, 'readwrite');
      tx.objectStore(STORE_DICTS).put({
        ...existingMetadata,
        title: dictTitle,
        format: indexData.format,
        revision: indexData.revision,
        description: indexData.description,
        importedAt: Date.now(),
        hasTerms,
        hasFreqs,
        importState: 'ready'
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to finalize dictionary metadata'));
    });
    clearYomitanCache();

    onProgress(isEs ? '¡Instalación completada!' : 'Installation completed!', 100);
    return { success: true, title: dictTitle, termsCount: totalProcessed, hasTerms, hasFreqs };
  } finally {
    zip = null;
  }
}

export async function getFrequenciesForWord(word: string): Promise<any[]> {
  // Cache hit
  if (_freqCache.has(word)) return _freqCache.get(word)!;

  const db = await getDB();
  const freqs: any[] = [];
  const { disabledDicts, dictOrder } = getCachedSettings();
  const installedTitles = await getCachedInstalledTitles();

  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_FREQS, 'readonly');
    const store = tx.objectStore(STORE_FREQS);
    const index = store.index('term');
    const request = index.openCursor(IDBKeyRange.only(word));
    
    request.onsuccess = (e: any) => {
      const cursor = e.target.result;
      if (cursor) {
        const val = cursor.value;
        if (installedTitles.has(val.dictionary) && !disabledDicts.includes(val.dictionary)) {
          freqs.push({
            dictionary: val.dictionary,
            value: val.value,
            displayValue: val.displayValue
          });
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = () => resolve();
  });

  const enabledTitles = [...installedTitles].filter(title => !disabledDicts.includes(title));
  for (const { dictionary, payload } of await readPackedMeta('freq', word, enabledTitles)) {
    freqs.push({ dictionary, value: payload[0], displayValue: payload[1] });
  }
  
  if (dictOrder.length > 0) {
    freqs.sort((a, b) => {
      const idxA = dictOrder.indexOf(a.dictionary);
      const idxB = dictOrder.indexOf(b.dictionary);
      if (idxA === -1 && idxB === -1) return 0;
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });
  }

  // Guardar en caché antes de retornar
  _freqCache.set(word, freqs);
  return freqs;
}

/**
 * Obtiene los tonos (pitch accent) de una palabra desde STORE_PITCHES.
 * Usa caché en memoria para evitar consultas IDB repetidas por página.
 */
export async function getPitchesForWord(word: string): Promise<any[]> {
  // Cache hit
  if (_pitchCache.has(word)) return _pitchCache.get(word)!;

  const db = await getDB();
  if (!db.objectStoreNames.contains(STORE_PITCHES)) {
    _pitchCache.set(word, []);
    return [];
  }
  const pitches: any[] = [];
  const { disabledDicts } = getCachedSettings();
  const installedTitles = await getCachedInstalledTitles();

  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_PITCHES, 'readonly');
    const store = tx.objectStore(STORE_PITCHES);
    const index = store.index('term');
    const request = index.openCursor(IDBKeyRange.only(word));
    
    request.onsuccess = (e: any) => {
      const cursor = e.target.result;
      if (cursor) {
        const val = cursor.value;
        if (installedTitles.has(val.dictionary) && !disabledDicts.includes(val.dictionary)) {
          pitches.push({
            dictionary: val.dictionary,
            reading: val.reading,
            pitches: val.pitches
          });
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = () => resolve();
  });

  const enabledTitles = [...installedTitles].filter(title => !disabledDicts.includes(title));
  for (const { dictionary, payload } of await readPackedMeta('pitch', word, enabledTitles)) {
    pitches.push({ dictionary, reading: payload[0], pitches: payload[1] });
  }

  _pitchCache.set(word, pitches);
  return pitches;
}

function cleanDefinition(def: any): string {
  if (typeof def === 'string') {
    return def;
  }
  if (typeof def === 'object' && def !== null) {
    let text = '';
    const traverse = (node: any) => {
      if (typeof node === 'string') {
        text += node + ' ';
      } else if (Array.isArray(node)) {
        node.forEach(traverse);
      } else if (typeof node === 'object' && node !== null) {
        if (node.content) traverse(node.content);
        if (node.text) text += node.text + ' ';
      }
    };
    traverse(def);
    return text.trim();
  }
  return '';
}

/** Plain text of a structured-content node, leaving out the small "refGlosses" hints. */
function structuredText(node: any): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(structuredText).join('');
  if (node && typeof node === 'object') {
    if (node.data?.content === 'refGlosses') return '';
    if (node.text) return String(node.text);
    return node.content !== undefined ? structuredText(node.content) : '';
  }
  return '';
}

/** List items of a structured-content node (each <li> is one gloss or one note). */
function structuredItems(node: any): string[] {
  const items: string[] = [];
  const visit = (current: any) => {
    if (Array.isArray(current)) { current.forEach(visit); return; }
    if (!current || typeof current !== 'object') return;
    if (current.tag === 'li') {
      const text = structuredText(current).replace(/\s+/g, ' ').trim();
      if (text) items.push(text);
      return;
    }
    if (current.content !== undefined) visit(current.content);
  };
  visit(node);
  if (items.length === 0) {
    const text = structuredText(node).replace(/\s+/g, ' ').trim();
    if (text) items.push(text);
  }
  return items;
}

const NOTE_SECTIONS = new Set(['notes', 'infoGlossary', 'references', 'antonym', 'antonyms', 'sourceLanguages', 'lexicalInformation']);

/**
 * One dictionary row is one sense. Yomitan JMdict rows keep the glosses, the usage notes and the
 * cross-references in sections of the same structured content; split them so the popup can show
 * "five; 5" with the note "伍 is used in legal documents" apart instead of one run-on line.
 */
function splitSense(definitions: any[]): { glossary: string; note: string } {
  const glosses: string[] = [];
  const notes: string[] = [];
  for (const definition of definitions || []) {
    if (typeof definition === 'string') {
      if (definition.trim()) glosses.push(definition.trim());
      continue;
    }
    const sections: { kind: string; node: any }[] = [];
    const findSections = (node: any) => {
      if (Array.isArray(node)) { node.forEach(findSections); return; }
      if (!node || typeof node !== 'object') return;
      const kind = node.data?.content;
      if (typeof kind === 'string') { sections.push({ kind, node }); return; }
      if (node.content !== undefined) findSections(node.content);
    };
    findSections(definition?.content ?? definition);
    if (sections.length === 0) {
      const text = cleanDefinition(definition);
      if (text) glosses.push(text);
      continue;
    }
    for (const { kind, node } of sections) {
      if (kind === 'glossary') glosses.push(...structuredItems(node));
      else if (NOTE_SECTIONS.has(kind)) notes.push(...structuredItems(node));
    }
  }
  return { glossary: glosses.join('; '), note: notes.join(' · ') };
}

// Kuromoji part of speech → JMdict part-of-speech tags.
const POS_TO_JMDICT: [string, string[]][] = [
  ['接頭詞', ['pref']],
  ['助詞', ['prt']],
  ['助動詞', ['aux', 'aux-v', 'aux-adj']],
  ['感動詞', ['int']],
  ['接続詞', ['conj']],
  ['副詞', ['adv']],
  ['連体詞', ['adj-pn']],
];

const toHiragana = (text: string) => text.replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60));
const isKanaOnly = (text: string) => /^[぀-ヿー]+$/.test(text);

type TermRow = { term: string; reading: string; definitions: any[]; tags: string; dictionary: string; score: number };

async function collectTerms(indexName: 'term' | 'reading', key: string, accept: (row: any) => boolean): Promise<TermRow[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const rows: TermRow[] = [];
    const request = db.transaction(STORE_TERMS, 'readonly').objectStore(STORE_TERMS).index(indexName).openCursor(IDBKeyRange.only(key));
    request.onsuccess = (e: any) => {
      const cursor = e.target.result;
      if (!cursor) { resolve(rows); return; }
      const val = cursor.value;
      if (accept(val)) {
        rows.push({
          term: val.term,
          reading: val.reading || '',
          definitions: val.definitions || [],
          tags: val.tags || '',
          dictionary: val.dictionary,
          score: Number(val.score) || 0
        });
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Realiza una búsqueda de palabras en la base de datos IndexedDB usando cursores y proyección
 * para minimizar drásticamente el consumo de RAM.
 * Los resultados se cachean en memoria por sesión para eliminar repetidas consultas IDB por página.
 *
 * The result shows one word (term + reading) with its senses; the other words found for the same
 * text or reading go in `alternatives`, so tapping ご shows 御 and offers 五・語・碁 as chips.
 */
export async function searchYomitanDB(word: string, reading: string = '', pos: string = ''): Promise<any> {
  // Cache hit
  const cacheKey = `${word}|${reading}|${pos}`;
  if (_searchCache.has(cacheKey)) return _searchCache.get(cacheKey);

  const { dictOrder, disabledDicts } = getCachedSettings();
  const installedTitles = await getCachedInstalledTitles();
  // JMdict "forms" rows are tables of spellings (五 ５ 伍 ★ ㊒…), not senses.
  const accept = (row: any) => installedTitles.has(row.dictionary) && !disabledDicts.includes(row.dictionary)
    && !String(row.tags || '').split(' ').includes('forms');

  try {
    const wantedReading = toHiragana(reading || '');
    let results = await collectTerms('term', word, accept);
    const byReading = results.length === 0;
    if (byReading) {
      const lookupReading = wantedReading || (isKanaOnly(word) ? toHiragana(word) : '');
      if (lookupReading) results = await collectTerms('reading', lookupReading, accept);
    }

    if (results.length > 0) {
      const wantedPos = POS_TO_JMDICT.find(([prefix]) => pos.startsWith(prefix))?.[1] || [];
      const dictRank = (dictionary: string) => {
        const index = dictOrder.indexOf(dictionary);
        return index === -1 ? dictOrder.length : index;
      };

      // Group the rows into words (term + reading) and rank the words.
      const groups = new Map<string, { term: string; reading: string; rank: number; rows: TermRow[] }>();
      for (const row of results) {
        const key = `${row.term}\u0000${row.reading}`;
        let group = groups.get(key);
        if (!group) {
          group = { term: row.term, reading: row.reading, rank: -Infinity, rows: [] };
          groups.set(key, group);
        }
        const tags = row.tags.split(' ');
        let rank = row.score;
        if (wantedReading && toHiragana(row.reading) === wantedReading) rank += 1e8;
        // Looking up kana: words usually written in kana (御 → ご) beat kanji homophones (五, 語).
        if (byReading && tags.includes('uk')) rank += 5e6;
        // The parser's part of speech (接頭詞 for the ご of ご承諾) picks the right homophone.
        if (byReading && wantedPos.some(tag => tags.includes(tag))) rank += 1e7;
        group.rank = Math.max(group.rank, rank);
        group.rows.push(row);
      }
      const ranked = [...groups.values()].sort((a, b) => b.rank - a.rank);
      const main = ranked[0];
      main.rows.sort((a, b) => dictRank(a.dictionary) - dictRank(b.dictionary) || b.score - a.score);

      // Helpers to classify definitions by language
      const SPA_DIACRITICS = /[áéíóúüñÁÉÍÓÚÜÑ¿¡]/u;
      const SPA_WORDS = /\b(de|del|el|la|los|las|en|un|una|unos|unas|con|por|para|que|es|son|su|sus|se|al|como|más|no|si|lo|le|les|muy|también|pero|cuando|este|esta|estos|estas|fue|ser|hay|ya|porque|aunque|donde|mientras|entre)\b/i;
      const ENG_WORDS = /\b(the|of|to|and|a|in|is|for|on|with|as|by|at|an|be|this|that|from|it|are|or|if|but|after|before|during|while|have|has|had|not|also|can|will|its|was|were|been|one|two|three|four|five|used|made|when|which|who|what|where|how)\b/i;
      const isSpanish = (text: string) => SPA_DIACRITICS.test(text) || SPA_WORDS.test(text);
      const isEnglish = (text: string) => !SPA_DIACRITICS.test(text) && ENG_WORDS.test(text) && !SPA_WORDS.test(text);

      const fullDefinitions: { dictionary: string; glossary: string; note?: string; partsOfSpeech?: string[] }[] = [];
      const seen = new Set<string>();
      const tagsSet = new Set<string>();
      for (const row of main.rows) {
        const partsOfSpeech = row.tags.split(' ').filter(tag => tag && !/^\d+$/.test(tag));
        partsOfSpeech.forEach(tag => tagsSet.add(tag));
        let definitions = row.definitions;
        // Imported mixed-language dictionaries: keep the Spanish glosses when there are any.
        if (definitions.every((d: any) => typeof d === 'string') && definitions.some(isSpanish)) {
          const spanish = definitions.filter((d: string) => !isEnglish(d));
          if (spanish.length > 0) definitions = spanish;
        }
        const { glossary, note } = splitSense(definitions);
        if (!glossary) continue;
        const key = `${row.dictionary}\u0000${glossary}`;
        if (seen.has(key)) continue;
        seen.add(key);
        fullDefinitions.push({ dictionary: row.dictionary || '', glossary, note: note || undefined, partsOfSpeech });
      }

      const alternatives: { term: string; reading: string; glossary: string }[] = [];
      for (const group of ranked.slice(1)) {
        if (alternatives.length >= 6) break;
        if (alternatives.some(alt => alt.term === group.term && alt.reading === group.reading)) continue;
        const first = [...group.rows].sort((a, b) => b.score - a.score)[0];
        alternatives.push({ term: group.term, reading: group.reading, glossary: splitSense(first.definitions).glossary });
      }

      const [freqs, pitches] = await Promise.all([getFrequenciesForWord(main.term), getPitchesForWord(main.term)]);
      const posTags = [...tagsSet].slice(0, 3);
      const finalResult = {
        word: main.term,
        reading: main.reading || reading,
        definitions: fullDefinitions.map(d => d.glossary).slice(0, 8),
        fullDefinitions: fullDefinitions.slice(0, 8),
        partsOfSpeech: posTags,
        alternatives,
        frequencies: freqs,
        pitches: pitches,
        isFromYomitan: true
      };

      // Guardar en caché para futuras páginas
      _searchCache.set(cacheKey, finalResult);
      return finalResult;
    }

    const [freqs, pitches] = await Promise.all([getFrequenciesForWord(word), getPitchesForWord(word)]);
    if (freqs.length > 0 || pitches.length > 0) {
      const finalResult = {
        word,
        reading: reading || '',
        definitions: [],
        fullDefinitions: [],
        partsOfSpeech: [],
        alternatives: [],
        frequencies: freqs,
        pitches: pitches,
        isFromYomitan: true
      };
      _searchCache.set(cacheKey, finalResult);
      return finalResult;
    }

    _searchCache.set(cacheKey, null);
    return null;
  } catch (err) {
    console.error('Error in searchYomitanDB:', err);
    throw err;
  }
}

/**
 * Exporta el contenido de los diccionarios liberando memoria entre iteraciones.
 */
export async function exportDictionaryDataToZip(zip: JSZip, onProgress: (msg: string, percent: number) => void): Promise<any[]> {
  const db = await getDB();
  
  try {
    onProgress('Exportando metadatos de diccionarios...', 5);
    const dictionaries = await new Promise<any[]>(resolve => {
      const tx = db.transaction(STORE_DICTS, 'readonly');
      const req = tx.objectStore(STORE_DICTS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    
    onProgress('Exportando términos del diccionario...', 10);
    const termChunkSize = 5000;
    let currentTermChunk: any[] | null = [];
    let termChunkCount = 0;
    let totalTermsExported = 0;
    
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TERMS, 'readonly');
      const store = tx.objectStore(STORE_TERMS);
      const request = store.openCursor();
      
      request.onsuccess = (event: any) => {
        const cursor = event.target.result;
        if (cursor) {
          currentTermChunk!.push(cursor.value);
          totalTermsExported++;
          
          if (currentTermChunk!.length >= termChunkSize) {
            zip.file(`terms_chunk_${termChunkCount}.json`, JSON.stringify(currentTermChunk));
            termChunkCount++;
            currentTermChunk!.length = 0;
            onProgress(`Exportados ${totalTermsExported} términos...`, 15 + Math.min(30, Math.floor(totalTermsExported / 10000)));
          }
          cursor.continue();
        } else {
          if (currentTermChunk!.length > 0) {
            zip.file(`terms_chunk_${termChunkCount}.json`, JSON.stringify(currentTermChunk));
            termChunkCount++;
            currentTermChunk = null;
          }
          resolve();
        }
      };
      request.onerror = reject;
    });
    
    zip.file('terms_info.json', JSON.stringify({ chunkCount: termChunkCount, totalCount: totalTermsExported }));
    
    onProgress('Exportando frecuencias del diccionario...', 50);
    const freqChunkSize = 5000;
    let currentFreqChunk: any[] | null = [];
    let freqChunkCount = 0;
    let totalFreqsExported = 0;
    
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_FREQS, 'readonly');
      const store = tx.objectStore(STORE_FREQS);
      const request = store.openCursor();
      
      request.onsuccess = (event: any) => {
        const cursor = event.target.result;
        if (cursor) {
          currentFreqChunk!.push(cursor.value);
          totalFreqsExported++;
          
          if (currentFreqChunk!.length >= freqChunkSize) {
            zip.file(`frequencies_chunk_${freqChunkCount}.json`, JSON.stringify(currentFreqChunk));
            freqChunkCount++;
            currentFreqChunk!.length = 0;
            onProgress(`Exportadas ${totalFreqsExported} frecuencias...`, 55 + Math.min(35, Math.floor(totalFreqsExported / 10000)));
          }
          cursor.continue();
        } else {
          if (currentFreqChunk!.length > 0) {
            zip.file(`frequencies_chunk_${freqChunkCount}.json`, JSON.stringify(currentFreqChunk));
            freqChunkCount++;
            currentFreqChunk = null;
          }
          resolve();
        }
      };
      request.onerror = reject;
    });
    
    zip.file('frequencies_info.json', JSON.stringify({ chunkCount: freqChunkCount, totalCount: totalFreqsExported }));

    // Packed frequencies and pitch accent (imports since 1.4.6), 100 records per file.
    if (db.objectStoreNames.contains(STORE_META)) {
      let packChunk: any[] = [];
      let packChunkCount = 0;
      await new Promise<void>((resolve, reject) => {
        const request = db.transaction(STORE_META, 'readonly').objectStore(STORE_META).openCursor();
        request.onsuccess = (event: any) => {
          const cursor = event.target.result;
          if (cursor) {
            packChunk.push(cursor.value);
            if (packChunk.length >= 100) {
              zip.file(`meta_packs_chunk_${packChunkCount++}.json`, JSON.stringify(packChunk));
              packChunk = [];
            }
            cursor.continue();
          } else {
            if (packChunk.length > 0) zip.file(`meta_packs_chunk_${packChunkCount++}.json`, JSON.stringify(packChunk));
            resolve();
          }
        };
        request.onerror = reject;
      });
      zip.file('meta_packs_info.json', JSON.stringify({ chunkCount: packChunkCount }));
    }
    
    return dictionaries;
  } catch (err) {
    console.error('Error exporting dictionary to zip:', err);
    throw err;
  }
}

/** Restores the packed frequency/pitch records of a backup (see exportDictionaryDataToZip). */
export async function importMetaPacksFromZip(zip: JSZip): Promise<void> {
  const info = zip.file('meta_packs_info.json');
  if (!info) return;
  const { chunkCount } = JSON.parse(await info.async('text'));
  const db = await getDB();
  for (let c = 0; c < chunkCount; c++) {
    const chunk = zip.file(`meta_packs_chunk_${c}.json`);
    if (!chunk) continue;
    const records = JSON.parse(await chunk.async('text'));
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      const store = tx.objectStore(STORE_META);
      records.forEach((record: any) => store.put(record));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  clearYomitanCache();
}

interface ImportDictionaryDataParams {
  dictionaries: any[];
  terms?: any[];
  frequencies?: any[];
}

/**
 * Importa todos los diccionarios por micro-lotes con pausas para evitar fugas.
 */
export async function importAllDictionaryData({ dictionaries, terms, frequencies }: ImportDictionaryDataParams): Promise<void> {
  const db = await getDB();
  
  try {
    if (dictionaries && dictionaries.length > 0) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_DICTS, 'readwrite');
        const store = tx.objectStore(STORE_DICTS);
        dictionaries.forEach(d => store.put(d));
        tx.oncomplete = () => resolve();
        tx.onerror = (e: any) => reject(tx.error || e.target.error || new Error('Dictionary transaction failed'));
      });
    }
    
    if (terms && terms.length > 0) {
      const batchSize = 2500;
      for (let i = 0; i < terms.length; i += batchSize) {
        let chunk: any[] | null = terms.slice(i, i + batchSize);
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_TERMS, 'readwrite');
          const store = tx.objectStore(STORE_TERMS);
          chunk!.forEach(t => store.put(t));
          tx.oncomplete = () => resolve();
          tx.onerror = (e: any) => reject(tx.error || e.target.error || new Error('Terms transaction failed'));
        });
        chunk = null;
        await new Promise(r => setTimeout(r, 15));
      }
    }
    
    if (frequencies && frequencies.length > 0) {
      const batchSize = 2500;
      for (let i = 0; i < frequencies.length; i += batchSize) {
        let chunk: any[] | null = frequencies.slice(i, i + batchSize);
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_FREQS, 'readwrite');
          const store = tx.objectStore(STORE_FREQS);
          chunk!.forEach(f => store.put(f));
          tx.oncomplete = () => resolve();
          tx.onerror = (e: any) => reject(tx.error || e.target.error || new Error('Frequencies transaction failed'));
        });
        chunk = null;
        await new Promise(r => setTimeout(r, 15));
      }
    }
  } catch (err) {
    console.error('Error importing all dictionary data:', err);
    throw err;
  }
}

/**
 * Migra los nombres de los diccionarios de inglés para agregar "(English)" de forma retrocompatible.
 */
/**
 * Until 1.4.5 the bundled English JMdict was cut to its first 100 000 rows (no 名前, 猫, 天気…).
 * Replaces that copy with the current bundled one; a JMdict the user imported is left alone.
 */
export async function upgradeTruncatedEnglishJmdict(): Promise<void> {
  const installed = await getInstalledDictionaries();
  const old = installed.find(dictionary =>
    dictionary.revision === 'JMdict.2026-08-29' && /^JMdict( \(English\))? \[/.test(dictionary.title || ''));
  if (!old) return;
  const db = await getDB();
  const rows = await new Promise<number>((resolve) => {
    const request = db.transaction(STORE_TERMS, 'readonly').objectStore(STORE_TERMS).index('dictionary').count(IDBKeyRange.only(old.title));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(-1);
  });
  if (rows !== 100000) return;
  await deleteDictionary(old.title);
  await installBundledDictionary('JMdict_english.zip', 'en');
}

export async function migrateEnglishDictName(): Promise<void> {
  const db = await getDB();
  try {
    // 1. Read dictionaries using a short-lived readonly transaction
    const dicts = await new Promise<any[]>((resolve) => {
      const tx = db.transaction(STORE_DICTS, 'readonly');
      const req = tx.objectStore(STORE_DICTS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    
    const targetDict = dicts.find(d => d.title.startsWith('JMdict') && !d.title.includes('Spanish') && !d.title.includes('English') && !d.title.includes('Frecuencia'));
    if (!targetDict) return;
    
    const oldTitle = targetDict.title;
    const newTitle = oldTitle.replace('JMdict', 'JMdict (English)');
    
    // 2. Open readwrite transaction only when we actually need to migrate!
    const tx = db.transaction([STORE_DICTS, STORE_TERMS, STORE_FREQS], 'readwrite');
    const dictStore = tx.objectStore(STORE_DICTS);
    const termStore = tx.objectStore(STORE_TERMS);
    const freqStore = tx.objectStore(STORE_FREQS);
    
    // Save new dictionary metadata
    dictStore.put({
      ...targetDict,
      title: newTitle
    });
    dictStore.delete(oldTitle);
    
    // Update terms in DB
    const termIndex = termStore.index('dictionary');
    const termRequest = termIndex.openCursor(IDBKeyRange.only(oldTitle));
    termRequest.onsuccess = (e: any) => {
      const cursor = e.target.result;
      if (cursor) {
        const val = cursor.value;
        val.dictionary = newTitle;
        cursor.update(val);
        cursor.continue();
      }
    };
    
    // Update frequencies in DB
    const freqIndex = freqStore.index('dictionary');
    const freqRequest = freqIndex.openCursor(IDBKeyRange.only(oldTitle));
    freqRequest.onsuccess = (e: any) => {
      const cursor = e.target.result;
      if (cursor) {
        const val = cursor.value;
        val.dictionary = newTitle;
        cursor.update(val);
        cursor.continue();
      }
    };

    // Await completion of migration transaction
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = reject;
    });
  } catch (err) {
    console.warn("Migration of English dictionary name failed:", err);
  }
}

export async function getTopWordsFromFrequencyDict(dictName: string, maxRank: number): Promise<string[]> {
  const db = await getDB();
  const words = new Set<string>();
  const inRange = (value: any) => {
    const rank = Number(value);
    return !isNaN(rank) && rank > 0 && rank <= maxRank;
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_FREQS, 'readonly');
    const request = tx.objectStore(STORE_FREQS).index('dictionary').openCursor(IDBKeyRange.only(dictName));
    request.onsuccess = (e: any) => {
      const cursor = e.target.result;
      if (cursor) {
        if (inRange(cursor.value.value) && cursor.value.term) words.add(cursor.value.term);
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = (e: any) => reject(e.target.error || new Error('Failed to query frequencies'));
  });
  if (db.objectStoreNames.contains(STORE_META)) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const request = tx.objectStore(STORE_META).index('dictionary').openCursor(IDBKeyRange.only(dictName));
      request.onsuccess = (e: any) => {
        const cursor = e.target.result;
        if (cursor) {
          if (cursor.value.kind === 'freq') {
            for (const [term, payloads] of Object.entries(cursor.value.entries || {})) {
              if ((payloads as any[]).some(payload => inRange(payload[0]))) words.add(term);
            }
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = (e: any) => reject(e.target.error || new Error('Failed to query frequencies'));
    });
  }
  return [...words];
}
