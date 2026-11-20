/**
 * Las parejas de «Leer y escuchar»: una novela y su audiolibro, juntos.
 *
 * Hay dos clases, y la sección enseña las dos:
 *
 *  - **De la biblioteca**: un libro que ya está en el aparato y su audiolibro de
 *    Audiobookshelf. Se puede leer escuchando ya.
 *  - **De Kavita**: una novela que está en el servidor pero todavía no en el aparato,
 *    con el audiolibro que le corresponde, tomo a tomo. Aquí falta traer la novela;
 *    lo que la sección dice es que merece la pena, porque su audio ya existe.
 *
 * Kavita y Audiobookshelf no se conocen entre sí: lo único que los une es el título.
 * Por eso toda la regla de emparejar está en `audiobookshelfService.ts`
 * (`audiobookMatchScore`, `unambiguousAudiobook`, `normalizeTitle`) y aquí solo se
 * aplica. Este fichero no toca el almacén ni la red: recibe lo que necesita, para
 * poder probarlo con datos de mentira.
 */

import {
  AUDIOBOOK_AUTO_MATCH_SCORE,
  audiobookMatchScore,
  audiobookSearchQuery,
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

/** Un tomo de la obra: su entrada en Kavita y su audiolibro. */
export interface TomoConAudio<S extends SerieDePareja = SerieDePareja> {
  serie: S;
  audio: AudioDePareja;
  /** El número de tomo, cuando el título lo dice. */
  tomo: number | null;
}

/** Una obra de Kavita con los tomos que ya tienen audiolibro. */
export interface ParejaKavita<S extends SerieDePareja = SerieDePareja> {
  /** El título de la obra, sin tomo ni notas de editorial. */
  obra: string;
  tomos: TomoConAudio<S>[];
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

const ROMANOS: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15,
};

/**
 * El tomo que dice un título, también cuando lo dice en números romanos.
 *
 * `volumeNumberOf` entiende 第3巻, Vol. 3 o un 3 al final, que es como numera casi
 * todo el mundo. Pero hay catálogos que numeran «兵士の娘Ⅱ», y el audiolibro del
 * mismo tomo se llama «兵士の娘2»: sin esto, el segundo tomo no se reconocía como
 * tal y se emparejaba con el primero. NFKC ya convierte Ⅱ y Ｉ en letras corrientes;
 * aquí solo se leen cuando van al final, que es donde va un número de tomo.
 */
export function tomoDe(title: string): number | null {
  const numero = volumeNumberOf(title);
  if (numero !== null) return numero;
  const texto = title.normalize('NFKC').replace(/[\s」』)\]】]+$/u, '');
  const romano = texto.match(/(?:^|[^a-z])([ivx]{1,5})$/i);
  return romano ? ROMANOS[romano[1].toLowerCase()] ?? null : null;
}

/** El título sin su tomo, para saber si dos entradas son de la misma obra. */
function obraDe(title: string): string {
  const texto = title.normalize('NFKC');
  // El romano del final es el tomo solo si no hay otro número que lo sea.
  const sinRomano = volumeNumberOf(title) === null
    ? texto.replace(/([^a-z])[ivx]{1,5}[\s」』)\]】]*$/i, '$1')
    : texto;
  return normalizeTitle(sinRomano);
}

/**
 * Qué entrada de Kavita es la novela de cada audiolibro, agrupado por obra.
 *
 * Se va del audiolibro a la novela y no al revés, por tamaño: un Audiobookshelf de
 * casa tiene decenas de audiolibros y un Kavita, miles de entradas. Los candidatos
 * llegan ya buscados por nombre (ver `kavitaSeriesParaAudios`), y aquí se decide.
 *
 * La regla, por audiolibro:
 *  - tiene que ser la misma obra (título muy parecido una vez quitado el tomo);
 *  - y el mismo tomo. Si el audiolibro dice «3», vale la entrada que dice «3» y
 *    ninguna otra: «el tomo 3 se parece mucho al 4» es justo el error que hay que
 *    evitar. Si ninguno de los dos dice tomo, basta con la obra.
 *
 * Un audiolibro repetido en el servidor (pasa: el mismo tomo subido dos veces) no
 * hace dos parejas; se queda el primero. Y lo que ya está en la biblioteca no sale:
 * esa pareja está arriba, con el libro de verdad.
 */
export function parejasDeKavita<S extends SerieDePareja>(
  audiolibros: AudioDePareja[],
  candidatos: S[],
  titulosDeBiblioteca: string[] = [],
): ParejaKavita<S>[] {
  if (audiolibros.length === 0 || candidatos.length === 0) return [];

  const enBiblioteca = new Set(titulosDeBiblioteca.map((title) => `${obraDe(title)}#${tomoDe(title) ?? ''}`));
  const obras = new Map<string, ParejaKavita<S>>();
  const usadas = new Set<string>();

  for (const audio of audiolibros) {
    const obraAudio = obraDe(audio.title);
    if (!obraAudio) continue;
    const tomoAudio = tomoDe(audio.title);
    let mejor: { serie: S; score: number } | null = null;
    for (const serie of candidatos) {
      if (tomoDe(serie.title) !== tomoAudio) continue;
      const score = audiobookMatchScore({ title: serie.title }, { title: audio.title, author: audio.author || '' } as never);
      if (score < AUDIOBOOK_AUTO_MATCH_SCORE) continue;
      // A igualdad de parecido, la entrada de título más corto: es la edición normal
      // y no la «edición especial» o el recopilatorio que también se llama igual.
      if (!mejor || score > mejor.score || (score === mejor.score && serie.title.length < mejor.serie.title.length)) {
        mejor = { serie, score };
      }
    }
    if (!mejor) continue;
    const clave = `${obraAudio}#${tomoAudio ?? ''}`;
    if (usadas.has(clave) || enBiblioteca.has(clave)) continue;
    usadas.add(clave);
    const pareja = obras.get(obraAudio) || { obra: tituloDeObra(audio.title), tomos: [] };
    pareja.tomos.push({ serie: mejor.serie, audio, tomo: tomoAudio });
    obras.set(obraAudio, pareja);
  }

  const lista = [...obras.values()];
  for (const pareja of lista) pareja.tomos.sort((a, b) => (a.tomo ?? 0) - (b.tomo ?? 0));
  return lista.sort((a, b) => b.tomos.length - a.tomos.length || a.obra.localeCompare(b.obra, 'ja'));
}

/** El título de la obra para enseñarlo: sin la etiqueta de tomo de delante ni el número de detrás. */
function tituloDeObra(title: string): string {
  const limpio = title
    .normalize('NFKC')
    .replace(/^\s*[[【(][^\]】)]*[\]】)]\s*/u, '')
    .replace(/\s*(?:第\s*\d+\s*[巻卷話]|\d+\s*[巻卷]?|[「『][^」』]*[」』]?)\s*$/u, '')
    .trim();
  return limpio || title;
}

/**
 * Con qué texto buscar en Kavita la obra de un audiolibro: el primer tramo del
 * título. Corto a propósito: los dos catálogos escriben distinto los subtítulos
 * («～司書に…» contra « 〜司書に…»), pero el arranque del título lo escriben igual.
 */
export function busquedaDeObra(title: string): string {
  const base = audiobookSearchQuery(title);
  const tramo = base.split(/[\s~～〜。、・:：？?！!\-―—]+/u).find((parte) => parte.length >= 2);
  return (tramo || base).slice(0, 30);
}

/** Las búsquedas distintas que hacen falta para un catálogo de audiolibros. */
export function busquedasParaAudios(audiolibros: AudioDePareja[]): string[] {
  return [...new Set(audiolibros.map((audio) => busquedaDeObra(audio.title)).filter(Boolean))];
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
