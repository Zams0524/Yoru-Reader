// Los marcadores y subrayados pasan de un aparato a otro, uno a uno (utils/marcasSync.ts).
// Hasta el 26 nov 2026, al combinar dos copias de un libro ganaba la ficha entera de la
// leída más tarde, y un marcador puesto en el PC no llegaba al móvil si el móvil había
// leído ese libro después. Los de un libro leído del servidor sin descargar no viajaban.
// Ejecutar: node tests/run-marcadores-sync-test.mjs

import { mergeDatabaseExports, mergeProfileData } from '../frontend/utils/cloudMerge';
import { combinarMarcasTemporales, sellarCambios, claveMarcador } from '../frontend/utils/marcasSync';

let failures = 0;
function check(condicion: boolean, nombre: string) {
  if (condicion) {
    console.log(`  ok  ${nombre}`);
  } else {
    failures += 1;
    console.error(`FALLA  ${nombre}`);
  }
}

const T = (minutos: number) => new Date(Date.UTC(2026, 10, 26, 12, minutos)).toISOString();
const libro = (extra: any) => ({ id: 'a', title: 'Re:Zero 1', author: 'Nagatsuki', chapters: [], ...extra });
const parrafos = (lista: any[] | undefined) => (lista || []).map((b) => b.paragraphId).sort((x, y) => x - y);

// 1. El caso de zams: marcador en el PC, el móvil leyó después.
{
  const pc = libro({ lastRead: T(0), bookmarks: [{ paragraphId: 40, content: 'x', page: true, createdAt: T(5) }] });
  const movil = libro({ id: 'b', lastRead: T(10), bookmarks: [] });
  const enMovil = mergeProfileData({ books: [movil] }, { books: [pc] }, false).books![0];
  check(parrafos(enMovil.bookmarks).join() === '40', 'el marcador del PC llega al móvil aunque el móvil leyó después');
  check(enMovil.lastRead === T(10) && enMovil.id === 'b', 'el resto de la ficha sigue siendo la más nueva');
  const enPc = mergeProfileData({ books: [pc] }, { books: [movil] }, true).books![0];
  check(parrafos(enPc.bookmarks).join() === '40', 'y el PC no lo pierde al combinar con la copia del móvil');
}

// 2. Marcadores de los dos aparatos se juntan.
{
  const pc = libro({ lastRead: T(0), bookmarks: [{ paragraphId: 1, createdAt: T(1) }] });
  const movil = libro({ lastRead: T(9), bookmarks: [{ paragraphId: 2, createdAt: T(2) }] });
  const r = mergeProfileData({ books: [pc] }, { books: [movil] }, false).books![0];
  check(parrafos(r.bookmarks).join() === '1,2', 'los de los dos aparatos se juntan');
}

// 3. Quitar un marcador en un aparato no lo devuelve el otro.
{
  const antes = [{ paragraphId: 7, createdAt: T(1) }];
  const quitado = sellarCambios(antes, [], {}, claveMarcador, T(20));
  check(quitado.borrados['7'] === T(20), 'quitar uno deja su fecha');
  const pc = libro({ lastRead: T(0), bookmarks: quitado.items, bookmarksRemoved: quitado.borrados });
  const movil = libro({ lastRead: T(30), bookmarks: antes });
  const r = mergeProfileData({ books: [movil] }, { books: [pc] }, false).books![0];
  check(parrafos(r.bookmarks).length === 0, 'el quitado en el PC no vuelve desde el móvil');
  // Y si se vuelve a poner después, se queda.
  const puesto = libro({ lastRead: T(0), bookmarks: [{ paragraphId: 7, createdAt: T(40) }] });
  const r2 = mergeProfileData({ books: [puesto] }, { books: [r] }, false).books![0];
  check(parrafos(r2.bookmarks).join() === '7' && !r2.bookmarksRemoved?.['7'], 'puesto otra vez después de quitarlo, se queda');
}

// 4. Libros antiguos sin marcadores: la combinación no cambia nada ni sube nada.
{
  const viejo = libro({ lastRead: T(0), progress: { charactersRead: 0, secondsRead: 0 } });
  const datos = { profiles: [{ id: 'p' }], profileData: { p: { books: [viejo] } } };
  const r = mergeDatabaseExports(datos as any, JSON.parse(JSON.stringify(datos)), false);
  check(!r.localChanged && !r.cloudChanged, 'sin marcadores no hay cambios que subir');
}

// 5. Al volver a guardar lo mismo, las fechas no cambian (nada nuevo que subir).
{
  const guardados = [{ paragraphId: 3, content: 'a', createdAt: T(1) }];
  const delLector = [{ paragraphId: 3, content: 'a' }];
  const r = sellarCambios(guardados, delLector, {}, claveMarcador, T(50));
  check(r.items[0].createdAt === T(1) && !r.items[0].updatedAt, 'la copia del lector sin fechas no cuenta como cambio');
  const nuevo = sellarCambios(guardados, [...delLector, { paragraphId: 9 }], {}, claveMarcador, T(50));
  check(nuevo.items[1].createdAt === T(50), 'uno nuevo lleva fecha');
}

// 6. Libros leídos del servidor sin descargar: sus marcadores viajan también.
{
  const pc = { 'tmp:kavita:12': { bookmarks: [{ paragraphId: 5, createdAt: T(1) }] } };
  const movil = { 'tmp:kavita:12': { bookmarks: [{ paragraphId: 8, createdAt: T(2) }] }, 'tmp:kavita:13': { highlights: [{ id: 'h', createdAt: T(3) }] } };
  const r = combinarMarcasTemporales(pc, movil);
  check(parrafos(r['tmp:kavita:12'].bookmarks).join() === '5,8', 'temporal: se juntan los de los dos');
  check(r['tmp:kavita:13'].highlights?.length === 1, 'temporal: llegan los de un tomo que este aparato no abrió');
  const local = { profiles: [{ id: 'p' }], profileData: { p: { books: [], marcasTemporales: pc } } };
  const remoto = { profiles: [{ id: 'p' }], profileData: { p: { books: [] } } };
  const m = mergeDatabaseExports(local as any, remoto as any, false);
  check(m.cloudChanged && !!m.merged.profileData.p.marcasTemporales, 'temporal: se sube al servidor');
  const otra = mergeDatabaseExports(m.merged as any, JSON.parse(JSON.stringify(m.merged)), false);
  check(!otra.localChanged && !otra.cloudChanged, 'temporal: una segunda vuelta ya no cambia nada');
}

// 7. Datos guardados con el sello de lista entera del PR #127 (`bookmarksAt`), sin fecha
// en cada marcador: siguen funcionando.
{
  const pc = libro({ lastRead: T(0), bookmarks: [{ paragraphId: 40, content: 'x' }], bookmarksAt: T(5) });
  const tel = libro({ id: 'b', lastRead: T(10), bookmarks: [] });
  const enTel = mergeProfileData({ books: [tel] }, { books: [pc] }, false).books![0];
  check(parrafos(enTel.bookmarks).join() === '40' && enTel.bookmarksAt === T(5), '#127: el marcador sin fecha del PC llega al teléfono');
  const telBorra = { ...enTel, bookmarks: [], bookmarksAt: T(20) };
  const enPc = mergeProfileData({ books: [pc] }, { books: [telBorra] }, false).books![0];
  check(parrafos(enPc.bookmarks).length === 0, '#127: quitado en el teléfono (lista tocada después), se quita en el PC');
  // Pero uno con fecha propia no se pierde solo porque la otra lista se tocó después.
  const pcNuevo = libro({ lastRead: T(0), bookmarks: [{ paragraphId: 41, createdAt: T(30) }], bookmarksAt: T(30) });
  const telOtro = libro({ id: 'b', lastRead: T(10), bookmarks: [{ paragraphId: 50, createdAt: T(31) }], bookmarksAt: T(31) });
  const r = mergeProfileData({ books: [telOtro] }, { books: [pcNuevo] }, false).books![0];
  check(parrafos(r.bookmarks).join() === '41,50', 'con fecha propia, los de los dos aparatos se quedan');
}

if (failures) {
  console.error(`\n${failures} prueba(s) fallaron`);
  process.exit(1);
}
console.log('\nmarcadores-sync: todo bien');
