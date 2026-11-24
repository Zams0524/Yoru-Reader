import { crearBuscador, normalizarTexto } from './busquedaRomaji';

/**
 * Colecciones que se llenan solas.
 *
 * Cuando entra un libro nuevo —en Kavita, en Audiobookshelf o en la biblioteca del
 * aparato— aquí se decide en qué colecciones ya hechas encaja, para que nadie tenga
 * que ir a meterlo a mano. Lo pidió zams (24 nov 2026).
 *
 * Tres pistas, y basta con una:
 *
 *  1. **El nombre de la colección está en el título.** «Re:Zero» recoge
 *     «Ｒｅ：ゼロから始める異世界生活 第五章», con el mismo buscador que la biblioteca
 *     (`busquedaRomaji.ts`), así que el romaji del nombre encuentra la kana del título.
 *  2. **Es de la misma serie que algo que ya está dentro.** «Ascendance of a Bookworm»
 *     no se parece en nada a «本好きの下剋上», pero si la colección ya tiene el primer
 *     tomo, el quinto entra por serie: mismo campo `series`, o el mismo título sin el
 *     número del tomo.
 *  3. **Género o etiqueta.** Una colección como «Isekai & Reencarnación» se parte por
 *     los «&», «y», «/»… y cada trozo se busca en los géneros y etiquetas que trae el
 *     servidor, en español, inglés o japonés (異世界, isekai, «Isekai»).
 *
 * Lo que **no** se hace es crear colecciones nuevas. Una por serie ya la da la vista
 * de Series, y una por género llenaría Inicio de filas que nadie pidió: aquí solo se
 * completa lo que el usuario o el servidor ya decidieron tener.
 *
 * Todo esto es puro, sin red ni almacenamiento, para poder probarlo
 * (`tests/colecciones-inteligentes.test.ts`).
 */

/** Lo que hace falta saber de un libro para clasificarlo. */
export interface Clasificable {
  title: string;
  /** Otros nombres del mismo libro: el japonés, el traducido (Kavita los da). */
  altTitles?: string[];
  series?: string;
  genres?: string[];
  tags?: string[];
}

/** Por qué entró, para poder decirlo en pantalla si hace falta. */
export type Motivo = 'titulo' | 'serie' | 'genero';

/* ------------------------------------------------------------------ */
/*  Géneros                                                             */
/* ------------------------------------------------------------------ */

/**
 * Cada grupo son maneras de decir lo mismo. Kavita trae los géneros como los tenga
 * el EPUB o el agregador (en inglés casi siempre), Audiobookshelf igual, y las
 * colecciones las nombra cada uno en su idioma.
 */
const SINONIMOS: string[][] = [
  ['isekai', '異世界', 'otro mundo', 'another world'],
  ['reencarnacion', 'reincarnation', '転生', 'tensei', 'transmigration'],
  ['sci-fi', 'scifi', 'ciencia ficcion', 'science fiction', 'sf'],
  ['realidad virtual', 'virtual reality', 'vr', 'vrmmo', 'mmorpg', 'game world', 'videojuegos'],
  ['fantasia oscura', 'dark fantasy', 'ダークファンタジー'],
  ['fantasia', 'fantasy', 'ファンタジー'],
  ['romance', 'romantico', 'amor', 'love', '恋愛', 'ラブコメ', 'romcom', 'rom-com'],
  ['comedia', 'comedy', 'humor', 'コメディ'],
  ['accion', 'action', 'アクション'],
  ['aventura', 'adventure', '冒険'],
  ['misterio', 'mystery', 'ミステリー', '推理', 'detective'],
  ['terror', 'horror', 'ホラー'],
  ['drama', 'ドラマ'],
  ['recuentos de la vida', 'slice of life', '日常', 'vida cotidiana'],
  ['escolar', 'school', 'school life', 'vida escolar', '学園'],
  ['psicologico', 'psychological', 'thriller', 'suspense', 'サスペンス'],
  ['mecha', 'robots', 'ロボット'],
  ['deportes', 'sports', 'スポーツ'],
  ['harem', 'haren', 'ハーレム'],
  ['sobrenatural', 'supernatural', '怪異'],
  ['historico', 'historical', '歴史'],
  ['militar', 'military', 'guerra', 'war', '戦記'],
  ['magia', 'magic', '魔法'],
  ['gastronomia', 'cocina', 'cooking', 'food', 'グルメ', '料理'],
  ['villana', 'villainess', '悪役令嬢', 'akuyaku reijou'],
];

/** Sin tildes, sin mayúsculas, con los guiones y signos como espacios. */
function plano(texto: string): string {
  return normalizarTexto(texto).replace(/[\s\-_.・:：]+/g, ' ').trim();
}

const GRUPO_DE = new Map<string, number>();
SINONIMOS.forEach((grupo, indice) => {
  for (const palabra of grupo) GRUPO_DE.set(plano(palabra), indice);
});

const TIENE_JAPONES = /[぀-ヿ㐀-鿿]/;

/**
 * Los trozos de un nombre de colección que podrían ser géneros, con lo que vaya entre
 * paréntesis incluido. Las colecciones del servidor de Yoru se llaman así:
 * «Isekai & Reencarnación (異世界・転生)» → «isekai», «reencarnacion», «異世界», «転生».
 */
export function terminosDeGenero(nombre: string): string[] {
  return nombre
    .split(/\s*(?:&|＆|\+|\/|,|、|・|[()（）]|\s+y\s+|\s+and\s+|\s+e\s+)\s*/i)
    .map(plano)
    .filter((termino) => termino.length >= 2);
}

/**
 * Lo que un trozo pide, palabra a palabra. Un trozo conocido entero («realidad
 * virtual», «異世界») es un requisito solo. Uno que no («Romance Escolar») vale si
 * todas sus palabras son géneros, y entonces pide todas: romance **y** escolar, no
 * cualquier romance. Si alguna palabra no se conoce, el trozo no cuenta.
 */
function requisitosDe(nombre: string): string[][] {
  const requisitos: string[][] = [];
  for (const termino of terminosDeGenero(nombre)) {
    if (GRUPO_DE.has(termino)) {
      requisitos.push([termino]);
      continue;
    }
    const palabras = termino.split(' ').filter(Boolean);
    if (palabras.length > 1 && palabras.every((palabra) => GRUPO_DE.has(palabra))) requisitos.push(palabras);
  }
  return requisitos;
}

/** Si el nombre de la colección es (en parte) un género conocido. */
export function esColeccionDeGenero(nombre: string): boolean {
  return requisitosDe(nombre).length > 0;
}

/** Las formas de decir un término: el suyo y los sinónimos, si los tiene. */
function formasDe(termino: string): string[] {
  const grupo = GRUPO_DE.get(termino);
  if (grupo === undefined) return [termino];
  return [...new Set([termino, ...SINONIMOS[grupo].map(plano)])];
}

/**
 * Una etiqueta del libro casa con una forma si son iguales o si la etiqueta la lleva
 * como palabra entera («Dark Fantasy» lleva «fantasy»). Lo japonés, si está dentro
 * («異世界転生» lleva «転生»). Las de una o dos letras latinas, solo por igualdad:
 * «sf» dentro de cualquier palabra sería un desastre.
 */
function etiquetaCasa(etiqueta: string, forma: string): boolean {
  if (etiqueta === forma) return true;
  if (TIENE_JAPONES.test(forma)) return etiqueta.includes(forma);
  if (forma.length <= 2) return false;
  return ` ${etiqueta} `.includes(` ${forma} `);
}

function casaPorGenero(libro: Clasificable, nombre: string): boolean {
  /*
    Solo los trozos que son un género que conocemos. Sin eso, «Overlord» buscaría
    «overlord» entre las etiquetas, y un libro etiquetado así por el agregador
    entraría en una colección de serie por una vía que nadie entiende.
  */
  const requisitos = requisitosDe(nombre);
  if (requisitos.length === 0) return false;
  const etiquetas = [...(libro.genres || []), ...(libro.tags || [])].map(plano).filter(Boolean);
  const titulos = [libro.title, ...(libro.altTitles || []), libro.series || ''].map(normalizarTexto);
  const tiene = (termino: string) => formasDe(termino).some((forma) => {
    if (etiquetas.some((etiqueta) => etiquetaCasa(etiqueta, forma))) return true;
    // En el título solo lo japonés: 異世界 en un título es una pista clara; «vr», no.
    return TIENE_JAPONES.test(forma) && titulos.some((titulo) => titulo.includes(forma));
  });
  /*
    Todo lo que pide el nombre, no una parte: «Fantasía Oscura & Acción» es oscura
    **y** de acción. Con «o», cualquier libro de acción entraba (decidido con Nix,
    24 nov 2026). Lo de dentro del paréntesis suele repetir lo de fuera en japonés
    (異世界・転生), así que se juntan por grupo de sinónimos y no se pide dos veces.
  */
  const grupos = new Map<number, string>();
  for (const palabra of requisitos.flat()) grupos.set(GRUPO_DE.get(palabra)!, palabra);
  return [...grupos.values()].every(tiene);
}

/* ------------------------------------------------------------------ */
/*  Título y serie                                                      */
/* ------------------------------------------------------------------ */

/**
 * El título sin el número de tomo ni lo que cuelga detrás: lo que comparten todos los
 * tomos de una serie. «本好きの下剋上 第五部 女神の化身 1» y «本好きの下剋上 第三部 1»
 * acaban los dos en «本好きの下剋上».
 */
export function raizDeTitulo(titulo: string): string {
  let raiz = normalizarTexto(titulo)
    // Lo que va entre paréntesis al final suele ser la editorial o «(ライトノベル)».
    .replace(/\s*[【［[(（〈《][^】］\])）〉》]*[】］\])）〉》]\s*$/u, '')
    .trim();
  // Desde el primer marcador de tomo, parte o capítulo, todo fuera.
  raiz = raiz.replace(
    /\s*(?:第\s*[0-9一二三四五六七八九十百]+\s*(?:巻|部|章|話|集|幕)|(?:vol(?:ume)?|tomo|libro|book|part|parte)\.?\s*\d+|\s\d+(?:\.\d+)?(?=\s|$)|[上中下]巻?$).*$/u,
    ''
  );
  // Un número pegado al final («ノーゲーム・ノーライフ12»).
  raiz = raiz.replace(/\s*\d+$/u, '');
  return raiz.replace(/[\s\-_:：・、。!！?？]+$/u, '').trim();
}

/** La raíz tiene que ser larga: con tres letras, medio catálogo «es de la misma serie». */
const RAIZ_MIN = 4;

function raices(libro: Clasificable): string[] {
  return [libro.title, ...(libro.altTitles || []), libro.series || '']
    .filter(Boolean)
    .map(raizDeTitulo)
    .filter((raiz) => raiz.length >= RAIZ_MIN);
}

function mismaSerie(libro: Clasificable, miembro: Clasificable): boolean {
  if (libro.series && miembro.series && plano(libro.series) === plano(miembro.series)) return true;
  const deMiembro = raices(miembro);
  return raices(libro).some((a) => deMiembro.some((b) => a.startsWith(b) || b.startsWith(a)));
}

/**
 * Los nombres por los que se puede buscar una colección en un título.
 *
 * Las del servidor de Yoru llevan el nombre en romaji y, entre paréntesis, en
 * japonés: «Re:Zero (Re:ゼロから始める異世界生活)», «Kino no Tabi (キノの旅)». Buscar
 * el nombre entero no encontraría nada; cada mitad por separado, sí. Y una colección
 * de dos series, «Sukasuka & Sukamoka», es cada una de las dos.
 */
export function nombresDeColeccion(nombre: string): string[] {
  const dentro = [...nombre.matchAll(/[(（]([^)）]*)[)）]/g)].map((parte) => parte[1]);
  const fuera = nombre.replace(/[(（][^)）]*[)）]/g, ' ');
  const enteros = [fuera, ...dentro].map((parte) => parte.trim()).filter(Boolean);
  const trozos = enteros.flatMap((parte) => parte.split(/\s*[&＆]\s*/));
  return [...new Set([...enteros, ...trozos].map((parte) => parte.trim()))].filter((parte) => {
    // Un nombre muy corto («86», «K») casaría con cualquier cosa; lo japonés dice más con menos.
    const largo = plano(parte).replace(/\s/g, '').length;
    return TIENE_JAPONES.test(parte) ? largo >= 2 : largo >= 4;
  });
}

function casaPorTitulo(libro: Clasificable, nombre: string): boolean {
  // «Isekai & Reencarnación» no es un título: eso lo decide el género.
  if (esColeccionDeGenero(nombre)) return false;
  return nombresDeColeccion(nombre).some((alias) => {
    const buscador = crearBuscador(alias);
    return !!buscador && buscador(libro.title, ...(libro.altTitles || []), libro.series);
  });
}

/* ------------------------------------------------------------------ */
/*  Decisión                                                            */
/* ------------------------------------------------------------------ */

/**
 * Si un libro entra en una colección, y por qué. `null` si no entra.
 *
 * `miembros` es lo que la colección ya tiene: la pista de la serie sale de ahí.
 */
export function motivoParaColeccion(
  libro: Clasificable,
  nombre: string,
  miembros: Clasificable[] = []
): Motivo | null {
  if (casaPorTitulo(libro, nombre)) return 'titulo';
  /*
    Una colección de género no recoge por serie: que el tomo 1 de algo esté en
    «Romance» porque el servidor lo etiquetó así no dice nada del resto, que ya
    traerá sus propias etiquetas.
  */
  if (!esColeccionDeGenero(nombre) && miembros.some((miembro) => mismaSerie(libro, miembro))) return 'serie';
  if (casaPorGenero(libro, nombre)) return 'genero';
  return null;
}

/** Una colección para `clasificar`: su nombre y lo que ya tiene. */
export interface ColeccionDestino<T> {
  nombre: string;
  miembros: T[];
}

/**
 * Para cada colección, lo que de `candidatos` debería estar dentro y no está.
 *
 * `clave` dice cuándo dos entradas son el mismo libro, para no meter otra vez lo que ya
 * estaba. El resultado va en el mismo orden que `colecciones`.
 */
export function clasificar<T extends Clasificable>(
  colecciones: ColeccionDestino<T>[],
  candidatos: T[],
  clave: (libro: T) => string
): { libro: T; motivo: Motivo }[][] {
  return colecciones.map((coleccion) => {
    const dentro = new Set(coleccion.miembros.map(clave));
    const nuevos: { libro: T; motivo: Motivo }[] = [];
    for (const candidato of candidatos) {
      const id = clave(candidato);
      if (dentro.has(id)) continue;
      const motivo = motivoParaColeccion(candidato, coleccion.nombre, coleccion.miembros);
      if (!motivo) continue;
      dentro.add(id);
      nuevos.push({ libro: candidato, motivo });
    }
    return nuevos;
  });
}

/* ------------------------------------------------------------------ */
/*  Biblioteca del aparato                                              */
/* ------------------------------------------------------------------ */

/**
 * Las colecciones manuales en las que debería entrar un libro recién importado.
 *
 * Las manuales son etiquetas de los libros (`collections.ts`), así que entrar es ganar
 * la etiqueta. Se decide **una vez, al importarlo**: si luego el usuario le quita la
 * etiqueta, nadie se la vuelve a poner. Las dinámicas no necesitan nada de esto,
 * porque se recalculan solas al mirarlas.
 *
 * `nombres` son las colecciones manuales del perfil; `biblioteca`, los libros que ya
 * había (de ahí salen los miembros de cada una).
 */
export function etiquetasParaLibroNuevo(
  libro: Clasificable,
  biblioteca: Array<Clasificable & { tags?: string[]; isDeleted?: boolean }>,
  nombres: string[]
): string[] {
  const yaTiene = new Set((libro.tags || []).map((tag) => tag.trim().toLowerCase()));
  const resultado: string[] = [];
  /*
    Para las etiquetas no se mira el género: un libro del aparato no trae géneros
    fiables, y su propia lista de etiquetas es justo lo que estamos decidiendo.
  */
  const sinGeneros: Clasificable = { title: libro.title, altTitles: libro.altTitles, series: libro.series };
  for (const nombre of nombres) {
    const clave = nombre.trim().toLowerCase();
    // «Kavita» es la etiqueta que se pone a lo descargado de allí, no una colección temática.
    if (!clave || yaTiene.has(clave) || clave === 'kavita') continue;
    const miembros = biblioteca.filter((otro) => !otro.isDeleted
      && (otro.tags || []).some((tag) => tag.trim().toLowerCase() === clave));
    const motivo = motivoParaColeccion(sinGeneros, nombre, miembros);
    if (motivo && motivo !== 'genero') {
      resultado.push(nombre);
      yaTiene.add(clave);
    }
  }
  return resultado;
}
