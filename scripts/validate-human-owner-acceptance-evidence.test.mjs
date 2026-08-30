import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  formatHumanOwnerAcceptanceValidation,
  runHumanOwnerAcceptanceCli,
  validateHumanOwnerAcceptanceReceipt,
} from "./validate-human-owner-acceptance-evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roles = {
  merchant_owner: ["owner_role_confirmed", "onboarding_handoff_reviewed", "merchant_impact_reviewed"],
  support_operator: ["support_queue_defined", "severity_path_reviewed", "escalation_owner_confirmed"],
  finance_owner: ["sandbox_boundary_reviewed", "refund_handoff_reviewed", "reconciliation_gap_acknowledged"],
  privacy_policy_owner: ["privacy_review_assigned", "data_request_path_reviewed", "retention_review_assigned"],
  release_owner: ["all_owner_packets_reviewed", "blockers_aggregated", "release_decision_recorded"],
};

function receipt(overrides = {}) {
  const responsibilities = Object.entries(roles).map(([roleId, checkIds]) => ({
    roleId,
    holderRef: `opaque:holder-${roleId}`,
    scopeRef: `opaque:scope-${roleId}`,
    manualSignatureRef: `opaque:signature-${roleId}`,
    decision: "ACCEPTED",
    checks: checkIds.map((checkId) => ({ checkId, status: "PASS", evidenceRef: `opaque:evidence-${roleId}-${checkId}`, sanitized: true })),
  }));
  return {
    schemaVersion: "celebratedeal-cat10-human-owner-acceptance/v1",
    packetRef: "opaque:packet-20260821",
    capturedAt: "2026-08-21T04:00:00Z",
    governanceVersion: "solo-founder-launch/v1",
    humanAttestation: true,
    responsibilities,
    policyReview: { terms: "ACCEPTED", privacy: "ACCEPTED", refunds: "ACCEPTED", retention: "ACCEPTED", dataRequest: "ACCEPTED" },
    supportEscalation: { intakeDefined: true, severityPathDefined: true, escalationOwnerConfirmed: true, evidenceRef: "opaque:support-evidence" },
    legalComplianceSelfReview: true,
    notIndependentLegalCounsel: true,
    releaseDecision: "GO",
    productionApproval: false,
    sanitized: true,
    sensitiveDataPersisted: false,
    ...overrides,
  };
}

const readFixture = {
  realpath: async (candidate) => candidate,
  readFile: async () => JSON.stringify(receipt()),
};

test("validator is read-only and has no environment, network, process or write side effects", async () => {
  const source = await fsp.readFile(path.join(ROOT, "scripts", "validate-human-owner-acceptance-evidence.mjs"), "utf8");
  assert.doesNotMatch(source, /process\.env|\bfetch\s*\(|node:(?:http|https|child_process)|\b(?:writeFile|mkdir|rm|spawn|exec)\s*\(/u);
  const result = await runHumanOwnerAcceptanceCli(["docs/ai-team/evidence/owner-acceptance-receipt.json"], readFixture, ROOT);
  assert.equal(result.ok, true);
});

test("complete human receipt is schema-valid but remains a non-Production candidate", () => {
  const result = validateHumanOwnerAcceptanceReceipt(receipt());
  assert.deepEqual(result, { ok: true, errors: [], result: "CANDIDATE" });
});

test("pending policy or owner checks remain incomplete", () => {
  const pending = receipt({ releaseDecision: "HOLD", policyReview: { terms: "ACCEPTED", privacy: "PENDING", refunds: "ACCEPTED", retention: "ACCEPTED", dataRequest: "ACCEPTED" } });
  pending.responsibilities[1].decision = "PENDING";
  pending.responsibilities[1].checks[0].status = "PENDING";
  assert.deepEqual(validateHumanOwnerAcceptanceReceipt(pending), { ok: true, errors: [], result: "INCOMPLETE" });
});

test("rejected or blocked evidence remains blocked", () => {
  const blocked = receipt({ releaseDecision: "NO_GO" });
  blocked.responsibilities[2].decision = "BLOCKED";
  blocked.responsibilities[2].checks[0].status = "BLOCKED";
  assert.deepEqual(validateHumanOwnerAcceptanceReceipt(blocked), { ok: true, errors: [], result: "BLOCKED" });
});

test("GO cannot bypass incomplete evidence", () => {
  const invalid = receipt({ policyReview: { terms: "ACCEPTED", privacy: "PENDING", refunds: "ACCEPTED", retention: "ACCEPTED", dataRequest: "ACCEPTED" } });
  invalid.responsibilities[0].decision = "PENDING";
  assert.equal(validateHumanOwnerAcceptanceReceipt(invalid).ok, false);
});

test("synthetic, sensitive and production claims are rejected", () => {
  const invalid = receipt({ packetRef: "opaque:synthetic-packet", productionApproval: true });
  assert.equal(validateHumanOwnerAcceptanceReceipt(invalid).ok, false);
  const sensitive = receipt({ packetRef: "https://provider.invalid/secret" });
  assert.equal(validateHumanOwnerAcceptanceReceipt(sensitive).ok, false);
});

test("role and check sets are exact", () => {
  const invalid = receipt();
  invalid.responsibilities.pop();
  invalid.responsibilities[0].checks.pop();
  const result = validateHumanOwnerAcceptanceReceipt(invalid);
  assert.equal(result.ok, false);
  assert.equal(result.errors.includes("ROLE_SET"), true);
  assert.equal(result.errors.includes("CHECK_SET:merchant_owner"), true);
});

test("CLI output is fixed and does not echo release or holder references", async () => {
  const result = await runHumanOwnerAcceptanceCli(["docs/ai-team/evidence/owner-acceptance-receipt.json"], readFixture, ROOT);
  const output = formatHumanOwnerAcceptanceValidation(result);
  assert.equal(output, "human_owner_acceptance_validation=PASS; result=CANDIDATE; release_decision=opaque; production_approval=false; sanitized=true");
  assert.doesNotMatch(output, /holder|packet-20260821|GO/u);
});

test("traversal, sensitive paths and symlink escapes are rejected", async () => {
  assert.equal((await runHumanOwnerAcceptanceCli(["docs/ai-team/evidence/../.env"], readFixture, ROOT)).reason, "invalid_path");
  assert.equal((await runHumanOwnerAcceptanceCli(["docs/ai-team/evidence/owner-secret-receipt.json"], readFixture, ROOT)).reason, "invalid_path");
  const outside = {
    realpath: async (candidate) => candidate.endsWith("owner-acceptance-receipt.json") ? "C:\\outside\\owner-acceptance-receipt.json" : candidate,
    readFile: async () => { throw new Error("must not read escaped path"); },
  };
  assert.equal((await runHumanOwnerAcceptanceCli(["docs/ai-team/evidence/owner-acceptance-receipt.json"], outside, ROOT)).reason, "invalid_path");
});

test("missing receipt path has a fixed failure reason", async () => {
  const result = await runHumanOwnerAcceptanceCli([], readFixture, ROOT);
  assert.equal(formatHumanOwnerAcceptanceValidation(result), "human_owner_acceptance_validation=FAIL; reason=receipt_path_required");
});
