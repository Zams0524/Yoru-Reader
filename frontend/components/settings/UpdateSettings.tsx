import React from 'react';
import { RefreshCw } from 'lucide-react';
import { isNewerVersion } from '../../hooks/useAppUpdater';

/**
 * Buscar e instalar versiones nuevas.
 *
 * Dice dos versiones porque son dos cosas distintas: la aplicación en sí, que en
 * Android es un APK que hay que instalar a mano, y la interfaz, que llega sola por
 * el aire. Cuando el instalador se queda viejo, la interfaz nueva viene dentro de
 * él y no puede llegar sola: eso es lo que avisa «llega con la próxima app», y por
 * eso se enseñan las dos por separado en vez de una sola barra de progreso.
 *
 * Movido tal cual desde `Library.tsx`.
 */
export default function UpdateSettings({
  lang,
  settings,
  onSaveSettings,
  updaterMode,
  updaterState,
  updateAvailable,
  updateProgress,
  updateErrorMessage,
  updating,
  checkingUpdates,
  onCheck,
  onUpdateNow,
  openUpdateFallback,
}: {
  lang: string;
  settings: Record<string, any>;
  onSaveSettings: (next: Record<string, any>) => void;
  /** 'android' o el de escritorio: cambia lo que dicen los botones. */
  updaterMode: string;
  updaterState: Record<string, any>;
  updateAvailable: boolean;
  updateProgress: number;
  updateErrorMessage: string;
  updating: boolean;
  /** Mientras se pregunta al servidor si hay versión nueva. */
  checkingUpdates: boolean;
  onCheck: () => void;
  onUpdateNow: () => void;
  /** La salida cuando la instalación automática no es posible: abrir la descarga. */
  openUpdateFallback: () => void;
}) {
  const handleCheckUpdates = onCheck;
  const handleUpdateNow = onUpdateNow;

  const isAndroidUpdater = updaterMode === 'android';
  const latest = updaterState.latest;
  const appOutdated = Boolean(latest) && isNewerVersion(latest.appVersion, updaterState.current.appVersion);
  // When the installer is outdated, the new interface comes inside it.
  const uiNeedsApk = Boolean(latest?.needsApk);
  const uiOutdated = !uiNeedsApk && Boolean(latest?.hotVersion) && isNewerVersion(latest.hotVersion, updaterState.current.hotVersion);
  const ready = updaterState.status === 'ready';
  const canUpdate = updateAvailable && !updating;
  const versionCard = (title: string, current?: string, latestVersion?: string, outdated = false, needsApk = false) => (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${outdated ? 'rgba(16, 185, 129, 0.45)' : 'var(--border-light)'}`,
      borderRadius: '10px',
      padding: '14px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-main)' }}>{title}</span>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {lang === 'es' ? 'Actual: ' : 'Current: '}{current || '—'}
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {lang === 'es' ? 'Última: ' : 'Latest: '}{latestVersion || '—'}
        </div>
      </div>
      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: needsApk ? '#f59e0b' : outdated ? '#10b981' : '#3b82f6', textAlign: 'right' }}>
        {needsApk
          ? (lang === 'es' ? 'Llega con la próxima app' : 'Comes with the next app')
          : outdated
          ? (lang === 'es' ? 'Disponible' : 'Available')
          : latest ? (lang === 'es' ? 'Actualizado' : 'Up to date') : '—'}
      </span>
    </div>
  );
  const progressLabel = updaterState.status === 'installing'
    ? (isAndroidUpdater && updaterState.kind === 'apk'
        ? (lang === 'es' ? 'Confirma la instalación en el aviso de Android.' : 'Confirm the install in the Android prompt.')
        : (lang === 'es' ? 'Instalando y reiniciando Yoru Reader...' : 'Installing and restarting Yoru Reader...'))
    : ready
      ? (lang === 'es' ? 'Descarga completada.' : 'Download complete.')
      : updateProgress >= 0
        ? (lang === 'es' ? 'Descargando actualización...' : 'Downloading update...')
        : (lang === 'es' ? 'Descargando actualización (tamaño desconocido)...' : 'Downloading update (unknown size)...');
  const updateButtonLabel = updaterState.status === 'downloading'
    ? (lang === 'es' ? `Descargando (${Math.max(0, updateProgress)}%)...` : `Downloading (${Math.max(0, updateProgress)}%)...`)
    : updaterState.status === 'installing'
      ? (lang === 'es' ? 'Instalando...' : 'Installing...')
      : ready && updaterState.kind === 'ota'
        ? (isAndroidUpdater ? (lang === 'es' ? 'Reiniciar para actualizar' : 'Restart to update') : (lang === 'es' ? 'Aplicar ahora' : 'Apply now'))
        : ready
          ? (isAndroidUpdater ? (lang === 'es' ? 'Instalar' : 'Install') : (lang === 'es' ? 'Reiniciar e instalar' : 'Restart and install'))
          : (lang === 'es' ? 'Actualizar ahora' : 'Update now');
  return (
  <div id="sec-updates" className="settings-section-card">
    <h3 className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <RefreshCw size={18} style={{ color: 'var(--primary)' }} />
      <span>{lang === 'es' ? 'Actualizaciones' : 'Updates'}</span>
    </h3>

    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '16px' }}>
      {/* Auto Update Checkbox */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', color: 'var(--text-main)' }}>
        <span>{lang === 'es' ? 'Actualización automática:' : 'Automatic updates:'}</span>
        <input
          type="checkbox"
          checked={settings.autoUpdate || false}
          onChange={(e) => onSaveSettings({ ...settings, autoUpdate: e.target.checked })}
          style={{ accentColor: 'var(--primary)', width: '16px', height: '16px', cursor: 'pointer' }}
        />
      </div>

      {/* Beta Updates Checkbox */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', color: 'var(--text-main)' }}>
        <span>{lang === 'es' ? 'Actualizaciones beta:' : 'Beta updates:'}</span>
        <input
          type="checkbox"
          checked={settings.betaUpdates || false}
          onChange={(e) => onSaveSettings({ ...settings, betaUpdates: e.target.checked })}
          style={{ accentColor: 'var(--primary)', width: '16px', height: '16px', cursor: 'pointer' }}
        />
      </div>

      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '4px 0 4px 0', lineHeight: 1.4 }}>
        {isAndroidUpdater
          ? (lang === 'es'
              ? 'Las mejoras de la interfaz se descargan solas y se aplican al volver a abrir la app. Si cambia la parte nativa, se descarga una nueva versión de la app y Android te pedirá confirmar la instalación.'
              : 'Interface updates download on their own and apply the next time you open the app. When the native part changes, a new app version downloads and Android asks you to confirm the install.')
          : (lang === 'es'
              ? 'Las actualizaciones se descargan e instalan dentro de la app. Con la actualización automática se descargan en segundo plano y se instalan al cerrar Yoru Reader.'
              : 'Updates download and install inside the app. With automatic updates on, they download in the background and install when you close Yoru Reader.')}
      </p>

      {versionCard(
        isAndroidUpdater ? (lang === 'es' ? 'Aplicación Android' : 'Android app') : (lang === 'es' ? 'Aplicación de escritorio' : 'Desktop app'),
        updaterState.current.appVersion,
        latest?.appVersion,
        appOutdated
      )}

      {versionCard(
        lang === 'es' ? 'Interfaz (actualización rápida)' : 'Interface (quick update)',
        updaterState.current.hotVersion,
        latest?.hotVersion,
        uiOutdated,
        uiNeedsApk
      )}

      {/* Progress Bar */}
      {(updating || ready) && (
        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            <span>{progressLabel}</span>
            <span>{updateProgress >= 0 ? `${updateProgress}%` : ''}</span>
          </div>
          <div style={{
            width: '100%',
            height: '6px',
            background: 'var(--border-light)',
            borderRadius: '3px',
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${updateProgress >= 0 ? updateProgress : 0}%`,
              height: '100%',
              background: ready || updaterState.status === 'installing' ? '#10b981' : 'var(--primary)',
              transition: 'width 0.2s ease-out'
            }} />
          </div>
        </div>
      )}

      {updateErrorMessage && (
        <div style={{ fontSize: '0.82rem', color: '#f87171', lineHeight: 1.4 }}>
          {updateErrorMessage}
          {updaterState.status === 'error' && (
            <>
              {' '}
              <button
                type="button"
                onClick={() => openUpdateFallback()}
                style={{ background: 'none', border: 'none', padding: 0, color: '#3b82f6', textDecoration: 'underline', cursor: 'pointer', fontSize: 'inherit' }}
              >
                {lang === 'es' ? 'Descargar manualmente' : 'Download manually'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
        <button
          type="button"
          onClick={handleCheckUpdates}
          disabled={checkingUpdates || updating}
          style={{
            flex: 1,
            padding: '10px',
            borderRadius: '8px',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: (checkingUpdates || updating) ? 'not-allowed' : 'pointer',
            background: 'rgba(37, 99, 235, 0.1)',
            border: '1px solid #2563eb',
            color: '#3b82f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s'
          }}
        >
          {checkingUpdates ? (lang === 'es' ? 'Buscando...' : 'Checking...') : (lang === 'es' ? 'Buscar actualizaciones' : 'Check for updates')}
        </button>

        <button
          type="button"
          onClick={handleUpdateNow}
          disabled={!canUpdate}
          style={{
            flex: 1,
            padding: '10px',
            borderRadius: '8px',
            fontSize: '0.85rem',
            fontWeight: 600,
            background: canUpdate ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg-card)',
            border: canUpdate ? '1px solid #10b981' : '1px solid var(--border-light)',
            color: canUpdate ? '#10b981' : 'var(--text-muted)',
            cursor: canUpdate ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s'
          }}
        >
          {updateButtonLabel}
        </button>
      </div>
    </div>
  </div>
  );

}
