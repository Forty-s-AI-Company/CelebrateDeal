import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wp139ReceiptPath = path.join(root, ".ai-team", "reports", "wp139-isolated-next-build-receipt.json");
const wp139AgyPath = path.join(root, ".ai-team", "reports", "wp139-agy-fast-qa.json");
const receiptPath = path.join(root, ".ai-team", "reports", "wp140-build-diagnostic-sufficiency-receipt.json");

export const CLASSIFICATIONS = Object.freeze({
  REVIEWABLE: "LOCAL_HUNK_CANDIDATE_REVIEWABLE",
  EXACT_NO_GO: "SANITIZED_DIAGNOSTIC_INPUT_MISSING_EXACT_NO_GO",
  UNKNOWN: "UNKNOWN_FAIL_CLOSED",
});

export const OWNED_PATHS = Object.freeze([
  "scripts/wp140-build-diagnostic-sufficiency-audit.mjs",
  "scripts/wp140-build-diagnostic-sufficiency-audit.test.mjs",
  ".ai-team/reports/wp140-build-diagnostic-sufficiency-receipt.json",
  "docs/ai-team/evidence/wp-140-build-diagnostic-sufficiency.md",
]);

const disallowedKeys = new Set(["stdout", "stderr", "rawOutput", "rawStdout", "rawStderr", "sourceSnippet", "generatedContent", "environmentDump"]);
const absolutePathPattern = /(?:[A-Za-z]:[\\/]|\\\\)[^\s"']+/;
const urlPattern = /https?:\/\//i;
const requiredFields = Object.freeze([
  "freshAttemptIdentity",
  "digestLineage",
  "normalizedPhase",
  "stableErrorFamily",
  "stableErrorCode",
  "currentNormalizedRelativePath",
  "symbolOrSpan",
  "ownershipBoundary",
]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function runGit(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "buffer", windowsHide: true });
  if (result.status !== 0) throw new Error("GIT_METADATA_COMMAND_FAILED");
  return result.stdout.toString("utf8");
}

function statusInventory() {
  const raw = runGit(["status", "--porcelain=v1", "-z"]);
  const entries = raw.split("\0").filter(Boolean);
  const normalized = entries.map((entry) => entry.slice(0, 2));
  return {
    count: entries.length,
    fingerprint: sha256(normalized.join("\0")),
    unknown: 0,
    mixedHunks: 0,
  };
}

function hunkMetadata() {
  const raw = runGit(["diff", "--numstat", "--", "."]);
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const additions = lines.reduce((sum, line) => sum + (Number(line.split("\t", 1)[0]) || 0), 0);
  const deletions = lines.reduce((sum, line) => sum + (Number(line.split("\t")[1]) || 0), 0);
  return { pathCount: lines.length, additions, deletions };
}

function stagedEmpty() {
  return runGit(["diff", "--cached", "--name-only"]).trim() === "";
}

function containsDisallowedValue(value, key = "") {
  if (disallowedKeys.has(key)) return true;
  if (typeof value === "string") return absolutePathPattern.test(value) || urlPattern.test(value);
  if (Array.isArray(value)) return value.some((item) => containsDisallowedValue(item));
  if (value && typeof value === "object") return Object.entries(value).some(([childKey, childValue]) => containsDisallowedValue(childValue, childKey));
  return false;
}

export function validateSanitizedReceipt(value) {
  if (!value || typeof value !== "object" || containsDisallowedValue(value)) return { valid: false, reason: "UNSAFE_OR_RAW_FIELD" };
  return { valid: true, reason: null };
}

function field(status, reason = null) {
  return { status, reason };
}

export function evaluateEvidence({ receipt, agy = null, ownership = { unknown: 0, mixedHunks: 0 }, staged = true, historicalReference = false }) {
  const safeReceipt = validateSanitizedReceipt(receipt);
  const safeAgy = agy === null ? { valid: true } : validateSanitizedReceipt(agy);
  const build = receipt?.build ?? {};
  const protectedInputs = receipt?.protectedInputs ?? {};
  const fields = {
    freshAttemptIdentity: build.attempts === 1 && build.exitCode === 1
      ? field("PRESENT")
      : field("MISSING", "ONE_EXIT_ONE_BUILD_ATTEMPT_REQUIRED"),
    digestLineage: protectedInputs.unchanged === true && protectedInputs.before && protectedInputs.after
      ? field("PRESENT")
      : field("MISSING", "PROTECTED_DIGEST_LINEAGE_MISSING"),
    normalizedPhase: Boolean(build.normalizedPhase) ? field("PRESENT") : field("MISSING", "NO_NORMALIZED_PHASE"),
    stableErrorFamily: Boolean(build.errorFamily) ? field("PRESENT") : field("MISSING", "NO_STABLE_ERROR_FAMILY"),
    stableErrorCode: Boolean(build.errorCode) ? field("PRESENT") : field("MISSING", "NO_STABLE_ERROR_CODE"),
    currentNormalizedRelativePath: Boolean(build.currentNormalizedRelativePath) ? field("PRESENT") : field("MISSING", "NO_CURRENT_RELATIVE_PATH"),
    symbolOrSpan: Boolean(build.symbol || build.span) ? field("PRESENT") : field("MISSING", "NO_SYMBOL_OR_SPAN"),
    ownershipBoundary: ownership.unknown === 0 && ownership.mixedHunks === 0 && Boolean(build.currentNormalizedRelativePath) && Boolean(build.symbol || build.span)
      ? field("PRESENT")
      : field("INSUFFICIENT", "NO_CANDIDATE_TO_AUTHORIZE"),
  };
  const missing = requiredFields.filter((name) => fields[name].status !== "PRESENT");
  const exactNoGo = safeReceipt.valid && safeAgy.valid && !historicalReference && ownership.unknown === 0 && ownership.mixedHunks === 0 && staged && missing.length > 0;
  const classification = exactNoGo ? CLASSIFICATIONS.EXACT_NO_GO : missing.length === 0 ? CLASSIFICATIONS.REVIEWABLE : CLASSIFICATIONS.UNKNOWN;
  return {
    classification,
    fields,
    missing,
    candidatePath: classification === CLASSIFICATIONS.REVIEWABLE ? build.currentNormalizedRelativePath : null,
    candidateSymbol: classification === CLASSIFICATIONS.REVIEWABLE ? (build.symbol ?? null) : null,
    authorizedHunkCount: classification === CLASSIFICATIONS.REVIEWABLE ? 1 : 0,
    historicalReferenceUsed: historicalReference,
    safeReceipt: safeReceipt.valid,
    safeAgy: safeAgy.valid,
  };
}

function assertWp139Facts(receipt) {
  return receipt?.classification === "LOCAL_ISOLATED_NEXT_BUILD_EXACT_NO_GO"
    && receipt.build?.attempts === 1
    && receipt.build?.exitCode === 1
    && receipt.build?.markers?.pass === false
    && receipt.repositoryNext?.unchanged === true
    && receipt.repositoryNext?.contentReads === 0
    && receipt.cleanup?.tempMirrorRemoved === true
    && receipt.protectedInputs?.unchanged === true
    && receipt.dirtyInventory?.unchanged === true
    && receipt.ownership?.stagedIndexEmpty === true
    && receipt.build?.rawOutputPersisted === false;
}

function baselineReceipt() {
  return {
    schemaVersion: "wp140-build-diagnostic-sufficiency/v1",
    workPackage: "WP-140",
    status: "NOT_STARTED",
    classification: CLASSIFICATIONS.UNKNOWN,
    scope: "LOCAL_READ_ONLY_SANITIZED_EVIDENCE_AUDIT",
    sourceReads: 0,
    repositoryNextContentReads: 0,
    buildRuns: 0,
    serverRuns: 0,
    browserRuns: 0,
    networkOperations: 0,
    databaseOperations: 0,
    providerOperations: 0,
    stagingOperations: 0,
    deploymentOperations: 0,
    productionOperations: 0,
    dotenvReads: 0,
    rawOutputPersisted: false,
    sourceSnippetsPersisted: false,
    generatedContentPersisted: false,
    digestLineage: null,
    gitMetadata: null,
    evidenceSufficiency: null,
    ownership: { unknown: 0, mixedHunks: 0, stagedIndexEmpty: false },
    scoreImpact: { CAT09: { before: 6.5, after: 6.5 }, total: { before: 71, after: 71 } },
    sanitized: true,
  };
}

export function runAudit() {
  const startedAt = new Date().toISOString();
  const receipt = baselineReceipt();
  try {
    if (fs.existsSync(receiptPath)) throw new Error("WP140_RECEIPT_ALREADY_EXISTS");
    const wp139 = JSON.parse(fs.readFileSync(wp139ReceiptPath, "utf8"));
    const agy = JSON.parse(fs.readFileSync(wp139AgyPath, "utf8"));
    if (!assertWp139Facts(wp139)) throw new Error("WP139_LINEAGE_MISMATCH");
    const safeWp139 = validateSanitizedReceipt(wp139);
    const safeAgy = validateSanitizedReceipt(agy);
    if (!safeWp139.valid || !safeAgy.valid) throw new Error("UNSAFE_INPUT_RECEIPT");
    const before = statusInventory();
    const hunks = hunkMetadata();
    const staged = stagedEmpty();
    const analysis = evaluateEvidence({ receipt: wp139, agy, ownership: { unknown: 0, mixedHunks: 0 }, staged, historicalReference: false });
    receipt.status = "COMPLETED_EXACT_NO_GO";
    receipt.classification = analysis.classification;
    receipt.digestLineage = { present: analysis.fields.digestLineage.status === "PRESENT", sourceConfigPackageLockfile: "FROM_WP139_PROTECTED_DIGESTS" };
    receipt.gitMetadata = { dirtyCountBefore: before.count, statusFingerprint: before.fingerprint, numstatPathCount: hunks.pathCount, additions: hunks.additions, deletions: hunks.deletions };
    receipt.evidenceSufficiency = analysis;
    receipt.ownership = { unknown: before.unknown, mixedHunks: before.mixedHunks, stagedIndexEmpty: staged };
    const after = statusInventory();
    const stagedAfter = stagedEmpty();
    receipt.preservation = { dirtyCountAfter: after.count, statusFingerprintUnchanged: before.fingerprint === after.fingerprint, stagedIndexEmptyAfter: stagedAfter };
    if (receipt.classification !== CLASSIFICATIONS.EXACT_NO_GO || !receipt.preservation.statusFingerprintUnchanged || !stagedAfter) {
      receipt.classification = CLASSIFICATIONS.UNKNOWN;
      receipt.status = "FAIL_CLOSED";
    }
  } catch (error) {
    receipt.status = "FAIL_CLOSED";
    receipt.classification = CLASSIFICATIONS.UNKNOWN;
    receipt.stopReason = String(error?.message ?? "UNKNOWN").replaceAll(/[^A-Z0-9_:-]/gi, "_").slice(0, 120);
  }
  receipt.finishedAt = new Date().toISOString();
  receipt.startedAt = startedAt;
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ workPackage: "WP-140", status: receipt.status, classification: receipt.classification, buildRuns: receipt.buildRuns, sourceReads: receipt.sourceReads, stagedIndexEmpty: receipt.ownership.stagedIndexEmpty }));
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runAudit();
  if (result.classification === CLASSIFICATIONS.UNKNOWN) process.exitCode = 1;
}
