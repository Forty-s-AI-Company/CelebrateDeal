import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyDeployment } from "./secure-staging-runner.mjs";

// This file must only be run by the protected master workflow. The evidence
// contracts deliberately require future producer versions with DB binding.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FIXED_SOURCE_SHA = "9193326824b8b6bf774bdfa28e4783a1a1b8f304";
export const EXPECTED_BEFORE = 58;
export const EXPECTED_AFTER = 79;
const SAFE_SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_MIGRATION = /^\d{12,14}_[a-z0-9_]+$/u;
const SAFE_PROJECT = /^[a-z0-9]{20}$/u;
const FORBIDDEN_PRODUCTION_REF = "ocbugvgojrunvenozsbx";
const WORKFLOWS = Object.freeze({
  replay: ".github/workflows/staging-isolated-migration-replay.yml",
  backup: ".github/workflows/secure-staging-validation.yml",
  recovery: ".github/workflows/staging-encrypted-backup-recovery.yml",
});

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
/** Hash excludes the password, and is identical to the LINE runner's binding. */
export function databaseIdentity(source) {
  try {
    const db = new URL(source.STAGING_DATABASE_URL);
    const api = new URL(source.NEXT_PUBLIC_SUPABASE_URL);
    const ref = api.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/u)?.[1];
    const user = decodeURIComponent(db.username);
    const port = db.port || "5432";
    const schema = db.searchParams.get("schema") ?? "public";
    const direct = db.hostname === `db.${ref}.supabase.co` && user === "postgres";
    const pooler = db.hostname.endsWith(".pooler.supabase.com") && user === `postgres.${ref}`;
    if (!ref || !SAFE_PROJECT.test(ref) || ref === FORBIDDEN_PRODUCTION_REF || ref !== source.STAGING_PROJECT_REF
      || api.protocol !== "https:" || api.pathname !== "/" || api.search || api.hash || api.username || api.password || api.port
      || !["postgres:", "postgresql:"].includes(db.protocol) || !db.password || !["5432", "6543"].includes(port)
      || db.pathname !== "/postgres" || schema !== "public"
      || [...db.searchParams.keys()].some((key) => key !== "schema") || (!direct && !pooler)) return null;
    const digest = sha256([db.hostname, port, db.pathname, user, schema].join("\n"));
    if (digest !== source.STAGING_DATABASE_IDENTITY_SHA256) return null;
    return { digest, projectRef: ref, host: db.hostname, port, database: "postgres", user, password: decodeURIComponent(db.password) };
  } catch { return null; }
}

export function validateInvocation(source) {
  if (source.GITHUB_REF !== "refs/heads/master" || source.GITHUB_REF_PROTECTED !== "true"
    || source.GITHUB_REPOSITORY !== "Forty-s-AI-Company/CelebrateDeal"
    || source.GITHUB_WORKFLOW_REF?.split("@")[0] !== "Forty-s-AI-Company/CelebrateDeal/.github/workflows/staging-migration-apply.yml") return "UNTRUSTED_WORKFLOW";
  if (source.CELEBRATEDEAL_SOURCE_SHA !== FIXED_SOURCE_SHA || !/^\d+$/u.test(source.GITHUB_RUN_ID ?? "")) return "SOURCE_BINDING_INVALID";
  if (!/^[a-z0-9-]+\.vercel\.app$/u.test(source.CELEBRATEDEAL_DEPLOYMENT_HOST ?? "")) return "DEPLOYMENT_HOST_INVALID";
  if (!databaseIdentity(source)) return "DATABASE_IDENTITY_INVALID";
  if (!source.GITHUB_TOKEN || !source.RUNNER_TEMP) return "REQUIRED_BINDING_MISSING";
  return null;
}

export function validateProducerRun(run, workflow) {
  const expectedPath = WORKFLOWS[workflow];
  return Boolean(expectedPath && run && run.event === "workflow_dispatch" && run.head_branch === "master"
    && run.status === "completed" && run.conclusion === "success" && /^[a-f0-9]{40}$/u.test(run.head_sha ?? "")
    && run.path === expectedPath && Number.isSafeInteger(run.id));
}

export async function verifyProducerRuns(runIds, source, fetchImpl = fetch, run = child) {
  const result = {};
  for (const workflow of ["replay", "backup", "recovery"]) {
    const id = runIds?.[workflow];
    if (!Number.isSafeInteger(id) || id <= 0) return false;
    const url = `https://api.github.com/repos/Forty-s-AI-Company/CelebrateDeal/actions/runs/${id}`;
    const response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(15_000),
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${source.GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28" } });
    if (response.status !== 200 || response.headers.has("location")) return false;
    const metadata = await response.json();
    result[workflow] = validateProducerRun(metadata, workflow)
      && run("git", ["merge-base", "--is-ancestor", metadata.head_sha, "HEAD"], trustedEnvironment(source)).code === 0;
  }
  return Object.values(result).every(Boolean);
}

export async function verifySourcePull(source, fetchImpl = fetch) {
  const url = "https://api.github.com/repos/Forty-s-AI-Company/CelebrateDeal/pulls/277";
  const response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(15_000),
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${source.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28" } });
  if (response.status !== 200 || response.headers.has("location")) return false;
  const pull = await response.json();
  return pull?.head?.sha === FIXED_SOURCE_SHA && pull?.base?.ref === "master"
    && pull?.head?.repo?.full_name === "Forty-s-AI-Company/CelebrateDeal";
}

export function validatePrerequisites(evidence, binding) {
  const { replay, backup, recovery, runIds } = evidence ?? {};
  const common = (value, version) => value?.schemaVersion === version && value?.result === "PASS"
    && value?.sourceCommit === FIXED_SOURCE_SHA
    && value?.databaseIdentitySha256 === binding.digest
    && value?.projectRef === binding.projectRef
    && value?.deploymentHost === binding.deploymentHost;
  if (!common(replay, "celebratedeal-staging-isolated-migration-replay/v2")
    || replay.stage !== "ISOLATED_SQL_REPLAY_COMPLETE" || replay.beforeCount !== EXPECTED_BEFORE
    || replay.afterCount !== EXPECTED_AFTER || replay.replayedCount !== EXPECTED_AFTER - EXPECTED_BEFORE
    || replay.sourceAggregateMatched !== true || replay.postReplaySchemaVerified !== true
    || replay.postReplayHistoryUnchanged !== true || replay.databaseWrites !== 0) return "REPLAY_EVIDENCE_INCOMPLETE";
  if (!common(backup, "celebratedeal-secure-staging-wp2/v3")
    || backup.retention?.status !== "ENCRYPTED" || backup.retention?.retained !== true
    || backup.backupRunId !== String(runIds?.backup)
    || !SAFE_SHA256.test(backup.archiveDigest ?? "") || backup.migrationAuthorization !== "BLOCKED") return "BACKUP_EVIDENCE_INCOMPLETE";
  if (!common(recovery, "celebratedeal-staging-encrypted-backup-recovery/v2")
    || recovery.backupRunId !== String(runIds?.backup) || recovery.recoveryRunId !== String(runIds?.recovery)
    || recovery.archiveDigest !== backup.archiveDigest || recovery.restoreResult !== "PASS"
    || recovery.isolated !== true) return "RECOVERY_EVIDENCE_INCOMPLETE";
  if (new Set(Object.values(runIds ?? {})).size !== 3) return "PRODUCER_RUNS_NOT_DISTINCT";
  return null;
}

function child(command, args, env, options = {}) {
  const response = spawnSync(command, args, { cwd: ROOT, env, encoding: "utf8", shell: false,
    windowsHide: true, timeout: 180_000, maxBuffer: 4 * 1024 * 1024, ...options });
  return { code: response.status ?? 1, stdout: response.stdout ?? "" };
}

function trustedEnvironment(source) {
  return Object.fromEntries(["PATH", "SystemRoot", "ComSpec", "PATHEXT", "HOME", "TMP", "TEMP", "RUNNER_TEMP"]
    .filter((key) => source[key]).map((key) => [key, source[key]]));
}

export function migrationInventory(source = FIXED_SOURCE_SHA, run = child, env = trustedEnvironment(process.env)) {
  const sourceRoot = path.join(ROOT, "fixed-source");
  if (run("git", ["-C", sourceRoot, "rev-parse", "HEAD"], env).stdout.trim() !== source) return null;
  const status = run("git", ["-C", sourceRoot, "status", "--porcelain", "--", "prisma/migrations", "prisma/schema.prisma"], env);
  if (status.code !== 0 || status.stdout.trim()) return null;
  const listed = run("git", ["-C", sourceRoot, "ls-tree", "-r", "--name-only", "HEAD", "--", "prisma/migrations"], env);
  if (listed.code !== 0) return null;
  const lock = path.join(sourceRoot, "prisma", "migrations", "migration_lock.toml");
  if (!fs.statSync(lock).isFile() || fs.lstatSync(lock).isSymbolicLink()) return null;
  const names = listed.stdout.split(/\r?\n/u).filter((name) => name.endsWith("/migration.sql"))
    .map((name) => name.split("/").at(-2));
  if (names.length !== EXPECTED_AFTER || names.some((name) => !SAFE_MIGRATION.test(name))
    || new Set(names).size !== EXPECTED_AFTER) return null;
  names.sort();
  const checksums = new Map();
  for (const name of names) {
    const file = `prisma/migrations/${name}/migration.sql`;
    const sourceHash = run("git", ["-C", sourceRoot, "rev-parse", `HEAD:${file}`], env);
    if (sourceHash.code !== 0 || !/^[a-f0-9]{40}\s*$/u.test(sourceHash.stdout)) return null;
    const localPath = path.join(sourceRoot, file);
    if (!fs.statSync(localPath).isFile() || fs.lstatSync(localPath).isSymbolicLink()) return null;
    const bytes = fs.readFileSync(localPath);
    if (bytes.length === 0) return null;
    checksums.set(name, new Set([
      sha256(bytes),
      sha256(bytes.at(-1) === 10 ? bytes.subarray(0, -1) : bytes),
      sha256(Buffer.from(bytes.toString("utf8").replace(/(?<!\r)\n/gu, "\r\n"), "utf8")),
    ]));
  }
  return { names, checksums, sourceRoot };
}

function queryHistory(binding, source, run = child) {
  const env = { ...trustedEnvironment(source), PGHOST: binding.host, PGPORT: binding.port,
    PGDATABASE: binding.database, PGUSER: binding.user, PGPASSWORD: binding.password,
    PGSSLMODE: "require", PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=5000" };
  const sql = "BEGIN READ ONLY; SELECT migration_name,checksum,(finished_at IS NOT NULL)::text,(rolled_back_at IS NOT NULL)::text FROM public._prisma_migrations ORDER BY migration_name,started_at; COMMIT;";
  const output = run("psql", ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-F", "|", "-c", sql], env);
  if (output.code !== 0) return null;
  const rows = output.stdout.split(/\r?\n/u).filter((line) => line.includes("|"));
  if (rows.some((line) => !/^\d{12,14}_[a-z0-9_]+\|[a-f0-9]{64}\|(?:true|false)\|(?:true|false)$/u.test(line))) return null;
  return rows.map((line) => { const [name, checksum, finished, rolledBack] = line.split("|"); return { name, checksum, finished: finished === "true", rolledBack: rolledBack === "true" }; });
}

function serverIdentityMatches(binding, source, run = child) {
  const env = { ...trustedEnvironment(source), PGHOST: binding.host, PGPORT: binding.port,
    PGDATABASE: binding.database, PGUSER: binding.user, PGPASSWORD: binding.password,
    PGSSLMODE: "require", PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=30000" };
  const sql = "BEGIN READ ONLY; SELECT (current_setting('transaction_read_only')='on')::text,(current_database()='postgres')::text,EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth')::text,(to_regclass('public._prisma_migrations') IS NOT NULL)::text; COMMIT;";
  const output = run("psql", ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-F", "|", "-c", sql], env);
  return output.code === 0 && output.stdout.trim() === "true|true|true|true";
}

export function historyMatches(rows, names, expectedCount, checksums = null) {
  if (!rows || !names || ![EXPECTED_BEFORE, EXPECTED_AFTER].includes(expectedCount)) return false;
  const active = rows.filter((row) => row.finished && !row.rolledBack);
  const failed = rows.filter((row) => !row.finished && !row.rolledBack);
  const rolledBack = rows.filter((row) => row.rolledBack);
  const expected = names.slice(0, expectedCount);
  return active.length === expectedCount && failed.length === 0 && rolledBack.length === 1
    && active.every((row, index) => row.name === expected[index]
      && (checksums === null || checksums.get(row.name)?.has(row.checksum)))
    && new Set(active.map((row) => row.name)).size === expectedCount
    && rolledBack.every((row) => active.some((item) => item.name === row.name && item.checksum === row.checksum));
}

function columnExists(binding, source, run = child) {
  const env = { ...trustedEnvironment(source), PGHOST: binding.host, PGPORT: binding.port,
    PGDATABASE: binding.database, PGUSER: binding.user, PGPASSWORD: binding.password,
    PGSSLMODE: "require", PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=30000" };
  const sql = "BEGIN READ ONLY; SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Vendor' AND column_name='enabledFeatureModules')::text; COMMIT;";
  const output = run("psql", ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], env);
  if (output.code !== 0 || !["true", "false"].includes(output.stdout.trim())) return null;
  return output.stdout.trim() === "true";
}

function createTrustedMigrationMirror(inventory, runnerTemp) {
  const root = fs.realpathSync(runnerTemp);
  const mirror = fs.mkdtempSync(path.join(root, "celebratedeal-migration-apply-"));
  try {
    const prismaRoot = path.join(mirror, "prisma");
    const target = path.join(prismaRoot, "migrations");
    fs.mkdirSync(target, { recursive: true });
    // Schema comes from protected master; only reviewed SQL comes from PR #277.
    fs.copyFileSync(path.join(ROOT, "prisma", "schema.prisma"), path.join(prismaRoot, "schema.prisma"));
    fs.copyFileSync(path.join(inventory.sourceRoot, "prisma", "migrations", "migration_lock.toml"), path.join(target, "migration_lock.toml"));
    for (const name of inventory.names) {
      const directory = path.join(target, name);
      fs.mkdirSync(directory);
      fs.copyFileSync(path.join(inventory.sourceRoot, "prisma", "migrations", name, "migration.sql"), path.join(directory, "migration.sql"));
    }
    return { mirror, schema: path.join(prismaRoot, "schema.prisma") };
  } catch {
    fs.rmSync(mirror, { recursive: true, force: true });
    throw new Error("MIRROR_PREPARATION_FAILED");
  }
}

// No raw child output is logged or saved. A migration attempt is recorded even
// when Prisma fails, because a partial write cannot be ruled out.
export function applyMigrations(evidence, source = process.env, dependencies = {}) {
  const receipt = { schemaVersion: "celebratedeal-staging-migration-apply/v1", result: "BLOCKED",
    sourceCommit: FIXED_SOURCE_SHA, databaseIdentitySha256: null, preCount: 0, postCount: 0,
    migrationAttempted: false, columnVerified: false, failureCode: null };
  const invocation = validateInvocation(source);
  if (invocation) { receipt.failureCode = invocation; return receipt; }
  const binding = databaseIdentity(source);
  receipt.databaseIdentitySha256 = binding.digest;
  const gate = validatePrerequisites(evidence, { ...binding, deploymentHost: source.CELEBRATEDEAL_DEPLOYMENT_HOST });
  if (gate) { receipt.failureCode = gate; return receipt; }
  const run = dependencies.run ?? child;
  const inventory = migrationInventory(FIXED_SOURCE_SHA, run, trustedEnvironment(source));
  if (!inventory) { receipt.failureCode = "SOURCE_INVENTORY_INVALID"; return receipt; }
  const { names, checksums } = inventory;
  if (!serverIdentityMatches(binding, source, run)) { receipt.failureCode = "SERVER_IDENTITY_INVALID"; return receipt; }
  const before = queryHistory(binding, source, run);
  if (!historyMatches(before, names, EXPECTED_BEFORE, checksums) || columnExists(binding, source, run) !== false) {
    receipt.failureCode = "PRE_MIGRATION_STATE_INVALID"; return receipt;
  }
  receipt.preCount = EXPECTED_BEFORE;
  const prisma = process.platform === "win32" ? "node_modules/.bin/prisma.cmd" : "node_modules/.bin/prisma";
  let response;
  let mirror;
  try {
    const prepared = createTrustedMigrationMirror(inventory, source.RUNNER_TEMP);
    mirror = prepared.mirror;
    receipt.migrationAttempted = true;
    response = run(prisma, ["migrate", "deploy", "--schema", prepared.schema],
      { ...trustedEnvironment(source), DATABASE_URL: source.STAGING_DATABASE_URL, DIRECT_URL: source.STAGING_DATABASE_URL,
        PRISMA_HIDE_UPDATE_MESSAGE: "true", NO_COLOR: "1" }, { timeout: 600_000 });
  } catch {
    receipt.result = receipt.migrationAttempted ? "FAILED" : "BLOCKED";
    receipt.failureCode = "MIGRATION_PREPARE_OR_EXECUTE_FAILED";
    return receipt;
  } finally {
    if (mirror && path.dirname(mirror) === fs.realpathSync(source.RUNNER_TEMP)) {
      try { fs.rmSync(mirror, { recursive: true, force: true }); }
      catch { receipt.result = receipt.migrationAttempted ? "FAILED" : "BLOCKED"; receipt.failureCode = "MIRROR_CLEANUP_FAILED"; }
    }
  }
  if (receipt.failureCode) return receipt;
  if (response.code !== 0) { receipt.result = "FAILED"; receipt.failureCode = "MIGRATION_COMMAND_FAILED"; return receipt; }
  const after = queryHistory(binding, source, run);
  if (!historyMatches(after, names, EXPECTED_AFTER, checksums)) { receipt.result = "FAILED"; receipt.failureCode = "POST_MIGRATION_HISTORY_INVALID"; return receipt; }
  receipt.postCount = EXPECTED_AFTER;
  receipt.columnVerified = columnExists(binding, source, run);
  if (!receipt.columnVerified) { receipt.result = "FAILED"; receipt.failureCode = "VENDOR_COLUMN_MISSING"; return receipt; }
  receipt.result = "PASS";
  return receipt;
}

function readReceipt(root, directory, filename) {
  const expected = path.join(root, directory, filename);
  const canonical = fs.realpathSync(expected);
  if (canonical !== expected || !canonical.startsWith(root + path.sep)) throw new Error("RECEIPT_PATH_INVALID");
  const bytes = fs.readFileSync(expected);
  if (bytes.length > 64 * 1024) throw new Error("RECEIPT_TOO_LARGE");
  return JSON.parse(bytes.toString("utf8"));
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  let receipt;
  try {
    const root = fs.realpathSync(process.env.RUNNER_TEMP ?? "");
    const evidence = {
      replay: readReceipt(root, "staging-replay", "celebratedeal-staging-migration-replay.json"),
      backup: readReceipt(root, "staging-backup", "wp2-readonly-restore-receipt.json"),
      recovery: readReceipt(root, "staging-recovery", "staging-encrypted-backup-recovery-receipt.json"),
      runIds: Object.fromEntries(["replay", "backup", "recovery"].map((name) => [name, Number(process.env[`STAGING_${name.toUpperCase()}_RUN_ID`])])),
    };
    if (validateInvocation(process.env)) throw new Error("INVOCATION_INVALID");
    const binding = databaseIdentity(process.env);
    if (validatePrerequisites(evidence, { ...binding, deploymentHost: process.env.CELEBRATEDEAL_DEPLOYMENT_HOST })) throw new Error("EVIDENCE_INCOMPLETE");
    if (!await verifyProducerRuns(evidence.runIds, process.env)) throw new Error("PRODUCER_PROVENANCE_INVALID");
    if (!await verifySourcePull(process.env)) throw new Error("SOURCE_PULL_INVALID");
    await verifyDeployment(process.env);
    receipt = applyMigrations(evidence);
  } catch { receipt = { result: "BLOCKED", failureCode: "EVIDENCE_LOAD_FAILED" }; }
  try {
    const root = fs.realpathSync(process.env.RUNNER_TEMP ?? "");
    fs.writeFileSync(path.join(root, "staging-migration-apply-receipt.json"), JSON.stringify(receipt) + "\n", { flag: "wx", mode: 0o600 });
  } catch { receipt = { result: "BLOCKED", failureCode: "RECEIPT_WRITE_FAILED" }; }
  process.stdout.write(`staging_migration_apply=${receipt.result}; code=${receipt.failureCode ?? "NONE"}\n`);
  if (receipt.result !== "PASS") process.exitCode = 1;
}
