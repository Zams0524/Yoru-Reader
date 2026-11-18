import React, { useEffect, useRef, useState } from 'react';
import { Check, LogOut, User } from 'lucide-react';
import { resizeToJpeg } from '../../utils/profileImage';
import { cerrarSesion, leerSesion } from '../../utils/discordAuth';

/**
 * El perfil, dentro de Ajustes.
 *
 * Hasta ahora el nombre y la foto solo se cambiaban desde un modal colgado del menú
 * del avatar: quien entraba en Ajustes a cambiar su perfil no lo encontraba, porque
 * no estaba. Y es lo primero que se busca en una pantalla de ajustes.
 *
 * Lo que hay aquí es lo que Yoru tiene de verdad: perfiles locales, con su nombre y
 * su foto. No hay cuentas, ni correo, ni sesión que cerrar, así que no se pintan
 * campos de eso — un formulario con un correo que no va a ninguna parte es peor que
 * no tenerlo.
 */

export interface YoruProfile {
  id: string;
  name: string;
  /** Una imagen (`data:` o ruta) o un degradado CSS, que es el hueco por defecto. */
  avatar: string;
  avatarEmoji?: string;
  /** La imagen de portada de la página de perfil (`data:`), si ha puesto una. */
  banner?: string;
}

export default function ProfileSettings({
  es,
  profile,
  profileCount,
  onSave,
  /** Convierte el fichero elegido en una imagen pequeña lista para guardar. */
  onPickImage,
}: {
  es: boolean;
  profile: YoruProfile | undefined;
  profileCount: number;
  onSave: (changes: { name: string; avatar: string; avatarEmoji: string; banner: string }) => void;
  onPickImage: (file: File) => Promise<string>;
}) {
  const [name, setName] = useState(profile?.name || '');
  const [avatar, setAvatar] = useState(profile?.avatar || '');
  const [banner, setBanner] = useState(profile?.banner || '');
  const [bannerError, setBannerError] = useState('');
  const [saved, setSaved] = useState(false);
  /** Se lee una vez al montar: la sesión no cambia mientras esta pantalla está abierta. */
  const [sesionDiscord] = useState(() => leerSesion());
  const fileRef = useRef<HTMLInputElement | null>(null);
  const bannerRef = useRef<HTMLInputElement | null>(null);

  // Al cambiar de perfil activo, el formulario pasa a hablar del nuevo.
  useEffect(() => {
    setName(profile?.name || '');
    setAvatar(profile?.avatar || '');
    setBanner(profile?.banner || '');
    setBannerError('');
    setSaved(false);
  }, [profile?.id, profile?.name, profile?.avatar, profile?.banner]);

  if (!profile) {
    return (
      <p className="settings-row-desc">
        {es ? 'No hay ningún perfil activo.' : 'There is no active profile.'}
      </p>
    );
  }

  const esImagen = avatar.startsWith('data:') || avatar.startsWith('/') || avatar.startsWith('http');
  const limpio = name.trim();
  const cambiado = limpio !== profile.name || avatar !== profile.avatar || banner !== (profile.banner || '');

  const guardar = () => {
    if (!limpio || !cambiado) return;
    // El emoji se vacía cuando hay foto: si no, se pintarían los dos encima.
    onSave({ name: limpio, avatar, avatarEmoji: esImagen ? '' : (profile.avatarEmoji || ''), banner });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  };

  const elegirFoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setAvatar(await onPickImage(file));
    } finally {
      // Se limpia para que elegir dos veces el mismo fichero vuelva a avisar.
      event.target.value = '';
    }
  };

  const elegirPortada = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBannerError('');
    try {
      setBanner(await resizeToJpeg(file));
    } catch {
      setBannerError(es ? 'No se pudo usar esa imagen.' : 'That image could not be used.');
    }
  };

  return (
    <div className="settings-rows">
      {/*
        El nombre y la foto ya no se editan aquí: vienen de Discord y se ponen al día
        solos en cada comprobación. Editarlos a mano habría durado hasta el siguiente
        arranque, que es la peor clase de ajuste: el que parece que funciona.
      */}
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-label">{es ? 'Nombre y foto' : 'Name and photo'}</span>
          <span className="settings-row-desc">
            {es
              ? 'Los pone tu cuenta de Discord. Si los cambias allí, aquí cambian solos.'
              : 'They come from your Discord account. Change them there and they change here.'}
          </span>
        </div>
        <div className="settings-row-control settings-profile-photo">
          <span className="settings-profile-avatar">
            {esImagen
              ? <img src={avatar} alt="" />
              : (
                <span style={avatar ? { background: avatar } : undefined}>
                  {profile.avatarEmoji || <User size={22} />}
                </span>
              )}
          </span>
          <span className="settings-label-text">{profile.name}</span>
        </div>
      </div>

      {/*
        La portada es la franja de arriba de la página de perfil. Se guarda reducida:
        los perfiles viven en el almacenamiento del navegador, que es pequeño.
      */}
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-label">{es ? 'Portada del perfil' : 'Profile banner'}</span>
          <span className="settings-row-desc">
            {bannerError || (es
              ? 'Una imagen ancha que se ve arriba de tu perfil. Se queda en este equipo.'
              : 'A wide image shown at the top of your profile. It stays on this computer.')}
          </span>
        </div>
        <div className="settings-row-control settings-profile-photo">
          <span
            aria-hidden="true"
            style={{
              width: 132,
              height: 48,
              flexShrink: 0,
              borderRadius: 10,
              border: '1px solid var(--border-light)',
              background: banner ? `center / cover no-repeat url(${banner})` : 'var(--surface-raised)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11.5,
              color: 'var(--text-muted)',
            }}
          >
            {banner ? '' : (es ? 'Sin portada' : 'No banner')}
          </span>
          <button type="button" className="settings-btn" onClick={() => bannerRef.current?.click()}>
            {banner ? (es ? 'Cambiar' : 'Change') : (es ? 'Subir portada' : 'Upload banner')}
          </button>
          {banner && (
            <button type="button" className="settings-btn" onClick={() => setBanner('')}>
              {es ? 'Quitar' : 'Remove'}
            </button>
          )}
          <input ref={bannerRef} type="file" accept="image/*" hidden onChange={elegirPortada} />
        </div>
      </div>


      {/*
        El botón solo se puede pulsar cuando hay algo que guardar. Un «Guardar»
        siempre encendido sobre un formulario sin tocar invita a pulsarlo por si acaso.
      */}
      <div className="settings-row settings-row-end">
        <button
          type="button"
          className="settings-btn is-primary"
          onClick={guardar}
          disabled={!cambiado || !limpio}
        >
          {saved
            ? <><Check size={15} /> {es ? 'Guardado' : 'Saved'}</>
            : (es ? 'Guardar cambios' : 'Save changes')}
        </button>
      </div>

      {/*
        La cuenta de Discord con la que se entró. Vive aquí, en el perfil, porque es
        quién eres para Yoru y no un servidor que se configure. Cerrar sesión deja la
        app en la pantalla de entrada: no es «desconectar un servicio», es salir.
      */}
      {sesionDiscord && (
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-label">{es ? 'Cuenta de Discord' : 'Discord account'}</span>
            <span className="settings-row-desc">
              {es
                ? `Entraste como ${sesionDiscord.usuarioNombre || sesionDiscord.usuarioId}. Yoru comprueba con esta cuenta que estás en el servidor.`
                : `You signed in as ${sesionDiscord.usuarioNombre || sesionDiscord.usuarioId}. Yoru uses this account to check that you are in the server.`}
            </span>
          </div>
          <div className="settings-row-control">
            <button
              type="button"
              className="settings-btn"
              onClick={() => {
                cerrarSesion();
                // Al montarse de nuevo, la app vuelve a decidir el acceso, y sin
                // sesión eso es la pantalla de entrada.
                window.location.reload();
              }}
            >
              <LogOut size={15} />
              {es ? 'Cerrar sesión' : 'Sign out'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
