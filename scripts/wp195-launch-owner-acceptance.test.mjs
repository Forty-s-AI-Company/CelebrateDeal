import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { baselinePacket, evaluatePacket, runDryRun, validateContract, validateReceipt } from "./wp195-launch-owner-acceptance.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(await fsp.readFile(path.join(ROOT, "docs", "launch", "wp195-launch-owner-acceptance-contract.json"), "utf8"));
const fixtures = JSON.parse(await fsp.readFile(path.join(ROOT, "scripts", "wp195-launch-owner-acceptance-fixtures.json"), "utf8"));

test("contract defines five responsibility roles without requiring five humans", () => {
  assert.deepEqual(validateContract(contract), { ok: true, errors: [] });
  assert.equal(contract.owners.length, 5);
  assert.equal(contract.ownerModel.sameHumanMultipleRoles, true);
  assert.equal(contract.ownerModel.distinctHumanRequired, false);
  assert.equal(contract.owners.every((owner) => owner.responsibilities.length >= 3 && owner.requiredChecks.length >= 3), true);
});

test("complete synthetic packet still holds release for manual signatures", () => {
  const result = evaluatePacket(contract, baselinePacket(contract, fixtures.fixedTimestamp));
  assert.equal(result.inputRejected, false);
  assert.deepEqual(result.blockers, []);
  const receipt = runDryRun(contract, fixtures);
  assert.equal(receipt.aggregation.manualSignatures, "PENDING");
  assert.equal(receipt.aggregation.releaseStatus, "HOLD_NOT_READY");
  assert.equal(receipt.aggregation.productionReady, false);
});

test("all positive and fail-closed scenarios produce the expected deterministic outcome", () => {
  const first = runDryRun(contract, fixtures);
  const second = runDryRun(contract, fixtures);
  assert.deepEqual(first, second);
  assert.equal(first.scenarios.length, 14);
  assert.equal(first.scenarios.every((scenario) => scenario.pass), true);
});

test("the same holder may own every responsibility role", () => {
  const packet = baselinePacket(contract, fixtures.fixedTimestamp);
  assert.equal(new Set(packet.map((item) => item.holderRef)).size, 1);
  assert.equal(evaluatePacket(contract, packet).blockers.length, 0);
});

test("missing evidence and non-accepted owners become explicit blockers", () => {
  const missing = baselinePacket(contract, fixtures.fixedTimestamp);
  missing[0].evidence = [];
  assert.equal(evaluatePacket(contract, missing).blockers.some((item) => item.startsWith("EVIDENCE_MISSING:")), true);
  const blocked = baselinePacket(contract, fixtures.fixedTimestamp);
  blocked[0].decision = "BLOCKED";
  assert.equal(evaluatePacket(contract, blocked).blockers.some((item) => item.startsWith("OWNER_BLOCKED:")), true);
});

test("production claims and sensitive fixture text are rejected", () => {
  const production = baselinePacket(contract, fixtures.fixedTimestamp);
  production.productionReady = true;
  assert.deepEqual(evaluatePacket(contract, production), { inputRejected: true, blockers: ["PRODUCTION_READY_CLAIM_REJECTED"] });
  const sensitive = baselinePacket(contract, fixtures.fixedTimestamp);
  sensitive[0].evidence[0].sourceRef = "secret:unsafe";
  assert.equal(evaluatePacket(contract, sensitive).inputRejected, true);
});

test("unknown release decision and missing holder reference fail closed", () => {
  const unknownDecision = baselinePacket(contract, fixtures.fixedTimestamp);
  unknownDecision.find((item) => item.ownerId === "release_owner").releaseDecision = "UNKNOWN";
  assert.equal(evaluatePacket(contract, unknownDecision).blockers.includes("RELEASE_DECISION_INVALID"), true);

  const missingHolder = baselinePacket(contract, fixtures.fixedTimestamp);
  const merchant = missingHolder.find((item) => item.ownerId === "merchant_owner");
  delete merchant.holderRef;
  assert.equal(evaluatePacket(contract, missingHolder).blockers.includes("HOLDER_REF_INVALID:merchant_owner"), true);
});

test("complete receipt is sanitized, side-effect free and score remains unapplied", () => {
  const receipt = runDryRun(contract, fixtures);
  assert.deepEqual(validateReceipt(receipt), { ok: true, errors: [] });
  assert.equal(Object.values(receipt.sideEffects).every((value) => value === 0), true);
  assert.equal(Object.values(receipt.safety).every((value) => value === false), true);
  assert.equal(receipt.scoreImpact.applied, false);
});

test("runner source contains no external execution primitive", async () => {
  const source = await fsp.readFile(path.join(ROOT, "scripts", "wp195-launch-owner-acceptance.mjs"), "utf8");
  assert.equal(/\bfetch\s*\(|node:(?:http|https|net|tls|child_process)|spawn\s*\(|exec\s*\(/u.test(source), false);
});
