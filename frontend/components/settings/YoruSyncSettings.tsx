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
  onSincronizar,
}: {
  lang: string;
  estado: 'apagado' | 'sincronizando' | 'al-dia' | 'fallo';
  detalle: string;
  ultima: number;
  servidor: string;
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
