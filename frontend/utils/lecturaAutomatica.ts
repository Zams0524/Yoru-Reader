/**
 * Contar lo que se lee sin que nadie tenga que pedirlo.
 *
 * Hasta ahora las estadísticas solo se llenaban si en el lector abrías «Sesión de
 * lectura» y pulsabas «Iniciar sesión». Quien no lo sabía —casi todo el mundo— leía
 * un tomo entero y Estadísticas seguía en cero. Ahora cuenta sola desde que se abre
 * un libro, y la sesión manual se queda en lo que es: un cronómetro para medir la
 * velocidad de un rato concreto.
 *
 * Contar sola obliga a no contar de más, que es justo lo que la sesión manual no
 * tenía que resolver porque la parabas tú. Tres reglas:
 *
 *  1. **Solo cuenta lo nuevo.** Los caracteres se suman cuando la posición pasa del
 *     punto más lejano al que se llegó; releer o volver atrás no cuenta dos veces.
 *  2. **Un salto no es lectura.** Ir al capítulo 12 desde el índice mueve la posición
 *     cuarenta mil caracteres de golpe: eso no se ha leído. Lo que avanza más de una
 *     página larga de una vez se toma como salto.
 *  3. **Sin nadie delante no corre el reloj.** El tiempo solo cuenta con la app a la
 *     vista y habiendo hecho algo hace poco (pasar página, tocar, una tecla). Un
 *     libro abierto en el PC toda la tarde no son cuatro horas de lectura.
 *
 * Aquí solo están las cuentas, sin React ni almacén, para poder probarlas.
 */

/** Más que esto de una vez no es pasar página: es saltar. */
export const SALTO_MAX_CARACTERES = 4000;
/**
 * Cuánto se puede estar sin tocar nada y seguir «leyendo». Generoso a propósito: una
 * página densa en japonés, a quien está aprendiendo, le dura minutos.
 */
export const PAUSA_MAX_MS = 5 * 60 * 1000;
/** Un tic más largo que esto es que el aparato durmió, no que se leyó. */
const TIC_MAX_MS = 1500;
/** Todavía no hay un tic anterior con el que medir. */
const SIN_TIC = -1;

export interface ContadorLectura {
  /** Hasta que no se arma no cuenta: al abrir, el lector recoloca la posición guardada. */
  armado: boolean;
  /** El punto más lejano al que se ha llegado, en caracteres. */
  tope: number;
  pendientesCaracteres: number;
  pendientesSegundos: number;
  totalCaracteres: number;
  totalSegundos: number;
  restoMs: number;
  ultimoTic: number;
  ultimaActividad: number;
}

export function crearContador(): ContadorLectura {
  return {
    armado: false,
    tope: 0,
    pendientesCaracteres: 0,
    pendientesSegundos: 0,
    totalCaracteres: 0,
    totalSegundos: 0,
    restoMs: 0,
    ultimoTic: SIN_TIC,
    ultimaActividad: 0,
  };
}

/** Empieza a contar desde donde esté el lector ahora. */
export function armar(contador: ContadorLectura, ahora: number): void {
  contador.armado = true;
  contador.ultimoTic = SIN_TIC;
  contador.ultimaActividad = ahora;
}

/** El usuario ha hecho algo: sigue ahí. */
export function anotarActividad(contador: ContadorLectura, ahora: number): void {
  contador.ultimaActividad = ahora;
}

/**
 * El lector dice por dónde va. `esSalto` es cuando el propio lector sabe que no se
 * llegó leyendo (índice, marcador, cambio de capítulo).
 */
export function anotarPosicion(contador: ContadorLectura, posicion: number, ahora: number, esSalto = false): void {
  const actual = Math.max(0, Number(posicion) || 0);
  if (!contador.armado) {
    contador.tope = actual;
    return;
  }
  contador.ultimaActividad = ahora;
  if (esSalto) {
    // Saltar adelante deja atrás lo que no se leyó; saltar atrás no borra lo leído.
    contador.tope = Math.max(contador.tope, actual);
    return;
  }
  const avance = actual - contador.tope;
  if (avance <= 0) return;
  contador.tope = actual;
  if (avance > SALTO_MAX_CARACTERES) return;
  contador.pendientesCaracteres += avance;
  contador.totalCaracteres += avance;
}

/**
 * Un tic del reloj. `aLaVista` es que la app está delante y no en segundo plano.
 * Devuelve los segundos enteros que acaba de sumar.
 */
export function anotarTiempo(contador: ContadorLectura, ahora: number, aLaVista: boolean): number {
  const presente = contador.armado && aLaVista && ahora - contador.ultimaActividad <= PAUSA_MAX_MS;
  if (!presente) {
    contador.ultimoTic = SIN_TIC;
    return 0;
  }
  if (contador.ultimoTic === SIN_TIC) {
    contador.ultimoTic = ahora;
    return 0;
  }
  contador.restoMs += Math.min(ahora - contador.ultimoTic, TIC_MAX_MS);
  contador.ultimoTic = ahora;
  const segundos = Math.floor(contador.restoMs / 1000);
  if (segundos < 1) return 0;
  contador.restoMs -= segundos * 1000;
  contador.pendientesSegundos += segundos;
  contador.totalSegundos += segundos;
  return segundos;
}

/** Lo que falta por guardar en el parte del día; lo deja a cero. */
export function recogerPendiente(contador: ContadorLectura): { caracteres: number; segundos: number } {
  const pendiente = { caracteres: contador.pendientesCaracteres, segundos: contador.pendientesSegundos };
  contador.pendientesCaracteres = 0;
  contador.pendientesSegundos = 0;
  return pendiente;
}

/** Lo leído desde la última vez que se cerró la cuenta; lo deja a cero y sigue armado. */
export function cerrarCuenta(contador: ContadorLectura): { caracteres: number; segundos: number } {
  const total = { caracteres: contador.totalCaracteres, segundos: contador.totalSegundos };
  contador.totalCaracteres = 0;
  contador.totalSegundos = 0;
  contador.ultimoTic = SIN_TIC;
  return total;
}
