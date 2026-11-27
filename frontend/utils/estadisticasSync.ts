/**
 * Las estadísticas de lectura y de Yoru SRS entre aparatos: cómo se combinan dos copias.
 *
 * Hasta el 27 nov 2026 nada de esto viajaba. Las tarjetas sí (`srsData`), pero los partes
 * diarios de lectura, el historial de repasos, los contadores de cada día y el tiempo de
 * estudio se quedaban en el aparato donde se hicieron: lo leído en el PC no salía en las
 * estadísticas del teléfono, la racha de cada aparato era distinta y, lo peor, el límite
 * de tarjetas nuevas del día se contaba por separado, así que con 20 nuevas hechas en el
 * PC el teléfono ofrecía otras 20.
 *
 * El problema de fondo es que son **sumas**. Si el PC lee 1000 caracteres de un libro y
 * el teléfono 500 el mismo día, el día tiene 1500; quedarse con el mayor pierde 500, y
 * sumar las dos copias cuenta dos veces lo que ya se había combinado antes. Por eso cada
 * cifra va **por aparato**: cada uno solo hace crecer la suya, y combinar es quedarse con
 * la mayor de cada aparato; el total es la suma de todos.
 *
 * El historial de repasos es una lista de sucesos con fecha: se combina juntando las dos
 * y quitando repetidos.
 *
 * Funciones puras, sin almacenamiento, para que las use el combinador y se puedan probar.
 */

/** Lo que un aparato aportó a un parte (un libro, un día). `t`: cuándo lo tocó por última vez (ms). */
export interface Aporte {
  /** Caracteres leídos. */
  c: number;
  /** Segundos leyendo. */
  r: number;
  /** Segundos escuchando. */
  l: number;
  /** Sesiones. */
  s: number;
  t: number;
}

/** Un parte diario de lectura como se guarda y como viaja. Los totales son la suma de `aparatos`. */
export interface ParteDiario {
  title: string;
  dateKey: string;
  charactersRead?: number;
  readingTime?: number;
  listeningTime?: number;
  sessionsCount?: number;
  lastStatisticModified?: number;
  /** Lo de cada aparato. Falta en los partes de antes de esto: entonces todo es de este aparato. */
  aparatos?: Record<string, Aporte>;
  [clave: string]: any;
}

/** Un día de Yoru SRS en un aparato. */
export interface DiaSrs {
  /** Tarjetas respondidas (lo que pinta el mapa de calor). */
  n: number;
  /** De ellas, repasos (para el límite de repasos del día). */
  r: number;
  /** Palabras que se estudiaron por primera vez (para el límite de nuevas del día). */
  w: string[];
  /** Segundos de estudio. */
  s: number;
}

/** Los días de Yoru SRS por aparato: aparato → AAAA-MM-DD → día. */
export type DiasSrsPorAparato = Record<string, Record<string, DiaSrs>>;

function ms(valor: unknown): number {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  const t = typeof valor === 'string' ? Date.parse(valor) : 0;
  return Number.isNaN(t) ? 0 : t;
}

function num(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* ------------------------------------------------------------------ partes de lectura */

/** Lo de cada aparato de un parte. Un parte viejo, sin `aparatos`, es todo de `aparatoLocal`. */
export function aportesDe(parte: ParteDiario, aparatoLocal: string): Record<string, Aporte> {
  if (parte.aparatos && typeof parte.aparatos === 'object' && Object.keys(parte.aparatos).length) return parte.aparatos;
  return {
    [aparatoLocal]: {
      c: num(parte.charactersRead),
      r: num(parte.readingTime),
      l: num(parte.listeningTime),
      s: num(parte.sessionsCount),
      t: num(parte.lastStatisticModified) || ms(`${parte.dateKey}T00:00:00`),
    },
  };
}

/** El parte con sus totales recalculados a partir de lo de cada aparato. */
export function conTotales(parte: ParteDiario, aparatos: Record<string, Aporte>): ParteDiario {
  let c = 0, r = 0, l = 0, s = 0, t = 0;
  for (const a of Object.values(aparatos)) {
    c += num(a.c); r += num(a.r); l += num(a.l); s += num(a.s); t = Math.max(t, num(a.t));
  }
  return {
    ...parte,
    charactersRead: c,
    readingTime: r,
    listeningTime: l,
    sessionsCount: s,
    lastStatisticModified: t || parte.lastStatisticModified,
    aparatos,
  };
}

/**
 * Suma lo de este aparato a un parte (o crea el parte). Es lo que hace `sumarAlParte`
 * al guardar lo leído; aquí para poder probarlo.
 */
export function sumarAporte(
  parte: ParteDiario | null | undefined,
  base: { title: string; dateKey: string },
  aparato: string,
  suma: { c: number; r: number; l: number; s: number },
  ahora: number,
): ParteDiario {
  const aparatos = { ...(parte ? aportesDe(parte, aparato) : {}) };
  const previo = aparatos[aparato] || { c: 0, r: 0, l: 0, s: 0, t: 0 };
  aparatos[aparato] = {
    c: num(previo.c) + num(suma.c),
    r: num(previo.r) + num(suma.r),
    l: num(previo.l) + num(suma.l),
    s: num(previo.s) + num(suma.s),
    t: ahora,
  };
  return conTotales(parte ? { ...parte } : { title: base.title, dateKey: base.dateKey }, aparatos);
}

const clavePartes = (p: { title: string; dateKey: string }) => `${p.title}\u0000${p.dateKey}`;

function combinarAportes(a: Aporte | undefined, b: Aporte | undefined): Aporte {
  if (!a) return { ...b! };
  if (!b) return { ...a };
  // Lo de un aparato solo crece: la copia mayor ya lleva todo lo de la menor.
  return {
    c: Math.max(num(a.c), num(b.c)),
    r: Math.max(num(a.r), num(b.r)),
    l: Math.max(num(a.l), num(b.l)),
    s: Math.max(num(a.s), num(b.s)),
    t: Math.max(num(a.t), num(b.t)),
  };
}

/** Dos partes del mismo libro y día. */
export function combinarParte(a: ParteDiario, b: ParteDiario, aparatoLocal: string): ParteDiario {
  const pa = aportesDe(a, aparatoLocal);
  const pb = aportesDe(b, aparatoLocal);
  const aparatos: Record<string, Aporte> = {};
  for (const id of [...new Set([...Object.keys(pa), ...Object.keys(pb)])].sort()) aparatos[id] = combinarAportes(pa[id], pb[id]);
  return conTotales({ ...b, ...a }, aparatos);
}

/** En el mismo orden siempre, para que dos copias iguales se vean iguales. */
function ordenar(partes: ParteDiario[]): ParteDiario[] {
  const clave = (p: ParteDiario) => `${p.dateKey}\u0000${p.title}`;
  return partes.sort((x, y) => (clave(x) < clave(y) ? -1 : clave(x) > clave(y) ? 1 : 0));
}

/**
 * Los partes como viajan: cada uno con lo de cada aparato (los viejos, a nombre de
 * `aparatoLocal`) y en orden.
 */
export function partesParaSincronizar(partes: ParteDiario[] | null | undefined, aparatoLocal: string): ParteDiario[] {
  return ordenar((partes || []).filter((p) => p && p.title && p.dateKey).map((p) => conTotales(p, aportesDe(p, aparatoLocal))));
}

/** Dos listas de partes, parte a parte y aparato a aparato. */
export function combinarPartes(
  a: ParteDiario[] | null | undefined,
  b: ParteDiario[] | null | undefined,
  aparatoLocal = 'local',
): ParteDiario[] {
  const resultado = new Map<string, ParteDiario>();
  for (const lista of [a || [], b || []]) {
    for (const parte of lista) {
      if (!parte?.title || !parte?.dateKey) continue;
      const clave = clavePartes(parte);
      const previo = resultado.get(clave);
      resultado.set(clave, previo ? combinarParte(previo, parte, aparatoLocal) : conTotales(parte, aportesDe(parte, aparatoLocal)));
    }
  }
  return ordenar([...resultado.values()]);
}

/**
 * Quita de los partes lo que se tocó hasta `limiteMs` en cada aparato; un parte sin nada
 * se va. `deTitulo` limita a un libro (al borrar sus estadísticas).
 */
export function partesSinLoAnteriorA(
  partes: ParteDiario[],
  limiteMs: number,
  aparatoLocal: string,
  deTitulo?: string,
): ParteDiario[] {
  if (!limiteMs) return partes;
  const salida: ParteDiario[] = [];
  for (const parte of partes) {
    if (deTitulo !== undefined && parte.title !== deTitulo) {
      salida.push(parte);
      continue;
    }
    const quedan = Object.fromEntries(Object.entries(aportesDe(parte, aparatoLocal)).filter(([, a]) => num(a.t) > limiteMs));
    if (Object.keys(quedan).length) salida.push(conTotales(parte, quedan));
  }
  return salida;
}

/** Las marcas de «borrar las estadísticas de este libro» de los dos lados: la más reciente de cada libro. */
export function combinarQuitados(
  a?: Record<string, string> | null,
  b?: Record<string, string> | null,
): Record<string, string> {
  const salida: Record<string, string> = { ...(b || {}) };
  for (const [titulo, cuando] of Object.entries(a || {})) {
    if (ms(cuando) > ms(salida[titulo])) salida[titulo] = cuando;
  }
  return Object.fromEntries(Object.keys(salida).sort().map((titulo) => [titulo, salida[titulo]]));
}

/** Los partes con las marcas de borrado de cada libro aplicadas. */
export function partesSinQuitados(
  partes: ParteDiario[],
  quitados: Record<string, string> | null | undefined,
  aparatoLocal: string,
): ParteDiario[] {
  let salida = partes;
  for (const [titulo, cuando] of Object.entries(quitados || {})) {
    salida = partesSinLoAnteriorA(salida, ms(cuando), aparatoLocal, titulo);
  }
  return salida;
}

/* ------------------------------------------------------------------ Yoru SRS */

/** Un día de Yoru SRS con lo que haya, limpio. */
export function diaSrs(valor: any): DiaSrs {
  return {
    n: num(valor?.n),
    r: num(valor?.r),
    w: Array.isArray(valor?.w) ? [...new Set<string>(valor.w.map(String))].sort() : [],
    s: num(valor?.s),
  };
}

/** Dos copias del mismo día de un aparato: lo de un aparato solo crece. */
function combinarDia(a: any, b: any): DiaSrs {
  const x = diaSrs(a);
  const y = diaSrs(b);
  return { n: Math.max(x.n, y.n), r: Math.max(x.r, y.r), w: [...new Set([...x.w, ...y.w])].sort(), s: Math.max(x.s, y.s) };
}

/** Los días de Yoru SRS de dos copias, aparato a aparato y día a día. */
export function combinarDiasSrs(a?: DiasSrsPorAparato | null, b?: DiasSrsPorAparato | null): DiasSrsPorAparato {
  const salida: DiasSrsPorAparato = {};
  for (const fuente of [a || {}, b || {}]) {
    for (const [aparato, dias] of Object.entries(fuente)) {
      if (!dias || typeof dias !== 'object') continue;
      const destino = salida[aparato] || (salida[aparato] = {});
      for (const [dia, valor] of Object.entries(dias)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) continue;
        destino[dia] = combinarDia(destino[dia], valor);
      }
    }
  }
  // En orden, para que dos copias iguales se vean iguales.
  return Object.fromEntries(Object.keys(salida).sort().map((aparato) => [
    aparato,
    Object.fromEntries(Object.keys(salida[aparato]).sort().map((dia) => [dia, salida[aparato][dia]])),
  ]));
}

/** Los días de Yoru SRS sin los que van hasta `diaLimite` (AAAA-MM-DD) incluido. */
export function diasSrsDespuesDe(dias: DiasSrsPorAparato | null | undefined, diaLimite: string): DiasSrsPorAparato {
  const salida: DiasSrsPorAparato = {};
  for (const [aparato, porDia] of Object.entries(dias || {})) {
    const quedan = Object.fromEntries(Object.entries(porDia || {}).filter(([dia]) => dia > diaLimite));
    if (Object.keys(quedan).length) salida[aparato] = quedan;
  }
  return salida;
}

/** Cuántos repasos del historial se guardan, como `db.addSrsHistory`. */
export const MAX_HISTORIAL_SRS = 500;

const claveRepaso = (entrada: any) => `${entrada?.timestamp || ''}\u0000${entrada?.word || ''}`;

/**
 * Dos historiales de repasos: todos los repasos de los dos, sin repetir, del más nuevo al
 * más viejo, y solo los últimos `MAX_HISTORIAL_SRS`.
 */
export function combinarHistorialSrs(a?: any[] | null, b?: any[] | null): any[] {
  const vistos = new Map<string, any>();
  for (const entrada of [...(a || []), ...(b || [])]) {
    if (!entrada || typeof entrada !== 'object' || !entrada.timestamp) continue;
    const clave = claveRepaso(entrada);
    if (!vistos.has(clave)) vistos.set(clave, entrada);
  }
  return [...vistos.values()]
    .sort((x, y) => ms(y.timestamp) - ms(x.timestamp) || (claveRepaso(x) < claveRepaso(y) ? -1 : 1))
    .slice(0, MAX_HISTORIAL_SRS);
}

/** El historial sin los repasos hasta `limiteMs`. */
export function historialDespuesDe(historial: any[] | null | undefined, limiteMs: number): any[] {
  return (historial || []).filter((entrada) => ms(entrada?.timestamp) > limiteMs);
}

/**
 * Lo que ven las pantallas: lo de este aparato (los contadores de siempre, que solo
 * cuentan lo hecho aquí) más lo de los demás aparatos.
 */
export function sumarDiasDeOtros(
  propios: { daily: Record<string, number>; stats: Record<string, { reviews: number; newWords: string[] }> },
  otros: DiasSrsPorAparato | null | undefined,
  aparatoLocal: string,
): { daily: Record<string, number>; stats: Record<string, { reviews: number; newWords: string[] }> } {
  const daily: Record<string, number> = { ...propios.daily };
  const stats: Record<string, { reviews: number; newWords: string[] }> = {};
  for (const [dia, valor] of Object.entries(propios.stats || {})) {
    stats[dia] = {
      reviews: num(valor?.reviews),
      newWords: Array.isArray(valor?.newWords) ? [...valor.newWords] : [],
    };
  }
  for (const [aparato, dias] of Object.entries(otros || {})) {
    if (aparato === aparatoLocal) continue;
    for (const [dia, valor] of Object.entries(dias || {})) {
      const d = diaSrs(valor);
      if (d.n) daily[dia] = num(daily[dia]) + d.n;
      if (d.r || d.w.length) {
        const previo = stats[dia] || { reviews: 0, newWords: [] };
        stats[dia] = { reviews: previo.reviews + d.r, newWords: [...new Set([...previo.newWords, ...d.w])] };
      }
    }
  }
  return { daily, stats };
}

/** Los segundos de estudio de un día en los demás aparatos. */
export function segundosDeOtros(otros: DiasSrsPorAparato | null | undefined, aparatoLocal: string, dia: string): number {
  let total = 0;
  for (const [aparato, dias] of Object.entries(otros || {})) {
    if (aparato !== aparatoLocal) total += num(dias?.[dia]?.s);
  }
  return total;
}
