import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";

import {
  createInitialReceipt,
  REQUIRED_CONFIG_KEYS,
  REQUIRED_SECRET_KEYS,
  validateInvocation,
  validateReceipt,
  verifyDeployment,
} from "./secure-staging-runner.mjs";

const sha = "e65485d5fd5f54d2c6bb9fe8231f55eac809376e";

function environment() {
  return {
    STAGING_DATABASE_URL: ["postgresql:", "", "postgres.projectref:fixture@aws-0-ap-northeast-1.pooler.supabase.com:5432", "postgres"].join("/"),
    GITHUB_TOKEN: "present",
    NEXT_PUBLIC_SUPABASE_URL: "https://projectref.supabase.co",
    CELEBRATEDEAL_SOURCE_SHA: sha,
    CELEBRATEDEAL_DEPLOYMENT_HOST: "safe-preview.vercel.app",
    RUNNER_TEMP: os.tmpdir(),
  };
}

function completePassReceipt() {
  const receipt = createInitialReceipt(sha);
  receipt.result = "PASS";
  receipt.lineage = { deploymentReads: 2, deploymentMatched: true, sourceMatched: true, preview: true, ready: true, healthStatus: 200, noRedirect: true, deploymentDigest: `sha256:${"a".repeat(64)}` };
  receipt.database = { connectionAttempts: 1, firstTransactionReadOnly: true, identityMatched: true, readQueries: 6, disconnected: true };
  receipt.migration = { expectedCount: 58, appliedCount: 58, unresolvedFailedCount: 0, rollbackEntryCount: 1, completedCounterpartCount: 1, exactChecksumCount: 57, formatVarianceCount: 1, unknownMismatchCount: 0, status: "UP_TO_DATE_FORMAT_VARIANCE" };
  receipt.backup = { attempts: 1, result: "PASS", byteBucket: "1_to_10mib", digest: `sha256:${"b".repeat(64)}` };
  receipt.restore = { attempts: 1, result: "PASS", migrationCount: 58, schemaMatched: true, extensionsMatched: true, aggregateMatched: true, isolated: true };
  receipt.sideEffects.backupWrites = 1;
  receipt.sideEffects.isolatedRestoreWrites = 1;
  return receipt;
}

test("only the fixed WP2 task and complete allowlisted bindings are accepted", () => {
  const source = environment();
  assert.equal(validateInvocation("wp2-readonly-restore", source).ok, true);
  assert.equal(validateInvocation("arbitrary-command", source).reason, "TASK_NOT_ALLOWLISTED");
  for (const key of [...REQUIRED_SECRET_KEYS, ...REQUIRED_CONFIG_KEYS]) {
    assert.equal(validateInvocation("wp2-readonly-restore", { ...source, [key]: "" }).ok, false, key);
  }
});

test("cross-project database identity and non-Preview hosts fail closed", () => {
  const source = environment();
  assert.equal(validateInvocation("wp2-readonly-restore", { ...source, CELEBRATEDEAL_DEPLOYMENT_HOST: "staging.example.net" }).reason, "DEPLOYMENT_HOST_INVALID");
  const wrongProject = ["postgresql:", "", "postgres.other:fixture@aws-0.pooler.supabase.com:5432", "postgres"].join("/");
  assert.equal(validateInvocation("wp2-readonly-restore", { ...source, STAGING_DATABASE_URL: wrongProject }).reason, "STAGING_DATABASE_IDENTITY_INVALID");
});

test("deployment verification requires one exact non-production successful Preview", async () => {
  const source = environment();
  const responses = [
    new Response(JSON.stringify([{ id: 42, sha, environment: "Preview – celebrate-deal-staging", production_environment: false }]), { status: 200 }),
    new Response(JSON.stringify([{ state: "success", environment_url: "https://safe-preview.vercel.app" }]), { status: 200 }),
  ];
  const result = await verifyDeployment(source, async () => responses.shift());
  assert.equal(result.sourceMatched, true);
  const productionResponses = [new Response(JSON.stringify([{ id: 42, sha, environment: "Preview – celebrate-deal-staging", production_environment: true }]), { status: 200 })];
  await assert.rejects(verifyDeployment(source, async () => productionResponses.shift()), /GITHUB_DEPLOYMENT_AMBIGUOUS/u);
});

test("sanitized current-source PASS receipt satisfies the full gate", () => {
  const receipt = completePassReceipt();
  assert.deepEqual(validateReceipt(receipt), { ok: true, errors: [] });
  assert.doesNotMatch(JSON.stringify(receipt), /postgres|https?:|password|token|cookie/iu);
});

test("receipt validation rejects extra fields, writes and secret-bearing text", () => {
  const receipt = completePassReceipt();
  receipt.database.rawRow = "unexpected";
  receipt.sideEffects.databaseWrites = 1;
  receipt.failureCategory = "https://unexpected.example";
  const errors = validateReceipt(receipt).errors;
  assert.equal(errors.includes("SCHEMA_DATABASE"), true);
  assert.equal(errors.includes("FORBIDDEN_SIDE_EFFECTS"), true);
  assert.equal(errors.includes("FORBIDDEN_TEXT"), true);
});
