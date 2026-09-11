import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { listCanonicalMigrations, writeMirror } from './prisma-loopback-disposable-migration-runner.mjs';
import { createLiveQaIsolation, runLiveQaNode, writeLiveQaVitestConfig } from './live-qa-isolation.mjs';

// Only this runner owns this fresh database. No existing database is migrated or cleaned.
const qa = createLiveQaIsolation('live-db');
const marker = `live-integration:${randomUUID()}`;
const out = path.join(qa.root, 'docs/live-feature-handoffs/integration-20260912');
fs.mkdirSync(out, { recursive: true });
const receipt = { startedAt: new Date().toISOString(), status: 'FAIL', boundary: 'real API/domain/PostgreSQL; mocked manager auth and limiter', phases: {}, ownership: { absentBeforeCreate: false, markerVerified: false }, migrations: [], tests: [], cleanup: 'NOT_CREATED' };
const query = (database, sql) => spawnSync('C:/Users/eden/scoop/apps/postgresql/current/bin/psql.exe', ['-X', '-w', '-h', '127.0.0.1', '-p', '54329', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-q', '-c', sql], { env: { ...qa.env, PGPASSWORD: 'postgres', PGCONNECT_TIMEOUT: '5' }, encoding: 'utf8', windowsHide: true });
let owned;
try {
  const migrations = listCanonicalMigrations();
  receipt.migrations = migrations.map(name => {
    const sql = fs.readFileSync(path.join(qa.root, 'prisma/migrations', name, 'migration.sql'), 'utf8');
    if (/\b(?:CREATE|ALTER|DROP)\s+(?:ROLE|USER|DATABASE|SYSTEM)\b/iu.test(sql)) throw new Error('CLUSTER_MUTATION_REJECTED');
    return { name, sha256: createHash('sha256').update(sql).digest('hex') };
  });
  for (const name of ['celebratedeal_ci', 'celebratedeal_wp17_ci', 'celebratedeal_wp18_ci']) {
    const exists = query('postgres', `SELECT count(*) FROM pg_database WHERE datname='${name}'`);
    if (exists.status !== 0) throw new Error('LOOPBACK_UNREACHABLE');
    if (exists.stdout.trim() !== '0') continue;
    if (query('postgres', `CREATE DATABASE "${name}" TEMPLATE template0`).status !== 0) throw new Error('CREATE_FAILED');
    owned = name; receipt.ownership.absentBeforeCreate = true;
    if (query('postgres', `COMMENT ON DATABASE "${name}" IS '${marker}'`).status !== 0) throw new Error('MARKER_FAILED');
    const checked = query('postgres', `SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname='${name}'`);
    receipt.ownership.markerVerified = checked.status === 0 && checked.stdout.trim() === marker;
    if (!receipt.ownership.markerVerified) throw new Error('MARKER_FAILED');
    break;
  }
  if (!owned) throw new Error('NO_UNUSED_DATABASE');
  const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:54329/${owned}?schema=public`;
  const env = { DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, RT01_D2_DISPOSABLE_DB: 'true', CSRF_SECRET: 'live-integration-synthetic-signing-seed-only' };
  const mirror = writeMirror(qa.temp, migrations);
  for (const [name, args, cwd] of [
    ['generate', ['generate', '--config', path.join(qa.temp, 'prisma.config.mjs')], qa.temp],
    ['validate', ['validate', '--config', path.join(mirror, 'prisma.config.mjs')], mirror],
    ['migrate', ['migrate', 'deploy', '--config', path.join(mirror, 'prisma.config.mjs')], mirror],
    ['status', ['migrate', 'status', '--config', path.join(mirror, 'prisma.config.mjs')], mirror],
  ]) {
    const result = runLiveQaNode(qa, [path.join(qa.root, 'node_modules/prisma/build/index.js'), ...args], cwd, env);
    receipt.phases[name] = result.exitCode;
    if (result.exitCode !== 0) throw new Error('PRISMA_PHASE_FAILED');
  }
  const state = query(owned, 'SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name');
  receipt.phases.migrationState = state.status === 0 && JSON.stringify(state.stdout.trim().split(/\r?\n/)) === JSON.stringify(migrations) ? 0 : 1;
  if (receipt.phases.migrationState !== 0) throw new Error('MIGRATION_STATE_MISMATCH');
  const files = ['live-private-chat', 'interaction-card', 'interaction-card-timeline', 'presenter-layout', 'live-danmaku', 'scripted-roles', 'live-cross-feature', 'live-creation-integration'].map(name => `src/lib/${name}.db.test.ts`);
  const report = path.join(qa.temp, 'db-tests.json');
  const args = ['node_modules/vitest/vitest.mjs', 'run', ...files, '--config', writeLiveQaVitestConfig(qa), '--reporter=json', '--outputFile', report];
  const result = runLiveQaNode(qa, args, qa.root, env);
  receipt.phases.tests = result.exitCode;
  const data = JSON.parse(fs.readFileSync(report, 'utf8'));
  receipt.tests = data.testResults.map(suite => ({ file: path.relative(qa.root, suite.name).replaceAll('\\', '/'), assertions: suite.assertionResults.map(t => ({ title: t.title, status: t.status })) }));
  const assertions = receipt.tests.flatMap(s => s.assertions);
  receipt.counts = { files: receipt.tests.length, total: assertions.length, passed: assertions.filter(t => t.status === 'passed').length, skipped: assertions.filter(t => ['skipped', 'pending', 'todo'].includes(t.status)).length, failed: assertions.filter(t => t.status === 'failed').length };
  if (result.exitCode !== 0 || receipt.tests.length !== files.length || !files.every(file => receipt.tests.some(suite => suite.file === file && suite.assertions.length > 0)) || assertions.some(t => t.status !== 'passed')) {
    // Only synthetic test failures are kept locally for diagnosis; receipts contain names/status only.
    fs.writeFileSync(path.join(qa.temp, 'diagnostics.txt'), result.stderr);
    console.log(`Synthetic diagnostics: ${path.join(qa.temp, 'diagnostics.txt')}`);
    throw new Error('TEST_FAILED');
  }
  if (process.argv.includes('--browser')) {
    const browserOptions = process.argv.filter(arg => arg.startsWith('--browser-executable=') || arg.startsWith('--video-fixture='));
    const browser = runLiveQaNode(qa, ['scripts/live-cross-feature-browser-qa.mjs', ...browserOptions], qa.root, { ...env, LIVE_QA_PRISMA_CLIENT: qa.client, LIVE_QA_DATABASE_MARKER: marker });
    receipt.phases.browser = browser.exitCode;
    process.stdout.write(browser.stdout); process.stderr.write(browser.stderr);
    if (browser.exitCode !== 0) throw new Error('BROWSER_FAILED');
  }
  receipt.status = 'PASS';
} catch (error) { receipt.failure = /^[A-Z_]+$/.test(error.message) ? error.message : 'RUNNER_FAILED'; }
finally {
  if (owned) {
    const checked = query('postgres', `SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname='${owned}'`);
    if (checked.status === 0 && checked.stdout.trim() === marker) {
      const dropped = query('postgres', `DROP DATABASE "${owned}"`);
      const absent = query('postgres', `SELECT count(*) FROM pg_database WHERE datname='${owned}'`);
      receipt.cleanup = dropped.status === 0 && absent.status === 0 && absent.stdout.trim() === '0' ? 'PASS' : 'FAIL';
    } else receipt.cleanup = 'OWNERSHIP_BLOCKED';
  }
  if (receipt.cleanup !== 'PASS') receipt.status = 'FAIL';
  receipt.finishedAt = new Date().toISOString();
  const file = path.join(out, `db-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status: receipt.status, phases: receipt.phases, counts: receipt.counts, cleanup: receipt.cleanup, failure: receipt.failure, evidence: file }));
  process.exitCode = receipt.status === 'PASS' ? 0 : 1;
}
