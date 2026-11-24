/**
 * Orden de los tomos de una serie o colección, y qué tomos van aparte.
 *
 * Kavita y Audiobookshelf devuelven los títulos de una colección en el orden en
 * que se añadieron, y ordenarlos solo por texto tampoco basta: «短編集１０» cae
 * delante de «21», el tomo 2 escrito «第二巻» no se entiende como 2, y las
 * historias IF (rutas alternativas) quedan mezcladas con el hilo principal.
 *
 * Aquí se lee de cada título:
 *  - el número de tomo: 3, ３, 第3巻, 第三巻, 三巻, Vol. 3, (3), 上/中/下…
 *  - el tipo: principal, IF, relatos cortos o extra (Ex, 外伝, 番外編…)
 *  - la serie a la que pertenece (el texto que va antes del número), para que en
 *    una colección con varias series cada una quede junta y en orden.
 *
 * Todo sale del texto del título: no hay listas de series concretas.
 */

export type TipoTomo = 'principal' | 'if' | 'cortos' | 'extra';

export const ORDEN_TIPOS: TipoTomo[] = ['principal', 'if', 'cortos', 'extra'];

const KANJI_DIGITO: Record<string, number> = {
  〇: 0, 零: 0, 一: 1, 壱: 1, 二: 2, 弐: 2, 三: 3, 参: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9,
};
const KANJI_UNIDAD: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
const KANJI_NUM = '[〇零一壱二弐三参四五六七八九十百千]+';

/** 二十三 → 23, 百二 → 102, 十 → 10, 二〇 → 20. Devuelve null si no es un número. */
export function kanjiANumero(texto: string): number | null {
  if (!texto || !new RegExp(`^${KANJI_NUM}$`).test(texto)) return null;
  // Sin 十/百/千 se lee cifra a cifra: 二〇 → 20.
  if (![...texto].some((c) => c in KANJI_UNIDAD)) {
    return Number([...texto].map((c) => KANJI_DIGITO[c]).join(''));
  }
  let total = 0;
  let actual = 0;
  for (const c of texto) {
    if (c in KANJI_DIGITO) actual = KANJI_DIGITO[c];
    else {
      total += (actual || 1) * KANJI_UNIDAD[c];
      actual = 0;
    }
  }
  return total + actual;
}

const ROMANO: Record<string, number> = {
  Ⅰ: 1, Ⅱ: 2, Ⅲ: 3, Ⅳ: 4, Ⅴ: 5, Ⅵ: 6, Ⅶ: 7, Ⅷ: 8, Ⅸ: 9, Ⅹ: 10, Ⅺ: 11, Ⅻ: 12,
};

/** Quita del final las notas entre paréntesis que no son el tomo: (MF文庫J), 【電子特典付き】… */
function quitarNotasFinales(titulo: string): string {
  const NOTA_FINAL = /[(（[［【〔]([^)）\]］】〕]*)[)）\]］】〕]\s*$/u;
  let out = titulo.trim();
  for (;;) {
    const m = out.match(NOTA_FINAL);
    if (!m || m.index === undefined) break;
    if (/^\s*[\d.]+\s*$/.test(m[1])) break; // «(4)» es el tomo.
    const recortado = out.slice(0, m.index).trim();
    if (!recortado || recortado === out) break;
    out = recortado;
  }
  return out;
}

/** Título preparado: NFKC (ancho completo → normal), romanos Ⅲ → 3, sin notas de editorial al final. */
function preparar(titulo: string): string {
  let t = (titulo || '').replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]/g, (c) => ` ${ROMANO[c]} `);
  t = t.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return quitarNotasFinales(t);
}

export interface InfoTomo {
  /** Número de tomo, o null si el título no lo dice. */
  numero: number | null;
  tipo: TipoTomo;
  /** Texto que va antes del número, reducido para comparar: identifica la serie. */
  base: string;
}

/** Un número dentro de un título: dónde empieza y cuánto vale. */
interface Hallazgo { valor: number; indice: number }

function buscarNumero(t: string): Hallazgo | null {
  const intentos: Array<[RegExp, (m: RegExpMatchArray) => number | null]> = [
    // 第3巻, 第三巻, 第3部, 第3章
    [new RegExp(`第\\s*(\\d+(?:\\.\\d+)?|${KANJI_NUM})\\s*[巻卷部章話集]`), (m) => leer(m[1])],
    // 3巻, 三巻
    [new RegExp(`(\\d+(?:\\.\\d+)?|${KANJI_NUM})\\s*[巻卷]`), (m) => leer(m[1])],
    // Vol. 3, Volume 3, v3, Book 3, Ep.3, #3
    [/(?:(?<![A-Za-z])(?:vol(?:ume)?|v|book|ep(?:isode)?)|#)\.?\s*(\d+(?:\.\d+)?)/i, (m) => Number(m[1])],
    // (3), [3]
    [/[(（[［]\s*(\d+(?:\.\d+)?)\s*[)）\]］]/, (m) => Number(m[1])],
    // 上 / 中 / 下 al final o entre paréntesis: 上=1, 中=2, 下=3
    [/(?:^|[\s(（〈《【])([上中下])(?:巻)?\s*[)）〉》】]?\s*$/, (m) => ({ 上: 1, 中: 2, 下: 3 } as Record<string, number>)[m[1]]],
    // Un número suelto al final: «… 21», «…短編集10». Va antes que el del medio
    // para que «86 エイティシックス 3» sea el 3 y no el 86.
    [/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*[」』)）\]］〉》]*\s*$/, (m) => Number(m[1])],
    // Un número seguido de un subtítulo: «… 21 ～副題～», «… Ex4 最優紀行»
    [/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:[-–—~〜～:：]|\s+\S)/, (m) => Number(m[1])],
  ];
  for (const [re, valor] of intentos) {
    const m = t.match(re);
    if (m && m.index !== undefined) {
      const v = valor(m);
      if (v !== null && Number.isFinite(v)) return { valor: v, indice: m.index };
    }
  }
  return null;
}

function leer(s: string): number | null {
  if (/^\d/.test(s)) return Number(s);
  return kanjiANumero(s);
}

const RE_IF = [
  /(?<![A-Za-z])IF(?![A-Za-z])/, // IF en mayúsculas, también pegado a japonés: 「強欲のIF」
  /(?<![A-Za-z])if\s*(?:route|ルート|story|ストーリー|編|物語)/i,
  /(?<![A-Za-z])what\s+if(?![A-Za-z])/i,
  /イフ(?:ストーリー|ルート)|ifルート|分岐(?:ルート|世界)|アナザー(?:ルート|ストーリー)|another\s+route|alternate\s+(?:route|ending|timeline)/i,
];
const RE_CORTOS = /短編集|短篇集|短編|短篇|掌編|ショートストーリー|short\s*stor(?:y|ies)|アンソロジー|anthology/i;
const RE_EXTRA = /(?<![A-Za-z])ex(?:\s*\d+|(?![A-Za-z]))|外伝|番外編|番外|スピンオフ|spin[-\s]?off|side\s*stor(?:y|ies)|公式(?:ガイド|ファンブック|アンソロジー)|ファンブック|設定資料|ガイドブック|guide\s*book|fan\s*book|画集|art\s*book|ビジュアルブック/i;

/** Qué clase de tomo es, mirando solo el título. */
export function tipoDeTomo(titulo: string): TipoTomo {
  const t = (titulo || '').normalize('NFKC');
  if (RE_IF.some((re) => re.test(t))) return 'if';
  if (RE_CORTOS.test(t)) return 'cortos';
  if (RE_EXTRA.test(t)) return 'extra';
  return 'principal';
}

/** Texto reducido para saber si dos títulos son de la misma serie. */
function reducir(texto: string): string {
  return texto
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .replace(/(?:第|vol(?:ume)?|book|v)$/i, '');
}

export function infoTomo(titulo: string): InfoTomo {
  const t = preparar(titulo);
  const hallazgo = buscarNumero(t);
  const antes = hallazgo ? t.slice(0, hallazgo.indice) : t;
  return {
    numero: hallazgo ? hallazgo.valor : null,
    tipo: tipoDeTomo(titulo),
    base: reducir(antes),
  };
}

const colador = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

/** Compara dos tomos de la misma serie y tipo: por número, y sin número al final. */
function compararTomos(a: { titulo: string; info: InfoTomo }, b: { titulo: string; info: InfoTomo }): number {
  const na = a.info.numero;
  const nb = b.info.numero;
  if (na !== null && nb !== null && na !== nb) return na - nb;
  if (na === null && nb !== null) return 1;
  if (na !== null && nb === null) return -1;
  return colador.compare(a.titulo, b.titulo);
}

export interface SeccionSerie<T> {
  tipo: TipoTomo;
  items: T[];
}

/**
 * Ordena y separa los títulos de una serie o colección.
 *
 * Devuelve las secciones en orden: principal, IF, relatos cortos, extra (solo las
 * que tienen algo). Dentro de cada sección, los títulos de la misma serie van
 * juntos y por número de tomo; las series se ordenan por el orden en que aparece
 * la primera de cada una en la lista original (así se respeta la colección que el
 * usuario armó en el servidor si mezcla series distintas).
 */
export function ordenarSerie<T>(items: T[], tituloDe: (item: T) => string): SeccionSerie<T>[] {
  const datos = items.map((item, posicion) => {
    const titulo = tituloDe(item) || '';
    return { item, titulo, info: infoTomo(titulo), posicion };
  });

  // Agrupa por serie: dos bases son la misma serie si una empieza por la otra.
  const grupos: Array<{ base: string; posicion: number }> = [];
  const grupoDe = (base: string, posicion: number): number => {
    const i = grupos.findIndex((g) => g.base === base
      || (g.base && base && (g.base.startsWith(base) || base.startsWith(g.base))));
    if (i >= 0) {
      if (base.length && base.length < grupos[i].base.length) grupos[i].base = base;
      grupos[i].posicion = Math.min(grupos[i].posicion, posicion);
      return i;
    }
    grupos.push({ base, posicion });
    return grupos.length - 1;
  };
  // Primero los principales, que son los que mejor fijan el nombre de la serie.
  const conGrupo = datos.map((d) => ({ ...d, grupo: -1 }));
  for (const d of conGrupo.filter((x) => x.info.tipo === 'principal')) d.grupo = grupoDe(d.info.base, d.posicion);
  for (const d of conGrupo.filter((x) => x.info.tipo !== 'principal')) d.grupo = grupoDe(d.info.base, d.posicion);

  return ORDEN_TIPOS
    .map((tipo) => {
      const delTipo = conGrupo
        .filter((d) => d.info.tipo === tipo)
        .sort((a, b) => {
          if (a.grupo !== b.grupo) return grupos[a.grupo].posicion - grupos[b.grupo].posicion;
          return compararTomos(a, b);
        });
      return { tipo, items: delTipo.map((d) => d.item) };
    })
    .filter((s) => s.items.length > 0);
}

/** Nombre visible de cada sección. */
export function nombreSeccion(tipo: TipoTomo, es: boolean): string {
  switch (tipo) {
    case 'principal': return es ? 'Historia principal' : 'Main story';
    case 'if': return es ? 'Historias IF (rutas alternativas)' : 'IF stories (alternate routes)';
    case 'cortos': return es ? 'Relatos cortos' : 'Short stories';
    case 'extra': return es ? 'Extras y spin-offs' : 'Extras and spin-offs';
  }
}
