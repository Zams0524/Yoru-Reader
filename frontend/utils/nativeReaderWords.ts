import { renderLineWords, type Book } from '../components/reader/ReaderEngine';
import type { WordEffect, WordStyleThemeConfig } from './parserSettingsStore';

/**
 * Word states in the native reader. The engine cannot run Yoru's parser, so the book is exported
 * with its words already marked: every line goes through the WebView reader's own rendering
 * (renderLineWords: Jiten's parse when it is on and cached, the local parser otherwise, furigana
 * on new words included), and the result is reduced to engine markup — one span per word whose
 * class is its state (w-new, w-young, …), styled by CSS made from the word-style settings.
 */

// The most telling state wins when a word has several (Jiten: "new frequent").
const STATE_ORDER: [string, string][] = [
  ['due', 'due'],
  ['young', 'young'], ['learning', 'young'],
  ['new', 'new'],
  ['blacklisted', 'blacklisted'], ['ignored', 'blacklisted'], ['suspended', 'blacklisted'],
  ['mature', 'mature'], ['known', 'mature'], ['mastered', 'mature'],
];

function engineState(classes: DOMTokenList): string {
  for (const [cls, state] of STATE_ORDER) if (classes.contains(cls)) return state;
  return 'mature';
}

const KEPT = new Set(['span', 'ruby', 'rb', 'rt', 'rp', 'img', 'br']);

/** The WebView markup of a line as engine XHTML: state spans, ruby, nothing else. */
function toEngineMarkup(html: string, holder: HTMLElement): string {
  holder.innerHTML = html;
  const clean = (element: Element) => {
    for (const child of Array.from(element.children)) {
      const tag = child.tagName.toLowerCase();
      if (!KEPT.has(tag)) {
        // Unknown wrappers: keep their content.
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      const state = child.classList.contains('jiten-word') ? engineState(child.classList) : null;
      const src = tag === 'img' ? child.getAttribute('src') : null;
      for (const attr of Array.from(child.attributes)) child.removeAttribute(attr.name);
      if (state) child.setAttribute('class', `w-${state}`);
      if (src) child.setAttribute('src', src);
      clean(child);
    }
  };
  clean(holder);
  // XMLSerializer gives well-formed XHTML (escaped text, closed tags); the namespace it adds to
  // each element is the document's default one anyway.
  const serializer = new XMLSerializer();
  return Array.from(holder.childNodes)
    .map((node) => serializer.serializeToString(node))
    .join('')
    .replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
}

/** The text of a chapter line that carries words (headings and ordinary lines, not pictures). */
function hasWords(line: string): boolean {
  return !!line.trim() && !(line.startsWith('{img:') && line.endsWith('}'));
}

/**
 * Engine markup of every line of the book with words, by line text (inline {img:} chunks stay as
 * they are: the export turns them into images). Runs in slices so the UI keeps running; null if
 * isCancelled() turned true.
 */
export async function renderBookWords(
  book: Book,
  statuses: Record<string, string>,
  isCancelled: () => boolean,
): Promise<Map<string, string> | null> {
  const holder = document.createElement('div');
  const lines = new Map<string, string>();
  let sinceYield = 0;
  for (const chapter of book.chapters || []) {
    for (const line of (chapter.content || '').split(/\r?\n/)) {
      if (!hasWords(line) || lines.has(line)) continue;
      const parts = line.split(/(\{img:[^{}]+\})/i);
      const heading = /^\{h[123]:/.test(line) && line.endsWith('}');
      const html = heading
        ? toEngineMarkup(renderLineWords(line, statuses), holder)
        : parts.map((part) => (!part || /^\{img:[^{}]+\}$/i.test(part) ? part : toEngineMarkup(renderLineWords(part, statuses), holder))).join('');
      lines.set(line, html);
      if (++sinceYield >= 25) {
        sinceYield = 0;
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        if (isCancelled()) return null;
      }
    }
  }
  return lines;
}

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

const ENGINE_STATES = ['new', 'young', 'mature', 'due', 'blacklisted'];

/**
 * Engine CSS for the word states from the word-style settings: text colour, underline and
 * background (blended with the page colour) carry over; opacity becomes a colour faded towards
 * the page; shadows have no equivalent. The underline takes the text colour (no separate colour).
 */
export function engineWordCss(config: WordStyleThemeConfig, textColor: number, backgroundColor: number): string {
  const rules: string[] = [];
  for (const state of ENGINE_STATES) {
    const effects: WordEffect[] = config?.states?.[state]?.effects || [];
    let color: number | null = null;
    const css: string[] = [];
    for (const effect of effects) {
      if (effect.type === 'text-colour' && effect.colour) color = parseHex(effect.colour);
      if (effect.type === 'underline') css.push('text-decoration:underline');
      if (effect.type === 'background' && effect.colour) {
        const bg = parseHex(effect.colour);
        if (bg !== null) css.push(`background-color:${hexOf(blend(bg, backgroundColor, effect.opacity ?? 1))}`);
      }
    }
    const opacity = effects.find((e) => e.type === 'opacity' && !e.hoverOnly && e.value !== undefined)?.value;
    if (opacity !== undefined) color = blend(color ?? textColor, backgroundColor, opacity);
    if (color !== null) css.push(`color:${hexOf(color)}`);
    if (css.length) rules.push(`span.w-${state}{${css.join(';')}}`);
  }
  return rules.join('');
}
