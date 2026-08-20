import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAFE_ROOTS = Object.freeze(["docs/ai-team/evidence", ".ai-team/reports"]);
const SAFE_RECEIPT_FILENAME = /(?:release|readiness|evidence|receipt|bundle)[^\\/]*\.json$/iu;
const REQUIRED_BUNDLE_KEYS = Object.freeze([
  "schemaVersion",
  "capturedAt",
  "sourceCommit",
  "governanceVersion",
  "environment",
  "nonProduction",
  "sanitized",
  "sensitiveDataPersisted",
  "rawDataPersisted",
  "productionApproval",
  "productionOperations",
  "releaseDecision",
  "gates",
]);
const REQUIRED_GATE_KEYS = Object.freeze([
  "gateId",
  "evidenceClass",
  "result",
  "sourceCommit",
  "evidenceRef",
  "ownerRef",
  "scopeRef",
  "capturedAt",
  "sanitized",
  "failureReason",
]);
export const REQUIRED_RELEASE_GATES = Object.freeze([
  "remote_ci",
  "staging_lineage",
  "staging_migration",
  "staging_recovery",
  "staging_rollback",
  "cloudflare_stream",
  "resend",
  "sentry",
  "posthog",
  "durable_rate_limit",
  "payuni_sandbox_reconciliation",
  "policy_review",
  "human_owner_acceptance",
]);
const GATE_EVIDENCE_CLASSES = Object.freeze({
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
});
const RESULTS = new Set(["PASS", "NOT_PROVEN", "PENDING_EXTERNAL", "PENDING_HUMAN", "BLOCKED", "FAIL"]);
const RELEASE_DECISIONS = new Set(["GO", "NO_GO"]);
const FAILURE_REASONS = new Set([
  "REMOTE_CI_RUN_MISSING",
  "STAGING_LINEAGE_MISSING",
  "STAGING_MIGRATION_MISSING",
  "STAGING_RECOVERY_MISSING",
  "STAGING_ROLLBACK_MISSING",
  "PROVIDER_EVIDENCE_MISSING",
  "PAYUNI_RECONCILIATION_MISSING",
  "POLICY_APPROVAL_MISSING",
  "HUMAN_ACCEPTANCE_MISSING",
  "VALIDATION_BLOCKED",
]);
const OPAQUE_REF = /^opaque:[a-z0-9][a-z0-9_-]{7,63}$/u;
const SOURCE_COMMIT = /^[a-f0-9]{7,64}$/u;
const CAPTURED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const SENSITIVE_PATTERN = /(?:https?:\/\/|bearer\s+|(?:password|secret|token|cookie|private[_ -]?key|card[_ -]?number|database_url|connection[_ -]?string)[:=]\S+)/iu;
const SENSITIVE_PATH_SEGMENT = /(?:^\.env(?:$|\.)|password|secret|token|cookie|private[_ -]?key|credential|dump|backup)/iu;

function exactSet(values, expected) {
  return Array.isArray(values)
    && values.length === expected.length
    && new Set(values).size === expected.length
    && [...values].sort().every((value, index) => value === [...expected].sort()[index]);
}

function exactKeys(value, expected) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && exactSet(Object.keys(value), expected);
}

function isOpaqueRef(value) {
  return typeof value === "string" && OPAQUE_REF.test(value) && !/^opaque:synthetic(?:$|[-_])/u.test(value);
}

function isSourceCommit(value) {
  return typeof value === "string" && SOURCE_COMMIT.test(value);
}

function isCapturedAt(value) {
  return typeof value === "string" && CAPTURED_AT.test(value) && !Number.isNaN(Date.parse(value));
}

function pathIsWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function hasSensitivePathSegment(candidate) {
  return candidate.split(/[\\/]+/u).some((segment) => SENSITIVE_PATH_SEGMENT.test(segment));
}

function safeReceiptFilename(candidate) {
  return SAFE_RECEIPT_FILENAME.test(path.basename(candidate));
}

function aggregateResult(bundle) {
  const results = bundle.gates.map((gate) => gate.result);
  if (results.some((result) => result === "FAIL" || result === "BLOCKED")) return "BLOCKED";
  if (results.some((result) => result !== "PASS")) return "INCOMPLETE";
  return bundle.releaseDecision === "GO" ? "CANDIDATE" : "NO_GO";
}

export function validateReleaseEvidenceBundle(bundle) {
  const errors = [];
  if (bundle?.schemaVersion !== "celebratedeal-release-evidence-bundle/v1") errors.push("SCHEMA");
  if (!exactKeys(bundle, REQUIRED_BUNDLE_KEYS)) errors.push("BUNDLE_KEYS");
  if (!isCapturedAt(bundle?.capturedAt)) errors.push("CAPTURED_AT");
  if (!isSourceCommit(bundle?.sourceCommit)) errors.push("SOURCE_COMMIT");
  if (bundle?.governanceVersion !== "solo-founder-launch/v1") errors.push("GOVERNANCE_VERSION");
  if (bundle?.environment !== "non-production" || bundle?.nonProduction !== true) errors.push("NON_PRODUCTION_BOUNDARY");
  if (bundle?.sanitized !== true || bundle?.sensitiveDataPersisted !== false || bundle?.rawDataPersisted !== false) errors.push("SAFETY_FLAGS");
  if (bundle?.productionApproval !== false || bundle?.productionOperations !== 0) errors.push("PRODUCTION_BOUNDARY");
  if (!RELEASE_DECISIONS.has(bundle?.releaseDecision)) errors.push("RELEASE_DECISION");
  if (!Array.isArray(bundle?.gates) || !exactSet(bundle.gates.map((gate) => gate?.gateId), REQUIRED_RELEASE_GATES)) {
    errors.push("GATE_SET");
  }

  for (const gate of bundle?.gates ?? []) {
    if (!exactKeys(gate, REQUIRED_GATE_KEYS)) errors.push(`GATE_KEYS:${gate?.gateId ?? "unknown"}`);
    if (!REQUIRED_RELEASE_GATES.includes(gate?.gateId)) continue;
    if (gate.evidenceClass !== GATE_EVIDENCE_CLASSES[gate.gateId]) errors.push(`EVIDENCE_CLASS:${gate.gateId}`);
    if (!RESULTS.has(gate.result)) errors.push(`RESULT:${gate.gateId}`);
    if (gate.sourceCommit !== bundle?.sourceCommit) errors.push(`SOURCE_LINEAGE:${gate.gateId}`);
    if (!isOpaqueRef(gate.evidenceRef) || !isOpaqueRef(gate.ownerRef) || !isOpaqueRef(gate.scopeRef)) errors.push(`OPAQUE_REFERENCE:${gate.gateId}`);
    if (!isCapturedAt(gate.capturedAt)) errors.push(`GATE_CAPTURED_AT:${gate.gateId}`);
    if (gate.sanitized !== true) errors.push(`GATE_SANITIZED:${gate.gateId}`);
    if (gate.result === "PASS") {
      if (gate.failureReason !== null) errors.push(`PASS_FAILURE_REASON:${gate.gateId}`);
    } else if (!FAILURE_REASONS.has(gate.failureReason)) {
      errors.push(`FAILURE_REASON:${gate.gateId}`);
    }
  }

  let serialized = "";
  try {
    serialized = JSON.stringify(bundle);
  } catch {
    errors.push("SERIALIZATION");
  }
  if (SENSITIVE_PATTERN.test(serialized)) errors.push("SENSITIVE_INPUT_REJECTED");
  if (errors.length === 0 && bundle.releaseDecision === "GO" && bundle.gates.some((gate) => gate.result !== "PASS")) {
    errors.push("GO_WITH_NONPASS_GATE");
  }

  const uniqueErrors = [...new Set(errors)].sort();
  return {
    ok: uniqueErrors.length === 0,
    errors: uniqueErrors,
    result: uniqueErrors.length === 0 ? aggregateResult(bundle) : "INVALID",
  };
}

export async function resolveCanonicalReleaseEvidenceBundlePath(bundlePath, workspaceRoot = ROOT, fsAdapter = fsp) {
  if (typeof bundlePath !== "string" || bundlePath.trim() === "" || path.isAbsolute(bundlePath)) return null;
  if (bundlePath.split(/[\\/]+/u).some((segment) => segment === ".." || segment === ".")) return null;

  const absolutePath = path.resolve(workspaceRoot, bundlePath);
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

export async function validateReleaseEvidenceBundleFile(bundlePath, fsAdapter = fsp, workspaceRoot = ROOT) {
  const canonicalPath = await resolveCanonicalReleaseEvidenceBundlePath(bundlePath, workspaceRoot, fsAdapter);
  if (!canonicalPath) return { ok: false, reason: "invalid_path" };

  let source;
  try {
    source = await fsAdapter.readFile(canonicalPath, "utf8");
  } catch {
    return { ok: false, reason: "read_failed" };
  }

  let bundle;
  try {
    bundle = JSON.parse(source);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  const validation = validateReleaseEvidenceBundle(bundle);
  return validation.ok ? { ok: true, result: validation.result } : { ok: false, reason: "invalid_bundle" };
}

export function formatReleaseEvidenceBundleValidation(result) {
  if (!result?.ok) {
    const reason = new Set(["receipt_path_required", "invalid_path", "read_failed", "invalid_json", "invalid_bundle"]).has(result?.reason)
      ? result.reason
      : "invalid_bundle";
    return `release_evidence_bundle_validation=FAIL; reason=${reason}`;
  }
  return `release_evidence_bundle_validation=PASS; result=${result.result}; release_decision=opaque; production_approval=false; sanitized=true`;
}

export async function runReleaseEvidenceBundleCli(args = process.argv.slice(2), fsAdapter = fsp, workspaceRoot = ROOT) {
  if (args.length !== 1) return { ok: false, reason: "receipt_path_required" };
  return validateReleaseEvidenceBundleFile(args[0], fsAdapter, workspaceRoot);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runReleaseEvidenceBundleCli();
  process.stdout.write(`${formatReleaseEvidenceBundleValidation(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}
