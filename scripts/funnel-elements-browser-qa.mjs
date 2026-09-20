import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Browser-only QA runs from a source mirror that cannot contain workspace
// .env files. The node_modules junction is read-only dependency reuse.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'celebratedeal-funnel-elements-'));
const mirror = path.join(work, 'app');
const allowedFiles = ['package.json', 'tsconfig.json', 'next.config.ts', 'postcss.config.mjs', 'sentry.server.config.ts', 'sentry.edge.config.ts'];
const environment = {
  PATH: process.env.PATH ?? '',
  SystemRoot: process.env.SystemRoot ?? '',
  ComSpec: process.env.ComSpec ?? '',
  PATHEXT: process.env.PATHEXT ?? '',
  TEMP: work,
  TMP: work,
  CI: 'true',
  CHECKPOINT_DISABLE: '1',
  SENTRY_DISABLE_AUTO_UPLOAD: 'true',
  FUNNEL_ELEMENTS_MIRROR_ROOT: mirror,
};

try {
  fs.mkdirSync(mirror, { recursive: true });
  for (const directory of ['src', 'public']) {
    fs.cpSync(path.join(root, directory), path.join(mirror, directory), {
      recursive: true,
      filter: (candidate) => !path.basename(candidate).startsWith('.env'),
    });
  }
  for (const file of allowedFiles) fs.copyFileSync(path.join(root, file), path.join(mirror, file));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(mirror, 'node_modules'), 'junction');
  const result = spawnSync(process.execPath, [
    path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'),
    'test', '--config', path.join(root, 'playwright.funnel-elements.config.ts'),
  ], { cwd: root, env: environment, encoding: 'utf8', windowsHide: true, maxBuffer: 12 * 1024 * 1024 });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  process.exitCode = result.status ?? 1;
} finally {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { fs.rmSync(work, { recursive: true, force: true }); break; }
    catch (error) {
      if (attempt === 9) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}
