import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReaderEngineApi } from './ReaderEngine';
import { prefetchSentence, speakSentence, type SpeechHandle } from '../../utils/bookTts';
import { READER_BLOCK_SELECTOR, blockText, rangeForOffsets, setNamedHighlight } from '../../utils/readerText';

/**
 * Reads the open book aloud sentence by sentence, like ReadEra: highlights the sentence being
 * read (CSS Custom Highlight API, so the page DOM is untouched), turns pages and sections on its
 * own, and supports previous/next sentence, speed and a sleep timer.
 */

export type ReadAloudStatus = 'idle' | 'playing' | 'paused';

interface Sentence {
  ordinal: number; // position among the reader's text blocks, to find it again after a re-render
  start: number;
  end: number;
  text: string;
}

const HIGHLIGHT_NAME = 'yoru-read-aloud';
const SPEAKABLE = /[぀-ヿ㐀-鿿豈-﫿A-Za-z0-9０-９Ａ-Ｚａ-ｚ]/;
// A sentence ends at 。！？!? (plus closing quotes/brackets) or at the end of the paragraph.
const SENTENCE = /[^。！？!?…]*(?:[。！？!?]+|…+|$)[」』）)】〉》"’]*/g;

function blocksOf(content: HTMLElement): Element[] {
  return Array.from(content.querySelectorAll(READER_BLOCK_SELECTOR));
}

function sentencesOf(block: Element, ordinal: number): Sentence[] {
  const text = blockText(block);
  const sentences: Sentence[] = [];
  SENTENCE.lastIndex = 0;
  for (let match = SENTENCE.exec(text); match; match = SENTENCE.exec(text)) {
    if (match[0].length === 0) {
      SENTENCE.lastIndex++;
      if (SENTENCE.lastIndex > text.length) break;
      continue;
    }
    const raw = match[0];
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (!SPEAKABLE.test(trimmed)) continue;
    sentences.push({ ordinal, start: match.index + leading, end: match.index + leading + trimmed.length, text: trimmed });
  }
  return sentences;
}

function rangeFor(content: HTMLElement, sentence: Sentence): Range | null {
  const block = blocksOf(content)[sentence.ordinal];
  return block ? rangeForOffsets(block, sentence.start, sentence.end) : null;
}

function collectSentences(content: HTMLElement): Sentence[] {
  return blocksOf(content).flatMap((block, ordinal) => sentencesOf(block, ordinal));
}

/** The first sentence that is at least partly on screen. */
function firstVisibleSentence(content: HTMLElement, sentences: Sentence[]): number {
  const box = content.getBoundingClientRect();
  for (let i = 0; i < sentences.length; i++) {
    const range = rangeFor(content, sentences[i]);
    const rect = range?.getClientRects()[0];
    if (rect && rect.right > box.left && rect.left < box.right && rect.bottom > box.top && rect.top < box.bottom) return i;
  }
  return 0;
}

function setHighlight(range: Range | null) {
  setNamedHighlight(HIGHLIGHT_NAME, range);
}

// Timers, not animation frames: frames stop while the page is hidden (screen off), timers keep going.
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Waits until the reader shows a different first block (the next section has been rendered). */
async function waitForNewSection(api: ReaderEngineApi, previousFirst: Element | undefined) {
  for (let waited = 0; waited < 3000; waited += 50) {
    await sleep(50);
    const content = api.getContent();
    const first = content ? blocksOf(content)[0] : undefined;
    if (first && first !== previousFirst) return;
  }
}

interface Options {
  apiRef: React.MutableRefObject<ReaderEngineApi | null>;
  voice?: string;
  onError?: (message: string) => void;
}

export const READ_ALOUD_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const RATE_STORAGE = 'yoru_read_aloud_rate';
const VOICE_STORAGE = 'yoru_read_aloud_voice';

export function useReadAloud({ apiRef, voice, onError }: Options) {
  const [status, setStatus] = useState<ReadAloudStatus>('idle');
  const [rate, setRateState] = useState<number>(() => {
    try { return parseFloat(localStorage.getItem(RATE_STORAGE) || '') || 1; } catch { return 1; }
  });
  const [chosenVoice, setChosenVoice] = useState<string>(() => {
    try { return localStorage.getItem(VOICE_STORAGE) || ''; } catch { return ''; }
  });
  const [sleepEndsAt, setSleepEndsAt] = useState<number | null>(null);
  const [position, setPosition] = useState({ index: 0, total: 0 });

  const sentencesRef = useRef<Sentence[]>([]);
  const indexRef = useRef(0);
  const runRef = useRef(0);
  const handleRef = useRef<SpeechHandle | null>(null);
  const rateRef = useRef(rate);
  const sleepRef = useRef<number | null>(null);
  rateRef.current = rate;
  const voiceRef = useRef(chosenVoice || voice);
  voiceRef.current = chosenVoice || voice;
  sleepRef.current = sleepEndsAt;

  const stopSpeech = () => {
    handleRef.current?.stop();
    handleRef.current = null;
  };

  const run = useCallback(async (startIndex: number) => {
    const runId = ++runRef.current;
    let index = startIndex;
    setStatus('playing');
    for (;;) {
      if (runId !== runRef.current) return;
      const content = apiRef.current?.getContent();
      if (!content) break;

      let sentence = sentencesRef.current[index];
      if (!sentence) {
        // End of what is rendered: go on with the next section, or finish.
        const previousFirst = blocksOf(content)[0];
        if (!apiRef.current?.goToNextSection()) break;
        await waitForNewSection(apiRef.current!, previousFirst);
        if (runId !== runRef.current) return;
        sentencesRef.current = collectSentences(apiRef.current!.getContent()!);
        index = 0;
        sentence = sentencesRef.current[0];
        if (!sentence) continue;
      }

      indexRef.current = index;
      setPosition({ index, total: sentencesRef.current.length });
      const range = rangeFor(content, sentence);
      setHighlight(range);
      if (range) apiRef.current?.revealRange(range);

      const options = { rate: rateRef.current, voice: voiceRef.current };
      const upcoming = sentencesRef.current[index + 1];
      if (upcoming) prefetchSentence(upcoming.text, options);
      const handle = speakSentence(sentence.text, options);
      handleRef.current = handle;
      try {
        await handle.done;
      } catch (error: any) {
        if (runId !== runRef.current) return;
        const code = String(error?.message || error || '');
        onError?.(code);
        runRef.current++;
        setStatus('paused');
        return;
      }
      if (runId !== runRef.current) return;
      if (sleepRef.current && Date.now() >= sleepRef.current) {
        setSleepEndsAt(null);
        runRef.current++;
        setStatus('paused');
        indexRef.current = index + 1;
        return;
      }
      index++;
    }
    if (runId === runRef.current) {
      setHighlight(null);
      setStatus('idle');
    }
  }, [apiRef, onError]);

  const start = useCallback(() => {
    const content = apiRef.current?.getContent();
    if (!content) return;
    sentencesRef.current = collectSentences(content);
    void run(firstVisibleSentence(content, sentencesRef.current));
  }, [apiRef, run]);

  const pause = useCallback(() => {
    runRef.current++;
    stopSpeech();
    setStatus('paused');
  }, []);

  const resume = useCallback(() => {
    const content = apiRef.current?.getContent();
    if (!content) return;
    // The section may have been re-rendered (word marks, Jiten): sentences are found again by position.
    if (sentencesRef.current.length === 0) sentencesRef.current = collectSentences(content);
    void run(indexRef.current);
  }, [apiRef, run]);

  const skip = useCallback((delta: number) => {
    stopSpeech();
    const next = Math.max(0, indexRef.current + delta);
    void run(next);
  }, [run]);

  const stop = useCallback(() => {
    runRef.current++;
    stopSpeech();
    setHighlight(null);
    setSleepEndsAt(null);
    setStatus('idle');
  }, []);

  const setRate = useCallback((value: number) => {
    setRateState(value);
    rateRef.current = value;
    try { localStorage.setItem(RATE_STORAGE, String(value)); } catch { /* ignore */ }
    // Apply at once: restart the current sentence at the new speed.
    if (runRef.current && handleRef.current) {
      stopSpeech();
      void run(indexRef.current);
    }
  }, [run]);

  const setVoice = useCallback((value: string) => {
    setChosenVoice(value);
    voiceRef.current = value || voice;
    try { localStorage.setItem(VOICE_STORAGE, value); } catch { /* ignore */ }
    // Hear the new voice at once.
    if (handleRef.current) {
      stopSpeech();
      void run(indexRef.current);
    }
  }, [run, voice]);

  const setSleepMinutes = useCallback((minutes: number | null) => {
    setSleepEndsAt(minutes ? Date.now() + minutes * 60_000 : null);
  }, []);

  useEffect(() => () => {
    runRef.current++;
    handleRef.current?.stop();
    setHighlight(null);
  }, []);

  return { status, rate, voice: chosenVoice, position, sleepEndsAt, start, pause, resume, skip, stop, setRate, setVoice, setSleepMinutes };
}
