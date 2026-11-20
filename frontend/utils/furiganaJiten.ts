/*
  Furigana a partir de la lectura anotada que da Jiten: `日[にち]曜[よう]日[び]`.

  La forma de colocar cada lectura por su posición, y la tabla de 来る y 得る, vienen de la
  extensión oficial, Jiten Reader (https://github.com/Sirush/JitenReader,
  `src/background-worker/parser/parser.ts`), que es MIT:
  Copyright (c) 2025 chinokusari, Copyright (c) 2026 Sirus. Ver THIRD-PARTY-GRANTS.md.

  Va en un fichero sin dependencias para poder probarlo en Node (`tests/furigana-jiten.test.ts`).
*/

/** Una lectura de la forma de diccionario: qué trozo cubre y dónde cae en la palabra. */
export interface RubyJiten {
  /** El trozo que lleva la lectura encima: kanji, o un número (`１` en `１[いっ]本[ぽん]`). */
  base: string;
  lectura: string;
  /** Posición de `base` en la forma de diccionario sin anotar. */
  inicio: number;
  /** Detrás solo queda る: 来[く]る, あり得[う]る. Ahí la lectura cambia al conjugar. */
  antesDeRu: boolean;
}

/** Una lectura ya colocada sobre el texto que se ve. */
export interface RubyColocado {
  inicio: number;
  fin: number;
  lectura: string;
}

type LecturasPorPrefijo = readonly [prefijo: string, lectura: string][];

// Gana el primer prefijo que encaje, así que los largos van delante.
const LECTURAS_KURU: LecturasPorPrefijo = [
  ['ない', 'こ'], ['なか', 'こ'], ['なく', 'こ'], ['なけ', 'こ'], ['なきゃ', 'こ'],
  ['れば', 'く'], ['りゃ', 'く'], ['る', 'く'],
  ['な', 'き'], ['た', 'き'], ['て', 'き'], ['ま', 'き'], ['ち', 'き'], ['そう', 'き'],
  ['と', 'き'], ['や', 'き'], ['つ', 'き'], ['っ', 'き'],
  ['れ', 'こ'], ['ら', 'こ'], ['さ', 'こ'], ['よ', 'こ'], ['い', 'こ'], ['ず', 'こ'],
  ['ぬ', 'こ'], ['ね', 'こ'], ['ん', 'こ'],
];

// うる solo sobrevive en la forma llana y con べき; el resto de 得る se lee え (あり得ない).
const LECTURAS_URU: LecturasPorPrefijo = [
  ['る', 'う'],
  ['べ', 'う'],
];

const SIN_CORCHETES = /\[[^\]]*\]/g;

/**
 * Las lecturas de una forma anotada, cada una con su posición.
 *
 * La base es cualquier tramo que no sea kana, no solo kanji: en `１[いっ]本[ぽん]` el número
 * lleva su propia lectura. Antes solo se miraban los kanji y el いっ se perdía.
 */
export function rubiesDeAnotado(anotado: string): RubyJiten[] {
  const rubies: RubyJiten[] = [];
  if (!anotado) return rubies;
  const diccionario = anotado.replace(SIN_CORCHETES, '');
  // 1: lo de antes, sin lectura. 2: la base. 3: la lectura entre corchetes.
  const patron = /((?:.|\n)*?)([^぀-ゟ゠-ヿ[\]]+)\[([^\]]+)\]/g;
  let posicion = 0;
  for (const m of anotado.matchAll(patron)) {
    posicion += m[1].replace(SIN_CORCHETES, '').length;
    const base = m[2];
    rubies.push({
      base,
      lectura: m[3],
      inicio: posicion,
      antesDeRu: diccionario.slice(posicion + base.length) === 'る',
    });
    posicion += base.length;
  }
  return rubies;
}

/**
 * La lectura en kana de una forma anotada: `食[た]べる` → たべる, `１[いっ]本[ぽん]` → いっぽん.
 *
 * Antes solo se quitaban los kanji de delante del corchete, y un número se quedaba pegado a su
 * lectura: «１いっぽん».
 */
export function kanaDeAnotado(anotado: string): string {
  return (anotado || '')
    .replace(/[^぀-ゟ゠-ヿ[\]]+\[([^\]]+)\]/g, '$1')
    .replace(SIN_CORCHETES, '');
}

function lecturaSegunLoQueSigue(tabla: LecturasPorPrefijo, siguiente: string): string | undefined {
  const kana = siguiente.slice(0, 3).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  return tabla.find(([prefijo]) => kana.startsWith(prefijo))?.[1];
}

/** 来 y 得 cambian de lectura con la conjugación: 来ない es こない, 来て es きて. */
function lecturaDeVerboFinal(base: string, lectura: string, siguiente: string): string | undefined {
  if ((base === '来' || base === '來') && lectura === 'く') return lecturaSegunLoQueSigue(LECTURAS_KURU, siguiente);
  if (base === '得' && lectura === 'う') return lecturaSegunLoQueSigue(LECTURAS_URU, siguiente) ?? 'え';
  return lectura;
}

/**
 * Coloca las lecturas de la forma de diccionario sobre el texto que se ve, que puede estar
 * conjugado.
 *
 * Cada lectura va **por su posición**, no buscando su kanji: buscándolo, el segundo 日 de
 * 日曜日 encontraba la lectura del primero y salía にち・よう・にち. Una lectura cuyo trozo no
 * esté en el mismo sitio en lo que se ve se descarta, y las demás se quedan.
 */
export function colocarRubies(superficie: string, rubies: readonly RubyJiten[]): RubyColocado[] {
  const colocados: RubyColocado[] = [];
  for (const ruby of rubies) {
    const fin = ruby.inicio + ruby.base.length;
    if (superficie.slice(ruby.inicio, fin) !== ruby.base) continue;
    const lectura = ruby.antesDeRu
      ? lecturaDeVerboFinal(ruby.base, ruby.lectura, superficie.slice(fin))
      : ruby.lectura;
    if (!lectura) continue;
    colocados.push({ inicio: ruby.inicio, fin, lectura });
  }
  return colocados;
}
