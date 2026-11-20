import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Headphones, User } from 'lucide-react';
import { EmptyState } from './primitives';
import type { DiscordMember } from '../../utils/discordWidget';
import { estadoMiembro } from '../../utils/miembrosVivos';
import { actividades, haceCuanto, rotuloActividad } from '../../utils/miembrosFichas';
import {
  fichaDeMiembro,
  type AudiolibroMiembro,
  type FichaMiembro,
  type LibroMiembro,
} from '../../utils/yoruSyncService';
import { getCachedServerCatalog, serverItemId } from '../../utils/serverCatalog';
import { portadaDeAudiolibro, portadaDeLibro } from './memberCovers';
import MemberCoverImage from './MemberCoverImage';

/**
 * El perfil de otro miembro, con la misma forma que el propio (`ProfileView`):
 * cabecera, y debajo sus dos listas, la de libros y la de audiolibros.
 *
 * Es de solo mirar. No hay botones de editar ni portada que cambiar, y las portadas
 * no abren nada: son los libros de otra persona, y lo que tú hagas con los tuyos se
 * hace desde tu Biblioteca.
 *
 * Sale de lo que esa persona subió al sincronizar, así que va con el retraso de su
 * última subida (unos minutos si está leyendo ahora). Mientras la pantalla está
 * delante se vuelve a preguntar cada minuto.
 */

type Pestana = 'resumen' | 'libros' | 'audio';
type FiltroLibros = 'todos' | LibroMiembro['estado'];

const REFRESCO_MS = 60_000;

export default function MemberProfileView({
  miembro,
  fichaInicial,
  es,
  onVolver,
}: {
  miembro: DiscordMember;
  /** La ficha corta que ya tenía la lista, para pintar algo mientras llega la larga. */
  fichaInicial: FichaMiembro;
  es: boolean;
  onVolver: () => void;
}) {
  const [ficha, setFicha] = useState<FichaMiembro>(fichaInicial);
  const [cargando, setCargando] = useState(true);
  const [pestana, setPestana] = useState<Pestana>('resumen');
  const [filtro, setFiltro] = useState<FiltroLibros>('todos');

  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      if (document.visibilityState === 'hidden') return;
      const nueva = await fichaDeMiembro(fichaInicial.usuarioId);
      if (!vivo) return;
      // Si falla un refresco se queda lo que había: un corte de red no vacía un perfil.
      if (nueva) setFicha(nueva);
      setCargando(false);
    };
    void cargar();
    const reloj = window.setInterval(() => { void cargar(); }, REFRESCO_MS);
    return () => { vivo = false; window.clearInterval(reloj); };
  }, [fichaInicial.usuarioId]);

  const libros = ficha.perfil?.libros || [];
  /** Un audiolibro escuchado antes de que la app apuntara su título lo saca del catálogo. */
  const audiolibros = useMemo(() => {
    const lista = ficha.perfil?.audiolibros || [];
    if (lista.every((item) => item.titulo)) return lista;
    const porId = new Map(getCachedServerCatalog().audiobooks.map((item) => [serverItemId(item), item]));
    return lista.map((item) => {
      if (item.titulo) return item;
      const conocido = porId.get(item.itemId);
      return conocido ? { ...item, titulo: conocido.title, autor: item.autor || conocido.author || '' } : item;
    });
  }, [ficha.perfil]);

  const estado = estadoMiembro(miembro.status, es);
  const ahora = Date.now();
  const enCurso = actividades(ficha).find((actividad) => actividad.ahora);
  const contar = (valor: number, singular: string, plural: string) => `${valor} ${valor === 1 ? singular : plural}`;

  const filtros: [FiltroLibros, string, number][] = [
    ['todos', es ? 'Todos' : 'All', libros.length],
    ['leyendo', es ? 'Leyendo' : 'Reading', libros.filter((libro) => libro.estado === 'leyendo').length],
    ['completado', es ? 'Completados' : 'Completed', libros.filter((libro) => libro.estado === 'completado').length],
    ['pendiente', es ? 'Pendientes' : 'Backlog', libros.filter((libro) => libro.estado === 'pendiente').length],
    ['por-empezar', es ? 'Por empezar' : 'Want to read', libros.filter((libro) => libro.estado === 'por-empezar').length],
  ];
  const mostrados = filtro === 'todos' ? libros : libros.filter((libro) => libro.estado === filtro);

  return (
    <div className="yoru-profile yoru-member-profile">
      <button type="button" className="yoru-btn yoru-member-profile-volver" onClick={onVolver}>
        <ArrowLeft size={15} />
        {es ? 'Miembros' : 'Members'}
      </button>

      <div className="yoru-profile-banner" />

      <div className="yoru-profile-head">
        <span className="yoru-profile-avatar">
          {miembro.avatar
            ? <img src={miembro.avatar} alt="" />
            : <span><User size={34} /></span>}
        </span>
        <div className="yoru-profile-id">
          <h1 className="yoru-profile-name">{miembro.name}</h1>
          <div className="yoru-profile-sub">
            {contar(libros.length, es ? 'libro' : 'book', es ? 'libros' : 'books')}
            {audiolibros.length > 0 && ` · ${contar(audiolibros.length, es ? 'audiolibro' : 'audiobook', es ? 'audiolibros' : 'audiobooks')}`}
          </div>
          <div className={`yoru-member-profile-ahora${enCurso ? ' is-ahora' : ''}`}>
            {enCurso
              ? `${rotuloActividad(enCurso, ahora, es)} · ${enCurso.titulo}`
              : ficha.actualizadoEn
                ? `${es ? 'Última sincronización' : 'Last synced'} ${haceCuanto(ficha.actualizadoEn, ahora, es)}`
                : estado.etiqueta}
            {enCurso ? '' : ficha.actualizadoEn ? ` · ${estado.etiqueta}` : ''}
          </div>
        </div>
      </div>

      {!ficha.comparte ? (
        <EmptyState
          title={es ? 'Prefiere no enseñar lo que lee' : 'Prefers not to share what they read'}
        />
      ) : (
        <>
          <div className="yoru-tabs" role="tablist">
            {([
              ['resumen', es ? 'Resumen' : 'Overview'],
              ['libros', es ? 'Lista de libros' : 'Book list'],
              ['audio', es ? 'Lista de audiolibros' : 'Audiobook list'],
            ] as [Pestana, string][]).map(([id, etiqueta]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={pestana === id}
                className={`yoru-tab${pestana === id ? ' active' : ''}`}
                onClick={() => setPestana(id)}
              >
                {etiqueta}
              </button>
            ))}
          </div>

          {cargando && !ficha.perfil && (
            <div className="app-section-loading" role="status" aria-live="polite">
              <span className="app-section-loading-indicator" />
              {es ? 'Cargando su perfil…' : 'Loading their profile…'}
            </div>
          )}

          {pestana === 'resumen' && ficha.perfil && (
            <div className="yoru-profile-overview">
              <section className="yoru-profile-panel">
                <div className="yoru-profile-panel-head">
                  <span className="yoru-profile-panel-icon"><BookOpen size={18} /></span>
                  <strong>{es ? 'Libros' : 'Books'}</strong>
                  {libros.length > 0 && (
                    <button type="button" className="yoru-chip-link" onClick={() => setPestana('libros')}>
                      {es ? 'Ver todos' : 'See all'}
                    </button>
                  )}
                </div>
                {libros.length === 0 ? (
                  <p className="yoru-profile-empty">{es ? 'Este estante está vacío.' : 'This shelf is empty.'}</p>
                ) : (
                  <div className="yoru-grid is-covers">
                    {libros.slice(0, 6).map((libro, indice) => (
                      <PortadaLibro key={`${libro.origen}-${libro.titulo}-${indice}`} libro={libro} es={es} />
                    ))}
                  </div>
                )}
              </section>

              <section className="yoru-profile-panel">
                <div className="yoru-profile-panel-head">
                  <span className="yoru-profile-panel-icon"><Headphones size={18} /></span>
                  <strong>{es ? 'Audiolibros' : 'Audiobooks'}</strong>
                  {audiolibros.length > 0 && (
                    <button type="button" className="yoru-chip-link" onClick={() => setPestana('audio')}>
                      {es ? 'Ver todos' : 'See all'}
                    </button>
                  )}
                </div>
                {audiolibros.length === 0 ? (
                  <p className="yoru-profile-empty">{es ? 'Este estante está vacío.' : 'This shelf is empty.'}</p>
                ) : (
                  <div className="yoru-grid is-covers">
                    {audiolibros.slice(0, 6).map((audio) => (
                      <PortadaAudio key={audio.itemId} audio={audio} es={es} />
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {pestana === 'libros' && ficha.perfil && (
            <div>
              <div className="yoru-profile-count">{contar(libros.length, es ? 'libro' : 'book', es ? 'libros' : 'books')}</div>
              <div className="yoru-chip-row">
                {filtros.map(([id, etiqueta, total]) => (
                  <button
                    key={id}
                    type="button"
                    className={`yoru-chip${filtro === id ? ' active' : ''}`}
                    onClick={() => setFiltro(id)}
                  >
                    {etiqueta}{total > 0 ? ` · ${total}` : ''}
                  </button>
                ))}
              </div>
              {mostrados.length === 0 ? (
                <EmptyState
                  title={es ? 'Todavía no hay libros' : 'No books yet'}
                  sub={es ? 'Este estante está vacío.' : 'This shelf is empty.'}
                />
              ) : (
                <div className="yoru-grid is-covers">
                  {mostrados.map((libro, indice) => (
                    <PortadaLibro key={`${libro.origen}-${libro.titulo}-${indice}`} libro={libro} es={es} />
                  ))}
                </div>
              )}
            </div>
          )}

          {pestana === 'audio' && ficha.perfil && (
            <div>
              <div className="yoru-profile-count">
                {contar(audiolibros.length, es ? 'audiolibro' : 'audiobook', es ? 'audiolibros' : 'audiobooks')}
              </div>
              {audiolibros.length === 0 ? (
                <EmptyState
                  title={es ? 'Nada por aquí todavía' : 'Nothing here yet'}
                  sub={es ? 'Aparecerán los audiolibros que escuche.' : 'The audiobooks they listen to will show up here.'}
                />
              ) : (
                <div className="yoru-grid is-covers">
                  {audiolibros.map((audio) => (
                    <PortadaAudio key={audio.itemId} audio={audio} es={es} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** La portada de un libro de otro, con su avance. No abre nada: no es tuyo. */
function PortadaLibro({ libro, es }: { libro: LibroMiembro; es: boolean }) {
  const portada = portadaDeLibro(libro);
  const avance = Math.min(100, Math.max(0, Math.round(libro.porcentaje || 0)));
  return (
    <div className="yoru-poster is-estatico" title={libro.titulo}>
      <span className="yoru-poster-frame">
        <MemberCoverImage src={portada} fallback={<span className="yoru-poster-fallback">{libro.titulo}</span>} />
        {avance > 0 && (
          <span className="yoru-poster-progress" aria-hidden="true">
            <span style={{ width: `${avance}%` }} />
          </span>
        )}
      </span>
      <span className="yoru-poster-title">{libro.titulo}</span>
      <span className="yoru-poster-meta">
        {libro.estado === 'completado' || avance >= 99
          ? (es ? 'Terminado' : 'Finished')
          : libro.estado === 'por-empezar' && avance < 1 ? (es ? 'Por empezar' : 'Not started')
            : avance < 1 ? (es ? 'Recién empezado' : 'Just started')
              : `${avance} % ${es ? 'leído' : 'read'}`}
      </span>
    </div>
  );
}

function PortadaAudio({ audio, es }: { audio: AudiolibroMiembro; es: boolean }) {
  const portada = portadaDeAudiolibro(audio);
  const avance = Math.min(100, Math.max(0, Math.round(audio.porcentaje || 0)));
  const titulo = audio.titulo || (es ? 'Audiolibro' : 'Audiobook');
  return (
    <div className="yoru-poster is-audio is-estatico" title={titulo}>
      <span className="yoru-poster-frame">
        <MemberCoverImage src={portada} fallback={<span className="yoru-poster-fallback">{titulo}</span>} />
        {avance > 0 && (
          <span className="yoru-poster-progress" aria-hidden="true">
            <span style={{ width: `${avance}%` }} />
          </span>
        )}
      </span>
      <span className="yoru-poster-title">{titulo}</span>
      <span className="yoru-poster-meta">
        {avance > 0
          ? `${avance} % ${es ? 'escuchado' : 'listened'}`
          : audio.autor || (es ? 'Audiolibro' : 'Audiobook')}
      </span>
    </div>
  );
}
