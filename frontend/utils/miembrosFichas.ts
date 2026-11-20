/**
 * Juntar las dos mitades de un miembro: la de Discord y la de Yoru.
 *
 * La lista de Miembros sale del widget público de Discord, que dice quién está
 * conectado pero no qué lee. Lo que lee lo sabe el servidor de sincronización de
 * Yoru, que a su vez no sabe quién está conectado. Aquí se casan, y se decide cómo
 * contar lo que el otro está haciendo.
 *
 * Todo son funciones puras, sin red ni pantalla, para poder probarlas solas.
 */

import { claveNombre } from './miembrosVivos';
import type { AudiolibroMiembro, FichaMiembro, LibroMiembro } from './yoruSyncService';

/**
 * La ficha de Yoru de alguien de la lista de Discord, o `null` si no ha sincronizado.
 *
 * Se casa por nombre porque el widget **no da el id de Discord** (el suyo es un número
 * de orden). El servidor guarda los dos nombres de cada cuenta, el que se ve y el de
 * usuario, y vale cualquiera. Si dos cuentas se llamaran igual gana la que subió
 * progreso más tarde, que es como viene ordenada la lista.
 */
export function fichaPara(nombreWidget: string, fichas: FichaMiembro[]): FichaMiembro | null {
  const clave = claveNombre(nombreWidget);
  if (!clave) return null;
  for (const ficha of fichas) {
    const nombres = [ficha.nombre, ...(ficha.alias || [])];
    if (nombres.some((nombre) => claveNombre(nombre) === clave)) return ficha;
  }
  return null;
}

/** «hace 5 min», «hace 3 h», «ayer», «hace 4 días». Sin fecha, cadena vacía. */
export function haceCuanto(momento: number, ahora: number, es: boolean): string {
  if (!momento) return '';
  const minutos = Math.max(0, Math.round((ahora - momento) / 60_000));
  if (minutos < 1) return es ? 'hace un momento' : 'just now';
  if (minutos < 60) return es ? `hace ${minutos} min` : `${minutos} min ago`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return es ? `hace ${horas} h` : `${horas} h ago`;
  const dias = Math.round(horas / 24);
  if (dias === 1) return es ? 'ayer' : 'yesterday';
  if (dias < 30) return es ? `hace ${dias} días` : `${dias} days ago`;
  const meses = Math.round(dias / 30);
  if (meses < 12) return es ? `hace ${meses} ${meses === 1 ? 'mes' : 'meses'}` : `${meses} mo ago`;
  const anios = Math.round(dias / 365);
  return es ? `hace ${anios} ${anios === 1 ? 'año' : 'años'}` : `${anios} y ago`;
}

/** Algo que el miembro lee o escucha, listo para pintarse en la tarjeta. */
export interface ActividadMiembro {
  tipo: 'leyendo' | 'escuchando';
  /** Si lo está haciendo ahora mismo, según el servidor. */
  ahora: boolean;
  titulo: string;
  /** El capítulo o el autor, lo que haya. */
  detalle: string;
  porcentaje: number;
  cuando: number;
  libro?: LibroMiembro;
  audio?: AudiolibroMiembro;
}

/**
 * Lo último que leyó y lo último que escuchó, lo más reciente primero.
 *
 * Solo una de las dos puede ir marcada como «ahora», que es la que dice el servidor:
 * nadie lee y escucha a la vez, y dos «ahora» en la misma tarjeta no se los cree nadie.
 */
export function actividades(ficha: FichaMiembro | null | undefined): ActividadMiembro[] {
  if (!ficha || !ficha.comparte) return [];
  const salida: ActividadMiembro[] = [];
  if (ficha.leyendo) {
    salida.push({
      tipo: 'leyendo',
      ahora: ficha.ahora === 'leyendo',
      titulo: ficha.leyendo.titulo,
      detalle: ficha.leyendo.capitulo || ficha.leyendo.autor || '',
      porcentaje: ficha.leyendo.porcentaje,
      cuando: ficha.leyendo.ultimaLectura,
      libro: ficha.leyendo,
    });
  }
  if (ficha.escuchando) {
    salida.push({
      tipo: 'escuchando',
      ahora: ficha.ahora === 'escuchando',
      titulo: ficha.escuchando.titulo,
      detalle: ficha.escuchando.autor || '',
      porcentaje: ficha.escuchando.porcentaje,
      cuando: ficha.escuchando.ultimaEscucha,
      audio: ficha.escuchando,
    });
  }
  return salida.sort((a, b) => Number(b.ahora) - Number(a.ahora) || b.cuando - a.cuando);
}

/** El rótulo de una actividad: «Leyendo ahora», o «Leyó hace 3 h». */
export function rotuloActividad(actividad: ActividadMiembro, ahora: number, es: boolean): string {
  if (actividad.ahora) {
    if (actividad.tipo === 'leyendo') return es ? 'Leyendo ahora' : 'Reading now';
    return es ? 'Escuchando ahora' : 'Listening now';
  }
  const hace = haceCuanto(actividad.cuando, ahora, es);
  if (actividad.tipo === 'leyendo') return es ? `Leyó ${hace}`.trim() : `Read ${hace}`.trim();
  return es ? `Escuchó ${hace}`.trim() : `Listened ${hace}`.trim();
}

/**
 * La línea de debajo del nombre en la lista: solo cuando está en ello ahora mismo.
 * Lo que leyó ayer no es noticia para la lista de conectados; eso se ve al abrir su
 * tarjeta.
 */
export function lineaAhora(ficha: FichaMiembro | null | undefined, es: boolean): string {
  const actual = actividades(ficha).find((actividad) => actividad.ahora);
  if (!actual) return '';
  const verbo = actual.tipo === 'leyendo' ? (es ? 'Leyendo' : 'Reading') : (es ? 'Escuchando' : 'Listening to');
  return actual.titulo ? `${verbo} · ${actual.titulo}` : verbo;
}
