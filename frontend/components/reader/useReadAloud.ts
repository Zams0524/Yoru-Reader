import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { ReaderEngineApi } from './ReaderEngine';
import { YoruTts, prefetchSentence, speakSentence, type QueuedSentence, type SpeechHandle } from '../../utils/bookTts';
import { READER_BLOCK_SELECTOR, blockText, rangeForOffsets, setNamedHighlight } from '../../utils/readerText';

/**
 * Reads the open book aloud sentence by sentence, like ReadEra: highlights the sentence being
 * read (CSS Custom Highlight API, so the page DOM is untouched), turns pages and sections on its
 * own, and supports previous/next sentence, speed and a sleep timer.
 *
 * Android: the sentences are handed to the system engine as a queue (YoruTts.speakQueue) instead
 * of asking for one at a time, because Chromium throttles the page's own timers once the screen is
 * off or Yoru is in the background — a loop that waited for each sentence to finish fell silent
 * there. The engine works through the queue on its own and reports each sentence as it starts
 * (queueSentence), so the highlight, the page and the notification follow even while the page is
 * not actively running. Desktop and the browser keep the original one-at-a-time loop.
 */

export type ReadAloudStatus = 'idle' | 'playing' | 'paused';

interface Sentence {
  ordinal: number; // position among the reader's text blocks, to find it again after a re-render
  start: number;
  end: number;
  text: string;
}

const HIGHLIGHT_NAME = 'yoru-read-aloud';
const SPEAKABLE = /[぀-ヿ㐀-鿿豈-﫿A-Za-z0-9０-９Ａ-Ｚａ-ｚ]/;
// A sentence ends at 。！？!? (plus closing quotes/brackets) or at the end of the paragraph.
const SENTENCE = /[^。！？!?…]*(?:[。！？!?]+|…+|$)[」』）)】〉》"’]*/g;

// A rough speed of Japanese speech at 1×, so the system player's progress bar (which counts
// milliseconds, not sentences) has times to show.
export const READ_ALOUD_CHARS_PER_SECOND = 7;

const isAndroidNativeTts = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

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
// Looks before each wait: in the background (screen off) timers can be slowed to one a minute,
// and the native reader has the next section ready at once.
async function waitForNewSection(api: ReaderEngineApi, previousFirst: Element | undefined) {
  for (let waited = 0; waited < 3000; waited += 50) {
    const content = api.getContent();
    const first = content ? blocksOf(content)[0] : undefined;
    if (first && first !== previousFirst) return;
    await sleep(50);
  }
}

interface Options {
  apiRef: React.MutableRefObject<ReaderEngineApi | null>;
  voice?: string;
  onError?: (message: string) => void;
}

/** Where the voice is in the section being read: for the player in the notification. */
export interface ReadAloudPosition {
  index: number;
  total: number;
  /** The sentence being read. */
  text: string;
  /** Characters of the section before this sentence, and in all of it (to estimate times). */
  charsBefore: number;
  charsTotal: number;
  /** The last chapter heading read in this section ('' until one is read). */
  heading: string;
}

const EMPTY_POSITION: ReadAloudPosition = { index: 0, total: 0, text: '', charsBefore: 0, charsTotal: 0, heading: '' };

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
  const [position, setPosition] = useState<ReadAloudPosition>(EMPTY_POSITION);

  const sentencesRef = useRef<Sentence[]>([]);
  // Characters before each sentence of sentencesRef (and the total at the end).
  const charsBeforeRef = useRef<number[]>([0]);
  const headingRef = useRef('');
  const setSentences = (list: Sentence[]) => {
    sentencesRef.current = list;
    headingRef.current = '';
    const before = [0];
    for (const sentence of list) before.push(before[before.length - 1] + sentence.text.length);
    charsBeforeRef.current = before;
  };
  const indexRef = useRef(0);
  const runRef = useRef(0);
  const handleRef = useRef<SpeechHandle | null>(null);
  const rateRef = useRef(rate);
  const sleepRef = useRef<number | null>(null);
  rateRef.current = rate;
  const voiceRef = useRef(chosenVoice || voice);
  voiceRef.current = chosenVoice || voice;
  sleepRef.current = sleepEndsAt;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  // True only while a run is actually speaking (not paused, not idle): setRate/setVoice use it to
  // decide whether to restart the current sentence at once.
  const playingRef = useRef(false);
  useEffect(() => { playingRef.current = status === 'playing'; }, [status]);

  /** Shows `sentence` as the one being read: highlight, page-follow and the notification's position. */
  const revealSentence = (content: HTMLElement, sentence: Sentence, index: number) => {
    indexRef.current = index;
    const charsBefore = charsBeforeRef.current;
    const block = blocksOf(content)[sentence.ordinal];
    if (block && /^H[1-3]$/.test(block.tagName)) headingRef.current = blockText(block).trim();
    setPosition({
      heading: headingRef.current,
      index,
      total: sentencesRef.current.length,
      text: sentence.text,
      charsBefore: charsBefore[index] ?? 0,
      charsTotal: charsBefore[charsBefore.length - 1] ?? 0,
    });
    const range = rangeFor(content, sentence);
    setHighlight(range);
    if (range) apiRef.current?.revealRange(range);
  };

  const stopSpeech = () => {
    const handle = handleRef.current;
    handleRef.current = null;
    if (isAndroidNativeTts()) return YoruTts.stop().catch(() => undefined);
    return Promise.resolve(handle?.stop());
  };

  // ---- Android: hands a whole batch of sentences to the system engine's queue. ----
  // Holds, for the feed currently playing, which absolute sentence index each queue item (0, 1, 2…
  // within that one speakQueue call) stands for. A fresh feed replaces it, so a late event from a
  // feed that was stopped (its runId no longer matches runRef) is ignored.
  const androidFeedRef = useRef<{ runId: number; indices: number[] }>({ runId: 0, indices: [] });
  const runAndroidQueueRef = useRef<(runId: number, startIndex: number) => Promise<void>>(async () => {});
  runAndroidQueueRef.current = async (runId: number, startIndex: number) => {
    let index = startIndex;
    setStatus('playing');
    let content = apiRef.current?.getContent();
    if (!content) {
      if (runId === runRef.current) { setHighlight(null); setStatus('idle'); }
      return;
    }
    let sentence = sentencesRef.current[index];
    if (!sentence) {
      // End of what is rendered: go on with the next section, or finish.
      const previousFirst = blocksOf(content)[0];
      if (!apiRef.current?.goToNextSection()) {
        if (runId === runRef.current) { setHighlight(null); setStatus('idle'); }
        return;
      }
      await waitForNewSection(apiRef.current!, previousFirst);
      if (runId !== runRef.current) return;
      content = apiRef.current!.getContent()!;
      setSentences(collectSentences(content));
      index = 0;
      sentence = sentencesRef.current[0];
      if (!sentence) {
        if (runId === runRef.current) { setHighlight(null); setStatus('idle'); }
        return;
      }
    }
    if (runId !== runRef.current) return;

    const charsBefore = charsBeforeRef.current;
    const total = charsBefore[charsBefore.length - 1] ?? 0;
    const items: QueuedSentence[] = [];
    const indices: number[] = [];
    for (let i = index; i < sentencesRef.current.length; i++) {
      items.push({
        id: i - index,
        text: sentencesRef.current[i].text,
        positionMs: Math.round(((charsBefore[i] ?? 0) / READ_ALOUD_CHARS_PER_SECOND) * 1000),
        durationMs: Math.round((total / READ_ALOUD_CHARS_PER_SECOND) * 1000),
      });
      indices.push(i);
    }
    androidFeedRef.current = { runId, indices };
    // Shown at once, instead of waiting for the engine's onStart for the first sentence.
    revealSentence(content, sentence, index);
    try {
      await YoruTts.speakQueue({ items, replace: true, rate: rateRef.current, voice: voiceRef.current });
    } catch (error: any) {
      if (runId !== runRef.current) return;
      onErrorRef.current?.(String(error?.message || error || 'TTS_ERROR'));
      runRef.current++;
      setStatus('paused');
    }
  };

  useEffect(() => {
    if (!isAndroidNativeTts()) return;
    let removed = false;
    const handles: Promise<{ remove: () => void }>[] = [
      YoruTts.addListener('queueSentence', ({ id }) => {
        const feed = androidFeedRef.current;
        if (feed.runId !== runRef.current) return;
        const absolute = feed.indices[id];
        const content = apiRef.current?.getContent();
        const sentence = absolute === undefined ? undefined : sentencesRef.current[absolute];
        if (!content || !sentence) return;
        revealSentence(content, sentence, absolute);
      }),
      YoruTts.addListener('queueDone', () => {
        const feed = androidFeedRef.current;
        if (feed.runId !== runRef.current) return;
        const last = feed.indices[feed.indices.length - 1];
        void runAndroidQueueRef.current(feed.runId, last === undefined ? 0 : last + 1);
      }),
      YoruTts.addListener('queueError', () => {
        const feed = androidFeedRef.current;
        if (feed.runId !== runRef.current) return;
        onErrorRef.current?.('TTS_ERROR');
        runRef.current++;
        setStatus('paused');
      }),
      YoruTts.addListener('queueSleep', ({ id }) => {
        const feed = androidFeedRef.current;
        if (feed.runId !== runRef.current) return;
        const absolute = feed.indices[id];
        setSleepEndsAt(null);
        runRef.current++;
        setStatus('paused');
        if (absolute !== undefined) indexRef.current = absolute + 1;
      }),
    ];
    return () => {
      removed = true;
      void Promise.all(handles).then((list) => { if (removed) list.forEach((h) => h.remove()); });
    };
    // Refers only to refs and stable setState functions: safe to register once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keeps the native sleep timer in step with the one set from the UI.
  useEffect(() => {
    if (isAndroidNativeTts()) void YoruTts.setSleep({ at: sleepEndsAt ?? 0 }).catch(() => {});
  }, [sleepEndsAt]);

  const run = useCallback(async (startIndex: number) => {
    const runId = ++runRef.current;
    if (isAndroidNativeTts()) {
      await runAndroidQueueRef.current(runId, startIndex);
      return;
    }
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
        setSentences(collectSentences(apiRef.current!.getContent()!));
        index = 0;
        sentence = sentencesRef.current[0];
        if (!sentence) continue;
      }

      revealSentence(content, sentence, index);

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
        onErrorRef.current?.(code);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiRef]);

  const start = useCallback(() => {
    const content = apiRef.current?.getContent();
    if (!content) return;
    setSentences(collectSentences(content));
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
    if (sentencesRef.current.length === 0) setSentences(collectSentences(content));
    void run(indexRef.current);
  }, [apiRef, run]);

  // Speaks again from `index` once the engine has really stopped. Starting at once let the native stop
  // land after the new sentence began, which ended it as "done" and skipped it (QA-20261023-07).
  const restartAt = useCallback(async (index: number) => {
    const restartId = ++runRef.current;
    await stopSpeech();
    if (restartId === runRef.current) void run(index);
  }, [run]);

  const skip = useCallback((delta: number) => {
    // Set at once, not just once playback catches up: two quick taps (e.g. "previous" twice from
    // the notification) must go back two sentences, not race each other to the same one.
    const target = Math.max(0, indexRef.current + delta);
    indexRef.current = target;
    void restartAt(target);
  }, [restartAt]);

  /** Goes to the sentence that starts closest after `chars` characters into the section (the player's bar). */
  const seekToChars = useCallback((chars: number) => {
    const before = charsBeforeRef.current;
    let index = 0;
    while (index + 1 < sentencesRef.current.length && before[index + 1] <= chars) index++;
    void restartAt(index);
  }, [restartAt]);

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
    if (playingRef.current) void restartAt(indexRef.current);
  }, [restartAt]);

  const setVoice = useCallback((value: string) => {
    setChosenVoice(value);
    voiceRef.current = value || voice;
    try { localStorage.setItem(VOICE_STORAGE, value); } catch { /* ignore */ }
    // Hear the new voice at once.
    if (playingRef.current) void restartAt(indexRef.current);
  }, [restartAt, voice]);

  const setSleepMinutes = useCallback((minutes: number | null) => {
    setSleepEndsAt(minutes ? Date.now() + minutes * 60_000 : null);
  }, []);

  useEffect(() => () => {
    runRef.current++;
    handleRef.current?.stop();
    if (isAndroidNativeTts()) void YoruTts.stop().catch(() => {});
    setHighlight(null);
  }, []);

  return { status, rate, voice: chosenVoice, position, sleepEndsAt, start, pause, resume, skip, seekToChars, stop, setRate, setVoice, setSleepMinutes };
}
