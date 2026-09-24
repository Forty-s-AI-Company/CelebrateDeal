import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVE_NAME = "wp2-readonly-restore.dump.age";
const RECIPIENT_PATTERN = /^age1[a-z0-9]{58}$/u;

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

export function validateStagingRecipient(recipient, productionRecipient) {
  if (typeof productionRecipient !== "string" || !RECIPIENT_PATTERN.test(productionRecipient)) return "PRODUCTION_RECIPIENT_UNAVAILABLE";
  if (typeof recipient !== "string" || !RECIPIENT_PATTERN.test(recipient)) return "STAGING_RECIPIENT_INVALID";
  if (recipient === productionRecipient) return "PRODUCTION_RECIPIENT_FORBIDDEN";
  return null;
}

export function parseProductionRecipient(fileContents) {
  if (typeof fileContents !== "string") return null;
  const recipients = fileContents.split(/\r?\n/u).filter((line) => line.startsWith("age1"));
  return recipients.length === 1 && RECIPIENT_PATTERN.test(recipients[0]) ? recipients[0] : null;
}

export async function retainEncryptedBackup({ dumpPath, runnerTemp, recipient, spawnImpl = spawnSync }) {
  const productionRecipient = parseProductionRecipient(await fs.readFile(path.join(ROOT, "ops", "backup", "keys", "production-backup.agepub"), "utf8"));
  const recipientError = validateStagingRecipient(recipient, productionRecipient);
  if (recipientError) throw new Error(recipientError);
  const directory = path.join(await fs.realpath(runnerTemp), "celebratedeal-secure-receipts");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const archivePath = path.join(directory, ARCHIVE_NAME);
  try {
    // The recipient is public. Database credentials and dump bytes never enter
    // command arguments, stdout, the receipt, or an upload path.
    const result = spawnImpl("age", ["-r", recipient, "-o", archivePath, dumpPath], {
      cwd: ROOT, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", USERPROFILE: process.env.USERPROFILE ?? "", SystemRoot: process.env.SystemRoot ?? "" },
      encoding: "utf8", shell: false, windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024,
    });
    if (result.status !== 0) throw new Error("STAGING_ENCRYPTION_FAILED");
    await fs.chmod(archivePath, 0o600);
    const archive = await fs.readFile(archivePath);
    if (archive.length === 0 || !archive.subarray(0, 24).toString("ascii").startsWith("age-encryption.org/v1")) {
      throw new Error("STAGING_ARCHIVE_INVALID");
    }
    return { archivePath, archiveName: ARCHIVE_NAME, archiveDigest: sha256(archive), recipientDigest: sha256(recipient) };
  } catch (error) {
    await fs.rm(archivePath, { force: true }).catch(() => {});
    throw error;
  }
}

export const RETAINED_BACKUP_ARCHIVE_NAME = ARCHIVE_NAME;
