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
}

export default function ReadAloudBar({
  status, rate, position, sleepEndsAt, lang, accent, onPlay, onPause, onSkip, onRate, onSleep, onSettings, onClose,
}: Props) {
  const es = lang === 'es';
  const [, setNow] = useState(Date.now());

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
    <div className="read-aloud-bar" role="toolbar" aria-label={es ? 'Lectura en voz alta' : 'Read aloud'} style={{ '--read-aloud-accent': accent } as React.CSSProperties}>
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
