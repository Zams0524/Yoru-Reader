import React from 'react';
import { Download, LogIn, Upload } from 'lucide-react';

/**
 * Google Drive: una copia de la biblioteca en la cuenta de cada uno.
 *
 * Es opcional. El progreso ya viaja solo por el servidor de Yoru; esto es para quien
 * quiere además su copia en su propio Drive.
 *
 * Aquí había dos filas de «destino de sincronización» que solo repetían si estabas
 * conectado, y dos desplegables —«Combinar (Merge)» o «Reemplazar (Replace)» para
 * estadísticas y objetivos— que guardaban `statsMergeOption` y `goalsMergeOption` sin
 * que nadie los leyera: las dos sincronizaciones combinan siempre, con
 * `mergeDatabaseExports`. Se han quitado; un ajuste que no hace nada es peor que no
 * tenerlo, porque elegir «Reemplazar» hacía creer que algo iba a pisarse.
 */
export default function CloudSyncSettings({
  lang,
  gDriveTokens,
  syncStatus,
  lastSyncTime,
  formatSyncTime,
  onConnect,
  onUpload,
  onDownload,
}: {
  lang: string;
  gDriveTokens: unknown;
  syncStatus: string;
  lastSyncTime: unknown;
  formatSyncTime: (value: any) => string;
  onConnect: () => void;
  onUpload: () => void;
  onDownload: () => void;
}) {
  const es = lang === 'es';
  const sincronizando = syncStatus === 'syncing';

  return (
    <>
      <p className="settings-card-desc">
        {es
          ? 'Opcional. Guarda una copia de tu biblioteca y tu progreso en tu propio Google Drive. Al bajarla se combina con lo que ya tienes; no borra nada.'
          : 'Optional. Keeps a copy of your library and progress in your own Google Drive. Downloading merges it with what you already have; nothing is erased.'}
      </p>

      <div className="settings-status-list">
        <div className="settings-status-row">
          <span>{es ? 'Estado' : 'Status'}</span>
          <strong className={gDriveTokens ? 'is-ok' : undefined}>
            {gDriveTokens ? (es ? 'Conectado' : 'Connected') : (es ? 'Sin conectar' : 'Not connected')}
          </strong>
        </div>
        {Boolean(gDriveTokens) && Boolean(lastSyncTime) && (
          <div className="settings-status-row">
            <span>{es ? 'Última copia' : 'Last copy'}</span>
            <strong>{formatSyncTime(lastSyncTime)}</strong>
          </div>
        )}
      </div>

      <div className="settings-actions">
        {Boolean(gDriveTokens) && (
          <>
            <button type="button" onClick={onUpload} disabled={sincronizando} className="settings-btn is-primary">
              <Upload size={15} /> <span>{es ? 'Subir copia' : 'Upload copy'}</span>
            </button>
            <button type="button" onClick={onDownload} disabled={sincronizando} className="settings-btn">
              <Download size={15} /> <span>{es ? 'Bajar y combinar' : 'Download and merge'}</span>
            </button>
          </>
        )}
        <button type="button" onClick={onConnect} disabled={sincronizando} className={`settings-btn${gDriveTokens ? ' is-quiet' : ' is-primary'}`}>
          <LogIn size={15} /> <span>{gDriveTokens ? (es ? 'Cambiar de cuenta' : 'Switch account') : (es ? 'Conectar Google Drive' : 'Connect Google Drive')}</span>
        </button>
      </div>
    </>
  );
}
