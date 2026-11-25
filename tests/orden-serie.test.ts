// Orden de tomos y separación de historias IF (frontend/utils/ordenSerie.ts).
import assert from 'node:assert/strict';
import { infoTomo, kanjiANumero, ordenarSerie, tipoDeTomo } from '../frontend/utils/ordenSerie';

let ok = 0;
function prueba(nombre: string, fn: () => void) {
  fn();
  ok++;
  console.log(`✓ ${nombre}`);
}

prueba('kanji a número', () => {
  assert.equal(kanjiANumero('三'), 3);
  assert.equal(kanjiANumero('十'), 10);
  assert.equal(kanjiANumero('十二'), 12);
  assert.equal(kanjiANumero('二十三'), 23);
  assert.equal(kanjiANumero('百二'), 102);
  assert.equal(kanjiANumero('二〇'), 20);
});

prueba('número de tomo en títulos reales', () => {
  assert.equal(infoTomo('Re：ゼロから始める異世界生活 21 (MF文庫J)').numero, 21);
  assert.equal(infoTomo('Re：ゼロから始める異世界生活　短編集１０').numero, 10);
  assert.equal(infoTomo('魔法科高校の劣等生 第三巻').numero, 3);
  assert.equal(infoTomo('魔法科高校の劣等生(12) 師族会議編〈上〉').numero, 12);
  assert.equal(infoTomo('Overlord Vol. 7').numero, 7);
  assert.equal(infoTomo('86―エイティシックス―Ep.3').numero, 3);
  assert.equal(infoTomo('86 エイティシックス 3').numero, 3);
  assert.equal(infoTomo('物語 上').numero, 1);
  assert.equal(infoTomo('物語 下').numero, 3);
  assert.equal(infoTomo('Re:ゼロから始める異世界生活 Ex4 最優紀行').numero, 4);
  assert.equal(infoTomo('無職転生 ～異世界行ったら本気だす～ 4 (MFブックス)').numero, 4);
  assert.equal(infoTomo('タイトルだけ').numero, null);
});

prueba('tipo de tomo', () => {
  assert.equal(tipoDeTomo('Re：ゼロから始める異世界生活 21 (MF文庫J)'), 'principal');
  assert.equal(tipoDeTomo('Re：ゼロから始める異世界生活　短編集１０'), 'cortos');
  assert.equal(tipoDeTomo('Re:ゼロから始める異世界生活 Ex4 最優紀行'), 'extra');
  assert.equal(tipoDeTomo('Re:ゼロから始める異世界生活 IF 強欲'), 'if');
  assert.equal(tipoDeTomo('Re:ゼロ 剣鬼恋歌 強欲のＩＦ'), 'if');
  assert.equal(tipoDeTomo('Some Series if route 2'), 'if');
  assert.equal(tipoDeTomo('What If Stories'), 'if');
  assert.equal(tipoDeTomo('Gift Of Life'), 'principal'); // «if» dentro de una palabra no cuenta
  assert.equal(tipoDeTomo('Exorcist 3'), 'principal'); // «Ex» dentro de una palabra tampoco
  assert.equal(tipoDeTomo('ソードアート・オンライン 外伝'), 'extra');
  // Libros de arte y enciclopedias de la serie van a Extras.
  assert.equal(tipoDeTomo('Re:ゼロから始める異世界生活 Animation Illust Works'), 'extra');
  assert.equal(tipoDeTomo('Re:ゼロから始める異世界生活 Art Works Re:BOX'), 'extra');
  assert.equal(tipoDeTomo('Re:zeropedia'), 'extra');
  assert.equal(tipoDeTomo('Re:ゼロから始める異世界生活 Re:zeropedia2'), 'extra');
  assert.equal(tipoDeTomo('Box of Secrets 3'), 'principal'); // «box» suelto no cuenta
  // El manga de un arco, los cómics y las colaboraciones también son Extras.
  assert.equal(tipoDeTomo('Re:ゼロから始める異世界生活 第一章 王都の一日編 2'), 'extra');
  assert.equal(tipoDeTomo('Re:ゼロから始める異世界生活　第三章　Truth　of　Zero　１０'), 'extra');
  assert.equal(tipoDeTomo('Re:ゼロから始める異世界生活 第5章 水の都と英雄の詩 1'), 'extra');
  assert.equal(tipoDeTomo('ソードアート・オンライン コミック 3'), 'extra');
  assert.equal(tipoDeTomo('Overlord Manga Vol. 2'), 'extra');
  assert.equal(tipoDeTomo('『この素晴らしい世界に祝福を！』×『Re:ゼロから始める異世界生活』スペシャルコラボブック'), 'extra');
  assert.equal(tipoDeTomo('本好きの下剋上 第三部 1'), 'principal'); // 部 es de la novela
  assert.equal(tipoDeTomo('とある物語 第3章'), 'principal'); // 第N章 solo, sin arco detrás
  assert.equal(tipoDeTomo('Mangaka-san 2'), 'principal'); // «manga» dentro de una palabra no cuenta
});

prueba('la colección Re:Zero de Kavita (25 nov 2026): la historia principal es la novela', () => {
  // Los títulos tal como los da el servidor, en el orden de la colección.
  const titulos = [
    'Re ゼロから始める異世界生活 公式アンソロジーコミック',
    'Re:ゼロから始める異世界生活 Animation Illust Works　-Re:START-',
    'Re:ゼロから始める異世界生活 Ex2　剣鬼恋歌',
    'Re:ゼロから始める異世界生活 第一章 王都の一日編 2',
    'Re:ゼロから始める異世界生活 第三章 Truth of Zero 1',
    'Re:ゼロから始める異世界生活 第五章 水の都と英雄の詩 １',
    'Re：ゼロから始める異世界生活　短編集１０',
    'Re:ゼロから始める異世界生活　第三章　Truth　of　Zero　１０',
    'Re：ゼロから始める異世界生活',
    'Re：ゼロから始める異世界生活 Ex4　最優紀行',
    'Re：ゼロから始める異世界生活 Ex6　剣鬼戦歌',
    'Re：ゼロから始める異世界生活 Re：IF 『ゼロカラカサネルイセカイセイカツ』',
    'Re：ゼロから始める異世界生活 Re：IF 『ゼロカラツギハグイセカイセイカツ』',
    'Re：ゼロから始める異世界生活 Re：IF 『レム』',
    'Re：ゼロから始める異世界生活 第二章 屋敷の一週間編',
    'Re：ゼロから始める異世界生活　Re：zeropedia 2',
    '『この素晴らしい世界に祝福を！』×『Re:ゼロから始める異世界生活』スペシャルコラボブック　Re:ゼロから始めるこのすば生活　コミックキューン　2017年2月号増刊',
    'Ｒｅ：ゼロから始める異世界生活 大塚真一郎 Art Works　Re：BOX',
    'Ｒｅ：ゼロから始める異世界生活 大塚真一郎 Art Works　Re：BOX 2nd',
    'Ｒｅ：ゼロから始める異世界生活Ex',
    'Ｒｅ：ゼロから始める異世界生活　Re:zeropedia',
    'Ｒｅ：ゼロから始める異世界生活　短編集１',
    'Re:ゼロから始める異世界生活 氷結の絆',
  ];
  const secciones = ordenarSerie(titulos, (t) => t);
  const de = (tipo: string) => secciones.find((s) => s.tipo === tipo)?.items || [];
  // La serie de los tomos 1–46 abre la historia principal. 氷結の絆 no dice en el
  // título qué es, así que se queda ahí, detrás.
  assert.deepEqual(de('principal'), ['Re：ゼロから始める異世界生活', 'Re:ゼロから始める異世界生活 氷結の絆']);
  assert.equal(de('if').length, 3);
  assert.deepEqual(de('cortos').map((t) => infoTomo(t).numero), [1, 10, null]);
  assert.equal(de('extra').length, 15);
});

prueba('la colección de Re:Zero de la captura queda en orden y separada', () => {
  const titulos = [
    'Re：ゼロから始める異世界生活　短編集１０',
    'Re：ゼロから始める異世界生活 21 (MF文庫J)',
    'Re：ゼロから始める異世界生活 23 (MF文庫J)',
    'Re：ゼロから始める異世界生活 24 (MF文庫J)',
    'Re：ゼロから始める異世界生活 25 (MF文庫J)',
    'Re：ゼロから始める異世界生活 2',
    'Re：ゼロから始める異世界生活 10',
    'Re：ゼロから始める異世界生活 1',
    'Re:ゼロから始める異世界生活 IF 傲慢',
    'Re:ゼロから始める異世界生活 Ex2 剣鬼恋譚',
    'Re：ゼロから始める異世界生活　短編集２',
    'Re:ゼロから始める異世界生活 Ex1 獅子王の見た夢',
    'Re:ゼロから始める異世界生活 Animation Illust Works',
    'Re:ゼロから始める異世界生活 Art Works Re:BOX',
    'Re:zeropedia',
    'Re:ゼロから始める異世界生活 Re:zeropedia2',
  ];
  const secciones = ordenarSerie(titulos, (t) => t);
  assert.deepEqual(secciones.map((s) => s.tipo), ['principal', 'if', 'cortos', 'extra']);
  assert.deepEqual(secciones[0].items.map((t) => infoTomo(t).numero), [1, 2, 10, 21, 23, 24, 25]);
  assert.deepEqual(secciones[2].items.map((t) => infoTomo(t).numero), [2, 10]);
  const extras = secciones[3].items;
  assert.equal(extras.length, 6);
  for (const t of [
    'Re:ゼロから始める異世界生活 Animation Illust Works',
    'Re:ゼロから始める異世界生活 Art Works Re:BOX',
    'Re:zeropedia',
    'Re:ゼロから始める異世界生活 Re:zeropedia2',
  ]) assert.ok(extras.includes(t), `${t} debería estar en Extras`);
  assert.deepEqual(extras.filter((t) => /Ex\d/.test(t)).map((t) => infoTomo(t).numero), [1, 2]);
});

prueba('una colección con varias series deja cada serie junta y en orden', () => {
  const titulos = [
    'Overlord Vol. 3',
    '魔法科高校の劣等生 第二巻',
    'Overlord Vol. 1',
    '魔法科高校の劣等生 第一巻',
    'Overlord Vol. 2',
  ];
  const [principal] = ordenarSerie(titulos, (t) => t);
  assert.deepEqual(principal.items, [
    'Overlord Vol. 1',
    'Overlord Vol. 2',
    'Overlord Vol. 3',
    '魔法科高校の劣等生 第一巻',
    '魔法科高校の劣等生 第二巻',
  ]);
});

prueba('sin número de tomo van al final de su serie', () => {
  const [principal] = ordenarSerie(['Serie X', 'Serie X 2', 'Serie X 1'], (t) => t);
  assert.deepEqual(principal.items, ['Serie X 1', 'Serie X 2', 'Serie X']);
});

console.log(`\n${ok} pruebas de orden de serie OK`);
