// Builds the reader extension (backend/reader-ext) from source: the Yoru branch of Jiten Reader
// pinned in build/reader-ext.json. Used by the release workflow and for local builds.
// Usage: node build/build-reader-ext.mjs
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { repository, ref } = JSON.parse(readFileSync(path.join(root, 'build/reader-ext.json'), 'utf8'));
const target = path.join(root, 'backend/reader-ext');
const workDir = mkdtempSync(path.join(tmpdir(), 'yoru-reader-ext-'));
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });

try {
  console.log(`[reader-ext] Building ${repository} @ ${ref}`);
  run('git', ['clone', '--quiet', '--depth', '1', '--branch', ref, repository, 'src'], workDir);
  const source = path.join(workDir, 'src');
  run('npm', ['ci', '--no-audit', '--no-fund'], source);
  run('node', ['scripts/build.mjs', 'chrome'], source);

  // Keep Yoru's attribution header on the upstream license.
  const notice = readFileSync(path.join(target, 'LICENSE.md'), 'utf8');
  rmSync(target, { recursive: true, force: true });
  cpSync(path.join(source, 'jiten.reader'), target, { recursive: true });
  writeFileSync(path.join(target, 'LICENSE.md'), notice);

  console.log(`[reader-ext] Wrote ${path.relative(root, target)}`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
