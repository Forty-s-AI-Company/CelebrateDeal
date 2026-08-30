import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  detectSafePureInterface,
  findUnsafeKey,
  transitionState,
  validateReceiptEnvelope,
  writeJsonAtomic,
} from './wp142-sanitized-receipt-preflight.mjs';

test('WP-141 actual namespace is inspected and missing safe serializer exports fail closed', async () => {
  const namespace = await import('./wp141-sanitized-build-boundary-runner.mjs');
  const info = detectSafePureInterface(namespace);
  assert.equal(info.safe, false);
  assert.deepEqual(info.missingExports, ['serializeReceipt', 'validateReceipt']);
});
test('safe named export detection does not treat copied local logic as an interface', () => {
  const info = detectSafePureInterface({ createSanitizer: () => {}, classifyDiagnostic: () => {} });
  assert.equal(info.safe, false);
  assert.deepEqual(info.missingExports, ['serializeReceipt', 'validateReceipt']);
});

test('false raw flags are legal but true flags are rejected by envelope contract', () => {
  const base = { schemaVersion: 'wp142-sanitized-receipt-preflight/v1', rawOutputPersisted: false, rawOutputExposed: false };
  assert.equal(validateReceiptEnvelope(base).ok, true);
  assert.equal(validateReceiptEnvelope({ ...base, rawOutputPersisted: true }).reason, 'RAW_FLAG_TRUE');
  assert.equal(findUnsafeKey({ diagnostic: { stdout: 'forbidden' } }), 'diagnostic.stdout');
});

test('unsafe keys reject source, environment and generated content without reading them', () => {
  const base = { schemaVersion: 'wp142-sanitized-receipt-preflight/v1' };
  for (const key of ['stderr', 'absolutePath', 'url', 'env', 'token', 'cookie', 'secret', 'sourceSnippet', 'generatedContent']) {
    assert.equal(validateReceiptEnvelope({ ...base, [key]: '[redacted-fixture]' }).ok, false, key);
  }
});

test('future receipt state machine is deterministic and WP-142 never consumes it', () => {
  assert.equal(transitionState('PRECHECK_ONLY', 'preflight_pass'), 'ATTEMPT_ARMED');
  assert.equal(transitionState('ATTEMPT_ARMED', 'spawn_success'), 'ATTEMPT_CONSUMED');
  assert.equal(transitionState('ATTEMPT_CONSUMED', 'result_recorded'), 'RESULT_RECORDED');
  assert.equal(transitionState('ATTEMPT_CONSUMED', 'result_rejected'), 'RECEIPT_VALIDATION_REJECTED');
  assert.equal(transitionState('PRECHECK_ONLY', 'spawn_success'), null);
});

test('atomic JSON write round-trips a sanitized envelope', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'celebratedeal-wp142-test-'));
  try {
    const target = path.join(root, 'receipt.json');
    const value = { schemaVersion: 'wp142-sanitized-receipt-preflight/v1', rawOutputPersisted: false, rawOutputExposed: false };
    const result = await writeJsonAtomic(target, value);
    assert.equal(result.pathWritten, true);
    assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), value);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('atomic rename failure removes temp file and does not leave a replacement receipt', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'celebratedeal-wp142-test-'));
  try {
    const target = path.join(root, 'receipt.json');
    const value = { schemaVersion: 'wp142-sanitized-receipt-preflight/v1', rawOutputPersisted: false, rawOutputExposed: false };
    await assert.rejects(() => writeJsonAtomic(target, value, { rename: async () => { const error = new Error('rename'); error.code = 'EIO'; throw error; } }), /ATOMIC_RENAME_FAILED/);
    assert.equal(await fs.stat(target).then(() => true).catch(() => false), false);
    assert.deepEqual(await fs.readdir(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
