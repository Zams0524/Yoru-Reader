// Quién entra en Yoru: la lógica pura de `frontend/utils/discordAccess.ts`.
// Nada de red ni de almacenamiento, solo las decisiones.
// Ejecutar: node tests/run-discord-access-test.mjs
import {
  aplicarRespuesta,
  decidirAcceso,
  MARGEN_SIN_COMPROBAR_MS,
  RECOMPROBAR_CADA_MS,
  tocaRecomprobar,
  tokenCaducado,
  type SesionDiscord,
} from '../frontend/utils/discordAccess';

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
const CLIENT = '1572616409819910397';

function sesion(cambios: Partial<SesionDiscord> = {}): SesionDiscord {
  return {
    accessToken: 'at',
    refreshToken: 'rt',
    expiraEn: AHORA + 60 * 60 * 1000,
    usuarioId: '42',
    usuarioNombre: 'zams',
    ultimaComprobacionOk: AHORA - 1000,
    ...cambios,
  };
}

function decisionTests() {
  console.log('\nDecisión de acceso');

  check(
    decidirAcceso({ sesion: sesion(), clientId: '', ahora: AHORA, hayRed: true }) === 'falta-config',
    'Sin Client ID se dice que falta configurar, aunque haya sesión buena',
  );

  check(
    decidirAcceso({ sesion: null, clientId: CLIENT, ahora: AHORA, hayRed: true }) === 'sin-sesion',
    'Sin sesión se pide entrar',
  );

  check(
    decidirAcceso({ sesion: sesion({ refreshToken: '' }), clientId: CLIENT, ahora: AHORA, hayRed: true }) === 'sin-sesion',
    'Una sesión sin token de refresco no sirve: se pide entrar otra vez',
  );

  check(
    decidirAcceso({ sesion: sesion({ noEsMiembro: true }), clientId: CLIENT, ahora: AHORA, hayRed: true }) === 'no-es-miembro',
    'Un «no» de Discord bloquea',
  );

  check(
    decidirAcceso({ sesion: sesion({ noEsMiembro: true, ultimaComprobacionOk: AHORA }), clientId: CLIENT, ahora: AHORA, hayRed: true }) === 'no-es-miembro',
    'El «no» manda sobre una comprobación reciente: no caduca a favor',
  );

  check(
    decidirAcceso({ sesion: sesion(), clientId: CLIENT, ahora: AHORA, hayRed: true }) === 'permitido',
    'Comprobado hace un momento: entra',
  );

  // Lo que de verdad protege al lector: sin red, pero dentro del margen.
  check(
    decidirAcceso({
      sesion: sesion({ ultimaComprobacionOk: AHORA - 6 * 24 * 60 * 60 * 1000 }),
      clientId: CLIENT, ahora: AHORA, hayRed: false,
    }) === 'permitido',
    'Sin red, con una comprobación de hace seis días: entra igual',
  );

  check(
    decidirAcceso({
      sesion: sesion({ ultimaComprobacionOk: AHORA - (MARGEN_SIN_COMPROBAR_MS - 1) }),
      clientId: CLIENT, ahora: AHORA, hayRed: false,
    }) === 'permitido',
    'Justo antes de cumplirse la semana: entra',
  );

  check(
    decidirAcceso({
      sesion: sesion({ ultimaComprobacionOk: AHORA - MARGEN_SIN_COMPROBAR_MS }),
      clientId: CLIENT, ahora: AHORA, hayRed: false,
    }) === 'sin-conexion',
    'Cumplida la semana y sin red: hace falta conexión',
  );

  check(
    decidirAcceso({
      sesion: sesion({ ultimaComprobacionOk: AHORA - 30 * 24 * 60 * 60 * 1000 }),
      clientId: CLIENT, ahora: AHORA, hayRed: true,
    }) === 'permitido',
    'Caducada pero con red: se deja pasar y se recomprueba por detrás',
  );

  check(
    decidirAcceso({ sesion: sesion({ ultimaComprobacionOk: 0 }), clientId: CLIENT, ahora: AHORA, hayRed: false }) === 'sin-conexion',
    'Sesión que nunca se comprobó y sin red: hace falta conexión',
  );
}

function recomprobarTests() {
  console.log('\nCuándo volver a preguntar');

  check(
    tocaRecomprobar({ sesion: sesion({ ultimaComprobacionOk: AHORA - RECOMPROBAR_CADA_MS }), hayRed: true, ahora: AHORA }),
    'Pasado un día con red: toca preguntar',
  );

  check(
    !tocaRecomprobar({ sesion: sesion({ ultimaComprobacionOk: AHORA - 1000 }), hayRed: true, ahora: AHORA }),
    'Comprobado hace un segundo: no se pregunta otra vez',
  );

  check(
    !tocaRecomprobar({ sesion: sesion({ ultimaComprobacionOk: 0 }), hayRed: false, ahora: AHORA }),
    'Sin red no se gasta una petición condenada',
  );

  check(
    !tocaRecomprobar({ sesion: null, hayRed: true, ahora: AHORA }),
    'Sin sesión no hay nada que recomprobar',
  );

  check(
    !tocaRecomprobar({ sesion: sesion({ noEsMiembro: true, ultimaComprobacionOk: 0 }), hayRed: true, ahora: AHORA }),
    'A quien Discord ya dijo que no, no se le pregunta en bucle',
  );
}

function tokenTests() {
  console.log('\nCaducidad del token');

  check(tokenCaducado(sesion({ expiraEn: AHORA - 1 }), AHORA), 'Un token vencido está caducado');
  check(tokenCaducado(sesion({ expiraEn: AHORA + 30_000 }), AHORA), 'Con medio minuto por delante se renueva ya, no se apura');
  check(!tokenCaducado(sesion({ expiraEn: AHORA + 10 * 60 * 1000 }), AHORA), 'Con diez minutos por delante todavía sirve');
}

function respuestaTests() {
  console.log('\nQué se guarda tras preguntar');

  const base = sesion({ ultimaComprobacionOk: AHORA - 99_999, noEsMiembro: true });

  const siMiembro = aplicarRespuesta(base, { tipo: 'miembro' }, AHORA);
  check(
    siMiembro?.ultimaComprobacionOk === AHORA && siMiembro?.noEsMiembro === false,
    'Un «sí» apunta la fecha y limpia el «no» anterior',
  );

  const noMiembro = aplicarRespuesta(sesion(), { tipo: 'no-miembro' }, AHORA);
  check(noMiembro?.noEsMiembro === true, 'Un «no» se apunta');
  check(
    noMiembro?.ultimaComprobacionOk === sesion().ultimaComprobacionOk,
    'Un «no» no mueve la fecha de la última comprobación buena',
  );

  // El caso que impide expulsar a nadie por un fallo ajeno.
  const original = sesion();
  const fallo = aplicarRespuesta(original, { tipo: 'indeterminado' }, AHORA);
  check(
    fallo?.ultimaComprobacionOk === original.ultimaComprobacionOk && fallo?.noEsMiembro !== true,
    'Si no se pudo saber, la sesión se queda exactamente como estaba',
  );
  check(
    JSON.stringify(fallo) === JSON.stringify(original),
    'Un fallo de Discord no cambia ni un campo de la sesión',
  );

  check(
    aplicarRespuesta(sesion(), { tipo: 'sesion-invalida' }, AHORA) === null,
    'Si el token ya no vale, la sesión se tira y hay que volver a entrar',
  );

  // Y la consecuencia, de punta a punta: un 5xx de Discord no echa a quien iba bien.
  const dentro = sesion({ ultimaComprobacionOk: AHORA - 2 * 24 * 60 * 60 * 1000 });
  const trasFallo = aplicarRespuesta(dentro, { tipo: 'indeterminado' }, AHORA);
  check(
    decidirAcceso({ sesion: trasFallo, clientId: CLIENT, ahora: AHORA, hayRed: true }) === 'permitido',
    'Tras un fallo de Discord, quien estaba dentro del margen sigue dentro',
  );
}

decisionTests();
recomprobarTests();
tokenTests();
respuestaTests();
console.log(failures ? `\n${failures} pruebas fallaron` : '\nTodas las pruebas pasaron');
if (failures) process.exit(1);
