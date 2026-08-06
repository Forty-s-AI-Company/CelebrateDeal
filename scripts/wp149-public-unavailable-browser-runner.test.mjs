import assert from "node:assert/strict";
import test from "node:test";

import { classifyServerOutput, fixtureScript, makeReceipt, validateWp149Receipt } from "./wp149-public-unavailable-browser-runner.mjs";

test("server output classifier never returns raw output", () => {
  assert.equal(classifyServerOutput("Error: failed to compile"), "SOURCE_OR_COMPILE_BOUNDARY");
  assert.equal(classifyServerOutput("Error: Cannot find module"), "MODULE_RESOLUTION");
  assert.equal(classifyServerOutput("listen EADDRINUSE"), "PORT_IN_USE");
  assert.equal(classifyServerOutput("ready - started server"), null);
});

test("preflight receipt is sanitized and fail-closed", () => {
  const receipt = makeReceipt();
  assert.equal(validateWp149Receipt(receipt), true);
  assert.equal(receipt.status, "PREFLIGHT_EXACT_NO_GO");
  assert.equal(receipt.attempt, 0);
  assert.equal(receipt.rawOutputPersisted, false);
  assert.equal(receipt.rawOutputExposed, false);
  assert.equal(receipt.sourceEnvContentsRead, false);
});

test("receipt rejects retries and unsafe side effects", () => {
  const receipt = makeReceipt();
  receipt.browser.retries = 1;
  assert.throws(() => validateWp149Receipt(receipt), /RECEIPT_RETRY_POLICY_INVALID/);
  receipt.browser.retries = 0;
  receipt.sideEffects.network = 1;
  assert.throws(() => validateWp149Receipt(receipt), /RECEIPT_SIDE_EFFECTS_INVALID/);
});

test("pass receipt requires exactly two browser cases", () => {
  const receipt = makeReceipt();
  receipt.status = "PASS";
  receipt.attempt = 1;
  receipt.browser.passed = 2;
  receipt.sideEffects.browser = 2;
  assert.equal(validateWp149Receipt(receipt), true);
});

test("fixture script binds vendorId after create instead of before create", () => {
  const createScript = fixtureScript(false);
  assert.match(createScript, /const vendorId = vendor\.id;/);
  assert.doesNotMatch(createScript, /const vendorId = \(await db\.vendor\.findUnique/);
  const cleanupScript = fixtureScript(true);
  assert.match(cleanupScript, /const vendorId = \(await db\.vendor\.findUnique/);
});

test("pure fixture lifecycle covers success, create failure, cleanup failure and idempotent cleanup", async () => {
  const {
    FIXTURE_STATES,
    buildFixtureLifecycleReceipt,
    cleanupFixtureIdempotently,
    fixtureTransition,
    runPureFixtureLifecycle,
    validateFixtureLifecycleReceipt,
  } = await import("./wp149-public-unavailable-browser-runner.mjs");
  const calls = [];
  const adapter = { create: () => calls.push("create"), cleanup: () => calls.push("cleanup") };

  const success = runPureFixtureLifecycle(adapter);
  assert.equal(success.state, FIXTURE_STATES.CLEANED);
  assert.deepEqual(calls, ["create", "cleanup"]);
  assert.equal(validateFixtureLifecycleReceipt(buildFixtureLifecycleReceipt(success)), true);

  const createFailure = runPureFixtureLifecycle(adapter, { createFailure: true });
  assert.equal(createFailure.createFailed, true);
  assert.match(buildFixtureLifecycleReceipt(createFailure).classification, /CREATE_FAILED/);

  const cleanupFailure = runPureFixtureLifecycle(adapter, { cleanupFailure: true });
  assert.equal(cleanupFailure.cleanupFailed, true);
  assert.match(buildFixtureLifecycleReceipt(cleanupFailure).classification, /CLEANUP_FAILED/);
  assert.throws(() => fixtureTransition(FIXTURE_STATES.UNINITIALIZED, "READY"), /ILLEGAL_FIXTURE_TRANSITION/);

  const alreadyClean = cleanupFixtureIdempotently(FIXTURE_STATES.CLEANED, { cleanup: () => calls.push("unexpected") });
  assert.deepEqual(alreadyClean, { state: FIXTURE_STATES.CLEANED, invoked: false });
  const failedCleanup = cleanupFixtureIdempotently(FIXTURE_STATES.CREATED, { cleanup: () => { throw new Error("synthetic"); } });
  assert.deepEqual(failedCleanup, { state: FIXTURE_STATES.CLEANUP_FAILED, invoked: true });
});
