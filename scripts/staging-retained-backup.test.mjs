import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseProductionRecipient, retainEncryptedBackup, validateStagingRecipient } from "./staging-retained-backup.mjs";
import { validateRetainedBackupPath } from "./validate-staging-retained-backup.mjs";
import { BACKUP_SOURCE_SHA, createInitialReceipt, sourceInventory } from "./secure-staging-runner.mjs";

const recipient = `age1${"a".repeat(58)}`;

test("staging recipient must be distinct from production and syntactically bounded", () => {
  const production = fs.readFileSync(path.join("ops", "backup", "keys", "production-backup.agepub"), "utf8").split(/\r?\n/u).find((line) => line.startsWith("age1"));
  assert.equal(validateStagingRecipient(production, production), "PRODUCTION_RECIPIENT_FORBIDDEN");
  assert.equal(validateStagingRecipient(recipient, null), "PRODUCTION_RECIPIENT_UNAVAILABLE");
  assert.equal(validateStagingRecipient("age1bad\nunsafe", production), "STAGING_RECIPIENT_INVALID");
  assert.equal(validateStagingRecipient(recipient, production), null);
  assert.equal(parseProductionRecipient(`${production}\n${recipient}\n`), null);
  assert.equal(parseProductionRecipient(` ${production}\n`), null);
  assert.equal(parseProductionRecipient("age1placeholder"), null);
  assert.equal(parseProductionRecipient(`# Production recipient\n${production}\n`), production);
});

test("only an age archive is retained and its digest is sanitized", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "staging-age-test-"));
  try {
    const dumpPath = path.join(root, "synthetic.dump");
    fs.writeFileSync(dumpPath, "synthetic fixture only");
    const retained = await retainEncryptedBackup({ dumpPath, runnerTemp: root, recipient, spawnImpl: (_command, args) => {
      fs.writeFileSync(args[3], "age-encryption.org/v1\nsynthetic ciphertext");
      return { status: 0 };
    } });
    assert.equal(retained.archiveName, "wp2-readonly-restore.dump.age");
    assert.match(retained.archiveDigest, /^sha256:[a-f0-9]{64}$/u);
    const receipt = createInitialReceipt(BACKUP_SOURCE_SHA);
    receipt.result = "PASS";
    receipt.lineage = { deploymentReads: 2, deploymentMatched: true, sourceMatched: true, preview: true, ready: true, healthStatus: 200, noRedirect: true, deploymentDigest: `sha256:${"a".repeat(64)}` };
    receipt.database = { connectionAttempts: 1, firstTransactionReadOnly: true, identityMatched: true, readQueries: 6, disconnected: true };
    receipt.migration = { expectedCount: sourceInventory(BACKUP_SOURCE_SHA).size, appliedCount: 58, unresolvedFailedCount: 0, rollbackEntryCount: 0, completedCounterpartCount: 0, exactChecksumCount: 58, formatVarianceCount: 0, unknownMismatchCount: 0, status: "BACKUP_READY_MIGRATIONS_PENDING" };
    receipt.backup = { attempts: 1, result: "PASS", byteBucket: "lt_1mib", digest: `sha256:${"b".repeat(64)}` };
    receipt.restore = { attempts: 1, result: "PASS", migrationCount: 58, schemaMatched: true, extensionsMatched: true, aggregateMatched: true, isolated: true };
    receipt.retention = { status: "ENCRYPTED", archiveDigest: retained.archiveDigest, recipientDigest: retained.recipientDigest, recoverability: "NOT_PROVEN", migrationAuthorization: "BLOCKED" };
    receipt.sideEffects.backupWrites = 1;
    receipt.sideEffects.isolatedRestoreWrites = 1;
    const receiptPath = path.join(root, "celebratedeal-secure-receipts", "wp2-readonly-restore-receipt.json");
    fs.writeFileSync(receiptPath, JSON.stringify(receipt));
    assert.equal(validateRetainedBackupPath(retained.archivePath, receiptPath, root), true);
    fs.appendFileSync(retained.archivePath, "tamper");
    assert.equal(validateRetainedBackupPath(retained.archivePath, receiptPath, root), false);
    assert.equal(fs.existsSync(path.join(root, "celebratedeal-secure-receipts", "synthetic.dump")), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("failed encryption leaves no uploadable archive", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "staging-age-fail-test-"));
  try {
    const dumpPath = path.join(root, "synthetic.dump");
    fs.writeFileSync(dumpPath, "synthetic fixture only");
    await assert.rejects(retainEncryptedBackup({ dumpPath, runnerTemp: root, recipient, spawnImpl: () => ({ status: 1 }) }), /STAGING_ENCRYPTION_FAILED/u);
    assert.equal(fs.existsSync(path.join(root, "celebratedeal-secure-receipts", "wp2-readonly-restore.dump.age")), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
