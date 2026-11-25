import { useEffect, useMemo, useState } from 'react';
import { getKavitaSeriesMetadata, isKavitaConfigured } from './kavitaService';

/**
 * ¿Están todos los tomos de una serie de Kavita en la biblioteca?
 *
 * No se adivina por los títulos: que haya del 1 al 12 sin huecos no dice si la
 * serie tiene 12 o 30 tomos. Se le pregunta a Kavita, que lo sabe de dos maneras:
 *  - `publicationStatus` 2 («Completed»): Kavita lo pone solo cuando la serie
 *    terminó y están todos los tomos; si terminó pero faltan, pone 4 («Ended»).
 *  - `totalCount` (tomos publicados) y `maxCount` (hasta dónde hay): con los dos,
 *    completa es `maxCount >= totalCount`.
 * Si Kavita no sabe el total, la serie no lleva ninguna señal: mejor callar que
 * prometer que está entera.
 *
 * La respuesta se guarda en localStorage para que la vista de colección siga
 * saliendo al instante y sin red, como el resto del catálogo.
 */

const CLAVE = 'yoru:kavita-serie-completa:v1';
/** Cada cuánto se vuelve a preguntar por una serie ya conocida. */
const VIGENCIA_MS = 6 * 60 * 60 * 1000;
/** Peticiones a la vez: una colección puede traer decenas de series. */
const EN_PARALELO = 4;

const KAVITA_COMPLETED = 2;

export interface EstadoSerie {
  /** Todos los tomos publicados están en la biblioteca. */
  completa: boolean;
  /** Tomos publicados y tomos que hay, cuando Kavita sabe el total y faltan. */
  tiene?: number;
  total?: number;
}

interface Guardado {
  s?: number;
  t?: number;
  m?: number;
  at: number;
}

function leerCache(): Record<string, Guardado> {
  try {
    const crudo = localStorage.getItem(CLAVE);
    const datos = crudo ? JSON.parse(crudo) : null;
    return datos && typeof datos === 'object' ? datos : {};
  } catch {
    return {};
  }
}

function escribirCache(datos: Record<string, Guardado>): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(datos));
  } catch {
    // Sin sitio en localStorage: la señal se calcula igual, solo que no se recuerda.
  }
}

/** Lo que Kavita dice de una serie, convertido en «completa», «faltan» o nada. */
export function estadoDeSerie(datos: { s?: number; t?: number; m?: number }): EstadoSerie | null {
  const total = datos.t && datos.t > 0 ? datos.t : undefined;
  const tiene = datos.m && datos.m > 0 ? datos.m : undefined;
  if (datos.s === KAVITA_COMPLETED) return { completa: true };
  if (total !== undefined && tiene !== undefined) {
    return tiene >= total ? { completa: true } : { completa: false, tiene, total };
  }
  return null;
}

async function enTandas<T>(lista: T[], tarea: (x: T) => Promise<void>): Promise<void> {
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < lista.length) {
      const x = lista[siguiente++];
      await tarea(x);
    }
  };
  await Promise.all(Array.from({ length: Math.min(EN_PARALELO, lista.length) }, trabajador));
}

/**
 * El estado de cada serie de Kavita de la lista, por id. Devuelve lo guardado de
 * inmediato y, si hay conexión, refresca en segundo plano lo que tenga más de
 * `VIGENCIA_MS`.
 */
export function useSeriesCompletas(seriesIds: string[]): Record<string, EstadoSerie | null> {
  const ids = useMemo(
    () => Array.from(new Set(seriesIds.filter((id) => /^\d+$/.test(id)))),
    // La lista llega nueva en cada render; lo que importa es su contenido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seriesIds.join(',')],
  );

  const [cache, setCache] = useState<Record<string, Guardado>>(() => leerCache());

  useEffect(() => {
    if (ids.length === 0 || !isKavitaConfigured()) return;
    let vivo = true;
    const ahora = Date.now();
    const pendientes = ids.filter((id) => {
      const g = cache[id];
      return !g || ahora - g.at > VIGENCIA_MS;
    });
    if (pendientes.length === 0) return;

    void enTandas(pendientes, async (id) => {
      const meta = await getKavitaSeriesMetadata(Number(id));
      // Sin `publicationStatus` es que el servidor no contestó: se queda lo de antes.
      if (!vivo || meta.publicationStatus === undefined) return;
      const nuevo: Guardado = { s: meta.publicationStatus, t: meta.totalCount, m: meta.maxCount, at: Date.now() };
      setCache((previo) => {
        const siguiente = { ...previo, [id]: nuevo };
        escribirCache({ ...leerCache(), [id]: nuevo });
        return siguiente;
      });
    });
    return () => {
      vivo = false;
    };
    // Solo al cambiar de series: la caché que se va llenando no debe relanzar nada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  return useMemo(() => {
    const out: Record<string, EstadoSerie | null> = {};
    for (const id of ids) out[id] = cache[id] ? estadoDeSerie(cache[id]) : null;
    return out;
  }, [ids, cache]);
}
