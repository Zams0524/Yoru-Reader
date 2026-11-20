#!/usr/bin/env node
/**
 * Genera sola la alineación texto↔audio de cada audiolibro y la deja donde el servidor
 * de sincronización la sirve (`servidor-sync/datos/alineaciones/<id de ABS>.srt`).
 *
 * Es la pieza que faltaba para que «Leer y escuchar» funcione sin importar nada: la
 * app pide la alineación por el id del audiolibro, y este programa es quien la pone
 * ahí. Corre en el PC donde están los EPUB y los audios.
 *
 * El trabajo de alinear lo hace Honomiya (https://github.com/Natsume-197/Honomiya, de
 * Natsume, licencia MIT) con su motor CTC: va en CPU, sin Python ni tarjeta gráfica, a
 * unas veinte o treinta veces el tiempo real. Aquí no se copia nada suyo: se le llama
 * como programa aparte y se lee lo que deja.
 *
 * Qué hace, por cada audiolibro de Audiobookshelf que aún no tenga alineación:
 *   1. busca su EPUB (por la lista de parejas; ver `--parejas`);
 *   2. llama a `honomiya align --engine ctc --srt`;
 *   3. junta los SRT de las pistas en uno solo con tiempos del audiolibro entero,
 *      le pone delante el veredicto que entiende la app, y lo guarda.
 *
 * Se puede cortar y volver a lanzar: lo hecho no se repite y Honomiya guarda en caché
 * las emisiones a medio hacer.
 *
 * Uso:  node tools/alineador-auto/generar.mjs [--solo <id>] [--max N] [--ver] [--reintentar]
 * Configuración: `tools/alineador-auto/config.json` (ver README.md).
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..');

/* ------------------------------------------------------------------ configuración */

function leerEnv(ruta) {
  const fuera = {};
  let texto = '';
  try { texto = readFileSync(ruta, 'utf8'); } catch { return fuera; }
  for (const linea of texto.split(/\r?\n/)) {
    const corte = linea.indexOf('=');
    if (corte <= 0 || linea.trim().startsWith('#')) continue;
    fuera[linea.slice(0, corte).trim()] = linea.slice(corte + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return fuera;
}

export function cargarConfig(args = process.argv.slice(2)) {
  let fichero = {};
  try { fichero = JSON.parse(readFileSync(join(AQUI, 'config.json'), 'utf8')); } catch { /* sin fichero valen los valores por omisión */ }
  // Las claves de Audiobookshelf ya viven en el .env del servidor de sync: no se repiten.
  const env = { ...leerEnv(join(RAIZ, 'servidor-sync', '.env')), ...process.env };
  const opcion = (nombre) => {
    const i = args.indexOf(`--${nombre}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    absUrl: String(fichero.absUrl || env.YORU_SYNC_ABS_URL || 'http://localhost:13378').replace(/\/+$/, ''),
    absToken: String(fichero.absToken || env.YORU_SYNC_ABS_TOKEN || ''),
    /** Carpetas donde buscar los EPUB (las de la biblioteca de Kavita). */
    libros: [].concat(fichero.libros || []),
    /** La lista de parejas EPUB↔audiolibro, con el formato de `readListen.listPairings`. */
    parejas: fichero.parejas || '',
    honomiya: fichero.honomiya || '',
    bun: fichero.bun || 'bun',
    salida: fichero.salida || env.YORU_SYNC_ALINEACIONES || join(RAIZ, 'servidor-sync', 'datos', 'alineaciones'),
    trabajo: fichero.trabajo || join(AQUI, 'trabajo'),
    hilos: Number(fichero.hilos || 0),
    solo: opcion('solo') || '',
    max: Number(opcion('max') || 0),
    ver: args.includes('--ver'),
    reintentar: args.includes('--reintentar'),
  };
}

/* --------------------------------------------------------------- Audiobookshelf */

async function abs(config, ruta) {
  const respuesta = await fetch(`${config.absUrl}${ruta}`, { headers: { Authorization: `Bearer ${config.absToken}` } });
  if (!respuesta.ok) throw new Error(`Audiobookshelf contestó ${respuesta.status} a ${ruta}`);
  return respuesta.json();
}

/** Todos los audiolibros, con las rutas de sus pistas en orden. */
async function audiolibros(config) {
  const { libraries = [] } = await abs(config, '/api/libraries');
  const fuera = [];
  for (const biblioteca of libraries) {
    if (biblioteca.mediaType && biblioteca.mediaType !== 'book') continue;
    const { results = [] } = await abs(config, `/api/libraries/${biblioteca.id}/items?limit=0`);
    for (const item of results) fuera.push({ id: item.id, titulo: item.media?.metadata?.title || '' });
  }
  return fuera;
}

async function pistasDe(config, id) {
  const item = await abs(config, `/api/items/${id}?expanded=1`);
  return (item.media?.audioFiles || [])
    .filter((pista) => !pista.exclude)
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((pista) => ({ ruta: pista.metadata?.path || '', duracionMs: Math.round((pista.duration || 0) * 1000) }));
}

/* -------------------------------------------------------------- buscar el EPUB */

const nfc = (texto) => String(texto || '').normalize('NFC');

function recorrer(carpeta, fuera = []) {
  let entradas = [];
  try { entradas = readdirSync(carpeta, { withFileTypes: true }); } catch { return fuera; }
  for (const entrada of entradas) {
    const ruta = join(carpeta, entrada.name);
    if (entrada.isDirectory()) recorrer(ruta, fuera);
    else if (extname(entrada.name).toLowerCase() === '.epub') fuera.push(ruta);
  }
  return fuera;
}

/**
 * Del nombre del fichero de audio al EPUB que va con él.
 *
 * No se adivina por el título: la lista de parejas dice qué EPUB va con qué audio, con
 * el nombre exacto de cada fichero. Un audiolibro que no esté en la lista se salta y se
 * dice; alinearlo contra «el EPUB que más se parece» daría un resaltado que miente, y
 * en un libro para aprender japonés eso es peor que no tener resaltado.
 */
export function buscadorDeEpub(parejas, epubs) {
  const epubPorNombre = new Map(epubs.map((ruta) => [nfc(basename(ruta)), ruta]));
  const ebookPorAudio = new Map();
  for (const pareja of parejas) {
    const audio = nfc(pareja?.audiobook?.filename || pareja?.audioFilename);
    const ebook = nfc(pareja?.ebook?.filename || pareja?.ebookFilename);
    if (audio && ebook && !ebookPorAudio.has(audio)) ebookPorAudio.set(audio, ebook);
  }
  return (rutaAudio) => {
    const ebook = ebookPorAudio.get(nfc(basename(rutaAudio)));
    return ebook ? epubPorNombre.get(ebook) || null : null;
  };
}

/* ------------------------------------------------------------- juntar los SRT */

function aMs(marca) {
  const m = marca.trim().match(/^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/);
  return m ? (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + Number(m[4].padEnd(3, '0')) : null;
}

function aMarca(ms) {
  const dos = (n) => String(n).padStart(2, '0');
  return `${dos(Math.floor(ms / 3_600_000))}:${dos(Math.floor(ms / 60_000) % 60)}:${dos(Math.floor(ms / 1000) % 60)},${String(ms % 1000).padStart(3, '0')}`;
}

function cuesDe(srt, desplazamientoMs) {
  const fuera = [];
  for (const bloque of srt.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const lineas = bloque.split('\n').map((l) => l.trim()).filter(Boolean);
    const flecha = lineas.findIndex((l) => l.includes('-->'));
    if (flecha < 0) continue;
    const [desde, hasta] = lineas[flecha].split('-->').map(aMs);
    const texto = lineas.slice(flecha + 1).join(' ').trim();
    if (desde === null || hasta === null || hasta <= desde || !texto) continue;
    fuera.push({ startMs: desde + desplazamientoMs, endMs: hasta + desplazamientoMs, texto });
  }
  return fuera;
}

/**
 * Un SRT por audiolibro, con los tiempos contados desde el principio del audiolibro.
 *
 * Honomiya escribe un SRT por pista y cada uno empieza en cero. La app reproduce el
 * audiolibro como una sola línea de tiempo (así lo da Audiobookshelf), de modo que a
 * cada pista se le suma lo que duran las anteriores.
 *
 * Delante va el veredicto, en la línea que `parseVerdict` de la app sabe leer: no es
 * un cue, así que el fichero sigue siendo un SRT corriente.
 */
export function unirSrt(srtPorPista, duracionesMs, informe) {
  const cues = [];
  let desplazamiento = 0;
  srtPorPista.forEach((srt, i) => {
    if (srt) cues.push(...cuesDe(srt, desplazamiento));
    desplazamiento += duracionesMs[i] || 0;
  });
  cues.sort((a, b) => a.startMs - b.startMs);

  const cobertura = Number(informe?.alignment?.bookCoverage ?? informe?.alignment?.directCoverage ?? 0);
  const totalMs = desplazamiento || (cues.length ? cues[cues.length - 1].endMs : 0);
  const conTexto = cues.reduce((suma, cue) => suma + (cue.endMs - cue.startMs), 0);
  const veredicto = {
    verdict: cobertura >= 0.8 ? 'bueno' : 'parcial',
    coverage: Math.round(cobertura * 1000) / 1000,
    audioCoverage: totalMs ? Math.round((conTexto / totalMs) * 1000) / 1000 : 0,
    notice: '',
    aside: [],
    generator: 'honomiya-ctc',
  };
  const cuerpo = cues.map((cue, i) => `${i + 1}\n${aMarca(cue.startMs)} --> ${aMarca(cue.endMs)}\n${cue.texto}`).join('\n\n');
  return { srt: `YORU-ALINEACION v1 ${JSON.stringify(veredicto)}\n\n${cuerpo}\n`, cues: cues.length, veredicto };
}

/* ------------------------------------------------------------------- Honomiya */

function ejecutar(orden, args, opciones) {
  return new Promise((resolver) => {
    const hijo = spawn(orden, args, { ...opciones, stdio: ['ignore', 'inherit', 'inherit'] });
    hijo.on('error', (error) => resolver({ codigo: -1, error }));
    hijo.on('close', (codigo) => resolver({ codigo }));
  });
}

async function alinear(config, id, epub, pistas) {
  const carpeta = join(config.trabajo, id);
  mkdirSync(carpeta, { recursive: true });
  const salida = join(carpeta, 'alineacion.json');
  const args = ['run', join(config.honomiya, 'src', 'cli.ts'), 'align', '--ebook', epub];
  for (const pista of pistas) args.push('--audio', pista.ruta);
  args.push('--engine', 'ctc', '--srt', '--output', salida, '--cache-dir', join(carpeta, 'cache'));
  if (config.hilos > 0) args.push('--threads', String(config.hilos));

  const hecho = await ejecutar(config.bun, args, { cwd: config.honomiya });
  if (hecho.codigo !== 0) return { error: hecho.error ? String(hecho.error.message) : `honomiya salió con ${hecho.codigo}` };

  const srtPorPista = pistas.map((pista) => {
    const ruta = join(carpeta, `${basename(pista.ruta, extname(pista.ruta))}.honomiya.srt`);
    try { return readFileSync(ruta, 'utf8'); } catch { return ''; }
  });
  let informe = null;
  try { informe = JSON.parse(readFileSync(`${salida}.report.json`, 'utf8')); } catch { /* sin informe se da por parcial */ }
  let duraciones = pistas.map((pista) => pista.duracionMs);
  try {
    // Lo que midió Honomiya manda sobre lo que dice Audiobookshelf: es contra lo que alineó.
    const manifiesto = JSON.parse(readFileSync(salida, 'utf8'));
    const medidas = (manifiesto.sources?.audioFiles || []).sort((a, b) => a.index - b.index).map((a) => a.durationMs);
    if (medidas.length === pistas.length && medidas.every(Boolean)) duraciones = medidas;
  } catch { /* se queda lo de Audiobookshelf */ }
  return { ...unirSrt(srtPorPista, duraciones, informe), carpeta };
}

/* ------------------------------------------------------------------- el bucle */

function registrar(...partes) {
  console.log(`[${new Date().toISOString()}]`, ...partes);
}

async function principal() {
  const config = cargarConfig();
  if (!config.absToken) throw new Error('Falta el token de Audiobookshelf (servidor-sync/.env o config.json).');
  if (!config.ver && !existsSync(join(config.honomiya, 'src', 'cli.ts'))) {
    throw new Error('No encuentro Honomiya. Pon su carpeta en "honomiya" de config.json (ver README.md).');
  }
  mkdirSync(config.salida, { recursive: true });

  const parejas = config.parejas ? JSON.parse(readFileSync(config.parejas, 'utf8')) : [];
  const epubs = config.libros.flatMap((carpeta) => recorrer(carpeta));
  const epubDe = buscadorDeEpub(parejas, epubs);
  registrar(`${epubs.length} EPUB en disco, ${parejas.length} parejas conocidas`);

  let todos = await audiolibros(config);
  if (config.solo) todos = todos.filter((a) => a.id === config.solo);
  const cuenta = { hechas: 0, yaEstaban: 0, sinEpub: 0, fallidas: 0 };

  for (const audiolibro of todos) {
    const destino = join(config.salida, `${audiolibro.id}.srt`);
    if (existsSync(destino)) { cuenta.yaEstaban += 1; continue; }
    // Un libro que ya falló no se reintenta solo: `--reintentar` lo vuelve a probar.
    if (!config.reintentar && existsSync(join(config.trabajo, audiolibro.id, 'FALLO.txt'))) { cuenta.fallidas += 1; continue; }

    const pistas = await pistasDe(config, audiolibro.id);
    const epub = pistas.length ? epubDe(pistas[0].ruta) : null;
    if (!epub || pistas.some((pista) => !pista.ruta || !existsSync(pista.ruta))) {
      cuenta.sinEpub += 1;
      if (config.ver) registrar('sin pareja en disco:', audiolibro.titulo);
      continue;
    }
    if (config.ver) { registrar('pendiente:', audiolibro.titulo); cuenta.hechas += 1; continue; }

    registrar('alineando:', audiolibro.titulo, `(${pistas.length} pista(s))`);
    const inicio = Date.now();
    const resultado = await alinear(config, audiolibro.id, epub, pistas);
    if (resultado.error || !resultado.cues) {
      cuenta.fallidas += 1;
      registrar('  falló:', resultado.error || 'no salió ningún cue');
      // Queda apuntado para no reintentar en bucle un libro que no casa.
      writeFileSync(join(config.trabajo, audiolibro.id, 'FALLO.txt'), String(resultado.error || 'sin cues'));
      continue;
    }
    // Escribir a un lado y renombrar: el servidor nunca ve un fichero a medias.
    writeFileSync(`${destino}.tmp`, resultado.srt, 'utf8');
    renameSync(`${destino}.tmp`, destino);
    rmSync(resultado.carpeta, { recursive: true, force: true });
    cuenta.hechas += 1;
    registrar(`  hecho en ${Math.round((Date.now() - inicio) / 60000)} min:`, `${resultado.cues} frases,`,
      `${Math.round(resultado.veredicto.coverage * 100)} % del libro`);
    if (config.max && cuenta.hechas >= config.max) break;
  }

  registrar(config.ver ? 'pendientes:' : 'hechas:', cuenta.hechas, '· ya estaban:', cuenta.yaEstaban,
    '· sin pareja en disco:', cuenta.sinEpub, '· fallidas:', cuenta.fallidas);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((error) => { console.error(String(error?.message || error)); process.exit(1); });
}
