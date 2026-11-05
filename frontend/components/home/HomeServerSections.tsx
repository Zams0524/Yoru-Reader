import React, { useEffect, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { Rail } from './primitives';
import {
  audiobookSeriesOf,
  getCachedServerCatalog,
  sample,
  type ServerItem,
  type ServerSeries,
} from '../../utils/serverCatalog';
import type { RailId } from '../../utils/homeRails';

/**
 * Las secciones de Inicio que viven en los servidores de casa.
 *
 * Mismas reglas que el resto del catálogo de servidor: se pintan de la caché, así que
 * aparecen al instante, y una sección sin datos no se pinta ni deja hueco.
 *
 * En lugar de «Popular» (que ningún servidor expone como ranking) va «Continuar en el
 * servidor», que es el `on-deck` de Kavita: lo que ese servidor tiene a medias.
 */
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




  // «Continuar en el servidor» no repite lo que ya sale en el «Continuar» local.
  const onDeck = useMemo(
    () => catalog.onDeck.filter((item) => !localTitles || !localTitles.has(item.title)),
    [catalog.onDeck, localTitles]
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

  if (onDeck.length > 0) {
    rails['server-ondeck'] = (
      <Rail title={es ? 'Continuar en el servidor' : 'Continue on the server'} es={es}>
        {onDeck.map((item) => (
          <ServerCard key={item.id} item={item} es={es} onOpen={onOpenItem} />
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
      </span>
      <span className="yoru-poster-title">{item.title}</span>
      <span className="yoru-poster-meta">
        {item.author
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
