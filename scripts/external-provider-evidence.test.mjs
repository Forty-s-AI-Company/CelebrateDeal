import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
  EXTERNAL_PROVIDER_CHECKS,
  EXTERNAL_PROVIDER_EVIDENCE_SCHEMA,
  EXTERNAL_PROVIDERS,
  canonicalDigest,
  createPendingExternalReceipt,
  parseAndValidateExternalProviderReceipt,
  serializeExternalProviderReceipt,
  validateExternalProviderReceipt,
} from './external-provider-evidence.mjs';

const ZERO_SIDE_EFFECTS = {
  databaseReads: 0,
  databaseWrites: 0,
  providerReadRequests: 0,
  providerWriteRequests: 0,
  emailsSent: 0,
  payments: 0,
  refunds: 0,
  callbackReplays: 0,
  deployments: 0,
  productionOperations: 0,
};

const SAFE_FLAGS = {
  rawOutputPersisted: false,
  credentialsPersisted: false,
  tokensPersisted: false,
  cookiesPersisted: false,
  customerDataPersisted: false,
  sourceEnvContentsRead: false,
  productionIdentityObserved: false,
};

const PASS_CHECKS = {
  cloudflare_stream: {
    accountMapping: 'matched',
    tokenScope: 'valid',
    directUpload: 'pass',
    liveInput: 'pass',
    readyWebhook: 'pass',
  },
  resend: {
    senderDomain: 'verified',
    delivery: 'delivered',
    piiBoundary: 'clean',
  },
  sentry: {
    issue: 'visible',
    alert: 'configured',
    notification: 'delivered',
  },
  posthog: {
    project: 'matched',
    eventName: 'production_smoke_test',
    eventReceipt: 'received',
    piiBoundary: 'clean',
  },
  durable_rate_limit: {
    provider: 'cloudflare_waf',
    route: 'protected',
    enforcement: 'rate_limited_429',
    fallback: 'disabled',
  },
  payuni_sandbox: {
    environmentBinding: 'sandbox',
    orderIdentity: 'match',
    referenceMatch: 'match',
    amountMatch: 'match',
    paymentStatus: 'match',
    refundStatus: 'match',
    callbackConsistency: 'match',
  },
};

const PASS_PROVIDER_ENVIRONMENTS = {
  cloudflare_stream: 'staging',
  resend: 'test',
  sentry: 'staging',
  posthog: 'test',
  durable_rate_limit: 'staging',
  payuni_sandbox: 'sandbox',
};

function passSideEffects(provider) {
  return {
    ...ZERO_SIDE_EFFECTS,
    providerReadRequests: ['cloudflare_stream', 'sentry', 'durable_rate_limit', 'payuni_sandbox'].includes(provider) ? 1 : 0,
    providerWriteRequests: ['cloudflare_stream', 'resend', 'sentry', 'posthog'].includes(provider) ? 1 : 0,
    emailsSent: provider === 'resend' ? 1 : 0,
  };
}

function passReceipt(provider, overrides = {}) {
  return {
    schemaVersion: EXTERNAL_PROVIDER_EVIDENCE_SCHEMA,
    workPackage: 'REL-20260821-EXTERNAL-PROVIDER-CONTRACT',
    sourceCommit: '318cd48',
    provider,
    result: 'PASS',
    runId: `run:synthetic-${provider}`,
    executedAtUtc: '2026-08-21T02:57:41Z',
    authorizationRecordRef: 'opaque:synthetic-authorization',
    environmentClass: 'staging',
    providerEnvironmentClass: PASS_PROVIDER_ENVIRONMENTS[provider],
    nonProduction: true,
    attemptCount: 1,
    checks: { ...PASS_CHECKS[provider] },
    evidenceRefs: [`opaque:synthetic-${provider}`],
    sideEffects: passSideEffects(provider),
    safety: { ...SAFE_FLAGS },
    sanitized: true,
    ...overrides,
  };
}

test('module imports without environment, network or process side effects', async () => {
  const source = await fs.readFile(new URL('./external-provider-evidence.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /process\.env|fetch\s*\(|node:child_process/);
  assert.equal(typeof validateExternalProviderReceipt, 'function');
  assert.equal(typeof serializeExternalProviderReceipt, 'function');
});

test('pending factory creates a safe fail-closed receipt for every provider', () => {
  for (const provider of EXTERNAL_PROVIDERS) {
    const receipt = createPendingExternalReceipt(provider);
    assert.equal(validateExternalProviderReceipt(receipt).ok, true);
    assert.equal(receipt.result, 'PENDING_EXTERNAL');
    assert.equal(receipt.sourceCommit, 'unknown');
    assert.equal(receipt.attemptCount, 0);
    assert.deepEqual(receipt.evidenceRefs, []);
    assert.equal(serializeExternalProviderReceipt(receipt).endsWith('\n'), true);
    assert.equal(parseAndValidateExternalProviderReceipt(serializeExternalProviderReceipt(receipt)).ok, true);
  }
});

test('synthetic PASS fixtures cover each provider predicate without claiming external success', () => {
  for (const provider of EXTERNAL_PROVIDERS) {
    const receipt = passReceipt(provider);
    const validation = validateExternalProviderReceipt(receipt);
    assert.equal(validation.ok, true, `${provider}: ${validation.errors.join('|')}`);
  }
});

test('each provider requires every success check', () => {
  for (const provider of EXTERNAL_PROVIDERS) {
    for (const key of Object.keys(EXTERNAL_PROVIDER_CHECKS[provider])) {
      const checks = { ...PASS_CHECKS[provider], [key]: key === 'eventName' ? 'invalid' : 'unknown' };
      const validation = validateExternalProviderReceipt(passReceipt(provider, { checks }));
      assert.equal(validation.ok, false, `${provider}.${key} unexpectedly passed`);
      assert.equal(validation.errors.includes('checks:PASS_PREDICATE_NOT_MET'), true);
    }
  }
});

test('PASS requires verified non-Production identity, evidence and an attempt', () => {
  const cases = [
    { sourceCommit: 'unknown' },
    { nonProduction: false },
    { environmentClass: 'isolated-restore-drill' },
    { providerEnvironmentClass: 'unknown' },
    { attemptCount: 0 },
    { evidenceRefs: [] },
  ];
  for (const overrides of cases) assert.equal(validateExternalProviderReceipt(passReceipt('resend', overrides)).ok, false);
});

test('PASS source lineage accepts only a short lowercase hexadecimal commit', () => {
  assert.equal(validateExternalProviderReceipt(passReceipt('resend', { sourceCommit: '318CD48' })).ok, false);
  assert.equal(validateExternalProviderReceipt(passReceipt('resend', { sourceCommit: 'short' })).ok, false);
  assert.equal(validateExternalProviderReceipt(passReceipt('resend', { sourceCommit: 'a'.repeat(41) })).ok, false);
  assert.equal(validateExternalProviderReceipt({
    ...passReceipt('resend'),
    schemaVersion: 'celebratedeal-external-provider-evidence/v1',
  }).ok, false);
});

test('raw output, provider payloads, identifiers and unknown nested keys are rejected', () => {
  const unsafeReceipts = [
    passReceipt('resend', { stdout: 'raw response' }),
    passReceipt('resend', { checks: { ...PASS_CHECKS.resend, rawResponse: 'provider payload' } }),
    passReceipt('resend', { sideEffects: { ...passSideEffects('resend'), url: 'https://provider.invalid' } }),
    passReceipt('resend', { evidenceRefs: ['https://provider.invalid/order'] }),
    passReceipt('resend', { evidenceRefs: ['opaque:orderNumber-123'] }),
    passReceipt('payuni_sandbox', { checks: { ...PASS_CHECKS.payuni_sandbox, tradeNo: 'opaque-trade' } }),
  ];
  for (const receipt of unsafeReceipts) {
    assert.equal(validateExternalProviderReceipt(receipt).ok, false);
    assert.throws(() => serializeExternalProviderReceipt(receipt));
  }
});

test('safety flags and forbidden side effects fail closed', () => {
  for (const key of Object.keys(SAFE_FLAGS)) {
    const safety = { ...SAFE_FLAGS, [key]: true };
    assert.equal(validateExternalProviderReceipt(passReceipt('posthog', { safety })).ok, false, key);
  }
  for (const key of ['payments', 'refunds', 'callbackReplays', 'deployments', 'productionOperations']) {
    const sideEffects = { ...passSideEffects('posthog'), [key]: 1 };
    assert.equal(validateExternalProviderReceipt(passReceipt('posthog', { sideEffects })).ok, false, key);
  }
  assert.equal(validateExternalProviderReceipt(passReceipt('payuni_sandbox', {
    sideEffects: { ...passSideEffects('payuni_sandbox'), providerWriteRequests: 1 },
  })).ok, false);
});

test('side-effect counters and attempts are bounded integers', () => {
  assert.equal(validateExternalProviderReceipt(passReceipt('sentry', {
    attemptCount: 6,
  })).ok, false);
  assert.equal(validateExternalProviderReceipt(passReceipt('sentry', {
    sideEffects: { ...passSideEffects('sentry'), providerReadRequests: -1 },
  })).ok, false);
  assert.equal(validateExternalProviderReceipt(passReceipt('sentry', {
    sideEffects: { ...passSideEffects('sentry'), providerReadRequests: 1.5 },
  })).ok, false);
  assert.equal(validateExternalProviderReceipt(passReceipt('sentry', {
    sideEffects: { ...passSideEffects('sentry'), providerReadRequests: 101 },
  })).ok, false);
});

test('FAILED, BLOCKED and PENDING_HUMAN states require closed reason semantics', () => {
  const failed = passReceipt('cloudflare_stream', {
    result: 'FAILED',
    checks: { ...PASS_CHECKS.cloudflare_stream, directUpload: 'fail' },
    failureClass: 'authentication',
  });
  assert.equal(validateExternalProviderReceipt(failed).ok, true);

  const blocked = createPendingExternalReceipt('cloudflare_stream');
  const blockedReceipt = { ...blocked, result: 'BLOCKED', blockingReason: 'authorization_missing' };
  assert.equal(validateExternalProviderReceipt(blockedReceipt).ok, true);

  const pendingHuman = { ...blocked, result: 'PENDING_HUMAN', blockingReason: 'policy_review_missing' };
  assert.equal(validateExternalProviderReceipt(pendingHuman).ok, true);

  assert.equal(validateExternalProviderReceipt({ ...failed, failureClass: undefined }).ok, false);
  assert.equal(validateExternalProviderReceipt({ ...failed, result: 'FAILED', checks: { ...PASS_CHECKS.cloudflare_stream } }).ok, false);
  assert.equal(validateExternalProviderReceipt({ ...blockedReceipt, checks: { ...PASS_CHECKS.cloudflare_stream } }).ok, false);
  assert.equal(validateExternalProviderReceipt({ ...blockedReceipt, blockingReason: 'not_run' }).ok, false);
});

test('canonical serialization is deterministic and digest changes with content', () => {
  const receipt = passReceipt('posthog');
  const reordered = {
    sanitized: receipt.sanitized,
    safety: receipt.safety,
    sideEffects: receipt.sideEffects,
    evidenceRefs: receipt.evidenceRefs,
    checks: receipt.checks,
    attemptCount: receipt.attemptCount,
    sourceCommit: receipt.sourceCommit,
    nonProduction: receipt.nonProduction,
    providerEnvironmentClass: receipt.providerEnvironmentClass,
    environmentClass: receipt.environmentClass,
    authorizationRecordRef: receipt.authorizationRecordRef,
    executedAtUtc: receipt.executedAtUtc,
    runId: receipt.runId,
    result: receipt.result,
    provider: receipt.provider,
    workPackage: receipt.workPackage,
    schemaVersion: receipt.schemaVersion,
  };
  assert.equal(serializeExternalProviderReceipt(receipt), serializeExternalProviderReceipt(reordered));
  assert.equal(canonicalDigest(receipt), canonicalDigest(reordered));
  assert.notEqual(canonicalDigest(receipt), canonicalDigest({ ...receipt, runId: 'run:synthetic-other' }));
  assert.equal(parseAndValidateExternalProviderReceipt('{bad json}').ok, false);
  assert.equal(parseAndValidateExternalProviderReceipt(42).ok, false);
});

test('invalid schema, provider, date, reference and options are rejected', () => {
  assert.equal(validateExternalProviderReceipt(passReceipt('resend', { schemaVersion: 'wrong/v1' })).ok, false);
  assert.equal(validateExternalProviderReceipt(passReceipt('resend', { provider: 'unknown' })).ok, false);
  assert.equal(validateExternalProviderReceipt(passReceipt('resend', { executedAtUtc: '2026-02-30T00:00:00Z' })).ok, false);
  assert.equal(validateExternalProviderReceipt(passReceipt('resend', { authorizationRecordRef: 'opaque:bad@address.test' })).ok, false);
  assert.throws(() => createPendingExternalReceipt('unknown'));
  assert.throws(() => createPendingExternalReceipt('resend', { unexpected: true }));
});

test('unsafe prototype keys are rejected before canonical serialization', () => {
  const receipt = passReceipt('resend');
  Object.defineProperty(receipt, '__proto__', { value: { rawResponse: 'bad' }, enumerable: true });
  assert.equal(validateExternalProviderReceipt(receipt).ok, false);
  assert.throws(() => serializeExternalProviderReceipt(receipt));
});
