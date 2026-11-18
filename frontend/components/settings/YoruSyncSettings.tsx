import React from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * La sincronización con el servidor de Yoru: lo que hay que enseñar, y nada más.
 *
 * Aquí no se configura nada, y esa es la gracia. No hay dirección que escribir ni
 * clave que pegar: entras con Discord —que ya es la puerta de la app— y tu biblioteca
 * te sigue del PC al teléfono sola. Lo único que falta por saber es si está yendo
 * bien, y cuándo fue la última vez; para eso está esta tarjeta.
 *
 * El botón de sincronizar a mano existe para un caso concreto: acabas de leer en el
 * PC, coges el teléfono y no quieres esperar al siguiente turno. No arregla nada que
 * no se arregle solo; ahorra la espera.
 */
export default function YoruSyncSettings({
  lang,
  estado,
  detalle,
  ultima,
  servidor,
  settings,
  onSaveSettings,
  onSincronizar,
}: {
  lang: string;
  estado: 'apagado' | 'sincronizando' | 'al-dia' | 'fallo';
  detalle: string;
  ultima: number;
  servidor: string;
  settings: Record<string, any>;
  onSaveSettings: (next: Record<string, any>) => void;
  onSincronizar: () => void;
}) {
  const es = lang === 'es';
  const sincronizando = estado === 'sincronizando';

  const color = estado === 'fallo' ? '#fbbf24' : estado === 'al-dia' ? '#34d399' : 'rgba(255,255,255,0.45)';
  const texto = (() => {
    if (estado === 'apagado') return es ? 'Desactivada' : 'Off';
    if (estado === 'sincronizando') return es ? 'Sincronizando…' : 'Syncing…';
    if (estado === 'fallo') return detalle || (es ? 'No se pudo sincronizar' : 'Could not sync');
    return es ? 'Al día' : 'Up to date';
  })();

  return (
    <>
      <p className="settings-card-desc">
        {es
          ? 'Tu progreso se guarda en el servidor de Yoru en cuanto entras con Discord: libros, por dónde vas, marcadores, palabras y tarjetas. No hay nada que configurar.'
          : 'Your progress is saved to the Yoru server as soon as you sign in with Discord: books, where you left off, bookmarks, words and cards. Nothing to configure.'}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '8px', padding: '12px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', gap: '12px' }}>
          <span style={{ color: 'rgba(255,255,255,0.4)' }}>{es ? 'Estado' : 'Status'}</span>
          <span style={{ color, fontWeight: 600, textAlign: 'right' }}>{texto}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', gap: '12px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '8px' }}>
          <span style={{ color: 'rgba(255,255,255,0.4)' }}>{es ? 'Última sincronización' : 'Last sync'}</span>
          <span style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>
            {ultima ? new Date(ultima).toLocaleString(es ? 'es-ES' : 'en-GB') : (es ? 'Todavía ninguna' : 'None yet')}
          </span>
        </div>
        {servidor && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', gap: '12px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '8px' }}>
            <span style={{ color: 'rgba(255,255,255,0.3)' }}>{es ? 'Servidor' : 'Server'}</span>
            <span style={{ color: 'rgba(255,255,255,0.3)', wordBreak: 'break-all', textAlign: 'right' }}>{servidor}</span>
          </div>
        )}
      </div>

      {/*
        Lo que ven los demás.

        Va aquí y no en la tarjeta de Discord porque es otra cosa: aquello es tu
        estado en Discord, esto es la tarjeta de Miembros dentro de Yoru. Viene
        encendido, que es lo que hace que la tarjeta sirva para algo, y lo que se
        enseña es un libro y un porcentaje, nunca tu biblioteca. La lista negra de la
        tarjeta de Discord vale también aquí: un libro que escondiste allí no asoma
        por este lado.
      */}
      <div className="settings-row-control">
        <span className="settings-label-text" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span>{es ? 'Enseñar a los miembros lo que lees' : 'Show members what you are reading'}</span>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-dark)', fontWeight: 400 }}>
            {es ? 'Solo el libro y por dónde vas, en la pestaña de Miembros' : 'Only the book and how far you are, in the Members tab'}
          </span>
        </span>
        <label className="migaku-switch">
          <input
            type="checkbox"
            checked={settings.shareReadingWithMembers !== false}
            onChange={(e) => onSaveSettings({ ...settings, shareReadingWithMembers: e.target.checked })}
          />
          <span className="migaku-switch-slider"></span>
        </label>
      </div>

      <button
        type="button"
        onClick={onSincronizar}
        disabled={sincronizando || estado === 'apagado'}
        className="reset-filter-btn"
        style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '8px' }}
      >
        <RefreshCw size={14} className={sincronizando ? 'spin' : undefined} />
        <span>{es ? 'Sincronizar ahora' : 'Sync now'}</span>
      </button>
    </>
  );
}
