import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  formatReleaseEvidenceBundleValidation,
  REQUIRED_RELEASE_GATES,
  runReleaseEvidenceBundleCli,
  validateReleaseEvidenceBundle,
} from "./validate-release-evidence-bundle.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATE_CLASSES = {
  remote_ci: "REMOTE_CI",
  staging_lineage: "STAGING_LINEAGE",
  staging_migration: "STAGING_MIGRATION",
  staging_recovery: "STAGING_RECOVERY",
  staging_rollback: "STAGING_ROLLBACK",
  cloudflare_stream: "EXTERNAL_PROVIDER",
  resend: "EXTERNAL_PROVIDER",
  sentry: "EXTERNAL_PROVIDER",
  posthog: "EXTERNAL_PROVIDER",
  durable_rate_limit: "EXTERNAL_PROVIDER",
  payuni_sandbox_reconciliation: "PAYMENT_RECONCILIATION",
  policy_review: "POLICY",
  human_owner_acceptance: "HUMAN_ACCEPTANCE",
};

function bundle(overrides = {}) {
  const sourceCommit = "8e8fe08";
  const gates = REQUIRED_RELEASE_GATES.map((gateId) => ({
    gateId,
    evidenceClass: GATE_CLASSES[gateId],
    result: "PASS",
    sourceCommit,
    evidenceRef: `opaque:evidence-${gateId}`,
    ownerRef: `opaque:owner-${gateId}`,
    scopeRef: `opaque:scope-${gateId}`,
    capturedAt: "2026-08-21T05:00:00Z",
    sanitized: true,
    failureReason: null,
  }));
  return {
    schemaVersion: "celebratedeal-release-evidence-bundle/v1",
    capturedAt: "2026-08-21T05:00:00Z",
    sourceCommit,
    governanceVersion: "solo-founder-launch/v1",
    environment: "non-production",
    nonProduction: true,
    sanitized: true,
    sensitiveDataPersisted: false,
    rawDataPersisted: false,
    productionApproval: false,
    productionOperations: 0,
    releaseDecision: "GO",
    gates,
    ...overrides,
  };
}

const readFixture = {
  realpath: async (candidate) => candidate,
  readFile: async () => JSON.stringify(bundle()),
};

test("bundle validator is read-only and has no environment, network, process or write side effects", async () => {
  const source = await fsp.readFile(path.join(ROOT, "scripts", "validate-release-evidence-bundle.mjs"), "utf8");
  assert.doesNotMatch(source, /process\.env|\bfetch\s*\(|node:(?:http|https|child_process)|\b(?:writeFile|mkdir|rm|spawn|exec)\s*\(/u);
  const result = await runReleaseEvidenceBundleCli(["docs/ai-team/evidence/release-evidence-bundle.json"], readFixture, ROOT);
  assert.deepEqual(result, { ok: true, result: "CANDIDATE" });
});

test("complete current-source bundle is a release candidate without Production approval", () => {
  assert.deepEqual(validateReleaseEvidenceBundle(bundle()), { ok: true, errors: [], result: "CANDIDATE" });
});

test("all required gates and source lineage are exact", () => {
  const invalid = bundle();
  invalid.gates[0].sourceCommit = "1ceb9a5";
  invalid.gates.pop();
  const result = validateReleaseEvidenceBundle(invalid);
  assert.equal(result.ok, false);
  assert.equal(result.errors.includes("GATE_SET"), true);
  assert.equal(result.errors.includes("SOURCE_LINEAGE:remote_ci"), true);
});

test("pending external or human gates aggregate to incomplete", () => {
  const pending = bundle({ releaseDecision: "NO_GO" });
  pending.gates[0] = { ...pending.gates[0], result: "NOT_PROVEN", failureReason: "REMOTE_CI_RUN_MISSING" };
  pending.gates.at(-1).result = "PENDING_HUMAN";
  pending.gates.at(-1).failureReason = "HUMAN_ACCEPTANCE_MISSING";
  assert.deepEqual(validateReleaseEvidenceBundle(pending), { ok: true, errors: [], result: "INCOMPLETE" });
});

test("blocked or failed gates aggregate to blocked", () => {
  const blocked = bundle({ releaseDecision: "NO_GO" });
  blocked.gates[2] = { ...blocked.gates[2], result: "BLOCKED", failureReason: "VALIDATION_BLOCKED" };
  assert.deepEqual(validateReleaseEvidenceBundle(blocked), { ok: true, errors: [], result: "BLOCKED" });
});

test("GO cannot bypass a non-PASS gate", () => {
  const invalid = bundle();
  invalid.gates[10] = { ...invalid.gates[10], result: "PENDING_EXTERNAL", failureReason: "PAYUNI_RECONCILIATION_MISSING" };
  const result = validateReleaseEvidenceBundle(invalid);
  assert.equal(result.ok, false);
  assert.equal(result.errors.includes("GO_WITH_NONPASS_GATE"), true);
});

test("NO_GO remains explicit even when every gate is schema-valid", () => {
  assert.deepEqual(validateReleaseEvidenceBundle(bundle({ releaseDecision: "NO_GO" })), { ok: true, errors: [], result: "NO_GO" });
});

test("synthetic, sensitive, raw and Production claims are rejected", () => {
  const synthetic = bundle();
  synthetic.gates[0].evidenceRef = "opaque:synthetic-ci";
  assert.equal(validateReleaseEvidenceBundle(synthetic).ok, false);

  const sensitive = bundle();
  sensitive.gates[0].evidenceRef = "https://provider.invalid/secret";
  assert.equal(validateReleaseEvidenceBundle(sensitive).ok, false);

  const production = bundle();
  production.productionApproval = true;
  assert.equal(validateReleaseEvidenceBundle(production).ok, false);

  const raw = bundle();
  raw.rawProviderPayload = { status: "ok" };
  assert.equal(validateReleaseEvidenceBundle(raw).ok, false);
});

test("failure reasons and PASS fields use closed semantics", () => {
  const invalid = bundle();
  invalid.gates[1].failureReason = "free-form diagnostic";
  invalid.gates[2].failureReason = "VALIDATION_BLOCKED";
  const result = validateReleaseEvidenceBundle(invalid);
  assert.equal(result.ok, false);
  assert.equal(result.errors.includes("PASS_FAILURE_REASON:staging_lineage"), true);
  assert.equal(result.errors.includes("PASS_FAILURE_REASON:staging_migration"), true);
});

test("CLI output is fixed and does not echo release or evidence references", async () => {
  const result = await runReleaseEvidenceBundleCli(["docs/ai-team/evidence/release-evidence-bundle.json"], readFixture, ROOT);
  const output = formatReleaseEvidenceBundleValidation(result);
  assert.equal(output, "release_evidence_bundle_validation=PASS; result=CANDIDATE; release_decision=opaque; production_approval=false; sanitized=true");
  assert.doesNotMatch(output, /GO|evidence-remote_ci|8e8fe08/u);
});

test("traversal, sensitive paths and symlink escapes are rejected", async () => {
  assert.equal((await runReleaseEvidenceBundleCli(["docs/ai-team/evidence/../.env"], readFixture, ROOT)).reason, "invalid_path");
  assert.equal((await runReleaseEvidenceBundleCli(["docs/ai-team/evidence/release-secret-bundle.json"], readFixture, ROOT)).reason, "invalid_path");
  const outside = {
    realpath: async (candidate) => candidate.endsWith("release-evidence-bundle.json") ? "C:\\outside\\release-evidence-bundle.json" : candidate,
    readFile: async () => { throw new Error("must not read escaped path"); },
  };
  assert.equal((await runReleaseEvidenceBundleCli(["docs/ai-team/evidence/release-evidence-bundle.json"], outside, ROOT)).reason, "invalid_path");
});

test("missing path and invalid JSON have fixed failure reasons", async () => {
  assert.equal(formatReleaseEvidenceBundleValidation(await runReleaseEvidenceBundleCli([], readFixture, ROOT)), "release_evidence_bundle_validation=FAIL; reason=receipt_path_required");
  const invalidJson = { realpath: async (candidate) => candidate, readFile: async () => "not-json" };
  assert.equal((await runReleaseEvidenceBundleCli(["docs/ai-team/evidence/release-evidence-bundle.json"], invalidJson, ROOT)).reason, "invalid_json");
});
