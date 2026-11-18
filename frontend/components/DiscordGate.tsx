import React, { useCallback, useEffect, useState } from 'react';
import { LogIn, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react';
import {
  cerrarSesion,
  entrarConDiscord,
  invitacionServidor,
  nombreServidor,
} from '../utils/discordAuth';
import type { EstadoAcceso } from '../utils/discordAccess';

/**
 * La puerta: lo único que se ve si no eres miembro del servidor de Yoru.
 *
 * Una puerta cerrada es el peor sitio para ser escueto. Quien llega aquí no ha hecho
 * nada mal, así que cada caso dice qué ha pasado y qué se puede hacer: entrar, unirse
 * al servidor, probar con otra cuenta o esperar a tener red. Lo que no hay es un
 * callejón sin salida ni un «acceso denegado» a secas.
 *
 * El nombre del servidor se pide al widget público, que no necesita sesión. Si no se
 * puede saber (sin red, widget apagado), se dice «el servidor de Yoru» y la frase no
 * se queda a medias.
 */

export default function DiscordGate({
  estado,
  es,
  onEntrar,
}: {
  estado: EstadoAcceso;
  es: boolean;
  /** Se llama cuando ya hay sesión buena: App vuelve a decidir el acceso. */
  onEntrar: () => void;
}) {
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState('');
  const [servidor, setServidor] = useState('');
  const [invitacion, setInvitacion] = useState('');

  useEffect(() => {
    let vivo = true;
    void nombreServidor().then((nombre) => { if (vivo) setServidor(nombre); });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (estado !== 'no-es-miembro') return undefined;
    let vivo = true;
    void invitacionServidor().then((url) => { if (vivo) setInvitacion(url); });
    return () => { vivo = false; };
  }, [estado]);

  const entrar = useCallback(async () => {
    setCargando(true);
    setFallo('');
    try {
      await entrarConDiscord();
      onEntrar();
    } catch (error) {
      setFallo(String((error as Error)?.message || 'error'));
    } finally {
      setCargando(false);
    }
  }, [onEntrar]);

  const otraCuenta = useCallback(() => {
    cerrarSesion();
    setFallo('');
    void entrar();
  }, [entrar]);

  const nombre = servidor || (es ? 'el servidor de Yoru' : 'the Yoru server');

  const textoFallo = (codigo: string): string => {
    if (!codigo) return '';
    if (codigo === 'cancelado') {
      return es ? 'Se quedó a medias. Puedes volver a intentarlo.' : 'It was left halfway. You can try again.';
    }
    if (codigo === 'falta-client-id') {
      return es ? 'Falta configurar el Client ID de Discord.' : 'The Discord Client ID is not configured.';
    }
    if (codigo === 'sin-puente-electron') {
      return es
        ? 'Esta versión de la app no puede abrir el inicio de sesión. Hay que actualizarla.'
        : 'This build cannot open the sign-in flow. It needs updating.';
    }
    if (codigo === 'state-no-coincide') {
      return es
        ? 'La respuesta de Discord no cuadra con la petición, así que se descarta por seguridad. Inténtalo otra vez.'
        : 'Discord\'s answer did not match the request, so it was discarded for safety. Try again.';
    }
    if (/^token-(400|401|403)$/.test(codigo)) {
      return es
        ? 'Discord no aceptó el inicio de sesión. Si la aplicación se acaba de configurar, puede que falte registrar la dirección de vuelta en el portal de Discord.'
        : 'Discord did not accept the sign-in. If the application was just set up, the redirect address may still be missing in Discord\'s portal.';
    }
    if (/^token-5/.test(codigo) || codigo === 'tiempo') {
      return es ? 'Discord no contesta ahora mismo. Prueba en un rato.' : 'Discord is not answering right now. Try again in a while.';
    }
    return es
      ? 'No se pudo iniciar sesión con Discord. Inténtalo otra vez.'
      : 'Could not sign in with Discord. Try again.';
  };

  /* La app está mal configurada: no es cosa del lector, y se dice sin rodeos. */
  if (estado === 'falta-config') {
    return (
      <Marco icono={<ShieldAlert size={26} />} titulo={es ? 'Falta configurar Discord' : 'Discord is not configured'}>
        <p className="yoru-gate-text">
          {es
            ? 'Esta build no trae el Client ID de Discord, así que no se puede comprobar quién es miembro. No es cosa tuya: hay que compilarla con VITE_DISCORD_CLIENT_ID o con el valor por defecto en el código.'
            : 'This build has no Discord Client ID, so membership cannot be checked. Not your fault: it needs building with VITE_DISCORD_CLIENT_ID or with the default value in the code.'}
        </p>
      </Marco>
    );
  }

  /* Sin red y con la comprobación caducada: no se puede saber, y no se adivina. */
  if (estado === 'sin-conexion') {
    return (
      <Marco icono={<WifiOff size={26} />} titulo={es ? 'Hace falta conexión' : 'A connection is needed'}>
        <p className="yoru-gate-text">
          {es
            ? `Ha pasado más de una semana desde la última comprobación, así que hay que volver a preguntarle a Discord si sigues en ${nombre}. Conéctate un momento y abre Yoru otra vez.`
            : `More than a week has passed since the last check, so Discord has to be asked again whether you are still in ${nombre}. Get online for a moment and open Yoru again.`}
        </p>
        <button type="button" className="yoru-btn" onClick={() => window.location.reload()}>
          <RefreshCw size={16} />
          {es ? 'Volver a probar' : 'Try again'}
        </button>
      </Marco>
    );
  }

  /* Discord dijo que esta cuenta no está en el servidor. */
  if (estado === 'no-es-miembro') {
    return (
      <Marco icono={<ShieldAlert size={26} />} titulo={es ? 'Esta cuenta no está en el servidor' : 'This account is not in the server'}>
        <p className="yoru-gate-text">
          {es
            ? `Yoru es para los miembros de ${nombre}, y esta cuenta de Discord no está dentro. Puedes unirte y volver, o entrar con otra cuenta.`
            : `Yoru is for members of ${nombre}, and this Discord account is not in it. You can join and come back, or sign in with another account.`}
        </p>
        <div className="yoru-gate-acciones">
          {invitacion && (
            <a className="yoru-btn yoru-btn-primary" href={invitacion} target="_blank" rel="noopener noreferrer">
              {es ? 'Unirme al servidor' : 'Join the server'}
            </a>
          )}
          <button type="button" className="yoru-btn" onClick={otraCuenta} disabled={cargando}>
            {es ? 'Probar con otra cuenta' : 'Try another account'}
          </button>
        </div>
        {!invitacion && (
          <p className="yoru-gate-nota">
            {es
              ? 'Ahora mismo no hay invitación pública que ofrecerte; pídele el enlace a quien te habló de Yoru.'
              : 'There is no public invite to offer right now; ask whoever told you about Yoru for the link.'}
          </p>
        )}
        {fallo && <p className="yoru-profile-error" role="alert">{textoFallo(fallo)}</p>}
      </Marco>
    );
  }

  /* Nadie ha entrado todavía. */
  return (
    <Marco icono={<LogIn size={26} />} titulo={es ? 'Yoru es para los miembros' : 'Yoru is for members'}>
      <p className="yoru-gate-text">
        {es
          ? `Para leer con Yoru hay que estar en ${nombre}. Entra con Discord y se comprueba una vez; después no vuelve a molestarte.`
          : `To read with Yoru you need to be in ${nombre}. Sign in with Discord and it checks once; after that it stays out of your way.`}
      </p>
      <button type="button" className="yoru-btn yoru-btn-primary" onClick={() => void entrar()} disabled={cargando}>
        <LogIn size={16} />
        {cargando
          ? (es ? 'Esperando a Discord…' : 'Waiting for Discord…')
          : (es ? 'Entrar con Discord' : 'Sign in with Discord')}
      </button>
      {cargando && (
        <p className="yoru-gate-nota">
          {es
            ? 'Discord se ha abierto fuera de la app. Autoriza allí y vuelve aquí.'
            : 'Discord opened outside the app. Authorize there and come back here.'}
        </p>
      )}
      {fallo && <p className="yoru-profile-error" role="alert">{textoFallo(fallo)}</p>}
      <p className="yoru-gate-nota">
        {es
          ? 'Yoru solo pide saber quién eres y en qué servidores estás, para ver si estás en este. No lee tus mensajes, y no guarda la lista de tus servidores.'
          : 'Yoru only asks who you are and which servers you are in, to see whether this one is among them. It does not read your messages, and it does not store the list of your servers.'}
      </p>
    </Marco>
  );
}

function Marco({
  children,
  icono,
  titulo,
}: {
  children: React.ReactNode;
  icono: React.ReactNode;
  titulo: string;
}) {
  return (
    <div className="yoru-gate" role="main">
      <div className="yoru-gate-caja">
        <span className="yoru-gate-icono" aria-hidden="true">{icono}</span>
        <h1 className="yoru-gate-titulo">{titulo}</h1>
        {children}
      </div>
    </div>
  );
}
