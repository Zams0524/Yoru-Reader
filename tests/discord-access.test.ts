// Quién entra en Yoru: la lógica pura de `frontend/utils/discordAccess.ts`.
// Nada de red ni de almacenamiento, solo las decisiones.
// Ejecutar: node tests/run-discord-access-test.mjs
import {
  aplicarRespuesta,
  decidirAcceso,
  MARGEN_SIN_COMPROBAR_MS,
  pantallaQueToca,
  RECOMPROBAR_CADA_MS,
  tocaRecomprobar,
  tokenCaducado,
  type SesionDiscord,
} from '../frontend/utils/discordAccess';
import { esBot, sinBots, type DiscordMember } from '../frontend/utils/discordWidget';
import { esLaMismaPersona, lecturaActual } from '../frontend/components/home/MembersView';
import type { ShelfBook } from '../frontend/components/home/libraryIndex';
import {
  estadoMiembro,
  INTERVALO_BASE_MS,
  INTERVALO_MAXIMO_MS,
  mismaLista,
  RITMO_INICIAL,
  siguienteRitmo,
} from '../frontend/utils/miembrosVivos';

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

function pantallaTests() {
  console.log('\nQué pantalla toca');

  check(
    pantallaQueToca({ acceso: 'sin-sesion', tutorialVisto: false }) === 'entrada',
    'Sin sesión: pantalla de entrada',
  );

  // El caso que de verdad importa: por mucho que ya se haya visto la guía, y por tanto
  // que sea alguien de siempre, la puerta sigue delante.
  check(
    pantallaQueToca({ acceso: 'sin-sesion', tutorialVisto: true }) === 'entrada',
    'Sin sesión y con la guía ya vista: igualmente la entrada, no la app',
  );

  check(
    pantallaQueToca({ acceso: 'permitido', tutorialVisto: false }) === 'guia',
    'Miembro que no ha visto la guía: la guía',
  );

  check(
    pantallaQueToca({ acceso: 'permitido', tutorialVisto: true }) === 'app',
    'Miembro que ya la vio: la app',
  );

  // Ni la guía, ni restaurar una copia, ni entrar con Google viven fuera de la puerta.
  // Se comprueban todos los estados de no-acceso para que añadir uno nuevo mañana no
  // abra un portillo sin que nadie se entere.
  for (const estado of ['falta-config', 'no-es-miembro', 'sin-conexion', 'sin-sesion'] as const) {
    check(
      pantallaQueToca({ acceso: estado, tutorialVisto: false }) === 'entrada'
      && pantallaQueToca({ acceso: estado, tutorialVisto: true }) === 'entrada',
      `El estado «${estado}» no deja pasar de la entrada, haya visto la guía o no`,
    );
  }
}

function botsTests() {
  console.log('\nMiembros: fuera los bots');

  // Los nueve que devuelve hoy el widget del servidor de Yoru, tal cual.
  const reales = ['Bump Buddy', 'DISBOARD', 'Dyno', 'Hade', 'Jockie Music', 'Kotoba', 'Mudae', 'Nekotina', 'TTS Bot'];
  const miembros: DiscordMember[] = reales.map((name, i) => ({
    id: String(i), name, status: 'online', avatar: '', activity: '',
  }));

  // Los nueve son bots, Hade incluido: en Discord lleva la etiqueta APP.
  const quedan = sinBots(miembros).map((m) => m.name);
  check(quedan.length === 0, 'De los nueve de hoy no queda ninguno: los nueve son bots');

  for (const bot of ['DISBOARD', 'Dyno', 'Kotoba', 'Mudae', 'Bump Buddy', 'Jockie Music', 'Nekotina', 'TTS Bot', 'Hade']) {
    check(esBot(bot), `«${bot}» se reconoce como bot`);
  }

  check(esBot('  disboard  '), 'Da igual el espaciado y las mayúsculas');
  check(esBot('Mi Bot'), 'Un nombre que acaba en «bot» como palabra suelta es un bot');

  // Una persona de las que salen desconectadas en Discord, por si algún día el widget
  // las publicara: no se las puede confundir con bots.
  for (const persona of ['Ala3', 'alex', 'alfa5', 'Antonio:v', 'Chococrispi789', 'Dian', 'galletas', 'isa2', 'Jeff', 'JhErk', 'marlonluffyxd.0', 'Rain', 'Zams']) {
    check(!esBot(persona), `«${persona}» se muestra: es una persona`);
  }

  // La parte que protege a las personas: ante la duda, se muestran.
  check(!esBot('Robot'), 'Robot no se excluye: «bot» va pegado, no es palabra suelta');
  check(!esBot('Botella'), 'Botella tampoco');
  check(!esBot('Abbot'), 'Abbot tampoco');
  check(!esBot('Botan'), 'Botan tampoco, aunque empiece por bot');
  check(!esBot('bottle rocket'), 'Un nombre que solo contiene «bot» dentro se muestra');
  check(!esBot(''), 'Un nombre vacío no se toma por bot');

  check(sinBots([]).length === 0, 'Una lista vacía sigue vacía');
  check(
    sinBots(miembros) !== miembros && miembros.length === 9,
    'El filtro no toca la lista original',
  );
}

function tarjetaTests() {
  console.log('\nTarjeta de miembro');

  check(esLaMismaPersona('Zams', 'Zams'), 'Tu propio nombre se reconoce');
  check(esLaMismaPersona('  zams ', 'Zams'), 'Da igual el espaciado y las mayúsculas');
  check(!esLaMismaPersona('Zams', 'Hade'), 'Otra persona no eres tú');
  check(!esLaMismaPersona('', ''), 'Sin sesión no se reconoce a nadie como uno mismo');
  check(!esLaMismaPersona('Zams', ''), 'Sin nombre de sesión, nadie es uno mismo');

  const libro = (extra: Partial<ShelfBook>): ShelfBook => ({
    id: 'b1', title: 'よつばと！', lastRead: '2026-11-18T10:00:00Z', ...extra,
  } as ShelfBook);

  check(lecturaActual([]) === null, 'Sin libros no hay bloque de lectura');

  const unoAMedias = lecturaActual([libro({ cover: 'data:x', progress: { percent: 42 } as any })]);
  check(
    unoAMedias?.titulo === 'よつばと！' && unoAMedias?.progreso === 42 && unoAMedias?.portada === 'data:x',
    'Un libro a medias da título, portada y porcentaje',
  );

  // Terminado no es «lo que estás leyendo»: continueReading ya lo descarta.
  check(
    lecturaActual([libro({ progress: { percent: 100 } as any })]) === null,
    'Un libro terminado no sale como lectura actual',
  );

  check(
    lecturaActual([libro({ hiddenFromContinue: true, progress: { percent: 10 } as any })]) === null,
    'Un libro apartado de «Continuar» tampoco sale',
  );

  // La portada oculta a propósito se respeta: no se cuela por la puerta de atrás.
  const sinPortada = lecturaActual([libro({ cover: 'data:x', hideCover: true, progress: { percent: 5 } as any })]);
  check(sinPortada !== null && !sinPortada.portada, 'Si la portada está oculta, no se enseña');
}

decisionTests();
recomprobarTests();
tokenTests();
respuestaTests();
pantallaTests();
function sondeoTests() {
  console.log('\nSondeo: ritmo y lista viva');

  const persona = (name: string, extra: Partial<DiscordMember> = {}): DiscordMember => ({
    id: '0', name, status: 'online', avatar: '', activity: '', ...extra,
  });

  // --- el ritmo ---
  check(
    siguienteRitmo({ esperaMs: 80_000, rechazos: 3 }, { ok: true }).esperaMs === INTERVALO_BASE_MS,
    'Una respuesta buena devuelve al ritmo de siempre, sin arrastrar el castigo',
  );
  check(
    siguienteRitmo({ esperaMs: 80_000, rechazos: 3 }, { ok: true }).rechazos === 0,
    'Y se olvidan los rechazos anteriores',
  );
  check(
    siguienteRitmo(RITMO_INICIAL, { ok: false, limitado: true }).esperaMs === INTERVALO_BASE_MS * 2,
    'Un 429 sin Retry-After dobla la espera',
  );
  check(
    siguienteRitmo(RITMO_INICIAL, { ok: false, limitado: true, retryAfterSegundos: 45 }).esperaMs === 45_000,
    'Con Retry-After manda Discord, no nuestro cálculo',
  );
  check(
    siguienteRitmo(RITMO_INICIAL, { ok: false, limitado: true, retryAfterSegundos: 9999 }).esperaMs === INTERVALO_MAXIMO_MS,
    'Un Retry-After desmedido se recorta al techo de dos minutos',
  );
  check(
    siguienteRitmo({ esperaMs: 90_000, rechazos: 2 }, { ok: false, limitado: true }).esperaMs === INTERVALO_MAXIMO_MS,
    'La espera nunca pasa de dos minutos',
  );
  check(
    siguienteRitmo(RITMO_INICIAL, { ok: false }).rechazos === 0,
    'Un fallo de red no cuenta como rechazo de Discord',
  );

  // --- el estado, el mismo en la lista y en la tarjeta ---
  check(estadoMiembro('online', true).clase === 'is-online', 'En línea: clase is-online (verde)');
  check(estadoMiembro('idle', true).clase === 'is-idle', 'Ausente: clase is-idle (amarillo)');
  check(estadoMiembro('dnd', true).clase === 'is-dnd', 'No molestar: clase is-dnd (rojo)');
  check(estadoMiembro('idle', true).etiqueta === 'Ausente', 'La etiqueta en español');
  check(estadoMiembro('idle', false).etiqueta === 'Idle', 'Y en inglés');
  check(estadoMiembro('dnd', false).etiqueta === 'Do not disturb', 'No molestar, en inglés');
  // Si Discord publica a alguien es que está conectado: lo que no se sabe es de qué
  // modo, así que un estado raro no deja el punto apagado.
  check(estadoMiembro(undefined, true).clase === 'is-online', 'Sin estado se asume en línea, no un punto apagado');
  check(estadoMiembro('vete-a-saber', true).clase === 'is-online', 'Un estado desconocido tampoco apaga el punto');

  // --- repintar o no ---
  check(mismaLista([], []), 'Dos listas vacías son iguales');
  check(mismaLista([persona('Jeff')], [persona('Jeff')]), 'La misma gente igual es la misma lista');
  check(
    mismaLista([persona('Jeff')], [{ ...persona('Jeff'), id: '7' }]),
    'El id no cuenta: es un número de orden que cambia solo',
  );
  check(
    !mismaLista([persona('Jeff')], [persona('Jeff', { status: 'idle' })]),
    'Un cambio de estado sí es un cambio',
  );
  check(
    !mismaLista([persona('Jeff')], [persona('Jeff', { activity: 'Yoru Reader' })]),
    'Y ponerse a leer también',
  );
  check(!mismaLista([persona('Jeff')], []), 'Si alguien se va, cambia');
}

botsTests();
tarjetaTests();
sondeoTests();
console.log(failures ? `\n${failures} pruebas fallaron` : '\nTodas las pruebas pasaron');
if (failures) process.exit(1);
