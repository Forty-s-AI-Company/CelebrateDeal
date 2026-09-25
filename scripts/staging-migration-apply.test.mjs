import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { applyMigrations, databaseIdentity, FIXED_SOURCE_SHA, historyMatches, validateApplyReceipt,
  validateInvocation, validatePrerequisites, validateProducerRun, verifyProducerRuns,
  verifySourcePull } from "./staging-migration-apply.mjs";

const ref = "ocbugvgojrunvenozsbx";
const host = "celebrate-deal-staging-jtozttm8m-a25814740s-projects.vercel.app";
const url = `postgresql://postgres:synthetic@db.${ref}.supabase.co:5432/postgres`;
const digest = crypto.createHash("sha256").update([`db.${ref}.supabase.co`, "5432", "/postgres", "postgres", "public"].join("\n")).digest("hex");
const source = {
  GITHUB_REF: "refs/heads/master", GITHUB_REF_PROTECTED: "true",
  GITHUB_REPOSITORY: "Forty-s-AI-Company/CelebrateDeal",
  GITHUB_WORKFLOW_REF: "Forty-s-AI-Company/CelebrateDeal/.github/workflows/staging-migration-apply.yml@refs/heads/master",
  GITHUB_RUN_ID: "123", GITHUB_SHA: "a".repeat(40), GITHUB_TOKEN: "synthetic", RUNNER_TEMP: "/tmp/synthetic",
  CELEBRATEDEAL_SOURCE_SHA: FIXED_SOURCE_SHA, CELEBRATEDEAL_DEPLOYMENT_HOST: host,
  CELEBRATEDEAL_STAGING_DATA_DISPOSITION: "ALL_DISPOSABLE_SYNTHETIC",
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
  for (const change of [
    { GITHUB_REF_PROTECTED: "false" }, { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_WORKFLOW_REF: "Forty-s-AI-Company/CelebrateDeal/.github/workflows/other.yml@refs/heads/master" },
    { STAGING_DATABASE_URL: "postgresql://postgres:synthetic@db.production.supabase.co/postgres" },
    { STAGING_DATABASE_URL: "postgresql://postgres:synthetic@db.abcdefghijklmnopqrst.supabase.co/postgres",
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" },
    { CELEBRATEDEAL_DEPLOYMENT_HOST: "other-preview.vercel.app" },
    { CELEBRATEDEAL_SOURCE_SHA: "0".repeat(40) },
    { CELEBRATEDEAL_STAGING_DATA_DISPOSITION: "UNKNOWN" },
    { GITHUB_SHA: "invalid" },
  ]) assert.notEqual(validateInvocation({ ...source, ...change }), null);
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

test("unknown staging data disposition blocks before database access", () => {
  let calls = 0;
  const receipt = applyMigrations(evidence, { ...source, CELEBRATEDEAL_STAGING_DATA_DISPOSITION: "UNKNOWN" },
    { run: () => { calls += 1; throw new Error("must not run"); } });
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.failureCode, "DATA_DISPOSITION_UNCONFIRMED");
  assert.equal(receipt.migrationAttempted, false);
  assert.equal(calls, 0);
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
        DATABASE_URL: "postgresql://postgres:synthetic@localhost:5432/postgres",
        DIRECT_URL: "postgresql://postgres:synthetic@localhost:5432/postgres" },
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
