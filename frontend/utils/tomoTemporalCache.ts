/**
 * Los últimos tomos del servidor que se abrieron sin guardar, ya preparados.
 *
 * Abrir un tomo de Kavita es bajarlo entero y pasarlo por el importador: en el teléfono
 * son varios segundos, y hasta ahora se pagaban cada vez, también al volver al mismo
 * tomo cinco minutos después. Aquí se guarda el resultado del importador, de modo que
 * la segunda apertura sale del aparato y es inmediata.
 *
 * No es la biblioteca: el tomo sigue siendo temporal y no aparece en el Catálogo. Se
 * guardan solo unos pocos, los más recientes, para no ir llenando el almacenamiento con
 * cada tomo que alguien abrió una vez.
 *
 * Nada de esto puede estorbar: si el almacén falla, se baja el tomo como siempre.
 */

const PREFIJO = 'yoru_tomo_temporal_';
const INDICE = 'yoru_tomos_temporales';
/** Cuántos tomos se conservan. Una serie se lee de uno en uno; con tres sobra. */
const MAXIMO = 3;

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Misma base y mismo almacén que `db` y que las alineaciones.
    const peticion = indexedDB.open('YoruReaderStore', 1);
    peticion.onupgradeneeded = (e: any) => {
      const base = e.target.result;
      if (!base.objectStoreNames.contains('keyvalue')) base.createObjectStore('keyvalue');
    };
    peticion.onsuccess = (e: any) => resolve(e.target.result);
    peticion.onerror = (e: any) => reject(e.target.error);
  });
}

function recientes(): number[] {
  try {
    const lista = JSON.parse(localStorage.getItem(INDICE) || '[]');
    return Array.isArray(lista) ? lista.map(Number).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

/** El tomo ya preparado, o `null` si no está guardado. */
export async function leerTomoTemporal(volumeId: number): Promise<any | null> {
  try {
    const base = await abrir();
    return await new Promise((resolve) => {
      const p = base.transaction('keyvalue', 'readonly').objectStore('keyvalue').get(PREFIJO + volumeId);
      p.onsuccess = () => resolve(p.result || null);
      p.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Guarda el tomo preparado y suelta los más viejos. No lanza. */
export async function guardarTomoTemporal(volumeId: number, libro: any): Promise<void> {
  try {
    const orden = [volumeId, ...recientes().filter((id) => id !== volumeId)];
    const sobran = orden.slice(MAXIMO);
    const base = await abrir();
    await new Promise<void>((resolve, reject) => {
      const tx = base.transaction('keyvalue', 'readwrite');
      const almacen = tx.objectStore('keyvalue');
      almacen.put(libro, PREFIJO + volumeId);
      for (const id of sobran) almacen.delete(PREFIJO + id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    localStorage.setItem(INDICE, JSON.stringify(orden.slice(0, MAXIMO)));
  } catch (error) {
    console.warn('[yoru] no se pudo guardar el tomo temporal:', error instanceof Error ? error.message : String(error));
  }
}
