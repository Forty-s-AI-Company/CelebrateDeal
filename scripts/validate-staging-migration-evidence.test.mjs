import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  createStagingMigrationReceipt,
  STAGING_MIGRATION_RECEIPT_SCHEMA,
} from './staging-migration-evidence.mjs';
import {
  formatValidationResult,
  normalizeRelativePath,
  resolveSafeReceiptPath,
  runCli,
  validateStagingMigrationReceiptFile,
} from './validate-staging-migration-evidence.mjs';

const migrationNames = [
  '20260721133000_inventory_reservations',
  '20260801090000_live_chat_ingress',
];

function receiptJson(overrides = {}) {
  return JSON.stringify(createStagingMigrationReceipt({
    runId: 'staging-migration-synthetic-01',
    executedAtUtc: '2026-08-21T00:00:00.000Z',
    authorizationRecordRef: 'ticket-staging-01',
    sourceCommit: '8a043b4',
    environmentClass: 'staging',
    databaseIdentityClass: 'staging-database',
    migrationStatus: 'up-to-date',
    expectedMigrationNames: migrationNames,
    appliedMigrationNames: migrationNames,
    ...overrides,
  }));
}

const readFixture = { realpath: async (candidate) => candidate, readFile: async () => receiptJson() };

test('CLI module imports without environment, network, child-process or write side effects', async () => {
  const source = await fs.readFile(new URL('./validate-staging-migration-evidence.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /process\.env|fetch\s*\(|node:child_process|writeFile\s*\(|appendFile\s*\(|rename\s*\(|rm\s*\(/u);
});

test('safe path accepts only sanitized evidence roots and receipt names', () => {
  assert.equal(
    normalizeRelativePath('docs/ai-team/evidence/staging-migration-receipt.json', 'C:\\workspace'),
    'C:\\workspace\\docs\\ai-team\\evidence\\staging-migration-receipt.json',
  );
  assert.equal(
    normalizeRelativePath('.ai-team/reports/staging-migration-evidence.json', 'C:\\workspace'),
    'C:\\workspace\\.ai-team\\reports\\staging-migration-evidence.json',
  );
  for (const unsafe of [
    'docs/ai-team/evidence/receipt.txt',
    'docs/ai-team/evidence/notes.json',
    'docs/ai-team/evidence/../.env.local-receipt.json',
    '.ai-team/reports/client-secret-receipt.json',
    'scripts/staging-migration-receipt.json',
    '../outside/staging-migration-receipt.json',
    'C:\\workspace\\docs\\ai-team\\evidence\\receipt.json',
  ]) {
    assert.equal(normalizeRelativePath(unsafe, 'C:\\workspace'), null, unsafe);
  }
});

test('resolver rejects unsafe paths before reading', () => {
  assert.throws(() => resolveSafeReceiptPath('docs/ai-team/evidence/raw.json'), /INVALID_RECEIPT_PATH/u);
  assert.throws(() => resolveSafeReceiptPath('.env.receipt.json'), /INVALID_RECEIPT_PATH/u);
});

test('valid PASS receipt is accepted with fixed staging output', async () => {
  const validation = await validateStagingMigrationReceiptFile(
    'docs/ai-team/evidence/staging-migration-receipt.json',
    readFixture,
    'C:\\workspace',
  );
  assert.deepEqual(validation, {
    ok: true,
    schemaVersion: STAGING_MIGRATION_RECEIPT_SCHEMA,
    result: 'PASS',
    environmentClass: 'staging',
    databaseIdentityClass: 'staging-database',
    sanitized: true,
  });
  assert.equal(
    formatValidationResult(validation),
    'staging_migration_validation=PASS; result=PASS; environment=staging; database=staging-database; sanitized=true',
  );
});

test('BLOCKED receipt remains valid evidence without becoming a readiness pass', async () => {
  const validation = await validateStagingMigrationReceiptFile(
    '.ai-team/reports/staging-migration-evidence.json',
    { realpath: async (candidate) => candidate, readFile: async () => receiptJson({ authorizationRecordRef: '', environmentClass: 'production', databaseIdentityClass: 'unknown' }) },
    'C:\\workspace',
  );
  assert.equal(validation.ok, true);
  assert.equal(validation.result, 'BLOCKED');
  assert.equal(formatValidationResult(validation), 'staging_migration_validation=PASS; result=BLOCKED; environment=unknown; database=unknown; sanitized=true');
});

test('read and JSON failures return fixed reasons without raw details', async () => {
  assert.deepEqual(
    await validateStagingMigrationReceiptFile('docs/ai-team/evidence/missing-receipt.json', {
      realpath: async (candidate) => candidate,
      readFile: async () => { throw new Error('synthetic-database-connection-error'); },
    }, 'C:\\workspace'),
    { ok: false, reason: 'read_failed' },
  );
  assert.deepEqual(
    await validateStagingMigrationReceiptFile('docs/ai-team/evidence/bad-receipt.json', {
      realpath: async (candidate) => candidate,
      readFile: async () => '{bad json}',
    }, 'C:\\workspace'),
    { ok: false, reason: 'invalid_receipt' },
  );
  assert.equal(formatValidationResult({ ok: false, reason: 'read_failed', detail: 'secret-sentinel' }), 'staging_migration_validation=FAIL; reason=read_failed');
  assert.equal(formatValidationResult({ ok: false, reason: 'https://provider.invalid' }), 'staging_migration_validation=FAIL; reason=invalid_result');
});

test('CLI requires exactly one receipt path and never exposes validator details', async () => {
  assert.deepEqual(await runCli([], readFixture, 'C:\\workspace'), { ok: false, reason: 'receipt_path_required' });
  assert.deepEqual(await runCli(['a', 'b'], readFixture, 'C:\\workspace'), { ok: false, reason: 'receipt_path_required' });
  assert.equal(formatValidationResult(await runCli([], readFixture, 'C:\\workspace')), 'staging_migration_validation=FAIL; reason=receipt_path_required');
  assert.equal(formatValidationResult({ ok: true, result: 'PASS', environmentClass: 'https://unsafe', databaseIdentityClass: 'staging-database', sanitized: true }), 'staging_migration_validation=FAIL; reason=invalid_result');
});

test('tampered receipts stay bound to the existing staging migration schema', async () => {
  const tampered = JSON.parse(receiptJson());
  tampered.sideEffects.migrationWrites = 1;
  const validation = await validateStagingMigrationReceiptFile(
    'docs/ai-team/evidence/staging-migration-receipt.json',
    { realpath: async (candidate) => candidate, readFile: async () => JSON.stringify(tampered) },
    'C:\\workspace',
  );
  assert.deepEqual(validation, { ok: false, reason: 'invalid_receipt' });
});

test('canonical path rejects a symlink target outside the sanitized evidence roots', async () => {
  let readCalled = false;
  const validation = await validateStagingMigrationReceiptFile('docs/ai-team/evidence/staging-migration-receipt.json', {
    realpath: async (candidate) => candidate.endsWith('staging-migration-receipt.json') ? 'C:\\outside\\secret.json' : candidate,
    readFile: async () => { readCalled = true; return receiptJson(); },
  }, 'C:\\workspace');
  assert.deepEqual(validation, { ok: false, reason: 'invalid_path' });
  assert.equal(readCalled, false);
});
