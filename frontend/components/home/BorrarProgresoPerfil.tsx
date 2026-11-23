import React, { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useConfirm } from '../ConfirmModal';
import { db } from '../../utils/db';
import { sincronizacionDisponible, sincronizarConServidorYoru } from '../../utils/yoruSyncService';
import { describirEstado } from '../../utils/yoruSyncNucleo';

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

type Estado = 'quieto' | 'borrando' | 'subiendo' | 'hecho' | 'fallo';

/** Si el borrado llegó a la cuenta de Discord (el servidor de Yoru) y, si no, por qué. */
type EnCuenta = { ok: boolean; motivo?: string };

/**
 * Lleva el borrado al servidor de Yoru, donde se guarda el progreso de la cuenta de
 * Discord. Es la sincronización de siempre: la marca de borrado viaja con los datos y
 * el combinador deja a cero lo del servidor. Si ya había una sincronización en marcha,
 * se espera un poco y se vuelve a intentar una vez.
 */
async function subirBorradoACuenta(): Promise<EnCuenta> {
  if (!sincronizacionDisponible()) return { ok: false, motivo: 'sin-servidor' };
  try {
    let resultado = await sincronizarConServidorYoru('bidireccional', { forzada: true });
    if (resultado.estado === 'muy-pronto') {
      await new Promise((listo) => setTimeout(listo, 3000));
      resultado = await sincronizarConServidorYoru('bidireccional', { forzada: true });
    }
    if (resultado.estado === 'adelante' && !resultado.fallo) return { ok: true };
    return { ok: false, motivo: describirEstado(resultado.fallo || resultado.estado) };
  } catch (error: any) {
    console.error('[borrar-progreso] no se pudo subir el borrado a la cuenta', error);
    return { ok: false, motivo: String(error?.message || error || '') };
  }
}

export default function BorrarProgresoPerfil({ es, fila = false }: { es: boolean; fila?: boolean }) {
  const { showConfirm, confirmModal } = useConfirm();
  const [estado, setEstado] = useState<Estado>('quieto');
  const [detalle, setDetalle] = useState('');
  const [enCuenta, setEnCuenta] = useState<EnCuenta | null>(null);

  const borrar = async () => {
    if (estado === 'borrando') return;
    const ok = await showConfirm({
      title: es ? '¿Borrar tu progreso de lectura?' : 'Erase your reading progress?',
      message: es
        ? 'Se pone a cero por dónde vas en cada libro, tus estadísticas y rachas, y lo leído o escuchado del servidor. Se borra también en tu cuenta de Yoru (la de Discord) y en tus otros aparatos. Tus libros, marcadores, notas, palabras y tarjetas se conservan. No se puede deshacer.'
        : 'Your place in every book, your statistics and streaks, and what you read or listened to from the server are reset. It is also erased on your Yoru account (the Discord one) and on your other devices. Your books, bookmarks, notes, words and cards are kept. This cannot be undone.',
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
      // El progreso de la cuenta de Discord vive en el servidor de Yoru: se le lleva el
      // borrado ya, sin esperar a la próxima sincronización, y se dice si llegó.
      setEstado('subiendo');
      const cuenta = await subirBorradoACuenta();
      setEnCuenta(cuenta);
      setEstado('hecho');
      // Se recarga para que ninguna pantalla siga enseñando lo de antes, con tiempo de
      // leer el aviso (más si la cuenta no respondió).
      setTimeout(() => window.location.reload(), cuenta.ok ? 2500 : 7000);
    } catch (error: any) {
      console.error('[borrar-progreso]', error);
      setEstado('fallo');
      setDetalle(String(error?.message || error || ''));
    } finally {
      if (reloj) clearTimeout(reloj);
    }
  };

  const descripcion = es
    ? 'Pone a cero por dónde vas en cada libro, tus estadísticas y rachas, y lo leído o escuchado del servidor, en tu cuenta de Yoru (Discord) y en todos tus aparatos. Conserva tus libros, marcadores, notas, palabras y tarjetas.'
    : 'Resets your place in every book, your statistics and streaks, and what you read or listened to from the server, on your Yoru (Discord) account and all your devices. Keeps your books, bookmarks, notes, words and cards.';

  const avisos = (
    <>
      {estado === 'hecho' && enCuenta?.ok && (
        <p className="yoru-profile-reset-msg" role="status">
          {es
            ? 'Progreso borrado aquí y en tu cuenta de Yoru (Discord).'
            : 'Progress erased here and on your Yoru (Discord) account.'}
        </p>
      )}
      {estado === 'hecho' && enCuenta && !enCuenta.ok && (
        <p className="yoru-profile-reset-msg is-error" role="alert">
          {es
            ? `Progreso borrado en este aparato, pero tu cuenta de Yoru no respondió (${enCuenta.motivo}). Se borrará allí en la próxima sincronización.`
            : `Progress erased on this device, but your Yoru account did not answer (${enCuenta.motivo}). It will be erased there on the next sync.`}
        </p>
      )}
      {estado === 'fallo' && (
        <p className="yoru-profile-reset-msg is-error" role="alert">
          {(es ? 'No se pudo borrar el progreso' : 'Could not erase the progress') + (detalle ? `: ${detalle}` : '.')}
        </p>
      )}
    </>
  );

  const ocupado = estado === 'borrando' || estado === 'subiendo' || estado === 'hecho';
  const rotulo = estado === 'borrando'
    ? (es ? 'Borrando…' : 'Erasing…')
    : estado === 'subiendo'
      ? (es ? 'Borrando en tu cuenta…' : 'Erasing on your account…')
      : (es ? 'Borrar mi progreso de lectura' : 'Erase my reading progress');

  // En Ajustes → Perfil, debajo de «Cuenta de Discord»: una fila como las demás.
  if (fila) {
    return (
      <div className="settings-row yoru-reset-row">
        <div className="settings-row-text">
          <span className="settings-row-label">{es ? 'Progreso de la cuenta' : 'Account progress'}</span>
          <span className="settings-row-desc">{descripcion}</span>
          {avisos}
        </div>
        <div className="settings-row-control">
          <button type="button" className="settings-btn yoru-btn-danger" onClick={borrar} disabled={ocupado}>
            <RotateCcw size={15} />
            {rotulo}
          </button>
        </div>
        {confirmModal}
      </div>
    );
  }

  return (
    <section className="yoru-profile-panel yoru-profile-reset">
      <div className="yoru-profile-panel-head">
        <span className="yoru-profile-panel-icon"><RotateCcw size={18} /></span>
        <strong>{es ? 'Progreso de lectura' : 'Reading progress'}</strong>
      </div>
      <p className="yoru-profile-reset-desc">{descripcion}</p>
      <button
        type="button"
        className="yoru-btn yoru-btn-danger"
        onClick={borrar}
        disabled={ocupado}
      >
        <RotateCcw size={15} />
        {rotulo}
      </button>
      {avisos}
      {confirmModal}
    </section>
  );
}
