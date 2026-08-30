import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TASK = "wp2-readonly-restore";
const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_REPOSITORY = "Forty-s-AI-Company/CelebrateDeal";
const GITHUB_ENVIRONMENT = "Preview – celebrate-deal-staging";
const POSTGRES_IMAGE = "postgres:17-alpine";
const EXPECTED_MIGRATION_COUNT = 58;
const SAFE_SHA = /^[a-f0-9]{40}$/u;
const SAFE_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const SAFE_MIGRATION = /^\d{12,14}_[a-z0-9_]+$/u;
const SAFE_TABLE = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const RECEIPT_NAME = "wp2-readonly-restore-receipt.json";

export const REQUIRED_SECRET_KEYS = Object.freeze(["STAGING_DATABASE_URL", "GITHUB_TOKEN"]);
export const REQUIRED_CONFIG_KEYS = Object.freeze(["NEXT_PUBLIC_SUPABASE_URL", "CELEBRATEDEAL_SOURCE_SHA", "CELEBRATEDEAL_DEPLOYMENT_HOST", "RUNNER_TEMP"]);
const RECEIPT_KEYS = Object.freeze(["schemaVersion", "task", "sourceCommit", "result", "executedAtUtc", "lineage", "database", "migration", "backup", "restore", "network", "safety", "sideEffects", "failureCategory"]);
const RECEIPT_NESTED_KEYS = Object.freeze({
  lineage: ["deploymentReads", "deploymentMatched", "sourceMatched", "preview", "ready", "healthStatus", "noRedirect", "deploymentDigest"],
  database: ["connectionAttempts", "firstTransactionReadOnly", "identityMatched", "readQueries", "disconnected"],
  migration: ["expectedCount", "appliedCount", "unresolvedFailedCount", "rollbackEntryCount", "completedCounterpartCount", "exactChecksumCount", "formatVarianceCount", "unknownMismatchCount", "status"],
  backup: ["attempts", "result", "byteBucket", "digest"],
  restore: ["attempts", "result", "migrationCount", "schemaMatched", "extensionsMatched", "aggregateMatched", "isolated"],
  network: ["policy", "githubDeployments", "stagingPreview", "supabaseStaging", "arbitraryOutbound"],
  safety: ["sanitized", "envFilesRead", "envEnumerated", "secretValuesPrinted", "secretValuesPersisted", "rawOutputPersisted", "rawDumpPersisted", "rawDatabaseRowsPersisted", "customerDataPersisted"],
  sideEffects: ["databaseWrites", "migrationWrites", "backupWrites", "isolatedRestoreWrites", "deployments", "aliasMutations", "productionOperations"],
});

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function hasValue(source, key) {
  return typeof source[key] === "string" && source[key].length > 0;
}

function hashBuffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function digest(label, value) {
  return `sha256:${crypto.createHash("sha256").update(`secure-staging/v2/${label}/${String(value)}`, "utf8").digest("hex")}`;
}

function baseEnvironment(source = process.env) {
  return Object.fromEntries(["PATH", "HOME", "USERPROFILE", "TMP", "TEMP", "RUNNER_TEMP", "SystemRoot", "ComSpec", "PATHEXT"].filter((key) => hasValue(source, key)).map((key) => [key, source[key]]));
}

function run(command, args, { env = baseEnvironment(), encoding = "utf8", input, cwd = ROOT, maxBuffer = 4 * 1024 * 1024 } = {}) {
  const child = spawnSync(command, args, { cwd, env, encoding, input, shell: false, windowsHide: true, timeout: 120_000, maxBuffer });
  return { code: child.status ?? 1, stdout: child.stdout ?? (encoding ? "" : Buffer.alloc(0)), stderr: child.stderr ?? (encoding ? "" : Buffer.alloc(0)) };
}

export function validateInvocation(task, source = process.env) {
  if (task !== TASK) return { ok: false, reason: "TASK_NOT_ALLOWLISTED" };
  if (![...REQUIRED_SECRET_KEYS, ...REQUIRED_CONFIG_KEYS].every((key) => hasValue(source, key))) return { ok: false, reason: "REQUIRED_BINDING_MISSING" };
  if (!SAFE_SHA.test(source.CELEBRATEDEAL_SOURCE_SHA)) return { ok: false, reason: "SOURCE_SHA_INVALID" };
  if (!SAFE_HOST.test(source.CELEBRATEDEAL_DEPLOYMENT_HOST) || !source.CELEBRATEDEAL_DEPLOYMENT_HOST.endsWith(".vercel.app")) return { ok: false, reason: "DEPLOYMENT_HOST_INVALID" };
  try {
    const database = new URL(source.STAGING_DATABASE_URL);
    const supabase = new URL(source.NEXT_PUBLIC_SUPABASE_URL);
    const projectRef = supabase.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/u)?.[1];
    const direct = projectRef && database.hostname === `db.${projectRef}.supabase.co` && database.username === "postgres";
    const pooler = projectRef && database.hostname.endsWith(".pooler.supabase.com") && database.username.endsWith(`.${projectRef}`);
    const port = database.port || "5432";
    if (!/^postgres(?:ql)?:$/u.test(database.protocol) || supabase.protocol !== "https:" || database.pathname !== "/postgres" || !/^\d{2,5}$/u.test(port) || (!direct && !pooler)) return { ok: false, reason: "STAGING_DATABASE_IDENTITY_INVALID" };
  } catch {
    return { ok: false, reason: "STAGING_BINDING_PARSE_FAILED" };
  }
  return { ok: true, reason: null };
}

export function createInitialReceipt(sourceCommit = "unknown") {
  return {
    schemaVersion: "celebratedeal-secure-staging-wp2/v2",
    task: TASK,
    sourceCommit: SAFE_SHA.test(sourceCommit) ? sourceCommit : "unknown",
    result: "BLOCKED",
    executedAtUtc: new Date().toISOString(),
    lineage: { deploymentReads: 0, deploymentMatched: false, sourceMatched: false, preview: false, ready: false, healthStatus: null, noRedirect: false, deploymentDigest: null },
    database: { connectionAttempts: 0, firstTransactionReadOnly: false, identityMatched: false, readQueries: 0, disconnected: false },
    migration: { expectedCount: EXPECTED_MIGRATION_COUNT, appliedCount: 0, unresolvedFailedCount: 0, rollbackEntryCount: 0, completedCounterpartCount: 0, exactChecksumCount: 0, formatVarianceCount: 0, unknownMismatchCount: 0, status: "NOT_RUN" },
    backup: { attempts: 0, result: "NOT_RUN", byteBucket: "not_run", digest: null },
    restore: { attempts: 0, result: "NOT_RUN", migrationCount: 0, schemaMatched: false, extensionsMatched: false, aggregateMatched: false, isolated: true },
    network: { policy: "fixed-host-egress", githubDeployments: true, stagingPreview: true, supabaseStaging: true, arbitraryOutbound: false },
    safety: { sanitized: true, envFilesRead: false, envEnumerated: false, secretValuesPrinted: false, secretValuesPersisted: false, rawOutputPersisted: false, rawDumpPersisted: false, rawDatabaseRowsPersisted: false, customerDataPersisted: false },
    sideEffects: { databaseWrites: 0, migrationWrites: 0, backupWrites: 0, isolatedRestoreWrites: 0, deployments: 0, aliasMutations: 0, productionOperations: 0 },
    failureCategory: null,
  };
}

export function validateReceipt(receipt) {
  const errors = [];
  if (!exactKeys(receipt, RECEIPT_KEYS)) errors.push("SCHEMA_KEYS");
  for (const [key, keys] of Object.entries(RECEIPT_NESTED_KEYS)) {
    if (!exactKeys(receipt?.[key], keys)) errors.push(`SCHEMA_${key.toUpperCase()}`);
  }
  if (receipt?.schemaVersion !== "celebratedeal-secure-staging-wp2/v2" || receipt?.task !== TASK) errors.push("SCHEMA");
  if (!SAFE_SHA.test(receipt?.sourceCommit ?? "")) errors.push("SOURCE");
  if (!["PASS", "FAILED", "BLOCKED"].includes(receipt?.result)) errors.push("RESULT");
  if (Number.isNaN(Date.parse(receipt?.executedAtUtc ?? ""))) errors.push("EXECUTED_AT");
  if (receipt?.failureCategory !== null && !/^[A-Z0-9_]+$/u.test(receipt?.failureCategory ?? "")) errors.push("FAILURE_CATEGORY");
  if (receipt?.safety?.sanitized !== true || Object.entries(receipt?.safety ?? {}).some(([key, value]) => key !== "sanitized" && value !== false)) errors.push("SENSITIVE_PERSISTENCE");
  const effects = receipt?.sideEffects ?? {};
  if (effects.databaseWrites !== 0 || effects.migrationWrites !== 0 || effects.deployments !== 0 || effects.aliasMutations !== 0 || effects.productionOperations !== 0) errors.push("FORBIDDEN_SIDE_EFFECTS");
  if (!Number.isInteger(effects.backupWrites) || effects.backupWrites < 0 || effects.backupWrites > 1 || !Number.isInteger(effects.isolatedRestoreWrites) || effects.isolatedRestoreWrites < 0 || effects.isolatedRestoreWrites > 1) errors.push("SIDE_EFFECT_BUDGET");
  if (receipt?.network?.arbitraryOutbound !== false || receipt?.network?.policy !== "fixed-host-egress") errors.push("NETWORK_POLICY");
  const serialized = JSON.stringify(receipt);
  if (/(?:postgres(?:ql)?:\/\/|https?:\/\/|Bearer\s+|BEGIN\s+(?:RSA|OPENSSH|EC)\s+PRIVATE\s+KEY|set-cookie|ocbugvgojrunvenozsbx)/iu.test(serialized)) errors.push("FORBIDDEN_TEXT");
  if (receipt?.result === "PASS") {
    const migration = receipt.migration ?? {};
    const complete = receipt.lineage?.deploymentMatched === true && receipt.lineage?.sourceMatched === true && receipt.lineage?.preview === true && receipt.lineage?.ready === true && receipt.lineage?.healthStatus === 200 && receipt.lineage?.noRedirect === true
      && receipt.database?.firstTransactionReadOnly === true && receipt.database?.identityMatched === true && receipt.database?.disconnected === true
      && migration.appliedCount === EXPECTED_MIGRATION_COUNT && migration.unresolvedFailedCount === 0 && migration.rollbackEntryCount === 1 && migration.completedCounterpartCount === 1 && migration.unknownMismatchCount === 0 && migration.exactChecksumCount + migration.formatVarianceCount === EXPECTED_MIGRATION_COUNT && ["UP_TO_DATE", "UP_TO_DATE_FORMAT_VARIANCE"].includes(migration.status)
      && receipt.backup?.attempts === 1 && receipt.backup?.result === "PASS" && /^sha256:[a-f0-9]{64}$/u.test(receipt.backup?.digest ?? "")
      && receipt.restore?.attempts === 1 && receipt.restore?.result === "PASS" && receipt.restore?.migrationCount === EXPECTED_MIGRATION_COUNT && receipt.restore?.schemaMatched === true && receipt.restore?.extensionsMatched === true && receipt.restore?.aggregateMatched === true && receipt.restore?.isolated === true
      && effects.backupWrites === 1 && effects.isolatedRestoreWrites === 1;
    if (!complete) errors.push("PASS_GATE_INCOMPLETE");
  }
  return { ok: errors.length === 0, errors };
}

export async function verifyDeployment(source, fetchImpl = fetch) {
  const endpoint = new URL(`/repos/${GITHUB_REPOSITORY}/deployments`, GITHUB_API_ORIGIN);
  endpoint.searchParams.set("sha", source.CELEBRATEDEAL_SOURCE_SHA);
  endpoint.searchParams.set("environment", GITHUB_ENVIRONMENT);
  endpoint.searchParams.set("per_page", "10");
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${source.GITHUB_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28" };
  const response = await fetchImpl(endpoint, { headers, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  if (response.status !== 200 || response.headers.has("location")) throw new Error("GITHUB_DEPLOYMENT_READ_FAILED");
  const deployments = await response.json();
  const candidates = Array.isArray(deployments) ? deployments.filter((item) => item?.sha === source.CELEBRATEDEAL_SOURCE_SHA && item?.environment === GITHUB_ENVIRONMENT && item?.production_environment === false && Number.isSafeInteger(item?.id)) : [];
  if (candidates.length !== 1) throw new Error("GITHUB_DEPLOYMENT_AMBIGUOUS");
  const deployment = candidates[0];
  const statusEndpoint = new URL(`/repos/${GITHUB_REPOSITORY}/deployments/${deployment.id}/statuses`, GITHUB_API_ORIGIN);
  const statusResponse = await fetchImpl(statusEndpoint, { headers, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  if (statusResponse.status !== 200 || statusResponse.headers.has("location")) throw new Error("GITHUB_DEPLOYMENT_STATUS_READ_FAILED");
  const statuses = await statusResponse.json();
  const latest = Array.isArray(statuses) ? statuses[0] : null;
  let host = "";
  try {
    const environmentUrl = new URL(latest?.environment_url ?? "");
    host = environmentUrl.protocol === "https:" && !environmentUrl.port && !environmentUrl.username && !environmentUrl.password ? environmentUrl.hostname.toLowerCase() : "";
  } catch { host = ""; }
  const deploymentMatched = host === source.CELEBRATEDEAL_DEPLOYMENT_HOST;
  const sourceMatched = deployment.sha === source.CELEBRATEDEAL_SOURCE_SHA;
  const preview = deployment.production_environment === false;
  const ready = latest?.state === "success";
  if (!deploymentMatched || !sourceMatched || !preview || !ready || !host.endsWith(".vercel.app") || !SAFE_HOST.test(host)) throw new Error("GITHUB_DEPLOYMENT_LINEAGE_MISMATCH");
  return { host, deploymentMatched, sourceMatched, preview, ready, deploymentDigest: digest("deployment", deployment.id), reads: 2 };
}

export function verifyTrustedMigrationTree(sourceCommit, spawnImpl = spawnSync) {
  const execute = (args, encoding = "utf8") => {
    const child = spawnImpl("git", args, { cwd: ROOT, env: baseEnvironment(), encoding, shell: false, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return { code: child.status ?? 1, stdout: child.stdout ?? (encoding ? "" : Buffer.alloc(0)) };
  };
  if (execute(["cat-file", "-e", `${sourceCommit}^{commit}`]).code !== 0) throw new Error("SOURCE_COMMIT_UNAVAILABLE");
  if (execute(["merge-base", "--is-ancestor", sourceCommit, "HEAD"]).code === 0) return { mode: "ancestor" };

  // Squash merges intentionally remove feature-branch ancestry. In that case the
  // protected runner may trust only an exact migration-tree match with HEAD; the
  // deployment itself is still independently pinned to the requested source SHA.
  const sourceTree = execute(["rev-parse", `${sourceCommit}:prisma/migrations`]);
  const trustedTree = execute(["rev-parse", "HEAD:prisma/migrations"]);
  const sourceTreeSha = String(sourceTree.stdout).trim();
  const trustedTreeSha = String(trustedTree.stdout).trim();
  if (sourceTree.code !== 0 || trustedTree.code !== 0 || !SAFE_SHA.test(sourceTreeSha) || !SAFE_SHA.test(trustedTreeSha)) {
    throw new Error("SOURCE_MIGRATION_TREE_UNAVAILABLE");
  }
  if (sourceTreeSha !== trustedTreeSha) throw new Error("SOURCE_MIGRATION_TREE_UNTRUSTED");
  return { mode: "squash-equivalent" };
}

function sourceInventory(sourceCommit, spawnImpl = spawnSync) {
  const execute = (args, encoding = "utf8") => {
    const child = spawnImpl("git", args, { cwd: ROOT, env: baseEnvironment(), encoding, shell: false, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return { code: child.status ?? 1, stdout: child.stdout ?? (encoding ? "" : Buffer.alloc(0)) };
  };
  verifyTrustedMigrationTree(sourceCommit, spawnImpl);
  const listed = execute(["ls-tree", "-r", "--name-only", sourceCommit, "--", "prisma/migrations"]);
  if (listed.code !== 0) throw new Error("SOURCE_MIGRATION_INVENTORY_FAILED");
  const files = String(listed.stdout).split(/\r?\n/u).filter((item) => item.endsWith("/migration.sql"));
  if (files.length !== EXPECTED_MIGRATION_COUNT) throw new Error("SOURCE_MIGRATION_COUNT_INVALID");
  const inventory = new Map();
  for (const file of files) {
    const name = file.split("/").at(-2) ?? "";
    if (!SAFE_MIGRATION.test(name) || inventory.has(name)) throw new Error("SOURCE_MIGRATION_NAME_INVALID");
    const shown = execute(["show", `${sourceCommit}:${file}`], null);
    if (shown.code !== 0 || !Buffer.isBuffer(shown.stdout) || shown.stdout.length === 0) throw new Error("SOURCE_MIGRATION_BLOB_FAILED");
    const exact = hashBuffer(shown.stdout);
    const withoutFinalLf = hashBuffer(shown.stdout.at(-1) === 10 ? shown.stdout.subarray(0, -1) : shown.stdout);
    const crlf = hashBuffer(Buffer.from(shown.stdout.toString("utf8").replace(/(?<!\r)\n/gu, "\r\n"), "utf8"));
    inventory.set(name, { exact, alternatives: new Set([withoutFinalLf, crlf]) });
  }
  return inventory;
}

function databaseEnvironment(source) {
  const value = new URL(source.STAGING_DATABASE_URL);
  return {
    ...baseEnvironment(source),
    PGHOST: value.hostname,
    PGPORT: value.port || "5432",
    PGDATABASE: value.pathname.slice(1),
    PGUSER: decodeURIComponent(value.username),
    PGPASSWORD: decodeURIComponent(value.password),
    PGSSLMODE: "require",
  };
}

function sourcePostgres(pgEnvironment, tool, args, { mount } = {}) {
  const dockerArgs = ["run", "--rm", "--network", "host", "--volume", "/etc/hosts:/etc/hosts:ro"];
  if (mount) dockerArgs.push("-v", `${mount}:/out`);
  for (const key of ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSSLMODE"]) dockerArgs.push("-e", key);
  dockerArgs.push(POSTGRES_IMAGE, tool, ...args);
  return run("docker", dockerArgs, { env: pgEnvironment, maxBuffer: 16 * 1024 * 1024 });
}

export function readOnlySql(sql) {
  const statement = String(sql).trim().replace(/;+$/u, "");
  if (!/^SELECT\b/iu.test(statement) || /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY)\b/iu.test(statement)) {
    throw new Error("SOURCE_QUERY_NOT_READ_ONLY");
  }
  return `BEGIN READ ONLY; ${statement}; COMMIT;`;
}

function sourcePsql(pgEnvironment, sql) {
  return sourcePostgres(pgEnvironment, "psql", ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-F", "|", "-c", readOnlySql(sql)]);
}

export function classifyPostgresFailure(stderr) {
  const message = String(stderr ?? "");
  if (/password authentication failed|tenant or user not found|invalid (?:user|password)|authentication failed/iu.test(message)) return "DATABASE_AUTHENTICATION_FAILED";
  if (/could not translate host name|name or service not known|temporary failure in name resolution/iu.test(message)) return "DATABASE_DNS_FAILED";
  if (/connection refused|timeout expired|connection timed out|network is unreachable|no route to host|could not connect to server/iu.test(message)) return "DATABASE_NETWORK_FAILED";
  if (/certificate|ssl error|tls/iu.test(message)) return "DATABASE_TLS_FAILED";
  if (/unsupported (?:startup|config) parameter|pgoptions/iu.test(message)) return "DATABASE_POOLER_STARTUP_REJECTED";
  if (/permission denied|must be (?:owner|superuser)/iu.test(message)) return "DATABASE_PERMISSION_DENIED";
  if (/syntax error|read only|transaction/iu.test(message)) return "DATABASE_READONLY_QUERY_REJECTED";
  return "DATABASE_CONNECTION_OR_QUERY_FAILED";
}

function targetPsql(containerId, sql) {
  return run("docker", ["exec", containerId, "psql", "-U", "postgres", "-d", "celebratedeal_restore", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-F", "|", "-c", sql]);
}

function parseSnapshot(metaOutput, tableOutput) {
  const meta = String(metaOutput).trim().split("|");
  if (meta.length !== 4 || meta.slice(0, 3).some((value) => !/^\d+$/u.test(value))) throw new Error("SNAPSHOT_METADATA_INVALID");
  const pairs = String(tableOutput).split(/\r?\n/u).filter(Boolean);
  if (pairs.some((item) => !/^[A-Za-z_][A-Za-z0-9_]*\|\d+$/u.test(item))) throw new Error("SNAPSHOT_AGGREGATE_INVALID");
  return { migrationCount: Number(meta[0]), tableCount: Number(meta[1]), columnCount: Number(meta[2]), extensionDigest: hashBuffer(Buffer.from(meta[3], "utf8")), aggregateDigest: hashBuffer(Buffer.from(pairs.sort().join("\n"), "utf8")) };
}

function snapshot(query) {
  const metaSql = "SELECT (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text,(SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')::text,(SELECT count(*) FROM information_schema.columns WHERE table_schema='public')::text,COALESCE((SELECT string_agg(extname,',' ORDER BY extname) FROM pg_extension WHERE extname IN ('pgcrypto','pg_trgm')),'');";
  const meta = query(metaSql);
  if (meta.code !== 0) throw new Error("SNAPSHOT_METADATA_FAILED");
  const tables = query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name;");
  if (tables.code !== 0) throw new Error("SNAPSHOT_TABLE_INVENTORY_FAILED");
  const names = String(tables.stdout).split(/\r?\n/u).filter(Boolean);
  if (names.length === 0 || names.some((name) => !SAFE_TABLE.test(name))) throw new Error("SNAPSHOT_TABLE_NAME_INVALID");
  const aggregateSql = names.map((name) => `SELECT '${name}'::text AS table_name,count(*)::text AS row_count FROM public."${name}"`).join(" UNION ALL ") + " ORDER BY table_name;";
  const aggregates = query(aggregateSql);
  if (aggregates.code !== 0) throw new Error("SNAPSHOT_AGGREGATE_FAILED");
  return parseSnapshot(meta.stdout, aggregates.stdout);
}

function byteBucket(size) {
  if (!Number.isSafeInteger(size) || size <= 0) return "invalid";
  if (size < 1024 * 1024) return "lt_1mib";
  if (size < 10 * 1024 * 1024) return "1_to_10mib";
  if (size < 100 * 1024 * 1024) return "10_to_100mib";
  return "gte_100mib";
}

function safeFailure(error) {
  return typeof error?.message === "string" && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "NORMALIZED_RUNNER_FAILURE";
}

function ownedContainer(containerId, runId) {
  const inspected = run("docker", ["inspect", "--format", "{{index .Config.Labels \"celebratedeal.wp2-run\"}}", containerId]);
  return inspected.code === 0 && String(inspected.stdout).trim() === runId;
}

export async function runSecureTask(task, source = process.env, dependencies = {}) {
  const receipt = createInitialReceipt(source.CELEBRATEDEAL_SOURCE_SHA);
  const invocation = validateInvocation(task, source);
  if (!invocation.ok) { receipt.failureCategory = invocation.reason; return receipt; }
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const runId = crypto.randomBytes(8).toString("hex");
  let tempRoot = null;
  let containerId = null;
  let pgEnvironment = null;
  try {
    const deployment = await verifyDeployment(source, fetchImpl);
    const { host, reads, ...sanitizedDeployment } = deployment;
    receipt.lineage = { ...receipt.lineage, ...sanitizedDeployment, deploymentReads: reads };
    const health = await fetchImpl(`https://${host}/api/health`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(15_000) });
    receipt.lineage.healthStatus = health.status;
    receipt.lineage.noRedirect = !health.redirected && !health.headers.has("location");
    if (health.status !== 200 || !receipt.lineage.noRedirect) throw new Error("STAGING_HEALTH_FAILED");

    const inventory = sourceInventory(source.CELEBRATEDEAL_SOURCE_SHA, dependencies.spawnSyncImpl ?? spawnSync);
    pgEnvironment = databaseEnvironment(source);
    delete process.env.STAGING_DATABASE_URL;
    delete process.env.GITHUB_TOKEN;

    receipt.database.connectionAttempts = 1;
    const first = sourcePsql(pgEnvironment, "SELECT (current_setting('transaction_read_only')='on')::text,(current_database()='postgres')::text,EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth')::text,(to_regclass('public._prisma_migrations') IS NOT NULL)::text");
    receipt.database.readQueries += 1;
    if (first.code !== 0) throw new Error(classifyPostgresFailure(first.stderr));
    const identityLine = String(first.stdout).split(/\r?\n/u).find((line) => /^(?:true|false)\|/u.test(line));
    const identity = identityLine?.split("|") ?? [];
    receipt.database.firstTransactionReadOnly = identity[0] === "true";
    receipt.database.identityMatched = identity.length === 4 && identity.every((value) => value === "true");
    if (!receipt.database.firstTransactionReadOnly || !receipt.database.identityMatched) throw new Error("DATABASE_IDENTITY_MISMATCH");

    const migrations = sourcePsql(pgEnvironment, "SELECT migration_name,checksum,(finished_at IS NOT NULL)::text,(rolled_back_at IS NOT NULL)::text FROM public._prisma_migrations ORDER BY migration_name,started_at;");
    receipt.database.readQueries += 1;
    if (migrations.code !== 0) throw new Error("MIGRATION_HISTORY_READ_FAILED");
    const rows = String(migrations.stdout).split(/\r?\n/u).filter(Boolean).map((line) => {
      const parts = line.split("|");
      if (parts.length !== 4 || !SAFE_MIGRATION.test(parts[0]) || !/^[a-f0-9]{64}$/u.test(parts[1])) throw new Error("MIGRATION_HISTORY_INVALID");
      return { name: parts[0], checksum: parts[1], finished: parts[2] === "true", rolledBack: parts[3] === "true" };
    });
    const active = rows.filter((row) => row.finished && !row.rolledBack);
    const rolledBack = rows.filter((row) => row.rolledBack);
    const unresolved = rows.filter((row) => !row.finished && !row.rolledBack);
    let exactChecksumCount = 0;
    let formatVarianceCount = 0;
    let unknownMismatchCount = 0;
    for (const row of active) {
      const expected = inventory.get(row.name);
      if (expected?.exact === row.checksum) exactChecksumCount += 1;
      else if (expected?.alternatives.has(row.checksum)) formatVarianceCount += 1;
      else unknownMismatchCount += 1;
    }
    const completedCounterpartCount = rolledBack.filter((row) => active.some((candidate) => candidate.name === row.name && candidate.checksum === row.checksum)).length;
    receipt.migration = { expectedCount: EXPECTED_MIGRATION_COUNT, appliedCount: active.length, unresolvedFailedCount: unresolved.length, rollbackEntryCount: rolledBack.length, completedCounterpartCount, exactChecksumCount, formatVarianceCount, unknownMismatchCount, status: active.length === EXPECTED_MIGRATION_COUNT && unresolved.length === 0 && rolledBack.length === 1 && completedCounterpartCount === 1 && unknownMismatchCount === 0 ? (formatVarianceCount === 0 ? "UP_TO_DATE" : "UP_TO_DATE_FORMAT_VARIANCE") : "HISTORY_DIVERGED" };
    if (!["UP_TO_DATE", "UP_TO_DATE_FORMAT_VARIANCE"].includes(receipt.migration.status)) throw new Error("MIGRATION_HISTORY_DIVERGED");

    const sourceSnapshot = snapshot((sql) => { receipt.database.readQueries += 1; return sourcePsql(pgEnvironment, sql); });
    const runnerTemp = await fsp.realpath(source.RUNNER_TEMP);
    tempRoot = await fsp.mkdtemp(path.join(runnerTemp, "celebratedeal-wp2-"));
    await fsp.writeFile(path.join(tempRoot, ".owner"), runId, { encoding: "utf8", flag: "wx" });
    const dumpPath = path.join(tempRoot, "staging-public.dump");
    receipt.backup.attempts = 1;
    receipt.sideEffects.backupWrites = 1;
    const dumped = sourcePostgres(pgEnvironment, "pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--schema=public", "--file=/out/staging-public.dump"], { mount: tempRoot });
    if (dumped.code !== 0 || !fs.existsSync(dumpPath)) throw new Error("STAGING_BACKUP_FAILED");
    const dump = await fsp.readFile(dumpPath);
    receipt.backup = { attempts: 1, result: dump.length > 0 ? "PASS" : "FAILED", byteBucket: byteBucket(dump.length), digest: `sha256:${hashBuffer(dump)}` };
    if (receipt.backup.result !== "PASS") throw new Error("STAGING_BACKUP_EMPTY");

    const containerName = `celebratedeal-wp2-${runId}`;
    const started = run("docker", ["run", "-d", "--pull=never", "--network", "none", "--name", containerName, "--label", `celebratedeal.wp2-run=${runId}`, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_DB=celebratedeal_restore", "--tmpfs", "/var/lib/postgresql/data", POSTGRES_IMAGE]);
    if (started.code !== 0 || !/^[a-f0-9]{64}$/u.test(String(started.stdout).trim())) throw new Error("ISOLATED_CONTAINER_CREATE_FAILED");
    containerId = String(started.stdout).trim();
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const probe = run("docker", ["exec", containerId, "pg_isready", "-U", "postgres", "-d", "celebratedeal_restore"]);
      if (probe.code === 0) { ready = true; break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
    if (!ready) throw new Error("ISOLATED_POSTGRES_NOT_READY");
    const prepared = targetPsql(containerId, "CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions; DROP SCHEMA public CASCADE;");
    if (prepared.code !== 0) throw new Error("ISOLATED_TARGET_PREPARE_FAILED");
    const copied = run("docker", ["cp", dumpPath, `${containerId}:/tmp/staging-public.dump`]);
    if (copied.code !== 0) throw new Error("ISOLATED_DUMP_COPY_FAILED");
    const listed = run("docker", ["exec", containerId, "pg_restore", "--list", "/tmp/staging-public.dump"]);
    if (listed.code !== 0) throw new Error("ISOLATED_DUMP_LIST_FAILED");
    if (!/SCHEMA\s+-\s+public\b/u.test(String(listed.stdout))) {
      const publicSchema = targetPsql(containerId, "CREATE SCHEMA public;");
      if (publicSchema.code !== 0) throw new Error("ISOLATED_PUBLIC_SCHEMA_FAILED");
    }
    receipt.restore.attempts = 1;
    receipt.sideEffects.isolatedRestoreWrites = 1;
    const restored = run("docker", ["exec", containerId, "pg_restore", "--no-owner", "--no-privileges", "--exit-on-error", "--single-transaction", "--dbname=celebratedeal_restore", "/tmp/staging-public.dump"]);
    if (restored.code !== 0) throw new Error("ISOLATED_RESTORE_FAILED");
    const targetSnapshot = snapshot((sql) => targetPsql(containerId, sql));
    receipt.restore = { attempts: 1, result: "PASS", migrationCount: targetSnapshot.migrationCount, schemaMatched: sourceSnapshot.tableCount === targetSnapshot.tableCount && sourceSnapshot.columnCount === targetSnapshot.columnCount, extensionsMatched: sourceSnapshot.extensionDigest === targetSnapshot.extensionDigest, aggregateMatched: sourceSnapshot.aggregateDigest === targetSnapshot.aggregateDigest, isolated: true };
    if (receipt.restore.migrationCount !== EXPECTED_MIGRATION_COUNT || !receipt.restore.schemaMatched || !receipt.restore.extensionsMatched || !receipt.restore.aggregateMatched) throw new Error("ISOLATED_RESTORE_MISMATCH");
    receipt.database.disconnected = true;
    receipt.result = "PASS";
  } catch (error) {
    receipt.result = receipt.result === "FAILED" ? "FAILED" : "BLOCKED";
    receipt.failureCategory = receipt.failureCategory ?? safeFailure(error);
  } finally {
    if (pgEnvironment) {
      for (const key of Object.keys(pgEnvironment)) pgEnvironment[key] = "";
      pgEnvironment = null;
      receipt.database.disconnected = true;
    }
    if (containerId) {
      if (ownedContainer(containerId, runId)) run("docker", ["rm", "-f", containerId]);
      else { receipt.result = "BLOCKED"; receipt.failureCategory = "ISOLATED_CLEANUP_OWNERSHIP_FAILED"; }
    }
    if (tempRoot) {
      const runnerTemp = await fsp.realpath(source.RUNNER_TEMP).catch(() => null);
      const owner = await fsp.readFile(path.join(tempRoot, ".owner"), "utf8").catch(() => "");
      const relative = runnerTemp ? path.relative(runnerTemp, tempRoot) : "..";
      if (owner === runId && !relative.startsWith("..") && !path.isAbsolute(relative)) await fsp.rm(tempRoot, { recursive: true, force: true });
      else { receipt.result = "BLOCKED"; receipt.failureCategory = "TEMP_CLEANUP_OWNERSHIP_FAILED"; }
    }
  }
  const validation = validateReceipt(receipt);
  if (!validation.ok) { receipt.result = "BLOCKED"; receipt.failureCategory = "RECEIPT_VALIDATION_FAILED"; }
  return receipt;
}

async function main() {
  const task = process.argv[2] ?? "";
  const receipt = await runSecureTask(task);
  const runnerTemp = await fsp.realpath(process.env.RUNNER_TEMP ?? os.tmpdir());
  const outputDirectory = path.join(runnerTemp, "celebratedeal-secure-receipts");
  await fsp.mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, RECEIPT_NAME);
  await fsp.writeFile(outputPath, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({ task: receipt.task, result: receipt.result, sourceCommit: receipt.sourceCommit, receipt: RECEIPT_NAME })}\n`);
  if (receipt.result !== "PASS") process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

export const CONTRACT = Object.freeze({ task: TASK, githubApiOrigin: GITHUB_API_ORIGIN, githubEnvironment: GITHUB_ENVIRONMENT, postgresImage: POSTGRES_IMAGE, receiptName: RECEIPT_NAME });
