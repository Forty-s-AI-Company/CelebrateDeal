import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { applyMigrations, databaseIdentity, FIXED_SOURCE_SHA, historyMatches,
  validateInvocation, validatePrerequisites, validateProducerRun, verifyProducerRuns,
  verifySourcePull } from "./staging-migration-apply.mjs";

const ref = "abcdefghijklmnopqrst";
const host = "celebratedeal-preview.vercel.app";
const url = `postgresql://postgres:synthetic@db.${ref}.supabase.co:5432/postgres`;
const digest = crypto.createHash("sha256").update([`db.${ref}.supabase.co`, "5432", "/postgres", "postgres", "public"].join("\n")).digest("hex");
const source = {
  GITHUB_REF: "refs/heads/master", GITHUB_REF_PROTECTED: "true",
  GITHUB_REPOSITORY: "Forty-s-AI-Company/CelebrateDeal",
  GITHUB_WORKFLOW_REF: "Forty-s-AI-Company/CelebrateDeal/.github/workflows/staging-migration-apply.yml@refs/heads/master",
  GITHUB_RUN_ID: "123", GITHUB_TOKEN: "synthetic", RUNNER_TEMP: "/tmp/synthetic",
  CELEBRATEDEAL_SOURCE_SHA: FIXED_SOURCE_SHA, CELEBRATEDEAL_DEPLOYMENT_HOST: host,
  STAGING_DATABASE_URL: url, NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  STAGING_PROJECT_REF: ref, STAGING_DATABASE_IDENTITY_SHA256: digest,
};
const binding = { digest, projectRef: ref, deploymentHost: host };
const ids = { replay: 10, backup: 20, recovery: 30 };
const common = { result: "PASS", sourceCommit: FIXED_SOURCE_SHA, databaseIdentitySha256: digest,
  projectRef: ref, deploymentHost: host };
const evidence = {
  runIds: ids,
  replay: { ...common, schemaVersion: "celebratedeal-staging-isolated-migration-replay/v2",
    stage: "ISOLATED_SQL_REPLAY_COMPLETE", beforeCount: 58, afterCount: 79, replayedCount: 21,
    sourceAggregateMatched: true, postReplaySchemaVerified: true,
    postReplayHistoryUnchanged: true, databaseWrites: 0 },
  backup: { ...common, schemaVersion: "celebratedeal-secure-staging-wp2/v3",
    retention: { status: "ENCRYPTED", retained: true }, archiveDigest: "a".repeat(64), backupRunId: "20",
    migrationAuthorization: "BLOCKED" },
  recovery: { ...common, schemaVersion: "celebratedeal-staging-encrypted-backup-recovery/v2",
    backupRunId: "20", recoveryRunId: "30", archiveDigest: "a".repeat(64),
    restoreResult: "PASS", isolated: true },
};

test("fixed non-Production URL, project, protected branch and workflow are required", () => {
  assert.equal(validateInvocation(source), null);
  assert.equal(databaseIdentity(source)?.digest, digest);
  for (const change of [
    { GITHUB_REF_PROTECTED: "false" }, { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_WORKFLOW_REF: "Forty-s-AI-Company/CelebrateDeal/.github/workflows/other.yml@refs/heads/master" },
    { STAGING_DATABASE_IDENTITY_SHA256: "0".repeat(64) }, { STAGING_PROJECT_REF: "z".repeat(20) },
    { STAGING_DATABASE_URL: "postgresql://postgres:synthetic@db.production.supabase.co/postgres" },
    { STAGING_PROJECT_REF: "ocbugvgojrunvenozsbx",
      STAGING_DATABASE_URL: "postgresql://postgres:synthetic@db.ocbugvgojrunvenozsbx.supabase.co/postgres",
      NEXT_PUBLIC_SUPABASE_URL: "https://ocbugvgojrunvenozsbx.supabase.co",
      STAGING_DATABASE_IDENTITY_SHA256: crypto.createHash("sha256").update("db.ocbugvgojrunvenozsbx.supabase.co\n5432\n/postgres\npostgres\npublic").digest("hex") },
    { CELEBRATEDEAL_SOURCE_SHA: "0".repeat(40) },
  ]) assert.notEqual(validateInvocation({ ...source, ...change }), null);
});

test("v1 receipts cannot authorize writes; all three v2/v3 bindings and recovery are required", () => {
  assert.equal(validatePrerequisites(evidence, binding), null);
  const cases = [
    { replay: { ...evidence.replay, schemaVersion: "celebratedeal-staging-isolated-migration-replay/v1" } },
    { replay: { ...evidence.replay, databaseIdentitySha256: undefined } },
    { replay: { ...evidence.replay, databaseWrites: 1 } },
    { replay: { ...evidence.replay, replayedCount: 20 } },
    { backup: { ...evidence.backup, schemaVersion: "celebratedeal-secure-staging-wp2/v2" } },
    { backup: { ...evidence.backup, retention: { status: "PLAINTEXT" } } },
    { backup: { ...evidence.backup, retention: { status: "ENCRYPTED", retained: false } } },
    { recovery: { ...evidence.recovery, backupRunId: "21" } },
    { recovery: { ...evidence.recovery, archiveDigest: "b".repeat(64) } },
    { runIds: { replay: 10, backup: 20, recovery: 20 } },
  ];
  for (const change of cases) assert.notEqual(validatePrerequisites({ ...evidence, ...change }, binding), null);
});

test("producer runs must be successful dispatches on master lineage", async () => {
  const names = [
    ".github/workflows/staging-isolated-migration-replay.yml",
    ".github/workflows/secure-staging-validation.yml",
    ".github/workflows/staging-encrypted-backup-recovery.yml",
  ];
  const runs = Object.fromEntries([10, 20, 30].map((id, index) => [id, {
    id, event: "workflow_dispatch", head_branch: "master", status: "completed",
    conclusion: "success", head_sha: FIXED_SOURCE_SHA, path: names[index],
  }]));
  const response = (id) => ({ status: 200, headers: { has: () => false }, json: async () => runs[id] });
  const ancestry = () => ({ code: 0 });
  assert.equal(await verifyProducerRuns(ids, source, async (url) => response(Number(url.split("/").at(-1))), ancestry), true);
  assert.equal(validateProducerRun({ ...runs[10], head_branch: "feature" }, "replay"), false);
  assert.equal(validateProducerRun({ ...runs[20], path: names[0] }, "backup"), false);
  assert.equal(await verifyProducerRuns({ ...ids, backup: 21 }, source, async () => ({ status: 404, headers: { has: () => false } }), ancestry), false);
  assert.equal(await verifyProducerRuns(ids, source, async (url) => response(Number(url.split("/").at(-1))), () => ({ code: 1 })), false);
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

test("missing same-DB attestation blocks before any child process", () => {
  let calls = 0;
  const receipt = applyMigrations({ ...evidence,
    replay: { ...evidence.replay, databaseIdentitySha256: undefined } }, source,
  { run: () => { calls += 1; throw new Error("must not run"); } });
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.failureCode, "REPLAY_EVIDENCE_INCOMPLETE");
  assert.equal(receipt.migrationAttempted, false);
  assert.equal(calls, 0);
});
