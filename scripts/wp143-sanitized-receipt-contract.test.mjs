import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  RECEIPT_SCHEMA_VERSION,
  RECEIPT_STATES,
  canonicalDigest,
  createValidationRejectedFallback,
  parseAndValidateSanitizedReceipt,
  serializeSanitizedReceipt,
  validateSanitizedReceipt,
  validateStateTransition,
  writeSanitizedReceiptAtomic,
} from './wp143-sanitized-receipt-contract.mjs';

function diagnostic(overrides = {}) {
  return {
    phase: 'typecheck',
    errorFamily: 'TYPECHECK',
    errorCode: 'TYPE_ERROR',
    currentRelativePath: 'src/app/example/page.tsx',
    pathClass: 'source',
    symbol: 'title',
    span: { line: 12, column: 4 },
    confidence: 'high',
    missingFields: [],
    fingerprint: 'sha256:0123456789abcdef0123456789abcdef',
    ...overrides,
  };
}

function receipt(overrides = {}) {
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    workPackage: 'WP-143',
    state: RECEIPT_STATES.RESULT_RECORDED,
    attempt: 1,
    previousReceiptDigest: null,
    classification: 'AUTHORITATIVE_SANITIZED_RECEIPT_CONTRACT_READY',
    rawOutputPersisted: false,
    rawOutputExposed: false,
    build: { attempts: 0, exitCode: 0, command: 'next build --webpack', timedOut: false },
    diagnostic: diagnostic(),
    markers: { buildId: true, buildManifest: true, routesManifest: true, appPathsManifest: true },
    digestLineage: { sourceConfigPackageLockfile: 'sha256:0123456789abcdef0123456789abcdef', contract: 'sha256:0123456789abcdef0123456789abcdef', fixtures: 'sha256:0123456789abcdef0123456789abcdef' },
    sanitized: true,
    ...overrides,
  };
}

test('module imports without output, environment access or child process', async () => {
  const moduleNamespace = await import('./wp143-sanitized-receipt-contract.mjs');
  assert.equal(typeof moduleNamespace.serializeSanitizedReceipt, 'function');
  assert.equal(Object.hasOwn(moduleNamespace, 'default'), false);
});

test('success fixture accepts false raw flags and round-trips canonically', () => {
  const value = receipt();
  assert.equal(validateSanitizedReceipt(value).ok, true);
  const serialized = serializeSanitizedReceipt(value);
  assert.equal(serialized.endsWith('\n'), true);
  assert.equal(parseAndValidateSanitizedReceipt(serialized).ok, true);
  assert.equal(serializeSanitizedReceipt(parseAndValidateSanitizedReceipt(serialized).value), serialized);
});

test('failure fixture stores normalized diagnostics without raw output', () => {
  const value = receipt({ classification: 'BUILD_FAILED', build: { attempts: 0, exitCode: 1, command: 'next build --webpack', timedOut: false }, diagnostic: diagnostic({ errorFamily: 'WEBPACK', errorCode: 'WEBPACK_BUILD_ERROR', confidence: 'medium' }) });
  assert.equal(validateSanitizedReceipt(value).ok, true);
  assert.equal(JSON.stringify(value).includes('stdout'), false);
});

test('insufficient diagnostic fixture remains explicitly fail closed', () => {
  const value = receipt({ classification: 'SANITIZED_DIAGNOSTIC_STILL_INSUFFICIENT_EXACT_NO_GO', diagnostic: diagnostic({ phase: null, errorFamily: null, errorCode: null, currentRelativePath: null, symbol: null, span: null, confidence: 'none', missingFields: ['phase', 'errorFamily', 'errorCode', 'currentRelativePath', 'symbol', 'span'] }) });
  assert.equal(validateSanitizedReceipt(value).ok, true);
  assert.deepEqual(value.diagnostic.missingFields, ['phase', 'errorFamily', 'errorCode', 'currentRelativePath', 'symbol', 'span']);
});

test('unsafe fixtures are rejected before serialization', () => {
  for (const bad of [
    { rawOutputPersisted: true },
    { rawOutputExposed: true },
    { stdout: 'raw' },
    { diagnostic: { stdout: 'raw' } },
    { diagnostic: { currentRelativePath: 'C:\\repo\\src\\app\\page.tsx' } },
    { diagnostic: { currentRelativePath: 'https://example.invalid/a' } },
    { diagnostic: { symbol: 'not-safe!' } },
    { unexpected: true },
    { diagnostic: { span: { line: NaN, column: 1 } } },
    { invalid: BigInt(1) },
  ]) {
    const candidate = receipt(bad);
    assert.equal(validateSanitizedReceipt(candidate).ok, false);
    assert.throws(() => serializeSanitizedReceipt(candidate));
  }
});

test('fallback accepts only trusted metadata and never includes diagnostic payload', () => {
  const fallback = createValidationRejectedFallback({ attemptId: 'synthetic-143', protectedDigestLineage: 'sha256:0123456789abcdef0123456789abcdef' }, 'FINAL_VALIDATION_FAILED');
  assert.equal(validateSanitizedReceipt(fallback).ok, true);
  assert.equal(fallback.diagnostic, null);
  assert.throws(() => createValidationRejectedFallback({ stdout: 'bad' }, 'FINAL_VALIDATION_FAILED'));
});

test('state machine permits only forward transitions with previous digest', () => {
  const precheck = receipt({ state: RECEIPT_STATES.PRECHECK_ONLY, attempt: 0, build: { attempts: 0, exitCode: null, command: 'next build --webpack', timedOut: false }, diagnostic: null });
  delete precheck.markers;
  delete precheck.digestLineage;
  const armed = { ...precheck, state: RECEIPT_STATES.ATTEMPT_ARMED, previousReceiptDigest: canonicalDigest(precheck) };
  const consumed = { ...armed, state: RECEIPT_STATES.ATTEMPT_CONSUMED, attempt: 1, previousReceiptDigest: canonicalDigest(armed), build: { attempts: 1, exitCode: null, command: 'next build --webpack', timedOut: false } };
  assert.equal(validateStateTransition(precheck, armed).ok, true);
  assert.equal(validateStateTransition(armed, consumed).ok, true);
  assert.equal(validateStateTransition(precheck, consumed).ok, false);
});

test('atomic write is immutable, exclusive and round-trips', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'celebratedeal-wp143-'));
  try {
    const target = path.join(root, 'receipt.json');
    const value = receipt();
    const result = await writeSanitizedReceiptAtomic(target, value);
    assert.equal(result.written, true);
    assert.equal(parseAndValidateSanitizedReceipt(await fs.readFile(target, 'utf8')).ok, true);
    await assert.rejects(() => writeSanitizedReceiptAtomic(target, value), /TARGET_ALREADY_EXISTS/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('atomic write failure cleans orphan temp and preserves existing target', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'celebratedeal-wp143-'));
  try {
    const target = path.join(root, 'receipt.json');
    const value = receipt();
    await assert.rejects(() => writeSanitizedReceiptAtomic(target, value, { rename: async () => { const error = new Error('rename'); error.code = 'EIO'; throw error; } }), /rename|EIO|ROUND_TRIP|ATOMIC/);
    assert.equal(await fs.stat(target).then(() => true).catch(() => false), false);
    assert.deepEqual(await fs.readdir(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
