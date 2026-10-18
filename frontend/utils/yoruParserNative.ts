import { getTokenizerInstance, initTokenizer, katakanaToHiragana } from './japanese';

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

          resultHtml += `<span class="${cls}" data-word="${escapeAttribute(basicForm)}" data-reading="${escapeAttribute(reading)}" data-pos="${escapeAttribute(pos)}">${escapeText(surface)}</span>`;
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
