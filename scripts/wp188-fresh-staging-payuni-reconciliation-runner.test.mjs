import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  CONTRACT,
  buildIsolationCommand,
  createPrimaryOutcome,
  initialReceipt,
  parseFreshnessJson,
  scoreEligible,
  validateReceipt,
} from "./wp188-fresh-staging-payuni-reconciliation-runner.mjs";
import { TARGET_KEYS } from "./wp174-fresh-preview-payuni-readonly-reconciliation-runner.mjs";

function consistentReceipt() {
  const receipt = initialReceipt();
  receipt.terminalStatus = "WP188_READ_ONLY_RECONCILIATION_CONSISTENT";
  receipt.processIsolation.isolatedTargetKeyPresenceCount = 0;
  receipt.freshness = { ...receipt.freshness, wp187Accepted: true, projectMatched: true, deploymentMatched: true, preview: true, ready: true, aliasMarkerMatched: true, healthStatus: 200, noRedirect: true };
  receipt.broker = { ...receipt.broker, attempts: 1, childValid: true };
  receipt.primaryOutcome = createPrimaryOutcome({
    status: "WP170_READ_ONLY_RECONCILIATION_CONSISTENT",
    database: { connectionAttempts: 1, readOnlyTransactionAttempts: 1, readOnlyTransactions: 1, applicationSelects: 1, transactionReadOnly: true, identityDigest: "sha256:db", productionIdentityDetected: false, candidateBucket: "one", candidateCount: 1, disconnected: true },
    payuni: { officialSandbox: true, queryAttempts: 1, retries: 0, redirects: 0, normalizedStatus: "paid", referenceMatched: true, orderMatched: true, amountMatched: true },
    reconciliation: { classification: "CONSISTENT", providerAhead: false },
  });
  receipt.cleanupOutcome = { attempted: true, pass: true, residualPathPresent: false, residualFileCount: 0, residualEnvPathCount: 0, residualSafe: true };
  receipt.scoreImpact.eligible = true;
  return receipt;
}

test("isolation command removes exactly the seven target names without fixture values", () => {
  const command = buildIsolationCommand(path.resolve("node.exe"), path.resolve("runner.mjs"));
  assert.equal(TARGET_KEYS.length, 7);
  for (const key of TARGET_KEYS) assert.equal(command.split(`Env:${key}`).length - 1, 1);
  assert.equal((command.match(/Remove-Item -LiteralPath/gu) ?? []).length, 7);
  assert.doesNotMatch(command, /synthetic-value-must-not-leak/u);
  assert.match(command, /--isolated-live/u);
});

test("isolation paths must be absolute", () => {
  assert.throws(() => buildIsolationCommand("node", "runner.mjs"), /ABSOLUTE_PATH_REQUIRED/u);
});

test("freshness accepts only the exact WP-187 Preview READY deployment", () => {
  const ok = parseFreshnessJson(JSON.stringify({ id: CONTRACT.expectedDeployment, name: CONTRACT.project, target: "preview", status: "READY" }), 0);
  assert.equal(ok.ok, true);
  for (const value of [
    { id: "dpl_old", name: CONTRACT.project, target: "preview", status: "READY" },
    { id: CONTRACT.expectedDeployment, name: "other", target: "preview", status: "READY" },
    { id: CONTRACT.expectedDeployment, name: CONTRACT.project, target: "production", status: "READY" },
    { id: CONTRACT.expectedDeployment, name: CONTRACT.project, target: "preview", status: "BUILDING" },
  ]) assert.equal(parseFreshnessJson(JSON.stringify(value), 0).ok, false);
  assert.equal(parseFreshnessJson("not-json", 0).ok, false);
});

test("consistent exact-one read-only reconciliation is score eligible", () => {
  const receipt = consistentReceipt();
  assert.equal(scoreEligible(receipt), true);
  assert.deepEqual(validateReceipt(receipt).errors, []);
});

test("safe empty cleanup residual does not erase the primary outcome", () => {
  const receipt = consistentReceipt();
  receipt.cleanupOutcome = { attempted: true, pass: false, residualPathPresent: true, residualFileCount: 0, residualEnvPathCount: 0, residualSafe: true };
  assert.equal(scoreEligible(receipt), true);
  assert.equal(receipt.primaryOutcome.capturedBeforeCleanup, true);
  assert.deepEqual(validateReceipt(receipt).errors, []);
});

test("unsafe cleanup residual fails closed", () => {
  const receipt = consistentReceipt();
  receipt.cleanupOutcome = { attempted: true, pass: false, residualPathPresent: true, residualFileCount: 1, residualEnvPathCount: 1, residualSafe: false };
  receipt.terminalStatus = "WP188_CLEANUP_UNSAFE_EXACT_NO_GO";
  receipt.scoreImpact.eligible = false;
  assert.equal(scoreEligible(receipt), false);
  assert.deepEqual(validateReceipt(receipt).errors, []);
});

test("inherited target-key presence prevents eligibility", () => {
  const receipt = consistentReceipt();
  receipt.processIsolation.isolatedTargetKeyPresenceCount = 1;
  receipt.scoreImpact.eligible = false;
  assert.equal(scoreEligible(receipt), false);
});

test("zero or ambiguous candidate cannot query provider", () => {
  for (const [status, bucket] of [["WP170_CANDIDATE_EXACT_NO_GO_ZERO", "zero"], ["WP170_CANDIDATE_EXACT_NO_GO_AMBIGUOUS", "ambiguous"]]) {
    const primary = createPrimaryOutcome({ status, database: { candidateBucket: bucket, candidateCount: bucket === "zero" ? 0 : 2 }, payuni: { queryAttempts: 0 }, reconciliation: {} });
    assert.equal(primary.payuni.queryAttempts, 0);
    assert.match(primary.status, /^WP188_CANDIDATE_/u);
  }
});

test("provider query before exact-one candidate is rejected", () => {
  const receipt = consistentReceipt();
  receipt.primaryOutcome.database.candidateBucket = "zero";
  receipt.scoreImpact.eligible = false;
  assert.ok(validateReceipt(receipt).errors.includes("PROVIDER_BEFORE_CANDIDATE"));
});

test("divergence is preserved but is not scored as consistency", () => {
  const receipt = consistentReceipt();
  receipt.terminalStatus = "WP188_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED";
  receipt.primaryOutcome.status = receipt.terminalStatus;
  receipt.primaryOutcome.reconciliation = { classification: "PROVIDER_AHEAD_MISSING_CALLBACK_CANDIDATE", providerAhead: true };
  receipt.scoreImpact.eligible = false;
  assert.equal(scoreEligible(receipt), false);
  assert.deepEqual(validateReceipt(receipt).errors, []);
});

test("attempt, redirect and write budgets fail closed", () => {
  const receipt = consistentReceipt();
  receipt.broker.attempts = 2;
  receipt.primaryOutcome.payuni.redirects = 1;
  receipt.sideEffects.databaseWrites = 1;
  receipt.scoreImpact.eligible = false;
  const errors = validateReceipt(receipt).errors;
  assert.ok(errors.includes("ATTEMPT_BUDGET"));
  assert.ok(errors.includes("RETRY_REDIRECT"));
  assert.ok(errors.includes("FORBIDDEN_SIDE_EFFECT"));
});

test("receipt rejects raw URLs and sensitive persistence", () => {
  const receipt = consistentReceipt();
  receipt.safety.credentialsPersisted = true;
  receipt.debug = { url: "https://example.invalid" };
  receipt.scoreImpact.eligible = false;
  const errors = validateReceipt(receipt).errors;
  assert.ok(errors.includes("SENSITIVE_PERSISTENCE"));
  assert.ok(errors.includes("FORBIDDEN_TEXT"));
});
