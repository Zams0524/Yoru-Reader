import { useCallback, useEffect, useRef } from 'react';
import { isNativeApp } from '../../utils/platform';
import {
  anotarActividad,
  anotarPosicion,
  anotarTiempo,
  armar,
  cerrarCuenta,
  crearContador,
  recogerPendiente,
} from '../../utils/lecturaAutomatica';

/** Cada cuánto se lleva lo leído al parte del día. */
const GUARDAR_CADA_SEGUNDOS = 15;
/**
 * Lo que se espera tras la primera posición antes de contar. Al abrir, el lector
 * informa primero del principio y luego de donde lo dejaste: sin esta espera, volver
 * a un libro por la página 200 contaría como haber leído hasta ahí.
 */
const ESPERA_AL_ABRIR_MS = 2500;

interface Opciones {
  bookId: string;
  title: string;
  /** Suma al parte del día (por título). */
  onSave?: (title: string, chars: number, seconds: number, sessions?: number) => Promise<void>;
  /** Suma a los totales del libro. */
  onIncrement: (bookId: string, chars: number, seconds: number) => void;
}

/**
 * Lleva la cuenta de lo leído mientras el lector está abierto, sin botón.
 * Las reglas están en `utils/lecturaAutomatica.ts`; esto solo las conecta al lector.
 */
export function useAutoReadingStats({ bookId, title, onSave, onIncrement }: Opciones) {
  const contadorRef = useRef(crearContador());
  const esperaRef = useRef<number | null>(null);
  const libroRef = useRef({ bookId, title });
  const salidasRef = useRef({ onSave, onIncrement });
  salidasRef.current = { onSave, onIncrement };

  const guardar = useCallback((sesiones = 0) => {
    const { caracteres, segundos } = recogerPendiente(contadorRef.current);
    if (caracteres === 0 && segundos === 0 && sesiones === 0) return;
    const guardarParte = salidasRef.current.onSave;
    if (!guardarParte) return;
    void guardarParte(libroRef.current.title || '', caracteres, segundos, sesiones).catch((error) => {
      console.error('No se pudo guardar lo leído en las estadísticas:', error);
    });
  }, []);

  /** Cierra el rato de lectura: al salir del libro o al irse la app al fondo. */
  const finalize = useCallback(() => {
    const { caracteres, segundos } = cerrarCuenta(contadorRef.current);
    const huboLectura = caracteres > 0 || segundos > 0;
    guardar(huboLectura ? 1 : 0);
    if (!huboLectura) return;
    try {
      void Promise.resolve(salidasRef.current.onIncrement(libroRef.current.bookId, caracteres, segundos)).catch((error) => {
        console.error('No se pudieron guardar los totales del libro:', error);
      });
    } catch (error) {
      console.error('No se pudieron guardar los totales del libro:', error);
    }
  }, [guardar]);

  const onPosition = useCallback((position: number, isJump = false) => {
    const contador = contadorRef.current;
    anotarPosicion(contador, position, performance.now(), isJump);
    if (!contador.armado && esperaRef.current === null) {
      esperaRef.current = window.setTimeout(() => {
        esperaRef.current = null;
        armar(contadorRef.current, performance.now());
      }, ESPERA_AL_ABRIR_MS);
    }
  }, []);

  // Un libro distinto es otra cuenta: se cierra la del anterior con su título.
  useEffect(() => {
    libroRef.current = { bookId, title };
    return () => {
      finalize();
      if (esperaRef.current !== null) {
        window.clearTimeout(esperaRef.current);
        esperaRef.current = null;
      }
      contadorRef.current = crearContador();
    };
    // El título no entra: cambiarlo desde los detalles no es cambiar de libro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, finalize]);
  useEffect(() => { libroRef.current.title = title; }, [title]);

  useEffect(() => {
    /*
      En Android la página del lector la pinta una vista nativa encima del WebView,
      que se queda sin foco aunque estés leyendo: allí solo se mira si la app está a
      la vista. En el PC sí importa el foco: con otra ventana delante no se lee.
    */
    const nativo = isNativeApp();
    const aLaVista = () => document.visibilityState === 'visible' && (nativo || document.hasFocus());

    const reloj = window.setInterval(() => {
      const contador = contadorRef.current;
      anotarTiempo(contador, performance.now(), aLaVista());
      if (contador.pendientesSegundos >= GUARDAR_CADA_SEGUNDOS) guardar();
    }, 1000);

    const actividad = () => anotarActividad(contadorRef.current, performance.now());
    const alOcultarse = () => {
      if (document.visibilityState === 'hidden') finalize();
      else actividad();
    };
    const opciones = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', actividad, opciones);
    window.addEventListener('keydown', actividad, opciones);
    window.addEventListener('wheel', actividad, opciones);
    document.addEventListener('visibilitychange', alOcultarse);
    window.addEventListener('pagehide', finalize);
    return () => {
      window.clearInterval(reloj);
      window.removeEventListener('pointerdown', actividad, opciones);
      window.removeEventListener('keydown', actividad, opciones);
      window.removeEventListener('wheel', actividad, opciones);
      document.removeEventListener('visibilitychange', alOcultarse);
      window.removeEventListener('pagehide', finalize);
    };
  }, [finalize, guardar]);

  return { onPosition, finalize };
}
