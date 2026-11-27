/**
 * La sincronización con el servidor de Yoru, puesta en marcha desde la concha.
 *
 * Vivía dentro de `Library.tsx`, y `Library` solo se monta al entrar en Catálogo, el
 * SRS o Ajustes. Mientras la app abría en la biblioteca daba igual; desde que abre
 * siempre en Inicio (1.2.8.72), la sincronización «de abrir la app» no corría hasta
 * que alguien pasaba por una de esas pantallas: quien formateaba y volvía a entrar se
 * quedaba mirando un Inicio vacío con su progreso esperando en el servidor, y luego,
 * al entrar en Catálogo, la pantalla se recargaba sola (zams, 19 nov 2026).
 *
 * Después pasó a montarla `YoruShell`, pero la concha tampoco está cuando hay un libro
 * abierto: mientras se leía no subía nada, ni cada cinco minutos ni al mandar la app al
 * fondo. Quien leía en el teléfono, lo dejaba con el libro abierto y seguía en el PC
 * encontraba el progreso de antes (zams, 20 nov 2026).
 *
 * Ahora quien la arranca es `useYoruSyncAutomatica()`, que monta `App`, lo único que
 * está siempre, y el estado vive aquí, fuera de React, para que la tarjeta de Ajustes
 * lo lea esté o no montada cuando ocurre.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { asegurarCredencialesMedios } from '../utils/credencialesMedios';
import {
  recargarSiHizoFalta,
  sincronizacionDisponible,
  sincronizarConServidorYoru,
  ultimaSincronizacion,
  type ModoSync,
} from '../utils/yoruSyncService';
import { describirEstado, INTERVALO_SUBIDA_MS, tocaBajarAlVolver } from '../utils/yoruSyncNucleo';

export interface EstadoYoruSync {
  estado: 'apagado' | 'sincronizando' | 'al-dia' | 'fallo';
  detalle: string;
  /** Cuándo se sincronizó por última vez, en milisegundos desde época. */
  ultima: number;
}

let actual: EstadoYoruSync = {
  estado: sincronizacionDisponible() ? 'sincronizando' : 'apagado',
  detalle: '',
  ultima: ultimaSincronizacion(),
};
const oyentes = new Set<() => void>();

function poner(cambios: Partial<EstadoYoruSync>): void {
  actual = { ...actual, ...cambios };
  oyentes.forEach((avisar) => avisar());
}

function suscribir(avisar: () => void): () => void {
  oyentes.add(avisar);
  return () => { oyentes.delete(avisar); };
}

/** Si hay un libro abierto ahora mismo. Con un libro abierto no se recarga la pantalla. */
let leyendoAhora = false;

/** Sincroniza y deja el resultado donde lo lee Ajustes. Recarga si llegó algo de otro aparato. */
export async function sincronizarConYoru(modo: ModoSync, forzada = false): Promise<void> {
  if (!sincronizacionDisponible()) { poner({ estado: 'apagado' }); return; }
  poner({ estado: 'sincronizando' });
  const resultado = await sincronizarConServidorYoru(modo, { forzada });
  if (resultado.fallo || resultado.estado === 'sin-red' || resultado.estado === 'sin-discord') {
    poner({ estado: 'fallo', detalle: describirEstado(resultado.fallo || resultado.estado), ultima: ultimaSincronizacion() });
  } else {
    poner({ estado: 'al-dia', detalle: '', ultima: ultimaSincronizacion() });
  }
  // Recargar con un libro abierto echaría al lector de su página. Lo combinado ya está
  // guardado; la pantalla lo enseña la próxima vez que se cargue. El libro abierto, en
  // cambio, no puede esperar: si llegó una página más adelante de otro aparato y el lector
  // sigue en la vieja, al pasar de página guardaría la vieja y se la quitaría al otro.
  // `App` mira si es el caso y lleva el lector allí (EVENTO_PROGRESO_LLEGADO).
  if (leyendoAhora) {
    if (resultado.cambioLocal) window.dispatchEvent(new Event(EVENTO_PROGRESO_LLEGADO));
  } else {
    recargarSiHizoFalta(resultado);
  }
}

/** Lo combinado con el servidor cambió algo mientras había un libro abierto. */
export const EVENTO_PROGRESO_LLEGADO = 'yoru-sync-progreso-llegado';

/** El estado de la sincronización, para pintarlo. */
export function useEstadoYoruSync(): EstadoYoruSync {
  return useSyncExternalStore(suscribir, () => actual);
}

/** Cuándo se trajo por última vez lo del servidor en esta carga de la página. */
let ultimaBajada = 0;

function bajarYSubir(): void {
  ultimaBajada = Date.now();
  void sincronizarConYoru('bidireccional', true);
}

/**
 * Arranca la sincronización automática. Se monta una sola vez, en `App`.
 *
 * Cuándo se **trae** lo del servidor (y se sube lo de aquí):
 *  - al abrir la app;
 *  - al volver a ella —del fondo en el teléfono, a la ventana en el PC—, también con un
 *    libro abierto. Es el momento en que se cambia de aparato: sin esto, una app que
 *    se quedó abierta no se enteraba nunca de lo leído en el otro. Hasta el 27 nov 2026
 *    se saltaba con un libro abierto, y quien dejaba el teléfono en el libro, seguía en
 *    el PC y volvía, encontraba la página vieja; al pasar de página, la vieja ganaba.
 *
 * Cuándo **solo se sube**:
 *  - al irse la app al fondo, haya o no un libro abierto, y sin esperar turno;
 *  - cada cinco minutos, también leyendo;
 *  - al cerrar un libro. Ahí no se trae nada: cambiarle la biblioteca a alguien que
 *    acaba de salir de su libro parece un fallo aunque no lo sea.
 *
 * @param dentro si ya se pasó la puerta de Discord y la guía. `App` está montada desde
 *   antes de entrar, y ahí todavía no hay con qué identificarse: la sincronización «de
 *   abrir la app» espera a este momento. Si no, quien borraba los datos y volvía a
 *   entrar se quedaba sin su progreso hasta cerrar y abrir la app.
 * @param leyendo si hay un libro abierto.
 */
export function useYoruSyncAutomatica(dentro: boolean, leyendo: boolean): void {
  const leyendoAntes = useRef(leyendo);
  const dentroRef = useRef(dentro);
  dentroRef.current = dentro;

  /*
    Las claves de Kavita y de Audiobookshelf las reparte el servidor de sincronización
    a quien sea miembro (`utils/credencialesMedios.ts`). Sin espera: cuanto antes
    lleguen, menos rato dice Inicio que no hay servidores.
  */
  useEffect(() => {
    if (dentro) void asegurarCredencialesMedios();
  }, [dentro]);

  useEffect(() => {
    if (!dentro || !sincronizacionDisponible()) return undefined;
    // Igual que con Drive: se le da un momento a la app para terminar de arrancar.
    const espera = window.setTimeout(bajarYSubir, 2000);
    return () => window.clearTimeout(espera);
  }, [dentro]);

  useEffect(() => {
    leyendoAhora = leyendo;
    const acabaDeCerrar = leyendoAntes.current && !leyendo;
    leyendoAntes.current = leyendo;
    if (!acabaDeCerrar || !dentroRef.current || !sincronizacionDisponible()) return undefined;
    // Un momento para que el lector guarde su última posición al cerrar el libro.
    const espera = window.setTimeout(() => { void sincronizarConYoru('solo-subir', true); }, 2000);
    return () => window.clearTimeout(espera);
  }, [leyendo]);

  useEffect(() => {
    if (!sincronizacionDisponible()) return undefined;
    const alVolver = () => {
      if (!dentroRef.current || document.visibilityState !== 'visible') return;
      if (!tocaBajarAlVolver(Date.now(), ultimaBajada)) return;
      bajarYSubir();
    };
    const alCambiarVisibilidad = () => {
      // Al fondo se sube siempre y sin esperar turno: es justo cuando se suelta este
      // aparato para coger el otro.
      if (!dentroRef.current) return;
      if (document.visibilityState === 'hidden') void sincronizarConYoru('solo-subir', true);
      else alVolver();
    };
    const reloj = window.setInterval(() => {
      if (dentroRef.current && document.visibilityState === 'visible') void sincronizarConYoru('solo-subir');
    }, INTERVALO_SUBIDA_MS);
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    // En el PC la ventana no se «oculta» al cambiar a otra: lo que hay es el foco.
    window.addEventListener('focus', alVolver);
    return () => {
      window.clearInterval(reloj);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
      window.removeEventListener('focus', alVolver);
    };
  }, []);
}
