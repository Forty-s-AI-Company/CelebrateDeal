import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import {
  CLEANUP_CLASSES,
  createCleanupCoordinator,
  makeReceipt as makeWp156Receipt,
  runCleanupReceiptContract,
  validateDiagnosticSnapshot,
} from "./wp156-local-server-readiness-diagnostic.mjs";
import { makeReceipt as makeWp155Receipt } from "./wp155-public-unavailable-browser-runner.mjs";
import { createSyntheticJsonFixture } from "./test-contract-synthetic-fixtures.mjs";

const wp155Fixture = createSyntheticJsonFixture("wp155-public-unavailable-browser-receipt.json", makeWp155Receipt());
const wp156Fixture = createSyntheticJsonFixture("wp156-local-server-readiness-diagnostic-receipt.json", makeWp156Receipt());
const wp155ReceiptPath = wp155Fixture.path;
const wp156ReceiptPath = wp156Fixture.path;
test.after(() => {
  wp155Fixture.cleanup();
  wp156Fixture.cleanup();
});

function snapshot() {
  return {
    diagnostic: {
      phase: "TERMINAL",
      exitSignalFamily: "UNKNOWN",
      loopbackBindClass: "UNKNOWN",
      timeoutBoundary: "UNKNOWN",
      ready: false,
    },
  };
}

test("snapshot validation is strict and cleanup classes are closed", () => {
  assert.equal(validateDiagnosticSnapshot(snapshot().diagnostic), true);
  assert.deepEqual(CLEANUP_CLASSES, ["CLEANUP_PASS", "WINDOWS_EBUSY_RECOVERED", "WINDOWS_EBUSY_RETRY_EXHAUSTED", "NON_EBUSY_CLEANUP_FAILED", "DIAGNOSTIC_SNAPSHOT_WRITE_FAILED", "FINAL_ENVELOPE_WRITE_FAILED"]);
  const unsafe = snapshot();
  unsafe.diagnostic.rawOutput = "forbidden";
  assert.throws(() => validateDiagnosticSnapshot(unsafe.diagnostic), /DIAGNOSTIC_SNAPSHOT_SAFETY_INVALID/);
});

test("atomic snapshot and readback happen before quiesce and cleanup; EBUSY recovers", () => {
  const events = [];
  let removeCalls = 0;
  let committed;
  const result = runCleanupReceiptContract({
    snapshot: snapshot(),
    atomicCommit: (value) => { events.push("atomic"); committed = structuredClone(value); },
    readback: () => { events.push("readback"); return committed; },
    quiesceProcess: () => events.push("quiesce"),
    closeStreams: () => events.push("close"),
    releaseHandles: () => events.push("release"),
    removeRuntime: () => { events.push("cleanup"); removeCalls += 1; if (removeCalls === 1) { const error = new Error("busy"); error.code = "EBUSY"; throw error; } },
    writeFinalEnvelope: () => events.push("envelope"),
  });
  assert.equal(result.classification, "WINDOWS_EBUSY_RECOVERED");
  assert.equal(result.cleanupAttempts, 2);
  assert.equal(removeCalls, 2);
  assert.ok(events.indexOf("atomic") < events.indexOf("cleanup"));
  assert.ok(events.indexOf("readback") < events.indexOf("quiesce"));
  assert.ok(events.indexOf("quiesce") < events.indexOf("close"));
  assert.ok(events.indexOf("close") < events.indexOf("release"));
});

test("three EBUSY failures are bounded and non-EBUSY does not retry", () => {
  let busyCalls = 0;
  const exhausted = runCleanupReceiptContract({
    snapshot: snapshot(),
    atomicCommit: () => undefined,
    readback: () => snapshot(),
    quiesceProcess: () => undefined,
    closeStreams: () => undefined,
    releaseHandles: () => undefined,
    removeRuntime: () => { busyCalls += 1; const error = new Error("busy"); error.code = "EBUSY"; throw error; },
    writeFinalEnvelope: () => undefined,
  });
  assert.equal(exhausted.classification, "WINDOWS_EBUSY_RETRY_EXHAUSTED");
  assert.equal(busyCalls, 3);
  let nonBusyCalls = 0;
  const failed = runCleanupReceiptContract({
    snapshot: snapshot(),
    atomicCommit: () => undefined,
    readback: () => snapshot(),
    quiesceProcess: () => undefined,
    closeStreams: () => undefined,
    releaseHandles: () => undefined,
    removeRuntime: () => { nonBusyCalls += 1; throw new Error("permission"); },
    writeFinalEnvelope: () => undefined,
  });
  assert.equal(failed.classification, "NON_EBUSY_CLEANUP_FAILED");
  assert.equal(nonBusyCalls, 1);
});

test("coordinator is idempotent and does not widen cleanup on re-entry", () => {
  let removeCalls = 0;
  let envelopeCalls = 0;
  const coordinator = createCleanupCoordinator({
    snapshot: snapshot(),
    atomicCommit: () => undefined,
    readback: () => snapshot(),
    quiesceProcess: () => undefined,
    closeStreams: () => undefined,
    releaseHandles: () => undefined,
    removeRuntime: () => { removeCalls += 1; },
    writeFinalEnvelope: () => { envelopeCalls += 1; },
  });
  const first = coordinator.run();
  const second = coordinator.run();
  assert.deepEqual(second, first);
  assert.equal(removeCalls, 1);
  assert.equal(envelopeCalls, 1);
});

test("snapshot write failure still releases handles and has distinct classification", () => {
  const events = [];
  const result = runCleanupReceiptContract({
    snapshot: snapshot(),
    atomicCommit: () => { throw new Error("write failed"); },
    readback: () => snapshot(),
    quiesceProcess: () => events.push("quiesce"),
    closeStreams: () => events.push("close"),
    releaseHandles: () => events.push("release"),
    removeRuntime: () => { throw new Error("must not cleanup before snapshot"); },
    writeFinalEnvelope: () => undefined,
  });
  assert.equal(result.classification, "DIAGNOSTIC_SNAPSHOT_WRITE_FAILED");
  assert.deepEqual(events, ["quiesce", "close", "release"]);
});

test("final envelope failure keeps the committed snapshot digest lineage", () => {
  let committed;
  const result = runCleanupReceiptContract({
    snapshot: snapshot(),
    atomicCommit: (value) => { committed = structuredClone(value); },
    readback: () => committed,
    quiesceProcess: () => undefined,
    closeStreams: () => undefined,
    releaseHandles: () => undefined,
    removeRuntime: () => undefined,
    writeFinalEnvelope: () => { throw new Error("envelope failed"); },
  });
  assert.equal(result.classification, "FINAL_ENVELOPE_WRITE_FAILED");
  assert.match(result.snapshotDigest, /^sha256:/);
});

test("WP-155 and WP-156 terminal receipts remain immutable inputs", () => {
  const before155 = crypto.createHash("sha256").update(fs.readFileSync(wp155ReceiptPath)).digest("hex");
  const before156 = crypto.createHash("sha256").update(fs.readFileSync(wp156ReceiptPath)).digest("hex");
  assert.equal(JSON.parse(fs.readFileSync(wp155ReceiptPath, "utf8")).status, "WP155_EXACT_NO_GO_NO_RETRY");
  assert.equal(JSON.parse(fs.readFileSync(wp156ReceiptPath, "utf8")).status, "WP156_EXACT_NO_GO_NO_RETRY_DIAGNOSTIC_INCOMPLETE");
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(wp155ReceiptPath)).digest("hex"), before155);
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(wp156ReceiptPath)).digest("hex"), before156);
});
