// Dónde sale la tarjeta del diccionario en horizontal (escritorio): pegada a la palabra,
// encima si cabe y si no justo debajo, sin salirse de la pantalla.
// `frontend/utils/posicionPopupHorizontal.ts`. Ejecutar: node tests/run-popup-horizontal-test.mjs
import { sitioEnHorizontal } from '../frontend/utils/posicionPopupHorizontal';

let failures = 0;
function check(condicion: boolean, nombre: string) {
  if (condicion) {
    console.log(`  ok  ${nombre}`);
  } else {
    failures += 1;
    console.error(`FALLA  ${nombre}`);
  }
}

const base = {
  anchoVentana: 1280,
  altoVentana: 800,
  anchoTarjeta: 380,
  altoPrevisto: 300,
  margen: 12,
  hueco: 8,
  altoMinimo: 120,
};
const palabra = (top: number, left = 400) => ({ top, bottom: top + 28, left, right: left + 40 });

// Palabra arriba: no cabe encima, así que va justo debajo, no abajo del todo.
{
  const p = palabra(60);
  const s = sitioEnHorizontal({ ...base, palabra: p });
  check(!s.encima, 'palabra arriba: la tarjeta va debajo');
  check(s.top === p.bottom + base.hueco, 'palabra arriba: pegada al borde de abajo de la palabra');
  check(s.top + Math.min(base.altoPrevisto, s.altoMaximo) <= base.altoVentana - base.margen, 'palabra arriba: no se sale por abajo');
}

// Palabra abajo: cabe encima y va justo encima.
{
  const p = palabra(700);
  const s = sitioEnHorizontal({ ...base, palabra: p });
  check(s.encima, 'palabra abajo: la tarjeta va encima');
  check(s.top === p.top - base.hueco, 'palabra abajo: su borde de abajo toca la palabra');
  check(s.top - Math.min(base.altoPrevisto, s.altoMaximo) >= base.margen, 'palabra abajo: no se sale por arriba');
}

// Palabra en medio con sitio a ambos lados: encima (lo ya leído).
{
  const p = palabra(400);
  const s = sitioEnHorizontal({ ...base, palabra: p });
  check(s.encima && s.top === p.top - base.hueco, 'palabra en medio: encima y pegada');
}

// No cabe entera en ningún lado: el lado con más sitio, encogida a ese hueco.
{
  const p = palabra(150);
  const s = sitioEnHorizontal({ ...base, altoVentana: 400, altoPrevisto: 360, palabra: p });
  const libreDebajo = 400 - p.bottom - base.margen - base.hueco;
  check(!s.encima, 'sin sitio entero: va al lado con más hueco (debajo)');
  check(s.altoMaximo === libreDebajo, 'sin sitio entero: el alto se ajusta al hueco');
  check(s.top === p.bottom + base.hueco, 'sin sitio entero: sigue pegada a la palabra');
}

// Palabra pegada al borde derecho: la tarjeta se corre a la izquierda para caber.
{
  const p = palabra(400, 1200);
  const s = sitioEnHorizontal({ ...base, palabra: p });
  check(s.left === base.anchoVentana - base.anchoTarjeta - base.margen, 'borde derecho: se corre para no salirse');
}

// Palabra pegada al borde izquierdo: respeta el margen.
{
  const s = sitioEnHorizontal({ ...base, palabra: palabra(400, 2) });
  check(s.left === base.margen, 'borde izquierdo: respeta el margen');
}

if (failures > 0) {
  console.error(`\n${failures} comprobación(es) fallaron`);
  process.exit(1);
}
console.log('\nTodo bien');
