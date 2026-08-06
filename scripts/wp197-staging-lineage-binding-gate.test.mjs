import test from "node:test";
import assert from "node:assert/strict";
import { CONTRACT, initialReceipt, parseInspect, validateReceipt } from "./wp197-staging-lineage-binding-gate.mjs";

test("contract is value-free and fixed to the prior lineage", () => {
  assert.equal(CONTRACT.project, "celebrate-deal-staging");
  assert.equal(initialReceipt().followUpWorkPackage, "NONE");
  assert.equal(initialReceipt().scoreImpact.CAT04.applied, false);
});

test("inspect parser accepts only exact Preview READY non-Production", () => {
  const accepted = parseInspect(JSON.stringify({ name: CONTRACT.project, id: CONTRACT.expectedDeployment, target: "preview", status: "READY", production: false }), 0);
  assert.equal(accepted.ok, true);
  const drift = parseInspect(JSON.stringify({ name: CONTRACT.project, id: "dpl_new", target: "preview", status: "READY", production: false }), 0);
  assert.equal(drift.ok, true);
  assert.equal(drift.lineageMatch, false);
  const prod = parseInspect(JSON.stringify({ name: CONTRACT.project, id: CONTRACT.expectedDeployment, target: "production", status: "READY", production: true }), 0);
  assert.equal(prod.ok, false);
});

test("freshness or lineage drift is fail closed before binding/probe", () => {
  const receipt = initialReceipt();
  receipt.result = "TERMINAL_NO_GO_LINEAGE_DRIFT";
  receipt.inspectUsed = true;
  receipt.attemptBudget.inspect = 1;
  receipt.lineageMatch = false;
  receipt.brokerCleanupSucceeded = true;
  receipt.deploymentDigest = "sha256:opaque";
  assert.equal(validateReceipt(receipt).ok, true);
});

test("parent contamination cannot open inspect or probe", () => {
  const receipt = initialReceipt();
  receipt.result = "TERMINAL_NO_GO_CONTAMINATION";
  receipt.parentTargetContaminated = true;
  receipt.brokerCleanupSucceeded = true;
  assert.equal(validateReceipt(receipt).ok, true);
  receipt.inspectUsed = true;
  assert.equal(validateReceipt(receipt).ok, false);
});

test("receipt rejects raw identifiers, URLs and sensitive persistence", () => {
  const receipt = initialReceipt();
  receipt.result = "TERMINAL_NO_GO_FRESHNESS";
  receipt.brokerCleanupSucceeded = true;
  receipt.safety.urlPersisted = true;
  assert.equal(validateReceipt(receipt).ok, false);
  const withRaw = initialReceipt();
  withRaw.result = "TERMINAL_NO_GO_FRESHNESS";
  withRaw.brokerCleanupSucceeded = true;
  withRaw.deploymentDigest = "https://example.invalid";
  assert.equal(validateReceipt(withRaw).ok, false);
});
