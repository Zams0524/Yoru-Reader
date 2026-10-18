import { searchYomitanDB } from './yomitanDB';

// Japanese-English Dictionary Utility

export interface DictionaryEntry {
  word: string;
  reading: string;
  partsOfSpeech: string[];
  definitions: (string | DictionaryDefinition)[];
  isFromYomitan?: boolean;
  isFromJisho?: boolean;
  isFallback?: boolean;
  frequencies?: any[];
  pitches?: any[];
}

export interface DictionaryDefinition {
  dictionary?: string;
  glossary: string;
  partsOfSpeech?: string[];
}

const JITEN_CACHE = new Map<string, DictionaryEntry>();

// Look up a word (first in local database, then on Jiten.moe API via CORS proxy)
export async function lookupWord(word: string, reading: string = ''): Promise<DictionaryEntry | null> {
  // 1. Clean the word: remove trailing particles or spaces
  const cleanWord = word.trim();
  if (!cleanWord) return null;

  // Split spelling and reading if formatted as spelling:reading (Yomitan key format)
  let searchWord = cleanWord;
  let searchReading = reading;
  if (cleanWord.includes(':')) {
    const parts = cleanWord.split(':');
    searchWord = parts[0].trim();
    searchReading = parts[1]?.trim() || reading;
  }
  const cacheKey = `${searchWord}\u0000${searchReading}`;

  let entry: DictionaryEntry | null = null;

  // 2. Prioritize Yomitan DB (IndexedDB) first, so user's installed dictionaries (Spanish, etc.) take precedence!
  // We use a 1.5-second timeout to prevent any IndexedDB locks/upgrades from hanging the UI
  try {
    const yomitanPromise = searchYomitanDB(searchWord, searchReading);
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
    
    const yomitanMatch = await Promise.race([yomitanPromise, timeoutPromise]) as any;
    if (yomitanMatch) {
      entry = {
        ...yomitanMatch,
        definitions: yomitanMatch.fullDefinitions || yomitanMatch.definitions
      };
    }
  } catch (err) {
    console.error('Yomitan DB search error:', err);
  }

  // 3. Fallback to Jiten online definitions if Yomitan DB found nothing OR returned empty definitions
  if (!entry || !entry.definitions || entry.definitions.length === 0) {
    let jitenEntry: DictionaryEntry | null = null;
    if (JITEN_CACHE.has(cacheKey)) {
      jitenEntry = { ...JITEN_CACHE.get(cacheKey)! };
    } else {
      try {
        const jitenUrl = `https://api.jiten.moe/api/vocabulary/search?query=${encodeURIComponent(searchWord)}`;
        const directController = new AbortController();
        const directId = setTimeout(() => directController.abort(), 2500);
        let fetchedJson: any = null;
        try {
          const response = await fetch(jitenUrl, { signal: directController.signal });
          clearTimeout(directId);
          if (!response.ok) throw new Error(`Jiten returned HTTP ${response.status}`);
          fetchedJson = await response.json();
        } catch {
          clearTimeout(directId);
          const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(jitenUrl)}`;
          const proxyController = new AbortController();
          const proxyId = setTimeout(() => proxyController.abort(), 2500);
          try {
            const response = await fetch(proxyUrl, { signal: proxyController.signal });
            clearTimeout(proxyId);
            if (response.ok) {
              const json = await response.json();
              fetchedJson = JSON.parse(json.contents);
            }
          } catch {
            clearTimeout(proxyId);
          }
        }
        
        if (fetchedJson && Array.isArray(fetchedJson.results) && fetchedJson.results.length > 0) {
          const definitions: any[] = [];
          const results = [...fetchedJson.results];
          if (searchReading) {
            results.sort((a: any, b: any) => Number(b.rubyText === searchReading) - Number(a.rubyText === searchReading));
          }
          results.slice(0, 4).forEach((res: any) => {
            if (res.meanings && res.meanings.length > 0) {
              res.meanings.forEach((m: string) => {
                definitions.push({
                  dictionary: 'Jiten',
                  glossary: m,
                  partsOfSpeech: res.partsOfSpeech || []
                });
              });
            }
          });
          
          if (definitions.length > 0) {
            const match = fetchedJson.results[0];
            jitenEntry = {
              word: match.text || searchWord,
              reading: match.rubyText || '',
              definitions: definitions.slice(0, 5),
              partsOfSpeech: match.partsOfSpeech || [],
              isFromJisho: false
            };
            
            JITEN_CACHE.set(cacheKey, jitenEntry);
          }
        }
      } catch (error) {
        console.warn('Jiten API lookup failed.', error);
      }
    }

    if (jitenEntry) {
      if (entry) {
        entry.definitions = jitenEntry.definitions;
        if (!entry.reading) entry.reading = jitenEntry.reading;
      } else {
        entry = jitenEntry;
      }
    }
  }

  // Fallback if nothing is found at all
  if (!entry) {
    entry = {
      word: searchWord,
      reading: searchReading || '',
      partsOfSpeech: ['Unknown'],
      definitions: ['No se encontraron definiciones en el diccionario local. Pulsa Buscar en Jiten para una búsqueda online.'],
      isFallback: true
    };
  }

  return entry;
}
