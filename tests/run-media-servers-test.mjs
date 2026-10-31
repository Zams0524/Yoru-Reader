// Bundles tests/media-servers.test.ts with rolldown (comes with Vite) and runs it in Node.
import { build } from 'rolldown';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const out = join(mkdtempSync(join(tmpdir(), 'yoru-media-test-')), 'test.mjs');
await build({
  input: fileURLToPath(new URL('./media-servers.test.ts', import.meta.url)),
  platform: 'node',
  // The EPUB/PDF parser (pdf.js worker) is not needed: only the server clients are tested.
  external: [/fileImport/],
  output: { file: out, format: 'esm', codeSplitting: false },
  logLevel: 'warn',
});
await import(pathToFileURL(out).href);
