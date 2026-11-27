// Prueba en un navegador de verdad (IndexedDB y localStorage): lo que llega de otro
// aparato se guarda y se ve sumado. Empaquetar con rolldown (platform: browser) y abrir
// en una página en blanco servida por localhost; el resultado sale en la página.
import db from '../frontend/utils/db';
import { idDeEsteAparato, leerPartes } from '../frontend/utils/estadisticasDb';

const salida: string[] = [];
const check = (ok: boolean, nombre: string) => salida.push(`${ok ? 'ok' : 'FALLA'}  ${nombre}`);

(async () => {
  localStorage.clear();
  await new Promise((r) => { const q = indexedDB.deleteDatabase('books'); q.onsuccess = q.onerror = q.onblocked = () => r(null); });
  db.saveProfiles([{ id: 'p1', name: 'Yo' }]);
  db.setActiveProfileId('p1');
  const yo = idDeEsteAparato();
  const hoy = new Date().toLocaleDateString('sv').slice(0, 10);
  await db.saveReadingStatsEntry('Libro A', 1000, 600, 1, 0);
  await db.saveReadingStatsEntry('Libro A', 200, 60, 0, 0);
  db.addSrsHistory('猫', 3, 1, 'Yoru Reader', true, 0);
  db.addSrsHistory('犬', 3, 4, 'Yoru Reader', false, 2);
  const exp = await db.exportFullDatabase();
  const pid = exp.activeProfileId;
  const mio = exp.profileData[pid];
  check(mio.readingStats?.[0]?.aparatos?.[yo]?.c === 1200, 'el parte sale con lo de este aparato');
  check(mio.srsDays?.[yo]?.[hoy]?.n === 2 && mio.srsDays[yo][hoy].w.includes('猫'), 'los días de SRS salen con este aparato');
  check(mio.srsHistory?.length === 2 && mio.srsHistory.every((e: any) => e.aparato === yo), 'el historial sale con su aparato');

  // Lo que llega del otro aparato (ya combinado con lo de aquí).
  const otro = JSON.parse(JSON.stringify(exp));
  const p = otro.profileData[pid];
  p.readingStats[0].aparatos.otro = { c: 500, r: 300, l: 0, s: 1, t: Date.now() };
  p.readingStats.push({ title: 'Libro B', dateKey: hoy, aparatos: { otro: { c: 70, r: 10, l: 0, s: 1, t: Date.now() } } });
  p.srsDays.otro = { [hoy]: { n: 20, r: 0, w: Array.from({ length: 20 }, (_, i) => `語${i}`), s: 300 } };
  p.srsHistory.unshift({ word: '語0', timestamp: new Date().toISOString(), isNew: true, aparato: 'otro' });
  p.srsData = { ...(p.srsData || {}), 語0: { word: '語0', state: 1, lastReview: new Date().toISOString() } };
  // Mientras iba y venía la red, aquí se leyó un poco más.
  await db.saveReadingStatsEntry('Libro A', 10, 5, 0, 0);
  await db.importFullDatabase(otro);

  const partes = await leerPartes();
  const a = partes.find((x) => x.title === 'Libro A')!;
  check(a?.charactersRead === 1710, `Libro A suma los dos aparatos y lo leído entretanto (${a?.charactersRead})`);
  check(partes.some((x) => x.title === 'Libro B' && x.charactersRead === 70), 'llega un libro leído solo en el otro aparato');
  const stats = db.getSrsDailyReviewStats()[hoy];
  check(stats?.newWords.length === 21, `nuevas de hoy: las de los dos (${stats?.newWords.length})`);
  check(db.getSrsDailyReviewStats(true)[hoy]?.newWords.length === 1, 'los contadores propios siguen siendo solo de aquí');
  check(db.getSrsDailyReviews()[hoy] === 22, `tarjetas de hoy en el mapa de calor (${db.getSrsDailyReviews()[hoy]})`);
  check(db.getSrsStudySeconds(hoy) >= 300, 'el tiempo de estudio del otro aparato cuenta');
  check(db.getSrsHistory().length === 3, 'el historial tiene los repasos de los dos');
  check(!!db.getSrsData()['語0'], 'la tarjeta del otro aparato llega');

  // Otra vuelta con lo mismo no duplica.
  await db.importFullDatabase(otro);
  check((await leerPartes()).find((x) => x.title === 'Libro A')!.charactersRead === 1710, 'importar otra vez no duplica');

  // Borrar las estadísticas de un libro aquí viaja como marca.
  await db.deleteReadingStatsForBook('Libro B');
  const exp2 = await db.exportFullDatabase();
  check(!!exp2.profileData[pid].readingStatsRemovals?.['Libro B'], 'el borrado de un libro sale con fecha');
  await db.importFullDatabase(otro);
  check(!(await leerPartes()).some((x) => x.title === 'Libro B'), 'y lo que llega de antes del borrado no lo devuelve');

  // Limpiar el historial aquí.
  db.clearSrsHistory();
  const exp3 = await db.exportFullDatabase();
  check(!!exp3.profileData[pid].srsHistoryClearedAt, 'limpiar el historial sale con fecha');
  await db.importFullDatabase(otro);
  check(db.getSrsHistory().length === 0 && !db.getSrsDailyReviews()[hoy], 'y no vuelve con lo que llega del otro aparato');

  document.body.innerText = salida.join('\n');
  (window as any).__resultado = salida;
})().catch((e) => { document.body.innerText = 'ERROR ' + (e?.stack || e); (window as any).__resultado = ['ERROR ' + e]; });
