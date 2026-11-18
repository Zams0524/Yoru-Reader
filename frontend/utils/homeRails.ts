import { db } from './db';

/**
 * Qué carruseles salen en Inicio, en qué orden, y cuáles no.
 *
 * Inicio llegó a tener **once** carruseles entre los de la biblioteca local y los de
 * los servidores de casa. Once es demasiado para una portada, pero cuál sobra depende
 * de cada uno: quien no tenga Audiobookshelf no quiere los tres de audio, y quien lea
 * del servidor quiere «Continuar en el servidor» arriba del todo.
 *
 * Por eso el orden se guarda y no se decide aquí. Lo que sí se decide aquí es el
 * orden de partida, que es el que había.
 *
 * Un carrusel vacío no se pinta aunque esté activado — eso lo resuelve cada vista, no
 * esta lista: aquí solo está la intención del usuario, no lo que hay.
 */

export type RailId =
  | 'continue'
  | 'recent'
  | 'server-list'
  | 'server-ondeck'
  | 'server-audio-continue'
  | 'server-foryou-audio'
  | 'server-kavita'
  | 'server-audio-series'
  | 'server-random-books'
  | 'server-random-audio'
  | 'for-you'
  | 'series'
  | 'collections';

export interface RailDef {
  id: RailId;
  es: string;
  en: string;
}

/** El orden de siempre, que es el que vale cuando nadie lo ha tocado. */
export const RAILS: RailDef[] = [
  /*
    Primero, lo que tienes a medias; después, lo que hay.

    Los tres «continuar» van juntos y arriba —el tuyo, el de Kavita y el de los
    audiolibros—, porque quien abre la app casi siempre viene a seguir con algo. Antes
    «Añadidos recientemente» y «Tu lista» se colaban en medio, y en un perfil nuevo,
    sin libros propios empezados, el primer carrusel acababa siendo el de novedades y
    lo que estabas leyendo quedaba más abajo. Lo pidió zams (18 nov 2026).
  */
  { id: 'continue', es: 'Continuar', en: 'Continue' },
  { id: 'server-ondeck', es: 'Continuar en el servidor', en: 'Continue on the server' },
  { id: 'server-audio-continue', es: 'Seguir escuchando', en: 'Keep listening' },
  { id: 'recent', es: 'Añadidos recientemente', en: 'Recently added' },
  // Lo que tú apartaste va antes que lo que te proponemos nosotros.
  { id: 'server-list', es: 'Tu lista', en: 'Your list' },
  { id: 'server-foryou-audio', es: 'Audiolibros para ti', en: 'Audiobooks for you' },
  { id: 'server-kavita', es: 'Series de libros', en: 'Book series' },
  { id: 'server-audio-series', es: 'Series de audiolibros', en: 'Audiobook series' },
  { id: 'server-random-books', es: 'Libros aleatorios', en: 'Random books' },
  { id: 'server-random-audio', es: 'Audiolibros aleatorios', en: 'Random audiobooks' },
  { id: 'for-you', es: 'Libros para ti', en: 'Books for you' },
  { id: 'series', es: 'Series', en: 'Series' },
  { id: 'collections', es: 'Descubre colecciones', en: 'Discover collections' },
];

export interface HomeLayout {
  order: RailId[];
  hidden: RailId[];
}

const BASE_KEY = 'yoru_home_rails';

function key(): string {
  return `${BASE_KEY}_${db.getActiveProfileId() || 'profile-default'}`;
}

const VALID = new Set<string>(RAILS.map((rail) => rail.id));

/**
 * El orden guardado, completado con lo que falte.
 *
 * Se completa siempre porque un carrusel nuevo tiene que aparecer solo a quien ya
 * tenía un orden guardado; si no, añadir uno sería invisible para todo el que haya
 * tocado esta pantalla alguna vez.
 */
export function getHomeLayout(): HomeLayout {
  let saved: Partial<HomeLayout> = {};
  try {
    const raw = localStorage.getItem(key());
    if (raw) saved = JSON.parse(raw);
  } catch {
    saved = {};
  }
  const order = (Array.isArray(saved.order) ? saved.order : []).filter((id) => VALID.has(id));
  const known = new Set(order);
  /*
    Lo que falte entra en su sitio, no al final.

    Antes se empujaba al final, y un carrusel nuevo que de fábrica va arriba —«Seguir
    escuchando», por ejemplo— aparecía el último a todo el que tuviera un orden
    guardado, que es casi todo el mundo. Ahora se mete detrás del vecino que tenga
    delante en el orden de fábrica, así que cae donde se pensó. Quien lo mueva a mano
    manda, como siempre: esto solo decide dónde nace.
  */
  for (let i = 0; i < RAILS.length; i++) {
    const id = RAILS[i].id;
    if (known.has(id)) continue;
    let destino = order.length;
    for (let anterior = i - 1; anterior >= 0; anterior--) {
      const posicion = order.indexOf(RAILS[anterior].id);
      if (posicion >= 0) { destino = posicion + 1; break; }
    }
    order.splice(destino, 0, id);
    known.add(id);
  }
  const hidden = (Array.isArray(saved.hidden) ? saved.hidden : []).filter((id) => VALID.has(id));
  return { order, hidden };
}

export function saveHomeLayout(layout: HomeLayout): void {
  try {
    localStorage.setItem(key(), JSON.stringify(layout));
    window.dispatchEvent(new Event('yoru-home-rails-updated'));
  } catch {
    // Sin sitio donde guardar, Inicio se queda con el orden de siempre. No se pierde
    // nada: el orden es una preferencia, no un dato.
  }
}

export function resetHomeLayout(): void {
  saveHomeLayout({ order: RAILS.map((rail) => rail.id), hidden: [] });
}
