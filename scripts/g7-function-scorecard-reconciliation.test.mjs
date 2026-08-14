import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scorecardPath = path.join(root, "docs", "launch", "current-function-scorecard-20260809.json");
const scorecard = JSON.parse(fs.readFileSync(scorecardPath, "utf8"));

const expectedFunctionIds = [
  "merchant_onboarding_settings",
  "product_catalog",
  "image_video_media",
  "live_studio",
  "registration_form_builder",
  "interaction_roles",
  "email_notifications",
  "checkout_payment",
  "orders_fulfillment",
  "refund_support",
  "finance_commission_payout",
  "team_stream_operations",
];
const expectedCategoryIds = Array.from({ length: 10 }, (_, index) => `CAT${String(index + 1).padStart(2, "0")}`);

function digest(relativePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
}

test("fixed function inventory is complete, unique and every candidate is at least seven", () => {
  const ids = scorecard.fixedFunctions.map((entry) => entry.id);
  assert.deepEqual(ids, expectedFunctionIds);
  assert.equal(new Set(ids).size, expectedFunctionIds.length);
  assert.equal(scorecard.allFixedFunctionsAtLeast7, true);

  for (const entry of scorecard.fixedFunctions) {
    assert.ok(entry.score >= 7 && entry.score <= 10, `${entry.id} has an invalid candidate score`);
    assert.ok(entry.dimensions.core >= 2, `${entry.id} cannot reach seven with core below two`);
    assert.ok(entry.dimensions.freshEvidence > 0, `${entry.id} cannot reach seven without fresh evidence`);
    const total = Object.values(entry.dimensions).reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(total - entry.score) < 1e-9, `${entry.id} rubric does not sum to its score`);
  }
});

test("every function evidence path exists and matches its declared SHA-256", () => {
  for (const entry of scorecard.fixedFunctions) {
    assert.equal(digest(entry.evidence.path), entry.evidence.sha256, `${entry.id} evidence drifted`);
  }
});

test("canonical truth is 75.5 and only CAT04 and CAT10 are below seven", () => {
  assert.deepEqual(Object.keys(scorecard.canonical.categories), expectedCategoryIds);
  const total = Object.values(scorecard.canonical.categories).reduce((sum, value) => sum + value, 0);
  assert.equal(total, scorecard.canonical.total);
  assert.equal(scorecard.canonical.total, 75.5);
  assert.equal(scorecard.canonical.allAtLeast7, false);
  assert.deepEqual(
    Object.entries(scorecard.canonical.categories).filter(([, score]) => score < 7).map(([category]) => category),
    ["CAT04", "CAT10"],
  );

  const source = JSON.parse(fs.readFileSync(path.join(root, scorecard.canonical.source.path), "utf8"));
  assert.equal(digest(scorecard.canonical.source.path), scorecard.canonical.source.sha256);
  assert.equal(source.total, scorecard.canonical.total);
  for (const category of expectedCategoryIds) assert.equal(source.categories[category].score, scorecard.canonical.categories[category]);
});

test("external blockers stay explicit and autonomous work remains product-first", () => {
  assert.deepEqual(scorecard.externalOrHumanBlockers.map((entry) => entry.category), ["CAT04", "CAT10"]);
  assert.deepEqual(scorecard.externalOrHumanBlockers[0].forbiddenRetry, ["FIN-08AA", "WP-196", "WP-197"]);
  assert.equal(scorecard.nextAutonomousLane, "FUNC_CLOSURE");
  assert.equal(scorecard.goalStatus, "ACTIVE");
});
