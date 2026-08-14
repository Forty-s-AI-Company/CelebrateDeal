import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PassThrough } from "node:stream";

import {
  attachSanitizedStream,
  classifyServerOutput,
  fixtureScript,
  makeReceipt,
  nextMetadataSnapshot,
  runQuiet,
  sha256File,
  sourceDigestSnapshot,
  syntheticEnvironment,
  validateWp149Receipt,
  waitForServer,
  writeReceipt,
} from "./wp149-public-unavailable-browser-runner.mjs";

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

// COV-08 BEGIN
test("WP149 synthetic environment stays loopback-only and metadata snapshot is typed", () => {
  const environment = syntheticEnvironment();
  assert.equal(environment.NODE_ENV, "development");
  assert.equal(environment.CI, "true");
  assert.match(environment.NEXT_PUBLIC_APP_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(environment.NPM_CONFIG_OFFLINE, "true");
  const metadata = nextMetadataSnapshot();
  assert.deepEqual(Object.keys(metadata).sort(), ["exists", "mtimeMs", "size"]);
  assert.equal(typeof metadata.exists, "boolean");
  assert.equal(typeof metadata.size, "number");
});

test("WP149 sanitized stream records categories without persisting raw output", () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const diagnostics = { lineCount: 0, classifications: [] };
  attachSanitizedStream({ stdout, stderr }, diagnostics);
  stdout.write("ready\nError: Cannot find module 'next'\n");
  stderr.write("listen EADDRINUSE\nTypeError: failed to compile\n");
  assert.equal(diagnostics.lineCount, 4);
  assert.deepEqual(diagnostics.classifications, ["MODULE_RESOLUTION", "PORT_IN_USE", "SOURCE_OR_COMPILE_BOUNDARY"]);
  stdout.end();
  stderr.end();
});

test("WP149 digest and receipt writer use disposable files with strict readback", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-wp149-test-"));
  try {
    const source = path.join(tempRoot, "fixture.txt");
    fs.writeFileSync(source, "synthetic fixture\n", "utf8");
    assert.match(sha256File("fixture.txt", tempRoot), /^sha256:[0-9a-f]{64}$/);
    const snapshot = sourceDigestSnapshot();
    assert.equal(typeof snapshot, "object");
    assert.ok(Object.keys(snapshot).length > 0);

    const target = path.join(tempRoot, "receipt.json");
    writeReceipt(target, makeReceipt());
    assert.equal(JSON.parse(fs.readFileSync(target, "utf8")).sanitized, true);
    assert.equal(fs.readdirSync(tempRoot).some((entry) => entry.includes(".tmp-")), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("WP149 subprocess normalization keeps only bounded result fields", () => {
  const result = runQuiet(process.execPath, ["--version"], process.env);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdoutBytes > 0, true);
  assert.equal(result.stderrBytes, 0);
  assert.deepEqual(Object.keys(result).sort(), ["exitCode", "stderrBytes", "stdoutBytes"]);
});

test("WP149 readiness fails closed on early exit without fetching", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { status: 204 };
  };
  try {
    await assert.rejects(
      waitForServer("http://127.0.0.1:32149", { exitCode: 1 }),
      /SERVER_PRE_READINESS_EXIT_EXACT_NO_GO/,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WP149 readiness accepts a loopback success response", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async (url) => {
    fetchCalls += 1;
    assert.equal(url, "http://127.0.0.1:32149/login");
    return { status: 204 };
  };
  try {
    await assert.doesNotReject(waitForServer("http://127.0.0.1:32149", { exitCode: null }));
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
// COV-08 END
