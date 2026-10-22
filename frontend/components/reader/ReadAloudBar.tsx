import React, { useEffect, useState } from 'react';
import { Moon, Pause, Play, Settings, SkipBack, SkipForward, X } from 'lucide-react';
import { READ_ALOUD_RATES, type ReadAloudStatus } from './useReadAloud';

interface Props {
  status: ReadAloudStatus;
  rate: number;
  position: { index: number; total: number };
  sleepEndsAt: number | null;
  lang: string;
  accent: string;
  onPlay: () => void;
  onPause: () => void;
  onSkip: (delta: number) => void;
  onRate: (rate: number) => void;
  onSleep: (minutes: number | null) => void;
  onSettings?: () => void;
  onClose: () => void;
  /** Sits higher while the page bar is shown at the bottom. */
  raised?: boolean;
  /**
   * Slides away after AUTO_HIDE_MS without a touch on it (while reading, with the reader's bars
   * hidden); tapping the page brings the bars back, and the player with them.
   */
  autoHide?: boolean;
}

const AUTO_HIDE_MS = 4000;

export default function ReadAloudBar({
  status, rate, position, sleepEndsAt, lang, accent, onPlay, onPause, onSkip, onRate, onSleep, onSettings, onClose, raised = false, autoHide = false,
}: Props) {
  const es = lang === 'es';
  const [, setNow] = useState(Date.now());
  const [hidden, setHidden] = useState(false);
  // Bumped by every touch on the bar: the hide countdown starts again.
  const [touched, setTouched] = useState(0);

  useEffect(() => {
    setHidden(false);
    if (!autoHide) return;
    const timer = window.setTimeout(() => setHidden(true), AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [autoHide, touched]);

  // Refresh the sleep countdown once a minute.
  useEffect(() => {
    if (!sleepEndsAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [sleepEndsAt]);

  const nextRate = () => {
    const index = READ_ALOUD_RATES.indexOf(rate);
    onRate(READ_ALOUD_RATES[(index + 1) % READ_ALOUD_RATES.length] ?? 1);
  };

  const sleepMinutesLeft = sleepEndsAt ? Math.max(1, Math.ceil((sleepEndsAt - Date.now()) / 60_000)) : null;
  // Off → 15 → 30 → 60 min → off.
  const nextSleep = () => {
    if (!sleepMinutesLeft) onSleep(15);
    else if (sleepMinutesLeft <= 15) onSleep(30);
    else if (sleepMinutesLeft <= 30) onSleep(60);
    else onSleep(null);
  };

  const playing = status === 'playing';

  return (
    <div
      className={`read-aloud-bar${raised ? " is-raised" : ""}${hidden ? " is-hidden" : ""}`}
      onPointerDown={() => setTouched((n) => n + 1)}
      aria-hidden={hidden || undefined}
      role="toolbar" aria-label={es ? 'Lectura en voz alta' : 'Read aloud'} style={{ '--read-aloud-accent': accent } as React.CSSProperties}>
      <button type="button" className="read-aloud-btn" onClick={() => onSkip(-1)} aria-label={es ? 'Frase anterior' : 'Previous sentence'}>
        <SkipBack size={18} />
      </button>
      <button
        type="button"
        className="read-aloud-btn read-aloud-play"
        onClick={playing ? onPause : onPlay}
        aria-label={playing ? (es ? 'Pausar' : 'Pause') : (es ? 'Leer' : 'Play')}
      >
        {playing ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <button type="button" className="read-aloud-btn" onClick={() => onSkip(1)} aria-label={es ? 'Frase siguiente' : 'Next sentence'}>
        <SkipForward size={18} />
      </button>
      <button type="button" className="read-aloud-chip" onClick={nextRate} aria-label={es ? 'Velocidad' : 'Speed'}>
        {rate}×
      </button>
      <button
        type="button"
        className={`read-aloud-chip${sleepEndsAt ? ' is-on' : ''}`}
        onClick={nextSleep}
        aria-label={es ? 'Temporizador de apagado' : 'Sleep timer'}
      >
        <Moon size={14} />
        {sleepMinutesLeft ? `${sleepMinutesLeft}′` : (es ? 'No' : 'Off')}
      </button>
      {position.total > 0 && (
        <span className="read-aloud-progress" aria-hidden="true">{position.index + 1}/{position.total}</span>
      )}
      {onSettings && (
        <button type="button" className="read-aloud-btn" onClick={onSettings} aria-label={es ? 'Ajustes de voz' : 'Voice settings'}>
          <Settings size={17} />
        </button>
      )}
      <button type="button" className="read-aloud-btn" onClick={onClose} aria-label={es ? 'Cerrar lectura en voz alta' : 'Close read aloud'}>
        <X size={18} />
      </button>
    </div>
  );
}
