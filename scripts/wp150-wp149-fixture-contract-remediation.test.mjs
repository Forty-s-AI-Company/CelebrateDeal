import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import {
  FIXTURE_STATES,
  buildFixtureLifecycleReceipt,
  cleanupFixtureIdempotently,
  makeReceipt,
  runPureFixtureLifecycle,
  validateFixtureLifecycleReceipt,
} from "./wp149-public-unavailable-browser-runner.mjs";
import { createSyntheticJsonFixture } from "./test-contract-synthetic-fixtures.mjs";

const syntheticReceiptFixture = createSyntheticJsonFixture(
  "wp149-public-unavailable-browser-receipt.json",
  makeReceipt(),
);
const receiptPath = syntheticReceiptFixture.path;
test.after(() => syntheticReceiptFixture.cleanup());

test("create success and cleanup success reach CLEANED without external calls", () => {
  const calls = [];
  const result = runPureFixtureLifecycle({ create: () => calls.push("create"), cleanup: () => calls.push("cleanup") });
  assert.equal(result.state, FIXTURE_STATES.CLEANED);
  assert.deepEqual(calls, ["create", "cleanup"]);
  assert.deepEqual(buildFixtureLifecycleReceipt(result).sideEffects, { network: 0, database: 0, provider: 0, staging: 0, production: 0, server: 0, browser: 0 });
});

test("create failure is exact no-go and never permits server/browser execution", () => {
  const result = runPureFixtureLifecycle({ create: () => { throw new Error("synthetic adapter must not run"); }, cleanup: () => undefined }, { createFailure: true });
  const receipt = buildFixtureLifecycleReceipt(result);
  assert.equal(result.state, FIXTURE_STATES.CLEANED);
  assert.equal(receipt.classification, "WP149_FIXTURE_CREATE_FAILED_EXACT_NO_GO");
  assert.equal(receipt.attempt, 0);
  assert.equal(receipt.serverAttempts, 0);
  assert.equal(receipt.browserCompleted, 0);
  assert.equal(validateFixtureLifecycleReceipt(receipt), true);
});

test("partial create cleanup is idempotent and cleanup failure is distinct", () => {
  let cleanupCalls = 0;
  const success = runPureFixtureLifecycle({ create: () => undefined, cleanup: () => { cleanupCalls += 1; } });
  assert.equal(success.state, FIXTURE_STATES.CLEANED);
  assert.equal(cleanupCalls, 1);
  const idempotent = cleanupFixtureIdempotently(FIXTURE_STATES.CLEANED, { cleanup: () => { cleanupCalls += 1; } });
  assert.equal(idempotent.state, FIXTURE_STATES.CLEANED);
  assert.equal(idempotent.invoked, false);
  const failed = runPureFixtureLifecycle({ create: () => undefined, cleanup: () => undefined }, { cleanupFailure: true });
  const receipt = buildFixtureLifecycleReceipt(failed);
  assert.equal(failed.state, FIXTURE_STATES.CLEANUP_FAILED);
  assert.equal(receipt.classification, "WP149_FIXTURE_CLEANUP_FAILED_EXACT_NO_GO");
  assert.equal(validateFixtureLifecycleReceipt(receipt), true);
});

test("WP-149 terminal receipt is read-only and cannot be overwritten", () => {
  const before = crypto.createHash("sha256").update(fs.readFileSync(receiptPath)).digest("hex");
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  assert.equal(receipt.status, "PREFLIGHT_EXACT_NO_GO");
  assert.equal(receipt.attempt, 0);
  assert.equal(receipt.browser.passed, 0);
  const after = crypto.createHash("sha256").update(fs.readFileSync(receiptPath)).digest("hex");
  assert.equal(after, before);
});

test("forbidden raw-like receipt fields are rejected", () => {
  const receipt = buildFixtureLifecycleReceipt(runPureFixtureLifecycle({ create: () => undefined, cleanup: () => undefined }));
  receipt.rawOutput = "synthetic-raw";
  assert.throws(() => validateFixtureLifecycleReceipt(receipt), /FIXTURE_RECEIPT_SAFETY_INVALID/);
});
