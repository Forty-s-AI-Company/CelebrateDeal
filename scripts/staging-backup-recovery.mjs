import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { BACKUP_SOURCE_SHA, filteredRestoreList, validateReceipt as validateBackupReceipt } from "./secure-staging-runner.mjs";
import { BACKUP_SOURCE } from "./staging-backup-recovery-source.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMAGE = "postgres:17-alpine";
const RECEIPT_NAME = "staging-backup-recovery-receipt.json";
const ARCHIVE_NAME = "wp2-readonly-restore.dump.age";
const BACKUP_RECEIPT_NAME = "wp2-readonly-restore-receipt.json";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const CONTAINER_ID = /^[a-f0-9]{64}$/u;
const TMPFS_MAGIC = 0x01021994;
// The retained archive is tied to this immutable RC migration tree, not to
// future master migrations that may be added during the 30-day retention.
const BACKUP_MIGRATION_TREE_SHA = "8204bf3ce05a309035f55b2f90aaffb18aed05c8";

function digest(value) { return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`; }
function safeEnvironment() {
  return Object.fromEntries(["PATH", "HOME", "USERPROFILE", "SystemRoot", "TMP", "TEMP"].filter((key) => typeof process.env[key] === "string").map((key) => [key, process.env[key]]));
}
function run(command, args, { input, maxBuffer = 16 * 1024 * 1024, spawnImpl = spawnSync } = {}) {
  const child = spawnImpl(command, args, { cwd: ROOT, env: safeEnvironment(), input, encoding: "utf8", shell: false, windowsHide: true, timeout: 120_000, maxBuffer });
  return { code: child.status ?? 1, stdout: child.stdout ?? "", stderr: child.stderr ?? "" };
}
function fixedInputPaths(runnerTemp) {
  const root = path.resolve(runnerTemp, "staging-recovery-input");
  return {
    archive: path.join(root, "archive", ARCHIVE_NAME),
    receipt: path.join(root, "receipt", BACKUP_RECEIPT_NAME),
  };
}
function regularFileAtFixedPath(file, expected) {
  const stat = fs.lstatSync(file);
  return stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync(file) === expected;
}

export function verifyDownloadedBackup(runnerTemp, readFile = fs.readFileSync) {
  if (typeof runnerTemp !== "string" || runnerTemp.length === 0) throw new Error("RECOVERY_INPUT_MISSING");
  const canonicalTemp = fs.realpathSync(runnerTemp);
  const files = fixedInputPaths(canonicalTemp);
  if (!regularFileAtFixedPath(files.archive, files.archive) || !regularFileAtFixedPath(files.receipt, files.receipt)) throw new Error("RECOVERY_INPUT_PATH_INVALID");
  if (fs.statSync(files.archive).size > 512 * 1024 * 1024 || fs.statSync(files.receipt).size > 64 * 1024) throw new Error("RECOVERY_INPUT_SIZE_EXCEEDED");
  const receipt = JSON.parse(readFile(files.receipt, "utf8"));
  if (!validateBackupReceipt(receipt, { pinnedMigrationTreeSha: BACKUP_MIGRATION_TREE_SHA }).ok || receipt.result !== "PASS" || receipt.sourceCommit !== BACKUP_SOURCE_SHA
    || receipt.task !== "wp2-readonly-restore" || receipt.retention.status !== "ENCRYPTED"
    || receipt.retention.recoverability !== "NOT_PROVEN" || receipt.retention.migrationAuthorization !== "BLOCKED"
    || !SHA256.test(receipt.backup.digest) || !SHA256.test(receipt.retention.archiveDigest) || !SHA256.test(receipt.retention.recipientDigest)) throw new Error("BACKUP_RECEIPT_INVALID");
  const archive = readFile(files.archive);
  if (!Buffer.isBuffer(archive) || archive.length === 0 || !archive.subarray(0, 24).toString("ascii").startsWith("age-encryption.org/v1")
    || digest(archive) !== receipt.retention.archiveDigest) throw new Error("ENCRYPTED_ARCHIVE_MISMATCH");
  return { files, receipt };
}

export function createRecoveryReceipt(runId) {
  return {
    schemaVersion: "celebratedeal-staging-recovery/v1", backupRunId: runId, sourceCommit: BACKUP_SOURCE_SHA,
    result: "BLOCKED", recoverability: "NOT_PROVEN", migrationAuthorization: "BLOCKED",
    archiveDigest: null, plaintextDigest: null,
    archiveVerified: false, recipientMatched: false, plaintextDigestMatched: false,
    restore: { isolated: true, networkDisabled: true, tmpfs: true, archiveListed: false, completed: false, migrationCount: 0, matchesBackup: false },
    cleanup: { containerRemoved: false, plaintextRemoved: false, identityRemoved: false },
    failureCategory: null,
  };
}

export function validateRecoveryReceipt(receipt) {
  const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("|") === keys.sort().join("|");
  if (!exact(receipt, ["schemaVersion", "backupRunId", "sourceCommit", "result", "recoverability", "migrationAuthorization", "archiveDigest", "plaintextDigest", "archiveVerified", "recipientMatched", "plaintextDigestMatched", "restore", "cleanup", "failureCategory"])
    || !exact(receipt.restore, ["isolated", "networkDisabled", "tmpfs", "archiveListed", "completed", "migrationCount", "matchesBackup"])
    || !exact(receipt.cleanup, ["containerRemoved", "plaintextRemoved", "identityRemoved"])) return false;
  if (receipt.schemaVersion !== "celebratedeal-staging-recovery/v1" || !/^[1-9][0-9]{0,15}$/u.test(receipt.backupRunId)
    || receipt.sourceCommit !== BACKUP_SOURCE.sourceSha || receipt.migrationAuthorization !== "BLOCKED"
    || !["PASS", "BLOCKED"].includes(receipt.result)
    || (receipt.failureCategory !== null && !/^[A-Z0-9_]+$/u.test(receipt.failureCategory))) return false;
  if ((receipt.archiveDigest !== null && !SHA256.test(receipt.archiveDigest))
    || (receipt.plaintextDigest !== null && !SHA256.test(receipt.plaintextDigest))
    || ![receipt.archiveVerified, receipt.recipientMatched, receipt.plaintextDigestMatched,
      receipt.restore.isolated, receipt.restore.networkDisabled, receipt.restore.tmpfs,
      receipt.restore.archiveListed, receipt.restore.completed, receipt.restore.matchesBackup,
      ...Object.values(receipt.cleanup)].every((value) => typeof value === "boolean")
    || !Number.isSafeInteger(receipt.restore.migrationCount) || receipt.restore.migrationCount < 0) return false;
  const serialized = JSON.stringify(receipt);
  if (/(?:postgres(?:ql)?:\/\/|https?:\/\/|age-secret-key-|Bearer\s+|set-cookie)/iu.test(serialized)) return false;
  if (receipt.result === "PASS") return receipt.recoverability === "PROVEN_ISOLATED" && receipt.archiveVerified === true
    && SHA256.test(receipt.archiveDigest ?? "") && SHA256.test(receipt.plaintextDigest ?? "")
    && receipt.recipientMatched === true && receipt.plaintextDigestMatched === true
    && receipt.restore.isolated === true && receipt.restore.networkDisabled === true && receipt.restore.tmpfs === true
    && receipt.restore.archiveListed === true && receipt.restore.completed === true && receipt.restore.migrationCount > 0
    && receipt.restore.matchesBackup === true && Object.values(receipt.cleanup).every((value) => value === true)
    && receipt.failureCategory === null;
  return receipt.recoverability === "NOT_PROVEN";
}

export async function runRecoveryDrill({ runId, runnerTemp, identity = process.env.STAGING_BACKUP_AGE_IDENTITY, spawnImpl = spawnSync } = {}) {
  const receipt = createRecoveryReceipt(runId);
  let temporaryRoot = null;
  let containerId = null;
  let containerName = null;
  const marker = crypto.randomBytes(8).toString("hex");
  try {
    if (typeof identity !== "string" || !/^AGE-SECRET-KEY-[A-Z0-9]+(?:\r?\n)?$/u.test(identity.trim())) throw new Error("RECOVERY_IDENTITY_MISSING_OR_INVALID");
    const verified = verifyDownloadedBackup(runnerTemp);
    receipt.archiveVerified = true;
    receipt.archiveDigest = verified.receipt.retention.archiveDigest;
    if (fs.statfsSync("/dev/shm").type !== TMPFS_MAGIC) throw new Error("RECOVERY_TMPFS_UNAVAILABLE");
    temporaryRoot = await fsp.mkdtemp("/dev/shm/celebratedeal-recovery-");
    await fsp.chmod(temporaryRoot, 0o700);
    const identityPath = path.join(temporaryRoot, "identity.agekey");
    const dumpPath = path.join(temporaryRoot, "staging-public.dump");
    await fsp.writeFile(identityPath, `${identity.trim()}\n`, { mode: 0o600, flag: "wx" });
    identity = null;
    delete process.env.STAGING_BACKUP_AGE_IDENTITY;
    const publicKey = run("age-keygen", ["-y", identityPath], { spawnImpl });
    if (publicKey.code !== 0 || digest(String(publicKey.stdout).trim()) !== verified.receipt.retention.recipientDigest) throw new Error("RECOVERY_RECIPIENT_MISMATCH");
    receipt.recipientMatched = true;
    const decrypted = run("age", ["-d", "-i", identityPath, "-o", dumpPath, verified.files.archive], { spawnImpl });
    if (decrypted.code !== 0) throw new Error("RECOVERY_DECRYPT_FAILED");
    await fsp.chmod(dumpPath, 0o600);
    if (digest(await fsp.readFile(dumpPath)) !== verified.receipt.backup.digest) throw new Error("RECOVERY_PLAINTEXT_DIGEST_MISMATCH");
    receipt.plaintextDigestMatched = true;
    receipt.plaintextDigest = verified.receipt.backup.digest;

    containerName = `celebratedeal-recovery-${marker}`;
    const started = run("docker", ["run", "-d", "--pull=never", "--network", "none", "--name", containerName,
      "--label", `celebratedeal.recovery=${marker}`, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_DB=celebratedeal_restore",
      "--tmpfs", "/var/lib/postgresql/data:rw,size=2g", "--tmpfs", "/tmp:rw,size=768m", IMAGE], { spawnImpl });
    if (started.code !== 0 || !CONTAINER_ID.test(String(started.stdout).trim())) throw new Error("RECOVERY_CONTAINER_CREATE_FAILED");
    containerId = String(started.stdout).trim();
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (run("docker", ["exec", containerId, "pg_isready", "-U", "postgres", "-d", "celebratedeal_restore"], { spawnImpl }).code === 0) { ready = true; break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
    if (!ready) throw new Error("RECOVERY_CONTAINER_NOT_READY");
    if (run("docker", ["cp", dumpPath, `${containerId}:/tmp/staging-public.dump`], { spawnImpl }).code !== 0) throw new Error("RECOVERY_ARCHIVE_COPY_FAILED");
    const listed = run("docker", ["exec", containerId, "pg_restore", "--list", "/tmp/staging-public.dump"], { spawnImpl });
    if (listed.code !== 0) throw new Error("RECOVERY_ARCHIVE_LIST_FAILED");
    receipt.restore.archiveListed = true;
    const restoreList = filteredRestoreList(listed.stdout);
    // The public-only archive omits Supabase-managed extension placement.
    // A dependency that needs a different placement will fail the restore closed.
    const prepared = run("docker", ["exec", containerId, "psql", "-U", "postgres", "-d", "celebratedeal_restore", "-X", "-v", "ON_ERROR_STOP=1", "-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions; CREATE EXTENSION pg_trgm WITH SCHEMA extensions;"], { spawnImpl });
    if (prepared.code !== 0) throw new Error("RECOVERY_TARGET_PREPARE_FAILED");
    if (run("docker", ["exec", "-i", containerId, "tee", "/tmp/staging-public.list"], { input: restoreList, spawnImpl }).code !== 0) throw new Error("RECOVERY_RESTORE_LIST_WRITE_FAILED");
    const restored = run("docker", ["exec", containerId, "pg_restore", "--username=postgres", "--no-owner", "--no-privileges", "--exit-on-error", "--single-transaction", "--use-list=/tmp/staging-public.list", "--dbname=celebratedeal_restore", "/tmp/staging-public.dump"], { spawnImpl });
    if (restored.code !== 0) throw new Error("RECOVERY_RESTORE_FAILED");
    receipt.restore.completed = true;
    const counted = run("docker", ["exec", containerId, "psql", "-U", "postgres", "-d", "celebratedeal_restore", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", "SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;"], { spawnImpl });
    if (counted.code !== 0 || !/^\d+$/u.test(String(counted.stdout).trim())) throw new Error("RECOVERY_MIGRATION_COUNT_INVALID");
    receipt.restore.migrationCount = Number(String(counted.stdout).trim());
    receipt.restore.matchesBackup = receipt.restore.migrationCount === verified.receipt.migration.appliedCount;
    if (!receipt.restore.matchesBackup) throw new Error("RECOVERY_MIGRATION_COUNT_MISMATCH");
  } catch (error) {
    receipt.failureCategory = typeof error?.message === "string" && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "RECOVERY_FAILED_NORMALIZED";
  } finally {
    identity = null;
    delete process.env.STAGING_BACKUP_AGE_IDENTITY;
    if (containerId) {
      const inspected = run("docker", ["inspect", "--format", "{{index .Config.Labels \"celebratedeal.recovery\"}}", containerId], { spawnImpl });
      if (inspected.code === 0 && String(inspected.stdout).trim() === marker && run("docker", ["rm", "-f", containerId], { spawnImpl }).code === 0) receipt.cleanup.containerRemoved = true;
      else receipt.failureCategory = "RECOVERY_CONTAINER_CLEANUP_FAILED";
    } else receipt.cleanup.containerRemoved = true;
    if (temporaryRoot) {
      const resolved = await fsp.realpath(temporaryRoot).catch(() => "");
      if (resolved.startsWith("/dev/shm/celebratedeal-recovery-") && !resolved.includes("/../")) {
        await fsp.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
      }
      const removed = !fs.existsSync(temporaryRoot);
      receipt.cleanup.plaintextRemoved = removed;
      receipt.cleanup.identityRemoved = removed;
      if (!removed) receipt.failureCategory = "RECOVERY_TMPFS_CLEANUP_FAILED";
    } else { receipt.cleanup.plaintextRemoved = true; receipt.cleanup.identityRemoved = true; }
  }
  if (receipt.failureCategory === null && receipt.archiveVerified && receipt.recipientMatched && receipt.plaintextDigestMatched
    && receipt.restore.archiveListed && receipt.restore.completed && receipt.restore.matchesBackup
    && Object.values(receipt.cleanup).every((value) => value === true)) {
    receipt.result = "PASS";
    receipt.recoverability = "PROVEN_ISOLATED";
  }
  if (!validateRecoveryReceipt(receipt)) { receipt.result = "BLOCKED"; receipt.recoverability = "NOT_PROVEN"; receipt.failureCategory = "RECOVERY_RECEIPT_INVALID"; }
  return receipt;
}

async function main() {
  const command = process.argv[2];
  const runnerTemp = process.env.RUNNER_TEMP ?? os.tmpdir();
  if (command === "preflight") {
    let ok = false;
    try { verifyDownloadedBackup(runnerTemp); ok = true; } catch { /* Fixed status only. */ }
    process.stdout.write(`downloaded_backup_preflight=${ok ? "PASS" : "BLOCKED"}\n`);
    if (!ok) process.exitCode = 2;
    return;
  }
  if (command !== "recover") { process.exitCode = 2; return; }
  const receipt = await runRecoveryDrill({ runId: process.env.BACKUP_RUN_ID, runnerTemp });
  const output = path.join(await fsp.realpath(runnerTemp), RECEIPT_NAME);
  await fsp.writeFile(output, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  process.stdout.write(`staging_backup_recovery=${receipt.result}; recoverability=${receipt.recoverability}\n`);
  if (receipt.result !== "PASS") process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
