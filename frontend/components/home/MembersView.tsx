import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, Users } from 'lucide-react';
import { EmptyState } from './primitives';
import {
  fetchDiscordWidget,
  YORU_DISCORD_GUILD_ID,
  type DiscordMember,
  type DiscordWidget,
  type DiscordWidgetError,
} from '../../utils/discordWidget';
import { leerSesion } from '../../utils/discordAuth';
import { estadoMiembro, mismaLista, RITMO_INICIAL, siguienteRitmo } from '../../utils/miembrosVivos';
import { continueReading, type ShelfBook } from './libraryIndex';
import MemberCard, { type LecturaActual } from './MemberCard';
import MemberProfileView from './MemberProfileView';
import { fichasDeMiembros, type FichaMiembro } from '../../utils/yoruSyncService';
import { fichaPara, lineaAhora } from '../../utils/miembrosFichas';
import { useBackHandler } from '../../hooks/useBackButton';

/**
 * Miembros: quién del servidor de Yoru está conectado ahora, y con qué.
 *
 * El servidor viene puesto (`YORU_DISCORD_GUILD_ID`): no hay nada que conectar ni
 * ningún ID que pegar, igual que Kavita y Audiobookshelf vienen puestos. Sale del
 * widget público (ver `discordWidget.ts`), así que no hace falta bot ni clave, y por
 * eso mismo solo salen los conectados: Discord no publica a los desconectados por esa
 * vía.
 *
 * Lo que lee cada uno no lo sabe Discord: lo sabe el servidor de sincronización de
 * Yoru, al que se pregunta aparte (`fichasDeMiembros`). Las dos respuestas se casan
 * por nombre (ver `miembrosFichas.ts`), y de ahí sale que la lista diga «Leyendo ·
 * título» de quien está leyendo ahora y que su tarjeta abra su perfil.
 */

/** Cada cuánto se vuelve a preguntar qué lee cada uno. La app sube cada cinco minutos. */
const REFRESCO_FICHAS_MS = 60_000;


const STATUS_ORDER = { online: 0, idle: 1, dnd: 2 } as const;

/**
 * Si un nombre del widget es el de la cuenta con la que se entró.
 *
 * Se compara por nombre porque el widget **no da el id real**: el suyo es un número de
 * orden (0, 1, 2…). No es infalible —dos personas podrían llamarse igual— y por eso lo
 * único que hay en juego es enseñarte de más sobre ti mismo, nunca datos de otro: el
 * bloque de lectura sale de lo que hay guardado en este aparato, que es tuyo.
 */
export function esLaMismaPersona(nombreWidget: string, nombreSesion: string): boolean {
  const a = (nombreWidget || '').trim().toLowerCase();
  const b = (nombreSesion || '').trim().toLowerCase();
  return a.length > 0 && a === b;
}

/** Lo que estás leyendo ahora, de «Continuar». Sin libro a medias, no hay bloque. */
export function lecturaActual(libros: ShelfBook[]): LecturaActual | null {
  const primero = continueReading(libros)[0];
  if (!primero) return null;
  return {
    titulo: primero.title,
    portada: primero.hideCover ? undefined : primero.cover,
    progreso: Number(primero.progress?.percent ?? 0),
  };
}

export default function MembersView({
  es,
  libros = [],
  onVerPerfil,
}: {
  es: boolean;
  /** La estantería, para contar qué estás leyendo tú. Lo de los demás viene del servidor. */
  libros?: ShelfBook[];
  onVerPerfil?: () => void;
}) {
  const [elegido, setElegido] = useState<DiscordMember | null>(null);
  /** Lo que el servidor de Yoru cuenta de cada miembro que ha sincronizado. */
  const [fichas, setFichas] = useState<FichaMiembro[]>([]);
  const [fichasListas, setFichasListas] = useState(false);
  /** El perfil de otro miembro, abierto encima de la lista. */
  const [perfilDe, setPerfilDe] = useState<{ miembro: DiscordMember; ficha: FichaMiembro } | null>(null);

  // El botón atrás de Android cierra primero lo que está encima: la tarjeta, y si no
  // el perfil. Sin esto se salía de Miembros entero con un perfil abierto.
  useBackHandler(Boolean(perfilDe), () => setPerfilDe(null));
  useBackHandler(Boolean(elegido), () => setElegido(null));

  /*
    Qué lee cada uno. Va aparte del sondeo de Discord porque es otro servidor (el PC
    de zams) y otro ritmo, y porque si no contesta no pasa nada: la lista sale igual,
    solo que sin lo que lee nadie. `fichasDeMiembros` devuelve vacío en vez de fallar.
  */
  useEffect(() => {
    let vivo = true;
    let enVuelo = false;
    const cargar = async () => {
      if (enVuelo || document.visibilityState === 'hidden') return;
      enVuelo = true;
      try {
        const lista = await fichasDeMiembros();
        if (!vivo) return;
        // Un refresco que vuelve vacío (el servidor no contesta) no borra lo que ya había.
        setFichas((previas) => (lista.length > 0 || previas.length === 0 ? lista : previas));
        setFichasListas(true);
      } finally {
        enVuelo = false;
      }
    };
    void cargar();
    const reloj = window.setInterval(() => { void cargar(); }, REFRESCO_FICHAS_MS);
    const alVolver = () => { if (document.visibilityState === 'visible') void cargar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      vivo = false;
      window.clearInterval(reloj);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, []);
  /** La sesión de Discord: tu nombre y tu foto, para reconocerte y pintarte. */
  const [miSesion] = useState(() => leerSesion());
  const miNombre = miSesion?.usuarioNombre || '';
  const esMiCuenta = (nombre: string) => esLaMismaPersona(nombre, miNombre);
  const miLectura = lecturaActual(libros);
  const [widget, setWidget] = useState<DiscordWidget | null>(null);
  const [error, setError] = useState<DiscordWidgetError | ''>('');
  const [loading, setLoading] = useState(false);

  const firstLoad = useRef(true);

  /*
    El sondeo. Tres cosas que no se ven pero se notan:

    - **No se solapa.** Si una petición sigue en el aire, la siguiente no sale.
    - **Se calla cuando no miras.** Con la ventana oculta no se pregunta, y al volver
      se pregunta al instante, igual que al recuperar la red: el momento en que alguien
      vuelve a la pantalla es justo cuando quiere verla al día.
    - **Nunca se vacía.** Mientras llega la respuesta nueva se queda la de antes, así
      que la lista no parpadea ni se queda en blanco por un corte de red.
  */
  useEffect(() => {
    let alive = true;
    let enVuelo = false;
    let reloj = 0;
    let ritmo = RITMO_INICIAL;
    const controller = new AbortController();

    const programar = (ms: number) => {
      window.clearTimeout(reloj);
      reloj = window.setTimeout(() => { void load(); }, ms);
    };

    const load = async () => {
      if (!alive || enVuelo) return;
      if (document.visibilityState === 'hidden') return; // Al volver se reprograma.
      enVuelo = true;
      // El indicador, solo en la primera carga: después hay lista que enseñar, y un
      // spinner encima de datos buenos es ruido.
      if (firstLoad.current) setLoading(true);
      try {
        const data = await fetchDiscordWidget(YORU_DISCORD_GUILD_ID, controller.signal);
        if (!alive) return;
        setError('');
        // Si Discord devuelve lo mismo de siempre, no se toca el estado: sin repintado
        // no hay parpadeo, y la tarjeta que alguien tenga abierta sigue abierta.
        setWidget((previo) => (previo
          && previo.name === data.name
          && previo.invite === data.invite
          && mismaLista(previo.members, data.members)
          ? previo
          : data));
        ritmo = siguienteRitmo(ritmo, { ok: true });
      } catch (reason: any) {
        if (!alive || reason?.name === 'AbortError') return;
        const codigo = (reason?.message as DiscordWidgetError) || 'network';
        setError(codigo);
        // Si ya había lista y falla un refresco, se queda la que había: un corte de
        // red de un minuto no tiene por qué vaciar la pantalla.
        if (firstLoad.current) setWidget(null);
        ritmo = siguienteRitmo(ritmo, {
          ok: false,
          limitado: codigo === 'rate-limit',
          retryAfterSegundos: reason?.retryAfterSegundos,
        });
      } finally {
        enVuelo = false;
        if (alive) {
          setLoading(false);
          firstLoad.current = false;
          programar(ritmo.esperaMs);
        }
      }
    };

    const alVolver = () => {
      if (document.visibilityState === 'visible') { ritmo = RITMO_INICIAL; void load(); }
    };

    firstLoad.current = true;
    void load();
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', alVolver);
    window.addEventListener('online', alVolver);

    return () => {
      alive = false;
      controller.abort();
      window.clearTimeout(reloj);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('focus', alVolver);
      window.removeEventListener('online', alVolver);
    };
  }, []);

  const errorText = (code: DiscordWidgetError | ''): string => {
    if (code === 'bad-id') return es ? 'El servidor de Yoru está mal puesto en la app. No es cosa tuya; habría que corregirlo.' : 'Yoru\'s server is misconfigured in the app. Not your fault; it needs fixing.';
    if (code === 'widget-off') return es ? 'El servidor de Yoru tiene el widget apagado, así que Discord no publica quién está conectado.' : 'Yoru\'s server has its widget turned off, so Discord does not publish who is online.';
    if (code === 'not-found') return es ? 'Discord no encuentra el servidor de Yoru.' : 'Discord cannot find Yoru\'s server.';
    if (code === 'rate-limit') return es ? 'Discord pide esperar un momento antes de volver a preguntar.' : 'Discord asks to wait a moment before asking again.';
    if (code === 'network') return es ? 'No se pudo hablar con Discord. Revisa la conexión.' : 'Could not reach Discord. Check your connection.';
    return '';
  };

  /*
    La lista es la de Discord, y solo la de Discord.

    Hubo un momento en que la app se añadía a sí misma para que no saliera «En línea ·
    0». Se quitó a propósito: estando apagado en Discord, Yoru decía que estabas
    encendido, y una pantalla que contradice a Discord sobre tu propio estado no ayuda,
    confunde. Aquí se enseña lo que Discord publica, de ti igual que de los demás, o no
    se enseña nada.
  */
  // De uno mismo no se enseña la ficha del servidor: lo de este aparato va por delante.
  const fichaDe = (member: DiscordMember) => (esMiCuenta(member.name) ? null : fichaPara(member.name, fichas));
  const members = (widget ? widget.members : [])
    .slice()
    .sort((a, b) =>
      // Quien está leyendo o escuchando ahora, arriba: es lo que se viene a mirar.
      Number(Boolean(lineaAhora(fichaDe(b), es))) - Number(Boolean(lineaAhora(fichaDe(a), es)))
      || Number(Boolean(b.activity)) - Number(Boolean(a.activity))
      || STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
      || a.name.localeCompare(b.name));

  if (perfilDe) {
    return (
      <MemberProfileView
        // El miembro al día, si sigue conectado: su punto de estado cambia mientras miras.
        miembro={members.find((member) => member.name === perfilDe.miembro.name) || perfilDe.miembro}
        fichaInicial={perfilDe.ficha}
        es={es}
        onVolver={() => setPerfilDe(null)}
      />
    );
  }

  return (
    <div className="yoru-members">
      <div className="yoru-view-head">
        <div>
          <h1 className="yoru-view-title">{es ? 'Miembros' : 'Members'}</h1>
          <div className="yoru-view-sub">
            {widget?.name
              ? `${widget.name} · Discord`
              : (es ? 'La comunidad de Yoru, desde la app.' : 'The Yoru community, from the app.')}
          </div>
        </div>
        <div className="yoru-detail-actions" style={{ marginBottom: 0 }}>
          {widget?.invite && (
            <a className="yoru-btn" href={widget.invite} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={15} />
              {es ? 'Abrir en Discord' : 'Open in Discord'}
            </a>
          )}
          {/*
            Aquí estaba el botón de actualizar. Se quita porque ya no hay nada que
            pedirle a nadie: la lista se refresca sola mientras esta pantalla está
            delante y en cuanto se vuelve a la ventana. Un botón que hace lo que ya
            pasa solo únicamente siembra la duda de si hacía falta pulsarlo.
          */}
        </div>
      </div>

      {error && (
        <div className="yoru-members-connect">
          <p className="yoru-profile-error" role="alert" style={{ margin: 0 }}>{errorText(error)}</p>
        </div>
      )}

      {!widget && loading && (
        <div className="app-section-loading" role="status" aria-live="polite">
          <span className="app-section-loading-indicator" />
          {es ? 'Preguntando a Discord…' : 'Asking Discord…'}
        </div>
      )}

      {widget && (
        <>
          <div className="yoru-members-group-title">
            {/* El contador cuenta lo que hay en la lista, contigo incluido. */}
            {es ? 'En línea' : 'Online'} · {members.length}
          </div>
          {members.length === 0 ? (
            <EmptyState
              title={es ? 'Nadie conectado ahora mismo' : 'Nobody online right now'}
              sub={es
                ? 'Cuando alguien del servidor se conecte, saldrá aquí. Los bots no cuentan.'
                : 'When someone from the server comes online, they will show up here. Bots do not count.'}
            />
          ) : (
            <ul className="yoru-members-list">
              {members.map((member) => (
                <li key={member.id || member.name}>
                  {/* Un botón y no un div con onClick: así el teclado y los lectores
                      de pantalla lo encuentran solos, sin tener que apañarlo. */}
                  <button
                    type="button"
                    className="yoru-member is-pulsable"
                    onClick={() => setElegido(member)}
                    aria-haspopup="dialog"
                  >
                    <span className="yoru-member-avatar">
                      {member.avatar
                        ? <img src={member.avatar} alt="" loading="lazy" />
                        : <span><Users size={18} /></span>}
                      <i className={`yoru-member-dot ${estadoMiembro(member.status, es).clase}`} title={estadoMiembro(member.status, es).etiqueta} />
                    </span>
                    <span className="yoru-member-text">
                      <span className="yoru-member-name">{member.name}</span>
                      <span className={`yoru-member-activity${lineaAhora(fichaDe(member), es) ? ' is-ahora' : ''}`}>
                        {lineaAhora(fichaDe(member), es) || member.activity || estadoMiembro(member.status, es).etiqueta}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {elegido && (
        <MemberCard
          miembro={elegido}
          es={es}
          esTuyo={esMiCuenta(elegido.name)}
          lectura={esMiCuenta(elegido.name) ? miLectura : null}
          ficha={fichaDe(elegido)}
          cargandoFicha={!fichasListas}
          onVerPerfilDe={(ficha) => { setPerfilDe({ miembro: elegido, ficha }); setElegido(null); }}
          onCerrar={() => setElegido(null)}
          onVerPerfil={onVerPerfil ? () => { setElegido(null); onVerPerfil(); } : undefined}
        />
      )}
    </div>
  );
}
