// Bundles tests/yoru-sync.test.ts with rolldown (comes with Vite) and runs it in Node.
import { build } from 'rolldown';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const out = join(mkdtempSync(join(tmpdir(), 'yoru-sync-test-')), 'test.mjs');
await build({
  input: fileURLToPath(new URL('./yoru-sync.test.ts', import.meta.url)),
  platform: 'node',
  output: { file: out, format: 'esm', codeSplitting: false },
  logLevel: 'warn',
});
await import(pathToFileURL(out).href);
