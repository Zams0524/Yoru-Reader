/**
 * Las parejas de «Leer y escuchar»: una novela y su audiolibro, juntos.
 *
 * Hay dos clases, y la sección enseña las dos:
 *
 *  - **De la biblioteca**: un libro que ya está en el aparato y su audiolibro de
 *    Audiobookshelf. Se puede leer escuchando ya.
 *  - **De Kavita**: una serie que está en el servidor pero todavía no en el aparato,
 *    con los audiolibros que le corresponden. Aquí falta traer la novela; lo que la
 *    sección dice es que merece la pena, porque su audio ya existe.
 *
 * Kavita y Audiobookshelf no se conocen entre sí: lo único que los une es el título.
 * Por eso toda la regla de emparejar está en `audiobookshelfService.ts`
 * (`audiobookMatchScore`, `unambiguousAudiobook`, `normalizeTitle`) y aquí solo se
 * aplica. Este fichero no toca el almacén ni la red: recibe lo que necesita, para
 * poder probarlo con datos de mentira.
 */

import {
  audiobookMatchScore,
  normalizeTitle,
  unambiguousAudiobook,
  volumeNumberOf,
  type AudiobookLink,
} from './audiobookshelfService';

/** Lo mínimo que hace falta saber de un audiolibro para emparejarlo. */
export interface AudioDePareja {
  /** El identificador que entiende Audiobookshelf. */
  itemId: string;
  title: string;
  author?: string;
}

export interface LibroDePareja {
  id: string;
  title: string;
  author?: string;
}

export interface SerieDePareja {
  /** El identificador que entiende Kavita. */
  serieId: string;
  title: string;
}

/**
 * De dónde sale la pareja: `vinculada` es un vínculo guardado (lo eligió el lector o
 * lo eligió el usuario a mano) y `encontrada` es la que sale de comparar títulos sin
 * que nadie la haya confirmado todavía.
 */
export type OrigenPareja = 'vinculada' | 'encontrada';

export interface ParejaBiblioteca<L extends LibroDePareja = LibroDePareja> {
  libro: L;
  audio: AudioDePareja;
  origen: OrigenPareja;
  /** El audiolibro viene partido en capítulos: el texto puede seguir a la voz. */
  conCapitulos: boolean;
}

export interface ParejaKavita<S extends SerieDePareja = SerieDePareja> {
  serie: S;
  /** Los audiolibros de la serie, por tomo. */
  audios: AudioDePareja[];
}

/**
 * Las parejas de la biblioteca, en el orden en que llegan los libros.
 *
 * El vínculo guardado manda siempre: si el usuario eligió un audiolibro a mano, ese
 * es, aunque el título se parezca más a otro. Solo cuando no hay vínculo se compara
 * por título, y solo vale si no hay duda (la misma regla que aplica el lector al
 * abrir el libro, para que lo que se promete aquí sea lo que allí va a pasar).
 */
export function parejasDeBiblioteca<L extends LibroDePareja>(
  libros: L[],
  audiolibros: AudioDePareja[],
  vinculoDe: (bookId: string) => AudiobookLink | null,
): ParejaBiblioteca<L>[] {
  const parejas: ParejaBiblioteca<L>[] = [];
  for (const libro of libros) {
    const vinculo = vinculoDe(libro.id);
    if (vinculo) {
      const conocido = audiolibros.find((item) => item.itemId === vinculo.itemId);
      parejas.push({
        libro,
        audio: { itemId: vinculo.itemId, title: vinculo.title || conocido?.title || '', author: conocido?.author },
        origen: 'vinculada',
        conCapitulos: (vinculo.chapters || 0) > 1,
      });
      continue;
    }
    if (audiolibros.length === 0) continue;
    const ordenados = audiolibros
      .map((item) => ({ item, score: audiobookMatchScore(libro, item as never) }))
      .sort((a, b) => b.score - a.score);
    const elegido = unambiguousAudiobook(ordenados);
    if (elegido) parejas.push({ libro, audio: elegido, origen: 'encontrada', conCapitulos: false });
  }
  return parejas;
}

/**
 * Las series de Kavita que tienen audiolibro y todavía no están en la biblioteca.
 *
 * Kavita lista series y Audiobookshelf lista tomos, así que aquí no se busca «el»
 * audiolibro sino todos los de la serie: el título sin tomo tiene que ser el mismo.
 * Igual de verdad, no parecido: «Serie A» y «Serie A 外伝» son dos series, y juntar
 * los audiolibros de una con la novela de la otra es peor que no juntar nada.
 *
 * Las que ya están en la biblioteca no salen: esas tienen su pareja arriba, con el
 * libro de verdad, y repetirlas aquí sería enseñar lo mismo dos veces.
 */
export function parejasDeKavita<S extends SerieDePareja>(
  series: S[],
  audiolibros: AudioDePareja[],
  titulosDeBiblioteca: string[],
): ParejaKavita<S>[] {
  if (series.length === 0 || audiolibros.length === 0) return [];

  const enBiblioteca = new Set(titulosDeBiblioteca.map((title) => normalizeTitle(title)).filter(Boolean));
  const porTitulo = new Map<string, AudioDePareja[]>();
  for (const audio of audiolibros) {
    const clave = normalizeTitle(audio.title);
    if (!clave) continue;
    const lista = porTitulo.get(clave) || [];
    lista.push(audio);
    porTitulo.set(clave, lista);
  }

  const parejas: ParejaKavita<S>[] = [];
  const vistas = new Set<string>();
  for (const serie of series) {
    const clave = normalizeTitle(serie.title);
    if (!clave || vistas.has(clave) || enBiblioteca.has(clave)) continue;
    const audios = porTitulo.get(clave);
    if (!audios?.length) continue;
    vistas.add(clave);
    parejas.push({ serie, audios: ordenarPorTomo(audios) });
  }
  return parejas;
}

/** Por número de tomo; los que no lo dicen, detrás y por título. */
function ordenarPorTomo(audios: AudioDePareja[]): AudioDePareja[] {
  return [...audios].sort((a, b) => {
    const tomoA = volumeNumberOf(a.title);
    const tomoB = volumeNumberOf(b.title);
    if (tomoA !== null && tomoB !== null && tomoA !== tomoB) return tomoA - tomoB;
    if (tomoA !== null && tomoB === null) return -1;
    if (tomoA === null && tomoB !== null) return 1;
    return a.title.localeCompare(b.title, 'ja', { numeric: true });
  });
}

/**
 * Bajo qué título se apunta lo escuchado en las estadísticas.
 *
 * Si el audiolibro es la otra mitad de una novela de la biblioteca, va al parte de la
 * novela: son el mismo libro, y con dos títulos las estadísticas lo contaban dos
 * veces en «libros» y lo partían en dos filas. Si va suelto, con su propio título.
 */
export function tituloParaEscucha(
  audio: { itemId: string; title: string },
  libros: LibroDePareja[],
  libroDeAudio: (itemId: string) => string | null,
): string {
  const bookId = libroDeAudio(audio.itemId);
  const libro = bookId ? libros.find((entry) => entry.id === bookId) : undefined;
  return libro?.title || audio.title || '';
}
