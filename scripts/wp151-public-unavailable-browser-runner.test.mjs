import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PassThrough } from "node:stream";

import {
  attachSanitizedStream,
  classifyServerOutput,
  extractFixtureSlug,
  makeReceipt,
  nextMetadataSnapshot,
  protectedDigestSnapshot,
  runQuiet,
  sha256File,
  syntheticEnvironment,
  validateWp151Receipt,
  waitForServer,
  writeReceipt,
} from "./wp151-public-unavailable-browser-runner.mjs";
import { fixtureScript } from "./wp149-public-unavailable-browser-runner.mjs";

test("WP151 preflight receipt is sanitized and no-go by default", () => {
  const receipt = makeReceipt();
  assert.equal(validateWp151Receipt(receipt), true);
  assert.equal(receipt.attempt, 0);
  assert.equal(receipt.browser.passed, 0);
  assert.equal(receipt.rawOutputPersisted, false);
});

test("WP150-remediated fixture exposes a stable synthetic slug and ordering", () => {
  const script = fixtureScript(false);
  const slug = extractFixtureSlug(script);
  assert.match(slug, /^wp149-unpublished-/);
  assert.match(script, /const vendorId = vendor\.id;/);
  assert.doesNotMatch(script, /const vendorId = \(await db\.vendor\.findUnique/);
});

test("server classifier returns only normalized categories", () => {
  assert.equal(classifyServerOutput("Error: failed to compile"), "SOURCE_OR_COMPILE_BOUNDARY");
  assert.equal(classifyServerOutput("listen EADDRINUSE"), "PORT_IN_USE");
  assert.equal(classifyServerOutput("ready"), null);
});

test("pass receipt requires one server attempt and two Browser cases", () => {
  const receipt = makeReceipt();
  receipt.status = "PASS";
  receipt.attempt = 1;
  receipt.server.attempts = 1;
  receipt.browser.passed = 2;
  assert.equal(validateWp151Receipt(receipt), true);
});

test("non-pass receipt cannot claim CAT06 score increase", () => {
  const receipt = makeReceipt();
  receipt.scoreImpact.CAT06.after = 7.5;
  assert.throws(() => validateWp151Receipt(receipt), /RECEIPT_NO_GO_SCORE_INVALID/);
});

test("fixture normalization and WP152 receipt validation fail closed across outcome branches", async () => {
  const {
    buildWp152FixtureReceipt,
    normalizeWp151FixtureScript,
    validateWp152FixtureReceipt,
  } = await import("./wp151-public-unavailable-browser-runner.mjs");
  const { FIXTURE_STATES, runPureFixtureLifecycle } = await import("./wp149-public-unavailable-browser-runner.mjs");
  const script = fixtureScript(false);
  const normalized = normalizeWp151FixtureScript(script);
  assert.match(normalized, /ctaLabel: "fixture CTA" \} \}\);/);
  assert.throws(() => normalizeWp151FixtureScript(""), /FIXTURE_SCRIPT_INVALID/);
  assert.throws(() => normalizeWp151FixtureScript(`${script}${script}`), /FIXTURE_SCRIPT_SHAPE_NOT_UNIQUE/);

  const created = runPureFixtureLifecycle({ create: () => undefined, cleanup: () => undefined });
  const receipt = buildWp152FixtureReceipt(created);
  assert.equal(receipt.fixtureState, FIXTURE_STATES.CLEANED);
  assert.equal(validateWp152FixtureReceipt(receipt), true);
  const unsafe = structuredClone(receipt);
  unsafe.sideEffects.database = 1;
  assert.throws(() => validateWp152FixtureReceipt(unsafe), /WP152_RECEIPT_SIDE_EFFECT_INVALID/);
  const noGo = buildWp152FixtureReceipt(created, "WP152_EXACT_NO_GO_ROOT_CAUSE_NOT_SAFELY_DETERMINABLE");
  assert.equal(noGo.classification, "WP152_EXACT_NO_GO_ROOT_CAUSE_NOT_SAFELY_DETERMINABLE");
});

// COV-07 BEGIN
test("COV-07 WP151 fixture builder preserves slug encoding and rejects malformed scripts", async () => {
  const { buildWp151FixtureScript, normalizeWp151FixtureScript } = await import("./wp151-public-unavailable-browser-runner.mjs");
  const generated = buildWp151FixtureScript();
  assert.equal(generated.includes("const vendorId = vendor.id;"), true);
  assert.equal(extractFixtureSlug(generated).startsWith("wp149-unpublished-"), true);
  assert.equal(extractFixtureSlug('const page = { slug: "wp149-unpublished-%2Ffixture%20slug" };'), "wp149-unpublished-%2Ffixture%20slug");
  assert.throws(() => extractFixtureSlug('const page = { slug: "external-fixture" };'), /FIXTURE_SLUG_NOT_FOUND/);
  assert.throws(() => normalizeWp151FixtureScript(`${fixtureScript(false)}${fixtureScript(false)}`), /FIXTURE_SCRIPT_SHAPE_NOT_UNIQUE/);
});

test("COV-07 WP151 receipt round-trip and safety tampering remain fail-closed", () => {
  const receipt = makeReceipt();
  const roundTrip = JSON.parse(JSON.stringify(receipt));
  assert.equal(validateWp151Receipt(roundTrip), true);
  const versionTampered = structuredClone(receipt);
  versionTampered.schemaVersion = "wp151-public-unavailable-browser/v2";
  assert.throws(() => validateWp151Receipt(versionTampered), /RECEIPT_SCHEMA_INVALID/);
  const safetyTampered = structuredClone(receipt);
  safetyTampered.sourceEnvContentsRead = true;
  assert.throws(() => validateWp151Receipt(safetyTampered), /RECEIPT_SAFETY_INVALID/);
  const sideEffectTampered = structuredClone(receipt);
  sideEffectTampered.sideEffects.network = 1;
  assert.throws(() => validateWp151Receipt(sideEffectTampered), /RECEIPT_SIDE_EFFECT_INVALID/);
});

test("COV-07 WP151 output classifier applies the most specific precedence", () => {
  assert.equal(classifyServerOutput("fatal EADDRINUSE while listening"), "PORT_IN_USE");
  assert.equal(classifyServerOutput("Error: Cannot find module 'next'"), "MODULE_RESOLUTION");
  assert.equal(classifyServerOutput("TypeError: failed to compile route"), "SOURCE_OR_COMPILE_BOUNDARY");
  assert.equal(classifyServerOutput("uncaught fatal server failure"), "SERVER_START_UNKNOWN");
  assert.equal(classifyServerOutput("ready"), null);
});

test("COV-07 WP151 fixture receipt builder validates lifecycle and tamper branches", async () => {
  const { buildWp152FixtureReceipt, validateWp152FixtureReceipt } = await import("./wp151-public-unavailable-browser-runner.mjs");
  const { FIXTURE_STATES, runPureFixtureLifecycle } = await import("./wp149-public-unavailable-browser-runner.mjs");
  const lifecycle = runPureFixtureLifecycle({ create: () => undefined, cleanup: () => undefined });
  const receipt = buildWp152FixtureReceipt(lifecycle);
  assert.deepStrictEqual({ fixtureState: receipt.fixtureState, createCalls: receipt.createCalls, cleanupCalls: receipt.cleanupCalls }, { fixtureState: FIXTURE_STATES.CLEANED, createCalls: 1, cleanupCalls: 1 });
  assert.equal(validateWp152FixtureReceipt(JSON.parse(JSON.stringify(receipt))), true);
  const stateTampered = structuredClone(receipt);
  stateTampered.fixtureState = "UNKNOWN";
  assert.throws(() => validateWp152FixtureReceipt(stateTampered), /WP152_RECEIPT_ATTEMPT_INVALID/);
});

// COV-08 BEGIN
test("WP151 synthetic environment and metadata snapshot remain bounded", () => {
  const environment = syntheticEnvironment();
  assert.equal(environment.NODE_ENV, "development");
  assert.equal(environment.CI, "true");
  assert.match(environment.E2E_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(environment.NPM_CONFIG_OFFLINE, "true");
  const metadata = nextMetadataSnapshot();
  assert.deepEqual(Object.keys(metadata).sort(), ["exists", "mtimeMs", "size"]);
  assert.equal(typeof metadata.exists, "boolean");
});

test("WP151 sanitized stream keeps only normalized diagnostic categories", () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const diagnostics = { classifications: [] };
  attachSanitizedStream({ stdout, stderr }, diagnostics);
  stdout.write("ready\nError: Cannot find module 'next'\n");
  stderr.write("fatal server failure\nlisten EADDRINUSE\n");
  assert.deepEqual(diagnostics.classifications, ["MODULE_RESOLUTION", "SERVER_START_UNKNOWN", "PORT_IN_USE"]);
  stdout.end();
  stderr.end();
});

test("WP151 protected digests and receipt writer preserve sanitized lineage", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-wp151-test-"));
  try {
    fs.writeFileSync(path.join(tempRoot, "fixture.txt"), "synthetic fixture\n", "utf8");
    assert.match(sha256File("fixture.txt", tempRoot), /^sha256:[0-9a-f]{64}$/);
    const snapshot = protectedDigestSnapshot();
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

test("WP151 subprocess normalization keeps only bounded result fields", () => {
  const result = runQuiet(process.execPath, ["--version"], process.env);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdoutBytes > 0, true);
  assert.equal(result.stderrBytes, 0);
  assert.deepEqual(Object.keys(result).sort(), ["exitCode", "stderrBytes", "stdoutBytes"]);
});

test("WP151 readiness fails closed on pre-readiness child exit without fetching", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { status: 204 };
  };
  try {
    await assert.rejects(
      waitForServer("http://127.0.0.1:32151", { exitCode: 1 }),
      /SERVER_PRE_READINESS_EXACT_NO_GO/,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WP151 readiness accepts a loopback success response", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async (url) => {
    fetchCalls += 1;
    assert.equal(url, "http://127.0.0.1:32151/login");
    return { status: 204 };
  };
  try {
    await assert.doesNotReject(waitForServer("http://127.0.0.1:32151", { exitCode: null }));
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
// COV-08 END
// COV-07 END
