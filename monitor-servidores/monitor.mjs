/**
 * Monitor de los servidores de Yoru: un programa aparte de la app.
 *
 * En el PC de zams viven cuatro cosas de las que depende la app de todo el mundo:
 * Tailscale (con Funnel, que es la puerta a internet), el servidor de sincronización,
 * Kavita y Audiobookshelf. Si una está apagada, la app solo sabe decir «no responde».
 * Este programa dice cuál es, en qué punto se corta, y la enciende.
 *
 * Como `servidor-sync/`, usa solo lo que trae Node: no hay nada que instalar.
 *
 *   node monitor-servidores/monitor.mjs            abre el panel y enciende lo apagado
 *   node monitor-servidores/monitor.mjs --estado   lo dice en la consola y termina
 *   node monitor-servidores/monitor.mjs --sin-navegador   se queda vigilando, sin ventana
 *
 * Cada servicio se mira por pasos, de dentro afuera, porque «no funciona» son varias
 * averías distintas: el programa no está abierto, está abierto pero no contesta,
 * contesta pero la clave no vale, o todo va en el PC y es Funnel quien no lo saca.
 */

import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

/* ── Configuración ─────────────────────────────────────────────────────────── */

/**
 * Todo tiene un valor que ya sirve en el PC de zams; las variables de entorno están
 * para el día que algo se mude de carpeta o de puerto.
 */
export function leerConfig(env = process.env) {
  const host = env.YORU_MONITOR_HOST || 'desktop-go1ujdd.tail6db786.ts.net';
  return {
    puertoPanel: Number(env.YORU_MONITOR_PUERTO) || 3748,
    host,
    carpetaSync: env.YORU_MONITOR_SYNC_DIR || join(AQUI, '..', 'servidor-sync'),
    tareaSync: env.YORU_MONITOR_SYNC_TAREA || 'Yoru sync',
    kavitaExe: env.YORU_MONITOR_KAVITA_EXE || 'C:\\Kavita\\Kavita.exe',
    absExe: env.YORU_MONITOR_ABS_EXE || 'C:\\Audiobookshelf\\AudiobookshelfTray.exe',
    tailscaleExe: env.YORU_MONITOR_TAILSCALE_EXE || 'tailscale',
    carpetaDatos: env.YORU_MONITOR_DATOS || join(AQUI, 'datos'),
    cadaMs: 10_000,
    /** No se reintenta encender lo mismo más de una vez por minuto. */
    pausaReintentoMs: 60_000,
    /** Cuánto se espera a que un programa recién abierto empiece a contestar. */
    esperaArranqueMs: 40_000,
  };
}

/**
 * Los tres servidores que hablan HTTP. Los puertos son los de siempre: los locales
 * los pone cada programa, y los de Funnel son los únicos tres que Funnel sirve.
 */
export function definirServicios(cfg) {
  return [
    {
      id: 'sync',
      nombre: 'Sincronización de Yoru',
      siFalla: 'Nadie puede entrar con Discord ni guardar su progreso, y la app no recibe las claves de Kavita y Audiobookshelf.',
      local: 'http://127.0.0.1:3747/api/salud',
      publico: `https://${cfg.host}/api/salud`,
      puertoFunnel: 443,
      destinoFunnel: 'http://127.0.0.1:3747',
    },
    {
      id: 'kavita',
      nombre: 'Kavita',
      siFalla: 'La app no puede mostrar ni abrir los libros de Kavita.',
      proceso: 'kavita.exe',
      local: 'http://127.0.0.1:5000/api/health',
      publico: `https://${cfg.host}:8443/api/health`,
      puertoFunnel: 8443,
      destinoFunnel: 'http://localhost:5000',
      clave: 'YORU_SYNC_KAVITA_API_KEY',
    },
    {
      id: 'abs',
      nombre: 'Audiobookshelf',
      siFalla: 'La app no puede mostrar ni reproducir los audiolibros.',
      proceso: 'audiobookshelf.exe',
      local: 'http://127.0.0.1:13378/ping',
      publico: `https://${cfg.host}:10000/ping`,
      puertoFunnel: 10000,
      destinoFunnel: 'http://localhost:13378',
      clave: 'YORU_SYNC_ABS_TOKEN',
    },
  ];
}

/* ── Lo que toca el sistema: se puede cambiar entero en las pruebas ─────────── */

/** Por qué no llegó una petición, dicho para alguien que no va a leer un código de error. */
export function motivoDeRed(error, ms) {
  const codigo = error?.cause?.code || error?.code || '';
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return `no contestó en ${Math.round(ms / 1000)} s`;
  if (codigo === 'ECONNREFUSED') return 'nadie escucha en ese puerto';
  if (codigo === 'ENOTFOUND' || codigo === 'EAI_AGAIN') return 'el nombre no resuelve (sin internet o sin DNS)';
  if (codigo === 'ECONNRESET') return 'la conexión se cortó';
  if (/CERT|SSL|TLS/.test(codigo)) return 'falló el certificado';
  return codigo || error?.message || 'error de red';
}

async function pedirDeVerdad(url, { method = 'GET', headers, ms = 4000 } = {}) {
  const inicio = Date.now();
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), ms);
  try {
    const respuesta = await fetch(url, { method, headers, signal: control.signal, redirect: 'manual' });
    await respuesta.arrayBuffer().catch(() => {});
    return { status: respuesta.status, ms: Date.now() - inicio };
  } catch (error) {
    return { status: 0, ms: Date.now() - inicio, error: motivoDeRed(error, ms) };
  } finally {
    clearTimeout(reloj);
  }
}

function ejecutarDeVerdad(comando, argumentos = [], { ms = 15_000, cwd } = {}) {
  return new Promise((resolver) => {
    execFile(comando, argumentos, { timeout: ms, windowsHide: true, cwd, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolver({
        codigo: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
        salida: String(stdout || ''),
        error: String(stderr || '') || (error ? String(error.message || error) : ''),
      });
    });
  });
}

/** Abre un programa y lo suelta: tiene que seguir vivo cuando este monitor se cierre. */
function lanzarDeVerdad(comando, argumentos = [], { cwd } = {}) {
  try {
    const hijo = spawn(comando, argumentos, { cwd, detached: true, stdio: 'ignore', windowsHide: false });
    hijo.on('error', () => {});
    hijo.unref();
    return true;
  } catch {
    return false;
  }
}

export function entornoDeVerdad() {
  return {
    pedir: pedirDeVerdad,
    ejecutar: ejecutarDeVerdad,
    lanzar: lanzarDeVerdad,
    existe: existsSync,
    leer: (ruta) => { try { return readFileSync(ruta, 'utf8'); } catch { return null; } },
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
    ahora: () => Date.now(),
  };
}

/* ── Leer lo que hay ───────────────────────────────────────────────────────── */

/** `servidor-sync/.env`: las claves que el servidor reparte. Nunca salen de este proceso. */
export function leerClaves(texto) {
  const claves = {};
  for (const linea of String(texto || '').split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('#')) continue;
    const corte = limpia.indexOf('=');
    if (corte <= 0) continue;
    let valor = limpia.slice(corte + 1).trim();
    const comilla = valor.slice(0, 1);
    if (valor.length >= 2 && (comilla === '"' || comilla === "'") && valor.endsWith(comilla)) valor = valor.slice(1, -1);
    claves[limpia.slice(0, corte).trim()] = valor;
  }
  return claves;
}

/** Los nombres de los programas abiertos, en minúsculas, de `tasklist /FO CSV /NH`. */
export function procesosDe(salidaTasklist) {
  const nombres = new Set();
  for (const linea of String(salidaTasklist || '').split(/\r?\n/)) {
    const m = linea.match(/^"([^"]+)"/);
    if (m) nombres.add(m[1].toLowerCase());
  }
  return nombres;
}

function jsonO(texto) {
  try { return JSON.parse(texto); } catch { return null; }
}

/** Mismo destino aunque uno diga `localhost` y el otro `127.0.0.1`. */
function mismoDestino(a, b) {
  const puerto = (u) => { try { const x = new URL(u); return `${x.protocol}//${x.port || (x.protocol === 'https:' ? '443' : '80')}`; } catch { return String(u); } };
  return puerto(a) === puerto(b);
}

/**
 * Qué puertos de Funnel están bien puestos, de `tailscale funnel status --json`.
 * Un puerto vale si está abierto a internet (`AllowFunnel`) y reenvía a donde debe.
 */
export function funnelDe(json, servicios) {
  const web = json?.Web || {};
  const abierto = json?.AllowFunnel || {};
  const resultado = {};
  for (const s of servicios) {
    const sufijo = `:${s.puertoFunnel}`;
    const clave = Object.keys(web).find((k) => k.endsWith(sufijo));
    const destino = clave ? web[clave]?.Handlers?.['/']?.Proxy : '';
    const publico = Boolean(clave && abierto[clave]);
    let problema = '';
    if (!clave) problema = 'no está configurado';
    else if (!mismoDestino(destino, s.destinoFunnel)) problema = `apunta a ${destino || 'ningún sitio'} y debería ir a ${s.destinoFunnel}`;
    else if (!publico) problema = 'está solo dentro del tailnet, no abierto a internet';
    resultado[s.id] = { ok: !problema, problema };
  }
  return resultado;
}

/* ── El monitor ────────────────────────────────────────────────────────────── */

export function crearMonitor({ config = leerConfig(), entorno = entornoDeVerdad() } = {}) {
  const servicios = definirServicios(config);
  const cacheClaves = new Map();
  const VALIDEZ_CLAVE_MS = 5 * 60_000;

  const ts = (argumentos, opciones) => entorno.ejecutar(config.tailscaleExe, argumentos, opciones);

  function claves() {
    return leerClaves(entorno.leer(join(config.carpetaSync, '.env')));
  }

  /**
   * ¿El servidor acepta la clave que reparte el servidor de sincronización?
   * Es la avería más difícil de ver desde la app: todo está encendido y aun así no
   * entra, porque alguien regeneró la clave en Kavita y el `.env` se quedó con la vieja.
   * Se pregunta cada cinco minutos, no en cada vuelta: cada pregunta es un inicio de sesión.
   */
  async function comprobarClave(servicio, valor) {
    const guardada = cacheClaves.get(servicio.id);
    if (guardada && guardada.valor === valor && entorno.ahora() - guardada.cuando < VALIDEZ_CLAVE_MS) return guardada.resultado;
    const base = new URL(servicio.local).origin;
    const r = servicio.id === 'kavita'
      ? await entorno.pedir(`${base}/api/Plugin/authenticate?apiKey=${encodeURIComponent(valor)}&pluginName=YoruMonitor`, { method: 'POST' })
      : await entorno.pedir(`${base}/api/me`, { headers: { Authorization: `Bearer ${valor}` } });
    let resultado;
    if (r.status >= 200 && r.status < 300) resultado = { ok: true, detalle: 'el servidor la acepta' };
    else if (r.status === 401 || r.status === 403) resultado = { ok: false, detalle: `${servicio.nombre} la rechaza: se cambió allí y servidor-sync/.env tiene la vieja` };
    else resultado = { ok: false, detalle: r.error || `respondió ${r.status}` };
    // Solo se recuerda una respuesta clara; un fallo de red se vuelve a preguntar.
    if (resultado.ok || r.status === 401 || r.status === 403) cacheClaves.set(servicio.id, { valor, cuando: entorno.ahora(), resultado });
    return resultado;
  }

  async function estadoTailscale(procesos) {
    const pasos = [];
    const servicioVivo = procesos.has('tailscaled.exe');
    pasos.push({ nombre: 'Servicio de Windows', ok: servicioVivo, detalle: servicioVivo ? 'tailscaled está abierto' : 'tailscaled no está abierto' });

    let conectado = false;
    let backend = '';
    let funnel = {};
    if (servicioVivo) {
      const st = await ts(['status', '--json']);
      const json = jsonO(st.salida);
      backend = json?.BackendState || '';
      conectado = backend === 'Running';
      const porQue = {
        Stopped: 'está desconectado',
        NeedsLogin: 'hay que iniciar sesión en Tailscale',
        NeedsMachineAuth: 'el equipo espera aprobación en la consola de Tailscale',
        Starting: 'está arrancando',
        NoState: 'está arrancando',
      };
      pasos.push({
        nombre: 'Conectado al tailnet',
        ok: conectado,
        detalle: conectado ? (json?.Self?.TailscaleIPs?.[0] || 'conectado') : (porQue[backend] || st.error.trim().split('\n')[0] || 'no contesta'),
      });
      if (conectado) {
        const fs = await ts(['funnel', 'status', '--json']);
        funnel = funnelDe(jsonO(fs.salida), servicios);
        const malos = servicios.filter((s) => !funnel[s.id]?.ok);
        pasos.push({
          nombre: 'Funnel (salida a internet)',
          ok: malos.length === 0,
          detalle: malos.length === 0
            ? `puertos ${servicios.map((s) => s.puertoFunnel).join(', ')} abiertos`
            : malos.map((s) => `${s.puertoFunnel} (${s.nombre}): ${funnel[s.id].problema}`).join('; '),
        });
      }
    }
    const funnelBien = pasos[2]?.ok === true;
    return {
      id: 'tailscale',
      nombre: 'Tailscale',
      siFalla: 'Ningún miembro llega al PC desde fuera: para la app, los tres servidores están apagados.',
      estado: !servicioVivo || !conectado ? 'mal' : (funnelBien ? 'bien' : 'aviso'),
      pasos,
      backend,
      funnel,
      conectado,
    };
  }

  async function estadoHttp(servicio, procesos, tailscale, misClaves) {
    const pasos = [];
    if (servicio.proceso) {
      const abierto = procesos.has(servicio.proceso);
      pasos.push({ nombre: 'Programa abierto', ok: abierto, detalle: abierto ? servicio.proceso : `${servicio.proceso} no está abierto` });
    }
    const [local, publico] = await Promise.all([
      entorno.pedir(servicio.local, { ms: 4000 }),
      entorno.pedir(servicio.publico, { ms: 8000 }),
    ]);
    const localBien = local.status === 200;
    pasos.push({
      nombre: 'Contesta en este PC',
      ok: localBien,
      detalle: localBien ? `${local.ms} ms` : (local.error || `respondió ${local.status}`),
    });

    if (servicio.clave) {
      const valor = misClaves[servicio.clave];
      if (!valor) pasos.push({ nombre: 'Clave para la app', ok: false, detalle: `falta ${servicio.clave} en servidor-sync/.env` });
      else if (localBien) pasos.push({ nombre: 'Clave para la app', ...(await comprobarClave(servicio, valor)) });
      else cacheClaves.delete(servicio.id);
    } else if (servicio.id === 'sync') {
      const faltan = definirServicios(config).filter((s) => s.clave && !misClaves[s.clave]).map((s) => s.nombre);
      pasos.push({
        nombre: 'Claves para repartir',
        ok: faltan.length === 0,
        detalle: faltan.length === 0 ? 'tiene las de Kavita y Audiobookshelf' : `falta la de ${faltan.join(' y ')} en servidor-sync/.env`,
      });
    }

    const publicoBien = publico.status === 200;
    let detallePublico = `${publico.ms} ms`;
    if (!publicoBien) {
      if (!localBien) detallePublico = 'no puede, mientras no conteste en este PC';
      else if (!tailscale.conectado) detallePublico = 'no puede, mientras Tailscale esté desconectado';
      else if (tailscale.funnel[servicio.id] && !tailscale.funnel[servicio.id].ok) detallePublico = `Funnel: ${tailscale.funnel[servicio.id].problema}`;
      else detallePublico = publico.error || `respondió ${publico.status}`;
    }
    pasos.push({ nombre: 'Se alcanza desde internet', ok: publicoBien, detalle: detallePublico });

    return {
      id: servicio.id,
      nombre: servicio.nombre,
      siFalla: servicio.siFalla,
      estado: !localBien ? 'mal' : (pasos.every((p) => p.ok) ? 'bien' : 'aviso'),
      pasos,
    };
  }

  /** Una vuelta entera: qué está encendido y, si algo no, en qué paso se corta. */
  async function comprobar() {
    const lista = await entorno.ejecutar('tasklist', ['/FO', 'CSV', '/NH']);
    const procesos = procesosDe(lista.salida);
    const tailscale = await estadoTailscale(procesos);
    const misClaves = claves();
    const resto = await Promise.all(servicios.map((s) => estadoHttp(s, procesos, tailscale, misClaves)));
    const { funnel, conectado, backend, ...publicoDeTailscale } = tailscale;
    const todos = [publicoDeTailscale, ...resto];
    for (const s of todos) {
      const roto = s.pasos.find((p) => !p.ok);
      s.resumen = roto ? `${roto.nombre}: ${roto.detalle}` : 'Todo en orden';
    }
    return { cuando: new Date(entorno.ahora()).toISOString(), todoBien: todos.every((s) => s.estado === 'bien'), servicios: todos, _tailscale: { funnel, conectado, backend } };
  }

  /* ── Encender ────────────────────────────────────────────────────────────── */

  async function esperarLocal(servicio) {
    const limite = entorno.ahora() + config.esperaArranqueMs;
    while (entorno.ahora() < limite) {
      const r = await entorno.pedir(servicio.local, { ms: 3000 });
      if (r.status === 200) return true;
      await entorno.esperar(2000);
    }
    return false;
  }

  /** `start` de cmd: abre el programa en su propia ventana, minimizada, como un doble clic. */
  function abrirMinimizado(titulo, exe, argumentos = [], cwd) {
    return entorno.lanzar('cmd.exe', ['/c', 'start', titulo, '/min', exe, ...argumentos], { cwd });
  }

  async function encenderTailscale(estado) {
    const hechos = [];
    let procesos = procesosDe((await entorno.ejecutar('tasklist', ['/FO', 'CSV', '/NH'])).salida);
    if (!procesos.has('tailscaled.exe')) {
      // Arrancar un servicio de Windows pide permiso de administrador: sale el aviso de Windows.
      await entorno.ejecutar('powershell.exe', ['-NoProfile', '-Command', "Start-Process sc.exe -ArgumentList 'start','Tailscale' -Verb RunAs -WindowStyle Hidden"], { ms: 60_000 });
      hechos.push('pedí permiso para arrancar el servicio de Tailscale');
      for (let i = 0; i < 10; i += 1) {
        await entorno.esperar(1500);
        procesos = procesosDe((await entorno.ejecutar('tasklist', ['/FO', 'CSV', '/NH'])).salida);
        if (procesos.has('tailscaled.exe')) break;
      }
      if (!procesos.has('tailscaled.exe')) return { ok: false, mensaje: 'El servicio de Tailscale no arrancó. Acepta el aviso de Windows, o ábrelo desde Servicios.' };
    }
    let st = jsonO((await ts(['status', '--json'])).salida);
    if (st?.BackendState === 'NeedsLogin') return { ok: false, mensaje: 'Tailscale pide iniciar sesión: ábrelo desde la bandeja y entra con tu cuenta.' };
    if (st?.BackendState !== 'Running') {
      const up = await ts(['up'], { ms: 30_000 });
      hechos.push('conecté Tailscale');
      st = jsonO((await ts(['status', '--json'])).salida);
      if (st?.BackendState !== 'Running') return { ok: false, mensaje: `Tailscale no conectó: ${up.error.trim().split('\n')[0] || st?.BackendState || 'sin respuesta'}` };
    }
    const funnel = funnelDe(jsonO((await ts(['funnel', 'status', '--json'])).salida), servicios);
    for (const s of servicios) {
      if (funnel[s.id].ok) continue;
      const r = await ts(['funnel', '--bg', `--https=${s.puertoFunnel}`, s.destinoFunnel], { ms: 30_000 });
      if (r.codigo !== 0) return { ok: false, mensaje: `Funnel no aceptó el puerto ${s.puertoFunnel}: ${r.error.trim().split('\n')[0]}` };
      hechos.push(`abrí Funnel en el ${s.puertoFunnel}`);
    }
    return { ok: true, mensaje: hechos.length ? hechos.join(', ') : 'ya estaba en orden' };
  }

  async function encenderHttp(servicio) {
    if ((await entorno.pedir(servicio.local, { ms: 3000 })).status === 200) return { ok: true, mensaje: 'ya contestaba' };
    let como = '';
    if (servicio.id === 'sync') {
      // La tarea programada es la que sobrevive a un reinicio; si Windows no deja
      // lanzarla sin ser administrador, se abre el servidor a mano, que hace lo mismo.
      const tarea = await entorno.ejecutar('schtasks', ['/Run', '/TN', config.tareaSync]);
      como = 'lancé la tarea programada';
      if (tarea.codigo !== 0 || !(await esperarLocalCorto(servicio))) {
        if (!entorno.existe(join(config.carpetaSync, 'servidor.mjs'))) return { ok: false, mensaje: `No encuentro servidor.mjs en ${config.carpetaSync}` };
        abrirMinimizado('Yoru - servidor de sincronizacion', process.execPath, ['servidor.mjs'], config.carpetaSync);
        como = 'abrí el servidor en una ventana';
      }
    } else {
      const exe = servicio.id === 'kavita' ? config.kavitaExe : config.absExe;
      if (!entorno.existe(exe)) return { ok: false, mensaje: `No encuentro ${exe}. Si se instaló en otra carpeta, dilo en la variable de entorno (ver README).` };
      abrirMinimizado(servicio.nombre, exe, [], dirname(exe));
      como = `abrí ${servicio.nombre}`;
    }
    const vivo = await esperarLocal(servicio);
    return vivo
      ? { ok: true, mensaje: como }
      : { ok: false, mensaje: `${como}, pero sigue sin contestar tras ${Math.round(config.esperaArranqueMs / 1000)} s` };
  }

  async function esperarLocalCorto(servicio) {
    for (let i = 0; i < 4; i += 1) {
      await entorno.esperar(1500);
      if ((await entorno.pedir(servicio.local, { ms: 3000 })).status === 200) return true;
    }
    return false;
  }

  /** Enciende un servicio. Devuelve `{ ok, mensaje }`, y el mensaje vale para enseñarlo. */
  async function encender(id) {
    if (id === 'tailscale') return encenderTailscale();
    const servicio = servicios.find((s) => s.id === id);
    if (!servicio) return { ok: false, mensaje: `No conozco el servicio «${id}»` };
    return encenderHttp(servicio);
  }

  /**
   * Qué hace falta encender, visto un estado. Tailscale va primero y también cuando
   * solo le falla Funnel; los demás, solo si no contestan en el PC: una clave mala o
   * una salida a internet rota no se arreglan reabriendo el programa.
   */
  function loQueFalta(estado) {
    return estado.servicios
      .filter((s) => (s.id === 'tailscale' ? s.estado !== 'bien' : s.estado === 'mal'))
      .map((s) => s.id);
  }

  return { config, servicios, comprobar, encender, loQueFalta };
}

/* ── El programa: vigilar, recordar y servir el panel ──────────────────────── */

const NOMBRE_ARRANQUE = 'Yoru monitor de servidores.vbs';

function rutaArranque(env = process.env) {
  return env.APPDATA ? join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', NOMBRE_ARRANQUE) : '';
}

/**
 * El bucle: comprueba cada pocos segundos, apunta cada cambio, y enciende lo que se
 * caiga si la vigilancia está puesta. Al abrir enciende siempre lo apagado.
 */
export function crearVigilante({ monitor, entorno = entornoDeVerdad(), alApuntar = () => {}, vigilar = true } = {}) {
  const { config } = monitor;
  const registro = [];
  const encendiendo = new Set();
  const ultimoIntento = new Map();
  let ultimo = null;
  let antes = {};
  let ajustes = { vigilar };

  function apuntar(tipo, servicio, texto) {
    const linea = { cuando: new Date(entorno.ahora()).toISOString(), tipo, servicio, texto };
    registro.push(linea);
    if (registro.length > 200) registro.shift();
    alApuntar(linea);
  }

  async function vuelta() {
    const estado = await monitor.comprobar();
    for (const s of estado.servicios) {
      const previo = antes[s.id];
      if (previo && previo !== s.estado) {
        if (s.estado === 'bien') apuntar('bien', s.id, `${s.nombre} volvió a estar en orden`);
        else apuntar(s.estado, s.id, `${s.nombre}: ${s.resumen}`);
      } else if (!previo && s.estado !== 'bien') {
        apuntar(s.estado, s.id, `${s.nombre}: ${s.resumen}`);
      }
      antes[s.id] = s.estado;
    }
    ultimo = estado;
    return estado;
  }

  async function encender(id, motivo = 'a mano') {
    if (encendiendo.has(id)) return { ok: false, mensaje: 'ya se está encendiendo' };
    encendiendo.add(id);
    ultimoIntento.set(id, entorno.ahora());
    const nombre = id === 'tailscale' ? 'Tailscale' : monitor.servicios.find((s) => s.id === id)?.nombre || id;
    let resultado;
    try {
      resultado = await monitor.encender(id);
    } catch (error) {
      resultado = { ok: false, mensaje: String(error?.message || error) };
    } finally {
      encendiendo.delete(id);
    }
    apuntar(resultado.ok ? 'encendido' : 'fallo', id, `${nombre} (${motivo}): ${resultado.mensaje}`);
    return resultado;
  }

  /** Enciende lo que falte: Tailscale primero, porque lo demás sale por él. */
  async function encenderTodo(motivo = 'a mano') {
    const estado = ultimo || await vuelta();
    const faltan = monitor.loQueFalta(estado);
    const resultados = {};
    if (faltan.includes('tailscale')) resultados.tailscale = await encender('tailscale', motivo);
    await Promise.all(faltan.filter((id) => id !== 'tailscale').map(async (id) => { resultados[id] = await encender(id, motivo); }));
    if (faltan.length) await vuelta();
    return resultados;
  }

  /** Una vuelta del reloj: mirar y, si la vigilancia está puesta, reencender. */
  async function tic() {
    const estado = await vuelta();
    if (!ajustes.vigilar) return estado;
    const ahora = entorno.ahora();
    const faltan = monitor.loQueFalta(estado).filter((id) => !encendiendo.has(id) && ahora - (ultimoIntento.get(id) || 0) >= config.pausaReintentoMs);
    if (faltan.length) {
      if (faltan.includes('tailscale')) await encender('tailscale', 'vigilancia');
      await Promise.all(faltan.filter((id) => id !== 'tailscale').map((id) => encender(id, 'vigilancia')));
      return vuelta();
    }
    return estado;
  }

  return {
    vuelta,
    tic,
    encender,
    encenderTodo,
    ajustes: () => ajustes,
    ponerAjustes: (nuevos) => { ajustes = { ...ajustes, ...nuevos }; },
    cargarRegistro: (lineas) => { registro.push(...lineas.slice(-200)); },
    foto: () => {
      const { _tailscale, ...publico } = ultimo || { servicios: [], todoBien: false, cuando: null };
      return { ...publico, encendiendo: [...encendiendo], vigilar: ajustes.vigilar, registro: registro.slice(-60).reverse() };
    },
  };
}

function leerJson(ruta, porDefecto) {
  try { return JSON.parse(readFileSync(ruta, 'utf8')); } catch { return porDefecto; }
}

/**
 * El panel, solo para este PC. Encender programas no puede quedar al alcance de
 * cualquier página abierta en el navegador, así que escucha solo en 127.0.0.1, mira
 * la cabecera `Host` (contra el DNS rebinding) y todo lo que cambia algo exige una
 * cabecera con un testigo que solo conoce la página que este mismo proceso sirve.
 */
export function crearPanel({ vigilante, config, testigo = randomBytes(18).toString('hex'), arranque = null, guardarAjustes = () => {} }) {
  const html = () => readFileSync(join(AQUI, 'panel.html'), 'utf8').replace('__TESTIGO__', testigo);
  const responder = (res, codigo, cuerpo, tipo = 'application/json; charset=utf-8') => {
    res.writeHead(codigo, { 'Content-Type': tipo, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo));
  };
  const foto = () => ({ ...vigilante.foto(), abrirConWindows: arranque ? arranque.puesto() : null });

  return createServer(async (req, res) => {
    const anfitrion = String(req.headers.host || '');
    if (anfitrion !== `127.0.0.1:${config.puertoPanel}` && anfitrion !== `localhost:${config.puertoPanel}`) { responder(res, 403, { error: 'solo desde este PC' }); return; }
    const ruta = new URL(req.url || '/', 'http://panel').pathname;
    try {
      if (req.method === 'GET' && ruta === '/') { responder(res, 200, html(), 'text/html; charset=utf-8'); return; }
      if (req.method === 'GET' && ruta === '/api/estado') { responder(res, 200, foto()); return; }
      if (req.method === 'GET' && ruta === '/api/quien') { responder(res, 200, { programa: 'yoru-monitor' }); return; }
      if (req.method !== 'POST') { responder(res, 404, { error: 'no existe' }); return; }
      if (req.headers['x-yoru-monitor'] !== testigo) { responder(res, 403, { error: 'falta el testigo' }); return; }

      if (ruta === '/api/comprobar') { await vigilante.vuelta(); responder(res, 200, foto()); return; }
      if (ruta === '/api/encender') { const resultados = await vigilante.encenderTodo(); responder(res, 200, { resultados, ...foto() }); return; }
      const uno = ruta.match(/^\/api\/encender\/([a-z]+)$/);
      if (uno) { const resultado = await vigilante.encender(uno[1]); await vigilante.vuelta(); responder(res, 200, { resultado, ...foto() }); return; }
      const vigilar = ruta.match(/^\/api\/vigilar\/(si|no)$/);
      if (vigilar) { vigilante.ponerAjustes({ vigilar: vigilar[1] === 'si' }); guardarAjustes(vigilante.ajustes()); responder(res, 200, foto()); return; }
      const conWindows = ruta.match(/^\/api\/abrir-con-windows\/(si|no)$/);
      if (conWindows && arranque) { conWindows[1] === 'si' ? arranque.poner() : arranque.quitar(); responder(res, 200, foto()); return; }
      responder(res, 404, { error: 'no existe' });
    } catch (error) {
      responder(res, 500, { error: String(error?.message || error) });
    }
  });
}

function pintarEnConsola(estado) {
  const marca = { bien: '[ OK ]', aviso: '[AVISO]', mal: '[ MAL ]' };
  for (const s of estado.servicios) {
    console.log(`${marca[s.estado]} ${s.nombre}`);
    for (const p of s.pasos) console.log(`         ${p.ok ? 'si' : 'NO'}  ${p.nombre}: ${p.detalle}`);
  }
}

async function principal(argumentos) {
  const config = leerConfig();
  const entorno = entornoDeVerdad();
  const monitor = crearMonitor({ config, entorno });

  if (argumentos.includes('--estado')) {
    const estado = await monitor.comprobar();
    pintarEnConsola(estado);
    process.exit(estado.todoBien ? 0 : 1);
  }

  const direccion = `http://127.0.0.1:${config.puertoPanel}/`;
  const abrirNavegador = () => { if (!argumentos.includes('--sin-navegador')) entorno.lanzar('cmd.exe', ['/c', 'start', '', direccion]); };

  mkdirSync(config.carpetaDatos, { recursive: true });
  const rutaRegistro = join(config.carpetaDatos, 'registro.jsonl');
  const rutaAjustes = join(config.carpetaDatos, 'ajustes.json');
  const vigilante = crearVigilante({
    monitor,
    entorno,
    vigilar: leerJson(rutaAjustes, {}).vigilar !== false,
    alApuntar: (linea) => { try { appendFileSync(rutaRegistro, `${JSON.stringify(linea)}\n`); } catch { /* el registro no puede tumbar al monitor */ } },
  });

  // Si ya hay un monitor abierto (por ejemplo, el que arranca con Windows), abrirlo
  // otra vez es pedirle lo mismo: encender lo apagado y enseñar el panel.
  const yaHay = await entorno.pedir(`${direccion}api/quien`, { ms: 1500 });
  if (yaHay.status === 200) {
    const resultados = await vigilante.encenderTodo('al abrir');
    for (const [id, r] of Object.entries(resultados)) console.log(`${id}: ${r.mensaje}`);
    abrirNavegador();
    return;
  }

  try {
    const viejas = readFileSync(rutaRegistro, 'utf8').trim().split('\n').slice(-200).map((l) => JSON.parse(l));
    vigilante.cargarRegistro(viejas);
  } catch { /* primera vez: no hay registro */ }

  const ruta = rutaArranque();
  const arranque = ruta ? {
    puesto: () => existsSync(ruta),
    poner: () => writeFileSync(ruta, `' Abre el monitor de servidores de Yoru sin ventana, al iniciar sesion.\r\nCreateObject("WScript.Shell").Run """${process.execPath}"" ""${join(AQUI, 'monitor.mjs')}"" --sin-navegador", 0, False\r\n`),
    quitar: () => rmSync(ruta, { force: true }),
  } : null;

  const panel = crearPanel({ vigilante, config, arranque, guardarAjustes: (a) => writeFileSync(rutaAjustes, JSON.stringify(a, null, 2)) });
  panel.on('error', (error) => { console.error(`No pude abrir el panel en el puerto ${config.puertoPanel}: ${error.message}`); process.exit(1); });
  panel.listen(config.puertoPanel, '127.0.0.1', async () => {
    console.log(`Monitor de servidores de Yoru: ${direccion}`);
    console.log('Cierra esta ventana para dejar de vigilar. Los servidores siguen encendidos.');
    abrirNavegador();
    await vigilante.vuelta();
    await vigilante.encenderTodo('al abrir');
    let ocupado = false;
    setInterval(async () => {
      if (ocupado) return;
      ocupado = true;
      try { await vigilante.tic(); } catch (error) { console.error(error?.message || error); } finally { ocupado = false; }
    }, config.cadaMs);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal(process.argv.slice(2));
}
