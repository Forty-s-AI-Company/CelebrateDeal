import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyDeployment } from "./secure-staging-runner.mjs";
import { expectedReplaySchema } from "./staging-migration-compat-preflight.mjs";
import { schemaVerificationSql } from "./staging-migration-isolated-replay.mjs";

// This file must only be run by the protected master workflow.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FIXED_SOURCE_SHA = "9193326824b8b6bf774bdfa28e4783a1a1b8f304";
export const EXPECTED_BEFORE = 58;
export const EXPECTED_AFTER = 79;
const SAFE_MIGRATION = /^\d{12,14}_[a-z0-9_]+$/u;
const SAFE_PROJECT = /^[a-z0-9]{20}$/u;
const FIXED_STAGING_REF = "ocbugvgojrunvenozsbx";
const FIXED_PREVIEW_HOST = "celebrate-deal-staging-jtozttm8m-a25814740s-projects.vercel.app";
const SAFE_RUNTIME_HINTS = Object.freeze({ connection_limit: [1, 100], connect_timeout: [0, 120],
  pool_timeout: [0, 120], socket_timeout: [0, 120], statement_cache_size: [0, 1000] });
const SAFE_QUERY_KEYS = new Set(["schema", "sslmode", "pgbouncer", ...Object.keys(SAFE_RUNTIME_HINTS)]);
const WORKFLOWS = Object.freeze({
  replay: ".github/workflows/staging-migration-compat-preflight.yml",
});

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function runtimeHintsValid(db) {
  return Object.entries(SAFE_RUNTIME_HINTS).every(([key, [min, max]]) => {
    const raw = db.searchParams.get(key);
    if (raw === null) return true;
    if (!/^\d{1,4}$/u.test(raw)) return false;
    const value = Number(raw);
    return value >= min && value <= max;
  });
}
/** Hash excludes the password, and is identical to the LINE runner's binding. */
export function databaseIdentity(source) {
  try {
    const db = new URL(source.STAGING_DATABASE_URL);
    const api = new URL(source.NEXT_PUBLIC_SUPABASE_URL);
    const ref = api.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/u)?.[1];
    const user = decodeURIComponent(db.username);
    const port = db.port || "5432";
    const schema = db.searchParams.get("schema") ?? "public";
    const sslmode = db.searchParams.get("sslmode");
    const pgbouncer = db.searchParams.get("pgbouncer");
    const queryKeys = [...db.searchParams.keys()];
    const direct = db.hostname === `db.${ref}.supabase.co` && user === "postgres";
    const pooler = db.hostname.endsWith(".pooler.supabase.com") && user === `postgres.${ref}`;
    if (!ref || !SAFE_PROJECT.test(ref) || ref !== FIXED_STAGING_REF
      || api.protocol !== "https:" || api.pathname !== "/" || api.search || api.hash || api.username || api.password || api.port
      || !["postgres:", "postgresql:"].includes(db.protocol) || !db.password || port !== "5432"
      || db.pathname !== "/postgres" || schema !== "public"
      || (sslmode !== null && !["require", "verify-full"].includes(sslmode))
      || (pgbouncer !== null && pgbouncer !== "true")
      || queryKeys.some((key) => !SAFE_QUERY_KEYS.has(key)) || !runtimeHintsValid(db)
      || new Set(queryKeys).size !== queryKeys.length || (!direct && !pooler)) return null;
    const digest = sha256([db.hostname, port, db.pathname, user, schema].join("\n"));
    return { digest, projectRef: ref, host: db.hostname, port, database: "postgres", user, password: decodeURIComponent(db.password) };
  } catch { return null; }
}

/** Return only a fixed category; never include a URL, credential, or query value in the receipt. */
export function databaseIdentityFailureCode(source) {
  if (!source.STAGING_DATABASE_URL) return "STAGING_DATABASE_URL_MISSING";
  if (!source.NEXT_PUBLIC_SUPABASE_URL) return "STAGING_SUPABASE_URL_MISSING";
  let db;
  let api;
  try {
    db = new URL(source.STAGING_DATABASE_URL);
    api = new URL(source.NEXT_PUBLIC_SUPABASE_URL);
  } catch { return "STAGING_DATABASE_URL_MALFORMED"; }
  const ref = api.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/u)?.[1];
  if (!ref || !SAFE_PROJECT.test(ref) || api.protocol !== "https:" || api.pathname !== "/"
    || api.search || api.hash || api.username || api.password || api.port) return "STAGING_SUPABASE_URL_INVALID";
  if (ref !== FIXED_STAGING_REF) return "STAGING_PROJECT_MISMATCH";
  const queryKeys = [...db.searchParams.keys()];
  const sslmode = db.searchParams.get("sslmode");
  if (new Set(queryKeys).size !== queryKeys.length) return "STAGING_DATABASE_QUERY_DUPLICATE";
  if ((db.searchParams.get("schema") ?? "public") !== "public") return "STAGING_DATABASE_SCHEMA_QUERY_INVALID";
  if (sslmode !== null && !["require", "verify-full"].includes(sslmode)) return "STAGING_DATABASE_SSLMODE_QUERY_INVALID";
  if (db.searchParams.has("pgbouncer") && db.searchParams.get("pgbouncer") !== "true") return "STAGING_DATABASE_PGBOUNCER_QUERY_INVALID";
  if (queryKeys.some((key) => !SAFE_QUERY_KEYS.has(key))) return "STAGING_DATABASE_QUERY_KEY_UNSUPPORTED";
  if (!runtimeHintsValid(db)) return "STAGING_DATABASE_QUERY_HINT_INVALID";
  if (!["postgres:", "postgresql:"].includes(db.protocol) || !db.username || !db.password
    || db.pathname !== "/postgres") return "STAGING_DATABASE_URL_SHAPE_INVALID";
  if ((db.port || "5432") === "6543") return "STAGING_MIGRATION_TRANSACTION_POOLER_UNSUPPORTED";
  if ((db.port || "5432") !== "5432") return "STAGING_DATABASE_URL_SHAPE_INVALID";
  let user;
  try { user = decodeURIComponent(db.username); }
  catch { return "STAGING_DATABASE_URL_SHAPE_INVALID"; }
  const direct = db.hostname === `db.${ref}.supabase.co` && user === "postgres";
  const pooler = db.hostname.endsWith(".pooler.supabase.com") && user === `postgres.${ref}`;
  if (!direct && !pooler) return "STAGING_DATABASE_TARGET_MISMATCH";
  return "DATABASE_IDENTITY_INVALID";
}

/** Prisma's migration engine ignores PGOPTIONS; bound lock and statement time in its URL. */
export function migrationUrlWithLockTimeout(source) {
  if (!databaseIdentity(source)) return null;
  const url = new URL(source.STAGING_DATABASE_URL);
  // Runtime's PgBouncer hint is unnecessary for direct/session migration connections.
  url.searchParams.delete("pgbouncer");
  for (const key of Object.keys(SAFE_RUNTIME_HINTS)) url.searchParams.delete(key);
  url.searchParams.set("options", "-c lock_timeout=5000 -c statement_timeout=60000");
  return url.toString();
}

export function validateInvocation(source) {
  if (source.GITHUB_REF !== "refs/heads/master" || source.GITHUB_REF_PROTECTED !== "true"
    || source.GITHUB_REPOSITORY !== "Forty-s-AI-Company/CelebrateDeal"
    || source.GITHUB_WORKFLOW_REF?.split("@")[0] !== "Forty-s-AI-Company/CelebrateDeal/.github/workflows/staging-migration-apply.yml") return "UNTRUSTED_WORKFLOW";
  if (source.CELEBRATEDEAL_SOURCE_SHA !== FIXED_SOURCE_SHA || !/^\d+$/u.test(source.GITHUB_RUN_ID ?? "")
    || !/^[a-f0-9]{40}$/u.test(source.GITHUB_SHA ?? "")) return "SOURCE_BINDING_INVALID";
  if (source.CELEBRATEDEAL_DEPLOYMENT_HOST !== FIXED_PREVIEW_HOST) return "DEPLOYMENT_HOST_INVALID";
  if (!databaseIdentity(source)) return databaseIdentityFailureCode(source);
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
  if (run("git", ["rev-parse", "HEAD"], trustedEnvironment(source)).stdout.trim() !== source.GITHUB_SHA) return false;
  for (const workflow of ["replay"]) {
    const id = runIds?.[workflow];
    if (!Number.isSafeInteger(id) || id <= 0) return false;
    const url = `https://api.github.com/repos/Forty-s-AI-Company/CelebrateDeal/actions/runs/${id}`;
    const response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(15_000),
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${source.GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28" } });
    if (response.status !== 200 || response.headers.has("location")) return false;
    const metadata = await response.json();
    if (!validateProducerRun(metadata, workflow) || metadata.head_sha !== source.GITHUB_SHA) return false;
  }
  return true;
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

export function validatePrerequisites(evidence) {
  const { replay, runIds } = evidence ?? {};
  if (!Number.isSafeInteger(runIds?.replay) || runIds.replay <= 0
    || replay?.schemaVersion !== "celebratedeal-staging-isolated-migration-replay/v1"
    || replay.result !== "PASS" || replay.sourceCommit !== FIXED_SOURCE_SHA
    || replay.stage !== "ISOLATED_SQL_REPLAY_COMPLETE"
    || replay.sourceMigrationCount !== EXPECTED_BEFORE
    || replay.expectedMigrationCount !== EXPECTED_AFTER
    || replay.pendingMigrationCount !== EXPECTED_AFTER - EXPECTED_BEFORE
    || replay.replayedMigrationCount !== EXPECTED_AFTER - EXPECTED_BEFORE
    || replay.sourceMetadataMatched !== true || replay.sourceTableCountsMatched !== true
    || replay.sourceExtensionsMatched !== true || replay.sourceAggregateMatched !== true
    || replay.postReplaySchemaVerified !== true || replay.postReplayHistoryUnchanged !== true
    || replay.prismaMigrateDeployRun !== false || replay.isolatedNetwork !== "none"
    || replay.rawDumpPersisted !== false || replay.databaseWrites !== 0
    || replay.productionOperations !== 0) return "REPLAY_EVIDENCE_INCOMPLETE";
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
  const sourceTree = run("git", ["-C", sourceRoot, "rev-parse", "HEAD:prisma/migrations"], env);
  const masterTree = run("git", ["rev-parse", "HEAD:prisma/migrations"], env);
  const sourceSchema = run("git", ["-C", sourceRoot, "rev-parse", "HEAD:prisma/schema.prisma"], env);
  const masterSchema = run("git", ["rev-parse", "HEAD:prisma/schema.prisma"], env);
  if (sourceTree.code !== 0 || masterTree.code !== 0 || !/^[a-f0-9]{40}\s*$/u.test(sourceTree.stdout)
    || sourceTree.stdout.trim() !== masterTree.stdout.trim()
    || sourceSchema.code !== 0 || masterSchema.code !== 0 || !/^[a-f0-9]{40}\s*$/u.test(sourceSchema.stdout)
    || sourceSchema.stdout.trim() !== masterSchema.stdout.trim()) return null;
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
  return { names, checksums, sourceRoot, migrationTreeSha: masterTree.stdout.trim() };
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

function expectedSchemaVerified(inventory, binding, source, run = child) {
  const env = { ...trustedEnvironment(source), PGHOST: binding.host, PGPORT: binding.port,
    PGDATABASE: binding.database, PGUSER: binding.user, PGPASSWORD: binding.password,
    PGSSLMODE: "require", PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=30000" };
  const sqlByName = new Map(inventory.names.slice(EXPECTED_BEFORE).map((name) =>
    [name, fs.readFileSync(path.join(inventory.sourceRoot, "prisma", "migrations", name, "migration.sql"))]));
  const expected = expectedReplaySchema(sqlByName);
  const output = run("psql", ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c",
    `BEGIN READ ONLY; ${schemaVerificationSql(expected)} COMMIT;`], env);
  return output.code === 0 && output.stdout.trim() === "true";
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
function initialReceipt() {
  return { schemaVersion: "celebratedeal-staging-migration-apply/v1", result: "BLOCKED",
    sourceCommit: FIXED_SOURCE_SHA, masterCommit: null, applyRunId: null,
    replayRunId: null, migrationTreeSha: null, deploymentHost: null,
    databaseIdentitySha256: null, preCount: 0, postCount: 0,
    migrationAttempted: false, columnVerified: false, schemaVerified: false, failureCode: null };
}

export function applyMigrations(evidence, source = process.env, dependencies = {}) {
  const receipt = initialReceipt();
  const invocation = validateInvocation(source);
  if (invocation) { receipt.failureCode = invocation; return receipt; }
  receipt.masterCommit = source.GITHUB_SHA;
  receipt.applyRunId = source.GITHUB_RUN_ID;
  receipt.deploymentHost = source.CELEBRATEDEAL_DEPLOYMENT_HOST;
  const binding = databaseIdentity(source);
  receipt.databaseIdentitySha256 = binding.digest;
  const gate = validatePrerequisites(evidence);
  if (gate) { receipt.failureCode = gate; return receipt; }
  receipt.replayRunId = String(evidence.runIds.replay);
  const run = dependencies.run ?? child;
  const inventory = migrationInventory(FIXED_SOURCE_SHA, run, trustedEnvironment(source));
  if (!inventory) { receipt.failureCode = "SOURCE_INVENTORY_INVALID"; return receipt; }
  receipt.migrationTreeSha = inventory.migrationTreeSha;
  const { names, checksums } = inventory;
  if (!serverIdentityMatches(binding, source, run)) { receipt.failureCode = "SERVER_IDENTITY_INVALID"; return receipt; }
  const before = queryHistory(binding, source, run);
  if (!historyMatches(before, names, EXPECTED_BEFORE, checksums) || columnExists(binding, source, run) !== false) {
    receipt.failureCode = "PRE_MIGRATION_STATE_INVALID"; return receipt;
  }
  receipt.preCount = EXPECTED_BEFORE;
  // Run from a fresh mirror outside the repository. Prisma then finds the
  // mirror's schema/migrations and cannot load the repository's dotenv config.
  const prisma = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
  let response;
  let mirror;
  try {
    const prepared = createTrustedMigrationMirror(inventory, source.RUNNER_TEMP);
    mirror = prepared.mirror;
    const migrationUrl = migrationUrlWithLockTimeout(source);
    if (!migrationUrl) throw new Error("MIGRATION_URL_INVALID");
    receipt.migrationAttempted = true;
    response = run(prisma, ["migrate", "deploy", "--schema", prepared.schema],
      { ...trustedEnvironment(source), DATABASE_URL: migrationUrl, DIRECT_URL: migrationUrl,
        PRISMA_HIDE_UPDATE_MESSAGE: "true", NO_COLOR: "1" }, { cwd: mirror, timeout: 600_000 });
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
  try {
    if (!expectedSchemaVerified(inventory, binding, source, run)) {
      receipt.result = "FAILED"; receipt.failureCode = "EXPECTED_SCHEMA_INCOMPLETE"; return receipt;
    }
  } catch {
    receipt.result = "FAILED"; receipt.failureCode = "EXPECTED_SCHEMA_CHECK_FAILED"; return receipt;
  }
  receipt.schemaVerified = true;
  receipt.result = "PASS";
  return receipt;
}

export function validateApplyReceipt(receipt, expected = {}) {
  if (!receipt || receipt.schemaVersion !== "celebratedeal-staging-migration-apply/v1"
    || !["PASS", "BLOCKED", "FAILED"].includes(receipt.result)
    || receipt.sourceCommit !== FIXED_SOURCE_SHA
    || ![receipt.masterCommit, receipt.migrationTreeSha].every((value) => value === null || /^[a-f0-9]{40}$/u.test(value))
    || ![receipt.applyRunId, receipt.replayRunId].every((value) => value === null || /^[1-9][0-9]*$/u.test(value))
    || (receipt.deploymentHost !== null && receipt.deploymentHost !== FIXED_PREVIEW_HOST)
    || (receipt.databaseIdentitySha256 !== null && !/^[a-f0-9]{64}$/u.test(receipt.databaseIdentitySha256))
    || (receipt.failureCode !== null && !/^[A-Z0-9_]+$/u.test(receipt.failureCode))
    || !Object.entries(expected).every(([key, value]) => Object.hasOwn(receipt, key) && receipt[key] === value)) return false;
  if (receipt.result !== "PASS") return true;
  return receipt.masterCommit !== null && receipt.applyRunId !== null && receipt.replayRunId !== null
    && receipt.migrationTreeSha !== null && receipt.deploymentHost === FIXED_PREVIEW_HOST
    && receipt.databaseIdentitySha256 !== null && receipt.preCount === EXPECTED_BEFORE
    && receipt.postCount === EXPECTED_AFTER && receipt.migrationAttempted === true
    && receipt.columnVerified === true && receipt.schemaVerified === true && receipt.failureCode === null;
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
  // Fixed phase codes identify the failing gate without exposing exceptions,
  // paths, provider responses, database rows, or child-process output.
  let phase = "REPLAY_RECEIPT_READ_FAILED";
  try {
    const root = fs.realpathSync(process.env.RUNNER_TEMP ?? "");
    const evidence = {
      replay: readReceipt(root, "staging-replay", "celebratedeal-staging-migration-replay.json"),
      runIds: { replay: Number(process.env.STAGING_REPLAY_RUN_ID) },
    };
    phase = "INVOCATION_INVALID";
    const invocation = validateInvocation(process.env);
    if (invocation) { phase = invocation; throw new Error("GATE_REJECTED"); }
    phase = "REPLAY_EVIDENCE_INCOMPLETE";
    const prerequisites = validatePrerequisites(evidence);
    if (prerequisites) { phase = prerequisites; throw new Error("GATE_REJECTED"); }
    phase = "PRODUCER_PROVENANCE_INVALID";
    if (!await verifyProducerRuns(evidence.runIds, process.env)) throw new Error("PRODUCER_PROVENANCE_INVALID");
    phase = "SOURCE_PULL_INVALID";
    if (!await verifySourcePull(process.env)) throw new Error("SOURCE_PULL_INVALID");
    phase = "DEPLOYMENT_LINEAGE_INVALID";
    await verifyDeployment(process.env);
    phase = "APPLY_RUNTIME_ERROR";
    receipt = applyMigrations(evidence);
  } catch { receipt = { ...initialReceipt(), failureCode: phase }; }
  try {
    const root = fs.realpathSync(process.env.RUNNER_TEMP ?? "");
    const expected = receipt.result === "PASS" ? {
      masterCommit: process.env.GITHUB_SHA, applyRunId: process.env.GITHUB_RUN_ID,
      replayRunId: String(process.env.STAGING_REPLAY_RUN_ID),
      deploymentHost: FIXED_PREVIEW_HOST,
    } : {};
    if (!validateApplyReceipt(receipt, expected)) throw new Error("RECEIPT_INVALID");
    fs.writeFileSync(path.join(root, "staging-migration-apply-receipt.json"), JSON.stringify(receipt) + "\n", { flag: "wx", mode: 0o600 });
  } catch { receipt = { result: "BLOCKED", failureCode: "RECEIPT_WRITE_FAILED" }; }
  process.stdout.write(`staging_migration_apply=${receipt.result}; code=${receipt.failureCode ?? "NONE"}\n`);
  if (receipt.result !== "PASS") process.exitCode = 1;
}
