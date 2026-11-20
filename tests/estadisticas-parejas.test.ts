// La cuenta automática de lo leído (`lecturaAutomatica.ts`) y las parejas de
// «Leer y escuchar» (`paresLecturaAudio.ts`). Sin red, sin almacén y sin pantalla.
// Ejecutar: node tests/run-estadisticas-parejas-test.mjs
import {
  PAUSA_MAX_MS,
  SALTO_MAX_CARACTERES,
  anotarActividad,
  anotarPosicion,
  anotarTiempo,
  armar,
  cerrarCuenta,
  crearContador,
  recogerPendiente,
} from '../frontend/utils/lecturaAutomatica';
import { parejasDeBiblioteca, parejasDeKavita, tituloParaEscucha } from '../frontend/utils/paresLecturaAudio';

let failures = 0;
function check(condicion: boolean, nombre: string) {
  if (condicion) {
    console.log(`  ok  ${nombre}`);
  } else {
    failures += 1;
    console.error(`FALLA  ${nombre}`);
  }
}

// ── La cuenta automática ────────────────────────────────────────────────

{
  const c = crearContador();
  // Al abrir, el lector dice primero 0 y luego la posición guardada.
  anotarPosicion(c, 0, 0);
  anotarPosicion(c, 52_000, 100);
  check(c.totalCaracteres === 0, 'recolocarse al abrir no cuenta como leído');
  armar(c, 2_500);
  anotarPosicion(c, 52_600, 3_000);
  anotarPosicion(c, 53_300, 4_000);
  check(c.totalCaracteres === 1_300, 'pasar páginas suma los caracteres nuevos');
  anotarPosicion(c, 52_600, 5_000);
  anotarPosicion(c, 53_300, 6_000);
  check(c.totalCaracteres === 1_300, 'volver atrás y releer no cuenta dos veces');
  anotarPosicion(c, 53_300 + SALTO_MAX_CARACTERES + 1, 7_000);
  check(c.totalCaracteres === 1_300, 'un avance enorme de golpe es un salto, no lectura');
  anotarPosicion(c, 53_300 + SALTO_MAX_CARACTERES + 501, 8_000);
  check(c.totalCaracteres === 1_800, 'después del salto se sigue contando desde allí');
  anotarPosicion(c, 90_000, 9_000, true);
  anotarPosicion(c, 90_400, 10_000);
  check(c.totalCaracteres === 2_200, 'un salto avisado por el lector tampoco cuenta, lo siguiente sí');
  anotarPosicion(c, 10_000, 11_000, true);
  anotarPosicion(c, 10_500, 12_000);
  check(c.totalCaracteres === 2_200, 'saltar atrás no hace contar otra vez lo ya leído');

  const pendiente = recogerPendiente(c);
  check(pendiente.caracteres === 2_200 && c.pendientesCaracteres === 0, 'lo pendiente se recoge una sola vez');
  const total = cerrarCuenta(c);
  check(total.caracteres === 2_200 && c.totalCaracteres === 0 && c.armado, 'cerrar la cuenta la deja a cero y armada');
}

{
  const c = crearContador();
  check(anotarTiempo(c, 1_000, true) === 0 && c.totalSegundos === 0, 'sin armar no corre el reloj');
  armar(c, 0);
  let ahora = 0;
  for (let i = 0; i < 61; i += 1) { ahora = i * 1_000; anotarTiempo(c, ahora, true); }
  check(c.totalSegundos === 60, 'un minuto a la vista son sesenta segundos');

  // La app se va al fondo media hora y vuelve.
  anotarTiempo(c, ahora + 1_000, false);
  anotarActividad(c, ahora + 1_800_000);
  anotarTiempo(c, ahora + 1_800_000, true);
  anotarTiempo(c, ahora + 1_801_000, true);
  check(c.totalSegundos === 61, 'el rato en segundo plano no cuenta');

  // Libro abierto y nadie delante: se deja de contar al pasar la pausa máxima.
  const c2 = crearContador();
  armar(c2, 0);
  for (let t = 0; t <= PAUSA_MAX_MS + 600_000; t += 1_000) anotarTiempo(c2, t, true);
  check(c2.totalSegundos === PAUSA_MAX_MS / 1_000, 'sin tocar nada, el reloj se para a los cinco minutos');
  anotarPosicion(c2, 300, PAUSA_MAX_MS + 601_000);
  anotarTiempo(c2, PAUSA_MAX_MS + 601_000, true);
  anotarTiempo(c2, PAUSA_MAX_MS + 602_000, true);
  check(c2.totalSegundos === PAUSA_MAX_MS / 1_000 + 1, 'pasar página lo vuelve a poner en marcha');

  // Un tic larguísimo (el aparato durmió) no se cuenta entero.
  const c3 = crearContador();
  armar(c3, 0);
  anotarTiempo(c3, 0, true);
  anotarTiempo(c3, 120_000, true);
  check(c3.totalSegundos === 1, 'un tic de dos minutos cuenta como uno normal');
}

// ── Las parejas ─────────────────────────────────────────────────────────

const AUDIOS = [
  { itemId: 'a1', title: '無職転生 ~異世界行ったら本気だす~ 1', author: '理不尽な孫の手' },
  { itemId: 'a2', title: '無職転生 ~異世界行ったら本気だす~ 2', author: '理不尽な孫の手' },
  { itemId: 'a3', title: 'キノの旅 the Beautiful World', author: '時雨沢恵一' },
  { itemId: 'a4', title: '本好きの下剋上 第一部「兵士の娘I」', author: '香月美夜' },
];

{
  const libros = [
    { id: 'b1', title: '無職転生 ~異世界行ったら本気だす~ 2 (MFブックス)', author: '理不尽な孫の手' },
    { id: 'b2', title: 'キノの旅 the Beautiful World', author: '時雨沢恵一' },
    { id: 'b3', title: '吾輩は猫である', author: '夏目漱石' },
    { id: 'b4', title: 'ぜんぜん違う本', author: '' },
  ];
  const vinculos: Record<string, { itemId: string; title: string; chapters?: number }> = {
    b4: { itemId: 'a4', title: '本好きの下剋上 第一部「兵士の娘I」', chapters: 24 },
  };
  const parejas = parejasDeBiblioteca(libros, AUDIOS, (id) => vinculos[id] || null);
  const de = (id: string) => parejas.find((pareja) => pareja.libro.id === id);

  check(de('b1')?.audio.itemId === 'a2', 'el tomo 2 se empareja con el audiolibro del tomo 2, no con el 1');
  check(de('b2')?.audio.itemId === 'a3' && de('b2')?.origen === 'encontrada', 'un título igual se empareja solo');
  check(!de('b3'), 'un libro sin audiolibro no sale');
  check(de('b4')?.audio.itemId === 'a4' && de('b4')?.origen === 'vinculada' && de('b4')?.conCapitulos === true,
    'el vínculo hecho a mano manda aunque los títulos no se parezcan');
  check(parejas.length === 3, 'salen solo los que tienen las dos mitades');
  check(parejasDeBiblioteca(libros, [], (id) => vinculos[id] || null).length === 1,
    'sin catálogo de audiolibros siguen saliendo los vinculados');
}

{
  const series = [
    { serieId: '10', title: '無職転生 ~異世界行ったら本気だす~' },
    { serieId: '11', title: 'キノの旅 the Beautiful World' },
    { serieId: '12', title: '涼宮ハルヒの憂鬱' },
    { serieId: '13', title: '無職転生 ~異世界行ったら本気だす~ 外伝' },
  ];
  const parejas = parejasDeKavita(series, AUDIOS, ['キノの旅 the Beautiful World']);
  const mushoku = parejas.find((pareja) => pareja.serie.serieId === '10');
  check(mushoku?.audios.map((audio) => audio.itemId).join() === 'a1,a2', 'una serie de Kavita junta sus audiolibros, por tomo');
  check(!parejas.some((pareja) => pareja.serie.serieId === '11'), 'la que ya está en la biblioteca no se repite');
  check(!parejas.some((pareja) => pareja.serie.serieId === '12'), 'una serie sin audiolibro no sale');
  check(!parejas.some((pareja) => pareja.serie.serieId === '13'), 'una serie distinta de nombre parecido no hereda los audiolibros');
  check(parejasDeKavita(series, [], []).length === 0, 'sin audiolibros no hay parejas de Kavita');
}

{
  const libros = [{ id: 'b1', title: 'La novela' }];
  const libroDe = (itemId: string) => (itemId === 'a1' ? 'b1' : itemId === 'a9' ? 'borrado' : null);
  check(tituloParaEscucha({ itemId: 'a1', title: 'El audiolibro' }, libros, libroDe) === 'La novela',
    'lo escuchado de un audiolibro vinculado va al parte de su novela');
  check(tituloParaEscucha({ itemId: 'a2', title: 'El audiolibro' }, libros, libroDe) === 'El audiolibro',
    'un audiolibro suelto se apunta con su título');
  check(tituloParaEscucha({ itemId: 'a9', title: 'El audiolibro' }, libros, libroDe) === 'El audiolibro',
    'si el libro vinculado ya no está, se apunta con el título del audiolibro');
}

if (failures > 0) {
  console.error(`\n${failures} comprobaciones fallaron.`);
  process.exit(1);
}
console.log('\nTodo en orden.');
