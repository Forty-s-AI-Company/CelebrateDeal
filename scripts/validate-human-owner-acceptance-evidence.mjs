import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAFE_ROOTS = Object.freeze(["docs/ai-team/evidence", ".ai-team/reports"]);
const REQUIRED_ROLES = Object.freeze([
  "merchant_owner",
  "support_operator",
  "finance_owner",
  "privacy_policy_owner",
  "release_owner",
]);
const REQUIRED_CHECKS = Object.freeze({
  merchant_owner: ["owner_role_confirmed", "onboarding_handoff_reviewed", "merchant_impact_reviewed"],
  support_operator: ["support_queue_defined", "severity_path_reviewed", "escalation_owner_confirmed"],
  finance_owner: ["sandbox_boundary_reviewed", "refund_handoff_reviewed", "reconciliation_gap_acknowledged"],
  privacy_policy_owner: ["privacy_review_assigned", "data_request_path_reviewed", "retention_review_assigned"],
  release_owner: ["all_owner_packets_reviewed", "blockers_aggregated", "release_decision_recorded"],
});
const DECISIONS = new Set(["PENDING", "ACCEPTED", "REJECTED", "BLOCKED"]);
const CHECK_STATUSES = new Set(["PENDING", "PASS", "FAIL", "BLOCKED"]);
const POLICY_STATUSES = new Set(["PENDING", "ACCEPTED", "REJECTED", "BLOCKED"]);
const RELEASE_DECISIONS = new Set(["GO", "HOLD", "NO_GO"]);
const OPAQUE_REF = /^opaque:[a-z0-9][a-z0-9_-]{7,63}$/u;
const CAPTURED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const SENSITIVE_PATTERN = /(?:https?:\/\/|bearer\s+|(?:password|secret|token|cookie|private[_ -]?key|card[_ -]?number|database_url|connection[_ -]?string)[:=]\S+)/iu;
const SENSITIVE_PATH_SEGMENT = /(?:^\.env(?:$|\.)|password|secret|token|cookie|private[_ -]?key|credential|dump|backup)/iu;

function isOpaqueRef(value) {
  return typeof value === "string" && OPAQUE_REF.test(value) && !/^opaque:synthetic(?:$|[-_])/u.test(value);
}

function isCapturedAt(value) {
  return typeof value === "string" && CAPTURED_AT.test(value) && !Number.isNaN(Date.parse(value));
}

function exactSet(values, expected) {
  return Array.isArray(values)
    && values.length === expected.length
    && new Set(values).size === expected.length
    && [...values].sort().every((value, index) => value === [...expected].sort()[index]);
}

function pathIsWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function hasSensitivePathSegment(candidate) {
  return candidate.split(/[\\/]+/u).some((segment) => SENSITIVE_PATH_SEGMENT.test(segment));
}

function safeReceiptFilename(candidate) {
  return /(?:owner|acceptance|evidence|receipt)[^\\/]*\.json$/iu.test(path.basename(candidate));
}

export async function resolveCanonicalReceiptPath(receiptPath, workspaceRoot = ROOT, fsAdapter = fsp) {
  if (typeof receiptPath !== "string" || receiptPath.trim() === "" || path.isAbsolute(receiptPath)) return null;
  if (receiptPath.split(/[\\/]+/u).some((segment) => segment === ".." || segment === ".")) return null;

  const absolutePath = path.resolve(workspaceRoot, receiptPath);
  if (hasSensitivePathSegment(absolutePath) || !safeReceiptFilename(absolutePath)) return null;
  const safeRoot = SAFE_ROOTS
    .map((relativeRoot) => path.resolve(workspaceRoot, relativeRoot))
    .find((candidate) => pathIsWithin(candidate, absolutePath));
  if (!safeRoot || typeof fsAdapter.realpath !== "function") return null;

  try {
    const canonicalRoot = await fsAdapter.realpath(safeRoot);
    const canonicalPath = await fsAdapter.realpath(absolutePath);
    if (!pathIsWithin(canonicalRoot, canonicalPath) || hasSensitivePathSegment(canonicalPath)) return null;
    return canonicalPath;
  } catch {
    return null;
  }
}

function policyReviewValid(policyReview) {
  const keys = ["terms", "privacy", "refunds", "retention", "dataRequest"];
  return policyReview
    && exactSet(Object.keys(policyReview), keys)
    && keys.every((key) => POLICY_STATUSES.has(policyReview[key]));
}

function supportEscalationValid(supportEscalation) {
  return supportEscalation
    && supportEscalation.intakeDefined === true
    && supportEscalation.severityPathDefined === true
    && supportEscalation.escalationOwnerConfirmed === true
    && isOpaqueRef(supportEscalation.evidenceRef);
}

function ownerResult(receipt) {
  const decisions = receipt.responsibilities.map((owner) => owner.decision);
  const checkStatuses = receipt.responsibilities.flatMap((owner) => owner.checks.map((check) => check.status));
  const policyStatuses = Object.values(receipt.policyReview);
  if (receipt.releaseDecision === "NO_GO" || decisions.some((value) => value === "REJECTED" || value === "BLOCKED") || checkStatuses.some((value) => value === "FAIL" || value === "BLOCKED") || policyStatuses.some((value) => value === "REJECTED" || value === "BLOCKED")) {
    return "BLOCKED";
  }
  if (receipt.releaseDecision === "HOLD" || decisions.includes("PENDING") || checkStatuses.includes("PENDING") || policyStatuses.includes("PENDING")) {
    return "INCOMPLETE";
  }
  return "CANDIDATE";
}

export function validateHumanOwnerAcceptanceReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== "celebratedeal-cat10-human-owner-acceptance/v1") errors.push("SCHEMA");
  if (!isOpaqueRef(receipt?.packetRef) || !isCapturedAt(receipt?.capturedAt)) errors.push("PACKET_REFERENCE");
  if (receipt?.governanceVersion !== "solo-founder-launch/v1") errors.push("GOVERNANCE_VERSION");
  if (receipt?.humanAttestation !== true || receipt?.sanitized !== true || receipt?.sensitiveDataPersisted !== false) errors.push("SAFETY_FLAGS");
  if (receipt?.productionApproval !== false) errors.push("PRODUCTION_APPROVAL_REJECTED");
  if (!Array.isArray(receipt?.responsibilities) || !exactSet(receipt.responsibilities.map((owner) => owner?.roleId), REQUIRED_ROLES)) {
    errors.push("ROLE_SET");
  }

  for (const owner of receipt?.responsibilities ?? []) {
    if (!REQUIRED_ROLES.includes(owner?.roleId)) continue;
    const expectedChecks = REQUIRED_CHECKS[owner.roleId];
    if (!isOpaqueRef(owner.holderRef) || !isOpaqueRef(owner.scopeRef) || !isOpaqueRef(owner.manualSignatureRef)) errors.push(`OWNER_REFERENCE:${owner.roleId}`);
    if (!DECISIONS.has(owner.decision)) errors.push(`OWNER_DECISION:${owner.roleId}`);
    if (!Array.isArray(owner.checks) || !exactSet(owner.checks.map((check) => check?.checkId), expectedChecks)) {
      errors.push(`CHECK_SET:${owner.roleId}`);
    }
    for (const check of owner.checks ?? []) {
      if (!expectedChecks.includes(check?.checkId)) continue;
      if (!CHECK_STATUSES.has(check.status) || !isOpaqueRef(check.evidenceRef) || check.sanitized !== true) errors.push(`CHECK_EVIDENCE:${owner.roleId}:${check.checkId}`);
    }
    if (owner.decision === "ACCEPTED" && (owner.checks ?? []).some((check) => check.status !== "PASS")) errors.push(`ACCEPTED_WITH_UNPASSED_CHECK:${owner.roleId}`);
  }

  if (!policyReviewValid(receipt?.policyReview)) errors.push("POLICY_REVIEW");
  if (!supportEscalationValid(receipt?.supportEscalation)) errors.push("SUPPORT_ESCALATION");
  if (!RELEASE_DECISIONS.has(receipt?.releaseDecision)) errors.push("RELEASE_DECISION");
  if (receipt?.legalComplianceSelfReview !== true || receipt?.notIndependentLegalCounsel !== true) errors.push("LEGAL_BOUNDARY");

  if (SENSITIVE_PATTERN.test(JSON.stringify(receipt))) errors.push("SENSITIVE_INPUT_REJECTED");

  const result = errors.length === 0 ? ownerResult(receipt) : "INVALID";
  if (errors.length === 0 && receipt.releaseDecision === "GO" && result !== "CANDIDATE") errors.push("GO_WITH_INCOMPLETE_EVIDENCE");
  return { ok: errors.length === 0, errors: [...new Set(errors)].sort(), result: errors.length === 0 ? ownerResult(receipt) : "INVALID" };
}

export async function validateHumanOwnerAcceptanceFile(receiptPath, fsAdapter = fsp, workspaceRoot = ROOT) {
  const canonicalPath = await resolveCanonicalReceiptPath(receiptPath, workspaceRoot, fsAdapter);
  if (!canonicalPath) return { ok: false, reason: "invalid_path" };
  let source;
  try {
    source = await fsAdapter.readFile(canonicalPath, "utf8");
  } catch {
    return { ok: false, reason: "read_failed" };
  }
  let receipt;
  try {
    receipt = JSON.parse(source);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  const validation = validateHumanOwnerAcceptanceReceipt(receipt);
  return validation.ok ? { ok: true, result: validation.result } : { ok: false, reason: "invalid_receipt" };
}

export function formatHumanOwnerAcceptanceValidation(result) {
  if (!result?.ok) return `human_owner_acceptance_validation=FAIL; reason=${result?.reason === "receipt_path_required" ? "receipt_path_required" : result?.reason === "invalid_path" ? "invalid_path" : result?.reason === "read_failed" ? "read_failed" : result?.reason === "invalid_json" ? "invalid_json" : "invalid_receipt"}`;
  return `human_owner_acceptance_validation=PASS; result=${result.result}; release_decision=opaque; production_approval=false; sanitized=true`;
}

export async function runHumanOwnerAcceptanceCli(args = process.argv.slice(2), fsAdapter = fsp, workspaceRoot = ROOT) {
  if (!args[0]) return { ok: false, reason: "receipt_path_required" };
  return validateHumanOwnerAcceptanceFile(args[0], fsAdapter, workspaceRoot);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runHumanOwnerAcceptanceCli();
  process.stdout.write(`${formatHumanOwnerAcceptanceValidation(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}
