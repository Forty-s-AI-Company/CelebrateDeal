import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildWp151FixtureScript } from "./wp151-public-unavailable-browser-runner.mjs";
import {
  attachSanitizedStream,
  makeReceipt,
  nextMetadataSnapshot,
  normalizeLoopbackEndpoint,
  preflightDependencyBoundary,
  protectedDigestSnapshot,
  readinessTransition,
  runQuiet,
  sha256File,
  syntheticEnvironment,
  validateReceipt,
  waitForServer,
  writeReceipt,
} from "./wp155-public-unavailable-browser-runner.mjs";
import { makeReceipt as makeWp153Receipt, READINESS_STATES } from "./wp153-public-unavailable-browser-runner.mjs";
import { createSyntheticJsonFixture } from "./test-contract-synthetic-fixtures.mjs";

const wp153SourceReceipt = makeWp153Receipt();
wp153SourceReceipt.attempt = 1;
wp153SourceReceipt.server.started = 1;
const wp153Fixture = createSyntheticJsonFixture("wp153-public-unavailable-browser-receipt.json", wp153SourceReceipt);
const wp154Fixture = createSyntheticJsonFixture("wp154-wp153-readiness-contract-remediation.json", {
  solAcceptance: "ACCEPT",
  classification: "WP154_WP153_READINESS_CONTRACT_REMEDIATED_READY",
});
const wp153ReceiptPath = wp153Fixture.path;
const wp154ReportPath = wp154Fixture.path;
test.after(() => {
  wp153Fixture.cleanup();
  wp154Fixture.cleanup();
});

test("WP-152 fixture normalization remains exact and side-effect-free", () => {
  const script = buildWp151FixtureScript();
  assert.match(script, /const vendorId = vendor\.id;/);
  assert.match(script, /ctaLabel: "fixture CTA" \} \}\);/);
  assert.doesNotMatch(script, /ctaLabel: "fixture CTA" \}\);/);
});

test("WP-154 acceptance and WP-153 terminal receipt are immutable prerequisites", () => {
  const wp153Before = crypto.createHash("sha256").update(fs.readFileSync(wp153ReceiptPath)).digest("hex");
  const wp153 = JSON.parse(fs.readFileSync(wp153ReceiptPath, "utf8"));
  assert.equal(wp153.status, "WP153_EXACT_NO_GO_NO_RETRY");
  assert.equal(wp153.attempt, 1);
  assert.equal(wp153.browser.desktop.passed, 0);
  assert.equal(wp153.browser.mobile390.passed, 0);
  const wp154 = JSON.parse(fs.readFileSync(wp154ReportPath, "utf8"));
  assert.equal(wp154.solAcceptance, "ACCEPT");
  assert.equal(wp154.classification, "WP154_WP153_READINESS_CONTRACT_REMEDIATED_READY");
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(wp153ReceiptPath)).digest("hex"), wp153Before);
});

test("readiness state machine is exactly-once and retry-free", () => {
  let machine = { state: READINESS_STATES.NOT_STARTED, markerSeen: false, probeSeen: false, spawnCount: 0, ignoredEvents: 0, events: [] };
  machine = readinessTransition(machine, "SPAWN_REQUEST");
  machine = readinessTransition(machine, "SPAWN_ACCEPTED");
  assert.throws(() => readinessTransition(machine, "RETRY"), /READINESS_RETRY_FORBIDDEN/);
  machine = readinessTransition(machine, "READY_MARKER");
  machine = readinessTransition(machine, "PROBE_READY");
  assert.equal(machine.state, READINESS_STATES.READY);
  assert.equal(machine.spawnCount, 1);
  const late = readinessTransition(machine, "PROBE_READY");
  assert.equal(late.ignoredEvents, 1);
});

test("loopback endpoint rejects non-loopback and invalid ports", () => {
  assert.equal(normalizeLoopbackEndpoint("http://127.0.0.1:32155"), "http://127.0.0.1:32155");
  assert.equal(normalizeLoopbackEndpoint("http://[::1]:32155"), "http://[::1]:32155");
  assert.throws(() => normalizeLoopbackEndpoint("https://example.invalid:32155"), /LOOPBACK_URL_NOT_ALLOWED/);
  assert.throws(() => normalizeLoopbackEndpoint("http://127.0.0.1"), /LOOPBACK_PORT_INVALID/);
});

test("no-go receipt cannot claim a score increase or unsafe output", () => {
  const receipt = makeReceipt();
  assert.equal(validateReceipt(receipt), true);
  receipt.scoreImpact.CAT06.after = 7.5;
  assert.throws(() => validateReceipt(receipt), /RECEIPT_NO_GO_SCORE_INVALID/);
  const unsafe = makeReceipt();
  unsafe.rawLog = "forbidden";
  assert.throws(() => validateReceipt(unsafe), /RECEIPT_SCHEMA_UNEXPECTED_KEY/);
});

test("verified receipt requires one server and two Browser cases", () => {
  const receipt = makeReceipt();
  receipt.status = "WP155_PUBLIC_UNAVAILABLE_BROWSER_VERIFIED";
  receipt.attempt = 1;
  receipt.server.started = 1;
  receipt.server.ready = true;
  receipt.server.readinessWindowsAttempted = 1;
  receipt.browser.desktop.passed = 1;
  receipt.browser.desktop.navigationCount = 1;
  receipt.browser.mobile390.passed = 1;
  receipt.browser.mobile390.navigationCount = 1;
  receipt.cleanup.fixture = "PASS";
  receipt.cleanup.schema = "PASS";
  receipt.cleanup.tempRoot = true;
  receipt.scoreImpact = { CAT06: { before: 7.0, after: 7.5 }, total: { before: 71.5, after: 72.0 } };
  assert.equal(validateReceipt(receipt), true);
  receipt.browser.mobile390.navigationCount = 2;
  assert.throws(() => validateReceipt(receipt), /RECEIPT_EXACTLY_ONCE_INVALID/);
});

test("WP155 receipt validation rejects malformed counters, side effects and unknown keys", () => {
  const invalidStatus = makeReceipt();
  invalidStatus.status = "UNKNOWN";
  assert.throws(() => validateReceipt(invalidStatus), /RECEIPT_STATUS_INVALID/);

  const invalidCounter = makeReceipt();
  invalidCounter.server.started = 2;
  assert.throws(() => validateReceipt(invalidCounter), /RECEIPT_EXACTLY_ONCE_INVALID/);

  const sideEffect = makeReceipt();
  sideEffect.sideEffects.network = 1;
  assert.throws(() => validateReceipt(sideEffect), /RECEIPT_SIDE_EFFECT_INVALID/);

  const unknown = makeReceipt();
  unknown.rawOutput = "forbidden";
  assert.throws(() => validateReceipt(unknown), /RECEIPT_SCHEMA_UNEXPECTED_KEY/);
});

// COV-07 BEGIN
test("COV-07 WP155 fixture builder keeps percent-encoded slug boundaries", async () => {
  const { extractFixtureSlug } = await import("./wp151-public-unavailable-browser-runner.mjs");
  const generated = buildWp151FixtureScript();
  assert.equal(generated.includes("const vendorId = vendor.id;"), true);
  assert.equal(extractFixtureSlug(generated).startsWith("wp149-unpublished-"), true);
  assert.equal(extractFixtureSlug('const page = { slug: "wp149-unpublished-%2Ffixture%20slug" };'), "wp149-unpublished-%2Ffixture%20slug");
  assert.throws(() => extractFixtureSlug('const page = { slug: "not-allowed" };'), /FIXTURE_SLUG_NOT_FOUND/);
});

test("COV-07 WP155 endpoint helper rejects external host, userinfo authority and bad protocol", () => {
  assert.equal(normalizeLoopbackEndpoint("http://127.0.0.1:32155/p/example"), "http://127.0.0.1:32155");
  assert.equal(normalizeLoopbackEndpoint("https://[::1]:4443/p/example"), "https://[::1]:4443");
  assert.throws(() => normalizeLoopbackEndpoint("http://127.0.0.1:32155@evil.example/p/example"), /LOOPBACK_URL_NOT_ALLOWED/);
  assert.throws(() => normalizeLoopbackEndpoint("ftp://127.0.0.1:32155/p/example"), /LOOPBACK_URL_NOT_ALLOWED/);
  assert.throws(() => normalizeLoopbackEndpoint("http://127.0.0.1:0/p/example"), /LOOPBACK_PORT_INVALID/);
});

test("COV-07 WP155 readiness helper records cleanup and ignores terminal events", () => {
  let machine = { state: READINESS_STATES.NOT_STARTED, markerSeen: false, probeSeen: false, spawnCount: 0, ignoredEvents: 0, events: [] };
  machine = readinessTransition(machine, "SPAWN_REJECTED");
  assert.equal(machine.state, READINESS_STATES.EARLY_EXIT);
  const cleaned = readinessTransition(machine, "CLEANUP");
  assert.equal(cleaned.state, READINESS_STATES.CLEANED);
  const ignored = readinessTransition(cleaned, "SPAWN_REQUEST");
  assert.equal(ignored.ignoredEvents, 1);
  assert.throws(() => readinessTransition({ ...machine, state: "UNKNOWN" }, "CLEANUP"), /READINESS_MACHINE_INVALID/);
});

test("COV-07 WP155 receipt round-trip rejects version, status and safety tampering", () => {
  const receipt = makeReceipt();
  assert.equal(validateReceipt(JSON.parse(JSON.stringify(receipt))), true);
  const versionTampered = structuredClone(receipt);
  versionTampered.schemaVersion = "wp155-public-unavailable-browser/v2";
  assert.throws(() => validateReceipt(versionTampered), /RECEIPT_SCHEMA_INVALID/);
  const statusTampered = structuredClone(receipt);
  statusTampered.status = "UNKNOWN";
  assert.throws(() => validateReceipt(statusTampered), /RECEIPT_STATUS_INVALID/);
  const safetyTampered = structuredClone(receipt);
  safetyTampered.sourceEnvContentsRead = true;
  assert.throws(() => validateReceipt(safetyTampered), /RECEIPT_SAFETY_INVALID/);
});

test("COV-09 WP155 environment and protected digest snapshots stay sanitized", () => {
  const environment = syntheticEnvironment();
  assert.equal(environment.NODE_ENV, "development");
  assert.equal(environment.CI, "true");
  assert.equal(environment.PAYMENT_PROVIDER, "demo");
  assert.equal(environment.RATE_LIMIT_PROVIDER, "memory");
  assert.equal(environment.PSQLRC, "");
  assert.equal(environment.DATABASE_URL.includes("127.0.0.1"), true);
  assert.equal(nextMetadataSnapshot().exists === true || nextMetadataSnapshot().exists === false, true);
  const snapshot = protectedDigestSnapshot();
  assert.equal(Object.keys(snapshot).length > 0, true);
  assert.equal(Object.values(snapshot).every((value) => /^sha256:[a-f0-9]{64}$/u.test(value)), true);
  assert.equal(/^sha256:[a-f0-9]{64}$/u.test(sha256File("package.json")), true);
});

test("COV-09 WP155 stream diagnostics classify without retaining raw output", () => {
  const child = { stdout: new EventEmitter(), stderr: new EventEmitter() };
  const diagnostics = { lineCount: 0, classifications: [], markerSeen: false };
  attachSanitizedStream(child, diagnostics);
  child.stdout.emit("data", "ready\n");
  child.stderr.emit("data", "Cannot find module 'next'\n");
  assert.equal(diagnostics.lineCount, 2);
  assert.equal(diagnostics.markerSeen, true);
  assert.deepEqual(diagnostics.classifications, ["MODULE_RESOLUTION"]);
  assert.equal(Object.hasOwn(diagnostics, "rawOutput"), false);
});

test("COV-09 WP155 receipt writer round-trips only a sanitized disposable receipt", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wp155-receipt-"));
  const target = path.join(directory, "receipt.json");
  try {
    const receipt = makeReceipt();
    assert.equal(writeReceipt(target, receipt), undefined);
    const roundTrip = JSON.parse(fs.readFileSync(target, "utf8"));
    assert.equal(roundTrip.status, "WP155_EXACT_NO_GO_NO_RETRY");
    assert.equal(roundTrip.rawOutputPersisted, false);
    assert.equal(fs.existsSync(`${target}.tmp-${process.pid}`), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("COV-09 WP155 preflight accepts the preserved local prerequisites without external execution", () => {
  const receipt = makeReceipt();
  preflightDependencyBoundary(receipt);
  assert.equal(receipt.quality.wp152Acceptance, "ACCEPT");
  assert.equal(receipt.quality.wp154Acceptance, "ACCEPT");
});

test("COV-11 WP155 subprocess normalization remains bounded", () => {
  const result = runQuiet(process.execPath, ["--version"], process.env);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdoutBytes > 0, true);
  assert.equal(result.stderrBytes, 0);
  assert.deepEqual(Object.keys(result).sort(), ["exitCode", "stderrBytes", "stdoutBytes"]);
});

test("COV-11 WP155 readiness fails closed on child early exit without fetch", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { status: 204 };
  };
  try {
    await assert.rejects(
      waitForServer("http://127.0.0.1:32155", { exitCode: 1 }, { markerSeen: false, probeSeen: false }),
      /SERVER_READINESS_EXACT_NO_GO:EARLY_EXIT/,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("COV-11 WP155 readiness reaches READY from a sanitized loopback probe", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async (url) => {
    fetchCalls += 1;
    assert.equal(url, "http://127.0.0.1:32155/login");
    return { status: 204 };
  };
  try {
    const readiness = await waitForServer(
      "http://127.0.0.1:32155",
      { exitCode: null },
      { markerSeen: true, probeSeen: false },
    );
    assert.equal(readiness.state, READINESS_STATES.READY);
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
// COV-07 END
