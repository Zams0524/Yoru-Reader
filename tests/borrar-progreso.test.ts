// «Borrar mi progreso de lectura»: `progresoBorrado.ts` y cómo lo respeta el combinador
// (`cloudMerge.ts`). Nada de red ni de almacenamiento.
// Ejecutar: node tests/run-borrar-progreso-test.mjs
import { librosTrasBorrado, mapaTrasBorrado, perfilTrasBorrado, ultimaMarca } from '../frontend/utils/progresoBorrado';
import { mergeDatabaseExports } from '../frontend/utils/cloudMerge';

let failures = 0;
function check(condicion: boolean, nombre: string) {
  if (condicion) {
    console.log(`  ok  ${nombre}`);
  } else {
    failures += 1;
    console.error(`FALLA  ${nombre}`);
  }
}

const ANTES = '2026-11-20T10:00:00.000Z';
const MARCA = '2026-11-22T12:00:00.000Z';
const DESPUES = '2026-11-23T09:00:00.000Z';

function libro(cambios: Record<string, any> = {}) {
  return {
    id: 'b1',
    title: 'こころ',
    author: '夏目漱石',
    chapters: [],
    createdAt: '2026-11-01T00:00:00.000Z',
    status: 'reading',
    lastRead: ANTES,
    bookmarks: [{ id: 'm1' }],
    highlights: [{ id: 'h1' }],
    progress: { currentChapter: 3, currentPage: 12, percent: 40, charactersRead: 42000, secondsRead: 3600 },
    ...cambios,
  };
}

function exportacion(datos: Record<string, any>) {
  return {
    version: 2,
    activeProfileId: 'p',
    profiles: [{ id: 'p', name: 'zams' }],
    profileData: { p: datos },
  };
}

console.log('progresoBorrado');
{
  check(ultimaMarca(null, undefined) === null, 'sin marcas no hay marca');
  check(ultimaMarca(ANTES, MARCA) === MARCA && ultimaMarca(MARCA, ANTES) === MARCA, 'de dos marcas gana la más reciente');

  const [vaciado] = librosTrasBorrado([libro()], MARCA);
  check(vaciado.progress.percent === 0 && vaciado.progress.currentChapter === 0 && vaciado.progress.currentPage === 0, 'el libro vuelve al principio');
  check(vaciado.progress.charactersRead === 0 && vaciado.progress.secondsRead === 0, 'lo leído queda a cero');
  check(vaciado.status === 'unread' && vaciado.lastRead === null, 'queda sin empezar y sin fecha de lectura');
  check(vaciado.bookmarks.length === 1 && vaciado.highlights.length === 1 && vaciado.title === 'こころ', 'el libro, sus marcadores y sus notas se conservan');

  const leidoDespues = [libro({ lastRead: DESPUES })];
  check(librosTrasBorrado(leidoDespues, MARCA) === leidoDespues, 'lo leído después de la marca no se toca');
  const sinEmpezar = [libro({ lastRead: undefined, status: 'unread', progress: { currentChapter: 0, currentPage: 0, percent: 0, charactersRead: 0, secondsRead: 0 } })];
  check(librosTrasBorrado(sinEmpezar, MARCA) === sinEmpezar, 'un libro sin empezar se deja como está');

  const mapa = {
    a: { chapterId: 1, seriesId: 9, percent: 60, at: ANTES },
    b: { chapterId: 2, seriesId: 9, percent: 10, at: DESPUES },
    c: { currentTime: 500, duration: 1000, at: ANTES },
  };
  const olvidado = mapaTrasBorrado(mapa, MARCA) as Record<string, any>;
  check(olvidado.a.borrado === true && olvidado.a.percent === 0 && olvidado.a.at === MARCA, 'el tomo de Kavita de antes queda olvidado, con la fecha de la marca');
  check(olvidado.c.borrado === true && olvidado.c.currentTime === 0, 'el audiolibro de antes queda olvidado');
  check(olvidado.b === mapa.b, 'lo leído del servidor después de la marca se conserva');
  check(mapaTrasBorrado(olvidado, MARCA) === olvidado, 'aplicar la marca dos veces no cambia nada');

  const datos = { books: [libro()], wordStatuses: { 猫: 'known' }, srsData: { 猫: { due: ANTES } } };
  check(perfilTrasBorrado(datos, null) === datos, 'sin marca el perfil no cambia');
  const tras = perfilTrasBorrado(datos, MARCA);
  check(tras.wordStatuses === datos.wordStatuses && tras.srsData === datos.srsData, 'las palabras y las tarjetas no se tocan');
}

console.log('el combinador respeta el borrado');
{
  // Este aparato borró; el servidor aún guarda lo de antes.
  const local = exportacion({
    books: librosTrasBorrado([libro()], MARCA),
    serverProgress: { kavita: mapaTrasBorrado({ a: { chapterId: 1, seriesId: 9, percent: 60, at: ANTES } }, MARCA), audiobooks: {} },
    progressResetAt: MARCA,
  });
  const nube = exportacion({
    books: [libro({ id: 'otro-id' })],
    serverProgress: { kavita: { a: { chapterId: 1, seriesId: 9, percent: 60, at: ANTES } }, audiobooks: { x: { currentTime: 500, duration: 1000, at: ANTES } } },
  });
  const r = mergeDatabaseExports(local as any, nube as any, false);
  const p = r.merged.profileData.p as any;
  check(p.books.length === 1 && p.books[0].progress.charactersRead === 0 && p.books[0].progress.percent === 0, 'el servidor no devuelve lo borrado');
  check(p.serverProgress.kavita.a.borrado === true && p.serverProgress.audiobooks.x.borrado === true, 'lo del servidor de medios tampoco vuelve');
  check(p.progressResetAt === MARCA, 'la marca sigue en el resultado');
  check(r.cloudChanged === true, 'el borrado se sube');
  check(r.localNeedsReload === false, 'y este aparato no se recarga: sus libros ya estaban vaciados');

  // El otro aparato, que no sabía nada, recibe el borrado.
  const otro = mergeDatabaseExports(nube as any, r.merged as any, true);
  const q = otro.merged.profileData.p as any;
  check(q.books[0].progress.secondsRead === 0 && q.books[0].lastRead === null, 'el otro aparato también lo borra');
  check(q.books[0].id === 'otro-id', 'y conserva su propio identificador del libro');
  check(otro.localNeedsReload === true, 'y se recarga para enseñarlo');

  // Una segunda vuelta ya no cambia nada: no hay sincronizaciones en bucle.
  const quieto = mergeDatabaseExports(r.merged as any, JSON.parse(JSON.stringify(r.merged)), false);
  check(!quieto.localChanged && !quieto.cloudChanged, 'una vez aplicado, combinar de nuevo no cambia nada');

  // Lo que se lee después del borrado, en el otro aparato, cuenta.
  const releido = exportacion({
    books: [libro({ lastRead: DESPUES, progress: { currentChapter: 0, currentPage: 4, percent: 2, charactersRead: 900, secondsRead: 120 } })],
  });
  const s = mergeDatabaseExports(local as any, releido as any, true).merged.profileData.p as any;
  check(s.books[0].progress.charactersRead === 900 && s.books[0].progress.percent === 2, 'lo leído después del borrado se conserva');

  // Sin marca en ningún lado, todo como siempre.
  const a = exportacion({ books: [libro()] });
  const b = exportacion({ books: [libro()] });
  const igual = mergeDatabaseExports(a as any, b as any, false);
  check(!igual.localChanged && !igual.cloudChanged && !('progressResetAt' in (igual.merged.profileData.p as any)), 'sin borrado, el combinador hace lo de siempre');
}

if (failures > 0) {
  console.error(`\n${failures} comprobaciones fallaron`);
  process.exit(1);
}
console.log('\nTodo en orden');
