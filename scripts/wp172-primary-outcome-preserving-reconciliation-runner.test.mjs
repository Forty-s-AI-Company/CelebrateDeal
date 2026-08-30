import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCleanupOutcome,
  createPrimaryOutcome,
  initialReceipt,
  normalizeFailure,
  validateReceipt,
} from "./wp172-primary-outcome-preserving-reconciliation-runner.mjs";

test("primary failure survives cleanup failure", () => {
  const receipt = initialReceipt();
  receipt.primaryOutcome = createPrimaryOutcome(child("WP170_DATABASE_IDENTITY_EXACT_NO_GO", "APP_ROUTE_MISMATCH"));
  applyCleanupOutcome(receipt, false, true);
  assert.equal(receipt.terminalStatus, "WP172_CLEANUP_EXACT_NO_GO");
  assert.equal(receipt.primaryOutcome.normalizedStatus, "WP172_DATABASE_IDENTITY_EXACT_NO_GO");
  assert.equal(receipt.primaryOutcome.normalizedFailure, "APP_ROUTE_MISMATCH");
  assert.equal(receipt.primaryOutcome.capturedBeforeCleanup, true);
});

test("primary success survives cleanup failure without changing terminal safety", () => {
  const receipt = initialReceipt();
  receipt.primaryOutcome = createPrimaryOutcome(child("WP170_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED", null));
  applyCleanupOutcome(receipt, false, true);
  assert.equal(receipt.terminalStatus, "WP172_CLEANUP_EXACT_NO_GO");
  assert.equal(receipt.primaryOutcome.normalizedStatus, "WP172_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED");
});

test("successful cleanup promotes the preserved primary status", () => {
  const receipt = initialReceipt();
  receipt.primaryOutcome = createPrimaryOutcome(child("WP170_CANDIDATE_EXACT_NO_GO_ZERO", "CANDIDATE_ZERO"));
  applyCleanupOutcome(receipt, true, false);
  assert.equal(receipt.terminalStatus, "WP172_CANDIDATE_EXACT_NO_GO_ZERO");
  assert.equal(receipt.primaryOutcome.normalizedFailure, "CANDIDATE_ZERO");
});

test("missing child never fabricates a primary outcome", () => {
  const primary = createPrimaryOutcome(null);
  assert.equal(primary.observed, false);
  assert.equal(primary.normalizedStatus, "NOT_OBSERVED");
  assert.equal(primary.capturedBeforeCleanup, false);
});

test("unsafe child failures normalize without retaining raw text", () => {
  assert.equal(normalizeFailure("postgresql://unsafe"), "NORMALIZED_EXTERNAL_FAILURE");
  assert.equal(normalizeFailure("APP_ROUTE_MISMATCH"), "APP_ROUTE_MISMATCH");
});

test("candidate zero and ambiguous preserve zero PayUni queries", () => {
  for (const [status, failure] of [["WP170_CANDIDATE_EXACT_NO_GO_ZERO", "CANDIDATE_ZERO"], ["WP170_CANDIDATE_EXACT_NO_GO_AMBIGUOUS", "CANDIDATE_AMBIGUOUS"]]) {
    const primary = createPrimaryOutcome(child(status, failure));
    assert.equal(primary.payuni.queryAttempts, 0);
  }
});

test("receipt rejects cleanup failure that does not control terminal status", () => {
  const receipt = initialReceipt();
  receipt.cleanupOutcome = { attempted: true, initialPass: false, residualPathPresent: true, controlledRecoveryPass: false };
  assert.equal(validateReceipt(receipt).ok, false);
});

test("receipt rejects valid child without captured primary", () => {
  const receipt = initialReceipt();
  receipt.brokerOutcome.childValid = true;
  assert.equal(validateReceipt(receipt).ok, false);
});

test("receipt rejects retry, write, package and sensitive persistence", () => {
  for (const mutate of [
    (x) => { x.brokerOutcome.retries = 1; },
    (x) => { x.sideEffects.databaseWrites = 1; },
    (x) => { x.startupPreflight.npxUsed = true; },
    (x) => { x.safety.rawIdentifiersPersisted = true; },
  ]) {
    const receipt = initialReceipt();
    mutate(receipt);
    assert.equal(validateReceipt(receipt).ok, false);
  }
});

test("receipt rejects URLs and raw identifier fields", () => {
  assert.equal(validateReceipt({ ...initialReceipt(), note: "https://example.invalid" }).ok, false);
  assert.equal(validateReceipt({ ...initialReceipt(), orderNumber: "synthetic" }).ok, false);
});

test("initial receipt is a valid fail-closed envelope", () => {
  assert.deepEqual(validateReceipt(initialReceipt()), { ok: true, errors: [] });
});

function child(status, failure) {
  return {
    status,
    failure,
    database: { connectionAttempts: 0, readOnlyTransactionAttempts: 0, readOnlyTransactions: 0, applicationSelects: 0, retries: 0, transactionReadOnly: false, identityDigest: null, productionIdentityDetected: false, candidateBucket: status.includes("ZERO") ? "zero" : status.includes("AMBIGUOUS") ? "ambiguous" : "not_run", candidateCount: null, disconnected: false },
    payuni: { officialSandbox: false, queryAttempts: 0, retries: 0, redirects: 0, normalizedStatus: null, referenceMatched: false, orderMatched: false, amountMatched: false, grossAmountCents: null, refundedAmountCents: null, remainingRefundableAmountCents: null },
    reconciliation: { classification: "NOT_RUN", localStatus: null, providerAhead: false },
    sideEffects: { databaseWrites: 0, rowLocks: 0, providerWrites: 0, payments: 0, refunds: 0, callbacks: 0, deployments: 0, environmentMutations: 0, dnsMutations: 0, production: 0 },
    safety: { rawDatabaseRowsPersisted: false, rawProviderResponsePersisted: false, rawIdentifiersPersisted: false, urlsPersisted: false, environmentValuesPersisted: false, credentialsPersisted: false, tokensPersisted: false, cookiesPersisted: false },
  };
}
