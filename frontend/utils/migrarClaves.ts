/*
  Cambio de nombre de las claves donde se guardan los datos (23 nov 2026).

  Hasta la 1.2.8.109 los perfiles, ajustes, estados de palabras y la estantería se
  guardaban bajo claves `migaku_reader_*`. Ahora son `yoru_*`. Este módulo mueve lo que
  haya con el nombre antiguo al nuevo, una sola vez, antes de que nadie lo lea:

  - localStorage: al importarse, de forma síncrona. `main.tsx` lo importa el primero.
  - IndexedDB (la estantería): `db.ts` llama a `migrarClavesIdb` al abrir la base, antes
    de entregarla, así que ninguna lectura ve la base a medio migrar.

  Nunca se pisa un valor que ya exista con el nombre nuevo; en ese caso el antiguo se
  deja donde está, por si acaso. Y nada se borra antes de que el valor esté a salvo.
*/

const PREFIJO_ANTIGUO = 'migaku_reader_';
const PREFIJO_NUEVO = 'yoru_';

export function nombreNuevo(clave: string): string | null {
  return clave.startsWith(PREFIJO_ANTIGUO) ? PREFIJO_NUEVO + clave.slice(PREFIJO_ANTIGUO.length) : null;
}

/** Mueve las claves antiguas de un almacén tipo localStorage. Devuelve cuántas movió. */
export function migrarClavesLocales(almacen: Storage): number {
  const antiguas: string[] = [];
  for (let i = 0; i < almacen.length; i++) {
    const clave = almacen.key(i);
    if (clave && nombreNuevo(clave)) antiguas.push(clave);
  }
  let movidas = 0;
  for (const antigua of antiguas) {
    const nueva = nombreNuevo(antigua)!;
    if (almacen.getItem(nueva) !== null) continue;
    const valor = almacen.getItem(antigua);
    if (valor === null) continue;
    // Primero se quita la antigua: con la estantería cerca del límite de 5 MB, tener las
    // dos a la vez podría no caber. Si la nueva no se puede escribir, se devuelve.
    almacen.removeItem(antigua);
    try {
      almacen.setItem(nueva, valor);
      movidas++;
    } catch (e) {
      try { almacen.setItem(antigua, valor); } catch { /* sin sitio ni para devolverla */ }
      console.error('[migrarClaves] No se pudo mover', antigua, e);
    }
  }
  return movidas;
}

/**
 * Mueve las claves antiguas de un almacén de IndexedDB, en una sola transacción: o se
 * mueve todo o no se toca nada. Nunca falla: si algo va mal, deja la base como estaba.
 */
export function migrarClavesIdb(base: IDBDatabase, almacen: string): Promise<void> {
  return new Promise((resolve) => {
    let tx: IDBTransaction;
    try {
      tx = base.transaction(almacen, 'readwrite');
    } catch (e) {
      console.error('[migrarClaves] IndexedDB', e);
      resolve();
      return;
    }
    const store = tx.objectStore(almacen);
    const peticion = store.openCursor(IDBKeyRange.bound(PREFIJO_ANTIGUO, PREFIJO_ANTIGUO + '￿'));
    peticion.onsuccess = () => {
      const cursor = peticion.result;
      if (!cursor) return;
      const antigua = String(cursor.key);
      const nueva = nombreNuevo(antigua);
      const valor = cursor.value;
      if (nueva) {
        const existe = store.getKey(nueva);
        existe.onsuccess = () => {
          if (existe.result !== undefined) return;
          store.put(valor, nueva);
          store.delete(antigua);
        };
      }
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      console.error('[migrarClaves] IndexedDB', tx.error);
      resolve();
    };
    tx.onabort = () => resolve();
  });
}

try {
  if (typeof localStorage !== 'undefined') {
    const movidas = migrarClavesLocales(localStorage);
    if (movidas > 0) console.log(`[migrarClaves] ${movidas} claves pasadas a ${PREFIJO_NUEVO}*`);
  }
} catch (e) {
  console.error('[migrarClaves]', e);
}

/*
  El modo de zonas de toque «20 % atrás, 80 % adelante» se guardaba como 'kindle'; ahora
  es 'asymmetric'. Se corrige el valor guardado para que el lector no tenga que conocer
  el nombre antiguo.
*/
try {
  if (typeof localStorage !== 'undefined' && localStorage.getItem('reader:tapZoneMode') === 'kindle') {
    localStorage.setItem('reader:tapZoneMode', 'asymmetric');
  }
} catch (e) {
  console.error('[migrarClaves]', e);
}
