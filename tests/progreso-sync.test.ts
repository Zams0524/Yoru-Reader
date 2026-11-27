// La página en la que va un libro pasa de un aparato a otro (cloudMerge.selloDePosicion).
// Hasta el 27 nov 2026 la decidía `lastRead`, que cambia con solo abrir el libro: el
// teléfono abría en la página vieja y esa ganaba a la que se había leído en el PC.
// Ejecutar: node tests/run-progreso-sync-test.mjs

import { mergeProfileData, selloDePosicion } from '../frontend/utils/cloudMerge';

let failures = 0;
function check(condicion: boolean, nombre: string) {
  if (condicion) {
    console.log(`  ok  ${nombre}`);
  } else {
    failures += 1;
    console.error(`FALLA  ${nombre}`);
  }
}

const T = (minutos: number) => new Date(Date.UTC(2026, 10, 27, 12, minutos)).toISOString();
const libro = (extra: any) => ({ id: 'a', title: 'Re:Zero 1', author: 'Nagatsuki', chapters: [], ...extra });
const pos = (chapter: number, page: number, percent: number) => ({ currentChapter: chapter, currentPage: page, percent, charactersRead: 0, secondsRead: 0 });
const sello = (chapter: number, page: number, at: string) => ({ at, chapter, page });

// 1. El caso de zams: leyó en el PC hasta la página 900; el teléfono abrió después en la 100.
{
  const pc = libro({ lastRead: T(10), progress: pos(5, 900, 60), positionStamp: sello(5, 900, T(10)) });
  const movil = libro({ id: 'b', lastRead: T(20), progress: pos(1, 100, 10), positionStamp: sello(1, 100, T(0)) });
  const enMovil = mergeProfileData({ books: [movil] }, { books: [pc] }, false).books![0];
  check(enMovil.progress.currentPage === 900 && enMovil.progress.currentChapter === 5, 'la página del PC llega al teléfono aunque el teléfono abrió el libro después');
  check(enMovil.progress.percent === 60, 'y su porcentaje con ella');
  check(enMovil.positionStamp?.page === 900, 'el sello viaja con la página');
  check(enMovil.lastRead === T(20) && enMovil.id === 'b', 'el resto de la ficha sigue siendo la más nueva');
  const enPc = mergeProfileData({ books: [pc] }, { books: [movil] }, false).books![0];
  check(enPc.progress.currentPage === 900, 'y el PC no la pierde al combinar con la copia del teléfono');
}

// 2. Si el teléfono de verdad leyó más tarde, gana el teléfono.
{
  const pc = libro({ lastRead: T(10), progress: pos(5, 900, 60), positionStamp: sello(5, 900, T(10)) });
  const movil = libro({ lastRead: T(30), progress: pos(6, 950, 64), positionStamp: sello(6, 950, T(30)) });
  const r = mergeProfileData({ books: [pc] }, { books: [movil] }, false).books![0];
  check(r.progress.currentPage === 950, 'la página movida más tarde gana');
}

// 3. Una versión vieja de la app mueve la página sin tocar el sello: cuenta su lastRead.
{
  const pc = libro({ lastRead: T(10), progress: pos(5, 900, 60), positionStamp: sello(5, 900, T(10)) });
  // El teléfono viejo recibió la ficha del PC (con su sello), leyó y guardó la 950 sin sello nuevo.
  const movilViejo = libro({ lastRead: T(30), progress: pos(6, 950, 64), positionStamp: sello(5, 900, T(10)) });
  check(selloDePosicion(movilViejo) === Date.parse(T(30)), 'un sello que no apunta a la página no vale');
  const r = mergeProfileData({ books: [pc] }, { books: [movilViejo] }, false).books![0];
  check(r.progress.currentPage === 950, 'lo leído en una versión vieja también llega');
}

// 4. Libros sin sello (de antes de esto): como siempre, por lastRead.
{
  const a = libro({ lastRead: T(5), progress: pos(1, 10, 1) });
  const b = libro({ lastRead: T(9), progress: pos(2, 20, 2) });
  const r = mergeProfileData({ books: [a] }, { books: [b] }, false).books![0];
  check(r.progress.currentPage === 20, 'sin sello, la copia leída más tarde');
  const igual = mergeProfileData({ books: [a] }, { books: [a] }, false).books![0];
  check(igual.positionStamp === undefined, 'y no se inventa un sello');
}

// 5. Los totales siguen creciendo aunque la página venga de la otra copia.
{
  const pc = libro({ lastRead: T(10), progress: { ...pos(5, 900, 60), charactersRead: 5000, secondsRead: 600 }, positionStamp: sello(5, 900, T(10)) });
  const movil = libro({ lastRead: T(20), progress: { ...pos(1, 100, 10), charactersRead: 7000, secondsRead: 300 }, positionStamp: sello(1, 100, T(0)) });
  const r = mergeProfileData({ books: [movil] }, { books: [pc] }, false).books![0];
  check(r.progress.charactersRead === 7000 && r.progress.secondsRead === 600, 'caracteres y segundos se quedan con el máximo');
}

if (failures) {
  console.error(`\nprogreso-sync: ${failures} fallo(s)`);
  process.exit(1);
}
console.log('\nprogreso-sync: todo bien');
