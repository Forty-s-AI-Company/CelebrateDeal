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
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'celebratedeal-commerce-qa-'));
let app = path.join(work, 'app');
const name = `celebratedeal-commerce-qa-${id}`;
const evidence = path.join(root, 'docs/ai-team/evidence/funnel-commerce-20260917');
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
  if (path.dirname(previousRoot) !== path.resolve(os.tmpdir()) || !path.basename(previousRoot).startsWith('celebratedeal-commerce-qa-') || previous.build !== 'PASS') throw new Error('Unverified build mirror');
  const previousApp = path.join(previousRoot, 'app');
  if (process.argv.includes('--reuse-build') && sourceDigest(previousApp) !== sourceDigest(root)) throw new Error('Application changed; rebuild required');
  app = previousApp; reuseBuild = process.argv.includes('--reuse-build');
} else fs.mkdirSync(app);
const env = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ComSpec: process.env.ComSpec ?? '', PATHEXT: process.env.PATHEXT ?? '', TEMP: work, TMP: work, CI: 'true', CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: 'true', SENTRY_DISABLE_AUTO_UPLOAD: 'true' };
const receipt = { status: 'RUNNING', migrations: 'NOT_RUN', tests: 'NOT_RUN', typecheck: 'NOT_RUN', build: 'NOT_RUN', browser: 'NOT_RUN', cleanup: 'NOT_RUN', sourceEnvRead: false, paymentEvidence: 'browser transport mock and local integration only; no provider or sandbox payment', externalAssets: 'optional remote Inter stylesheet replaced with inert local CSS; all other external browser requests blocked', target: 'new disposable loopback PostgreSQL', migrationCount: 0 };
function run(command, args, cwd = app, extra = {}) {
  return spawnSync(command, args, { cwd, env: { ...env, ...extra }, encoding: 'utf8', windowsHide: true, maxBuffer: 12 * 1024 * 1024 });
}
function must(result, phase) {
  if (result.status !== 0) {
    // Emit error categories/locations only, never fixture payloads or credentials.
    const diagnostics = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.split(/\r?\n/u)
      .filter(line => /error TS\d+|\b(?:Error|error)\b|Timeout|waiting for (?:locator|getBy)|Error Context:|\d+ failed|QA_(?:REACT_)?DIAGNOSTIC/u.test(line))
      .filter(line => !/cookie|token|secret|password|postgres(?:ql)?:|@/iu.test(line))
      .map(line => line.replace(/\u001b\[[0-9;]*m/gu, '').slice(0, 250)).slice(0, 12);
    receipt.failureDiagnostics = diagnostics;
    process.stdout.write(`${phase}: command failed\n${diagnostics.join('\n')}\n`);
    throw new Error(`${phase} failed`);
  }
}
let created = false;
try {
  for (const dir of (reuseBuild ? ['tests'] : ['src', 'public', 'tests'])) fs.cpSync(path.join(root, dir), path.join(app, dir), { recursive: true, filter: (p) => !path.basename(p).startsWith('.env') });
  fs.mkdirSync(path.join(app, 'scripts'), { recursive: true });
  for (const file of ['local-database-safety.ts', 'node-tap-contract-tests.ts']) fs.copyFileSync(path.join(root, 'scripts', file), path.join(app, 'scripts', file));
  fs.copyFileSync(path.join(root, 'vitest.config.ts'), path.join(app, 'vitest.config.ts'));
  if (!reuseBuild) {
    for (const file of [...reusableFiles, 'next-env.d.ts']) fs.copyFileSync(path.join(root, file), path.join(app, file));
    // Prisma's generated query engine can be locked by a local dev server.
    // Mirror every dependency by link, except @prisma/client which must be a
    // real local copy so its `.prisma/client` lookup stays inside this app.
    const mirrorNodeModules = path.join(app, 'node_modules');
    if (!fs.existsSync(mirrorNodeModules)) {
      fs.mkdirSync(mirrorNodeModules, { recursive: true });
      for (const entry of fs.readdirSync(path.join(root, 'node_modules'), { withFileTypes: true })) {
        const target = path.join(mirrorNodeModules, entry.name);
        // The output directory must never be linked to the workspace client.
        if (entry.name === '.prisma') continue;
        if (entry.name === '@prisma') {
          fs.mkdirSync(target, { recursive: true });
          fs.cpSync(path.join(root, 'node_modules', '@prisma', 'client'), path.join(target, 'client'), { recursive: true });
          continue;
        }
        fs.symlinkSync(path.join(root, 'node_modules', entry.name), target, entry.isDirectory() ? 'junction' : 'file');
      }
    }
    const isolatedPrismaOutputRoot = path.join(mirrorNodeModules, '.prisma');
    fs.mkdirSync(isolatedPrismaOutputRoot, { recursive: true });
    const resolvedMirrorNodeModules = fs.realpathSync(mirrorNodeModules);
    const isolatedPrismaStat = fs.lstatSync(isolatedPrismaOutputRoot);
    const resolvedIsolatedPrismaOutputRoot = fs.realpathSync(isolatedPrismaOutputRoot);
    if (isolatedPrismaStat.isSymbolicLink() || !resolvedIsolatedPrismaOutputRoot.startsWith(`${resolvedMirrorNodeModules}${path.sep}`)) {
      throw new Error('isolated Prisma output is not local');
    }
    fs.mkdirSync(path.join(app, 'prisma'), { recursive: true });
    const sourceSchema = fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8');
    const mirrorSchema = sourceSchema.replace(
      /(generator client \{\r?\n\s+provider = "prisma-client-js")\r?\n\}/u,
      '$1\n  output   = "../node_modules/.prisma/client"\n}',
    );
    if (mirrorSchema === sourceSchema) throw new Error('prisma generator mirror contract changed');
    fs.writeFileSync(path.join(app, 'prisma', 'schema.prisma'), mirrorSchema, 'utf8');
    fs.writeFileSync(path.join(app, 'prisma.source-only.config.mjs'), [
      'import { createRequire } from "node:module";',
      `const require = createRequire(${JSON.stringify(path.join(root, 'package.json'))});`,
      'const { defineConfig } = require("prisma/config");',
      'export default defineConfig({ schema: "./prisma/schema.prisma" });',
      '',
    ].join('\n'), 'utf8');
  }
  if (sourceDigest(app) !== sourceDigest(root)) throw new Error('Source mirror mismatch');
  receipt.sourceSha256 = sourceDigest(app);
  receipt.browserTestSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(app, 'tests/e2e/funnel-commerce.spec.ts'))).digest('hex');
  const start = run('docker', ['run', '-d', '--pull=never', '--name', name, '--label', `celebratedeal.commerce-qa=${id}`, '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=celebratedeal_test', '--tmpfs', '/var/lib/postgresql/data', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
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
  // Generate only into the isolated app mirror. The config has no dotenv
  // loading and this never renames or replaces the workspace Prisma engine.
  const isolatedPrismaOutputRoot = path.join(app, 'node_modules', '.prisma');
  const isolatedPrismaStat = fs.lstatSync(isolatedPrismaOutputRoot);
  const resolvedAppNodeModules = fs.realpathSync(path.join(app, 'node_modules'));
  const resolvedIsolatedPrismaOutputRoot = fs.realpathSync(isolatedPrismaOutputRoot);
  if (isolatedPrismaStat.isSymbolicLink() || !resolvedIsolatedPrismaOutputRoot.startsWith(`${resolvedAppNodeModules}${path.sep}`)) {
    throw new Error('isolated Prisma output is not local');
  }
  const generated = run(process.execPath, [prisma, 'generate', '--config', path.join(app, 'prisma.source-only.config.mjs')]);
  must(generated, 'isolated Prisma client generate');
  const generatedSchema = path.join(app, 'node_modules', '.prisma', 'client', 'schema.prisma');
  if (!fs.existsSync(generatedSchema) || !/\bitems\s+Json\?/u.test(fs.readFileSync(generatedSchema, 'utf8'))) {
    throw new Error('isolated Prisma client schema is stale');
  }
  Object.assign(env, { FUNNEL_COMMERCE_DISPOSABLE_QA: '1', E2E_TEST_MODE: 'true', E2E_BASE_URL: 'http://127.0.0.1:31139', NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:31139', PAYMENT_PROVIDER: 'demo', RATE_LIMIT_PROVIDER: 'memory', CSRF_SECRET: 'celebratedeal-local-playwright-csrf-secret-v1', CRON_SECRET: 'celebratedeal-local-playwright-cron-secret-v1', JOB_SECRET: 'e2e-job-secret-at-least-16-chars', LIVE_CHAT_INGRESS_SECRET: 'celebratedeal-local-playwright-live-chat-ingress-secret-v1', BANK_ACCOUNT_KEYRING_JSON: JSON.stringify({ activeKeyId: 'playwright', keys: { playwright: Buffer.alloc(32, 7).toString('base64url') } }), G7_COMMERCE_LOOPBACK_TLS_BRIDGE: '1', SMOKE_TEST_EMAIL: 'commerce-qa@example.test', FUNNEL_COMMERCE_QA_SCREENSHOT_DIR: evidence });
  const next = path.join(root, 'node_modules/next/dist/bin/next');
  const tests = run(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run',
    'src/lib/funnel-commerce.test.ts', 'src/lib/funnel-commerce-service.test.ts',
    'src/lib/inventory-reservations.test.ts', 'src/lib/funnel-page-document.test.ts',
    'src/lib/funnel-page-history.test.ts', 'src/lib/funnel-step-pages.test.ts',
    'src/lib/funnel-template-gallery.test.ts', 'src/lib/funnel-template-transaction.test.ts',
    'src/lib/landing-page-service.test.ts', 'src/lib/commerce-checkout.test.ts',
    'src/lib/commerce-orders.test.ts', 'src/lib/checkout-admission.test.ts', 'src/lib/checkout-idempotency.test.ts',
    'src/app/api/payments/checkout/route.test.ts', 'src/app/api/payments/checkout/admission/route.test.ts',
    'src/components/commerce-checkout-form.test.tsx',
    'src/components/landing-pages/funnel-commerce-element.test.tsx',
    'src/components/landing-pages/funnel-page-document-renderer.test.tsx',
    'src/app/lp/[slug]/[stepPath]/checkout/page.test.tsx',
    'src/app/checkout/result/page.test.tsx', 'src/app/api/webhooks/payments/route.test.ts',
    '--reporter=json', '--outputFile=commerce-tests.json'], app, { NODE_ENV: 'test', E2E_TEST_MODE: 'false' });
  receipt.tests = tests.status === 0 ? 'PASS' : 'FAIL';
  const reportPath = path.join(app, 'commerce-tests.json');
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    receipt.testCounts = { passed: report.numPassedTests, failed: report.numFailedTests, pending: report.numPendingTests };
    receipt.failedTests = report.testResults.flatMap(file => file.assertionResults.filter(item => item.status === 'failed').map(item => item.fullName));
  }
  must(tests, 'integration tests');
  process.stdout.write(`Integration tests PASS (${receipt.testCounts.passed})\n`);
  must(run(process.execPath, [next, 'typegen']), 'typegen');
  must(run(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit']), 'typecheck');
  receipt.typecheck = 'PASS';
  if (!reuseBuild) {
    process.stdout.write('Building isolated Next.js application...\n');
    must(run(process.execPath, [next, 'build', '--webpack'], app, { NODE_ENV: 'production' }), 'build');
  } else process.stdout.write('Reusing source-identical production build.\n');
  receipt.build = 'PASS';
  process.stdout.write('Production build PASS; running browser journey...\n');
  receipt.buildReused = reuseBuild;
  const config = `import { defineConfig } from '@playwright/test';\nexport default defineConfig({testDir:'./tests/e2e',testMatch:'funnel-commerce.spec.ts',timeout:180000,workers:1,retries:0,reporter:'list',use:{baseURL:'http://127.0.0.1:31139',trace:'off',launchOptions:{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}},webServer:{command:${JSON.stringify(`"${process.execPath}" "${next}" start --hostname 127.0.0.1 --port 31139`)},url:'http://127.0.0.1:31139/login',reuseExistingServer:false,timeout:120000,stdout:'pipe',stderr:'pipe',env:{NODE_ENV:'production'}}});`;
  fs.writeFileSync(path.join(app, 'playwright.commerce.config.ts'), config);
  const browser = run(process.execPath, [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--config', 'playwright.commerce.config.ts']);
  receipt.browser = browser.status === 0 ? 'PASS' : 'FAIL';
  must(browser, 'browser'); process.stdout.write('Browser journey PASS (transport mock only)\n');
  receipt.browser = 'PASS'; receipt.status = 'PASS';
} catch (error) { receipt.status = 'FAIL'; receipt.failure = error.message; process.exitCode = 1; }
finally {
  if (created) {
    const identity = run('docker', ['inspect', '--format', '{{index .Config.Labels "celebratedeal.commerce-qa"}}', name]);
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
