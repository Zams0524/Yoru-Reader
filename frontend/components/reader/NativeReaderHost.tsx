import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ReaderSettingsState } from '../../hooks/useReaderSettings';
import { isPhoneUI } from '../../utils/platform';
import { initTokenizer } from '../../utils/japanese';
import { getLocalWordStyleConfig } from '../../utils/parserSettingsStore';
import { analyseBookWords, engineWordCss, renderBookWords, type BookWords } from '../../utils/nativeReaderWords';
import { isFuriganaOnNewWords } from '../../utils/yoruParserNative';
import { isJitenParserEnabled, onJitenChange, parseWithJiten } from '../../utils/jitenSync';
import { computeSections, jitenTextOfLine, prepareLineWords, renderLineWords, type Book, type CharsUpdatePayload, type ReaderEngineApi } from './ReaderEngine';
import {
  NativeReader,
  baseTextNodes,
  blockOfParagraph,
  cssColorToInt,
  ensureNativeBook,
  exportBookForNativeReader,
  loadNativePosition,
  saveNativePosition,
  type NativePosition,
  type NativeReaderSettings,
  type NativeWordHit,
  textOffsetToInnerPath,
  xpathToTextOffset,
} from '../../utils/nativeReader';

interface Props {
  apiRef?: React.MutableRefObject<ReaderEngineApi | null>;
  book: Book;
  readerSettings: ReaderSettingsState;
  colors: { bg: string; textMain: string; accent?: string };
  /** The reader's root element: what is shown inside it (bars, panels) is cut out of the native page. */
  rootRef: React.RefObject<HTMLElement>;
  onCharsUpdate?: (payload: CharsUpdatePayload) => void;
  /** Tap in the middle of the page (shows or hides the bars), or anywhere while the popup is open. */
  onTap?: (closePopup: boolean) => void;
  /** A word was tapped: its span (rendered off screen like the WebView reader's) and box on screen. */
  onWordTap?: (wordSpan: HTMLElement, rect: DOMRect) => void;
  /** The dictionary popup is open: taps on the page close it. */
  popupOpen?: boolean;
  wordStatuses?: Record<string, string>;
  onPageTurn?: () => void;
  /** Chapter index (table of contents). */
  targetSection?: number | null;
  targetParagraphId?: number | null;
  targetCharPosition?: number | null;
  /** The engine could not open the book or stopped: the reader goes back to the WebView engine. */
  onError?: (message: string) => void;
  /** Read aloud is not running: its next start reads from the page on screen. */
  readAloudIdle?: boolean;
}

function nativeSettings(settings: ReaderSettingsState, colors: Props['colors']): NativeReaderSettings {
  return {
    vertical: settings.vertical,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    verticalPadding: settings.verticalPadding,
    horizontalPadding: settings.horizontalPadding,
    textColor: cssColorToInt(colors.textMain, 0xffffff),
    backgroundColor: cssColorToInt(colors.bg, 0x08080a),
    fontFamily: settings.fontFamily,
    textAlign: settings.textAlign || 'original',
    invertTaps: !!settings.invertTapZones,
    tapZoneMode: settings.tapZoneMode || 'edge',
    brightness: typeof settings.readerBrightness === 'number' ? settings.readerBrightness : 100,
    underlines: [],
  };
}

/** Visible elements of the reader UI (and of body-level portals), as screen rectangles. */
function collectHoles(root: HTMLElement, placeholder: HTMLElement | null): number[][] {
  const rects: number[][] = [];
  const width = window.innerWidth;
  const height = window.innerHeight;
  const visit = (element: Element) => {
    if (element === placeholder || !(element instanceof HTMLElement)) return;
    if (element.dataset.nativeIgnore !== undefined || element.tagName === 'SCRIPT' || element.tagName === 'STYLE') return;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
    const r = element.getBoundingClientRect();
    const onScreen = r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < width && r.top < height;
    // Click-through layers (pointer-events: none) and empty wrappers: look at what they contain.
    if (!onScreen || style.pointerEvents === 'none') {
      Array.from(element.children).forEach(visit);
      return;
    }
    rects.push([r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * 10) / 10));
    // Menus and popovers can stick out of the bar they belong to: add what lies outside it.
    for (const inner of Array.from(element.querySelectorAll('*'))) {
      const c = inner.getBoundingClientRect();
      if (c.width <= 0 || c.height <= 0) continue;
      if (c.left >= r.left - 1 && c.top >= r.top - 1 && c.right <= r.right + 1 && c.bottom <= r.bottom + 1) continue;
      const innerStyle = getComputedStyle(inner);
      // Only positioned layers (dropdowns): clipped overflow of normal content is not on screen.
      if (innerStyle.position !== 'absolute' && innerStyle.position !== 'fixed') continue;
      if (innerStyle.visibility === 'hidden' || innerStyle.display === 'none' || Number(innerStyle.opacity) === 0) continue;
      rects.push([c.left, c.top, c.right, c.bottom].map((v) => Math.round(v * 10) / 10));
    }
  };
  Array.from(root.children).forEach(visit);
  // Portals (toasts, dialogs) rendered next to the app root.
  for (const child of Array.from(document.body.children)) {
    if (!child.contains(root)) visit(child);
  }
  return rects;
}

/**
 * Android reader drawn natively (NativeReaderPlugin): this element only reserves the page area
 * and keeps the WebView side in step (position, settings, the reader's bars over the page).
 */
export default function NativeReaderHost({
  apiRef,
  book,
  readerSettings,
  colors,
  rootRef,
  onCharsUpdate,
  onTap,
  onWordTap,
  popupOpen = false,
  wordStatuses = {},
  onPageTurn,
  targetSection,
  targetParagraphId,
  targetCharPosition,
  onError,
  readAloudIdle = true,
}: Props) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const sections = useMemo(() => computeSections(book), [book]);
  const showFurigana = readerSettings.showFurigana !== false;
  const settings = nativeSettings(readerSettings, colors);

  // Word states. The book's words are analysed once (kept in IndexedDB, so later opens take
  // milliseconds; the first one shows its progress), and the book opens with its colours and
  // furigana on new words already there, instead of opening plain and reloading. A state change,
  // a Jiten parse or a word-style change re-marks the words (string building only) and reloads
  // the engine at the same character.
  const [parserSettings, setParserSettings] = useState(() => ({ furiganaOnNew: isFuriganaOnNewWords(), revision: 0 }));
  useEffect(() => {
    const onChange = () => setParserSettings((prev) => ({ furiganaOnNew: isFuriganaOnNewWords(), revision: prev.revision + 1 }));
    window.addEventListener('yoru-parser-settings-changed', onChange);
    return () => window.removeEventListener('yoru-parser-settings-changed', onChange);
  }, []);
  const [jitenRevision, setJitenRevision] = useState(0);
  useEffect(() => onJitenChange(() => setJitenRevision((revision) => revision + 1)), []);
  // Marking words in the popup changes states one by one: export once they settle.
  const [exportStatuses, setExportStatuses] = useState(wordStatuses);
  useEffect(() => {
    const timer = window.setTimeout(() => setExportStatuses(wordStatuses), 700);
    return () => window.clearTimeout(timer);
  }, [wordStatuses]);
  const [words, setWords] = useState<BookWords | null>(null);
  const [wordsSettled, setWordsSettled] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    setWords(null);
    setWordsSettled(false);
    // Show the progress only if the analysis is not almost immediate (cached).
    const showProgress = window.setTimeout(() => { if (!cancelled) setAnalysisProgress(0); }, 250);
    void analyseBookWords(book, (fraction) => { if (!cancelled) setAnalysisProgress(fraction); }, () => cancelled)
      .catch(() => null)
      .then((result) => {
        if (cancelled) return;
        window.clearTimeout(showProgress);
        setWords(result);
        setWordsSettled(true);
        setAnalysisProgress(null);
      });
    return () => { cancelled = true; window.clearTimeout(showProgress); };
  }, [book]);
  const lineHtml = useMemo(
    () => (words ? renderBookWords(words, exportStatuses, parserSettings.furiganaOnNew) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [words, exportStatuses, parserSettings, jitenRevision],
  );
  const wordStyle = useMemo(
    () => engineWordCss(getLocalWordStyleConfig(), settings.textColor, settings.backgroundColor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parserSettings, settings.textColor, settings.backgroundColor],
  );
  const exported = useMemo(() => exportBookForNativeReader(book, {
    showFurigana,
    lineHtml: lineHtml || undefined,
    wordCss: lineHtml ? wordStyle.css : '',
  }), [book, showFurigana, lineHtml, wordStyle]);
  settings.underlines = lineHtml ? wordStyle.underlines : [];
  const [ready, setReady] = useState(false);
  const positionRef = useRef<NativePosition | null>(null);
  /** The export the engine has open: positions and taps refer to it until a reload replaces it. */
  const openedExportRef = useRef<typeof exported | null>(null);
  const sectionRef = useRef(0);
  const [currentSection, setCurrentSection] = useState(0);
  const lookupRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onCharsUpdate, onTap, onWordTap, onPageTurn, onError });
  callbacks.current = { onCharsUpdate, onTap, onWordTap, onPageTurn, onError };
  const wordStatusesRef = useRef(wordStatuses);
  wordStatusesRef.current = wordStatuses;

  const settingsJson = JSON.stringify(settings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Native position -> Yoru paragraph, section and characters (progress, stats, page bar).
  const report = (position: NativePosition) => {
    positionRef.current = position;
    if (position.ordinal < 0) return;
    const open = openedExportRef.current ?? exported;
    const paragraph = open.blockParagraph[Math.min(position.ordinal, open.blockParagraph.length - 1)] ?? 0;
    const sectionIndex = Math.max(0, sections.findIndex((s) => paragraph >= s.startParagraphId && paragraph <= s.lastIndex));
    sectionRef.current = sectionIndex;
    setCurrentSection(sectionIndex);
    saveNativePosition(String(book.id), {
      xpath: position.xpath,
      paragraph,
      key: open.key,
      ordinal: position.ordinal,
      offset: xpathToTextOffset(open.blocks[position.ordinal] ?? '', position.xpath),
    });
    callbacks.current.onCharsUpdate?.({
      currChars: open.paragraphChars[paragraph] ?? 0,
      totalChars: open.totalChars,
      lastIndex: paragraph,
      currSection: sectionIndex,
    });
  };
  const reportRef = useRef(report);
  reportRef.current = report;

  // Tapped letter -> the word span around it, in the paragraph rendered as the WebView reader does.
  const findWord = async (hit: NativeWordHit) => {
    const open = openedExportRef.current ?? exported;
    const line = open.blockLines[hit.ordinal];
    const blockHtml = open.blocks[hit.ordinal];
    if (line === undefined || blockHtml === undefined) return;
    await Promise.all([tokenizerReady, prepareLineWords(line)]);
    const container = lookupRef.current;
    if (!container) return;
    let offset = xpathToTextOffset(blockHtml, hit.xpath);
    container.innerHTML = `<p class="chapter-content">${renderLineWords(line, wordStatusesRef.current)}</p>`;
    const texts = baseTextNodes(container);
    const plain = texts.map((t) => t.data).join('');
    // The engine's offset can be off by a few characters (whitespace): trust the tapped letter.
    if (hit.letter && plain[offset] !== hit.letter) {
      let best = -1;
      for (let i = plain.indexOf(hit.letter); i >= 0; i = plain.indexOf(hit.letter, i + 1)) {
        if (best < 0 || Math.abs(i - offset) < Math.abs(best - offset)) best = i;
      }
      if (best >= 0) offset = best;
    }
    if (offset < 0) return;
    let total = 0;
    for (const text of texts) {
      if (offset < total + text.length) {
        const span = text.parentElement?.closest('[data-word], [wordId], .jiten-word') as HTMLElement | null;
        if (!span) return;
        // Letters of the word before and after the tapped one, for the highlight on the page.
        let start = -1;
        let end = -1;
        let at = 0;
        for (const t of texts) {
          if (span.contains(t)) {
            if (start < 0) start = at;
            end = at + t.length;
          }
          at += t.length;
        }
        void NativeReader.highlight({
          page: hit.page,
          index: hit.index,
          before: Math.max(0, offset - start),
          after: Math.max(0, end - offset - 1),
          color: highlightColorRef.current,
        }).catch(() => {});
        callbacks.current.onWordTap?.(span, new DOMRect(hit.left, hit.top, hit.right - hit.left, hit.bottom - hit.top));
        return;
      }
      total += text.length;
    }
  };
  // Accent at about 35 % opacity (ARGB), behind the looked-up word.
  const highlightColor = useMemo(() => ((0x5a << 24) | cssColorToInt(colors.accent || '#f2c866', 0xf2c866)) >>> 0, [colors.accent]);
  const highlightColorRef = useRef(highlightColor);
  highlightColorRef.current = highlightColor;
  // Accent at 25 % opacity for read-aloud sentence highlight (lighter than the word lookup).
  const ttsHighlightColor = useMemo(() => ((0x40 << 24) | cssColorToInt(colors.accent || '#f2c866', 0xf2c866)) >>> 0, [colors.accent]);
  const ttsHighlightColorRef = useRef(ttsHighlightColor);
  ttsHighlightColorRef.current = ttsHighlightColor;
  // The local parser (Kuromoji) loads once; until then words would be split by script only.
  const [tokenizerReady] = useState(() => initTokenizer().catch(() => undefined));
  const findWordRef = useRef(findWord);
  findWordRef.current = findWord;
  const appliedSettingsRef = useRef('');
  // Leaving the reader closes the engine (a reload keeps it and the page on screen).
  useEffect(() => () => { void NativeReader.close().catch(() => {}); }, []);

  // Open the book (export it first if this version is not on the device yet), close on leaving.
  useEffect(() => {
    if (!wordsSettled) return undefined;
    let cancelled = false;
    const handles: Promise<{ remove: () => Promise<void> }>[] = [
      NativeReader.addListener('pageChanged', (position) => {
        reportRef.current(position);
        callbacks.current.onPageTurn?.();
      }),
      NativeReader.addListener('tap', ({ closePopup }) => callbacks.current.onTap?.(!!closePopup)),
      NativeReader.addListener('word', (hit) => { void findWordRef.current(hit); }),
      NativeReader.addListener('error', ({ message }) => callbacks.current.onError?.(message)),
    ];
    (async () => {
      try {
        await ensureNativeBook(exported);
        if (cancelled) return;
        const paragraph = Number(book.progress?.currentPage) || 0;
        const saved = loadNativePosition(String(book.id));
        // Reloaded here (word states, furigana): the character at the top of the page on screen,
        // found again in the new markup. Otherwise the saved page: the same xpath for the same
        // export, or its character found in this one, if the book was not read further in the
        // WebView reader since.
        const live = positionRef.current;
        const previous = openedExportRef.current;
        const at = (ordinal: number, offset: number) => {
          const innerPath = offset >= 0 ? textOffsetToInnerPath(exported.blocks[ordinal] ?? '', offset) : null;
          return { ordinal, ...(innerPath ? { innerPath } : {}) };
        };
        let place: { xpath?: string; ordinal?: number; innerPath?: string };
        if (live && live.ordinal >= 0 && previous) {
          place = at(live.ordinal, xpathToTextOffset(previous.blocks[live.ordinal] ?? '', live.xpath));
        } else if (saved && saved.paragraph === paragraph) {
          place = saved.key === exported.key || typeof saved.ordinal !== 'number'
            ? { xpath: saved.xpath }
            : at(saved.ordinal, saved.offset ?? -1);
        } else {
          place = { ordinal: blockOfParagraph(exported, paragraph) };
        }
        const position = await NativeReader.open({ key: exported.key, settings: settingsRef.current, ...place });
        openedExportRef.current = exported;
        if (cancelled) return;
        appliedSettingsRef.current = JSON.stringify(settingsRef.current);
        reportRef.current(position);
        setReady(true);
      } catch (error) {
        if (!cancelled) callbacks.current.onError?.(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancelled = true;
      handles.forEach((handle) => handle.then((h) => h.remove()).catch(() => {}));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exported.key, wordsSettled]);

  // Jiten parses what is being read (this section and the next two), as the WebView reader asks
  // for the paragraphs on its page; each parse brings a new export with Jiten's words and states.
  useEffect(() => {
    if (!ready || !isJitenParserEnabled()) return;
    const from = sections[currentSection]?.startParagraphId ?? 0;
    const to = sections[Math.min(sections.length - 1, currentSection + 2)]?.lastIndex ?? from;
    const texts: string[] = [];
    exported.blockParagraph.forEach((paragraph, ordinal) => {
      if (paragraph < from || paragraph > to) return;
      const text = jitenTextOfLine(exported.blockLines[ordinal] || '');
      if (text) texts.push(text);
    });
    void parseWithJiten(texts).catch(() => []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, currentSection, sections]);

  useEffect(() => {
    if (ready) void NativeReader.setPopupOpen({ open: popupOpen }).catch(() => {});
  }, [ready, popupOpen]);

  // Settings changes (font size, margins, theme, direction): relayout, keeping the position.
  useEffect(() => {
    if (!ready || settingsJson === appliedSettingsRef.current) return;
    const timer = window.setTimeout(() => {
      appliedSettingsRef.current = settingsJson;
      void NativeReader.setSettings({ settings: JSON.parse(settingsJson) }).catch(() => {});
    }, 150);
    return () => window.clearTimeout(timer);
  }, [ready, settingsJson]);

  // The reader's bars and panels over the page: cut them out of the native view.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !ready) return;
    let frame = 0;
    let late = 0;
    let last = '';
    const update = () => {
      frame = 0;
      const rects = collectHoles(root, placeholderRef.current);
      const json = JSON.stringify(rects);
      if (json === last) return;
      last = json;
      void NativeReader.setHoles({ rects }).catch(() => {});
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
      // Bars slide in: measure again once their transition is over.
      window.clearTimeout(late);
      late = window.setTimeout(() => requestAnimationFrame(update), 380);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    observer.observe(document.body, { childList: true });
    root.addEventListener('transitionend', schedule, true);
    root.addEventListener('animationend', schedule, true);
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      observer.disconnect();
      root.removeEventListener('transitionend', schedule, true);
      root.removeEventListener('animationend', schedule, true);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(late);
      void NativeReader.setHoles({ rects: [] }).catch(() => {});
    };
  }, [ready, rootRef]);

  const goToParagraph = (paragraph: number) => {
    void NativeReader.goTo({ ordinal: blockOfParagraph(exported, paragraph) }).catch(() => {});
  };
  const goToParagraphRef = useRef(goToParagraph);
  goToParagraphRef.current = goToParagraph;

  useEffect(() => {
    if (!ready || typeof targetSection !== 'number') return;
    const section = sections.find((s) => s.chapterIndex === targetSection);
    if (section) goToParagraphRef.current(section.startParagraphId);
  }, [ready, targetSection, sections]);

  useEffect(() => {
    if (ready && typeof targetParagraphId === 'number') goToParagraphRef.current(targetParagraphId);
  }, [ready, targetParagraphId]);

  useEffect(() => {
    if (!ready || typeof targetCharPosition !== 'number' || targetCharPosition < 0) return;
    // Last paragraph that starts at or before the position.
    const chars = exported.paragraphChars;
    let lo = 0;
    let hi = chars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (chars[mid] <= targetCharPosition) lo = mid;
      else hi = mid - 1;
    }
    goToParagraphRef.current(lo);
  }, [ready, targetCharPosition, exported]);

  // Hardware volume keys turn pages (as in the WebView reader; phones only).
  useEffect(() => {
    if (!ready || readerSettings.volumeKeysNavigation === false || !isPhoneUI()) return;
    const onKey = (e: KeyboardEvent) => {
      const up = e.key === 'VolumeUp' || e.key === 'AudioVolumeUp' || e.code === 'VolumeUp' || (e as any).keyCode === 175 || (e as any).keyCode === 24;
      const down = e.key === 'VolumeDown' || e.key === 'AudioVolumeDown' || e.code === 'VolumeDown' || (e as any).keyCode === 174 || (e as any).keyCode === 25;
      if (!up && !down) return;
      e.preventDefault();
      const forward = readerSettings.invertVolumeKeys ? up : down;
      void NativeReader.turnPage({ direction: forward ? 1 : -1 }).catch(() => {});
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [ready, readerSettings.volumeKeysNavigation, readerSettings.invertVolumeKeys]);

  // Clear the TTS sentence highlight when read-aloud stops.
  useEffect(() => {
    if (readAloudIdle && ready) void NativeReader.clearHighlight().catch(() => {});
  }, [readAloudIdle, ready]);

  // Read aloud works on DOM blocks: an off-screen copy of the open section, from the paragraph on
  // screen to the end of the section, with the WebView reader's block names. The page follows
  // the paragraph being read.
  const readAloudRef = useRef({ section: -1, lastParagraph: -1 });
  const readAloudIdleRef = useRef(readAloudIdle);
  readAloudIdleRef.current = readAloudIdle;
  const readAloudContentRef = useRef<HTMLDivElement>(null);
  const buildReadAloud = (sectionIndex: number, fromParagraph: number) => {
    const container = readAloudContentRef.current;
    const section = sections[sectionIndex];
    if (!container || !section) return null;
    const html: string[] = [];
    exported.blockParagraph.forEach((paragraph, ordinal) => {
      if (paragraph < Math.max(fromParagraph, section.startParagraphId) || paragraph > section.lastIndex) return;
      const line = exported.blockLines[ordinal] || '';
      const heading = /^\{(h[123]):/.exec(line);
      if (heading && line.endsWith('}')) html.push(`<${heading[1]} class="chapter-content-${heading[1]}">${exported.blocks[ordinal]}</${heading[1]}>`);
      else if (line.trim() && !line.startsWith('{img:')) html.push(`<p class="chapter-content" index="${paragraph}" data-ordinal="${ordinal}">${exported.blocks[ordinal]}</p>`);
    });
    container.innerHTML = html.join('');
    readAloudRef.current.section = sectionIndex;
    readAloudRef.current.lastParagraph = -1;
    return container;
  };
  const readAloudApi = {
    getContent: (): HTMLDivElement | null => {
      const container = readAloudContentRef.current;
      // A new start reads from the page on screen; while reading, the same copy is kept.
      if (container && (readAloudIdleRef.current || readAloudRef.current.section < 0)) {
        const position = positionRef.current;
        const paragraph = position && position.ordinal >= 0 ? exported.blockParagraph[position.ordinal] ?? 0 : 0;
        return buildReadAloud(sectionRef.current, paragraph);
      }
      return container;
    },
    goToNextSection: () => {
      const next = readAloudRef.current.section + 1;
      if (next >= sections.length) return false;
      return !!buildReadAloud(next, sections[next].startParagraphId);
    },
    revealRange: (range: Range) => {
      const block = range.startContainer.parentElement?.closest('[index]') as HTMLElement | null;
      const paragraph = Number(block?.getAttribute('index'));
      if (!Number.isFinite(paragraph)) return;
      if (paragraph !== readAloudRef.current.lastParagraph) {
        readAloudRef.current.lastParagraph = paragraph;
        goToParagraphRef.current(paragraph);
      }
      // Highlight the sentence on the native page.
      const ordinal = Number(block?.dataset.ordinal);
      if (!block || isNaN(ordinal)) return;
      const pageStartOrdinal = positionRef.current?.ordinal ?? 0;
      const relativeBlock = ordinal - pageStartOrdinal;
      if (relativeBlock < 0) return;
      let charOffset = 0;
      let charLength = 0;
      let beforeStart = true;
      for (const textNode of baseTextNodes(block)) {
        if (beforeStart) {
          if (textNode === range.startContainer) {
            beforeStart = false;
            charOffset += range.startOffset;
            charLength += (textNode === range.endContainer)
              ? range.endOffset - range.startOffset
              : textNode.length - range.startOffset;
            if (textNode === range.endContainer) break;
          } else {
            charOffset += textNode.length;
          }
        } else {
          if (textNode === range.endContainer) { charLength += range.endOffset; break; }
          charLength += textNode.length;
        }
      }
      if (charLength <= 0) return;
      void NativeReader.highlightRange({
        relativeBlock,
        charOffset,
        charLength,
        color: ttsHighlightColorRef.current,
      }).catch(() => {});
    },
  };
  const readAloudApiRef = useRef(readAloudApi);
  readAloudApiRef.current = readAloudApi;

  // The parts of the reader API that make sense without a DOM page (page bar, keys, bookmarks, read aloud).
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      getContent: () => readAloudApiRef.current.getContent(),
      revealRange: (range) => readAloudApiRef.current.revealRange(range),
      goToNextSection: () => readAloudApiRef.current.goToNextSection(),
      goToParagraph: (_section, paragraph) => goToParagraphRef.current(paragraph),
      getSections: () => sections,
      getCurrentSection: () => sectionRef.current,
      isPaginated: () => true,
      // Pages of the open section, estimated from the whole book (the page bar measures chars per page).
      getPageInfo: () => {
        const position = positionRef.current;
        const section = sections[sectionRef.current];
        if (!position || !section?.charCount || !exported.totalChars) return { page: 0, pages: 1 };
        // Not rounded: the page bar divides by it to get characters per page (whole-book average).
        return { page: 0, pages: Math.max(0.01, position.pages * (section.charCount / exported.totalChars)) };
      },
      turnPage: (direction) => { void NativeReader.turnPage({ direction }).catch(() => {}); },
    };
    return () => { apiRef.current = null; };
  }, [apiRef, sections, exported]);

  return (
    <div
      ref={placeholderRef}
      className="native-reader-page"
      style={{ flex: 1, width: '100%', height: '100%', background: colors.bg, position: 'relative', overflow: 'hidden' }}
    >
      {!ready && analysisProgress !== null && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, color: colors.textMain, opacity: 0.8, fontFamily: 'var(--font-ui), sans-serif', fontSize: 15 }}>
          <div>Preparando el libro…</div>
          <div style={{ width: 160, height: 4, borderRadius: 2, background: 'rgba(127,127,127,0.25)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(analysisProgress * 100)}%`, height: '100%', background: colors.accent || '#f2c866', transition: 'width 0.2s' }} />
          </div>
        </div>
      )}
      {/* Off-screen copy of the section being read aloud. */}
      <div ref={readAloudContentRef} aria-hidden="true" style={{ position: 'absolute', left: -10000, top: 0, width: 600, visibility: 'hidden' }} />
      {/* Off-screen copy of the tapped paragraph: the dictionary reads the word from its spans. */}
      <div ref={lookupRef} aria-hidden="true" style={{ position: 'absolute', left: -10000, top: 0, width: 600, visibility: 'hidden' }} />
    </div>
  );
}
