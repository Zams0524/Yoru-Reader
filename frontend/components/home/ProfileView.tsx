import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Headphones, ImagePlus, Pencil, Play, Settings, Trash2, User } from 'lucide-react';
import { BookPoster, EmptyState } from './primitives';
import { isCssGradient, shelfBooks, visibleBooks, type ShelfBook, type ShelfId } from './libraryIndex';
import { audiobookList } from '../../utils/audiobookList';
import {
  getCachedServerCatalog,
  localAudioContinueItems,
  serverItemId,
  type ServerItem,
} from '../../utils/serverCatalog';
import { resizeToJpeg } from '../../utils/profileImage';

/**
 * La página del perfil: quién eres en Yoru y qué tienes entre manos.
 *
 * Hasta ahora el avatar de la cabecera llevaba a Ajustes, y el perfil era dos campos
 * dentro de un formulario. Aquí tiene su sitio: portada, foto, nombre, y debajo sus
 * dos listas, la de libros y la de audiolibros, cada una con sus estados.
 *
 * Solo hay lo que Yoru tiene de verdad. Los perfiles son locales: no hay cuenta, ni
 * correo, ni estado «en línea», ni sesión que cerrar, así que nada de eso se pinta.
 */

type Tab = 'overview' | 'books' | 'audio';
type BookFilter = 'all' | ShelfId;
type AudioFilter = 'all' | 'listening' | 'list';

interface ProfileLike {
  id: string;
  name: string;
  avatar?: string;
  avatarEmoji?: string;
  /** Imagen de portada (`data:`), o vacío si no ha puesto ninguna. */
  banner?: string;
}

export default function ProfileView({
  books,
  es,
  profile,
  onOpenDetail,
  onOpenServerItem,
  onOpenSettings,
  onUpdateProfile,
}: {
  books: ShelfBook[];
  es: boolean;
  profile: ProfileLike | undefined;
  onOpenDetail: (book: ShelfBook) => void;
  onOpenServerItem: (item: ServerItem) => void;
  onOpenSettings: () => void;
  onUpdateProfile: (profileId: string, changes: Record<string, unknown>) => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [bookFilter, setBookFilter] = useState<BookFilter>('all');
  const [audioFilter, setAudioFilter] = useState<AudioFilter>('all');
  const [bannerError, setBannerError] = useState('');
  /** Sube cuando cambia la lista de audiolibros, para volver a leerla. */
  const [audioVersion, setAudioVersion] = useState(0);
  const bannerInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const refresh = () => setAudioVersion((value) => value + 1);
    window.addEventListener('yoru-audiobook-list-updated', refresh);
    return () => window.removeEventListener('yoru-audiobook-list-updated', refresh);
  }, []);

  const shelves = useMemo(
    () => ({
      reading: shelfBooks(books, 'reading'),
      completed: shelfBooks(books, 'completed'),
      backlog: shelfBooks(books, 'backlog'),
      want: shelfBooks(books, 'want'),
    }),
    [books]
  );

  /**
   * La lista de libros del perfil: los que están en algún estante. Un libro recién
   * importado y sin abrir cae en «Por empezar», así que en la práctica son todos,
   * pero se arma desde los estantes para que el total cuadre con los filtros.
   */
  const listed = useMemo(() => {
    const seen = new Set<string>();
    const out: ShelfBook[] = [];
    for (const book of [...shelves.reading, ...shelves.backlog, ...shelves.want, ...shelves.completed]) {
      if (seen.has(book.id)) continue;
      seen.add(book.id);
      out.push(book);
    }
    return out;
  }, [shelves]);

  const shownBooks = bookFilter === 'all' ? listed : shelves[bookFilter];

  /** Audiolibros: los que se están escuchando en este perfil y los apartados en «Tu lista». */
  const audio = useMemo(() => {
    const listening = localAudioContinueItems();
    const catalog = getCachedServerCatalog();
    const ids = audiobookList();
    const byId = new Map(catalog.audiobooks.map((item) => [serverItemId(item), item]));
    const list = ids.map((id) => byId.get(id)).filter((item): item is ServerItem => Boolean(item));
    const seen = new Set<string>();
    const all: ServerItem[] = [];
    for (const item of [...listening, ...list]) {
      const id = serverItemId(item);
      if (seen.has(id)) continue;
      seen.add(id);
      all.push(item);
    }
    return { listening, list, all };
    // `audioVersion` entra a propósito: la lista vive en localStorage, no en props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioVersion]);

  const shownAudio = audioFilter === 'all' ? audio.all : audio[audioFilter];

  if (!profile) {
    return <EmptyState title={es ? 'No hay ningún perfil activo' : 'There is no active profile'} />;
  }

  const avatar = profile.avatar || '';
  const avatarIsImage = Boolean(avatar) && !isCssGradient(avatar);
  const initial = (profile.name || '?').trim().charAt(0).toUpperCase();

  const pickBanner = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Se limpia para que elegir dos veces el mismo fichero vuelva a avisar.
    event.target.value = '';
    if (!file) return;
    setBannerError('');
    try {
      onUpdateProfile(profile.id, { banner: await resizeToJpeg(file) });
    } catch {
      setBannerError(es ? 'No se pudo usar esa imagen.' : 'That image could not be used.');
    }
  };

  const bookFilters: [BookFilter, string, number][] = [
    ['all', es ? 'Todos' : 'All', listed.length],
    ['reading', es ? 'Leyendo' : 'Reading', shelves.reading.length],
    ['completed', es ? 'Completados' : 'Completed', shelves.completed.length],
    ['backlog', es ? 'Pendientes' : 'Backlog', shelves.backlog.length],
    ['want', es ? 'Por empezar' : 'Want to read', shelves.want.length],
  ];
  const audioFilters: [AudioFilter, string, number][] = [
    ['all', es ? 'Todos' : 'All', audio.all.length],
    ['listening', es ? 'Escuchando' : 'Listening', audio.listening.length],
    ['list', es ? 'Mi lista' : 'My list', audio.list.length],
  ];

  const count = (value: number, singular: string, plural: string) => `${value} ${value === 1 ? singular : plural}`;

  return (
    <div className="yoru-profile">
      <div
        className={`yoru-profile-banner${profile.banner ? ' has-image' : ''}`}
        style={profile.banner ? { backgroundImage: `url(${profile.banner})` } : undefined}
      >
        <div className="yoru-profile-banner-actions">
          <button
            type="button"
            className="yoru-profile-banner-btn"
            onClick={() => bannerInput.current?.click()}
            title={es ? 'Cambiar la portada' : 'Change banner'}
          >
            <ImagePlus size={15} />
            {profile.banner ? (es ? 'Cambiar portada' : 'Change banner') : (es ? 'Poner portada' : 'Add banner')}
          </button>
          {profile.banner && (
            <button
              type="button"
              className="yoru-profile-banner-btn"
              onClick={() => onUpdateProfile(profile.id, { banner: '' })}
              title={es ? 'Quitar la portada' : 'Remove banner'}
              aria-label={es ? 'Quitar la portada' : 'Remove banner'}
            >
              <Trash2 size={15} />
            </button>
          )}
          <input ref={bannerInput} type="file" accept="image/*" hidden onChange={pickBanner} />
        </div>
      </div>

      <div className="yoru-profile-head">
        <span className="yoru-profile-avatar">
          {avatarIsImage
            ? <img src={avatar} alt="" />
            : (
              <span style={avatar ? { background: avatar } : undefined}>
                {profile.avatarEmoji || initial || <User size={34} />}
              </span>
            )}
        </span>
        <div className="yoru-profile-id">
          <h1 className="yoru-profile-name">{profile.name}</h1>
          <div className="yoru-profile-sub">
            {count(visibleBooks(books).length, es ? 'libro' : 'book', es ? 'libros' : 'books')}
            {audio.all.length > 0 && ` · ${count(audio.all.length, es ? 'audiolibro' : 'audiobook', es ? 'audiolibros' : 'audiobooks')}`}
          </div>
        </div>
        <div className="yoru-profile-actions">
          <button type="button" className="yoru-btn" onClick={onOpenSettings}>
            <Pencil size={15} />
            {es ? 'Editar perfil' : 'Edit profile'}
          </button>
          <button
            type="button"
            className="yoru-btn"
            onClick={onOpenSettings}
            title={es ? 'Ajustes' : 'Settings'}
            aria-label={es ? 'Ajustes' : 'Settings'}
          >
            <Settings size={15} />
          </button>
        </div>
      </div>
      {bannerError && <p className="yoru-profile-error" role="alert">{bannerError}</p>}

      <div className="yoru-tabs" role="tablist">
        {([
          ['overview', es ? 'Resumen' : 'Overview'],
          ['books', es ? 'Lista de libros' : 'Book list'],
          ['audio', es ? 'Lista de audiolibros' : 'Audiobook list'],
        ] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`yoru-tab${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="yoru-profile-overview">
          <section className="yoru-profile-panel">
            <div className="yoru-profile-panel-head">
              <span className="yoru-profile-panel-icon"><BookOpen size={18} /></span>
              <strong>{es ? 'Libros' : 'Books'}</strong>
              {listed.length > 0 && (
                <button type="button" className="yoru-chip-link" onClick={() => setTab('books')}>
                  {es ? 'Ver todos' : 'See all'}
                </button>
              )}
            </div>
            {/*
              Los mismos libros que la pestaña «Lista de libros», no solo los empezados:
              un perfil con un libro sin abrir decía aquí «estante vacío» y dos líneas
              más arriba «1 libro».
            */}
            {listed.length === 0 ? (
              <p className="yoru-profile-empty">{es ? 'Este estante está vacío.' : 'This shelf is empty.'}</p>
            ) : (
              <div className="yoru-grid is-covers">
                {listed.slice(0, 6).map((book) => (
                  <BookPoster key={book.id} book={book} onOpen={onOpenDetail} />
                ))}
              </div>
            )}
          </section>

          <section className="yoru-profile-panel">
            <div className="yoru-profile-panel-head">
              <span className="yoru-profile-panel-icon"><Headphones size={18} /></span>
              <strong>{es ? 'Audiolibros' : 'Audiobooks'}</strong>
              {audio.all.length > 0 && (
                <button type="button" className="yoru-chip-link" onClick={() => setTab('audio')}>
                  {es ? 'Ver todos' : 'See all'}
                </button>
              )}
            </div>
            {audio.all.length === 0 ? (
              <p className="yoru-profile-empty">{es ? 'Este estante está vacío.' : 'This shelf is empty.'}</p>
            ) : (
              <div className="yoru-grid is-covers">
                {audio.all.slice(0, 6).map((item) => (
                  <AudioPoster key={serverItemId(item)} item={item} es={es} onOpen={onOpenServerItem} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'books' && (
        <div>
          <div className="yoru-profile-count">{count(listed.length, es ? 'libro' : 'book', es ? 'libros' : 'books')}</div>
          <div className="yoru-chip-row">
            {bookFilters.map(([id, label, total]) => (
              <button
                key={id}
                type="button"
                className={`yoru-chip${bookFilter === id ? ' active' : ''}`}
                onClick={() => setBookFilter(id)}
              >
                {label}{total > 0 ? ` · ${total}` : ''}
              </button>
            ))}
          </div>
          {shownBooks.length === 0 ? (
            <EmptyState
              title={es ? 'Todavía no hay libros' : 'No books yet'}
              sub={es ? 'Este estante está vacío.' : 'This shelf is empty.'}
            />
          ) : (
            <div className="yoru-grid is-covers">
              {shownBooks.map((book) => (
                <BookPoster key={book.id} book={book} onOpen={onOpenDetail} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'audio' && (
        <div>
          <div className="yoru-profile-count">
            {count(audio.all.length, es ? 'audiolibro' : 'audiobook', es ? 'audiolibros' : 'audiobooks')}
          </div>
          <div className="yoru-chip-row">
            {audioFilters.map(([id, label, total]) => (
              <button
                key={id}
                type="button"
                className={`yoru-chip${audioFilter === id ? ' active' : ''}`}
                onClick={() => setAudioFilter(id)}
              >
                {label}{total > 0 ? ` · ${total}` : ''}
              </button>
            ))}
          </div>
          {shownAudio.length === 0 ? (
            <EmptyState
              title={es ? 'Nada por aquí todavía' : 'Nothing here yet'}
              sub={es
                ? 'Aparecerán los audiolibros que escuches o apartes en «Tu lista».'
                : 'Audiobooks you listen to or add to your list will show up here.'}
            />
          ) : (
            <div className="yoru-grid is-covers">
              {shownAudio.map((item) => (
                <AudioPoster key={serverItemId(item)} item={item} es={es} onOpen={onOpenServerItem} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Portada de un audiolibro del servidor, con lo que se lleva escuchado. */
function AudioPoster({ item, es, onOpen }: { item: ServerItem; es: boolean; onOpen: (item: ServerItem) => void }) {
  const percent = typeof item.percent === 'number' && item.percent > 0 ? Math.min(100, item.percent) : 0;
  return (
    <button type="button" className="yoru-poster is-audio" title={item.title} onClick={() => onOpen(item)}>
      <span className="yoru-poster-frame">
        <img src={item.cover} alt="" loading="lazy" />
        <span className="yoru-poster-play" aria-hidden="true"><Play size={18} /></span>
        {percent > 0 && (
          <span className="yoru-poster-progress" aria-hidden="true">
            <span style={{ width: `${percent}%` }} />
          </span>
        )}
      </span>
      <span className="yoru-poster-title">{item.title}</span>
      <span className="yoru-poster-meta">
        {percent > 0
          ? `${percent} % ${es ? 'escuchado' : 'listened'}`
          : item.author || (es ? 'Audiolibro' : 'Audiobook')}
      </span>
    </button>
  );
}
