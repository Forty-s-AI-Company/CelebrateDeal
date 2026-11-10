import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RECEIPT_NAME, validateReceipt } from "./secure-staging-line-notifications.mjs";

// Stage names the workflow's LINE step can record before it writes a receipt.
const RUNNER_STAGES = new Set([
  "prepare_receipt_root", "report_missing_bindings", "require_database_binding", "require_preview_binding",
  "validate_bindings", "resolve_allowlist", "backup_network_policy", "apply_network_policy", "execute_line_validation",
]);
export const RUNNER_STAGE_FILENAME = "celebratedeal-line-runner-stage";

/**
 * When no receipt exists, report the fixed stage at which the workflow step stopped.
 * Only an exact allowlisted stage name is accepted; anything else stays UNKNOWN.
 */
export function readRunnerStage(runnerTemp = process.env.RUNNER_TEMP) {
  if (!runnerTemp) return "NONE";
  let serialized;
  try {
    const candidate = path.resolve(runnerTemp, RUNNER_STAGE_FILENAME);
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64) return "RUNNER_STAGE_UNKNOWN";
    serialized = fs.readFileSync(candidate, "utf8").trim();
  } catch { return "NONE"; }
  return RUNNER_STAGES.has(serialized) ? `RUNNER_STAGE_${serialized.toUpperCase()}` : "RUNNER_STAGE_UNKNOWN";
}

/** Only a code matching the receipt writer's own allowlist is echoed; anything else is UNCLASSIFIED_FAILURE. */
export function sanitizeFailureCode(code) {
  if (code === null || code === undefined) return "NONE";
  return typeof code === "string" && /^[A-Z0-9_]{3,80}$/u.test(code) ? code : "UNCLASSIFIED_FAILURE";
}

// Key names of boolean checks that are false. validateReceipt already enforced the exact check key set,
// so these are fixed identifiers, never receipt free text.
const CHECK_KEY_ALLOWLIST = new Set(["isolatedDatabase", "runtimeDatabaseBound", "invalidBearerRejected", "invalidBearerNoWrite", "validBearerAccepted", "sentAtPresent", "idempotencyProbePassed", "tenantIsolationPassed"]);
export function falseCheckKeys(checks) {
  const keys = Object.keys(checks ?? {}).filter((key) => CHECK_KEY_ALLOWLIST.has(key) && checks[key] === false);
  return keys.length ? keys.join(",") : "NONE";
}

export function validateReceiptPath(candidate, runnerTemp = process.env.RUNNER_TEMP, expectedSource = process.env) {
  if (!candidate || !runnerTemp) return { ok: false, reason: "PATH_MISSING" };
  if (!expectedSource.CELEBRATEDEAL_SOURCE_SHA || !expectedSource.GITHUB_RUN_ID || !expectedSource.GITHUB_RUN_ATTEMPT) return { ok: false, reason: "EXPECTED_BINDING_MISSING" };
  let allowedRoot;
  try { allowedRoot = fs.realpathSync(path.resolve(runnerTemp, "celebratedeal-secure-receipts")); }
  catch {
    const stage = readRunnerStage(runnerTemp);
    return stage === "NONE" ? { ok: false, reason: "RECEIPT_ROOT_MISSING" } : { ok: false, reason: "RECEIPT_ROOT_MISSING", diagnostic: stage };
  }
  let stat;
  let canonical;
  try {
    stat = fs.lstatSync(candidate);
    canonical = fs.realpathSync(candidate);
  } catch {
    const stage = readRunnerStage(runnerTemp);
    return stage === "NONE" ? { ok: false, reason: "RECEIPT_FILE_MISSING" } : { ok: false, reason: "RECEIPT_FILE_MISSING", diagnostic: stage };
  }
  if (!stat.isFile() || stat.isSymbolicLink() || path.dirname(canonical) !== allowedRoot || path.basename(canonical) !== RECEIPT_NAME) {
    return { ok: false, reason: "PATH_OUTSIDE_RUNNER_TEMP" };
  }
  let serialized;
  try { serialized = fs.readFileSync(canonical, "utf8"); }
  catch { return { ok: false, reason: "RECEIPT_READ_FAILED" }; }
  if (serialized.length === 0) return { ok: false, reason: "RECEIPT_EMPTY" };
  let receipt;
  try { receipt = JSON.parse(serialized.replace(/^\uFEFF/u, "")); }
  catch { return { ok: false, reason: "RECEIPT_JSON_INVALID" }; }
  const validation = validateReceipt(receipt, { sourceCommit: expectedSource.CELEBRATEDEAL_SOURCE_SHA, runId: expectedSource.GITHUB_RUN_ID, runAttempt: expectedSource.GITHUB_RUN_ATTEMPT });
  return validation.ok
    ? { ok: true, result: receipt.result, failure: sanitizeFailureCode(receipt.failureCode), failedChecks: falseCheckKeys(receipt.checks) }
    : { ok: false, reason: "RECEIPT_INVALID", diagnostic: validation.errors[0] ?? "UNKNOWN" };
}

function main() {
  const result = validateReceiptPath(process.env.SECURE_RECEIPT_PATH ?? process.argv[2]);
  // Only fixed validator codes are emitted. Receipt contents and bindings stay private.
  process.stdout.write(`secure_line_receipt_validation=${result.ok ? "PASS" : "FAIL"}; result=${result.result ?? "BLOCKED"}; reason=${result.reason ?? "NONE"}; diagnostic=${result.diagnostic ?? "NONE"}${result.ok ? `; failure=${result.failure}; false_checks=${result.failedChecks}` : ""}\n`);
  if (!result.ok && process.env.GITHUB_ACTIONS === "true") {
    process.stdout.write(`::error title=Sanitized LINE receipt validation::reason=${result.reason ?? "UNKNOWN"}; diagnostic=${result.diagnostic ?? "NONE"}\n`);
  }
  if (result.ok && result.result !== "PASS" && process.env.GITHUB_ACTIONS === "true") {
    process.stdout.write(`::error title=Sanitized LINE receipt::result=${result.result}; failure=${result.failure}; false_checks=${result.failedChecks}\n`);
  }
  if (!result.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
