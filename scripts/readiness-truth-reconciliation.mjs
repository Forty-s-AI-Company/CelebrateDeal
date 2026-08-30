import crypto from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = path.join(root, "docs/launch/current-readiness-snapshot-20260802.json");
const snapshotMarkdownPath = path.join(root, "docs/launch/current-readiness-snapshot-20260802.md");
const provenanceManifestPath = path.join(root, "docs/launch/current-readiness-provenance-manifest.json");
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const provenanceManifest = JSON.parse(fs.readFileSync(provenanceManifestPath, "utf8"));
const expectedScores = [8.5, 8.5, 8, 6, 8.5, 7, 9, 8, 7.5, 4.5];
const categories = Object.values(snapshot.categories);
const total = categories.reduce((sum, category) => sum + category.score, 0);

const sha256File = (absolutePath) => `sha256:${crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex")}`;
const allSnapshotProvenance = [
  ...categories.flatMap((category) => category.provenance),
  ...Object.values(snapshot.gates).flatMap((gate) => gate.provenance),
  ...Object.values(snapshot.staging_gates).flatMap((gate) => gate.provenance),
  ...snapshot.superseded_legacy_sources,
];
const runtimeProvenancePaths = [...new Set(allSnapshotProvenance.filter((relativePath) => relativePath.startsWith(".ai-team/reports/")))].sort();
assert.equal(provenanceManifest.schemaVersion, "current-readiness-provenance/v1");
assert.equal(provenanceManifest.sourceSnapshot.json.path, "docs/launch/current-readiness-snapshot-20260802.json");
assert.equal(provenanceManifest.sourceSnapshot.json.sha256, sha256File(snapshotPath));
assert.equal(provenanceManifest.sourceSnapshot.markdown.path, "docs/launch/current-readiness-snapshot-20260802.md");
assert.equal(provenanceManifest.sourceSnapshot.markdown.sha256, sha256File(snapshotMarkdownPath));
assert.ok(Array.isArray(provenanceManifest.runtimeArtifacts));
const runtimeArtifacts = [...provenanceManifest.runtimeArtifacts].sort((left, right) => left.path.localeCompare(right.path));
assert.deepEqual(runtimeArtifacts.map((artifact) => artifact.path), runtimeProvenancePaths);
const runtimeArtifactByPath = new Map(runtimeArtifacts.map((artifact) => [artifact.path, artifact]));
for (const artifact of runtimeArtifacts) {
  assert.equal(artifact.sourceClass, "SANITIZED_LOCAL_RUNTIME_ARTIFACT");
  assert.match(artifact.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.ok(Number.isInteger(artifact.bytes) && artifact.bytes > 0);
  const absolutePath = path.join(root, artifact.path);
  if (fs.existsSync(absolutePath)) {
    assert.equal(sha256File(absolutePath), artifact.sha256, `Runtime artifact digest drifted: ${artifact.path}`);
    assert.equal(fs.statSync(absolutePath).size, artifact.bytes, `Runtime artifact size drifted: ${artifact.path}`);
  }
}
assert.ok(Array.isArray(provenanceManifest.ignoredProvenanceArtifacts));
const ignoredProvenanceArtifacts = [...provenanceManifest.ignoredProvenanceArtifacts].sort((left, right) => left.path.localeCompare(right.path));
const ignoredProvenanceByPath = new Map(ignoredProvenanceArtifacts.map((artifact) => [artifact.path, artifact]));
for (const artifact of ignoredProvenanceArtifacts) {
  assert.ok(allSnapshotProvenance.includes(artifact.path), `Ignored provenance is not referenced by snapshot: ${artifact.path}`);
  assert.equal(artifact.sourceClass, "SANITIZED_LOCAL_IGNORED_PROVENANCE_ARTIFACT");
  assert.match(artifact.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.ok(Number.isInteger(artifact.bytes) && artifact.bytes > 0);
  const absolutePath = path.join(root, artifact.path);
  if (fs.existsSync(absolutePath)) {
    assert.equal(sha256File(absolutePath), artifact.sha256, `Ignored provenance digest drifted: ${artifact.path}`);
    assert.equal(fs.statSync(absolutePath).size, artifact.bytes, `Ignored provenance size drifted: ${artifact.path}`);
  }
}
const wp148Receipt = provenanceManifest.wp148Summary;
assert.deepEqual(Object.keys(wp148Receipt).sort(), ["classification", "externalTelemetry", "labels", "rawOutputExposed", "rawOutputPersisted", "sanitized", "scoreImpact", "state"]);
assert.equal(snapshot.status, "CURRENT_TRUTH");
assert.equal(categories.length, 10);
assert.deepEqual(categories.map((category) => category.score), expectedScores);
assert.equal(total, 75.5);
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
assert.equal(snapshot.score_change_in_g7_23, 0.5);
assert.equal(snapshot.score_change_in_g7_48, 0.5);
assert.equal(snapshot.score_change_in_g7_49, 0.5);
assert.equal(snapshot.score_change_in_g7_51, 0.5);
assert.equal(snapshot.score_change_in_g7_53, 0);
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
assert.ok(snapshot.categories.CAT08.provenance.includes("docs/ai-team/evidence/g7-51-stream-retry-browser-qa-219b00b4693552be.json"));
assert.ok(snapshot.categories.CAT08.provenance.includes("docs/ai-team/evidence/g7-50-stream-quota-browser-qa-c3429009491880d7.json"));
assert.ok(snapshot.categories.CAT08.provenance.includes("docs/ai-team/evidence/g7-51-stream-heartbeat-reliability-20260810.md"));
assert.ok(snapshot.categories.CAT01.provenance.includes(".ai-team/reports/wp131-cloudflare-stream-webhook-idempotency-receipt.json"));
assert.ok(snapshot.categories.CAT01.provenance.includes(".ai-team/reports/g7-23-live-reminder-reconciliation-20260809.json"));
assert.ok(snapshot.categories.CAT01.provenance.includes("docs/ai-team/evidence/g7-48b-buyer-delivery-browser-qa-c0de9982255ebec7.json"));
assert.ok(snapshot.categories.CAT01.provenance.includes("docs/ai-team/evidence/g7-48-product-delivery-buyer-access-20260809.md"));
assert.equal(snapshot.g7_23_scope.final_review, "NO_P0_P1_FINAL");
assert.equal(snapshot.g7_23_scope.real_provider_delivery, "NOT_EXECUTED");
assert.equal(snapshot.g7_48_scope.result, "PASS_LOCAL_DISPOSABLE");
assert.equal(snapshot.g7_48_scope.full_refund_delivery_revocation, "PASS");
assert.equal(snapshot.g7_48_scope.external_provider_payment, "NOT_EXECUTED");
assert.equal(snapshot.g7_49_scope.result, "PASS_LOCAL_DISPOSABLE");
assert.equal(snapshot.g7_49_scope.final_review, "ELIGIBLE_CAT02_PLUS_0_5_NO_P0_P1");
assert.equal(snapshot.g7_49_scope.external_provider_payment, "NOT_EXECUTED");
assert.equal(snapshot.g7_51_scope.result, "PASS_LOCAL_DISPOSABLE");
assert.equal(snapshot.g7_51_scope.final_review, "PASS_NO_P0_P1_P2_BLOCKER");
assert.equal(snapshot.g7_51_scope.external_cloudflare_reconciliation, "NOT_EXECUTED");
assert.equal(snapshot.g7_53_scope.result, "PASS_LOCAL_DISPOSABLE");
assert.deepEqual(snapshot.g7_53_scope.registration_form_function_score, { before: 8.2, after: 8.7 });
assert.equal(snapshot.g7_53_scope.browser_contracts, "9/9 PASS");
assert.equal(snapshot.g7_53_scope.final_review, "ELIGIBLE_NO_P0_P1_P2");
assert.equal(snapshot.g7_53_scope.external_operations, "NOT_EXECUTED");
assert.ok(snapshot.categories.CAT02.provenance.includes("docs/ai-team/evidence/g7-49-onboarding-browser-qa-532104134ca28812.json"));
assert.ok(snapshot.categories.CAT02.provenance.includes("docs/ai-team/evidence/g7-49-merchant-onboarding-live-readiness-20260810.md"));
assert.ok(snapshot.categories.CAT09.provenance.includes(".ai-team/reports/wp187-latest-workspace-preview-freshness.json"));
assert.ok(snapshot.categories.CAT09.provenance.includes(".ai-team/reports/wp192-staging-alias-propagation-verification.json"));
assert.ok(snapshot.categories.CAT10.provenance.includes(".ai-team/reports/wp175-sales-to-support-operational-rehearsal-receipt.json"));
assert.ok(snapshot.categories.CAT10.provenance.includes(".ai-team/reports/wp195-launch-owner-acceptance.json"));
const assertProvenance = (relativePath, label) => {
  if (runtimeArtifactByPath.has(relativePath) || ignoredProvenanceByPath.has(relativePath)) return;
  assert.ok(fs.existsSync(path.join(root, relativePath)), `Missing provenance: ${label}`);
};
for (const category of categories) {
  assert.ok(category.provenance.length > 0, `Missing provenance for ${category.name}`);
  for (const relativePath of category.provenance) assertProvenance(relativePath, relativePath);
}
for (const gate of Object.values(snapshot.gates)) {
  for (const relativePath of gate.provenance) assertProvenance(relativePath, relativePath);
}
for (const gate of Object.values(snapshot.staging_gates)) {
  for (const relativePath of gate.provenance) assertProvenance(relativePath, relativePath);
}
for (const relativePath of snapshot.superseded_legacy_sources) assertProvenance(relativePath, relativePath);

const currentMarkdown = fs.readFileSync(path.join(root, "docs/launch/current-readiness-snapshot-20260802.md"), "utf8");
assert.match(currentMarkdown, /75\.5\/100/);
assert.match(currentMarkdown, /G1 = CLOSED/);
assert.doesNotMatch(currentMarkdown, /58\/100|G1 = BLOCKED|CAT-03[^\n]*6\.0/);
assert.match(currentMarkdown, /SANDBOX_READY = false/);
assert.match(currentMarkdown, /PRODUCTION_READY = false/);
assert.match(currentMarkdown, /STAGING_ROLLBACK_GATE = CLOSED_FOR_STAGING/);

console.log(JSON.stringify({
  work_package: "G7-54",
  status: "PASS",
  total,
  category_count: categories.length,
  g1: snapshot.gates.G1.status,
  sandbox_ready: snapshot.readiness_labels.SANDBOX_READY,
  production_ready: snapshot.readiness_labels.PRODUCTION_READY,
  legacy_sources_classified: snapshot.superseded_legacy_sources.length,
  score_change: snapshot.score_change_in_g7_53,
  staging_rollback_gate: snapshot.staging_gates.ROLLBACK.status,
  wp131_score_change: snapshot.score_change_in_wp131,
  g7_23_score_change: snapshot.score_change_in_g7_23,
  g7_48_score_change: snapshot.score_change_in_g7_48,
  g7_49_score_change: snapshot.score_change_in_g7_49,
  g7_51_score_change: snapshot.score_change_in_g7_51,
  g7_53_score_change: snapshot.score_change_in_g7_53,
  g7_54_score_change: snapshot.score_change_in_g7_54,
}));
