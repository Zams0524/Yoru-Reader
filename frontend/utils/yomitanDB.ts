import JSZip from 'jszip';

const DB_NAME = 'yoru_yomitan_db';
const DB_VERSION = 3;
const STORE_DICTS = 'dictionaries';
const STORE_TERMS = 'terms';
const STORE_FREQS = 'frequencies';
const STORE_PITCHES = 'pitches';

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
    };
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

/** Deja listo un diccionario de términos en el idioma de la app y el pitch accent. */
export async function ensureDefaultDictionaries(lang: 'es' | 'en' = 'en'): Promise<void> {
  const pitchPattern = /pitch|アクセント/i;
  const frequencyPattern = /frequen|frecuencia|frequency|meta|Netflix|YouTube|novels|anime|visual novel/i;
  const isTermDictionary = (dictionary: any) => {
    if (dictionary.hasTerms === true) return true;
    if (dictionary.hasTerms === false || dictionary.hasFreqs === true) return false;
    return !pitchPattern.test(dictionary.title || '') && !frequencyPattern.test(dictionary.title || '');
  };

  let installed = await getInstalledDictionaries();
  const interruptedImports = installed.filter(dictionary => dictionary.importState === 'installing');
  for (const dictionary of interruptedImports) {
    await deleteDictionary(dictionary.title);
  }
  if (interruptedImports.length > 0) installed = await getInstalledDictionaries();

  if (!installed.some(isTermDictionary)) {
    const assetName = lang === 'es' ? 'JMdict_spanish.zip' : 'JMdict_english.zip';
    await installBundledDictionary(assetName, lang);
    installed = await getInstalledDictionaries();
  }

  if (!installed.some(dictionary => pitchPattern.test(dictionary.title || ''))) {
    await installBundledDictionary('pitch-accent-japanese.zip', lang);
  }
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

      const hasFreqs = await new Promise<boolean>((resolve) => {
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

  // 4. Borrar todos los registros de pitch
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

    // --- 2. Parallel Extraction & Fast Chunked Write for Frequencies/Pitch ---
    if (metaFiles.length > 0) {
      onProgress(isEs ? 'Extrayendo frecuencias...' : 'Extracting frequencies and pitch...', 80);
      
      // Read only a few banks at once. Parsing every JSON bank with Promise.all
      // kept the whole expanded archive in memory and left the UI frozen at 80%.
      const META_BANK_BATCH = 3;
      const WRITE_META_CHUNK = 5000;
      const metaFileSizes = metaFiles.map(filename => {
        const file = zip!.file(filename) as any;
        return Math.max(1, Number(file?._data?.uncompressedSize) || 1);
      });
      const totalMetaBytes = metaFileSizes.reduce((sum, size) => sum + size, 0);
      let completedMetaBytes = 0;
      let lastMetaProgress = 79;
      const reportMetaProgress = (message: string, percent: number) => {
        lastMetaProgress = Math.max(lastMetaProgress, Math.min(99, Math.floor(percent)));
        onProgress(message, lastMetaProgress);
      };

      for (let start = 0; start < metaFiles.length; start += META_BANK_BATCH) {
        const batchFiles = metaFiles.slice(start, start + META_BANK_BATCH);
        const batchOffsets: number[] = [];
        let bytesBeforeInBatch = 0;
        for (let i = 0; i < batchFiles.length; i++) {
          batchOffsets.push(bytesBeforeInBatch);
          bytesBeforeInBatch += metaFileSizes[start + i];
        }
        const batchBytes = bytesBeforeInBatch;

        const parsedBanks = await Promise.all(batchFiles.map(async (filename, batchIndex) => {
          const zf = zip!.file(filename);
          if (!zf) return [];
          const absoluteBank = start + batchIndex + 1;
          const fileSize = metaFileSizes[start + batchIndex];
          const bankOffset = batchOffsets[batchIndex];
          const text = await zf.async('string', metadata => {
            const progressBytes = completedMetaBytes + bankOffset + fileSize * ((metadata as any).percent || 0) / 100;
            const percent = 80 + 9 * (progressBytes / totalMetaBytes);
            reportMetaProgress(
              isEs
                ? `Extrayendo banco ${absoluteBank}/${metaFiles.length} (${Math.floor((metadata as any).percent || 0)}%)...`
                : `Extracting bank ${absoluteBank}/${metaFiles.length} (${Math.floor((metadata as any).percent || 0)}%)...`,
              percent
            );
          });
          return JSON.parse(text);
        }));

        const freqItems: any[] = [];
        const pitchItems: any[] = [];
        for (const metaArray of parsedBanks) {
          for (const metaData of metaArray) {
            if (!Array.isArray(metaData)) continue;
            const term = metaData[0];
            const type = metaData[1];

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
                if (typeof freqVal.value === 'number') {
                  value = freqVal.value;
                  displayValue = '#' + value;
                } else if (typeof freqVal.frequency === 'number') {
                  value = freqVal.frequency;
                  displayValue = '#' + value;
                }
                if (freqVal.displayValue) displayValue = freqVal.displayValue;
              }
              freqItems.push({ dictionary: dictTitle, term, value, displayValue });
            } else if (type === 'pitch') {
              const pitchData = metaData[2];
              if (pitchData && typeof pitchData === 'object') {
                pitchItems.push({
                  dictionary: dictTitle,
                  term,
                  reading: pitchData.reading || '',
                  pitches: pitchData.pitches || []
                });
              }
            }
          }
        }

        // Store each bank batch in bounded transactions so large corpora don't
        // monopolize IndexedDB or make the UI appear stuck.
        const totalBatchItems = freqItems.length + pitchItems.length;
        let writtenBatchItems = 0;
        for (let offset = 0; offset < Math.max(freqItems.length, pitchItems.length); offset += WRITE_META_CHUNK) {
          const freqChunk = freqItems.slice(offset, offset + WRITE_META_CHUNK);
          const pitchChunk = pitchItems.slice(offset, offset + WRITE_META_CHUNK);
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction([STORE_FREQS, STORE_PITCHES], 'readwrite');
            const storeFreq = tx.objectStore(STORE_FREQS);
            const storePitch = tx.objectStore(STORE_PITCHES);
            for (const item of freqChunk) storeFreq.add(item);
            for (const item of pitchChunk) storePitch.add(item);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('Failed to save dictionary metadata'));
            tx.onabort = () => reject(tx.error || new Error('Dictionary metadata transaction was aborted'));
          });

          const written = freqChunk.length + pitchChunk.length;
          writtenBatchItems += written;
          totalProcessed += written;
          const batchFraction = totalBatchItems ? writtenBatchItems / totalBatchItems : 1;
          const progressBytes = completedMetaBytes + batchBytes * batchFraction;
          const percent = 90 + 9 * (progressBytes / totalMetaBytes);
          reportMetaProgress(
            isEs
              ? `Guardando ${writtenBatchItems.toLocaleString()} / ${totalBatchItems.toLocaleString()} entradas...`
              : `Saving ${writtenBatchItems.toLocaleString()} / ${totalBatchItems.toLocaleString()} entries...`,
            percent
          );
          await new Promise(resolve => setTimeout(resolve, 0));
        }

        completedMetaBytes += batchBytes;
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

/**
 * Realiza una búsqueda de palabras en la base de datos IndexedDB usando cursores y proyección
 * para minimizar drásticamente el consumo de RAM.
 * Los resultados se cachean en memoria por sesión para eliminar repetidas consultas IDB por página.
 */
export async function searchYomitanDB(word: string, reading: string = ''): Promise<any> {
  // Cache hit
  const cacheKey = reading ? `${word}|${reading}` : word;
  if (_searchCache.has(cacheKey)) return _searchCache.get(cacheKey);

  const db = await getDB();
  let results: any[] | null = [];
  const { dictOrder, disabledDicts } = getCachedSettings();
  const installedTitles = await getCachedInstalledTitles();

  try {
    // 1. Buscar coincidencia de término exacto usando cursores (Consultas selectivas)
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TERMS, 'readonly');
      const store = tx.objectStore(STORE_TERMS);
      const index = store.index('term');
      const request = index.openCursor(IDBKeyRange.only(word));
      
      request.onsuccess = (e: any) => {
        const cursor = e.target.result;
        if (cursor) {
          const val = cursor.value;
          if (installedTitles.has(val.dictionary) && !disabledDicts.includes(val.dictionary)) {
            results!.push({
              term: val.term,
              reading: val.reading,
              definitions: val.definitions,
              tags: val.tags,
              dictionary: val.dictionary
            });
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = reject;
    });
    
    // 2. Buscar por lectura como fallback si no se encontró término exacto
    if (reading && results.length === 0) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_TERMS, 'readonly');
        const store = tx.objectStore(STORE_TERMS);
        const index = store.index('reading');
        const request = index.openCursor(IDBKeyRange.only(reading));
        
        request.onsuccess = (e: any) => {
          const cursor = e.target.result;
          if (cursor) {
            const val = cursor.value;
            if (installedTitles.has(val.dictionary) && !disabledDicts.includes(val.dictionary)) {
              results!.push({
                term: val.term,
                reading: val.reading,
                definitions: val.definitions,
                tags: val.tags,
                dictionary: val.dictionary
              });
            }
            cursor.continue();
          } else {
            resolve();
          }
        };
        request.onerror = reject;
      });
    }
    
    const freqs = await getFrequenciesForWord(word);
    const pitches = await getPitchesForWord(word);
    
    if (results.length > 0) {
      // Sort results by dictionaryOrder
      if (dictOrder.length > 0) {
        results.sort((a, b) => {
          const idxA = dictOrder.indexOf(a.dictionary);
          const idxB = dictOrder.indexOf(b.dictionary);
          if (idxA === -1 && idxB === -1) return 0;
          if (idxA === -1) return 1;
          if (idxB === -1) return -1;
          return idxA - idxB;
        });
      }

      const combinedDefs: string[] = [];
      const fullDefinitions: { dictionary: string; glossary: string; partsOfSpeech?: string[] }[] = [];
      const tagsSet = new Set<string>();

      // Helpers to classify definitions by language
      const SPA_DIACRITICS = /[áéíóúüñÁÉÍÓÚÜÑ¿¡]/u;
      const SPA_WORDS = /\b(de|del|el|la|los|las|en|un|una|unos|unas|con|por|para|que|es|son|su|sus|se|al|como|más|no|si|lo|le|les|muy|también|pero|cuando|este|esta|estos|estas|fue|ser|hay|ya|porque|aunque|donde|mientras|entre)\b/i;
      const ENG_WORDS = /\b(the|of|to|and|a|in|is|for|on|with|as|by|at|an|be|this|that|from|it|are|or|if|but|after|before|during|while|have|has|had|not|also|can|will|its|was|were|been|one|two|three|four|five|used|made|when|which|who|what|where|how)\b/i;

      const isSpanish = (text: string) => SPA_DIACRITICS.test(text) || SPA_WORDS.test(text);
      const isEnglish = (text: string) => !SPA_DIACRITICS.test(text) && ENG_WORDS.test(text) && !SPA_WORDS.test(text);

      results.forEach(res => {
        let resPos: string[] = [];
        if (res.tags) {
          resPos = res.tags.split(' ').filter((t: string) => t.length > 0);
          resPos.forEach((t: string) => tagsSet.add(t));
        }

        const defs = res.definitions.map(cleanDefinition).filter(Boolean);

        // Check if this entry has at least one Spanish definition
        const hasSpanish = defs.some(isSpanish);

        const targetDefs = hasSpanish 
          ? defs.filter((d: string) => !isEnglish(d))
          : defs;

        const finalDefs = targetDefs.length > 0 ? targetDefs : defs;

        finalDefs.forEach((d: string) => {
          combinedDefs.push(d);
          fullDefinitions.push({
            dictionary: res.dictionary || 'Glosario',
            glossary: d,
            partsOfSpeech: resPos
          });
        });
      });
      
      const posTags = [...tagsSet].slice(0, 3);
      const finalResult = {
        word: results[0].term,
        reading: results[0].reading || reading,
        definitions: combinedDefs.slice(0, 5), // Limit definitions returned to UI to save RAM
        fullDefinitions: fullDefinitions.slice(0, 5),
        partsOfSpeech: posTags.length > 0 ? posTags : [],
        frequencies: freqs,
        pitches: pitches,
        isFromYomitan: true
      };
      
      results.length = 0; 
      results = null;
      tagsSet.clear();

      // Guardar en caché para futuras páginas
      _searchCache.set(cacheKey, finalResult);
      return finalResult;
    }
    
    if (freqs.length > 0 || pitches.length > 0) {
      const finalResult = {
        word,
        reading: reading || '',
        definitions: [],
        fullDefinitions: [],
        partsOfSpeech: [],
        frequencies: freqs,
        pitches: pitches,
        isFromYomitan: true
      };
      results.length = 0;
      results = null;
      _searchCache.set(cacheKey, finalResult);
      return finalResult;
    }
    
    results.length = 0;
    results = null;
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
    
    return dictionaries;
  } catch (err) {
    console.error('Error exporting dictionary to zip:', err);
    throw err;
  }
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
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FREQS, 'readonly');
    const store = tx.objectStore(STORE_FREQS);
    const index = store.index('dictionary');
    const request = index.openCursor(IDBKeyRange.only(dictName));
    const words = new Set<string>();
    
    request.onsuccess = (e: any) => {
      const cursor = e.target.result;
      if (cursor) {
        const val = cursor.value;
        const rank = Number(val.value);
        if (!isNaN(rank) && rank > 0 && rank <= maxRank) {
          if (val.term) words.add(val.term);
        }
        cursor.continue();
      } else {
        resolve([...words]);
      }
    };
    
    request.onerror = (e: any) => {
      reject(e.target.error || new Error('Failed to query frequencies'));
    };
  });
}
