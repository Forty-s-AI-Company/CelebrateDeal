import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { applyMigrations, databaseIdentity, databaseIdentityFailureCode, FIXED_SOURCE_SHA, historyMatches, migrationUrlWithLockTimeout, validateApplyReceipt,
  validateInvocation, validatePrerequisites, validateProducerRun, verifyProducerRuns,
  verifySourcePull } from "./staging-migration-apply.mjs";

const ref = "ocbugvgojrunvenozsbx";
const host = "celebrate-deal-staging-jtozttm8m-a25814740s-projects.vercel.app";
function syntheticDbUrl(hostname) {
  const parsed = new URL("postgresql://localhost:5432/postgres");
  parsed.hostname = hostname;
  parsed.username = "postgres";
  parsed.password = "synthetic";
  return parsed.href;
}
const url = syntheticDbUrl(`db.${ref}.supabase.co`);
const digest = crypto.createHash("sha256").update([`db.${ref}.supabase.co`, "5432", "/postgres", "postgres", "public"].join("\n")).digest("hex");
const source = {
  GITHUB_REF: "refs/heads/master", GITHUB_REF_PROTECTED: "true",
  GITHUB_REPOSITORY: "Forty-s-AI-Company/CelebrateDeal",
  GITHUB_WORKFLOW_REF: "Forty-s-AI-Company/CelebrateDeal/.github/workflows/staging-migration-apply.yml@refs/heads/master",
  GITHUB_RUN_ID: "123", GITHUB_SHA: "a".repeat(40), GITHUB_TOKEN: "synthetic", RUNNER_TEMP: "/tmp/synthetic",
  CELEBRATEDEAL_SOURCE_SHA: FIXED_SOURCE_SHA, CELEBRATEDEAL_DEPLOYMENT_HOST: host,
  STAGING_DATABASE_URL: url, NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
};
const ids = { replay: 10 };
const evidence = {
  runIds: ids,
  replay: { result: "PASS", sourceCommit: FIXED_SOURCE_SHA,
    schemaVersion: "celebratedeal-staging-isolated-migration-replay/v1",
    stage: "ISOLATED_SQL_REPLAY_COMPLETE", sourceMigrationCount: 58,
    expectedMigrationCount: 79, pendingMigrationCount: 21, replayedMigrationCount: 21,
    sourceMetadataMatched: true, sourceTableCountsMatched: true,
    sourceExtensionsMatched: true, sourceAggregateMatched: true,
    postReplaySchemaVerified: true, postReplayHistoryUnchanged: true,
    prismaMigrateDeployRun: false, isolatedNetwork: "none", rawDumpPersisted: false,
    databaseWrites: 0, productionOperations: 0 },
};

test("fixed non-Production URL, project, protected branch and workflow are required", () => {
  assert.equal(validateInvocation(source), null);
  assert.equal(databaseIdentity(source)?.digest, digest);
  assert.equal(databaseIdentity({ ...source, STAGING_DATABASE_URL: `${url}?sslmode=require` })?.digest, digest);
  assert.equal(databaseIdentity({ ...source, STAGING_DATABASE_URL: `${url}?pgbouncer=true` })?.digest, digest);
  assert.equal(databaseIdentity({ ...source, STAGING_DATABASE_URL: `${url}?connection_limit=1&connect_timeout=10&pool_timeout=20` })?.digest, digest);
  for (const change of [
    { GITHUB_REF_PROTECTED: "false" }, { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_WORKFLOW_REF: "Forty-s-AI-Company/CelebrateDeal/.github/workflows/other.yml@refs/heads/master" },
    { STAGING_DATABASE_URL: syntheticDbUrl("db.production.supabase.co") },
    { STAGING_DATABASE_URL: syntheticDbUrl("db.abcdefghijklmnopqrst.supabase.co"),
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" },
    { CELEBRATEDEAL_DEPLOYMENT_HOST: "other-preview.vercel.app" },
    { CELEBRATEDEAL_SOURCE_SHA: "0".repeat(40) },
    { STAGING_DATABASE_URL: `${url}?sslmode=disable` },
    { STAGING_DATABASE_URL: `${url}?sslmode=require&sslmode=require` },
    { STAGING_DATABASE_URL: `${url}?pgbouncer=false` },
    { STAGING_DATABASE_URL: `${url}?connection_limit=0` },
    { STAGING_DATABASE_URL: `${url}?host=other.example.test` },
    { STAGING_DATABASE_URL: `${url}?options=-c%20search_path%3Dother` },
    { STAGING_DATABASE_URL: url.replace(":5432/", ":6543/") },
    { GITHUB_SHA: "invalid" },
  ]) assert.notEqual(validateInvocation({ ...source, ...change }), null);
});

test("database identity failures expose only fixed categories before any migration", () => {
  const cases = [
    [{ STAGING_DATABASE_URL: "" }, "STAGING_DATABASE_URL_MISSING"],
    [{ NEXT_PUBLIC_SUPABASE_URL: "" }, "STAGING_SUPABASE_URL_MISSING"],
    [{ NEXT_PUBLIC_SUPABASE_URL: "https://example.test" }, "STAGING_SUPABASE_URL_INVALID"],
    [{ NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" }, "STAGING_PROJECT_MISMATCH"],
    [{ STAGING_DATABASE_URL: `${url}?unsupported=private` }, "STAGING_DATABASE_QUERY_KEY_UNSUPPORTED"],
    [{ STAGING_DATABASE_URL: `${url}?schema=other` }, "STAGING_DATABASE_SCHEMA_QUERY_INVALID"],
    [{ STAGING_DATABASE_URL: `${url}?sslmode=disable` }, "STAGING_DATABASE_SSLMODE_QUERY_INVALID"],
    [{ STAGING_DATABASE_URL: `${url}?pgbouncer=false` }, "STAGING_DATABASE_PGBOUNCER_QUERY_INVALID"],
    [{ STAGING_DATABASE_URL: `${url}?sslmode=require&sslmode=require` }, "STAGING_DATABASE_QUERY_DUPLICATE"],
    [{ STAGING_DATABASE_URL: `${url}?connection_limit=0` }, "STAGING_DATABASE_QUERY_HINT_INVALID"],
    [{ STAGING_DATABASE_URL: `${url}?host=other.example.test` }, "STAGING_DATABASE_QUERY_KEY_UNSUPPORTED"],
    [{ STAGING_DATABASE_URL: url.replace(":5432/", ":6543/") }, "STAGING_MIGRATION_TRANSACTION_POOLER_UNSUPPORTED"],
    [{ STAGING_DATABASE_URL: "postgresql://bad" }, "STAGING_DATABASE_URL_SHAPE_INVALID"],
    [{ STAGING_DATABASE_URL: syntheticDbUrl("db.other-project.supabase.co") }, "STAGING_DATABASE_TARGET_MISMATCH"],
  ];
  for (const [change, code] of cases) {
    const candidate = { ...source, ...change };
    assert.equal(databaseIdentity(candidate), null);
    assert.equal(databaseIdentityFailureCode(candidate), code);
    assert.equal(validateInvocation(candidate), code);
    assert.match(code, /^[A-Z0-9_]+$/u);
    assert.equal(code.includes("private"), false);
  }
});

test("Prisma migration URL has a bounded lock wait without changing source binding", () => {
  const derived = new URL(migrationUrlWithLockTimeout(source));
  assert.equal(derived.searchParams.get("options"), "-c lock_timeout=5000 -c statement_timeout=60000");
  assert.equal(derived.hostname, `db.${ref}.supabase.co`);
  const withRuntimeHint = migrationUrlWithLockTimeout({ ...source, STAGING_DATABASE_URL: `${url}?pgbouncer=true` });
  assert.equal(new URL(withRuntimeHint).searchParams.has("pgbouncer"), false);
  const withTuning = migrationUrlWithLockTimeout({ ...source, STAGING_DATABASE_URL: `${url}?connection_limit=1&connect_timeout=10` });
  assert.equal(new URL(withTuning).searchParams.has("connection_limit"), false);
  assert.equal(new URL(withTuning).searchParams.has("connect_timeout"), false);
  assert.equal(databaseIdentity({ ...source, STAGING_DATABASE_URL: derived.toString() }), null);
  assert.equal(migrationUrlWithLockTimeout({ ...source, STAGING_DATABASE_URL: "postgresql://bad" }), null);
});

test("exact protected isolated replay receipt is required", () => {
  assert.equal(validatePrerequisites(evidence), null);
  const cases = [
    { replay: { ...evidence.replay, schemaVersion: "celebratedeal-staging-isolated-migration-replay/v2" } },
    { replay: { ...evidence.replay, databaseWrites: 1 } },
    { replay: { ...evidence.replay, replayedMigrationCount: 20 } },
    { replay: { ...evidence.replay, sourceTableCountsMatched: false } },
    { replay: { ...evidence.replay, rawDumpPersisted: true } },
    { runIds: { replay: 0 } },
  ];
  for (const change of cases) assert.notEqual(validatePrerequisites({ ...evidence, ...change }), null);
});

test("producer runs must be successful dispatches on master lineage", async () => {
  const name = ".github/workflows/staging-migration-compat-preflight.yml";
  const runs = { 10: { id: 10, event: "workflow_dispatch", head_branch: "master", status: "completed",
    conclusion: "success", head_sha: source.GITHUB_SHA, path: name } };
  const response = (id) => ({ status: 200, headers: { has: () => false }, json: async () => runs[id] });
  const ancestry = () => ({ code: 0, stdout: `${source.GITHUB_SHA}\n` });
  assert.equal(await verifyProducerRuns(ids, source, async (url) => response(Number(url.split("/").at(-1))), ancestry), true);
  assert.equal(validateProducerRun({ ...runs[10], head_branch: "feature" }, "replay"), false);
  assert.equal(validateProducerRun({ ...runs[10], path: "other.yml" }, "replay"), false);
  assert.equal(await verifyProducerRuns({ replay: 21 }, source, async () => ({ status: 404, headers: { has: () => false } }), ancestry), false);
  assert.equal(await verifyProducerRuns(ids, source, async (url) => response(Number(url.split("/").at(-1))), () => ({ code: 1, stdout: "" })), false);
});

test("squash-merged app source is proven by fixed PR head, independent of master ancestry", async () => {
  const response = { status: 200, headers: { has: () => false }, json: async () => ({
    head: { sha: FIXED_SOURCE_SHA, repo: { full_name: "Forty-s-AI-Company/CelebrateDeal" } },
    base: { ref: "master" },
  }) };
  assert.equal(await verifySourcePull(source, async () => response), true);
  assert.equal(await verifySourcePull(source, async () => ({ ...response, json: async () => ({
    head: { sha: "0".repeat(40), repo: { full_name: "Forty-s-AI-Company/CelebrateDeal" } },
    base: { ref: "master" },
  }) })), false);
});

test("pre/post migration history requires the exact prefix and no unresolved failures", () => {
  const names = Array.from({ length: 79 }, (_, index) => `202601010000${String(index).padStart(2, "0")}_m${index}`);
  const rows = names.slice(0, 58).map((name) => ({ name, checksum: "a".repeat(64), finished: true, rolledBack: false }));
  const history = [...rows, { ...rows[0], rolledBack: true }];
  assert.equal(historyMatches(history, names, 58), true);
  assert.equal(historyMatches([...history, { ...rows[0], finished: false }], names, 58), false);
  assert.equal(historyMatches(rows, names, 58), false);
  assert.equal(historyMatches(history.map((row, index) => index === 2 ? { ...row, name: "other" } : row), names, 58), false);
  assert.equal(historyMatches(history, names, 79), false);
  assert.equal(historyMatches(history, names, 58, new Map(rows.map((row) => [row.name, new Set(["b".repeat(64)])]))), false);
});

test("invalid replay evidence blocks before any child process", () => {
  let calls = 0;
  const receipt = applyMigrations({ ...evidence,
    replay: { ...evidence.replay, sourceTableCountsMatched: false } }, source,
  { run: () => { calls += 1; throw new Error("must not run"); } });
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.failureCode, "REPLAY_EVIDENCE_INCOMPLETE");
  assert.equal(receipt.migrationAttempted, false);
  assert.equal(calls, 0);
});

test("CLI identifies a missing replay receipt before any migration attempt", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-apply-receipt-"));
  try {
    const cli = path.resolve("scripts/staging-migration-apply.mjs");
    const result = spawnSync(process.execPath, [cli], {
      cwd: temp, encoding: "utf8", shell: false,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, RUNNER_TEMP: temp },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /code=REPLAY_RECEIPT_READ_FAILED/u);
    const receipt = JSON.parse(fs.readFileSync(path.join(temp, "staging-migration-apply-receipt.json"), "utf8"));
    assert.equal(receipt.failureCode, "REPLAY_RECEIPT_READ_FAILED");
    assert.equal(receipt.migrationAttempted, false);
  } finally {
    if (path.dirname(temp) === os.tmpdir()) fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("apply receipt binds protected commit and producer run", () => {
  const receipt = {
    schemaVersion: "celebratedeal-staging-migration-apply/v1", result: "PASS",
    sourceCommit: FIXED_SOURCE_SHA, masterCommit: source.GITHUB_SHA,
    applyRunId: "123", replayRunId: "10", migrationTreeSha: "b".repeat(40),
    deploymentHost: host, databaseIdentitySha256: digest,
    preCount: 58, postCount: 79, migrationAttempted: true,
    columnVerified: true, schemaVerified: true, failureCode: null,
  };
  const expected = { masterCommit: source.GITHUB_SHA, applyRunId: "123",
    replayRunId: "10", migrationTreeSha: "b".repeat(40), deploymentHost: host };
  assert.equal(validateApplyReceipt(receipt, expected), true);
  for (const [key, value] of Object.entries({ masterCommit: "c".repeat(40), applyRunId: "124",
    replayRunId: "11", migrationTreeSha: "d".repeat(40), deploymentHost: "other.vercel.app" })) {
    assert.equal(validateApplyReceipt({ ...receipt, [key]: value }, expected), false);
  }
});

test("Prisma uses the isolated mirror without loading repository config", () => {
  const base = fs.realpathSync(os.tmpdir());
  const mirror = fs.mkdtempSync(path.join(base, "celebratedeal-prisma-mirror-test-"));
  try {
    const prismaDir = path.join(mirror, "prisma");
    fs.mkdirSync(prismaDir);
    const schema = path.join(prismaDir, "schema.prisma");
    fs.copyFileSync(path.resolve("prisma/schema.prisma"), schema);
    const cli = path.resolve("node_modules/prisma/build/index.js");
    const result = spawnSync(process.execPath, [cli, "validate", "--schema", schema], {
      cwd: mirror, encoding: "utf8", timeout: 30_000, shell: false,
      env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "",
        DATABASE_URL: syntheticDbUrl("localhost"),
        DIRECT_URL: syntheticDbUrl("localhost") },
    });
    assert.equal(result.status, 0, "mirror schema must validate");
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Loaded Prisma config from|Prisma config detected/iu);
  } finally {
    if (path.dirname(mirror) !== base || !path.basename(mirror).startsWith("celebratedeal-prisma-mirror-test-")) {
      throw new Error("MIRROR_CLEANUP_PATH_INVALID");
    }
    try { fs.rmSync(mirror, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
    catch (error) {
      // Windows can briefly keep the Prisma child process's cwd locked after
      // it exits. The isolated CI runner uses Linux and must always clean up.
      if (process.platform !== "win32" || error.code !== "EBUSY") throw error;
    }
  }
});
