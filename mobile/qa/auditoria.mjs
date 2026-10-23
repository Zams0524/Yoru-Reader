#!/usr/bin/env node
// Auditoría QA de Yoru Reader en un teléfono Android conectado por adb.
// Solo busca errores: capturas, logcat, cierres, memoria y un informe en Markdown.
// Plan y checklist: docs/AUDITORIA_QA.md (el modo guiado lee los pasos de ahí).
//
//   node mobile/qa/auditoria.mjs inicio --serial <serial> [--apk <ruta>] [--etiqueta <texto>] [--sin-reinicio]
//   node mobile/qa/auditoria.mjs guiado [--desde <ID>] [--solo LEC,TTS]
//   node mobile/qa/auditoria.mjs paso <ID> [--nota <texto>] [--bug <texto> --sev S1|S2|S3|S4]
//   node mobile/qa/auditoria.mjs fin
//   node mobile/qa/auditoria.mjs informe [carpeta]
//
// Reglas del teléfono (docs/AUDITORIA_QA.md §2): siempre adb -s, solo install -r, nunca desinstalar ni borrar datos.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const PKG = 'com.yorureader.app';
const ACTIVITY = `${PKG}/.MainActivity`;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNS = path.join(REPO, 'qa-runs');
const CURRENT = path.join(RUNS, 'actual.json');
const PLAN = path.join(REPO, 'docs', 'AUDITORIA_QA.md');
const SEVERITIES = ['S1', 'S2', 'S3', 'S4'];

// ---------- argumentos ----------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

// ---------- adb con guardas ----------

function findAdb() {
  if (process.env.YORU_ADB) return process.env.YORU_ADB;
  const probe = spawnSync('adb', ['version'], { encoding: 'utf8' });
  if (!probe.error && probe.status === 0) return 'adb';
  const sdk = path.join(process.env.LOCALAPPDATA || '', 'Temp', 'yoru-android-apk-build', 'sdk', 'platform-tools', 'adb.exe');
  if (fs.existsSync(sdk)) return sdk;
  fail('No encuentro adb. Ponlo en el PATH o define YORU_ADB con su ruta.');
}

// Refuses anything that could uninstall the app or delete data (docs/AUDITORIA_QA.md §2).
export function assertSafe(args) {
  const cmd = args.join(' ');
  if (args[0] === 'uninstall') throw new Error('Prohibido: desinstalar.');
  if (args[0] === 'install' && !args.includes('-r')) throw new Error('Prohibido: install sin -r.');
  if (/\bpm\s+(clear|uninstall)\b|\brm\s|\bmonkey\b|\bwipe\b|\bcmd\s+package\s+(clear|uninstall)\b/.test(cmd)) {
    throw new Error(`Prohibido por las reglas del teléfono: ${cmd}`);
  }
}

function makeAdb(serial) {
  if (!serial) fail('Falta --serial (o YORU_QA_SERIAL). La auditoría nunca usa adb sin -s.');
  const bin = findAdb();
  const run = (args, { binary = false, allowFail = false, timeout = 120000 } = {}) => {
    assertSafe(args);
    const res = spawnSync(bin, ['-s', serial, ...args], {
      encoding: binary ? 'buffer' : 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      timeout,
    });
    if (!allowFail && (res.error || res.status !== 0)) {
      const err = res.error ? res.error.message : (binary ? res.stderr.toString() : res.stderr || res.stdout);
      throw new Error(`adb ${args.join(' ')} falló: ${String(err).trim()}`);
    }
    return binary ? res.stdout : (res.stdout || '').replace(/\r\n/g, '\n');
  };
  return { bin, serial, run, shell: (cmd, opts) => run(['shell', cmd], opts) };
}

// ---------- sesión ----------

function loadSession(dir) {
  const runDir = dir ? path.resolve(dir) : (fs.existsSync(CURRENT) ? JSON.parse(fs.readFileSync(CURRENT, 'utf8')).dir : null);
  if (!runDir || !fs.existsSync(path.join(runDir, 'sesion.json'))) fail('No hay auditoría en curso. Empieza con: inicio --serial <serial>');
  const session = JSON.parse(fs.readFileSync(path.join(runDir, 'sesion.json'), 'utf8'));
  return { runDir, session };
}

function saveSession(runDir, session) {
  fs.writeFileSync(path.join(runDir, 'sesion.json'), JSON.stringify(session, null, 2));
}

function readSteps(runDir) {
  const file = path.join(runDir, 'pasos.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
}

// ---------- lecturas del teléfono ----------

export function parsePackage(dumpsys) {
  const code = dumpsys.match(/versionCode=(\d+)/);
  const name = dumpsys.match(/versionName=(\S+)/);
  return { versionCode: code ? Number(code[1]) : null, versionName: name ? name[1] : null };
}

export function parseMeminfoKb(text) {
  const m = text.match(/TOTAL PSS:\s+(\d+)/) || text.match(/^\s*TOTAL\s+(\d+)/m);
  return m ? Number(m[1]) : null;
}

function appPid(adb) {
  const out = adb.shell(`pidof ${PKG}`, { allowFail: true }).trim();
  return out ? Number(out.split(/\s+/)[0]) : null;
}

function screenshot(adb, file) {
  const png = adb.run(['exec-out', 'screencap', '-p'], { binary: true, allowFail: true });
  if (png && png.length > 100) { fs.writeFileSync(file, png); return true; }
  return false;
}

function gradleVersionCode() {
  const gradle = fs.readFileSync(path.join(REPO, 'android', 'app', 'build.gradle'), 'utf8');
  const m = gradle.match(/versionCode\s+(\d+)/);
  return m ? Number(m[1]) : null;
}

// Reads the JavaScript errors main.tsx keeps in localStorage, straight from the WebView's LevelDB (read only).
export function extractRuntimeIssues(buffers) {
  const found = new Set();
  const re = /\[(\d{4}-\d\d-\d\dT[\d:.]+Z)\] (JavaScript error|Unhandled promise rejection|React render error)((?:\\n|\n)[^"\u0000]{0,700})?/g;
  for (const buf of buffers) {
    for (const text of [buf.toString('latin1'), buf.toString('utf16le'), buf.subarray(1).toString('utf16le')]) {
      for (const m of text.matchAll(re)) {
        const body = (m[3] || '').replace(/\\n/g, '\n').replace(/\\"/g, '"').split('\n').slice(0, 6).join('\n').trim();
        found.add(`[${m[1]}] ${m[2]}\n${body}`.trim());
      }
    }
  }
  return [...found].sort();
}

// ---------- análisis de logcat ----------

// threadtime: "10-23 06:31:12.345  1234  1250 E Tag: message"
const LINE = /^(\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(.*?)\s*:\s(.*)$/;

const KNOWN = [
  { re: /FATAL EXCEPTION/, label: 'Cierre nativo (FATAL EXCEPTION)', sev: 'S1' },
  { re: /YoruReaderCrash/, label: 'Informe de cierre guardado', sev: 'S1', tag: true },
  { re: /ANR in com\.yorureader\.app/, label: 'ANR (la app se colgó)', sev: 'S1' },
  { re: /OutOfMemoryError/, label: 'Sin memoria (OutOfMemoryError)', sev: 'S1' },
  { re: /open failed|engine failed/, label: 'Fallo del motor del lector', sev: 'S2', onlyTag: 'YoruNativeReader' },
  { re: /Unable to open asset URL/, label: 'Recurso que el WebView no encuentra', sev: 'S3' },
  { re: /Cleartext HTTP traffic/, label: 'Petición HTTP bloqueada', sev: 'S3' },
  { re: /already registered/, label: 'Plugin registrado dos veces', sev: 'S4' },
  { re: /Uncaught|TypeError|ReferenceError/, label: 'Error de JavaScript', sev: 'S2' },
  { re: /.*/, label: 'La OTA no arrancó', sev: 'S2', onlyTag: 'YoruWebUpdater', levels: 'WE' },
];

function normalize(msg) {
  return msg
    .replace(/https?:\/\/\S+/g, (u) => u.replace(/\d+/g, '#'))
    .replace(/0x[0-9a-f]+/gi, '0x#')
    .replace(/\d+(\.\d+)?/g, '#')
    .slice(0, 220);
}

export function analyseLogcat(text, steps, pids) {
  const appPids = new Set(pids.filter(Boolean).map(String));
  const lines = text.split(/\r?\n/);
  const stepAt = (offset) => {
    // A line belongs to the first step captured after it was written.
    for (const s of steps) if (offset <= s.logOffset) return s.id;
    return '(después del último paso)';
  };
  const groups = new Map();
  const known = new Map();
  const opens = [];
  const frames = [];
  let offset = 0;
  let fatalBlock = null;
  const fatals = [];
  for (const raw of lines) {
    const lineOffset = offset;
    offset += Buffer.byteLength(raw, 'utf8') + 1;
    const m = raw.match(LINE);
    if (!m) continue;
    const [, time, pid, , level, tag, msg] = m;
    const ours = appPids.has(pid);

    if (fatalBlock && pid === fatalBlock.pid && tag === 'AndroidRuntime') { fatalBlock.lines.push(msg); continue; }
    fatalBlock = null;
    if (tag === 'AndroidRuntime' && /FATAL EXCEPTION/.test(msg)) {
      fatalBlock = { time, pid, step: stepAt(lineOffset), lines: [msg] };
      fatals.push(fatalBlock);
    }
    if (ours && tag === 'YoruNativeReader') {
      const o = msg.match(/opened (\d+) pages in (\d+) ms/);
      if (o) opens.push({ time, pages: Number(o[1]), ms: Number(o[2]), step: stepAt(lineOffset) });
    }
    if (ours && tag === 'Choreographer') {
      const f = msg.match(/Skipped (\d+) frames/);
      if (f && Number(f[1]) >= 30) frames.push({ time, frames: Number(f[1]), step: stepAt(lineOffset) });
    }

    for (const k of KNOWN) {
      if (k.onlyTag && tag !== k.onlyTag) continue;
      if (k.levels && !k.levels.includes(level)) continue;
      const hay = k.tag ? tag : `${tag}: ${msg}`;
      if (!k.re.test(hay)) continue;
      if (!ours && !/ANR in|FATAL EXCEPTION/.test(msg) && tag !== 'YoruReaderCrash') continue;
      if (k.label === 'Error de JavaScript' && !(level === 'E' || /Console/.test(tag))) continue;
      const entry = known.get(k.label) || { ...k, count: 0, first: time, step: stepAt(lineOffset), sample: msg };
      entry.count++;
      known.set(k.label, entry);
      break;
    }

    if (ours && (level === 'E' || level === 'F' || level === 'W')) {
      const key = `${level} ${tag}: ${normalize(msg)}`;
      const g = groups.get(key) || { level, tag, sample: msg.slice(0, 300), count: 0, first: time, steps: new Set() };
      g.count++;
      g.steps.add(stepAt(lineOffset));
      groups.set(key, g);
    }
  }
  const errors = [...groups.values()].sort((a, b) => (a.level === b.level ? b.count - a.count : 'FEW'.indexOf(a.level) - 'FEW'.indexOf(b.level)));
  return { fatals, known: [...known.values()], opens, frames, errors };
}

// ---------- informe ----------

function mdEscape(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function buildReport(session, steps, logText, extras = {}) {
  const pids = [session.pidInicio, ...steps.map((s) => s.pid)];
  const a = analyseLogcat(logText, steps, pids);
  const bugs = steps.filter((s) => s.bug);
  const restarts = [];
  let prev = session.pidInicio;
  for (const s of steps) {
    if (prev && s.pid && s.pid !== prev) restarts.push(`${s.id}: PID ${prev} → ${s.pid}`);
    if (prev && !s.pid) restarts.push(`${s.id}: la app no estaba en marcha`);
    if (s.pid) prev = s.pid;
  }
  const out = [];
  out.push(`# Informe de auditoría QA · ${session.etiqueta}`, '');
  out.push(`- Fecha: ${session.fecha}`);
  out.push(`- Teléfono: ${session.modelo} (Android ${session.android}), serial \`${session.serial}\``);
  out.push(`- Build: ${session.versionName} (versionCode ${session.versionCode})${session.apk ? `, instalada desde \`${path.basename(session.apk)}\`` : ''}`);
  out.push(`- Rama: \`${session.rama || '?'}\` @ \`${session.commit || '?'}\``);
  out.push(`- OTA guardada en el teléfono: ${session.ota || 'no'}`);
  out.push(`- Arranque en frío: ${session.arranqueMs != null ? `${session.arranqueMs} ms` : 'no medido'}`);
  out.push(`- Pasos registrados: ${steps.length} · bugs marcados: ${bugs.length}`, '');

  out.push('## Resumen', '');
  const s1 = a.fatals.length + restarts.length + (extras.crash ? 1 : 0)
    + a.known.filter((k) => /ANR|OutOfMemory/.test(k.label)).reduce((n, k) => n + k.count, 0);
  out.push(`- Cierres o cuelgues detectados: **${s1}**`);
  out.push(`- Bugs marcados por severidad: ${SEVERITIES.map((v) => `${v} ${bugs.filter((b) => b.sev === v).length}`).join(' · ')}`);
  out.push(`- Grupos de errores/avisos de la app en logcat: ${a.errors.length}`);
  out.push(`- Errores de JavaScript guardados por la app: ${(extras.jsIssues || []).length}`, '');

  out.push('## Bugs marcados', '');
  if (!bugs.length) out.push('_Ninguno._', '');
  else {
    out.push('| ID | Sev | Paso | Descripción | Captura | Estado |', '|---|---|---|---|---|---|');
    const day = session.fecha.slice(0, 10).replace(/-/g, '');
    bugs.forEach((b, i) => out.push(`| QA-${day}-${String(i + 1).padStart(2, '0')} | ${b.sev || '?'} | ${b.id} | ${mdEscape(b.bug)} | ${b.captura ? `capturas/${b.captura}` : '-'} | abierto |`));
    out.push('');
  }

  out.push('## Cierres y cuelgues', '');
  if (!a.fatals.length && !restarts.length && !extras.crash) out.push('_Ninguno._');
  for (const f of a.fatals) out.push(`- ${f.time} (paso ${f.step}):`, '```', ...f.lines.slice(0, 15), '```');
  for (const r of restarts) out.push(`- Reinicio de la app entre pasos: ${r}`);
  if (extras.crash) out.push('- Informe de cierre nativo guardado por la app (`files/yoru-last-crash.txt`):', '```', ...extras.crash.split('\n').slice(0, 25), '```');
  out.push('');

  out.push('## Patrones conocidos', '');
  if (!a.known.length) out.push('_Ninguno._', '');
  else {
    out.push('| Sev | Qué | Veces | Primera vez | Paso | Ejemplo |', '|---|---|---|---|---|---|');
    for (const k of a.known) out.push(`| ${k.sev} | ${k.label} | ${k.count} | ${k.first} | ${k.step} | \`${mdEscape(k.sample.slice(0, 140))}\` |`);
    out.push('');
  }

  out.push('## Lector nativo: aperturas', '');
  if (!a.opens.length) out.push('_No se abrió ningún libro con el motor nativo._', '');
  else {
    out.push('| Hora | Paso | Páginas | ms |', '|---|---|---|---|');
    for (const o of a.opens) out.push(`| ${o.time} | ${o.step} | ${o.pages} | ${o.ms}${o.ms > 3000 ? ' ⚠' : ''} |`);
    const perStep = {};
    for (const o of a.opens) perStep[o.step] = (perStep[o.step] || 0) + 1;
    const repeated = Object.entries(perStep).filter(([, n]) => n > 1);
    if (repeated.length) out.push('', `⚠ Varias aperturas en un mismo paso (posibles recargas encadenadas): ${repeated.map(([s, n]) => `${s} ×${n}`).join(', ')}`);
    out.push('');
  }

  if (a.frames.length) {
    out.push('## Tirones (≥ 30 frames saltados)', '', '| Hora | Paso | Frames |', '|---|---|---|');
    for (const f of a.frames.slice(0, 30)) out.push(`| ${f.time} | ${f.step} | ${f.frames} |`);
    out.push('');
  }

  out.push('## Errores de JavaScript guardados por la app', '');
  if (!(extras.jsIssues || []).length) out.push('_Ninguno._', '');
  else for (const j of extras.jsIssues) out.push('```', j, '```');

  out.push('## Errores y avisos de la app en logcat (agrupados)', '');
  if (!a.errors.length) out.push('_Ninguno._', '');
  else {
    out.push('| Nivel | Tag | Veces | Primera vez | Pasos | Mensaje |', '|---|---|---|---|---|---|');
    for (const e of a.errors.slice(0, 80)) out.push(`| ${e.level} | ${mdEscape(e.tag)} | ${e.count} | ${e.first} | ${[...e.steps].join(', ')} | \`${mdEscape(e.sample.slice(0, 160))}\` |`);
    if (a.errors.length > 80) out.push('', `… y ${a.errors.length - 80} grupos más (ver logcat.txt).`);
    out.push('');
  }

  out.push('## Pasos', '', '| Hora | Paso | Resultado | PID | PSS (MB) | Captura | Nota |', '|---|---|---|---|---|---|---|');
  for (const s of steps) {
    const res = s.bug ? `bug ${s.sev || ''}` : s.saltado ? 'saltado' : 'ok';
    out.push(`| ${s.hora.slice(11, 19)} | ${s.id} | ${res} | ${s.pid ?? '-'} | ${s.pssKb ? (s.pssKb / 1024).toFixed(0) : '-'} | ${s.captura ? `capturas/${s.captura}` : '-'} | ${mdEscape(s.nota || s.bug || '')} |`);
  }
  out.push('', '---', '_Generado por `mobile/qa/auditoria.mjs`. Completar causa raíz y estado de cada bug (docs/AUDITORIA_QA.md §8–10)._', '');
  return out.join('\n');
}

// ---------- comandos ----------

function git(args) {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function cmdInicio(opts) {
  const adb = makeAdb(opts.serial || process.env.YORU_QA_SERIAL);
  const state = adb.run(['get-state'], { allowFail: true }).trim();
  if (state !== 'device') fail(`El teléfono ${adb.serial} no está listo (estado: ${state || 'desconectado'}).`);

  let pkg = parsePackage(adb.shell(`dumpsys package ${PKG}`, { allowFail: true }));
  if (opts.apk) {
    const apk = path.resolve(String(opts.apk));
    if (!fs.existsSync(apk)) fail(`No existe el APK ${apk}`);
    const newCode = Number(opts['version-code']) || gradleVersionCode();
    if (pkg.versionCode != null && newCode != null && newCode <= pkg.versionCode) {
      fail(`El APK (versionCode ${newCode}) no es mayor que el instalado (${pkg.versionCode}). Sube versionCode y recompila.`);
    }
    console.log(`Instalando ${path.basename(apk)} con install -r…`);
    adb.run(['install', '-r', apk], { timeout: 600000 });
    pkg = parsePackage(adb.shell(`dumpsys package ${PKG}`));
  }
  if (pkg.versionCode == null) fail(`Yoru Reader (${PKG}) no está instalado en ${adb.serial}.`);

  const etiqueta = String(opts.etiqueta || `v${pkg.versionName}-${pkg.versionCode}`).replace(/[^\w.-]+/g, '-');
  const runDir = path.join(RUNS, `${stamp()}-${etiqueta}`);
  fs.mkdirSync(path.join(runDir, 'capturas'), { recursive: true });

  const ota = adb.shell(`run-as ${PKG} ls files/web-bundles`, { allowFail: true }).trim();
  const session = {
    etiqueta,
    fecha: new Date().toISOString(),
    serial: adb.serial,
    modelo: adb.shell('getprop ro.product.model').trim(),
    android: adb.shell('getprop ro.build.version.release').trim(),
    versionCode: pkg.versionCode,
    versionName: pkg.versionName,
    apk: opts.apk ? path.resolve(String(opts.apk)) : null,
    rama: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    commit: git(['rev-parse', '--short', 'HEAD']),
    ota: ota && !/No such file|not debuggable|run-as:/i.test(ota) ? ota.split('\n').join(', ') : null,
  };

  // Recording logcat in the background; the process id lets `fin` stop it.
  adb.run(['logcat', '-c'], { allowFail: true });
  const logFd = fs.openSync(path.join(runDir, 'logcat.txt'), 'a');
  const child = spawn(adb.bin, ['-s', adb.serial, 'logcat', '-v', 'threadtime'], { detached: true, stdio: ['ignore', logFd, logFd], windowsHide: true });
  child.unref();
  session.logcatPid = child.pid;

  if (!opts['sin-reinicio']) {
    adb.shell(`am force-stop ${PKG}`, { allowFail: true });
    const start = adb.shell(`am start -W -n ${ACTIVITY}`, { allowFail: true });
    const t = start.match(/TotalTime:\s+(\d+)/);
    session.arranqueMs = t ? Number(t[1]) : null;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},4000)']);
  }
  session.pidInicio = appPid(adb);
  saveSession(runDir, session);
  fs.writeFileSync(CURRENT, JSON.stringify({ dir: runDir }));
  recordStep(adb, runDir, { id: 'ARR-01', nota: session.arranqueMs != null ? `arranque en frío ${session.arranqueMs} ms` : 'inicio' });

  console.log(`\n✓ Auditoría iniciada en ${runDir}`);
  console.log(`  ${session.modelo} · Android ${session.android} · Yoru ${session.versionName} (${session.versionCode})`);
  if (session.arranqueMs != null) console.log(`  Arranque en frío: ${session.arranqueMs} ms${session.arranqueMs > 4000 ? '  ⚠ más de 4 s' : ''}`);
  if (session.ota) console.log(`  ⚠ Hay una OTA guardada en el teléfono: ${session.ota}`);
  console.log('  Sigue con: node mobile/qa/auditoria.mjs guiado');
}

function recordStep(adb, runDir, { id, nota, bug, sev, saltado }) {
  const steps = readSteps(runDir);
  const n = steps.filter((s) => s.id === id).length;
  const captura = saltado ? null : `${id}${n ? `-${n + 1}` : ''}.png`;
  const ok = captura ? screenshot(adb, path.join(runDir, 'capturas', captura)) : false;
  const logFile = path.join(runDir, 'logcat.txt');
  const step = {
    id,
    hora: new Date().toISOString(),
    pid: appPid(adb),
    pssKb: parseMeminfoKb(adb.shell(`dumpsys meminfo ${PKG}`, { allowFail: true })),
    logOffset: fs.existsSync(logFile) ? fs.statSync(logFile).size : 0,
    captura: ok ? captura : null,
    ...(nota ? { nota } : {}),
    ...(bug ? { bug, sev: SEVERITIES.includes(sev) ? sev : 'S3' } : {}),
    ...(saltado ? { saltado: true } : {}),
  };
  fs.appendFileSync(path.join(runDir, 'pasos.jsonl'), `${JSON.stringify(step)}\n`);
  const prev = [...steps].reverse().find((s) => s.pid);
  if (prev && step.pid && prev.pid !== step.pid) console.log(`  ⚠ La app cambió de PID (${prev.pid} → ${step.pid}): ¿se cerró?`);
  if (prev && !step.pid) console.log('  ⚠ La app no está en marcha.');
  return step;
}

function cmdPaso(opts) {
  const id = opts._[1];
  if (!id) fail('Uso: paso <ID> [--nota texto] [--bug texto --sev S2]');
  const { runDir, session } = loadSession();
  const adb = makeAdb(session.serial);
  const step = recordStep(adb, runDir, { id, nota: opts.nota && String(opts.nota), bug: opts.bug && String(opts.bug), sev: opts.sev && String(opts.sev).toUpperCase() });
  console.log(`✓ ${id}${step.bug ? ` · bug ${step.sev}` : ''} · ${step.captura || 'sin captura'} · PSS ${step.pssKb ? Math.round(step.pssKb / 1024) + ' MB' : '?'}`);
}

export function readPlanSteps(planText) {
  const steps = [];
  for (const line of planText.split('\n')) {
    const m = line.match(/^- \[[ x]\] \*\*([A-Z]+-\d+)\*\* (.*)$/);
    if (m) steps.push({ id: m[1], texto: m[2] });
  }
  return steps;
}

async function cmdGuiado(opts) {
  const { runDir, session } = loadSession();
  const adb = makeAdb(session.serial);
  let steps = readPlanSteps(fs.readFileSync(PLAN, 'utf8'));
  if (opts.solo) {
    const areas = String(opts.solo).toUpperCase().split(',').map((s) => s.trim());
    steps = steps.filter((s) => areas.includes(s.id.split('-')[0]) || s.id === 'ARR-01' || s.id === 'GEN-01');
  }
  if (opts.desde) {
    const i = steps.findIndex((s) => s.id === String(opts.desde).toUpperCase());
    if (i < 0) fail(`No encuentro el paso ${opts.desde}`);
    steps = steps.slice(i);
  }
  const done = new Set(readSteps(runDir).map((s) => s.id));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // Reading through the iterator keeps lines that arrive early (piped answers) instead of dropping them.
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (q) => { process.stdout.write(q); const r = await lines.next(); return r.done ? 'q' : r.value; };
  console.log('Intro = ok · b = bug · n = nota · s = saltar · q = salir\n');
  for (const s of steps) {
    console.log(`\n${s.id}${done.has(s.id) ? ' (ya registrado)' : ''}\n  ${s.texto}`);
    const ans = (await ask('  > ')).trim().toLowerCase();
    if (ans === 'q') break;
    if (ans === 's') { recordStep(adb, runDir, { id: s.id, saltado: true }); continue; }
    if (ans === 'b') {
      const sev = (await ask('  Severidad (S1-S4) [S3]: ')).trim().toUpperCase() || 'S3';
      const bug = (await ask('  ¿Qué falla?: ')).trim();
      recordStep(adb, runDir, { id: s.id, bug: bug || 'sin descripción', sev });
      console.log('  ✓ bug registrado con captura');
      continue;
    }
    const nota = ans === 'n' ? (await ask('  Nota: ')).trim() : undefined;
    recordStep(adb, runDir, { id: s.id, nota });
    console.log('  ✓');
  }
  rl.close();
  console.log('\nCuando termines: node mobile/qa/auditoria.mjs fin');
}

function stopLogcat(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid);
  } catch { /* already stopped */ }
}

function cmdFin() {
  const { runDir, session } = loadSession();
  const adb = makeAdb(session.serial);
  recordStep(adb, runDir, { id: 'FIN', nota: 'estado final' });
  stopLogcat(session.logcatPid);

  const crash = adb.shell(`run-as ${PKG} cat files/yoru-last-crash.txt`, { allowFail: true });
  const extras = { crash: /Yoru Reader Android crash/.test(crash) ? crash.trim() : null, jsIssues: [] };
  if (extras.crash) fs.writeFileSync(path.join(runDir, 'yoru-last-crash.txt'), extras.crash);

  const lsDir = 'app_webview/Default/Local Storage/leveldb';
  const files = adb.shell(`run-as ${PKG} ls "${lsDir}"`, { allowFail: true }).split('\n').map((f) => f.trim()).filter((f) => /\.(log|ldb)$/.test(f));
  const buffers = files.map((f) => adb.run(['exec-out', `run-as ${PKG} cat "${lsDir}/${f}"`], { binary: true, allowFail: true })).filter(Boolean);
  extras.jsIssues = extractRuntimeIssues(buffers);
  fs.writeFileSync(path.join(runDir, 'extras.json'), JSON.stringify(extras, null, 2));

  session.terminada = new Date().toISOString();
  saveSession(runDir, session);
  writeReport(runDir, session, extras);
  fs.rmSync(CURRENT, { force: true });
}

function writeReport(runDir, session, extras) {
  const logFile = path.join(runDir, 'logcat.txt');
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  const report = buildReport(session, readSteps(runDir), log, extras);
  fs.writeFileSync(path.join(runDir, 'informe.md'), report);
  console.log(`✓ Informe: ${path.join(runDir, 'informe.md')}`);
  console.log(`  Cópialo a docs/qa/informes/ y la carpeta entera a la carpeta del proyecto auditoria-qa/ (docs/AUDITORIA_QA.md §8).`);
}

function cmdInforme(opts) {
  const { runDir, session } = loadSession(opts._[1]);
  const extrasFile = path.join(runDir, 'extras.json');
  writeReport(runDir, session, fs.existsSync(extrasFile) ? JSON.parse(fs.readFileSync(extrasFile, 'utf8')) : {});
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0];
  try {
    if (cmd === 'inicio') cmdInicio(opts);
    else if (cmd === 'paso') cmdPaso(opts);
    else if (cmd === 'guiado') await cmdGuiado(opts);
    else if (cmd === 'fin') cmdFin();
    else if (cmd === 'informe') cmdInforme(opts);
    else {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.exit(cmd ? 1 : 0);
    }
  } catch (error) {
    fail(error.message);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
