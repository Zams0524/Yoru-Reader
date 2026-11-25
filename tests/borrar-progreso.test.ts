// «Borrar mi progreso de lectura»: `progresoBorrado.ts` y cómo lo respeta el combinador
// (`cloudMerge.ts`). Nada de red ni de almacenamiento.
// Ejecutar: node tests/run-borrar-progreso-test.mjs
import { diaDeMarca, librosTrasBorrado, mapaTrasBorrado, perfilTrasBorrado, tarjetasTrasBorrado, ultimaMarca } from '../frontend/utils/progresoBorrado';
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
  check(tras.wordStatuses === datos.wordStatuses, 'las palabras no se tocan');
  check(Object.keys(tras.srsData).length === 0, 'una tarjeta de antes de la marca, aunque no se repasara, se borra');
}

console.log('Yoru SRS');
{
  const repasada = { word: '猫', reading: 'ねこ', source: 'Core 2k', state: 2, reps: 7, repetitions: 7, lapses: 1, stability: 30, difficulty: 5, due: '2026-12-20T00:00:00.000Z', lastReview: ANTES, last_review: ANTES, suspended: true };
  const nueva = { word: '犬', source: 'Core 2k', state: 0, reps: 0, due: ANTES };
  const despues = { word: '鳥', source: 'Core 2k', state: 1, reps: 1, lastReview: DESPUES, last_review: DESPUES };
  const importada = { word: '魚', source: 'Core 2k', state: 2, reps: 4, lastReview: ANTES, importedAt: DESPUES };
  const creadaDespues = { word: '花', source: 'Mío', state: 0, due: DESPUES, dueDate: DESPUES };
  // Un mazo de «+ Mazo» vence dentro de un año: su fecha de vencimiento no dice nada.
  const mazoViejo = { word: '_deck_g', source: 'g', state: 0, due: '2027-11-20T00:00:00.000Z', isPlaceholder: true };
  const mazoNuevo = { word: '_deck_Mío', source: 'Mío', state: 0, createdAt: DESPUES, due: '2027-11-23T00:00:00.000Z', isPlaceholder: true };
  const tarjetas = {
    猫: repasada, 犬: nueva, 鳥: despues, 魚: importada, 花: creadaDespues,
    '_deck_Core 2k': { createdAt: ANTES }, _deck_g: mazoViejo, '_deck_Mío': mazoNuevo,
  };

  const tras = tarjetasTrasBorrado(tarjetas, MARCA) as Record<string, any>;
  check(!('猫' in tras), 'la tarjeta repasada antes de la marca se borra');
  check(!('犬' in tras), 'la tarjeta nueva de antes de la marca también');
  check(!('_deck_Core 2k' in tras) && !('_deck_g' in tras), 'los mazos de antes se borran, aunque venzan dentro de un año');
  check(tras.鳥 === despues, 'lo repasado después de la marca se conserva');
  check(tras.魚 === importada, 'un mazo importado después de la marca se conserva');
  check(tras.花 === creadaDespues && tras['_deck_Mío'] === mazoNuevo, 'un mazo y una tarjeta creados después se conservan');
  check(tarjetasTrasBorrado(tras, MARCA) === tras, 'aplicar la marca dos veces no cambia nada');

  const perfil = perfilTrasBorrado({ srsData: tarjetas }, MARCA) as any;
  check(!('猫' in perfil.srsData) && !('_deck_g' in perfil.srsData), 'el perfil con la marca no lleva los mazos ni las tarjetas de antes');

  // Este aparato borró; la cuenta aún guarda el mazo y sus tarjetas.
  const local = exportacion({ srsData: tarjetasTrasBorrado({ 猫: repasada, _deck_g: mazoViejo }, MARCA), progressResetAt: MARCA });
  const nube = exportacion({ srsData: { 猫: repasada, _deck_g: mazoViejo } });
  const r = mergeDatabaseExports(local as any, nube as any, false);
  const srsR = (r.merged.profileData.p as any).srsData || {};
  check(!('猫' in srsR) && !('_deck_g' in srsR) && r.cloudChanged, 'la cuenta no devuelve los mazos ni las tarjetas, y el borrado se sube');
  const otro = mergeDatabaseExports(nube as any, r.merged as any, true);
  const srsOtro = (otro.merged.profileData.p as any).srsData || {};
  check(!('猫' in srsOtro) && !('_deck_g' in srsOtro) && otro.localNeedsReload, 'el otro aparato también los borra');
  const quieto = mergeDatabaseExports(r.merged as any, JSON.parse(JSON.stringify(r.merged)), false);
  check(!quieto.localChanged && !quieto.cloudChanged, 'ya borrados, combinar de nuevo no cambia nada');

  check(diaDeMarca('2026-11-22T12:00:00') === '2026-11-22', 'el día de la marca es el día local');
}

console.log('eliminar un mazo');
{
  // Se eliminó el mazo «g» aquí; el otro aparato aún lo guarda (sin fecha de creación).
  const BORRADO = '2026-11-24T10:00:00.000Z';
  const mazo = { word: '_deck_g', source: 'g', state: 0, due: '2027-11-20T00:00:00.000Z', isPlaceholder: true };
  const tarjeta = { word: '猫', source: 'g', state: 0, due: ANTES };
  const local = exportacion({ srsData: {}, srsRemovals: { _deck_g: BORRADO, 猫: BORRADO } });
  const nube = exportacion({ srsData: { _deck_g: mazo, 猫: tarjeta } });
  const r = mergeDatabaseExports(local as any, nube as any, false);
  const srs = (r.merged.profileData.p as any).srsData || {};
  check(!('_deck_g' in srs) && !('猫' in srs), 'el mazo eliminado y sus tarjetas no vuelven del otro aparato');

  // Se vuelve a crear con el mismo nombre después: se queda.
  const otraVez = { ...mazo, createdAt: DESPUES.replace('23', '25') };
  const nube2 = exportacion({ srsData: { _deck_g: otraVez } });
  const r2 = mergeDatabaseExports(local as any, nube2 as any, false);
  check(Boolean(((r2.merged.profileData.p as any).srsData || {})._deck_g), 'un mazo creado otra vez después del borrado se conserva');
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
