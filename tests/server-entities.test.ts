// Series y autores del servidor para Explorar, contra servidores simulados.
// Run: node tests/run-server-entities-test.mjs
import { saveKavitaConfig } from '../frontend/utils/kavitaService';
import { saveAudiobookshelfConfig } from '../frontend/utils/audiobookshelfService';
import {
  cleanSeriesName,
  getCachedServerEntities,
  refreshServerEntities,
  serverAuthorGroups,
  serverSeriesGroups,
  splitAuthors,
} from '../frontend/utils/serverEntities';

type Call = { method: string; url: string };
const calls: Call[] = [];
const json = (data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });

const K = 'http://kavita.test:5000';
const A = 'http://abs.test:13378';
// 130 series en Kavita: dos páginas de 100.
const kavitaSeries = Array.from({ length: 130 }, (_, i) => ({ id: i + 1, name: `Serie ${i + 1}`, libraryId: 2 }));

(globalThis as any).fetch = async (url: string, init: any = {}) => {
  calls.push({ method: init.method || 'GET', url });
  if (url === `${K}/api/Library/libraries`) return json([{ id: 2, name: 'Light Novels', type: 4 }]);
  const page = /\/api\/Series\/v2\?PageNumber=(\d+)&PageSize=(\d+)/.exec(url);
  if (page) {
    const n = Number(page[1]);
    const size = Number(page[2]);
    const slice = kavitaSeries.slice((n - 1) * size, n * size);
    return json(slice, { pagination: JSON.stringify({ currentPage: n, totalPages: 2, totalItems: 130 }) });
  }
  const meta = /\/api\/Series\/metadata\?seriesId=(\d+)/.exec(url);
  if (meta) {
    const id = Number(meta[1]);
    return json({ writers: id <= 3 ? [{ id: 1, name: '西尾維新' }] : id === 4 ? [{ id: 2, name: '川原礫' }] : [] });
  }
  if (url === `${A}/api/libraries`) return json({ libraries: [{ id: 'lib1', name: 'Audio', mediaType: 'book' }] });
  if (url.startsWith(`${A}/api/libraries/lib1/items`)) {
    return json({
      total: 3,
      results: [
        { id: 'a1', libraryId: 'lib1', media: { metadata: { title: 'Tomo 2', authorName: '川原礫', seriesName: 'SAO #2' } } },
        { id: 'a2', libraryId: 'lib1', media: { metadata: { title: 'Tomo 1', authorName: '川原礫', seriesName: 'SAO #1' } } },
        { id: 'a3', libraryId: 'lib1', media: { metadata: { title: 'Suelto', authorName: 'Ana, Beto' } } },
      ],
    });
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
(globalThis as any).document = new EventTarget();

let failures = 0;
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures++;
};

check(cleanSeriesName('SAO #12') === 'SAO' && cleanSeriesName('Re:Zero #1.5') === 'Re:Zero', 'El número de tomo no forma parte del nombre de la serie');
check(JSON.stringify(splitAuthors('Ana, Beto')) === '["Ana","Beto"]', 'Varios autores separados por comas son varios autores');

// Sin servidores configurados no se pide nada.
await refreshServerEntities(true);
check(calls.length === 0 && getCachedServerEntities().kavita.length === 0, 'Sin servidores no se pregunta a nadie');

saveKavitaConfig({ serverUrl: K, apiKey: 'key-1', token: 'jwt' } as any);
saveAudiobookshelfConfig({ serverUrl: A, token: 'abs' } as any);
await refreshServerEntities(true);
const entities = getCachedServerEntities();
check(entities.kavita.length === 130, `Se traen todas las series de Kavita, no una muestra (${entities.kavita.length})`);
check(entities.audiobooks.length === 3, 'Se traen los audiolibros');

const series = serverSeriesGroups(entities);
const sao = series.find((group) => group.name === 'SAO');
check(series.length === 131, `Series: 130 de Kavita + 1 de audiolibros (${series.length})`);
check(Boolean(sao) && sao!.items.length === 2 && sao!.items[0].title === 'Tomo 1', 'La serie de audiolibros junta sus tomos en orden');
check(series.find((group) => group.key === 'kavita:1')?.items[0].author === '西尾維新', 'La serie de Kavita lleva su autor');

const authors = serverAuthorGroups(entities);
const nisio = authors.find((group) => group.name === '西尾維新');
const kawahara = authors.find((group) => group.name === '川原礫');
check(nisio?.items.length === 3, 'Autor de Kavita con sus tres series');
check(kawahara?.items.length === 3 && kawahara.items.some((i) => i.source === 'kavita') && kawahara.items.some((i) => i.source === 'audiobookshelf'),
  'Un autor con series en Kavita y audiolibros sale una vez, con todo junto');
check(Boolean(authors.find((g) => g.name === 'Ana')) && Boolean(authors.find((g) => g.name === 'Beto')), 'Coautores separados');

// Segundo refresco: los autores ya conocidos no se vuelven a pedir.
const before = calls.filter((c) => c.url.includes('/api/Series/metadata')).length;
await refreshServerEntities(true);
const after = calls.filter((c) => c.url.includes('/api/Series/metadata')).length;
check(before === 130 && after === before, `Los metadatos se piden una sola vez por serie (${before} → ${after})`);

// Reciente: sin forzar no se vuelve a pedir nada.
const n = calls.length;
await refreshServerEntities();
check(calls.length === n, 'Con la caché reciente no se pregunta al servidor');

if (failures) {
  console.error(`\n${failures} fallo(s)`);
  process.exit(1);
}
console.log('\nTodo bien');
