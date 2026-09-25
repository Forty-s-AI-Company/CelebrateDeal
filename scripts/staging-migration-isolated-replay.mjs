import { randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { getStagingDatabaseIdentityReport } from "../src/lib/database-identity.ts";
import { auditPendingSql, expectedReplaySchema, inspectMigrationHistory, PREVIEW_HOST, readPendingSql, SOURCE_SHA } from "./staging-migration-compat-preflight.mjs";
import { classifyPostgresFailure, classifyRestoreFailure, filteredRestoreList, isolatedReadinessArgs, isolatedRestoreArgs, parseExtensionPlacements, readOnlySql, sourceInventory, verifyDeployment } from "./secure-staging-runner.mjs";

export const IMAGE = "postgres:17-alpine@sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3";
const MAX_DUMP_BYTES = 128 * 1024 * 1024;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const digest = (value) => createHash("sha256").update(value).digest("hex");

function sanitizedReceipt(result, stage, extra = {}) {
  return {
    schemaVersion: "celebratedeal-staging-isolated-migration-replay/v1",
    result, stage,
    sourceCommit: SOURCE_SHA,
    sourceMigrationCount: 58,
    expectedMigrationCount: 79,
    pendingMigrationCount: 21,
    replayedMigrationCount: extra.replayedMigrationCount ?? 0,
    sourceAggregateMatched: extra.sourceAggregateMatched ?? false,
    postReplaySchemaVerified: extra.postReplaySchemaVerified ?? false,
    postReplayHistoryUnchanged: extra.postReplayHistoryUnchanged ?? false,
    prismaMigrateDeployRun: false,
    isolatedNetwork: "none",
    rawDumpPersisted: false,
    databaseWrites: 0,
    isolatedWrites: extra.isolatedWrites ?? 0,
    productionOperations: 0,
  };
}

function safeEnvironment(source) {
  return Object.fromEntries(["PATH", "HOME", "USERPROFILE", "TMP", "TEMP", "RUNNER_TEMP", "SystemRoot", "ComSpec", "PATHEXT"]
    .filter((key) => typeof source[key] === "string").map((key) => [key, source[key]]));
}

function command(commandName, args, { env, input, binary = false, maxBuffer = 8 * 1024 * 1024 } = {}) {
  const child = spawnSync(commandName, args, {
    env: env ?? safeEnvironment(process.env), input, encoding: binary ? null : "utf8",
    shell: false, windowsHide: true, timeout: 120_000, maxBuffer,
  });
  return { code: child.status ?? 1, stdout: child.stdout ?? (binary ? Buffer.alloc(0) : ""), stderr: child.stderr ?? "" };
}

function databaseEnvironment(source) {
  const url = new URL(source.STAGING_DATABASE_URL);
  return {
    ...safeEnvironment(source),
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: url.pathname.slice(1),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: "require",
  };
}

function snapshot(query) {
  const metadata = query("SELECT (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text,(SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')::text,(SELECT count(*) FROM information_schema.columns WHERE table_schema='public')::text;");
  if (metadata.code !== 0) throw new Error("SNAPSHOT_METADATA_FAILED");
  const fields = String(metadata.stdout).trim().split("|");
  if (fields.length !== 3 || fields.some((value) => !/^\d+$/u.test(value))) throw new Error("SNAPSHOT_METADATA_INVALID");
  const tables = query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name;");
  if (tables.code !== 0) throw new Error("SNAPSHOT_TABLE_LIST_FAILED");
  const names = String(tables.stdout).split(/\r?\n/u).filter(Boolean);
  if (names.length === 0 || names.some((name) => !NAME.test(name))) throw new Error("SNAPSHOT_TABLE_LIST_INVALID");
  const sql = names.map((name) => `SELECT '${name}'::text AS table_name,count(*)::text AS row_count FROM public."${name}"`).join(" UNION ALL ") + " ORDER BY table_name;";
  const counts = query(sql);
  if (counts.code !== 0 || !String(counts.stdout).split(/\r?\n/u).filter(Boolean).every((line) => /^[A-Za-z_][A-Za-z0-9_]*\|\d+$/u.test(line))) throw new Error("SNAPSHOT_COUNTS_INVALID");
  return { metadata: fields.join("|"), counts: digest(String(counts.stdout).trim()) };
}

function parseHistory(output) {
  const lines = String(output).split(/\r?\n/u).filter(Boolean);
  if (lines.some((line) => !/^\d{12,14}_[a-z0-9_]+\|[a-f0-9]{64}\|(?:true|false)\|(?:true|false)$/u.test(line))) return null;
  return lines.map((line) => {
    const [migration_name, checksum, finished, rolled] = line.split("|");
    return { migration_name, checksum, finished_at: finished === "true" ? true : null, rolled_back_at: rolled === "true" ? true : null };
  });
}

export function validateBindings(source) {
  let database;
  try { database = new URL(source.STAGING_DATABASE_URL); } catch { return false; }
  const project = "ocbugvgojrunvenozsbx";
  const direct = database.hostname === `db.${project}.supabase.co` && database.username === "postgres";
  const pooler = database.hostname.endsWith(".pooler.supabase.com") && database.username === `postgres.${project}`;
  return ["postgres:", "postgresql:"].includes(database.protocol) && database.pathname === "/postgres" && (direct || pooler)
    && source.CELEBRATEDEAL_SOURCE_SHA === SOURCE_SHA
    && source.CELEBRATEDEAL_DEPLOYMENT_HOST === PREVIEW_HOST
    && typeof source.GITHUB_TOKEN === "string" && source.GITHUB_TOKEN.length > 0
    && typeof source.RUNNER_TEMP === "string" && source.RUNNER_TEMP.length > 0
    && getStagingDatabaseIdentityReport({
      DATABASE_URL: source.STAGING_DATABASE_URL, DIRECT_URL: source.STAGING_DATABASE_URL,
      STAGING_DATABASE_URL: source.STAGING_DATABASE_URL,
      NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
    }).all_passed;
}

export function replayArgs(containerId) {
  if (!/^[a-f0-9]{64}$/u.test(containerId)) throw new Error("ISOLATED_CONTAINER_INVALID");
  return ["exec", "-i", containerId, "psql", "-U", "postgres", "-d", "celebratedeal_restore", "-X", "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"];
}

export function schemaVerificationSql(expected) {
  const values = (items) => items.map((item) => `('${item}')`).join(",");
  const relations = (items) => `NOT EXISTS (SELECT 1 FROM (VALUES ${values(items)}) AS required(name) WHERE to_regclass(format('public.%I', required.name)) IS NULL)`;
  const types = `NOT EXISTS (SELECT 1 FROM (VALUES ${values(expected.types)}) AS required(name) WHERE to_regtype(format('public.%I', required.name)) IS NULL)`;
  const constraints = `NOT EXISTS (SELECT 1 FROM (VALUES ${values(expected.constraints)}) AS required(name) LEFT JOIN pg_constraint c ON c.conname=required.name AND c.connamespace='public'::regnamespace WHERE c.oid IS NULL)`;
  const columnValues = expected.columns.map((item) => {
    const [table, column] = item.split("|");
    return `('${table}','${column}')`;
  }).join(",");
  const columns = `NOT EXISTS (SELECT 1 FROM (VALUES ${columnValues}) AS required(table_name,column_name) LEFT JOIN information_schema.columns c ON c.table_schema='public' AND c.table_name=required.table_name AND c.column_name=required.column_name WHERE c.column_name IS NULL)`;
  return `SELECT (${[relations(expected.tables), relations(expected.indexes), types, constraints, columns].join(" AND ")})::text;`;
}

export async function runIsolatedReplay(source = process.env, dependencies = {}) {
  if (!validateBindings(source)) return sanitizedReceipt("BLOCKED", "INVALID_BINDING");
  const execute = dependencies.command ?? command;
  let containerId = null;
  let runId = null;
  let replayed = 0;
  let restoredWrites = 0;
  let sourceAggregateMatched = false;
  let postReplaySchemaVerified = false;
  let postReplayHistoryUnchanged = false;
  let result = sanitizedReceipt("BLOCKED", "NOT_STARTED");
  try {
    const deployment = await (dependencies.verifyDeploymentImpl ?? verifyDeployment)(source, dependencies.fetchImpl ?? fetch);
    if (deployment.host !== PREVIEW_HOST || !deployment.deploymentMatched || !deployment.sourceMatched || !deployment.ready) throw new Error("PREVIEW_LINEAGE_MISMATCH");
    const inventory = (dependencies.sourceInventoryImpl ?? sourceInventory)(SOURCE_SHA);
    const sqlByName = await (dependencies.readPendingSqlImpl ?? readPendingSql)(inventory);
    if (!auditPendingSql(inventory, sqlByName)) throw new Error("PENDING_SOURCE_AUDIT_FAILED");
    const expectedSchema = expectedReplaySchema(sqlByName);
    const pgEnv = databaseEnvironment(source);
    const sourceQueryWith = (sql) => {
      const query = execute("docker", ["run", "--rm", "--pull=never", "--network", "host", "--volume", "/etc/hosts:/etc/hosts:ro",
        ...["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSSLMODE"].flatMap((key) => ["-e", key]),
        IMAGE, "psql", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-F", "|", "-c", readOnlySql(sql)], { env: pgEnv });
      if (query.code !== 0) throw new Error(classifyPostgresFailure(query.stderr));
      return query;
    };
    const identity = String(sourceQueryWith("SELECT (current_setting('transaction_read_only')='on')::text,(current_database()='postgres')::text,(to_regclass('public._prisma_migrations') IS NOT NULL)::text").stdout).trim();
    if (identity !== "true|true|true") throw new Error("DATABASE_IDENTITY_MISMATCH");
    const historySql = "SELECT migration_name,checksum,(finished_at IS NOT NULL)::text,(rolled_back_at IS NOT NULL)::text FROM public._prisma_migrations ORDER BY migration_name,started_at";
    const sourceHistoryOutput = sourceQueryWith(historySql).stdout;
    const history = parseHistory(sourceHistoryOutput);
    if (!inspectMigrationHistory(history, inventory)) throw new Error("MIGRATION_BASELINE_CHANGED");
    const extensionQuery = "SELECT extension.extname,namespace.nspname FROM pg_extension extension INNER JOIN pg_namespace namespace ON namespace.oid=extension.extnamespace WHERE extension.extname IN ('pgcrypto','pg_trgm') ORDER BY extension.extname";
    const extensions = sourceQueryWith(extensionQuery);
    const placement = parseExtensionPlacements(extensions.stdout);
    const before = snapshot(sourceQueryWith);
    const dump = execute("docker", ["run", "--rm", "--pull=never", "--network", "host", "--volume", "/etc/hosts:/etc/hosts:ro",
      ...["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSSLMODE"].flatMap((key) => ["-e", key]),
      IMAGE, "pg_dump", "--format=custom", "--no-owner", "--no-privileges", "--schema=public"],
    { env: pgEnv, binary: true, maxBuffer: MAX_DUMP_BYTES });
    if (dump.code !== 0 || !Buffer.isBuffer(dump.stdout) || dump.stdout.length === 0 || dump.stdout.length >= MAX_DUMP_BYTES) throw new Error("SOURCE_DUMP_FAILED");
    runId = randomBytes(8).toString("hex");
    const started = execute("docker", ["run", "-d", "--pull=never", "--network", "none", "--name", `celebratedeal-migration-replay-${runId}`,
      "--label", `celebratedeal.migration-replay=${runId}`, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_DB=celebratedeal_restore",
      "--tmpfs", "/var/lib/postgresql/data", "--tmpfs", "/tmp:size=268435456", IMAGE]);
    if (started.code !== 0 || !/^[a-f0-9]{64}$/u.test(String(started.stdout).trim())) throw new Error("ISOLATED_CONTAINER_CREATE_FAILED");
    containerId = String(started.stdout).trim();
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (execute("docker", isolatedReadinessArgs(containerId)).code === 0) { ready = true; break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
    if (!ready) throw new Error("ISOLATED_POSTGRES_NOT_READY");
    const copied = execute("docker", ["exec", "-i", containerId, "sh", "-c", "cat > /tmp/staging-public.dump"], { input: dump.stdout });
    if (copied.code !== 0) throw new Error("ISOLATED_DUMP_COPY_FAILED");
    const listed = execute("docker", ["exec", containerId, "pg_restore", "--list", "/tmp/staging-public.dump"]);
    if (listed.code !== 0) throw new Error("ISOLATED_DUMP_LIST_FAILED");
    const restoreList = filteredRestoreList(listed.stdout);
    const extensionSql = ["pgcrypto", "pg_trgm"].map((name) => `CREATE EXTENSION ${name} WITH SCHEMA ${placement[name]};`).join(" ");
    const prepare = execute("docker", ["exec", containerId, "psql", "-U", "postgres", "-d", "celebratedeal_restore", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", `DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA IF NOT EXISTS extensions; ${extensionSql}`]);
    if (prepare.code !== 0) throw new Error("ISOLATED_TARGET_PREPARE_FAILED");
    const listWritten = execute("docker", ["exec", "-i", containerId, "sh", "-c", "cat > /tmp/staging-public.list"], { input: restoreList });
    if (listWritten.code !== 0) throw new Error("ISOLATED_RESTORE_LIST_WRITE_FAILED");
    const restored = execute("docker", isolatedRestoreArgs(containerId));
    if (restored.code !== 0) throw new Error(classifyRestoreFailure(restored.stderr));
    restoredWrites = 1;
    const targetQueryWith = (sql) => {
      const query = execute("docker", ["exec", containerId, "psql", "-U", "postgres", "-d", "celebratedeal_restore", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-F", "|", "-c", sql]);
      if (query.code !== 0) throw new Error("ISOLATED_SNAPSHOT_FAILED");
      return query;
    };
    const afterRestore = snapshot(targetQueryWith);
    const restoredExtensions = targetQueryWith(extensionQuery);
    if (before.metadata !== afterRestore.metadata || before.counts !== afterRestore.counts
      || String(extensions.stdout).trim() !== String(restoredExtensions.stdout).trim()) throw new Error("ISOLATED_RESTORE_MISMATCH");
    sourceAggregateMatched = true;
    for (const name of [...inventory.keys()].sort().slice(-21)) {
      const replay = execute("docker", replayArgs(containerId), { input: sqlByName.get(name) });
      if (replay.code !== 0) throw new Error("ISOLATED_MIGRATION_REPLAY_FAILED");
      replayed += 1;
    }
    const finalSchema = targetQueryWith(schemaVerificationSql(expectedSchema));
    if (String(finalSchema.stdout).trim() !== "true") throw new Error("POST_REPLAY_SCHEMA_MISMATCH");
    postReplaySchemaVerified = true;
    const finalHistoryOutput = targetQueryWith(historySql).stdout;
    if (String(finalHistoryOutput).trim() !== String(sourceHistoryOutput).trim()
      || !inspectMigrationHistory(parseHistory(finalHistoryOutput), inventory)) throw new Error("POST_REPLAY_HISTORY_CHANGED");
    postReplayHistoryUnchanged = true;
    result = sanitizedReceipt("PASS", "ISOLATED_SQL_REPLAY_COMPLETE", { replayedMigrationCount: replayed, sourceAggregateMatched, postReplaySchemaVerified, postReplayHistoryUnchanged, isolatedWrites: replayed + restoredWrites });
  } catch (error) {
    result = sanitizedReceipt("BLOCKED", /^[A-Z0-9_]+$/u.test(error?.message ?? "") ? error.message : "ISOLATED_REPLAY_FAILED",
      { replayedMigrationCount: replayed, sourceAggregateMatched, postReplaySchemaVerified, postReplayHistoryUnchanged, isolatedWrites: replayed + restoredWrites });
  } finally {
    if (containerId) {
      const owned = execute("docker", ["inspect", "--format", "{{index .Config.Labels \"celebratedeal.migration-replay\"}}", containerId]);
      if (owned.code === 0 && String(owned.stdout).trim() === runId) {
        if (execute("docker", ["rm", "-f", containerId]).code !== 0) result = sanitizedReceipt("BLOCKED", "ISOLATED_CLEANUP_FAILED");
      } else result = sanitizedReceipt("BLOCKED", "ISOLATED_CLEANUP_OWNERSHIP_FAILED");
    }
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runIsolatedReplay();
  if (process.env.RUNNER_TEMP) await writeFile(`${process.env.RUNNER_TEMP}/celebratedeal-staging-migration-replay.json`, `${JSON.stringify(result)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.result !== "PASS") process.exitCode = 2;
}
