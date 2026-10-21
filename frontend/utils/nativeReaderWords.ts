import { renderLineWords, sanitizeJapaneseText, jitenTextOfLine, type Book } from '../components/reader/ReaderEngine';
import { getTokenizerInstance, initTokenizer, katakanaToHiragana } from './japanese';
import { furiganaFromReading, getStatusClass } from './yoruParserNative';
import { getCachedJitenTokens, isJitenParserEnabled } from './jitenSync';
import type { WordEffect, WordStyleThemeConfig } from './parserSettingsStore';

/**
 * Word states in the native reader. The engine cannot run Yoru's parser, so the book is exported
 * with its words already marked: one span per word whose class is its state (w-new, w-young, …),
 * styled by CSS made from the word-style settings.
 *
 * The slow part, splitting every line into words (Kuromoji), does not depend on the states: it is
 * done once per book and kept in IndexedDB (analyseBookWords). Marking the states is then plain
 * string building (renderBookWords), so opening a book, or a state change while reading, never
 * waits for the parser. Lines Jiten has parsed (when its parser is on) use the WebView reader's
 * own rendering instead, with Jiten's words and states.
 */

/** Escaped text, or a word: surface, dictionary form, reading, and the book's own ruby if any. */
type Piece = string | { s: string; b: string; r: string; ruby?: string };
export type BookWords = Map<string, Piece[]>;

/** Bumped when analyse() changes: cached analyses are redone. */
const ANALYSIS_VERSION = 1;
const JAPANESE = /[぀-ヿ㐀-䶿一-鿿]/;
const memoryCache = new WeakMap<Book, BookWords>();

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Words of one text (after sanitizeJapaneseText, so book ruby is <ruby> markup), as tokenizeJapaneseText splits them. */
function analyse(tokenizer: any, text: string): Piece[] {
  const pieces: Piece[] = [];
  for (const part of text.split(/(<ruby\b[^>]*>[\s\S]*?<\/ruby>)/gi)) {
    if (!part) continue;
    const ruby = /^<ruby\b[^>]*>([\s\S]*?)<\/ruby>$/i.exec(part);
    if (ruby) {
      const reading = Array.from(ruby[1].matchAll(/<rt\b[^>]*>([\s\S]*?)<\/rt>/gi)).map((m) => m[1]).join('').replace(/<[^>]*>/g, '');
      const surface = ruby[1].replace(/<rt\b[^>]*>[\s\S]*?<\/rt>|<rp\b[^>]*>[\s\S]*?<\/rp>/gi, '').replace(/<[^>]*>/g, '');
      if (!surface) continue;
      pieces.push({ s: surface, b: surface, r: reading, ruby: reading ? `<ruby>${escapeText(surface)}<rt>${escapeText(reading)}</rt></ruby>` : undefined });
      continue;
    }
    for (const token of tokenizer.tokenize(part)) {
      const surface: string = token.surface_form || '';
      if (token.pos === '記号' || !JAPANESE.test(surface)) {
        pieces.push(escapeText(surface));
        continue;
      }
      const base = token.basic_form && token.basic_form !== '*' ? token.basic_form : surface;
      pieces.push({ s: surface, b: base, r: katakanaToHiragana(token.reading || '') || surface });
    }
  }
  return pieces;
}

/** Lines that carry words: headings and ordinary lines (not empty lines or pictures). */
function hasWords(line: string): boolean {
  return !!line.trim() && !(line.startsWith('{img:') && line.endsWith('}'));
}

function wordText(line: string): string {
  return /^\{h[123]:/.test(line) && line.endsWith('}') ? line.substring(4, line.length - 1) : line;
}

function bookFingerprint(book: Book): string {
  let hash = 0x811c9dc5;
  for (const chapter of book.chapters || []) {
    const text = chapter.content || '';
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return `${String(book.id)}:${(hash >>> 0).toString(36)}:v${ANALYSIS_VERSION}`;
}

// ── IndexedDB cache (one analysis per book) ────────────────────────────

const DB_NAME = 'yoru-native-reader';
const STORE = 'words';

function openCache(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readCached(book: Book, fingerprint: string): Promise<BookWords | null> {
  const dbase = await openCache();
  if (!dbase) return null;
  return new Promise((resolve) => {
    const request = dbase.transaction(STORE, 'readonly').objectStore(STORE).get(String(book.id));
    request.onsuccess = () => {
      const value = request.result;
      resolve(value && value.fingerprint === fingerprint && Array.isArray(value.entries) ? new Map(value.entries) : null);
      dbase.close();
    };
    request.onerror = () => { resolve(null); dbase.close(); };
  });
}

async function writeCached(book: Book, fingerprint: string, words: BookWords): Promise<void> {
  const dbase = await openCache();
  if (!dbase) return;
  await new Promise<void>((resolve) => {
    const transaction = dbase.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put({ fingerprint, entries: Array.from(words.entries()) }, String(book.id));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
  });
  dbase.close();
}

/**
 * Words of every line of the book: from memory or IndexedDB if this text was analysed before,
 * otherwise with Kuromoji in slices (onProgress gets 0..1) and saved. Null if the parser is not
 * available or isCancelled() turned true.
 */
export async function analyseBookWords(
  book: Book,
  onProgress: (fraction: number) => void,
  isCancelled: () => boolean,
): Promise<BookWords | null> {
  const known = memoryCache.get(book);
  if (known) return known;
  const fingerprint = bookFingerprint(book);
  const cached = await readCached(book, fingerprint);
  if (cached) {
    memoryCache.set(book, cached);
    return cached;
  }
  try {
    await initTokenizer();
  } catch {
    return null;
  }
  const tokenizer = getTokenizerInstance();
  if (!tokenizer || isCancelled()) return null;
  const lines = new Set<string>();
  for (const chapter of book.chapters || []) {
    for (const line of (chapter.content || '').split(/\r?\n/)) if (hasWords(line)) lines.add(line);
  }
  const words: BookWords = new Map();
  let done = 0;
  let sliceStart = performance.now();
  for (const line of lines) {
    const pieces: Piece[] = [];
    // Inline images are kept apart; only the text around them is analysed.
    for (const chunk of wordText(line).split(/(\{img:[^{}]+\})/i)) {
      if (!chunk) continue;
      if (/^\{img:[^{}]+\}$/i.test(chunk)) pieces.push(chunk);
      else pieces.push(...analyse(tokenizer, sanitizeJapaneseText(chunk)));
    }
    words.set(line, pieces);
    done++;
    if (performance.now() - sliceStart > 40) {
      onProgress(done / lines.size);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      if (isCancelled()) return null;
      sliceStart = performance.now();
    }
  }
  memoryCache.set(book, words);
  void writeCached(book, fingerprint, words);
  return words;
}

// ── States ─────────────────────────────────────────────────────────────

// The most telling state wins when a word has several (Jiten: "new frequent").
const STATE_ORDER: [string, string][] = [
  ['due', 'due'],
  ['young', 'young'], ['learning', 'young'],
  ['new', 'new'],
  ['blacklisted', 'blacklisted'], ['ignored', 'blacklisted'], ['suspended', 'blacklisted'],
  ['mature', 'mature'], ['known', 'mature'], ['mastered', 'mature'],
];

function stateOfClasses(classes: DOMTokenList): string {
  for (const [cls, state] of STATE_ORDER) if (classes.contains(cls)) return state;
  return 'mature';
}

/** Short state of a local status, as getStatusClass names it ("new", "young", "mature", "due", "blacklisted"). */
function stateOfStatus(status: string | undefined): string {
  const cls = getStatusClass(status).split(' ').pop() || 'new';
  return cls === 'mastered' ? 'mature' : cls;
}

const KEPT = new Set(['span', 'ruby', 'rb', 'rt', 'rp', 'img', 'br']);

/** The WebView markup of a line (Jiten) as engine XHTML: state spans, ruby, nothing else. */
function toEngineMarkup(html: string, holder: HTMLElement): string {
  holder.innerHTML = html;
  const clean = (element: Element) => {
    for (const child of Array.from(element.children)) {
      const tag = child.tagName.toLowerCase();
      if (!KEPT.has(tag)) {
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      const state = child.classList.contains('jiten-word') ? stateOfClasses(child.classList) : null;
      const src = tag === 'img' ? child.getAttribute('src') : null;
      for (const attr of Array.from(child.attributes)) child.removeAttribute(attr.name);
      if (state) child.setAttribute('class', `w-${state}`);
      if (src) child.setAttribute('src', src);
      clean(child);
    }
  };
  clean(holder);
  const serializer = new XMLSerializer();
  return Array.from(holder.childNodes)
    .map((node) => serializer.serializeToString(node))
    .join('')
    .replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
}

/**
 * Engine markup of every line with words, by line text, as the WebView reader marks them: state
 * from wordStatuses (dictionary form first), furigana on new words when that setting is on, and
 * Jiten's rendering for the lines it has parsed. Inline {img:} chunks are left for the export.
 */
export function renderBookWords(
  words: BookWords,
  statuses: Record<string, string>,
  furiganaOnNew: boolean,
): Map<string, string> {
  const holder = document.createElement('div');
  const jiten = isJitenParserEnabled();
  const lines = new Map<string, string>();
  for (const [line, pieces] of words) {
    const jitenText = jiten ? jitenTextOfLine(line) : '';
    if (jitenText && getCachedJitenTokens(jitenText)) {
      lines.set(line, toEngineMarkup(renderLineWords(line, statuses), holder));
      continue;
    }
    let html = '';
    for (const piece of pieces) {
      if (typeof piece === 'string') {
        html += piece;
        continue;
      }
      const state = stateOfStatus(statuses[piece.b] || statuses[piece.s]);
      const inner = piece.ruby
        || (furiganaOnNew && state === 'new' && furiganaFromReading(piece.s, piece.r))
        || escapeText(piece.s);
      html += `<span class="w-${state}">${inner}</span>`;
    }
    lines.set(line, html);
  }
  return lines;
}

// ── Engine CSS ─────────────────────────────────────────────────────────

function hexOf(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

function parseHex(colour: string): number | null {
  const hex = colour.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex.slice(0, 6);
  const value = parseInt(full, 16);
  return Number.isNaN(value) || full.length !== 6 ? null : value;
}

/** a over b with alpha (the engine has no transparency for text and backgrounds). */
function blend(a: number, b: number, alpha: number): number {
  const mix = (shift: number) => Math.round(((a >> shift) & 255) * alpha + ((b >> shift) & 255) * (1 - alpha));
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/** A colour that differs from base by k in the blue channel: invisible, but exact in the page pixels. */
function marker(base: number, k: number): number {
  const blue = base & 255;
  return (base & 0xffff00) | (blue + k <= 255 ? blue + k : blue - k);
}

/** An underline the plugin draws itself under the words whose background is `background`. */
export interface EngineUnderline {
  background: number;
  color: number;
  /** CSS px. */
  thickness: number;
  style: 'solid' | 'dotted' | 'dashed' | 'wavy';
}

const ENGINE_STATES = ['new', 'young', 'mature', 'due', 'blacklisted'];

/**
 * Engine CSS for the word states from the word-style settings. Text colour and background
 * (blended with the page) are plain CSS; opacity becomes a colour faded towards the page; shadows
 * have no equivalent. The engine draws underlines only one pixel thick, in the text colour, and
 * through the furigana, so underlines are not CSS: each underlined state gets a background that
 * differs from the page (or from its own background) by an invisible step, and the plugin finds
 * those words in the page pixels and draws the underline with its colour, thickness and style.
 */
export function engineWordCss(config: WordStyleThemeConfig, textColor: number, backgroundColor: number): { css: string; underlines: EngineUnderline[] } {
  const rules: string[] = [];
  const underlines: EngineUnderline[] = [];
  ENGINE_STATES.forEach((state, index) => {
    const effects: WordEffect[] = config?.states?.[state]?.effects || [];
    let color: number | null = null;
    let background: number | null = null;
    let underline: WordEffect | undefined;
    for (const effect of effects) {
      if (effect.type === 'text-colour' && effect.colour) color = parseHex(effect.colour);
      if (effect.type === 'underline') underline = effect;
      if (effect.type === 'background' && effect.colour) {
        const bg = parseHex(effect.colour);
        if (bg !== null) background = blend(bg, backgroundColor, effect.opacity ?? 1);
      }
    }
    const opacity = effects.find((e) => e.type === 'opacity' && !e.hoverOnly && e.value !== undefined)?.value;
    if (opacity !== undefined) color = blend(color ?? textColor, backgroundColor, opacity);
    if (underline) {
      background = marker(background ?? backgroundColor, index + 1);
      underlines.push({
        background,
        color: (underline.colour && parseHex(underline.colour)) ?? color ?? textColor,
        thickness: underline.thickness || 2,
        style: underline.style || 'solid',
      });
    }
    const css: string[] = [];
    if (color !== null) css.push(`color:${hexOf(color)}`);
    if (background !== null) css.push(`background-color:${hexOf(background)}`);
    if (css.length) rules.push(`span.w-${state}{${css.join(';')}}`);
  });
  return { css: rules.join(''), underlines };
}
