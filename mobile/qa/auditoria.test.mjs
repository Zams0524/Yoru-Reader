// node --test mobile/qa/auditoria.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafe, analyseLogcat, extractRuntimeIssues, parsePackage, parseMeminfoKb, readPlanSteps } from './auditoria.mjs';
import fs from 'node:fs';

test('las guardas rechazan todo lo que borra datos', () => {
  for (const args of [['uninstall', 'com.yorureader.app'], ['install', 'a.apk'], ['shell', 'pm clear com.yorureader.app'],
    ['shell', 'run-as com.yorureader.app rm -r files'], ['shell', 'monkey -p com.yorureader.app 500'], ['shell', 'cmd package clear x']]) {
    assert.throws(() => assertSafe(args), args.join(' '));
  }
  for (const args of [['install', '-r', 'a.apk'], ['shell', 'dumpsys meminfo com.yorureader.app'], ['shell', 'run-as com.yorureader.app ls files/web-bundles']]) {
    assert.doesNotThrow(() => assertSafe(args));
  }
});

test('logcat: cierres, aperturas y errores por paso', () => {
  const log = [
    '10-23 06:31:10.100  42  42 I YoruNativeReader: opened 629 pages in 2400 ms, prefix 0',
    '10-23 06:31:11.000  42  50 W chromium: Unable to open asset URL: https://localhost/img/1.jpg',
    '10-23 06:31:12.000  77  77 E OtraApp: no cuenta',
    '10-23 06:31:16.000  42  42 E AndroidRuntime: FATAL EXCEPTION: main',
    '10-23 06:31:16.000  42  42 E AndroidRuntime: java.lang.NullPointerException',
  ].join('\n');
  const firstEnd = Buffer.byteLength(log.split('\n').slice(0, 2).join('\n'));
  const a = analyseLogcat(log, [{ id: 'LEC-01', logOffset: firstEnd }, { id: 'LEC-02', logOffset: 1e9 }], [42]);
  assert.equal(a.opens.length, 1);
  assert.equal(a.opens[0].step, 'LEC-01');
  assert.equal(a.fatals.length, 1);
  assert.equal(a.fatals[0].step, 'LEC-02');
  assert.deepEqual(a.fatals[0].lines, ['FATAL EXCEPTION: main', 'java.lang.NullPointerException']);
  assert.ok(a.known.some((k) => k.label.startsWith('Recurso')));
  assert.ok(!a.errors.some((e) => e.tag === 'OtraApp'));
});

test('lecturas del teléfono y del plan', () => {
  assert.deepEqual(parsePackage('versionCode=151 minSdk=24\n versionName=1.4.5'), { versionCode: 151, versionName: '1.4.5' });
  assert.equal(parseMeminfoKb('  TOTAL PSS:   412345  TOTAL RSS: 1'), 412345);
  const issues = extractRuntimeIssues([Buffer.from('["[2026-10-23T06:31:13.000Z] JavaScript error\\nx is undefined"]', 'latin1')]);
  assert.equal(issues.length, 1);
  const steps = readPlanSteps(fs.readFileSync(new URL('../../docs/AUDITORIA_QA.md', import.meta.url), 'utf8'));
  assert.ok(steps.length > 50);
  assert.equal(new Set(steps.map((s) => s.id)).size, steps.length, 'IDs repetidos en la checklist');
});
