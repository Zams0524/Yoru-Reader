// Japanese tokenization and furigana alignment utility

declare global {
  interface Window {
    kuromoji: any;
  }
}

let tokenizerInstance: any = null;
let initPromise: Promise<any> | null = null;

/** Returns the shared Kuromoji instance after initTokenizer() has completed. */
export function getTokenizerInstance(): any {
  return tokenizerInstance;
}

// Initialize the Kuromoji tokenizer
export function initTokenizer(): Promise<any> {
  if (initPromise) return initPromise;
  
  initPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error("This library can only run in a browser environment."));
      return;
    }
    
    // Check if kuromoji script tag is loaded
    if (!window.kuromoji) {
      let checkCount = 0;
      const interval = setInterval(() => {
        if (window.kuromoji) {
          clearInterval(interval);
          build();
        } else {
          checkCount++;
          if (checkCount > 50) { // 5 seconds max
            clearInterval(interval);
            reject(new Error("Kuromoji.js library did not load from the bundled app files."));
          }
        }
      }, 100);
    } else {
      build();
    }
    
    function build() {
      window.kuromoji.builder({
        dicPath: "dict/"
      }).build((err: any, tokenizer: any) => {
        if (err) {
          console.error("Error building kuromoji tokenizer:", err);
          reject(err);
        } else {
          tokenizerInstance = tokenizer;
          resolve(tokenizer);
        }
      });
    }
  });

  // A failed first load (for example while packaged dictionary assets are still
  // starting) must not permanently prevent a retry.
  const pending = initPromise;
  pending.catch(() => {
    if (initPromise === pending) initPromise = null;
  });
  
  return pending;
}

// Convert Katakana to Hiragana
export function katakanaToHiragana(src: string): string {
  if (!src) return '';
  return src.replace(/[\u30a1-\u30f6]/g, function (match) {
    const chr = match.charCodeAt(0) - 0x60;
    return String.fromCharCode(chr);
  });
}

// Check if character is Kanji
export function isKanji(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (code >= 0x4e00 && code <= 0x9faf) || (code >= 0x3400 && code <= 0x4dbf);
}

// Check if character is Kana
export function isKana(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (code >= 0x3040 && code <= 0x309f) || (code >= 0x30a0 && code <= 0x30ff);
}

// Check if string contains Kanji
export function hasKanji(str: string): boolean {
  if (!str) return false;
  for (let i = 0; i < str.length; i++) {
    if (isKanji(str[i])) return true;
  }
  return false;
}

export interface FuriganaAlignment {
  type: 'kana' | 'kanji';
  text: string;
  ruby?: string;
}

// Align kanji surface form with reading to generate furigana splits
export function alignFurigana(surface: string, reading: string): FuriganaAlignment[] | null {
  if (!surface || !reading) return null;
  
  // If no kanji, no alignment needed
  if (!hasKanji(surface)) {
    return [{ type: 'kana', text: surface }];
  }

  function align(sIndex: number, rIndex: number): FuriganaAlignment[] | null {
    if (sIndex === surface.length && rIndex === reading.length) return [];
    if (sIndex === surface.length || rIndex === reading.length) return null;

    const sChar = surface[sIndex];
    const sCharHira = isKana(sChar) ? katakanaToHiragana(sChar) : sChar;
    const rChar = reading[rIndex];

    // If matches kana-to-kana
    if (isKana(sChar) && sCharHira === rChar) {
      const sub = align(sIndex + 1, rIndex + 1);
      if (sub) {
        return [{ type: 'kana', text: sChar }, ...sub];
      }
    }

    // If Kanji block
    if (isKanji(sChar)) {
      let kanjiBlock = "";
      let k = sIndex;
      while (k < surface.length && isKanji(surface[k])) {
        kanjiBlock += surface[k];
        k++;
      }

      // Try consuming different lengths of the reading string
      for (let len = 1; len <= reading.length - rIndex; len++) {
        const readingPart = reading.slice(rIndex, rIndex + len);
        const sub = align(k, rIndex + len);
        if (sub) {
          return [{ type: 'kanji', text: kanjiBlock, ruby: readingPart }, ...sub];
        }
      }
    }

    return null;
  }

  const result = align(0, 0);
  
  // Fallback if alignment algorithm fails on irregular combinations
  if (!result) {
    return [{ type: 'kanji', text: surface, ruby: reading }];
  }
  
  return result;
}

export interface EncodedTextSegment {
  type: 'text' | 'ruby';
  content?: string;
  text?: string;
  ruby?: string;
}

// Decode encoded ruby segments from stored markup (e.g. "{日本|にほん}")
export function parseEncodedText(text: string): EncodedTextSegment[] {
  const regex = /\{([^|]+)\|([^}]+)\}/g;
  const segments: EncodedTextSegment[] = [];
  let lastIndex = 0;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    const textBefore = text.slice(lastIndex, match.index);
    if (textBefore) {
      segments.push({ type: 'text', content: textBefore });
    }
    segments.push({ type: 'ruby', text: match[1], ruby: match[2] });
    lastIndex = regex.lastIndex;
  }
  
  const textAfter = text.slice(lastIndex);
  if (textAfter) {
    segments.push({ type: 'text', content: textAfter });
  }
  
  return segments;
}

export interface TokenInfo {
  surface: string;
  reading?: string;
  basicForm?: string;
  pos?: string;
  alignment?: FuriganaAlignment[];
  isWord?: boolean;
  isPunctuation?: boolean;
  isLineBreak?: boolean;
  type?: string;
  src?: string;
  isImage?: boolean;
}

// Tokenize text into paragraphs of tokenized words, handling unified ruby tokens
export async function tokenizeText(text: string): Promise<TokenInfo[][]> {
  const tokenizer = await initTokenizer();
  if (!text) return [];
  
  const paragraphs = text.split(/\r?\n/);
  const resultParagraphs: TokenInfo[][] = [];
  
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      // Empty line placeholder
      resultParagraphs.push([{ surface: '', isLineBreak: true }]);
      continue;
    }
    
    // Intercept image tokens
    if (trimmed.startsWith('{img:') && trimmed.endsWith('}')) {
      const src = trimmed.substring(5, trimmed.length - 1);
      resultParagraphs.push([{
        type: 'image',
        src: src,
        isImage: true,
        surface: ''
      }]);
      continue;
    }
    
    // 1. Reconstruct plain text and extract original rubies with offsets
    let plainText = "";
    const originalRubies = [];
    const regex = /\{([^|]+)\|([^}]+)\}/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(para)) !== null) {
      plainText += para.slice(lastIndex, match.index);
      const start = plainText.length;
      plainText += match[1];
      const end = plainText.length;
      originalRubies.push({ start, end, text: match[1], ruby: match[2] });
      lastIndex = regex.lastIndex;
    }
    plainText += para.slice(lastIndex);
    
    // 2. Tokenize plain text as a single string for full context
    let rawTokens: any[] = [];
    try {
      rawTokens = tokenizer.tokenize(plainText);
    } catch (e) {
      console.error("Kuromoji tokenization failed for paragraph:", plainText, e);
      resultParagraphs.push([{
        surface: plainText,
        reading: '',
        basicForm: plainText,
        pos: 'UNK',
        alignment: [{ type: 'kana', text: plainText }],
        isWord: false,
        isPunctuation: false
      }]);
      continue;
    }
    
    // Pre-calculate character ranges for each raw token
    let tempIdx = 0;
    const rawTokensWithRanges = rawTokens.map(token => {
      const start = tempIdx;
      const end = start + token.surface_form.length;
      tempIdx = end;
      return { token, start, end };
    });
    
    const processedTokens: TokenInfo[] = [];
    let tokenIdx = 0;
    
    // 3. Map/merge tokens based on overlapping original rubies
    while (tokenIdx < rawTokensWithRanges.length) {
      const current = rawTokensWithRanges[tokenIdx];
      
      // Look for a ruby block that starts at or before this token and overlaps it
      const matchingRuby = originalRubies.find(r => r.start <= current.start && r.end > current.start);
      
      if (matchingRuby) {
        // Collect all tokens that fall inside this ruby block
        const tokensInRuby = [];
        let j = tokenIdx;
        while (j < rawTokensWithRanges.length && rawTokensWithRanges[j].start < matchingRuby.end) {
          tokensInRuby.push(rawTokensWithRanges[j]);
          j++;
        }
        
        const mergedSurface = matchingRuby.text;
        const mergedReading = matchingRuby.ruby;
        
        const firstContentToken = tokensInRuby.find(t => t.token.pos !== '記号') || tokensInRuby[0];
        const pos = firstContentToken.token.pos;
        const basicForm = firstContentToken.token.basic_form && firstContentToken.token.basic_form !== '*' 
          ? firstContentToken.token.basic_form 
          : firstContentToken.token.surface_form;
        
        const CONTENT_WORD_POS = ['名詞', '動詞', '形容詞', '副詞', '連体詞', '代名詞', '感動詞'];
        const isWord = CONTENT_WORD_POS.includes(pos);
        
        processedTokens.push({
          surface: mergedSurface,
          reading: mergedReading,
          basicForm: basicForm,
          pos: pos,
          alignment: [{ type: 'kanji', text: mergedSurface, ruby: mergedReading }],
          isWord,
          isPunctuation: false
        });
        
        tokenIdx = j;
      } else {
        const { token, start, end } = current;
        const surface = token.surface_form;
        const katakanaReading = token.reading || '';
        const hiraganaReading = katakanaToHiragana(katakanaReading) || surface;
        
        let alignment: FuriganaAlignment[] = [];
        if (hasKanji(surface)) {
          const aligned = alignFurigana(surface, hiraganaReading);
          alignment = aligned || [{ type: 'kanji', text: surface, ruby: hiraganaReading }];
        } else {
          alignment = [{ type: 'kana', text: surface }];
        }
        
        const CONTENT_WORD_POS = ['名詞', '動詞', '形容詞', '副詞', '連体詞', '代名詞', '感動詞'];
        const isWord = CONTENT_WORD_POS.includes(token.pos);
        
        processedTokens.push({
          surface,
          reading: hiraganaReading,
          basicForm: token.basic_form && token.basic_form !== '*' ? token.basic_form : surface,
          pos: token.pos,
          alignment,
          isWord,
          isPunctuation: token.pos === '記号'
        });
        
        tokenIdx++;
      }
    }
    
    resultParagraphs.push(processedTokens);
  }
  
  return resultParagraphs;
}

export interface ExtensionToken {
  start: number;
  end: number;
  wordId: string | null;
  readingIndex: number;
}

export interface ExtensionVocabulary {
  wordId: string;
  readingIndex: number;
  spelling: string;
  reading: string;
  frequencyRank: number;
  partsOfSpeech: string[];
  meaningsChunks: string[][];
  meaningsPartOfSpeech: string[][];
  knownState: number[];
  pitchAccents: string[];
  studyDeckIds: any[];
}

export interface ExtensionParseResult {
  tokens: ExtensionToken[][];
  vocabulary: ExtensionVocabulary[];
}

export async function parseExtensionText(paragraphs: string[], wordStatuses?: Record<string, string>): Promise<ExtensionParseResult> {
  const tokenizer = await initTokenizer();
  
  const tokens: ExtensionToken[][] = [];
  const vocabularyMap = new Map<string, ExtensionVocabulary>();
  const statuses = wordStatuses || {};
  
  for (const para of paragraphs) {
    if (!para) {
      tokens.push([]);
      continue;
    }
    
    let rawTokens: any[] = [];
    try {
      rawTokens = tokenizer.tokenize(para);
    } catch (e) {
      console.error("Local tokenization failed for paragraph:", para, e);
      tokens.push([]);
      continue;
    }
    
    const paraTokens: ExtensionToken[] = [];
    let tempIdx = 0;
    
    for (const rawToken of rawTokens) {
      const surface = rawToken.surface_form;
      const start = tempIdx;
      const end = start + surface.length;
      tempIdx = end;
      
      const pos = rawToken.pos;
      const isPunc = pos === '記号';
      
      let wordId: string | null = null;
      if (!isPunc) {
        const basicForm = rawToken.basic_form && rawToken.basic_form !== '*' ? rawToken.basic_form : surface;
        const katakanaReading = rawToken.reading || '';
        const reading = katakanaToHiragana(katakanaReading) || surface;
        
        const key = `${basicForm}:${reading}`;
        wordId = key;
        
        if (!vocabularyMap.has(key)) {
          const status = statuses[basicForm] || 'new';
          let knownState = [0];
          if (status === 'known') knownState = [2];
          else if (status === 'learning') knownState = [1];
          else if (status === 'ignored') knownState = [3];
          
          vocabularyMap.set(key, {
            wordId: key,
            readingIndex: 0,
            spelling: basicForm,
            reading: reading,
            frequencyRank: 999999,
            partsOfSpeech: [pos],
            meaningsChunks: [[]],
            meaningsPartOfSpeech: [[]],
            knownState,
            pitchAccents: [],
            studyDeckIds: []
          });
        }
      }
      
      if (wordId) {
        paraTokens.push({
          start,
          end,
          wordId,
          readingIndex: 0
        });
      }
    }
    
    tokens.push(paraTokens);
  }
  
  return {
    tokens,
    vocabulary: Array.from(vocabularyMap.values())
  };
}
