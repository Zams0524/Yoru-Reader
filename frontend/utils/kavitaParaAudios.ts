/**
 * Las entradas de Kavita que pueden ser la novela de algún audiolibro.
 *
 * «Leer y escuchar» empezó comparando los audiolibros con las series de Kavita que
 * la app guarda para Inicio, que son treinta y seis. En un Kavita de casa con miles
 * de entradas —el de zams tiene 7.778, porque cada tomo es una serie— ahí no cae
 * casi ninguna de las que interesan. Así que se pregunta al revés: los audiolibros
 * son pocos, y para cada obra se le pide a Kavita lo que se llame así.
 *
 * Son unas pocas peticiones (una por obra, no por audiolibro), se guardan, y no se
 * repiten mientras el catálogo de audiolibros no cambie o no pasen unas horas. Si
 * Kavita no contesta se queda lo guardado: sin error, sin aviso, sin esperar.
 */

import { getKavitaSeriesByName, isKavitaConfigured } from './kavitaService';
import { busquedasParaAudios, type AudioDePareja, type SerieDePareja } from './paresLecturaAudio';

const CACHE_KEY = 'yoru_kavita_para_audios_v1';
const VALE_MS = 6 * 60 * 60 * 1000;
export const KAVITA_PARA_AUDIOS_EVENT = 'yoru-kavita-para-audios-updated';

interface Guardado {
  at: number;
  /** Las búsquedas con las que se consiguió: si cambian, hay que volver a preguntar. */
  firma: string;
  series: SerieDePareja[];
}

function leer(): Guardado | null {
  try {
    const dato = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!dato || !Array.isArray(dato.series)) return null;
    return { at: Number(dato.at) || 0, firma: String(dato.firma || ''), series: dato.series };
  } catch {
    return null;
  }
}

/** Lo último que se supo. Nunca lanza: sin nada guardado, lista vacía. */
export function getKavitaParaAudios(): SerieDePareja[] {
  return leer()?.series || [];
}

let enCurso: Promise<void> | null = null;

/** Vuelve a preguntar a Kavita si hace falta. Se puede llamar las veces que sea. */
export function refrescarKavitaParaAudios(audiolibros: AudioDePareja[]): Promise<void> {
  if (enCurso) return enCurso;
  if (!isKavitaConfigured() || audiolibros.length === 0) return Promise.resolve();
  const busquedas = busquedasParaAudios(audiolibros).sort();
  const firma = busquedas.join('\n');
  const guardado = leer();
  if (guardado && guardado.firma === firma && Date.now() - guardado.at < VALE_MS) return Promise.resolve();

  enCurso = (async () => {
    const porId = new Map<string, SerieDePareja>();
    // De una en una: son pocas, y el servidor es un PC de casa.
    for (const busqueda of busquedas) {
      const encontradas = await getKavitaSeriesByName(busqueda);
      for (const serie of encontradas) porId.set(String(serie.id), { serieId: String(serie.id), title: serie.name });
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), firma, series: [...porId.values()] } satisfies Guardado));
    window.dispatchEvent(new Event(KAVITA_PARA_AUDIOS_EVENT));
  })()
    .catch((error) => console.warn('[servidor] No se pudieron buscar en Kavita las novelas de los audiolibros:', error))
    .finally(() => { enCurso = null; });
  return enCurso;
}
