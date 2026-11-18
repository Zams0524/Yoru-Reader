/**
 * Prueba del servidor de sincronización, sin tocar Discord ni el disco.
 *
 * Levanta el servidor de verdad en un puerto libre, con la base en memoria y un
 * Discord de mentira, y recorre lo que de verdad puede salir mal: entrar sin estar en
 * el servidor, un token que no vale, Discord caído, dos aparatos escribiendo a la vez.
 * Lo último es lo que justifica la prueba entera: el día que el contador de versiones
 * se rompa, alguien perderá la posición de un libro y no sabrá por qué.
 *
 * Correr:  node servidor-sync/prueba.mjs
 */

import assert from 'node:assert/strict';
import { abrirBase, crearServidor, GUILD_YORU } from './servidor.mjs';

/** Un Discord de mentira: un mapa de token a lo que contestaría Discord. */
function discordDeMentira(cuentas) {
  return async (url, opciones) => {
    const token = String(opciones?.headers?.Authorization || '').replace(/^Bearer /, '');
    const cuenta = cuentas[token];
    if (!cuenta) return new Response('{"message":"401: Unauthorized"}', { status: 401 });
    if (cuenta.caido) return new Response('oops', { status: 500 });
    if (url.endsWith('/users/@me')) {
      return new Response(JSON.stringify({ id: cuenta.id, global_name: cuenta.nombre }), { status: 200 });
    }
    if (url.endsWith('/users/@me/guilds')) {
      return new Response(JSON.stringify(cuenta.guilds.map((id) => ({ id }))), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
}

const CUENTAS = {
  'tok-zams': { id: '111', nombre: 'zams', guilds: [GUILD_YORU, '999'] },
  'tok-otro': { id: '222', nombre: 'otro miembro', guilds: [GUILD_YORU] },
  'tok-fuera': { id: '333', nombre: 'de paso', guilds: ['999'] },
  'tok-caido': { id: '444', nombre: 'mala suerte', guilds: [GUILD_YORU], caido: true },
};

const base = abrirBase(':memory:');
const { servidor } = crearServidor({ base, fetchImpl: discordDeMentira(CUENTAS) });
await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
const raiz = `http://127.0.0.1:${servidor.address().port}`;

const pedir = (ruta, opciones = {}) => fetch(`${raiz}${ruta}`, {
  ...opciones,
  headers: { 'Content-Type': 'application/json', ...(opciones.headers || {}) },
  body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
});

const entrar = async (accessToken) => pedir('/api/sesion', { method: 'POST', cuerpo: { accessToken } });

let fallos = 0;
async function prueba(nombre, fn) {
  try {
    await fn();
    console.log(`  ok  ${nombre}`);
  } catch (error) {
    fallos++;
    console.error(`FALLA  ${nombre}\n       ${error.message}`);
  }
}

console.log('Servidor de sincronización de Yoru\n');

await prueba('responde que está vivo', async () => {
  const r = await pedir('/api/salud');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

await prueba('un miembro entra y recibe su token', async () => {
  const r = await entrar('tok-zams');
  assert.equal(r.status, 200);
  const datos = await r.json();
  assert.equal(datos.usuarioId, '111');
  assert.ok(datos.token.length >= 32);
});

await prueba('quien no está en el servidor no entra', async () => {
  const r = await entrar('tok-fuera');
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, 'no-miembro');
});

await prueba('un token que Discord no reconoce no entra', async () => {
  const r = await entrar('tok-inventado');
  assert.equal(r.status, 401);
});

await prueba('si Discord no responde, no se echa a nadie: se dice 503', async () => {
  const r = await entrar('tok-caido');
  assert.equal(r.status, 503);
});

await prueba('sin token no se lee el progreso de nadie', async () => {
  assert.equal((await pedir('/api/progreso')).status, 401);
  assert.equal((await pedir('/api/progreso', { headers: { Authorization: 'Bearer inventado' } })).status, 401);
});

await prueba('se guarda y se vuelve a leer', async () => {
  const { token } = await (await entrar('tok-zams')).json();
  const auth = { Authorization: `Bearer ${token}` };

  const vacio = await (await pedir('/api/progreso', { headers: auth })).json();
  assert.equal(vacio.version, 0);
  assert.equal(vacio.datos, null);

  const puesto = await pedir('/api/progreso', {
    method: 'PUT', headers: auth,
    cuerpo: { baseVersion: 0, datos: { profiles: [{ id: 'p1' }], profileData: { p1: { books: [{ id: 'b1' }] } } } },
  });
  assert.equal(puesto.status, 200);
  assert.equal((await puesto.json()).version, 1);

  const leido = await (await pedir('/api/progreso', { headers: auth })).json();
  assert.equal(leido.version, 1);
  assert.equal(leido.datos.profileData.p1.books[0].id, 'b1');
});

await prueba('cada miembro ve solo lo suyo', async () => {
  const { token } = await (await entrar('tok-otro')).json();
  const suyo = await (await pedir('/api/progreso', { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(suyo.datos, null, 'el progreso de zams no puede asomar aquí');
});

await prueba('dos aparatos a la vez: el segundo no pisa al primero', async () => {
  const { token } = await (await entrar('tok-zams')).json();
  const auth = { Authorization: `Bearer ${token}` };
  const { version } = await (await pedir('/api/progreso', { headers: auth })).json();

  // El teléfono escribe primero, partiendo de la versión que ambos leyeron.
  const telefono = await pedir('/api/progreso', { method: 'PUT', headers: auth, cuerpo: { baseVersion: version, datos: { quien: 'telefono' } } });
  assert.equal(telefono.status, 200);

  // El PC llega después con la misma versión de partida: se le dice que no, y se le
  // devuelve lo que hay para que lo combine.
  const pc = await pedir('/api/progreso', { method: 'PUT', headers: auth, cuerpo: { baseVersion: version, datos: { quien: 'pc' } } });
  assert.equal(pc.status, 409);
  const choque = await pc.json();
  assert.equal(choque.datos.quien, 'telefono');
  assert.equal(choque.version, version + 1);

  // Y con la versión al día, pasa.
  const otraVez = await pedir('/api/progreso', { method: 'PUT', headers: auth, cuerpo: { baseVersion: choque.version, datos: { quien: 'pc' } } });
  assert.equal(otraVez.status, 200);
});

await prueba('cerrar sesión deja el token inservible', async () => {
  const { token } = await (await entrar('tok-otro')).json();
  const auth = { Authorization: `Bearer ${token}` };
  assert.equal((await pedir('/api/sesion', { method: 'DELETE', headers: auth })).status, 200);
  assert.equal((await pedir('/api/progreso', { headers: auth })).status, 401);
});

/* ------------------------------------------- lo que un miembro ve de otro miembro */

/** Una biblioteca como la que sube la app, con lo justo para estas pruebas. */
function biblioteca({ titulo = 'よつばと!', ajustes = {} } = {}) {
  return {
    version: 2,
    activeProfileId: 'p1',
    profiles: [{ id: 'p1', name: 'zams' }],
    profileData: {
      p1: {
        settings: ajustes,
        books: [
          { id: 'b1', title: 'un libro viejo', lastRead: '2026-01-01T00:00:00.000Z', progress: { percent: 10 } },
          {
            id: 'b2', title: titulo, author: 'Azuma Kiyohiko',
            lastRead: '2026-11-18T10:00:00.000Z',
            chapters: [{ title: 'Capítulo 1' }, { title: 'Capítulo 2' }],
            progress: { percent: 42.6, currentChapter: 1 },
          },
          { id: 'b3', title: 'borrado', isDeleted: true, lastRead: '2026-11-19T00:00:00.000Z', progress: { percent: 99 } },
        ],
        wordStatuses: { 四葉: 'known' },
        srsData: { 四葉: { state: 2 } },
      },
    },
  };
}

async function subirComo(accessToken, datos) {
  const { token } = await (await entrar(accessToken)).json();
  const auth = { Authorization: `Bearer ${token}` };
  const { version } = await (await pedir('/api/progreso', { headers: auth })).json();
  const r = await pedir('/api/progreso', { method: 'PUT', headers: auth, cuerpo: { baseVersion: version, datos } });
  assert.equal(r.status, 200);
  return auth;
}

await prueba('un miembro ve qué lee otro: el último libro, no el borrado', async () => {
  await subirComo('tok-zams', biblioteca());
  const auth = await subirComo('tok-otro', biblioteca({ titulo: 'otra cosa' }));

  const ficha = await (await pedir('/api/progreso/111', { headers: auth })).json();
  assert.equal(ficha.nombre, 'zams');
  assert.equal(ficha.leyendo.titulo, 'よつばと!');
  assert.equal(ficha.leyendo.capitulo, 'Capítulo 2');
  assert.equal(ficha.leyendo.porcentaje, 43, 'el porcentaje se redondea');
});

await prueba('y no ve nada más de él', async () => {
  const auth = await subirComo('tok-otro', biblioteca({ titulo: 'otra cosa' }));
  const crudo = await (await pedir('/api/progreso/111', { headers: auth })).text();
  // Lo que importa no es lo que sale, sino lo que no sale: la ficha pública no puede
  // ser una copia de la cuenta de nadie.
  assert.ok(!crudo.includes('wordStatuses'), 'los estados de palabras no salen');
  assert.ok(!crudo.includes('srsData'), 'las tarjetas del SRS no salen');
  assert.ok(!crudo.includes('un libro viejo'), 'el resto de la biblioteca no sale');
  assert.ok(!crudo.includes('profileData'), 'la biblioteca entera no sale');
});

await prueba('la lista negra de Discord vale también aquí', async () => {
  await subirComo('tok-zams', biblioteca({ ajustes: { discordBlacklist: 'otra\nよつばと!\n' } }));
  const auth = await subirComo('tok-otro', biblioteca({ titulo: 'otra cosa' }));
  const ficha = await (await pedir('/api/progreso/111', { headers: auth })).json();
  assert.equal(ficha.leyendo, null, 'un libro escondido en Discord no asoma por aquí');
  assert.equal(ficha.comparte, false);
});

await prueba('quien apaga el compartir no sale', async () => {
  await subirComo('tok-zams', biblioteca({ ajustes: { shareReadingWithMembers: false } }));
  const auth = await subirComo('tok-otro', biblioteca({ titulo: 'otra cosa' }));
  const ficha = await (await pedir('/api/progreso/111', { headers: auth })).json();
  assert.equal(ficha.comparte, false);
  assert.equal(ficha.leyendo, null);
});

await prueba('sin sesión no se ve la ficha de nadie', async () => {
  assert.equal((await pedir('/api/progreso/111')).status, 401);
  assert.equal((await pedir('/api/miembros')).status, 401);
});

await prueba('la lista de miembros trae a todos los que han sincronizado', async () => {
  await subirComo('tok-zams', biblioteca());
  const auth = await subirComo('tok-otro', biblioteca({ titulo: 'otra cosa' }));
  const { miembros } = await (await pedir('/api/miembros', { headers: auth })).json();
  const ids = miembros.map((m) => m.usuarioId).sort();
  assert.deepEqual(ids, ['111', '222']);
  assert.equal(miembros.find((m) => m.usuarioId === '222').leyendo.titulo, 'otra cosa');
});

await prueba('preguntar por alguien que no existe es un 404, no un vacío', async () => {
  const auth = await subirComo('tok-otro', biblioteca({ titulo: 'otra cosa' }));
  assert.equal((await pedir('/api/progreso/987654321', { headers: auth })).status, 404);
});

await new Promise((listo) => servidor.close(listo));
base.close();

console.log(fallos ? `\n${fallos} prueba(s) fallaron` : '\nTodo en orden');
process.exit(fallos ? 1 : 0);
