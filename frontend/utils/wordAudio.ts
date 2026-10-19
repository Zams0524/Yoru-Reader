import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';

/**
 * Word pronunciation for the reader popup and SRS cards.
 *
 * 1. A native-speaker recording from JapanesePod101 (the source Yomitan uses), which has the
 *    word's real pitch accent. Only on Android, where CapacitorHttp fetches it without CORS.
 * 2. The Android system TTS engine (YoruTtsPlugin), given the written form so the engine
 *    picks the dictionary pitch accent instead of guessing from bare kana.
 * Returns null when neither is available so callers can keep their own fallbacks.
 */

interface YoruTtsPlugin {
  speak(options: { text: string; rate?: number; voice?: string }): Promise<void>;
  stop(): Promise<void>;
}

const YoruTts = registerPlugin<YoruTtsPlugin>('YoruTts');

// JapanesePod101 answers unknown words with this "audio not available" clip.
const JPOD_MISSING_CLIP_BYTES = 52288;
const recordingCache = new Map<string, string | null>();
const KANJI = /[㐀-鿿豈-﫿々]/;

export interface WordAudioPlayback {
  source: 'recording' | 'device-tts';
  ended: Promise<void>;
  stop: () => void;
}

function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

async function fetchRecording(term: string, reading: string): Promise<string | null> {
  const kana = reading || term;
  const key = `${term}\u0000${kana}`;
  if (recordingCache.has(key)) return recordingCache.get(key) ?? null;

  let dataUrl: string | null = null;
  try {
    const url = `https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?kanji=${encodeURIComponent(term)}&kana=${encodeURIComponent(kana)}`;
    const response = await CapacitorHttp.request({ url, method: 'GET', responseType: 'arraybuffer', connectTimeout: 6000, readTimeout: 8000 });
    const data = typeof response.data === 'string' ? response.data.replace(/\s/g, '') : '';
    const bytes = data ? base64ByteLength(data) : 0;
    if (response.status === 200 && bytes > 1000 && bytes !== JPOD_MISSING_CLIP_BYTES) {
      dataUrl = `data:audio/mpeg;base64,${data}`;
    }
  } catch (error) {
    console.warn('[WordAudio] Recording lookup failed:', error);
    return null; // Do not cache network errors.
  }
  recordingCache.set(key, dataUrl);
  return dataUrl;
}

function playRecording(dataUrl: string, rate: number): WordAudioPlayback {
  const audio = new Audio(dataUrl);
  audio.playbackRate = Math.min(2, Math.max(0.5, rate));
  const ended = new Promise<void>((resolve) => {
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    audio.onpause = () => resolve();
  });
  void audio.play().catch(() => undefined);
  return { source: 'recording', ended, stop: () => audio.pause() };
}

export async function playWordAudio(term: string, reading = '', rate = 1): Promise<WordAudioPlayback | null> {
  const word = (term || reading || '').trim();
  if (!word || !Capacitor.isNativePlatform()) return null;

  const recording = await fetchRecording(word, reading.trim());
  if (recording) return playRecording(recording, rate);

  // Kanji spelling lets the engine look the word up (and its accent); kana-only words stay kana.
  const text = KANJI.test(word) ? word : (reading.trim() || word);
  try {
    const ended = YoruTts.speak({ text, rate });
    // An immediate rejection (no Japanese voice installed) lets the caller try its own fallback.
    await Promise.race([ended, new Promise((resolve) => setTimeout(resolve, 250))]);
    return { source: 'device-tts', ended: ended.catch(() => undefined), stop: () => { void YoruTts.stop(); } };
  } catch (error) {
    console.warn('[WordAudio] Device TTS failed:', error);
    return null;
  }
}

export function stopWordAudio(): void {
  if (Capacitor.isNativePlatform()) void YoruTts.stop().catch(() => undefined);
}
