// Kavita / Audiobookshelf clients against a mocked server (no real server needed).
// Run: node tests/run-media-servers-test.mjs
import JSZip from 'jszip';
import {
  extractKavitaDownload,
  getKavitaLibraries,
  getKavitaSeries,
  getKavitaVolumes,
  kavitaChapterForPercent,
  kavitaPageForPercent,
  kavitaPercentForPage,
  kavitaVolumesToBooks,
  loginKavita,
  saveKavitaConfig,
  searchKavitaSeries,
  testKavitaConnection,
} from '../frontend/utils/kavitaService';
import {
  buildAlignmentIndex,
  cueAt,
  normalizeForMatch,
  paragraphAtTime,
  parseAlignment,
  parseVerdict,
  timeOfParagraph,
  timeOfText,
} from '../frontend/utils/readAlongAlignment';
import { decidirSeguimiento } from '../frontend/utils/seguimientoAudio';
import { capituloVecino, tieneTexto } from '../frontend/utils/capitulos';
import { juntarOkurigana } from '../frontend/utils/okurigana';
import { mereceBuscarseFuera, mensajeSinDefinicion, FUENTE_POR_DEFECTO } from '../frontend/utils/dictionary';
import { TRANSLATIONS, t } from '../frontend/utils/i18n';
import {
  modoAnalizador,
  modoAnalizadorPorDefecto,
  motivoModoNoDisponible,
} from '../frontend/utils/parserSettingsStore';
import { ordenEfectivo, rangoDeDiccionario } from '../frontend/utils/ordenDiccionarios';
import {
  audiobookMatchScore,
  chapterAt,
  getAudiobooks,
  locateTrack,
  loginAudiobookshelf,
  normalizeTitle,
  saveAudiobookshelfConfig,
  searchAudiobooks,
  startAudiobookPlayback,
  testAudiobookshelfConnection,
  updateAudiobookProgress,
  volumeNumberOf,
} from '../frontend/utils/audiobookshelfService';
import { normalizeServerUrl } from '../frontend/utils/serverHttp';

type Call = { method: string; url: string; headers: Record<string, string>; body: any };
const calls: Call[] = [];
let routes: ((call: Call) => Response | null)[] = [];

const json = (data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });

(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const call: Call = { method: init.method || 'GET', url, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined };
  calls.push(call);
  for (const route of routes) {
    const response = route(call);
    if (response) return response;
  }
  return new Response('not found', { status: 404 });
};

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, String(value)),
  removeItem: (key: string) => store.delete(key),
};
(globalThis as any).window = globalThis;
(globalThis as any).window.dispatchEvent = () => true;

let failures = 0;
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures++;
};

const K = 'http://kavita.test:5000';
const A = 'http://abs.test:13378';

async function kavitaTests() {
  routes = [
    (c) => c.url === `${K}/api/Account/login` && c.method === 'POST'
      ? (c.body.password === 'secret' ? json({ username: 'zams', token: 'jwt-1', apiKey: 'key-1' }) : new Response('bad', { status: 401 }))
      : null,
    (c) => c.url.startsWith(`${K}/api/Plugin/authenticate?apiKey=key-1`) ? json({ username: 'zams', token: 'jwt-2', apiKey: 'key-1' }) : null,
    (c) => c.url.startsWith(`${K}/api/Plugin/authenticate`) ? new Response('bad key', { status: 401 }) : null,
    (c) => c.url === `${K}/api/Library/libraries` && c.headers.Authorization?.startsWith('Bearer jwt')
      ? json([{ id: 1, name: 'Manga', type: 0 }, { id: 2, name: 'Light Novels', type: 4 }]) : null,
    (c) => c.url.startsWith(`${K}/api/Series/v2?PageNumber=2&PageSize=30`)
      ? json([{ id: 12, name: '本好きの下剋上', libraryId: 2 }], { Pagination: JSON.stringify({ currentPage: 2, itemsPerPage: 30, totalItems: 31, totalPages: 2 }) })
      : null,
    (c) => c.url.startsWith(`${K}/api/Search/search?queryString=`) ? json({ series: [{ seriesId: 7, name: '薬屋のひとりごと', libraryId: 2 }] }) : null,
    (c) => c.url === `${K}/api/Series/volumes?seriesId=7` ? json([
      { id: 72, seriesId: 7, minNumber: 2, name: '2', pages: 20, chapters: [{ id: 702, pages: 20 }] },
      { id: 71, seriesId: 7, minNumber: 1, name: '1', pages: 18, chapters: [{ id: 701, pages: 18 }] },
    ]) : null,
  ];

  check(normalizeServerUrl(' 192.168.1.20:5000/ ') === 'http://192.168.1.20:5000', 'URL sin esquema → http://, sin barra final');

  const config = await loginKavita(`${K}/`, 'zams', 'secret');
  check(config.apiKey === 'key-1' && config.token === 'jwt-1' && !('password' in config), 'Login Kavita guarda la clave API y el JWT, no la contraseña');
  const test = await testKavitaConnection(config, true);
  check(test.ok && /2 bibliotecas/.test(test.message), `Probar conexión Kavita: ${test.message}`);
  const bad = await testKavitaConnection({ ...config, apiKey: 'wrong' }, true);
  check(!bad.ok && /401/.test(bad.message), `Clave incorrecta da error claro: ${bad.message}`);

  saveKavitaConfig(config);
  const libraries = await getKavitaLibraries();
  check(libraries.length === 2 && libraries[1].type === 4, 'Lista de bibliotecas');

  const page = await getKavitaSeries(2, 2);
  const seriesCall = calls.find((c) => c.url.includes('/api/Series/v2'))!;
  check(page.items[0].name === '本好きの下剋上' && page.totalPages === 2 && page.totalItems === 31, 'Series paginadas (cabecera Pagination)');
  check(seriesCall.body.statements[0].value === '2' && seriesCall.body.statements[0].field === 19, 'Filtro v2 por biblioteca');

  const found = await searchKavitaSeries('薬屋');
  check(found[0].id === 7, 'Búsqueda de series');
  // Un volumen de capítulos sueltos: Kavita manda `-100000` como número y como nombre.
  // Pintarlo en crudo es lo que hacía que en Explorar saliera un libro titulado
  // «-100000». Con un solo volumen no son «Especiales»: son el libro.
  const sueltos = kavitaVolumesToBooks(
    { id: 1, name: 'serie', libraryId: 1 } as any,
    [{ id: 9, seriesId: 1, name: '-100000', number: -100000, pages: 18, chapters: [] }] as any,
    true,
  );
  check(sueltos[0].title === 'Volumen único',
    'Kavita: el volumen especial -100000 no se pinta en crudo');
  const conTitulo = kavitaVolumesToBooks(
    { id: 1, name: 'serie', libraryId: 1 } as any,
    [{ id: 9, seriesId: 1, name: '-100000', number: -100000, pages: 18,
       chapters: [{ id: 3, title: '嘘つきな私を終わりにする日', pages: 18 }] }] as any,
    true,
  );
  check(conTitulo[0].title === '嘘つきな私を終わりにする日',
    'Kavita: si el capítulo trae título, ese es el nombre del volumen');

  const books = kavitaVolumesToBooks(found[0], await getKavitaVolumes(7), true);
  check(books.map((b) => b.title).join(',') === 'Volumen 1,Volumen 2' && books[0].chapterId === 701, 'Volúmenes ordenados con capítulo');
  check(books[0].coverUrl.includes('volume-cover?volumeId=71&apiKey=key-1'), 'Portada con apiKey en la URL');

  check(kavitaPageForPercent(200, 50) === 100 && kavitaPageForPercent(200, 140) === 200, 'Porcentaje → página Kavita');

  // La vuelta: de la página de Kavita al porcentaje nuestro.
  check(kavitaPercentForPage(200, 100) === 50, 'Página → porcentaje: el principio de la página');
  check(kavitaPercentForPage(200, 200) === 100 && kavitaPercentForPage(200, 500) === 100, 'Página → porcentaje: el final es 100');
  check(kavitaPercentForPage(200, 0) === 0 && kavitaPercentForPage(200, -3) === 0, 'Página → porcentaje: el principio es 0');
  check(kavitaPercentForPage(0, 10) === 0 && kavitaPercentForPage(NaN, 10) === 0, 'Página → porcentaje: sin páginas no hay NaN');
  // Ida y vuelta: la página se conserva exacta, incluidas las que caen en .5.
  check(
    [1, 50, 137, 150, 199].every((page) => kavitaPageForPercent(200, kavitaPercentForPage(200, page)) === page),
    'Ida y vuelta: la página se conserva'
  );

  // El capítulo que contiene un porcentaje, según las páginas de cada capítulo.
  check(kavitaChapterForPercent([10, 10, 10], 0) === 0, 'Porcentaje → capítulo: el principio');
  check(kavitaChapterForPercent([10, 10, 10], 50) === 1, 'Porcentaje → capítulo: la mitad');
  check(kavitaChapterForPercent([10, 10, 10], 100) === 2, 'Porcentaje → capítulo: el final');
  check(kavitaChapterForPercent([], 50) === 0, 'Porcentaje → capítulo: sin capítulos');

  // ── Alineación texto ↔ audio ──────────────────────────────────────────
  // Un SRT normal, con coma decimal y números de orden.
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:03,500',
    '吾輩は猫である。',
    '',
    '2',
    '00:00:03,500 --> 00:00:06,000',
    '名前はまだ無い。',
  ].join(String.fromCharCode(10));
  const parsed = parseAlignment(srt);
  check(parsed.cues.length === 2, 'Alineación: lee un SRT');
  check(parsed.cues[0].startMs === 1000 && parsed.cues[0].endMs === 3500, 'Alineación: tiempos en ms');
  check(parsed.cues[1].index === 1, 'Alineación: los cues se numeran en orden');
  check(!parsed.incomplete && parsed.longestGapMs === 0, 'Alineación: sin huecos, completa');

  // WebVTT: cabecera, punto decimal y ajustes de posición detrás del tiempo final.
  const vtt = [
    'WEBVTT',
    '',
    '00:00:02.250 --> 00:00:04.000 line:90%',
    'ウェブの字幕',
  ].join(String.fromCharCode(10));
  const fromVtt = parseAlignment(vtt);
  check(fromVtt.cues.length === 1 && fromVtt.cues[0].startMs === 2250, 'Alineación: lee un WebVTT');

  // Un bloque roto no tira la alineación entera.
  const dodgy = ['1', 'no-es-un-tiempo', 'texto suelto', '', '2', '00:00:05,000 --> 00:00:06,000', 'bueno'].join(String.fromCharCode(10));
  check(parseAlignment(dodgy).cues.length === 1, 'Alineación: un cue roto no tumba el resto');

  // Un hueco largo significa que falta texto por alinear.
  const gappy = [
    '1', '00:00:00,000 --> 00:00:01,000', 'principio',
    '', '2', '00:05:00,000 --> 00:05:01,000', 'mucho después',
  ].join(String.fromCharCode(10));
  const withGap = parseAlignment(gappy);
  check(withGap.longestGapMs === 299_000 && withGap.incomplete, 'Alineación: detecta que falta texto');

  // Qué suena en cada momento.
  check(cueAt(parsed.cues, 0) === null, 'Alineación: antes del primer cue no hay nada');
  check(cueAt(parsed.cues, 2000)?.index === 0, 'Alineación: el cue que suena');
  check(cueAt(parsed.cues, 99_000)?.index === 1, 'Alineación: pasado el final, el último');
  check(cueAt([], 10) === null, 'Alineación: sin cues no hay nada que sonar');

  // Del texto al audio, tolerando que el EPUB no coincida carácter a carácter.
  check(timeOfText(parsed.cues, '名前はまだ無い') === 3500, 'Alineación: del texto al momento del audio');
  check(timeOfText(parsed.cues, 'no está en el libro') === null, 'Alineación: texto que no aparece');
  check(
    normalizeForMatch('「吾輩は、猫である。」') === normalizeForMatch('吾輩は猫である'),
    'Alineación: la puntuación japonesa no estorba al comparar'
  );
  check(
    normalizeForMatch('ビール') !== normalizeForMatch('ビル'),
    'Alineación: ー es un sonido, no puntuación (ビール no es ビル)'
  );

  // ── El veredicto que el generador escribe en el propio SRT ───────────
  const conVeredicto = [
    'YORU-ALINEACION v1 {"verdict":"parcial","coverage":0.41,"audioCoverage":0.93,"notice":"solo un tomo"}',
    '', '1', '00:00:01,000 --> 00:00:02,000', '吾輩は猫である',
  ].join(String.fromCharCode(10));
  const conV = parseAlignment(conVeredicto);
  check(conV.cues.length === 1, 'Veredicto: la cabecera no se cuela como cue');
  check(conV.verdict?.verdict === 'parcial' && conV.verdict?.coverage === 0.41,
    'Veredicto: se lee de la cabecera');
  check(parseAlignment('1\n00:00:01,000 --> 00:00:02,000\nhola').verdict === null,
    'Veredicto: un SRT de fuera no trae veredicto, y eso no es un error');
  check(parseVerdict('YORU-ALINEACION v1 {roto') === null,
    'Veredicto: una cabecera rota no tumba nada');

  // ── El índice cue ↔ párrafo ──────────────────────────────────────────
  // Sustituye al barrido lineal: el lector hace un salto por página y con decenas de
  // miles de cues no puede recorrerlos todos cada vez.
  const parrafos = [
    { sectionIndex: 0, paragraphId: 10, text: '吾輩は猫である。' },
    { sectionIndex: 0, paragraphId: 11, text: '名前はまだ無い。' },
    { sectionIndex: 1, paragraphId: 12, text: 'どこで生れたか頓と見当がつかぬ。' },
  ];
  const conParrafos = parseAlignment([
    '1', '00:00:01,000 --> 00:00:03,000', '吾輩は猫である',
    '', '2', '00:00:03,000 --> 00:00:05,000', '名前はまだ無い',
    '', '3', '00:00:20,000 --> 00:00:22,000', 'どこで生れたか頓と見当がつかぬ',
  ].join(String.fromCharCode(10)));
  const idx = buildAlignmentIndex(conParrafos, parrafos);
  check(idx.placed === 3, 'Índice: coloca los tres cues en su párrafo');
  check(idx.paragraphOfCue[0] === 10 && idx.paragraphOfCue[2] === 12,
    'Índice: cada cue cae en el párrafo que le toca');
  check(idx.sectionOfCue[2] === 1, 'Índice: y se queda con su sección');
  check(timeOfParagraph(idx, 11) === 3000, 'Índice: del párrafo al segundo del audio');
  check(timeOfParagraph(idx, 99) === null, 'Índice: un párrafo sin alinear no da tiempo');
  check(paragraphAtTime(idx, 4000)?.paragraphId === 11, 'Índice: del segundo al párrafo');
  check(paragraphAtTime(idx, 0) === null, 'Índice: antes del primer cue no hay párrafo');

  /*
    Dónde cae cada frase dentro de su párrafo. Es lo que permite resaltar la frase y
    no el párrafo entero, y se mide en caracteres ya normalizados: el párrafo
    「吾輩は猫である。」 normaliza a 吾輩は猫である, siete caracteres desde el cero,
    porque los corchetes y el punto se caen.
  */
  check(idx.offsetInParagraph[0] === 0 && idx.lengthOfCue[0] === 7,
    'Índice: la primera frase empieza al principio de su párrafo');
  check(idx.offsetInParagraph[1] === 0 && idx.lengthOfCue[1] === 7,
    'Índice: y la segunda, al principio del suyo');

  // Dos frases en un mismo párrafo: la segunda tiene que empezar donde acaba la primera.
  const dosEnUno = buildAlignmentIndex(
    parseAlignment([
      '1', '00:00:01,000 --> 00:00:02,000', '吾輩は猫である',
      '', '2', '00:00:02,000 --> 00:00:03,000', '名前はまだ無い',
    ].join(String.fromCharCode(10))),
    [{ sectionIndex: 0, paragraphId: 5, text: '「吾輩は猫である。名前はまだ無い。」' }],
  );
  check(dosEnUno.offsetInParagraph[0] === 0 && dosEnUno.lengthOfCue[0] === 7
    && dosEnUno.offsetInParagraph[1] === 7 && dosEnUno.lengthOfCue[1] === 7,
    'Índice: dos frases en un párrafo no se pisan');
  check(idx.offsetInParagraph.length === idx.cues.length,
    'Índice: hay un desplazamiento por cue, colocado o no');
  // Lo que de verdad importa: en un hueco sin alinear **no se inventa** un párrafo. El
  // lector se queda quieto en vez de saltar al más cercano.
  check(paragraphAtTime(idx, 15_000) === null,
    'Índice: en un tramo sin alinear no devuelve nada, para no saltar a ojo');
  const ajeno = buildAlignmentIndex(
    parseAlignment('1\n00:00:01,000 --> 00:00:02,000\nesto no está en el libro'),
    parrafos,
  );
  check(ajeno.placed === 0, 'Índice: un cue que no aparece en el libro no se coloca');

  // ── Material que no es la novela ─────────────────────────────────────
  // El narrador lee la portada, el aviso de copyright y el índice. Los cues se guardan
  // —si no, perderíamos la señal de que el audio empieza con medio minuto de título—
  // pero no se subrayan ni se ofrece saltar a ellos.
  const conAjeno = parseAlignment([
    'YORU-ALINEACION v1 {"verdict":"bueno","coverage":1,"audioCoverage":1,"notice":"","aside":[[0,0]]}',
    '', '1', '00:00:01,000 --> 00:00:03,000', '吾輩は猫である',
    '', '2', '00:00:03,000 --> 00:00:05,000', '名前はまだ無い',
  ].join(String.fromCharCode(10)));
  check(conAjeno.verdict?.aside.length === 1, 'Ajeno: los tramos se leen de la cabecera');
  const idxAjeno = buildAlignmentIndex(conAjeno, parrafos);
  check(idxAjeno.cues.length === 2, 'Ajeno: el cue sigue en el fichero, no se borra');
  check(idxAjeno.asideOfCue[0] === 1 && idxAjeno.asideOfCue[1] === 0,
    'Ajeno: se marca el que toca y solo ese');
  check(paragraphAtTime(idxAjeno, 2000) === null,
    'Ajeno: el texto no sigue al audio en el material ajeno');
  check(paragraphAtTime(idxAjeno, 4000)?.paragraphId === 11,
    'Ajeno: pero sí en la novela que viene después');
  check(timeOfParagraph(idxAjeno, 10) === null,
    'Ajeno: no se ofrece «escuchar desde aquí» en el material ajeno');

  // Una frase que se repite no puede mandar al lector hacia atrás: el segundo cue de
  // «吾輩は猫である» va detrás del primero, no vuelve al párrafo 10.
  const repetida = buildAlignmentIndex(parseAlignment([
    '1', '00:00:01,000 --> 00:00:02,000', '名前はまだ無い',
    '', '2', '00:00:02,000 --> 00:00:03,000', '吾輩は猫である',
  ].join(String.fromCharCode(10))), parrafos);
  check(repetida.paragraphOfCue[0] === 11, 'Orden: el primer cue cae donde le toca');
  check(repetida.paragraphOfCue[1] === -1,
    'Orden: un cue que solo casa hacia atrás se queda sin colocar, no hace retroceder');

  // Downloads: a single EPUB, and a ZIP holding two EPUBs.
  const epub = new JSZip();
  epub.file('mimetype', 'application/epub+zip');
  epub.file('META-INF/container.xml', '<container/>');
  const epubBytes = await epub.generateAsync({ type: 'arraybuffer' });
  const single = await extractKavitaDownload(epubBytes);
  check(single.length === 1 && single[0].kind === 'epub', 'Descarga de un EPUB');
  const bundle = new JSZip();
  bundle.file('b/vol 10.epub', epubBytes);
  bundle.file('a/vol 2.epub', epubBytes);
  bundle.file('cover.jpg', 'x');
  const multi = await extractKavitaDownload(await bundle.generateAsync({ type: 'arraybuffer' }));
  check(multi.length === 2 && multi.every((f) => f.kind === 'epub'), 'ZIP con varios EPUB se separa');
}

async function absTests() {
  routes = [
    (c) => c.url === `${A}/login` ? json({ user: { id: 'u1', username: 'zams', token: 'abs-token' } }) : null,
    (c) => c.headers.Authorization !== 'Bearer abs-token' && c.url.startsWith(`${A}/api`) ? new Response('Unauthorized', { status: 401 }) : null,
    (c) => c.url === `${A}/api/me` ? json({ username: 'zams' }) : null,
    (c) => c.url === `${A}/api/libraries` ? json({ libraries: [{ id: 'lib1', name: 'Audiolibros', mediaType: 'book' }, { id: 'pod', name: 'Podcasts', mediaType: 'podcast' }] }) : null,
    (c) => c.url.startsWith(`${A}/api/libraries/lib1/items`) ? json({ total: 268, results: [
      { id: 'li1', libraryId: 'lib1', media: { duration: 36000, metadata: { title: '薬屋のひとりごと 1', authorName: '日向夏' } } },
    ] }) : null,
    (c) => c.url.startsWith(`${A}/api/libraries/lib1/search`) ? json({ book: [
      { libraryItem: { id: 'li1', libraryId: 'lib1', media: { duration: 36000, metadata: { title: '薬屋のひとりごと 1', authorName: '日向夏' } } } },
      { libraryItem: { id: 'li2', libraryId: 'lib1', media: { duration: 35000, metadata: { title: '薬屋のひとりごと 2', authorName: '日向夏' } } } },
    ] }) : null,
    (c) => c.url === `${A}/api/items/li1/play` && c.method === 'POST' ? json({
      id: 'sess1', currentTime: 4000, duration: 7200, displayTitle: '薬屋のひとりごと 1', displayAuthor: '日向夏',
      chapters: [{ id: 0, start: 0, end: 3600, title: '序章' }, { id: 1, start: 3600, end: 7200, title: '一話' }],
      audioTracks: [
        { index: 2, startOffset: 3600, duration: 3600, contentUrl: '/api/items/li1/file/222', mimeType: 'audio/mpeg' },
        { index: 1, startOffset: 0, duration: 3600, contentUrl: '/api/items/li1/file/111', mimeType: 'audio/mpeg' },
      ],
    }) : null,
    (c) => c.url === `${A}/api/me/progress/li1` && c.method === 'PATCH' ? json({}) : null,
  ];

  const config = await loginAudiobookshelf(A, 'zams', 'pw');
  check(config.token === 'abs-token' && !('password' in config), 'Login Audiobookshelf guarda solo el token');
  const test = await testAudiobookshelfConnection(config, true);
  check(test.ok && /1 biblioteca de audiolibros/.test(test.message), `Probar conexión Audiobookshelf: ${test.message}`);
  const bad = await testAudiobookshelfConnection({ ...config, token: 'x' }, true);
  check(!bad.ok && /401/.test(bad.message), 'Token incorrecto da error claro');

  saveAudiobookshelfConfig(config);
  const list = await getAudiobooks('lib1');
  check(list.total === 268 && list.items[0].author === '日向夏' && list.items[0].coverUrl === `${A}/api/items/li1/cover?token=abs-token`, 'Lista de audiolibros con portada');

  const results = await searchAudiobooks('薬屋のひとりごと');
  check(results.length === 2, 'Búsqueda solo en bibliotecas de audiolibros');
  const book = { title: '薬屋のひとりごと 2', author: '日向夏' };
  const [s1, s2] = results.map((item) => audiobookMatchScore(book, item));
  check(s2 > s1 && s2 >= 0.8, `Coincidencia por título y volumen (${s1.toFixed(2)} vs ${s2.toFixed(2)})`);
  check(volumeNumberOf('本好きの下剋上 第三部「領主の養女1」') === 1 && volumeNumberOf('Vol. 4') === 4 && volumeNumberOf('第12巻') === 12, 'Número de volumen');
  check(normalizeTitle('【オーディオブック】薬屋のひとりごと 第2巻') === normalizeTitle('薬屋のひとりごと'), 'Normalización de títulos');

  /*
    El mismo tomo, escrito como lo escriben los dos servidores de zams.

    Kavita cuelga la colección al final —`(MFブックス)`— y eso tapaba el número de
    tomo, que va justo delante: el título se quedaba sin tomo, y sin tomo el cuarto
    y el séptimo puntuaban igual contra cualquier audiolibro de la serie.
  */
  const kavita4 = '無職転生 ～異世界行ったら本気だす～ 4 (MFブックス)';
  const abs4 = '[4巻] 無職転生 ～異世界行ったら本気だす～ 4';
  check(
    volumeNumberOf(kavita4) === 4 && volumeNumberOf(abs4) === 4,
    `Tomo con colección detrás y con prefijo [N巻] (${volumeNumberOf(kavita4)} y ${volumeNumberOf(abs4)})`
  );
  check(normalizeTitle(kavita4) === normalizeTitle(abs4), 'Mismo título en los dos catálogos');

  const mushoku = (vol: number) => ({
    id: `m${vol}`, libraryId: 'li1', title: `[${vol}巻] 無職転生 ～異世界行ったら本気だす～ ${vol}`,
    author: '理不尽な孫の手', duration: 0, coverUrl: '',
  });
  const libroMushoku4 = { title: kavita4, author: '理不尽な孫の手' };
  const propio = audiobookMatchScore(libroMushoku4, mushoku(4));
  const otroTomo = audiobookMatchScore(libroMushoku4, mushoku(7));
  check(propio >= 0.9, `El tomo 4 reconoce su audiolibro (${propio.toFixed(2)})`);
  // Lo que de verdad estaba roto: el tomo 7 puntuaba igual que el 4.
  check(otroTomo < propio - 0.2, `Otro tomo de la misma serie puntúa menos (${otroTomo.toFixed(2)} < ${propio.toFixed(2)})`);

  // Dos series distintas con el mismo número de tomo no se emparejan.
  const rezero4 = {
    id: 'r4', libraryId: 'li1', title: '[4巻] Re:ゼロから始める異世界生活 4',
    author: '長月達平', duration: 0, coverUrl: '',
  };
  const cruzado = audiobookMatchScore(libroMushoku4, rezero4);
  check(cruzado < 0.3, `Series distintas, mismo tomo, no emparejan (${cruzado.toFixed(2)})`);

  // Un paréntesis que es solo un número sí es el tomo, y se respeta.
  check(volumeNumberOf('ソードアート・オンライン (3)') === 3, 'Tomo escrito entre paréntesis');
  // Y un título que es solo la colección no se queda vacío.
  check(normalizeTitle('(MFブックス)').length > 0, 'Un título que es solo la colección no se vacía');

  /*
    El mismo tomo dos veces en el servidor no es una duda.

    Pasa: una copia vieja, un fichero repetido. Los dos candidatos empatan, y la
    regla de «el segundo a más de 0.1» lo leía como ambigüedad y mandaba a elegir
    entre dos entradas idénticas. Si apuntan al mismo tomo, da igual cuál se coja.
  */
  const duplicado = { ...mushoku(4), id: 'm4bis' };
  const empate = audiobookMatchScore(libroMushoku4, duplicado);
  check(
    empate === propio && volumeNumberOf(duplicado.title) === volumeNumberOf(mushoku(4).title),
    'Dos copias del mismo tomo empatan y son el mismo tomo'
  );

  const session = await startAudiobookPlayback('li1');
  const playCall = calls.find((c) => c.url.endsWith('/play'))!;
  check(playCall.body.forceDirectPlay === true && playCall.body.deviceInfo.clientName === 'Yoru Reader', 'Sesión con reproducción directa');
  // Por la ruta pública de la sesión, no por el fichero con el testigo en la dirección:
  // eso último lo contesta el servidor con 401, y el navegador, que no sabe leer esa
  // respuesta, lo reporta como «Format error». La prueba anterior fijaba ese fallo.
  check(
    session.tracks[0].startOffset === 0
      && session.tracks[0].url === `${A}/public/session/sess1/track/1`
      && session.tracks[1].url === `${A}/public/session/sess1/track/2`,
    'Pistas ordenadas y servidas por la sesión, sin testigo en la dirección'
  );
  check(session.currentTime === 4000 && session.chapters.length === 2, 'Posición y capítulos del servidor');
  const at = locateTrack(session.tracks, 4000);
  check(at.trackIndex === 1 && at.offset === 400, 'Tiempo global → pista y segundo');
  check(chapterAt(session.chapters, 3599) === 0 && chapterAt(session.chapters, 3600) === 1, 'Capítulo actual');

  await updateAudiobookProgress('li1', 7190, 7200);
  const patch = calls.find((c) => c.method === 'PATCH')!;
  check(patch.body.isFinished === true && patch.body.currentTime === 7190, 'Progreso PATCH /api/me/progress');
}

/** Cuándo el texto sigue al audio y cuándo se queda quieto. */
function seguimientoTests() {
  // Una ventana de 1000 px: la banda cómoda va de 220 a 720.
  const ventana = { inicio: 0, fin: 1000 };
  const enLaBanda = { inicio: 400, fin: 500 };   // centro 450
  const masAbajo = { inicio: 740, fin: 800 };    // centro 770, fuera de la banda pero visible
  const fuera = { inicio: 1200, fin: 1300 };     // ni se ve
  const aMedias = { inicio: 950, fin: 1100 };    // empieza dentro, acaba fuera

  check(
    decidirSeguimiento({ modo: 'siguiendo', frase: enLaBanda, ventana }).mover === false,
    'En la banda cómoda el texto no se mueve',
  );
  check(
    decidirSeguimiento({ modo: 'siguiendo', frase: masAbajo, ventana }).mover === true,
    'Visible pero fuera de la banda: se mueve',
  );
  check(
    decidirSeguimiento({ modo: 'siguiendo', estrategia: 'visibilidad', frase: masAbajo, ventana }).mover === false,
    'En paginado, visible basta: no se mueve',
  );
  check(
    decidirSeguimiento({ modo: 'siguiendo', estrategia: 'visibilidad', frase: aMedias, ventana }).mover === true,
    'Media frase asomando no cuenta como visible',
  );
  check(
    decidirSeguimiento({ modo: 'siguiendo', estrategia: 'visibilidad', frase: fuera, ventana }).mover === true,
    'Fuera de la página: se mueve',
  );

  const decision = decidirSeguimiento({ modo: 'suspendido', frase: fuera, ventana });
  check(
    decision.mover === false && decision.ofrecerVolver === true,
    'Suspendido: no se mueve nada y se ofrece volver',
  );
  check(
    decidirSeguimiento({ modo: 'suspendido', forzar: true, frase: fuera, ventana }).mover === false,
    'Ni forzando se mueve algo suspendido',
  );
  check(
    decidirSeguimiento({ modo: 'siguiendo', forzar: true, frase: enLaBanda, ventana }).mover === true,
    'Forzar mueve aunque ya se viera',
  );

  // La barra del reproductor tapa los últimos 300 px: lo de debajo no está visible.
  const tapadoPorLaBarra = { inicio: 780, fin: 860 };
  check(
    decidirSeguimiento({ modo: 'siguiendo', estrategia: 'visibilidad', frase: tapadoPorLaBarra, ventana }).mover === false
      && decidirSeguimiento({ modo: 'siguiendo', estrategia: 'visibilidad', frase: tapadoPorLaBarra, ventana, margenFin: 300 }).mover === true,
    'Una frase detrás de los mandos no cuenta como visible',
  );
}

/** A qué capítulo llevan «siguiente» y «anterior». */
function capitulosTests() {
  const con = (desde: number, hasta: number) => ({ startParagraphId: desde, lastIndex: hasta });
  // Un capítulo sin párrafos: el motor lo guarda con lastIndex = startParagraphId - 1.
  const vacio = (en: number) => ({ startParagraphId: en, lastIndex: en - 1 });

  check(tieneTexto(con(10, 40)) && !tieneTexto(vacio(41)),
    'Capítulos: un rango vacío no cuenta como capítulo con texto');

  const normales = [con(0, 9), con(10, 19), con(20, 29)];
  check(capituloVecino(normales, 1, 1) === 2 && capituloVecino(normales, 1, -1) === 0,
    'Capítulos: con todos llenos, siguiente y anterior son el de al lado');
  check(capituloVecino(normales, 2, 1) === null && capituloVecino(normales, 0, -1) === null,
    'Capítulos: en los extremos no hay vecino');

  /*
    El caso que se nos escapó y rompió la tecla M.

    Entre dos capítulos con texto hay una ilustración, que no tiene párrafos. Ir hacia
    delante caía en uno con texto y funcionaba; ir hacia atrás caía en el vacío, y como
    el salto buscaba la sección por el número de párrafo —y un rango vacío no contiene
    ninguno—, no encontraba nada y la tecla se quedaba muda. En un sentido sí y en el
    otro no.
  */
  const conIlustracion = [con(0, 9), vacio(10), con(10, 19)];
  check(capituloVecino(conIlustracion, 2, -1) === 0,
    'Capítulos: hacia atrás se salta la ilustración y llega al capítulo con texto');
  check(capituloVecino(conIlustracion, 0, 1) === 2,
    'Capítulos: y hacia delante, igual');

  // Varias seguidas, y al final del libro solo quedan vacíos.
  const alFinal = [con(0, 9), vacio(10), vacio(10), vacio(10)];
  check(capituloVecino(alFinal, 0, 1) === null,
    'Capítulos: si solo quedan capítulos sin texto, es el último');
}

/*
  El kanji con furigana y su terminación son la misma palabra.

  Las cuatro primeras salieron de medir su libro: el lector las daba por palabras
  sueltas, con categoría 名詞 puesta a mano, y ninguna existe en ningún diccionario.
  El analizador se simula con lo que Kuromoji devuelve de verdad para cada caso, que
  es lo que esta función consulta.
*/
function okuriganaTests() {
  const analizador = (salidas: Record<string, { surface: string; basicForm: string; pos: string }[]>) =>
    (texto: string) => salidas[texto] || [{ surface: texto, basicForm: texto, pos: '名詞' }];

  /*
    Las claves son el texto **tal como se le pasa al analizador**: el kanji más toda la
    tirada de hiragana que viene detrás, no solo el okurigana. Eso importa: la gracia de
    la función es que el analizador decida dónde cortar, así que el simulador tiene que
    devolver varios tokens como haría Kuromoji, no uno.
  */
  const kuromoji = analizador({
    '尊き': [{ surface: '尊き', basicForm: '尊い', pos: '形容詞' }],
    '自らそれを': [
      { surface: '自ら', basicForm: '自ら', pos: '副詞' },
      { surface: 'それ', basicForm: 'それ', pos: '名詞' },
      { surface: 'を', basicForm: 'を', pos: '助詞' },
    ],
    '辿っており': [
      { surface: '辿っ', basicForm: '辿る', pos: '動詞' },
      { surface: 'て', basicForm: 'て', pos: '助詞' },
      { surface: 'おり', basicForm: 'おる', pos: '動詞' },
    ],
    '苛立ちを': [
      { surface: '苛立ち', basicForm: '苛立つ', pos: '動詞' },
      { surface: 'を', basicForm: 'を', pos: '助詞' },
    ],
    // Aquí el kanji va solo: lo que sigue es una partícula, no su terminación.
    '町に': [{ surface: '町', basicForm: '町', pos: '名詞' }, { surface: 'に', basicForm: 'に', pos: '助詞' }],
  });

  const r1 = juntarOkurigana('尊', 'き魔術師ならば、', kuromoji);
  check(r1?.palabra === '尊い' && r1?.okurigana === 'き' && r1?.pos === '形容詞',
    'Okurigana: 尊 + き es 尊い, no un nombre llamado 尊');

  const r2 = juntarOkurigana('自', 'らそれを生みだそうと', kuromoji);
  check(r2?.palabra === '自ら' && r2?.okurigana === 'ら',
    'Okurigana: 自 + ら es 自ら, y deja de salir un ら suelto');

  const r3 = juntarOkurigana('辿', 'っており、', kuromoji);
  check(r3?.palabra === '辿る' && r3?.okurigana === 'っ',
    'Okurigana: 辿 + っ es 辿る, que sí está en el diccionario');

  const r4 = juntarOkurigana('苛立', 'ちを覚える', kuromoji);
  check(r4?.palabra === '苛立つ' && r4?.okurigana === 'ち',
    'Okurigana: 苛立 + ち es 苛立つ');

  // Lo que NO debe juntarse, que es donde está el riesgo de romper algo.
  check(juntarOkurigana('町', 'に現れた。', kuromoji) === null,
    'Okurigana: 町 seguido de に se queda como estaba, la partícula no se traga');
  check(juntarOkurigana('魔術', '師ならば', kuromoji) === null,
    'Okurigana: si detrás no hay hiragana, no se toca nada');
  check(juntarOkurigana('尊', '', kuromoji) === null && juntarOkurigana('', 'き', kuromoji) === null,
    'Okurigana: sin texto por algún lado, no se inventa nada');
  check(juntarOkurigana('辿', 'って', () => { throw new Error('el analizador falló'); }) === null,
    'Okurigana: si el analizador falla, se deja el texto como estaba');
}

/*
  Qué palabras no merecen un viaje a internet.

  Las de la primera tanda son las que de verdad fallaban en su libro. Las de la segunda
  son el motivo de que el filtro sea tan estrecho: palabras legítimas que no están en
  sus diccionarios y que comparten categoría con la basura del analizador. Si alguna de
  esas dejara de buscarse, el filtro estaría escondiendo vocabulario.
*/
function fueraTests() {
  const gramatica = ['助詞', '助動詞', '助詞,接続助詞', '助動詞,*,*'];
  check(gramatica.every((pos) => mereceBuscarseFuera(pos) === false),
    'Buscar fuera: partículas y auxiliares no salen a internet');

  const palabras = ['名詞', '動詞', '形容詞', '副詞', '連体詞', '接続詞', '感動詞', '接頭詞',
    '名詞,固有名詞', '動詞,自立'];
  check(palabras.every((pos) => mereceBuscarseFuera(pos) === true),
    'Buscar fuera: nombres, verbos, adjetivos y demás sí salen');

  check(mereceBuscarseFuera('') === true && mereceBuscarseFuera(undefined as any) === true,
    'Buscar fuera: sin categoría, se busca igual, que es lo prudente');
}

await kavitaTests();
await absTests();
seguimientoTests();
capitulosTests();
okuriganaTests();
fueraTests();

/*
  En qué orden mandan los diccionarios.

  Importa porque una palabra la resuelve el primero que la tenga: con el JMdict inglés
  por debajo del español, esto decide en qué idioma la lees. Lo que se fija aquí es que
  mande lo que el usuario puso, y que cuando no ha puesto nada no decida la suerte.
*/
function ordenTests() {
  const es = { title: 'JMdict (Spanish)', importedAt: '2026-08-29T10:00:00.000Z' };
  const en = { title: 'JMdict (English)', importedAt: '2026-11-15T04:40:00.000Z' };
  const nov = { title: 'Novels', importedAt: '2026-09-01T12:00:00.000Z' };

  check(JSON.stringify(ordenEfectivo([en, es, nov], ['JMdict (Spanish)', 'JMdict (English)', 'Novels']))
      === JSON.stringify(['JMdict (Spanish)', 'JMdict (English)', 'Novels']),
    'Orden: manda lo que el usuario guardó, aunque lleguen en otro orden');

  // Sin nada guardado: el que instaló primero. Es el caso de zams antes de ordenarlos.
  check(JSON.stringify(ordenEfectivo([en, nov, es], []))
      === JSON.stringify(['JMdict (Spanish)', 'Novels', 'JMdict (English)']),
    'Orden: sin nada guardado, manda el que se instaló primero');

  // Lo guardado manda; lo que no esté, detrás y por antigüedad.
  check(JSON.stringify(ordenEfectivo([en, nov, es], ['Novels']))
      === JSON.stringify(['Novels', 'JMdict (Spanish)', 'JMdict (English)']),
    'Orden: lo guardado va delante y el resto detrás, por antigüedad');

  // Un título que ya no está instalado no debe colarse en el orden.
  check(JSON.stringify(ordenEfectivo([es], ['Borrado', 'JMdict (Spanish)']))
      === JSON.stringify(['JMdict (Spanish)']),
    'Orden: un diccionario borrado no deja hueco en el orden');

  // Sin fecha no se inventa una: se quedan al final y en el mismo orden en que vinieron.
  const viejoA = { title: 'Viejo A' };
  const viejoB = { title: 'Viejo B' };
  check(JSON.stringify(ordenEfectivo([viejoA, viejoB, es], []))
      === JSON.stringify(['JMdict (Spanish)', 'Viejo A', 'Viejo B']),
    'Orden: los que no tienen fecha van al final, sin removerlos entre ellos');

  const orden = ordenEfectivo([en, es], ['JMdict (Spanish)']);
  check(rangoDeDiccionario('JMdict (Spanish)', orden) === 0
      && rangoDeDiccionario('JMdict (English)', orden) === 1
      && rangoDeDiccionario('Ni idea', orden) === 2,
    'Orden: el rango sitúa cada uno, y los desconocidos al final');
}

/*
  Lo que se le dice al usuario cuando una palabra no tiene definición.

  Importa porque el mensaje de antes servía para los tres casos y afirmaba cosas que no
  se habían comprobado: con «solo Jiten» decía que no estaba en sus diccionarios, una
  búsqueda que no se había hecho; y cuando Jiten no contestaba, decía que la palabra no
  existe, que es distinto de no haber podido preguntar. Cada mensaje nombra solo dónde
  se buscó de verdad y qué pasó allí.
*/
function mensajeTests() {
  check(FUENTE_POR_DEFECTO === 'ambos',
    'Mensaje: por defecto se siguen usando los dos, como hasta ahora');

  check(mensajeSinDefinicion('locales', false) === 'noDefFound'
      && mensajeSinDefinicion('locales', true) === 'noDefFound',
    'Mensaje: con solo los suyos, se habla solo de sus diccionarios');

  check(mensajeSinDefinicion('jiten', false) === 'noDefJitenVacio',
    'Mensaje: con solo Jiten y Jiten contestando, la palabra no está en Jiten');
  check(mensajeSinDefinicion('jiten', true) === 'noDefJitenCaido',
    'Mensaje: con solo Jiten y Jiten caído, no se afirma que la palabra no exista');

  check(mensajeSinDefinicion('ambos', false) === 'noDefNinguno',
    'Mensaje: con los dos y Jiten contestando, no está en ninguno de los dos');
  check(mensajeSinDefinicion('ambos', true) === 'noDefOffline',
    'Mensaje: con los dos y sin conexión, se dice que Jiten no se pudo consultar');

  // Las claves tienen que existir en los dos idiomas: una sin traducir se pinta en
  // crudo («noDefJitenCaido») en la ventana del diccionario.
  const claves = ['noDefFound', 'noDefOffline', 'noDefNinguno', 'noDefJitenVacio', 'noDefJitenCaido'];
  check(claves.every((clave) => !!TRANSLATIONS.es[clave] && !!TRANSLATIONS.en[clave]),
    'Mensaje: las cinco claves están traducidas en español y en inglés');
  check(claves.every((clave) => t(clave, 'en') !== clave && t(clave, 'es') !== clave),
    'Mensaje: ninguna clave se pinta en crudo');
}

/*
  Quién parte las palabras: el analizador de Jiten o el de la app.

  Antes no se elegía, se deducía: con clave guardada mandaba Jiten, sin ella el de la app.
  Lo que se fija aquí es que al pasar a elegirlo nadie note el cambio —quien tenía clave
  sigue con Jiten, quien no, con el de la app— y que el modo elegido pese por encima de la
  clave, que es justo lo que no se podía hacer: leer con el analizador de la app teniendo
  cuenta de Jiten.
*/
function analizadorTests() {
  const AJUSTES = 'yoru_parser_settings_v1';
  const poner = (valores: Record<string, unknown>) => localStorage.setItem(AJUSTES, JSON.stringify(valores));
  const comoEscritorio = (si: boolean) => {
    if (si) (globalThis as any).window.electronAPI = {};
    else delete (globalThis as any).window.electronAPI;
  };

  comoEscritorio(false);

  poner({});
  check(modoAnalizadorPorDefecto() === 'nativo' && modoAnalizador() === 'nativo',
    'Analizador: sin clave y sin elegir, parte las palabras la app');

  poner({ jitenApiKey: 'ak_de_prueba' });
  check(modoAnalizadorPorDefecto() === 'jiten' && modoAnalizador() === 'jiten',
    'Analizador: quien ya tenía clave sigue con Jiten sin tocar nada');

  // El interruptor viejo apagado también se respeta como punto de partida.
  poner({ jitenApiKey: 'ak_de_prueba', jitenUseParser: false });
  check(modoAnalizador() === 'nativo',
    'Analizador: quien había apagado el parser de Jiten arranca con el de la app');

  // Lo nuevo: la elección manda sobre todo lo anterior, en los dos sentidos.
  poner({ jitenApiKey: 'ak_de_prueba', parserEngine: 'nativo' });
  check(modoAnalizador() === 'nativo',
    'Analizador: con cuenta de Jiten se puede leer con el de la app, que antes no se podía');
  poner({ jitenApiKey: 'ak_de_prueba', jitenUseParser: false, parserEngine: 'jiten' });
  check(modoAnalizador() === 'jiten',
    'Analizador: y lo elegido pesa más que el interruptor viejo');

  // Un valor que no es ninguno de los dos no se cuela: se vuelve al de siempre.
  poner({ parserEngine: 'lo-que-sea' });
  check(modoAnalizador() === 'nativo',
    'Analizador: un modo desconocido no se usa, se vuelve al de siempre');

  // Qué no se ofrece, y por qué. Sin clave, Jiten no puede: su analizador es un servicio.
  poner({});
  check(motivoModoNoDisponible('jiten') === 'sin-clave' && motivoModoNoDisponible('nativo') === null,
    'Analizador: sin clave, el modo Jiten no se ofrece, y se dice que falta la clave');
  poner({ jitenApiKey: 'ak_de_prueba' });
  check(motivoModoNoDisponible('jiten') === null,
    'Analizador: con clave, el modo Jiten se ofrece');

  /*
    En escritorio las palabras las parte la extensión de lectura. La app no puede pedirle que
    pare: su interruptor (`parsingPaused`) está sin prefijo en chrome.storage.local y el puente
    de ajustes escribe `profile:<id>:<clave>`. Así que allí el modo nativo no se ofrece, y el
    motivo que se da es ese y no «te falta la clave».
  */
  comoEscritorio(true);
  check(motivoModoNoDisponible('nativo') === 'solo-extension',
    'Analizador: en escritorio el modo de la app no se ofrece, y se dice que manda la extensión');
  poner({});
  check(modoAnalizadorPorDefecto() === 'jiten',
    'Analizador: en escritorio, sin elegir, parte las palabras la extensión');

  comoEscritorio(false);
  localStorage.removeItem(AJUSTES);
}

mensajeTests();
analizadorTests();
ordenTests();
console.log(failures ? `\n${failures} pruebas fallaron` : '\nTodas las pruebas pasaron');
if (failures) process.exit(1);
