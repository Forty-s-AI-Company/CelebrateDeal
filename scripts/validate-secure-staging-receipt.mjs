import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateReceipt } from "./secure-staging-runner.mjs";

export function validateReceiptPath(candidate, runnerTemp = process.env.RUNNER_TEMP) {
  if (typeof candidate !== "string" || typeof runnerTemp !== "string") return { ok: false, reason: "PATH_MISSING" };
  try {
    const receiptPath = path.resolve(candidate);
    const allowedRoot = fs.realpathSync(path.resolve(runnerTemp, "celebratedeal-secure-receipts"));
    const stat = fs.lstatSync(receiptPath);
    const canonicalReceiptPath = fs.realpathSync(receiptPath);
    if (
      !stat.isFile()
      || stat.isSymbolicLink()
      || path.dirname(canonicalReceiptPath) !== allowedRoot
      || path.basename(canonicalReceiptPath) !== "wp2-readonly-restore-receipt.json"
    ) {
      return { ok: false, reason: "PATH_OUTSIDE_RUNNER_TEMP" };
    }
    const receipt = JSON.parse(fs.readFileSync(canonicalReceiptPath, "utf8"));
    const validation = validateReceipt(receipt);
    return validation.ok ? { ok: true, result: receipt.result } : { ok: false, reason: "RECEIPT_INVALID" };
  } catch {
    return { ok: false, reason: "RECEIPT_UNREADABLE" };
  }
}

function main() {
  const result = validateReceiptPath(process.argv[2]);
  process.stdout.write(`secure_staging_receipt_validation=${result.ok ? "PASS" : "FAIL"}; result=${result.result ?? "BLOCKED"}\n`);
  if (!result.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
