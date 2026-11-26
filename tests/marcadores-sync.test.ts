// Un marcador puesto en un aparato llega al otro aunque el otro haya leído después.
// Antes `mergeBook` se quedaba con la lista del libro con el `lastRead` más reciente, y poner un
// marcador no lo cambia: el teléfono, que había leído después, borraba el marcador del PC.
// Ejecutar: node tests/run-marcadores-sync-test.mjs
import { mergeBooks } from '../frontend/utils/cloudMerge';

let failures = 0;
function check(condicion: boolean, nombre: string) {
  if (condicion) console.log(`  ok  ${nombre}`);
  else { failures += 1; console.error(`FALLA  ${nombre}`); }
}

const base = { id: 'a', title: 'Re:Zero 1', author: 'Nagatsuki', createdAt: '2026-11-01T00:00:00Z', chapters: [] };

// PC: leyó a las 10, puso un marcador a las 11.
const pc = {
  ...base, lastRead: '2026-11-26T10:00:00Z', progress: { currentPage: 50 },
  bookmarks: [{ id: 'm1', paragraph: 40 }], bookmarksAt: '2026-11-26T11:00:00Z',
};
// Teléfono: leyó a las 12 (más tarde), sin marcadores.
const tel = { ...base, lastRead: '2026-11-26T12:00:00Z', progress: { currentPage: 80 }, bookmarks: [] };

const enTel = mergeBooks([tel], [pc])[0];
check(enTel.bookmarks.length === 1 && enTel.bookmarks[0].id === 'm1', 'el marcador del PC llega al teléfono');
check(enTel.progress.currentPage === 80, 'la página del teléfono (leída después) se queda');

const enPc = mergeBooks([pc], [tel])[0];
check(enPc.bookmarks.length === 1, 'el PC no pierde su marcador al recibir la copia del teléfono');

// Borrar un marcador también viaja: el teléfono lo quita a las 13.
const telBorra = { ...enTel, bookmarks: [], bookmarksAt: '2026-11-26T13:00:00Z' };
const pcTras = mergeBooks([pc], [telBorra])[0];
check(pcTras.bookmarks.length === 0, 'un marcador borrado en el teléfono se borra en el PC');

// Datos de antes (sin sello en ningún lado): como hasta ahora, gana el libro más nuevo.
const viejoPc = { ...base, lastRead: '2026-11-26T10:00:00Z', bookmarks: [{ id: 'x' }] };
const viejoTel = { ...base, lastRead: '2026-11-26T12:00:00Z', bookmarks: [{ id: 'y' }] };
check(mergeBooks([viejoPc], [viejoTel])[0].bookmarks[0].id === 'y', 'sin sellos se queda la lista del libro más nuevo');

// Subrayados, igual.
const pcSub = { ...pc, highlights: [{ id: 'h1' }], highlightsAt: '2026-11-26T11:30:00Z' };
check(mergeBooks([tel], [pcSub])[0].highlights?.[0]?.id === 'h1', 'el subrayado del PC llega al teléfono');

if (failures) { console.error(`\n${failures} fallo(s)`); process.exit(1); }
console.log('\nmarcadores-sync: todo bien');
