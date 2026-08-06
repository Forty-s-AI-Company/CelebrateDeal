import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import { buildWp151FixtureScript } from "./wp151-public-unavailable-browser-runner.mjs";
import { isAllowedLoopbackUrl, makeReceipt, validateWp153Receipt } from "./wp153-public-unavailable-browser-runner.mjs";

const wp151ReceiptPath = ".ai-team/reports/wp151-public-unavailable-browser-receipt.json";

test("WP-152 normalization is imported side-effect-free and keeps the repaired fixture identity", () => {
  const script = buildWp151FixtureScript();
  assert.match(script, /const vendorId = vendor\.id;/);
  assert.match(script, /ctaLabel: "fixture CTA" \} \}\);/);
  assert.doesNotMatch(script, /ctaLabel: "fixture CTA" \}\);/);
});

test("loopback transport allowlist rejects external and malformed URLs", () => {
  assert.equal(isAllowedLoopbackUrl("http://127.0.0.1:32153/p/example"), true);
  assert.equal(isAllowedLoopbackUrl("http://[::1]:32153/p/example"), true);
  assert.equal(isAllowedLoopbackUrl("https://example.invalid/p/example"), false);
  assert.equal(isAllowedLoopbackUrl("file:///tmp/example"), false);
  assert.equal(isAllowedLoopbackUrl("not-a-url"), false);
});

test("default receipt is exact no-go and cannot claim a score increase", () => {
  const receipt = makeReceipt();
  assert.equal(validateWp153Receipt(receipt), true);
  assert.equal(receipt.attempt, 0);
  assert.equal(receipt.server.started, 0);
  assert.equal(receipt.browser.desktop.passed, 0);
  assert.equal(receipt.browser.mobile390.passed, 0);
  receipt.scoreImpact.CAT06.after = 7.5;
  assert.throws(() => validateWp153Receipt(receipt), /RECEIPT_NO_GO_SCORE_INVALID/);
});

test("pass receipt requires exactly one server and one desktop/mobile case", () => {
  const receipt = makeReceipt();
  receipt.status = "PASS";
  receipt.attempt = 1;
  receipt.server.started = 1;
  receipt.server.ready = true;
  receipt.browser.desktop.passed = 1;
  receipt.browser.mobile390.passed = 1;
  receipt.cleanup.fixture = "PASS";
  receipt.cleanup.schema = "PASS";
  receipt.cleanup.tempRoot = true;
  assert.equal(validateWp153Receipt(receipt), true);
  receipt.browser.mobile390.passed = 2;
  assert.throws(() => validateWp153Receipt(receipt), /RECEIPT_PASS_GATE_INVALID/);
});

test("WP-151 terminal receipt is read-only and its digest is stable", () => {
  const before = crypto.createHash("sha256").update(fs.readFileSync(wp151ReceiptPath)).digest("hex");
  const receipt = JSON.parse(fs.readFileSync(wp151ReceiptPath, "utf8"));
  assert.equal(receipt.status, "FIXTURE_CONTRACT_EXACT_NO_GO");
  assert.equal(receipt.attempt, 0);
  const after = crypto.createHash("sha256").update(fs.readFileSync(wp151ReceiptPath)).digest("hex");
  assert.equal(after, before);
});

test("receipt safety rejects raw-like fields and nonzero side effects", () => {
  const receipt = makeReceipt();
  receipt.rawLog = "forbidden";
  assert.throws(() => validateWp153Receipt(receipt), /RECEIPT_MISSING|RECEIPT_SCHEMA|RECEIPT_STATUS|RECEIPT_SAFETY/);
  const sideEffectReceipt = makeReceipt();
  sideEffectReceipt.sideEffects.network = 1;
  assert.throws(() => validateWp153Receipt(sideEffectReceipt), /RECEIPT_SIDE_EFFECT_INVALID/);
});

test("viewport and retry counters remain exactly once", () => {
  const receipt = makeReceipt();
  assert.deepEqual({ desktop: receipt.browser.desktop.expected, mobile390: receipt.browser.mobile390.expected }, { desktop: 1, mobile390: 1 });
  assert.equal(receipt.browser.desktop.retries, 0);
  assert.equal(receipt.browser.mobile390.retries, 0);
  assert.equal(receipt.server.readinessWindows, 0);
});

test("synthetic readiness and WP154 normalization cover terminal and safety branches", async () => {
  const { normalizeWp154ReadinessReceipt, runSyntheticReadiness, validateWp154ReadinessReceipt } = await import("./wp153-public-unavailable-browser-runner.mjs");
  const ready = runSyntheticReadiness(["SPAWN_REQUEST", "SPAWN_ACCEPTED", "PROBE_READY", "READY_MARKER"]);
  assert.equal(ready.state, "READY");
  assert.equal(ready.spawnCount, 1);
  const conflict = runSyntheticReadiness(["SPAWN_REQUEST", "SPAWN_ACCEPTED", "PROBE_NOT_READY"]);
  assert.equal(conflict.state, "READINESS_CONFLICT");
  const timedOut = runSyntheticReadiness(["SPAWN_REQUEST", "SPAWN_ACCEPTED", "TIMEOUT"]);
  assert.equal(timedOut.state, "TIMED_OUT");
  assert.throws(() => runSyntheticReadiness(["RETRY"]), /READINESS_RETRY_FORBIDDEN/);

  const source = makeReceipt();
  source.attempt = 1;
  source.server.started = 1;
  const normalized = normalizeWp154ReadinessReceipt(source);
  assert.equal(normalized.workPackage, "WP-154");
  assert.equal(validateWp154ReadinessReceipt(normalized), true);
  const invalid = structuredClone(normalized);
  invalid.rawOutputPersisted = true;
  assert.throws(() => validateWp154ReadinessReceipt(invalid), /WP154_RECEIPT_SAFETY_INVALID/);
});

// COV-07 BEGIN
test("COV-07 WP153 endpoint normalization canonicalizes loopback and rejects unsafe authorities", async () => {
  const { normalizeLoopbackEndpoint } = await import("./wp153-public-unavailable-browser-runner.mjs");
  assert.equal(normalizeLoopbackEndpoint("http://127.0.0.1:32153/p/example"), "http://127.0.0.1:32153");
  assert.equal(normalizeLoopbackEndpoint("https://[::1]:4443/p/example"), "https://[::1]:4443");
  assert.throws(() => normalizeLoopbackEndpoint("http://127.0.0.1:32153@evil.example/p/example"), /LOOPBACK_URL_NOT_ALLOWED/);
  assert.throws(() => normalizeLoopbackEndpoint("ftp://127.0.0.1:32153/p/example"), /LOOPBACK_URL_NOT_ALLOWED/);
  assert.throws(() => normalizeLoopbackEndpoint("http://127.0.0.1:0/p/example"), /LOOPBACK_PORT_INVALID/);
  assert.throws(() => normalizeLoopbackEndpoint("http://127.0.0.1:65536/p/example"), /(LOOPBACK_URL_INVALID|LOOPBACK_PORT_INVALID)/);
});

test("COV-07 WP153 output classification keeps port and module precedence", async () => {
  const { classifyServerOutput } = await import("./wp153-public-unavailable-browser-runner.mjs");
  assert.equal(classifyServerOutput("fatal EADDRINUSE and Cannot find module"), "PORT_IN_USE");
  assert.equal(classifyServerOutput("Error: Cannot find module 'next'"), "MODULE_RESOLUTION");
  assert.equal(classifyServerOutput("TypeError: failed to compile"), "SOURCE_OR_COMPILE_BOUNDARY");
  assert.equal(classifyServerOutput("uncaught fatal server error"), "SERVER_START_UNKNOWN");
  assert.equal(classifyServerOutput("ready"), null);
});

test("COV-07 WP153 readiness transitions accept one terminal path and reject illegal events", async () => {
  const { READINESS_STATES, readinessTransition } = await import("./wp153-public-unavailable-browser-runner.mjs");
  const initial = { state: READINESS_STATES.NOT_STARTED, markerSeen: false, probeSeen: false, spawnCount: 0, ignoredEvents: 0, events: [] };
  const requested = readinessTransition(initial, "SPAWN_REQUEST");
  const running = readinessTransition(requested, "SPAWN_ACCEPTED");
  const marked = readinessTransition(running, "READY_MARKER");
  const ready = readinessTransition(marked, "PROBE_READY");
  assert.deepStrictEqual({ state: ready.state, markerSeen: ready.markerSeen, probeSeen: ready.probeSeen, spawnCount: ready.spawnCount }, { state: READINESS_STATES.READY, markerSeen: true, probeSeen: true, spawnCount: 1 });
  assert.throws(() => readinessTransition(initial, "SPAWN_ACCEPTED"), /READINESS_SPAWN_STATE_INVALID/);
  const ignored = readinessTransition(ready, "PROBE_READY");
  assert.equal(ignored.ignoredEvents, 1);
});

test("COV-07 WP153 receipt round-trip rejects version, status and safety tampering", () => {
  const receipt = makeReceipt();
  assert.equal(validateWp153Receipt(JSON.parse(JSON.stringify(receipt))), true);
  const versionTampered = structuredClone(receipt);
  versionTampered.schemaVersion = "wp153-public-unavailable-browser/v2";
  assert.throws(() => validateWp153Receipt(versionTampered), /RECEIPT_SCHEMA_INVALID/);
  const statusTampered = structuredClone(receipt);
  statusTampered.status = "UNKNOWN";
  assert.throws(() => validateWp153Receipt(statusTampered), /RECEIPT_STATUS_INVALID/);
  const safetyTampered = structuredClone(receipt);
  safetyTampered.rawOutputExposed = true;
  assert.throws(() => validateWp153Receipt(safetyTampered), /RECEIPT_SAFETY_INVALID/);
});
// COV-07 END
