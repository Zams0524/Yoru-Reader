/**
 * Novedades: el aviso corto de «esto se actualizó» que sale en Inicio al abrir la app
 * después de una versión nueva.
 *
 * No es el historial de versiones de Ajustes → Acerca de (`changelog.ts`), que es la
 * lista larga de cada cambio. Aquí va una frase, la que quieres leer de pasada antes de
 * volver a tu libro. Lo pidió zams (19 nov 2026).
 *
 * Qué dispara el aviso: que haya cambiado la versión del paquete web
 * (`stable.json` → `hotUpdateVersion`), que es la que cambia en cada publicación, también
 * cuando llega por OTA sin APK nuevo.
 *
 * Qué dice: la nota de más arriba de `NOVEDADES` que este aparato no haya visto todavía.
 * Las notas van por identificador y no por número de versión a propósito: el número lo
 * pone el taller al publicar (`build/prepare-update-manifest.cjs`), así que al escribir la
 * nota aún no se sabe cuál le tocará. Sin nota nueva que contar, el aviso lo dice en
 * genérico, que sigue siendo verdad.
 *
 * Quien instala por primera vez no ve nada: no se ha actualizado de nada. Solo se apunta
 * la versión con la que entró, y el aviso llega con la siguiente.
 */

import stableManifest from '../../stable.json';
import { pushNotice } from './appNotices';

export interface Novedad {
  /** Identificador estable y único de la nota; lo que se guarda como «ya visto». */
  id: string;
  es: string;
  en: string;
}

/** Las notas escritas a mano, de la más nueva a la más vieja. La primera es la que sale. */
export const NOVEDADES: Novedad[] = [
  {
    id: '2026-11-21-leer-y-escuchar-mas-claro',
    es: 'En «Leer y escuchar» la frase que suena se ve mejor, con fondo y subrayado. Si pasas de página por tu cuenta, la barra del audio te ofrece «Volver a la narración». Y el reproductor grande enseña la frase que suena y trae un temporizador de sueño: por minutos o hasta el final del capítulo.',
    en: 'In “Read and listen” the sentence being read stands out more, with a background and an underline. If you turn the page yourself, the audio bar offers “Back to the narration”. And the full player shows the sentence being read and has a sleep timer: by minutes or until the end of the chapter.',
  },
  {
    id: '2026-11-20-leer-y-escuchar-sincronizado',
    es: '«Leer y escuchar» ya va sincronizado: al abrir una novela con su audiolibro, el audio arranca solo y el texto resalta la frase que suena y la sigue. Funciona en los audiolibros que el servidor ya tiene alineados; los demás suenan igual, sin resaltado, hasta que les toque.',
    en: '“Read and listen” is now in sync: open a novel with its audiobook and the audio starts on its own while the text highlights the sentence being read and follows it. It works for the audiobooks the server has already aligned; the rest still play, without highlighting, until their turn comes.',
  },
  {
    id: '2026-11-20-estadisticas-solas-y-leer-y-escuchar',
    es: 'Las estadísticas se llenan solas: lo que lees cuenta desde que abres un libro, y lo que escuchas, desde cualquier reproductor. Y «Leer y escuchar» enseña cada novela con su audiolibro, más las de Kavita que ya tienen el suyo, tomo a tomo.',
    en: 'Statistics now fill in on their own: reading counts from the moment you open a book, and listening from any player. And “Read and listen” shows each novel with its audiobook, plus the Kavita novels that already have theirs, volume by volume.',
  },
  {
    id: '2026-11-20-progreso-entre-telefono-y-pc',
    es: 'Ya puedes seguir en el PC lo que leías en el teléfono, y al revés: el progreso de los tomos y audiolibros del servidor viaja con tu cuenta de Discord, se guarda también con un libro abierto y se pone al día al volver a la app.',
    en: 'You can now pick up on your PC what you were reading on your phone, and the other way round: progress in server volumes and audiobooks travels with your Discord account, is saved even with a book open, and catches up when you come back to the app.',
  },
  {
    id: '2026-11-20-boton-mas-coleccion-y-atras-ajustes',
    es: 'El «+» de arriba abre directamente la ventana para crear una colección. Y al volver atrás desde Ajustes regresas a donde estabas, no a una estantería sin cabecera.',
    en: 'The “+” at the top now opens the create-collection window directly. And going back from Settings returns you to where you were, not to a shelf without a header.',
  },
  {
    id: '2026-11-20-colecciones-agregar-novelas-y-ajustes-lector',
    es: 'Al crear una colección con el «+» ya puedes agregar novelas del teléfono o del PC ahí mismo. Y el panel de ajustes del lector es más pequeño y deja ver la página: se quitó el botón «Ajustes generales».',
    en: 'When you create a collection with “+” you can now add novels from your phone or PC right there. And the reader settings panel is smaller and lets the page show through: the “General settings” button is gone.',
  },
  {
    id: '2026-11-19-lector-android-sin-congelarse',
    es: 'En Android, marcar una palabra ya no congela la página unos segundos: los colores se actualizan por detrás mientras sigues leyendo. El libro abre más rápido y tocar una palabra justo después de pasar página abre el diccionario.',
    en: 'On Android, marking a word no longer freezes the page for a few seconds: the colours update in the background while you keep reading. Books open faster, and tapping a word right after turning the page opens the dictionary.',
  },
  {
    id: '2026-11-19-notificaciones-audiolibros',
    es: 'En Android, el audiolibro que escuchas sale en las notificaciones y en la pantalla de bloqueo, con sus mandos; y los avisos de actualización y de repaso ahora sí llegan.',
    en: 'On Android, the audiobook you are listening to shows in the notifications and on the lock screen, with its controls; and update and review notices now do arrive.',
  },
  {
    id: '2026-11-19-perfil-unico-sync',
    es: 'Si borras los datos o instalas la app en otro aparato, tu progreso vuelve a tu perfil y ya no a uno aparte; y lo que borras deja de esconder su serie en Inicio.',
    en: 'After clearing data or installing on another device, your progress comes back to your profile instead of a separate one; and deleted books no longer hide their series on Home.',
  },
  {
    id: '2026-11-19-inicio-novedades',
    es: 'La app abre siempre en Inicio, y aquí te contamos en una línea lo que cambió en cada versión.',
    en: 'The app always opens on Home, and tells you here in one line what changed in each version.',
  },
];

const VERSION_KEY = 'yoru_novedades_version';
const NOTA_KEY = 'yoru_novedades_nota';
const AVISO_KEY = 'yoru_novedades_aviso';

/** La versión del paquete web que está corriendo ahora mismo. */
export function versionActual(): string {
  const manifest = stableManifest as { hotUpdateVersion?: string; appVersion?: string };
  return String(manifest.hotUpdateVersion || manifest.appVersion || '');
}

function leer(clave: string): string {
  try {
    return localStorage.getItem(clave) || '';
  } catch {
    return '';
  }
}

function escribir(clave: string, valor: string): void {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    // Sin almacenamiento el aviso saldrá otra vez; es lo de menos.
  }
}

export interface NovedadPendiente {
  version: string;
  texto: string;
}

/** La nota de arriba del todo, si este aparato no la ha visto ya. */
function notaSinVer(): Novedad | null {
  const nota = NOVEDADES[0];
  if (!nota) return null;
  return leer(NOTA_KEY) === nota.id ? null : nota;
}

function textoDeAviso(es: boolean, version: string): string {
  const nota = notaSinVer();
  if (nota) return es ? nota.es : nota.en;
  return es
    ? `Yoru Reader se actualizó a la versión ${version}.`
    : `Yoru Reader was updated to version ${version}.`;
}

/** Da la novedad por leída: no vuelve a salir hasta la siguiente versión. */
export function marcarNovedadVista(): void {
  const version = versionActual();
  if (version) escribir(VERSION_KEY, version);
  const nota = NOVEDADES[0];
  if (nota) escribir(NOTA_KEY, nota.id);
}

/**
 * La novedad que toca enseñar, o nulo si no hay ninguna: porque es la primera vez que se
 * abre la app, porque ya se vio esta versión, o porque no se sabe qué versión corre.
 */
export function novedadPendiente(es: boolean): NovedadPendiente | null {
  const version = versionActual();
  if (!version) return null;

  const vista = leer(VERSION_KEY);
  if (!vista) {
    // Primera vez: no se ha actualizado de nada, solo se deja apuntado desde dónde parte.
    marcarNovedadVista();
    return null;
  }
  if (vista === version) return null;

  return { version, texto: textoDeAviso(es, version) };
}

/**
 * Deja la novedad también en Notificaciones, una sola vez por versión, para que siga ahí
 * después de cerrar la tarjeta de Inicio y para que se encienda la campana.
 */
export function anunciarNovedadEnAvisos(es: boolean): void {
  const version = versionActual();
  if (!version) return;
  const vista = leer(VERSION_KEY);
  // Sin versión apuntada no hay actualización que anunciar: es una instalación nueva.
  if (!vista || vista === version) return;
  if (leer(AVISO_KEY) === version) return;
  escribir(AVISO_KEY, version);
  pushNotice(
    es ? `Yoru se actualizó a la ${version}` : `Yoru was updated to ${version}`,
    textoDeAviso(es, version)
  );
}
