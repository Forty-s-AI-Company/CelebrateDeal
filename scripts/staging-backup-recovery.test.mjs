import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { BACKUP_SOURCE_SHA, createInitialReceipt, sourceInventory } from "./secure-staging-runner.mjs";
import { BACKUP_SOURCE, attestBackupRun, validateBackupRun } from "./staging-backup-recovery-source.mjs";
import { createRecoveryReceipt, runRecoveryDrill, validateRecoveryReceipt, verifyDownloadedBackup } from "./staging-backup-recovery.mjs";

const hash = (value) => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;

function backupRun() {
  return {
    id: 12345, head_sha: BACKUP_SOURCE.backupCommit, head_branch: "master", path: BACKUP_SOURCE.workflow,
    event: "workflow_dispatch", status: "completed", conclusion: "success",
    repository: { full_name: BACKUP_SOURCE.repository }, head_repository: { full_name: BACKUP_SOURCE.repository },
    inputs: { task: "wp2-readonly-restore", source_sha: BACKUP_SOURCE.sourceSha, deployment_host: "safe-preview.vercel.app" },
  };
}

function artifacts() {
  return { total_count: 2, artifacts: [BACKUP_SOURCE.archiveArtifact, BACKUP_SOURCE.receiptArtifact]
    .map((name) => ({ name, expired: false, workflow_run: { id: 12345 }, size_in_bytes: 100 })) };
}

function backupReceipt(archive) {
  const receipt = createInitialReceipt(BACKUP_SOURCE_SHA);
  receipt.result = "PASS";
  receipt.lineage = { deploymentReads: 2, deploymentMatched: true, sourceMatched: true, preview: true, ready: true, healthStatus: 200, noRedirect: true, deploymentDigest: `sha256:${"a".repeat(64)}` };
  receipt.database = { connectionAttempts: 1, firstTransactionReadOnly: true, identityMatched: true, readQueries: 6, disconnected: true };
  receipt.migration = { expectedCount: sourceInventory(BACKUP_SOURCE_SHA).size, appliedCount: 58, unresolvedFailedCount: 0, rollbackEntryCount: 0, completedCounterpartCount: 0, exactChecksumCount: 58, formatVarianceCount: 0, unknownMismatchCount: 0, status: "BACKUP_READY_MIGRATIONS_PENDING" };
  receipt.backup = { attempts: 1, result: "PASS", byteBucket: "lt_1mib", digest: hash("synthetic plain dump") };
  receipt.restore = { attempts: 1, result: "PASS", migrationCount: 58, schemaMatched: true, extensionsMatched: true, aggregateMatched: true, isolated: true };
  receipt.retention = { status: "ENCRYPTED", archiveDigest: hash(archive), recipientDigest: hash(`age1${"a".repeat(58)}`), recoverability: "NOT_PROVEN", migrationAuthorization: "BLOCKED" };
  receipt.sideEffects.backupWrites = 1;
  receipt.sideEffects.isolatedRestoreWrites = 1;
  return receipt;
}

test("only one successful protected #288 run with both fixed artifacts is accepted", async () => {
  assert.equal(validateBackupRun(backupRun(), artifacts(), "12345"), true);
  assert.equal(validateBackupRun({ ...backupRun(), head_sha: "a".repeat(40) }, artifacts(), "12345"), false);
  assert.equal(validateBackupRun({ ...backupRun(), head_branch: "feature" }, artifacts(), "12345"), false);
  assert.equal(validateBackupRun(backupRun(), { ...artifacts(), artifacts: artifacts().artifacts.slice(0, 1) }, "12345"), false);
  assert.equal(validateBackupRun(backupRun(), { ...artifacts(), artifacts: artifacts().artifacts.map((artifact) => ({ ...artifact, expired: true })) }, "12345"), false);
  const responses = [new Response(JSON.stringify(backupRun()), { status: 200 }), new Response(JSON.stringify(artifacts()), { status: 200 })];
  assert.equal(await attestBackupRun("12345", "synthetic", async () => responses.shift()), true);
  assert.equal(await attestBackupRun("invalid", "synthetic", async () => { throw new Error("should not fetch"); }), false);
});

test("downloaded ciphertext must match the fixed receipt digest and path", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "staging-recovery-input-test-"));
  try {
    const archive = Buffer.from("age-encryption.org/v1\nsynthetic encrypted bytes");
    const archiveDir = path.join(root, "staging-recovery-input", "archive");
    const receiptDir = path.join(root, "staging-recovery-input", "receipt");
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.mkdirSync(receiptDir, { recursive: true });
    const archivePath = path.join(archiveDir, "wp2-readonly-restore.dump.age");
    fs.writeFileSync(archivePath, archive);
    fs.writeFileSync(path.join(receiptDir, "wp2-readonly-restore-receipt.json"), JSON.stringify(backupReceipt(archive)));
    assert.equal(verifyDownloadedBackup(root).receipt.migration.appliedCount, 58);
    fs.appendFileSync(archivePath, "tampered");
    assert.throws(() => verifyDownloadedBackup(root), /ENCRYPTED_ARCHIVE_MISMATCH/u);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("missing private identity blocks recovery before any Docker call", async () => {
  let calls = 0;
  const receipt = await runRecoveryDrill({ runId: "12345", runnerTemp: os.tmpdir(), identity: "", spawnImpl: () => { calls += 1; throw new Error("unexpected child"); } });
  assert.equal(calls, 0);
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.recoverability, "NOT_PROVEN");
  assert.equal(receipt.migrationAuthorization, "BLOCKED");
  assert.equal(validateRecoveryReceipt(receipt), true);
  const forged = createRecoveryReceipt("12345");
  forged.result = "PASS";
  forged.recoverability = "PROVEN_ISOLATED";
  assert.equal(validateRecoveryReceipt(forged), false);
  const unsafe = createRecoveryReceipt("12345");
  unsafe.archiveDigest = "customer@example.test";
  assert.equal(validateRecoveryReceipt(unsafe), false);
});
