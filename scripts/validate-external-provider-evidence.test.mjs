import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
  EXTERNAL_PROVIDER_EVIDENCE_SCHEMA,
  createPendingExternalReceipt,
  serializeExternalProviderReceipt,
} from './external-provider-evidence.mjs';
import {
  formatValidationResult,
  normalizeRelativePath,
  resolveSafeReceiptPath,
  runCli,
  validateExternalProviderReceiptFile,
} from './validate-external-provider-evidence.mjs';

const receiptJson = serializeExternalProviderReceipt(createPendingExternalReceipt('resend'));
const readFixture = { readFile: async () => receiptJson };

test('CLI module imports without environment, network or child-process side effects', async () => {
  const source = await fs.readFile(new URL('./validate-external-provider-evidence.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /process\.env|fetch\s*\(|node:child_process/);
});

test('safe path accepts only the two sanitized evidence roots and JSON receipt names', () => {
  assert.equal(
    normalizeRelativePath('docs/ai-team/evidence/synthetic-provider-receipt.json', 'C:\\workspace'),
    'C:\\workspace\\docs\\ai-team\\evidence\\synthetic-provider-receipt.json',
  );
  assert.equal(
    normalizeRelativePath('.ai-team/reports/external-provider-evidence.json', 'C:\\workspace'),
    'C:\\workspace\\.ai-team\\reports\\external-provider-evidence.json',
  );
  for (const unsafe of [
    'docs/ai-team/evidence/receipt.txt',
    'docs/ai-team/evidence/notes.json',
    'docs/ai-team/evidence/../.env.local-receipt.json',
    '.ai-team/reports/client-secret-receipt.json',
    'scripts/receipt.json',
    '../outside/receipt.json',
    'C:\\workspace\\docs\\ai-team\\evidence\\receipt.json',
  ]) {
    assert.equal(normalizeRelativePath(unsafe, 'C:\\workspace'), null, unsafe);
  }
});

test('resolver rejects unsafe paths without reading them', () => {
  assert.throws(() => resolveSafeReceiptPath('docs/ai-team/evidence/raw.json'), /INVALID_RECEIPT_PATH/);
  assert.throws(() => resolveSafeReceiptPath('.env.receipt.json'), /INVALID_RECEIPT_PATH/);
});

test('valid pending receipt is accepted and output states validation without claiming provider PASS', async () => {
  const validation = await validateExternalProviderReceiptFile(
    'docs/ai-team/evidence/synthetic-provider-receipt.json',
    readFixture,
    'C:\\workspace',
  );
  assert.deepEqual(validation, {
    ok: true,
    provider: 'resend',
    result: 'PENDING_EXTERNAL',
    sanitized: true,
  });
  assert.equal(
    formatValidationResult(validation),
    'receipt_validation=PASS; provider=resend; result=PENDING_EXTERNAL; sanitized=true',
  );
});

test('read, JSON and receipt failures return fixed reasons without raw error text', async () => {
  assert.deepEqual(
    await validateExternalProviderReceiptFile('docs/ai-team/evidence/missing-receipt.json', {
      readFile: async () => { throw new Error('https://provider.invalid/token=secret'); },
    }, 'C:\\workspace'),
    { ok: false, reason: 'read_failed' },
  );
  assert.deepEqual(
    await validateExternalProviderReceiptFile('docs/ai-team/evidence/bad-receipt.json', {
      readFile: async () => '{bad json}',
    }, 'C:\\workspace'),
    { ok: false, reason: 'invalid_receipt' },
  );
  assert.equal(formatValidationResult({ ok: false, reason: 'read_failed', detail: 'secret-sentinel' }), 'receipt_validation=FAIL; reason=read_failed');
  assert.equal(formatValidationResult({ ok: false, reason: 'https://provider.invalid' }), 'receipt_validation=FAIL; reason=invalid_result');
});

test('CLI requires exactly one receipt path and never exposes validator details', async () => {
  assert.deepEqual(await runCli([], readFixture, 'C:\\workspace'), { ok: false, reason: 'receipt_path_required' });
  assert.deepEqual(await runCli(['a', 'b'], readFixture, 'C:\\workspace'), { ok: false, reason: 'receipt_path_required' });
  assert.equal(formatValidationResult(await runCli([], readFixture, 'C:\\workspace')), 'receipt_validation=FAIL; reason=receipt_path_required');
  assert.equal(formatValidationResult({ ok: true, provider: 'https://provider.invalid', result: 'PASS', sanitized: true }), 'receipt_validation=FAIL; reason=invalid_result');
});

test('valid receipt shape remains bound to the external evidence schema', () => {
  assert.equal(JSON.parse(receiptJson).schemaVersion, EXTERNAL_PROVIDER_EVIDENCE_SCHEMA);
});
