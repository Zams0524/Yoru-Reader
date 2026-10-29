import React, { useCallback, useEffect, useState } from 'react';
import { Headphones, Server, Settings as SettingsIcon } from 'lucide-react';
import {
  absCoverUrl,
  getAudiobookLibraries,
  getAudiobooks,
  isAudiobookshelfConfigured,
} from '../../utils/audiobookshelfService';
import type { AudiobookItem, AudiobookshelfLibrary } from '../../types/integrations';
import { describeServerError } from '../../utils/serverHttp';

/**
 * Las vistas de servidor dentro del lienzo del shell: el contenido de Kavita y el de
 * Audiobookshelf se miran desde la barra lateral, no desde Ajustes. Sin credenciales
 * no se da un error seco, sino el estado vacío con el camino para ponerlas.
 */

export function ServerEmptyState({
  kind,
  es,
  onOpenSettings,
}: {
  kind: 'kavita' | 'audiobookshelf';
  es: boolean;
  onOpenSettings: () => void;
}) {
  const isKavita = kind === 'kavita';
  const Icon = isKavita ? Server : Headphones;
  return (
    <div className="yoru-server-empty">
      <Icon size={34} aria-hidden="true" />
      <h2 className="yoru-stats-title">{isKavita ? 'Kavita' : 'Audiobookshelf'}</h2>
      <p className="yoru-empty-note">
        {isKavita
          ? es
            ? 'Conecta tu servidor Kavita y tus novelas aparecerán aquí, listas para leer o descargar.'
            : 'Connect your Kavita server and your novels show up here, ready to read or download.'
          : es
            ? 'Conecta tu servidor Audiobookshelf y tus audiolibros aparecerán aquí.'
            : 'Connect your Audiobookshelf server and your audiobooks show up here.'}
      </p>
      <button type="button" className="yoru-btn yoru-btn-primary" onClick={onOpenSettings}>
        <SettingsIcon size={16} />
        {es ? 'Configurar servidor' : 'Set up the server'}
      </button>
    </div>
  );
}

/** El catálogo de audiolibros del servidor, biblioteca a biblioteca. */
export function AudiobookshelfView({ es, onOpenSettings }: { es: boolean; onOpenSettings: () => void }) {
  const [libraries, setLibraries] = useState<AudiobookshelfLibrary[] | null>(null);
  const [libraryId, setLibraryId] = useState<string | null>(null);
  const [items, setItems] = useState<AudiobookItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const configured = isAudiobookshelfConfigured();

  useEffect(() => {
    if (!configured) return undefined;
    let alive = true;
    setLoading(true);
    getAudiobookLibraries()
      .then((list) => {
        if (!alive) return;
        setLibraries(list);
        setLibraryId((current) => current || list[0]?.id || null);
      })
      .catch((err) => { if (alive) setError(describeServerError(err, es)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [configured, es]);

  const load = useCallback((id: string) => {
    let alive = true;
    setLoading(true);
    setError('');
    getAudiobooks(id, 0, 48)
      .then((page) => { if (alive) { setItems(page.items); setTotal(page.total); } })
      .catch((err) => { if (alive) setError(describeServerError(err, es)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [es]);

  useEffect(() => {
    if (!libraryId) return undefined;
    return load(libraryId);
  }, [libraryId, load]);

  if (!configured) return <ServerEmptyState kind="audiobookshelf" es={es} onOpenSettings={onOpenSettings} />;

  return (
    <div>
      <div className="yoru-view-head">
        <div>
          <h1 className="yoru-view-title">{es ? 'Audiolibros' : 'Audiobooks'}</h1>
          <div className="yoru-view-sub">
            {total > 0
              ? `${total} ${es ? (total === 1 ? 'audiolibro' : 'audiolibros') : total === 1 ? 'audiobook' : 'audiobooks'}`
              : es ? 'Tu servidor Audiobookshelf' : 'Your Audiobookshelf server'}
          </div>
        </div>
      </div>

      {libraries && libraries.length > 1 && (
        <div className="yoru-chip-row">
          {libraries.map((library) => (
            <button
              key={library.id}
              type="button"
              className={`yoru-chip${library.id === libraryId ? ' active' : ''}`}
              onClick={() => setLibraryId(library.id)}
            >
              {library.name}
            </button>
          ))}
        </div>
      )}

      {error && <p className="yoru-stats-empty">{error}</p>}

      {loading && !items.length ? (
        <div className="app-section-loading" role="status" aria-live="polite">
          <span className="app-section-loading-indicator" />
          {es ? 'Cargando…' : 'Loading…'}
        </div>
      ) : (
        <div className="yoru-grid is-covers">
          {items.map((item) => (
            <div key={item.id} className="yoru-poster">
              <div className="yoru-poster-frame">
                <img src={absCoverUrl(item.id)} alt="" loading="lazy" />
              </div>
              <span className="yoru-poster-title">{item.title}</span>
              {item.author && <span className="yoru-poster-meta">{item.author}</span>}
            </div>
          ))}
        </div>
      )}

      {!loading && !error && !items.length && (
        <p className="yoru-stats-empty">{es ? 'Esta biblioteca está vacía.' : 'This library is empty.'}</p>
      )}
    </div>
  );
}
