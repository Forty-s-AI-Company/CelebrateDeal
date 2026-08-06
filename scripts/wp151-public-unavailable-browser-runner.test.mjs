import assert from "node:assert/strict";
import test from "node:test";

import { classifyServerOutput, extractFixtureSlug, makeReceipt, validateWp151Receipt } from "./wp151-public-unavailable-browser-runner.mjs";
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
// COV-07 END
