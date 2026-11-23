import React, { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useConfirm } from '../ConfirmModal';
import { db } from '../../utils/db';

/**
 * «Borrar mi progreso de lectura», en el perfil.
 *
 * Antes vivía al fondo de Ajustes, en la Zona de peligro, y desde allí no se
 * encontraba. Es algo de la cuenta de quien lee, así que va con su perfil, debajo
 * de sus listas.
 *
 * Lo que borra lo decide `db.borrarProgresoDeLectura` (ver `progresoBorrado.ts`): por
 * dónde va en cada libro, sus estadísticas y lo leído o escuchado del servidor, en
 * todos sus aparatos. Libros, marcadores, notas, palabras y tarjetas se quedan.
 *
 * El botón lleva su propia confirmación y su propio aviso en vez de pedírselos a
 * `Library`: el perfil no vive dentro de la biblioteca. Mientras borra lo dice, y si
 * falla o tarda demasiado también: lo que no puede pasar es que se pulse y no se vea
 * nada.
 */

/** Más que esto sin acabar es que algo se ha quedado esperando: mejor decirlo. */
const DEMASIADO_MS = 15000;

type Estado = 'quieto' | 'borrando' | 'hecho' | 'fallo';

export default function BorrarProgresoPerfil({ es }: { es: boolean }) {
  const { showConfirm, confirmModal } = useConfirm();
  const [estado, setEstado] = useState<Estado>('quieto');
  const [detalle, setDetalle] = useState('');

  const borrar = async () => {
    if (estado === 'borrando') return;
    const ok = await showConfirm({
      title: es ? '¿Borrar tu progreso de lectura?' : 'Erase your reading progress?',
      message: es
        ? 'Se pone a cero por dónde vas en cada libro, tus estadísticas y rachas, y lo leído o escuchado del servidor. Se borra también en tus otros aparatos al sincronizar. Tus libros, marcadores, notas, palabras y tarjetas se conservan. No se puede deshacer.'
        : 'Your place in every book, your statistics and streaks, and what you read or listened to from the server are reset. It is erased on your other devices too when they sync. Your books, bookmarks, notes, words and cards are kept. This cannot be undone.',
      type: 'danger',
      confirmText: es ? 'Borrar progreso' : 'Erase progress',
      cancelText: es ? 'Cancelar' : 'Cancel',
    });
    if (!ok) return;

    setEstado('borrando');
    setDetalle('');
    let reloj: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        db.borrarProgresoDeLectura(),
        new Promise((_, rechazar) => {
          reloj = setTimeout(() => rechazar(new Error(es ? 'tardó demasiado' : 'it took too long')), DEMASIADO_MS);
        }),
      ]);
      setEstado('hecho');
      // Se recarga para que ninguna pantalla siga enseñando lo de antes; al arrancar,
      // la sincronización lleva el borrado a los demás aparatos.
      setTimeout(() => window.location.reload(), 900);
    } catch (error: any) {
      console.error('[borrar-progreso]', error);
      setEstado('fallo');
      setDetalle(String(error?.message || error || ''));
    } finally {
      if (reloj) clearTimeout(reloj);
    }
  };

  return (
    <section className="yoru-profile-panel yoru-profile-reset">
      <div className="yoru-profile-panel-head">
        <span className="yoru-profile-panel-icon"><RotateCcw size={18} /></span>
        <strong>{es ? 'Progreso de lectura' : 'Reading progress'}</strong>
      </div>
      <p className="yoru-profile-reset-desc">
        {es
          ? 'Pone a cero por dónde vas en cada libro, tus estadísticas y rachas, y lo leído o escuchado del servidor, en todos tus aparatos. Conserva tus libros, marcadores, notas, palabras y tarjetas.'
          : 'Resets your place in every book, your statistics and streaks, and what you read or listened to from the server, on all your devices. Keeps your books, bookmarks, notes, words and cards.'}
      </p>
      <button
        type="button"
        className="yoru-btn yoru-btn-danger"
        onClick={borrar}
        disabled={estado === 'borrando' || estado === 'hecho'}
      >
        <RotateCcw size={15} />
        {estado === 'borrando'
          ? (es ? 'Borrando…' : 'Erasing…')
          : (es ? 'Borrar mi progreso de lectura' : 'Erase my reading progress')}
      </button>
      {estado === 'hecho' && (
        <p className="yoru-profile-reset-msg" role="status">
          {es ? 'Progreso de lectura borrado.' : 'Reading progress erased.'}
        </p>
      )}
      {estado === 'fallo' && (
        <p className="yoru-profile-reset-msg is-error" role="alert">
          {(es ? 'No se pudo borrar el progreso' : 'Could not erase the progress') + (detalle ? `: ${detalle}` : '.')}
        </p>
      )}
      {confirmModal}
    </section>
  );
}
