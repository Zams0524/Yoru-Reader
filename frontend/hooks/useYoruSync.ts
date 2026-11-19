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
 * Ahora quien la arranca es `useYoruSyncAutomatica()`, que monta `YoruShell`, y el
 * estado vive aquí, fuera de React, para que la tarjeta de Ajustes lo lea esté o no
 * montada cuando ocurre.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { asegurarCredencialesMedios } from '../utils/credencialesMedios';
import {
  recargarSiHizoFalta,
  sincronizacionDisponible,
  sincronizarConServidorYoru,
  ultimaSincronizacion,
  type ModoSync,
} from '../utils/yoruSyncService';
import { describirEstado, INTERVALO_SUBIDA_MS } from '../utils/yoruSyncNucleo';

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
  recargarSiHizoFalta(resultado);
}

/** El estado de la sincronización, para pintarlo. */
export function useEstadoYoruSync(): EstadoYoruSync {
  return useSyncExternalStore(suscribir, () => actual);
}

/**
 * La de «abrir la app» se hace una vez por carga de la página. La concha se vuelve a
 * montar al cerrar un libro, y ahí solo se sube: cambiarle la biblioteca a alguien que
 * acaba de salir de su libro, y recargarle la pantalla, parece un fallo aunque no lo sea.
 */
let yaSeCombinoAlAbrir = false;

/** Arranca la sincronización automática. Se monta una sola vez, en la concha. */
export function useYoruSyncAutomatica(): void {
  /*
    Las claves de Kavita y de Audiobookshelf las reparte el servidor de sincronización
    a quien sea miembro (`utils/credencialesMedios.ts`). Sin espera: cuanto antes
    lleguen, menos rato dice Inicio que no hay servidores.
  */
  useEffect(() => {
    void asegurarCredencialesMedios();
  }, []);

  useEffect(() => {
    if (!sincronizacionDisponible()) return undefined;
    // Igual que con Drive: se le da un momento al lector para que guarde su última
    // posición al cerrar un libro.
    const espera = window.setTimeout(() => {
      const modo: ModoSync = yaSeCombinoAlAbrir ? 'solo-subir' : 'bidireccional';
      yaSeCombinoAlAbrir = true;
      void sincronizarConYoru(modo, true);
    }, 2000);
    return () => window.clearTimeout(espera);
  }, []);

  useEffect(() => {
    if (!sincronizacionDisponible()) return undefined;
    const subir = () => { void sincronizarConYoru('solo-subir'); };
    const alOcultarse = () => { if (document.visibilityState === 'hidden') subir(); };
    const reloj = window.setInterval(() => {
      if (document.visibilityState === 'visible') subir();
    }, INTERVALO_SUBIDA_MS);
    document.addEventListener('visibilitychange', alOcultarse);
    return () => {
      window.clearInterval(reloj);
      document.removeEventListener('visibilitychange', alOcultarse);
    };
  }, []);
}
