// Run: node tests/run-migrar-claves-test.mjs
import { migrarClavesLocales, nombreNuevo } from '../frontend/utils/migrarClaves';

let fallos = 0;
function check(ok: boolean, nombre: string) {
  console.log(`${ok ? 'ok  ' : 'FALLO'} ${nombre}`);
  if (!ok) fallos++;
}

/** Un localStorage de mentira, con límite de tamaño opcional. */
function almacen(inicial: Record<string, string>, limite = Infinity): Storage {
  const m = new Map(Object.entries(inicial));
  const tam = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => {
      const antes = m.get(k);
      m.set(k, String(v));
      if (tam() > limite) {
        if (antes === undefined) m.delete(k); else m.set(k, antes);
        throw new Error('QuotaExceededError');
      }
    },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  } as Storage;
}

check(nombreNuevo('migaku_reader_settings_p1') === 'yoru_settings_p1', 'El nombre nuevo cambia solo el prefijo');
check(nombreNuevo('yoru_settings_p1') === null, 'Una clave ya nueva no se toca');

const s = almacen({
  migaku_reader_profiles: '[{"id":"p1"}]',
  migaku_reader_active_profile_id: 'p1',
  migaku_reader_settings_p1: '{"a":1}',
  migaku_reader_word_status_p1: '{"猫":"known"}',
  otra_cosa: 'x',
});
check(migrarClavesLocales(s) === 4, 'Se mueven las cuatro claves antiguas');
check(s.getItem('yoru_profiles') === '[{"id":"p1"}]' && s.getItem('yoru_active_profile_id') === 'p1'
  && s.getItem('yoru_settings_p1') === '{"a":1}' && s.getItem('yoru_word_status_p1') === '{"猫":"known"}',
  'Los valores llegan intactos');
check(s.getItem('migaku_reader_settings_p1') === null && s.getItem('otra_cosa') === 'x', 'Las antiguas desaparecen y lo demás sigue');
check(migrarClavesLocales(s) === 0, 'Una segunda pasada no hace nada');

const conflicto = almacen({ migaku_reader_settings_p1: 'viejo', yoru_settings_p1: 'nuevo' });
migrarClavesLocales(conflicto);
check(conflicto.getItem('yoru_settings_p1') === 'nuevo' && conflicto.getItem('migaku_reader_settings_p1') === 'viejo',
  'Si ya hay un valor nuevo, no se pisa y el viejo se queda');

// Cerca del límite: tener las dos copias no cabría, pero moverla sí.
const grande = 'x'.repeat(900);
const justo = almacen({ migaku_reader_books: grande }, 1000);
migrarClavesLocales(justo);
check(justo.getItem('yoru_books') === grande && justo.getItem('migaku_reader_books') === null, 'Cerca del límite también se mueve');

// El navegador se niega a escribir la clave nueva: el dato vuelve a su sitio.
const terco = almacen({ migaku_reader_x: "y" });
const escribir = terco.setItem;
terco.setItem = (k: string, v: string) => { if (k.startsWith("yoru_")) throw new Error("QuotaExceededError"); escribir(k, v); };
migrarClavesLocales(terco);
check(terco.getItem("migaku_reader_x") === "y", "Si no se puede escribir, el dato se queda donde estaba");

if (fallos) { console.log(`\n${fallos} pruebas fallaron`); process.exit(1); }
console.log('\nTodas las pruebas pasaron');
