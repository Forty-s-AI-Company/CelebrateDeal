import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { evaluateScenario, loadJson, runFixtureSet, validateContract } from "./wp123-observability-rehearsal.mjs";

const contract = loadJson(fs.readFileSync(new URL("../docs/launch/wp123-observability-rehearsal-contract.json", import.meta.url), "utf8"), "contract");
const fixtures = loadJson(fs.readFileSync(new URL("./wp123-observability-rehearsal-fixtures.json", import.meta.url), "utf8"), "fixtures");

test("WP-116 traceable contract is valid and fixture set passes", () => {
  assert.equal(validateContract(contract), true);
  const receipt = runFixtureSet(contract, fixtures);
  assert.equal(receipt.status, "PASS");
  assert.equal(receipt.localIncidentRehearsal, "PASS");
  assert.equal(receipt.externalTelemetry, "PENDING");
});

test("healthy flow produces no incident", () => {
  const result = evaluateScenario(fixtures.scenarios.find((scenario) => scenario.id === "healthy_flow"), contract);
  assert.equal(result.incidents.length, 0);
  assert.equal(result.transitions[0].transition, "healthy");
});

test("mismatch detects one correlated high incident", () => {
  const result = evaluateScenario(fixtures.scenarios.find((scenario) => scenario.id === "reconciliation_mismatch"), contract);
  assert.equal(result.incidents.length, 1);
  assert.equal(result.incidents[0].incidentCode, "payment_reconciliation_mismatch");
  assert.equal(result.incidents[0].severity, "high");
  assert.equal(result.incidents[0].detected, 1);
});

test("correlation identity is stable across the same event timeline", () => {
  const first = evaluateScenario(fixtures.scenarios.find((scenario) => scenario.id === "reconciliation_mismatch"), contract);
  const second = evaluateScenario(fixtures.scenarios.find((scenario) => scenario.id === "reconciliation_mismatch"), contract);
  assert.equal(first.incidents[0].correlationId, second.incidents[0].correlationId);
});

test("duplicate delivery is suppressed without a second incident", () => {
  const result = evaluateScenario(fixtures.scenarios.find((scenario) => scenario.id === "duplicate_delivery"), contract);
  assert.equal(result.incidents.length, 1);
  assert.equal(result.incidents[0].detected, 1);
  assert.equal(result.transitions[1].transition, "suppressed_duplicate");
});

test("matching recovery closes while unrelated recovery is rejected", () => {
  const matched = evaluateScenario(fixtures.scenarios.find((scenario) => scenario.id === "matched_recovery"), contract);
  const unmatched = evaluateScenario(fixtures.scenarios.find((scenario) => scenario.id === "unmatched_recovery"), contract);
  assert.equal(matched.incidents[0].status, "recovered");
  assert.equal(unmatched.incidents[0].status, "detected");
  assert.ok(unmatched.transitions.some((transition) => transition.transition === "recovery_rejected"));
});

test("out-of-order timestamps are processed deterministically", () => {
  const result = evaluateScenario(fixtures.scenarios.find((scenario) => scenario.id === "out_of_order_timeline"), contract);
  assert.equal(result.incidents[0].status, "recovered");
  assert.equal(result.transitions[0].transition, "detected");
});

for (const id of ["missing_required_field", "invalid_event_status", "unknown_event_type"]) {
  test(`${id} fails closed`, () => {
    const result = evaluateScenario(fixtures.scenarios.find((scenario) => scenario.id === id), contract);
    assert.equal(result.status, "BLOCKED_OR_FAILED");
    assert.equal(result.externalTelemetry, "PENDING");
  });
}

test("missing correlation inputs and unknown action fail closed", () => {
  const missingTimestamp = { id: "missing-correlation", timeline: [{ action: "observe", evidenceId: "evidence-missing", event: { event: "payment_webhook_failure_v1", method: "POST", path: "/api/webhooks/payments", source: "notify", status: 500, code: "processing_failed" } }] };
  const unknownAction = { id: "unknown-action", timeline: [{ action: "page", evidenceId: "evidence-action", timestamp: "2026-08-02T15:22:00.000Z" }] };
  assert.equal(evaluateScenario(missingTimestamp, contract).status, "BLOCKED_OR_FAILED");
  assert.equal(evaluateScenario(unknownAction, contract).status, "BLOCKED_OR_FAILED");
});

test("sensitive-like extra payload is rejected and never returned", () => {
  const scenario = JSON.parse(JSON.stringify(fixtures.scenarios[1]));
  scenario.timeline[0].event.body = "synthetic-sensitive-marker";
  const result = evaluateScenario(scenario, contract);
  assert.equal(result.status, "BLOCKED_OR_FAILED");
  assert.doesNotMatch(JSON.stringify(result), /synthetic-sensitive-marker/);
});

test("normalized receipts are stable across identical runs", () => {
  const scenario = fixtures.scenarios.find((item) => item.id === "duplicate_delivery");
  assert.deepEqual(evaluateScenario(scenario, contract), evaluateScenario(scenario, contract));
});

test("receipt keeps external and production boundaries explicit", () => {
  const receipt = runFixtureSet(contract, fixtures);
  assert.equal(receipt.externalTelemetry, "PENDING");
  assert.equal(receipt.SANDBOX_READY, false);
  assert.equal(receipt.PRODUCTION_READY, false);
  assert.equal(receipt.rawEventPayloadSaved, false);
  assert.equal(receipt.sensitiveValuesSaved, false);
});

test("fabricated external telemetry or readiness cannot pass contract", () => {
  const mutated = JSON.parse(JSON.stringify(contract));
  mutated.receiptPolicy.externalTelemetry = "PASS";
  assert.throws(() => validateContract(mutated), /Readiness boundary/);
  mutated.receiptPolicy.externalTelemetry = "PENDING";
  mutated.receiptPolicy.PRODUCTION_READY = true;
  assert.throws(() => validateContract(mutated), /Readiness boundary/);
});
