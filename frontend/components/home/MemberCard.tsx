import React, { useEffect, useRef } from 'react';
import { User, X } from 'lucide-react';
import type { DiscordMember } from '../../utils/discordWidget';
import { estadoMiembro } from '../../utils/miembrosVivos';

/**
 * La tarjeta de un miembro, al pulsarlo en «Miembros».
 *
 * Enseña **solo lo que se sabe de verdad**, que de los demás es poquísimo: el widget
 * público de Discord da nombre, foto, estado y, si acaso, el nombre de lo que tienen
 * abierto. Nada de progreso de lectura ajeno, porque en Yoru el progreso es local y de
 * cada uno: inventarse la barra de avance de otra persona sería mentir con buena
 * presentación.
 *
 * De uno mismo sí hay más que contar, y ahí la tarjeta añade lo que Yoru tiene en
 * casa: el libro que está leyendo, con su portada y su avance de verdad.
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
  onCerrar,
  onVerPerfil,
}: {
  miembro: DiscordMember;
  es: boolean;
  /** Si este miembro es el propio usuario. */
  esTuyo: boolean;
  /** Lo que estás leyendo ahora. Solo se pasa para uno mismo. */
  lectura?: LecturaActual | null;
  onCerrar: () => void;
  onVerPerfil?: () => void;
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

          {/* Lo que Yoru sabe de ti, y solo de ti. */}
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

          {esTuyo && onVerPerfil && (
            <button type="button" className="yoru-btn yoru-member-card-boton" onClick={onVerPerfil}>
              {es ? 'Ver mi perfil' : 'View my profile'}
            </button>
          )}

          {!esTuyo && (
            <p className="yoru-member-card-nota">
              {es
                ? 'Esto es todo lo que Discord publica de los demás. Lo que lee cada uno se queda en su aparato.'
                : 'This is all Discord publishes about other people. What each person reads stays on their device.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
