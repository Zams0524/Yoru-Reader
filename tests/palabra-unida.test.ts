// Una palabra que juntaste a mano (varios trozos de Jiten) y marcaste se pinta entera.
// Ejecutar: node tests/run-palabra-unida-test.mjs
import { renderJitenParagraph } from '../frontend/utils/yoruParserNative';

let failures = 0;
function check(condicion: boolean, nombre: string) {
  if (condicion) console.log(`  ok  ${nombre}`);
  else { failures += 1; console.error(`FALLA  ${nombre}`); }
}

const texto = '気でヤバい。';
// Jiten parte ヤバい en ヤバ + い.
const tokens = [
  { start: 0, end: 1, key: 'k1' },
  { start: 1, end: 2, key: 'k2' },
  { start: 2, end: 4, key: 'k3' },
  { start: 4, end: 5, key: 'k4' },
];
const palabras: Record<string, { spelling: string; reading: string; states: string[] }> = {
  k1: { spelling: '気', reading: 'き', states: ['new'] },
  k2: { spelling: 'で', reading: 'で', states: ['mastered'] },
  k3: { spelling: 'ヤバ', reading: 'ヤバ', states: ['new'] },
  k4: { spelling: 'い', reading: 'い', states: ['new'] },
};
const getWord = (key: string) => palabras[key];

const sinMarca = renderJitenParagraph(texto, tokens, getWord, () => undefined);
check(sinMarca.includes('data-word="ヤバ"') && sinMarca.includes('data-word="い"'), 'sin marca: los trozos van por separado');

const marcada = renderJitenParagraph(texto, tokens, getWord, (s) => (s === 'ヤバい' ? 'mastered' : undefined));
check(/<span class="jiten-word mastered"[^>]*data-word="ヤバい">ヤバい<\/span>。/.test(marcada), 'marcada: ヤバい va en un solo span, mastered');
check(!marcada.includes('data-word="ヤバ"'), 'marcada: ya no queda el trozo ヤバ suelto');
check(marcada.includes('data-word="気"') && marcada.includes('data-word="で"'), 'marcada: el resto del párrafo no cambia');

const olvidada = renderJitenParagraph(texto, tokens, getWord, (s) => (s === 'ヤバい' ? 'new' : undefined));
check(olvidada === sinMarca, 'estado new: no se junta');

const sinFuncion = renderJitenParagraph(texto, tokens, getWord);
check(sinFuncion === sinMarca, 'sin función de juntar: igual que antes');

if (failures > 0) { console.error(`${failures} fallo(s)`); process.exit(1); }
console.log('Todo bien');
