import { getTokenizerInstance, initTokenizer, katakanaToHiragana } from './japanese';
import { getLocalParserSetting } from './parserSettingsStore';

export function getStatusClass(status?: string): string {
  if (status === 'known' || status === 'mature' || status === 'mastered') return 'jiten-word mature';
  if (status === 'learning' || status === 'young') return 'jiten-word young';
  if (status === 'due') return 'jiten-word due';
  if (status === 'ignored' || status === 'blacklisted') return 'jiten-word blacklisted';
  return 'jiten-word new';
}

const segmenter = typeof Intl !== 'undefined' && (Intl as any).Segmenter
  ? new (Intl as any).Segmenter('ja', { granularity: 'word' })
  : null;

interface NativeTokenAnalysis {
  surface: string;
  basicForm: string;
  reading: string;
  pos: string;
}

function escapeHtmlText(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char] as string));
}

// ── Furigana on new words ("Only add furigana to new words", as in the Jiten extension) ──

const KANJI_CLASS = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff々〆ヵヶ';
const KANJI_CHAR = new RegExp(`[${KANJI_CLASS}]`);
const KANJI_OR_KANA_RUNS = new RegExp(`[${KANJI_CLASS}]+|[^${KANJI_CLASS}]+`, 'g');

let furiganaOnNewWords = readFuriganaSetting();
function readFuriganaSetting(): boolean {
  const value = getLocalParserSetting('furiganaNewWords');
  return value === true || value === 'true';
}
if (typeof window !== 'undefined') {
  window.addEventListener('yoru-parser-settings-changed', () => { furiganaOnNewWords = readFuriganaSetting(); });
}

export function isFuriganaOnNewWords(): boolean {
  return furiganaOnNewWords;
}

const rubyHtml = (base: string, reading: string) =>
  `<ruby>${escapeHtmlText(base)}<rt class="jiten-furi">${escapeHtmlText(reading)}</rt></ruby>`;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Furigana from the kana reading of `surface` itself (Kuromoji): kanji get ruby, okurigana stays plain. */
export function furiganaFromReading(surface: string, reading: string): string | null {
  if (!reading || !KANJI_CHAR.test(surface)) return null;
  const parts = surface.match(KANJI_OR_KANA_RUNS) || [];
  const pattern = parts.map((part) => (KANJI_CHAR.test(part[0]) ? '(.+?)' : escapeRegex(katakanaToHiragana(part)))).join('');
  const match = katakanaToHiragana(reading).match(new RegExp(`^${pattern}$`));
  if (!match) return null;
  let group = 1;
  return parts.map((part) => (KANJI_CHAR.test(part[0]) ? rubyHtml(part, match[group++]) : escapeHtmlText(part))).join('');
}

/** Kanji run → kana pairs from Jiten's annotated reading, e.g. "食[た]べる" → [["食", "た"]]. */
export function furiganaPairsFromAnnotated(annotated: string): [string, string][] {
  const pairs: [string, string][] = [];
  for (const match of (annotated || '').matchAll(/([^[\]]+?)\[([^\]]+)\]/g)) {
    const run = match[1].match(new RegExp(`[${KANJI_CLASS}]+$`));
    if (run) pairs.push([run[0], match[2]]);
  }
  return pairs;
}

/** Furigana for a surface (which may be conjugated) from the dictionary form's kanji readings. */
function furiganaFromPairs(surface: string, pairs: [string, string][]): string | null {
  if (!pairs.length || !KANJI_CHAR.test(surface)) return null;
  const parts = surface.match(KANJI_OR_KANA_RUNS) || [];
  let html = '';
  for (const part of parts) {
    if (!KANJI_CHAR.test(part[0])) {
      html += escapeHtmlText(part);
      continue;
    }
    // A run may span several annotated pieces (日本[にほん]語[ご]); consume them in order.
    let rest = part;
    while (rest) {
      const pair = pairs.find(([base]) => rest.startsWith(base));
      if (!pair) return null;
      html += rubyHtml(pair[0], pair[1]);
      rest = rest.slice(pair[0].length);
    }
  }
  return html;
}

// Status changes should only repaint spans; they should not make Kuromoji parse every
// paragraph in the open book again. Keep a small LRU cache of morphology, not rendered HTML.
const TOKEN_CACHE_LIMIT = 300;
const MAX_CACHEABLE_TEXT_LENGTH = 20_000;
const tokenAnalysisCache = new Map<string, NativeTokenAnalysis[]>();

function tokenizeWithCache(tokenizer: any, text: string): NativeTokenAnalysis[] {
  const cached = tokenAnalysisCache.get(text);
  if (cached) {
    tokenAnalysisCache.delete(text);
    tokenAnalysisCache.set(text, cached);
    return cached;
  }

  const analysis = tokenizer.tokenize(text).map((token: any) => ({
    surface: token.surface_form || '',
    basicForm: token.basic_form && token.basic_form !== '*' ? token.basic_form : token.surface_form || '',
    reading: katakanaToHiragana(token.reading || '') || token.surface_form || '',
    pos: token.pos || ''
  }));

  if (text.length <= MAX_CACHEABLE_TEXT_LENGTH) {
    tokenAnalysisCache.set(text, analysis);
    if (tokenAnalysisCache.size > TOKEN_CACHE_LIMIT) {
      const oldestKey = tokenAnalysisCache.keys().next().value;
      if (oldestKey !== undefined) tokenAnalysisCache.delete(oldestKey);
    }
  }

  return analysis;
}

function readRubyMarkup(markup: string): { surface: string; reading: string; html: string } | null {
  if (!/^<ruby\b[\s\S]*<\/ruby>$/i.test(markup)) return null;

  if (typeof DOMParser !== 'undefined') {
    const parsed = new DOMParser().parseFromString(markup, 'text/html');
    const ruby = parsed.body.querySelector('ruby');
    if (ruby) {
      const reading = Array.from(ruby.querySelectorAll('rt'))
        .map(node => node.textContent || '')
        .join('')
        .trim();
      const base = ruby.cloneNode(true) as HTMLElement;
      base.querySelectorAll('rt, rp').forEach(node => node.remove());
      const surface = (base.textContent || '').trim();
      if (surface) {
        const children = Array.from(ruby.childNodes).map((node) => {
          if (node.nodeType === Node.TEXT_NODE) return escapeHtmlText(node.textContent || '');
          if (!(node instanceof Element)) return '';
          const tag = node.tagName.toLowerCase();
          if (tag === 'rb' || tag === 'rt' || tag === 'rp') {
            const content = escapeHtmlText(node.textContent || '');
            return tag === 'rt' ? `<rt class="jiten-furi">${content}</rt>` : `<${tag}>${content}</${tag}>`;
          }
          return escapeHtmlText(node.textContent || '');
        }).join('');
        return { surface, reading, html: `<ruby>${children}</ruby>` };
      }
    }
  }

  const simple = markup.match(/^<ruby\b[^>]*>([\s\S]*?)<rt\b[^>]*>([\s\S]*?)<\/rt>[\s\S]*<\/ruby>$/i);
  if (!simple) return null;
  const surface = simple[1].replace(/<[^>]*>/g, '').trim();
  const reading = simple[2].replace(/<[^>]*>/g, '').trim();
  return surface ? {
    surface,
    reading,
    html: `<ruby>${escapeHtmlText(surface)}<rt class="jiten-furi">${escapeHtmlText(reading)}</rt></ruby>`
  } : null;
}

function readImageSource(markup: string): string | null {
  if (!/^<img\b[^>]*>$/i.test(markup)) return null;
  if (typeof DOMParser !== 'undefined') {
    const parsed = new DOMParser().parseFromString(markup, 'text/html');
    return parsed.body.querySelector('img')?.getAttribute('src') || null;
  }
  return markup.match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2] || null;
}

/**
 * Fast tokenization and markup generation for Japanese text paragraphs
 * Handles both plain text and embedded <ruby> blocks.
 */
export function tokenizeJapaneseText(
  text: string,
  wordStatuses: Record<string, string> = {}
): string {
  if (!text) return '';

  // Keep ruby/image elements intact while parsing surrounding Japanese text.
  const parts = text.split(/(<ruby\b[^>]*>[\s\S]*?<\/ruby>|<img\b[^>]*>)/gi);
  const tokenizer = getTokenizerInstance();

  let resultHtml = '';
  const escapeText = escapeHtmlText;
  const escapeAttribute = escapeHtmlText;

  for (const part of parts) {
    if (!part) continue;

    // Preserve author-provided furigana, including rb/rp wrappers and ruby attributes.
    const rubyData = readRubyMarkup(part);
    if (rubyData) {
      const { surface: rawSurface, reading: rawReading, html } = rubyData;
      const status = wordStatuses[rawSurface] || 'new';
      const cls = getStatusClass(status);
      const ruby = rawReading ? html : escapeText(rawSurface);
      resultHtml += `<span class="${cls}" data-word="${escapeAttribute(rawSurface)}" data-reading="${escapeAttribute(rawReading)}" data-pos="名詞">${ruby}</span>`;
      continue;
    }

    const imageSource = readImageSource(part);
    if (imageSource !== null) {
      resultHtml += `<img src="${escapeAttribute(imageSource)}" style="max-width:100%; max-height:var(--reader-image-height,85vh); object-fit:contain; display:block; margin:1em auto;" />`;
      continue;
    }

    // Process plain text chunk with Kuromoji if available
    if (tokenizer) {
      try {
        const rawTokens = tokenizeWithCache(tokenizer, part);
        for (const token of rawTokens) {
          const surface = token.surface;
          const pos = token.pos;

          // Ignore punctuation and non-Japanese characters
          if (pos === '記号' || !/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(surface)) {
            resultHtml += escapeText(surface);
            continue;
          }

          const basicForm = token.basicForm || surface;
          const reading = token.reading || surface;
          const status = wordStatuses[basicForm] || wordStatuses[surface] || 'new';
          const cls = getStatusClass(status);

          const inner = (furiganaOnNewWords && cls === 'jiten-word new' && furiganaFromReading(surface, token.reading || '')) || escapeText(surface);
          resultHtml += `<span class="${cls}" data-word="${escapeAttribute(basicForm)}" data-reading="${escapeAttribute(reading)}" data-pos="${escapeAttribute(pos)}">${inner}</span>`;
        }
        continue;
      } catch (e) {
        console.warn('Tokenizer chunk error:', e);
      }
    }

    // High-performance Intl.Segmenter fallback
    if (segmenter) {
      const segments = segmenter.segment(part);
      for (const s of segments) {
        const seg = s.segment;
        if (!/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(seg)) {
          resultHtml += escapeText(seg);
          continue;
        }

        const status = wordStatuses[seg] || 'new';
        const cls = getStatusClass(status);
        resultHtml += `<span class="${cls}" data-word="${escapeAttribute(seg)}" data-pos="名詞">${escapeText(seg)}</span>`;
      }
      continue;
    }

    // Last-resort regex tokenizer
    const regex = /([\u4e00-\u9faf\u3400-\u4dbf々ー]+[\u3040-\u309f]*)|([\u30a0-\u30ff]+)|([\u3040-\u309f]+)|([^\u3040-\u30ff\u4e00-\u9faf\u3400-\u4dbf々ー]+)/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(part)) !== null) {
      const full = match[0];
      if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(full)) {
        const status = wordStatuses[full] || 'new';
        const cls = getStatusClass(status);
        resultHtml += `<span class="${cls}" data-word="${escapeAttribute(full)}" data-pos="名詞">${escapeText(full)}</span>`;
      } else {
        resultHtml += escapeText(full);
      }
    }
  }

  return resultHtml;
}

export async function setupNativeYoruParser(onWordClick?: (word: string, element: HTMLElement) => void): Promise<() => void> {
  const handleNativeClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target) return;
    const wordEl = target.closest('.jiten-word') as HTMLElement;
    if (wordEl) {
      const word = wordEl.getAttribute('data-word') || wordEl.textContent?.trim() || '';
      if (word && onWordClick) {
        onWordClick(word, wordEl);
      }
    }
  };

  document.addEventListener('click', handleNativeClick);
  try {
    await initTokenizer();
  } catch (err) {
    console.warn('Native tokenizer init error:', err);
  }

  return () => {
    document.removeEventListener('click', handleNativeClick);
  };
}

// ── Jiten parser output ────────────────────────────────────────────────

export interface JitenRenderToken {
  start: number;
  end: number;
  key: string;
}

export interface JitenRenderWord {
  spelling: string;
  reading: string;
  states: string[];
  furigana?: [string, string][];
}

interface ParagraphUnit {
  start: number;
  end: number;
  html: string;
}

// Splits a sanitized paragraph into units over its plain text (ruby bases count, furigana does not).
function splitParagraphUnits(text: string): { plain: string; units: ParagraphUnit[] } {
  const parts = text.split(/(<ruby\b[^>]*>[\s\S]*?<\/ruby>|<img\b[^>]*>)/gi);
  const units: ParagraphUnit[] = [];
  let plain = '';

  for (const part of parts) {
    if (!part) continue;
    const rubyData = readRubyMarkup(part);
    if (rubyData) {
      const start = plain.length;
      plain += rubyData.surface;
      units.push({ start, end: plain.length, html: rubyData.reading ? rubyData.html : escapeHtmlText(rubyData.surface) });
      continue;
    }
    const imageSource = readImageSource(part);
    if (imageSource !== null) {
      units.push({
        start: plain.length,
        end: plain.length,
        html: `<img src="${escapeHtmlText(imageSource)}" style="max-width:100%; max-height:var(--reader-image-height,85vh); object-fit:contain; display:block; margin:1em auto;" />`,
      });
      continue;
    }
    for (let i = 0; i < part.length; i++) {
      units.push({ start: plain.length + i, end: plain.length + i + 1, html: escapeHtmlText(part[i]) });
    }
    plain += part;
  }
  return { plain, units };
}

/** The text Jiten parses for a paragraph: what the reader shows, without furigana. */
export function jitenPlainText(text: string): string {
  return splitParagraphUnits(text).plain;
}

/** Renders a paragraph with Jiten's word boundaries and card states. */
export function renderJitenParagraph(
  text: string,
  tokens: JitenRenderToken[],
  getWord: (key: string) => JitenRenderWord | undefined,
): string {
  const { units } = splitParagraphUnits(text);
  let html = '';
  let tokenIndex = 0;
  let openEnd = -1;
  // While a new word is open: its plain text, so it can get furigana when it is closed.
  let furiganaWord: JitenRenderWord | undefined;
  let wordStart = 0;
  let wordText = '';
  const closeWord = () => {
    if (furiganaWord) {
      const ruby = furiganaFromPairs(wordText, furiganaWord.furigana || []);
      if (ruby) html = html.slice(0, wordStart) + ruby;
    }
    html += '</span>';
    openEnd = -1;
    furiganaWord = undefined;
  };

  for (const unit of units) {
    const isText = unit.end > unit.start;
    if (openEnd >= 0 && isText && unit.start >= openEnd) closeWord();
    if (openEnd < 0 && isText) {
      while (tokenIndex < tokens.length && tokens[tokenIndex].end <= unit.start) tokenIndex++;
      const token = tokens[tokenIndex];
      if (token && token.start < unit.end && token.end > unit.start) {
        const word = getWord(token.key);
        const states = word?.states?.length ? word.states.join(' ') : 'new';
        const spelling = word?.spelling || '';
        html += `<span class="jiten-word ${escapeHtmlText(states)}" data-jiten="${escapeHtmlText(token.key)}"`
          + (spelling ? ` data-word="${escapeHtmlText(spelling)}"` : '')
          + (word?.reading ? ` data-reading="${escapeHtmlText(word.reading)}"` : '')
          + '>';
        openEnd = token.end;
        tokenIndex++;
        furiganaWord = furiganaOnNewWords && (word?.states?.includes('new') ?? true) && word?.furigana?.length ? word : undefined;
        wordStart = html.length;
        wordText = '';
      }
    }
    // A ruby base is never split: a word that ends inside it takes the whole base.
    if (openEnd >= 0 && unit.end > openEnd) openEnd = unit.end;
    // Furigana already in the book wins: only plain single characters are rewritten.
    if (furiganaWord) {
      if (unit.end - unit.start === 1 && !/[&<]/.test(unit.html)) wordText += unit.html;
      else furiganaWord = undefined;
    }
    html += unit.html;
  }
  if (openEnd >= 0) closeWord();
  return html;
}
