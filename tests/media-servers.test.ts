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

  const session = await startAudiobookPlayback('li1');
  const playCall = calls.find((c) => c.url.endsWith('/play'))!;
  check(playCall.body.forceDirectPlay === true && playCall.body.deviceInfo.clientName === 'Yoru Reader', 'Sesión con reproducción directa');
  check(session.tracks[0].startOffset === 0 && session.tracks[1].url === `${A}/api/items/li1/file/222?token=abs-token`, 'Pistas ordenadas con token');
  check(session.currentTime === 4000 && session.chapters.length === 2, 'Posición y capítulos del servidor');
  const at = locateTrack(session.tracks, 4000);
  check(at.trackIndex === 1 && at.offset === 400, 'Tiempo global → pista y segundo');
  check(chapterAt(session.chapters, 3599) === 0 && chapterAt(session.chapters, 3600) === 1, 'Capítulo actual');

  await updateAudiobookProgress('li1', 7190, 7200);
  const patch = calls.find((c) => c.method === 'PATCH')!;
  check(patch.body.isFinished === true && patch.body.currentTime === 7190, 'Progreso PATCH /api/me/progress');
}

await kavitaTests();
await absTests();
console.log(failures ? `\n${failures} pruebas fallaron` : '\nTodas las pruebas pasaron');
if (failures) process.exit(1);
