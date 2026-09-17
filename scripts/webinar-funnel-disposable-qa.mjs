import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listCanonicalMigrations, writeMirror } from './prisma-loopback-disposable-migration-runner.mjs';

// Run the real application from a source-only mirror: never load workspace env files.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = crypto.randomBytes(6).toString('hex');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'celebratedeal-webinar-qa-'));
let app = path.join(work, 'app');
const name = `celebratedeal-webinar-qa-${id}`;
const evidence = path.join(root, 'docs/ai-team/evidence/webinar-funnel-20260917');
fs.mkdirSync(evidence, { recursive: true });
const reusableFiles = ['package.json', 'tsconfig.json', 'next.config.ts', 'postcss.config.mjs', 'sentry.server.config.ts', 'sentry.edge.config.ts'];
function sourceDigest(base) {
  const digest = crypto.createHash('sha256');
  const visit = (relative) => {
    const absolute = path.join(base, relative);
    if (fs.statSync(absolute).isDirectory()) {
      for (const item of fs.readdirSync(absolute).sort()) if (!item.startsWith('.env')) visit(path.join(relative, item));
    } else { digest.update(relative); digest.update(fs.readFileSync(absolute)); }
  };
  for (const item of ['src', 'public', ...reusableFiles]) visit(item);
  return digest.digest('hex');
}
let reuseBuild = false;
if (process.argv.includes('--reuse-build') || process.argv.includes('--refresh-build')) {
  const previous = JSON.parse(fs.readFileSync(path.join(evidence, 'receipt.json'), 'utf8'));
  const previousRoot = path.resolve(previous.mirror);
  if (path.dirname(previousRoot) !== path.resolve(os.tmpdir()) || !path.basename(previousRoot).startsWith('celebratedeal-webinar-qa-') || previous.build !== 'PASS') throw new Error('Unverified build mirror');
  const previousApp = path.join(previousRoot, 'app');
  if (process.argv.includes('--reuse-build') && sourceDigest(previousApp) !== sourceDigest(root)) throw new Error('Application changed; rebuild required');
  app = previousApp; reuseBuild = process.argv.includes('--reuse-build');
} else fs.mkdirSync(app);
const env = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ComSpec: process.env.ComSpec ?? '', PATHEXT: process.env.PATHEXT ?? '', TEMP: work, TMP: work, CI: 'true', CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: 'true', SENTRY_DISABLE_AUTO_UPLOAD: 'true' };
const receipt = { status: 'RUNNING', migrations: 'NOT_RUN', build: 'NOT_RUN', browser: 'NOT_RUN', cleanup: 'NOT_RUN', sourceEnvRead: false, target: 'new disposable loopback PostgreSQL', migrationCount: 0 };
function run(command, args, cwd = app, extra = {}) {
  return spawnSync(command, args, { cwd, env: { ...env, ...extra }, encoding: 'utf8', windowsHide: true, maxBuffer: 12 * 1024 * 1024 });
}
function must(result, phase) {
  if (result.status !== 0) {
    // Inputs are only source and synthetic fixtures; redact connection-shaped strings.
    process.stdout.write((result.stdout + result.stderr).replace(/postgres(?:ql)?:\/\/\S+/g, '[disposable database]').slice(-12000));
    throw new Error(`${phase} failed`);
  }
}
let created = false;
try {
  for (const dir of (reuseBuild ? ['tests'] : ['src', 'public', 'tests'])) fs.cpSync(path.join(root, dir), path.join(app, dir), { recursive: true, filter: (p) => !path.basename(p).startsWith('.env') });
  fs.mkdirSync(path.join(app, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts/local-database-safety.ts'), path.join(app, 'scripts/local-database-safety.ts'));
  if (!reuseBuild) {
    for (const file of [...reusableFiles, 'next-env.d.ts']) fs.copyFileSync(path.join(root, file), path.join(app, file));
    if (!fs.existsSync(path.join(app, 'node_modules'))) fs.symlinkSync(path.join(root, 'node_modules'), path.join(app, 'node_modules'), 'junction');
  }
  if (sourceDigest(app) !== sourceDigest(root)) throw new Error('Source mirror mismatch');
  receipt.sourceSha256 = sourceDigest(app);
  receipt.browserTestSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(app, 'tests/e2e/webinar-funnel-flow.spec.ts'))).digest('hex');
  const start = run('docker', ['run', '-d', '--pull=never', '--name', name, '--label', `celebratedeal.webinar-qa=${id}`, '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=celebratedeal_test', '--tmpfs', '/var/lib/postgresql/data', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
  must(start, 'container'); created = true;
  let ready = false;
  for (let i = 0; i < 30; i++) { if (run('docker', ['exec', name, 'pg_isready', '-U', 'postgres']).status === 0) { ready = true; break; } Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); }
  if (!ready) throw new Error('database readiness failed');
  const portResult = run('docker', ['port', name, '5432/tcp']); must(portResult, 'port');
  const port = /^127\.0\.0\.1:(\d+)\s*$/.exec(portResult.stdout)?.[1];
  if (!port) throw new Error('loopback identity failed');
  env.DATABASE_URL = env.DIRECT_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/celebratedeal_test?schema=public`;
  const migrations = listCanonicalMigrations();
  const mirror = writeMirror(work, migrations);
  const prisma = path.join(root, 'node_modules/prisma/build/index.js');
  for (const args of [['validate'], ['migrate', 'deploy'], ['migrate', 'status']]) must(run(process.execPath, [prisma, ...args, '--config', path.join(mirror, 'prisma.config.mjs')], mirror), `migration ${args.join(' ')}`);
  receipt.migrations = 'PASS'; receipt.migrationCount = migrations.length;
  process.stdout.write(`Migration PASS (${migrations.length} migrations)\n`);
  Object.assign(env, { E2E_TEST_MODE: 'true', E2E_BASE_URL: 'http://127.0.0.1:31138', NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:31138', PAYMENT_PROVIDER: 'demo', RATE_LIMIT_PROVIDER: 'memory', CSRF_SECRET: 'celebratedeal-local-playwright-csrf-secret-v1', CRON_SECRET: 'celebratedeal-local-playwright-cron-secret-v1', JOB_SECRET: 'e2e-job-secret-at-least-16-chars', LIVE_CHAT_INGRESS_SECRET: 'celebratedeal-local-playwright-live-chat-ingress-secret-v1', BANK_ACCOUNT_KEYRING_JSON: JSON.stringify({ activeKeyId: 'playwright', keys: { playwright: Buffer.alloc(32, 7).toString('base64url') } }), G7_COMMERCE_LOOPBACK_TLS_BRIDGE: '1', SMOKE_TEST_EMAIL: 'webinar-qa@example.test', WEBINAR_QA_SCREENSHOT_DIR: evidence });
  const next = path.join(root, 'node_modules/next/dist/bin/next');
  if (!reuseBuild) {
    process.stdout.write('Building isolated Next.js application...\n');
    must(run(process.execPath, [next, 'build', '--webpack'], app, { NODE_ENV: 'production' }), 'build');
  } else process.stdout.write('Reusing source-identical production build.\n');
  receipt.build = 'PASS';
  process.stdout.write('Production build PASS; running browser journey...\n');
  receipt.buildReused = reuseBuild;
  const config = `import { defineConfig } from '@playwright/test';\nexport default defineConfig({testDir:'./tests/e2e',testMatch:'webinar-funnel-flow.spec.ts',timeout:180000,workers:1,retries:0,reporter:'list',use:{baseURL:'http://127.0.0.1:31138',trace:'off',launchOptions:{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}},webServer:{command:${JSON.stringify(`"${process.execPath}" "${next}" start --hostname 127.0.0.1 --port 31138`)},url:'http://127.0.0.1:31138/login',reuseExistingServer:false,timeout:120000,env:{NODE_ENV:'production'}}});`;
  fs.writeFileSync(path.join(app, 'playwright.webinar.config.ts'), config);
  const browser = run(process.execPath, [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--config', 'playwright.webinar.config.ts']);
  receipt.browser = browser.status === 0 ? 'PASS' : 'FAIL';
  must(browser, 'browser'); process.stdout.write(browser.stdout.slice(-3000));
  receipt.browser = 'PASS'; receipt.status = 'PASS';
} catch (error) { receipt.status = 'FAIL'; receipt.failure = error.message; process.exitCode = 1; }
finally {
  if (created) {
    const identity = run('docker', ['inspect', '--format', '{{index .Config.Labels "celebratedeal.webinar-qa"}}', name]);
    if (identity.status === 0 && identity.stdout.trim() === id) receipt.cleanup = run('docker', ['rm', '-f', name]).status === 0 ? 'PASS' : 'FAIL';
    else receipt.cleanup = 'IDENTITY_MISMATCH';
    if (receipt.cleanup !== 'PASS') { receipt.status = 'FAIL'; process.exitCode = 1; }
  }
  // Keep source-only mirror for failure diagnosis. It contains synthetic test data only.
  receipt.mirror = path.dirname(app);
  fs.writeFileSync(path.join(evidence, `receipt-${id}.json`), JSON.stringify(receipt, null, 2) + '\n');
  fs.writeFileSync(path.join(evidence, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  process.stdout.write(JSON.stringify(receipt) + '\n');
}
