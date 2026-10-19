import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Sentence-by-sentence speech for reading a book aloud.
 * Android: the system TTS engine (YoruTtsPlugin). Desktop: Edge neural voices through Electron.
 * Browser: Web Speech. Every call returns a handle whose `done` settles when the sentence ends.
 */

interface YoruTtsPlugin {
  speak(options: { text: string; rate?: number }): Promise<void>;
  stop(): Promise<void>;
}

const YoruTts = registerPlugin<YoruTtsPlugin>('YoruTts');

export interface SpeechHandle {
  done: Promise<void>;
  stop: () => void;
}

export interface SpeechOptions {
  rate: number;
  voice?: string; // 'Nanami' | 'Mayu' | 'Keita'
}

const AZURE_VOICES: Record<string, string> = {
  Nanami: 'ja-JP-NanamiNeural',
  Mayu: 'ja-JP-MayuNeural',
  Keita: 'ja-JP-KeitaNeural',
};

// Desktop audio is synthesised ahead so sentences follow each other without a gap.
const audioCache = new Map<string, Promise<ArrayBuffer | null>>();
const AUDIO_CACHE_LIMIT = 6;

function electronSpeak() {
  const api = (window as any).electronAPI;
  return api && typeof api.speakText === 'function' ? api.speakText : null;
}

function cacheKey(text: string, options: SpeechOptions) {
  return `${options.voice || 'Nanami'}|${options.rate}|${text}`;
}

/** Starts synthesising a sentence that will be spoken soon (desktop only; elsewhere a no-op). */
export function prefetchSentence(text: string, options: SpeechOptions) {
  const speakText = electronSpeak();
  if (!speakText || Capacitor.isNativePlatform() || !text.trim()) return;
  const key = cacheKey(text, options);
  if (audioCache.has(key)) return;
  audioCache.set(key, Promise.resolve(speakText({
    text,
    voice: AZURE_VOICES[options.voice || 'Nanami'] || AZURE_VOICES.Nanami,
    rate: options.rate,
  })).catch(() => null));
  while (audioCache.size > AUDIO_CACHE_LIMIT) {
    const oldest = audioCache.keys().next().value;
    if (oldest === undefined) break;
    audioCache.delete(oldest);
  }
}

let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;
function japaneseVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!voicesPromise) {
    voicesPromise = new Promise((resolve) => {
      const pick = () => window.speechSynthesis.getVoices().filter((voice) => voice.lang.startsWith('ja'));
      const now = pick();
      if (now.length) return resolve(now);
      window.speechSynthesis.addEventListener('voiceschanged', () => resolve(pick()), { once: true });
      setTimeout(() => resolve(pick()), 1500);
    });
  }
  return voicesPromise;
}

export function speakSentence(text: string, options: SpeechOptions): SpeechHandle {
  // Android: system engine (the WebView has no Web Speech voices).
  if (Capacitor.isNativePlatform()) {
    return {
      done: YoruTts.speak({ text, rate: options.rate }),
      stop: () => { void YoruTts.stop().catch(() => undefined); },
    };
  }

  // Desktop: Edge neural voice through the main process.
  if (electronSpeak()) {
    let audio: HTMLAudioElement | null = null;
    let stopped = false;
    const done = (async () => {
      prefetchSentence(text, options);
      const buffer = await audioCache.get(cacheKey(text, options));
      audioCache.delete(cacheKey(text, options));
      if (stopped) return;
      if (!buffer) throw new Error('TTS_ERROR');
      const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/mp3' }));
      audio = new Audio(url);
      await new Promise<void>((resolve, reject) => {
        audio!.onended = () => resolve();
        audio!.onpause = () => resolve();
        audio!.onerror = () => reject(new Error('TTS_ERROR'));
        audio!.play().catch(reject);
      }).finally(() => URL.revokeObjectURL(url));
    })();
    return { done, stop: () => { stopped = true; audio?.pause(); } };
  }

  // Browser: Web Speech.
  if ('speechSynthesis' in window) {
    let finished: () => void = () => undefined;
    const done = new Promise<void>((resolve, reject) => {
      finished = resolve;
      japaneseVoices().then((voices) => {
        if (!voices.length) return reject(new Error('JAPANESE_VOICE_MISSING'));
        const hint = (options.voice || '').toLowerCase();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ja-JP';
        utterance.rate = options.rate;
        utterance.voice = voices.find((voice) => voice.name.toLowerCase().includes(hint)) || voices[0];
        utterance.onend = () => resolve();
        utterance.onerror = (event) => (event.error === 'interrupted' || event.error === 'canceled' ? resolve() : reject(new Error(event.error)));
        window.speechSynthesis.speak(utterance);
      }).catch(reject);
    });
    return { done, stop: () => { window.speechSynthesis.cancel(); finished(); } };
  }

  return { done: Promise.reject(new Error('TTS_UNAVAILABLE')), stop: () => undefined };
}
