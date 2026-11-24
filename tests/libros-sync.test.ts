// Los libros importados viajan con la sincronización: `db.exportFullDatabase` los lee de
// la estantería que usa la app y `db.importFullDatabase` los deja en esa misma estantería.
// Hasta el 22 nov 2026 los dos miraban `books_list_<perfil>`, donde la app no escribe.
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

console.log('la exportación lleva los libros importados');
{
  aparatoNuevo();
  await db.saveBooks([libro()] as any);
  const exportado = await db.exportFullDatabase();
  const libros = exportado.profileData[PERFIL].books;
  check(libros.length === 1 && libros[0].title === 'こころ', 'el libro de la estantería sale en la exportación');
  check(libros[0].chapters.length === 1 && libros[0].chapters[0].content.includes('先生'), 'sale con su texto');
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
  check(enTelefono[0].chapters.length === 1, 'con su texto, listo para abrir');
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

if (failures > 0) {
  console.error(`\n${failures} comprobaciones fallaron`);
  process.exit(1);
}
console.log('\nTodo bien');
