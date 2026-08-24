import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BIND_CLASSES,
  EXIT_SIGNAL_FAMILIES,
  PHASES,
  TIMEOUT_BOUNDARIES,
  classifyExit,
  createCleanupCoordinator,
  diagnosticTransition,
  initialDiagnosticState,
  nextMetadataSnapshot,
  preflight,
  probeLoopbackBind,
  makeReceipt,
  runQuiet,
  runCleanupReceiptContract,
  runDiagnostic,
  syntheticEnvironment,
  validateReceipt,
  writeReceipt,
} from "./wp156-local-server-readiness-diagnostic.mjs";
import { makeReceipt as makeWp155Receipt } from "./wp155-public-unavailable-browser-runner.mjs";
import { createSyntheticJsonFixture } from "./test-contract-synthetic-fixtures.mjs";

const wp155Fixture = createSyntheticJsonFixture("wp155-public-unavailable-browser-receipt.json", makeWp155Receipt());
const wp155ReceiptPath = wp155Fixture.path;
test.after(() => wp155Fixture.cleanup());

test("diagnostic enums are closed and receipt starts fail-closed", () => {
  assert.deepEqual(PHASES, ["PREFLIGHT", "SPAWN", "PROCESS_RUNNING", "LOOPBACK_BIND", "READINESS_PROBE", "TERMINAL"]);
  assert.ok(EXIT_SIGNAL_FAMILIES.includes("NONZERO_EXIT_BEFORE_READY"));
  assert.ok(BIND_CLASSES.includes("LOOPBACK_ACCEPTING"));
  assert.ok(TIMEOUT_BOUNDARIES.includes("AFTER_BIND_BEFORE_READY"));
  assert.equal(validateReceipt(makeReceipt()), true);
});

test("exit and signal families are normalized without raw output", () => {
  assert.equal(classifyExit({ running: true }), "PROCESS_STILL_RUNNING");
  assert.equal(classifyExit({ code: 0 }), "NORMAL_EXIT_BEFORE_READY");
  assert.equal(classifyExit({ code: 1 }), "NONZERO_EXIT_BEFORE_READY");
  assert.equal(classifyExit({ signal: "SIGTERM" }), "SIGNALLED_BEFORE_READY");
  assert.equal(classifyExit({ spawnError: true }), "SPAWN_FAILED");
  assert.equal(classifyExit(), "NOT_OBSERVED");
});

test("fake process exits before bind are classified and cannot retry", async () => {
  let now = 0;
  const result = await runDiagnostic({
    processAdapter: { spawn: async () => ({ exited: true, code: 1, signal: null }) },
    bindProbe: async () => ({ accepting: false, class: "LOOPBACK_NOT_OBSERVED" }),
    readinessProbe: async () => false,
    clock: { now: () => now, sleep: async () => { now += 100; } },
  });
  assert.equal(result.phase, "TERMINAL");
  assert.equal(result.exitSignalFamily, "NONZERO_EXIT_BEFORE_READY");
  assert.equal(result.loopbackBindClass, "LOOPBACK_NOT_OBSERVED");
  assert.equal(result.serverAttempts, 1);
  let running = diagnosticTransition(initialDiagnosticState(), "PREFLIGHT_PASS");
  running = diagnosticTransition(running, "SPAWN_REQUEST");
  assert.throws(() => diagnosticTransition(running, "RETRY"), /DIAGNOSTIC_RETRY_RESTART_FORBIDDEN/);
});

test("fake process binds but remains unready and timeout boundary is after bind", async () => {
  let now = 0;
  const result = await runDiagnostic({
    processAdapter: { spawn: async () => ({ exited: false }) },
    bindProbe: async () => ({ accepting: true, class: "LOOPBACK_ACCEPTING" }),
    readinessProbe: async () => false,
    clock: { now: () => now, sleep: async () => { now += 100; } },
    maxMs: 300,
  });
  assert.equal(result.phase, "TERMINAL");
  assert.equal(result.exitSignalFamily, "PROCESS_STILL_RUNNING");
  assert.equal(result.loopbackBindClass, "LOOPBACK_ACCEPTING");
  assert.equal(result.timeoutBoundary, "AFTER_BIND_BEFORE_READY");
});

test("fake process reaches readiness once and late events cannot reopen terminal state", async () => {
  let now = 0;
  const result = await runDiagnostic({
    processAdapter: { spawn: async () => ({ exited: false }) },
    bindProbe: async () => ({ accepting: true, class: "LOOPBACK_ACCEPTING" }),
    readinessProbe: async () => true,
    clock: { now: () => now, sleep: async () => { now += 100; } },
  });
  assert.equal(result.phase, "TERMINAL");
  assert.equal(result.ready, true);
  assert.equal(result.exitSignalFamily, "PROCESS_STILL_RUNNING");
  assert.equal(result.timeoutBoundary, "NO_TIMEOUT");
  assert.equal(result.retries, 0);
  assert.equal(result.restarts, 0);
});

test("receipt rejects raw-like fields and score mutation", () => {
  const unsafe = makeReceipt();
  unsafe.rawOutput = "forbidden";
  assert.throws(() => validateReceipt(unsafe), /RECEIPT_SCHEMA_UNEXPECTED_KEY/);
  const score = makeReceipt();
  score.scoreImpact.CAT06.after = 7.5;
  assert.throws(() => validateReceipt(score), /RECEIPT_SCORE_MUTATION_FORBIDDEN/);
});

test("WP-155 terminal receipt is immutable and remains the diagnostic input", () => {
  const before = crypto.createHash("sha256").update(fs.readFileSync(wp155ReceiptPath)).digest("hex");
  const receipt = JSON.parse(fs.readFileSync(wp155ReceiptPath, "utf8"));
  assert.equal(receipt.status, "WP155_EXACT_NO_GO_NO_RETRY");
  assert.equal(receipt.server.ready, false);
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(wp155ReceiptPath)).digest("hex"), before);
});

test("diagnostic snapshots and cleanup contract fail closed without raw output", async () => {
  const { canonicalSnapshotDigest, runCleanupReceiptContract, validateDiagnosticSnapshot } = await import("./wp156-local-server-readiness-diagnostic.mjs");
  const snapshot = { diagnostic: { phase: "PREFLIGHT", exitSignalFamily: "NOT_OBSERVED", loopbackBindClass: "LOOPBACK_NOT_OBSERVED", timeoutBoundary: "NO_TIMEOUT", ready: false } };
  assert.equal(validateDiagnosticSnapshot(snapshot.diagnostic), true);
  assert.equal(canonicalSnapshotDigest(snapshot), canonicalSnapshotDigest(structuredClone(snapshot)));
  assert.throws(() => validateDiagnosticSnapshot({ ...snapshot.diagnostic, rawOutput: "forbidden" }), /DIAGNOSTIC_SNAPSHOT_SAFETY_INVALID/);
  const failedSnapshot = runCleanupReceiptContract({ snapshot: { diagnostic: { phase: "INVALID" } }, atomicCommit: () => undefined, readback: () => snapshot, quiesceProcess: () => undefined, closeStreams: () => undefined, releaseHandles: () => undefined, removeRuntime: () => undefined, writeFinalEnvelope: () => undefined });
  assert.equal(failedSnapshot.classification, "DIAGNOSTIC_SNAPSHOT_WRITE_FAILED");
  const nonEbusy = runCleanupReceiptContract({ snapshot, atomicCommit: () => undefined, readback: () => snapshot, quiesceProcess: () => undefined, closeStreams: () => undefined, releaseHandles: () => undefined, removeRuntime: () => { throw new Error("synthetic"); }, writeFinalEnvelope: () => undefined });
  assert.equal(nonEbusy.classification, "NON_EBUSY_CLEANUP_FAILED");
});

test("diagnostic process exits cover normal, signalled, and unobserved terminal classifications", async () => {
  for (const handle of [
    { exited: true, code: 0, signal: null },
    { exited: true, code: null, signal: "SIGTERM" },
    { exited: true, code: null, signal: null },
  ]) {
    const result = await runDiagnostic({
      processAdapter: { spawn: async () => handle },
      bindProbe: async () => ({ accepting: false, class: "LOOPBACK_NOT_OBSERVED" }),
      readinessProbe: async () => false,
      clock: { now: () => 0, sleep: async () => undefined },
    });
    assert.equal(result.phase, "TERMINAL");
    assert.equal(result.serverAttempts, 1);
  }
});

test("diagnostic transition preserves terminal events and rejects invalid phase transitions", () => {
  let state = diagnosticTransition(initialDiagnosticState(), "PREFLIGHT_PASS");
  state = diagnosticTransition(state, "SPAWN_REQUEST");
  assert.throws(() => diagnosticTransition(state, "PREFLIGHT_PASS"), /DIAGNOSTIC_PREFLIGHT_STATE_INVALID/);
  state = diagnosticTransition(state, "LOOPBACK_BOUND", { loopbackBindClass: "LOOPBACK_ACCEPTING" });
  const terminal = diagnosticTransition(state, "PROCESS_EXIT", { code: 0 });
  const late = diagnosticTransition(terminal, "READY");
  assert.equal(late.phase, "TERMINAL");
  assert.equal(late.events.at(-1), "IGNORED:READY");
  assert.throws(() => diagnosticTransition({ ...state, phase: "INVALID" }, "READY"), /DIAGNOSTIC_STATE_INVALID/);
});

test("cleanup contract records EBUSY recovery and coordinator is idempotent", () => {
  const snapshot = { diagnostic: { phase: "PREFLIGHT", exitSignalFamily: "NOT_OBSERVED", loopbackBindClass: "LOOPBACK_NOT_OBSERVED", timeoutBoundary: "NO_TIMEOUT", ready: false } };
  let removeAttempts = 0;
  let committed;
  const result = runCleanupReceiptContract({
    snapshot,
    atomicCommit: () => undefined,
    readback: () => structuredClone(snapshot),
    quiesceProcess: () => undefined,
    closeStreams: () => undefined,
    releaseHandles: () => undefined,
    removeRuntime: () => {
      removeAttempts += 1;
      if (removeAttempts === 1) {
        const error = new Error("busy");
        error.code = "EBUSY";
        throw error;
      }
    },
    writeFinalEnvelope: (envelope) => { committed = envelope; },
  });
  assert.equal(result.classification, "WINDOWS_EBUSY_RECOVERED");
  assert.equal(result.cleanupAttempts, 2);
  assert.equal(committed.classification, "WINDOWS_EBUSY_RECOVERED");

  let coordinatorCalls = 0;
  const coordinator = createCleanupCoordinator({
    snapshot,
    atomicCommit: () => undefined,
    readback: () => structuredClone(snapshot),
    quiesceProcess: () => undefined,
    closeStreams: () => undefined,
    releaseHandles: () => undefined,
    removeRuntime: () => { coordinatorCalls += 1; },
    writeFinalEnvelope: () => undefined,
  });
  const first = coordinator.run();
  const second = coordinator.run();
  assert.equal(first, second);
  assert.equal(coordinatorCalls, 1);
});

test("cleanup contract preserves strict terminal classifications", () => {
  const snapshot = { diagnostic: { phase: "PREFLIGHT", exitSignalFamily: "NOT_OBSERVED", loopbackBindClass: "LOOPBACK_NOT_OBSERVED", timeoutBoundary: "NO_TIMEOUT", ready: false } };
  const exhausted = runCleanupReceiptContract({
    snapshot,
    atomicCommit: () => undefined,
    readback: () => structuredClone(snapshot),
    quiesceProcess: () => undefined,
    closeStreams: () => undefined,
    releaseHandles: () => undefined,
    removeRuntime: () => { const error = new Error("busy"); error.code = "EBUSY"; throw error; },
    writeFinalEnvelope: () => undefined,
    maxAttempts: 2,
  });
  assert.equal(exhausted.classification, "WINDOWS_EBUSY_RETRY_EXHAUSTED");
  assert.equal(exhausted.cleanupAttempts, 2);

  const envelopeFailure = runCleanupReceiptContract({
    snapshot,
    atomicCommit: () => undefined,
    readback: () => structuredClone(snapshot),
    quiesceProcess: () => undefined,
    closeStreams: () => undefined,
    releaseHandles: () => undefined,
    removeRuntime: () => undefined,
    writeFinalEnvelope: () => { throw new Error("write failed"); },
  });
  assert.equal(envelopeFailure.classification, "FINAL_ENVELOPE_WRITE_FAILED");
  assert.equal(envelopeFailure.idempotent, true);
});

test("sanitized process, loopback and receipt helpers preserve bounded evidence", async () => {
  const environment = syntheticEnvironment();
  assert.equal(environment.CI, "true");
  assert.equal(environment.E2E_TEST_MODE, "true");
  const quiet = runQuiet(process.execPath, ["-e", "process.stdout.write('synthetic')"], environment);
  assert.equal(quiet.exitCode, 0);
  assert.equal(quiet.stdoutBytes, 9);
  assert.equal(typeof nextMetadataSnapshot().exists, "boolean");

  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  const accepting = await probeLoopbackBind("127.0.0.1", address.port);
  assert.deepEqual(accepting, { accepting: true, class: "LOOPBACK_ACCEPTING" });
  await new Promise((resolve) => server.close(resolve));
  const closed = await probeLoopbackBind("127.0.0.1", address.port);
  assert.deepEqual(closed, { accepting: false, class: "LOOPBACK_NOT_OBSERVED" });

  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-wp156-test-")), "receipt.json");
  try {
    const receipt = makeReceipt();
    writeReceipt(target, receipt);
    assert.equal(validateReceipt(JSON.parse(fs.readFileSync(target, "utf8"))), true);
  } finally {
    fs.rmSync(path.dirname(target), { recursive: true, force: true });
  }
});

test("diagnostic transition and preflight cover spawn failure, timeout and bounded acceptance", async () => {
  const spawnFailure = await runDiagnostic({
    processAdapter: { spawn: async () => { throw new Error("synthetic spawn failure"); } },
    bindProbe: async () => ({ accepting: false, class: "LOOPBACK_NOT_OBSERVED" }),
    readinessProbe: async () => false,
    clock: { now: () => 0, sleep: async () => undefined },
  });
  assert.equal(spawnFailure.exitSignalFamily, "SPAWN_FAILED");
  assert.equal(spawnFailure.timeoutBoundary, "BEFORE_PROCESS_RUNNING");

  let state = diagnosticTransition(initialDiagnosticState(), "PREFLIGHT_PASS");
  state = diagnosticTransition(state, "SPAWN_REQUEST");
  state = diagnosticTransition(state, "LOOPBACK_BOUND", { loopbackBindClass: "LOOPBACK_ACCEPTING" });
  state = diagnosticTransition(state, "READINESS_PROBE", { ready: false });
  const timeout = diagnosticTransition(state, "TIMEOUT");
  assert.equal(timeout.timeoutBoundary, "AFTER_BIND_BEFORE_READY");
  assert.equal(diagnosticTransition(timeout, "INVALID_EVENT").events.at(-1), "IGNORED:INVALID_EVENT");

  const receipt = makeReceipt();
  preflight(receipt);
  assert.equal(receipt.quality.wp155Terminal, "PRESERVE_ONLY_TERMINAL");
  assert.equal(receipt.quality.wp154Acceptance, "ACCEPT");
});
