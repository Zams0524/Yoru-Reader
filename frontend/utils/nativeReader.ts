import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { countJapaneseChars, sanitizeJapaneseText, type Book } from '../components/reader/ReaderEngine';

/**
 * Native Android reader (NativeReaderPlugin.java, OpenReadEra EraEPUB engine). The book is exported
 * to one HTML file whose blocks are all body-level <p> elements, so the engine's xpaths ("/p[n]")
 * give the block ("ordinal"); `blockParagraph` maps it to Yoru's paragraph index (the `index`
 * attribute of the WebView reader), which is what progress, bookmarks and stats use.
 */

export interface NativeReaderSettings {
  vertical: boolean;
  fontSize: number;
  lineHeight: number;
  verticalPadding: number;
  horizontalPadding: number;
  textColor: number;
  backgroundColor: number;
  fontFamily: string;
  textAlign: string;
  invertTaps: boolean;
  /** 0-100: below 100 the page is dimmed (the reader's brightness setting). */
  brightness: number;
}

/** A tap on a letter: its engine xpath, block and box on screen (CSS px). */
export interface NativeWordHit {
  xpath: string;
  ordinal: number;
  letter: string;
  /** Letter index on its page, for highlight(). */
  index: number;
  page: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface NativePosition {
  page: number;
  pages: number;
  xpath: string;
  /** Block of the exported book at the top of the page, -1 if unknown. */
  ordinal: number;
}

interface NativeReaderPlugin {
  hasBook(options: { key: string }): Promise<{ exists: boolean }>;
  highlight(options: { page: number; index: number; before: number; after: number; color: number }): Promise<void>;
  writeBookChunk(options: { key: string; data: string; first: boolean; last: boolean }): Promise<void>;
  writeBookImage(options: { key: string; name: string; data: string }): Promise<void>;
  /** innerPath (with ordinal): a place inside that block, see textOffsetToInnerPath. */
  open(options: { key: string; settings: NativeReaderSettings; xpath?: string; ordinal?: number; innerPath?: string }): Promise<NativePosition>;
  setSettings(options: { settings: Partial<NativeReaderSettings> }): Promise<void>;
  goTo(options: { ordinal?: number; page?: number }): Promise<void>;
  turnPage(options: { direction: 1 | -1 }): Promise<void>;
  setHoles(options: { rects: number[][] }): Promise<void>;
  setPopupOpen(options: { open: boolean }): Promise<void>;
  /** Highlights a read-aloud sentence. relativeBlock: block index from top of current page. */
  highlightRange(options: { relativeBlock: number; charOffset: number; charLength: number; color: number }): Promise<void>;
  /** Clears any word or sentence highlight on the page. */
  clearHighlight(): Promise<void>;
  close(): Promise<void>;
  addListener(event: 'pageChanged', listener: (position: NativePosition) => void): Promise<PluginListenerHandle>;
  addListener(event: 'tap', listener: (point: { x: number; y: number; closePopup?: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'word', listener: (hit: NativeWordHit) => void): Promise<PluginListenerHandle>;
  addListener(event: 'error', listener: (error: { message: string }) => void): Promise<PluginListenerHandle>;
}

export const NativeReader = registerPlugin<NativeReaderPlugin>('NativeReader');

/** The APK has the native reader (1.4.0+; older APKs get the web UI by OTA without it). */
export function isNativeReaderAvailable(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('NativeReader');
}

/**
 * Bumped when the exported book changes, so books are exported again (and saved engine xpaths,
 * which depend on the document's structure, are dropped when POSITION_FORMAT changes too).
 * v2: XHTML packed as an EPUB, for images. v3: picture blocks on pages of their own.
 * v4: the plugin swaps those pictures for a page-tall placeholder (pictures.idx). v5: small images
 * (logos) stay in the text (class "si"). v6: words in state spans (nativeReaderWords); the key
 * is a hash of the HTML, so a state change gives a new export. v7: the plugin moves the CSS into
 * style.css and the engine reads it unfiltered.
 */
const EXPORT_VERSION = 7;
/** Bumped when engine xpaths of earlier exports no longer point to the same place. */
const POSITION_FORMAT = 2;
const CHUNK_CHARS = 512 * 1024;

export interface NativeBookExport {
  key: string;
  html: string;
  images: { name: string; data: string }[];
  /** HTML inside each block's <p>, and the chapter line it comes from. */
  blocks: string[];
  blockLines: string[];
  /** Yoru paragraph index of each block (headings get the paragraph that follows them). */
  blockParagraph: number[];
  /** Characters before each paragraph (the `characumm` attribute of the WebView reader). */
  paragraphChars: number[];
  totalChars: number;
}

// eslint-disable-next-line no-control-regex
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/** Text for XHTML: markup characters escaped, characters XML does not allow removed. */
function escapeHtml(text: string): string {
  return text.replace(XML_INVALID, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hashText(text: string): string {
  // FNV-1a: the same HTML gives the same key (and the export already on the device).
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Japanese characters of a text line, counted as the WebView reader does (computeSections). */
function lineChars(line: string): number {
  const plainText = line
    .replace(/\{img:[^{}]*\}/gi, '')
    .replace(/\{[^|{}]+\|[^{}]*\}/g, (match) => match.split('|')[0].substring(1))
    .replace(/[｀`]/g, '、')
    .replace(/[゜°]/g, '。');
  return countJapaneseChars(plainText);
}

/**
 * Exports the book for the engine. Paragraph numbering and character counts follow
 * computeSections / renderSectionContent exactly, so positions stay interchangeable with the
 * WebView reader. Ruby from the book ({base|reading} and Aozora 《》) becomes <ruby>.
 */
export interface NativeExportOptions {
  showFurigana?: boolean;
  /** Engine markup of each line with its words in state spans (renderBookWords); without it the text is exported plain. */
  lineHtml?: Map<string, string>;
  /** Engine CSS for the word states (engineWordCss). */
  wordCss?: string;
}

export function exportBookForNativeReader(book: Book, options: NativeExportOptions = {}): NativeBookExport {
  const showFurigana = options.showFurigana !== false;
  const images: { name: string; data: string }[] = [];
  const imageNames = new Map<string, string>();
  const imageSrc = (src: string): string | null => {
    const known = imageNames.get(src);
    if (known) return known;
    const match = /^data:image\/([a-z0-9.+-]+);base64,(.*)$/is.exec(src.trim());
    if (!match) return null;  // the engine cannot fetch remote images
    const ext = match[1].toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const name = `${images.length + 1}.${ext}`;
    images.push({ name, data: match[2] });
    const path = `img/${name}`;
    imageNames.set(src, path);
    return path;
  };
  const imgTag = (src: string) => {
    const path = imageSrc(src);
    return path ? `<img src="${path}"/>` : '';
  };

  const worded = (line: string) => {
    const html = options.lineHtml?.get(line);
    if (html === undefined) return null;
    return html.replace(XML_INVALID, '').replace(/\{img:([^{}]+)\}/gi, (_m, src) => imgTag(src));
  };
  const blocks: string[] = [];
  const blockHtml: string[] = [];
  const blockLines: string[] = [];
  const blockParagraph: number[] = [];
  const paragraphChars: number[] = [];
  let paragraphId = 0;
  let charAccum = 0;

  (book.chapters || []).forEach((chapter, chapterIndex) => {
    const lines = (chapter.content || '').split(/\r?\n/);
    lines.forEach((line, lineIndex) => {
      const breakBefore = chapterIndex > 0 && lineIndex === 0;
      const classes: string[] = breakBefore ? ['ch'] : [];
      let inner: string;
      const heading = /^\{(h[123]):/.exec(line);
      const isHeading = !!heading && line.endsWith('}');
      if (isHeading) {
        classes.push(heading![1]);
        inner = worded(line) ?? sanitizeJapaneseText(escapeHtml(line.substring(4, line.length - 1)));
      } else if (!line.trim()) {
        classes.push('e');
        inner = '&#160;';
      } else if (line.startsWith('{img:') && line.endsWith('}')) {
        classes.push('i');
        inner = imgTag(line.substring(5, line.length - 1)) || '&#160;';
      } else {
        inner = worded(line) ?? sanitizeJapaneseText(escapeHtml(line)).replace(/\{img:([^{}]+)\}/gi, (_m, src) => imgTag(src));
      }
      blocks.push(`<p${classes.length ? ` class="${classes.join(' ')}"` : ''}>${inner}</p>`);
      blockHtml.push(inner);
      blockLines.push(line);
      // Headings have no paragraph index of their own (renderSectionContent).
      blockParagraph.push(paragraphId);
      if (!isHeading) {
        paragraphChars[paragraphId] = charAccum;
        if (line.trim() && !(line.startsWith('{img:') && line.endsWith('}'))) charAccum += lineChars(line);
        paragraphId++;
      }
    });
  });
  paragraphChars[paragraphId] = charAccum;

  const title = escapeHtml(book.title || '');
  // XHTML: the plugin packs it as an EPUB (the engine loads images only from a container).
  const html = '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n'
    + '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja"><head><meta charset="utf-8"/>'
    + `<title>${title}</title><style>`
    + 'body{margin:0;padding:0}'
    + 'p{margin:0;text-indent:0}'
    + 'p.ch{page-break-before:always}'
    + 'p.h1{font-size:1.5em;font-weight:bold;margin:1em 0}'
    + 'p.h2{font-size:1.3em;font-weight:bold;margin:0.8em 0}'
    + 'p.h3{font-size:1.15em;font-weight:bold;margin:0.6em 0}'
    // A picture gets a page of its own; the plugin draws it there centred and fitted to the screen.
    + 'p.i{text-align:center;page-break-before:always;page-break-after:always}'
    + 'p.si{text-align:center}'
    + 'img{max-width:100%;max-height:100%}'
    // "Show furigana" off: the book's readings are hidden (a separate export, see the key).
    + (showFurigana ? '' : 'rt,rp{display:none}')
    + (options.wordCss || '')
    + '</style></head><body>\n'
    + blocks.join('\n')
    + '\n</body></html>\n';

  const id = String(book.id || 'book').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || 'book';
  return {
    key: `${id}-${hashText(html)}-v${EXPORT_VERSION}`,
    html,
    images,
    blocks: blockHtml,
    blockLines,
    blockParagraph,
    paragraphChars,
    totalChars: charAccum,
  };
}

/** Writes the exported book to the app's files unless that version is already there. */
export async function ensureNativeBook(exported: NativeBookExport): Promise<void> {
  const { exists } = await NativeReader.hasBook({ key: exported.key });
  if (exists) return;
  // The first call starts a fresh folder; the book counts as written once its HTML is complete.
  await NativeReader.writeBookChunk({ key: exported.key, data: '', first: true, last: false });
  for (const image of exported.images) {
    await NativeReader.writeBookImage({ key: exported.key, name: image.name, data: image.data });
  }
  for (let start = 0; start < exported.html.length; start += CHUNK_CHARS) {
    await NativeReader.writeBookChunk({
      key: exported.key,
      data: exported.html.slice(start, start + CHUNK_CHARS),
      first: false,
      last: start + CHUNK_CHARS >= exported.html.length,
    });
  }
}

/** First block of a Yoru paragraph (its heading, if one comes right before it). */
export function blockOfParagraph(exported: NativeBookExport, paragraph: number): number {
  const list = exported.blockParagraph;
  let lo = 0;
  let hi = list.length - 1;
  let found = list.length - 1;
  // blockParagraph is non-decreasing: find the first block with paragraph >= target.
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] >= paragraph) {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return Math.max(0, found);
}

const isFurigana = (node: Node) => !!(node.parentElement && node.parentElement.closest('rt, rp'));

/** Text nodes of an element in reading order, without furigana (<rt>/<rp>). */
export function baseTextNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!isFurigana(node)) nodes.push(node as Text);
  }
  return nodes;
}

/**
 * Character offset, in the block's text without furigana, of an engine xpath inside the block
 * ("/html/body/p[7]/ruby[2]/text().0", "/html/body/p[7]/text()[3].12"). A point inside furigana
 * counts as the start of its ruby base. Returns -1 if the path does not match the block.
 */
export function xpathToTextOffset(blockHtml: string, xpath: string): number {
  const match = /\/body\/p(?:\[\d+\])?((?:\/[^/]+)*)$/.exec(xpath);
  if (!match) return -1;
  let tail = match[1] || '';
  let offset = 0;
  const offsetMatch = /\.(\d+)$/.exec(tail);
  if (offsetMatch) {
    offset = Number(offsetMatch[1]);
    tail = tail.slice(0, -offsetMatch[0].length);
  }
  const block = document.createElement('p');
  block.innerHTML = blockHtml;
  let node: Node = block;
  for (const step of tail.split('/').filter(Boolean)) {
    const stepMatch = /^(text\(\)|[A-Za-z][A-Za-z0-9]*)(?:\[(\d+)\])?$/.exec(step);
    if (!stepMatch) return -1;
    const wantText = stepMatch[1] === 'text()';
    const candidates = Array.from(node.childNodes).filter((child) => wantText
      ? child.nodeType === Node.TEXT_NODE
      : child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName.toLowerCase() === stepMatch[1].toLowerCase());
    const next = candidates[(Number(stepMatch[2]) || 1) - 1];
    if (!next) return -1;
    node = next;
  }
  if (node.nodeType !== Node.TEXT_NODE) offset = 0;
  // Furigana: go to the start of the ruby it belongs to.
  if (isFurigana(node)) {
    node = node.parentElement!.closest('ruby') || node;
    offset = 0;
  }
  let total = 0;
  for (const text of baseTextNodes(block)) {
    if (text === node) return total + Math.min(offset, text.length);
    if (node.nodeType === Node.ELEMENT_NODE && node.contains(text)) return total;
    total += text.length;
  }
  return -1;
}

/**
 * Path inside a block to a character offset of its text without furigana, in the engine's xpath
 * form ("span[3]/ruby[1]/text()[1].0"), for reopening at the same character after the block's
 * markup changed. Null if the offset is past the text.
 */
export function textOffsetToInnerPath(blockHtml: string, offset: number): string | null {
  const block = document.createElement('p');
  block.innerHTML = blockHtml;
  let total = 0;
  for (const text of baseTextNodes(block)) {
    if (offset < total + text.length) {
      const steps: string[] = [];
      for (let node: Node = text; node !== block; node = node.parentNode!) {
        const parent = node.parentNode!;
        if (node.nodeType === Node.TEXT_NODE) {
          const index = Array.from(parent.childNodes).filter((c) => c.nodeType === Node.TEXT_NODE).indexOf(node as ChildNode) + 1;
          steps.unshift(`text()[${index}]`);
        } else {
          const tag = (node as Element).tagName.toLowerCase();
          const index = Array.from(parent.childNodes).filter((c) => c.nodeType === Node.ELEMENT_NODE && (c as Element).tagName.toLowerCase() === tag).indexOf(node as ChildNode) + 1;
          steps.unshift(`${tag}[${index}]`);
        }
      }
      return `${steps.join('/')}.${offset - total}`;
    }
    total += text.length;
  }
  return null;
}

/** CSS colour (hex, rgb()) as 0xRRGGBB. */
export function cssColorToInt(color: string, fallback: number): number {
  const probe = document.createElement('span');
  probe.style.color = color;
  if (!probe.style.color) return fallback;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(computed);
  if (!match) return fallback;
  return (Number(match[1]) << 16) | (Number(match[2]) << 8) | Number(match[3]);
}

/** The exact page of a book (xpath) is kept per device; the shared progress only has the paragraph. */
const POSITION_KEY = `native-reader:position:v${POSITION_FORMAT}:`;

export function loadNativePosition(bookId: string): { xpath: string; paragraph: number } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY + bookId) || 'null');
    return saved && typeof saved.xpath === 'string' && typeof saved.paragraph === 'number' ? saved : null;
  } catch {
    return null;
  }
}

export function saveNativePosition(bookId: string, xpath: string, paragraph: number) {
  try {
    localStorage.setItem(POSITION_KEY + bookId, JSON.stringify({ xpath, paragraph }));
  } catch {
    // Storage full or blocked: the paragraph in the book progress is still saved.
  }
}
