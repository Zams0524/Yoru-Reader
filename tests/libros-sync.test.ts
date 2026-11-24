// Los libros del catálogo viajan con la sincronización: `db.exportFullDatabase` los lee de
// la estantería que usa la app y `db.importFullDatabase` los deja en esa misma estantería.
// Hasta el 22 nov 2026 los dos miraban `books_list_<perfil>`, donde la app no escribe.
// Viaja la ficha (estado, progreso, portada pequeña), no el texto: ese va aparte
// (`textosLibros.ts`) y el otro aparato lo baja al abrir el libro.
// Con un localStorage y un IndexedDB de mentira, sin red.
// Ejecutar: node tests/run-libros-sync-test.mjs

let failures = 0;
function check(condicion: boolean, nombre: string) {
  if (condicion) {
    console.log(`  ok  ${nombre}`);
  } else {
    failures += 1;
    console.error(`FALLA  ${nombre}`);
  }
}

/* ------------------------------------------------ almacenamiento de mentira */

function localStorageDeMentira() {
  const datos = new Map<string, string>();
  return {
    getItem: (clave: string) => (datos.has(clave) ? datos.get(clave)! : null),
    setItem: (clave: string, valor: string) => { datos.set(clave, String(valor)); },
    removeItem: (clave: string) => { datos.delete(clave); },
    key: (i: number) => [...datos.keys()][i] ?? null,
    get length() { return datos.size; },
    clear: () => datos.clear(),
  };
}

/** Lo justo de IndexedDB que usa `db.ts`: un almacén clave-valor con get y put. */
function indexedDbDeMentira() {
  const almacen = new Map<string, any>();
  const peticion = (resultado: () => any) => {
    const req: any = {};
    queueMicrotask(() => { req.result = resultado(); req.onsuccess?.({ target: req }); });
    return req;
  };
  const base = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => undefined,
    close: () => undefined,
    transaction: () => {
      const tx: any = {
        objectStore: () => ({
          // Copia al entrar y al salir, como hace el de verdad: nada de compartir referencias.
          get: (clave: string) => peticion(() => (almacen.has(clave) ? structuredClone(almacen.get(clave)) : undefined)),
          put: (valor: any, clave: string) => peticion(() => { almacen.set(clave, structuredClone(valor)); }),
          // La migración de claves antiguas (`migrarClaves.ts`) recorre con cursor: aquí no hay nada que migrar.
          openCursor: () => peticion(() => null),
        }),
      };
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    },
  };
  (globalThis as any).IDBKeyRange = { bound: () => null };
  return { almacen, open: () => peticion(() => base) };
}

const idbFalso = indexedDbDeMentira();
(globalThis as any).localStorage = localStorageDeMentira();
(globalThis as any).indexedDB = idbFalso;

const { db } = await import('../frontend/utils/db');
const { mergeDatabaseExports } = await import('../frontend/utils/cloudMerge');
const { claveTexto, faltaTexto, LIMITE_PORTADA } = await import('../frontend/utils/textosLibros');

/* ------------------------------------------------------------------ datos */

const PERFIL = 'profile-1';
const ESTANTERIA = `yoru_books_${PERFIL}`;

function libro(cambios: Record<string, any> = {}) {
  return {
    id: 'book-1',
    title: 'こころ',
    author: '夏目漱石',
    cover: 'data:image/png;base64,AAAA',
    chapters: [{ title: '上', content: '私はその人を常に先生と呼んでいた。' }],
    createdAt: '2026-11-01T00:00:00.000Z',
    lastRead: '2026-11-20T10:00:00.000Z',
    status: 'reading',
    progress: { currentChapter: 0, currentPage: 3, percent: 12, charactersRead: 900, secondsRead: 300 },
    ...cambios,
  };
}

function aparatoNuevo() {
  localStorage.clear();
  idbFalso.almacen.clear();
  db.saveProfiles([{ id: PERFIL, name: 'zams' } as any]);
  db.setActiveProfileId(PERFIL);
}

/* ----------------------------------------------------------------- pruebas */

console.log('la exportación lleva la ficha de los libros, no su texto');
{
  aparatoNuevo();
  await db.saveBooks([libro()] as any);
  const exportado = await db.exportFullDatabase();
  const libros = exportado.profileData[PERFIL].books;
  check(libros.length === 1 && libros[0].title === 'こころ', 'el libro de la estantería sale en la exportación');
  check(libros[0].chapters.length === 0, 'sale sin su texto, que va aparte');
  check(libros[0].textoAparte === true, 'pero dice que lo tiene');
  check(libros[0].status === 'reading', 'con su estado en el catálogo');
  check(libros[0].progress.percent === 12, 'y con por dónde va');
  check(!idbFalso.almacen.has(`books_list_${PERFIL}`), 'nadie escribe ya en la clave vieja');
}

console.log('la importación los deja donde la app los lee');
{
  aparatoNuevo();
  await db.saveBooks([libro()] as any);
  const delPc = await db.exportFullDatabase();

  // Un teléfono recién instalado recupera la copia de Drive.
  aparatoNuevo();
  check((await db.getBooks()).length === 0, 'el teléfono empieza sin libros');
  await db.importFullDatabase(delPc);
  const enTelefono = await db.getBooks();
  check(enTelefono.length === 1 && enTelefono[0].title === 'こころ', 'el libro aparece en la biblioteca del teléfono');
  check(enTelefono[0].chapters.length === 0 && faltaTexto(enTelefono[0]), 'sin texto todavía: se baja al abrirlo');
  check(enTelefono[0].progress.percent === 12, 'y por donde se dejó en el PC');
  check(idbFalso.almacen.has(ESTANTERIA) && !idbFalso.almacen.has(`books_list_${PERFIL}`), 'guardado en la estantería de la app');
}

console.log('dos aparatos con libros distintos acaban con los dos');
{
  aparatoNuevo();
  await db.saveBooks([libro()] as any);
  const delPc = await db.exportFullDatabase();

  aparatoNuevo();
  await db.saveBooks([libro({ id: 'book-2', title: '雪国', author: '川端康成', lastRead: '2026-11-21T08:00:00.000Z' })] as any);
  const delTelefono = await db.exportFullDatabase();
  const { merged, localChanged, cloudChanged } = mergeDatabaseExports(delTelefono, delPc, false);
  check(localChanged && cloudChanged, 'a cada lado le falta el libro del otro');
  await db.importFullDatabase(merged);
  const titulos = (await db.getBooks()).map((b: any) => b.title).sort();
  check(titulos.length === 2 && titulos.includes('こころ') && titulos.includes('雪国'), 'el teléfono tiene los dos libros');
}

console.log('lo leído mientras se sincronizaba no se pierde');
{
  aparatoNuevo();
  await db.saveBooks([libro()] as any);
  const exportado = await db.exportFullDatabase();
  // Entre exportar y escribir la combinación, el lector guarda una página más y se importa otro libro.
  await db.saveBooks([
    libro({ lastRead: '2026-11-22T23:00:00.000Z', progress: { currentChapter: 0, currentPage: 9, percent: 30, charactersRead: 2000, secondsRead: 700 } }),
    libro({ id: 'book-3', title: '坊っちゃん', lastRead: undefined }),
  ] as any);
  await db.importFullDatabase(exportado);
  const libros = await db.getBooks();
  check(libros.find((b: any) => b.id === 'book-1')?.progress.percent === 30, 'se queda la posición más reciente, no la exportada');
  check(libros.some((b: any) => b.id === 'book-3'), 'el libro importado entremedias sigue ahí');
}

console.log('una copia sin libros no vacía la biblioteca');
{
  aparatoNuevo();
  await db.saveBooks([libro()] as any);
  const exportado = await db.exportFullDatabase();
  exportado.profileData[PERFIL].books = [];
  await db.importFullDatabase(exportado);
  check((await db.getBooks()).length === 1, 'el libro de este aparato sigue en su sitio');
}

console.log('un libro borrado viaja sin su texto');
{
  const borrado = libro({ isDeleted: true, chapters: [], lastRead: '2026-11-22T10:00:00.000Z' });
  const lado = (libros: any[]) => ({ version: 2, activeProfileId: PERFIL, profiles: [{ id: PERFIL, name: 'zams' }], profileData: { [PERFIL]: { books: libros } } });
  const { merged } = mergeDatabaseExports(lado([libro()]) as any, lado([borrado]) as any, false);
  const [resultado] = merged.profileData[PERFIL].books as any[];
  check(resultado.isDeleted === true && resultado.chapters.length === 0, 'borrado en el otro aparato: aquí se queda borrado y sin texto');
  check(resultado.progress.charactersRead === 900, 'pero conserva lo leído, que cuenta en las estadísticas');
}

console.log('el texto de este aparato no se pierde al recibir la ficha de vuelta');
{
  aparatoNuevo();
  await db.saveBooks([libro()] as any);
  const exportado = await db.exportFullDatabase();
  // Otro aparato lo marca como terminado y la ficha vuelve, sin texto.
  exportado.profileData[PERFIL].books[0] = { ...exportado.profileData[PERFIL].books[0], status: 'completed', updatedAt: '2026-11-23T00:00:00.000Z' };
  await db.importFullDatabase(exportado);
  const [aqui] = await db.getBooks() as any[];
  check(aqui.status === 'completed', 'llega el estado nuevo');
  check(aqui.chapters.length === 1, 'y el texto de aquí sigue en su sitio');
}

console.log('la portada grande viaja pequeña y no pisa la original');
{
  aparatoNuevo();
  const grande = 'data:image/jpeg;base64,' + 'A'.repeat(LIMITE_PORTADA + 10);
  await db.saveBooks([libro({ cover: grande })] as any);
  const exportado = await db.exportFullDatabase();
  const ficha = exportado.profileData[PERFIL].books[0];
  check(ficha.portadaReducida === true && ficha.cover.length < LIMITE_PORTADA, 'en el bulto va la pequeña');
  ficha.updatedAt = '2026-11-23T00:00:00.000Z';
  await db.importFullDatabase(exportado);
  const [aqui] = await db.getBooks() as any[];
  check(aqui.cover === grande && !aqui.portadaReducida, 'aquí se queda la original');
}

console.log('el texto bajado se pone en su sitio sin tocar lo demás');
{
  aparatoNuevo();
  await db.saveBooks([libro()] as any);
  const delPc = await db.exportFullDatabase();
  aparatoNuevo();
  await db.importFullDatabase(delPc);
  const [sinTexto] = await db.getBooks() as any[];
  await db.ponerTextoDeLibro(sinTexto.id, libro().chapters, 'data:image/png;base64,BBBB');
  const [conTexto] = await db.getBooks() as any[];
  check(conTexto.chapters.length === 1 && !faltaTexto(conTexto), 'ya se puede abrir');
  check(conTexto.updatedAt === sinTexto.updatedAt, 'sin parecer un cambio del lector');
  check(conTexto.progress.percent === 12 && conTexto.status === 'reading', 'con su progreso y su estado');
}

console.log('importar aquí un libro que vino sin texto se lo da');
{
  aparatoNuevo();
  await db.saveBooks([libro()] as any);
  const delPc = await db.exportFullDatabase();
  aparatoNuevo();
  await db.importFullDatabase(delPc);
  await db.addBooks([{ title: 'こころ', author: '夏目漱石', chapters: libro().chapters }] as any);
  const libros = await db.getBooks() as any[];
  check(libros.length === 1 && libros[0].chapters.length === 1, 'el mismo libro, ahora con texto');
  check(libros[0].progress.percent === 12, 'y sin perder por dónde iba');
}

console.log('la clave del texto es la misma en todos los aparatos');
{
  check(claveTexto(libro()) === claveTexto(libro({ id: 'book-otro-aparato' })), 'no depende del id');
  check(claveTexto(libro()) === claveTexto(libro({ title: ' こころ ', author: '夏目漱石' })), 'ni de espacios sueltos');
  check(claveTexto(libro()) !== claveTexto(libro({ title: '坊っちゃん' })), 'y cambia con el libro');
  check(/^[a-f0-9]{16,64}$/.test(claveTexto(libro())), 'y la acepta el servidor');
}

if (failures > 0) {
  console.error(`\n${failures} comprobaciones fallaron`);
  process.exit(1);
}
console.log('\nTodo bien');
