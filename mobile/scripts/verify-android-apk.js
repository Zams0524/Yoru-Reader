import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const REQUIRED_CLASSES = [
  'Landroidx/concurrent/futures/ResolvableFuture;',
  'Landroidx/concurrent/futures/AbstractResolvableFuture;',
  'Lcom/google/common/util/concurrent/ListenableFuture;',
];

function readClassDefinitions(dex, name) {
  const invalid = (reason) => new Error(`${name}: DEX inválido (${reason}).`);
  const requireRange = (offset, size) => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size)
      || offset < 0 || size < 0 || offset > dex.length - size) {
      throw invalid('referencia fuera del archivo');
    }
  };

  requireRange(0, 112);
  if (!/^dex\n0(?:35|37|38|39|40)\0$/.test(dex.toString('latin1', 0, 8))) {
    throw invalid('formato no compatible');
  }
  if (dex.readUInt32LE(32) !== dex.length || dex.readUInt32LE(36) !== 112
    || dex.readUInt32LE(40) !== 0x12345678) {
    throw invalid('cabecera incorrecta');
  }

  const readTable = (headerOffset, entrySize) => {
    const count = dex.readUInt32LE(headerOffset);
    const offset = dex.readUInt32LE(headerOffset + 4);
    requireRange(offset, count * entrySize);
    if (count > 0 && (offset < 112 || offset % 4 !== 0)) {
      throw invalid('tabla desalineada');
    }
    return { count, offset };
  };
  const strings = readTable(56, 4);
  const types = readTable(64, 4);
  const classes = readTable(96, 32);

  const readDescriptor = (stringIndex) => {
    if (stringIndex >= strings.count) throw invalid('índice de cadena incorrecto');
    let offset = dex.readUInt32LE(strings.offset + stringIndex * 4);
    if (offset < 112) throw invalid('dirección de cadena incorrecta');

    // string_data starts with a ULEB128 UTF-16 length, followed by MUTF-8.
    // Required descriptors are ASCII, so no Unicode conversion is needed.
    for (let byteIndex = 0; byteIndex < 5; byteIndex += 1) {
      requireRange(offset, 1);
      const byte = dex[offset++];
      if (byteIndex === 4 && byte > 0x0f) throw invalid('longitud ULEB128 incorrecta');
      if ((byte & 0x80) === 0) break;
    }
    const end = dex.indexOf(0, offset);
    if (end === -1) throw invalid('cadena sin terminador');
    return dex.toString('latin1', offset, end);
  };

  const definitions = new Set();
  for (let index = 0; index < classes.count; index += 1) {
    const typeIndex = dex.readUInt32LE(classes.offset + index * 32);
    if (typeIndex >= types.count) throw invalid('índice de clase incorrecto');
    const descriptorIndex = dex.readUInt32LE(types.offset + typeIndex * 4);
    definitions.add(readDescriptor(descriptorIndex));
  }
  return definitions;
}

/** Reject APKs whose startup dependencies are referenced but not actually defined. */
export async function verifyAndroidApk(apkPath) {
  const apk = await JSZip.loadAsync(await fs.readFile(apkPath));
  const dexFiles = Object.values(apk.files)
    .filter((entry) => !entry.dir && /^classes(?:\d+)?\.dex$/.test(entry.name));
  if (dexFiles.length === 0) throw new Error('El APK no contiene archivos classes.dex.');

  const definitions = new Set();
  // Read one DEX at a time to bound memory when the APK uses multidex.
  for (const entry of dexFiles) {
    const dex = await entry.async('nodebuffer');
    for (const descriptor of readClassDefinitions(dex, entry.name)) {
      definitions.add(descriptor);
    }
  }
  const missing = REQUIRED_CLASSES.filter((descriptor) => !definitions.has(descriptor));
  if (missing.length > 0) {
    throw new Error(`APK incompleto: faltan clases de arranque: ${missing.join(', ')}. `
      + 'Revisa las exclusiones de dependencias de Android antes de distribuirlo.');
  }
  // The native reader runs the engine from nativeLibraryDir: it must be in the APK, stored uncompressed
  // or extracted (useLegacyPackaging in android/app/build.gradle).
  if (!apk.file("lib/arm64-v8a/liberaepub.so")) {
    throw new Error("APK incompleto: falta lib/arm64-v8a/liberaepub.so (motor del lector nativo).");
  }
  return { dexFiles: dexFiles.length, classCount: definitions.size, requiredClasses: REQUIRED_CLASSES.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('Uso: node mobile/scripts/verify-android-apk.js <archivo.apk>');
    const result = await verifyAndroidApk(process.argv[2]);
    console.log(`APK verificado: ${result.requiredClasses} clases de arranque presentes `
      + `en ${result.dexFiles} DEX (${result.classCount} clases definidas).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
