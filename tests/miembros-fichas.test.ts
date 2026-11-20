// Casar la lista de Discord con lo que el servidor de Yoru sabe de cada uno, y cómo
// se cuenta lo que el otro lee: `miembrosFichas.ts`. Sin red ni pantalla.
// Ejecutar: node tests/run-miembros-fichas-test.mjs
import { actividades, fichaPara, haceCuanto, lineaAhora, rotuloActividad } from '../frontend/utils/miembrosFichas';
import type { FichaMiembro } from '../frontend/utils/yoruSyncService';

let failures = 0;
function check(condicion: boolean, nombre: string) {
  if (condicion) {
    console.log(`  ok  ${nombre}`);
  } else {
    failures += 1;
    console.error(`FALLA  ${nombre}`);
  }
}

const AHORA = 1_795_000_000_000;
const MIN = 60_000;

function ficha(cambios: Partial<FichaMiembro> = {}): FichaMiembro {
  return {
    usuarioId: '111',
    nombre: 'Yozhy',
    alias: ['Yozhy', 'yozhy_42'],
    actualizadoEn: AHORA - 2 * MIN,
    comparte: true,
    leyendo: {
      origen: 'local', titulo: 'よつばと!', autor: 'Azuma', portada: '', capitulo: 'Capítulo 2',
      porcentaje: 43, estado: 'leyendo', ultimaLectura: AHORA - 3 * MIN,
    },
    escuchando: { itemId: 'abs-1', titulo: 'キノの旅', autor: '時雨沢', porcentaje: 25, ultimaEscucha: AHORA - 26 * 60 * MIN },
    ahora: 'leyendo',
    ...cambios,
  };
}

// --- casar por nombre ---
const lista = [ficha(), ficha({ usuarioId: '222', nombre: 'Otra', alias: ['Otra'] })];
check(fichaPara('Yozhy', lista)?.usuarioId === '111', 'se reconoce por el nombre a la vista');
check(fichaPara('  YOZHY ', lista)?.usuarioId === '111', 'sin importar mayúsculas ni espacios');
check(fichaPara('yozhy_42', lista)?.usuarioId === '111', 'y también por el nombre de usuario');
check(fichaPara('Nadie', lista) === null, 'quien no ha sincronizado no tiene ficha');
check(fichaPara('', lista) === null, 'un nombre vacío no casa con nadie');
check(fichaPara('Otra', [ficha({ usuarioId: '9', nombre: 'Otra', alias: undefined })])?.usuarioId === '9', 'un servidor de antes, sin alias, casa por el nombre');

// --- hace cuánto ---
check(haceCuanto(0, AHORA, true) === '', 'sin fecha no se inventa nada');
check(haceCuanto(AHORA - 20_000, AHORA, true) === 'hace un momento', 'hace un momento');
check(haceCuanto(AHORA - 5 * MIN, AHORA, true) === 'hace 5 min', 'minutos');
check(haceCuanto(AHORA - 3 * 60 * MIN, AHORA, true) === 'hace 3 h', 'horas');
check(haceCuanto(AHORA - 26 * 60 * MIN, AHORA, true) === 'ayer', 'ayer');
check(haceCuanto(AHORA - 4 * 24 * 60 * MIN, AHORA, true) === 'hace 4 días', 'días');
check(haceCuanto(AHORA + 5 * MIN, AHORA, true) === 'hace un momento', 'un reloj adelantado no da tiempos negativos');

// --- qué está haciendo ---
const suyas = actividades(ficha());
check(suyas.length === 2 && suyas[0].tipo === 'leyendo' && suyas[0].ahora, 'lo de ahora va primero');
check(!suyas[1].ahora, 'y solo una de las dos es «ahora»');
check(rotuloActividad(suyas[0], AHORA, true) === 'Leyendo ahora', 'rótulo de lo que lee ahora');
check(rotuloActividad(suyas[1], AHORA, true) === 'Escuchó ayer', 'rótulo de lo que escuchó');
check(lineaAhora(ficha(), true) === 'Leyendo · よつばと!', 'la lista dice qué lee ahora');

const oyendo = ficha({ ahora: 'escuchando', escuchando: { itemId: 'abs-1', titulo: 'キノの旅', autor: '', porcentaje: 25, ultimaEscucha: AHORA - MIN } });
check(actividades(oyendo)[0].tipo === 'escuchando', 'si escucha ahora, eso va primero');
check(lineaAhora(oyendo, true) === 'Escuchando · キノの旅', 'la lista dice qué escucha ahora');

check(lineaAhora(ficha({ ahora: null }), true) === '', 'lo que leyó hace rato no sale en la lista');
check(actividades(ficha({ ahora: null }))[0].tipo === 'leyendo', 'sin «ahora», lo más reciente primero');
check(actividades(ficha({ comparte: false })).length === 0, 'quien no comparte no enseña nada');
check(actividades(null).length === 0 && lineaAhora(null, true) === '', 'sin ficha no hay nada que contar');
check(actividades(ficha({ escuchando: null })).length === 1, 'quien no escucha nada solo tiene lectura');

console.log(failures ? `\n${failures} prueba(s) fallaron` : '\nTodo en orden');
process.exit(failures ? 1 : 0);
