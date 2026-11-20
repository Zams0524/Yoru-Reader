/**
 * Prueba del monitor, sin tocar el PC: ni programas, ni Tailscale, ni la red.
 *
 * Todo lo que el monitor le pregunta al sistema pasa por un «entorno» que aquí es de
 * mentira, así que se puede apagar Kavita, desconectar Tailscale o romper una clave
 * con una línea, y mirar dos cosas: que el panel diga la avería correcta, y que
 * «encender» lance justo lo que hace falta y nada más.
 *
 * Correr:  node monitor-servidores/prueba.mjs
 */

import assert from 'node:assert/strict';
import { crearMonitor, crearVigilante, crearPanel, leerConfig, leerClaves, procesosDe, funnelDe, definirServicios, motivoDeRed, resolverCarpetaSync } from './monitor.mjs';

const HOST = 'pc.ejemplo.ts.net';
const config = { ...leerConfig({ YORU_MONITOR_HOST: HOST, YORU_MONITOR_SYNC_DIR: '/sync', YORU_MONITOR_DATOS: '/datos' }), esperaArranqueMs: 10_000 };

const FUNNEL_BIEN = {
  Web: {
    [`${HOST}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3747' } } },
    [`${HOST}:8443`]: { Handlers: { '/': { Proxy: 'http://localhost:5000' } } },
    [`${HOST}:10000`]: { Handlers: { '/': { Proxy: 'http://localhost:13378' } } },
  },
  AllowFunnel: { [`${HOST}:443`]: true, [`${HOST}:8443`]: true, [`${HOST}:10000`]: true },
};

/**
 * Un PC de mentira. `mundo` dice qué está encendido; lanzar un programa lo enciende,
 * que es lo que pasa de verdad, y todo lo que se ejecuta queda apuntado en `ordenes`.
 */
function pcDeMentira(cambios = {}) {
  const mundo = {
    tailscaled: true, backend: 'Running', funnel: structuredClone(FUNNEL_BIEN), internet: true,
    sync: true, kavita: true, abs: true, tareaFunciona: true, uacAceptado: true,
    claveKavita: 'buena', claveAbs: 'buena',
    env: 'YORU_SYNC_KAVITA_API_KEY=buena\nYORU_SYNC_ABS_TOKEN=buena\n',
    ...cambios,
  };
  const ordenes = [];
  let reloj = 1_700_000_000_000;
  const puertos = { 3747: 'sync', 5000: 'kavita', 13378: 'abs' };
  const publicos = { '': 'sync', 8443: 'kavita', 10000: 'abs' };

  const entorno = {
    ahora: () => reloj,
    esperar: async (ms) => { reloj += ms; },
    existe: () => true,
    leer: (ruta) => (ruta.endsWith('.env') ? mundo.env : null),
    lanzar: (comando, argumentos) => {
      const linea = [comando, ...argumentos].join(' ');
      ordenes.push(`lanzar ${linea}`);
      if (/Kavita\.exe/.test(linea)) mundo.kavita = true;
      if (/AudiobookshelfTray/.test(linea)) mundo.abs = true;
      if (/servidor\.mjs/.test(linea)) mundo.sync = true;
      return true;
    },
    ejecutar: async (comando, argumentos = []) => {
      const linea = [comando, ...argumentos].join(' ');
      if (comando === 'tasklist') {
        const abiertos = [mundo.tailscaled && 'tailscaled.exe', mundo.kavita && 'Kavita.exe', mundo.abs && 'audiobookshelf.exe'].filter(Boolean);
        return { codigo: 0, salida: abiertos.map((n) => `"${n}","1","Console","1","1 K"`).join('\r\n'), error: '' };
      }
      if (!linea.endsWith('status --json')) ordenes.push(linea);   // las preguntas no son órdenes
      if (comando === 'schtasks') { if (mundo.tareaFunciona) mundo.sync = true; return { codigo: mundo.tareaFunciona ? 0 : 1, salida: '', error: 'Acceso denegado' }; }
      if (comando === 'powershell.exe') { if (mundo.uacAceptado) mundo.tailscaled = true; return { codigo: 0, salida: '', error: '' }; }
      if (linea === 'tailscale status --json') return { codigo: 0, salida: JSON.stringify({ BackendState: mundo.backend, Self: { TailscaleIPs: ['100.1.2.3'] } }), error: '' };
      if (linea === 'tailscale funnel status --json') return { codigo: 0, salida: JSON.stringify(mundo.funnel), error: '' };
      if (linea === 'tailscale up') { if (mundo.backend === 'Stopped') mundo.backend = 'Running'; return { codigo: 0, salida: '', error: '' }; }
      const abrir = linea.match(/^tailscale funnel --bg --https=(\d+) (\S+)$/);
      if (abrir) {
        mundo.funnel.Web[`${HOST}:${abrir[1]}`] = { Handlers: { '/': { Proxy: abrir[2] } } };
        mundo.funnel.AllowFunnel[`${HOST}:${abrir[1]}`] = true;
        return { codigo: 0, salida: '', error: '' };
      }
      return { codigo: 1, salida: '', error: `orden desconocida: ${linea}` };
    },
    pedir: async (direccion, opciones = {}) => {
      const url = new URL(direccion);
      if (url.hostname === HOST) {
        const cual = publicos[url.port];
        const sale = mundo.internet && mundo.tailscaled && mundo.backend === 'Running'
          && funnelDe(mundo.funnel, definirServicios(config))[cual]?.ok && mundo[cual];
        return sale ? { status: 200, ms: 80 } : { status: 0, ms: 8000, error: 'la conexión se cortó' };
      }
      const cual = puertos[url.port];
      if (!mundo[cual]) return { status: 0, ms: 3, error: 'nadie escucha en ese puerto' };
      if (url.pathname === '/api/Plugin/authenticate') return { status: url.searchParams.get('apiKey') === mundo.claveKavita ? 200 : 401, ms: 5 };
      if (url.pathname === '/api/me') return { status: opciones.headers?.Authorization === `Bearer ${mundo.claveAbs}` ? 200 : 401, ms: 5 };
      return { status: 200, ms: 4 };
    },
  };
  return { mundo, ordenes, entorno, monitor: crearMonitor({ config, entorno }) };
}

const de = (estado, id) => estado.servicios.find((s) => s.id === id);
const paso = (servicio, nombre) => servicio.pasos.find((p) => p.nombre === nombre);
let hechas = 0;
async function prueba(nombre, cuerpo) {
  try { await cuerpo(); hechas += 1; console.log(`  ok  ${nombre}`); }
  catch (error) { console.error(`  FALLA  ${nombre}`); throw error; }
}

console.log('Monitor de servidores');

await prueba('las piezas sueltas leen lo que Windows y Tailscale dicen de verdad', () => {
  assert.deepEqual([...procesosDe('"Kavita.exe","2580","Console","1","205,212 K"\r\n"tailscaled.exe","5400","Services","0","45 K"')], ['kavita.exe', 'tailscaled.exe']);
  assert.deepEqual(leerClaves('# nota\nA=1\nB="dos"\n\nC = tres '), { A: '1', B: 'dos', C: 'tres' });
  const f = funnelDe(FUNNEL_BIEN, definirServicios(config));
  assert.ok(f.sync.ok && f.kavita.ok && f.abs.ok);
  assert.equal(motivoDeRed({ cause: { code: 'ECONNREFUSED' } }, 4000), 'nadie escucha en ese puerto');
  assert.equal(motivoDeRed({ name: 'AbortError' }, 4000), 'no contestó en 4 s');
});

await prueba('con todo encendido, todo sale en verde', async () => {
  const { monitor } = pcDeMentira();
  const estado = await monitor.comprobar();
  assert.equal(estado.todoBien, true);
  assert.deepEqual(estado.servicios.map((s) => s.id), ['tailscale', 'sync', 'kavita', 'abs']);
  assert.deepEqual(monitor.loQueFalta(estado), []);
});

await prueba('Kavita cerrado: rojo, dice que el programa no está abierto, y encender lo abre', async () => {
  const { monitor, ordenes, mundo } = pcDeMentira({ kavita: false });
  const estado = await monitor.comprobar();
  const kavita = de(estado, 'kavita');
  assert.equal(kavita.estado, 'mal');
  assert.match(kavita.resumen, /Programa abierto/);
  assert.match(paso(kavita, 'Se alcanza desde internet').detalle, /mientras no conteste en este PC/);
  assert.equal(de(estado, 'abs').estado, 'bien');
  assert.deepEqual(monitor.loQueFalta(estado), ['kavita']);

  const r = await monitor.encender('kavita');
  assert.equal(r.ok, true);
  assert.equal(mundo.kavita, true);
  assert.equal(ordenes.filter((o) => o.startsWith('lanzar')).length, 1);
  assert.match(ordenes[0], /start Kavita \/min C:\\Kavita\\Kavita\.exe/);
  assert.equal((await monitor.comprobar()).todoBien, true);
});

await prueba('encender algo que ya contesta no lanza nada', async () => {
  const { monitor, ordenes } = pcDeMentira();
  const r = await monitor.encender('abs');
  assert.equal(r.ok, true);
  assert.deepEqual(ordenes, []);
});

await prueba('un programa que se abre pero no contesta se cuenta como fallo', async () => {
  const { monitor, entorno } = pcDeMentira({ abs: false });
  entorno.lanzar = () => true;
  const r = await monitor.encender('abs');
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /sigue sin contestar/);
});

await prueba('la sincronización usa la tarea programada, y si Windows no deja, abre el servidor', async () => {
  const conTarea = pcDeMentira({ sync: false });
  assert.equal((await conTarea.monitor.encender('sync')).ok, true);
  assert.deepEqual(conTarea.ordenes, ['schtasks /Run /TN Yoru sync']);

  const sinPermiso = pcDeMentira({ sync: false, tareaFunciona: false });
  const r = await sinPermiso.monitor.encender('sync');
  assert.equal(r.ok, true);
  assert.match(r.mensaje, /ventana/);
  assert.match(sinPermiso.ordenes[1], /^lanzar cmd\.exe \/c start .* servidor\.mjs$/);
});

await prueba('clave cambiada en Kavita: ámbar, lo dice, y no se intenta «encender»', async () => {
  const { monitor } = pcDeMentira({ claveKavita: 'otra' });
  const estado = await monitor.comprobar();
  const kavita = de(estado, 'kavita');
  assert.equal(kavita.estado, 'aviso');
  assert.match(paso(kavita, 'Clave para la app').detalle, /la rechaza/);
  assert.deepEqual(monitor.loQueFalta(estado), []);
  assert.ok(!JSON.stringify(estado).includes('buena'), 'la clave no sale en el estado');
});

await prueba('sin .env: avisa de qué clave falta, en cada servidor y en la sincronización', async () => {
  const { monitor } = pcDeMentira({ env: 'YORU_SYNC_ABS_TOKEN=buena\n' });
  const estado = await monitor.comprobar();
  assert.match(paso(de(estado, 'kavita'), 'Clave para la app').detalle, /falta YORU_SYNC_KAVITA_API_KEY/);
  assert.match(paso(de(estado, 'sync'), 'Claves para repartir').detalle, /falta la de Kavita/);
  assert.equal(de(estado, 'abs').estado, 'bien');
});

await prueba('Tailscale desconectado: todo lo demás queda en ámbar por la salida, y se reconecta', async () => {
  const { monitor, ordenes } = pcDeMentira({ backend: 'Stopped' });
  const estado = await monitor.comprobar();
  assert.equal(de(estado, 'tailscale').estado, 'mal');
  assert.match(de(estado, 'tailscale').resumen, /desconectado/);
  assert.equal(de(estado, 'kavita').estado, 'aviso');
  assert.match(paso(de(estado, 'kavita'), 'Se alcanza desde internet').detalle, /Tailscale esté desconectado/);
  assert.deepEqual(monitor.loQueFalta(estado), ['tailscale']);

  assert.equal((await monitor.encender('tailscale')).ok, true);
  assert.ok(ordenes.includes('tailscale up'));
  assert.equal((await monitor.comprobar()).todoBien, true);
});

await prueba('Tailscale sin sesión: no se puede arreglar solo, y lo dice', async () => {
  const { monitor } = pcDeMentira({ backend: 'NeedsLogin' });
  const r = await monitor.encender('tailscale');
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /iniciar sesión/);
});

await prueba('servicio de Tailscale parado: pide permiso a Windows y sigue', async () => {
  const { monitor, ordenes } = pcDeMentira({ tailscaled: false });
  assert.equal(de(await monitor.comprobar(), 'tailscale').pasos.length, 1);
  assert.equal((await monitor.encender('tailscale')).ok, true);
  assert.match(ordenes[0], /RunAs/);

  const rechazado = pcDeMentira({ tailscaled: false, uacAceptado: false });
  assert.equal((await rechazado.monitor.encender('tailscale')).ok, false);
});

await prueba('Funnel sin un puerto: ámbar en Tailscale y en ese servidor, y se vuelve a abrir solo ese', async () => {
  const funnel = structuredClone(FUNNEL_BIEN);
  delete funnel.Web[`${HOST}:8443`];
  const { monitor, ordenes } = pcDeMentira({ funnel });
  const estado = await monitor.comprobar();
  assert.equal(de(estado, 'tailscale').estado, 'aviso');
  assert.match(de(estado, 'tailscale').resumen, /8443 \(Kavita\): no está configurado/);
  assert.match(paso(de(estado, 'kavita'), 'Se alcanza desde internet').detalle, /Funnel: no está configurado/);
  assert.equal(de(estado, 'abs').estado, 'bien');
  assert.deepEqual(monitor.loQueFalta(estado), ['tailscale']);

  assert.equal((await monitor.encender('tailscale')).ok, true);
  assert.deepEqual(ordenes.filter((o) => o.includes('--bg')), ['tailscale funnel --bg --https=8443 http://localhost:5000']);
  assert.equal((await monitor.comprobar()).todoBien, true);
});

await prueba('Funnel solo dentro del tailnet o apuntando a otro sitio también cuenta como roto', () => {
  const servicios = definirServicios(config);
  const privado = structuredClone(FUNNEL_BIEN);
  privado.AllowFunnel[`${HOST}:443`] = false;
  assert.match(funnelDe(privado, servicios).sync.problema, /solo dentro del tailnet/);
  const torcido = structuredClone(FUNNEL_BIEN);
  torcido.Web[`${HOST}:10000`].Handlers['/'].Proxy = 'http://localhost:9999';
  assert.match(funnelDe(torcido, servicios).abs.problema, /debería ir a/);
  assert.equal(funnelDe(null, servicios).kavita.ok, false);
});

await prueba('al abrir enciende todo lo apagado, y lo deja apuntado', async () => {
  const { monitor, entorno, mundo } = pcDeMentira({ kavita: false, abs: false, backend: 'Stopped' });
  const vigilante = crearVigilante({ monitor, entorno });
  await vigilante.vuelta();
  const resultados = await vigilante.encenderTodo('al abrir');
  assert.deepEqual(Object.keys(resultados).sort(), ['abs', 'kavita', 'tailscale']);
  assert.ok(mundo.kavita && mundo.abs && mundo.backend === 'Running');
  const foto = vigilante.foto();
  assert.equal(foto.todoBien, true);
  assert.equal(foto.registro.filter((l) => l.tipo === 'encendido').length, 3);
  assert.ok(!('_tailscale' in foto));
});

await prueba('la vigilancia reenciende lo que se cae, pero no más de una vez por minuto', async () => {
  const { monitor, entorno, mundo, ordenes } = pcDeMentira();
  const vigilante = crearVigilante({ monitor, entorno });
  await vigilante.tic();
  assert.deepEqual(ordenes, []);

  mundo.kavita = false;
  entorno.lanzar = (comando, argumentos) => { ordenes.push(`lanzar ${argumentos.join(' ')}`); return true; };   // se abre pero no arranca
  await vigilante.tic();
  await vigilante.tic();
  assert.equal(ordenes.filter((o) => o.startsWith('lanzar')).length, 1, 'un solo intento dentro del minuto');
  await entorno.esperar(config.pausaReintentoMs);
  await vigilante.tic();
  assert.equal(ordenes.filter((o) => o.startsWith('lanzar')).length, 2);
  assert.ok(vigilante.foto().registro.some((l) => l.tipo === 'mal' && /Kavita/.test(l.texto)));
});

await prueba('con la vigilancia quitada, mira pero no toca', async () => {
  const { monitor, entorno, ordenes } = pcDeMentira({ abs: false });
  const vigilante = crearVigilante({ monitor, entorno, vigilar: false });
  const estado = await vigilante.tic();
  assert.equal(de(estado, 'abs').estado, 'mal');
  assert.deepEqual(ordenes, []);
});

await prueba('el panel solo obedece a su propia página', async () => {
  const { monitor, entorno, mundo } = pcDeMentira({ kavita: false });
  const vigilante = crearVigilante({ monitor, entorno });
  await vigilante.vuelta();
  const puerto = 39000 + Math.floor(Math.random() * 2000);
  const panel = crearPanel({ vigilante, config: { ...config, puertoPanel: puerto }, testigo: 'secreto' });
  await new Promise((r) => panel.listen(puerto, '127.0.0.1', r));
  const base = `http://127.0.0.1:${puerto}`;
  try {
    const pagina = await (await fetch(`${base}/`)).text();
    assert.ok(pagina.includes("const TESTIGO = 'secreto'"));

    const estado = await (await fetch(`${base}/api/estado`)).json();
    assert.equal(estado.servicios.find((s) => s.id === 'kavita').estado, 'mal');
    assert.equal(estado.abrirConWindows, null);

    assert.equal((await fetch(`${base}/api/encender`, { method: 'POST' })).status, 403);
    assert.equal((await fetch(`${base}/api/encender`, { method: 'POST', headers: { 'X-Yoru-Monitor': 'otro' } })).status, 403);
    assert.equal(mundo.kavita, false, 'sin testigo no se enciende nada');

    // Otra página que apunte su nombre a 127.0.0.1 (DNS rebinding) llega con otro Host.
    const { request } = await import('node:http');
    const conOtroHost = await new Promise((resolver) => {
      request({ host: '127.0.0.1', port: puerto, path: '/api/estado', headers: { Host: 'malo.ejemplo' } }, (res) => resolver(res.statusCode)).end();
    });
    assert.equal(conOtroHost, 403);

    const r = await fetch(`${base}/api/encender`, { method: 'POST', headers: { 'X-Yoru-Monitor': 'secreto' } });
    const cuerpo = await r.json();
    assert.equal(cuerpo.resultados.kavita.ok, true);
    assert.equal(cuerpo.todoBien, true);

    const sinVigilar = await (await fetch(`${base}/api/vigilar/no`, { method: 'POST', headers: { 'X-Yoru-Monitor': 'secreto' } })).json();
    assert.equal(sinVigilar.vigilar, false);
  } finally {
    panel.close();
  }
});

await prueba('en otra copia del repositorio, las claves se buscan donde corre el servidor de verdad', async () => {
  const xml = '<Task><Actions><Exec><Command>node</Command><WorkingDirectory>C:\\repo\\servidor-sync</WorkingDirectory></Exec></Actions></Task>';
  const entorno = (hay) => ({ existe: (ruta) => hay.some((h) => ruta.includes(h)), ejecutar: async () => ({ codigo: 0, salida: xml, error: '' }) });
  const cfg = { carpetaSync: '/copia/servidor-sync', tareaSync: 'Yoru sync' };
  assert.equal(await resolverCarpetaSync(cfg, entorno(['/copia/servidor-sync']), {}), '/copia/servidor-sync');
  assert.equal(await resolverCarpetaSync(cfg, entorno(['C:\\repo']), {}), 'C:\\repo\\servidor-sync');
  assert.equal(await resolverCarpetaSync(cfg, entorno([]), {}), '/copia/servidor-sync');
  assert.equal(await resolverCarpetaSync(cfg, entorno(['C:\\repo']), { YORU_MONITOR_SYNC_DIR: 'x' }), '/copia/servidor-sync');
});

console.log(`\n${hechas} pruebas, todas bien.`);
