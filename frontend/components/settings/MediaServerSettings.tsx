import React, { useState } from 'react';
import { CheckCircle2, Headphones, Library as LibraryIcon, Loader2, Unplug, XCircle } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import type { ConnectionTestResult, KavitaAuthMode } from '../../types/integrations';
import {
  KAVITA_DEFAULT_URL,
  clearKavitaConfig,
  getKavitaConfig,
  loginKavita,
  saveKavitaConfig,
  testKavitaConnection,
} from '../../utils/kavitaService';
import {
  AUDIOBOOKSHELF_DEFAULT_URL,
  clearAudiobookshelfConfig,
  getAudiobookshelfConfig,
  loginAudiobookshelf,
  saveAudiobookshelfConfig,
  testAudiobookshelfConnection,
} from '../../utils/audiobookshelfService';
import { describeServerError, normalizeServerUrl } from '../../utils/serverHttp';

interface Props {
  lang: string;
}

type Status = { state: 'idle' } | { state: 'testing' } | ({ state: 'done' } & ConnectionTestResult);

function StatusLine({ status }: { status: Status }) {
  if (status.state === 'idle') return null;
  if (status.state === 'testing') {
    return <div className="media-server-status"><Loader2 size={15} className="guide-spin" /> …</div>;
  }
  return (
    <div className={`media-server-status ${status.ok ? 'is-ok' : 'is-error'}`} role="status">
      {status.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
      <span>{status.message}</span>
    </div>
  );
}

/**
 * Settings for the self-hosted servers: Kavita (light novels to import) and Audiobookshelf
 * (audiobooks to listen to while reading). "Test connection" logs in, checks the server and saves
 * the connection when it works. Saved on this device only.
 */
export default function MediaServerSettings({ lang }: Props) {
  const es = lang === 'es';
  const isAndroid = Capacitor.getPlatform() === 'android';

  const savedKavita = getKavitaConfig();
  const [kavitaUrl, setKavitaUrl] = useState(savedKavita?.serverUrl || KAVITA_DEFAULT_URL);
  const [kavitaMode, setKavitaMode] = useState<KavitaAuthMode>(savedKavita?.authMode || 'apiKey');
  const [kavitaApiKey, setKavitaApiKey] = useState(savedKavita?.authMode === 'apiKey' ? savedKavita.apiKey : '');
  const [kavitaUser, setKavitaUser] = useState(savedKavita?.username || '');
  const [kavitaPassword, setKavitaPassword] = useState('');
  const [kavitaConnected, setKavitaConnected] = useState(Boolean(savedKavita?.apiKey));
  const [kavitaStatus, setKavitaStatus] = useState<Status>({ state: 'idle' });

  const savedAbs = getAudiobookshelfConfig();
  const [absUrl, setAbsUrl] = useState(savedAbs?.serverUrl || AUDIOBOOKSHELF_DEFAULT_URL);
  const [absMode, setAbsMode] = useState<'token' | 'password'>(savedAbs?.username ? 'password' : 'token');
  const [absToken, setAbsToken] = useState(savedAbs && !savedAbs.username ? savedAbs.token : '');
  const [absUser, setAbsUser] = useState(savedAbs?.username || '');
  const [absPassword, setAbsPassword] = useState('');
  const [absConnected, setAbsConnected] = useState(Boolean(savedAbs?.token));
  const [absStatus, setAbsStatus] = useState<Status>({ state: 'idle' });

  const testKavita = async () => {
    setKavitaStatus({ state: 'testing' });
    try {
      const config = kavitaMode === 'password'
        ? await loginKavita(kavitaUrl, kavitaUser, kavitaPassword)
        : { serverUrl: normalizeServerUrl(kavitaUrl), authMode: 'apiKey' as const, apiKey: kavitaApiKey.trim(), username: '' };
      if (!config.apiKey) {
        setKavitaStatus({ state: 'done', ok: false, message: es ? 'Falta la clave API (Kavita › Ajustes de usuario › Clave API).' : 'API key missing (Kavita › User settings › API key).' });
        return;
      }
      const result = await testKavitaConnection(config, es);
      setKavitaStatus({ state: 'done', ...result });
      if (result.ok) {
        saveKavitaConfig(config);
        setKavitaUrl(config.serverUrl);
        setKavitaPassword('');
        setKavitaConnected(true);
      }
    } catch (error) {
      setKavitaStatus({ state: 'done', ok: false, message: describeServerError(error, es) });
    }
  };

  const testAbs = async () => {
    setAbsStatus({ state: 'testing' });
    try {
      const config = absMode === 'password'
        ? await loginAudiobookshelf(absUrl, absUser, absPassword)
        : { serverUrl: normalizeServerUrl(absUrl), token: absToken.trim(), username: '' };
      if (!config.token) {
        setAbsStatus({ state: 'done', ok: false, message: es ? 'Falta el token API (Audiobookshelf › Ajustes › Usuarios › tu usuario).' : 'API token missing (Audiobookshelf › Settings › Users › your user).' });
        return;
      }
      const result = await testAudiobookshelfConnection(config, es);
      setAbsStatus({ state: 'done', ...result });
      if (result.ok) {
        saveAudiobookshelfConfig(config);
        setAbsUrl(config.serverUrl);
        setAbsPassword('');
        setAbsConnected(true);
      }
    } catch (error) {
      setAbsStatus({ state: 'done', ok: false, message: describeServerError(error, es) });
    }
  };

  const modeSwitch = <T extends string>(value: T, options: { value: T; label: string }[], onChange: (value: T) => void) => (
    <div className="media-server-mode" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? 'is-active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  const field = (label: string, input: React.ReactNode) => (
    <label className="media-server-field">
      <span>{label}</span>
      {input}
    </label>
  );

  return (
    <div className="media-server-settings">
      {isAndroid && (
        <p className="media-server-hint">
          {es
            ? 'En el teléfono, «localhost» es el propio teléfono: usa la IP de tu PC en la red de casa (por ejemplo http://192.168.1.196:5000).'
            : 'On the phone, "localhost" is the phone itself: use your PC\'s home network IP (for example http://192.168.1.196:5000).'}
        </p>
      )}

      <section className="media-server-card">
        <header className="media-server-head">
          <LibraryIcon size={18} />
          <div>
            <h4>{es ? 'Servidor Kavita' : 'Kavita server'}</h4>
            <p>{es ? 'Explora tus novelas ligeras e impórtalas a la biblioteca para leerlas sin conexión.' : 'Browse your light novels and import them to read offline.'}</p>
          </div>
          {kavitaConnected && <span className="media-server-badge">{es ? 'Conectado' : 'Connected'}</span>}
        </header>
        {field(es ? 'URL del servidor' : 'Server URL', (
          <input type="url" inputMode="url" autoCapitalize="off" spellCheck={false} value={kavitaUrl} placeholder={KAVITA_DEFAULT_URL} onChange={(e) => setKavitaUrl(e.target.value)} />
        ))}
        {modeSwitch<KavitaAuthMode>(kavitaMode, [
          { value: 'apiKey', label: es ? 'Clave API' : 'API key' },
          { value: 'password', label: es ? 'Usuario y contraseña' : 'Username & password' },
        ], setKavitaMode)}
        {kavitaMode === 'apiKey' ? (
          field(es ? 'Clave API' : 'API key', (
            <input type="password" autoComplete="off" spellCheck={false} value={kavitaApiKey} onChange={(e) => setKavitaApiKey(e.target.value)} placeholder={kavitaConnected && savedKavita?.authMode === 'password' ? (es ? 'Guardada' : 'Saved') : ''} />
          ))
        ) : (
          <>
            {field(es ? 'Usuario' : 'Username', <input type="text" autoCapitalize="off" autoComplete="username" value={kavitaUser} onChange={(e) => setKavitaUser(e.target.value)} />)}
            {field(es ? 'Contraseña' : 'Password', <input type="password" autoComplete="current-password" value={kavitaPassword} onChange={(e) => setKavitaPassword(e.target.value)} />)}
          </>
        )}
        <div className="media-server-actions">
          <button type="button" className="media-server-btn is-primary" onClick={testKavita} disabled={kavitaStatus.state === 'testing'}>
            {es ? 'Probar conexión' : 'Test connection'}
          </button>
          {kavitaConnected && (
            <button type="button" className="media-server-btn" onClick={() => { clearKavitaConfig(); setKavitaConnected(false); setKavitaStatus({ state: 'idle' }); }}>
              <Unplug size={15} /> {es ? 'Desconectar' : 'Disconnect'}
            </button>
          )}
        </div>
        <StatusLine status={kavitaStatus} />
        <p className="media-server-note">
          {es ? 'Se guarda solo en este dispositivo; no se guarda la contraseña.' : 'Saved on this device only; the password is not stored.'}
        </p>
      </section>

      <section className="media-server-card">
        <header className="media-server-head">
          <Headphones size={18} />
          <div>
            <h4>{es ? 'Servidor Audiobookshelf' : 'Audiobookshelf server'}</h4>
            <p>{es ? 'Escucha el audiolibro de la novela mientras lees; el progreso se sincroniza con el servidor.' : 'Listen to the novel\'s audiobook while reading; progress syncs with the server.'}</p>
          </div>
          {absConnected && <span className="media-server-badge">{es ? 'Conectado' : 'Connected'}</span>}
        </header>
        {field(es ? 'URL del servidor' : 'Server URL', (
          <input type="url" inputMode="url" autoCapitalize="off" spellCheck={false} value={absUrl} placeholder={AUDIOBOOKSHELF_DEFAULT_URL} onChange={(e) => setAbsUrl(e.target.value)} />
        ))}
        {modeSwitch<'token' | 'password'>(absMode, [
          { value: 'token', label: es ? 'Token API' : 'API token' },
          { value: 'password', label: es ? 'Usuario y contraseña' : 'Username & password' },
        ], setAbsMode)}
        {absMode === 'token' ? (
          field(es ? 'Token API' : 'API token', (
            <input type="password" autoComplete="off" spellCheck={false} value={absToken} onChange={(e) => setAbsToken(e.target.value)} />
          ))
        ) : (
          <>
            {field(es ? 'Usuario' : 'Username', <input type="text" autoCapitalize="off" autoComplete="username" value={absUser} onChange={(e) => setAbsUser(e.target.value)} />)}
            {field(es ? 'Contraseña' : 'Password', <input type="password" autoComplete="current-password" value={absPassword} onChange={(e) => setAbsPassword(e.target.value)} />)}
          </>
        )}
        <div className="media-server-actions">
          <button type="button" className="media-server-btn is-primary" onClick={testAbs} disabled={absStatus.state === 'testing'}>
            {es ? 'Probar conexión' : 'Test connection'}
          </button>
          {absConnected && (
            <button type="button" className="media-server-btn" onClick={() => { clearAudiobookshelfConfig(); setAbsConnected(false); setAbsStatus({ state: 'idle' }); }}>
              <Unplug size={15} /> {es ? 'Desconectar' : 'Disconnect'}
            </button>
          )}
        </div>
        <StatusLine status={absStatus} />
        <p className="media-server-note">
          {es ? 'Se guarda solo en este dispositivo; no se guarda la contraseña.' : 'Saved on this device only; the password is not stored.'}
        </p>
      </section>
    </div>
  );
}
