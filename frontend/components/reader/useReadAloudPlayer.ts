import { useEffect, useRef } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import type { ReadAloudPosition, ReadAloudStatus } from './useReadAloud';
import {
  YoruNotifications,
  ensureNotificationPermission,
  hasYoruNotifications,
  notificationSettings,
  playerArtwork,
  type ReadAloudControl,
} from '../../utils/yoruNotifications';

/**
 * Android: mirrors read-aloud in the system player (notification, lock screen, headset buttons)
 * through YoruNotificationsPlugin, so the voice goes on with Yoru in the background, and turns the
 * player's buttons back into read-aloud actions. Says how far the voice went on coming back.
 */

interface ReadAloudControls {
  status: ReadAloudStatus;
  rate: number;
  position: ReadAloudPosition;
  sleepEndsAt: number | null;
  start: () => void;
  pause: () => void;
  resume: () => void;
  skip: (delta: number) => void;
  seekToChars: (chars: number) => void;
  setSleepMinutes: (minutes: number | null) => void;
}

interface Options {
  readAloud: ReadAloudControls;
  /** The read-aloud bar is open in the reader. */
  open: boolean;
  book: { id: string; title?: string; cover?: string };
  chapter: string;
  settings: any;
  lang: string;
  /** Shown instead of the sleep timer while read-aloud is stopped by an error. */
  error: string;
  onClose: () => void;
  onReturn: (message: string) => void;
}

// A rough speed of Japanese speech at 1×, to give the player's bar times (it shows minutes, not sentences).
const CHARS_PER_SECOND = 7;
const SLEEP_STEPS: (number | null)[] = [15, 30, 60, null];

export function useReadAloudPlayer({ readAloud, open, book, chapter, settings, lang, error, onClose, onReturn }: Options) {
  const enabled = hasYoruNotifications() && notificationSettings(settings).readAloudBackground;
  const showSentence = notificationSettings(settings).readAloudSentence;
  const active = enabled && open && readAloud.status !== 'idle';
  const es = lang === 'es';

  const shownRef = useRef(false);
  const artworkSentRef = useRef<string | null>(null);
  const askedRef = useRef(false);
  const sleepStepRef = useRef(-1);

  // The latest controls for the listener, which is added once.
  const controlsRef = useRef({ readAloud, onClose });
  controlsRef.current = { readAloud, onClose };

  useEffect(() => {
    if (!active) {
      if (shownRef.current) {
        shownRef.current = false;
        artworkSentRef.current = null;
        void YoruNotifications.stopReadAloud().catch(() => {});
      }
      return;
    }
    if (!askedRef.current) {
      askedRef.current = true;
      void ensureNotificationPermission();
    }
    let cancelled = false;
    const { position, rate, sleepEndsAt, status } = readAloud;
    const minutesLeft = sleepEndsAt ? Math.max(1, Math.ceil((sleepEndsAt - Date.now()) / 60_000)) : 0;
    const note = error
      || (minutesLeft ? (es ? `Se apaga en ${minutesLeft} min` : `Stops in ${minutesLeft} min`) : '');
    const state = {
      bookTitle: book.title || '',
      // The heading just read names the chapter better than the reader's "Chapter 9" for untitled ones.
      chapter: position.heading || chapter,
      sentence: position.text,
      showSentence,
      playing: status === 'playing',
      positionMs: Math.round((position.charsBefore / CHARS_PER_SECOND) * 1000),
      durationMs: Math.round((position.charsTotal / CHARS_PER_SECOND) * 1000),
      rate,
      note,
      lang,
    };
    const send = (artwork?: string) => {
      if (cancelled) return;
      shownRef.current = true;
      void YoruNotifications.updateReadAloud(artwork ? { ...state, artwork } : state).catch(() => {});
    };
    if (artworkSentRef.current === book.id) {
      send();
    } else {
      artworkSentRef.current = book.id;
      void playerArtwork(book.id, book.cover).then(send);
    }
    return () => { cancelled = true; };
  }, [active, readAloud.status, readAloud.position, readAloud.rate, readAloud.sleepEndsAt, book.id, book.title, book.cover, chapter, showSentence, error, lang, es]);

  // Leaving the reader removes the player.
  useEffect(() => () => {
    if (shownRef.current) void YoruNotifications.stopReadAloud().catch(() => {});
  }, []);

  // The player's buttons, the lock screen and the headset.
  useEffect(() => {
    if (!enabled) return;
    let handle: PluginListenerHandle | null = null;
    let removed = false;
    void YoruNotifications.addListener('readAloudAction', ({ action, positionMs }) => {
      const { readAloud: controls, onClose: close } = controlsRef.current;
      switch (action as ReadAloudControl) {
        case 'play':
          if (controls.status === 'idle') controls.start();
          else if (controls.status === 'paused') controls.resume();
          break;
        case 'pause':
          if (controls.status === 'playing') controls.pause();
          break;
        case 'next':
          controls.skip(1);
          break;
        case 'previous':
          controls.skip(-1);
          break;
        case 'seek':
          controls.seekToChars((positionMs / 1000) * CHARS_PER_SECOND);
          break;
        case 'sleep': {
          // 15 → 30 → 60 min → off, starting over when the timer ran out on its own.
          if (!controls.sleepEndsAt) sleepStepRef.current = -1;
          sleepStepRef.current = (sleepStepRef.current + 1) % SLEEP_STEPS.length;
          controls.setSleepMinutes(SLEEP_STEPS[sleepStepRef.current]);
          break;
        }
        case 'close':
          close();
          break;
        default:
          break;
      }
    }).then((h) => {
      if (removed) h.remove();
      else handle = h;
    });
    return () => {
      removed = true;
      handle?.remove();
    };
  }, [enabled]);

  // Coming back to Yoru: say how far the voice went while it was away.
  const awayRef = useRef<{ heard: number; lastText: string } | null>(null);
  useEffect(() => {
    const away = awayRef.current;
    if (away && readAloud.position.text && readAloud.position.text !== away.lastText) {
      away.heard++;
      away.lastText = readAloud.position.text;
    }
  }, [readAloud.position]);
  const returnRef = useRef({ active, onReturn, text: readAloud.position.text, es });
  returnRef.current = { active, onReturn, text: readAloud.position.text, es };
  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => {
      const current = returnRef.current;
      if (document.visibilityState === 'hidden') {
        awayRef.current = current.active ? { heard: 0, lastText: current.text } : null;
        return;
      }
      const away = awayRef.current;
      awayRef.current = null;
      if (!away || !current.active || away.heard < 2) return;
      current.onReturn(current.es
        ? `Seguiste escuchando ${away.heard} oraciones. Te dejé donde va la voz.`
        : `You kept listening for ${away.heard} sentences. You're where the voice is.`);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [enabled]);
}
