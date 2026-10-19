import React, { useEffect, useState } from 'react';
import { ExternalLink, Play } from 'lucide-react';
import ReaderSidePanel from './ReaderSidePanel';
import { READ_ALOUD_RATES } from './useReadAloud';
import { canOpenSystemTtsSettings, listJapaneseVoices, openSystemTtsSettings, speakSentence, type VoiceOption } from '../../utils/bookTts';

interface Props {
  voice: string;
  rate: number;
  sleepEndsAt: number | null;
  onVoice: (voice: string) => void;
  onRate: (rate: number) => void;
  onSleep: (minutes: number | null) => void;
  onClose: () => void;
  colors: { textMain: string; textMuted: string; border?: string; popoverBg?: string; accent: string };
  lang: string;
}

const SAMPLE = '今日はいい天気ですね。本を読みましょう。';

/** Read-aloud settings, ReadEra-style: voice list, speech rate and sleep timer. */
export default function ReadAloudSettings({ voice, rate, sleepEndsAt, onVoice, onRate, onSleep, onClose, colors, lang }: Props) {
  const es = lang === 'es';
  const [voices, setVoices] = useState<VoiceOption[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    listJapaneseVoices(lang).then(
      (list) => { if (alive) setVoices(list); },
      () => { if (alive) { setVoices([]); setError(true); } },
    );
    return () => { alive = false; };
  }, [lang]);

  const preview = (id: string) => {
    const handle = speakSentence(SAMPLE, { rate, voice: id || undefined });
    handle.done.catch(() => setError(true));
  };

  const sleepLeft = sleepEndsAt ? Math.max(1, Math.ceil((sleepEndsAt - Date.now()) / 60_000)) : null;
  // Which option is on: the chosen one, or the smallest that still covers the time left.
  const [sleepChoice, setSleepChoice] = useState<number | null>(() => (sleepLeft ? [15, 30, 60].find((m) => sleepLeft <= m) ?? 60 : null));
  const activeSleep = sleepEndsAt ? sleepChoice : null;
  const options: { id: string; label: string; detail: string }[] = [
    { id: '', label: es ? 'Predeterminada' : 'Default', detail: es ? 'La voz japonesa del sistema' : 'The system Japanese voice' },
    ...(voices || []),
  ];

  return (
    <ReaderSidePanel title={es ? 'Ajustes de voz' : 'Voice settings'} onClose={onClose} colors={colors} closeLabel={es ? 'Cerrar' : 'Close'}>
      <div className="tts-settings-section-title" style={{ color: colors.accent }}>{es ? 'Voz' : 'Voice'}</div>
      {voices === null && <p className="reader-side-panel-empty" style={{ color: colors.textMuted }}>{es ? 'Buscando voces…' : 'Looking for voices…'}</p>}
      {voices !== null && (
        <ul className="tts-voice-list" role="radiogroup" aria-label={es ? 'Voz' : 'Voice'}>
          {options.map((option) => (
            <li key={option.id || 'default'}>
              <button
                type="button"
                role="radio"
                aria-checked={voice === option.id}
                className="tts-voice-option"
                onClick={() => onVoice(option.id)}
                style={{ color: colors.textMain }}
              >
                <span className="tts-voice-text">
                  <span className="tts-voice-name">{option.label}</span>
                  <span className="tts-voice-detail" style={{ color: colors.textMuted }}>{option.detail}</span>
                </span>
                <span className={`tts-voice-radio${voice === option.id ? ' checked' : ''}`} style={{ borderColor: voice === option.id ? colors.accent : colors.textMuted, background: voice === option.id ? colors.accent : 'transparent' }} />
              </button>
              <button type="button" className="tts-voice-preview" onClick={() => preview(option.id)} aria-label={es ? `Escuchar ${option.label}` : `Listen to ${option.label}`} style={{ color: colors.textMuted }}>
                <Play size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {voices !== null && voices.length === 0 && (
        <p className="reader-side-panel-empty" style={{ color: colors.textMuted }}>
          {es ? 'No se encontraron voces japonesas instaladas.' : 'No Japanese voices installed.'}
        </p>
      )}
      {error && (
        <p className="reader-side-panel-empty" style={{ color: '#f87171' }}>
          {es ? 'No se pudo usar esa voz. Prueba otra o instala una voz japonesa.' : 'That voice could not be used. Try another or install a Japanese voice.'}
        </p>
      )}
      {canOpenSystemTtsSettings() && (
        <button type="button" className="tts-settings-link" onClick={() => void openSystemTtsSettings()} style={{ color: colors.textMuted }}>
          <span>{es ? 'Puedes descargar más voces en los ajustes de Texto a voz del dispositivo.' : 'You can download more voices in the device text-to-speech settings.'}</span>
          <ExternalLink size={18} />
        </button>
      )}

      <div className="tts-settings-section-title" style={{ color: colors.accent }}>{es ? 'Velocidad' : 'Speech rate'}</div>
      <div className="tts-chip-row">
        {READ_ALOUD_RATES.map((value) => (
          <button key={value} type="button" className={`read-aloud-chip${rate === value ? ' is-on' : ''}`} onClick={() => onRate(value)} style={{ '--read-aloud-accent': colors.accent } as React.CSSProperties}>
            {value}×
          </button>
        ))}
      </div>

      <div className="tts-settings-section-title" style={{ color: colors.accent }}>{es ? 'Temporizador' : 'Timer'}</div>
      <div className="tts-chip-row">
        {[null, 15, 30, 60].map((minutes) => {
          const on = activeSleep === minutes;
          return (
            <button key={String(minutes)} type="button" className={`read-aloud-chip${on ? ' is-on' : ''}`} onClick={() => { setSleepChoice(minutes); onSleep(minutes); }} style={{ '--read-aloud-accent': colors.accent } as React.CSSProperties}>
              {minutes === null ? (es ? 'Apagado' : 'Off') : `${minutes} min`}
            </button>
          );
        })}
      </div>
      {sleepLeft && (
        <p className="reader-side-panel-empty" style={{ color: colors.textMuted }}>
          {es ? `Se detendrá en ${sleepLeft} min.` : `Stops in ${sleepLeft} min.`}
        </p>
      )}
    </ReaderSidePanel>
  );
}
