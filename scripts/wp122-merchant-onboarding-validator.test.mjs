import assert from "node:assert/strict";
import test from "node:test";

import { buildReceipt, expectedStageIds, loadJson, validateOnboardingContract } from "./wp122-merchant-onboarding-validator.mjs";

const contract = loadJson(await import("node:fs").then(({ readFileSync }) => readFileSync(new URL("../docs/launch/wp122-merchant-onboarding-contract.json", import.meta.url), "utf8")), "contract");
const fixture = loadJson(await import("node:fs").then(({ readFileSync }) => readFileSync(new URL("./wp122-merchant-onboarding-fixture.json", import.meta.url), "utf8")), "fixture");

function copy() { return JSON.parse(JSON.stringify(fixture)); }

test("complete eight-stage local contract passes while external readiness stays pending", () => {
  const result = validateOnboardingContract(contract, fixture);
  assert.equal(result.status, "PASS");
  assert.equal(result.stageCount, 8);
  assert.equal(result.overallReadiness, "NOT_READY");
  assert.equal(buildReceipt(result).labels.PRODUCTION_READY, false);
});

for (const [name, mutate] of [
  ["missing stage", (value) => { value.stages.pop(); }],
  ["missing owner", (value) => { value.stages[0].ownerRoles = []; }],
  ["missing evidence", (value) => { value.stages[0].requiredEvidence = []; }],
  ["missing rollback", (value) => { value.stages[0].rollback = ""; }],
  ["missing escalation", (value) => { value.stages[0].escalation = ""; }],
  ["unresolved placeholder", (value) => { value.stages[0].purpose = "TODO: assign owner"; }],
  ["unknown status", (value) => { value.stages[0].requiredEvidence[0].status = "UNKNOWN"; }],
]) {
  test(`fails closed for ${name}`, () => {
    const mutated = JSON.parse(JSON.stringify(contract));
    mutate(mutated);
    assert.throws(() => validateOnboardingContract(mutated, fixture));
  });
}

for (const key of ["manualRehearsal", "legalApproval", "supportReadiness"]) {
  test(`keeps overall readiness blocked when ${key} is not pending`, () => {
    const mutated = copy();
    mutated[key] = "PASS";
    assert.throws(() => validateOnboardingContract(contract, mutated));
  });
}

test("rejects fabricated readiness labels", () => {
  const mutated = copy();
  mutated.PRODUCTION_READY = true;
  assert.throws(() => validateOnboardingContract(contract, mutated));
});

test("rejects sensitive and placeholder-like values", () => {
  const mutated = copy();
  mutated.evidenceRefs = ["synthetic_reference", "Bearer fake"];
  assert.throws(() => validateOnboardingContract(contract, mutated));
});

test("normalized result is deterministic and covers every expected stage", () => {
  const first = validateOnboardingContract(contract, fixture);
  const second = validateOnboardingContract(contract, fixture);
  assert.deepEqual(first.normalized, second.normalized);
  assert.deepEqual(first.normalized.stageIds, expectedStageIds);
  assert.equal(first.normalizedHash, second.normalizedHash);
});
