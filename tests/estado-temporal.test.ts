// Posición y marcadores de los libros que se leen del servidor sin descargar
// (frontend/utils/estadoTemporal.ts).
import assert from 'node:assert/strict';

const almacen = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (almacen.has(k) ? almacen.get(k)! : null),
  setItem: (k: string, v: string) => { almacen.set(k, String(v)); },
  removeItem: (k: string) => { almacen.delete(k); },
};

const {
  esIdTemporal, guardarMarcadoresTemporales, guardarPosicionTemporal, guardarSubrayadosTemporales,
  leerEstadoTemporal, olvidarEstadoTemporal, retomarAqui,
} = await import('../frontend/utils/estadoTemporal');

let ok = 0;
function prueba(nombre: string, fn: () => void) {
  fn();
  ok++;
  console.log(`ok ${nombre}`);
}

const ID = 'tmp:kavita:42';

prueba('solo los ids temporales', () => {
  assert.equal(esIdTemporal(ID), true);
  assert.equal(esIdTemporal('book-1'), false);
  guardarPosicionTemporal('p1', 'book-1', { currentChapter: 1, currentPage: 2, percent: 3 });
  assert.equal(leerEstadoTemporal('p1', 'book-1'), null);
});

prueba('la posición exacta se guarda y se lee', () => {
  guardarPosicionTemporal('p1', ID, { currentChapter: 7, currentPage: 312, percent: 41 });
  const estado = leerEstadoTemporal('p1', ID)!;
  assert.equal(estado.progress!.currentChapter, 7);
  assert.equal(estado.progress!.currentPage, 312);
  assert.equal(estado.progress!.percent, 41);
});

prueba('marcadores y subrayados se guardan sin pisar la posición', () => {
  guardarMarcadoresTemporales('p1', ID, [{ paragraphId: 312, content: 'あ', page: true }]);
  guardarSubrayadosTemporales('p1', ID, [{ id: 'h1', paragraphId: 300 }]);
  const estado = leerEstadoTemporal('p1', ID)!;
  assert.equal(estado.bookmarks!.length, 1);
  assert.equal(estado.bookmarks![0].paragraphId, 312);
  assert.equal(estado.highlights!.length, 1);
  assert.equal(estado.progress!.currentPage, 312);
});

prueba('cada perfil lo suyo', () => {
  assert.equal(leerEstadoTemporal('p2', ID), null);
});

prueba('olvidar al guardarlo en la biblioteca', () => {
  olvidarEstadoTemporal('p1', ID);
  assert.equal(leerEstadoTemporal('p1', ID), null);
});

prueba('se retoma en el aparato salvo que el servidor vaya por delante', () => {
  const local = { currentChapter: 7, currentPage: 312, percent: 41, at: '' };
  assert.equal(retomarAqui(local, 0), true); // servidor sin nada
  assert.equal(retomarAqui(local, 41), true);
  // Redondeo de Kavita: 41 % de 20 páginas sube como la página 8 (40 %) o la 9 (45 %).
  assert.equal(retomarAqui(local, 45, 20), true);
  // Se leyó más en otro aparato.
  assert.equal(retomarAqui(local, 60, 20), false);
  assert.equal(retomarAqui(null, 10), false);
});

console.log(`${ok} pruebas bien`);
