import React, { useEffect, useRef, useState } from 'react';
import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import packageJson from '../../package.json';
import { CHANGELOG } from '../utils/changelog';

const AndroidDiagnostics = registerPlugin<{
  getLastCrashReport(): Promise<{ report: string }>;
  clearLastCrashReport(): Promise<void>;
}>('AndroidDiagnostics');

const RUNTIME_REPORT_KEY = 'yoru_last_runtime_issue';

function AndroidCrashDiagnostics({ lang }: { lang: string }) {
  const [report, setReport] = useState('');
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const reportRef = useRef<HTMLTextAreaElement>(null);
  const spanish = lang === 'es';

  useEffect(() => {
    let current = true;
    setLoading(true);
    setMessage('');
    setLoadError('');
    Promise.allSettled([
      AndroidDiagnostics.getLastCrashReport(),
      Promise.resolve().then(() => localStorage.getItem(RUNTIME_REPORT_KEY) || ''),
    ]).then(([native, runtime]) => {
      if (!current) return;
      const nativeReport = native.status === 'fulfilled' ? native.value.report : '';
      const runtimeReport = runtime.status === 'fulfilled' ? runtime.value : '';
      setReport([
        nativeReport && `${spanish ? 'Cierre de Android' : 'Android crash'}\n${nativeReport}`,
        runtimeReport && `${spanish ? 'Error de la interfaz' : 'Interface error'}\n${runtimeReport}`,
      ].filter(Boolean).join('\n\n'));
      const errors = [native, runtime]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map(result => result.reason?.message || String(result.reason));
      if (errors.length) {
        setLoadError(`${spanish ? 'No se pudieron leer todos los informes' : 'Some reports could not be read'}: ${errors.join('; ')}`);
      }
      setLoading(false);
    });
    return () => { current = false; };
  }, [refresh, spanish]);

  const copyReport = async () => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(report);
      copied = true;
    } catch {
      try {
        reportRef.current?.focus();
        reportRef.current?.select();
        copied = document.execCommand('copy');
      } catch {
        // Keep the visible text selected so the user can copy it manually.
      }
    }
    setMessage(copied
      ? (spanish ? 'Informe copiado.' : 'Report copied.')
      : (spanish ? 'No se pudo copiar automáticamente. Mantén pulsado el informe y selecciona Copiar.' : 'Automatic copy failed. Press and hold the report, then select Copy.'));
  };

  const clearReport = async () => {
    setClearing(true);
    setMessage('');
    try {
      await AndroidDiagnostics.clearLastCrashReport();
      localStorage.removeItem(RUNTIME_REPORT_KEY);
      setReport('');
      setLoadError('');
      setMessage(spanish ? 'Informe borrado.' : 'Report cleared.');
    } catch (error) {
      setMessage(`${spanish ? 'No se pudo borrar el informe' : 'Could not clear the report'}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setClearing(false);
    }
  };

  const buttonStyle: React.CSSProperties = {
    minHeight: 44, padding: '10px 14px', borderRadius: 10,
    border: '1px solid var(--border-light)', background: 'var(--bg-card)',
    color: 'var(--text-main)', fontWeight: 600, cursor: 'pointer',
  };

  return (
    <section aria-labelledby="android-diagnostics-title" aria-busy={loading || clearing} style={{ minWidth: 0 }}>
      <h4 id="android-diagnostics-title" style={{ margin: '0 0 8px', color: 'var(--primary)' }}>
        {spanish ? 'Diagnóstico de cierres' : 'Crash diagnostics'}
      </h4>
      <p style={{ color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 16px' }}>
        {spanish
          ? 'Aquí puedes consultar los errores que la app ha podido guardar. Después de un cierre, vuelve a abrirla y copia el informe para compartirlo.'
          : 'View errors the app was able to save. After a crash, reopen the app and copy the report to share it.'}
      </p>
      {loading ? (
        <p role="status">{spanish ? 'Buscando informe…' : 'Loading report…'}</p>
      ) : report ? (
        <textarea
          ref={reportRef}
          readOnly
          value={report}
          aria-label={spanish ? 'Informe técnico' : 'Technical report'}
          rows={9}
          spellCheck={false}
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', background: 'var(--bg-app)', border: '1px solid var(--border-light)', borderRadius: 10, color: 'var(--text-main)', padding: 12, fontSize: 12, lineHeight: 1.5 }}
        />
      ) : !loadError && (
        <p style={{ color: 'var(--text-muted)' }}>{spanish ? 'No hay informes guardados.' : 'No saved reports.'}</p>
      )}
      {loadError && <p role="alert" style={{ color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{loadError}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <button type="button" disabled={loading || clearing} onClick={() => setRefresh(value => value + 1)} style={buttonStyle}>
          {spanish ? 'Actualizar informe' : 'Refresh report'}
        </button>
        {report && <>
          <button type="button" disabled={loading || clearing} onClick={copyReport} style={{ ...buttonStyle, background: 'var(--primary)', color: '#111' }}>
            {spanish ? 'Copiar informe' : 'Copy report'}
          </button>
          <button type="button" disabled={loading || clearing} onClick={clearReport} style={buttonStyle}>
            {spanish ? 'Borrar informe' : 'Clear report'}
          </button>
        </>}
      </div>
      {message && <p role="status" style={{ color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{message}</p>}
    </section>
  );
}

export default function AppAbout({ lang }: { lang: string }) {
  const android = Capacitor.getPlatform() === 'android';
  const [nativeInfo, setNativeInfo] = useState<{ version: string; build: string } | null>(null);
  const [versionError, setVersionError] = useState(false);
  const spanish = lang === 'es';

  useEffect(() => {
    if (!android) return;
    let current = true;
    App.getInfo().then(info => {
      if (current) setNativeInfo(info);
    }).catch(() => {
      if (current) setVersionError(true);
    });
    return () => { current = false; };
  }, [android]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
      <div style={{ border: '1px solid var(--border-light)', background: 'var(--bg-card)', borderRadius: 12, padding: 20, textAlign: 'center' }}>
        <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--primary)', marginBottom: 8 }}>Yoru Reader</div>
        <div style={{ color: 'var(--text-main)', marginBottom: 8 }}>
          {android
            ? nativeInfo
              ? `Android · ${spanish ? 'Versión' : 'Version'} ${nativeInfo.version} (${nativeInfo.build})`
              : versionError
                ? (spanish ? 'No se pudo leer la versión instalada.' : 'Could not read the installed version.')
                : (spanish ? 'Leyendo versión instalada…' : 'Loading installed version…')
            : `${spanish ? 'Versión' : 'Version'} ${packageJson.version}`}
        </div>
        <div style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {spanish ? 'Aprende japonés leyendo historias que te gustan.' : 'Learn Japanese through stories you enjoy.'}
        </div>
      </div>
      {android ? <AndroidCrashDiagnostics lang={lang} /> : (
        <section>
          <h4 style={{ margin: '0 0 12px' }}>{spanish ? 'Historial de versiones y cambios' : 'Version History & Changelog'}</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 240, overflowY: 'auto' }}>
            {CHANGELOG.map(item => (
              <div key={item.version}>
                <strong style={{ color: 'var(--primary)' }}>v{item.version}</strong>
                <span style={{ marginLeft: 12, color: 'var(--text-muted)' }}>{item.date}</span>
                <ul style={{ paddingLeft: 18, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  {((item.changes as Record<string, string[]>)[lang] || item.changes.en).map((change, index) => <li key={index}>{change}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
