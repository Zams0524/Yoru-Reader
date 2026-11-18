/**
 * Entrar en Yoru con Discord, y comprobar que eres del servidor.
 *
 * OAuth2 con Authorization Code + PKCE, como **cliente público**: en la app no hay
 * ningún client secret, ni lo habrá. Un secreto metido en un binario que se descarga
 * cualquiera no es un secreto, es un secreto de todos, y Discord lo sabe: por eso
 * admite PKCE, que demuestra que quien cambia el código por un token es el mismo que
 * empezó el proceso, sin nada compartido que guardar.
 *
 * Cada plataforma vuelve de Discord por donde puede:
 *
 *  - **Escritorio (Electron).** El proceso principal levanta un servidor en
 *    `127.0.0.1` y Discord redirige ahí. A diferencia del de Google, que escucha en un
 *    puerto al azar (`listen(0)`), este usa el **puerto fijo 53682**: Google acepta
 *    cualquier puerto de loopback para apps de escritorio, pero Discord exige que la
 *    dirección de vuelta coincida letra por letra con una registrada, y no admite
 *    comodines. Con un puerto al azar la dirección cambiaría en cada intento y Discord
 *    rechazaría todos menos uno.
 *  - **Android.** La autorización se abre en el navegador del sistema y vuelve por
 *    `yoru://discord-auth`, un esquema propio declarado en el manifest. No se reutiliza
 *    el camino del inicio de sesión de Google, que va por el selector de cuentas
 *    nativo y solo sirve para Google.
 *
 * Las peticiones a Discord salen **fuera de la WebView** en Android (`CapacitorHttp`,
 * como en `serverHttp.ts`), porque el punto de tokens de Discord no manda cabeceras
 * CORS. En escritorio la ventana corre con `webSecurity` desactivado, así que un
 * `fetch` normal llega igual.
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App as CapacitorApp } from '@capacitor/app';
import { YORU_DISCORD_GUILD_ID } from './discordWidget';
import {
  aplicarRespuesta,
  tokenCaducado,
  type RespuestaMembresia,
  type SesionDiscord,
} from './discordAccess';

/**
 * El Client ID de la aplicación de Discord de Yoru.
 *
 * Es público por diseño: viaja en la URL de autorización, a la vista de cualquiera que
 * mire la barra de direcciones del navegador. No es un secreto, y por eso puede estar
 * aquí en el código, igual que el ID del servidor. `VITE_DISCORD_CLIENT_ID` lo
 * sustituye si está definida, para apuntar a otra aplicación de Discord en una build
 * de pruebas sin tocar el código ni los secretos de CI.
 */
export const YORU_DISCORD_CLIENT_ID = '1572616409819910397';

export function clientIdDiscord(): string {
  // `import.meta.env` lo pone Vite al compilar. Fuera de Vite (en los tests, o en
  // cualquier herramienta que importe esto desde Node) no existe, y leerlo a pelo
  // reventaría: el valor del código ya es el bueno, así que se cae de pie.
  const entorno = (import.meta as { env?: Record<string, string | undefined> }).env;
  const deBuild = entorno?.VITE_DISCORD_CLIENT_ID || '';
  return (deBuild || YORU_DISCORD_CLIENT_ID).trim();
}

/** Puerto fijo del loopback en escritorio. Ver la explicación de arriba. */
export const PUERTO_LOOPBACK = 53682;
export const REDIRECT_ESCRITORIO = `http://127.0.0.1:${PUERTO_LOOPBACK}/discord`;
export const REDIRECT_ANDROID = 'yoru://discord-auth';

/** Lo mínimo: quién eres y en qué servidores estás. Nada de leer mensajes. */
export const SCOPES = 'identify guilds';

const API = 'https://discord.com/api';
const CLAVE_SESION = 'yoru_discord_sesion';
const TIEMPO_MS = 20_000;

export function redirectUri(): string {
  return Capacitor.getPlatform() === 'android' ? REDIRECT_ANDROID : REDIRECT_ESCRITORIO;
}

/* ------------------------------------------------------------------ almacenamiento */

/**
 * La sesión se guarda en `localStorage`, igual que el token de Google
 * (`gdrive_tokens`). El proyecto no usa `safeStorage` de Electron para ningún token;
 * meter solo este por ahí dejaría dos sitios distintos para lo mismo, y si algún día
 * se cifran, se cifran todos juntos.
 */
export function leerSesion(): SesionDiscord | null {
  try {
    const raw = localStorage.getItem(CLAVE_SESION);
    if (!raw) return null;
    const dato = JSON.parse(raw);
    if (!dato || typeof dato !== 'object' || !dato.refreshToken) return null;
    return {
      accessToken: String(dato.accessToken || ''),
      refreshToken: String(dato.refreshToken),
      expiraEn: Number(dato.expiraEn) || 0,
      usuarioId: String(dato.usuarioId || ''),
      usuarioNombre: String(dato.usuarioNombre || ''),
      avatarHash: typeof dato.avatarHash === 'string' ? dato.avatarHash : '',
      avatarDataUrl: typeof dato.avatarDataUrl === 'string' ? dato.avatarDataUrl : '',
      ultimaComprobacionOk: Number(dato.ultimaComprobacionOk) || 0,
      noEsMiembro: dato.noEsMiembro === true,
    };
  } catch {
    return null;
  }
}

export function guardarSesion(sesion: SesionDiscord | null): void {
  try {
    if (!sesion) localStorage.removeItem(CLAVE_SESION);
    else localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
  } catch {
    /* Sin almacenamiento no se puede recordar la sesión; habrá que entrar otra vez. */
  }
}

export function cerrarSesion(): void {
  guardarSesion(null);
}

/* -------------------------------------------------------------------------- PKCE */

function base64url(bytes: Uint8Array): string {
  let texto = '';
  bytes.forEach((b) => { texto += String.fromCharCode(b); });
  return btoa(texto).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generarPkce(): Promise<{ verifier: string; challenge: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = base64url(bytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

/** La URL a la que se manda al usuario para que autorice. */
export function urlAutorizacion({
  clientId,
  redirect,
  challenge,
  state,
}: { clientId: string; redirect: string; challenge: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    prompt: 'consent',
  });
  return `${API}/oauth2/authorize?${params.toString()}`;
}

/* ------------------------------------------------------------- hablar con Discord */

interface Respuesta {
  status: number;
  datos: any;
  texto: string;
}

/** Una petición a Discord, por donde cada plataforma puede. Nunca lanza por el status. */
async function peticion(
  url: string,
  opciones: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string } = {},
): Promise<Respuesta> {
  const method = opciones.method || 'GET';
  const headers = { Accept: 'application/json', ...(opciones.headers || {}) };

  if (Capacitor.isNativePlatform()) {
    // CapacitorHttp no entiende AbortSignal, así que la carrera es contra un reloj,
    // igual que en serverHttp.ts y jitenSync.ts.
    const nativa = await Promise.race([
      CapacitorHttp.request({
        url, method, headers, data: opciones.body, responseType: 'json',
        connectTimeout: TIEMPO_MS, readTimeout: TIEMPO_MS,
      }),
      new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('tiempo')), TIEMPO_MS)),
    ]);
    const datos = typeof nativa.data === 'string' ? intentarJson(nativa.data) : nativa.data;
    return { status: nativa.status, datos, texto: typeof nativa.data === 'string' ? nativa.data : '' };
  }

  const control = new AbortController();
  const reloj = window.setTimeout(() => control.abort(), TIEMPO_MS);
  try {
    const respuesta = await fetch(url, { method, headers, body: opciones.body, signal: control.signal, credentials: 'omit' });
    const texto = await respuesta.text();
    return { status: respuesta.status, datos: intentarJson(texto), texto };
  } finally {
    window.clearTimeout(reloj);
  }
}

function intentarJson(texto: string): any {
  try { return texto ? JSON.parse(texto) : null; } catch { return null; }
}

interface RespuestaToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function pedirToken(cuerpo: Record<string, string>): Promise<RespuestaToken> {
  const respuesta = await peticion(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(cuerpo).toString(),
  });
  if (respuesta.status < 200 || respuesta.status >= 300) {
    // El código de error sube para poder distinguir «el refresco ya no vale» de «se
    // cayó Discord». No se escribe en ningún registro.
    throw new Error(`token-${respuesta.status}`);
  }
  const dato = respuesta.datos;
  if (!dato?.access_token || !dato?.refresh_token) throw new Error('token-sin-datos');
  return dato as RespuestaToken;
}

/** Cambia el código de autorización por los tokens. PKCE, sin secreto. */
async function canjearCodigo(code: string, verifier: string, redirect: string): Promise<RespuestaToken> {
  return pedirToken({
    client_id: clientIdDiscord(),
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirect,
    code_verifier: verifier,
  });
}

/** Renueva el token de acceso con el de refresco. */
async function renovar(refreshToken: string): Promise<RespuestaToken> {
  return pedirToken({
    client_id: clientIdDiscord(),
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}

async function datosUsuario(accessToken: string): Promise<{ id: string; nombre: string; avatarHash: string }> {
  const respuesta = await peticion(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (respuesta.status !== 200) throw new Error(`usuario-${respuesta.status}`);
  return {
    // `global_name` es el nombre que la gente ve hoy en Discord; `username` es el de
    // toda la vida, y queda de reserva para las cuentas que no lo tengan puesto.
    id: String(respuesta.datos?.id || ''),
    nombre: String(respuesta.datos?.global_name || respuesta.datos?.username || ''),
    avatarHash: String(respuesta.datos?.avatar || ''),
  };
}

/** La dirección de la foto de perfil en el CDN de Discord. Vacía si no tiene. */
export function urlAvatar(usuarioId: string, hash: string): string {
  if (!usuarioId || !hash) return '';
  return `https://cdn.discordapp.com/avatars/${usuarioId}/${hash}.png?size=256`;
}

/**
 * Baja la foto de Discord y la devuelve como data URL, para que se vea sin conexión.
 *
 * Se guarda la imagen entera y no su dirección a propósito: el avatar aparece en la
 * barra, en el perfil y en los ajustes, y pedirlo al CDN cada vez dejaría un hueco
 * gris justo en un avión o en el metro, que es donde más se lee. Si falla devuelve
 * vacío y no pasa nada: se reintenta en la siguiente comprobación con red.
 */
export async function descargarAvatar(usuarioId: string, hash: string): Promise<string> {
  const url = urlAvatar(usuarioId, hash);
  if (!url) return '';
  try {
    if (Capacitor.isNativePlatform()) {
      const nativa = await Promise.race([
        CapacitorHttp.request({ url, method: 'GET', responseType: 'blob', connectTimeout: TIEMPO_MS, readTimeout: TIEMPO_MS }),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('tiempo')), TIEMPO_MS)),
      ]);
      if (nativa.status !== 200 || typeof nativa.data !== 'string') return '';
      // CapacitorHttp devuelve los binarios en base64, como en wordAudio.ts.
      return `data:image/png;base64,${nativa.data}`;
    }

    const control = new AbortController();
    const reloj = window.setTimeout(() => control.abort(), TIEMPO_MS);
    try {
      const respuesta = await fetch(url, { signal: control.signal, credentials: 'omit' });
      if (!respuesta.ok) return '';
      const blob = await respuesta.blob();
      return await new Promise<string>((resolve) => {
        const lector = new FileReader();
        lector.onload = () => resolve(typeof lector.result === 'string' ? lector.result : '');
        lector.onerror = () => resolve('');
        lector.readAsDataURL(blob);
      });
    } finally {
      window.clearTimeout(reloj);
    }
  } catch {
    return '';
  }
}

/**
 * El perfil de Yoru que le corresponde a esta cuenta de Discord.
 *
 * Sin foto de Discord se cae al avatar de reserva de Yoru, el mismo degradado y emoji
 * que ofrecía la pantalla de creación: así nadie se queda con un hueco.
 */
export function perfilDesdeDiscord(sesion: SesionDiscord, idExistente?: string): {
  id: string;
  name: string;
  avatar: string;
  avatarEmoji: string;
} {
  const tieneFoto = Boolean(sesion.avatarDataUrl);
  return {
    id: idExistente || `profile-${Date.now()}`,
    name: sesion.usuarioNombre || 'Yoru',
    avatar: tieneFoto ? String(sesion.avatarDataUrl) : AVATAR_RESERVA.avatar,
    avatarEmoji: tieneFoto ? '' : AVATAR_RESERVA.emoji,
  };
}

/** El avatar de Yoru para quien no tiene foto en Discord. */
const AVATAR_RESERVA = { avatar: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)', emoji: '🌙' };

/**
 * Pone al día la foto guardada si falta o si Discord tiene otra.
 *
 * Devuelve la sesión actualizada, o la misma si no había nada que cambiar.
 */
export async function refrescarAvatar(sesion: SesionDiscord): Promise<SesionDiscord> {
  if (!sesion.avatarHash) return sesion;
  if (sesion.avatarDataUrl) return sesion;
  const dataUrl = await descargarAvatar(sesion.usuarioId, sesion.avatarHash);
  if (!dataUrl) return sesion;
  const actualizada = { ...sesion, avatarDataUrl: dataUrl };
  guardarSesion(actualizada);
  return actualizada;
}

/**
 * Si esta cuenta está en el servidor de Yoru.
 *
 * Solo se mira si el ID está en la lista; **la lista no se guarda en ningún sitio**. A
 * Yoru no le importa en qué otros servidores anda cada uno, y guardarlo sería quedarse
 * con algo que no necesita para nada.
 */
export async function comprobarMembresia(
  sesion: SesionDiscord,
): Promise<{ respuesta: RespuestaMembresia; sesion: SesionDiscord }> {
  let activa = sesion;

  try {
    if (tokenCaducado(activa, Date.now())) {
      const nuevos = await renovar(activa.refreshToken);
      activa = {
        ...activa,
        accessToken: nuevos.access_token,
        refreshToken: nuevos.refresh_token,
        expiraEn: Date.now() + nuevos.expires_in * 1000,
      };
    }
  } catch (error) {
    const texto = String((error as Error)?.message || '');
    // 400 y 401 al renovar significan que el refresco ya no vale: hay que volver a
    // entrar. Cualquier otra cosa (5xx, sin red) es «no se sabe», y no expulsa.
    if (/token-40[013]/.test(texto)) return { respuesta: { tipo: 'sesion-invalida' }, sesion: activa };
    return { respuesta: { tipo: 'indeterminado' }, sesion: activa };
  }

  try {
    const respuesta = await peticion(`${API}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${activa.accessToken}` },
    });
    if (respuesta.status === 401) return { respuesta: { tipo: 'sesion-invalida' }, sesion: activa };
    if (respuesta.status !== 200 || !Array.isArray(respuesta.datos)) {
      return { respuesta: { tipo: 'indeterminado' }, sesion: activa };
    }
    const esMiembro = respuesta.datos.some((guild: any) => String(guild?.id) === YORU_DISCORD_GUILD_ID);
    return { respuesta: { tipo: esMiembro ? 'miembro' : 'no-miembro' }, sesion: activa };
  } catch {
    return { respuesta: { tipo: 'indeterminado' }, sesion: activa };
  }
}

/** Pregunta a Discord y deja la sesión guardada como toque. Devuelve qué pasó. */
export async function revisarYGuardar(sesion: SesionDiscord): Promise<RespuestaMembresia> {
  const { respuesta, sesion: actualizada } = await comprobarMembresia(sesion);
  guardarSesion(aplicarRespuesta(actualizada, respuesta, Date.now()));
  return respuesta;
}

/* ------------------------------------------------------------------------- entrar */

/** Espera a que Android vuelva de Discord por `yoru://discord-auth`. */
function esperarVueltaAndroid(state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let listo = false;
    const pendiente = CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      if (listo || !url || !url.startsWith(REDIRECT_ANDROID)) return;
      listo = true;
      window.clearTimeout(reloj);
      void quitar();
      void Browser.close().catch(() => {});

      const params = new URLSearchParams(url.split('?')[1] || '');
      if (params.get('error')) { reject(new Error(String(params.get('error')))); return; }
      if (params.get('state') !== state) { reject(new Error('state-no-coincide')); return; }
      const code = params.get('code');
      if (!code) { reject(new Error('sin-codigo')); return; }
      resolve(code);
    });

    const quitar = async () => { try { (await pendiente).remove(); } catch { /* ya no estaba */ } };

    // Si alguien deja la autorización a medias, no se queda una promesa viva para
    // siempre: a los cinco minutos se da por cancelada.
    const reloj = window.setTimeout(() => {
      if (listo) return;
      listo = true;
      void quitar();
      reject(new Error('cancelado'));
    }, 5 * 60 * 1000);
  });
}

/**
 * Inicia sesión con Discord y devuelve la sesión ya guardada.
 *
 * No decide si se entra o no: eso lo hace `decidirAcceso` con lo que quede guardado.
 * Aquí solo se consigue la sesión y se apunta la primera comprobación.
 */
export async function entrarConDiscord(): Promise<SesionDiscord> {
  const clientId = clientIdDiscord();
  if (!clientId) throw new Error('falta-client-id');

  const esAndroid = Capacitor.getPlatform() === 'android';
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));

  let code: string;
  let verifier: string;
  let redirect: string;

  if (esAndroid) {
    const pkce = await generarPkce();
    verifier = pkce.verifier;
    redirect = REDIRECT_ANDROID;
    const espera = esperarVueltaAndroid(state);
    await Browser.open({ url: urlAutorizacion({ clientId, redirect, challenge: pkce.challenge, state }) });
    code = await espera;
  } else {
    if (!window.electronAPI?.startDiscordOauth) throw new Error('sin-puente-electron');
    // El proceso principal pone el loopback, genera el PKCE y abre el navegador.
    const resultado = await window.electronAPI.startDiscordOauth(clientId, state);
    if (!resultado?.code) throw new Error('sin-codigo');
    code = resultado.code;
    verifier = resultado.codeVerifier;
    redirect = resultado.redirectUri || REDIRECT_ESCRITORIO;
  }

  const tokens = await canjearCodigo(code, verifier, redirect);
  const usuario = await datosUsuario(tokens.access_token);

  const recien: SesionDiscord = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiraEn: Date.now() + tokens.expires_in * 1000,
    usuarioId: usuario.id,
    usuarioNombre: usuario.nombre,
    avatarHash: usuario.avatarHash,
    // La foto se baja aquí mismo, mientras hay red garantizada: es el único momento
    // en que se sabe seguro que la hay. Si falla, se reintenta más adelante.
    avatarDataUrl: await descargarAvatar(usuario.id, usuario.avatarHash),
    ultimaComprobacionOk: 0,
  };

  const { respuesta, sesion: revisada } = await comprobarMembresia(recien);
  const final = aplicarRespuesta(revisada, respuesta, Date.now());
  if (!final) throw new Error('sesion-invalida');
  guardarSesion(final);
  return final;
}

/** La invitación al servidor, para quien no es miembro. La da el widget público. */
export async function invitacionServidor(): Promise<string> {
  try {
    const { fetchDiscordWidget } = await import('./discordWidget');
    const widget = await fetchDiscordWidget(YORU_DISCORD_GUILD_ID);
    return widget.invite || '';
  } catch {
    return '';
  }
}

/** El nombre del servidor, para la pantalla de bloqueo. Vacío si no se puede saber. */
export async function nombreServidor(): Promise<string> {
  try {
    const { fetchDiscordWidget } = await import('./discordWidget');
    const widget = await fetchDiscordWidget(YORU_DISCORD_GUILD_ID);
    return widget.name || '';
  } catch {
    return '';
  }
}
