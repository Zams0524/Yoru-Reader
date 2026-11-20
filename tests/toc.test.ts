// La tabla de contenidos: cómo el índice del EPUB se convierte en capítulos al importar
// (`planChapters`) y qué capítulos lista el lector (`buildTocEntries`). `frontend/utils/toc.ts`.
// Ejecutar: node tests/run-toc-test.mjs
import {
  activeTocEntry,
  buildTocEntries,
  planChapters,
  titleLooksLikeBook,
  type SpineDoc,
  type TocRef,
} from '../frontend/utils/toc';

let failures = 0;
function check(condicion: boolean, nombre: string) {
  if (condicion) {
    console.log(`  ok  ${nombre}`);
  } else {
    failures += 1;
    console.error(`FALLA  ${nombre}`);
  }
}

const LIBRO = '"夜空"星を読むひと(6) (やみ文庫)';
// Lo que el editor pone en el <title> de cada fichero: el del libro, con otras comillas y sin sello.
const TITULO_FICHERO = '〝夜空〟星を読むひと(6)';

const doc = (path: string, cambios: Partial<SpineDoc<string>> = {}): SpineDoc<string> => ({
  path,
  paragraphs: [`texto de ${path}`],
  anchors: {},
  titleTag: TITULO_FICHERO,
  textLength: (parrafo) => parrafo.length,
  ...cambios,
});
const ref = (path: string, label: string, level = 0, fragment = ''): TocRef => ({ path, fragment, label, level });

function titulosTests() {
  console.log('Títulos');
  check(titleLooksLikeBook(TITULO_FICHERO, LIBRO), 'el título del fichero es el del libro aunque cambien comillas y sello');
  check(titleLooksLikeBook(LIBRO, LIBRO), 'el mismo título');
  check(!titleLooksLikeBook('ご利用上の注意', LIBRO), 'un título propio no es el del libro');
  check(!titleLooksLikeBook('星', LIBRO), 'una palabra suelta del título no cuenta');
  check(!titleLooksLikeBook('', LIBRO), 'sin título');
}

// Un tomo como los de Calibre: portada, ilustraciones sueltas, y capítulos partidos en varios
// ficheros con una ilustración en medio. El índice solo nombra el primer fichero de cada capítulo.
function tomo(): { spine: SpineDoc<string>[]; toc: TocRef[] } {
  const spine = [
    doc('titlepage.xhtml', { titleTag: 'Cover' }),
    doc('text/part0000.html'),
    doc('text/part0001.html'),
    doc('text/part0002.html', { titleTag: 'ご利用上の注意' }),
    doc('text/part0003.html'),
    doc('text/part0004.html'),
    doc('text/part0005.html'),
    doc('text/part0006.html'),
    doc('text/part0007.html'),
    doc('text/part0008.html'),
    doc('text/part0009.html', { titleTag: 'BOOK☆WALKER' }),
  ];
  const toc = [
    ref('text/part0003.html', '目次', 0, 'a1'),
    ref('text/part0004.html', '一章', 0, 'a2'),
    ref('text/part0007.html', '二章', 0, 'a3'),
  ];
  return { spine, toc };
}

function planTests() {
  console.log('Capítulos al importar');
  const { spine, toc } = tomo();
  const capitulos = planChapters(spine, toc, LIBRO);
  check(capitulos.length === spine.length, 'cada fichero sigue siendo un capítulo: no se pierde texto');
  check(capitulos.map((c) => c.paragraphs[0]).join('|') === spine.map((d) => d.paragraphs[0]).join('|'), 'en el mismo orden');
  check(capitulos[1].continuation === true && capitulos[1].title === 'Cover', 'las ilustraciones siguen a la portada');
  check(capitulos[3].title === 'ご利用上の注意' && !capitulos[3].continuation, 'un fichero con título propio es un capítulo');
  check(capitulos[5].title === '一章' && capitulos[5].isFromToc && capitulos[5].tocLevel === 0, 'el capítulo lleva el nombre del índice');
  check(capitulos[6].continuation === true && capitulos[6].title === '一章', 'el resto del capítulo no es otro capítulo');
  check(capitulos[7].continuation === true && capitulos[7].title === '一章', 'ni el tercer fichero');
  check(capitulos[10].title === 'BOOK☆WALKER' && !capitulos[10].continuation, 'la página final con título propio');

  const entradas = buildTocEntries(capitulos, LIBRO);
  check(
    entradas.map((e) => e.title).join('|') === 'Cover|ご利用上の注意|目次|一章|二章|BOOK☆WALKER',
    'la tabla lista el índice del libro, sin repetidos',
  );
  check(entradas.map((e) => e.chapterIndex).join(',') === '0,3,4,5,8,10', 'cada entrada abre su capítulo');
  check(new Set(entradas.map((e) => e.title)).size === entradas.length, 'ningún título se repite');
  check(activeTocEntry(entradas, 6) === 3, 'leyendo el segundo fichero de 一章 se marca 一章');
  check(activeTocEntry(entradas, 0) === 0 && activeTocEntry(entradas, 10) === 5, 'primera y última');
}

function anidadosTests() {
  console.log('Secciones anidadas y anclas');
  // Un libro en un solo fichero: el índice apunta a anclas dentro de él.
  const unico = doc('book.xhtml', {
    paragraphs: ['portada '.repeat(40), 'uno', 'uno b', 'dos', 'dos b', 'tres'],
    anchors: { c1: 1, s1: 1, c2: 3, c3: 5 },
  });
  const capitulos = planChapters([unico], [
    ref('book.xhtml', 'Parte I', 0, 'c1'),
    ref('book.xhtml', 'Uno', 1, 's1'),
    ref('book.xhtml', 'Dos', 1, 'c2'),
    ref('book.xhtml', 'Parte II', 0, 'c3'),
  ], 'Libro');
  check(capitulos.length === 4, 'un fichero con varias entradas se corta en cada una');
  check(capitulos[0].title === 'Portada' && capitulos[0].paragraphs.length === 1, 'lo que hay antes de la primera entrada');
  check(capitulos[1].title === 'Uno' && capitulos[1].paragraphs.join('|') === 'uno|uno b', 'cada trozo con su texto');
  check(capitulos[2].title === 'Dos' && capitulos[2].tocLevel === 1, 'la sección conserva su nivel');
  check(capitulos.reduce((n, c) => n + c.paragraphs.length, 0) === 6, 'no se pierde ningún párrafo');

  const entradas = buildTocEntries(capitulos, 'Libro');
  check(entradas.map((e) => `${e.level}:${e.title}`).join('|') === '0:Portada|0:Parte I|1:Uno|1:Dos|0:Parte II', 'la parte y su primer capítulo, con jerarquía');
  check(entradas[1].chapterIndex === entradas[2].chapterIndex, 'la parte y su primer capítulo abren el mismo sitio');

  // Un adorno antes del ancla no es una página aparte.
  const adorno = planChapters(
    [doc('a.xhtml', { paragraphs: ['*', 'texto'], anchors: { x: 1 } })],
    [ref('a.xhtml', 'Uno', 0, 'x')],
    'Libro',
  );
  check(adorno.length === 1 && adorno[0].paragraphs.length === 2, 'un adorno antes del ancla se queda con su capítulo');

  // Un ancla que no está en el texto empieza donde la anterior.
  const perdida = planChapters(
    [doc('a.xhtml', { paragraphs: ['uno', 'dos'], anchors: {} })],
    [ref('a.xhtml', 'Uno', 0, 'x'), ref('a.xhtml', 'Dos', 0, 'y')],
    'Libro',
  );
  check(perdida.length === 1 && perdida[0].title === 'Dos' && perdida[0].tocParents?.[0].title === 'Uno', 'anclas perdidas: las dos entradas siguen en la tabla');

  // Un fichero con encabezado propio dentro de un capítulo es una sección suya.
  const conSeccion = planChapters(
    [doc('a.xhtml'), doc('b.xhtml', { heading: { text: 'Interludio', tag: 'h2' } }), doc('c.xhtml', { heading: { text: 'Epílogo', tag: 'h1' } })],
    [ref('a.xhtml', 'Uno')],
    LIBRO,
  );
  check(conSeccion[1].title === 'Interludio' && conSeccion[1].tocLevel === 1, 'un h2 fuera del índice es una sección del capítulo');
  check(conSeccion[2].title === 'Epílogo' && conSeccion[2].tocLevel === 0, 'un h1 fuera del índice es un capítulo');

  // El índice apunta a una página vacía: la entrada pasa a lo que sigue.
  const vacia = planChapters(
    [doc('a.xhtml', { paragraphs: [] }), doc('b.xhtml')],
    [ref('a.xhtml', 'Uno')],
    LIBRO,
  );
  check(vacia.length === 1 && vacia[0].title === 'Uno', 'una entrada a una página vacía abre la siguiente');

  // Rutas: el índice puede nombrar el fichero con otra carpeta o con mayúsculas.
  const rutas = planChapters([doc('OEBPS/Text/Uno.xhtml')], [ref('text/uno.xhtml', 'Uno')], LIBRO);
  check(rutas[0].title === 'Uno' && rutas[0].isFromToc, 'el fichero se encuentra por su nombre');
}

function sinIndiceTests() {
  console.log('Libros sin índice');
  const capitulos = planChapters(
    [doc('a.xhtml'), doc('b.xhtml', { heading: { text: 'Uno', tag: 'h2' } }), doc('c.xhtml')],
    [],
    LIBRO,
  );
  check(capitulos.map((c) => c.title).join('|') === 'Portada|Uno|Capítulo 3', 'cada fichero es un capítulo, con su encabezado o un número');
  check(capitulos.every((c) => !c.continuation && c.tocLevel === undefined), 'sin marcas de índice');
  check(buildTocEntries(capitulos, LIBRO).length === 3, 'y la tabla los lista todos');
}

function antiguosTests() {
  console.log('Libros importados antes');
  // Así quedó guardado el tomo con el importador anterior: el título del fichero en cada resto.
  const guardado = [
    { title: 'Cover', isFromToc: false },
    { title: TITULO_FICHERO, isFromToc: false },
    { title: TITULO_FICHERO, isFromToc: false },
    { title: 'ご利用上の注意', isFromToc: false },
    { title: '目次', isFromToc: true },
    { title: '一章', isFromToc: true },
    { title: TITULO_FICHERO, isFromToc: false },
    { title: TITULO_FICHERO, isFromToc: false },
    { title: '二章', isFromToc: true },
    { title: TITULO_FICHERO, isFromToc: false },
    { title: 'BOOK☆WALKER', isFromToc: false },
  ];
  const entradas = buildTocEntries(guardado, LIBRO);
  check(
    entradas.map((e) => e.title).join('|') === 'Cover|ご利用上の注意|目次|一章|二章|BOOK☆WALKER',
    'sin volver a importar, la tabla ya no repite el título del libro',
  );
  check(entradas.map((e) => e.chapterIndex).join(',') === '0,3,4,5,8,10', 'y cada entrada abre su capítulo');

  const numerados = buildTocEntries([
    { title: 'Uno', isFromToc: true },
    { title: 'Capítulo 2', isFromToc: false },
    { title: 'Dos', isFromToc: true },
  ], 'Libro');
  check(numerados.map((e) => e.title).join('|') === 'Uno|Dos', 'los ficheros sin nombre de un libro con índice no se listan');

  const sinIndice = buildTocEntries([
    { title: 'Portada' }, { title: 'Capítulo 2' }, { title: 'Capítulo 3' },
  ], 'Libro');
  check(sinIndice.length === 3, 'un libro sin índice conserva sus capítulos numerados');

  const repetidos = buildTocEntries([{ title: 'A' }, { title: 'A' }, { title: 'B' }, { title: 'A' }], 'Libro');
  check(repetidos.map((e) => e.chapterIndex).join(',') === '0,2,3', 'dos seguidos con el mismo nombre son uno');

  check(buildTocEntries(undefined).length === 0 && activeTocEntry([], 3) === -1, 'sin capítulos');
}

titulosTests();
planTests();
anidadosTests();
sinIndiceTests();
antiguosTests();

console.log(failures ? `\n${failures} prueba(s) fallaron` : '\nTodo en orden');
process.exit(failures ? 1 : 0);
