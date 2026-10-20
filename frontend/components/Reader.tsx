import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ExternalLink, Plus, Volume2, X } from 'lucide-react';
import { tokenizeText } from '../utils/japanese';
import { lookupWord } from '../utils/dictionary';
import { db } from '../utils/db';
import { FSRS6, Rating, State, getPreviousSrsState } from '../utils/fsrs';
import html2canvas from 'html2canvas';
import { t } from '../utils/i18n';
import { synthesizeSpeechAzure } from '../utils/azureTtsService';
import { updateDiscordReading, clearDiscordPresence } from '../utils/discordRpc';
import { getPitchAccent, getPitchMorae } from '../utils/pitchAccent';
import { playWordAudio, type WordAudioPlayback } from '../utils/wordAudio';
import { syncJitenReview } from '../utils/jitenSync';

// Direct reader engine imports
import ReaderEngine, { type ReaderEngineApi } from './reader/ReaderEngine';
import NativeReaderHost from './reader/NativeReaderHost';
import { isNativeReaderAvailable } from '../utils/nativeReader';
import ReadAloudBar from './reader/ReadAloudBar';
import ReadAloudSettings from './reader/ReadAloudSettings';
import ReaderPageBar from './reader/ReaderPageBar';
import BookSearchPanel from './reader/BookSearchPanel';
import HighlightNoteDialog from './reader/HighlightNoteDialog';
import {
  HIGHLIGHT_COLORS,
  exportHighlights,
  highlightCssName,
  newHighlightId,
  type BookHighlight,
  type HighlightColor,
} from '../utils/highlights';
import { blockText, offsetInBlock, rangeForOffsets, setNamedHighlight } from '../utils/readerText';
import { useReadAloud } from './reader/useReadAloud';
import ReaderNavbar from './reader/ReaderNavbar';
import ReaderSidebar from './reader/ReaderSidebar';
import ReaderSettings from './reader/ReaderSettings';
import ReaderSettingsPopover from './reader/ReaderSettingsPopover';
import { Capacitor } from '@capacitor/core';
import YoruParserSettings from './reader/YoruParserSettings';
import CharacterCounter from './reader/CharacterCounter';
import SelectionToolbar from './reader/SelectionToolbar';
import { useReaderSettings, ReaderSettingsState, baseReaderTheme } from '../hooks/useReaderSettings';
import { useBackHandler } from '../hooks/useBackButton';

// Page-turn keys handled inside ReaderEngine.
const ENGINE_PAGE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ' ']);

interface PitchAccentGraphProps {
  reading: string;
  position: number;
}

// Beautiful Interactive SVG Pitch Accent Graph
function PitchAccentGraph({ reading, position }: PitchAccentGraphProps) {
  const morae = getPitchMorae(reading);
  if (morae.length === 0) return null;

  const nodeSpacing = 30;
  const height = 50;
  const padding = 12;
  const width = morae.length * nodeSpacing + padding * 2;

  const getLevel = (idx: number) => {
    const moraNum = idx + 1; // 1-based index
    if (position === 0) {
      return moraNum === 1 ? 0 : 1; // Low, then High...
    } else if (position === 1) {
      return moraNum === 1 ? 1 : 0; // High, then Low...
    } else {
      if (moraNum === 1) return 0;
      if (moraNum <= position) return 1;
      return 0;
    }
  };

  const points = morae.map((mora, idx) => {
    const x = padding + idx * nodeSpacing;
    const level = getLevel(idx);
    const y = level === 1 ? 12 : 28; // High node at 12, Low node at 28
    return { x, y, mora, idx, level };
  });

  let dropLine: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (position > 0 && position <= morae.length) {
    const lastHighPoint = points[position - 1];
    const nextX = lastHighPoint.x + nodeSpacing / 2;
    const dropY = 28; // Drop to low level (28)
    dropLine = { x1: lastHighPoint.x, y1: lastHighPoint.y, x2: nextX, y2: dropY };
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', margin: '8px 0' }}>
      <div style={{ overflowX: 'auto', maxWidth: '100%', background: 'rgba(255,255,255,0.01)', borderRadius: '6px', padding: '4px 8px', border: '1px solid rgba(255,255,255,0.03)' }}>
        <svg width={width} height={height} style={{ overflow: 'visible' }}>
          {points.map((pt, idx) => {
            if (idx === 0) return null;
            const prev = points[idx - 1];
            return (
              <line
                key={`line-${idx}`}
                x1={prev.x}
                y1={prev.y}
                x2={pt.x}
                y2={pt.y}
                stroke="#38bdf8"
                strokeWidth="2"
              />
            );
          })}

          {dropLine && (
            <>
              <line
                x1={dropLine.x1}
                y1={dropLine.y1}
                x2={dropLine.x2}
                y2={dropLine.y2}
                stroke="#ef4444"
                strokeWidth="2"
                strokeDasharray="2 2"
              />
              <circle
                cx={dropLine.x2}
                cy={dropLine.y2}
                r="3"
                fill="none"
                stroke="#ef4444"
                strokeWidth="1.5"
              />
            </>
          )}

          {points.map((pt) => (
            <g key={`node-${pt.idx}`}>
              <circle
                cx={pt.x}
                cy={pt.y}
                r="3.5"
                fill={pt.level === 1 ? '#38bdf8' : '#1e293b'}
                stroke="#38bdf8"
                strokeWidth="1.5"
              />
              <text
                x={pt.x}
                y={height - 4} // Always align text at the bottom
                textAnchor="middle"
                fill="#ffffff"
                style={{ fontSize: '0.64rem', fontFamily: 'var(--font-japanese)', fontWeight: 600 }}
              >
                {pt.mora}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

// Hash a string ID to a positive 32-bit integer for ttu-reader compatibility
function hashStringToInt(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Extract the sentence containing the selected text inside the iframe DOM
function getSentenceFromSelection(selection: Selection): string {
  const node = selection.anchorNode;
  if (!node) return '';
  
  let container: Node | null = node;
  while (container && container.nodeType !== Node.ELEMENT_NODE) {
    container = container.parentNode;
  }
  if (!container) return '';
  
  const text = container.textContent || '';
  const selectedText = selection.toString();
  
  const sentences = text.split(/(?<=[。！？\n])/g);
  const match = sentences.find(s => s.includes(selectedText));
  return match ? match.trim() : selectedText;
}

function getSentenceFromElement(element: HTMLElement): string {
  let container: Node | null = element;
  while (container && container.nodeType !== Node.ELEMENT_NODE) {
    container = container.parentNode;
  }
  if (!container) return '';
  const text = container.textContent || '';
  const wordText = element.textContent || '';
  const sentences = text.split(/(?<=[。！？\n])/g);
  const match = sentences.find(s => s.includes(wordText));
  return match ? match.trim() : wordText;
}

function sanitizeDictionaryHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'BR', 'SPAN', 'RUBY', 'RT', 'RP', 'SMALL', 'SUB', 'SUP', 'UL', 'OL', 'LI', 'DIV', 'P']);
  const cleanNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const element = node as Element;
    const children = Array.from(element.childNodes).map(cleanNode).join('');
    if (!allowedTags.has(element.tagName)) return children;
    const tag = element.tagName.toLowerCase();
    return tag === 'br' ? '<br>' : `<${tag}>${children}</${tag}>`;
  };
  return Array.from(parsed.body.childNodes).map(cleanNode).join('');
}

export function getUniqueFrequencies(frequencies: any[]): any[] {
  if (!frequencies || frequencies.length === 0) return [];
  
  const bestFreqs: Record<string, any> = {};
  frequencies.forEach(f => {
    const dict = f.dictionary;
    let numVal = Infinity;
    if (typeof f.value === 'number') {
      numVal = f.value;
    } else if (f.value) {
      const parsed = parseInt(String(f.value).replace(/[^\d]/g, ''), 10);
      if (!isNaN(parsed)) {
        numVal = parsed;
      }
    } else if (f.displayValue) {
      const parsed = parseInt(String(f.displayValue).replace(/[^\d]/g, ''), 10);
      if (!isNaN(parsed)) {
        numVal = parsed;
      }
    }
    
    if (!bestFreqs[dict]) {
      bestFreqs[dict] = { ...f, parsedValue: numVal };
    } else {
      if (numVal < bestFreqs[dict].parsedValue) {
        bestFreqs[dict] = { ...f, parsedValue: numVal };
      }
    }
  });
  
  const seenDicts = new Set<string>();
  const orderedResult: any[] = [];
  frequencies.forEach(f => {
    if (!seenDicts.has(f.dictionary)) {
      seenDicts.add(f.dictionary);
      if (bestFreqs[f.dictionary]) {
        orderedResult.push(bestFreqs[f.dictionary]);
      }
    }
  });
  
  return orderedResult;
}

interface ReaderProps {
  book: any;
  onBack: (targetTab?: string) => void;
  onUpdateProgress: (bookId: string, currentChapter: number, currentPage: number, percent: number) => void;
  onIncrementReadingStats: (bookId: string, chars: number, seconds: number) => void;
  onSaveReadingStats?: (title: string, chars: number, seconds: number, sessions?: number) => Promise<void>;
  wordStatuses: Record<string, string>;
  onSetWordStatus: (word: string, status: string, wordData?: any) => void;
  settings: any;
  onSaveSettings: (settings: any) => void;
  onUpdateBookDetails?: (bookId: string, data: any) => Promise<void>;
}

export default function Reader({ 
  book, 
  onBack, 
  onUpdateProgress, 
  onIncrementReadingStats,
  onSaveReadingStats,
  wordStatuses, 
  onSetWordStatus, 
  settings, 
  onSaveSettings,
  onUpdateBookDetails
}: ReaderProps) {
  const lang = settings.appLanguage || 'en';
  const finalizeReadingSessionRef = useRef<() => void>(() => {});

  const handleBack = useCallback(() => {
    flushProgressRef.current();
    finalizeReadingSessionRef.current();
    const updatedSettings = db.getSettings();
    db.saveSettings(updatedSettings);
    onSaveSettings(updatedSettings);
    onBack();
  }, [onSaveSettings, onBack]);

  const [readerSettings, rawSetReaderSetting] = useReaderSettings();

  const fsrsSettings = db.getSettings();
  const fsrsRetentionRate = fsrsSettings.fsrsRetentionRate !== undefined ? Number(fsrsSettings.fsrsRetentionRate) : 0.90;
  const fsrsMaxInterval = fsrsSettings.fsrsMaxInterval !== undefined ? Number(fsrsSettings.fsrsMaxInterval) : 36500;
  const fsrsEnableFuzz = fsrsSettings.fsrsEnableFuzz !== undefined ? Boolean(fsrsSettings.fsrsEnableFuzz) : true;

  const fsrs = useMemo(() => {
    return new FSRS6({
      request_retention: fsrsRetentionRate,
      maximum_interval: fsrsMaxInterval,
      enable_fuzz: fsrsEnableFuzz,
    });
  }, [fsrsRetentionRate, fsrsMaxInterval, fsrsEnableFuzz]);
  const setReaderSetting = useCallback(<K extends keyof ReaderSettingsState>(key: K, value: ReaderSettingsState[K]) => {
    rawSetReaderSetting(key, value);
    // The app theme follows the book's base colours (contrast/twilight/console are variants).
    if (key === 'theme') {
      const base = baseReaderTheme(String(value));
      if (settings.theme !== base) {
        onSaveSettings({ ...settings, theme: base });
      }
    }
  }, [rawSetReaderSetting, settings, onSaveSettings]);
  const [sidebarMode, setSidebarMode] = useState<'toc' | 'bookmarks' | 'notes' | 'session' | 'settings' | null>(null);
  const sidebarModeRef = useRef(sidebarMode);
  sidebarModeRef.current = sidebarMode;
  const [bookmarks, setBookmarks] = useState<any[]>(book.bookmarks || []);
  const [currentProgress, setCurrentProgress] = useState({
    currChars: book.progress?.currentPage || 0,
    totalChars: 0,
    lastIndex: book.progress?.currentPage || 0,
    currSection: book.progress?.currentChapter || 0,
  });

  // Discord Rich Presence Integration
  useEffect(() => {
    updateDiscordReading(book, settings, currentProgress);
    return () => {
      clearDiscordPresence();
    };
  }, [book, settings, currentProgress.currSection, currentProgress.currChars]);

  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [isJumpModalOpen, setIsJumpModalOpen] = useState(false);
  const [jumpPosition, setJumpPosition] = useState(1);
  const [targetCharPosition, setTargetCharPosition] = useState<number | null>(null);
  const [isExtSettingsOpen, setIsExtSettingsOpen] = useState(false);
  const [extId, setExtId] = useState<string | null>(null);
  const [deckSelectorWord, setDeckSelectorWord] = useState<string | null>(null);
  const [newDeckInput, setNewDeckInput] = useState('');

  // Extract all images from book chapters
  const bookImages = useMemo<string[]>(() => {
    if (!book || !book.chapters) return [];
    const urls: string[] = [];
    book.chapters.forEach(chapter => {
      const lines = (chapter.content || '').split(/\r?\n/);
      lines.forEach(line => {
        if (line.startsWith('{img:') && line.endsWith('}')) {
          const src = line.substring(5, line.length - 1);
          if (src) urls.push(src);
        } else {
          const regex = /\{img:([^{}]+)\}/gi;
          let match;
          while ((match = regex.exec(line)) !== null) {
            if (match[1]) urls.push(match[1]);
          }
        }
      });
    });
    return Array.from(new Set(urls));
  }, [book]);

  const [session, setSession] = useState({
    isActive: false,
    isPaused: false,
    readingTime: 0,
    charsRead: 0,
    speed: 0,
    initialChars: 0,
  });
  const readingTrackerRef = useRef({
    active: false,
    paused: false,
    lastPosition: currentProgress.currChars,
    furthestPosition: currentProgress.currChars,
    lastTickAt: 0,
    partialSecondMs: 0,
    pendingChars: 0,
    pendingSeconds: 0,
    totalChars: 0,
    totalSeconds: 0,
  });
  const skipNextReadingPositionRef = useRef(false);

  const [selection, setSelection] = useState<any | null>(null);
  const [navTargetSection, setNavTargetSection] = useState<number | null>(null);
  const [navTargetParagraphId, setNavTargetParagraphId] = useState<number | null>(null);

  const [selectedWord, setSelectedWord] = useState<any | null>(null);
  const [dictEntry, setDictEntry] = useState<any | null>(null);
  const [dictLoading, setDictLoading] = useState(false);
  const [ankiCardExists, setAnkiCardExists] = useState(false);
  const [srsCard, setSrsCard] = useState<any | null>(null);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [showSettingsPopover, setShowSettingsPopover] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const hoveredElementRef = useRef<HTMLElement | null>(null);
  const dictionaryLookupRequestRef = useRef(0);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsKeepAliveRef = useRef<any>(null);
  const wordAudioRef = useRef<WordAudioPlayback | null>(null);
  const [popupPos, setPopupPos] = useState({ x: 10, y: 10, anchorBottom: false, targetTop: 10, targetBottom: 10 });
  const [popupMaxHeight, setPopupMaxHeight] = useState(Math.max(160, window.innerHeight - 24));
  const [viewportRevision, setViewportRevision] = useState(0);
  const dictPopupRef = useRef<HTMLDivElement | null>(null);
  const [isTtsPlaying, setIsTtsPlaying] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const toastTimerRef = useRef<any>(null);

  const engineApiRef = useRef<ReaderEngineApi | null>(null);
  const [isReadAloudOpen, setIsReadAloudOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isVoiceSettingsOpen, setIsVoiceSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const showToast = useCallback((message: string, type = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ show: true, message, type });
    toastTimerRef.current = setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 3500);
  }, []);

  const readAloud = useReadAloud({
    apiRef: engineApiRef,
    voice: settings.audioVoiceOption,
    onError: (code) => {
      const es = lang === 'es';
      const android = Capacitor.isNativePlatform();
      let message = es ? 'No se pudo leer en voz alta.' : 'Could not read aloud.';
      if (/EDGE_TTS_FAILED/.test(code)) {
        message = es
          ? 'No se pudo conectar con la voz neural (necesita internet). Inténtalo de nuevo.'
          : 'Could not reach the neural voice (needs internet). Try again.';
      } else if (/JAPANESE_VOICE_MISSING|TTS_UNAVAILABLE/.test(code)) {
        message = android
          ? (es ? 'No hay voz japonesa. Instálala en Ajustes de Android → Texto a voz.' : 'No Japanese voice. Install one in Android Settings → Text-to-speech.')
          : (es ? 'No hay voz japonesa en este equipo. Elige Nanami o Keita en los ajustes de voz.' : 'No Japanese voice on this computer. Pick Nanami or Keita in the voice settings.');
      }
      showToast(message, 'error');
    },
  });

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }, []);

  const handleToggleCompleted = useCallback(async () => {
    const isCompleted = book.status === 'completed';
    if (isCompleted) {
      if (onUpdateBookDetails) {
        await onUpdateBookDetails(book.id, { status: 'reading' });
      }
      showToast(lang === 'es' ? 'Libro marcado como en progreso' : 'Book marked as in progress', 'success');
    } else {
      if (onUpdateBookDetails) {
        await onUpdateBookDetails(book.id, { status: 'completed' });
        onUpdateProgress(book.id, currentProgress.currSection, currentProgress.lastIndex, 100);
      }
      showToast(lang === 'es' ? '¡Libro completado al 100%!' : 'Book marked as 100% completed!', 'success');
    }
  }, [book.id, book.status, onUpdateBookDetails, onUpdateProgress, currentProgress.currSection, currentProgress.lastIndex, lang, showToast]);

  const handleConfirmJump = useCallback(() => {
    if (jumpPosition < 0 || jumpPosition > currentProgress.totalChars) {
      showToast(lang === 'es' ? 'Posición no válida' : 'Invalid position', 'warning');
      return;
    }
    skipNextReadingPositionRef.current = true;
    setTargetCharPosition(jumpPosition);
    setTimeout(() => setTargetCharPosition(null), 100);
    setIsJumpModalOpen(false);
    showToast(lang === 'es' ? `Saltando a posición ${jumpPosition}` : `Jumping to position ${jumpPosition}`, 'success');
  }, [jumpPosition, currentProgress.totalChars, lang, showToast]);

  useEffect(() => {
    // Automatically hide header after 1.5 seconds when entering reader mode
    const timer = setTimeout(() => {
      setIsHeaderVisible(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (settings.theme === 'light' || settings.theme === 'sepia' || settings.theme === 'dark') {
      // Only follow a real change of the app theme, not a variant of the same base.
      if (baseReaderTheme(readerSettings.theme) !== settings.theme) {
        rawSetReaderSetting('theme', settings.theme);
      }
    }
  }, [settings.theme, readerSettings.theme, rawSetReaderSetting]);

  useEffect(() => {
    if (!isGalleryOpen || bookImages.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        setGalleryIndex(prev => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        setGalleryIndex(prev => Math.min(bookImages.length - 1, prev + 1));
      } else if (e.key === 'Escape') {
        setIsGalleryOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isGalleryOpen, bookImages.length]);

  const triggerTtuKeyboardAction = useCallback((code: string, key: string) => {
    try {
      const downEvent = new KeyboardEvent('keydown', {
        code,
        key,
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(downEvent);
      return true;
    } catch (e) {
      console.error('[Yoru] Keyboard action failed:', e);
      return false;
    }
  }, []);

  const handleOpenExtensionSettings = useCallback(() => {
    // The quick settings sheet would otherwise stay open underneath and bleed through the modal.
    setShowSettingsPopover(false);
    setIsExtSettingsOpen(true);
  }, []);

  useEffect(() => {
    if (selectedWord && selectedWord.basicForm) {
      setSrsCard(db.getSrsCard(selectedWord.basicForm));
    } else {
      setSrsCard(null);
    }
  }, [selectedWord]);

  useEffect(() => {
    return () => {
      wordAudioRef.current?.stop();
      wordAudioRef.current = null;
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      clearInterval(ttsKeepAliveRef.current);
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const theme = settings.theme || 'dark';
    window.__yoruTheme = theme;
  }, [settings.theme]);

  const handleSelection = useCallback(async () => {
    const selectionObj = window.getSelection();
    if (!selectionObj || selectionObj.rangeCount === 0) return;
    const selectedText = selectionObj.toString().trim();
    
    if (selectedText && selectedText.length > 0 && selectedText.length <= 12) {
      const sentenceText = getSentenceFromSelection(selectionObj);
      const requestId = ++dictionaryLookupRequestRef.current;
      const range = selectionObj.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      
      const x = Math.max(10, Math.min(window.innerWidth - 390, rect.left));
      const top = rect.top;
      const bottom = rect.bottom;
      
      const anchorBottom = top > window.innerHeight / 2;
      const y = anchorBottom ? top - 6 : bottom + 6;
      
      setPopupPos({ x, y, anchorBottom, targetTop: rect.top, targetBottom: rect.bottom });
      setDictLoading(true);
      setSelectedWord({
        surface: selectedText,
        basicForm: selectedText,
        reading: '',
        sentenceText
      });

      try {
        const entry = await lookupWord(selectedText);
        if (requestId === dictionaryLookupRequestRef.current) setDictEntry(entry);
      } catch (error) {
        if (requestId === dictionaryLookupRequestRef.current) {
          console.error('Dictionary selection lookup failed:', error);
          setDictEntry(null);
        }
      } finally {
        if (requestId === dictionaryLookupRequestRef.current) setDictLoading(false);
      }
    }
  }, []);

  // rectOverride: where the word is on screen when the span is not (native reader).
  const triggerWordLookup = useCallback(async (wordSpan: HTMLElement, rectOverride?: DOMRect) => {
    const wordId = wordSpan.getAttribute('data-word') || wordSpan.getAttribute('wordId') || wordSpan.innerText;
    if (!wordId) return;
    
    let word = wordId;
    let reading = wordSpan.getAttribute('data-reading') || '';
    if (wordId.includes(':')) {
      const parts = wordId.split(':');
      word = parts[0];
      reading = parts[1];
    }
    
    if (selectedWord && selectedWord.basicForm === word && selectedWord.reading === reading) {
      return;
    }
    
    const rect = rectOverride || wordSpan.getBoundingClientRect();
    const requestId = ++dictionaryLookupRequestRef.current;
    const x = Math.max(10, Math.min(window.innerWidth - 390, rect.left));
    const top = rect.top;
    const bottom = rect.bottom;
    const anchorBottom = top > window.innerHeight / 2;
    const y = anchorBottom ? top - 6 : bottom + 6;
    
    setPopupPos({ x, y, anchorBottom, targetTop: rect.top, targetBottom: rect.bottom });
    setDictLoading(true);
    
    // Surface text without furigana (<rt>/<rp>), e.g. 彼女 instead of 彼女ヒロイン
    const surfaceClone = wordSpan.cloneNode(true) as HTMLElement;
    surfaceClone.querySelectorAll('rt, rp').forEach(node => node.remove());
    const surface = (surfaceClone.textContent || '').trim() || wordSpan.innerText;

    setSelectedWord({
      surface,
      basicForm: word,
      reading: reading,
      sentenceText: getSentenceFromElement(wordSpan)
    });
    
    try {
      const entry = await lookupWord(word, reading);
      if (requestId !== dictionaryLookupRequestRef.current) return;
      setDictEntry(entry);
    } catch (error) {
      if (requestId === dictionaryLookupRequestRef.current) {
        console.error('Dictionary lookup failed:', error);
        setDictEntry(null);
      }
    } finally {
      if (requestId === dictionaryLookupRequestRef.current) setDictLoading(false);
    }
  }, [selectedWord]);

  React.useLayoutEffect(() => {
    const popup = dictPopupRef.current;
    if (!selectedWord || !popup) return;

    const margin = 12;
    const gap = 8;

    // Phones: dock the popup to the screen edge opposite the word (bottom sheet / top sheet),
    // so the tapped word and the lines next to it stay visible.
    if (window.innerWidth < 768) {
      // Stay clear of the status bar / gesture bar (edge-to-edge insets injected by Capacitor).
      const rootStyle = getComputedStyle(document.documentElement);
      const safeTop = parseFloat(rootStyle.getPropertyValue('--safe-area-inset-top')) || 0;
      const safeBottom = parseFloat(rootStyle.getPropertyValue('--safe-area-inset-bottom')) || 0;
      const wordInUpperHalf = (popupPos.targetTop + popupPos.targetBottom) / 2 < window.innerHeight / 2;
      const available = wordInUpperHalf
        ? window.innerHeight - safeBottom - popupPos.targetBottom - gap - margin
        : popupPos.targetTop - safeTop - gap - margin;
      // About a third of the screen, so most of the page (and the highlighted word) stays in view.
      const maxHeight = Math.max(150, Math.min(Math.round(window.innerHeight * 0.34), available));
      const top = wordInUpperHalf ? window.innerHeight - safeBottom - margin : safeTop + margin;
      setPopupMaxHeight(current => current === maxHeight ? current : maxHeight);
      setPopupPos(current => current.x === margin && current.y === top && current.anchorBottom === wordInUpperHalf
        ? current
        : { ...current, x: margin, y: top, anchorBottom: wordInUpperHalf });
      return;
    }

    const bounds = popup.getBoundingClientRect();
    const spaceAbove = Math.max(0, popupPos.targetTop - margin - gap);
    const spaceBelow = Math.max(0, window.innerHeight - popupPos.targetBottom - margin - gap);
    const preferredHeight = Math.min(popup.scrollHeight, 360);
    const placeBelow = spaceBelow >= preferredHeight || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(120, Math.min(window.innerHeight - margin * 2, Math.max(spaceAbove, spaceBelow)));
    const left = Math.min(Math.max(margin, popupPos.x), Math.max(margin, window.innerWidth - bounds.width - margin));
    const top = placeBelow ? popupPos.targetBottom + gap : Math.max(margin, popupPos.targetTop - gap);

    setPopupMaxHeight(current => current === maxHeight ? current : maxHeight);
    setPopupPos(current => current.x === left && current.y === top && current.anchorBottom === !placeBelow
      ? current
      : { ...current, x: left, y: top, anchorBottom: !placeBelow });
  }, [selectedWord, dictLoading, dictEntry, popupPos.x, popupPos.targetTop, popupPos.targetBottom, viewportRevision]);

  useEffect(() => {
    const handleResize = () => setViewportRevision(revision => revision + 1);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    // Handle selection-based dictionary lookup (bubbles up to window)
    const handleMouseUp = () => {
      const selectionObj = window.getSelection();
      if (!selectionObj) return;
      const anchorNode = selectionObj.anchorNode;
      if (!anchorNode) return;
      
      const contentArea = document.querySelector('.book-content-container');
      if (contentArea && contentArea.contains(anchorNode)) {
        handleSelection();
      }
    };

    const handleDblClick = () => {
      setTimeout(handleMouseUp, 80);
    };

    // Tracks target element and triggers if Shift is held down
    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      hoveredElementRef.current = target;
      
      if (e.shiftKey) {
        const wordSpan = target.closest('[data-word], [wordId], .jiten-word') as HTMLElement;
        if (wordSpan) {
          triggerWordLookup(wordSpan);
        }
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      hoveredElementRef.current = target;
      
      if (e.shiftKey) {
        const wordSpan = target.closest('[data-word], [wordId], .jiten-word') as HTMLElement;
        if (wordSpan) {
          triggerWordLookup(wordSpan);
        }
      }
    };

    // Global KeyDown to support pressing Shift while hovering
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        if (hoveredElementRef.current) {
          const wordSpan = hoveredElementRef.current.closest('[data-word], [wordId], .jiten-word') as HTMLElement;
          if (wordSpan) {
            triggerWordLookup(wordSpan);
          }
        }
      }
    };

    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchend', handleMouseUp);
    window.addEventListener('dblclick', handleDblClick);
    window.addEventListener('mouseover', handleMouseOver);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleGlobalKeyDown);

    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchend', handleMouseUp);
      window.removeEventListener('dblclick', handleDblClick);
      window.removeEventListener('mouseover', handleMouseOver);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [handleSelection, triggerWordLookup]);

  const handleCopyText = useCallback(() => {
    if (!selection) return;
    navigator.clipboard.writeText(selection.text);
    showToast(lang === 'es' ? 'Texto copiado al portapapeles' : 'Text copied to clipboard', 'success');
    window.getSelection()?.removeAllRanges();
  }, [selection, lang]);

  const handleToggleBookmark = useCallback((paragraphId: number, content: string) => {
    let next;
    const exists = bookmarks.find(b => b.paragraphId === paragraphId);
    if (exists) {
      next = bookmarks.filter(b => b.paragraphId !== paragraphId);
      showToast(lang === 'es' ? 'Marcador eliminado' : 'Bookmark removed', 'success');
    } else {
      next = [...bookmarks, { paragraphId, content }];
      showToast(lang === 'es' ? 'Marcador guardado' : 'Bookmark saved', 'success');
    }
    setBookmarks(next);
    db.saveBookBookmarks(book.id, next);
  }, [bookmarks, book.id, lang]);

  // ── Highlights & notes ──
  const [highlights, setHighlights] = useState<BookHighlight[]>(() => (book as any).highlights || []);
  const [noteDraft, setNoteDraft] = useState<{ highlight: BookHighlight; isNew: boolean } | null>(null);

  const saveHighlights = useCallback((next: BookHighlight[]) => {
    setHighlights(next);
    void db.saveBookHighlights(book.id, next);
  }, [book.id]);

  /** Adds a highlight, replacing any that overlap it in the same paragraph. */
  const withHighlight = useCallback((list: BookHighlight[], item: BookHighlight) => [
    ...list.filter((h) => h.id === item.id || !(h.paragraphId === item.paragraphId && h.start < item.end && item.start < h.end)).filter((h) => h.id !== item.id),
    item,
  ], []);

  const highlightFromSelection = useCallback((color: HighlightColor): BookHighlight | null => {
    if (!selection?.offsets || !selection.visibleText) return null;
    return {
      id: newHighlightId(),
      paragraphId: selection.paragraphId,
      start: selection.offsets.start,
      end: selection.offsets.end,
      text: selection.visibleText,
      color,
      createdAt: new Date().toISOString(),
    };
  }, [selection]);

  const handleHighlightSelection = useCallback((color: HighlightColor) => {
    const item = highlightFromSelection(color);
    if (!item) return;
    saveHighlights(withHighlight(highlights, item));
    window.getSelection()?.removeAllRanges();
    showToast(lang === 'es' ? 'Subrayado guardado' : 'Highlight saved', 'success');
  }, [highlightFromSelection, saveHighlights, withHighlight, highlights, lang, showToast]);

  const handleNoteSelection = useCallback(() => {
    const item = highlightFromSelection('yellow');
    if (!item) return;
    window.getSelection()?.removeAllRanges();
    setNoteDraft({ highlight: item, isNew: true });
  }, [highlightFromSelection]);

  // Draw saved highlights on whatever paragraphs are rendered; redraw when the page content changes.
  useEffect(() => {
    const content = engineApiRef.current?.getContent();
    if (!content) return;
    const paint = () => {
      const byColor = new Map<HighlightColor, Range[]>(HIGHLIGHT_COLORS.map((c) => [c.id, []]));
      for (const item of highlights) {
        const block = content.querySelector(`p.chapter-content[index="${item.paragraphId}"]`);
        const range = block ? rangeForOffsets(block, item.start, item.end) : null;
        if (range) byColor.get(item.color)?.push(range);
      }
      byColor.forEach((ranges, color) => setNamedHighlight(highlightCssName(color), ranges));
    };
    paint();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(paint, 60);
    });
    observer.observe(content, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [highlights]);

  useEffect(() => () => {
    HIGHLIGHT_COLORS.forEach((c) => setNamedHighlight(highlightCssName(c.id), null));
  }, []);

  /** Opens the section holding a paragraph and turns to it (and to a range inside it, when given). */
  const goToParagraphAnywhere = useCallback((paragraphId: number, offsets?: { start: number; end: number }) => {
    const api = engineApiRef.current;
    if (!api) return;
    const sectionIndex = api.getSections().findIndex((s) => paragraphId >= s.startParagraphId && paragraphId <= s.lastIndex);
    skipNextReadingPositionRef.current = true;
    api.goToParagraph(sectionIndex >= 0 ? sectionIndex : api.getCurrentSection(), paragraphId);
    if (offsets) {
      window.setTimeout(() => {
        const block = api.getContent()?.querySelector(`p.chapter-content[index="${paragraphId}"]`);
        const range = block ? rangeForOffsets(block, offsets.start, offsets.end) : null;
        if (range) api.revealRange(range);
      }, 150);
    }
  }, []);

  const handleExportHighlights = useCallback(() => {
    const text = exportHighlights(book.title || '', highlights, lang);
    void navigator.clipboard.writeText(text).then(
      () => showToast(lang === 'es' ? 'Subrayados copiados' : 'Highlights copied', 'success'),
      () => showToast(lang === 'es' ? 'No se pudo copiar' : 'Could not copy', 'error'),
    );
  }, [book.title, highlights, lang, showToast]);

  const handleBookmarkSelection = useCallback(() => {
    if (!selection) return;
    handleToggleBookmark(selection.paragraphId, selection.text);
    window.getSelection()?.removeAllRanges();
  }, [selection, handleToggleBookmark]);

  useEffect(() => {
    const handleSelectionChange = () => {
      const selectionObj = window.getSelection();
      if (!selectionObj || selectionObj.isCollapsed || !selectionObj.rangeCount) {
        setSelection(null);
        return;
      }
      
      const text = selectionObj.toString().trim();
      if (!text) {
        setSelection(null);
        return;
      }



      const anchorP = selectionObj.anchorNode?.parentElement?.closest('[index]');
      const focusP = selectionObj.focusNode?.parentElement?.closest('[index]');
      if (!anchorP || !focusP || anchorP !== focusP) {
        setSelection(null);
        return;
      }

      const paragraphId = parseInt(anchorP.getAttribute('index') || '0', 10);
      const range = selectionObj.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      // Offsets in the paragraph's visible text (no furigana) so the highlight can be drawn again later.
      const startOffset = offsetInBlock(anchorP, range.startContainer, range.startOffset);
      const endOffset = offsetInBlock(anchorP, range.endContainer, range.endOffset);
      const offsets = startOffset >= 0 && endOffset > startOffset ? { start: startOffset, end: endOffset } : null;

      setSelection({
        visible: true,
        rect: { x: rect.left + rect.width / 2, y: rect.top },
        paragraphId,
        text,
        offsets,
        visibleText: offsets && anchorP.matches('p.chapter-content') ? blockText(anchorP).slice(offsets.start, offsets.end) : null,
      });
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, []);

  const flushPendingReadingStats = useCallback((sessionsToAdd = 0) => {
    const tracker = readingTrackerRef.current;
    const chars = tracker.pendingChars;
    const seconds = tracker.pendingSeconds;
    if (chars === 0 && seconds === 0 && sessionsToAdd === 0) return;
    tracker.pendingChars = 0;
    tracker.pendingSeconds = 0;
    if (onSaveReadingStats) {
      void onSaveReadingStats(book.title || '', chars, seconds, sessionsToAdd).catch((error) => {
        console.error('Could not save reading session statistics:', error);
      });
    }
  }, [book.title, onSaveReadingStats]);

  const finalizeReadingSession = useCallback(() => {
    const tracker = readingTrackerRef.current;
    if (!tracker.active) return;

    tracker.active = false;
    tracker.paused = false;
    tracker.lastTickAt = 0;
    const sessionChars = tracker.totalChars;
    const sessionSeconds = tracker.totalSeconds;
    const hasReading = sessionChars > 0 || sessionSeconds > 0;

    flushPendingReadingStats(hasReading ? 1 : 0);
    if (hasReading) {
      void Promise.resolve(onIncrementReadingStats(book.id, sessionChars, sessionSeconds)).catch((error) => {
        console.error('Could not save book reading totals:', error);
      });
    }

    setSession((previous) => ({
      ...previous,
      isActive: false,
      isPaused: false,
      charsRead: sessionChars,
      readingTime: sessionSeconds,
      speed: sessionSeconds >= 10 ? Math.round((sessionChars * 3600) / sessionSeconds) : 0,
    }));
  }, [book.id, flushPendingReadingStats, onIncrementReadingStats]);
  finalizeReadingSessionRef.current = finalizeReadingSession;

  useEffect(() => {
    const onPageHide = () => finalizeReadingSessionRef.current();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      finalizeReadingSessionRef.current();
    };
  }, []);

  // Count foreground reading time and save light-weight daily checkpoints.
  useEffect(() => {
    if (!session.isActive || session.isPaused) return;

    const resetClock = () => { readingTrackerRef.current.lastTickAt = 0; };
    const interval = window.setInterval(() => {
      const tracker = readingTrackerRef.current;
      if (!tracker.active || tracker.paused) return;
      if (document.visibilityState !== 'visible' || !document.hasFocus()) {
        tracker.lastTickAt = 0;
        return;
      }

      const now = performance.now();
      if (tracker.lastTickAt === 0) {
        tracker.lastTickAt = now;
        return;
      }

      // Ignore long event-loop stalls (sleep/background throttling) instead of inflating reading time.
      tracker.partialSecondMs += Math.min(now - tracker.lastTickAt, 1500);
      tracker.lastTickAt = now;
      const wholeSeconds = Math.floor(tracker.partialSecondMs / 1000);
      if (wholeSeconds < 1) return;
      tracker.partialSecondMs -= wholeSeconds * 1000;
      tracker.totalSeconds += wholeSeconds;
      tracker.pendingSeconds += wholeSeconds;

      // Each update re-renders the whole reader: every second only while the session panel is open.
      if (tracker.totalSeconds % 5 !== 0 && sidebarModeRef.current !== 'session') {
        if (tracker.pendingSeconds >= 15) flushPendingReadingStats();
        return;
      }
      setSession((previous) => {
        const readingTime = tracker.totalSeconds;
        return {
          ...previous,
          readingTime,
          speed: readingTime >= 10 ? Math.round((tracker.totalChars * 3600) / readingTime) : 0,
        };
      });

      if (tracker.pendingSeconds >= 15) flushPendingReadingStats();
    }, 1000);

    window.addEventListener('focus', resetClock);
    window.addEventListener('blur', resetClock);
    document.addEventListener('visibilitychange', resetClock);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', resetClock);
      window.removeEventListener('blur', resetClock);
      document.removeEventListener('visibilitychange', resetClock);
      readingTrackerRef.current.lastTickAt = 0;
    };
  }, [session.isActive, session.isPaused, flushPendingReadingStats]);

  const handleToggleSession = useCallback(() => {
    const tracker = readingTrackerRef.current;
    if (!tracker.active) {
      tracker.active = true;
      tracker.paused = false;
      tracker.lastPosition = currentProgress.currChars;
      tracker.furthestPosition = currentProgress.currChars;
      tracker.lastTickAt = 0;
      tracker.partialSecondMs = 0;
      tracker.pendingChars = 0;
      tracker.pendingSeconds = 0;
      tracker.totalChars = 0;
      tracker.totalSeconds = 0;
      setSession({
        isActive: true,
        isPaused: false,
        readingTime: 0,
        charsRead: 0,
        speed: 0,
        initialChars: currentProgress.currChars,
      });
      return;
    }

    tracker.paused = !tracker.paused;
    tracker.lastPosition = currentProgress.currChars;
    tracker.furthestPosition = Math.max(tracker.furthestPosition, currentProgress.currChars);
    tracker.lastTickAt = 0;
    if (tracker.paused) flushPendingReadingStats();
    setSession((previous) => ({ ...previous, isPaused: tracker.paused }));
  }, [currentProgress.currChars, flushPendingReadingStats]);

  const handleToggleReadingMeasurement = useCallback(() => {
    if (readingTrackerRef.current.active) {
      finalizeReadingSessionRef.current();
    } else {
      handleToggleSession();
    }
  }, [handleToggleSession]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const popup = document.querySelector('.dict-popup');
      if (popup && !popup.contains(e.target as Node)) {
        setSelectedWord(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const checkAnkiCardExists = async (word: string) => {
    setAnkiCardExists(false);
    if (!word) return;

    const savedV2 = localStorage.getItem('anki_settings_v2');
    const ankiSettingsV2 = savedV2 ? JSON.parse(savedV2) : null;
    let host = 'http://127.0.0.1:8765';
    let noteType = 'Lapis';
    let fieldsConfig: Record<string, string> = { Expression: '{expression}' };

    if (ankiSettingsV2) {
      host = ankiSettingsV2.host || host;
      const config = ankiSettingsV2.expression || {};
      noteType = config.noteType || noteType;
      if (config.fields && Object.keys(config.fields).length > 0) {
        fieldsConfig = config.fields;
      }
    } else {
      const saved = localStorage.getItem('anki_settings');
      if (saved) {
        const legacy = JSON.parse(saved);
        host = legacy.host || host;
        noteType = legacy.noteType || noteType;
        fieldsConfig = { [legacy.wordField || 'Expression']: '{expression}' };
      }
    }

    const expressionField = Object.keys(fieldsConfig).find(k => (fieldsConfig as any)[k] === '{expression}') || 'Expression';

    try {
      const res = await fetch(host, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'findNotes',
          version: 6,
          params: {
            query: `note:"${noteType}" "${expressionField}:${word}"`
          }
        })
      });
      const data = await res.json();
      if (data && data.result && data.result.length > 0) {
        setAnkiCardExists(true);
      }
    } catch (e) {
      console.warn('Could not check card existence in Anki:', e);
    }
  };

  useEffect(() => {
    if (selectedWord) {
      checkAnkiCardExists(selectedWord.basicForm);
    } else {
      setAnkiCardExists(false);
    }
  }, [selectedWord]);

  const handleOpenInAnki = async () => {
    if (!selectedWord) return;

    const savedV2 = localStorage.getItem('anki_settings_v2');
    const ankiSettingsV2 = savedV2 ? JSON.parse(savedV2) : null;
    let host = 'http://127.0.0.1:8765';
    if (ankiSettingsV2) {
      host = ankiSettingsV2.host || host;
    } else {
      const saved = localStorage.getItem('anki_settings');
      if (saved) {
        host = JSON.parse(saved).host || host;
      }
    }

    try {
      await fetch(host, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'guiBrowse',
          version: 6,
          params: {
            query: `"${selectedWord.basicForm}"`
          }
        })
      });
    } catch (e) {
      console.error('Error opening Anki browser:', e);
      showToast(lang === 'es' ? 'No se pudo conectar con Anki. Asegúrate de tener Anki abierto.' : 'Could not connect to Anki. Make sure Anki is open.', 'error');
    }
  };

  const handleMineToAnki = async () => {
    if (!selectedWord) return;

    const uploadMediaToAnki = async (host: string, filename: string, base64Data: string) => {
      try {
        const res = await fetch(host, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'storeMediaFile',
            version: 6,
            params: { filename, data: base64Data }
          })
        });
        return await res.json();
      } catch (e) {
        console.error('Error uploading media:', e);
        return null;
      }
    };

    const uploadMediaUrlToAnki = async (host: string, filename: string, downloadUrl: string) => {
      try {
        const res = await fetch(host, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'storeMediaFile',
            version: 6,
            params: { filename, url: downloadUrl }
          })
        });
        return await res.json();
      } catch (e) {
        console.error('Error downloading media:', e);
        return null;
      }
    };

    const getAnkiFurigana = (token: any, keepLeadingSpace = false) => {
      if (!token) return '';
      if (!token.alignment) return token.surface || '';
      
      let result = '';
      token.alignment.forEach((part: any) => {
        if (part.type === 'kanji') {
          result += ` ${part.text}[${part.ruby}]`;
        } else {
          result += part.text;
        }
      });
      return keepLeadingSpace ? result : result.trim();
    };

    const getSentenceAnkiFurigana = (sentenceTokens: any[]) => {
      return sentenceTokens.map(tok => {
        if (tok.isLineBreak) return ' ';
        if (!tok.isWord) return tok.surface || '';
        return getAnkiFurigana(tok, true);
      }).join('');
    };

    const savedV2 = localStorage.getItem('anki_settings_v2');
    const ankiSettingsV2 = savedV2 ? JSON.parse(savedV2) : null;

    let host = 'http://127.0.0.1:8765';
    let deck = 'sentence mining';
    let noteType = 'Lapis';
    let rawTags = 'yoru-reader';
    let fieldsConfig = {
      Expression: '{expression}',
      ExpressionFurigana: '{furigana}',
      ExpressionReading: '{reading}',
      ExpressionAudio: '{audio}',
      SelectionText: '{popup-selection-text}',
      MainDefinition: '{meaning}',
      DefinitionPicture: '',
      Sentence: '{sentence}',
      SentenceFurigana: '{sentence-furigana}',
      SentenceAudio: '',
      Picture: '{screenshot}',
    };

    if (ankiSettingsV2) {
      host = ankiSettingsV2.host || host;
      rawTags = ankiSettingsV2.tags || rawTags;
      const config = ankiSettingsV2.expression || {};
      deck = config.deck || deck;
      noteType = config.noteType || noteType;
      if (config.fields && Object.keys(config.fields).length > 0) {
        fieldsConfig = config.fields;
      }
    } else {
      const saved = localStorage.getItem('anki_settings');
      if (saved) {
        const legacy = JSON.parse(saved);
        host = legacy.host || host;
        deck = legacy.deck || deck;
        noteType = legacy.noteType || noteType;
        rawTags = legacy.tags || rawTags;
        fieldsConfig = {
          [legacy.wordField || 'Expression']: '{expression}',
          [legacy.readingField || 'Reading']: '{reading}',
          [legacy.meaningField || 'Meaning']: '{meaning}',
          [legacy.sentenceField || 'Sentence']: '{sentence}'
        } as any;
      }
    }

    const sentenceText = selectedWord.sentenceText || selectedWord.surface;
    const sentenceTokens = (await tokenizeText(sentenceText)).flat();
    const wordTokens = (await tokenizeText(selectedWord.basicForm)).flat();
    const activeWordToken = wordTokens[0] || selectedWord;

    const definitionsAsStrings = dictEntry && dictEntry.definitions
      ? dictEntry.definitions.map((d: any) => typeof d === 'string' ? d : (d.glossary || ''))
      : [];

    const meaning = definitionsAsStrings.join('<br>');
    
    const isBilingual = (defText: string) => {
      const SPA_DIACRITICS = /[áéíóúüñÁÉÍÓÚÜÑ¿¡]/u;
      const SPA_WORDS = /\b(de|del|el|la|los|las|en|un|una|unos|unas|con|por|para|que|es|son|su|sus|se|al|como|más|no|si|lo|le|les|muy|también|pero|cuando|este|esta|estos|estas|fue|ser|hay|ya|porque|aunque|donde|mientras|entre)\b/i;
      const ENG_WORDS = /\b(the|of|to|and|a|in|is|for|on|with|as|by|at|an|be|this|that|from|it|are|or|if|but|after|before|during|while|have|has|had|not|also|can|will|its|was|were|been|one|two|three|four|five|used|made|when|which|who|what|where|how)\b/i;
      return SPA_DIACRITICS.test(defText) || SPA_WORDS.test(defText) || ENG_WORDS.test(defText);
    };

    const allDefs = definitionsAsStrings;
    const bilingualDefs = allDefs.filter((d: string) => isBilingual(d));
    const monolingualDefs = allDefs.filter((d: string) => !isBilingual(d));

    const meaningBilingual = bilingualDefs.join('<br>') || meaning;
    const monolingualPrimary = monolingualDefs[0] || '';
    const monolingualExtra = monolingualDefs.slice(1).join('<br>') || '';

    const wordFurigana = getAnkiFurigana(activeWordToken);
    const sentenceFurigana = getSentenceAnkiFurigana(sentenceTokens);

    const fieldsConfigValues = Object.values(fieldsConfig);
    const hasScreenshot = fieldsConfigValues.includes('{screenshot}');
    const hasAudio = fieldsConfigValues.includes('{audio}');
    const hasSentenceAudio = fieldsConfigValues.includes('{sentence-audio}');

    let screenshotHTML = '';
    if (hasScreenshot && containerRef.current) {
      try {
        const popup = document.querySelector('.dict-popup') as HTMLElement;
        if (popup) popup.style.setProperty('display', 'none', 'important');
        await new Promise(r => setTimeout(r, 80));
        
        const bgColor = window.getComputedStyle(containerRef.current).backgroundColor;
        const canvas = await html2canvas(containerRef.current, {
          backgroundColor: bgColor || '#0d0d0f',
          logging: false,
          useCORS: true
        });
        
        if (popup) popup.style.display = '';
        
        const base64 = canvas.toDataURL('image/png').split(',')[1];
        const filename = `yoru_snap_${Date.now()}.png`;
        await uploadMediaToAnki(host, filename, base64);
        screenshotHTML = `<img src="${filename}">`;
      } catch (e) {
        console.error('Screenshot generation failed:', e);
      }
    }

    let audioHTML = '';
    if (hasAudio) {
      try {
        const filename = `yoru_audio_${Date.now()}.mp3`;
        const downloadUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ja&q=${encodeURIComponent(selectedWord.basicForm || selectedWord.surface)}`;
        await uploadMediaUrlToAnki(host, filename, downloadUrl);
        audioHTML = `[sound:${filename}]`;
      } catch (e) {
        console.error('Audio generation failed:', e);
      }
    }

    let sentenceAudioHTML = '';
    if (hasSentenceAudio) {
      try {
        const filename = `yoru_sentence_audio_${Date.now()}.mp3`;
        const downloadUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ja&q=${encodeURIComponent(sentenceText)}`;
        await uploadMediaUrlToAnki(host, filename, downloadUrl);
        sentenceAudioHTML = `[sound:${filename}]`;
      } catch (e) {
        console.error('Sentence audio generation failed:', e);
      }
    }

    const fields: Record<string, string> = {};
    for (const [fieldName, tokenTemplate] of Object.entries(fieldsConfig)) {
      if (!tokenTemplate) {
        fields[fieldName] = '';
        continue;
      }
      
      let pitchPositions = '';
      let pitchCategories = '';
      let pitchGraphs = '';
      if (dictEntry && dictEntry.pitches && dictEntry.pitches.length > 0) {
        pitchPositions = dictEntry.pitches
          .flatMap((pEntry: any) => pEntry.pitches.map((p: any) => p.position))
          .join(', ');
          
        const getPitchCategoryName = (pos: number, r: string) => {
          const morae = (r || '').match(/[ぁ-んァ-ン][ゃゅょャュョ]*/g) || [];
          const count = morae.length;
          if (pos === 0) return '平板';
          if (pos === 1) return '頭高';
          if (pos > 1) {
            if (pos === count) return '尾高';
            return '中高';
          }
          return '';
        };

        const getPitchGraphHTML = (r: string, pos: number) => {
          const morae = (r || '').match(/[ぁ-んァ-ン][ゃゅょャュョ]*/g) || [];
          if (morae.length === 0) return r || '';
          
          let html = '<span style="display: inline-flex; padding: 2px 0; font-family: monospace;">';
          morae.forEach((mora, idx) => {
            const m = idx + 1;
            let isHigh = false;
            let hasDrop = false;

            if (pos === 0) {
              isHigh = m > 1;
            } else if (pos === 1) {
              isHigh = m === 1;
              hasDrop = m === 1;
            } else if (pos > 1) {
              isHigh = m >= 2 && m <= pos;
              hasDrop = m === pos;
            }

            const borderTop = isHigh ? '1px solid currentColor' : '1px solid transparent';
            const borderRight = hasDrop ? '1px solid currentColor' : '1px solid transparent';
            const paddingRight = hasDrop ? '1px' : '0px';

            html += `<span style="border-top: ${borderTop}; border-right: ${borderRight}; padding-right: ${paddingRight}; line-height: 1.2; display: inline-block;">${mora}</span>`;
          });
          html += '</span>';
          return html;
        };
        
        pitchCategories = dictEntry.pitches
          .flatMap((pEntry: any) => pEntry.pitches.map((p: any) => getPitchCategoryName(p.position, pEntry.reading || selectedWord.reading)))
          .filter(Boolean)
          .join(', ');

        pitchGraphs = dictEntry.pitches
          .flatMap((pEntry: any) => pEntry.pitches.map((p: any) => getPitchGraphHTML(pEntry.reading || selectedWord.reading || selectedWord.surface, p.position)))
          .join('<br>');
      }

      let frequencyRank = '';
      let frequenciesDetails = '';
      if (dictEntry && dictEntry.frequencies && dictEntry.frequencies.length > 0) {
        const uniqueFreqs = getUniqueFrequencies(dictEntry.frequencies);
        frequencyRank = uniqueFreqs.map(f => f.displayValue || String(f.value)).join(', ');
        frequenciesDetails = uniqueFreqs.map(f => `${f.dictionary}: ${f.displayValue || f.value}`).join(', ');
      }

      let clozePrefix = '';
      let clozeBody = selectedWord.surface || '';
      let clozeBodyKana = selectedWord.reading || '';
      let clozeSuffix = '';
      
      const parts = sentenceText.split(selectedWord.surface);
      clozePrefix = parts[0] || '';
      clozeSuffix = parts.slice(1).join(selectedWord.surface);
      const sentenceClozeHTML = `${clozePrefix}{{c1::${clozeBody}}}${clozeSuffix}`;

      const furiganaPlain = getAnkiFurigana(activeWordToken, false);
      const sentenceFuriganaPlain = sentenceTokens.map(tok => {
        if (tok.isLineBreak) return ' ';
        if (!tok.isWord) return tok.surface || '';
        return getAnkiFurigana(tok, false);
      }).join('');

      const glossary = meaning;
      const glossaryFirst = dictEntry && dictEntry.definitions && dictEntry.definitions[0] ? dictEntry.definitions[0] : '';
      const glossaryBrief = glossaryFirst;
      const glossaryFirstBrief = glossaryFirst;
      const glossaryNoDict = meaning; 
      const glossaryPlain = meaning.replace(/<[^>]*>/g, '');
      const glossaryPlainNoDict = glossaryPlain;

      const partOfSpeechVal = dictEntry && dictEntry.partsOfSpeech ? dictEntry.partsOfSpeech.join(', ') : '';

      let pitchAccentsVal = '';
      if (dictEntry && dictEntry.pitches && dictEntry.pitches.length > 0) {
        pitchAccentsVal = dictEntry.pitches
          .flatMap((pEntry: any) => pEntry.pitches.map((p: any) => `${pEntry.reading || selectedWord.reading || ''}: [${p.position}]`))
          .join(', ');
      }

      let singleFreqBccwj = '';
      let singleFreqJpdb = '';
      let singleFreqJiten = '';
      let singleFreqVn = '';
      if (dictEntry && dictEntry.frequencies) {
        dictEntry.frequencies.forEach((f: any) => {
          const dictName = (f.dictionary || '').toLowerCase();
          const valStr = String(f.value);
          if (dictName.includes('bccwj')) singleFreqBccwj = valStr;
          else if (dictName.includes('jpdb')) singleFreqJpdb = valStr;
          else if (dictName.includes('jiten') || dictName.includes('anime')) singleFreqJiten = valStr;
          else if (dictName.includes('vn') || dictName.includes('novel')) singleFreqVn = valStr;
        });
      }

      const documentTitleVal = book.title || book.filename || '';
      const docUrlVal = `yoru://book/${book.id || 'local'}`;

      let val = tokenTemplate
        .replaceAll('{expression}', selectedWord.basicForm || selectedWord.surface)
        .replaceAll('{furigana}', wordFurigana)
        .replaceAll('{furigana-plain}', furiganaPlain)
        .replaceAll('{reading}', selectedWord.reading || '')
        .replaceAll('{audio}', audioHTML)
        .replaceAll('{popup-selection-text}', selectedWord.surface)
        .replaceAll('{sentence}', sentenceText)
        .replaceAll('{sentence-furigana}', sentenceFurigana)
        .replaceAll('{sentence-furigana-plain}', sentenceFuriganaPlain)
        .replaceAll('{sentence-audio}', sentenceAudioHTML)
        .replaceAll('{sentence-cloze}', sentenceClozeHTML)
        .replaceAll('{screenshot}', screenshotHTML)
        .replaceAll('{meaning}', meaning)
        .replaceAll('{glossary}', glossary)
        .replaceAll('{glossary-brief}', glossaryBrief)
        .replaceAll('{glossary-first}', glossaryFirst)
        .replaceAll('{glossary-first-brief}', glossaryFirstBrief)
        .replaceAll('{glossary-no-dictionary}', glossaryNoDict)
        .replaceAll('{glossary-plain}', glossaryPlain)
        .replaceAll('{glossary-plain-no-dictionary}', glossaryPlainNoDict)
        .replaceAll('{tags}', rawTags)
        .replaceAll('{pitch-accent-positions}', pitchPositions)
        .replaceAll('{pitch-accent-categories}', pitchCategories)
        .replaceAll('{pitch-accent-graphs}', pitchGraphs)
        .replaceAll('{pitch-accent-graphs-jj}', pitchGraphs)
        .replaceAll('{pitch-accents}', pitchAccentsVal)
        .replaceAll('{frequency-harmonic-rank}', frequencyRank)
        .replaceAll('{frequencies}', frequenciesDetails)
        .replaceAll('{single-frequency-number-bccwj}', singleFreqBccwj)
        .replaceAll('{single-frequency-number-jiten-anime}', singleFreqJiten)
        .replaceAll('{single-frequency-number-jpdb}', singleFreqJpdb)
        .replaceAll('{single-frequency-number-vn-freq}', singleFreqVn)
        .replaceAll('{cloze-prefix}', clozePrefix)
        .replaceAll('{cloze-body}', clozeBody)
        .replaceAll('{cloze-body-kana}', clozeBodyKana)
        .replaceAll('{cloze-suffix}', clozeSuffix)
        .replaceAll('{document-title}', documentTitleVal)
        .replaceAll('{search-query}', selectedWord.basicForm || selectedWord.surface)
        .replaceAll('{part-of-speech}', partOfSpeechVal)
        .replaceAll('{bilingual}', meaningBilingual)
        .replaceAll('{monolingual-primary}', monolingualPrimary)
        .replaceAll('{monolingual-extra}', monolingualExtra)
        .replaceAll('{clipboard-text}', selectedWord.surface)
        .replaceAll('{clipboard-image}', screenshotHTML)
        .replaceAll('{single-glossary-jmdict-spanish-2026-06-10}', glossary)
        .replaceAll('{url}', docUrlVal)
        .replaceAll('{url-plain}', docUrlVal);
      fields[fieldName] = val;
    }

    const tagsList = rawTags.split(/[\s,]+/).filter(t => t.trim().length > 0);
    if (!tagsList.includes('yoru_reader')) {
      tagsList.push('yoru_reader');
    }

    const note = {
      deckName: deck,
      modelName: noteType,
      fields: fields,
      options: { allowDuplicate: true, duplicateScope: "deck" },
      tags: tagsList
    };

    try {
      const response = await fetch(host, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addNote', version: 6, params: { note } })
      });
      const result = await response.json();
      if (result.error) {
        showToast('Anki error: ' + result.error, 'error');
      } else {
        if (selectedWord && selectedWord.basicForm) {
          const existingCard = db.getSrsCard(selectedWord.basicForm);
          onSetWordStatus(selectedWord.basicForm, 'learning', {
            reading: selectedWord.reading || selectedWord.surface,
            sentence: selectedWord.sentenceText || selectedWord.surface || '',
            source: existingCard?.source || book?.title || 'Yoru Reader'
          });
        }
        setAnkiCardExists(true);
        showToast(lang === 'es' ? '¡Tarjeta de Anki creada con éxito! La palabra fue marcada como "Estudiando".' : 'Anki card created successfully! The word was marked as "Learning".', 'success');
      }
    } catch (e) {
      showToast(lang === 'es' ? 'Error de conexión con AnkiConnect. Asegúrate de tener Anki abierto.' : 'Connection error with AnkiConnect. Make sure Anki is open.', 'error');
    }
  };

  // Single words: a native recording or the device voice first (Android has no Web Speech voices).
  const reproducirPalabra = async (term: string, reading: string) => {
    wordAudioRef.current?.stop();
    wordAudioRef.current = null;
    setIsTtsPlaying(true);
    const playback = await playWordAudio(term, reading, parseFloat(settings.audioSpeed || '1.0'));
    if (playback) {
      wordAudioRef.current = playback;
      playback.ended.then(() => {
        if (wordAudioRef.current !== playback) return;
        wordAudioRef.current = null;
        setIsTtsPlaying(false);
      });
      return;
    }
    setIsTtsPlaying(false);
    reproducirTexto(reading || term);
  };

  const playSelectedWordAudio = () => {
    if (!selectedWord) return;
    const term = dictEntry?.word || selectedWord.basicForm || selectedWord.surface;
    const reading = dictEntry?.reading || (term === selectedWord.surface ? selectedWord.reading : '') || '';
    reproducirPalabra(term, reading);
  };

  const reproducirTexto = async (texto: string, vozSeleccionada?: string) => {
    if (!texto || !texto.trim()) return;

    wordAudioRef.current?.stop();
    wordAudioRef.current = null;

    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      clearInterval(ttsKeepAliveRef.current);
    }

    setIsTtsPlaying(true);

    const vozId = vozSeleccionada || settings.audioVoiceOption || 'Nanami';
    const speed = parseFloat(settings.audioSpeed || '1.0');

    if (window.electronAPI && window.electronAPI.speakText) {
      try {
        // Edge's free service has Nanami and Keita for Japanese (Mayu was withdrawn).
        const azureVoiceName = vozId === 'Keita' ? 'ja-JP-KeitaNeural' : 'ja-JP-NanamiNeural';

        const audioBuffer = await window.electronAPI.speakText({
          text: texto,
          voice: azureVoiceName,
          rate: speed
        });

        if (audioBuffer) {
          const blob = new Blob([audioBuffer], { type: 'audio/mp3' });
          const audioUrl = URL.createObjectURL(blob);
          const audio = new Audio(audioUrl);
          ttsAudioRef.current = audio;
          audio.onended = () => { setIsTtsPlaying(false); ttsAudioRef.current = null; };
          audio.onerror = () => { setIsTtsPlaying(false); ttsAudioRef.current = null; };
          await audio.play();
          return;
        }
      } catch (err) {
        console.warn('Edge TTS failed, falling back:', err);
      }
    }

    if (settings.azureApiKey && settings.azureApiKey.trim()) {
      try {
        const azureVoiceName = 
          vozId === 'Mayu' ? 'ja-JP-MayuNeural' : 
          vozId === 'Keita' ? 'ja-JP-KeitaNeural' : 
          'ja-JP-NanamiNeural';

        const audioUrl = await synthesizeSpeechAzure(
          texto,
          azureVoiceName,
          settings.azureApiKey,
          settings.azureRegion || 'eastus',
          speed
        );

        const audio = new Audio(audioUrl);
        ttsAudioRef.current = audio;
        audio.onended = () => { setIsTtsPlaying(false); ttsAudioRef.current = null; };
        audio.onerror = () => { setIsTtsPlaying(false); ttsAudioRef.current = null; };
        await audio.play();
        return;
      } catch (err) {
        console.warn('Azure TTS failed, falling back:', err);
      }
    }

    if ('speechSynthesis' in window) {
      const getVoicesAsync = () => new Promise<SpeechSynthesisVoice[]>((resolve) => {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) return resolve(voices);
        window.speechSynthesis.addEventListener('voiceschanged', () => {
          resolve(window.speechSynthesis.getVoices());
        }, { once: true });
        setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1000);
      });

      const voices = await getVoicesAsync();
      let matchedVoice: SpeechSynthesisVoice | null = null;

      const keyword = vozId.toLowerCase();
      matchedVoice = voices.find(v => {
        const name = v.name.toLowerCase();
        return v.lang.startsWith('ja') && (name.includes(keyword) || name.includes('online') || name.includes('natural'));
      }) || null;

      if (!matchedVoice) {
        matchedVoice = voices.find(v => v.lang.startsWith('ja')) || null;
      }

      if (!matchedVoice) {
        try {
          const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ja&q=${encodeURIComponent(texto)}`;
          const audio = new Audio(googleTtsUrl);
          ttsAudioRef.current = audio;
          audio.playbackRate = Math.min(4, Math.max(0.25, speed));
          audio.onended = () => { setIsTtsPlaying(false); ttsAudioRef.current = null; };
          audio.onerror = () => { setIsTtsPlaying(false); ttsAudioRef.current = null; };
          await audio.play();
          return;
        } catch (e) {
          console.error('Google Translate TTS fallback failed:', e);
        }
      }

      if (matchedVoice) {
        const utterance = new SpeechSynthesisUtterance(texto);
        utterance.lang = 'ja-JP';
        utterance.rate = speed;
        utterance.voice = matchedVoice;

        if (vozId === 'Keita' && matchedVoice && !matchedVoice.name.toLowerCase().includes('keita') && !matchedVoice.name.toLowerCase().includes('male')) {
          utterance.pitch = 0.72;
        } else {
          utterance.pitch = 1.0;
        }

        utterance.onstart = () => setIsTtsPlaying(true);
        utterance.onend = () => { setIsTtsPlaying(false); clearInterval(ttsKeepAliveRef.current); };
        utterance.onerror = () => { setIsTtsPlaying(false); clearInterval(ttsKeepAliveRef.current); };

        clearInterval(ttsKeepAliveRef.current);
        ttsKeepAliveRef.current = setInterval(() => {
          if (window.speechSynthesis.speaking) {
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
          } else {
            clearInterval(ttsKeepAliveRef.current);
          }
        }, 10000);

        window.speechSynthesis.speak(utterance);
      } else {
        setIsTtsPlaying(false);
      }
    } else {
      setIsTtsPlaying(false);
    }
  };

  const calculateSrsIntervals = (card: any) => {
    const c = card ? { ...card } : fsrs.createEmptyCard();
    const repeats = fsrs.repeat(c, new Date());
    
    const formatInterval = (days: number, due?: Date) => {
      if (days === 0 && due) {
        const minutes = Math.max(1, Math.round((due.getTime() - Date.now()) / 60000));
        return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
      }
      if (days === 0) return '10m';
      if (days >= 30) {
        return `${Math.round(days / 30)}mo`;
      }
      return `${days}d`;
    };

    return {
      again: formatInterval(repeats[Rating.Again].scheduled_days, repeats[Rating.Again].due),
      hard: formatInterval(repeats[Rating.Hard].scheduled_days, repeats[Rating.Hard].due),
      good: formatInterval(repeats[Rating.Good].scheduled_days, repeats[Rating.Good].due),
      easy: formatInterval(repeats[Rating.Easy].scheduled_days, repeats[Rating.Easy].due),
      repeats,
    };
  };

  const srsCardPreviewKey = JSON.stringify(srsCard);
  const selectedSrsIntervals = useMemo(
    () => calculateSrsIntervals(srsCard),
    [srsCardPreviewKey, fsrs],
  );

  const handleSrsReview = (word: string, grade: number, preview?: any) => {
    const currentCard = db.getSrsCard(word);
    const intervals = preview ? { repeats: preview } : calculateSrsIntervals(currentCard);
    const updatedCard = { 
      ...currentCard,
      ...(intervals.repeats as any)[grade] 
    };
    
    // Ensure all metadata fields are populated
    if (!updatedCard.word) updatedCard.word = word;
    if (!updatedCard.reading) updatedCard.reading = selectedWord?.reading || selectedWord?.surface || '';
    if (!updatedCard.sentence) updatedCard.sentence = selectedWord?.sentenceText || selectedWord?.sentence || '';
    if (!updatedCard.source) {
      updatedCard.source = currentCard?.source || '';
    }
    
    db.saveSrsCard(word, updatedCard);
    const previousState = getPreviousSrsState(currentCard);
    const isNew = previousState === State.New;
    db.addSrsHistory(word, grade, updatedCard.scheduled_days ?? updatedCard.interval ?? 0, updatedCard.source || '', isNew, previousState);
    syncJitenReview(word, updatedCard.reading || '', grade);
    setSrsCard(db.getSrsCard(word));
    
    if (wordStatuses[word] !== 'learning') {
      onSetWordStatus(word, 'learning');
    }
    
    const gradeName = grade === 1 ? 'Again' : grade === 2 ? 'Hard' : grade === 3 ? 'Good' : 'Easy';
    const nextText = intervals[grade === Rating.Again ? 'again' : grade === Rating.Hard ? 'hard' : grade === Rating.Easy ? 'easy' : 'good'];
    showToast(`SRS: ${gradeName} (${nextText})`, 'success');
  };

  const handleReaderKeydown = useCallback((e: KeyboardEvent) => {
    if (!e.isTrusted) return;
    if (isExtSettingsOpen || isJumpModalOpen || isGalleryOpen) return;
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    const keybindings = settings.keybindings || {
      toggleFullscreen: 'f',
      nextPage: 'ArrowRight',
      prevPage: 'ArrowLeft',
      toggleMenu: 'Escape',
      readAloud: 't'
    };

    const matchKey = (boundKey: string, pressedEvent: KeyboardEvent) => {
      if (!boundKey) return false;
      const lowerBound = boundKey.toLowerCase();
      if (lowerBound === pressedEvent.key.toLowerCase()) return true;
      if (lowerBound === pressedEvent.code.toLowerCase()) return true;
      return false;
    };

    // Toggle vertical / horizontal mode (V key)
    if (e.key === 'v' || e.key === 'V') {
      e.preventDefault();
      const newVertical = !readerSettings.vertical;
      setReaderSetting('vertical', newVertical);
      setReaderSetting('direction', newVertical ? 'vertical' : 'horizontal');
      if (newVertical) setReaderSetting('paginated', true);
      onSaveSettings({ ...settings, readingOrientation: newVertical ? 'vertical' : 'horizontal' });
      showToast(lang === 'es' ? (newVertical ? 'Modo Vertical (Tategaki)' : 'Modo Horizontal (Yokogaki)') : (newVertical ? 'Vertical Mode' : 'Horizontal Mode'), 'info');
      return;
    }

    // Toggle settings popover (Q key)
    if (e.key === 'q' || e.key === 'Q') {
      e.preventDefault();
      setShowSettingsPopover(prev => !prev);
      setIsHeaderVisible(true);
      return;
    }

    // Create Anki card / Save to SRS (A key)
    if (e.key === 'a' || e.key === 'A') {
      if (selectedWord) {
        e.preventDefault();
        handleMineToAnki();
        return;
      }
    }

    // Keys the reader engine already turns pages with.
    if (ENGINE_PAGE_KEYS.has(e.key)) {
      return;
    }

    // Next page (J)
    if (e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      engineApiRef.current?.turnPage(1);
      return;
    }

    // Prev page (K)
    if (e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      engineApiRef.current?.turnPage(-1);
      return;
    }

    if (matchKey(keybindings.toggleFullscreen, e)) {
      e.preventDefault();
      toggleFullscreen();
      return;
    }

    if (matchKey(keybindings.nextPage, e)) {
      e.preventDefault();
      engineApiRef.current?.turnPage(1);
      return;
    }

    if (matchKey(keybindings.prevPage, e)) {
      e.preventDefault();
      engineApiRef.current?.turnPage(-1);
      return;
    }

    if (matchKey(keybindings.toggleMenu, e)) {
      e.preventDefault();
      setIsHeaderVisible(prev => !prev);
      return;
    }

    if (matchKey(keybindings.readAloud, e)) {
      e.preventDefault();
      if (isTtsPlaying) {
        wordAudioRef.current?.stop();
        wordAudioRef.current = null;
        if (ttsAudioRef.current) {
          ttsAudioRef.current.pause();
          ttsAudioRef.current = null;
        }
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          clearInterval(ttsKeepAliveRef.current);
        }
        setIsTtsPlaying(false);
      } else if (selectedWord && selectedWord.surface) {
        playSelectedWordAudio();
      }
      return;
    }
  }, [settings, readerSettings.vertical, setReaderSetting, onSaveSettings, lang, showToast, isExtSettingsOpen, isJumpModalOpen, isGalleryOpen, toggleFullscreen, triggerTtuKeyboardAction, isTtsPlaying, selectedWord, dictEntry, handleMineToAnki]);

  useEffect(() => {
    window.addEventListener('keydown', handleReaderKeydown);
    return () => {
      window.removeEventListener('keydown', handleReaderKeydown);
    };
  }, [handleReaderKeydown]);

  const colors = useMemo(() => {
    const themeName: string = readerSettings.theme || 'dark';
    return {
      light: {
        bg: '#ffffff',
        headerBg: '#ffffff',
        border: 'rgba(0, 0, 0, 0.08)',
        textMain: '#000000',
        textMuted: '#8e8e93',
        cardBg: '#f6f6f6',
        accent: '#5c35db',
        popoverBg: '#ffffff',
      },
      sepia: {
        bg: '#fcfaf2',
        headerBg: '#fcfaf2',
        border: 'rgba(92, 75, 55, 0.15)',
        textMain: '#5c4b37',
        textMuted: 'rgba(92, 75, 55, 0.65)',
        cardBg: '#f4eedb',
        accent: '#8b5a2b',
        popoverBg: '#fcfaf2',
      },
      dark: {
        bg: '#08080a',
        headerBg: '#08080a',
        border: 'rgba(255, 255, 255, 0.12)',
        textMain: '#ffffff',
        textMuted: 'rgba(255, 255, 255, 0.45)',
        cardBg: 'rgba(255, 255, 255, 0.05)',
        accent: '#FFE000',
        popoverBg: '#050507',
      },
      'night-contrast': {
        bg: '#000000',
        headerBg: '#000000',
        border: 'rgba(255, 255, 255, 0.16)',
        textMain: '#ffffff',
        textMuted: 'rgba(255, 255, 255, 0.6)',
        cardBg: 'rgba(255, 255, 255, 0.06)',
        accent: '#FFE000',
        popoverBg: '#000000',
      },
      'sepia-contrast': {
        bg: '#f4ecd8',
        headerBg: '#f4ecd8',
        border: 'rgba(59, 42, 24, 0.2)',
        textMain: '#2e1f0f',
        textMuted: 'rgba(46, 31, 15, 0.7)',
        cardBg: '#ebe0c4',
        accent: '#7a4a1c',
        popoverBg: '#f4ecd8',
      },
      twilight: {
        bg: '#1c2230',
        headerBg: '#1c2230',
        border: 'rgba(201, 209, 224, 0.14)',
        textMain: '#c9d1e0',
        textMuted: 'rgba(201, 209, 224, 0.55)',
        cardBg: 'rgba(201, 209, 224, 0.06)',
        accent: '#f5c86b',
        popoverBg: '#171c28',
      },
      console: {
        bg: '#000000',
        headerBg: '#000000',
        border: 'rgba(51, 255, 102, 0.2)',
        textMain: '#33ff66',
        textMuted: 'rgba(51, 255, 102, 0.55)',
        cardBg: 'rgba(51, 255, 102, 0.05)',
        accent: '#33ff66',
        popoverBg: '#000000',
      },
    }[themeName as 'light' | 'sepia' | 'dark' | 'night-contrast' | 'sepia-contrast' | 'twilight' | 'console'] || {
      bg: themeName === 'custom' ? (localStorage.getItem('reader:customBg') || '#08080a') : '#08080a',
      headerBg: themeName === 'custom' ? (localStorage.getItem('reader:customBg') || '#08080a') : '#08080a',
      border: 'rgba(255, 255, 255, 0.12)',
      textMain: themeName === 'custom' ? (localStorage.getItem('reader:customText') || '#ffffff') : '#ffffff',
      textMuted: 'rgba(255, 255, 255, 0.45)',
      cardBg: 'rgba(255, 255, 255, 0.05)',
      accent: '#FFE000',
      popoverBg: '#050507',
    };
  }, [readerSettings.theme]);

  // Android back button: close the top-most panel or popup; with none open, leave the book.
  useBackHandler(true, () => {
    const steps: [boolean, () => void][] = [
      [Boolean(deckSelectorWord), () => setDeckSelectorWord(null)],
      [Boolean(selectedWord), () => setSelectedWord(null)],
      [isExtSettingsOpen, () => setIsExtSettingsOpen(false)],
      [isVoiceSettingsOpen, () => setIsVoiceSettingsOpen(false)],
      [isJumpModalOpen, () => setIsJumpModalOpen(false)],
      [isGalleryOpen, () => setIsGalleryOpen(false)],
      [isSearchOpen, () => setIsSearchOpen(false)],
      [showSettingsPopover, () => setShowSettingsPopover(false)],
      [sidebarMode !== null, () => setSidebarMode(null)],
      [isReadAloudOpen, () => { readAloud.stop(); setIsReadAloudOpen(false); }],
    ];
    const step = steps.find(([open]) => open);
    if (step) step[1]();
    else handleBack();
  });

  // Saving progress rewrites the whole library in IndexedDB (every book's text): never on each
  // page turn. Keep the latest position and save it after a pause, and always when leaving.
  const pendingProgressRef = useRef<[number, number, number] | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const flushProgress = useCallback(() => {
    if (progressTimerRef.current !== null) window.clearTimeout(progressTimerRef.current);
    progressTimerRef.current = null;
    const pending = pendingProgressRef.current;
    if (!pending) return;
    pendingProgressRef.current = null;
    onUpdateProgress(book.id, pending[0], pending[1], pending[2]);
  }, [book.id, onUpdateProgress]);
  const flushProgressRef = useRef(flushProgress);
  flushProgressRef.current = flushProgress;
  useEffect(() => {
    const onHidden = () => { if (document.visibilityState === 'hidden') flushProgressRef.current(); };
    const onPageHide = () => flushProgressRef.current();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
      flushProgressRef.current();
    };
  }, []);

  const handleCharsUpdate = useCallback((payload: any) => {
    setCurrentProgress(payload);
    const tracker = readingTrackerRef.current;
    const position = Math.max(0, Number(payload.currChars) || 0);
    if (skipNextReadingPositionRef.current) {
      skipNextReadingPositionRef.current = false;
      tracker.lastPosition = position;
      tracker.furthestPosition = Math.max(tracker.furthestPosition, position);
    } else if (tracker.active) {
      if (!tracker.paused && position > tracker.furthestPosition) {
        const addedChars = position - tracker.furthestPosition;
        tracker.totalChars += addedChars;
        tracker.pendingChars += addedChars;
        tracker.furthestPosition = position;
        setSession((previous) => ({
          ...previous,
          charsRead: tracker.totalChars,
          speed: tracker.totalSeconds >= 10
            ? Math.round((tracker.totalChars * 3600) / tracker.totalSeconds)
            : 0,
        }));
      }
      tracker.lastPosition = position;
    } else {
      tracker.lastPosition = position;
      tracker.furthestPosition = position;
    }

    const percentage = payload.totalChars > 0 ? Math.min(100, Math.floor((payload.currChars / payload.totalChars) * 100)) : 0;
    pendingProgressRef.current = [payload.currSection, payload.lastIndex, percentage];
    if (progressTimerRef.current !== null) window.clearTimeout(progressTimerRef.current);
    progressTimerRef.current = window.setTimeout(() => flushProgressRef.current(), 1500);
  }, []);

  const handleNavbarMouseLeave = useCallback(() => {
    if (!sidebarMode && !showSettingsPopover && !isJumpModalOpen && !isGalleryOpen) {
      setIsHeaderVisible(false);
    }
  }, [sidebarMode, showSettingsPopover, isJumpModalOpen, isGalleryOpen]);

  const hideBarsOnPageTurnRef = useRef(true);
  hideBarsOnPageTurnRef.current = !showSettingsPopover && !sidebarMode && !isSearchOpen;
  const handlePageTurn = useCallback(() => {
    if (hideBarsOnPageTurnRef.current) setIsHeaderVisible(false);
  }, []);

  const handleEngineClick = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement | null;
    const wordSpan = target?.closest('[data-word], [wordId], .jiten-word') as HTMLElement | null;
    if (wordSpan) {
      triggerWordLookup(wordSpan);
      return;
    }
    setIsHeaderVisible(prev => !prev);
  }, [triggerWordLookup]);

  // Android: the native engine (NativeReaderHost) draws the book unless it is turned off in the
  // reader settings or failed for this book; then the WebView engine takes over.
  const nativeAvailable = useMemo(() => isNativeReaderAvailable(), []);
  const [nativeFailed, setNativeFailed] = useState(false);
  const useNativeEngine = nativeAvailable && readerSettings.nativeEngine !== false && !nativeFailed;
  const handleNativeTap = useCallback((closePopup: boolean) => {
    if (closePopup) setSelectedWord(null);
    else setIsHeaderVisible(prev => !prev);
  }, []);
  const handleNativeWordTap = useCallback((wordSpan: HTMLElement, rect: DOMRect) => {
    void triggerWordLookup(wordSpan, rect);
  }, [triggerWordLookup]);
  const handleNativeError = useCallback((message: string) => {
    console.warn('Native reader failed, using the WebView reader:', message);
    setNativeFailed(true);
    showToast(lang === 'es' ? 'El lector nativo falló; se usa el lector web.' : 'The native reader failed; using the web reader.', 'error');
  }, [lang, showToast]);
  // Switching engines mid-book: the new one starts where the other one was.
  const currentProgressRef = useRef(currentProgress);
  currentProgressRef.current = currentProgress;
  const initialEngineRef = useRef(useNativeEngine);
  const engineSwitchedRef = useRef(false);
  const engineBook = useMemo(() => {
    if (useNativeEngine !== initialEngineRef.current) engineSwitchedRef.current = true;
    if (!engineSwitchedRef.current) return book;
    const position = currentProgressRef.current;
    return {
      ...book,
      _savedSection: position.currSection,
      progress: { ...(book.progress || {}), currentChapter: position.currSection, currentPage: position.lastIndex },
    };
  }, [book, useNativeEngine]);

  return (
    <div 
      ref={containerRef}
      className="reader-container"
      data-theme={baseReaderTheme(readerSettings.theme || 'dark')}
      data-reader-theme={readerSettings.theme || 'dark'}
      style={{
        width: '100%',
        height: '100vh',
        background: colors.bg,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Top hover trigger zone to show navbar */}
      {!isHeaderVisible && (
        <div 
          data-native-ignore
          onMouseEnter={() => setIsHeaderVisible(true)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: '24px',
            zIndex: 9997,
            background: 'transparent',
          }}
        />
      )}

      <ReaderNavbar
        visible={isHeaderVisible}
        onClose={() => setIsHeaderVisible(false)}
        onBack={handleBack}
        onToggleToc={() => setSidebarMode('toc')}
        onToggleBookmarks={() => setSidebarMode('bookmarks')}
        onToggleSession={() => setSidebarMode('session')}
        isReadingSpeedActive={session.isActive}
        isReadingSpeedPaused={session.isPaused}
        readingSpeed={session.speed}
        onToggleReadingSpeed={handleToggleReadingMeasurement}
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenNotes={() => setSidebarMode('notes')}
        bookAuthor={book?.author || ''}
        sectionTitle={engineApiRef.current?.getSections()[currentProgress.currSection]?.title || ''}
        isReadingAloud={isReadAloudOpen}
        onToggleReadAloud={() => {
          if (isReadAloudOpen) {
            readAloud.stop();
            setIsReadAloudOpen(false);
          } else {
            setIsReadAloudOpen(true);
            readAloud.start();
          }
        }}
        onToggleSettings={() => setShowSettingsPopover(prev => !prev)}
        onToggleFullscreen={toggleFullscreen}
        isFullscreen={!!document.fullscreenElement}
        bookTitle={book?.title || ''}
        colors={colors}
        lang={lang}
        isBookCompleted={book.status === 'completed'}
        onToggleFlagCompleted={handleToggleCompleted}
        onOpenGallery={() => {
          if (bookImages.length === 0) {
            showToast(lang === 'es' ? 'Esta novela no contiene imágenes' : 'This novel contains no images', 'warning');
            return;
          }
          setGalleryIndex(0);
          setIsGalleryOpen(true);
        }}
        onOpenJumpModal={() => {
          setJumpPosition(currentProgress.currChars);
          setIsJumpModalOpen(true);
        }}
        onMouseLeave={handleNavbarMouseLeave}
      />

      {isHeaderVisible && showSettingsPopover && (
        <ReaderSettingsPopover
          settings={readerSettings}
          onSettingChange={setReaderSetting}
          onClose={() => setShowSettingsPopover(false)}
          onOpenFullSettings={() => {
            setShowSettingsPopover(false);
            setSidebarMode('settings');
          }}
          onOpenExtensionSettings={handleOpenExtensionSettings}
          lang={lang}
        />
      )}

      {noteDraft && (
        <HighlightNoteDialog
          highlight={noteDraft.highlight}
          isNew={noteDraft.isNew}
          lang={lang}
          colors={colors}
          onCancel={() => setNoteDraft(null)}
          onDelete={() => {
            if (!noteDraft.isNew) saveHighlights(highlights.filter((h) => h.id !== noteDraft.highlight.id));
            setNoteDraft(null);
          }}
          onSave={({ note, color }) => {
            saveHighlights(withHighlight(highlights, { ...noteDraft.highlight, note: note.trim() || undefined, color }));
            setNoteDraft(null);
          }}
        />
      )}

      {isSearchOpen && (
        <BookSearchPanel
          chapters={book.chapters || []}
          apiRef={engineApiRef}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onClose={() => setIsSearchOpen(false)}
          colors={colors}
          lang={lang}
        />
      )}

      <ReaderPageBar
        visible={isHeaderVisible && !showSettingsPopover && !isSearchOpen}
        currChars={currentProgress.currChars}
        totalChars={currentProgress.totalChars}
        apiRef={engineApiRef}
        onSeek={(position) => {
          skipNextReadingPositionRef.current = true;
          setTargetCharPosition(position);
          setTimeout(() => setTargetCharPosition(null), 100);
        }}
        lang={lang}
        accent={colors.accent}
        rtl={readerSettings.vertical}
      />

      {isReadAloudOpen && (
        <ReadAloudBar
          status={readAloud.status}
          rate={readAloud.rate}
          position={readAloud.position}
          sleepEndsAt={readAloud.sleepEndsAt}
          lang={lang}
          accent={colors.accent}
          onPlay={() => (readAloud.status === 'idle' ? readAloud.start() : readAloud.resume())}
          onPause={readAloud.pause}
          onSkip={readAloud.skip}
          onRate={readAloud.setRate}
          onSleep={readAloud.setSleepMinutes}
          onSettings={() => setIsVoiceSettingsOpen(true)}
          raised={isHeaderVisible}
          onClose={() => { readAloud.stop(); setIsReadAloudOpen(false); }}
        />
      )}

      {isVoiceSettingsOpen && (
        <ReadAloudSettings
          voice={readAloud.voice}
          rate={readAloud.rate}
          sleepEndsAt={readAloud.sleepEndsAt}
          onVoice={readAloud.setVoice}
          onRate={readAloud.setRate}
          onSleep={readAloud.setSleepMinutes}
          onClose={() => setIsVoiceSettingsOpen(false)}
          colors={colors}
          lang={lang}
        />
      )}

      {useNativeEngine ? (
        <NativeReaderHost
          apiRef={engineApiRef}
          book={engineBook}
          readerSettings={readerSettings}
          colors={colors}
          rootRef={containerRef}
          targetSection={navTargetSection}
          targetParagraphId={navTargetParagraphId}
          targetCharPosition={targetCharPosition}
          onCharsUpdate={handleCharsUpdate}
          onTap={handleNativeTap}
          onWordTap={handleNativeWordTap}
          popupOpen={Boolean(selectedWord)}
          wordStatuses={wordStatuses}
          onPageTurn={handlePageTurn}
          onError={handleNativeError}
          readAloudIdle={readAloud.status === 'idle'}
        />
      ) : (
        <ReaderEngine
          apiRef={engineApiRef}
          book={engineBook}
          readerSettings={readerSettings}
          targetSection={navTargetSection}
          targetParagraphId={navTargetParagraphId}
          targetCharPosition={targetCharPosition}
          onCharsUpdate={handleCharsUpdate}
          onClick={handleEngineClick}
          onPageTurn={handlePageTurn}
          wordStatuses={wordStatuses}
          colors={colors}
        />
      )}

      {/* Jump to Position Modal */}
      {isJumpModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          zIndex: 10020,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(4px)',
        }}>
          <div style={{
            background: colors.popoverBg || '#0c0c0e',
            border: `1px solid ${colors.border || 'rgba(255,255,255,0.1)'}`,
            borderRadius: '12px',
            padding: '24px',
            width: '320px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            color: colors.textMain,
            fontFamily: 'var(--font-ui), sans-serif',
          }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.1rem', fontWeight: 600 }}>
              {lang === 'es' ? 'Ir a Posición' : 'Jump to Position'}
            </h3>
            <input
              type="number"
              value={jumpPosition}
              onChange={(e) => setJumpPosition(Number(e.target.value))}
              min={0}
              max={currentProgress.totalChars}
              style={{
                width: '100%',
                padding: '10px',
                background: 'rgba(255,255,255,0.05)',
                border: `1px solid ${colors.border || 'rgba(255,255,255,0.1)'}`,
                borderRadius: '6px',
                color: '#fff',
                fontSize: '1rem',
                marginBottom: '20px',
                outline: 'none',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmJump();
                else if (e.key === 'Escape') setIsJumpModalOpen(false);
              }}
              autoFocus
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                onClick={() => setIsJumpModalOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: colors.textMuted,
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  padding: '8px 16px',
                }}
              >
                {lang === 'es' ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                onClick={handleConfirmJump}
                style={{
                  background: '#FFE000',
                  border: 'none',
                  color: '#000',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  padding: '8px 16px',
                }}
              >
                {lang === 'es' ? 'Confirmar' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Gallery Viewer Modal */}
      {isGalleryOpen && bookImages.length > 0 && (
        <div className="reader-gallery" role="dialog" aria-modal="true" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: '#08080a',
          zIndex: 10030,
          display: 'flex',
          color: '#fff',
          fontFamily: 'var(--font-ui), sans-serif',
          animation: 'fadeIn 0.2s ease-out',
        }}>
          <style>{`
            .gallery-sidebar::-webkit-scrollbar {
              width: 6px;
            }
            .gallery-sidebar::-webkit-scrollbar-track {
              background: transparent;
            }
            .gallery-sidebar::-webkit-scrollbar-thumb {
              background: rgba(255, 255, 255, 0.15);
              border-radius: 3px;
            }
            .gallery-sidebar::-webkit-scrollbar-thumb:hover {
              background: rgba(255, 255, 255, 0.3);
            }
          `}</style>

          {/* Close button */}
          <button
            type="button"
            className="reader-gallery-close"
            aria-label={lang === 'es' ? 'Cerrar galería' : 'Close gallery'}
            onClick={(e) => { e.stopPropagation(); setIsGalleryOpen(false); }}
            style={{
              position: 'absolute',
              top: 'calc(16px + var(--yoru-safe-top, 0px))',
              left: '16px',
              background: 'rgba(0,0,0,0.5)',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              zIndex: 10035,
              padding: '8px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={20} />
          </button>

          {/* Thumbnails Sidebar (Left) */}
          <div 
            className={`gallery-sidebar${bookImages.length < 2 ? " is-single" : ""}`}
            style={{
              width: '210px',
              background: '#0d0d0f',
              borderRight: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              padding: '80px 16px 20px 16px',
              gap: '16px',
              flexShrink: 0,
              boxSizing: 'border-box',
            }}
          >
            {bookImages.map((src, idx) => (
              <div
                key={idx}
                onClick={() => setGalleryIndex(idx)}
                style={{
                  cursor: 'pointer',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  border: galleryIndex === idx ? '2px solid #FFE000' : '2px solid transparent',
                  transition: 'border-color 0.15s',
                  background: '#131316',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  aspectRatio: '3/4',
                  width: '100%',
                  flexShrink: 0,
                  boxSizing: 'border-box',
                }}
              >
                <img
                  src={src}
                  alt={`Thumbnail ${idx + 1}`}
                  loading="lazy"
                  decoding="async"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                />
              </div>
            ))}
          </div>

          {/* Main View Area (Center/Right) */}
          <div className="reader-gallery-main" style={{
            flex: 1,
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px 40px',
          }}>
            {/* Prev Arrow */}
            {galleryIndex > 0 && (
              <button
                type="button"
                className="reader-gallery-arrow is-prev"
                aria-label={lang === 'es' ? 'Imagen anterior' : 'Previous image'}
                onClick={() => setGalleryIndex(prev => prev - 1)}
                style={{
                  position: 'absolute',
                  left: '20px',
                  background: 'rgba(0,0,0,0.5)',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  padding: '16px 12px',
                  borderRadius: '8px',
                  zIndex: 10032,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
              </button>
            )}

            {/* Main Image */}
            <div className="reader-gallery-frame" style={{
              maxWidth: '95%',
              maxHeight: '92vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 30px rgba(0,0,0,0.7)',
              borderRadius: '8px',
              overflow: 'hidden',
              background: '#000',
            }}>
              <img
                src={bookImages[galleryIndex]}
                alt={`Image ${galleryIndex + 1}`}
                className="reader-gallery-image"
                decoding="async"
                style={{
                  maxWidth: '100%',
                  maxHeight: '92vh',
                  objectFit: 'contain',
                }}
              />
            </div>

            {/* Next Arrow */}
            {galleryIndex < bookImages.length - 1 && (
              <button
                type="button"
                className="reader-gallery-arrow is-next"
                aria-label={lang === 'es' ? 'Imagen siguiente' : 'Next image'}
                onClick={() => setGalleryIndex(prev => prev + 1)}
                style={{
                  position: 'absolute',
                  right: '20px',
                  background: 'rgba(0,0,0,0.5)',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  padding: '16px 12px',
                  borderRadius: '8px',
                  zIndex: 10032,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
            )}

            {/* Index Counter (Bottom) */}
            <div style={{
              marginTop: '12px',
              fontSize: '1rem',
              color: 'rgba(255,255,255,0.7)',
              background: 'rgba(0,0,0,0.6)',
              padding: '6px 16px',
              borderRadius: '20px',
              userSelect: 'none',
            }}>
              {galleryIndex + 1} / {bookImages.length}
            </div>
          </div>
        </div>
      )}

      <YoruParserSettings
        isOpen={isExtSettingsOpen}
        onClose={() => setIsExtSettingsOpen(false)}
        colors={colors}
        lang={lang}
      />

      <CharacterCounter
        currChars={currentProgress.currChars}
        totalChars={currentProgress.totalChars}
        colors={colors}
      />

      {selection && selection.visible && (
        <SelectionToolbar
          visible={selection.visible}
          position={selection.rect}
          selectedText={selection.text}
          onCopy={handleCopyText}
          onBookmark={handleBookmarkSelection}
          onHighlight={selection.offsets ? handleHighlightSelection : undefined}
          onNote={selection.offsets ? handleNoteSelection : undefined}
          colors={colors}
          lang={lang}
        />
      )}

      {toast.show && (
        <div style={{
          position: 'fixed',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: toast.type === 'error' ? 'rgba(239, 68, 68, 0.95)' : 'rgba(12, 12, 14, 0.95)',
          border: toast.type === 'error' ? '1px solid #ef4444' : `1px solid ${colors.accent}66`,
          color: '#fff',
          padding: '8px 18px',
          borderRadius: '20px',
          zIndex: 100000,
          boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
          fontSize: '0.82rem',
          fontWeight: 600,
          backdropFilter: 'blur(16px)',
          letterSpacing: '0.02em',
        }}>
          {toast.message}
        </div>
      )}

      {sidebarMode === 'settings' ? (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: colors.bg || '#121214',
            zIndex: 10001,
            display: 'flex',
            flexDirection: 'column',
            animation: 'fadeIn 0.2s ease-out',
            overflow: 'hidden',
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'calc(12px + var(--yoru-safe-top, 0px)) 20px 12px',
            borderBottom: `1px solid ${colors.border || 'rgba(255,255,255,0.08)'}`,
            background: colors.popoverBg || '#1c1c1e',
            flexShrink: 0,
          }}>
            <button
              onClick={() => setSidebarMode(null)}
              style={{
                background: 'none',
                border: 'none',
                color: colors.accent || '#FFE000',
                fontSize: '0.9rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              ← {lang === 'es' ? 'Volver al Lector' : 'Back to Reader'}
            </button>
            <span style={{ fontSize: '0.95rem', fontWeight: 'bold', color: colors.textMain || '#fff' }}>
              {lang === 'es' ? 'Ajustes del Lector' : 'Reader Settings'}
            </span>
            <div style={{ width: '80px' }} /> {/* Spacer */}
          </div>
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '24px 16px 40px 16px',
              display: 'flex',
              justifyContent: 'center',
              background: colors.bg || '#08080a',
            }}
          >
            <div style={{ width: '100%', maxWidth: '560px' }}>
              <ReaderSettings
                settings={readerSettings}
                onSettingChange={setReaderSetting}
                onOpenExtensionSettings={handleOpenExtensionSettings}
                colors={colors}
                lang={lang}
              />
            </div>
          </div>
        </div>
      ) : (
        <ReaderSidebar
          mode={sidebarMode}
          onClose={() => setSidebarMode(null)}
          sections={book.chapters.map((ch: any, idx: number) => ({ id: `chapter-${idx}`, title: ch.title, isFromToc: ch.isFromToc }))}
          currSection={currentProgress.currSection}
          onGoToSection={(idx: number) => {
            skipNextReadingPositionRef.current = true;
            setNavTargetSection(idx);
            requestAnimationFrame(() => setNavTargetSection(null));
          }}
          bookmarks={bookmarks}
          onGoToBookmark={(bm: any) => goToParagraphAnywhere(bm.paragraphId)}
          onModeChange={setSidebarMode}
          highlights={highlights}
          onGoToHighlight={(item) => goToParagraphAnywhere(item.paragraphId, item)}
          onEditHighlight={(item) => setNoteDraft({ highlight: item, isNew: false })}
          onExportHighlights={handleExportHighlights}
          readingSession={session}
          onToggleSession={handleToggleSession}
          colors={colors}
          lang={lang}
        />
      )}

      {selectedWord && (
        <div 
          ref={dictPopupRef}
          className="dict-popup"
          style={{ 
            position: 'fixed',
            left: `${popupPos.x}px`, 
            top: `${popupPos.y}px`,
            zIndex: 99999,
            transform: popupPos.anchorBottom ? 'translateY(-100%)' : 'none',
            maxHeight: `${popupMaxHeight}px`,
            width: 'min(360px, calc(100vw - 24px))',
            boxSizing: 'border-box',
            background: colors.popoverBg,
            border: `1px solid ${colors.border}`,
            borderRadius: '12px',
            padding: window.innerWidth < 768 ? '8px 10px' : '12px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            writingMode: 'horizontal-tb',
            WebkitWritingMode: 'horizontal-tb',
            textOrientation: 'mixed',
            direction: 'ltr',
            textAlign: 'left'
          }}
        >
          {(() => {
            const wordStatus = wordStatuses[selectedWord.basicForm] || 'new';
            const isLearning = wordStatus === 'learning';
            const isKnown = wordStatus === 'known';
            const isIgnored = wordStatus === 'ignored';

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                <div style={{ display: 'flex', gap: '5px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (isKnown) {
                        onSetWordStatus(selectedWord.basicForm, 'new');
                      } else {
                        const wordData = {
                          reading: selectedWord.reading || selectedWord.surface,
                          meaning: dictEntry?.definitions?.slice(0, 3).map((d: any) => typeof d === 'string' ? d : (d.glossary || '')).join(' / ') || ''
                        };
                        onSetWordStatus(selectedWord.basicForm, 'known', wordData);
                      }
                    }}
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      borderRadius: '5px',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      background: isKnown ? 'rgba(74, 117, 36, 0.22)' : 'rgba(255,255,255,0.02)',
                      border: isKnown ? '1.5px solid rgba(74, 117, 36, 0.7)' : '1px solid rgba(255,255,255,0.1)',
                      color: isKnown ? '#a3e635' : '#84cc16',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {lang === 'es' ? 'Nunca olvidar' : 'Never forget'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (isIgnored) {
                        onSetWordStatus(selectedWord.basicForm, 'new');
                      } else {
                        onSetWordStatus(selectedWord.basicForm, 'ignored');
                      }
                    }}
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      borderRadius: '5px',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      background: isIgnored ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.02)',
                      border: isIgnored ? '1.5px solid rgba(255,255,255,0.3)' : '1px solid rgba(255,255,255,0.1)',
                      color: isIgnored ? '#fff' : '#a1a1aa',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Blacklist
                  </button>

                  <div style={{ position: 'relative' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setDeckSelectorWord(prev => prev ? null : selectedWord.basicForm);
                      }}
                      style={{
                        padding: '4px 10px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        borderRadius: '5px',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        background: isLearning ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.02)',
                        border: isLearning ? '1.5px solid rgba(59, 130, 246, 0.5)' : '1px solid rgba(255,255,255,0.1)',
                        color: isLearning ? '#60a5fa' : '#3b82f6',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {isLearning ? 'Deck -' : 'Deck +'}
                    </button>
                    
                    {deckSelectorWord === selectedWord.basicForm && (() => {
                      const srsData = db.getSrsData();
                      const deckNamesSet = new Set<string>();
                      
                      // ONLY user-created decks from _deck_ keys or card sources
                      Object.entries(srsData).forEach(([word, card]: [string, any]) => {
                        if (word.startsWith('_deck_')) {
                          const deckName = word.substring(6).trim();
                          if (deckName) deckNamesSet.add(deckName);
                        } else if (card && card.source && !word.startsWith('_')) {
                          const src = card.source.trim();
                          if (src) deckNamesSet.add(src);
                        }
                      });
                      
                      const allDecks = Array.from(deckNamesSet);
                      const currentCard = db.getSrsCard(selectedWord.basicForm);
                      const currentDeck = currentCard?.source || '';
                      
                      const handleCreateAndAssignDeck = (deckName: string) => {
                        const trimmed = deckName.trim();
                        if (!trimmed) return;
                        
                        // Register deck in srsData
                        const updatedSrs = db.getSrsData();
                        updatedSrs[`_deck_${trimmed}`] = { createdAt: new Date().toISOString() };
                        
                        const wordData = {
                          reading: selectedWord.reading || selectedWord.surface,
                          sentence: selectedWord.sentenceText || selectedWord.surface || '',
                          source: trimmed
                        };
                        
                        const card = updatedSrs[selectedWord.basicForm] || {
                          word: selectedWord.basicForm,
                          reading: wordData.reading,
                          sentence: wordData.sentence,
                          state: 0,
                          dueDate: new Date().toISOString(),
                          due: new Date().toISOString()
                        };
                        card.source = trimmed;
                        updatedSrs[selectedWord.basicForm] = card;
                        
                        db.saveSrsData(updatedSrs);
                        setSrsCard(card);
                        onSetWordStatus(selectedWord.basicForm, 'learning', wordData);
                        setDeckSelectorWord(null);
                        setNewDeckInput('');
                      };

                      const handleDeleteDeck = (e: React.MouseEvent, deckName: string) => {
                        e.stopPropagation();
                        const updatedSrs = db.getSrsData();
                        delete updatedSrs[`_deck_${deckName}`];
                        Object.entries(updatedSrs).forEach(([key, card]: [string, any]) => {
                          if (card && card.source === deckName) {
                            card.source = '';
                          }
                        });
                        db.saveSrsData(updatedSrs);
                        if (currentDeck === deckName) {
                          setSrsCard(db.getSrsCard(selectedWord.basicForm));
                        }
                      };

                      return (
                        <div style={{
                          position: 'absolute',
                          top: '100%',
                          right: 0,
                          marginTop: '6px',
                          background: 'rgba(20, 20, 24, 0.98)',
                          backdropFilter: 'blur(12px)',
                          WebkitBackdropFilter: 'blur(12px)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          borderRadius: '10px',
                          padding: '12px',
                          zIndex: 100,
                          minWidth: '200px',
                          maxWidth: '260px',
                          boxShadow: '0 12px 28px rgba(0, 0, 0, 0.6), 0 4px 10px rgba(0, 0, 0, 0.4)'
                        }}>
                          <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            {lang === 'es' ? 'Añadir al mazo' : 'Add to deck'}
                          </div>
                          
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '160px', overflowY: 'auto', marginBottom: '8px' }}>
                            {allDecks.length === 0 ? (
                              <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', padding: '6px 4px', fontStyle: 'italic' }}>
                                {lang === 'es' ? 'No hay mazos creados aún.' : 'No custom decks created yet.'}
                              </div>
                            ) : (
                              allDecks.map(deckName => {
                                const isSelected = isLearning && currentDeck === deckName;
                                return (
                                  <div
                                    key={deckName}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      background: isSelected ? 'rgba(139, 92, 246, 0.18)' : 'rgba(255,255,255,0.03)',
                                      border: isSelected ? '1px solid rgba(139, 92, 246, 0.45)' : '1px solid transparent',
                                      borderRadius: '6px',
                                      padding: '5px 8px',
                                      transition: 'all 0.15s'
                                    }}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => handleCreateAndAssignDeck(deckName)}
                                      style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: isSelected ? '#a78bfa' : 'var(--text-main)',
                                        fontSize: '0.75rem',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        flex: 1,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap'
                                      }}
                                    >
                                      {deckName}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => handleDeleteDeck(e, deckName)}
                                      title={lang === 'es' ? 'Eliminar mazo' : 'Delete deck'}
                                      style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'rgba(255,255,255,0.3)',
                                        cursor: 'pointer',
                                        fontSize: '0.7rem',
                                        padding: '2px 4px',
                                        borderRadius: '3px'
                                      }}
                                      onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; }}
                                      onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.3)'; }}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                );
                              })
                            )}
                          </div>

                          {/* Create new deck input row */}
                          <div style={{
                            display: 'flex',
                            gap: '4px',
                            borderTop: '1px solid rgba(255,255,255,0.08)',
                            paddingTop: '8px',
                            marginTop: '4px'
                          }}>
                            <input
                              type="text"
                              value={newDeckInput}
                              onChange={(e) => setNewDeckInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleCreateAndAssignDeck(newDeckInput);
                                }
                              }}
                              placeholder={lang === 'es' ? 'Nuevo mazo...' : 'New deck...'}
                              style={{
                                flex: 1,
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.12)',
                                borderRadius: '5px',
                                padding: '4px 8px',
                                fontSize: '0.72rem',
                                color: '#fff',
                                outline: 'none'
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => handleCreateAndAssignDeck(newDeckInput)}
                              style={{
                                background: '#8b5cf6',
                                border: 'none',
                                borderRadius: '5px',
                                padding: '4px 10px',
                                color: '#fff',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                cursor: 'pointer'
                              }}
                            >
                              +
                            </button>
                          </div>
                          
                          {isLearning && (
                            <button
                              type="button"
                              onClick={() => {
                                onSetWordStatus(selectedWord.basicForm, 'new');
                                setDeckSelectorWord(null);
                              }}
                              style={{
                                background: 'rgba(239, 68, 68, 0.08)',
                                border: '1px solid rgba(239, 68, 68, 0.2)',
                                borderRadius: '5px',
                                padding: '5px 8px',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                color: '#f87171',
                                cursor: 'pointer',
                                textAlign: 'center',
                                width: '100%',
                                marginTop: '8px',
                                transition: 'all 0.15s'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)';
                              }}
                            >
                              {lang === 'es' ? 'Quitar del mazo' : 'Remove from deck'}
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {isLearning && (() => {
                  const intervals = selectedSrsIntervals;
                  return (
                    <div style={{ display: 'flex', gap: '5px', marginTop: '4px' }}>
                      <button
                        type="button"
                        onClick={() => handleSrsReview(selectedWord.basicForm, 1, intervals.repeats)}
                        style={{
                          padding: '3px 10px',
                          borderRadius: '5px',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                          background: 'rgba(239, 68, 68, 0.06)',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                          color: '#f87171',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          whiteSpace: 'nowrap'
                        }}
                      >
                        again <span style={{ opacity: 0.55, fontSize: '0.6rem' }}>({intervals.again})</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSrsReview(selectedWord.basicForm, 2, intervals.repeats)}
                        style={{
                          padding: '3px 10px',
                          borderRadius: '5px',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                          background: 'rgba(249, 115, 22, 0.06)',
                          border: '1px solid rgba(249, 115, 22, 0.25)',
                          color: '#fb923c',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          whiteSpace: 'nowrap'
                        }}
                      >
                        hard <span style={{ opacity: 0.55, fontSize: '0.6rem' }}>({intervals.hard})</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSrsReview(selectedWord.basicForm, 3, intervals.repeats)}
                        style={{
                          padding: '3px 10px',
                          borderRadius: '5px',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                          background: 'rgba(168, 85, 247, 0.06)',
                          border: '1px solid rgba(168, 85, 247, 0.25)',
                          color: '#c084fc',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          whiteSpace: 'nowrap'
                        }}
                      >
                        good <span style={{ opacity: 0.55, fontSize: '0.6rem' }}>({intervals.good})</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSrsReview(selectedWord.basicForm, 4, intervals.repeats)}
                        style={{
                          padding: '3px 10px',
                          borderRadius: '5px',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                          background: 'rgba(34, 197, 94, 0.06)',
                          border: '1px solid rgba(34, 197, 94, 0.25)',
                          color: '#4ade80',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          whiteSpace: 'nowrap'
                        }}
                      >
                        easy <span style={{ opacity: 0.55, fontSize: '0.6rem' }}>({intervals.easy})</span>
                      </button>
                    </div>
                  );
                })()}

                {srsCard && (
                  <div style={{
                    fontSize: '0.68rem',
                    color: colors.textMuted,
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: '4px',
                    padding: '3px 6px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: '2px'
                  }}>
                    <span>Intervalo: {srsCard.interval ?? srsCard.scheduled_days ?? 0}d</span>
                    <span>Ease: {(srsCard.ease ?? 2.5).toFixed(2)}</span>
                    <span>Reps: {srsCard.repetitions ?? srsCard.reps ?? 0}</span>
                  </div>
                )}
              </div>
            );
          })()}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '6px', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: window.innerWidth < 768 ? '1.15rem' : '1.4rem', fontWeight: 'bold', color: colors.textMain }}>
                {selectedWord.surface}
              </span>
              <button
                type="button"
                onClick={playSelectedWordAudio}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: colors.textMuted,
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '4px',
                  transition: 'background 0.15s, color 0.15s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                  e.currentTarget.style.color = '#FFE000';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = colors.textMuted;
                }}
                title={lang === 'es' ? 'Escuchar pronunciación' : 'Listen pronunciation'}
              >
                <Volume2 size={16} />
              </button>
            </div>
            {selectedWord.reading && selectedWord.reading !== selectedWord.surface && (
              <span style={{ fontSize: '0.9rem', color: colors.textMuted }}>
                {selectedWord.reading}
              </span>
            )}
          </div>

          {/* Pitch Accent Graph */}
          {(() => {
            const accent = getPitchAccent(dictEntry?.pitches, selectedWord.reading || dictEntry?.reading);
            return accent ? <PitchAccentGraph reading={accent.reading || selectedWord.reading} position={accent.position} /> : null;
          })()}

          {/* Anki button small footprint */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            {ankiCardExists ? (
              <button 
                onClick={handleOpenInAnki}
                style={{
                  background: 'rgba(92, 53, 219, 0.1)',
                  border: '1px solid rgba(92, 53, 219, 0.35)',
                  color: '#a78bfa',
                  padding: '3px 8px',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  width: 'fit-content'
                }}
              >
                <ExternalLink size={11} />
                {lang === 'es' ? 'Ver en Anki' : 'View in Anki'}
              </button>
            ) : (
              <button 
                onClick={handleMineToAnki}
                style={{
                  background: 'rgba(255, 224, 0, 0.05)',
                  border: '1px solid rgba(255, 224, 0, 0.25)',
                  color: '#FFE000',
                  padding: '3px 8px',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  width: 'fit-content'
                }}
              >
                <Plus size={11} />
                {lang === 'es' ? 'Anki' : 'Anki'}
              </button>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {!dictLoading ? (
              dictEntry && dictEntry.definitions && dictEntry.definitions.length > 0 ? (
                dictEntry.definitions.map((def: any, idx: number) => {
                  const glossary = typeof def === 'string' ? def : (def?.glossary || '');
                  return (
                  <div key={idx} style={{ marginBottom: '8px', fontSize: '0.85rem', lineHeight: '1.4', color: colors.textMain }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                      <span style={{ 
                        fontSize: '0.68rem', 
                        background: 'rgba(255, 224, 0, 0.1)', 
                        color: '#FFE000', 
                        padding: '1px 5px', 
                        borderRadius: '3px',
                        fontWeight: 600
                      }}>
                        {(typeof def === 'string' ? '' : def?.dictionary) || 'Glosario'}
                      </span>
                      {typeof def !== 'string' && def?.partsOfSpeech && def.partsOfSpeech.map((pos: string, pIdx: number) => (
                        <span key={pIdx} style={{ fontSize: '0.62rem', color: colors.textMuted, fontStyle: 'italic' }}>
                          {pos}
                        </span>
                      ))}
                    </div>
                    <div dangerouslySetInnerHTML={{ __html: sanitizeDictionaryHtml(glossary) }} />
                  </div>
                  );
                })
              ) : (
                <p style={{ color: colors.textMuted, fontSize: '0.82rem' }}>
                  {t('dictNoDefinitions', lang)}
                </p>
              )
            ) : (
              <p style={{ color: colors.textMuted }}>{t('dictLoading', lang)}</p>
            )}
          </div>
        </div>
      )}

      {/* Thin bottom progress line */}
      {readerSettings.showProgressLine && currentProgress.totalChars > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            height: '3px',
            width: `${Math.min(100, (currentProgress.currChars / currentProgress.totalChars) * 100)}%`,
            background: colors.accent,
            transition: 'width 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            zIndex: 10000,
          }}
        />
      )}
    </div>
  );
}
