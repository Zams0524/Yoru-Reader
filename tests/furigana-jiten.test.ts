// El furigana que se saca de la lectura anotada de Jiten: `frontend/utils/furiganaJiten.ts`.
// Las lecturas anotadas de aquí son las que devuelve la API de Jiten (comprobadas el 20 nov 2026).
// Ejecutar: node tests/run-furigana-jiten-test.mjs
import { colocarRubies, kanaDeAnotado, rubiesDeAnotado } from '../frontend/utils/furiganaJiten';

let failures = 0;
function check(condicion: boolean, nombre: string) {
  if (condicion) {
    console.log(`  ok  ${nombre}`);
  } else {
    failures += 1;
    console.error(`FALLA  ${nombre}`);
  }
}

/** El texto con sus lecturas, escrito `{base|lectura}` para compararlo de un vistazo. */
function furigana(anotado: string, superficie: string): string {
  let salida = '';
  let por = 0;
  for (const ruby of colocarRubies(superficie, rubiesDeAnotado(anotado))) {
    salida += superficie.slice(por, ruby.inicio) + `{${superficie.slice(ruby.inicio, ruby.fin)}|${ruby.lectura}}`;
    por = ruby.fin;
  }
  return salida + superficie.slice(por);
}

function igual(obtenido: string, esperado: string, nombre: string) {
  check(obtenido === esperado, `${nombre}: ${obtenido}${obtenido === esperado ? '' : ` (se esperaba ${esperado})`}`);
}

console.log('Kanji repetido: cada lectura por su posición');
igual(furigana('日[にち]曜[よう]日[び]', '日曜日'), '{日|にち}{曜|よう}{日|び}', '日曜日');
igual(furigana('一[いち]日[にち]一[いち]日[にち]', '一日一日'), '{一|いち}{日|にち}{一|いち}{日|にち}', '一日一日');
igual(furigana('人[ひと]々[びと]', '人々'), '{人|ひと}{々|びと}', '人々');
igual(furigana('時[じ]間[かん]', '時間'), '{時|じ}{間|かん}', '時間');

console.log('Palabras conjugadas');
igual(furigana('食[た]べる', '食べました'), '{食|た}べました', '食べました');
igual(furigana('見[み]る', '見ていられなかった'), '{見|み}ていられなかった', '見ていられなかった');
igual(furigana('もう一[いち]度[ど]', 'もう一度'), 'もう{一|いち}{度|ど}', 'kana delante');
igual(furigana('お茶[ちゃ]', 'お茶'), 'お{茶|ちゃ}', 'お茶');

console.log('来る y 得る cambian de lectura al conjugar');
igual(furigana('来[く]る', '来る'), '{来|く}る', '来る');
igual(furigana('来[く]る', '来なかった'), '{来|こ}なかった', '来なかった');
igual(furigana('来[く]る', '来て'), '{来|き}て', '来て');
igual(furigana('来[く]る', '来ます'), '{来|き}ます', '来ます');
igual(furigana('来[く]る', '来られる'), '{来|こ}られる', '来られる');
igual(furigana('来[く]る', '来い'), '{来|こ}い', '来い');
igual(furigana('来[く]る', '来れば'), '{来|く}れば', '来れば');
igual(furigana('やって来[く]る', 'やって来た'), 'やって{来|き}た', 'やって来た');
igual(furigana('あり得[う]る', 'あり得る'), 'あり{得|う}る', 'あり得る');
igual(furigana('あり得[う]る', 'あり得ない'), 'あり{得|え}ない', 'あり得ない');
igual(furigana('来[く]る', '来'), '来', '来 sin nada detrás: sin lectura antes que una equivocada');
igual(furigana('出[で]来[き]る', '出来ない'), '{出|で}{来|き}ない', '出来る no es 来る');

console.log('Números con lectura');
igual(furigana('１[いっ]本[ぽん]', '１本'), '{１|いっ}{本|ぽん}', '１本');
igual(kanaDeAnotado('１[いっ]本[ぽん]'), 'いっぽん', 'kana de １本');

console.log('Lectura en kana');
igual(kanaDeAnotado('食[た]べる'), 'たべる', 'kana de 食べる');
igual(kanaDeAnotado('日[にち]曜[よう]日[び]'), 'にちようび', 'kana de 日曜日');
igual(kanaDeAnotado('もう一[いち]度[ど]'), 'もういちど', 'kana de もう一度');
igual(kanaDeAnotado('コーヒー'), 'コーヒー', 'kana sin anotar');
igual(kanaDeAnotado(''), '', 'vacío');

console.log('Lo que no encaja se descarta sin romper el resto');
igual(furigana('日[にち]曜[よう]日[び]', '月曜日'), '月{曜|よう}{日|び}', 'otro kanji en la primera posición');
igual(furigana('食[た]べる', 'たべる'), 'たべる', 'escrito en kana');
check(rubiesDeAnotado('').length === 0 && rubiesDeAnotado('たべる').length === 0, 'sin anotaciones no hay lecturas');
check(colocarRubies('', rubiesDeAnotado('食[た]べる')).length === 0, 'superficie vacía');

if (failures > 0) {
  console.error(`\n${failures} comprobación(es) fallaron`);
  process.exit(1);
}
console.log('\nTodo bien');
