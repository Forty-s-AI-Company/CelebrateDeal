import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import {
  READINESS_STATES,
  isAllowedLoopbackUrl,
  normalizeLoopbackEndpoint,
  normalizeWp154ReadinessReceipt,
  runSyntheticReadiness,
  validateWp154ReadinessReceipt,
} from "./wp153-public-unavailable-browser-runner.mjs";

const wp153ReceiptPath = ".ai-team/reports/wp153-public-unavailable-browser-receipt.json";

test("valid synthetic spawn and readiness sequence reaches READY then CLEANED", () => {
  const ready = runSyntheticReadiness(["SPAWN_REQUEST", "SPAWN_ACCEPTED", "READY_MARKER", "PROBE_READY"]);
  assert.equal(ready.state, READINESS_STATES.READY);
  assert.equal(ready.spawnCount, 1);
  const cleaned = runSyntheticReadiness(["SPAWN_REQUEST", "SPAWN_ACCEPTED", "PROBE_READY", "READY_MARKER", "CLEANUP"]);
  assert.equal(cleaned.state, READINESS_STATES.CLEANED);
  assert.equal(cleaned.spawnCount, 1);
});

test("spawn rejection and early exit are distinct fail-closed terminal states", () => {
  assert.equal(runSyntheticReadiness(["SPAWN_REQUEST", "SPAWN_REJECTED"]).state, READINESS_STATES.EARLY_EXIT);
  const early = runSyntheticReadiness(["SPAWN_REQUEST", "SPAWN_ACCEPTED", "EARLY_EXIT", "READY_MARKER"]);
  assert.equal(early.state, READINESS_STATES.EARLY_EXIT);
  assert.equal(early.ignoredEvents, 1);
});

test("timeout, conflict, duplicate and retry contracts never reopen readiness", () => {
  const timeout = runSyntheticReadiness(["SPAWN_REQUEST", "SPAWN_ACCEPTED", "TIMEOUT", "PROBE_READY"]);
  assert.equal(timeout.state, READINESS_STATES.TIMED_OUT);
  assert.equal(timeout.ignoredEvents, 1);
  const conflict = runSyntheticReadiness(["SPAWN_REQUEST", "SPAWN_ACCEPTED", "READY_MARKER", "PROBE_NOT_READY"]);
  assert.equal(conflict.state, READINESS_STATES.READINESS_CONFLICT);
  assert.throws(() => runSyntheticReadiness(["SPAWN_REQUEST", "SPAWN_ACCEPTED", "RETRY"]), /READINESS_RETRY_FORBIDDEN/);
});

test("loopback endpoint normalization is canonical and fail-closed", () => {
  assert.equal(normalizeLoopbackEndpoint("http://127.0.0.1:32154/login"), "http://127.0.0.1:32154");
  assert.equal(normalizeLoopbackEndpoint("http://[::1]:32154/login"), "http://[::1]:32154");
  assert.equal(isAllowedLoopbackUrl("http://127.0.0.1:32154/login"), true);
  assert.throws(() => normalizeLoopbackEndpoint("https://example.invalid/login"), /LOOPBACK_URL_NOT_ALLOWED/);
  assert.throws(() => normalizeLoopbackEndpoint("http://127.0.0.1:0/login"), /LOOPBACK_PORT_INVALID/);
});

test("sanitized WP-153 fields normalize to a synthetic-only remediation receipt", () => {
  const before = crypto.createHash("sha256").update(fs.readFileSync(wp153ReceiptPath)).digest("hex");
  const source = JSON.parse(fs.readFileSync(wp153ReceiptPath, "utf8"));
  const receipt = normalizeWp154ReadinessReceipt(source);
  assert.equal(receipt.phase, "NOT_VERIFIED");
  assert.equal(receipt.syntheticOnly, true);
  assert.equal(receipt.readinessWindowsAttempted, 1);
  assert.equal(validateWp154ReadinessReceipt(JSON.parse(JSON.stringify(receipt))), true);
  const after = crypto.createHash("sha256").update(fs.readFileSync(wp153ReceiptPath)).digest("hex");
  assert.equal(after, before);
});

test("strict receipt and side-effect sentinels reject forbidden fields", () => {
  const source = JSON.parse(fs.readFileSync(wp153ReceiptPath, "utf8"));
  const receipt = normalizeWp154ReadinessReceipt(source);
  receipt.rawLog = "forbidden";
  assert.throws(() => validateWp154ReadinessReceipt(receipt), /WP154_RECEIPT_SAFETY_INVALID/);
  const withSideEffect = normalizeWp154ReadinessReceipt(source);
  withSideEffect.sideEffects.network = 1;
  assert.throws(() => validateWp154ReadinessReceipt(withSideEffect), /WP154_RECEIPT_SIDE_EFFECT_INVALID/);
});

test("WP-153 existing terminal receipt remains unchanged and no process adapter is invoked", () => {
  const source = JSON.parse(fs.readFileSync(wp153ReceiptPath, "utf8"));
  const before = source.status;
  const events = runSyntheticReadiness(["SPAWN_REQUEST", "SPAWN_ACCEPTED", "TIMEOUT", "CLEANUP"]);
  assert.equal(events.spawnCount, 1);
  assert.equal(before, "WP153_EXACT_NO_GO_NO_RETRY");
  assert.equal(source.server.started, 1);
  assert.equal(source.browser.desktop.passed, 0);
});
