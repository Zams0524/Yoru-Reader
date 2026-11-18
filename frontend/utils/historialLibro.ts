import type { DailyStatRecord } from './db';

/**
 * El historial de lectura de **un** libro: lo que llevas leído de él día a día, a qué
 * ritmo y cuánto te queda.
 *
 * Las estadísticas de Yoru ya se guardaban por libro y por día (`DailyStatRecord`
 * lleva el título y la fecha), pero solo se miraban en bloque, en la pantalla de
 * Estadísticas: la ficha de un libro enseñaba el total —caracteres y tiempo— y nada
 * más. Así no se ve lo único que de verdad quiere saber quien está a mitad de una
 * novela: si va a terminarla, y cuándo.
 *
 * Nada de esto pide un dato nuevo. El total de caracteres del libro, que no se guarda
 * en ninguna parte (lo calcula el lector al abrirlo), se despeja de lo que sí hay: si
 * has leído 42.000 caracteres y vas por el 30 %, el libro tiene unos 140.000. Es una
 * estimación y se dice que lo es; con el porcentaje muy bajo ni se intenta, porque
 * dividir por 0,4 % convierte un redondeo en un error de decenas de miles.
 */

export interface DiaLibro {
  /** YYYY-MM-DD en hora local, la misma clave que usa el parte diario. */
  key: string;
  /** Etiqueta corta para el eje: el día del mes. */
  label: string;
  seconds: number;
  chars: number;
  sessions: number;
}

export interface HistorialLibro {
  /** Los días de la ventana pedida, todos, también los vacíos, del más viejo al de hoy. */
  dias: DiaLibro[];
  /** Días en los que se leyó algo de este libro, en toda su historia. */
  diasLeidos: number;
  sesiones: number;
  segundos: number;
  caracteres: number;
  /** El último día con actividad, o null si no hay ninguno. */
  ultimaActividad: string | null;
  /** Caracteres por día activo. */
  mediaCaracteres: number;
  /** Segundos por día activo. */
  mediaSegundos: number;
  /** Caracteres por segundo medidos en este libro, o null si no da para medirlo. */
  ritmo: number | null;
  /** Caracteres que faltan, estimados desde el porcentaje. null si no se puede estimar. */
  restantes: number | null;
  /** Lo que queda, en segundos, al ritmo medido. */
  segundosRestantes: number | null;
  /** El día en que se acabaría manteniendo la media diaria, en clave YYYY-MM-DD. */
  fechaFin: string | null;
}

/** La clave del día de una fecha, en hora local, como la escribe el parte diario. */
export function claveDia(date: Date): string {
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  const dia = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mes}-${dia}`;
}

function sumar(record: DailyStatRecord): { seconds: number; chars: number; sessions: number } {
  return {
    // La escucha cuenta como tiempo del libro: es el mismo libro, con la voz puesta.
    seconds: (record.readingTime || 0) + (record.listeningTime || 0),
    chars: record.charactersRead || 0,
    sessions: record.sessionsCount || 0,
  };
}

/**
 * Reúne el historial de un libro a partir de todos los partes guardados.
 *
 * Los partes se emparejan **por título**, que es la única llave que guardan. Dos
 * libros con el mismo título compartirían historial; es un defecto del formato de los
 * partes, no de esta función, y arreglarlo pediría migrar las estadísticas de todo el
 * mundo a un identificador que no tienen.
 */
export function historialDeLibro(
  records: DailyStatRecord[],
  libro: { title: string; progress?: { percent?: number; charactersRead?: number; secondsRead?: number } },
  ventana = 30
): HistorialLibro {
  const propios = records.filter((record) => record.title === libro.title);

  const porDia = new Map<string, { seconds: number; chars: number; sessions: number }>();
  let segundos = 0;
  let caracteres = 0;
  let sesiones = 0;
  let diasLeidos = 0;
  let ultimaActividad: string | null = null;

  for (const record of propios) {
    const totales = sumar(record);
    if (totales.seconds <= 0 && totales.chars <= 0) continue;
    const previo = porDia.get(record.dateKey);
    if (previo) {
      previo.seconds += totales.seconds;
      previo.chars += totales.chars;
      previo.sessions += totales.sessions;
    } else {
      porDia.set(record.dateKey, { ...totales });
      diasLeidos += 1;
    }
    segundos += totales.seconds;
    caracteres += totales.chars;
    sesiones += totales.sessions;
    if (!ultimaActividad || record.dateKey > ultimaActividad) ultimaActividad = record.dateKey;
  }

  const dias: DiaLibro[] = [];
  const hoy = new Date();
  for (let atras = ventana - 1; atras >= 0; atras--) {
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - atras);
    const key = claveDia(fecha);
    const totales = porDia.get(key);
    dias.push({
      key,
      label: String(fecha.getDate()),
      seconds: totales?.seconds || 0,
      chars: totales?.chars || 0,
      sessions: totales?.sessions || 0,
    });
  }

  const mediaCaracteres = diasLeidos > 0 ? Math.round(caracteres / diasLeidos) : 0;
  const mediaSegundos = diasLeidos > 0 ? Math.round(segundos / diasLeidos) : 0;

  /*
    El ritmo sale del total del libro, no de la ventana de 30 días: es una velocidad de
    lectura, y cuantas más horas la sostengan, menos la mueve una tarde rara. Se mide
    con lo que hay en el propio libro y, si ahí no hay nada —partes de antes de que se
    contaran caracteres—, con la suma de los partes.
  */
  const leidos = libro.progress?.charactersRead || caracteres;
  const tiempo = libro.progress?.secondsRead || segundos;
  const ritmo = tiempo > 60 && leidos > 0 ? leidos / tiempo : null;

  const percent = libro.progress?.percent ?? 0;
  /*
    Con menos del 2 % leído el total estimado no vale: el porcentaje viene redondeado, y
    a esa altura un punto arriba o abajo dobla o parte por la mitad la cuenta. Antes que
    decir «te faltan 900.000 caracteres» se calla.
  */
  const total = percent >= 2 && leidos > 0 ? Math.round(leidos / (percent / 100)) : null;
  const restantes = total !== null ? Math.max(0, total - leidos) : null;
  const segundosRestantes = restantes !== null && ritmo ? Math.round(restantes / ritmo) : null;

  let fechaFin: string | null = null;
  if (restantes !== null && restantes > 0 && mediaCaracteres > 0) {
    const faltan = Math.ceil(restantes / mediaCaracteres);
    // Más de dos años por delante es un «nunca» disfrazado de fecha: mejor no decirlo.
    if (faltan <= 730) {
      const fin = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + faltan);
      fechaFin = claveDia(fin);
    }
  }

  return {
    dias,
    diasLeidos,
    sesiones,
    segundos,
    caracteres,
    ultimaActividad,
    mediaCaracteres,
    mediaSegundos,
    ritmo,
    restantes,
    segundosRestantes,
    fechaFin,
  };
}
