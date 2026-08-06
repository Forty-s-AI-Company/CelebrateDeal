import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import {
  FIXTURE_STATES,
  buildFixtureLifecycleReceipt,
  runPureFixtureLifecycle,
  validateFixtureLifecycleReceipt,
} from "./wp149-public-unavailable-browser-runner.mjs";
import {
  buildWp151FixtureScript,
  buildWp152FixtureReceipt,
  normalizeWp151FixtureScript,
  validateWp152FixtureReceipt,
} from "./wp151-public-unavailable-browser-runner.mjs";

const terminalReceiptPath = ".ai-team/reports/wp151-public-unavailable-browser-receipt.json";

test("WP-151 fixture normalization repairs exactly the generated closing boundary", () => {
  const normalized = buildWp151FixtureScript();
  assert.match(normalized, /ctaLabel: "fixture CTA" \} \}\);/);
  assert.doesNotMatch(normalized, /ctaLabel: "fixture CTA" \}\);/);
  assert.match(normalized, /const vendorId = vendor\.id;/);
});

test("fixture normalization fails closed when the expected shape is not unique", () => {
  assert.throws(() => normalizeWp151FixtureScript("const vendorId = vendor.id;"), /FIXTURE_SCRIPT_SHAPE_NOT_UNIQUE/);
});

test("pure valid lifecycle reaches test-only ready without server, Browser, DB, or network", () => {
  const calls = [];
  const result = runPureFixtureLifecycle({
    create: () => calls.push("create"),
    cleanup: () => calls.push("cleanup"),
  });
  assert.equal(result.state, FIXTURE_STATES.CLEANED);
  assert.deepEqual(calls, ["create", "cleanup"]);
  const receipt = buildWp152FixtureReceipt(result);
  assert.equal(receipt.classification, "WP152_WP151_FIXTURE_CONTRACT_REMEDIATED_READY");
  assert.equal(validateWp152FixtureReceipt(receipt), true);
  assert.equal(receipt.serverAttempts, 0);
  assert.equal(receipt.browserCompleted, 0);
  assert.deepEqual(receipt.sideEffects, { network: 0, database: 0, provider: 0, payuni: 0, staging: 0, production: 0, server: 0, browser: 0 });
});

test("invalid create and cleanup paths remain exact no-go and preserve WP-149 contract", () => {
  const failedCreate = runPureFixtureLifecycle({ create: () => { throw new Error("must not execute"); }, cleanup: () => undefined }, { createFailure: true });
  const createReceipt = buildWp152FixtureReceipt(failedCreate, "WP152_EXACT_NO_GO_ROOT_CAUSE_NOT_SAFELY_DETERMINABLE");
  assert.equal(failedCreate.state, FIXTURE_STATES.CLEANED);
  assert.equal(createReceipt.attempt, 0);
  assert.equal(createReceipt.serverAttempts, 0);
  assert.equal(createReceipt.browserCompleted, 0);
  const wp149Receipt = buildFixtureLifecycleReceipt(failedCreate);
  assert.equal(validateFixtureLifecycleReceipt(wp149Receipt), true);
});

test("WP-151 terminal receipt is immutable and receipt paths reject forbidden fields", () => {
  const before = crypto.createHash("sha256").update(fs.readFileSync(terminalReceiptPath)).digest("hex");
  const receipt = JSON.parse(fs.readFileSync(terminalReceiptPath, "utf8"));
  assert.equal(receipt.status, "FIXTURE_CONTRACT_EXACT_NO_GO");
  assert.equal(receipt.attempt, 0);
  const after = crypto.createHash("sha256").update(fs.readFileSync(terminalReceiptPath)).digest("hex");
  assert.equal(after, before);

  const safe = buildWp152FixtureReceipt(runPureFixtureLifecycle({ create: () => undefined, cleanup: () => undefined }));
  safe.rawOutput = "synthetic-raw";
  assert.throws(() => validateWp152FixtureReceipt(safe), /WP152_RECEIPT_SAFETY_INVALID/);
});

test("WP-152 receipt normalization is stable and side-effect free", () => {
  const result = runPureFixtureLifecycle({ create: () => undefined, cleanup: () => undefined });
  const first = JSON.stringify(buildWp152FixtureReceipt(result));
  const second = JSON.stringify(buildWp152FixtureReceipt(result));
  assert.equal(first, second);
  assert.doesNotMatch(first, /synthetic-raw|secret|token|cookie|stack/i);
});
