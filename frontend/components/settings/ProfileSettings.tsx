import React, { useEffect, useRef, useState } from 'react';
import { Check, User } from 'lucide-react';

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
  onSave: (changes: { name: string; avatar: string; avatarEmoji: string }) => void;
  onPickImage: (file: File) => Promise<string>;
}) {
  const [name, setName] = useState(profile?.name || '');
  const [avatar, setAvatar] = useState(profile?.avatar || '');
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Al cambiar de perfil activo, el formulario pasa a hablar del nuevo.
  useEffect(() => {
    setName(profile?.name || '');
    setAvatar(profile?.avatar || '');
    setSaved(false);
  }, [profile?.id, profile?.name, profile?.avatar]);

  if (!profile) {
    return (
      <p className="settings-row-desc">
        {es ? 'No hay ningún perfil activo.' : 'There is no active profile.'}
      </p>
    );
  }

  const esImagen = avatar.startsWith('data:') || avatar.startsWith('/') || avatar.startsWith('http');
  const limpio = name.trim();
  const cambiado = limpio !== profile.name || avatar !== profile.avatar;

  const guardar = () => {
    if (!limpio || !cambiado) return;
    // El emoji se vacía cuando hay foto: si no, se pintarían los dos encima.
    onSave({ name: limpio, avatar, avatarEmoji: esImagen ? '' : (profile.avatarEmoji || '') });
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

  return (
    <div className="settings-rows">
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-label">{es ? 'Foto de perfil' : 'Profile photo'}</span>
          <span className="settings-row-desc">
            {es
              ? 'Una imagen JPG, PNG o WebP. Se queda en este equipo, dentro de tu perfil.'
              : 'A JPG, PNG or WebP image. It stays on this computer, inside your profile.'}
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
          <button type="button" className="settings-btn" onClick={() => fileRef.current?.click()}>
            {es ? 'Cambiar foto' : 'Change photo'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={elegirFoto} />
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-label">{es ? 'Nombre del perfil' : 'Profile name'}</span>
          <span className="settings-row-desc">
            {profileCount > 1
              ? (es ? 'Con el que lo distingues de tus otros perfiles.' : 'How you tell it apart from your other profiles.')
              : (es ? 'Como te llama Yoru.' : 'What Yoru calls you.')}
          </span>
        </div>
        <div className="settings-row-control">
          <input
            type="text"
            className="settings-input"
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') guardar(); }}
            aria-label={es ? 'Nombre del perfil' : 'Profile name'}
          />
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
    </div>
  );
}
