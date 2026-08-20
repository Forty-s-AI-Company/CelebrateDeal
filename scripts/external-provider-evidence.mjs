import crypto from 'node:crypto';

// This module is deliberately pure: it never reads environment variables,
// calls a provider, starts a process, or writes an evidence artifact.
const EXTERNAL_PROVIDER_EVIDENCE_SCHEMA = 'celebratedeal-external-provider-evidence/v1';

const EXTERNAL_PROVIDERS = Object.freeze([
  'cloudflare_stream',
  'resend',
  'sentry',
  'posthog',
  'durable_rate_limit',
  'payuni_sandbox',
]);

const EXTERNAL_PROVIDER_RESULTS = Object.freeze([
  'PASS',
  'FAILED',
  'BLOCKED',
  'PENDING_EXTERNAL',
  'PENDING_HUMAN',
]);

const ENVIRONMENT_CLASSES = Object.freeze(['preview', 'staging', 'isolated-restore-drill']);
const PROVIDER_ENVIRONMENT_CLASSES = Object.freeze(['sandbox', 'test', 'staging', 'unknown']);
const MAX_ATTEMPT_COUNT = 5;
const MAX_SIDE_EFFECT_COUNTER = 100;

const SIDE_EFFECT_KEYS = Object.freeze([
  'databaseReads',
  'databaseWrites',
  'providerReadRequests',
  'providerWriteRequests',
  'emailsSent',
  'payments',
  'refunds',
  'callbackReplays',
  'deployments',
  'productionOperations',
]);

const SAFETY_KEYS = Object.freeze([
  'rawOutputPersisted',
  'credentialsPersisted',
  'tokensPersisted',
  'cookiesPersisted',
  'customerDataPersisted',
  'sourceEnvContentsRead',
  'productionIdentityObserved',
]);

const CHECK_SPECS = Object.freeze({
  cloudflare_stream: Object.freeze({
    accountMapping: Object.freeze(['matched', 'mismatched', 'unknown']),
    tokenScope: Object.freeze(['valid', 'invalid', 'unknown']),
    directUpload: Object.freeze(['pass', 'fail', 'not_run']),
    liveInput: Object.freeze(['pass', 'fail', 'not_run']),
    readyWebhook: Object.freeze(['pass', 'fail', 'not_run']),
  }),
  resend: Object.freeze({
    senderDomain: Object.freeze(['verified', 'unverified', 'unknown']),
    delivery: Object.freeze(['delivered', 'not_delivered', 'not_run']),
    piiBoundary: Object.freeze(['clean', 'violation', 'unknown']),
  }),
  sentry: Object.freeze({
    issue: Object.freeze(['visible', 'not_visible', 'not_run']),
    alert: Object.freeze(['configured', 'not_configured', 'unknown']),
    notification: Object.freeze(['delivered', 'not_delivered', 'not_run']),
  }),
  posthog: Object.freeze({
    project: Object.freeze(['matched', 'mismatched', 'unknown']),
    eventName: Object.freeze(['production_smoke_test']),
    eventReceipt: Object.freeze(['received', 'not_received', 'not_run']),
    piiBoundary: Object.freeze(['clean', 'violation', 'unknown']),
  }),
  durable_rate_limit: Object.freeze({
    provider: Object.freeze(['cloudflare_waf', 'upstash', 'memory', 'unknown']),
    route: Object.freeze(['protected', 'unknown']),
    enforcement: Object.freeze(['rate_limited_429', 'edge_blocked', 'not_enforced', 'unknown']),
    fallback: Object.freeze(['disabled', 'used', 'unknown']),
  }),
  payuni_sandbox: Object.freeze({
    environmentBinding: Object.freeze(['sandbox', 'mismatch', 'unknown']),
    orderIdentity: Object.freeze(['match', 'mismatch', 'unknown']),
    referenceMatch: Object.freeze(['match', 'mismatch', 'unknown']),
    amountMatch: Object.freeze(['match', 'mismatch', 'unknown']),
    paymentStatus: Object.freeze(['match', 'mismatch', 'unknown']),
    refundStatus: Object.freeze(['match', 'mismatch', 'unknown']),
    callbackConsistency: Object.freeze(['match', 'mismatch', 'unknown']),
  }),
});

const ROOT_KEYS = new Set([
  'schemaVersion',
  'workPackage',
  'provider',
  'result',
  'runId',
  'executedAtUtc',
  'authorizationRecordRef',
  'environmentClass',
  'providerEnvironmentClass',
  'nonProduction',
  'attemptCount',
  'checks',
  'evidenceRefs',
  'sideEffects',
  'safety',
  'blockingReason',
  'failureClass',
  'sanitized',
]);

const SIDE_EFFECT_KEY_SET = new Set(SIDE_EFFECT_KEYS);
const SAFETY_KEY_SET = new Set(SAFETY_KEYS);
const CHECK_KEY_SET = new Set(Object.values(CHECK_SPECS).flatMap((spec) => Object.keys(spec)));

const CHILD_SCHEMAS = Object.freeze({
  root: Object.freeze({ checks: 'checks', sideEffects: 'sideEffects', safety: 'safety' }),
});

const FORBIDDEN_KEYS = new Set([
  'stdout',
  'stderr',
  'rawoutput',
  'rawstdout',
  'rawstderr',
  'rawresponse',
  'rawbody',
  'apiresponse',
  'url',
  'env',
  'token',
  'secret',
  'cookie',
  'password',
  'credential',
  'credentials',
  'email',
  'ip',
  'useragent',
  'customerdata',
  'paymentdata',
  'ordernumber',
  'tradeno',
  'providerreference',
  'connectionstring',
  'absolutepath',
  'deploymentid',
  'streamuid',
  'streamkey',
]);

const UNSAFE_STRING_PATTERNS = Object.freeze([
  /https?:\/\//i,
  /postgres(?:ql)?:\/\//i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
]);

const SAFE_WORK_PACKAGE = /^(?:WP-[0-9]{2,4}|REL-[A-Z0-9][A-Z0-9._-]{2,79})$/;
const SAFE_RUN_ID = /^run:[a-z0-9][a-z0-9._-]{0,79}$/;
const SAFE_OPAQUE_REFERENCE = /^opaque:[a-z0-9][a-z0-9._-]{0,79}$/;
const SAFE_EVIDENCE_REFERENCE = /^(?:opaque:[a-z0-9][a-z0-9._-]{0,79}|sha256:[a-f0-9]{64})$/;
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const BLOCKING_REASONS = new Set([
  'authorization_missing',
  'credential_scope_unverified',
  'external_receipt_missing',
  'forbidden_probe',
  'human_acceptance_missing',
  'lineage_unverified',
  'non_production_unverified',
  'not_run',
  'policy_review_missing',
  'production_identity_detected',
  'provider_unavailable',
]);

const FAILURE_CLASSES = new Set([
  'account_mapping',
  'authentication',
  'delivery',
  'enforcement',
  'reconciliation_mismatch',
  'safety_violation',
  'signature',
  'timeout',
  'unknown',
]);

const REQUIRED_ROOT_KEYS = Object.freeze([
  'schemaVersion',
  'workPackage',
  'provider',
  'result',
  'runId',
  'executedAtUtc',
  'authorizationRecordRef',
  'environmentClass',
  'providerEnvironmentClass',
  'nonProduction',
  'attemptCount',
  'checks',
  'evidenceRefs',
  'sideEffects',
  'safety',
  'sanitized',
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function pushError(errors, error) {
  errors.push(error);
}

function allowedKeysForSchema(schemaName, provider) {
  if (schemaName === 'root') return ROOT_KEYS;
  if (schemaName === 'checks') return CHECK_SPECS[provider] ? new Set(Object.keys(CHECK_SPECS[provider])) : CHECK_KEY_SET;
  if (schemaName === 'sideEffects') return SIDE_EFFECT_KEY_SET;
  if (schemaName === 'safety') return SAFETY_KEY_SET;
  return null;
}

function childSchemaFor(schemaName, key) {
  return CHILD_SCHEMAS[schemaName]?.[key] ?? null;
}

function inspectValue(value, pathName, errors, seen, schemaName, provider) {
  if (value === undefined) {
    pushError(errors, `${pathName}:UNDEFINED`);
    return;
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    pushError(errors, `${pathName}:NON_JSON_TYPE`);
    return;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    pushError(errors, `${pathName}:NON_FINITE_NUMBER`);
    return;
  }
  if (typeof value === 'string') {
    if (UNSAFE_STRING_PATTERNS.some((pattern) => pattern.test(value))) pushError(errors, `${pathName}:UNSAFE_STRING`);
    return;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return;
  if (seen.has(value)) {
    pushError(errors, `${pathName}:CYCLE`);
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectValue(item, `${pathName}[${index}]`, errors, seen, null, provider));
    seen.delete(value);
    return;
  }
  if (!isPlainObject(value)) {
    pushError(errors, `${pathName}:NON_PLAIN_OBJECT`);
    seen.delete(value);
    return;
  }

  const allowedKeys = allowedKeysForSchema(schemaName, provider);
  for (const key of Object.keys(value)) {
    const normalizedKey = key.toLowerCase();
    if (key === '__proto__' || key === 'constructor' || key === 'prototype' || FORBIDDEN_KEYS.has(normalizedKey)) {
      pushError(errors, `${pathName}.${key}:FORBIDDEN_KEY`);
      continue;
    }
    if (allowedKeys && !allowedKeys.has(key)) pushError(errors, `${pathName}.${key}:UNKNOWN_KEY`);
    inspectValue(value[key], `${pathName}.${key}`, errors, seen, childSchemaFor(schemaName, key), provider);
  }
  seen.delete(value);
}

function checkRequiredKeys(value, keys, pathName, errors) {
  if (!isPlainObject(value)) {
    pushError(errors, `${pathName}:OBJECT_REQUIRED`);
    return;
  }
  for (const key of keys) if (!hasOwn(value, key)) pushError(errors, `${pathName}.${key}:REQUIRED`);
}

function checkEnum(value, allowed, pathName, errors) {
  if (!allowed.includes(value)) pushError(errors, `${pathName}:INVALID`);
}

function checkSafeReference(value, pattern, pathName, errors) {
  if (typeof value !== 'string' || !pattern.test(value)) pushError(errors, `${pathName}:INVALID`);
}

function checkUtcSeconds(value, pathName, errors) {
  if (typeof value !== 'string' || !UTC_SECONDS.test(value)) {
    pushError(errors, `${pathName}:INVALID`);
    return;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value.replace('Z', '.000Z')) pushError(errors, `${pathName}:INVALID_DATE`);
}

function validateChecks(receipt, errors) {
  const spec = CHECK_SPECS[receipt.provider];
  if (!spec) return;
  checkRequiredKeys(receipt.checks, Object.keys(spec), 'checks', errors);
  if (!isPlainObject(receipt.checks)) return;
  for (const [key, allowed] of Object.entries(spec)) checkEnum(receipt.checks[key], allowed, `checks.${key}`, errors);
}

function validateSideEffects(receipt, errors) {
  checkRequiredKeys(receipt.sideEffects, SIDE_EFFECT_KEYS, 'sideEffects', errors);
  if (!isPlainObject(receipt.sideEffects)) return;
  for (const key of SIDE_EFFECT_KEYS) {
    const value = receipt.sideEffects[key];
    if (!Number.isInteger(value) || value < 0 || value > MAX_SIDE_EFFECT_COUNTER) pushError(errors, `sideEffects.${key}:INVALID`);
  }
  for (const key of ['payments', 'refunds', 'callbackReplays', 'deployments', 'productionOperations']) {
    if (receipt.sideEffects[key] !== 0) pushError(errors, `sideEffects.${key}:MUST_BE_ZERO`);
  }
  if (receipt.provider === 'payuni_sandbox' && receipt.sideEffects.providerWriteRequests !== 0) {
    pushError(errors, 'sideEffects.providerWriteRequests:MUST_BE_ZERO_FOR_PAYUNI');
  }
}

function validateSafety(receipt, errors) {
  checkRequiredKeys(receipt.safety, SAFETY_KEYS, 'safety', errors);
  if (!isPlainObject(receipt.safety)) return;
  for (const key of SAFETY_KEYS) {
    if (receipt.safety[key] !== false) pushError(errors, `safety.${key}:MUST_BE_FALSE`);
  }
}

function checksArePending(provider, checks) {
  const spec = CHECK_SPECS[provider];
  if (!spec || !isPlainObject(checks)) return false;
  return Object.entries(spec).every(([key, allowed]) => {
    if (key === 'eventName') return checks[key] === allowed[0];
    return checks[key] === 'unknown' || checks[key] === 'not_run';
  });
}

function checksPass(provider, checks) {
  if (!isPlainObject(checks)) return false;
  switch (provider) {
    case 'cloudflare_stream':
      return checks.accountMapping === 'matched'
        && checks.tokenScope === 'valid'
        && checks.directUpload === 'pass'
        && checks.liveInput === 'pass'
        && checks.readyWebhook === 'pass';
    case 'resend':
      return checks.senderDomain === 'verified' && checks.delivery === 'delivered' && checks.piiBoundary === 'clean';
    case 'sentry':
      return checks.issue === 'visible' && checks.alert === 'configured' && checks.notification === 'delivered';
    case 'posthog':
      return checks.project === 'matched'
        && checks.eventName === 'production_smoke_test'
        && checks.eventReceipt === 'received'
        && checks.piiBoundary === 'clean';
    case 'durable_rate_limit':
      return ['cloudflare_waf', 'upstash'].includes(checks.provider)
        && checks.route === 'protected'
        && ['rate_limited_429', 'edge_blocked'].includes(checks.enforcement)
        && checks.fallback === 'disabled';
    case 'payuni_sandbox':
      return checks.environmentBinding === 'sandbox'
        && checks.orderIdentity === 'match'
        && checks.referenceMatch === 'match'
        && checks.amountMatch === 'match'
        && checks.paymentStatus === 'match'
        && checks.refundStatus === 'match'
        && checks.callbackConsistency === 'match';
    default:
      return false;
  }
}

function validateProviderPassEffects(receipt, errors) {
  const effects = receipt.sideEffects;
  if (!isPlainObject(effects)) {
    pushError(errors, 'sideEffects:INSUFFICIENT_PROVIDER_OPERATION_EVIDENCE');
    return;
  }
  const required = {
    cloudflare_stream: effects.providerReadRequests >= 1 && effects.providerWriteRequests >= 1,
    resend: effects.providerWriteRequests >= 1 && effects.emailsSent >= 1 && effects.emailsSent <= 1,
    sentry: effects.providerReadRequests >= 1 && effects.providerWriteRequests >= 1,
    posthog: effects.providerWriteRequests >= 1,
    durable_rate_limit: effects.providerReadRequests >= 1,
    payuni_sandbox: effects.providerReadRequests >= 1
      && effects.providerWriteRequests === 0
      && effects.payments === 0
      && effects.refunds === 0
      && effects.callbackReplays === 0,
  }[receipt.provider];
  if (!required) pushError(errors, 'sideEffects:INSUFFICIENT_PROVIDER_OPERATION_EVIDENCE');
}

function validateResultSemantics(receipt, errors) {
  const result = receipt.result;
  const passPredicate = checksPass(receipt.provider, receipt.checks);
  if (result === 'PASS') {
    if (!receipt.nonProduction) pushError(errors, 'nonProduction:MUST_BE_TRUE_FOR_PASS');
    if (!['preview', 'staging'].includes(receipt.environmentClass)) pushError(errors, 'environmentClass:PASS_REQUIRES_PREVIEW_OR_STAGING');
    if (receipt.providerEnvironmentClass === 'unknown') pushError(errors, 'providerEnvironmentClass:PASS_REQUIRES_VERIFIED_CLASS');
    if (receipt.attemptCount < 1) pushError(errors, 'attemptCount:PASS_REQUIRES_ATTEMPT');
    if (!Array.isArray(receipt.evidenceRefs) || receipt.evidenceRefs.length < 1) pushError(errors, 'evidenceRefs:PASS_REQUIRES_REFERENCE');
    if (!passPredicate) pushError(errors, 'checks:PASS_PREDICATE_NOT_MET');
    validateProviderPassEffects(receipt, errors);
    if (hasOwn(receipt, 'blockingReason') || hasOwn(receipt, 'failureClass')) pushError(errors, 'result:PASS_CANNOT_HAVE_REASON');
    return;
  }

  if (result === 'PENDING_EXTERNAL' || result === 'PENDING_HUMAN') {
    const validReasons = result === 'PENDING_EXTERNAL'
      ? ['not_run', 'provider_unavailable', 'credential_scope_unverified', 'external_receipt_missing']
      : ['human_acceptance_missing', 'policy_review_missing'];
    if (!validReasons.includes(receipt.blockingReason)) pushError(errors, 'blockingReason:INVALID_FOR_PENDING_RESULT');
    if (hasOwn(receipt, 'failureClass')) pushError(errors, 'failureClass:PENDING_RESULT_FORBIDS_FAILURE_CLASS');
    if (receipt.attemptCount !== 0) pushError(errors, 'attemptCount:PENDING_RESULT_REQUIRES_ZERO');
    if (!Array.isArray(receipt.evidenceRefs) || receipt.evidenceRefs.length !== 0) pushError(errors, 'evidenceRefs:PENDING_RESULT_REQUIRES_EMPTY');
    if (!checksArePending(receipt.provider, receipt.checks)) pushError(errors, 'checks:PENDING_RESULT_REQUIRES_UNKNOWN_OR_NOT_RUN');
    if (!SIDE_EFFECT_KEYS.every((key) => receipt.sideEffects?.[key] === 0)) pushError(errors, 'sideEffects:PENDING_RESULT_REQUIRES_ZERO');
    return;
  }

  if (result === 'FAILED') {
    if (!FAILURE_CLASSES.has(receipt.failureClass)) pushError(errors, 'failureClass:REQUIRED_FOR_FAILED_RESULT');
    if (hasOwn(receipt, 'blockingReason')) pushError(errors, 'blockingReason:FAILED_RESULT_FORBIDS_BLOCKING_REASON');
    if (receipt.attemptCount < 1) pushError(errors, 'attemptCount:FAILED_REQUIRES_ATTEMPT');
    if (!Array.isArray(receipt.evidenceRefs) || receipt.evidenceRefs.length < 1) pushError(errors, 'evidenceRefs:FAILED_REQUIRES_REFERENCE');
    if (passPredicate) pushError(errors, 'checks:FAILED_RESULT_CANNOT_HAVE_PASS_PREDICATE');
    return;
  }

  if (result === 'BLOCKED') {
    if (!['authorization_missing', 'credential_scope_unverified', 'forbidden_probe', 'lineage_unverified', 'non_production_unverified', 'production_identity_detected', 'provider_unavailable'].includes(receipt.blockingReason)) {
      pushError(errors, 'blockingReason:REQUIRED_FOR_BLOCKED_RESULT');
    }
    if (hasOwn(receipt, 'failureClass')) pushError(errors, 'failureClass:BLOCKED_RESULT_FORBIDS_FAILURE_CLASS');
    if (passPredicate) pushError(errors, 'checks:BLOCKED_RESULT_CANNOT_HAVE_PASS_PREDICATE');
  }
}

function validateFieldSemantics(receipt, errors) {
  checkRequiredKeys(receipt, REQUIRED_ROOT_KEYS, 'root', errors);
  if (receipt.schemaVersion !== EXTERNAL_PROVIDER_EVIDENCE_SCHEMA) pushError(errors, 'schemaVersion:INVALID');
  checkSafeReference(receipt.workPackage, SAFE_WORK_PACKAGE, 'workPackage', errors);
  checkEnum(receipt.provider, EXTERNAL_PROVIDERS, 'provider', errors);
  checkEnum(receipt.result, EXTERNAL_PROVIDER_RESULTS, 'result', errors);
  checkSafeReference(receipt.runId, SAFE_RUN_ID, 'runId', errors);
  checkUtcSeconds(receipt.executedAtUtc, 'executedAtUtc', errors);
  checkSafeReference(receipt.authorizationRecordRef, SAFE_OPAQUE_REFERENCE, 'authorizationRecordRef', errors);
  checkEnum(receipt.environmentClass, ENVIRONMENT_CLASSES, 'environmentClass', errors);
  checkEnum(receipt.providerEnvironmentClass, PROVIDER_ENVIRONMENT_CLASSES, 'providerEnvironmentClass', errors);
  if (receipt.nonProduction !== true) pushError(errors, 'nonProduction:MUST_BE_TRUE');
  if (!Number.isInteger(receipt.attemptCount) || receipt.attemptCount < 0 || receipt.attemptCount > MAX_ATTEMPT_COUNT) pushError(errors, 'attemptCount:INVALID');

  if (!Array.isArray(receipt.evidenceRefs)) {
    pushError(errors, 'evidenceRefs:ARRAY_REQUIRED');
  } else {
    if (receipt.evidenceRefs.length > 8) pushError(errors, 'evidenceRefs:TOO_MANY');
    if (new Set(receipt.evidenceRefs).size !== receipt.evidenceRefs.length) pushError(errors, 'evidenceRefs:DUPLICATE');
    receipt.evidenceRefs.forEach((reference, index) => checkSafeReference(reference, SAFE_EVIDENCE_REFERENCE, `evidenceRefs[${index}]`, errors));
  }

  validateChecks(receipt, errors);
  validateSideEffects(receipt, errors);
  validateSafety(receipt, errors);
  if (receipt.sanitized !== true) pushError(errors, 'sanitized:MUST_BE_TRUE');
  if (hasOwn(receipt, 'blockingReason') && !BLOCKING_REASONS.has(receipt.blockingReason)) pushError(errors, 'blockingReason:INVALID');
  if (hasOwn(receipt, 'failureClass') && !FAILURE_CLASSES.has(receipt.failureClass)) pushError(errors, 'failureClass:INVALID');
  validateResultSemantics(receipt, errors);
}

function validateExternalProviderReceipt(receipt) {
  const errors = [];
  if (!isPlainObject(receipt)) return { ok: false, errors: ['root:OBJECT_REQUIRED'] };
  inspectValue(receipt, 'root', errors, new WeakSet(), 'root', receipt.provider);
  validateFieldSemantics(receipt, errors);
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

function canonicalize(value, seen = new WeakSet()) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw new Error('NON_JSON_TYPE');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('NON_FINITE_NUMBER');
  if (typeof value === 'string' || value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (seen.has(value)) throw new Error('CYCLE');
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => canonicalize(item, seen));
    seen.delete(value);
    return result;
  }
  if (!isPlainObject(value)) throw new Error('NON_PLAIN_OBJECT');
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const normalizedKey = key.toLowerCase();
    if (key === '__proto__' || key === 'constructor' || key === 'prototype' || FORBIDDEN_KEYS.has(normalizedKey)) throw new Error('FORBIDDEN_KEY');
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

function serializeExternalProviderReceipt(receipt) {
  const validation = validateExternalProviderReceipt(receipt);
  if (!validation.ok) throw new Error(`EXTERNAL_PROVIDER_RECEIPT_VALIDATION_FAILED:${validation.errors.join('|')}`);
  return `${canonicalString(receipt)}\n`;
}

function parseAndValidateExternalProviderReceipt(json) {
  if (typeof json !== 'string') return { ok: false, errors: ['input:STRING_REQUIRED'] };
  try {
    const value = JSON.parse(json);
    const validation = validateExternalProviderReceipt(value);
    return validation.ok ? { ok: true, value, errors: [] } : { ok: false, errors: validation.errors };
  } catch (error) {
    return { ok: false, errors: [`json:${error?.name === 'SyntaxError' ? 'INVALID_JSON' : 'PARSE_FAILED'}`] };
  }
}

function createPendingExternalReceipt(provider, options = {}) {
  if (!EXTERNAL_PROVIDERS.includes(provider)) throw new Error('PROVIDER_INVALID');
  if (!isPlainObject(options)) throw new Error('OPTIONS_OBJECT_REQUIRED');
  const optionKeys = new Set(['workPackage', 'runId', 'executedAtUtc', 'authorizationRecordRef', 'blockingReason']);
  for (const key of Object.keys(options)) if (!optionKeys.has(key)) throw new Error('OPTIONS_KEY_INVALID');
  const spec = CHECK_SPECS[provider];
  const checks = Object.fromEntries(Object.entries(spec).map(([key, allowed]) => [key, key === 'eventName' ? allowed[0] : (allowed.includes('not_run') ? 'not_run' : 'unknown')]));
  const sideEffects = Object.fromEntries(SIDE_EFFECT_KEYS.map((key) => [key, 0]));
  const safety = Object.fromEntries(SAFETY_KEYS.map((key) => [key, false]));
  const receipt = {
    schemaVersion: EXTERNAL_PROVIDER_EVIDENCE_SCHEMA,
    workPackage: options.workPackage ?? 'REL-20260821-EXTERNAL-PROVIDER-CONTRACT',
    provider,
    result: 'PENDING_EXTERNAL',
    runId: options.runId ?? `run:pending-${provider}`,
    executedAtUtc: options.executedAtUtc ?? '2026-08-21T00:00:00Z',
    authorizationRecordRef: options.authorizationRecordRef ?? 'opaque:external-provider-contract',
    environmentClass: 'staging',
    providerEnvironmentClass: 'unknown',
    nonProduction: true,
    attemptCount: 0,
    checks,
    evidenceRefs: [],
    sideEffects,
    safety,
    blockingReason: options.blockingReason ?? 'not_run',
    sanitized: true,
  };
  const validation = validateExternalProviderReceipt(receipt);
  if (!validation.ok) throw new Error(`PENDING_RECEIPT_INVALID:${validation.errors.join('|')}`);
  return receipt;
}

export {
  EXTERNAL_PROVIDER_EVIDENCE_SCHEMA,
  EXTERNAL_PROVIDERS,
  EXTERNAL_PROVIDER_RESULTS,
  CHECK_SPECS as EXTERNAL_PROVIDER_CHECKS,
  canonicalDigest,
  createPendingExternalReceipt,
  parseAndValidateExternalProviderReceipt,
  serializeExternalProviderReceipt,
  validateExternalProviderReceipt,
};
