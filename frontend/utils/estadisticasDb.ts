/**
 * Dónde se guardan los partes de lectura: el almacén `statistic` de la base `books`
 * de IndexedDB (un libro, un día).
 *
 * Esto vivía en `db.ts` y abría la base pidiendo siempre la versión 4. Con eso bastaba
 * una secuencia corriente para dejar las estadísticas vacías para siempre:
 *
 *  1. Se abre Estadísticas antes de haber leído nada. La lectura abría la versión 4
 *     sin crear el almacén: la base quedaba en la 4, vacía.
 *  2. Se lee. Al guardar, el almacén no está, y se subía la base a la versión 5 para
 *     crearlo. Como ninguna conexión se cerraba, esa subida se quedaba esperando.
 *  3. Con la base ya en la 5, pedir la 4 es un error: no se guardaba ni se leía nada
 *     más, y sin avisar.
 *
 * Ahora no se pide ninguna versión: se abre la que haya, y solo se sube si falta el
 * almacén. Cada conexión se cierra al terminar, para no estorbar a la siguiente.
 * Vale para las bases que ya quedaron en la 5 (o más): se abren tal cual.
 *
 * Sin React ni el resto de `db.ts`, para poder probarlo en un navegador.
 */

import { aportesDe, combinarParte, conTotales, sumarAporte, type Aporte } from './estadisticasSync';

/** Un parte de lectura: un libro, un dia. `listeningTime` puede faltar en los viejos. */
export interface DailyStatRecord {
  title: string;
  /** YYYY-MM-DD en hora local. */
  dateKey: string;
  charactersRead?: number;
  readingTime?: number;
  listeningTime?: number;
  sessionsCount?: number;
  lastStatisticModified?: number;
  /** Lo de cada aparato (estadisticasSync.ts). Falta en los partes de antes del 27 nov 2026. */
  aparatos?: Record<string, Aporte>;
}

const CLAVE_APARATO = 'yoru_aparato_id';

/**
 * Un nombre fijo para este aparato (esta instalación), con el que se apunta lo que se lee
 * y se repasa aquí. No sale de la cuenta ni dice nada del aparato: es un número al azar.
 */
export function idDeEsteAparato(): string {
  try {
    let id = localStorage.getItem(CLAVE_APARATO);
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(CLAVE_APARATO, id);
    }
    return id;
  } catch {
    return 'local';
  }
}

const BASE = 'books';
const ALMACEN = 'statistic';
/** Si otra conexión no se aparta, no se espera para siempre. */
const ESPERA_MAX_MS = 4000;
const INTENTOS = 2;

function crearAlmacen(base: IDBDatabase): void {
  if (base.objectStoreNames.contains(ALMACEN)) return;
  const almacen = base.createObjectStore(ALMACEN, { keyPath: ['title', 'dateKey'] });
  almacen.createIndex('dateKey', 'dateKey');
  almacen.createIndex('completedBook', ['completedBook', 'title']);
}

/** Abre la base; sin `version`, la que haya. `null` si no se pudo. */
function abrir(version?: number): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let resuelto = false;
    const acabar = (base: IDBDatabase | null) => {
      clearTimeout(plazo);
      if (resuelto) {
        // Llegó tarde: nadie la va a usar, así que no se deja abierta.
        base?.close();
        return;
      }
      resuelto = true;
      resolve(base);
    };
    /*
      El plazo corre desde el principio y no solo al avisar `blocked`: una apertura
      que llega detrás de una subida parada tampoco avanza, y a esa no la avisa nadie.
    */
    const plazo = setTimeout(() => acabar(null), ESPERA_MAX_MS);
    let peticion: IDBOpenDBRequest;
    try {
      peticion = version === undefined ? indexedDB.open(BASE) : indexedDB.open(BASE, version);
    } catch {
      acabar(null);
      return;
    }
    // Base nueva o subida de versión: en los dos casos el almacén tiene que quedar hecho.
    peticion.onupgradeneeded = () => crearAlmacen(peticion.result);
    peticion.onsuccess = () => {
      const base = peticion.result;
      // Si otra pestaña o una versión nueva de la app necesita subir la base, se le deja.
      base.onversionchange = () => base.close();
      acabar(base);
    };
    peticion.onerror = (evento) => {
      evento.preventDefault();
      acabar(null);
    };
  });
}

/**
 * La base con el almacén de partes. Con `crear`, lo crea si falta (subiendo una
 * versión); sin él devuelve `null` cuando no hay nada guardado todavía.
 */
async function abrirPartes(crear: boolean): Promise<IDBDatabase | null> {
  for (let intento = 0; intento < INTENTOS; intento += 1) {
    const base = await abrir();
    if (!base) return null;
    if (base.objectStoreNames.contains(ALMACEN)) return base;
    const version = base.version;
    base.close();
    if (!crear) return null;
    const subida = await abrir(version + 1);
    if (subida?.objectStoreNames.contains(ALMACEN)) return subida;
    // Otro guardado se adelantó con la subida, o no se pudo: se mira otra vez.
    subida?.close();
  }
  return null;
}

/** Todos los partes diarios guardados. */
export async function leerPartes(): Promise<DailyStatRecord[]> {
  const base = await abrirPartes(false);
  if (!base) return [];
  return new Promise((resolve) => {
    let partes: DailyStatRecord[] = [];
    const acabar = () => {
      base.close();
      resolve(partes);
    };
    try {
      const tx = base.transaction(ALMACEN, 'readonly');
      const consulta = tx.objectStore(ALMACEN).getAll();
      consulta.onsuccess = () => { partes = (consulta.result || []) as DailyStatRecord[]; };
      tx.oncomplete = acabar;
      tx.onerror = acabar;
      tx.onabort = acabar;
    } catch {
      acabar();
    }
  });
}

/**
 * Suma al parte de hoy de un libro. Lo escuchado va a su campo, `listeningTime`, y
 * nunca se mezcla con `readingTime`: si se sumaran, ya no se podría saber cuánto se
 * leyó de verdad. Devuelve si quedó guardado.
 */
export async function sumarAlParte(
  title: string,
  caracteres: number,
  segundos: number,
  sesiones = 0,
  escuchado = 0,
): Promise<boolean> {
  const base = await abrirPartes(true);
  if (!base) {
    console.error('Estadísticas: no se pudo abrir la base para guardar lo leído.');
    return false;
  }
  return new Promise((resolve) => {
    const acabar = (guardado: boolean) => {
      base.close();
      if (!guardado) console.error('Estadísticas: no se pudo guardar lo leído.');
      resolve(guardado);
    };
    try {
      const tx = base.transaction(ALMACEN, 'readwrite');
      const almacen = tx.objectStore(ALMACEN);
      const hoy = new Date().toLocaleDateString('sv').slice(0, 10);
      const consulta = almacen.get([title, hoy]);
      consulta.onsuccess = () => {
        // Lo de este aparato va en su casilla (`aparatos`), para que al combinarlo con lo
        // de otro aparato no se cuente dos veces ni se pierda (estadisticasSync.ts).
        almacen.put(sumarAporte(
          consulta.result,
          { title, dateKey: hoy },
          idDeEsteAparato(),
          { c: caracteres, r: segundos, l: escuchado, s: sesiones },
          Date.now(),
        ));
      };
      tx.oncomplete = () => acabar(true);
      tx.onerror = () => acabar(false);
      tx.onabort = () => acabar(false);
    } catch {
      acabar(false);
    }
  });
}

/**
 * Guarda los partes que llegan de la sincronización, ya combinados: cada uno se vuelve a
 * combinar con el que hay ahora (lo leído mientras iba y venía la red no se pierde), y lo
 * de cada libro borrado en otro aparato (`quitados`, título → fecha) se quita también aquí.
 */
export async function guardarPartesCombinados(
  llegados: DailyStatRecord[],
  quitados: Record<string, string> | null | undefined,
): Promise<boolean> {
  const marcas = Object.entries(quitados || {}).map(([titulo, cuando]) => [titulo, Date.parse(cuando) || 0] as const).filter(([, t]) => t);
  if (!llegados.length && !marcas.length) return true;
  const base = await abrirPartes(true);
  if (!base) return false;
  const aparato = idDeEsteAparato();
  const limiteDe = new Map(marcas);
  /** El parte sin lo de antes de que se borraran las estadísticas de su libro; `null` si no queda nada. */
  const sinQuitado = (parte: DailyStatRecord): DailyStatRecord | null => {
    const limite = limiteDe.get(parte.title);
    if (!limite) return parte;
    const todos = aportesDe(parte, aparato);
    const quedan = Object.fromEntries(Object.entries(todos).filter(([, a]) => (Number(a.t) || 0) > limite));
    if (!Object.keys(quedan).length) return null;
    return Object.keys(quedan).length === Object.keys(todos).length ? parte : conTotales(parte, quedan);
  };
  return new Promise((resolve) => {
    const acabar = (ok: boolean) => {
      base.close();
      resolve(ok);
    };
    try {
      const tx = base.transaction(ALMACEN, 'readwrite');
      const almacen = tx.objectStore(ALMACEN);
      for (const parte of llegados) {
        if (!parte?.title || !parte?.dateKey) continue;
        const consulta = almacen.get([parte.title, parte.dateKey]);
        consulta.onsuccess = () => {
          const actual = consulta.result as DailyStatRecord | undefined;
          const junto = sinQuitado(actual ? combinarParte(actual, parte, aparato) : conTotales(parte, aportesDe(parte, aparato)));
          if (junto) almacen.put(junto);
          else if (actual) almacen.delete([parte.title, parte.dateKey]);
        };
      }
      // Lo de los libros cuyas estadísticas se borraron en otro aparato, también aquí.
      if (limiteDe.size) {
        const cursor = almacen.openCursor();
        cursor.onsuccess = () => {
          const actual = cursor.result;
          if (!actual) return;
          const parte = actual.value as DailyStatRecord;
          const queda = sinQuitado(parte);
          if (!queda) actual.delete();
          else if (queda !== parte) actual.update(queda);
          actual.continue();
        };
      }
      tx.oncomplete = () => acabar(true);
      tx.onerror = () => acabar(false);
      tx.onabort = () => acabar(false);
    } catch {
      acabar(false);
    }
  });
}

/**
 * Borra los partes apuntados hasta `limiteMs` (al borrar el progreso de lectura). Los de
 * después se quedan: son lo que se leyó ya con el progreso borrado. Un parte viejo sin
 * fecha de cambio cuenta por su día.
 */
export async function borrarPartesHasta(limiteMs: number): Promise<void> {
  const base = await abrirPartes(false);
  if (!base) return;
  return new Promise((resolve) => {
    const acabar = () => {
      base.close();
      resolve();
    };
    try {
      const tx = base.transaction(ALMACEN, 'readwrite');
      const cursor = tx.objectStore(ALMACEN).openCursor();
      cursor.onsuccess = () => {
        const actual = cursor.result;
        if (!actual) return;
        const parte = actual.value as DailyStatRecord;
        const cuando = Number(parte.lastStatisticModified) || Date.parse(`${parte.dateKey}T00:00:00`) || 0;
        if (cuando <= limiteMs) actual.delete();
        actual.continue();
      };
      tx.oncomplete = acabar;
      tx.onerror = acabar;
      tx.onabort = acabar;
    } catch {
      acabar();
    }
  });
}

/** Borra todos los partes de un libro (al quitar sus estadísticas). */
export async function borrarPartesDe(title: string): Promise<void> {
  const base = await abrirPartes(false);
  if (!base) return;
  return new Promise((resolve) => {
    const acabar = () => {
      base.close();
      resolve();
    };
    try {
      const tx = base.transaction(ALMACEN, 'readwrite');
      tx.objectStore(ALMACEN).delete(IDBKeyRange.bound([title, ''], [title, '￿']));
      tx.oncomplete = acabar;
      tx.onerror = acabar;
      tx.onabort = acabar;
    } catch {
      acabar();
    }
  });
}
