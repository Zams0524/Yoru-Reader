import React, { useState, useEffect, useRef, useMemo, useCallback, ReactNode } from 'react';
import { ReaderSettingsState } from '../../hooks/useReaderSettings';
import { tokenizeJapaneseText, setupNativeYoruParser, jitenPlainText, renderJitenParagraph, isFuriganaOnNewWords } from '../../utils/yoruParserNative';
import { isPhoneUI } from '../../utils/platform';
import { t } from '../../utils/i18n';
import { getCachedJitenTokens, getJitenWord, isJitenParserEnabled, onJitenChange, parseWithJiten } from '../../utils/jitenSync';

export interface Chapter {
  title: string;
  content: string;
  isFromToc?: boolean;
}

export interface Book {
  id?: string;
  title: string;
  chapters: Chapter[];
  _savedSection?: number;
  // Saved by db.updateBookProgress: section index and first visible paragraph.
  progress?: { currentChapter?: number; currentPage?: number };
}

export interface Section {
  id: string;
  title: string;
  chapterIndex: number;
  startOffset: number;
  endOffset: number;
  startParagraphId: number;
  lastIndex: number;
  startChars: number;
  charCount?: number;
  isFromToc?: boolean;
}

export interface CharsUpdatePayload {
  currChars: number;
  totalChars: number;
  lastIndex: number;
  currSection: number;
}

/** Imperative access for features that drive the page (read aloud, search). */
export interface ReaderEngineApi {
  getContent: () => HTMLDivElement | null;
  /** Turns/scrolls the page so the range is on screen. */
  revealRange: (range: Range) => void;
  /** Paged mode: moves to the next section. Returns false at the end of the book or in continuous mode. */
  goToNextSection: () => boolean;
  /** Opens a section and shows the paragraph with that index attribute. */
  goToParagraph: (sectionIndex: number, paragraphId: number) => void;
  getSections: () => Section[];
  getCurrentSection: () => number;
  isPaginated: () => boolean;
  /** Paged mode: current page and page count of the open section. */
  getPageInfo: () => { page: number; pages: number };
  /** Turns one page (1 = forward, -1 = backward), moving to the next/previous section at the ends. */
  turnPage: (direction: 1 | -1) => void;
}

export interface ReaderEngineProps {
  apiRef?: React.MutableRefObject<ReaderEngineApi | null>;
  book: Book;
  readerSettings: ReaderSettingsState;
  onCharsUpdate?: (payload: CharsUpdatePayload) => void;
  onSectionChange?: (sectionIndex: number) => void;
  onClick?: (e: React.MouseEvent) => void;
  /** Called on every page turn (the reader hides its bars). */
  onPageTurn?: () => void;
  children?: ReactNode;
  targetSection?: number | null;
  targetParagraphId?: number | null;
  targetCharPosition?: number | null;
  wordStatuses?: Record<string, string>;
  colors: any;
}

export function sanitizeJapaneseText(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\uFF40\u0060\u2018\u2019\u00B4｀`]/g, '、')
    .replace(/[\u309C\uFF9F\u00B0゜°]/g, '。')
    .replace(/［＃[^］]+］/g, '')
    .replace(/｜([^\n《]+)《([^\n》]+)》/g, '<ruby>$1<rt>$2</rt></ruby>')
    .replace(/([\u4e00-\u9faf\u3400-\u4dbf々ー]+)《([^\n》]+)》/g, '<ruby>$1<rt>$2</rt></ruby>')
    .replace(/\{([^|{}]+)\|([^|{}]+)\}/g, '<ruby>$1<rt>$2</rt></ruby>');
}

export function processRuby(text: string): string {
  return sanitizeJapaneseText(text);
}

export function countJapaneseChars(text: string): number {
  if (!text) return 0;
  const regex = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\u3400-\u4dbf々ー]/g;
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char] as string));
}

/** A paragraph rendered with the local parser while it waits for Jiten's parse. */
interface PendingJitenParagraph {
  paragraphId: number;
  text: string;
  html: string;
}

function renderSectionContent(
  rawContent: string,
  startParagraphId: number,
  startChars: number,
  wordStatuses: Record<string, string>,
  jitenPending: PendingJitenParagraph[] | null,
): string {
  let paragraphId = startParagraphId;
  let charAccum = startChars;

  return rawContent.split(/\r?\n/).map((line) => {
    if (!line.trim()) {
      const html = `<p class="chapter-content empty-line" index="${paragraphId}" characumm="${charAccum}"><br/></p>`;
      paragraphId++;
      return html;
    }

    if (line.startsWith('{h1:') && line.endsWith('}')) {
      const text = processRuby(line.substring(4, line.length - 1));
      return `<h1 class="chapter-content-h1">${tokenizeJapaneseText(text, wordStatuses)}</h1>`;
    }
    if (line.startsWith('{h2:') && line.endsWith('}')) {
      const text = processRuby(line.substring(4, line.length - 1));
      return `<h2 class="chapter-content-h2">${tokenizeJapaneseText(text, wordStatuses)}</h2>`;
    }
    if (line.startsWith('{h3:') && line.endsWith('}')) {
      const text = processRuby(line.substring(4, line.length - 1));
      return `<h3 class="chapter-content-h3">${tokenizeJapaneseText(text, wordStatuses)}</h3>`;
    }

    if (line.startsWith('{img:') && line.endsWith('}')) {
      const src = line.substring(5, line.length - 1);
      const html = `<img index="${paragraphId}" characumm="${charAccum}" src="${escapeHtmlAttribute(src)}" loading="lazy" decoding="async" style="max-width:100%; max-height:var(--reader-image-height,85vh); object-fit:contain; display:block; margin:1em auto;" />`;
      paragraphId++;
      return html;
    }

    const sanitized = sanitizeJapaneseText(line);
    const processed = sanitized.replace(
      /\{img:([^{}]+)\}/gi,
      (_match, src) => `<img src="${escapeHtmlAttribute(src)}" loading="lazy" decoding="async" style="max-width:100%; max-height:var(--reader-image-height,85vh); object-fit:contain; display:block; margin:1em auto;" />`,
    );
    const plainText = line
      .replace(/\{img:[^{}]*\}/gi, '')
      .replace(/\{[^|{}]+\|[^{}]*\}/g, (match) => match.split('|')[0].substring(1))
      .replace(/[｀`]/g, '、')
      .replace(/[゜°]/g, '。');
    const jpCount = countJapaneseChars(plainText);
    let tokenizedHtml: string;
    const jitenText = jitenPending ? jitenPlainText(processed) : '';
    const jitenTokens = jitenText ? getCachedJitenTokens(jitenText) : undefined;
    if (jitenTokens) {
      tokenizedHtml = renderJitenParagraph(processed, jitenTokens, getJitenWord);
    } else {
      tokenizedHtml = tokenizeJapaneseText(processed, wordStatuses);
      if (jitenPending && jitenText.trim()) jitenPending.push({ paragraphId, text: jitenText, html: processed });
    }
    const html = `<p class="chapter-content" index="${paragraphId}" characumm="${charAccum}">${tokenizedHtml}</p>`;
    charAccum += jpCount;
    paragraphId++;
    return html;
  }).join('');
}

/**
 * One text line of a chapter as the WebView reader renders its words (Jiten's parse when it is on
 * and cached, the local parser otherwise), without the paragraph element. The native reader uses
 * it to find the tapped word.
 */
export function renderLineWords(line: string, wordStatuses: Record<string, string>): string {
  const heading = /^\{h[123]:/.test(line) && line.endsWith('}');
  if (heading) return tokenizeJapaneseText(processRuby(line.substring(4, line.length - 1)), wordStatuses);
  const processed = sanitizeJapaneseText(line).replace(/\{img:[^{}]*\}/gi, '');
  const jitenText = isJitenParserEnabled() ? jitenPlainText(processed) : '';
  const jitenTokens = jitenText ? getCachedJitenTokens(jitenText) : undefined;
  return jitenTokens
    ? renderJitenParagraph(processed, jitenTokens, getJitenWord)
    : tokenizeJapaneseText(processed, wordStatuses);
}

/** The text Jiten parses for a chapter line ('' for headings and lines without text). */
export function jitenTextOfLine(line: string): string {
  if (/^\{h[123]:/.test(line) && line.endsWith('}')) return '';
  const text = jitenPlainText(sanitizeJapaneseText(line).replace(/\{img:[^{}]*\}/gi, ''));
  return text.trim() ? text : '';
}

/** With the Jiten parser on, waits (up to a few seconds) for its parse of the line, as the WebView reader shows it. */
export async function prepareLineWords(line: string): Promise<void> {
  if (!isJitenParserEnabled()) return;
  const jitenText = jitenTextOfLine(line);
  if (!jitenText || getCachedJitenTokens(jitenText)) return;
  await Promise.race([
    parseWithJiten([jitenText]).catch(() => []),
    new Promise((resolve) => window.setTimeout(resolve, 3000)),
  ]);
}

/**
 * Splits the book into sections of about 3000 characters (chapter boundaries kept) and numbers
 * its paragraphs the way renderSectionContent does (the `index` attribute of each block).
 */
export function computeSections(book: Book): Section[] {
  if (!book || !book.chapters || book.chapters.length === 0) return [];
  let paragraphId = 0;
  let charAccum = 0;
  const resultSections: Section[] = [];
  // Untitled chapters are named in the app's language. The importer (fileImport.ts) stores
  // Spanish names for them ("Capítulo 3", "Portada"); those are translated here too.
  let lang = 'en';
  try { lang = localStorage.getItem('app_language') || 'en'; } catch { /* no storage */ }
  const chapterWord = t('chapter', lang);
  const titleOf = (title: string | undefined, chapterIdx: number) => {
    if (!title) return `${chapterWord} ${chapterIdx + 1}`;
    if (lang !== 'en') return title;
    if (title === 'Portada') return 'Cover';
    return title.replace(/^Capítulo (\d+)$/, `${chapterWord} $1`);
  };

  book.chapters.forEach((chapter, chapterIdx) => {
    const chapterContent = chapter.content || '';
    const lines = chapterContent.split(/\r?\n/);
    let lineOffset = 0;
    let sectionStartOffset = 0;
    let sectionStartParagraphId = paragraphId;
    let sectionCharCount = 0;
    let startChars = charAccum;
    let subSectionIdx = 0;
    let sectionHasContent = false;

    lines.forEach((line, lineIdx) => {
      const lineEndOffset = lineOffset + line.length;
      const separatorLength = lineIdx < lines.length - 1
        ? (chapterContent.charCodeAt(lineEndOffset) === 13 ? 2 : 1)
        : 0;
      const nextLineOffset = lineEndOffset + separatorLength;
      sectionHasContent = true;

      if (!line.trim()) {
        paragraphId++;
      } else if (line.startsWith('{img:') && line.endsWith('}')) {
        paragraphId++;
      } else {
        const isHeading = (
          (line.startsWith('{h1:') || line.startsWith('{h2:') || line.startsWith('{h3:')) && line.endsWith('}')
        );
        if (!isHeading) {
          const plainText = line
            .replace(/\{img:[^{}]*\}/gi, '')
            .replace(/\{[^|{}]+\|[^{}]*\}/g, (match) => match.split('|')[0].substring(1))
            .replace(/[｀`]/g, '、')
            .replace(/[゜°]/g, '。');
          const jpCount = countJapaneseChars(plainText);
          charAccum += jpCount;
          sectionCharCount += jpCount;
          paragraphId++;
        }
      }

      if (sectionCharCount >= 3000) {
        resultSections.push({
          id: `chapter-${chapterIdx}-${subSectionIdx}`,
          title: subSectionIdx === 0 || !chapter.title ? titleOf(chapter.title, chapterIdx) : `${titleOf(chapter.title, chapterIdx)} (${subSectionIdx + 1})`,
          chapterIndex: chapterIdx,
          startOffset: sectionStartOffset,
          endOffset: lineEndOffset,
          startParagraphId: sectionStartParagraphId,
          lastIndex: paragraphId - 1,
          startChars,
          charCount: charAccum - startChars,
          isFromToc: chapter.isFromToc,
        });
        sectionStartOffset = nextLineOffset;
        sectionStartParagraphId = paragraphId;
        sectionCharCount = 0;
        startChars = charAccum;
        subSectionIdx++;
        sectionHasContent = false;
      }

      lineOffset = nextLineOffset;
    });

    if (sectionHasContent || resultSections.length === 0) {
      resultSections.push({
        id: `chapter-${chapterIdx}-${subSectionIdx}`,
        title: subSectionIdx === 0 || !chapter.title ? titleOf(chapter.title, chapterIdx) : `${titleOf(chapter.title, chapterIdx)} (${subSectionIdx + 1})`,
        chapterIndex: chapterIdx,
        startOffset: sectionStartOffset,
        endOffset: chapterContent.length,
        startParagraphId: sectionStartParagraphId,
        lastIndex: paragraphId - 1,
        startChars,
        charCount: charAccum - startChars,
        isFromToc: chapter.isFromToc,
      });
    }
  });

  return resultSections;
}

/**
 * Authentic Native Yoru Reader Engine & High-Speed Parser
 * Directly parses and colors Japanese words natively with 0ms latency.
 */
function ReaderEngineComponent({
  apiRef,
  book,
  readerSettings,
  onCharsUpdate,
  onSectionChange,
  onClick,
  onPageTurn,
  children,
  targetSection,
  targetParagraphId,
  targetCharPosition,
  wordStatuses = {},
  colors,
}: ReaderEngineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // The memo below skips re-renders, so callbacks are read through a ref.
  const onPageTurnRef = useRef(onPageTurn);
  onPageTurnRef.current = onPageTurn;
  // Touch input is handled in touchend; the click the browser emulates afterwards must not act again.
  const lastTouchEndRef = useRef(0);

  // Height of the page box (the content element; its height is fixed at 100%, the container may
  // add padding): a vertical-text page is exactly this tall (see contentStyle).
  const [boxHeight, setBoxHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setBoxHeight(content.clientHeight || window.innerHeight));
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Initialize native parser
  const [parserReady, setParserReady] = useState(false);
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    setupNativeYoruParser().then((fn) => {
      cleanup = fn;
      setParserReady(true);
    }).catch(err => {
      console.warn('Parser setup error:', err);
      setParserReady(true);
    });
    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  // Current chapter / section index
  const [currSection, setCurrSection] = useState<number>(() => {
    const saved = book._savedSection ?? book.progress?.currentChapter;
    return typeof saved === 'number' && saved >= 0 ? saved : 0;
  });

  // Current discrete page index
  const [pageIndex, setPageIndex] = useState<number>(0);

  // Keep only section offsets here. Tokenizing every chapter at once creates a
  // large HTML copy of the whole book and can exhaust Android WebView memory.
  const sections = useMemo<Section[]>(() => computeSections(book), [book]);

  useEffect(() => {
    if (sections.length > 0 && currSection >= sections.length) {
      pendingParagraphRef.current = null;
      setCurrSection(0);
    }
  }, [sections.length, currSection]);

  const totalChars = useMemo(() => {
    if (sections.length === 0) return 0;
    const lastSection = sections[sections.length - 1];
    return lastSection.startChars + (lastSection.charCount || 0);
  }, [sections]);

  const {
    vertical,
    paginated,
    fontSize,
    lineHeight,
    verticalPadding,
    horizontalPadding,
    fontFamily,
  } = readerSettings;
  const fontWeight = readerSettings.fontWeight || 400;
  const textAlign = readerSettings.textAlign || 'original';
  const hyphenation = !!readerSettings.hyphenation;

  // Outer container styles
  const containerStyle = useMemo<React.CSSProperties>(() => {
    return {
      fontFamily: fontFamily !== '__default__' ? `"${fontFamily}", serif` : 'inherit',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      position: 'relative',
      backgroundColor: colors.bg,
      color: colors.textMain,
    };
  }, [fontFamily, colors.bg, colors.textMain]);

  // Content styles
  const contentStyle = useMemo<React.CSSProperties>(() => {
    const vpPx = Math.max(10, window.innerHeight * (verticalPadding / 100));
    const vp = `${vpPx}px`;
    const hp = `${Math.max(10, window.innerWidth * (horizontalPadding / 100))}px`;

    const base: React.CSSProperties = {
      margin: 'auto',
      fontFamily: fontFamily !== '__default__' ? `"${fontFamily}", serif` : 'inherit',
      fontSize: `${fontSize}px`,
      lineHeight: `${lineHeight}`,
      padding: `${vp} ${hp}`,
      backgroundColor: colors.bg,
      color: colors.textMain,
      boxSizing: 'border-box',
      fontWeight,
      ...(textAlign !== 'original' ? { textAlign } : {}),
      ...(hyphenation ? { hyphens: 'auto' as const, WebkitHyphens: 'auto' as const } : {}),
    };

    if (paginated && vertical) {
      return {
        ...base,
        writingMode: 'vertical-rl',
        overflowX: 'hidden',
        overflowY: 'hidden',
        width: '100%',
        height: '100%',
        // In vertical-rl a column's width is its height and columns stack downwards: each column
        // fills the page between the top and bottom margins, and the gap spans both margins, so
        // page N starts exactly at N * page height.
        columnGap: `${vpPx * 2}px`,
        columnWidth: `${Math.max(120, boxHeight - vpPx * 2)}px`,
        columnFill: 'auto',
      };
    } else if (paginated && !vertical) {
      return {
        ...base,
        writingMode: 'horizontal-tb',
        overflowY: 'hidden',
        overflowX: 'hidden',
        width: '100%',
        height: '100%',
        columnGap: `calc(${hp} * 2)`,
        columnWidth: `calc(100vw - ${hp} * 2)`,
        columnFill: 'auto',
      };
    } else if (!paginated && vertical) {
      return {
        ...base,
        writingMode: 'vertical-rl',
        overflowX: 'auto',
        overflowY: 'hidden',
        height: '100%',
        width: '100%',
      };
    } else {
      return {
        ...base,
        writingMode: 'horizontal-tb',
        height: '100%',
        width: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
      };
    }
  }, [fontSize, lineHeight, verticalPadding, horizontalPadding, vertical, paginated, fontFamily, colors.bg, colors.textMain, fontWeight, textAlign, hyphenation, boxHeight]);

  // Update current chars read based on visible elements
  const updateChars = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;

    let lastIndex = 0;
    let currChars = 0;
    const pTags = content.querySelectorAll('[index]');
    const box = paginated ? content.getBoundingClientRect() : null;
    const onPage = (element: Element) => Array.from(element.getClientRects()).some((r) =>
      r.bottom > box!.top + 1 && r.top < box!.bottom - 1 && r.right > box!.left + 1 && r.left < box!.right - 1);

    for (let i = 0; i < pTags.length; i++) {
      lastIndex = Number(pTags[i].getAttribute('index')) || lastIndex;
      currChars = Number(pTags[i].getAttribute('characumm')) || currChars;

      // Stop at first visible element
      if (box) {
        if (onPage(pTags[i])) break;
        continue;
      }
      const rect = pTags[i].getBoundingClientRect();
      if ((!vertical && rect.bottom > 0) || (vertical && rect.right > 0)) {
        break;
      }
    }

    if (onCharsUpdate) {
      onCharsUpdate({ currChars, totalChars, lastIndex, currSection });
    }
  }, [paginated, vertical, totalChars, currSection, onCharsUpdate]);

  // Calculate total pages in current section
  // Vertical text: columns stack downwards, so its pages run on the Y axis. Horizontal text: on X.
  const pagesOnY = useCallback(() => {
    const content = contentRef.current;
    return !!content && content.scrollWidth <= content.clientWidth + 2 && content.scrollHeight > content.clientHeight + 2;
  }, []);

  const getMaxPages = useCallback(() => {
    const content = contentRef.current;
    if (!content) return 1;
    if (pagesOnY()) {
      return Math.max(1, Math.round(content.scrollHeight / (content.clientHeight || window.innerHeight)));
    }
    const clientW = content.clientWidth || window.innerWidth;
    const scrollW = content.scrollWidth;
    return Math.max(1, Math.ceil(scrollW / clientW));
  }, [pagesOnY]);

  // Pages on Y cannot glide sideways, so the new page slides in (from the left when reading forward
  // in vertical text, as in ReadEra).
  const slideIn = useCallback((content: HTMLElement, forward: boolean) => {
    if (typeof content.animate !== 'function') return;
    const from = forward === vertical ? '-24%' : '24%';
    content.animate(
      [{ transform: `translateX(${from})`, opacity: 0.3 }, { transform: 'translateX(0)', opacity: 1 }],
      { duration: 260, easing: 'cubic-bezier(0.22, 0.8, 0.3, 1)' },
    );
  }, [vertical]);

  // Page-turn slide (ReadEra-style): pages sit side by side and glide into place.
  const slideAnimationRef = useRef<number | null>(null);
  const stopSlide = useCallback(() => {
    if (slideAnimationRef.current !== null) {
      cancelAnimationFrame(slideAnimationRef.current);
      slideAnimationRef.current = null;
    }
  }, []);
  const slideTo = useCallback((content: HTMLDivElement, targetLeft: number, onDone: () => void) => {
    stopSlide();
    const from = content.scrollLeft;
    const distance = targetLeft - from;
    if (Math.abs(distance) < 1) {
      content.scrollLeft = targetLeft;
      onDone();
      return;
    }
    const duration = Math.min(320, 160 + Math.abs(distance) * 0.25);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      content.scrollLeft = from + distance * eased;
      if (t < 1) {
        slideAnimationRef.current = requestAnimationFrame(step);
      } else {
        slideAnimationRef.current = null;
        content.scrollLeft = targetLeft;
        onDone();
      }
    };
    slideAnimationRef.current = requestAnimationFrame(step);
  }, [stopSlide]);

  // Sync scroll position (animate = slide to the page instead of jumping)
  const applyPagePosition = useCallback((targetPage: number, animate = false) => {
    const content = contentRef.current;
    if (!content) return;

    if (pagesOnY()) {
      stopSlide();
      const pageHeight = content.clientHeight || window.innerHeight;
      const from = Math.round(content.scrollTop / pageHeight);
      content.scrollTop = targetPage * pageHeight;
      if (animate && from !== targetPage) {
        slideIn(content, targetPage > from);
        // Progress makes the whole reader re-render: do it once the slide has played, so the
        // first frames of the animation are not delayed.
        window.setTimeout(updateChars, 280);
      } else {
        updateChars();
      }
      return;
    }

    const clientW = content.clientWidth || window.innerWidth;
    const targetLeft = vertical ? -targetPage * clientW : targetPage * clientW;
    const pagesOnX = content.scrollWidth > content.clientWidth + 2;
    if (animate && pagesOnX && document.visibilityState === 'visible') {
      slideTo(content, targetLeft, updateChars);
      return;
    }
    stopSlide();
    if (vertical) {
      content.scrollLeft = targetLeft;
    } else {
      content.scrollTo({ left: targetLeft, behavior: 'instant' });
    }
    updateChars();
  }, [vertical, updateChars, slideTo, stopSlide, pagesOnY, slideIn]);

  const statePageIndex = pageIndex;
  // Page flip function (1 = forward, -1 = backward). fromLeft: where a drag started.
  const flipPage = useCallback((multiplier: number, fromLeft?: number) => {
    const content = contentRef.current;
    if (!content) return;
    onPageTurnRef.current?.();

    if (paginated) {
      const maxPages = getMaxPages();
      // The page on screen, read from the scroll position: jumps (search, notes, the page bar)
      // move the content without updating pageIndex. While a slide runs, pageIndex is its target.
      const onY = pagesOnY();
      const pagesOnX = content.scrollWidth > content.clientWidth + 2;
      const pageSize = onY ? (content.clientHeight || window.innerHeight) : (content.clientWidth || window.innerWidth);
      const position = onY ? content.scrollTop : Math.abs(fromLeft ?? content.scrollLeft);
      const pageIndex = slideAnimationRef.current !== null || (!pagesOnX && !onY)
        ? statePageIndex
        : Math.max(0, Math.min(maxPages - 1, Math.round(position / pageSize)));

      if (multiplier === 1) {
        // Forward
        if (pageIndex < maxPages - 1) {
          const next = pageIndex + 1;
          setPageIndex(next);
          applyPagePosition(next, true);
        } else {
          // Advance to next chapter
          if (currSection < sections.length - 1) {
            setCurrSection(prev => prev + 1);
            setPageIndex(0);
            requestAnimationFrame(() => { if (contentRef.current) slideIn(contentRef.current, true); });
          }
        }
      } else if (multiplier === -1) {
        // Backward
        if (pageIndex > 0) {
          const prev = pageIndex - 1;
          setPageIndex(prev);
          applyPagePosition(prev, true);
        } else {
          // Go to previous chapter
          if (currSection > 0) {
            setCurrSection(prev => prev - 1);
            requestAnimationFrame(() => {
              const prevMax = getMaxPages();
              const lastPage = Math.max(0, prevMax - 1);
              setPageIndex(lastPage);
              applyPagePosition(lastPage);
              if (contentRef.current) slideIn(contentRef.current, false);
            });
          }
        }
      }
    } else {
      // Continuous scroll mode
      if (vertical) {
        content.scrollLeft -= 200 * multiplier;
      } else {
        content.scrollTop += 200 * multiplier;
      }
      updateChars();
    }
  }, [paginated, vertical, statePageIndex, currSection, sections.length, getMaxPages, applyPagePosition, updateChars, pagesOnY, slideIn]);

  // Jump directly to section
  const goToSection = useCallback((sectionIdx: number) => {
    if (sectionIdx < 0 || sectionIdx >= sections.length) return;
    setCurrSection(sectionIdx);
    setPageIndex(0);
    const content = contentRef.current;
    if (content) {
      content.scrollLeft = 0;
      content.scrollTop = 0;
    }
    requestAnimationFrame(() => updateChars());
  }, [sections.length, updateChars]);

  useEffect(() => {
    if (typeof targetSection === 'number') {
      goToSection(targetSection);
    }
  }, [targetSection, goToSection]);

  const revealRange = useCallback((range: Range) => {
    const content = contentRef.current;
    if (!content) return;
    const rect = range.getClientRects()[0] || range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return;
    const box = content.getBoundingClientRect();
    const visible = rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
    if (visible) return;

    // Some engines lay vertical-rl columns out downwards: then the pages scroll on the Y axis.
    const pagesOnYAxis = paginated
      && content.scrollWidth <= content.clientWidth + 2
      && content.scrollHeight > content.clientHeight + 2;
    if (pagesOnYAxis) {
      const pageHeight = content.clientHeight || window.innerHeight;
      const page = Math.max(0, Math.floor((rect.top - box.top + content.scrollTop + 1) / pageHeight));
      content.scrollTop = page * pageHeight;
      setPageIndex(page);
      updateChars();
    } else if (paginated) {
      const pageWidth = content.clientWidth || window.innerWidth;
      // Distance from the start of the section (left edge, or right edge for vertical text).
      const offset = vertical
        ? box.right - rect.right - content.scrollLeft
        : rect.left - box.left + content.scrollLeft;
      const page = Math.max(0, Math.min(getMaxPages() - 1, Math.floor((offset + 1) / pageWidth)));
      setPageIndex(page);
      applyPagePosition(page);
    } else {
      // Bring the range to the middle of the scroller (works for both writing modes).
      content.scrollBy({
        left: (rect.left + rect.right) / 2 - (box.left + box.right) / 2,
        top: (rect.top + rect.bottom) / 2 - (box.top + box.bottom) / 2,
      });
      updateChars();
    }
  }, [paginated, vertical, getMaxPages, applyPagePosition, updateChars]);

  const showElement = (element: Element) => {
    if (!paginated) {
      element.scrollIntoView({ inline: 'center', block: 'center' });
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(element);
    revealRange(range);
  };

  // Opening a book resumes at the saved paragraph (the effect below shows it once rendered).
  const pendingParagraphRef = useRef<number | null>(
    (book.progress?.currentPage ?? 0) > 0 ? book.progress!.currentPage! : null
  );
  const goToParagraph = useCallback((sectionIndex: number, paragraphId: number) => {
    const show = () => {
      const element = contentRef.current?.querySelector(`[index="${paragraphId}"]`);
      if (!element) return false;
      const range = document.createRange();
      range.selectNodeContents(element);
      revealRange(range);
      return true;
    };
    if (paginated && sectionIndex !== currSection) {
      pendingParagraphRef.current = paragraphId;
      setCurrSection(sectionIndex);
      setPageIndex(0);
    } else {
      show();
    }
  }, [paginated, currSection, revealRange]);

  // After a section change requested by goToParagraph, show the paragraph once it is rendered.
  useEffect(() => {
    const paragraphId = pendingParagraphRef.current;
    if (paragraphId === null) return;
    // After the section-change reset (which scrolls to the start) has run.
    const timer = window.setTimeout(() => {
      pendingParagraphRef.current = null;
      const element = contentRef.current?.querySelector(`[index="${paragraphId}"]`);
      if (!element) return;
      showElement(element);
      updateChars();
    }, 60);
    return () => window.clearTimeout(timer);
  });

  if (apiRef) {
    apiRef.current = {
      getContent: () => contentRef.current,
      revealRange,
      goToNextSection: () => {
        if (!paginated || currSection >= sections.length - 1) return false;
        setCurrSection(currSection + 1);
        setPageIndex(0);
        return true;
      },
      goToParagraph,
      getSections: () => sections,
      getCurrentSection: () => currSection,
      isPaginated: () => paginated,
      getPageInfo: () => {
        // Pages run on X, or on Y where an engine lays vertical columns downwards (see revealRange).
        const content = contentRef.current;
        if (!content) return { page: 0, pages: 1 };
        const onY = content.scrollWidth <= content.clientWidth + 2 && content.scrollHeight > content.clientHeight + 2;
        const pages = onY ? Math.max(1, Math.ceil(content.scrollHeight / (content.clientHeight || 1))) : getMaxPages();
        return { page: Math.min(pageIndex, pages - 1), pages };
      },
      turnPage: (direction) => flipPage(direction),
    };
  }

  useEffect(() => {
    if (typeof targetParagraphId === 'number') {
      const content = contentRef.current;
      if (content) {
        const el = content.querySelector(`[index="${targetParagraphId}"]`);
        if (el) {
          showElement(el);
          updateChars();
        }
      }
    }
  }, [targetParagraphId, updateChars]);

  useEffect(() => {
    if (typeof targetCharPosition === 'number' && targetCharPosition >= 0 && sections.length > 0) {
      const sectionIdx = sections.findIndex((s, idx) => {
        const nextSection = sections[idx + 1];
        if (!nextSection) return true;
        return targetCharPosition >= s.startChars && targetCharPosition < nextSection.startChars;
      });

      if (sectionIdx !== -1) {
        setCurrSection(sectionIdx);
        setPageIndex(0);
        requestAnimationFrame(() => {
          const content = contentRef.current;
          if (content) {
            const pTags = content.querySelectorAll('[characumm]');
            let targetP: HTMLElement | null = null;
            for (let i = 0; i < pTags.length; i++) {
              const accum = parseInt(pTags[i].getAttribute('characumm') || '0', 10);
              if (accum <= targetCharPosition) {
                targetP = pTags[i] as HTMLElement;
              } else {
                break;
              }
            }
            if (targetP) {
              showElement(targetP);
            }
          }
          updateChars();
        });
      }
    }
  }, [targetCharPosition, sections, updateChars]);

  // Reset scroll & update chars on section change
  useEffect(() => {
    const c = contentRef.current;
    if (c) {
      c.scrollLeft = 0;
      c.scrollTop = 0;
    }
    requestAnimationFrame(() => updateChars());
    if (onSectionChange) onSectionChange(currSection);
  }, [currSection, onSectionChange, updateChars]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;

      if (vertical) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          flipPage(1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          flipPage(-1);
        }
      } else {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          flipPage(1);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          flipPage(-1);
        }
      }

      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        flipPage(1);
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        flipPage(-1);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [vertical, flipPage]);

  // Hardware Volume Keys Navigation (phones only: on a PC the keyboard's volume keys must just change the volume)
  useEffect(() => {
    if (readerSettings.volumeKeysNavigation === false || !isPhoneUI()) return;
    const handleVolumeKey = (e: KeyboardEvent) => {
      const isVolUp = e.key === 'VolumeUp' || e.key === 'AudioVolumeUp' || e.code === 'VolumeUp' || (e as any).keyCode === 175 || (e as any).keyCode === 24;
      const isVolDown = e.key === 'VolumeDown' || e.key === 'AudioVolumeDown' || e.code === 'VolumeDown' || (e as any).keyCode === 174 || (e as any).keyCode === 25;

      if (isVolUp || isVolDown) {
        e.preventDefault();
        const isForward = readerSettings.invertVolumeKeys ? isVolUp : isVolDown;
        flipPage(isForward ? 1 : -1);
      }
    };

    window.addEventListener('keydown', handleVolumeKey, { capture: true });
    return () => window.removeEventListener('keydown', handleVolumeKey, { capture: true });
  }, [readerSettings.volumeKeysNavigation, readerSettings.invertVolumeKeys, flipPage]);

  // Continuous Auto-Scroll Engine (Yoru Feature)
  useEffect(() => {
    if (!readerSettings.autoScrollEnabled) return;
    let isPaused = false;
    let animationFrameId: number;
    const container = containerRef.current;
    if (!container) return;

    let lastTime = performance.now();
    const scrollSpeed = (readerSettings.autoScrollSpeed || 1.0) * 45; // px per second

    const step = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      if (!isPaused) {
        if (vertical) {
          container.scrollLeft -= scrollSpeed * dt;
        } else {
          container.scrollTop += scrollSpeed * dt;
        }
      }
      animationFrameId = requestAnimationFrame(step);
    };

    animationFrameId = requestAnimationFrame(step);

    const onUserTouch = () => {
      isPaused = true;
      clearTimeout((window as any)._yoruAutoScrollResume);
      (window as any)._yoruAutoScrollResume = setTimeout(() => {
        isPaused = false;
      }, 2000);
    };

    window.addEventListener('touchstart', onUserTouch, { passive: true });
    window.addEventListener('mousedown', onUserTouch, { passive: true });

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('touchstart', onUserTouch);
      window.removeEventListener('mousedown', onUserTouch);
    };
  }, [readerSettings.autoScrollEnabled, readerSettings.autoScrollSpeed, vertical]);

  // Mobile Touch Swipe & Tap Zones
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    // Paged mode drag: the page follows the finger, the next one slides in beside it.
    let dragBaseLeft = 0;
    let dragging = false;
    let dragCancelled = false;
    // 'scroll': pages side by side (horizontal text). 'shift': pages on Y, the page itself follows the finger.
    let dragKind: 'scroll' | 'shift' = 'scroll';
    // Touch moves can arrive faster than the screen refreshes: move the page once per frame.
    let dragDx = 0;
    let dragFrame: number | null = null;
    const applyDrag = () => {
      dragFrame = null;
      const content = contentRef.current;
      if (!content || !dragging) return;
      if (dragKind === 'shift') content.style.transform = `translateX(${dragDx}px)`;
      else content.scrollLeft = dragBaseLeft - dragDx;
    };
    const cancelDragFrame = () => {
      if (dragFrame !== null) cancelAnimationFrame(dragFrame);
      dragFrame = null;
    };

    const canShiftPage = () => {
      const content = contentRef.current;
      if (!paginated || !content || !pagesOnY()) return false;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return false;
      return !document.querySelector('.dict-popup');
    };

    const canDragPages = () => {
      const content = contentRef.current;
      if (!paginated || !content) return false;
      if (content.scrollWidth <= content.clientWidth + 2) return false; // pages are not side by side
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return false; // selecting text
      return !document.querySelector('.dict-popup');
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
        dragging = false;
        dragCancelled = false;
        const content = contentRef.current;
        if (content) {
          content.style.transform = '';
          // Catch a page that is still sliding.
          stopSlide();
          dragBaseLeft = content.scrollLeft;
        }
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1 || dragCancelled) return;
      const dx = e.touches[0].clientX - touchStartX;
      const dy = e.touches[0].clientY - touchStartY;
      if (!dragging) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        const kind = canDragPages() ? 'scroll' : canShiftPage() ? 'shift' : null;
        if (Math.abs(dy) > Math.abs(dx) || !kind) {
          dragCancelled = true;
          return;
        }
        dragKind = kind;
        dragging = true;
      }
      dragDx = dx;
      if (dragFrame === null) dragFrame = requestAnimationFrame(applyDrag);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length === 0) return;
      lastTouchEndRef.current = Date.now();
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const deltaX = touchEndX - touchStartX;
      const deltaY = touchEndY - touchStartY;
      const deltaTime = Date.now() - touchStartTime;

      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (dragging) {
        cancelDragFrame();
        dragging = false;
        const content = contentRef.current;
        const width = content?.clientWidth || window.innerWidth;
        // Turn when dragged past a fifth of the page, or on a quick flick.
        const turn = absX > width * 0.2 || (absX > 30 && deltaTime < 250);
        if (dragKind === 'shift' && content) {
          content.style.transform = '';
          if (!turn && typeof content.animate === 'function') {
            content.animate([{ transform: `translateX(${deltaX}px)` }, { transform: 'translateX(0)' }], { duration: 180, easing: 'ease-out' });
          }
        }
        if (turn) {
          // Vertical Japanese: dragging right brings the next page; horizontal text: dragging left.
          const forward = vertical ? deltaX > 0 : deltaX < 0;
          flipPage(forward ? 1 : -1, dragKind === 'scroll' ? dragBaseLeft : undefined);
        } else if (content && dragKind === 'scroll') {
          slideTo(content, dragBaseLeft, updateChars);
        }
        return;
      }

      // SWIPE DETECTION (Threshold: 30px distance or quick flick)
      if (absX > 30 || absY > 30) {
        if (absX > absY) {
          // Horizontal Swipe
          if (vertical) {
            // In Japanese vertical right-to-left: Swipe Right = Next Page, Swipe Left = Prev Page
            if (deltaX > 30) {
              flipPage(1); // Next page
            } else if (deltaX < -30) {
              flipPage(-1); // Prev page
            }
          } else {
            // Horizontal text: Swipe Left = Next Page, Swipe Right = Prev Page
            if (deltaX < -30) {
              flipPage(1); // Next page
            } else if (deltaX > 30) {
              flipPage(-1); // Prev page
            }
          }
        } else {
          // Vertical Swipe (Swipe Up = Next, Swipe Down = Prev)
          if (deltaY < -30) {
            flipPage(1);
          } else if (deltaY > 30) {
            flipPage(-1);
          }
        }
        return;
      }

      // TAP ZONES (Short touch without drag)
      if (deltaTime < 350 && absX < 15 && absY < 15) {
        const target = e.target as HTMLElement;
        // Don't trigger page turn if tapping a word, ruby or interactive element
        if (target?.closest?.('[data-word], [wordId], .jiten-word, .yoru-word, ruby, a, button, .dict-popup')) {
          return;
        }
        // An open dictionary popup is dismissed by this tap; don't also turn the page
        if (document.querySelector('.dict-popup')) {
          return;
        }

        const screenWidth = window.innerWidth;
        const tapX = touchEndX;

        const tapMode = readerSettings.tapZoneMode || 'edge';
        const invert = readerSettings.invertTapZones || false;

        if (tapMode === 'kindle') {
          // Kindle Style: 20% left is Prev, 80% right is Next
          if (tapX < screenWidth * 0.20) {
            flipPage(invert ? 1 : -1);
          } else {
            flipPage(invert ? -1 : 1);
          }
        } else {
          // Edge Style: 25% Left, 50% Center, 25% Right
          if (tapX < screenWidth * 0.25) {
            const dir = vertical ? 1 : -1;
            flipPage(invert ? -dir : dir);
          } else if (tapX > screenWidth * 0.75) {
            const dir = vertical ? -1 : 1;
            flipPage(invert ? -dir : dir);
          } else {
            if (onClick) onClick(e as any);
          }
        }
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      cancelDragFrame();
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [vertical, paginated, flipPage, onClick, slideTo, stopSlide, updateChars, pagesOnY]);

  // Mouse wheel
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (paginated) {
        e.preventDefault();
        flipPage(e.deltaY > 0 ? 1 : -1);
      } else if (vertical && !paginated) {
        container.scrollLeft -= e.deltaY;
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [paginated, vertical, flipPage]);

  // Resize handling
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleResize = () => {
      container.style.setProperty('--reader-height', `${window.innerHeight}px`);
      container.style.setProperty('--reader-width', `${window.innerWidth}px`);
      container.style.setProperty(
        '--reader-image-height',
        `${window.innerHeight - 2 * window.innerHeight * (verticalPadding / 100) - 60}px`
      );
      container.style.setProperty(
        '--reader-image-width',
        `${window.innerWidth - 2 * window.innerWidth * (horizontalPadding / 100) - 60}px`
      );

      // A page-turn slide is already taking the content to this page; let it finish.
      if (paginated && slideAnimationRef.current === null) {
        applyPagePosition(pageIndex);
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      container.style.removeProperty('--reader-height');
      container.style.removeProperty('--reader-width');
      container.style.removeProperty('--reader-image-height');
      container.style.removeProperty('--reader-image-width');
    };
  }, [verticalPadding, horizontalPadding, paginated, pageIndex, applyPagePosition]);

  // Jiten parser (when the user saved a Jiten API key and there is no reader extension).
  const [jitenEnabled, setJitenEnabled] = useState(() => isJitenParserEnabled());
  // Rendered into the HTML by the tokenizers, so a change re-renders the section.
  const [furiganaNew, setFuriganaNew] = useState(() => isFuriganaOnNewWords());
  useEffect(() => {
    const refresh = () => {
      setJitenEnabled(isJitenParserEnabled());
      setFuriganaNew(isFuriganaOnNewWords());
    };
    window.addEventListener('yoru-parser-settings-changed', refresh);
    const unsubscribe = onJitenChange(refresh);
    return () => {
      window.removeEventListener('yoru-parser-settings-changed', refresh);
      unsubscribe();
    };
  }, []);
  const jitenPendingRef = useRef<PendingJitenParagraph[]>([]);

  // Build current section HTML
  const currentHtml = useMemo(() => {
    const pending: PendingJitenParagraph[] = [];
    jitenPendingRef.current = pending;
    const renderSection = (section: Section) => {
      const chapterContent = book.chapters?.[section.chapterIndex]?.content || '';
      return renderSectionContent(
        chapterContent.slice(section.startOffset, section.endOffset),
        section.startParagraphId,
        section.startChars,
        wordStatuses,
        jitenEnabled ? pending : null,
      );
    };

    if (paginated) {
      const currentSection = sections[currSection];
      return currentSection ? renderSection(currentSection) : '';
    }
    return sections.map(renderSection).join('');
  }, [book.chapters, sections, currSection, paginated, wordStatuses, parserReady, jitenEnabled, furiganaNew]);

  // Ask Jiten for the paragraphs on screen, then swap them in place (same text, so the page does not move).
  useEffect(() => {
    if (!jitenEnabled) return;
    let pending = jitenPendingRef.current;
    if (!paginated) {
      // Continuous mode renders the whole book: only parse around the current section.
      const near = sections.slice(Math.max(0, currSection - 1), currSection + 2);
      pending = pending.filter((item) => near.some((section) => item.paragraphId >= section.startParagraphId && item.paragraphId <= section.lastIndex));
    }
    if (pending.length === 0) return;
    // Not cancelled on re-run: a paragraph that left the page simply is not found, and one still
    // shown must be swapped even if a newer request skipped it as already in flight.
    parseWithJiten(pending.map((item) => item.text)).then((parsed) => {
      const content = contentRef.current;
      if (!content || parsed.length === 0) return;
      for (const item of pending) {
        const tokens = getCachedJitenTokens(item.text);
        const element = content.querySelector(`p.chapter-content[index="${item.paragraphId}"]`);
        if (tokens && element && !element.querySelector('[data-jiten]')) {
          element.innerHTML = renderJitenParagraph(item.html, tokens, getJitenWord);
        }
      }
    });
  }, [currentHtml, jitenEnabled, paginated, sections, currSection]);

  const handleContentClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const onWord = !!target?.closest?.('[data-word], [wordId], .jiten-word, .yoru-word, ruby, a, button');
    // After a touch, touchend already turned the page or toggled the bars: the emulated click only opens words.
    if (Date.now() - lastTouchEndRef.current < 800) {
      if (onWord && onClick) onClick(e);
      return;
    }
    if (onWord || !paginated) {
      if (onClick) onClick(e);
      return;
    }
    // A click that closes the dictionary popup or ends a text selection does not turn the page.
    if (document.querySelector('.dict-popup')) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;

    const rect = containerRef.current?.getBoundingClientRect();
    const width = rect?.width || window.innerWidth;
    const x = e.clientX - (rect?.left || 0);
    const invert = readerSettings.invertTapZones || false;
    if ((readerSettings.tapZoneMode || 'edge') === 'kindle') {
      flipPage(x < width * 0.2 ? (invert ? 1 : -1) : (invert ? -1 : 1));
    } else if (x < width * 0.25 || x > width * 0.75) {
      // Vertical text reads right to left: the left edge is the next page.
      const dir = (x < width * 0.25) === vertical ? 1 : -1;
      flipPage(invert ? -dir : dir);
    } else if (onClick) {
      onClick(e);
    }
  }, [onClick, paginated, vertical, flipPage, readerSettings.tapZoneMode, readerSettings.invertTapZones]);

  const maxWidthStyle = readerSettings.readerMaxWidth && readerSettings.readerMaxWidth !== 'none'
    ? { maxWidth: readerSettings.readerMaxWidth, margin: '0 auto' }
    : {};

  return (
    <div
      ref={containerRef}
      style={{ ...containerStyle, ...maxWidthStyle }}
      onClick={handleContentClick}
      className={`reader-engine-container book-content ${vertical ? 'book-content--writing-vertical-rl' : 'book-content--writing-horizontal-tb'}`}
    >
      {/* In-App Reader Brightness Overlay (Yoru Feature) */}
      {typeof readerSettings.readerBrightness === 'number' && readerSettings.readerBrightness < 100 && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: `rgba(0, 0, 0, ${(100 - readerSettings.readerBrightness) / 100})`,
            pointerEvents: 'none',
            zIndex: 99999,
            transition: 'background-color 0.15s ease'
          }}
        />
      )}
      <div
        ref={contentRef}
        id={`ttu-chapter-${currSection}`}
        style={contentStyle}
        className="reader-engine-content book-content-container"
        data-align={textAlign !== 'original' ? textAlign : undefined}
        dangerouslySetInnerHTML={{ __html: currentHtml }}
      />
      {children}
    </div>
  );
}

export const ReaderEngine = React.memo(ReaderEngineComponent, (prevProps, nextProps) => {
  return (
    prevProps.book.id === nextProps.book.id &&
    prevProps.readerSettings.fontSize === nextProps.readerSettings.fontSize &&
    prevProps.readerSettings.lineHeight === nextProps.readerSettings.lineHeight &&
    prevProps.readerSettings.vertical === nextProps.readerSettings.vertical &&
    prevProps.readerSettings.paginated === nextProps.readerSettings.paginated &&
    prevProps.readerSettings.theme === nextProps.readerSettings.theme &&
    prevProps.readerSettings.fontWeight === nextProps.readerSettings.fontWeight &&
    prevProps.readerSettings.textAlign === nextProps.readerSettings.textAlign &&
    prevProps.readerSettings.hyphenation === nextProps.readerSettings.hyphenation &&
    prevProps.readerSettings.fontFamily === nextProps.readerSettings.fontFamily &&
    prevProps.readerSettings.verticalPadding === nextProps.readerSettings.verticalPadding &&
    prevProps.readerSettings.horizontalPadding === nextProps.readerSettings.horizontalPadding &&
    prevProps.targetSection === nextProps.targetSection &&
    prevProps.targetParagraphId === nextProps.targetParagraphId &&
    prevProps.targetCharPosition === nextProps.targetCharPosition &&
    prevProps.wordStatuses === nextProps.wordStatuses &&
    prevProps.colors === nextProps.colors
  );
});

export default ReaderEngine;
