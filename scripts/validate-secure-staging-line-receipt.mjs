import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RECEIPT_NAME, validateReceipt } from "./secure-staging-line-notifications.mjs";

export function validateReceiptPath(candidate, runnerTemp = process.env.RUNNER_TEMP, expectedSource = process.env) {
  if (!candidate || !runnerTemp) return { ok: false, reason: "PATH_MISSING" };
  if (!expectedSource.CELEBRATEDEAL_SOURCE_SHA || !expectedSource.GITHUB_RUN_ID || !expectedSource.GITHUB_RUN_ATTEMPT) return { ok: false, reason: "EXPECTED_BINDING_MISSING" };
  try {
    const allowedRoot = fs.realpathSync(path.resolve(runnerTemp, "celebratedeal-secure-receipts"));
    const stat = fs.lstatSync(candidate);
    const canonical = fs.realpathSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink() || path.dirname(canonical) !== allowedRoot || path.basename(canonical) !== RECEIPT_NAME) {
      return { ok: false, reason: "PATH_OUTSIDE_RUNNER_TEMP" };
    }
    const receipt = JSON.parse(fs.readFileSync(canonical, "utf8"));
    const validation = validateReceipt(receipt, { sourceCommit: expectedSource.CELEBRATEDEAL_SOURCE_SHA, runId: expectedSource.GITHUB_RUN_ID, runAttempt: expectedSource.GITHUB_RUN_ATTEMPT });
    return validation.ok
      ? { ok: true, result: receipt.result }
      : { ok: false, reason: "RECEIPT_INVALID", diagnostic: validation.errors[0] ?? "UNKNOWN" };
  } catch { return { ok: false, reason: "RECEIPT_UNREADABLE" }; }
}

function main() {
  const result = validateReceiptPath(process.argv[2]);
  // Only fixed validator codes are emitted. Receipt contents and bindings stay private.
  process.stdout.write(`secure_line_receipt_validation=${result.ok ? "PASS" : "FAIL"}; result=${result.result ?? "BLOCKED"}; reason=${result.reason ?? "NONE"}; diagnostic=${result.diagnostic ?? "NONE"}\n`);
  if (!result.ok && process.env.GITHUB_ACTIONS === "true") {
    process.stdout.write(`::error title=Sanitized LINE receipt validation::reason=${result.reason ?? "UNKNOWN"}; diagnostic=${result.diagnostic ?? "NONE"}\n`);
  }
  if (!result.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
