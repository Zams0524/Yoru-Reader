import React, { useEffect, useRef } from 'react';
import { BookOpen, Headphones, User, X } from 'lucide-react';
import type { DiscordMember } from '../../utils/discordWidget';
import { estadoMiembro } from '../../utils/miembrosVivos';
import { actividades, rotuloActividad, type ActividadMiembro } from '../../utils/miembrosFichas';
import type { FichaMiembro } from '../../utils/yoruSyncService';
import { portadaDeAudiolibro, portadaDeLibro } from './memberCovers';
import MemberCoverImage from './MemberCoverImage';

/**
 * La tarjeta de un miembro, al pulsarlo en «Miembros».
 *
 * Junta dos fuentes. De Discord (el widget público) salen el nombre, la foto, el
 * estado y, si acaso, el nombre de lo que tiene abierto. De Yoru (el servidor de
 * sincronización) sale lo que lee y lo que escucha, con su avance de verdad, y si lo
 * está haciendo ahora mismo. Lo segundo solo existe para quien ha sincronizado y no
 * ha apagado «Enseñar a los miembros lo que lees».
 *
 * De uno mismo no se pregunta a nadie: lo que estás leyendo sale de este aparato, que
 * va por delante de lo que haya llegado al servidor.
 */

export interface LecturaActual {
  titulo: string;
  portada?: string;
  /** Porcentaje 0–100. */
  progreso: number;
}

export default function MemberCard({
  miembro,
  es,
  esTuyo,
  lectura,
  ficha,
  cargandoFicha = false,
  onCerrar,
  onVerPerfil,
  onVerPerfilDe,
}: {
  miembro: DiscordMember;
  es: boolean;
  /** Si este miembro es el propio usuario. */
  esTuyo: boolean;
  /** Lo que estás leyendo ahora. Solo se pasa para uno mismo. */
  lectura?: LecturaActual | null;
  /** Lo que Yoru sabe de este miembro, si ha sincronizado. */
  ficha?: FichaMiembro | null;
  /** Mientras se pregunta por primera vez: para no decir «no hay nada» antes de saberlo. */
  cargandoFicha?: boolean;
  onCerrar: () => void;
  onVerPerfil?: () => void;
  /** Abre el perfil de otro miembro. */
  onVerPerfilDe?: (ficha: FichaMiembro) => void;
}) {
  const cerrarRef = useRef<HTMLButtonElement | null>(null);

  // El foco entra en la tarjeta al abrirse: quien navega con teclado no se queda
  // pulsando tabulador a ciegas por detrás del diálogo.
  useEffect(() => { cerrarRef.current?.focus(); }, []);

  useEffect(() => {
    const alPulsarTecla = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') { evento.stopPropagation(); onCerrar(); }
    };
    document.addEventListener('keydown', alPulsarTecla);
    return () => document.removeEventListener('keydown', alPulsarTecla);
  }, [onCerrar]);

  // La misma función que usa la fila de la lista, para que el punto no pueda salir de
  // un color aquí y de otro allí.
  const estado = estadoMiembro(miembro.status, es);
  const suyas = esTuyo ? [] : actividades(ficha);
  const ahora = Date.now();

  return (
    <div
      className="yoru-member-card-fondo"
      role="presentation"
      onClick={(evento) => { if (evento.target === evento.currentTarget) onCerrar(); }}
    >
      <div
        className="yoru-member-card"
        role="dialog"
        aria-modal="true"
        aria-label={es ? `Perfil de ${miembro.name}` : `${miembro.name}'s profile`}
      >
        <button
          type="button"
          className="yoru-member-card-cerrar"
          onClick={onCerrar}
          ref={cerrarRef}
          aria-label={es ? 'Cerrar' : 'Close'}
        >
          <X size={16} />
        </button>

        {/*
          La franja de arriba, como en la referencia. Es color, no un dato: el widget
          no da la portada de nadie, y poner una falsa sería adornar con mentira.
        */}
        <div className="yoru-member-card-franja" aria-hidden="true" />

        <div className="yoru-member-card-cuerpo">
          <span className="yoru-member-card-avatar">
            {miembro.avatar
              ? <img src={miembro.avatar} alt="" />
              : <span><User size={30} /></span>}
            <i className={`yoru-member-dot ${estado.clase}`} title={estado.etiqueta} />
          </span>

          <h2 className="yoru-member-card-nombre">{miembro.name}</h2>
          <p className="yoru-member-card-estado">{estado.etiqueta}</p>

          {/* Solo si Discord publica algo. Sin actividad, no hay bloque. */}
          {miembro.activity && (
            <div className="yoru-member-card-bloque">
              <span className="yoru-member-card-titulo-bloque">
                {es ? 'Ahora mismo' : 'Right now'}
              </span>
              <p className="yoru-member-card-actividad">{miembro.activity}</p>
            </div>
          )}

          {/* Lo que Yoru sabe de ti sale de este aparato. */}
          {esTuyo && lectura && (
            <div className="yoru-member-card-bloque">
              <span className="yoru-member-card-titulo-bloque">
                {es ? 'Leyendo' : 'Reading'}
              </span>
              <div className="yoru-member-card-lectura">
                {lectura.portada
                  ? <img className="yoru-member-card-portada" src={lectura.portada} alt="" />
                  : <span className="yoru-member-card-portada is-vacia" aria-hidden="true" />}
                <div className="yoru-member-card-lectura-texto">
                  <span className="yoru-member-card-libro">{lectura.titulo}</span>
                  <span className="yoru-member-card-barra" aria-hidden="true">
                    <i style={{ width: `${Math.max(0, Math.min(100, lectura.progreso))}%` }} />
                  </span>
                  <span className="yoru-member-card-porcentaje">{Math.round(lectura.progreso)}%</span>
                </div>
              </div>
            </div>
          )}

          {/* Lo que Yoru sabe de los demás: lo que subieron al sincronizar. */}
          {suyas.map((actividad) => (
            <BloqueActividad key={actividad.tipo} actividad={actividad} ahora={ahora} es={es} />
          ))}

          {esTuyo && onVerPerfil && (
            <button type="button" className="yoru-btn yoru-member-card-boton" onClick={onVerPerfil}>
              {es ? 'Ver mi perfil' : 'View my profile'}
            </button>
          )}

          {!esTuyo && ficha?.comparte && onVerPerfilDe && (
            <button type="button" className="yoru-btn yoru-member-card-boton" onClick={() => onVerPerfilDe(ficha)}>
              {es ? 'Ver perfil' : 'View profile'}
            </button>
          )}

          {!esTuyo && !cargandoFicha && ficha && !ficha.comparte && (
            <p className="yoru-member-card-nota">
              {es ? 'Prefiere no enseñar lo que lee.' : 'Prefers not to share what they read.'}
            </p>
          )}

          {!esTuyo && !cargandoFicha && !ficha && (
            <p className="yoru-member-card-nota">
              {es ? 'Todavía no ha sincronizado su lectura con Yoru.' : 'Has not synced their reading with Yoru yet.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Un libro o un audiolibro del otro miembro: rótulo, portada, título y avance. */
function BloqueActividad({ actividad, ahora, es }: { actividad: ActividadMiembro; ahora: number; es: boolean }) {
  const portada = actividad.libro
    ? portadaDeLibro(actividad.libro)
    : actividad.audio ? portadaDeAudiolibro(actividad.audio) : '';
  const Icono = actividad.tipo === 'leyendo' ? BookOpen : Headphones;
  const titulo = actividad.titulo
    || (actividad.tipo === 'leyendo' ? (es ? 'Un libro' : 'A book') : (es ? 'Un audiolibro' : 'An audiobook'));
  return (
    <div className={`yoru-member-card-bloque${actividad.ahora ? ' is-ahora' : ''}`}>
      <span className="yoru-member-card-titulo-bloque">
        <Icono size={12} aria-hidden="true" />
        {rotuloActividad(actividad, ahora, es)}
      </span>
      <div className="yoru-member-card-lectura">
        <MemberCoverImage
          src={portada}
          className="yoru-member-card-portada"
          fallback={<span className="yoru-member-card-portada is-vacia" aria-hidden="true" />}
        />
        <div className="yoru-member-card-lectura-texto">
          <span className="yoru-member-card-libro">{titulo}</span>
          {actividad.detalle && <span className="yoru-member-card-detalle">{actividad.detalle}</span>}
          <span className="yoru-member-card-barra" aria-hidden="true">
            <i style={{ width: `${Math.max(0, Math.min(100, actividad.porcentaje))}%` }} />
          </span>
          <span className="yoru-member-card-porcentaje">{Math.round(actividad.porcentaje)}%</span>
        </div>
      </div>
    </div>
  );
}
