import React, { useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { dismissPackProgress, getPackProgress, subscribePackProgress, type PackProgress } from '../utils/dictionaryPackProgress';

/** Small bar at the bottom while the recommended dictionaries install in the background. */
export default function DictionaryInstallToast({ lang }: { lang: string }) {
  const [progress, setProgress] = useState<PackProgress>(getPackProgress);
  const es = lang === 'es';

  useEffect(() => subscribePackProgress(setProgress), []);

  useEffect(() => {
    if (!progress.done) return;
    const timer = window.setTimeout(dismissPackProgress, 2500);
    return () => window.clearTimeout(timer);
  }, [progress.done]);

  if (!progress.running && !progress.done && !progress.error) return null;

  return (
    <div className="dict-install-toast" role="status" aria-live="polite">
      <div className="dict-install-toast-row">
        {progress.running && <Loader2 size={14} className="guide-spin" />}
        {progress.done && <Check size={14} />}
        <span className="dict-install-toast-text">
          {progress.error
            ? (es ? `No se pudo instalar: ${progress.error}` : `Could not install: ${progress.error}`)
            : progress.done
              ? (es ? 'Diccionarios listos' : 'Dictionaries ready')
              : (es ? `Instalando ${progress.label} · ${progress.step} de ${progress.total}` : `Installing ${progress.label} · ${progress.step} of ${progress.total}`)}
        </span>
        {progress.running
          ? <span className="dict-install-toast-pct">{progress.percent}%</span>
          : (
            <button type="button" onClick={dismissPackProgress} aria-label={es ? 'Cerrar' : 'Close'}>
              <X size={14} />
            </button>
          )}
      </div>
      {progress.running && (
        <div className="dict-install-toast-track"><div style={{ width: `${progress.percent}%` }} /></div>
      )}
    </div>
  );
}
