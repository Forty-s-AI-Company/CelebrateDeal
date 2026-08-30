import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";

import {
  classifyPostgresFailure,
  classifyRestoreFailure,
  createInitialReceipt,
  isolatedRestoreArgs,
  readOnlySql,
  REQUIRED_CONFIG_KEYS,
  REQUIRED_SECRET_KEYS,
  validateInvocation,
  validateReceipt,
  verifyDeployment,
  verifyTrustedMigrationTree,
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

test("squash-merged sources require an exact protected migration tree", () => {
  const trustedTree = "a".repeat(40);
  const matchingSpawn = (_command, args) => {
    const key = args.join(" ");
    if (key.startsWith("cat-file -e ")) return { status: 0, stdout: "" };
    if (key.startsWith("merge-base --is-ancestor ")) return { status: 1, stdout: "" };
    if (key === `rev-parse ${sha}:prisma/migrations` || key === "rev-parse HEAD:prisma/migrations") {
      return { status: 0, stdout: `${trustedTree}\n` };
    }
    return { status: 1, stdout: "" };
  };
  assert.deepEqual(verifyTrustedMigrationTree(sha, matchingSpawn), { mode: "squash-equivalent" });

  const mismatchedSpawn = (_command, args) => {
    const result = matchingSpawn(_command, args);
    return args.join(" ") === "rev-parse HEAD:prisma/migrations"
      ? { status: 0, stdout: `${"b".repeat(40)}\n` }
      : result;
  };
  assert.throws(() => verifyTrustedMigrationTree(sha, mismatchedSpawn), /SOURCE_MIGRATION_TREE_UNTRUSTED/u);
});

test("source queries begin an explicit read-only transaction without startup PGOPTIONS", () => {
  const wrapped = readOnlySql("SELECT current_setting('transaction_read_only')");
  assert.equal(wrapped, "BEGIN READ ONLY; SELECT current_setting('transaction_read_only'); COMMIT;");
  assert.throws(() => readOnlySql("UPDATE public.example SET value = 1"), /SOURCE_QUERY_NOT_READ_ONLY/u);
});

test("database stderr is reduced to fixed sanitized failure categories", () => {
  assert.equal(classifyPostgresFailure("password authentication failed for user [redacted]"), "DATABASE_AUTHENTICATION_FAILED");
  assert.equal(classifyPostgresFailure("connection timed out"), "DATABASE_NETWORK_FAILED");
  assert.equal(classifyPostgresFailure("unsupported startup parameter: options"), "DATABASE_POOLER_STARTUP_REJECTED");
  assert.equal(classifyPostgresFailure("unrecognized provider response"), "DATABASE_CONNECTION_OR_QUERY_FAILED");
  for (const sample of ["credential=value", "postgresql://example", "user@example.test"]) {
    assert.match(classifyPostgresFailure(sample), /^[A-Z0-9_]+$/u);
  }
});

test("restore stderr is reduced to fixed sanitized failure categories", () => {
  assert.equal(classifyRestoreFailure('error: role "supabase_admin" does not exist'), "ISOLATED_RESTORE_ROLE_DEPENDENCY");
  assert.equal(classifyRestoreFailure('error: schema "auth" does not exist'), "ISOLATED_RESTORE_SCHEMA_DEPENDENCY");
  assert.equal(classifyRestoreFailure("function auth.uid() does not exist"), "ISOLATED_RESTORE_AUTH_FUNCTION_DEPENDENCY");
  assert.equal(classifyRestoreFailure("function public.uuid_generate_v4() does not exist"), "ISOLATED_RESTORE_UUID_OSSP_DEPENDENCY");
  assert.equal(classifyRestoreFailure("function extensions.digest(text, text) does not exist"), "ISOLATED_RESTORE_PGCRYPTO_DEPENDENCY");
  assert.equal(classifyRestoreFailure("operator class extensions.gin_trgm_ops does not exist"), "ISOLATED_RESTORE_PG_TRGM_DEPENDENCY");
  assert.equal(classifyRestoreFailure("type extensions.vector does not exist"), "ISOLATED_RESTORE_VECTOR_DEPENDENCY");
  assert.equal(classifyRestoreFailure("function public.audit_trigger() does not exist"), "ISOLATED_RESTORE_PUBLIC_OBJECT_DEPENDENCY");
  assert.equal(classifyRestoreFailure("unsupported version (1.16) in file header"), "ISOLATED_RESTORE_ARCHIVE_INCOMPATIBLE");
  assert.equal(classifyRestoreFailure('relation "Example" already exists'), "ISOLATED_RESTORE_TARGET_CONFLICT");
  assert.equal(classifyRestoreFailure("unrecognized restore failure"), "ISOLATED_RESTORE_COMMAND_FAILED");
  for (const sample of ["credential=value", "postgresql://example", "user@example.test"]) {
    assert.match(classifyRestoreFailure(sample), /^[A-Z0-9_]+$/u);
  }
});

test("isolated restore connects as the container postgres role", () => {
  const containerId = "a".repeat(64);
  assert.deepEqual(isolatedRestoreArgs(containerId), [
    "exec",
    containerId,
    "pg_restore",
    "--username=postgres",
    "--no-owner",
    "--no-privileges",
    "--exit-on-error",
    "--single-transaction",
    "--dbname=celebratedeal_restore",
    "/tmp/staging-public.dump",
  ]);
  assert.throws(() => isolatedRestoreArgs("not-a-container"), /ISOLATED_CONTAINER_ID_INVALID/u);
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
