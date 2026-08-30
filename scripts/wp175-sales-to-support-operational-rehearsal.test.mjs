import test from "node:test";
import assert from "node:assert/strict";
import { buildReceipt, evaluateScenario, loadInputs, validateContract, validateReceipt } from "./wp175-sales-to-support-operational-rehearsal.mjs";

test("contract contains eight owned operational stages and zero external side effects", () => {
  const { contract } = loadInputs();
  assert.deepEqual(validateContract(contract), []);
  assert.equal(contract.stages.length, 8);
  assert.equal(contract.boundaries.externalNetwork, false);
  assert.equal(contract.boundaries.databaseWrites, 0);
});

test("all positive sales-to-support scenarios reach the declared bounded decision", () => {
  const { contract, fixtures } = loadInputs();
  for (const scenario of fixtures.positive) {
    assert.equal(evaluateScenario(scenario, contract).decision, scenario.expected, scenario.id);
  }
});

test("all unsafe scenarios fail closed", () => {
  const { contract, fixtures } = loadInputs();
  for (const scenario of fixtures.negative) {
    assert.equal(evaluateScenario(scenario, contract).decision, "REJECTED", scenario.id);
  }
});

test("receipt is deterministic, sanitized, and cannot claim commercial readiness", () => {
  const { contract, fixtures } = loadInputs();
  const first = buildReceipt(contract, fixtures);
  const second = buildReceipt(contract, fixtures);
  assert.deepEqual(first, second);
  assert.deepEqual(validateReceipt(first), []);
  assert.equal(first.localOperationalRehearsal, "PASS");
  assert.equal(first.readiness.overallCommercialReadiness, "NOT_READY");
  assert.equal(first.readiness.PRODUCTION_READY, false);
  assert.deepEqual(new Set(first.scenarioResults.map((item) => Object.keys(item)).flat()), new Set(["id", "decision", "nextOwner"]));
});
