import React, { useState, useEffect, useRef, useMemo, useCallback, ReactNode } from 'react';
import { ReaderSettingsState } from '../../hooks/useReaderSettings';
import { tokenizeJapaneseText, setupNativeYoruParser, jitenPlainText, renderJitenParagraph } from '../../utils/yoruParserNative';
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
}

export interface ReaderEngineProps {
  apiRef?: React.MutableRefObject<ReaderEngineApi | null>;
  book: Book;
  readerSettings: ReaderSettingsState;
  onCharsUpdate?: (payload: CharsUpdatePayload) => void;
  onSectionChange?: (sectionIndex: number) => void;
  onClick?: (e: React.MouseEvent) => void;
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
  children,
  targetSection,
  targetParagraphId,
  targetCharPosition,
  wordStatuses = {},
  colors,
}: ReaderEngineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

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
    const saved = book._savedSection;
    return typeof saved === 'number' && saved >= 0 ? saved : 0;
  });

  // Current discrete page index
  const [pageIndex, setPageIndex] = useState<number>(0);

  // Keep only section offsets here. Tokenizing every chapter at once creates a
  // large HTML copy of the whole book and can exhaust Android WebView memory.
  const sections = useMemo<Section[]>(() => {
    if (!book || !book.chapters || book.chapters.length === 0) return [];
    let paragraphId = 0;
    let charAccum = 0;
    const resultSections: Section[] = [];

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
            title: chapter.title ? (subSectionIdx === 0 ? chapter.title : `${chapter.title} (${subSectionIdx + 1})`) : `Capítulo ${chapterIdx + 1}`,
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
          title: chapter.title ? (subSectionIdx === 0 ? chapter.title : `${chapter.title} (${subSectionIdx + 1})`) : `Capítulo ${chapterIdx + 1}`,
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
  }, [book]);

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
    const vp = `${Math.max(10, window.innerHeight * (verticalPadding / 100))}px`;
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
    };

    if (paginated && vertical) {
      return {
        ...base,
        writingMode: 'vertical-rl',
        overflowX: 'hidden',
        overflowY: 'hidden',
        width: '100%',
        height: '100%',
        columnGap: `calc(${hp} * 2)`,
        columnWidth: `calc(100vw - ${hp} * 2)`,
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
  }, [fontSize, lineHeight, verticalPadding, horizontalPadding, vertical, paginated, fontFamily, colors.bg, colors.textMain]);

  // Update current chars read based on visible elements
  const updateChars = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;

    let lastIndex = 0;
    let currChars = 0;
    const pTags = content.querySelectorAll('[index]');

    for (let i = 0; i < pTags.length; i++) {
      const rect = pTags[i].getBoundingClientRect();
      lastIndex = Number(pTags[i].getAttribute('index')) || lastIndex;
      currChars = Number(pTags[i].getAttribute('characumm')) || currChars;

      // Stop at first visible element
      if (
        (!paginated && !vertical && rect.bottom > 0) ||
        (!paginated && vertical && rect.right > 0) ||
        (paginated && !vertical && rect.right > 0) ||
        (paginated && vertical && rect.right > 0)
      ) {
        break;
      }
    }

    if (onCharsUpdate) {
      onCharsUpdate({ currChars, totalChars, lastIndex, currSection });
    }
  }, [paginated, vertical, totalChars, currSection, onCharsUpdate]);

  // Calculate total pages in current section
  const getMaxPages = useCallback(() => {
    const content = contentRef.current;
    if (!content) return 1;
    const clientW = content.clientWidth || window.innerWidth;
    const scrollW = content.scrollWidth;
    return Math.max(1, Math.ceil(scrollW / clientW));
  }, []);

  // Sync scroll position
  const applyPagePosition = useCallback((targetPage: number) => {
    const content = contentRef.current;
    if (!content) return;

    const clientW = content.clientWidth || window.innerWidth;
    if (vertical) {
      content.scrollLeft = -targetPage * clientW;
    } else {
      content.scrollTo({ left: targetPage * clientW, behavior: 'instant' });
    }
    updateChars();
  }, [vertical, updateChars]);

  // Page flip function (1 = forward, -1 = backward)
  const flipPage = useCallback((multiplier: number) => {
    const content = contentRef.current;
    if (!content) return;

    if (paginated) {
      const maxPages = getMaxPages();

      if (multiplier === 1) {
        // Forward
        if (pageIndex < maxPages - 1) {
          const next = pageIndex + 1;
          setPageIndex(next);
          applyPagePosition(next);
        } else {
          // Advance to next chapter
          if (currSection < sections.length - 1) {
            setCurrSection(prev => prev + 1);
            setPageIndex(0);
          }
        }
      } else if (multiplier === -1) {
        // Backward
        if (pageIndex > 0) {
          const prev = pageIndex - 1;
          setPageIndex(prev);
          applyPagePosition(prev);
        } else {
          // Go to previous chapter
          if (currSection > 0) {
            setCurrSection(prev => prev - 1);
            requestAnimationFrame(() => {
              const prevMax = getMaxPages();
              const lastPage = Math.max(0, prevMax - 1);
              setPageIndex(lastPage);
              applyPagePosition(lastPage);
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
  }, [paginated, vertical, pageIndex, currSection, sections.length, getMaxPages, applyPagePosition, updateChars]);

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

  const pendingParagraphRef = useRef<number | null>(null);
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
      const range = document.createRange();
      range.selectNodeContents(element);
      revealRange(range);
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
    };
  }

  useEffect(() => {
    if (typeof targetParagraphId === 'number') {
      const content = contentRef.current;
      if (content) {
        const el = content.querySelector(`[index="${targetParagraphId}"]`);
        if (el) {
          el.scrollIntoView({ inline: 'center', block: 'center' });
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
              targetP.scrollIntoView({ inline: 'center', block: 'center' });
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

  // Hardware Volume Keys Navigation (Yoru Feature)
  useEffect(() => {
    if (readerSettings.volumeKeysNavigation === false) return;
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

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length === 0) return;
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const deltaX = touchEndX - touchStartX;
      const deltaY = touchEndY - touchStartY;
      const deltaTime = Date.now() - touchStartTime;

      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

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
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [vertical, flipPage, onClick]);

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

      if (paginated) {
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
  useEffect(() => {
    const refresh = () => setJitenEnabled(isJitenParserEnabled());
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
  }, [book.chapters, sections, currSection, paginated, wordStatuses, parserReady, jitenEnabled]);

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
    if (onClick) onClick(e);
  }, [onClick]);

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
