// Las decisiones de la sincronización con el servidor de Yoru: `yoruSyncNucleo.ts`.
// Nada de red ni de almacenamiento, solo las decisiones.
// Ejecutar: node tests/run-yoru-sync-test.mjs
import {
  clasificarFallo,
  decidirSincronizacion,
  describirEstado,
  INTERVALO_SUBIDA_MS,
  MARGEN_TOKEN_MS,
  perfilSinNada,
  reconciliarPerfiles,
  sesionServidorValida,
  urlSync,
  type SesionServidor,
} from '../frontend/utils/yoruSyncNucleo';

let failures = 0;
function check(condicion: boolean, nombre: string) {
  if (condicion) {
    console.log(`  ok  ${nombre}`);
  } else {
    failures += 1;
    console.error(`FALLA  ${nombre}`);
  }
}

const AHORA = 1_700_000_000_000;
const SERVIDOR = 'https://desktop-go1ujdd.tail6db786.ts.net';

function datos(cambios: Partial<Parameters<typeof decidirSincronizacion>[0]> = {}) {
  return {
    urlServidor: SERVIDOR,
    haySesionDiscord: true,
    hayRed: true,
    ahora: AHORA,
    ultimaSubida: 0,
    forzada: false,
    ...cambios,
  };
}

function sesion(cambios: Partial<SesionServidor> = {}): SesionServidor {
  return { token: 'abc', usuarioId: '42', nombre: 'zams', expiraEn: AHORA + 60 * 60 * 1000, ...cambios };
}

function decisionTests() {
  console.log('\nCuándo se sincroniza');

  check(decidirSincronizacion(datos()) === 'adelante', 'con todo en su sitio, se sincroniza');

  check(
    decidirSincronizacion(datos({ urlServidor: '' })) === 'apagado',
    'sin dirección de servidor la función está apagada',
  );
  check(
    decidirSincronizacion(datos({ urlServidor: '   ' })) === 'apagado',
    'una dirección de solo espacios cuenta como vacía',
  );

  check(
    decidirSincronizacion(datos({ haySesionDiscord: false })) === 'sin-discord',
    'sin sesión de Discord no hay con qué identificarse',
  );

  check(
    decidirSincronizacion(datos({ hayRed: false })) === 'sin-red',
    'sin red no se intenta una petición condenada',
  );

  check(
    decidirSincronizacion(datos({ ultimaSubida: AHORA - 1000 })) === 'muy-pronto',
    'recién sincronizado, no se repite',
  );
  check(
    decidirSincronizacion(datos({ ultimaSubida: AHORA - INTERVALO_SUBIDA_MS - 1 })) === 'adelante',
    'pasado el intervalo, se vuelve a subir',
  );

  // Lo que pide el usuario a mano, y la sincronización de abrir la app, no esperan turno.
  check(
    decidirSincronizacion(datos({ ultimaSubida: AHORA - 1000, forzada: true })) === 'adelante',
    'una sincronización pedida a mano no espera su turno',
  );
  // ...pero ni siquiera forzada se salta lo que no depende del reloj.
  check(
    decidirSincronizacion(datos({ forzada: true, hayRed: false })) === 'sin-red',
    'ni forzada se inventa una red que no hay',
  );
  check(
    decidirSincronizacion(datos({ forzada: true, haySesionDiscord: false })) === 'sin-discord',
    'ni forzada se inventa una sesión de Discord',
  );
}

function sesionTests() {
  console.log('\nEl token del servidor');

  check(sesionServidorValida(sesion(), AHORA), 'un token con horas por delante vale');
  check(!sesionServidorValida(null, AHORA), 'sin sesión no vale');
  check(!sesionServidorValida(sesion({ token: '' }), AHORA), 'una sesión sin token no vale');
  check(!sesionServidorValida(sesion({ expiraEn: AHORA - 1 }), AHORA), 'un token caducado no vale');
  check(
    !sesionServidorValida(sesion({ expiraEn: AHORA + MARGEN_TOKEN_MS - 1 }), AHORA),
    'un token al que le queda menos que el margen tampoco: no se apura',
  );
}

function falloTests() {
  console.log('\nQué significa cada respuesta del servidor');

  // La distinción que importa: «caducó» se arregla solo pidiendo otro token; «no eres
  // miembro» no se arregla reintentando, y confundirlos deja a la app dando vueltas.
  check(clasificarFallo(401) === 'sesion-caducada', '401 es que el token caducó');
  check(clasificarFallo(403) === 'no-miembro', '403 es que esta cuenta no está en el servidor');
  check(clasificarFallo(409) === 'desfase', '409 es que otro aparato escribió entremedias');

  check(clasificarFallo(0) === 'servidor-no-responde', 'sin respuesta: no responde');
  check(clasificarFallo(503) === 'servidor-no-responde', '503 es que no responde');
  check(clasificarFallo(502) === 'servidor-no-responde', '502 es que no responde');
  check(clasificarFallo(504) === 'servidor-no-responde', '504 es que no responde');
  check(clasificarFallo(500) === 'otro', 'un 500 es otra cosa, y no se reintenta igual');
  check(clasificarFallo(400) === 'otro', 'un 400 es otra cosa');
}

function urlTests() {
  console.log('\nLas direcciones');

  check(urlSync(SERVIDOR, '/api/salud') === `${SERVIDOR}/api/salud`, 'la ruta se pega tal cual');
  check(urlSync(`${SERVIDOR}/`, '/api/salud') === `${SERVIDOR}/api/salud`, 'una barra de más no duplica');
  check(urlSync(`${SERVIDOR}///`, '/api/salud') === `${SERVIDOR}/api/salud`, 'ni tres barras de más');
  check(urlSync(` ${SERVIDOR} `, 'api/salud') === `${SERVIDOR}/api/salud`, 'sin barra en la ruta, se pone');
}

function textoTests() {
  console.log('\nLo que se le enseña al lector');

  // Nunca se culpa al lector de que el PC de zams esté apagado.
  check(describirEstado('servidor-no-responde').includes('no responde'), 'el servidor caído se dice tal cual');
  check(describirEstado('sin-red').includes('Sin conexión'), 'sin red se dice que volverá');
  check(describirEstado('muy-pronto') === describirEstado('al-dia'), 'no hace falta: al día, no «esperando»');
  check(describirEstado('apagado') === 'Desactivada', 'apagada se dice apagada');
}

function perfilesTests() {
  console.log('\nLos perfiles repetidos de una misma cuenta');

  const libro = { id: 'b1', title: 'よつばと!' };
  const lleno = { books: [libro], wordStatuses: { 猫: 'known' }, srsData: null };
  const vacioDatos = { books: [], wordStatuses: null, srsData: { _deck_Yoru: { name: 'Yoru' } } };
  const viejo = { id: 'profile-100', name: 'zams' };
  const nuevo = { id: 'profile-200', name: 'zams' };

  check(perfilSinNada(vacioDatos) && perfilSinNada(undefined), 'un perfil con solo un mazo vacío no guarda nada');
  check(!perfilSinNada(lleno), 'con un libro ya guarda algo');
  check(!perfilSinNada({ books: [{ ...libro, isDeleted: true }] }), 'un libro borrado cuenta: lleva estadísticas');
  check(!perfilSinNada({ srsData: { 猫: { due: 1 } } }), 'una tarjeta del SRS cuenta');

  // Datos borrados o app recién instalada: perfil nuevo y vacío aquí, el de siempre en el servidor.
  {
    const local = { activeProfileId: nuevo.id, profiles: [nuevo], profileData: { [nuevo.id]: vacioDatos } };
    const remoto = { activeProfileId: viejo.id, profiles: [viejo], profileData: { [viejo.id]: lleno } };
    const r = reconciliarPerfiles(local, remoto);
    check(r.cambioLocal && !r.cambioRemoto, 'recién instalada: cambia este aparato, no el servidor');
    check(r.local.activeProfileId === viejo.id, 'el perfil activo pasa a ser el que tiene el progreso');
    check(r.local.profiles.length === 0 && !(nuevo.id in r.local.profileData), 'y el vacío recién creado se quita');
    check(local.profiles.length === 1 && local.activeProfileId === nuevo.id, 'sin tocar lo que se le pasó');
  }

  // Lo que dejó el fallo: los dos perfiles ya están en los dos lados y el activo es el vacío.
  {
    const lado = () => ({
      activeProfileId: nuevo.id,
      profiles: [nuevo, viejo],
      profileData: { [nuevo.id]: vacioDatos, [viejo.id]: lleno },
    });
    const r = reconciliarPerfiles(lado(), lado());
    check(r.cambioLocal && r.cambioRemoto, 'ya duplicado: se limpia en los dos lados');
    check(r.local.profiles.length === 1 && r.local.profiles[0].id === viejo.id, 'queda solo el que tiene datos');
    check(r.local.activeProfileId === viejo.id && r.remoto.activeProfileId === viejo.id, 'y es el activo en los dos');
  }

  // El nombre de Discord cambió entre medias: sigue siendo la misma cuenta.
  {
    const otroNombre = { id: 'profile-300', name: 'zams2' };
    const local = { activeProfileId: otroNombre.id, profiles: [otroNombre], profileData: {} };
    const remoto = { activeProfileId: viejo.id, profiles: [viejo], profileData: { [viejo.id]: lleno } };
    const r = reconciliarPerfiles(local, remoto);
    check(r.local.activeProfileId === viejo.id && r.local.profiles.length === 0, 'único perfil vacío y desconocido: se adopta el del servidor');
  }

  // Lo que no se toca.
  {
    const local = { activeProfileId: nuevo.id, profiles: [nuevo], profileData: { [nuevo.id]: lleno } };
    const remoto = { activeProfileId: viejo.id, profiles: [viejo], profileData: { [viejo.id]: lleno } };
    const r = reconciliarPerfiles(local, remoto);
    check(!r.cambioLocal && !r.cambioRemoto && r.local === local, 'dos perfiles con datos no se funden, aunque se llamen igual');
  }
  {
    const hermano = { id: 'profile-400', name: 'hermano' };
    const lado = () => ({
      activeProfileId: viejo.id,
      profiles: [viejo, hermano],
      profileData: { [viejo.id]: lleno, [hermano.id]: vacioDatos },
    });
    const r = reconciliarPerfiles(lado(), lado());
    check(!r.cambioLocal && !r.cambioRemoto, 'un perfil vacío con otro nombre se queda: es de otra persona');
  }
  {
    const local = { activeProfileId: viejo.id, profiles: [viejo], profileData: { [viejo.id]: lleno } };
    const r = reconciliarPerfiles(local, { ...local });
    check(!r.cambioLocal && !r.cambioRemoto, 'el caso normal, un perfil igual en los dos lados, ni se mira');
  }
}

decisionTests();
perfilesTests();
sesionTests();
falloTests();
urlTests();
textoTests();

console.log(failures ? `\n${failures} prueba(s) fallaron` : '\nTodo en orden');
process.exit(failures ? 1 : 0);
