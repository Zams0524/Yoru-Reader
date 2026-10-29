// Kavita / Audiobookshelf clients against a mocked server (no real server needed).
// Run: node tests/run-media-servers-test.mjs
import JSZip from 'jszip';
import {
  extractKavitaDownload,
  getKavitaLibraries,
  getKavitaSeries,
  getKavitaVolumes,
  kavitaPageForPercent,
  kavitaVolumesToBooks,
  loginKavita,
  saveKavitaConfig,
  searchKavitaSeries,
  testKavitaConnection,
} from '../frontend/utils/kavitaService';
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
