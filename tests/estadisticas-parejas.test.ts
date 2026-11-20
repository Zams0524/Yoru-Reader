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
import { busquedasParaAudios, parejasDeBiblioteca, parejasDeKavita, tituloParaEscucha, tomoDe } from '../frontend/utils/paresLecturaAudio';

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
  // Títulos tal como vienen en un Kavita y un Audiobookshelf de verdad.
  const audios = [
    { itemId: 'm2', title: '[2巻] 無職転生 ～異世界行ったら本気だす～ 2', author: '理不尽な孫の手' },
    { itemId: 'm2b', title: '[2巻] 無職転生 ～異世界行ったら本気だす～ 2', author: '理不尽な孫の手' },
    { itemId: 'm10', title: '[10巻] 無職転生 ～異世界行ったら本気だす～ 10', author: '理不尽な孫の手' },
    { itemId: 'h1', title: '本好きの下剋上～司書になるためには手段を選んでいられません～第一部「兵士の娘1」', author: '香月 美夜' },
    { itemId: 'h2', title: '本好きの下剋上～司書になるためには手段を選んでいられません～第一部「兵士の娘2」', author: '香月 美夜' },
    { itemId: 'h3', title: '本好きの下剋上～司書になるためには手段を選んでいられません～第一部「兵士の娘3」', author: '香月 美夜' },
    { itemId: 'g3', title: '[3巻] ひげを剃る。そして女子高生を拾う。３', author: 'しめさば' },
    { itemId: 'k', title: '恋する寄生虫', author: '三秋 縋' },
    { itemId: 's1', title: '[1巻] 終末なにしてますか？　忙しいですか？　救ってもらっていいですか？　第1話', author: '枯野 瑛' },
  ];
  const kavita = [
    '無職転生 ～異世界行ったら本気だす～ 1',
    '無職転生 ～異世界行ったら本気だす～ 2 (MFブックス)',
    '無職転生 ～異世界行ったら本気だす～ 10',
    '無職転生 ～異世界行ったら本気だす～ スペシャルブック',
    '無職転生　～蛇足編～1',
    '本好きの下剋上 〜司書になるためには手段を選んでいられません〜 第一部　兵士の娘Ｉ',
    '本好きの下剋上 〜司書になるためには手段を選んでいられません〜 第一部　兵士の娘Ⅱ',
    '本好きの下剋上 〜司書になるためには手段を選んでいられません〜 第二部　神殿の巫女見習いIII',
    'ひげを剃る。そして女子高生を拾う。【電子特別版】 (角川スニーカー文庫)',
    'ひげを剃る。そして女子高生を拾う。（３）',
    'ひげを剃る。そして女子高生を拾う。５ (角川スニーカー文庫)',
    '恋する寄生虫 (メディアワークス文庫)',
    '終末なにしてますか？　忙しいですか？　救ってもらっていいですか？＃０４',
  ].map((title, index) => ({ serieId: String(index), title }));

  check(tomoDe('本好きの下剋上 第一部　兵士の娘Ⅱ') === 2 && tomoDe('第一部「兵士の娘2」') === 2, 'el tomo se lee igual en romanos que en cifras');
  check(tomoDe('恋する寄生虫') === null, 'un título sin tomo no se inventa uno');
  check(busquedasParaAudios(audios).join() === '無職転生,本好きの下剋上,ひげを剃る,恋する寄生虫,終末なにしてますか',
    'se busca una vez por obra, con el arranque del título');

  const parejas = parejasDeKavita(audios, kavita, []);
  const obra = (trozo: string) => parejas.find((pareja) => pareja.obra.includes(trozo));
  const pares = (trozo: string) => (obra(trozo)?.tomos || []).map((tomo) => `${tomo.audio.itemId}=${tomo.serie.title}`).join(' | ');

  check(pares('無職転生') === 'm2=無職転生 ～異世界行ったら本気だす～ 2 (MFブックス) | m10=無職転生 ～異世界行ったら本気だす～ 10',
    'cada audiolibro va con su tomo, y el repetido no hace dos parejas');
  check(pares('本好き') === `h1=${kavita[5].title} | h2=${kavita[6].title}`, 'el tomo 3 que no está en Kavita no se empareja con otro tomo');
  check(pares('ひげを剃る') === `g3=${kavita[9].title}`, 'el tomo 3 va con el (３), no con la edición especial ni con el 5');
  check(pares('恋する寄生虫') === `k=${kavita[11].title}`, 'una novela de un solo tomo se empareja por título');
  check(!obra('終末'), 'si Kavita solo tiene otro tomo, no hay pareja');
  check(parejas[0].tomos.length === 2 && parejas[parejas.length - 1].tomos.length === 1, 'las obras con más tomos van primero');

  const sinElDos = parejasDeKavita(audios, kavita, ['無職転生 ～異世界行ったら本気だす～ 2 (MFブックス)']);
  check(sinElDos.find((pareja) => pareja.obra.includes('無職転生'))?.tomos.map((tomo) => tomo.tomo).join() === '10',
    'el tomo que ya está en la biblioteca no se repite');
  check(parejasDeKavita([], kavita).length === 0 && parejasDeKavita(audios, []).length === 0, 'sin una de las dos mitades no hay parejas');
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
