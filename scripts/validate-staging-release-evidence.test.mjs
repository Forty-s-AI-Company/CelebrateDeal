import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  STAGING_RELEASE_EVIDENCE_SCHEMA,
  createStagingReleaseReceipt,
} from './staging-release-evidence.mjs';
import {
  formatValidationResult,
  normalizeRelativePath,
  resolveSafeReceiptPath,
  runCli,
  validateStagingReleaseReceiptFile,
} from './validate-staging-release-evidence.mjs';

const sourceCommit = '5607910';

function receiptJson(overrides = {}) {
  return JSON.stringify(createStagingReleaseReceipt({
    sourceCommit,
    runId: 'staging-release-synthetic-01',
    executedAtUtc: '2026-08-21T00:00:00.000Z',
    authorizationRecordRef: 'ticket-staging-01',
    environmentClass: 'staging',
    nonProduction: true,
    components: {
      lineage: { result: 'PASS', sourceCommit, evidenceRef: 'opaque:staging-lineage-01' },
      migration: { result: 'PASS', sourceCommit, evidenceRef: 'opaque:staging-migration-01' },
      recovery: { result: 'PASS', sourceCommit, evidenceRef: 'opaque:staging-recovery-01' },
      rollback: { result: 'PASS', sourceCommit, evidenceRef: 'opaque:staging-rollback-01' },
    },
    ...overrides,
  }));
}

const readFixture = {
  realpath: async (candidate) => candidate,
  readFile: async () => receiptJson(),
};

test('CLI module imports without environment, network, child-process or write side effects', async () => {
  const source = await fs.readFile(new URL('./validate-staging-release-evidence.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /process\.env|fetch\s*\(|node:child_process|writeFile\s*\(|appendFile\s*\(|rename\s*\(|rm\s*\(/u);
});

test('safe path accepts only sanitized staging evidence roots and receipt names', () => {
  assert.equal(
    normalizeRelativePath('docs/ai-team/evidence/staging-release-evidence.json', 'C:\\workspace'),
    'C:\\workspace\\docs\\ai-team\\evidence\\staging-release-evidence.json',
  );
  assert.equal(
    normalizeRelativePath('.ai-team/reports/staging-release-receipt.json', 'C:\\workspace'),
    'C:\\workspace\\.ai-team\\reports\\staging-release-receipt.json',
  );
  for (const unsafe of [
    'docs/ai-team/evidence/receipt.txt',
    'docs/ai-team/evidence/notes.json',
    'docs/ai-team/evidence/../.env.local-receipt.json',
    '.ai-team/reports/client-secret-receipt.json',
    'scripts/staging-release-evidence.json',
    '../outside/staging-release-evidence.json',
    'C:\\workspace\\docs\\ai-team\\evidence\\receipt.json',
  ]) {
    assert.equal(normalizeRelativePath(unsafe, 'C:\\workspace'), null, unsafe);
  }
});

test('resolver rejects unsafe paths before reading', () => {
  assert.throws(() => resolveSafeReceiptPath('docs/ai-team/evidence/raw.json'), /INVALID_RECEIPT_PATH/u);
  assert.throws(() => resolveSafeReceiptPath('.env.receipt.json'), /INVALID_RECEIPT_PATH/u);
});

test('valid PASS aggregate is accepted with fixed output and bound lineage', async () => {
  const validation = await validateStagingReleaseReceiptFile(
    'docs/ai-team/evidence/staging-release-evidence.json',
    readFixture,
    'C:\\workspace',
  );
  assert.deepEqual(validation, {
    ok: true,
    schemaVersion: STAGING_RELEASE_EVIDENCE_SCHEMA,
    result: 'PASS',
    sourceLineage: 'bound',
    sanitized: true,
  });
  assert.equal(
    formatValidationResult(validation),
    'staging_release_validation=PASS; result=PASS; source_lineage=bound; sanitized=true',
  );
});

test('BLOCKED aggregate remains valid evidence without becoming a readiness pass', async () => {
  const validation = await validateStagingReleaseReceiptFile(
    '.ai-team/reports/staging-release-evidence.json',
    {
      realpath: async (candidate) => candidate,
      readFile: async () => receiptJson({
        sourceCommit: '',
        authorizationRecordRef: '',
        environmentClass: 'unknown',
        nonProduction: false,
        components: {
          lineage: { result: 'NOT_PROVEN', sourceCommit: '', evidenceRef: '' },
          migration: { result: 'NOT_PROVEN', sourceCommit: '', evidenceRef: '' },
          recovery: { result: 'NOT_PROVEN', sourceCommit: '', evidenceRef: '' },
          rollback: { result: 'NOT_PROVEN', sourceCommit: '', evidenceRef: '' },
        },
      }),
    },
    'C:\\workspace',
  );
  assert.deepEqual(validation, {
    ok: true,
    schemaVersion: STAGING_RELEASE_EVIDENCE_SCHEMA,
    result: 'BLOCKED',
    sourceLineage: 'unknown',
    sanitized: true,
  });
  assert.equal(formatValidationResult(validation), 'staging_release_validation=PASS; result=BLOCKED; source_lineage=unknown; sanitized=true');
});

test('read and JSON failures return fixed reasons without raw details', async () => {
  assert.deepEqual(
    await validateStagingReleaseReceiptFile('docs/ai-team/evidence/missing-receipt.json', {
      realpath: async (candidate) => candidate,
      readFile: async () => { throw new Error('synthetic-database-connection-error'); },
    }, 'C:\\workspace'),
    { ok: false, reason: 'read_failed' },
  );
  assert.deepEqual(
    await validateStagingReleaseReceiptFile('docs/ai-team/evidence/bad-receipt.json', {
      realpath: async (candidate) => candidate,
      readFile: async () => '{bad json}',
    }, 'C:\\workspace'),
    { ok: false, reason: 'invalid_receipt' },
  );
  assert.equal(formatValidationResult({ ok: false, reason: 'read_failed', detail: 'secret-sentinel' }), 'staging_release_validation=FAIL; reason=read_failed');
  assert.equal(formatValidationResult({ ok: false, reason: 'https://provider.invalid' }), 'staging_release_validation=FAIL; reason=invalid_result');
});

test('CLI requires exactly one receipt path and never exposes validator details', async () => {
  assert.deepEqual(await runCli([], readFixture, 'C:\\workspace'), { ok: false, reason: 'receipt_path_required' });
  assert.deepEqual(await runCli(['a', 'b'], readFixture, 'C:\\workspace'), { ok: false, reason: 'receipt_path_required' });
  assert.equal(formatValidationResult(await runCli([], readFixture, 'C:\\workspace')), 'staging_release_validation=FAIL; reason=receipt_path_required');
  assert.equal(formatValidationResult({ ok: true, result: 'PASS', sourceLineage: 'https://unsafe', sanitized: true }), 'staging_release_validation=FAIL; reason=invalid_result');
});

test('tampered aggregate is rejected before it can be reported as valid', async () => {
  const tampered = JSON.parse(receiptJson());
  tampered.sideEffects.productionOperations = 1;
  const validation = await validateStagingReleaseReceiptFile(
    'docs/ai-team/evidence/staging-release-evidence.json',
    { realpath: async (candidate) => candidate, readFile: async () => JSON.stringify(tampered) },
    'C:\\workspace',
  );
  assert.deepEqual(validation, { ok: false, reason: 'invalid_receipt' });
});

test('canonical path rejects a symlink target outside sanitized evidence roots', async () => {
  let readCalled = false;
  const validation = await validateStagingReleaseReceiptFile('docs/ai-team/evidence/staging-release-evidence.json', {
    realpath: async (candidate) => candidate.endsWith('staging-release-evidence.json') ? 'C:\\outside\\secret.json' : candidate,
    readFile: async () => { readCalled = true; return receiptJson(); },
  }, 'C:\\workspace');
  assert.deepEqual(validation, { ok: false, reason: 'invalid_path' });
  assert.equal(readCalled, false);
});
