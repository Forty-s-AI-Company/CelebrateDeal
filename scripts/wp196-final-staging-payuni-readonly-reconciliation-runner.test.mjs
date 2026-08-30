import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTRACT,
  initialReceipt,
  parseFreshness,
  successEligible,
  validateReceipt,
} from "./wp196-final-staging-payuni-readonly-reconciliation-runner.mjs";

function eligibleReceipt() {
  const receipt = initialReceipt();
  receipt.terminalStatus = "WP196_FINAL_RECONCILIATION_CONSISTENT";
  receipt.freshness = { ...receipt.freshness, deploymentMatched: true, preview: true, ready: true, noRedirect: true };
  receipt.temp = { ...receipt.temp, cleanupPass: true };
  receipt.broker = { ...receipt.broker, childValid: true };
  receipt.primaryOutcome = {
    observed: true,
    status: receipt.terminalStatus,
    failure: null,
    database: { connectionAttempts: 1, readOnlyTransactionAttempts: 1, readOnlyTransactions: 1, applicationSelects: 1, transactionReadOnly: true, identityDigest: "sha256:db", candidateBucket: "one", candidateCount: 1, disconnected: true },
    payuni: { officialSandbox: true, queryAttempts: 1, retries: 0, redirects: 0, normalizedStatus: "refunded", referenceMatched: true, orderMatched: true, amountMatched: true },
    reconciliation: { classification: "PROVIDER_AHEAD_MISSING_CALLBACK_CANDIDATE", providerAhead: false },
  };
  receipt.scoreImpact.eligible = true;
  receipt.authorizationDecision = "AUTHORIZE_CAT04_UPLIFT";
  return receipt;
}

test("WP-196 contract is bound to the exact Preview deployment and has no follow-up package", () => {
  assert.equal(CONTRACT.project, "celebrate-deal-staging");
  assert.equal(CONTRACT.expectedDeployment, "dpl_9KrvwFKkGKAVEzVZdm5Tc9iiQqCg");
  assert.equal(initialReceipt().attemptDisposition, "FINAL_ATTEMPT_CONSUMED_NO_RERUN");
  assert.equal(initialReceipt().followUpWorkPackage, "NONE");
});

test("freshness accepts only exact READY Preview metadata", () => {
  const accepted = parseFreshness(JSON.stringify({ name: "celebrate-deal-staging", id: CONTRACT.expectedDeployment, target: "preview", status: "READY" }), 0);
  assert.equal(accepted.ok, true);
  const old = parseFreshness(JSON.stringify({ name: "celebrate-deal-staging", id: "dpl_old", target: "preview", status: "READY" }), 0);
  assert.equal(old.ok, false);
  const production = parseFreshness(JSON.stringify({ name: "celebrate-deal-staging", id: CONTRACT.expectedDeployment, target: "production", status: "READY" }), 0);
  assert.equal(production.ok, false);
});

test("default receipt is a strict no-score terminal authorization", () => {
  const receipt = initialReceipt();
  assert.equal(successEligible(receipt), false);
  assert.equal(validateReceipt(receipt).ok, true);
  assert.equal(receipt.scoreImpact.CAT04.applied, false);
});

test("complete read-only chain is eligible for CAT04 uplift", () => {
  const receipt = eligibleReceipt();
  assert.equal(successEligible(receipt), true);
  assert.equal(validateReceipt(receipt).ok, true);
});

test("provider query cannot be accepted before an exactly-one candidate", () => {
  const receipt = eligibleReceipt();
  receipt.primaryOutcome.database.candidateBucket = "zero";
  receipt.primaryOutcome.database.candidateCount = 0;
  receipt.primaryOutcome.payuni.queryAttempts = 1;
  receipt.scoreImpact.eligible = false;
  receipt.authorizationDecision = "FINAL_NO_SCORE_AUTHORIZATION";
  assert.equal(validateReceipt(receipt).ok, false);
  assert.ok(validateReceipt(receipt).errors.includes("PROVIDER_BEFORE_CANDIDATE"));
});

test("receipt rejects persisted endpoint or raw identifier material", () => {
  const receipt = eligibleReceipt();
  receipt.safety.urlsPersisted = true;
  assert.equal(validateReceipt(receipt).ok, false);
  assert.ok(validateReceipt(receipt).errors.includes("SENSITIVE_PERSISTENCE"));
});
