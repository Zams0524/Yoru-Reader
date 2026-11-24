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
  ];
  const secciones = ordenarSerie(titulos, (t) => t);
  assert.deepEqual(secciones.map((s) => s.tipo), ['principal', 'if', 'cortos', 'extra']);
  assert.deepEqual(secciones[0].items.map((t) => infoTomo(t).numero), [1, 2, 10, 21, 23, 24, 25]);
  assert.deepEqual(secciones[2].items.map((t) => infoTomo(t).numero), [2, 10]);
  assert.deepEqual(secciones[3].items.map((t) => infoTomo(t).numero), [1, 2]);
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
