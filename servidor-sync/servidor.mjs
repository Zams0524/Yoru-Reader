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
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ configuración */

/**
 * Lee `servidor-sync/.env`, que git ignora.
 *
 * Aquí viven las claves de Kavita y de Audiobookshelf, y por eso hace falta este
 * trozo de código en vez de pedirle a nadie que escriba variables de entorno en el
 * `.bat`: las claves tienen que estar en **un** sitio, ese sitio no puede subir al
 * repositorio, y el servidor se arranca con doble clic.
 *
 * Lo que ya venga del entorno manda sobre el fichero, para poder probar sin tocarlo.
 * Sin fichero no pasa nada: el servidor arranca igual y la sincronización funciona;
 * lo único que queda apagado es `/api/medios`.
 */
export function cargarEnvLocal(ruta = join(AQUI, '.env')) {
  let texto = '';
  try { texto = readFileSync(ruta, 'utf8'); } catch { return 0; }
  let puestas = 0;
  for (const linea of texto.split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('#')) continue;
    const corte = limpia.indexOf('=');
    if (corte <= 0) continue;
    const nombre = limpia.slice(0, corte).trim();
    let valor = limpia.slice(corte + 1).trim();
    const comilla = valor.slice(0, 1);
    const entrecomillado = valor.length >= 2
      && (comilla === '"' || comilla === "'")
      && valor.endsWith(comilla);
    if (entrecomillado) valor = valor.slice(1, -1);
    if (process.env[nombre] === undefined) { process.env[nombre] = valor; puestas += 1; }
  }
  return puestas;
}

cargarEnvLocal();

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

/* --------------------------------------------------- los servidores de medios */

function limpiarUrl(valor) {
  return String(valor || '').trim().replace(/\/+$/, '');
}

/**
 * Kavita y Audiobookshelf, con sus claves, para repartirlas solo a los miembros.
 *
 * Antes las dos claves venían escritas en el código de la app
 * (`frontend/config/serverDefaults.ts`), y como el repositorio es público eso era
 * publicarlas. Mientras los dos servidores solo escuchaban en `localhost` no
 * importaba demasiado, porque no había dirección a la que ir; en cuanto salen por
 * Funnel, dirección y clave están las dos publicadas y entra cualquiera.
 *
 * Ahora viven aquí, en un `.env` que no sube a ningún sitio, y las reparte
 * `/api/medios`, que exige sesión: es decir, haber entrado con Discord y estar en el
 * servidor de Yoru. La puerta pasa de «saber leer GitHub» a «ser miembro».
 *
 * Lo que esto **no** arregla: un miembro que abra las herramientas del navegador
 * sigue viendo la clave que le han dado, porque es su propia app la que habla con
 * Kavita. Para que la clave no saliera nunca de este PC haría falta que el tráfico
 * pasara por aquí en vez de ir directo. Queda anotado en el README.
 *
 * Dos direcciones por servidor porque no son la misma: `*_URL` es por dónde llega
 * este proceso, que está en el mismo PC (`localhost`), y `*_URL_PUBLICA` es por
 * dónde llega el teléfono de un miembro (la salida de Funnel). Si falta la pública
 * se manda la interna, que es lo que había antes.
 */
export const MEDIOS = {
  kavita: {
    campo: 'apiKey',
    interna: limpiarUrl(process.env.YORU_SYNC_KAVITA_URL || 'http://localhost:5000'),
    publica: limpiarUrl(process.env.YORU_SYNC_KAVITA_URL_PUBLICA || ''),
    clave: String(process.env.YORU_SYNC_KAVITA_API_KEY || '').trim(),
  },
  audiobookshelf: {
    campo: 'token',
    interna: limpiarUrl(process.env.YORU_SYNC_ABS_URL || 'http://localhost:13378'),
    publica: limpiarUrl(process.env.YORU_SYNC_ABS_URL_PUBLICA || ''),
    clave: String(process.env.YORU_SYNC_ABS_TOKEN || '').trim(),
  },
};

/**
 * Lo que se le da a un miembro con sesión. Un servidor sin clave sale como `null`:
 * la app lo entiende como «esto no viene configurado» y pide configurarlo a mano,
 * que es exactamente lo que hacía antes de que existiera nada de esto.
 */
export function credencialesMedios(medios = MEDIOS) {
  const salida = {};
  for (const [nombre, m] of Object.entries(medios)) {
    salida[nombre] = m.clave
      ? { serverUrl: m.publica || m.interna, [m.campo]: m.clave }
      : null;
  }
  return salida;
}

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
  // El nombre de usuario de Discord, además del nombre a la vista. Hace falta para
  // reconocer a alguien en la lista de Miembros, que sale del widget y unas veces trae
  // un nombre y otras el otro. En una base de antes la columna no existe: se añade.
  const columnas = base.prepare('PRAGMA table_info(usuarios)').all().map((columna) => columna.name);
  if (!columnas.includes('alias')) base.exec("ALTER TABLE usuarios ADD COLUMN alias TEXT NOT NULL DEFAULT ''");
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
      alias: String(usuario.datos.username || ''),
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
    INSERT INTO usuarios (id, nombre, alias, version, actualizado, creado, datos)
    VALUES (?, ?, ?, 0, 0, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, alias = excluded.alias
  `).run(usuario.id, usuario.nombre, String(usuario.alias || ''), ahora);
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
 * Lo que un miembro ve de otro: su perfil de lectura, y nada más que eso.
 *
 * Hasta el 20 nov 2026 esto era **un libro y un porcentaje**. zams pidió que la
 * tarjeta de Miembros enseñara el perfil del otro como se ve el propio: sus libros,
 * sus audiolibros y por dónde va en cada uno, y si está leyendo o escuchando ahora.
 * Así que ahora salen las dos listas, con título, autor, portada y avance.
 *
 * Lo que sigue sin salir nunca, y es la razón de que esto se construya campo a campo
 * en vez de devolver el bulto: los estados de cada palabra, las tarjetas del SRS, los
 * ajustes, el texto de los libros y los identificadores internos. La app sube la
 * cuenta entera; aquí se saca de ella una estantería.
 *
 * Y se respeta lo que cada uno ya había decidido sobre enseñar lo que lee:
 *
 *  - `shareReadingWithMembers: false` → no se enseña nada.
 *  - La lista negra de Discord (`discordBlacklist`) vale también aquí, con la misma
 *    regla que en `discordRpc.ts`: un título por línea, comparado en minúsculas. Un
 *    libro escondido allí no sale en ninguna lista, y si es justo el último que se
 *    abrió, no se enseña nada: decir «leyó otra cosa hace un mes» sería mentir.
 */

/**
 * Cuánto dura «ahora».
 *
 * La app sube el progreso cada cinco minutos mientras se lee, así que lo que aquí se
 * sabe de alguien tiene hasta cinco minutos de retraso. Con doce de margen, quien
 * está leyendo sale como «leyendo ahora» sin parpadear entre subida y subida, y
 * quien cerró el libro deja de salir al cabo de un rato razonable.
 */
export const VENTANA_AHORA_MS = 12 * 60 * 1000;

/** Una portada incrustada (`data:`) más grande que esto no viaja: sale sin portada. */
const MAX_PORTADA = 120_000;
/** Y entre todas las de un perfil, hasta aquí. Las de después salen sin portada. */
const MAX_PORTADAS_PERFIL = 1_500_000;
const MAX_LISTA = 300;

function momento(texto) {
  return Date.parse(texto || '') || 0;
}

function porcentaje(valor) {
  return Math.max(0, Math.min(100, Math.round(Number(valor) || 0)));
}

function portadaSegura(libro) {
  if (!libro || libro.hideCover) return '';
  const portada = String(libro.cover || '');
  if (/^https?:\/\//i.test(portada)) return portada.length <= 2000 ? portada : '';
  if (/^data:image\//i.test(portada)) return portada.length <= MAX_PORTADA ? portada : '';
  return '';
}

/** El estante de un libro, con el mismo respaldo por progreso que `bookStatus` en la app. */
function estadoLibro(libro) {
  const avance = Number(libro?.progress?.percent) || 0;
  const estado = String(libro?.status || (avance === 0 ? 'unread' : avance >= 100 ? 'completed' : 'reading'));
  if (estado === 'completed') return 'completado';
  if (estado === 'paused' || estado === 'planning') return 'pendiente';
  if (estado === 'unread') return 'por-empezar';
  return 'leyendo';
}

/** El perfil activo, si su dueño comparte, y su lista negra. */
function loCompartido(datos) {
  const perfiles = Array.isArray(datos?.profiles) ? datos.profiles : [];
  const perfilId = datos?.activeProfileId || perfiles[0]?.id;
  const perfil = perfilId ? datos?.profileData?.[perfilId] : null;
  if (!perfil) return { comparte: true, perfil: null, negra: [] };

  const ajustes = perfil.settings || {};
  // Por defecto sí se comparte: la tarjeta de Miembros es la razón de que esto exista.
  // Quien no quiera, lo apaga en Ajustes y deja de salir desde la siguiente subida.
  if (ajustes.shareReadingWithMembers === false) return { comparte: false, perfil: null, negra: [] };

  const negra = String(ajustes.discordBlacklist || '')
    .split('\n').map((linea) => linea.trim().toLowerCase()).filter(Boolean);
  return { comparte: true, perfil, negra };
}

/**
 * Los libros de un perfil: los importados y las series que lee en Kavita sin
 * importarlas, lo último abierto primero. `fuente` es el libro de verdad, para sacar
 * la portada después; no sale nunca en una respuesta.
 */
function librosDe(perfil) {
  const salida = [];
  for (const libro of Array.isArray(perfil.books) ? perfil.books : []) {
    if (!libro || libro.isDeleted) continue;
    const progreso = libro.progress || {};
    const capitulo = Array.isArray(libro.chapters) ? libro.chapters[progreso.currentChapter] : null;
    salida.push({
      origen: 'local',
      titulo: String(libro.title || ''),
      autor: String(libro.author || ''),
      capitulo: capitulo ? String(capitulo.title || '') : '',
      porcentaje: porcentaje(progreso.percent),
      estado: estadoLibro(libro),
      ultimaLectura: momento(libro.lastRead),
      fuente: libro,
    });
  }

  // Un tomo por serie, el que se abrió más tarde: lo mismo que `localKavitaSeriesRead`.
  const porSerie = new Map();
  const kavita = perfil.serverProgress?.kavita;
  for (const entrada of Object.values(kavita && typeof kavita === 'object' ? kavita : {})) {
    if (!entrada || entrada.borrado || !entrada.seriesId) continue;
    const actual = porSerie.get(entrada.seriesId);
    if (!actual || momento(entrada.at) > momento(actual.at)) porSerie.set(entrada.seriesId, entrada);
  }
  for (const entrada of porSerie.values()) {
    const avance = porcentaje(entrada.percent);
    salida.push({
      origen: 'kavita',
      seriesId: Number(entrada.seriesId) || 0,
      volumeId: Number(entrada.volumeId) || 0,
      titulo: String(entrada.seriesName || entrada.volumeTitle || 'Kavita'),
      autor: '',
      capitulo: entrada.seriesName ? String(entrada.volumeTitle || '') : '',
      porcentaje: avance,
      estado: avance >= 99 ? 'completado' : 'leyendo',
      ultimaLectura: momento(entrada.at),
      fuente: null,
    });
  }

  return salida.sort((a, b) => b.ultimaLectura - a.ultimaLectura);
}

/** Los audiolibros que ha escuchado un perfil, lo último primero. */
function audiolibrosDe(perfil) {
  const salida = [];
  const audio = perfil.serverProgress?.audiobooks;
  for (const [itemId, entrada] of Object.entries(audio && typeof audio === 'object' ? audio : {})) {
    if (!entrada || entrada.borrado) continue;
    const dura = Number(entrada.duration) || 0;
    salida.push({
      itemId: String(itemId),
      titulo: String(entrada.title || ''),
      autor: String(entrada.author || ''),
      porcentaje: dura > 0 ? porcentaje(((Number(entrada.currentTime) || 0) / dura) * 100) : 0,
      ultimaEscucha: momento(entrada.at),
    });
  }
  return salida.sort((a, b) => b.ultimaEscucha - a.ultimaEscucha);
}

/**
 * Todo lo que se puede enseñar de una cuenta, ya limpio. No depende de la hora: lo
 * que sí depende («¿está leyendo ahora?») lo pone `actividadAhora` al contestar, y
 * así esto se puede guardar entre una subida y la siguiente.
 */
export function resumenPublico(datos) {
  const { comparte, perfil, negra } = loCompartido(datos);
  const nada = { comparte, leyendo: null, escuchando: null, libros: [], audiolibros: [] };
  if (!perfil) return nada;

  const escondido = (titulo) => negra.includes(String(titulo || '').toLowerCase());
  const todos = librosDe(perfil);
  const ultimo = todos.find((libro) => libro.ultimaLectura > 0) || null;
  if (ultimo && escondido(ultimo.titulo)) return { ...nada, comparte: false };

  let gastado = 0;
  const libros = todos.filter((libro) => !escondido(libro.titulo)).slice(0, MAX_LISTA).map((libro) => {
    const { fuente, ...limpio } = libro;
    let portada = portadaSegura(fuente);
    if (gastado + portada.length > MAX_PORTADAS_PERFIL) portada = '';
    gastado += portada.length;
    return { ...limpio, portada };
  });
  const audiolibros = audiolibrosDe(perfil).filter((item) => !escondido(item.titulo)).slice(0, MAX_LISTA);

  return {
    comparte: true,
    leyendo: libros.find((libro) => libro.ultimaLectura > 0) || null,
    escuchando: audiolibros.find((item) => item.ultimaEscucha > 0) || null,
    libros,
    audiolibros,
  };
}

/** `'leyendo'`, `'escuchando'` o `null`: lo último que hizo, si fue hace nada. */
export function actividadAhora(resumen, ahora = Date.now()) {
  const leyo = resumen.leyendo?.ultimaLectura || 0;
  const escucho = resumen.escuchando?.ultimaEscucha || 0;
  const ultimo = Math.max(leyo, escucho);
  if (!ultimo || ahora - ultimo >= VENTANA_AHORA_MS) return null;
  return escucho > leyo ? 'escuchando' : 'leyendo';
}

/** Qué está leyendo y escuchando alguien, sin sus listas. Lo que usa la tarjeta. */
export function queEstaLeyendo(datos, ahora = Date.now()) {
  const { comparte, leyendo, escuchando } = resumenPublico(datos);
  return { comparte, leyendo, escuchando, ahora: actividadAhora({ leyendo, escuchando }, ahora) };
}

/**
 * El resumen de cada cuenta, guardado hasta que vuelva a subir.
 *
 * La lista de Miembros se pregunta cada minuto desde cada app abierta, y sin esto
 * cada pregunta volvería a leer y trocear la biblioteca entera de todo el mundo, que
 * son megas. La versión cambia con cada subida, así que sirve de llave.
 */
const resumenes = new WeakMap();

function resumenDe(base, usuarioId) {
  let guardados = resumenes.get(base);
  if (!guardados) { guardados = new Map(); resumenes.set(base, guardados); }
  const fila = base.prepare('SELECT version FROM usuarios WHERE id = ?').get(usuarioId);
  const version = Number(fila?.version || 0);
  const previo = guardados.get(usuarioId);
  if (previo && previo.version === version) return previo.resumen;
  const resumen = resumenPublico(leerProgreso(base, usuarioId).datos);
  guardados.set(usuarioId, { version, resumen });
  return resumen;
}

/**
 * La ficha pública de un miembro: quién es, qué lee y qué escucha. Nunca sus datos.
 * Con `conPerfil` lleva además sus dos listas, que es lo que abre «Ver perfil».
 */
export function fichaDe(base, usuarioId, { conPerfil = false, ahora = Date.now() } = {}) {
  const fila = base.prepare('SELECT id, nombre, alias, actualizado FROM usuarios WHERE id = ?').get(usuarioId);
  if (!fila) return null;
  const { comparte, leyendo, escuchando, libros, audiolibros } = resumenDe(base, usuarioId);
  const nombre = String(fila.nombre || '');
  const alias = [...new Set([nombre, String(fila.alias || '')].filter(Boolean))];
  return {
    usuarioId: String(fila.id),
    nombre,
    alias,
    actualizadoEn: Number(fila.actualizado || 0),
    comparte,
    leyendo,
    escuchando,
    ahora: actividadAhora({ leyendo, escuchando }, ahora),
    ...(conPerfil ? { perfil: { libros, audiolibros } } : {}),
  };
}

/** Todos los que alguna vez han sincronizado, del más reciente al más antiguo. */
export function fichasDeTodos(base, ahora = Date.now()) {
  const filas = base.prepare('SELECT id FROM usuarios WHERE datos IS NOT NULL ORDER BY actualizado DESC').all();
  return filas.map((fila) => fichaDe(base, fila.id, { ahora })).filter(Boolean);
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

      /*
        Las claves de Kavita y de Audiobookshelf, para quien sea miembro.

        Va aquí abajo a propósito, debajo del `if (!sesion)`: sin sesión viva esto
        contesta 401 y no suelta nada. Es toda la diferencia entre repartir una clave
        entre los miembros y publicarla.
      */
      if (ruta === '/api/medios' && req.method === 'GET') {
        responder(res, 200, credencialesMedios());
        return;
      }

      const unMiembro = ruta.match(/^\/api\/progreso\/([0-9]{1,32})$/);
      if (unMiembro && req.method === 'GET') {
        const ficha = fichaDe(bd, unMiembro[1], { conPerfil: true });
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
    for (const [nombre, m] of Object.entries(MEDIOS)) {
      // Que se vea al arrancar, porque un `.env` que falta se nota tarde y mal: la
      // app dice «no responde» y a nadie se le ocurre mirar aquí.
      registrar(m.clave
        ? `${nombre}: se reparte a los miembros (${m.publica || m.interna})`
        : `${nombre}: sin clave en .env, no se reparte`);
    }
  });
  for (const senal of ['SIGINT', 'SIGTERM']) {
    process.on(senal, () => { registrar('cerrando'); servidor.close(() => process.exit(0)); });
  }
}
