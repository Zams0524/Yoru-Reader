// Que el popup del diccionario conteste en el idioma de la app aunque haya un diccionario de
// otro idioma instalado antes o puesto arriba. `frontend/utils/ordenDiccionarios.ts`.
// Ejecutar: node tests/run-diccionario-idioma-test.mjs
import { esTraduccionAutomatica, idiomaDeDiccionario, ordenPorIdioma, ordenEfectivo } from '../frontend/utils/ordenDiccionarios';
import { idiomaAjeno } from '../frontend/utils/dictionary';

let failures = 0;
function check(condicion: boolean, nombre: string) {
  if (condicion) {
    console.log(`  ok  ${nombre}`);
  } else {
    failures += 1;
    console.error(`FALLA  ${nombre}`);
  }
}

const ES = 'JMdict (Spanish) [2026-08-29]';
const EN = 'JMdict (English) [2026-10-23]';

check(idiomaDeDiccionario(ES) === 'es', 'el JMdict español se reconoce');
check(idiomaDeDiccionario(EN) === 'en', 'el JMdict inglés se reconoce');
check(idiomaDeDiccionario('JMdict [2026-08-29]') === 'en', 'el JMdict inglés antiguo, sin etiqueta, es inglés');
check(idiomaDeDiccionario('Jiten') === 'en', 'Jiten es inglés');
check(idiomaDeDiccionario('大辞林') === null, 'un monolingüe japonés no tiene idioma');

// El caso del fallo: el inglés se instaló antes que el español, sin orden guardado.
{
  const orden = ordenEfectivo([
    { title: EN, importedAt: '2026-08-01T00:00:00.000Z' },
    { title: ES, importedAt: '2026-09-01T00:00:00.000Z' },
  ]);
  check(orden[0] === EN, 'sin idioma, manda el que se instaló antes (el inglés)');
  check(ordenPorIdioma(orden, 'es')[0] === ES, 'con la app en español, manda el español');
  check(ordenPorIdioma(orden, 'en')[0] === EN, 'con la app en inglés, manda el inglés');
}

// El usuario puso el inglés arriba en Ajustes.
{
  const orden = ordenEfectivo([{ title: ES }, { title: EN }], [EN, ES]);
  check(ordenPorIdioma(orden, 'es')[0] === ES, 'el idioma de la app manda sobre el orden de Ajustes');
}

// Dentro del mismo idioma se respeta el orden; los desconocidos van en medio.
{
  const orden = ['Otro inglés (English)', EN, '大辞林', ES, 'Mi diccionario español'];
  const r = ordenPorIdioma(orden, 'es');
  check(r.join('|') === [ES, 'Mi diccionario español', '大辞林', 'Otro inglés (English)', EN].join('|'),
    'español primero en su orden, luego desconocidos, luego inglés en su orden');
}

// El aviso de la tarjeta.
check(idiomaAjeno([{ dictionary: EN, glossary: 'to go' }], 'es') === 'en', 'solo inglés con la app en español: avisa');
check(idiomaAjeno([{ dictionary: 'Jiten', glossary: 'to go' }], 'es') === 'en', 'Jiten con la app en español: avisa');
check(idiomaAjeno([{ dictionary: ES, glossary: 'ir' }], 'es') === undefined, 'en español: no avisa');
check(idiomaAjeno([{ dictionary: '大辞林', glossary: '行くこと' }], 'es') === undefined, 'idioma desconocido: no avisa');
check(idiomaAjeno(['to go'], 'es') === undefined, 'glosa suelta sin diccionario: no avisa');
check(idiomaAjeno([{ dictionary: EN, glossary: 'to go' }], 'en') === undefined, 'inglés con la app en inglés: no avisa');
check(idiomaAjeno([{ dictionary: ES, glossary: 'ir' }], 'en') === 'es', 'español con la app en inglés: avisa');

// El JMdict traducido a máquina (las palabras que faltan en el español).
{
  const AUTO = 'JMdict (Spanish, traducción automática) [2026-11-26]';
  check(idiomaDeDiccionario(AUTO) === 'es', 'el JMdict traducido es español');
  check(esTraduccionAutomatica(AUTO), 'el JMdict traducido se reconoce como traducción automática');
  check(!esTraduccionAutomatica(ES), 'el JMdict español hecho a mano no es traducción automática');
  // Instalado antes que el español: aun así va detrás de él, y delante del inglés.
  const orden = ordenEfectivo([
    { title: AUTO, importedAt: '2026-08-01T00:00:00.000Z' },
    { title: EN, importedAt: '2026-08-02T00:00:00.000Z' },
    { title: ES, importedAt: '2026-09-01T00:00:00.000Z' },
  ]);
  check(ordenPorIdioma(orden, 'es').join('|') === [ES, AUTO, EN].join('|'), 'español a mano, luego el traducido, luego inglés');
  check(ordenPorIdioma(orden, 'en')[0] === EN, 'con la app en inglés, manda el inglés');
  check(idiomaAjeno([{ dictionary: AUTO, glossary: 'surgir' }], 'es') === undefined, 'el traducido con la app en español: no avisa');
}

if (failures > 0) {
  console.error(`\n${failures} fallo(s)`);
  process.exit(1);
}
console.log('\nTodo bien.');
