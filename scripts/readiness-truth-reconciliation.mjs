import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = path.join(root, "docs/launch/current-readiness-snapshot-20260802.json");
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const wp148Receipt = JSON.parse(fs.readFileSync(path.join(root, ".ai-team/reports/wp148-local-reliability-contract.json"), "utf8"));
const expectedScores = [7.5, 8, 8, 6, 8.5, 7, 9, 7.5, 7.5, 4.5];
const categories = Object.values(snapshot.categories);
const total = categories.reduce((sum, category) => sum + category.score, 0);
assert.equal(snapshot.status, "CURRENT_TRUTH");
assert.equal(categories.length, 10);
assert.deepEqual(categories.map((category) => category.score), expectedScores);
assert.equal(total, 73.5);
assert.equal(snapshot.total, total);
assert.equal(snapshot.gates.G1.status, "CLOSED");
assert.equal(snapshot.readiness_labels.SANDBOX_READY, false);
assert.equal(snapshot.readiness_labels.PRODUCTION_READY, false);
assert.equal(snapshot.score_change_in_wp119, 0);
assert.equal(snapshot.score_change_in_wp122, 0.5);
assert.equal(snapshot.score_change_in_wp123, 0.5);
assert.equal(snapshot.score_change_in_wp131, 0.5);
assert.equal(snapshot.score_change_in_wp148, 0.5);
assert.equal(snapshot.score_change_in_wp175, 0.5);
assert.equal(snapshot.score_change_in_wp187, 0.5);
assert.equal(snapshot.score_change_in_wp192, 0.5);
assert.equal(snapshot.score_change_in_wp195, 0.5);
assert.equal(snapshot.staging_gates.ROLLBACK.status, "CLOSED_FOR_STAGING");
assert.equal(snapshot.wp192_scope.production_ready, false);
assert.equal(snapshot.wp192_scope.sol_acceptance, "ACCEPT");
assert.equal(snapshot.wp195_scope.manual_signatures, "PENDING");
assert.equal(snapshot.wp195_scope.release_status, "HOLD_NOT_READY");
assert.equal(snapshot.wp195_scope.overall_commercial_readiness, "NOT_READY");
assert.equal(snapshot.wp195_scope.production_ready, false);
assert.equal(snapshot.wp195_scope.sol_acceptance, "ACCEPT");
assert.equal(snapshot.wp122_scope.overall_readiness, "NOT_READY");
assert.equal(snapshot.wp123_scope.external_telemetry, "PENDING");
assert.equal(snapshot.wp148_scope.local_contract, "ACCEPTED");
assert.equal(wp148Receipt.classification, "LOCAL_RELIABILITY_DIAGNOSTIC_CONTRACT_VERIFIED");
assert.equal(wp148Receipt.externalTelemetry, "NOT_COLLECTED");
assert.equal(wp148Receipt.scoreImpact.CAT08.applied, false);
assert.ok(snapshot.categories.CAT10.provenance.includes(".ai-team/reports/wp122-merchant-onboarding-receipt.json"));
assert.ok(snapshot.categories.CAT08.provenance.includes(".ai-team/reports/wp123-observability-rehearsal-receipt.json"));
assert.ok(snapshot.categories.CAT08.provenance.includes(".ai-team/reports/wp148-local-reliability-contract.json"));
assert.ok(snapshot.categories.CAT01.provenance.includes(".ai-team/reports/wp131-cloudflare-stream-webhook-idempotency-receipt.json"));
assert.ok(snapshot.categories.CAT09.provenance.includes(".ai-team/reports/wp187-latest-workspace-preview-freshness.json"));
assert.ok(snapshot.categories.CAT09.provenance.includes(".ai-team/reports/wp192-staging-alias-propagation-verification.json"));
assert.ok(snapshot.categories.CAT10.provenance.includes(".ai-team/reports/wp175-sales-to-support-operational-rehearsal-receipt.json"));
assert.ok(snapshot.categories.CAT10.provenance.includes(".ai-team/reports/wp195-launch-owner-acceptance.json"));
for (const category of categories) {
  assert.ok(category.provenance.length > 0, `Missing provenance for ${category.name}`);
  for (const relativePath of category.provenance) assert.ok(fs.existsSync(path.join(root, relativePath)), `Missing provenance: ${relativePath}`);
}
for (const gate of Object.values(snapshot.gates)) {
  for (const relativePath of gate.provenance) assert.ok(fs.existsSync(path.join(root, relativePath)), `Missing gate provenance: ${relativePath}`);
}
for (const gate of Object.values(snapshot.staging_gates)) {
  for (const relativePath of gate.provenance) assert.ok(fs.existsSync(path.join(root, relativePath)), `Missing staging gate provenance: ${relativePath}`);
}
for (const relativePath of snapshot.superseded_legacy_sources) assert.ok(fs.existsSync(path.join(root, relativePath)), `Missing superseded source: ${relativePath}`);

const currentMarkdown = fs.readFileSync(path.join(root, "docs/launch/current-readiness-snapshot-20260802.md"), "utf8");
assert.match(currentMarkdown, /73\.5\/100/);
assert.match(currentMarkdown, /G1 = CLOSED/);
assert.doesNotMatch(currentMarkdown, /58\/100|G1 = BLOCKED|CAT-03[^\n]*6\.0/);
assert.match(currentMarkdown, /SANDBOX_READY = false/);
assert.match(currentMarkdown, /PRODUCTION_READY = false/);
assert.match(currentMarkdown, /STAGING_ROLLBACK_GATE = CLOSED_FOR_STAGING/);

console.log(JSON.stringify({
  work_package: "WP-195",
  status: "PASS",
  total,
  category_count: categories.length,
  g1: snapshot.gates.G1.status,
  sandbox_ready: snapshot.readiness_labels.SANDBOX_READY,
  production_ready: snapshot.readiness_labels.PRODUCTION_READY,
  legacy_sources_classified: snapshot.superseded_legacy_sources.length,
  score_change: snapshot.score_change_in_wp195,
  staging_rollback_gate: snapshot.staging_gates.ROLLBACK.status,
  wp131_score_change: snapshot.score_change_in_wp131,
}));
