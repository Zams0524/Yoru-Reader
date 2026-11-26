// Dónde sale la tarjeta del diccionario en vertical: junto a la columna de la palabra,
// nunca en el borde contrario de la pantalla. `frontend/utils/posicionPopupVertical.ts`.
// Ejecutar: node tests/run-popup-vertical-test.mjs
import { sitioEnVertical } from '../frontend/utils/posicionPopupVertical';

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
  anchoVentana: 1900,
  altoVentana: 1000,
  anchoDeseado: 380,
  altoTarjeta: 380,
  margen: 12,
  hueco: 8,
  anchoMinimo: 300,
};

// El caso de las capturas: palabra arriba en la primera columna, pegada al borde derecho.
{
  const palabra = { top: 45, bottom: 130, left: 1712, right: 1770 };
  const s = sitioEnVertical({ ...base, palabra });
  check(s.donde === 'izquierda', 'primera columna arriba: va a la izquierda de la palabra');
  check(s.left + s.ancho === palabra.left - base.hueco, 'primera columna arriba: pegada a la columna');
  check(s.left > base.anchoVentana / 2, 'primera columna arriba: no se va al otro lado de la pantalla');
  check(s.top === palabra.top, 'primera columna arriba: alineada con la palabra');
}

// Con sitio a la derecha (lo leído), sigue yendo a la derecha.
{
  const palabra = { top: 300, bottom: 360, left: 800, right: 850 };
  const s = sitioEnVertical({ ...base, palabra });
  check(s.donde === 'derecha' && s.left === palabra.right + base.hueco, 'con sitio a la derecha: a la derecha y pegada');
}

// Sin sitio a la derecha pero sí encima: encima de la palabra.
{
  const palabra = { top: 600, bottom: 660, left: 1712, right: 1770 };
  const s = sitioEnVertical({ ...base, palabra });
  check(s.donde === 'encima', 'primera columna abajo: encima de la palabra');
  check(s.top + base.altoTarjeta === palabra.top - base.hueco, 'primera columna abajo: pegada por arriba');
}

// Palabra abajo del todo: alineada pero sin salirse por abajo.
{
  const palabra = { top: 950, bottom: 990, left: 1712, right: 1770 };
  const s = sitioEnVertical({ ...base, altoTarjeta: 960, palabra });
  check(s.top + 960 <= base.altoVentana - base.margen || s.top === base.margen, 'no se sale por abajo');
}

// Ventana estrecha sin sitio a los lados: debajo de la palabra.
{
  const palabra = { top: 40, bottom: 120, left: 150, right: 200 };
  const s = sitioEnVertical({ ...base, anchoVentana: 400, altoTarjeta: 300, palabra });
  check(s.donde === 'debajo' && s.top === palabra.bottom + base.hueco, 'ventana estrecha: debajo de la palabra');
  check(s.left >= base.margen && s.left + s.ancho <= 400 - base.margen, 'ventana estrecha: dentro de la pantalla');
}

if (failures > 0) {
  console.error(`\n${failures} comprobación(es) fallaron`);
  process.exit(1);
}
console.log('\nTodo bien');
