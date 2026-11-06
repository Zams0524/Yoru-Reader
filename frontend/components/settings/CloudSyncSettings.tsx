import React from 'react';
import { Download, Settings, Upload } from 'lucide-react';

/**
 * Google Drive: subir la biblioteca, bajarla, y qué hacer cuando chocan.
 *
 * Lo de «combinar o reemplazar» no es un capricho de configuración: si lees en el
 * teléfono y en el ordenador, las estadísticas de los dos se encuentran, y hay que
 * decidir de antemano si se suman o si una pisa a la otra. Equivocarse ahí borra
 * horas de lectura, así que se pregunta antes y no después.
 *
 * Movido tal cual desde `Library.tsx`.
 */
export default function CloudSyncSettings({
  lang,
  settings,
  onSaveSettings,
  gDriveTokens,
  syncStatus,
  lastSyncTime,
  formatSyncTime,
  onConnect,
  onUpload,
  onDownload,
}: {
  lang: string;
  settings: Record<string, any>;
  onSaveSettings: (next: Record<string, any>) => void;
  gDriveTokens: unknown;
  syncStatus: string;
  lastSyncTime: unknown;
  formatSyncTime: (value: any) => string;
  onConnect: () => void;
  onUpload: () => void;
  onDownload: () => void;
}) {
  const sincronizando = syncStatus === 'syncing';

  return (
    <>
      <p className="settings-card-desc">
        {lang === 'es'
          ? 'Configura la sincronización con almacenamiento en la nube y cómo se resuelven los conflictos.'
          : 'Configure cloud storage synchronization and how metadata conflicts are resolved.'}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '8px', padding: '12px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
          <span style={{ color: 'rgba(255,255,255,0.4)' }}>{lang === 'es' ? 'Destino de sincronización de almacenamiento' : 'Storage Sync Target'}</span>
          <span style={{ color: gDriveTokens ? '#34d399' : 'rgba(255,255,255,0.3)', fontWeight: 600 }}>
            {gDriveTokens ? 'Google Drive' : (lang === 'es' ? 'Ninguno' : 'None')}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '8px' }}>
          <span style={{ color: 'rgba(255,255,255,0.4)' }}>{lang === 'es' ? 'Destino de sincronización de ajustes' : 'Settings Sync Target'}</span>
          <span style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>
            {lang === 'es' ? 'Perfil local' : 'Local Profile'}
          </span>
        </div>
      </div>

      <div className="settings-row-control">
        <span className="settings-label-text">{lang === 'es' ? 'Combinación de estadísticas' : 'Statistics Merge'}</span>
        <select
          value={settings.statsMergeOption || 'merge'}
          onChange={(e) => onSaveSettings({ ...settings, statsMergeOption: e.target.value })}
          className="migaku-select"
        >
          <option value="merge">{lang === 'es' ? 'Combinar (Merge)' : 'Merge'}</option>
          <option value="replace">{lang === 'es' ? 'Reemplazar (Replace)' : 'Replace'}</option>
        </select>
      </div>

      <div className="settings-row-control">
        <span className="settings-label-text">{lang === 'es' ? 'Combinación de objetivos de lectura' : 'Reading Goals Merge'}</span>
        <select
          value={settings.goalsMergeOption || 'merge'}
          onChange={(e) => onSaveSettings({ ...settings, goalsMergeOption: e.target.value })}
          className="migaku-select"
        >
          <option value="merge">{lang === 'es' ? 'Combinar (Merge)' : 'Merge'}</option>
          <option value="replace">{lang === 'es' ? 'Reemplazar (Replace)' : 'Replace'}</option>
        </select>
      </div>

      {/* Botón e inputs de Google Drive */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '14px', marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button
          type="button"
          onClick={onConnect}
          disabled={sincronizando}
          className="reset-filter-btn"
          style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <Settings size={14} /> <span>{gDriveTokens ? (lang === 'es' ? 'Volver a iniciar sesión' : 'Sign in again') : (lang === 'es' ? 'Iniciar sesión con Google' : 'Sign in with Google')}</span>
        </button>

        {gDriveTokens && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={onUpload}
                disabled={sincronizando}
                className="reset-filter-btn"
                style={{ flex: 1, justifyContent: 'center', background: 'rgba(52, 211, 153, 0.05)', borderColor: '#34d399', color: '#34d399', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <Upload size={14} /> <span>{lang === 'es' ? 'Subir copia completa' : 'Upload backup'}</span>
              </button>
              <button
                type="button"
                onClick={onDownload}
                disabled={sincronizando}
                className="reset-filter-btn"
                style={{ flex: 1, justifyContent: 'center', background: 'rgba(251, 191, 36, 0.05)', borderColor: '#fbbf24', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <Download size={14} /> <span>{lang === 'es' ? 'Descargar' : 'Download'}</span>
              </button>
            </div>
            {lastSyncTime && (
              <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>
                {lang === 'es' ? 'Última sincronización:' : 'Last sync:'} {formatSyncTime(lastSyncTime)}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
}
