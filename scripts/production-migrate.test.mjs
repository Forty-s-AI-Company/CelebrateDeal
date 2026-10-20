import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { FIXED_STAGING_REF, MIGRATION_SESSION_OPTIONS } from "./staging-migrate.mjs";
import {
  BACKUP_MAX_AGE_MS, FIXED_PRODUCTION_REF, parseProductionDatabaseUrl, run, verifyBackupRun,
} from "./production-migrate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Built from parts so the repository secret scan does not see a literal database URL.
const url = (authority, suffix = "") => ["postgresql:", "", `${authority}/postgres${suffix}`].join("/");
const directHost = `db.${FIXED_PRODUCTION_REF}.supabase.co`;
const poolerHost = "aws-0-ap-northeast-1.pooler.supabase.com";
const poolerUser = `postgres.${FIXED_PRODUCTION_REF}`;
const direct = url(`postgres:synthetic-password@${directHost}:5432`);
const pooler = url(`${poolerUser}:synthetic-password@${poolerHost}:6543`);
const failure = (value) => parseProductionDatabaseUrl(value).failure ?? null;

const now = Date.parse("2026-10-21T12:00:00.000Z");
const backupEnv = {
  BACKUP_RUN_ID: "18765432101",
  PRODUCTION_BACKUP_WORKFLOW_PATH: ".github/workflows/production-backup.yml",
  GITHUB_REPOSITORY: "owner/celebratedeal",
  GITHUB_TOKEN: "synthetic-token",
};
const goodRun = {
  path: ".github/workflows/production-backup.yml",
  head_branch: "master",
  status: "completed",
  conclusion: "success",
  updated_at: new Date(now - 60 * 60 * 1000).toISOString(),
};
const fetchReturning = (body, ok = true) => async () => ({ ok, json: async () => body });

test("accepts only the fixed Production project over a TLS session connection", () => {
  assert.equal(failure(direct), null);
  assert.equal(failure(pooler), null);
  const built = new URL(parseProductionDatabaseUrl(pooler).url);
  assert.equal(built.port, "5432");
  assert.equal(built.searchParams.get("sslmode"), "require");
  assert.equal(built.searchParams.get("options"), MIGRATION_SESSION_OPTIONS);
  assert.match(MIGRATION_SESSION_OPTIONS, /lock_timeout=5000/u);
  assert.match(MIGRATION_SESSION_OPTIONS, /statement_timeout=60000/u);
  assert.equal(failure(direct.replaceAll(FIXED_PRODUCTION_REF, FIXED_STAGING_REF)), "PRODUCTION_DATABASE_IS_STAGING");
  assert.equal(failure(pooler.replace(poolerUser, `postgres.${FIXED_STAGING_REF}`)), "PRODUCTION_DATABASE_IS_STAGING");
  assert.equal(failure(direct.replace(FIXED_PRODUCTION_REF, "aaaaaaaaaaaaaaaaaaaa")), "PRODUCTION_PROJECT_MISMATCH");
  assert.equal(failure(direct.replace(":5432/", ":6543/")), "PRODUCTION_DATABASE_PORT_INVALID");
  assert.equal(failure(`${direct}?host=evil.example.test`), "PRODUCTION_DATABASE_QUERY_KEY_UNSUPPORTED");
  assert.equal(failure(`${direct}?options=-c%20statement_timeout%3D0`), "PRODUCTION_DATABASE_QUERY_KEY_UNSUPPORTED");
  assert.equal(failure(`${direct}?sslmode=disable`), "PRODUCTION_DATABASE_SSLMODE_QUERY_INVALID");
  assert.equal(failure(`${direct}?schema=other`), "PRODUCTION_DATABASE_SCHEMA_QUERY_INVALID");
  assert.equal(failure(undefined), "PRODUCTION_DATABASE_URL_INVALID");
});

test("backup verification requires a fresh successful run of the designated workflow on master", async () => {
  assert.equal(await verifyBackupRun(backupEnv, { fetchImpl: fetchReturning(goodRun), now }), null);
  assert.equal(await verifyBackupRun({ ...backupEnv, BACKUP_RUN_ID: "abc" }, { fetchImpl: fetchReturning(goodRun), now }), "BACKUP_RUN_ID_INVALID");
  assert.equal(await verifyBackupRun({ ...backupEnv, BACKUP_RUN_ID: "1;rm -rf" }, { fetchImpl: fetchReturning(goodRun), now }), "BACKUP_RUN_ID_INVALID");
  assert.equal(await verifyBackupRun({ ...backupEnv, PRODUCTION_BACKUP_WORKFLOW_PATH: "" }, { fetchImpl: fetchReturning(goodRun), now }), "BACKUP_WORKFLOW_NOT_CONFIGURED");
  assert.equal(await verifyBackupRun({ ...backupEnv, PRODUCTION_BACKUP_WORKFLOW_PATH: ".github/workflows/production-migrate.yml" }, { fetchImpl: fetchReturning(goodRun), now }), "BACKUP_WORKFLOW_NOT_CONFIGURED");
  assert.equal(await verifyBackupRun(backupEnv, { fetchImpl: fetchReturning({}, false), now }), "BACKUP_RUN_NOT_FOUND");
  assert.equal(await verifyBackupRun(backupEnv, { fetchImpl: async () => { throw new Error("network"); }, now }), "BACKUP_RUN_LOOKUP_FAILED");
  assert.equal(await verifyBackupRun(backupEnv, { fetchImpl: fetchReturning({ ...goodRun, path: ".github/workflows/ci.yml" }), now }), "BACKUP_RUN_WRONG_WORKFLOW");
  assert.equal(await verifyBackupRun(backupEnv, { fetchImpl: fetchReturning({ ...goodRun, head_branch: "codex/x" }), now }), "BACKUP_RUN_NOT_MASTER");
  assert.equal(await verifyBackupRun(backupEnv, { fetchImpl: fetchReturning({ ...goodRun, conclusion: "failure" }), now }), "BACKUP_RUN_NOT_SUCCESSFUL");
  assert.equal(await verifyBackupRun(backupEnv, { fetchImpl: fetchReturning({ ...goodRun, status: "in_progress" }), now }), "BACKUP_RUN_NOT_SUCCESSFUL");
  const stale = new Date(now - BACKUP_MAX_AGE_MS - 1).toISOString();
  assert.equal(await verifyBackupRun(backupEnv, { fetchImpl: fetchReturning({ ...goodRun, updated_at: stale }), now }), "BACKUP_RUN_TOO_OLD");
});

function fakeRunner(outputs) {
  const calls = [];
  return {
    calls,
    runner: (args, env) => {
      calls.push({ args, env });
      return outputs.shift();
    },
  };
}

test("deploy verifies the backup before touching the database, then runs status before deploy", async () => {
  const blocked = fakeRunner([]);
  const refused = await run("deploy", { PRODUCTION_DATABASE_URL: direct, ...backupEnv, BACKUP_RUN_ID: "" }, { runner: blocked.runner, emit: () => {}, fetchImpl: fetchReturning(goodRun), now });
  assert.deepEqual(refused, { code: 1, lines: ["BACKUP_RUN_ID_INVALID"] });
  assert.equal(blocked.calls.length, 0);

  const ok = fakeRunner([
    { status: 1, output: "115 migrations found in prisma/migrations\nFollowing migration have not yet been applied:\n20261021130100_landing_page_archive_restrict_funnel" },
    { status: 0, output: "The following migration(s) have been applied:\n└─ 20261021130100_landing_page_archive_restrict_funnel/\nAll migrations have been successfully applied." },
  ]);
  const emitted = [];
  const result = await run("deploy", { PRODUCTION_DATABASE_URL: direct, PATH: "/bin", SECRET_EXTRA: "x", ...backupEnv }, { runner: ok.runner, emit: (line) => emitted.push(line), fetchImpl: fetchReturning(goodRun), now });
  assert.equal(result.code, 0);
  assert.deepEqual(ok.calls.map((call) => call.args), [["migrate", "status"], ["migrate", "deploy"]]);
  assert.deepEqual(Object.keys(ok.calls[1].env).sort(), ["CHECKPOINT_DISABLE", "DATABASE_URL", "DIRECT_URL", "HOME", "PATH", "PRISMA_HIDE_UPDATE_MESSAGE"]);
  assert.ok(emitted.every((line) => line.startsWith("::add-mask::")));
  assert.ok(result.lines.includes("All migrations have been successfully applied."));
});

test("deploy refuses a failed migration (P3009) or diverged history and never retries", async () => {
  const failed = fakeRunner([{ status: 1, output: "Error: P3009\nmigrate found failed migrations in the target database\nThe `20261021130000_payment_account_masked_legacy_number` migration started at 2026-10-21 failed" }]);
  const result = await run("deploy", { PRODUCTION_DATABASE_URL: direct, ...backupEnv }, { runner: failed.runner, emit: () => {}, fetchImpl: fetchReturning(goodRun), now });
  assert.notEqual(result.code, 0);
  assert.ok(result.lines.includes("PRODUCTION_HISTORY_DIVERGED"));
  assert.ok(result.lines.includes("PRISMA_ERROR P3009"));
  assert.equal(failed.calls.length, 1);
});

test("status is read-only, needs no backup and prints only allowlisted lines", async () => {
  const status = fakeRunner([{ status: 1, output: `Datasource "db": PostgreSQL database "postgres" at "${directHost}:5432"\nFollowing migration have not yet been applied:\n20261021130000_payment_account_masked_legacy_number` }]);
  const result = await run("status", { PRODUCTION_DATABASE_URL: direct }, { runner: status.runner, emit: () => {} });
  assert.equal(result.code, 0);
  assert.ok(result.lines.includes("PRODUCTION_MIGRATIONS_PENDING"));
  assert.ok(result.lines.every((line) => !line.includes(directHost) && !line.includes("synthetic-password")));
  assert.equal(status.calls.length, 1);
  assert.deepEqual(await run("reset", { PRODUCTION_DATABASE_URL: direct }), { code: 2, lines: ["PRODUCTION_MIGRATE_MODE_INVALID"] });
});

test("workflow is manual, production-environment gated, protected-branch only and never echoes inputs into shell", () => {
  const source = fs.readFileSync(path.join(root, ".github", "workflows", "production-migrate.yml"), "utf8");
  const workflow = yaml.load(source);
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.backup_run_id.required, true);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.mode.options, ["status", "deploy"]);
  assert.deepEqual(workflow.permissions, { contents: "read", actions: "read" });
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  const job = workflow.jobs.migrate;
  assert.equal(job.environment, "production");
  assert.match(job.if, /github\.ref == 'refs\/heads\/master'/u);
  assert.match(job.if, /github\.ref_protected/u);
  for (const step of job.steps) {
    if (typeof step.run === "string") assert.doesNotMatch(step.run, /\$\{\{/u, `${step.name} must pass inputs through env`);
  }
  const secretRefs = [...source.matchAll(/secrets\.([A-Z0-9_]+)/gu)].map((match) => match[1]);
  assert.deepEqual([...new Set(secretRefs)], ["PRODUCTION_DATABASE_URL"]);
  const actionUses = [...source.matchAll(/^\s*uses:\s*([^\s#]+).*$/gmu)].map((match) => match[1]);
  assert.ok(actionUses.length > 0 && actionUses.every((value) => /@[a-f0-9]{40}$/u.test(value)));
  assert.doesNotMatch(source, /pull_request|schedule:|secrets:\s*inherit|toJSON\(secrets\)/iu);
});
