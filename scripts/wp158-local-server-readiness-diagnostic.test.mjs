import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import { createCleanupCoordinator } from "./wp156-local-server-readiness-diagnostic.mjs";
import {
  BIND_CLASSES,
  EXIT_SIGNAL_FAMILIES,
  PHASES,
  TIMEOUT_BOUNDARIES,
  classifyExit,
  diagnosticTransition,
  initialDiagnosticState,
  makeReceipt,
  mapToWp156Diagnostic,
  runDiagnostic,
  validateReceipt,
} from "./wp158-local-server-readiness-diagnostic.mjs";

const wp155ReceiptPath = ".ai-team/reports/wp155-public-unavailable-browser-receipt.json";
const wp156ReceiptPath = ".ai-team/reports/wp156-local-server-readiness-diagnostic-receipt.json";

test("WP-158 diagnostic enums and receipt are closed fail-closed", () => {
  assert.deepEqual(PHASES, ["PREFLIGHT", "SPAWN", "PROCESS_RUNNING", "LOOPBACK_BIND", "READINESS_PROBE", "TERMINAL"]);
  assert.ok(EXIT_SIGNAL_FAMILIES.includes("PROCESS_STILL_RUNNING_AT_SNAPSHOT"));
  assert.ok(BIND_CLASSES.includes("LOOPBACK_ACCEPTING_UNATTRIBUTED"));
  assert.ok(TIMEOUT_BOUNDARIES.includes("AFTER_BIND_BEFORE_READY"));
  assert.equal(validateReceipt(makeReceipt()), true);
});

test("WP-158 exit families contain no raw signal or output", () => {
  assert.equal(classifyExit({ running: true }), "PROCESS_STILL_RUNNING_AT_SNAPSHOT");
  assert.equal(classifyExit({ code: 0 }), "NORMAL_EXIT_BEFORE_READY");
  assert.equal(classifyExit({ code: 1 }), "NONZERO_EXIT_BEFORE_READY");
  assert.equal(classifyExit({ signal: "SIGTERM" }), "SIGNALLED_BEFORE_READY");
  assert.equal(classifyExit({ spawnError: true }), "SPAWN_FAILED");
  assert.equal(classifyExit(), "NOT_APPLICABLE");
});

test("unattributed listener never becomes readiness pass", async () => {
  let now = 0;
  const result = await runDiagnostic({
    processAdapter: { spawn: async () => ({ exited: false }) },
    bindProbe: async () => ({ accepting: true, class: "LOOPBACK_ACCEPTING_UNATTRIBUTED" }),
    readinessProbe: async () => true,
    clock: { now: () => now, sleep: async () => { now += 100; } },
    maxMs: 300,
  });
  assert.equal(result.ready, false);
  assert.equal(result.loopbackBindClass, "LOOPBACK_ACCEPTING_UNATTRIBUTED");
  assert.equal(result.timeoutBoundary, "AFTER_BIND_BEFORE_READY");
  assert.equal(result.exitSignalFamily, "PROCESS_STILL_RUNNING_AT_SNAPSHOT");
});

test("child-attributed bind plus ready is the only readiness pass", async () => {
  let now = 0;
  const result = await runDiagnostic({
    processAdapter: { spawn: async () => ({ exited: false }) },
    bindProbe: async () => ({ accepting: true, class: "LOOPBACK_BOUND_TO_CHILD" }),
    readinessProbe: async () => true,
    clock: { now: () => now, sleep: async () => { now += 100; } },
  });
  assert.equal(result.ready, true);
  assert.equal(result.phase, "TERMINAL");
  assert.equal(result.exitSignalFamily, "PROCESS_STILL_RUNNING_AT_SNAPSHOT");
  assert.equal(result.retries, 0);
  assert.equal(result.restarts, 0);
});

test("normal, nonzero, signal and spawn failure are terminal without retry", async () => {
  for (const handle of [{ exited: true, code: 0 }, { exited: true, code: 1 }, { exited: true, signal: "SIGTERM" }]) {
    const result = await runDiagnostic({
      processAdapter: { spawn: async () => handle },
      bindProbe: async () => ({ accepting: false, class: "LOOPBACK_NOT_OBSERVED" }),
      readinessProbe: async () => false,
      clock: { now: () => 0, sleep: async () => undefined },
    });
    assert.equal(result.phase, "TERMINAL");
    assert.equal(result.serverAttempts, 1);
    assert.equal(result.retries, 0);
  }
  const spawnFailure = await runDiagnostic({
    processAdapter: { spawn: async () => { throw new Error("synthetic"); } },
    bindProbe: async () => ({ accepting: false, class: "LOOPBACK_NOT_OBSERVED" }),
    readinessProbe: async () => false,
    clock: { now: () => 0, sleep: async () => undefined },
  });
  assert.equal(spawnFailure.exitSignalFamily, "SPAWN_FAILED");
  assert.equal(spawnFailure.serverAttempts, 1);
});

test("terminal state ignores late events and forbids retry/restart", () => {
  let state = diagnosticTransition(initialDiagnosticState(), "PREFLIGHT_PASS");
  state = diagnosticTransition(state, "SPAWN_REQUEST");
  state = diagnosticTransition(state, "LOOPBACK_BOUND", { loopbackBindClass: "LOOPBACK_ACCEPTING_UNATTRIBUTED" });
  state = diagnosticTransition(state, "TIMEOUT");
  const late = diagnosticTransition(state, "READY");
  assert.equal(late.phase, "TERMINAL");
  assert.equal(late.ready, false);
  assert.throws(() => diagnosticTransition({ ...state, phase: "READINESS_PROBE" }, "RETRY"), /WP158_RETRY_RESTART_FORBIDDEN/);
});

test("WP-158 receipt rejects raw fields and score mutation", () => {
  const unsafe = makeReceipt();
  unsafe.rawOutput = "forbidden";
  assert.throws(() => validateReceipt(unsafe), /WP158_RECEIPT_SCHEMA_UNEXPECTED_KEY/);
  const score = makeReceipt();
  score.scoreImpact.CAT06.after = 7.5;
  assert.throws(() => validateReceipt(score), /WP158_RECEIPT_SCORE_MUTATION_FORBIDDEN/);
});

test("WP-157 coordinator is used with snapshot-before-cleanup and bounded EBUSY", () => {
  const events = [];
  let removeAttempts = 0;
  const snapshot = { diagnostic: mapToWp156Diagnostic(makeReceipt().diagnostic) };
  const coordinator = createCleanupCoordinator({
    snapshot,
    atomicCommit: () => events.push("atomic"),
    readback: () => snapshot,
    quiesceProcess: () => events.push("quiesce"),
    closeStreams: () => events.push("close"),
    releaseHandles: () => events.push("release"),
    removeRuntime: () => {
      removeAttempts += 1;
      events.push(`remove${removeAttempts}`);
      if (removeAttempts === 1) throw Object.assign(new Error("busy"), { code: "EBUSY" });
    },
    writeFinalEnvelope: () => events.push("envelope"),
  });
  const first = coordinator.run();
  const second = coordinator.run();
  assert.equal(first.classification, "WINDOWS_EBUSY_RECOVERED");
  assert.equal(second, first);
  assert.deepEqual(events, ["atomic", "quiesce", "close", "release", "remove1", "remove2", "envelope"]);
});

test("preserved WP-155 and WP-156 receipts remain immutable", () => {
  const before155 = crypto.createHash("sha256").update(fs.readFileSync(wp155ReceiptPath)).digest("hex");
  const before156 = crypto.createHash("sha256").update(fs.readFileSync(wp156ReceiptPath)).digest("hex");
  assert.equal(JSON.parse(fs.readFileSync(wp155ReceiptPath, "utf8")).status, "WP155_EXACT_NO_GO_NO_RETRY");
  assert.equal(JSON.parse(fs.readFileSync(wp156ReceiptPath, "utf8")).workPackage, "WP-156");
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(wp155ReceiptPath)).digest("hex"), before155);
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(wp156ReceiptPath)).digest("hex"), before156);
});

test("WP-158 mapping and state guards preserve child attribution and fail closed", async () => {
  const { canonicalSnapshotDigest, diagnosticTransition, initialDiagnosticState, mapToWp156Diagnostic } = await import("./wp158-local-server-readiness-diagnostic.mjs");
  const mapped = mapToWp156Diagnostic({ phase: "TERMINAL", exitSignalFamily: "PROCESS_STILL_RUNNING_AT_SNAPSHOT", loopbackBindClass: "LOOPBACK_BOUND_TO_CHILD", timeoutBoundary: "NO_TIMEOUT", ready: true });
  assert.deepEqual(mapped, { phase: "TERMINAL", exitSignalFamily: "PROCESS_STILL_RUNNING", loopbackBindClass: "LOOPBACK_ACCEPTING", timeoutBoundary: "NO_TIMEOUT", ready: true });
  assert.equal(canonicalSnapshotDigest(mapped), canonicalSnapshotDigest(structuredClone(mapped)));

  let state = diagnosticTransition(initialDiagnosticState(), "PREFLIGHT_PASS");
  state = diagnosticTransition(state, "SPAWN_REQUEST");
  assert.throws(() => diagnosticTransition(state, "LOOPBACK_BOUND", { loopbackBindClass: "BAD_CLASS" }), /WP158_BIND_CLASS_INVALID/);
  assert.throws(() => diagnosticTransition(state, "READY"), /WP158_READY_STATE_INVALID/);
  assert.throws(() => diagnosticTransition(state, "INVALID_EVENT"), /WP158_EVENT_INVALID/);
});

test("WP-158 process spawnError is terminal before any bind or readiness probe", async () => {
  let bindCalls = 0;
  let readinessCalls = 0;
  const result = await runDiagnostic({
    processAdapter: { spawn: async () => ({ spawnError: true, exited: false }) },
    bindProbe: async () => { bindCalls += 1; return { accepting: false, class: "LOOPBACK_NOT_OBSERVED" }; },
    readinessProbe: async () => { readinessCalls += 1; return false; },
    clock: { now: () => 0, sleep: async () => undefined },
  });

  assert.equal(result.phase, "TERMINAL");
  assert.equal(result.exitSignalFamily, "SPAWN_FAILED");
  assert.equal(result.timeoutBoundary, "NO_TIMEOUT");
  assert.equal(result.serverAttempts, 1);
  assert.equal(bindCalls, 0);
  assert.equal(readinessCalls, 0);
});

test("WP-158 rejects a ready event unless the bind is attributed to the child", () => {
  let state = diagnosticTransition(initialDiagnosticState(), "PREFLIGHT_PASS");
  state = diagnosticTransition(state, "SPAWN_REQUEST");
  state = diagnosticTransition(state, "LOOPBACK_BOUND", { loopbackBindClass: "LOOPBACK_ACCEPTING_UNATTRIBUTED" });
  state = diagnosticTransition(state, "READINESS_PROBE", { ready: true });
  assert.equal(state.ready, false);
  assert.throws(() => diagnosticTransition(state, "READY"), /WP158_READY_STATE_INVALID/);
  assert.throws(() => diagnosticTransition(state, "LOOPBACK_BOUND", { loopbackBindClass: "BAD_CLASS" }), /WP158_BIND_CLASS_INVALID/);
});
