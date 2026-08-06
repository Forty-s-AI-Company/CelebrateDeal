import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildBrokerArgs, createPrimaryOutcome, initialReceipt, parseBrokerOutput, parseFreshnessJson, successEligible, validateReceipt } from "./wp174-fresh-preview-payuni-readonly-reconciliation-runner.mjs";

function successfulReceipt(status = "WP174_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED") {
  const receipt = initialReceipt();
  receipt.terminalStatus = status;
  receipt.freshness = { ...receipt.freshness, projectMatched: true, deploymentMatched: true, preview: true, ready: true, noRedirect: true, healthStatus: 200 };
  receipt.temp = { ...receipt.temp, outsideWorkspace: true, canonicalPathMatched: true, symbolicLink: false, envPathCount: 0, cleanupPass: true };
  receipt.broker = { ...receipt.broker, attempts: 1, retries: 0, childResultCount: 1, childValid: true };
  receipt.primaryOutcome = {
    observed: true, status, failure: null,
    database: { connectionAttempts: 1, readOnlyTransactionAttempts: 1, readOnlyTransactions: 1, applicationSelects: 1, transactionReadOnly: true, identityDigest: "sha256:db", candidateBucket: "one", candidateCount: 1, disconnected: true },
    payuni: { officialSandbox: true, queryAttempts: 1, retries: 0, redirects: 0, normalizedStatus: "refunded", referenceMatched: true, orderMatched: true, amountMatched: true },
    reconciliation: { classification: status.endsWith("DIVERGENCE_DETECTED") ? "PROVIDER_AHEAD_MISSING_CALLBACK_CANDIDATE" : "CONSISTENT", providerAhead: status.endsWith("DIVERGENCE_DETECTED") },
  };
  receipt.scoreImpact.eligible = true;
  return receipt;
}

test("freshness accepts only the exact new Ready Preview deployment", () => {
  const good = JSON.stringify({ id: "dpl_9KrvwFKkGKAVEzVZdm5Tc9iiQqCg", name: "celebrate-deal-staging", target: "preview", status: "READY" });
  assert.equal(parseFreshnessJson(good, 0).ok, true);
  for (const changed of [
    { id: "dpl_old", name: "celebrate-deal-staging", target: "preview", status: "READY" },
    { id: "dpl_9KrvwFKkGKAVEzVZdm5Tc9iiQqCg", name: "wrong", target: "preview", status: "READY" },
    { id: "dpl_9KrvwFKkGKAVEzVZdm5Tc9iiQqCg", name: "celebrate-deal-staging", target: "production", status: "READY" },
    { id: "dpl_9KrvwFKkGKAVEzVZdm5Tc9iiQqCg", name: "celebrate-deal-staging", target: "preview", status: "BUILDING" },
  ]) assert.equal(parseFreshnessJson(JSON.stringify(changed), 0).ok, false);
  assert.equal(parseFreshnessJson("not-json", 0).ok, false);
});

test("maps every child status without inventing success", () => {
  assert.equal(createPrimaryOutcome({ status: "WP170_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED" }).status, "WP174_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED");
  assert.equal(createPrimaryOutcome({ status: "WP170_CANDIDATE_EXACT_NO_GO_ZERO" }).status, "WP174_CANDIDATE_EXACT_NO_GO_ZERO");
  assert.equal(createPrimaryOutcome({ status: "UNKNOWN" }).status, "WP174_BROKER_EXACT_NO_GO");
});

test("broker argv is absolute, Preview-only, and points at the protected live child", () => {
  const absolute = ["node.exe", "tsx.mjs", "tsconfig.json", "wp170.mjs", "temp"].map((name) => path.resolve("C:/wp174", name));
  const args = buildBrokerArgs(...absolute);
  assert.deepEqual(args.slice(0, 7), ["env", "run", "-e", "preview", "--project", "celebrate-deal-staging", "--"]);
  assert.equal(args.at(-1), "preview");
  assert.equal(args.at(-3), "--live-child");
  assert.throws(() => buildBrokerArgs("node", ...absolute.slice(1)), /ABSOLUTE_PATH_REQUIRED/u);
});

test("broker accepts exactly one sanitized child and rejects duplicate, autoload or assignment output", () => {
  const childReceipt = {
    status: "WP170_CANDIDATE_EXACT_NO_GO_ZERO",
    database: { connectionAttempts: 1, readOnlyTransactionAttempts: 1, applicationSelects: 1, retries: 0, candidateBucket: "zero" },
    payuni: { queryAttempts: 0, retries: 0, redirects: 0 },
    sideEffects: { databaseWrites: 0, providerWrites: 0 },
    safety: { rawDatabaseRowsPersisted: false, rawProviderResponsePersisted: false },
  };
  const line = `WP170_CHILD_RESULT:${JSON.stringify({ schema: "wp170-child/v1", cwdMatched: true, receipt: childReceipt })}`;
  assert.equal(parseBrokerOutput(line, "", 2).ok, true);
  assert.equal(parseBrokerOutput(`${line}\n${line}`, "", 2).ok, false);
  assert.equal(parseBrokerOutput(`${line}\nLoaded env from .env.local`, "", 2).ok, false);
  assert.equal(parseBrokerOutput(`${line}\nPAYUNI_ENV=x`, "", 2).ok, false);
  assert.equal(parseBrokerOutput("malformed", "", 2).ok, false);
});

test("divergence and consistent outcomes require the full read-only provider predicate", () => {
  const divergent = successfulReceipt();
  assert.equal(successEligible(divergent), true);
  assert.equal(validateReceipt(divergent).ok, true);
  const consistent = successfulReceipt("WP174_READ_ONLY_RECONCILIATION_CONSISTENT");
  assert.equal(successEligible(consistent), true);
  assert.equal(validateReceipt(consistent).ok, true);
});

test("candidate failures cannot query PayUni or become score eligible", () => {
  for (const bucket of ["zero", "ambiguous", "invalid_state", "unsafe_reference", "invalid_amount"]) {
    const receipt = successfulReceipt();
    receipt.terminalStatus = bucket === "zero" ? "WP174_CANDIDATE_EXACT_NO_GO_ZERO" : bucket === "ambiguous" ? "WP174_CANDIDATE_EXACT_NO_GO_AMBIGUOUS" : "WP174_CANDIDATE_EXACT_NO_GO_INVALID";
    receipt.primaryOutcome.status = receipt.terminalStatus;
    receipt.primaryOutcome.database.candidateBucket = bucket;
    receipt.primaryOutcome.database.candidateCount = bucket === "zero" ? 0 : 2;
    receipt.primaryOutcome.payuni.queryAttempts = 0;
    receipt.scoreImpact.eligible = false;
    assert.equal(successEligible(receipt), false);
    assert.equal(validateReceipt(receipt).ok, true);
    receipt.primaryOutcome.payuni.queryAttempts = 1;
    assert.equal(validateReceipt(receipt).ok, false);
  }
});

test("mismatch, retry, redirect, write, production and over-budget attempts fail closed", () => {
  const mutations = [
    (r) => { r.primaryOutcome.payuni.referenceMatched = false; },
    (r) => { r.primaryOutcome.payuni.orderMatched = false; },
    (r) => { r.primaryOutcome.payuni.amountMatched = false; },
    (r) => { r.primaryOutcome.payuni.retries = 1; },
    (r) => { r.primaryOutcome.payuni.redirects = 1; },
    (r) => { r.sideEffects.databaseWrites = 1; },
    (r) => { r.sideEffects.production = 1; },
    (r) => { r.primaryOutcome.database.applicationSelects = 2; },
  ];
  for (const mutate of mutations) {
    const receipt = successfulReceipt();
    mutate(receipt);
    assert.equal(validateReceipt(receipt).ok, false);
  }
});

test("cleanup no-go preserves primary evidence but disables scoring", () => {
  const receipt = successfulReceipt();
  receipt.terminalStatus = "WP174_CLEANUP_EXACT_NO_GO";
  receipt.temp.cleanupPass = false;
  receipt.scoreImpact.eligible = false;
  assert.equal(receipt.primaryOutcome.database.applicationSelects, 1);
  assert.equal(receipt.primaryOutcome.payuni.queryAttempts, 1);
  assert.equal(validateReceipt(receipt).ok, true);
});

test("receipt rejects sensitive persistence and readiness overclaim", () => {
  const receipt = successfulReceipt();
  receipt.safety.rawIdentifiersPersisted = true;
  assert.equal(validateReceipt(receipt).ok, false);
  const ready = successfulReceipt();
  ready.gateImpact.PRODUCTION_READY = true;
  assert.equal(validateReceipt(ready).ok, false);
});
