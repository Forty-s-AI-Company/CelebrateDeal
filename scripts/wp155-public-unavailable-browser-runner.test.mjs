import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import { buildWp151FixtureScript } from "./wp151-public-unavailable-browser-runner.mjs";
import { makeReceipt, normalizeLoopbackEndpoint, readinessTransition, validateReceipt } from "./wp155-public-unavailable-browser-runner.mjs";
import { READINESS_STATES } from "./wp153-public-unavailable-browser-runner.mjs";

const wp153ReceiptPath = ".ai-team/reports/wp153-public-unavailable-browser-receipt.json";
const wp154ReportPath = ".ai-team/reports/wp154-wp153-readiness-contract-remediation.json";

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
// COV-07 END
