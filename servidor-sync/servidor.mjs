/**
 * Servidor de sincronización de Yoru.
 *
 * Corre en el PC de zams y guarda el progreso de cada miembro del servidor de Discord
 * de Yoru: libros, posición de lectura, estados de palabras, tarjetas del SRS y
 * ajustes. La app lo alcanza por Tailscale, así que no hay nada abierto a internet:
 * quien no esté en el tailnet no llega ni a la puerta.
 *
 * Dos decisiones que explican casi todo el fichero:
 *
 *  - **Sin dependencias.** Solo `node:http`, `node:sqlite` y `fetch`, todo de serie en
 *    Node 24. Un servidor que hay que recordar reinstalar cada vez que se borra
 *    `node_modules` es un servidor que un día no arranca, y el día que no arranque
 *    nadie estará mirando: estará leyendo en el metro.
 *  - **Aquí no se combina nada.** El servidor guarda el bulto tal cual y lleva la
 *    cuenta de versiones; quien combina es la app, con `mergeDatabaseExports`, el
 *    mismo código que ya combina con Google Drive. Tener dos combinadores distintos
 *    para los mismos datos es tener dos sitios donde perder horas de lectura.
 *
 * La identidad la pone Discord, no nosotros. El cliente manda su token de acceso una
 * vez, el servidor le pregunta a Discord quién es y si está en el servidor de Yoru, y
 * a cambio entrega un token propio con el que hablar el resto de la semana. Así el
 * token de Discord no viaja en cada petición y Discord no recibe una pregunta por cada
 * página que alguien pasa.
 *
 * Arrancar:  node servidor-sync/servidor.mjs
 * Ver README.md para ponerlo a arrancar solo con Windows.
 */

import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ configuración */

/** El servidor de Discord de Yoru. El mismo que mira la app en `discordWidget.ts`. */
export const GUILD_YORU = process.env.YORU_SYNC_GUILD || '1372928430634565775';

export const PUERTO = Number(process.env.YORU_SYNC_PUERTO || 3747);

/**
 * Escucha en todas las direcciones a propósito.
 *
 * La dirección de Tailscale (100.121.94.3) solo existe cuando Tailscale ya levantó su
 * interfaz; atarse a ella haría que el servidor fallara al arrancar con Windows, que
 * es justo cuando nadie mira. Escuchando en todas, Tailscale sirve igual y el
 * cortafuegos de Windows decide el resto. Ver README.md.
 */
export const HOST = process.env.YORU_SYNC_HOST || '0.0.0.0';

const API_DISCORD = process.env.YORU_SYNC_DISCORD_API || 'https://discord.com/api';

/** Cuánto vale un token del servidor antes de volver a preguntarle a Discord. */
const VIDA_SESION_MS = 7 * 24 * 60 * 60 * 1000;

/** Tope del cuerpo de una petición. Una biblioteca grande ronda unos pocos MB. */
const MAX_CUERPO = 64 * 1024 * 1024;

const TIEMPO_DISCORD_MS = 15_000;

/* ------------------------------------------------------------------ base de datos */

export function abrirBase(ruta = process.env.YORU_SYNC_DB || join(AQUI, 'datos', 'yoru-sync.db')) {
  if (ruta !== ':memory:') mkdirSync(dirname(ruta), { recursive: true });
  const base = new DatabaseSync(ruta);
  // WAL: la app escribe mientras otra lee sin que se bloqueen entre ellas.
  if (ruta !== ':memory:') base.exec('PRAGMA journal_mode = WAL');
  base.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id          TEXT PRIMARY KEY,
      nombre      TEXT NOT NULL DEFAULT '',
      version     INTEGER NOT NULL DEFAULT 0,
      actualizado INTEGER NOT NULL DEFAULT 0,
      creado      INTEGER NOT NULL DEFAULT 0,
      datos       TEXT
    );
    CREATE TABLE IF NOT EXISTS sesiones (
      token      TEXT PRIMARY KEY,
      usuario_id TEXT NOT NULL,
      nombre     TEXT NOT NULL DEFAULT '',
      creada     INTEGER NOT NULL,
      expira     INTEGER NOT NULL,
      vista      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sesiones_por_usuario ON sesiones (usuario_id);
  `);
  return base;
}

/* -------------------------------------------------------------- hablar con Discord */

/**
 * Quién es el dueño de este token y si está en el servidor de Yoru.
 *
 * Devuelve `{ tipo: 'miembro', usuario }`, `{ tipo: 'no-miembro' }`,
 * `{ tipo: 'token-invalido' }` o `{ tipo: 'discord-caido' }`. La diferencia entre las
 * dos últimas es la que decide si al lector se le echa o se le deja en paz: que
 * Discord no conteste no es lo mismo que Discord diciendo que no.
 */
export async function identificar(accessToken, fetchImpl = fetch) {
  const cabeceras = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
  const pedir = async (ruta) => {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), TIEMPO_DISCORD_MS);
    try {
      const respuesta = await fetchImpl(`${API_DISCORD}${ruta}`, { headers: cabeceras, signal: control.signal });
      const texto = await respuesta.text();
      let datos = null;
      try { datos = texto ? JSON.parse(texto) : null; } catch { datos = null; }
      return { status: respuesta.status, datos };
    } finally {
      clearTimeout(reloj);
    }
  };

  let usuario;
  let guilds;
  try {
    usuario = await pedir('/users/@me');
    if (usuario.status === 401) return { tipo: 'token-invalido' };
    if (usuario.status !== 200 || !usuario.datos?.id) return { tipo: 'discord-caido' };
    guilds = await pedir('/users/@me/guilds');
    if (guilds.status === 401) return { tipo: 'token-invalido' };
    if (guilds.status !== 200 || !Array.isArray(guilds.datos)) return { tipo: 'discord-caido' };
  } catch {
    return { tipo: 'discord-caido' };
  }

  const esMiembro = guilds.datos.some((g) => String(g?.id) === GUILD_YORU);
  if (!esMiembro) return { tipo: 'no-miembro' };
  return {
    tipo: 'miembro',
    usuario: {
      id: String(usuario.datos.id),
      nombre: String(usuario.datos.global_name || usuario.datos.username || ''),
    },
  };
}

/* ------------------------------------------------------------------------ sesiones */

function nuevoToken() {
  return randomBytes(32).toString('hex');
}

export function crearSesion(base, usuario, ahora = Date.now()) {
  const token = nuevoToken();
  base.prepare('INSERT INTO sesiones (token, usuario_id, nombre, creada, expira, vista) VALUES (?, ?, ?, ?, ?, ?)')
    .run(token, usuario.id, usuario.nombre, ahora, ahora + VIDA_SESION_MS, ahora);
  base.prepare(`
    INSERT INTO usuarios (id, nombre, version, actualizado, creado, datos)
    VALUES (?, ?, 0, 0, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre
  `).run(usuario.id, usuario.nombre, ahora);
  return { token, expiraEn: ahora + VIDA_SESION_MS };
}

export function sesionDe(base, token, ahora = Date.now()) {
  if (!token) return null;
  const fila = base.prepare('SELECT * FROM sesiones WHERE token = ?').get(token);
  if (!fila) return null;
  if (fila.expira <= ahora) {
    base.prepare('DELETE FROM sesiones WHERE token = ?').run(token);
    return null;
  }
  base.prepare('UPDATE sesiones SET vista = ? WHERE token = ?').run(ahora, token);
  return fila;
}

export function limpiarSesiones(base, ahora = Date.now()) {
  return base.prepare('DELETE FROM sesiones WHERE expira <= ?').run(ahora).changes;
}

/* -------------------------------------------------------------------- el progreso */

export function leerProgreso(base, usuarioId) {
  const fila = base.prepare('SELECT version, actualizado, datos FROM usuarios WHERE id = ?').get(usuarioId);
  if (!fila || !fila.datos) {
    return { version: Number(fila?.version || 0), actualizadoEn: Number(fila?.actualizado || 0), datos: null };
  }
  let datos = null;
  try { datos = JSON.parse(fila.datos); } catch { datos = null; }
  return { version: Number(fila.version), actualizadoEn: Number(fila.actualizado), datos };
}

/**
 * Guarda el progreso si quien escribe partió de la versión que hay.
 *
 * `baseVersion` es la versión que el cliente leyó antes de combinar. Si entretanto
 * escribió otro aparato, el número ya no cuadra y aquí se dice que no, devolviendo lo
 * que hay para que el cliente lo combine y vuelva. Sin esto, dos teléfonos leyendo a
 * la vez se pisarían el uno al otro y el segundo en llegar borraría lo del primero.
 */
export function guardarProgreso(base, usuarioId, datos, baseVersion, ahora = Date.now()) {
  const actual = base.prepare('SELECT version FROM usuarios WHERE id = ?').get(usuarioId);
  const version = Number(actual?.version || 0);
  if (Number(baseVersion) !== version) {
    return { ok: false, motivo: 'desfase', ...leerProgreso(base, usuarioId) };
  }
  const texto = JSON.stringify(datos);
  base.prepare('UPDATE usuarios SET datos = ?, version = ?, actualizado = ? WHERE id = ?')
    .run(texto, version + 1, ahora, usuarioId);
  return { ok: true, version: version + 1, actualizadoEn: ahora, bytes: texto.length };
}

/* ---------------------------------------------------------- lo que ven los demás */

/**
 * Qué está leyendo alguien, para que la tarjeta de Miembros lo enseñe.
 *
 * Esto es lo único que un miembro puede ver de otro, y es a propósito. Lo que la app
 * sube es la biblioteca entera: todos los libros, los estados de cada palabra, las
 * tarjetas del SRS, los ajustes. Devolver eso a cualquiera que pregunte convertiría
 * una tarjeta de «qué está leyendo fulano» en una copia de su cuenta, y nadie que
 * entre con Discord espera eso. Así que aquí se saca **un libro y un porcentaje**, y
 * se tira el resto.
 *
 * Y se respeta lo que cada uno ya había decidido sobre enseñar lo que lee:
 *
 *  - `shareReadingWithMembers: false` → no se enseña nada.
 *  - La lista negra de Discord (`discordBlacklist`) vale también aquí, con la misma
 *    regla que en `discordRpc.ts`: un título por línea, comparado en minúsculas. Un
 *    libro que alguien escondió de sus amigos en Discord no va a aparecer en la
 *    tarjeta de Miembros por la puerta de atrás.
 */
export function queEstaLeyendo(datos) {
  const perfiles = Array.isArray(datos?.profiles) ? datos.profiles : [];
  const perfilId = datos?.activeProfileId || perfiles[0]?.id;
  const perfil = perfilId ? datos?.profileData?.[perfilId] : null;
  if (!perfil) return { comparte: true, leyendo: null };

  const ajustes = perfil.settings || {};
  // Por defecto sí se comparte: la tarjeta de Miembros es la razón de que esto exista.
  // Quien no quiera, lo apaga en Ajustes y deja de salir desde la siguiente subida.
  if (ajustes.shareReadingWithMembers === false) return { comparte: false, leyendo: null };

  const libros = (Array.isArray(perfil.books) ? perfil.books : []).filter((libro) => libro && !libro.isDeleted);
  let ultimo = null;
  let cuando = 0;
  for (const libro of libros) {
    const momento = Date.parse(libro.lastRead || '') || 0;
    if (momento > cuando) { cuando = momento; ultimo = libro; }
  }
  if (!ultimo || !cuando) return { comparte: true, leyendo: null };

  const negra = String(ajustes.discordBlacklist || '')
    .split('\n').map((linea) => linea.trim().toLowerCase()).filter(Boolean);
  if (negra.includes(String(ultimo.title || '').toLowerCase())) return { comparte: false, leyendo: null };

  const progreso = ultimo.progress || {};
  const capitulo = Array.isArray(ultimo.chapters) ? ultimo.chapters[progreso.currentChapter] : null;
  return {
    comparte: true,
    leyendo: {
      titulo: String(ultimo.title || ''),
      autor: String(ultimo.author || ''),
      portada: String(ultimo.cover || ''),
      capitulo: capitulo ? String(capitulo.title || '') : '',
      porcentaje: Math.max(0, Math.min(100, Math.round(Number(progreso.percent) || 0))),
      ultimaLectura: cuando,
    },
  };
}

/** La ficha pública de un miembro: quién es y qué lee. Nunca sus datos. */
export function fichaDe(base, usuarioId) {
  const fila = base.prepare('SELECT id, nombre, actualizado FROM usuarios WHERE id = ?').get(usuarioId);
  if (!fila) return null;
  const { datos } = leerProgreso(base, usuarioId);
  return {
    usuarioId: String(fila.id),
    nombre: String(fila.nombre || ''),
    actualizadoEn: Number(fila.actualizado || 0),
    ...queEstaLeyendo(datos),
  };
}

/** Todos los que alguna vez han sincronizado, del más reciente al más antiguo. */
export function fichasDeTodos(base) {
  const filas = base.prepare('SELECT id FROM usuarios WHERE datos IS NOT NULL ORDER BY actualizado DESC').all();
  return filas.map((fila) => fichaDe(base, fila.id)).filter(Boolean);
}

/* ------------------------------------------------------- aguantar el mundo entero */

/**
 * Cuántas veces seguidas se puede pedir entrar desde la misma dirección.
 *
 * Mientras esto solo vivía dentro del tailnet, sobraba: quien llegaba a la puerta ya
 * había pasado otra. Expuesto a internet con Funnel, `POST /api/sesion` es el único
 * sitio al que cualquiera puede llamar sin nada, y cada llamada se convierte en dos
 * peticiones a Discord. Sin un tope, un aburrido con un bucle agota el límite de
 * Discord y deja fuera a los que sí son miembros.
 *
 * Solo se cuentan los intentos que **fallan**. Quien es miembro de verdad puede abrir
 * la app las veces que quiera desde la misma casa o el mismo móvil sin tropezarse con
 * esto; quien prueba tokens a ciegas falla siempre, y a los diez fallos se queda sin
 * puerta durante diez minutos.
 */
export const INTENTOS_ENTRADA = 10;
export const VENTANA_ENTRADA_MS = 10 * 60 * 1000;

function vigentes(mapa, clave, ahora, ventanaMs) {
  return (mapa.get(clave) || []).filter((momento) => ahora - momento < ventanaMs);
}

/**
 * ¿Está esta dirección frenada ahora mismo? Solo mira; no apunta nada.
 */
export function frenado(mapa, clave, ahora = Date.now(), max = INTENTOS_ENTRADA, ventanaMs = VENTANA_ENTRADA_MS) {
  const marcas = vigentes(mapa, clave, ahora, ventanaMs);
  mapa.set(clave, marcas);
  return marcas.length >= max;
}

/**
 * Apunta un intento fallido.
 *
 * El contador vive en memoria y se olvida al reiniciar, y está bien: no es un castigo
 * que haya que recordar, es freno para una ráfaga.
 */
export function anotarFallo(mapa, clave, ahora = Date.now(), ventanaMs = VENTANA_ENTRADA_MS) {
  const marcas = vigentes(mapa, clave, ahora, ventanaMs);
  marcas.push(ahora);
  mapa.set(clave, marcas);
  // Que el mapa no crezca para siempre con direcciones de paso.
  if (mapa.size > 10_000) {
    for (const [otra, suyas] of mapa) {
      if (!suyas.some((momento) => ahora - momento < ventanaMs)) mapa.delete(otra);
    }
  }
}

/**
 * De dónde viene esta petición.
 *
 * Con Funnel, Tailscale hace de intermediario: la conexión llega desde el propio
 * equipo y el de fuera queda en `X-Forwarded-For`. Esa cabecera solo se cree **si la
 * conexión viene de la máquina misma**; de cualquier otro sitio es un dato que manda
 * quien llama, y creérsela convertiría el tope de arriba en un adorno que cualquiera
 * esquiva poniendo una dirección distinta en cada intento.
 */
export function ipDe(req) {
  const directa = req.socket?.remoteAddress || '';
  const esLocal = directa === '127.0.0.1' || directa === '::1' || directa === '::ffff:127.0.0.1';
  if (esLocal) {
    const reenviada = String(req.headers?.['x-forwarded-for'] || '').split(',').pop()?.trim();
    if (reenviada) return reenviada;
  }
  return directa || 'desconocida';
}

/* ------------------------------------------------------------------------- el HTTP */

function responder(res, status, cuerpo) {
  const texto = JSON.stringify(cuerpo ?? null);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(texto),
    // El tailnet ya es la frontera; dentro, cualquier origen de la app vale (Electron
    // con webSecurity apagado, Vite en desarrollo, la WebView de Android).
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(texto);
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    let total = 0;
    req.on('data', (trozo) => {
      total += trozo.length;
      if (total > MAX_CUERPO) {
        reject(new Error('cuerpo-demasiado-grande'));
        req.destroy();
        return;
      }
      trozos.push(trozo);
    });
    req.on('end', () => {
      const texto = Buffer.concat(trozos).toString('utf8');
      if (!texto) { resolve(null); return; }
      try { resolve(JSON.parse(texto)); } catch { reject(new Error('json-invalido')); }
    });
    req.on('error', reject);
  });
}

function tokenDe(req) {
  const cabecera = String(req.headers.authorization || '');
  const trozos = cabecera.split(' ');
  return trozos.length === 2 && /^bearer$/i.test(trozos[0]) ? trozos[1].trim() : '';
}

function registrar(...partes) {
  console.log(`[${new Date().toISOString()}]`, ...partes);
}

export function crearServidor({ base, fetchImpl = fetch } = {}) {
  const bd = base || abrirBase();
  const intentos = new Map();

  const servidor = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://servidor');
    const ruta = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS') { responder(res, 204, null); return; }

    try {
      if (ruta === '/api/salud' && req.method === 'GET') {
        responder(res, 200, { ok: true, servidor: 'yoru-sync', guild: GUILD_YORU });
        return;
      }

      /* Entrar: el token de Discord a cambio de un token nuestro. */
      if (ruta === '/api/sesion' && req.method === 'POST') {
        const quienLlama = ipDe(req);
        if (frenado(intentos, quienLlama)) {
          registrar('frenado', quienLlama);
          responder(res, 429, { error: 'demasiados-intentos' });
          return;
        }
        const cuerpo = await leerCuerpo(req);
        const accessToken = String(cuerpo?.accessToken || '').trim();
        if (!accessToken) { anotarFallo(intentos, quienLlama); responder(res, 400, { error: 'falta-token' }); return; }

        const quien = await identificar(accessToken, fetchImpl);
        // Discord caído no es culpa de quien llama, así que ese no se apunta.
        if (quien.tipo === 'token-invalido') { anotarFallo(intentos, quienLlama); responder(res, 401, { error: 'token-invalido' }); return; }
        if (quien.tipo === 'no-miembro') { anotarFallo(intentos, quienLlama); responder(res, 403, { error: 'no-miembro' }); return; }
        if (quien.tipo === 'discord-caido') { responder(res, 503, { error: 'discord-no-responde' }); return; }

        const { token, expiraEn } = crearSesion(bd, quien.usuario);
        registrar('entra', quien.usuario.nombre || quien.usuario.id);
        responder(res, 200, { token, expiraEn, usuarioId: quien.usuario.id, nombre: quien.usuario.nombre });
        return;
      }

      /* De aquí abajo todo necesita una sesión viva. */
      const sesion = sesionDe(bd, tokenDe(req));

      if (ruta === '/api/sesion' && req.method === 'DELETE') {
        if (sesion) bd.prepare('DELETE FROM sesiones WHERE token = ?').run(sesion.token);
        responder(res, 200, { ok: true });
        return;
      }

      if (!sesion) { responder(res, 401, { error: 'sin-sesion' }); return; }

      if (ruta === '/api/progreso' && req.method === 'GET') {
        responder(res, 200, leerProgreso(bd, sesion.usuario_id));
        return;
      }

      /*
        Lo que ven los demás miembros: la tarjeta de «qué está leyendo fulano».

        Ojo con la diferencia, que es toda la seguridad de esto: `/api/progreso` (sin
        nada detrás) devuelve **tus** datos enteros y va por tu propia sesión;
        `/api/progreso/<id>` devuelve de cualquiera **solo un libro y un porcentaje**,
        con lo que cada uno haya decidido compartir. Nunca se cruzan.
      */
      if (ruta === '/api/miembros' && req.method === 'GET') {
        responder(res, 200, { miembros: fichasDeTodos(bd) });
        return;
      }

      const unMiembro = ruta.match(/^\/api\/progreso\/([0-9]{1,32})$/);
      if (unMiembro && req.method === 'GET') {
        const ficha = fichaDe(bd, unMiembro[1]);
        if (!ficha) { responder(res, 404, { error: 'no-existe' }); return; }
        responder(res, 200, ficha);
        return;
      }

      if (ruta === '/api/progreso' && req.method === 'PUT') {
        const cuerpo = await leerCuerpo(req);
        if (!cuerpo || typeof cuerpo !== 'object' || !cuerpo.datos) {
          responder(res, 400, { error: 'sin-datos' });
          return;
        }
        const hecho = guardarProgreso(bd, sesion.usuario_id, cuerpo.datos, cuerpo.baseVersion ?? 0);
        if (!hecho.ok) {
          responder(res, 409, { error: 'desfase', version: hecho.version, actualizadoEn: hecho.actualizadoEn, datos: hecho.datos });
          return;
        }
        registrar('guarda', sesion.nombre || sesion.usuario_id, `v${hecho.version}`, `${Math.round(hecho.bytes / 1024)} KB`);
        responder(res, 200, { version: hecho.version, actualizadoEn: hecho.actualizadoEn });
        return;
      }

      responder(res, 404, { error: 'no-existe' });
    } catch (error) {
      const motivo = String(error?.message || error);
      if (motivo === 'cuerpo-demasiado-grande') { responder(res, 413, { error: motivo }); return; }
      if (motivo === 'json-invalido') { responder(res, 400, { error: motivo }); return; }
      registrar('fallo', motivo);
      responder(res, 500, { error: 'fallo-interno' });
    }
  });

  // Una barrida de sesiones caducadas al arrancar y una cada hora. `unref` para que
  // este reloj no impida que el proceso termine cuando se le pide que termine.
  limpiarSesiones(bd);
  const reloj = setInterval(() => limpiarSesiones(bd), 60 * 60 * 1000);
  reloj.unref?.();
  servidor.on('close', () => clearInterval(reloj));

  return { servidor, base: bd };
}

/* -------------------------------------------------------------------- el arranque */

const esElPrograma = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (esElPrograma) {
  const { servidor } = crearServidor();
  servidor.listen(PUERTO, HOST, () => {
    registrar(`Yoru sync escuchando en ${HOST}:${PUERTO}`);
    registrar(`Servidor de Discord: ${GUILD_YORU}`);
  });
  for (const senal of ['SIGINT', 'SIGTERM']) {
    process.on(senal, () => { registrar('cerrando'); servidor.close(() => process.exit(0)); });
  }
}
