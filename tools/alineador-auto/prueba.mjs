/** Prueba de lo que no necesita ni Honomiya ni Audiobookshelf.  node tools/alineador-auto/prueba.mjs */
import assert from 'node:assert/strict';
import { buscadorDeEpub, unirSrt } from './generar.mjs';

const pista1 = '1\n00:00:01,000 --> 00:00:03,500\n吾輩は猫である。\n\n2\n00:00:04,000 --> 00:00:06,000\n名前はまだ無い。\n';
const pista2 = '1\n00:00:00,500 --> 00:00:02,000\nどこで生れたかとんと見当がつかぬ。\n';
const unido = unirSrt([pista1, pista2], [10_000, 5_000], { alignment: { bookCoverage: 0.95 } });

assert.equal(unido.cues, 3);
assert.match(unido.srt, /^YORU-ALINEACION v1 \{"verdict":"bueno","coverage":0\.95/);
// La segunda pista empieza donde acaba la primera: 10 s + 0,5 s.
assert.match(unido.srt, /3\n00:00:10,500 --> 00:00:12,000\nどこで生れたか/);
assert.equal(unirSrt([pista1], [10_000], { alignment: { bookCoverage: 0.4 } }).veredicto.verdict, 'parcial');

const epubDe = buscadorDeEpub(
  [{ ebook: { filename: 'tomo 2.epub' }, audiobook: { filename: '[2巻] tomo 2.m4b' } }],
  ['C:/Libros/autor/tomo 2/tomo 2.epub', 'C:/Libros/autor/otro/otro.epub'],
);
assert.equal(epubDe('D:/Audios/x/[2巻] tomo 2.m4b'), 'C:/Libros/autor/tomo 2/tomo 2.epub');
assert.equal(epubDe('D:/Audios/x/desconocido.m4b'), null);

console.log('Todo en orden');
