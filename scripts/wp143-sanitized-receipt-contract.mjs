import crypto from 'node:crypto';
import fsp from 'node:fs/promises';

const RECEIPT_SCHEMA_VERSION = 'wp143-authoritative-sanitized-receipt/v1';
const RECEIPT_STATES = Object.freeze({
  PRECHECK_ONLY: 'PRECHECK_ONLY',
  ATTEMPT_ARMED: 'ATTEMPT_ARMED',
  ATTEMPT_CONSUMED: 'ATTEMPT_CONSUMED',
  RESULT_RECORDED: 'RESULT_RECORDED',
  RECEIPT_VALIDATION_REJECTED: 'RECEIPT_VALIDATION_REJECTED',
});

const ALLOWED_KEYS = Object.freeze({
  root: new Set(['schemaVersion', 'workPackage', 'state', 'attempt', 'previousReceiptDigest', 'classification', 'rawOutputPersisted', 'rawOutputExposed', 'build', 'diagnostic', 'markers', 'digestLineage', 'fixtureMatrix', 'stateMachine', 'moduleDigest', 'schemaDigest', 'fixtureDigest', 'ownership', 'sideEffects', 'scoreImpact', 'fallbackReason', 'trustedMetadata', 'sanitized']),
  build: new Set(['attempts', 'exitCode', 'command', 'timedOut']),
  diagnostic: new Set(['phase', 'errorFamily', 'errorCode', 'currentRelativePath', 'pathClass', 'symbol', 'span', 'confidence', 'missingFields', 'fingerprint']),
  span: new Set(['line', 'column']),
  markers: new Set(['buildId', 'buildManifest', 'routesManifest', 'appPathsManifest']),
  digestLineage: new Set(['sourceConfigPackageLockfile', 'contract', 'fixtures']),
  fixtureMatrix: new Set(['success', 'failure', 'insufficient', 'unsafe', 'fallback', 'stateMachine', 'atomicWrite', 'roundTrip', 'importSafety']),
  stateMachine: new Set(['precheck', 'armed', 'consumed', 'resultRecorded', 'fallback']),
  ownership: new Set(['before', 'after', 'unknown', 'mixedHunks', 'stagedIndexEmpty', 'artifactsUnchanged']),
  ownershipSnapshot: new Set(['dirtyCount', 'statusFingerprint', 'ownedArtifactCount', 'ownershipCounts', 'unknown', 'mixedHunks', 'stagedIndexEmpty']),
  ownershipCounts: new Set(['WP143_OWNED', 'DIRTY_TRACKED_PRESERVE_ONLY', 'UNTRACKED_PRESERVE_ONLY']),
  sideEffects: new Set(['buildRuns', 'serverRuns', 'typegenRuns', 'browserRuns', 'databaseOperations', 'networkOperations', 'providerOperations', 'stagingOperations', 'deploymentOperations', 'productionOperations', 'dotenvReads']),
  scoreImpact: new Set(['CAT06', 'CAT09', 'total']),
  scoreEntry: new Set(['before', 'after']),
  trustedMetadata: new Set(['attemptId', 'protectedDigestLineage']),
});

const CHILD_SCHEMA = Object.freeze({
  root: { build: 'build', diagnostic: 'diagnostic', markers: 'markers', digestLineage: 'digestLineage', fixtureMatrix: 'fixtureMatrix', stateMachine: 'stateMachine', ownership: 'ownership', sideEffects: 'sideEffects', scoreImpact: 'scoreImpact', trustedMetadata: 'trustedMetadata' },
  diagnostic: { span: 'span' },
  ownership: { before: 'ownershipSnapshot', after: 'ownershipSnapshot' },
  ownershipSnapshot: { ownershipCounts: 'ownershipCounts' },
  scoreImpact: { CAT06: 'scoreEntry', CAT09: 'scoreEntry', total: 'scoreEntry' },
});

const FORBIDDEN_KEYS = new Set(['stdout', 'stderr', 'rawOutput', 'rawStdout', 'rawStderr', 'rawBody', 'absolutePath', 'url', 'env', 'token', 'cookie', 'secret', 'sourceSnippet', 'generatedContent']);
const SAFE_RELATIVE_PATH = /^(?:src|app|pages|lib|components)\/[^\s]+$/;
const SAFE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]{0,79}$/;
const SAFE_FINGERPRINT = /^(?:sha256:)?[a-f0-9]{16,128}$/i;
const SAFE_REASON_CODES = new Set(['FINAL_VALIDATION_FAILED', 'SCHEMA_REJECTED', 'ATOMIC_WRITE_FAILED', 'ROUND_TRIP_MISMATCH']);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function inspectValue(value, pathName, errors, seen, schemaName = null) {
  if (value === undefined) { errors.push(`${pathName}:UNDEFINED`); return; }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') { errors.push(`${pathName}:NON_JSON_TYPE`); return; }
  if (typeof value === 'number' && !Number.isFinite(value)) { errors.push(`${pathName}:NON_FINITE_NUMBER`); return; }
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return;
  if (seen.has(value)) { errors.push(`${pathName}:CYCLE`); return; }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectValue(item, `${pathName}[${index}]`, errors, seen, null));
    seen.delete(value);
    return;
  }
  if (!isPlainObject(value)) { errors.push(`${pathName}:NON_PLAIN_OBJECT`); seen.delete(value); return; }
  const keys = ALLOWED_KEYS[schemaName || 'root'];
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype' || FORBIDDEN_KEYS.has(key)) {
      errors.push(`${pathName}.${key}:FORBIDDEN_KEY`);
      continue;
    }
    if (keys && !keys.has(key)) errors.push(`${pathName}.${key}:UNKNOWN_KEY`);
    const childSchema = CHILD_SCHEMA[schemaName || 'root']?.[key] || null;
    inspectValue(value[key], `${pathName}.${key}`, errors, seen, childSchema);
  }
  seen.delete(value);
}

function validateFieldSemantics(receipt, errors) {
  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) errors.push('schemaVersion:INVALID');
  if (receipt.workPackage !== 'WP-143') errors.push('workPackage:INVALID');
  if (!Object.values(RECEIPT_STATES).includes(receipt.state)) errors.push('state:INVALID');
  if (!Number.isInteger(receipt.attempt) || ![0, 1].includes(receipt.attempt)) errors.push('attempt:INVALID');
  if (typeof receipt.classification !== 'string' || !/^[A-Z0-9_]+$/.test(receipt.classification)) errors.push('classification:INVALID');
  if (receipt.rawOutputPersisted !== false) errors.push('rawOutputPersisted:MUST_BE_FALSE');
  if (receipt.rawOutputExposed !== false) errors.push('rawOutputExposed:MUST_BE_FALSE');
  if (receipt.sanitized !== true) errors.push('sanitized:MUST_BE_TRUE');
  if (receipt.previousReceiptDigest !== null && (typeof receipt.previousReceiptDigest !== 'string' || !SAFE_FINGERPRINT.test(receipt.previousReceiptDigest))) errors.push('previousReceiptDigest:INVALID');
  if (receipt.build !== undefined && receipt.build !== null) {
    if (!isPlainObject(receipt.build)) errors.push('build:OBJECT_REQUIRED');
    else {
      if (!Number.isInteger(receipt.build.attempts) || ![0, 1].includes(receipt.build.attempts)) errors.push('build.attempts:INVALID');
      if (receipt.build.exitCode !== null && !Number.isInteger(receipt.build.exitCode)) errors.push('build.exitCode:INVALID');
      if (receipt.build.command !== undefined && receipt.build.command !== 'next build --webpack') errors.push('build.command:INVALID');
    }
  }
  if (receipt.diagnostic !== undefined && receipt.diagnostic !== null) {
    if (!isPlainObject(receipt.diagnostic)) errors.push('diagnostic:OBJECT_REQUIRED');
    else {
      if (receipt.diagnostic.currentRelativePath !== null && receipt.diagnostic.currentRelativePath !== undefined && !SAFE_RELATIVE_PATH.test(receipt.diagnostic.currentRelativePath)) errors.push('diagnostic.currentRelativePath:NOT_NORMALIZED');
      if (receipt.diagnostic.symbol !== null && receipt.diagnostic.symbol !== undefined && !SAFE_IDENTIFIER.test(receipt.diagnostic.symbol)) errors.push('diagnostic.symbol:NOT_IDENTIFIER');
      if (receipt.diagnostic.fingerprint !== null && receipt.diagnostic.fingerprint !== undefined && !SAFE_FINGERPRINT.test(receipt.diagnostic.fingerprint)) errors.push('diagnostic.fingerprint:INVALID');
      if (receipt.diagnostic.span !== null && receipt.diagnostic.span !== undefined) {
        if (!isPlainObject(receipt.diagnostic.span) || !Number.isInteger(receipt.diagnostic.span.line) || !Number.isInteger(receipt.diagnostic.span.column)) errors.push('diagnostic.span:INVALID');
      }
    }
  }
  if (receipt.fallbackReason !== undefined && !SAFE_REASON_CODES.has(receipt.fallbackReason)) errors.push('fallbackReason:INVALID');
  if (receipt.trustedMetadata !== undefined && !isPlainObject(receipt.trustedMetadata)) errors.push('trustedMetadata:OBJECT_REQUIRED');
}

function validateSanitizedReceipt(receipt) {
  const errors = [];
  if (!isPlainObject(receipt)) return { ok: false, errors: ['root:OBJECT_REQUIRED'] };
  inspectValue(receipt, 'root', errors, new WeakSet(), 'root');
  validateFieldSemantics(receipt, errors);
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

function canonicalize(value, seen = new WeakSet()) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw new Error('NON_JSON_TYPE');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('NON_FINITE_NUMBER');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (seen.has(value)) throw new Error('CYCLE');
  seen.add(value);
  if (Array.isArray(value)) { const result = value.map((item) => canonicalize(item, seen)); seen.delete(value); return result; }
  if (!isPlainObject(value)) throw new Error('NON_PLAIN_OBJECT');
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype' || FORBIDDEN_KEYS.has(key)) throw new Error('FORBIDDEN_KEY');
    result[key] = canonicalize(value[key], seen);
  }
  seen.delete(value);
  return result;
}

function canonicalString(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalDigest(value) {
  return `sha256:${crypto.createHash('sha256').update(canonicalString(value), 'utf8').digest('hex')}`;
}

function serializeSanitizedReceipt(receipt) {
  const validation = validateSanitizedReceipt(receipt);
  if (!validation.ok) throw new Error(`RECEIPT_VALIDATION_FAILED:${validation.errors.join('|')}`);
  return `${canonicalString(receipt)}\n`;
}

function parseAndValidateSanitizedReceipt(json) {
  if (typeof json !== 'string') return { ok: false, errors: ['input:STRING_REQUIRED'] };
  try {
    const value = JSON.parse(json);
    const validation = validateSanitizedReceipt(value);
    return validation.ok ? { ok: true, value, errors: [] } : { ok: false, errors: validation.errors };
  } catch (error) {
    return { ok: false, errors: [`json:${error?.name === 'SyntaxError' ? 'INVALID_JSON' : 'PARSE_FAILED'}`] };
  }
}

function validateStateTransition(previous, next) {
  const previousValidation = validateSanitizedReceipt(previous);
  const nextValidation = validateSanitizedReceipt(next);
  if (!previousValidation.ok || !nextValidation.ok) return { ok: false, reason: 'INVALID_RECEIPT' };
  const allowed = {
    PRECHECK_ONLY: { ATTEMPT_ARMED: 0 },
    ATTEMPT_ARMED: { ATTEMPT_CONSUMED: 1 },
    ATTEMPT_CONSUMED: { RESULT_RECORDED: 1, RECEIPT_VALIDATION_REJECTED: 1 },
  };
  const expectedAttempt = allowed[previous.state]?.[next.state];
  if (expectedAttempt === undefined || next.attempt !== expectedAttempt) return { ok: false, reason: 'ILLEGAL_TRANSITION' };
  if (next.previousReceiptDigest !== canonicalDigest(previous)) return { ok: false, reason: 'PREVIOUS_DIGEST_MISMATCH' };
  if (previous.state === 'RECEIPT_VALIDATION_REJECTED') return { ok: false, reason: 'FALLBACK_NOT_EXECUTABLE' };
  return { ok: true, reason: null };
}

function createValidationRejectedFallback(trustedMetadata, reasonCode) {
  if (!isPlainObject(trustedMetadata)) throw new Error('TRUSTED_METADATA_REQUIRED');
  if (!SAFE_REASON_CODES.has(reasonCode)) throw new Error('REASON_CODE_INVALID');
  const safeKeys = new Set(['attemptId', 'protectedDigestLineage']);
  for (const key of Object.keys(trustedMetadata)) if (!safeKeys.has(key)) throw new Error('UNTRUSTED_METADATA_KEY');
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    workPackage: 'WP-143',
    state: RECEIPT_STATES.RECEIPT_VALIDATION_REJECTED,
    attempt: 1,
    previousReceiptDigest: null,
    classification: 'RECEIPT_VALIDATION_REJECTED',
    rawOutputPersisted: false,
    rawOutputExposed: false,
    build: { attempts: 1, exitCode: null, command: 'next build --webpack', timedOut: false },
    diagnostic: null,
    fallbackReason: reasonCode,
    trustedMetadata: { ...trustedMetadata },
    sanitized: true,
  };
  const validation = validateSanitizedReceipt(receipt);
  if (!validation.ok) throw new Error(`FALLBACK_INVALID:${validation.errors.join('|')}`);
  return receipt;
}

async function writeSanitizedReceiptAtomic(targetPath, receipt, adapter = {}) {
  const validation = validateSanitizedReceipt(receipt);
  if (!validation.ok) throw new Error(`RECEIPT_VALIDATION_FAILED:${validation.errors.join('|')}`);
  const fsAdapter = { ...fsp, ...adapter };
  const directory = targetPath.slice(0, Math.max(targetPath.lastIndexOf('/'), targetPath.lastIndexOf('\\')));
  if (!directory) throw new Error('TARGET_DIRECTORY_REQUIRED');
  try { await fsAdapter.stat(targetPath); throw new Error('TARGET_ALREADY_EXISTS'); } catch (error) { if (error?.message === 'TARGET_ALREADY_EXISTS') throw error; if (error?.code !== 'ENOENT') throw new Error('TARGET_STAT_FAILED'); }
  await fsAdapter.mkdir(directory, { recursive: true });
  const payload = serializeSanitizedReceipt(receipt);
  const temporaryPath = `${targetPath}.wp143-${process.pid}-${Date.now()}.tmp`;
  let handle;
  let renamed = false;
  try {
    handle = await fsAdapter.open(temporaryPath, 'wx');
    await handle.writeFile(payload, 'utf8');
    if (typeof handle.sync === 'function') await handle.sync();
    await handle.close();
    handle = null;
    const roundTrip = parseAndValidateSanitizedReceipt(await fsAdapter.readFile(temporaryPath, 'utf8'));
    if (!roundTrip.ok || serializeSanitizedReceipt(roundTrip.value) !== payload) throw new Error('ROUND_TRIP_MISMATCH');
    await fsAdapter.rename(temporaryPath, targetPath);
    renamed = true;
    return { written: true, bytes: Buffer.byteLength(payload, 'utf8'), digest: canonicalDigest(receipt) };
  } finally {
    if (handle) { try { await handle.close(); } catch {} }
    if (!renamed) { try { await fsAdapter.rm(temporaryPath, { force: true }); } catch {} }
  }
}

export {
  RECEIPT_SCHEMA_VERSION,
  RECEIPT_STATES,
  canonicalDigest,
  createValidationRejectedFallback,
  parseAndValidateSanitizedReceipt,
  serializeSanitizedReceipt,
  validateSanitizedReceipt,
  validateStateTransition,
  writeSanitizedReceiptAtomic,
};
