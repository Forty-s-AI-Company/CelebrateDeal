import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";

import {
  classifyPostgresFailure,
  classifyRestoreFailure,
  createInitialReceipt,
  filteredRestoreList,
  isolatedReadinessArgs,
  isolatedRestoreArgs,
  parseExtensionPlacements,
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
  assert.equal(result.reads, 2);
  const productionResponses = [new Response(JSON.stringify([{ id: 42, sha, environment: "Preview – celebrate-deal-staging", production_environment: true }]), { status: 200 })];
  await assert.rejects(verifyDeployment(source, async () => productionResponses.shift()), /GITHUB_DEPLOYMENT_AMBIGUOUS/u);
});

test("deployment verification reads every candidate and ignores latest failure records", async () => {
  const source = environment();
  const requests = [];
  const responses = [
    new Response(JSON.stringify([
      { id: 41, sha, environment: "Preview – celebrate-deal-staging", production_environment: false },
      { id: 42, sha, environment: "Preview – celebrate-deal-staging", production_environment: false },
    ]), { status: 200 }),
    new Response(JSON.stringify([{ state: "failure", environment_url: "https://safe-preview.vercel.app" }]), { status: 200 }),
    new Response(JSON.stringify([{ state: "success", environment_url: "https://safe-preview.vercel.app/" }]), { status: 200 }),
  ];
  const result = await verifyDeployment(source, async (input) => {
    requests.push(new URL(String(input)));
    return responses.shift();
  });

  assert.equal(result.deploymentMatched, true);
  assert.equal(result.reads, 3);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].searchParams.get("per_page"), "10");
  assert.deepEqual(requests.slice(1).map((request) => [request.pathname, request.searchParams.get("per_page")]), [
    ["/repos/Forty-s-AI-Company/CelebrateDeal/deployments/41/statuses", "1"],
    ["/repos/Forty-s-AI-Company/CelebrateDeal/deployments/42/statuses", "1"],
  ]);
  assert.doesNotMatch(JSON.stringify(result), /https?:\/\//iu);
});

test("deployment verification follows a Link-header page for a unique exact-host success", async () => {
  const source = environment();
  const requests = [];
  const pageOne = [
    { id: 41, sha, environment: "Preview – celebrate-deal-staging", production_environment: false },
    ...Array.from({ length: 9 }, (_, index) => ({ id: 100 + index, sha: "f".repeat(40), environment: "Preview – celebrate-deal-staging", production_environment: false })),
  ];
  const responses = [
    new Response(JSON.stringify(pageOne), {
      status: 200,
      headers: { Link: '<https://api.github.com/repos/Forty-s-AI-Company/CelebrateDeal/deployments?page=2>; rel="next"' },
    }),
    new Response(JSON.stringify([{ state: "failure", environment_url: "https://safe-preview.vercel.app" }]), { status: 200 }),
    new Response(JSON.stringify([{ id: 42, sha, environment: "Preview – celebrate-deal-staging", production_environment: false }]), { status: 200 }),
    new Response(JSON.stringify([{ state: "success", target_url: "https://safe-preview.vercel.app/" }]), { status: 200 }),
  ];
  const result = await verifyDeployment(source, async (input) => {
    requests.push(new URL(String(input)));
    return responses.shift();
  });

  assert.equal(result.deploymentMatched, true);
  assert.equal(result.reads, 4);
  assert.deepEqual(requests.filter((request) => request.pathname.endsWith("/deployments")).map((request) => request.searchParams.get("page")), ["1", "2"]);
});

test("deployment verification rejects a malformed Link header before accepting page-one success", async () => {
  const source = environment();
  const pageOne = [
    { id: 42, sha, environment: "Preview – celebrate-deal-staging", production_environment: false },
    ...Array.from({ length: 9 }, (_, index) => ({ id: 300 + index, sha: "f".repeat(40), environment: "Preview – celebrate-deal-staging", production_environment: false })),
  ];
  const requests = [];
  await assert.rejects(
    verifyDeployment(source, async (input) => {
      requests.push(new URL(String(input)));
      return new Response(JSON.stringify(pageOne), { status: 200, headers: { Link: "malformed-pagination" } });
    }),
    /GITHUB_DEPLOYMENT_PAGINATION_INVALID/u,
  );
  assert.equal(requests.length, 1);
});

test("deployment verification accepts a valid terminal Link header without next", async () => {
  const source = environment();
  const requests = [];
  const responses = [
    new Response(JSON.stringify([{ id: 42, sha, environment: "Preview – celebrate-deal-staging", production_environment: false }]), {
      status: 200,
      headers: { Link: '<https://api.github.com/repos/Forty-s-AI-Company/CelebrateDeal/deployments?page=1>; rel="last"' },
    }),
    new Response(JSON.stringify([{ state: "success", environment_url: "https://safe-preview.vercel.app" }]), { status: 200 }),
  ];
  const result = await verifyDeployment(source, async (input) => {
    requests.push(new URL(String(input)));
    return responses.shift();
  });
  assert.equal(result.deploymentMatched, true);
  assert.equal(result.reads, 2);
  assert.deepEqual(requests.map((request) => request.searchParams.get("page")), ["1", null]);
});

test("deployment verification reads across full pages before rejecting multiple exact-host successes", async () => {
  const source = environment();
  const requests = [];
  const pageOne = [
    { id: 41, sha, environment: "Preview – celebrate-deal-staging", production_environment: false },
    ...Array.from({ length: 9 }, (_, index) => ({ id: 200 + index, sha, environment: "Preview – celebrate-deal-staging", production_environment: true })),
  ];
  const responses = [
    new Response(JSON.stringify(pageOne), { status: 200 }),
    new Response(JSON.stringify([{ state: "success", environment_url: "https://safe-preview.vercel.app" }]), { status: 200 }),
    new Response(JSON.stringify([{ id: 42, sha, environment: "Preview – celebrate-deal-staging", production_environment: false }]), { status: 200 }),
    new Response(JSON.stringify([{ state: "success", target_url: "https://safe-preview.vercel.app/" }]), { status: 200 }),
  ];
  await assert.rejects(
    verifyDeployment(source, async (input) => {
      requests.push(new URL(String(input)));
      return responses.shift();
    }),
    /GITHUB_DEPLOYMENT_AMBIGUOUS/u,
  );
  assert.equal(requests.length, 4);
  assert.deepEqual(requests.filter((request) => request.pathname.endsWith("/deployments")).map((request) => request.searchParams.get("page")), ["1", "2"]);
});

test("deployment verification fails closed when pagination exhausts the total GitHub read budget", async () => {
  const source = environment();
  const requests = [];
  await assert.rejects(
    verifyDeployment(source, async (input) => {
      const request = new URL(String(input));
      requests.push(request);
      if (request.pathname.endsWith("/statuses")) {
        return new Response(JSON.stringify([{ state: "failure", environment_url: "https://safe-preview.vercel.app" }]), { status: 200 });
      }
      const page = Number(request.searchParams.get("page"));
      const deployments = Array.from({ length: 10 }, (_, index) => ({ id: page * 100 + index, sha, environment: "Preview – celebrate-deal-staging", production_environment: false }));
      return new Response(JSON.stringify(deployments), {
        status: 200,
        headers: { Link: `<https://api.github.com/repos/Forty-s-AI-Company/CelebrateDeal/deployments?page=${page + 1}>; rel="next"` },
      });
    }),
    /GITHUB_DEPLOYMENT_READ_BUDGET_EXHAUSTED/u,
  );
  assert.equal(requests.length, 20);
  assert.equal(requests.filter((request) => request.pathname.endsWith("/deployments")).length, 2);
  assert.equal(requests.filter((request) => request.pathname.endsWith("/statuses")).length, 18);
});

test("deployment verification fails closed with zero successful exact-host candidates", async () => {
  const source = environment();
  const responses = [
    new Response(JSON.stringify([{ id: 42, sha, environment: "Preview – celebrate-deal-staging", production_environment: false }]), { status: 200 }),
    new Response(JSON.stringify([{ state: "failure", environment_url: "https://safe-preview.vercel.app" }]), { status: 200 }),
  ];
  await assert.rejects(
    verifyDeployment(source, async () => responses.shift()),
    /GITHUB_DEPLOYMENT_LINEAGE_MISMATCH/u,
  );
});

test("deployment verification fails closed with multiple successful exact-host candidates", async () => {
  const source = environment();
  const responses = [
    new Response(JSON.stringify([
      { id: 41, sha, environment: "Preview – celebrate-deal-staging", production_environment: false },
      { id: 42, sha, environment: "Preview – celebrate-deal-staging", production_environment: false },
    ]), { status: 200 }),
    new Response(JSON.stringify([{ state: "success", environment_url: "https://safe-preview.vercel.app" }]), { status: 200 }),
    new Response(JSON.stringify([{ state: "success", target_url: "https://safe-preview.vercel.app/" }]), { status: 200 }),
  ];
  await assert.rejects(
    verifyDeployment(source, async () => responses.shift()),
    /GITHUB_DEPLOYMENT_AMBIGUOUS/u,
  );
});

test("deployment verification accepts GitHub target_url and rejects conflicting status URLs", async () => {
  const source = environment();
  const targetUrlResponses = [
    new Response(JSON.stringify([{ id: 42, sha, environment: "Preview – celebrate-deal-staging", production_environment: false }]), { status: 200 }),
    new Response(JSON.stringify([{ state: "success", target_url: "https://safe-preview.vercel.app" }]), { status: 200 }),
  ];
  const result = await verifyDeployment(source, async () => targetUrlResponses.shift());
  assert.equal(result.deploymentMatched, true);

  const conflictingResponses = [
    new Response(JSON.stringify([{ id: 42, sha, environment: "Preview – celebrate-deal-staging", production_environment: false }]), { status: 200 }),
    new Response(JSON.stringify([{
      state: "success",
      environment_url: "https://safe-preview.vercel.app",
      target_url: "https://different-preview.vercel.app",
    }]), { status: 200 }),
  ];
  await assert.rejects(
    verifyDeployment(source, async () => conflictingResponses.shift()),
    /GITHUB_DEPLOYMENT_LINEAGE_MISMATCH/u,
  );
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
    "--use-list=/tmp/staging-public.list",
    "--dbname=celebratedeal_restore",
    "/tmp/staging-public.dump",
  ]);
  assert.throws(() => isolatedRestoreArgs("not-a-container"), /ISOLATED_CONTAINER_ID_INVALID/u);
});

test("isolated readiness verifies the exact restore database", () => {
  const containerId = "b".repeat(64);
  const args = isolatedReadinessArgs(containerId);
  assert.deepEqual(args.slice(0, 5), ["exec", containerId, "psql", "-U", "postgres"]);
  assert.deepEqual(args.slice(-4), ["-v", "ON_ERROR_STOP=1", "-c", "SELECT 1;"]);
  assert.equal(args.includes("celebratedeal_restore"), true);
  assert.equal(args.includes("pg_isready"), false);
});

test("isolated restore mirrors allowlisted source extension placement", () => {
  assert.deepEqual(parseExtensionPlacements("pg_trgm|public\npgcrypto|extensions\n"), {
    pg_trgm: "public",
    pgcrypto: "extensions",
  });
  assert.throws(() => parseExtensionPlacements("pg_trgm|private\npgcrypto|extensions\n"), /SOURCE_EXTENSION_SCHEMA_UNSUPPORTED/u);
  assert.throws(() => parseExtensionPlacements("pg_trgm|public\n"), /SOURCE_EXTENSION_INVENTORY_INVALID/u);
  assert.throws(() => parseExtensionPlacements("pg_trgm|public|extra\npgcrypto|extensions\n"), /SOURCE_EXTENSION_INVENTORY_INVALID/u);
});

test("restore TOC removes only the pre-created public schema entry", () => {
  const toc = "; archive\n1; 2615 2200 SCHEMA - public postgres\n2; 1259 1 TABLE public Example postgres\n";
  const filtered = filteredRestoreList(toc);
  assert.doesNotMatch(filtered, /SCHEMA\s+-\s+public/u);
  assert.match(filtered, /TABLE public Example/u);
  assert.throws(() => filteredRestoreList("; archive\n2; TABLE public Example\n"), /ISOLATED_PUBLIC_SCHEMA_TOC_INVALID/u);
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
