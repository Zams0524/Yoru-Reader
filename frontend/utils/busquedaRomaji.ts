/**
 * Buscar títulos japoneses escribiendo en romaji.
 *
 * «re zero» tiene que encontrar «Ｒｅ：ゼロから始める異世界生活», y antes no lo hacía: los
 * buscadores comparaban el texto tal cual, en minúsculas, y «zero» no está dentro de
 * «ゼロ». Aquí cada texto se compara de tres maneras, y basta con que una acierte:
 *
 *  1. **Plano**: NFKC (Ｒｅ → re, ： → :), minúsculas, sin tildes y con la katakana
 *     pasada a hiragana. Así «ゼロ» y «ぜろ» son lo mismo, y lo japonés escrito en
 *     japonés sigue encontrándose como siempre.
 *  2. **Clave fonética**: el texto pasado a kana y de la kana a un romaji canónico, sin
 *     espacios ni signos y con las vocales largas juntadas. Lo que el usuario escribe
 *     pasa por el mismo camino, así que «shi»/«si», «tsu»/«tu», «zero»/«ゼロ» o
 *     «shousetsu»/«shōsetsu»/«しょうせつ» acaban igual.
 *  3. **Lectura**: lo que está en kanji (異世界) no tiene kana que convertir. Si el
 *     tokenizador Kuromoji ya está cargado, el texto se lee con él y la lectura pasa
 *     por la misma clave: «isekai» encuentra «異世界». `useLecturasJapones` lo carga la
 *     primera vez que se busca con letras latinas; hasta entonces, 1 y 2 bastan para
 *     todo lo que esté en kana.
 *
 * Cada palabra de la búsqueda tiene que estar (en cualquiera de las tres formas), en
 * cualquier orden; y la búsqueda entera sin espacios también vale («rezero»).
 */
import { useEffect, useState } from 'react';
import { getTokenizerInstance, initTokenizer } from './japanese';

/* ------------------------------------------------------------------ */
/*  Romaji → hiragana                                                  */
/* ------------------------------------------------------------------ */

/**
 * Las grafías Hepburn van primero: al invertir la tabla para pasar de kana a romaji
 * gana la primera que aparece de cada kana.
 */
const ROMAJI: Array<[string, string]> = [
  ['a', 'あ'], ['i', 'い'], ['u', 'う'], ['e', 'え'], ['o', 'お'],
  ['ka', 'か'], ['ki', 'き'], ['ku', 'く'], ['ke', 'け'], ['ko', 'こ'],
  ['ga', 'が'], ['gi', 'ぎ'], ['gu', 'ぐ'], ['ge', 'げ'], ['go', 'ご'],
  ['sa', 'さ'], ['shi', 'し'], ['su', 'す'], ['se', 'せ'], ['so', 'そ'],
  ['za', 'ざ'], ['ji', 'じ'], ['zu', 'ず'], ['ze', 'ぜ'], ['zo', 'ぞ'],
  ['ta', 'た'], ['chi', 'ち'], ['tsu', 'つ'], ['te', 'て'], ['to', 'と'],
  ['da', 'だ'], ['di', 'ぢ'], ['du', 'づ'], ['de', 'で'], ['do', 'ど'],
  ['na', 'な'], ['ni', 'に'], ['nu', 'ぬ'], ['ne', 'ね'], ['no', 'の'],
  ['ha', 'は'], ['hi', 'ひ'], ['fu', 'ふ'], ['he', 'へ'], ['ho', 'ほ'],
  ['ba', 'ば'], ['bi', 'び'], ['bu', 'ぶ'], ['be', 'べ'], ['bo', 'ぼ'],
  ['pa', 'ぱ'], ['pi', 'ぴ'], ['pu', 'ぷ'], ['pe', 'ぺ'], ['po', 'ぽ'],
  ['ma', 'ま'], ['mi', 'み'], ['mu', 'む'], ['me', 'め'], ['mo', 'も'],
  ['ya', 'や'], ['yu', 'ゆ'], ['yo', 'よ'],
  ['ra', 'ら'], ['ri', 'り'], ['ru', 'る'], ['re', 'れ'], ['ro', 'ろ'],
  ['wa', 'わ'], ['wo', 'を'],
  ['kya', 'きゃ'], ['kyu', 'きゅ'], ['kyo', 'きょ'],
  ['gya', 'ぎゃ'], ['gyu', 'ぎゅ'], ['gyo', 'ぎょ'],
  ['sha', 'しゃ'], ['shu', 'しゅ'], ['she', 'しぇ'], ['sho', 'しょ'],
  ['ja', 'じゃ'], ['ju', 'じゅ'], ['je', 'じぇ'], ['jo', 'じょ'],
  ['cha', 'ちゃ'], ['chu', 'ちゅ'], ['che', 'ちぇ'], ['cho', 'ちょ'],
  ['nya', 'にゃ'], ['nyu', 'にゅ'], ['nyo', 'にょ'],
  ['hya', 'ひゃ'], ['hyu', 'ひゅ'], ['hyo', 'ひょ'],
  ['bya', 'びゃ'], ['byu', 'びゅ'], ['byo', 'びょ'],
  ['pya', 'ぴゃ'], ['pyu', 'ぴゅ'], ['pyo', 'ぴょ'],
  ['mya', 'みゃ'], ['myu', 'みゅ'], ['myo', 'みょ'],
  ['rya', 'りゃ'], ['ryu', 'りゅ'], ['ryo', 'りょ'],
  ['fa', 'ふぁ'], ['fi', 'ふぃ'], ['fe', 'ふぇ'], ['fo', 'ふぉ'],
  ['wi', 'うぃ'], ['we', 'うぇ'],
  ['va', 'ゔぁ'], ['vi', 'ゔぃ'], ['vu', 'ゔ'], ['ve', 'ゔぇ'], ['vo', 'ゔぉ'],
  // «ti» es ティ (パーティー), no チ: en títulos sale mucho más como préstamo.
  ['ti', 'てぃ'],
  // Kunrei y variantes: solo para leer lo que escribe el usuario.
  ['tu', 'つ'], ['si', 'し'], ['zi', 'じ'], ['hu', 'ふ'], ['tsa', 'つぁ'],
  ['sya', 'しゃ'], ['syu', 'しゅ'], ['syo', 'しょ'],
  ['zya', 'じゃ'], ['zyu', 'じゅ'], ['zyo', 'じょ'],
  ['jya', 'じゃ'], ['jyu', 'じゅ'], ['jyo', 'じょ'],
  ['tya', 'ちゃ'], ['tyu', 'ちゅ'], ['tyo', 'ちょ'],
  ['cya', 'ちゃ'], ['cyu', 'ちゅ'], ['cyo', 'ちょ'],
  ['ca', 'か'], ['ci', 'し'], ['cu', 'く'], ['ce', 'せ'], ['co', 'こ'],
  ['la', 'ら'], ['li', 'り'], ['lu', 'る'], ['le', 'れ'], ['lo', 'ろ'],
];

const A_KANA = new Map<string, string>(ROMAJI);
const LARGO_MAX = 3;

/** Hiragana (o kana con dígrafos) → romaji canónico. を se lee «o», como se pronuncia. */
const A_ROMAJI = new Map<string, string>();
for (const [romaji, kana] of ROMAJI) if (!A_ROMAJI.has(kana)) A_ROMAJI.set(kana, romaji);
A_ROMAJI.set('を', 'o');
A_ROMAJI.set('ん', 'n');
// Kana pequeñas sueltas (ァ en ヴァ ya va en la tabla; las demás, por si acaso).
for (const [pequeña, normal] of [['ぁ', 'a'], ['ぃ', 'i'], ['ぅ', 'u'], ['ぇ', 'e'], ['ぉ', 'o'], ['ゃ', 'ya'], ['ゅ', 'yu'], ['ょ', 'yo'], ['ゎ', 'wa']] as const) {
  A_ROMAJI.set(pequeña, normal);
}

const VOCAL = /[aeiouy]/;
const CONSONANTE = /[bcdfghjklmpqrstvwxz]/;

/**
 * Pasa a hiragana lo que esté en romaji y deja lo demás como está (kanji, kana,
 * números, letras que no forman sílaba). Espera el texto ya en minúsculas.
 */
export function romajiAHiragana(texto: string): string {
  let out = '';
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    const siguiente = texto[i + 1];
    // Consonante doble (kk, tt, ss…) → っ. «tch» también (matcha → まっちゃ).
    if (CONSONANTE.test(c) && (siguiente === c || (c === 't' && siguiente === 'c' && texto[i + 2] === 'h'))) {
      out += 'っ';
      i += 1;
      continue;
    }
    if (c === 'n') {
      if (siguiente === "'") { out += 'ん'; i += 2; continue; }
      if (siguiente === 'n' && !VOCAL.test(texto[i + 2] || '')) { out += 'ん'; i += 2; continue; }
      if (!siguiente || !VOCAL.test(siguiente)) { out += 'ん'; i += 1; continue; }
    }
    let encontrado = false;
    for (let largo = LARGO_MAX; largo >= 1; largo -= 1) {
      const kana = A_KANA.get(texto.slice(i, i + largo));
      if (kana) {
        out += kana;
        i += largo;
        encontrado = true;
        break;
      }
    }
    if (!encontrado) {
      out += c === '-' ? 'ー' : c;
      i += 1;
    }
  }
  return out;
}

/** Hiragana → romaji canónico. Lo que no es kana se queda igual. */
export function hiraganaARomaji(texto: string): string {
  let out = '';
  let duplicar = false;
  let i = 0;
  while (i < texto.length) {
    const dos = A_ROMAJI.get(texto.slice(i, i + 2));
    const uno = dos ? undefined : A_ROMAJI.get(texto[i]);
    const c = texto[i];
    i += dos ? 2 : 1;
    if (c === 'っ') { duplicar = true; continue; }
    if (c === 'ー') continue;
    const romaji = dos || uno || c;
    out += duplicar && /^[a-z]/.test(romaji) ? romaji[0] + romaji : romaji;
    duplicar = false;
  }
  return out;
}

export function katakanaAHiragana(texto: string): string {
  return texto.replace(/[ァ-ヶ]/g, (letra) => String.fromCharCode(letra.charCodeAt(0) - 0x60));
}

export function hiraganaAKatakana(texto: string): string {
  return texto.replace(/[ぁ-ゖ]/g, (letra) => String.fromCharCode(letra.charCodeAt(0) + 0x60));
}

/* ------------------------------------------------------------------ */
/*  Normalización                                                       */
/* ------------------------------------------------------------------ */

/**
 * NFKC, minúsculas, sin tildes ni macrones, katakana → hiragana. Las tildes se quitan
 * descomponiendo y volviendo a componer: quitar a lo bruto las marcas combinables
 * también le quitaría el dakuten a が.
 */
export function normalizarTexto(texto: string): string {
  return katakanaAHiragana(
    texto
      .normalize('NFKC')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .normalize('NFC'),
  );
}

function juntarVocales(romaji: string): string {
  return romaji.replace(/([aeiou])\1+/g, '$1').replace(/ou/g, 'o');
}

const CACHE_MAX = 20000;
function guardar(cache: Map<string, string>, clave: string, valor: string): string {
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(clave, valor);
  return valor;
}

const clavesFoneticas = new Map<string, string>();

/** El texto en romaji canónico, sin espacios ni signos: lo que se compara. */
export function claveFonetica(texto: string): string {
  const guardada = clavesFoneticas.get(texto);
  if (guardada !== undefined) return guardada;
  const romaji = hiraganaARomaji(romajiAHiragana(normalizarTexto(texto)));
  return guardar(clavesFoneticas, texto, juntarVocales(romaji.replace(/[^\p{L}\p{N}]+/gu, '')));
}

const lecturas = new Map<string, string>();
const TIENE_KANJI = /[㐀-䶿一-鿿豈-﫿]/;

/**
 * La clave fonética de cómo se lee el texto, con Kuromoji. `null` si el texto no
 * tiene kanji (la clave normal ya lo cubre) o si el tokenizador aún no está cargado.
 */
export function claveLectura(texto: string): string | null {
  if (!TIENE_KANJI.test(texto)) return null;
  const guardada = lecturas.get(texto);
  if (guardada !== undefined) return guardada;
  const tokenizador = getTokenizerInstance();
  if (!tokenizador) return null;
  try {
    const tokens: any[] = tokenizador.tokenize(texto.normalize('NFKC'));
    const kana = tokens.map((token) => {
      // Las partículas は y へ se dicen «wa» y «e».
      if (token.pos === '助詞' && token.surface_form === 'は') return 'わ';
      if (token.pos === '助詞' && token.surface_form === 'へ') return 'え';
      const lectura = token.reading;
      return lectura && lectura !== '*' ? lectura : token.surface_form;
    }).join('');
    return guardar(lecturas, texto, claveFonetica(kana));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Buscador                                                            */
/* ------------------------------------------------------------------ */

export type Buscador = (...campos: Array<string | null | undefined | false>) => boolean;

const TIENE_LETRA = /[\p{L}\p{N}]/u;

/**
 * Prepara la búsqueda una vez y devuelve con qué comprobar cada elemento. `null` si la
 * búsqueda está vacía: entonces no se filtra nada.
 */
export function crearBuscador(busqueda: string): Buscador | null {
  const texto = busqueda.trim();
  if (!texto) return null;
  const plano = normalizarTexto(texto);
  const claveTodo = claveFonetica(texto);
  const terminos = texto
    .split(/\s+/)
    .map((termino) => ({ plano: normalizarTexto(termino), clave: claveFonetica(termino) }))
    .filter((termino) => TIENE_LETRA.test(termino.plano));
  if (!terminos.length && !claveTodo) {
    // Solo signos («：»): se busca tal cual.
    return (...campos) => normalizarTexto(campos.filter(Boolean).join(' ')).includes(plano);
  }

  return (...campos) => {
    const hayTexto = campos.filter(Boolean).join(' ');
    if (!hayTexto) return false;
    const hayPlano = normalizarTexto(hayTexto);
    if (hayPlano.includes(plano)) return true;
    const hayClave = claveFonetica(hayTexto);
    let hayLectura: string | null | undefined;
    const contiene = (clave: string): boolean => {
      if (!clave) return false;
      if (hayClave.includes(clave)) return true;
      if (hayLectura === undefined) hayLectura = claveLectura(hayTexto);
      return !!hayLectura && hayLectura.includes(clave);
    };
    if (contiene(claveTodo)) return true;
    return terminos.length > 0 && terminos.every((termino) => hayPlano.includes(termino.plano) || contiene(termino.clave));
  };
}

/** Atajo para un solo elemento. Una búsqueda vacía lo deja pasar todo. */
export function coincideBusqueda(busqueda: string, ...campos: Array<string | null | undefined | false>): boolean {
  const buscador = crearBuscador(busqueda);
  return buscador ? buscador(...campos) : true;
}

export function tieneRomaji(busqueda: string): boolean {
  return /[a-z]/i.test(busqueda.normalize('NFKC'));
}

/**
 * Qué mandar a un buscador de servidor (Kavita, Audiobookshelf), que solo sabe buscar
 * el texto tal cual. Con romaji se prueba además en katakana y hiragana: la búsqueda
 * entera y su palabra más larga, que es la que más filtra. Lo que devuelvan hay que
 * pasarlo luego por `crearBuscador`, porque «ゼロ» sola trae más de lo que se pidió.
 */
export function variantesParaServidor(busqueda: string, maximo = 4): string[] {
  const texto = busqueda.trim();
  if (!texto) return [];
  const variantes = new Set<string>([texto]);
  if (tieneRomaji(texto)) {
    const aKana = (parte: string): string | null => {
      const hira = romajiAHiragana(normalizarTexto(parte).replace(/[^\p{L}\p{N}]+/gu, ''));
      return hira && !/[a-z]/.test(hira) ? hira : null;
    };
    const terminos = texto.split(/\s+/).filter(Boolean);
    const todo = aKana(terminos.join(''));
    const masLargo = [...terminos].sort((a, b) => b.length - a.length)[0];
    const largo = masLargo ? aKana(masLargo) : null;
    if (todo) variantes.add(hiraganaAKatakana(todo));
    if (largo) {
      variantes.add(hiraganaAKatakana(largo));
      variantes.add(largo);
    }
    if (todo) variantes.add(todo);
  }
  return [...variantes].slice(0, maximo);
}

/**
 * Carga Kuromoji la primera vez que se busca con letras latinas, para que los kanji
 * también se encuentren en romaji. Devuelve un número que cambia cuando ya está
 * listo: ponlo en las dependencias del `useMemo` que filtra.
 */
export function useLecturasJapones(busqueda: string): number {
  const [listo, setListo] = useState(() => (getTokenizerInstance() ? 1 : 0));
  const quiere = tieneRomaji(busqueda);
  useEffect(() => {
    if (!quiere || listo) return;
    let vivo = true;
    initTokenizer()
      .then(() => { if (vivo) setListo(1); })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, [quiere, listo]);
  return listo;
}
