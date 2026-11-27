// Las estadísticas de lectura y de Yoru SRS pasan de un aparato a otro (estadisticasSync.ts).
// Hasta el 27 nov 2026 se quedaban en cada aparato: lo leído en el PC no salía en el
// teléfono y el límite de tarjetas nuevas del día se contaba por separado en cada uno.
// Ejecutar: node tests/run-estadisticas-sync-test.mjs

import { mergeDatabaseExports, mergeProfileData } from '../frontend/utils/cloudMerge';
import {
  combinarHistorialSrs,
  partesParaSincronizar,
  sumarAporte,
  sumarDiasDeOtros,
  MAX_HISTORIAL_SRS,
} from '../frontend/utils/estadisticasSync';

let failures = 0;
function check(condicion: boolean, nombre: string) {
  if (condicion) {
    console.log(`  ok  ${nombre}`);
  } else {
    failures += 1;
    console.error(`FALLA  ${nombre}`);
  }
}

const T = (minutos: number) => Date.UTC(2026, 10, 27, 12, minutos);
const ISO = (minutos: number) => new Date(T(minutos)).toISOString();
const libro = { title: 'Re:Zero 1', dateKey: '2026-11-27' };

// 1. El mismo libro el mismo día en los dos aparatos: se suman, sin contar dos veces.
{
  const pc = sumarAporte(null, libro, 'pc', { c: 1000, r: 600, l: 0, s: 1 }, T(10));
  const movil = sumarAporte(null, libro, 'movil', { c: 500, r: 300, l: 120, s: 1 }, T(20));
  const enMovil = mergeProfileData({ readingStats: [movil] }, { readingStats: [pc] }, false).readingStats!;
  check(enMovil.length === 1 && enMovil[0].charactersRead === 1500, 'lo leído en el PC y en el teléfono se suma');
  check(enMovil[0].readingTime === 900 && enMovil[0].listeningTime === 120 && enMovil[0].sessionsCount === 2, 'tiempo, escucha y sesiones también');
  const otraVez = mergeProfileData({ readingStats: enMovil }, { readingStats: enMovil }, false).readingStats!;
  check(otraVez[0].charactersRead === 1500, 'combinar otra vez lo ya combinado no lo duplica');
  // El teléfono sigue leyendo: solo crece su casilla.
  const masMovil = sumarAporte(enMovil[0], libro, 'movil', { c: 100, r: 60, l: 0, s: 0 }, T(30));
  const r = mergeProfileData({ readingStats: [masMovil] }, { readingStats: enMovil }, true).readingStats!;
  check(r[0].charactersRead === 1600, 'lo que se lee después se suma una sola vez');
}

// 2. Un parte de antes de esto (sin casillas) es todo de este aparato.
{
  const viejo = { ...libro, charactersRead: 800, readingTime: 400, listeningTime: 0, sessionsCount: 1, lastStatisticModified: T(5) };
  const sale = partesParaSincronizar([viejo], 'pc')[0];
  check(sale.aparatos?.pc?.c === 800 && sale.charactersRead === 800, 'un parte viejo sale a nombre de este aparato');
  const sumado = sumarAporte(viejo, libro, 'pc', { c: 200, r: 100, l: 0, s: 0 }, T(6));
  check(sumado.charactersRead === 1000 && Object.keys(sumado.aparatos!).length === 1, 'y lo nuevo se le suma sin perder lo viejo');
}

// 3. Borrar las estadísticas de un libro en un aparato no se deshace con el otro.
{
  const pc = sumarAporte(null, libro, 'pc', { c: 1000, r: 600, l: 0, s: 1 }, T(10));
  const movil = sumarAporte(null, libro, 'movil', { c: 500, r: 300, l: 0, s: 1 }, T(20));
  const r = mergeProfileData(
    { readingStats: [], readingStatsRemovals: { 'Re:Zero 1': ISO(25) } },
    { readingStats: [pc, movil] },
    false,
  );
  check((r.readingStats || []).length === 0, 'lo borrado no vuelve del otro aparato');
  const despues = sumarAporte(null, libro, 'movil', { c: 50, r: 30, l: 0, s: 1 }, T(40));
  const r2 = mergeProfileData({ readingStats: [], readingStatsRemovals: { 'Re:Zero 1': ISO(25) } }, { readingStats: [despues] }, false);
  check(r2.readingStats?.[0]?.charactersRead === 50, 'lo leído después del borrado sí se queda');
}

// 4. Yoru SRS: las tarjetas nuevas del PC cuentan para el límite del teléfono.
{
  const pcDias = { pc: { '2026-11-27': { n: 25, r: 5, w: Array.from({ length: 20 }, (_, i) => `語${i}`), s: 600 } } };
  const movilDias = { movil: { '2026-11-27': { n: 3, r: 3, w: [], s: 60 } } };
  const junto = mergeProfileData({ srsDays: movilDias }, { srsDays: pcDias }, false).srsDays!;
  const vista = sumarDiasDeOtros(
    { daily: { '2026-11-27': 3 }, stats: { '2026-11-27': { reviews: 3, newWords: [] } } },
    junto,
    'movil',
  );
  check(vista.stats['2026-11-27'].newWords.length === 20, 'el teléfono ve las 20 nuevas hechas en el PC');
  check(vista.stats['2026-11-27'].reviews === 8, 'y los repasos de los dos');
  check(vista.daily['2026-11-27'] === 28, 'el mapa de calor cuenta las tarjetas de los dos aparatos');
  const otraVez = mergeProfileData({ srsDays: junto }, { srsDays: junto }, false).srsDays!;
  check(JSON.stringify(otraVez) === JSON.stringify(junto), 'combinar otra vez no cambia nada');
}

// 5. El historial de repasos: todos los de los dos, sin repetir, como mucho 500.
{
  const a = [{ word: '猫', timestamp: ISO(10), aparato: 'pc' }, { word: '犬', timestamp: ISO(5), aparato: 'pc' }];
  const b = [{ word: '鳥', timestamp: ISO(8), aparato: 'movil' }, { word: '猫', timestamp: ISO(10), aparato: 'pc' }];
  const h = combinarHistorialSrs(a, b);
  check(h.length === 3 && h[0].word === '猫' && h[1].word === '鳥' && h[2].word === '犬', 'se juntan sin repetir, del más nuevo al más viejo');
  const mucho = Array.from({ length: 600 }, (_, i) => ({ word: `w${i}`, timestamp: new Date(T(0) + i * 1000).toISOString() }));
  check(combinarHistorialSrs(mucho, []).length === MAX_HISTORIAL_SRS, 'y no pasan de 500');
}

// 6. Limpiar el historial en un aparato lo limpia en el otro.
{
  const historial = [{ word: '猫', timestamp: ISO(10) }, { word: '犬', timestamp: ISO(40) }];
  const r = mergeProfileData(
    { srsHistoryClearedAt: ISO(30), srsHistory: [] },
    { srsHistory: historial, srsDays: { pc: { '2026-11-26': { n: 4, r: 4, w: [], s: 0 }, '2026-11-28': { n: 1, r: 1, w: [], s: 0 } } } },
    false,
  );
  check(r.srsHistory?.length === 1 && r.srsHistory[0].word === '犬', 'los repasos de antes de limpiar no vuelven');
  check(!r.srsDays?.pc?.['2026-11-26'] && !!r.srsDays?.pc?.['2026-11-28'], 'ni sus días; los de después se quedan');
}

// 7. Borrar el progreso de lectura también se lleva estas estadísticas.
{
  const pc = sumarAporte(null, libro, 'pc', { c: 1000, r: 600, l: 0, s: 1 }, T(10));
  const r = mergeProfileData(
    { progressResetAt: ISO(20) },
    { readingStats: [pc], srsHistory: [{ word: '猫', timestamp: ISO(10) }], srsDays: { pc: { '2026-11-27': { n: 1, r: 0, w: ['猫'], s: 5 } } } },
    false,
  );
  check((r.readingStats || []).length === 0 && (r.srsHistory || []).length === 0, 'partes e historial de antes del borrado se van');
  check(Object.keys(r.srsDays || {}).length === 0, 'y los días de Yoru SRS hasta el día del borrado');
}

// 8. Con una copia de una versión anterior (sin estos campos) no se pierde nada y se sube.
{
  const pc = sumarAporte(null, libro, 'pc', { c: 1000, r: 600, l: 0, s: 1 }, T(10));
  const local = { profiles: [{ id: 'p' }], profileData: { p: { books: [], readingStats: [pc], srsHistory: [{ word: '猫', timestamp: ISO(10) }] } } };
  const viejo = { profiles: [{ id: 'p' }], profileData: { p: { books: [] } } };
  const r = mergeDatabaseExports(local as any, viejo as any, false);
  check(r.merged.profileData.p.readingStats?.[0]?.charactersRead === 1000, 'lo de este aparato se queda');
  check(r.cloudChanged && !r.localChanged && !r.localNeedsReload, 'hay que subirlo, y aquí no cambia nada');
  const igual = mergeDatabaseExports(local as any, r.merged as any, false);
  check(!igual.cloudChanged && !igual.localChanged, 'una vez subido, las dos copias son iguales');
  const alReves = mergeDatabaseExports(viejo as any, local as any, false);
  check(alReves.localChanged && !alReves.localNeedsReload, 'lo que llega solo de estadísticas no obliga a recargar la app');
}

if (failures) {
  console.error(`\n${failures} comprobación(es) fallaron`);
  process.exit(1);
}
console.log('\nTodo bien');
