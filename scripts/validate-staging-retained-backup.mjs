import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateReceipt } from "./secure-staging-runner.mjs";
import { RETAINED_BACKUP_ARCHIVE_NAME } from "./staging-retained-backup.mjs";

export function validateRetainedBackupPath(candidate, receiptCandidate, runnerTemp = process.env.RUNNER_TEMP) {
  if (typeof candidate !== "string" || typeof receiptCandidate !== "string" || typeof runnerTemp !== "string") return false;
  try {
    const root = fs.realpathSync(path.resolve(runnerTemp, "celebratedeal-secure-receipts"));
    const archive = fs.realpathSync(candidate);
    const receiptPath = fs.realpathSync(receiptCandidate);
    if (path.dirname(archive) !== root || path.basename(archive) !== RETAINED_BACKUP_ARCHIVE_NAME
      || path.dirname(receiptPath) !== root || path.basename(receiptPath) !== "wp2-readonly-restore-receipt.json") return false;
    if (!fs.lstatSync(candidate).isFile() || fs.lstatSync(candidate).isSymbolicLink()
      || !fs.lstatSync(receiptCandidate).isFile() || fs.lstatSync(receiptCandidate).isSymbolicLink()) return false;
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    if (!validateReceipt(receipt).ok || receipt.result !== "PASS" || receipt.retention.status !== "ENCRYPTED"
      || receipt.retention.recoverability !== "NOT_PROVEN" || receipt.retention.migrationAuthorization !== "BLOCKED") return false;
    const bytes = fs.readFileSync(archive);
    return bytes.length > 0 && bytes.subarray(0, 24).toString("ascii").startsWith("age-encryption.org/v1")
      && `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}` === receipt.retention.archiveDigest;
  } catch { return false; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ok = validateRetainedBackupPath(process.argv[2], process.argv[3]);
  process.stdout.write(`staging_encrypted_archive_validation=${ok ? "PASS" : "FAIL"}\n`);
  if (!ok) process.exitCode = 2;
}
