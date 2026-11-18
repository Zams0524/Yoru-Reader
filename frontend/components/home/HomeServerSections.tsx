import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Tag, X } from 'lucide-react';
import { Rail } from './primitives';
import {
  audiobookSeriesOf,
  getCachedServerCatalog,
  sample,
  serverItemId,
  type ServerItem,
  type ServerSeries,
} from '../../utils/serverCatalog';
import type { RailId } from '../../utils/homeRails';
import { audiobookList, isAudiobookInList, toggleAudiobookInList } from '../../utils/audiobookList';

/**
 * Las secciones de Inicio que viven en los servidores de casa.
 *
 * Mismas reglas que el resto del catálogo de servidor: se pintan de la caché, así que
 * aparecen al instante, y una sección sin datos no se pinta ni deja hueco.
 *
 * En lugar de «Popular» (que ningún servidor expone como ranking) va «Continuar en el
 * servidor», que es el `on-deck` de Kavita: lo que ese servidor tiene a medias.
 *
 * Lo que se aparta a mano de las dos filas de «continuar» del servidor se guarda
 * aquí, en la app: el servidor sigue sabiendo que ese libro está a medias, que es la
 * verdad, y no se lo quitamos a los demás aparatos que lo usan. Lo pidió zams (18 nov
 * 2026) al encontrarse con que en esas tarjetas el clic derecho no hacía nada.
 */
const APARTADOS = 'yoru_server_continue_hidden_v1';
const APARTADOS_EVENTO = 'yoru-server-continue-hidden';

function leerApartados(): string[] {
  try {
    const crudo = localStorage.getItem(APARTADOS);
    const lista = crudo ? JSON.parse(crudo) : [];
    return Array.isArray(lista) ? lista.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function apartar(id: string): void {
  const lista = leerApartados();
  if (!lista.includes(id)) {
    lista.push(id);
    try {
      localStorage.setItem(APARTADOS, JSON.stringify(lista));
    } catch {
      /* Sin sitio en el almacén: se queda sin apartar, que es mejor que romper la vista. */
    }
  }
  window.dispatchEvent(new Event(APARTADOS_EVENTO));
}

export function useServerRails({
  es,
  localTitles,
  onOpenItem,
  onOpenSeries,
}: {
  es: boolean;
  /** Títulos que ya están en la biblioteca local, para no repetirlos. */
  localTitles?: Set<string>;
  /** Abre la ficha de un título del servidor: la serie en Kavita, el tomo en Audiobookshelf. */
  onOpenItem: (item: ServerItem) => void;
  /** Abre una serie de audiolibros, que por ahora es su primer tomo. */
  onOpenSeries: (series: ServerSeries) => void;
}) {
  const [catalog, setCatalog] = useState(() => getCachedServerCatalog());
  const [seed, setSeed] = useState(1);

  useEffect(() => {
    const onUpdate = () => setCatalog(getCachedServerCatalog());
    window.addEventListener('yoru-server-catalog-updated', onUpdate);
    return () => window.removeEventListener('yoru-server-catalog-updated', onUpdate);
  }, []);




  /*
    Tu lista guarda ids, no títulos, así que los audiolibros salen de la misma caché
    que alimenta el resto de carruseles. Un id que ya no esté en el servidor
    sencillamente no aparece, en vez de dejar una tarjeta rota.
  */
  const [apartados, setApartados] = useState(() => new Set(leerApartados()));
  useEffect(() => {
    const onUpdate = () => setApartados(new Set(leerApartados()));
    window.addEventListener(APARTADOS_EVENTO, onUpdate);
    return () => window.removeEventListener(APARTADOS_EVENTO, onUpdate);
  }, []);
  const quitar = (item: ServerItem) => apartar(item.id);

  const [listIds, setListIds] = useState(() => audiobookList());
  useEffect(() => {
    const onUpdate = () => setListIds(audiobookList());
    window.addEventListener('yoru-audiobook-list-updated', onUpdate);
    return () => window.removeEventListener('yoru-audiobook-list-updated', onUpdate);
  }, []);
  const listed = useMemo(() => {
    if (listIds.length === 0) return [];
    const byId = new Map(catalog.audiobooks.map((item) => [serverItemId(item), item]));
    return listIds.map((id) => byId.get(id)).filter((item): item is ServerItem => Boolean(item));
  }, [listIds, catalog.audiobooks]);

  // «Continuar en el servidor» no repite lo que ya sale en el «Continuar» local.
  const onDeck = useMemo(
    () => catalog.onDeck.filter(
      (item) => (!localTitles || !localTitles.has(item.title)) && !apartados.has(item.id)
    ),
    [catalog.onDeck, localTitles, apartados]
  );
  const continueAudio = useMemo(
    () => catalog.continueAudio.filter((item) => !apartados.has(item.id)),
    [catalog.continueAudio, apartados]
  );
  const audioSeries = useMemo(() => audiobookSeriesOf(catalog.audiobooks), [catalog.audiobooks]);
  const randomBooks = useMemo(() => sample(catalog.kavita, 10, seed), [catalog.kavita, seed]);
  const randomAudio = useMemo(() => sample(catalog.audiobooks, 10, seed + 7), [catalog.audiobooks, seed]);

  /*
    Devueltos uno a uno y no como un bloque: así Inicio puede intercalarlos con los
    suyos y el usuario puede poner «Continuar en el servidor» antes que «Continuar».
    Un carrusel sin datos no entra en el mapa, así que no se pinta ni deja hueco.
  */
  const rails: Partial<Record<RailId, React.ReactNode>> = {};

  /*
    Lo que apartaste tú con «Añadir a lista». Va de los primeros porque es lo único
    de esta pantalla que elegiste a mano: todo lo demás te lo proponemos nosotros.
  */
  if (listed.length > 0) {
    rails['server-list'] = (
      <Rail title={es ? 'Tu lista' : 'Your list'} es={es}>
        {listed.map((item) => (
          <ServerCard key={`l-${item.id}`} item={item} es={es} onOpen={onOpenItem} />
        ))}
      </Rail>
    );
  }

  /*
    «Seguir escuchando»: los audiolibros a medias, con su barra de avance.

    Faltaba, y se notaba: los libros tenían su «Continuar» con el porcentaje desde el
    principio y los audiolibros no tenían nada, aunque el servidor sepa perfectamente
    por dónde vas. Lo pidió zams (18 nov 2026). Sale del `items-in-progress` del
    propio Audiobookshelf, así que dice lo mismo que su app.
  */
  if (continueAudio.length > 0) {
    rails['server-audio-continue'] = (
      <Rail title={es ? 'Seguir escuchando' : 'Keep listening'} es={es}>
        {continueAudio.map((item) => (
          <ServerContinueCard key={`c-${item.id}`} item={item} es={es} onOpen={onOpenItem} onHide={quitar} />
        ))}
      </Rail>
    );
  }

  if (onDeck.length > 0) {
    rails['server-ondeck'] = (
      <Rail title={es ? 'Continuar en el servidor' : 'Continue on the server'} es={es}>
        {onDeck.map((item) => (
          <ServerContinueCard key={item.id} item={item} es={es} onOpen={onOpenItem} onHide={quitar} />
        ))}
      </Rail>
    );
  }

  if (catalog.forYouAudio.length > 0) {
    rails['server-foryou-audio'] = (
      <Rail title={es ? 'Audiolibros para ti' : 'Audiobooks for you'} es={es}>
        {catalog.forYouAudio.map((item) => (
          <ServerCard key={item.id} item={item} es={es} onOpen={onOpenItem} />
        ))}
      </Rail>
    );
  }

  if (catalog.kavita.length > 0) {
    rails['server-kavita'] = (
      <Rail title={es ? 'Series de libros' : 'Book series'} es={es}>
        {catalog.kavita.map((item) => (
          <ServerCard key={item.id} item={item} es={es} onOpen={onOpenItem} />
        ))}
      </Rail>
    );
  }

  if (audioSeries.length > 0) {
    rails['server-audio-series'] = (
      <Rail title={es ? 'Series de audiolibros' : 'Audiobook series'} es={es}>
        {audioSeries.map((series) => (
          <SeriesStack key={series.key} series={series} es={es} onOpen={onOpenSeries} />
        ))}
      </Rail>
    );
  }

  if (randomBooks.length > 0) {
    rails['server-random-books'] = (
      <Rail
        title={es ? 'Libros aleatorios' : 'Random books'}
        onMore={() => setSeed((value) => value + 1)}
        moreLabel={es ? 'Actualizar' : 'Shuffle'}
        es={es}
      >
        {randomBooks.map((item) => (
          <ServerCard key={`r-${item.id}`} item={item} es={es} onOpen={onOpenItem} />
        ))}
      </Rail>
    );
  }

  if (randomAudio.length > 0) {
    rails['server-random-audio'] = (
      <Rail
        title={es ? 'Audiolibros aleatorios' : 'Random audiobooks'}
        onMore={() => setSeed((value) => value + 1)}
        moreLabel={es ? 'Actualizar' : 'Shuffle'}
        es={es}
      >
        {randomAudio.map((item) => (
          <ServerCard key={`ra-${item.id}`} item={item} es={es} onOpen={onOpenItem} />
        ))}
      </Rail>
    );
  }

  return rails;
}

/**
 * Una fila de «seguir donde lo dejaste», para lo que está a medias en el servidor.
 *
 * Es la misma tarjeta ancha que el «Continuar» local (`.yoru-continue-card`), y a
 * propósito: zams lo pidió así (18 nov 2026) porque las tres filas de «continuar»
 * caen juntas arriba de Inicio y mezclar póster grande con fila ancha las hacía
 * parecer secciones distintas. Lo único que cambia es la línea de estado, que dice
 * si es novela o audiolibro.
 */
function ServerContinueCard({
  item,
  es,
  onOpen,
  onHide,
}: {
  item: ServerItem;
  es: boolean;
  onOpen: (item: ServerItem) => void;
  /** Aparta la tarjeta de la fila, solo en esta app. */
  onHide: (item: ServerItem) => void;
}) {
  const isAudio = item.source === 'audiobookshelf';
  const percent = typeof item.percent === 'number' ? Math.min(100, Math.max(0, item.percent)) : 0;
  const tipo = isAudio ? (es ? 'Audiolibro' : 'Audiobook') : (es ? 'Novela' : 'Novel');
  // Sin autor no se escribe «Sin autor»: eso es afirmar algo que no sabemos. Kavita
  // solo da el escritor en los metadatos de la serie, y de ahí sale cuando los trae.
  const subtitulo = item.author || item.series || '';
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      className="yoru-continue-slot"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <button type="button" className="yoru-continue-card" title={item.title} onClick={() => onOpen(item)}>
        <span className="yoru-continue-cover">
          <img src={item.cover} alt="" loading="lazy" />
        </span>
        <span className="yoru-continue-body">
          <span className="yoru-continue-title">{item.title}</span>
          {subtitulo && <span className="yoru-continue-author">{subtitulo}</span>}
          <span className="yoru-continue-state">
            {tipo} · {percent} %
          </span>
          <span className="yoru-continue-bar">
            <span style={{ width: `${percent}%` }} />
          </span>
        </span>
      </button>
      <button
        type="button"
        className="yoru-continue-remove"
        title={es ? 'Quitar de esta fila' : 'Remove from this row'}
        aria-label={es ? 'Quitar de esta fila' : 'Remove from this row'}
        onClick={(event) => {
          event.stopPropagation();
          onHide(item);
        }}
      >
        <X size={14} />
      </button>
      {menu && (
        <ServerItemMenu
          item={item}
          es={es}
          x={menu.x}
          y={menu.y}
          onOpen={onOpen}
          onHide={onHide}
          onClose={() => setMenu(null)}
        />
      )}
    </span>
  );
}

/**
 * El menú del clic derecho de una tarjeta del servidor.
 *
 * No es el de los libros de tu biblioteca: lo que hay aquí no es un libro tuyo, así
 * que no puede ir a una colección ni tiene ficha local. Lo que sí puede hacer está
 * todo aquí, con la misma pinta que el otro. Lo pidió zams (18 nov 2026).
 */
function ServerItemMenu({
  item,
  es,
  x,
  y,
  onOpen,
  onHide,
  onClose,
}: {
  item: ServerItem;
  es: boolean;
  x: number;
  y: number;
  onOpen: (item: ServerItem) => void;
  onHide: (item: ServerItem) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: x, top: y, ready: false });

  // Que no se salga de la ventana: se mide ya pintado y se recoloca si hace falta.
  useEffect(() => {
    const caja = ref.current?.getBoundingClientRect();
    if (!caja) return;
    setPlace({
      left: Math.max(8, Math.min(x, window.innerWidth - caja.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - caja.height - 8)),
      ready: true,
    });
  }, [x, y]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isAudio = item.source === 'audiobookshelf';
  const id = serverItemId(item);
  const enLista = isAudio && isAudiobookInList(id);
  const run = (action: () => void) => () => { action(); onClose(); };

  return (
    <div
      className="yoru-menu-scrim"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onContextMenu={(event) => { event.preventDefault(); onClose(); }}
    >
      <div
        ref={ref}
        className="yoru-menu"
        role="menu"
        aria-label={item.title}
        style={{ left: place.left, top: place.top, visibility: place.ready ? 'visible' : 'hidden' }}
      >
        <div className="yoru-menu-head" title={item.title}>{item.title}</div>

        <button type="button" className="yoru-menu-item" role="menuitem" onClick={run(() => onOpen(item))}>
          <Play size={15} />
          {isAudio ? (es ? 'Seguir escuchando' : 'Keep listening') : es ? 'Continuar' : 'Continue'}
        </button>

        {isAudio && (
          <button
            type="button"
            className="yoru-menu-item"
            role="menuitem"
            onClick={run(() => toggleAudiobookInList(id))}
          >
            <Tag size={15} />
            {enLista
              ? (es ? 'Quitar de tu lista' : 'Remove from your list')
              : (es ? 'Añadir a tu lista' : 'Add to your list')}
          </button>
        )}

        <div className="yoru-menu-sep" />

        <button type="button" className="yoru-menu-item" role="menuitem" onClick={run(() => onHide(item))}>
          <X size={15} />
          {es ? 'Quitar de esta fila' : 'Remove from this row'}
        </button>
      </div>
    </div>
  );
}

/**
 * Una portada del servidor.
 *
 * Es un `<button>` y no un `<div>` con `onClick` a propósito: así llega el foco con
 * el tabulador y responde a Enter y a espacio sin escribir nada. Antes era un `div`,
 * y las seis filas de servidor de Inicio parecían pulsables sin serlo.
 */
function ServerCard({ item, es, onOpen }: { item: ServerItem; es: boolean; onOpen: (item: ServerItem) => void }) {
  const isAudio = item.source === 'audiobookshelf';
  return (
    <button
      type="button"
      className={`yoru-poster${isAudio ? ' is-audio' : ''}`}
      title={item.title}
      onClick={() => onOpen(item)}
    >
      <span className="yoru-poster-frame">
        <img src={item.cover} alt="" loading="lazy" />
        {isAudio && (
          <span className="yoru-poster-play" aria-hidden="true">
            <Play size={18} />
          </span>
        )}
        {/* Lo que llevas escuchado, sobre la portada, como en «Continuar». */}
        {typeof item.percent === 'number' && item.percent > 0 && (
          <span className="yoru-poster-progress" aria-hidden="true">
            <span style={{ width: `${Math.min(100, item.percent)}%` }} />
          </span>
        )}
      </span>
      <span className="yoru-poster-title">{item.title}</span>
      <span className="yoru-poster-meta">
        {typeof item.percent === 'number' && item.percent > 0
          ? `${item.percent} % ${isAudio ? (es ? 'escuchado' : 'listened') : (es ? 'leído' : 'read')}`
          : item.author
          || (item.hours
            ? `~${Math.round(item.hours)} h ${es ? 'de lectura' : 'to read'}`
            : isAudio ? (es ? 'Audiolibro' : 'Audiobook') : 'Kavita')}
      </span>
    </button>
  );
}

/**
 * Tarjeta de serie: los cantos de los demás tomos asomando detrás de la portada.
 *
 * Abre el primer tomo, no una ficha de serie: la serie la agrupamos nosotros por
 * nombre y Audiobookshelf no tiene una entidad propia a la que ir.
 */
function SeriesStack({
  series,
  es,
  onOpen,
}: {
  series: ServerSeries;
  es: boolean;
  onOpen: (series: ServerSeries) => void;
}) {
  const backs = series.covers.slice(1, 3);
  return (
    <button type="button" className="yoru-series-stack" title={series.title} onClick={() => onOpen(series)}>
      <span className="yoru-series-stack-frame">
        {backs.map((cover, index) => (
          <img
            key={`${cover}-${index}`}
            className={`yoru-series-stack-back is-${index + 1}`}
            src={cover}
            alt=""
            loading="lazy"
          />
        ))}
        <img className="yoru-series-stack-front" src={series.covers[0]} alt="" loading="lazy" />
      </span>
      <span className="yoru-poster-title">{series.title}</span>
      <span className="yoru-poster-meta">
        {series.count}{' '}
        {es
          ? series.count === 1 ? 'audiolibro' : 'audiolibros'
          : series.count === 1 ? 'audiobook' : 'audiobooks'}
        {series.author ? ` · ${series.author}` : ''}
      </span>
    </button>
  );
}
