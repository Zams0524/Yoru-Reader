import { useEffect, useState } from 'react';
import { getKavitaVolumes, isKavitaConfigured } from './kavitaService';

/**
 * Cuántos tomos tiene en Kavita cada serie, para la insignia de la portada.
 *
 * Lo pidió zams (25 nov 2026): una serie como Re:ゼロ sale con la portada del tomo 1
 * y nada dice que dentro hay 46. Se cuentan los volúmenes que Kavita tiene de la
 * serie (`/api/Series/volumes`), lo mismo que enseña su ficha («46 tomos»).
 *
 * Cada tarjeta pide su serie con `useTomosSerie`, pero las peticiones se reparten
 * desde aquí: como mucho `EN_PARALELO` a la vez, una sola por serie aunque salga en
 * tres filas, y lo sabido se guarda en localStorage para que la insignia salga al
 * instante y sin red la próxima vez.
 */

const CLAVE = 'yoru:kavita-tomos-serie:v1';
/** Cada cuánto se vuelve a contar una serie ya conocida (entran tomos nuevos). */
const VIGENCIA_MS = 6 * 60 * 60 * 1000;
const EN_PARALELO = 3;

interface Guardado {
  n: number;
  at: number;
}

let cache: Record<string, Guardado> | null = null;
const oyentes = new Map<string, Set<(n: number) => void>>();
const cola: string[] = [];
const pedidas = new Set<string>();
let activas = 0;

function leerCache(): Record<string, Guardado> {
  if (cache) return cache;
  try {
    const crudo = localStorage.getItem(CLAVE);
    const datos = crudo ? JSON.parse(crudo) : null;
    cache = datos && typeof datos === 'object' ? datos : {};
  } catch {
    cache = {};
  }
  return cache!;
}

function guardar(id: string, n: number): void {
  const datos = leerCache();
  datos[id] = { n, at: Date.now() };
  try {
    localStorage.setItem(CLAVE, JSON.stringify(datos));
  } catch {
    // Sin sitio: la insignia sale igual, solo que no se recuerda.
  }
  oyentes.get(id)?.forEach((avisar) => avisar(n));
}

function siguiente(): void {
  while (activas < EN_PARALELO && cola.length > 0) {
    const id = cola.shift()!;
    activas += 1;
    getKavitaVolumes(Number(id))
      .then((tomos) => {
        // Una respuesta vacía es que el servidor no contestó bien: se queda lo de antes.
        if (tomos.length > 0) guardar(id, tomos.length);
      })
      .catch(() => {
        // Sin red o sin permiso: sin insignia, que es lo mismo que «no se sabe».
      })
      .finally(() => {
        activas -= 1;
        siguiente();
      });
  }
}

function pedir(id: string): void {
  if (pedidas.has(id) || !isKavitaConfigured()) return;
  const guardado = leerCache()[id];
  if (guardado && Date.now() - guardado.at < VIGENCIA_MS) return;
  pedidas.add(id);
  cola.push(id);
  siguiente();
}

/** Lo sabido de una serie, sin pedir nada. */
export function tomosGuardados(seriesId: string): number | null {
  return leerCache()[seriesId]?.n ?? null;
}

/**
 * Los tomos de una serie de Kavita, o `null` mientras no se sepa. Con `seriesId`
 * vacío (un audiolibro, por ejemplo) no pide nada.
 */
export function useTomosSerie(seriesId: string | null | undefined): number | null {
  const id = seriesId && /^\d+$/.test(seriesId) ? seriesId : null;
  const [n, setN] = useState<number | null>(() => (id ? tomosGuardados(id) : null));

  useEffect(() => {
    if (!id) {
      setN(null);
      return;
    }
    setN(tomosGuardados(id));
    let grupo = oyentes.get(id);
    if (!grupo) {
      grupo = new Set();
      oyentes.set(id, grupo);
    }
    grupo.add(setN);
    pedir(id);
    return () => {
      grupo!.delete(setN);
    };
  }, [id]);

  return n;
}

/** El texto de la insignia: solo con más de un tomo, que con uno no dice nada. */
export function textoTomos(n: number | null, es: boolean): string | null {
  if (n === null || n <= 1) return null;
  return es ? `${n} tomos` : `${n} volumes`;
}
