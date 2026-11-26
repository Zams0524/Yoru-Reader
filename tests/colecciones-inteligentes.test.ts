// Colecciones que se llenan solas. `frontend/utils/coleccionesInteligentes.ts`.
// Ejecutar: node tests/run-colecciones-inteligentes-test.mjs
// (Sin Kuromoji: lo que esté solo en kanji no se lee en romaji aquí.)
import {
  clasificar,
  esColeccionDeGenero,
  etiquetasParaLibroNuevo,
  motivoParaColeccion,
  raizDeTitulo,
  terminosDeGenero,
  type Clasificable,
} from '../frontend/utils/coleccionesInteligentes';

let failures = 0;
function check(condicion: boolean, nombre: string) {
  if (condicion) {
    console.log(`  ok  ${nombre}`);
  } else {
    failures += 1;
    console.error(`FALLA  ${nombre}`);
  }
}

const rezero5: Clasificable = { title: 'Re:ゼロから始める異世界生活 第五章 水の都と英雄の詩 1' };
const bookworm1: Clasificable = { title: '本好きの下剋上 第一部 兵士の娘 1', altTitles: ['Ascendance of a Bookworm'] };
const bookworm5: Clasificable = { title: '本好きの下剋上 第五部 女神の化身 3' };
const mushoku: Clasificable = { title: '無職転生 ～異世界行ったら本気だす～ 4', genres: ['Fantasy', 'Isekai'] };
const sao: Clasificable = { title: 'ソードアート・オンライン 1', genres: ['Sci-Fi', 'Action'], tags: ['VRMMO'] };
const majo: Clasificable = { title: '魔女の旅々 3', genres: ['Fantasy', 'Adventure'] };

// 1. Por título.
check(motivoParaColeccion(rezero5, 'Re:Zero') === 'titulo', '«Re:Zero» recoge «Re:ゼロから…» por título');
check(motivoParaColeccion({ title: 'Ｒｅ：ゼロから始める異世界生活 Ex 2' }, 're zero') === 'titulo', 'también en ancho completo');
check(motivoParaColeccion(majo, 'Re:Zero') === null, '«Re:Zero» no recoge otra cosa');
check(motivoParaColeccion(bookworm1, 'Ascendance of a Bookworm') === 'titulo', 'el título traducido (altTitles) cuenta');
check(motivoParaColeccion({ title: '86―エイティシックス― 3' }, '86') === null, 'un nombre de dos letras no recoge por título');

// 2. Por serie.
check(raizDeTitulo('本好きの下剋上 第五部 女神の化身 3') === '本好きの下剋上', 'raíz sin «第五部…»');
check(raizDeTitulo('ノーゲーム・ノーライフ12') === 'のーげーむ・のーらいふ', 'raíz sin el número pegado');
check(raizDeTitulo('Sword Art Online Vol. 3') === 'sword art online', 'raíz sin «Vol. 3»');
check(raizDeTitulo('とある魔術の禁書目録 (電撃文庫)') === 'とある魔術の禁書目録', 'raíz sin la editorial');
check(motivoParaColeccion(bookworm5, 'Ascendance of a Bookworm', [bookworm1]) === 'serie', 'el tomo 5 entra porque el 1 ya estaba');
check(motivoParaColeccion(bookworm5, 'Ascendance of a Bookworm', []) === null, 'sin el tomo 1 dentro, no hay pista');
check(
  motivoParaColeccion({ title: 'とある科学の超電磁砲 1' }, 'Index', [{ title: 'とある魔術の禁書目録 1' }]) === null,
  'dos series que empiezan igual no son la misma'
);
check(
  motivoParaColeccion({ title: 'Otro título', series: 'Re:Zero' }, 'Mi colección', [{ title: 'Cualquiera', series: 'Re:Zero' }]) === 'serie',
  'mismo campo «series»'
);

// 3. Por género.
check(esColeccionDeGenero('Isekai & Reencarnación'), '«Isekai & Reencarnación» es de género');
check(!esColeccionDeGenero('Re:Zero'), '«Re:Zero» no es de género');
check(terminosDeGenero('Sci-Fi & Realidad Virtual').join('|') === 'sci fi|realidad virtual', 'se parte por «&»');
check(motivoParaColeccion(mushoku, 'Isekai & Reencarnación') === 'genero', 'géneros del servidor en inglés');
check(motivoParaColeccion({ title: '転生したらスライムだった件 2' }, 'Isekai & Reencarnación') === 'genero', 'isekai y reencarnación son familia: basta una (転生)');
check(motivoParaColeccion({ title: 'オーバーロード 3', genres: ['Isekai'] }, 'Isekai & Reencarnación (異世界・転生)') === 'genero', 'Overlord: isekai sin reencarnación entra');
check(motivoParaColeccion({ title: 'x', genres: ['Sci-Fi'] }, 'Sci-Fi & Realidad Virtual (SF・VRMMO)') === 'genero', 'sci-fi sin realidad virtual entra');
check(motivoParaColeccion({ title: 'x', genres: ['Romance', 'School Life'] }, 'Romance Escolar & Comedia (学園・ラブコメ)') === null, 'Romance Escolar & Comedia pide también comedia');
check(motivoParaColeccion({ title: 'x', genres: ['Romance', 'School Life', 'Comedy'] }, 'Romance Escolar & Comedia (学園・ラブコメ)') === 'genero', 'romance, escolar y comedia, sí');
check(motivoParaColeccion({ title: '異世界転生 2' }, 'Isekai & Reencarnación') === 'genero', '異世界 y 転生 en el título');
check(motivoParaColeccion(sao, 'Sci-Fi & Realidad Virtual') === 'genero', 'Sci-Fi y VRMMO');
check(motivoParaColeccion(majo, 'Sci-Fi & Realidad Virtual') === null, 'fantasía no es sci-fi');
check(motivoParaColeccion({ title: 'x', genres: ['Dark Fantasy'] }, 'Fantasía') === 'genero', '«Dark Fantasy» es fantasía');
check(motivoParaColeccion({ title: 'x', genres: ['Classic'] }, 'Sci-Fi') === null, '«sf» no casa dentro de otra palabra');
check(
  motivoParaColeccion({ title: 'Romance del otro tomo 2' }, 'Romance', [{ title: 'Romance del otro tomo 1', genres: ['Romance'] }]) !== 'serie',
  'una colección de género no recoge por serie'
);

// Los nombres de verdad del servidor de Yoru (capturas de zams, 24 nov 2026).
check(motivoParaColeccion(rezero5, 'Re:Zero (Re:ゼロから始める異世界生活)') === 'titulo', '«Re:Zero (Re:ゼロ…)» recoge Re:ゼロ');
check(motivoParaColeccion({ title: 'キノの旅 XXIII the Beautiful World' }, 'Kino no Tabi (キノの旅)') === 'titulo', '«Kino no Tabi (キノの旅)»');
check(motivoParaColeccion({ title: 'オーバーロード 15' }, 'Overlord (オーバーロード)') === 'titulo', '«Overlord (オーバーロード)»');
check(motivoParaColeccion({ title: 'ハイスクールD×D 25' }, 'High School DxD (ハイスクールD×D)') === 'titulo', '«High School DxD (ハイスクールD×D)»');
check(
  motivoParaColeccion({ title: '終末なにしてますか？もう一度だけ、会えますか？ 3' }, 'Sukasuka & Sukamoka (終末なにしてますか？)') === 'titulo',
  'una colección de dos series recoge por la mitad japonesa'
);
check(motivoParaColeccion(majo, 'Overlord (オーバーロード)') === null, 'y no recoge otra cosa');
check(motivoParaColeccion(majo, 'Leer y Escuchar (Sync Audiobooks)') === null, '«Leer y Escuchar» no recoge al azar');
check(esColeccionDeGenero('Isekai & Reencarnación (異世界・転生)'), 'el género con paréntesis sigue siendo género');
check(motivoParaColeccion({ title: '29歳独身は異世界で自由に生きた…かった。 2', genres: ['Reincarnation'] }, 'Isekai & Reencarnación (異世界・転生)') === 'genero', '異世界 en el título + Reincarnation; el paréntesis no pide más');
check(motivoParaColeccion({ title: 'x', genres: ['Action'] }, 'Fantasía Oscura & Acción (ダークファンタジー)') === null, 'acción sola no entra en «Fantasía Oscura & Acción»');
check(motivoParaColeccion({ title: 'x', genres: ['Dark Fantasy', 'Action'] }, 'Fantasía Oscura & Acción (ダークファンタジー)') === 'genero', 'oscura y acción, sí');
check(motivoParaColeccion(sao, 'Sci-Fi & Realidad Virtual (SF・VRMMO)') === 'genero', 'SAO → Sci-Fi (SF・VRMMO)');
check(
  motivoParaColeccion({ title: 'x', genres: ['Romance', 'School Life'] }, 'Romance Escolar') === 'genero'
    && motivoParaColeccion({ title: 'x', genres: ['Romance'] }, 'Romance Escolar') === null,
  '«Romance Escolar» pide romance y escolar, no cualquier romance'
);
check(motivoParaColeccion({ title: 'x', genres: ['Dark Fantasy'] }, 'Fantasía Oscura') === 'genero', 'Dark Fantasy → Fantasía Oscura');
check(motivoParaColeccion({ title: 'x', genres: ['Fantasy'] }, 'Fantasía Oscura') === null, 'fantasía a secas no es oscura');

// clasificar: no repite lo que ya está y respeta el orden.
const items = [rezero5, bookworm5, sao, majo];
const res = clasificar(
  [
    { nombre: 'Re:Zero', miembros: [rezero5] },
    { nombre: 'Ascendance of a Bookworm', miembros: [bookworm1] },
    { nombre: 'Sci-Fi & Realidad Virtual', miembros: [] },
  ],
  items,
  (libro) => libro.title
);
check(res[0].length === 0, 'lo que ya está dentro no se vuelve a meter');
check(res[1].length === 1 && res[1][0].libro === bookworm5, 'Bookworm recibe su tomo nuevo');
check(res[2].length === 1 && res[2][0].libro === sao, 'Sci-Fi recibe SAO');

// Biblioteca del aparato: etiquetas al importar.
const biblioteca = [
  { title: '本好きの下剋上 第一部 1', tags: ['Bookworm'] },
  { title: 'Re:ゼロから始める異世界生活 1', tags: ['Favoritos'] },
];
check(
  etiquetasParaLibroNuevo({ title: '本好きの下剋上 第二部 2' }, biblioteca, ['Bookworm', 'Favoritos']).join() === 'Bookworm',
  'un tomo nuevo gana la etiqueta de su serie, y no otras'
);
check(
  etiquetasParaLibroNuevo({ title: 'Re:ゼロから始める異世界生活 2' }, biblioteca, ['Re:Zero', 'Kavita']).join() === 'Re:Zero',
  'una colección vacía también recoge por título; «Kavita» nunca'
);
check(
  etiquetasParaLibroNuevo({ title: '転生したらスライムだった件', tags: [] }, biblioteca, ['Isekai']).length === 0,
  'en el aparato no se clasifica por género'
);
check(
  etiquetasParaLibroNuevo({ title: 'Re:ゼロ 3', tags: ['re:zero'] }, biblioteca, ['Re:Zero']).length === 0,
  'no repite una etiqueta que ya tiene'
);

if (failures > 0) {
  console.error(`\n${failures} prueba(s) fallaron`);
  process.exit(1);
}
console.log('\nTodo bien.');
