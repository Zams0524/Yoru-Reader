// Buscar títulos japoneses escribiendo en romaji. `frontend/utils/busquedaRomaji.ts`.
// Ejecutar: node tests/run-busqueda-romaji-test.mjs
// (Sin Kuromoji: aquí solo se prueba lo que no depende de leer kanji.)
import {
  claveFonetica,
  coincideBusqueda,
  crearBuscador,
  hiraganaARomaji,
  romajiAHiragana,
  variantesParaServidor,
} from '../frontend/utils/busquedaRomaji';

let failures = 0;
function check(condicion: boolean, nombre: string) {
  if (condicion) {
    console.log(`  ok  ${nombre}`);
  } else {
    failures += 1;
    console.error(`FALLA  ${nombre}`);
  }
}

const REZERO = 'Ｒｅ：ゼロから始める異世界生活';
const REZERO_ASCII = 'Re:ゼロから始める異世界生活 第五章 水の都と英雄の詩 1';

// La captura de zams: «re zero» decía «Sin resultados» con Re:Zero en pantalla.
check(coincideBusqueda('re zero', REZERO), '«re zero» encuentra «Ｒｅ：ゼロから…» (ancho completo)');
check(coincideBusqueda('re zero', REZERO_ASCII), '«re zero» encuentra «Re:ゼロから…»');
check(coincideBusqueda('rezero', REZERO), '«rezero», todo junto');
check(coincideBusqueda('Re:Zero', REZERO), '«Re:Zero», con mayúsculas y dos puntos');
check(coincideBusqueda('zero kara', REZERO), '«zero kara»');
check(coincideBusqueda('re zero', 'Kavita', REZERO), 'en cualquiera de los campos');
check(!coincideBusqueda('re zero', '魔女の旅々'), '«re zero» no encuentra otra cosa');
check(!coincideBusqueda('re zero', 'Re:モンスター'), 'hacen falta las dos palabras');

// Lo de siempre sigue funcionando.
check(coincideBusqueda('ゼロ', REZERO), 'buscar en katakana');
check(coincideBusqueda('ぜろ', REZERO), 'hiragana encuentra katakana');
check(coincideBusqueda('異世界', REZERO), 'buscar en kanji');
check(coincideBusqueda('art works', 'Ｒｅ：ゼロから始める異世界生活 大塚真一郎 Art Works'), 'texto en inglés');
check(coincideBusqueda('Kawahara', 'Reki Kawahara'), 'autores en romaji');
check(coincideBusqueda('', 'lo que sea'), 'una búsqueda vacía deja pasar todo');
check(crearBuscador('   ') === null, 'solo espacios = sin filtro');

// Variantes de romaji y vocales largas.
check(coincideBusqueda('mahou', 'まほうつかい'), 'mahou → まほう');
check(coincideBusqueda('maho', 'まほうつかい'), 'maho (sin vocal larga) → まほう');
check(coincideBusqueda('mahō', 'まほうつかい'), 'mahō (macrón) → まほう');
check(coincideBusqueda('tsukai', 'マホウツカイ'), 'tsukai → ツカイ');
check(coincideBusqueda('tukai', 'マホウツカイ'), 'tukai (kunrei) → ツカイ');
check(coincideBusqueda('shoujo', 'しょうじょ'), 'shoujo → しょうじょ');
check(coincideBusqueda('syoujo', 'しょうじょ'), 'syoujo → しょうじょ');
check(coincideBusqueda('kekkon', 'けっこん'), 'consonante doble → っ');
check(coincideBusqueda('konnichiwa', 'こんにちわ'), 'nn delante de vocal');
check(coincideBusqueda('sukeruton', 'スケルトン'), 'n final');
check(coincideBusqueda('suupaa', 'スーパー'), 'ー (vocal larga en katakana)');
check(coincideBusqueda('so-do a-to', 'ソードアート・オンライン'), 'so-do a-to → ソードアート');

// Las conversiones en sí.
check(romajiAHiragana('zero') === 'ぜろ', 'romajiAHiragana(zero)');
check(romajiAHiragana('kyou') === 'きょう', 'romajiAHiragana(kyou)');
check(romajiAHiragana('matcha') === 'まっちゃ', 'romajiAHiragana(matcha)');
check(romajiAHiragana("kan'i") === 'かんい', "romajiAHiragana(kan'i)");
check(hiraganaARomaji('きょう') === 'kyou', 'hiraganaARomaji(きょう)');
check(hiraganaARomaji('がっこう') === 'gakkou', 'hiraganaARomaji(がっこう)');
check(claveFonetica('Ｒｅ：ゼロ') === claveFonetica('re zero'), 'misma clave: Ｒｅ：ゼロ / re zero');

// Lo que se manda a Kavita/Audiobookshelf.
const variantes = variantesParaServidor('re zero');
check(variantes[0] === 're zero', 'primero, la búsqueda tal cual');
check(variantes.includes('ゼロ'), 'y la palabra más larga en katakana');
check(variantesParaServidor('ゼロ').length === 1, 'en japonés no hace falta más');
check(variantesParaServidor('').length === 0, 'vacía, nada');

if (failures) {
  console.error(`\n${failures} prueba(s) fallaron`);
  process.exit(1);
}
console.log('\nbusqueda-romaji: todo bien');
