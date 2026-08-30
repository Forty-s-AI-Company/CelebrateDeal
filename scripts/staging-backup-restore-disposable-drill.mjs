import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listCanonicalMigrations, writeMirror } from "./prisma-loopback-disposable-migration-runner.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const migrationsRoot = path.join(workspaceRoot, "prisma", "migrations");
const receiptPath = path.join(workspaceRoot, ".ai-team", "reports", "staging-backup-restore-disposable-receipt.json");
const dockerImage = "postgres:16-alpine";
const receiptSchema = "celebratedeal-staging-backup-restore-disposable/v1";
const runNamePattern = /^celebratedeal-staging-backup-(?:source|target)-[a-f0-9]{16}$/u;
const tempNamePattern = /^celebratedeal-staging-backup-[a-f0-9]{16}$/u;
const migrationNamePattern = /^\d{12,14}_[a-z0-9_]+$/u;

function run(command, args, environment, { cwd = workspaceRoot, input = undefined, binary = false } = {}) {
  const child = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: binary ? null : "utf8",
    input,
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  return {
    exitCode: child.status ?? 1,
    stdout: child.stdout ?? (binary ? Buffer.alloc(0) : ""),
    stderr: child.stderr ?? (binary ? Buffer.alloc(0) : ""),
    error: child.error ?? null,
  };
}

function text(value) {
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value ?? "");
}

function runId() {
  return crypto.randomBytes(8).toString("hex");
}

export function safeEnvironment(tempRoot, additions = {}) {
  return {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    ComSpec: process.env.ComSpec ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    TEMP: path.join(tempRoot, "tmp"),
    TMP: path.join(tempRoot, "tmp"),
    HOME: path.join(tempRoot, "home"),
    USERPROFILE: path.join(tempRoot, "home"),
    DOCKER_CONFIG: path.join(tempRoot, "docker-config"),
    CI: "true",
    NODE_ENV: "test",
    NEXT_TELEMETRY_DISABLED: "1",
    PRISMA_HIDE_UPDATE_MESSAGE: "true",
    NO_COLOR: "1",
    PAYMENT_PROVIDER: "demo",
    RATE_LIMIT_PROVIDER: "memory",
    ...additions,
  };
}

export function parseContainerInspection(value) {
  const fields = String(value).replace(/\r?\n$/u, "").split("\t");
  if (fields.length !== 5) return null;
  const [id, name, run, marker, mount] = fields;
  return { id, name: name?.replace(/^\//u, ""), run, marker, mount };
}

export function isOwnedContainerInspection(inspection, expected) {
  return Boolean(
    inspection
    && inspection.id === expected.id
    && inspection.name === expected.name
    && inspection.run === expected.run
    && inspection.marker === expected.marker
    && (inspection.mount === "" || inspection.mount === "tmpfs=/var/lib/postgresql/data"),
  );
}

export function normalizePublicSchemaDump(value) {
  if (!Buffer.isBuffer(value) || value.length === 0) throw new Error("schema-dump-invalid");
  const source = value.toString("utf8");
  const matches = source.match(/^CREATE SCHEMA public;\r?\n/mgu) ?? [];
  if (matches.length > 1) throw new Error("schema-dump-public-schema-duplicate");
  return Buffer.from(source.replace(/^CREATE SCHEMA public;\r?\n/mu, ""), "utf8");
}

export function classifyFailure(value) {
  const raw = text(value);
  const restoreMatch = /psql-restore-failed:([A-Z_]+)/u.exec(raw);
  if (restoreMatch) return `DATABASE_RESTORE_${restoreMatch[1]}`;
  const message = raw.toLowerCase();
  if (message.includes("docker") || message.includes("container")) return "DOCKER_UNAVAILABLE_OR_OWNERSHIP";
  if (message.includes("pg_dump") || message.includes("psql") || message.includes("restore")) return "DATABASE_BACKUP_OR_RESTORE_FAILED";
  if (message.includes("prisma") || message.includes("migration")) return "MIGRATION_GATE_FAILED";
  if (message.includes("cleanup")) return "CLEANUP_FAILED";
  return "DRILL_FAILED_UNCLASSIFIED";
}

function classifyDatabaseFailure(value) {
  const message = text(value).toLowerCase();
  if (message.includes("role") && message.includes("does not exist")) return "ROLE_DEPENDENCY";
  if (message.includes("schema \"public\" already exists")) return "SCHEMA_CONFLICT";
  if (message.includes("extension") && message.includes("already exists")) return "EXTENSION_CONFLICT";
  if (message.includes("relation") && message.includes("already exists")) return "RELATION_CONFLICT";
  if (message.includes("function") && message.includes("already exists")) return "FUNCTION_CONFLICT";
  if (message.includes("type") && message.includes("already exists")) return "TYPE_CONFLICT";
  if (message.includes("constraint") && message.includes("already exists")) return "CONSTRAINT_CONFLICT";
  if (message.includes("index") && message.includes("already exists")) return "INDEX_CONFLICT";
  if (message.includes("syntax error")) return "SYNTAX_ERROR";
  if (message.includes("schema")) return "SCHEMA_MISSING";
  if (message.includes("relation")) return "RELATION_MISSING";
  if (message.includes("sequence")) return "SEQUENCE_MISSING";
  if (message.includes("function")) return "FUNCTION_MISSING";
  if (message.includes("type")) return "TYPE_MISSING";
  if (message.includes("language")) return "LANGUAGE_MISSING";
  if (message.includes("collation")) return "COLLATION_MISSING";
  if (message.includes("operator")) return "OPERATOR_MISSING";
  if (message.includes("publication")) return "PUBLICATION_MISSING";
  if (message.includes("extension")) return "EXTENSION_MISSING";
  if (message.includes("does not exist")) return "OBJECT_MISSING";
  if (message.includes("extension")) return "EXTENSION_DEPENDENCY";
  if (message.includes("permission denied")) return "PERMISSION_DENIED";
  if (message.includes("already exists")) return "OBJECT_CONFLICT";
  return "SQL_ERROR";
}

export function createReceipt(migrations) {
  return {
    schemaVersion: receiptSchema,
    workPackage: "STAGING_BACKUP_RESTORE_DISPOSABLE",
    status: "BLOCKED_OR_FAILED",
    migrations: {
      expected: migrations.length,
      source: "NOT_RUN",
      restored: "NOT_RUN",
      status: "NOT_RUN",
    },
    backup: {
      schema: "NOT_RUN",
      data: "NOT_RUN",
      schemaBytes: 0,
      dataBytes: 0,
      schemaSha256: null,
      dataSha256: null,
    },
    restore: {
      schema: "NOT_RUN",
      data: "NOT_RUN",
      aggregate: "NOT_RUN",
    },
    cleanup: {
      sourceContainer: "NOT_STARTED",
      targetContainer: "NOT_STARTED",
      tempRoot: "NOT_STARTED",
    },
    failure: { category: null },
    safety: {
      sourceEnvContentsRead: false,
      rawDumpPersisted: false,
      rawOutputPersisted: false,
      loopbackOnly: true,
      noPersistentVolume: true,
      productionOperations: false,
    },
  };
}

export function validateReceipt(value, migrations = listCanonicalMigrations()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const exact = (candidate, keys) => (
    candidate && typeof candidate === "object" && !Array.isArray(candidate)
    && Object.keys(candidate).length === keys.length
    && keys.every((key) => Object.hasOwn(candidate, key))
  );
  if (!exact(value, ["schemaVersion", "workPackage", "status", "migrations", "backup", "restore", "cleanup", "failure", "safety"])) return false;
  if (value.schemaVersion !== receiptSchema || value.workPackage !== "STAGING_BACKUP_RESTORE_DISPOSABLE") return false;
  if (!["PASS", "BLOCKED_OR_FAILED"].includes(value.status)) return false;
  if (!exact(value.migrations, ["expected", "source", "restored", "status"]) || value.migrations.expected !== migrations.length) return false;
  if (!exact(value.backup, ["schema", "data", "schemaBytes", "dataBytes", "schemaSha256", "dataSha256"])) return false;
  if (!Number.isInteger(value.backup.schemaBytes) || value.backup.schemaBytes < 0 || !Number.isInteger(value.backup.dataBytes) || value.backup.dataBytes < 0) return false;
  if (!exact(value.restore, ["schema", "data", "aggregate"])) return false;
  if (!exact(value.cleanup, ["sourceContainer", "targetContainer", "tempRoot"])) return false;
  if (!exact(value.failure, ["category"])) return false;
  if (!exact(value.safety, ["sourceEnvContentsRead", "rawDumpPersisted", "rawOutputPersisted", "loopbackOnly", "noPersistentVolume", "productionOperations"])) return false;
  if (value.safety.sourceEnvContentsRead || value.safety.rawDumpPersisted || value.safety.rawOutputPersisted || !value.safety.loopbackOnly || !value.safety.noPersistentVolume || value.safety.productionOperations) return false;
  if (value.status === "PASS") {
    return value.migrations.source === "PASS"
      && value.migrations.restored === "PASS"
      && value.migrations.status === "PASS"
      && value.backup.schema === "PASS"
      && value.backup.data === "PASS"
      && value.backup.schemaBytes > 0
      && value.backup.dataBytes > 0
      && /^[a-f0-9]{64}$/u.test(value.backup.schemaSha256)
      && /^[a-f0-9]{64}$/u.test(value.backup.dataSha256)
      && value.restore.schema === "PASS"
      && value.restore.data === "PASS"
      && value.restore.aggregate === "PASS"
      && value.cleanup.sourceContainer === "PASS"
      && value.cleanup.targetContainer === "PASS"
      && value.cleanup.tempRoot === "PASS"
      && value.failure.category === null;
  }
  return true;
}

function dockerInspect(containerId, environment) {
  const inspected = run("docker", [
    "inspect", "--format",
    "{{.Id}}\t{{.Name}}\t{{index .Config.Labels \"celebratedeal.run-id\"}}\t{{index .Config.Labels \"celebratedeal.marker\"}}\t{{range .Mounts}}{{.Type}}={{.Destination}}{{end}}",
    containerId,
  ], environment);
  return inspected.exitCode === 0 ? parseContainerInspection(text(inspected.stdout)) : null;
}

function dockerPort(containerId, environment) {
  const response = run("docker", ["port", containerId, "5432/tcp"], environment);
  const match = response.exitCode === 0 ? /^127\.0\.0\.1:(\d+)\s*$/mu.exec(text(response.stdout)) : null;
  return match ? Number(match[1]) : null;
}

function waitForPostgres(containerId, environment) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ready = run("docker", ["exec", containerId, "pg_isready", "-U", "postgres", "-d", "celebratedeal_test"], environment);
    if (ready.exitCode === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  return false;
}

function psql(containerId, sql, environment, database = "celebratedeal_test", input) {
  return run("docker", [
    "exec", ...(input === undefined ? [] : ["-i"]), containerId,
    "psql", "-U", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q",
    "-d", database, "-c", sql,
  ], environment, { input });
}

function markContainer(container, environment) {
  const database = psql(container.id, `COMMENT ON DATABASE celebratedeal_test IS '${container.marker}';`, environment, "postgres");
  const schema = psql(container.id, `COMMENT ON SCHEMA public IS '${container.marker}';`, environment);
  if (database.exitCode !== 0 || schema.exitCode !== 0) throw new Error("container-marker-write-failed");
}

function startContainer(tempRoot, runIdentifier, role, environment) {
  const name = `celebratedeal-staging-backup-${role}-${runIdentifier}`;
  const marker = `staging-backup:${runIdentifier}:${role}`;
  if (!runNamePattern.test(name)) throw new Error("container-name-invalid");
  const created = run("docker", [
    "run", "-d", "--pull=never", "--name", name,
    "--label", `celebratedeal.run-id=${runIdentifier}`,
    "--label", `celebratedeal.marker=${marker}`,
    "-e", "POSTGRES_USER=postgres",
    "-e", "POSTGRES_PASSWORD=postgres",
    "-e", "POSTGRES_DB=celebratedeal_test",
    "--tmpfs", "/var/lib/postgresql/data",
    "-p", "127.0.0.1::5432",
    dockerImage,
  ], environment);
  if (created.exitCode !== 0 || !/^[a-f0-9]{64}\s*$/iu.test(text(created.stdout))) throw new Error("docker-container-create-failed");
  const id = text(created.stdout).trim();
  const container = { id, name, run: runIdentifier, marker, role, port: null, databaseUrl: null };
  if (!waitForPostgres(id, environment)) throw new Error("postgres-not-ready");
  const port = dockerPort(id, environment);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("loopback-port-invalid");
  container.port = port;
  container.databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/celebratedeal_test?schema=public`;
  markContainer(container, environment);
  return container;
}

function prismaCommand(mirrorRoot, databaseUrl, tempRoot, args) {
  const prismaCli = path.join(workspaceRoot, "node_modules", "prisma", "build", "index.js");
  if (!fs.existsSync(prismaCli)) return { exitCode: 1, stdout: "", stderr: "prisma-cli-missing" };
  const environment = safeEnvironment(tempRoot, { DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl });
  return run(process.execPath, [prismaCli, ...args, "--config", path.join(mirrorRoot, "prisma.config.mjs")], environment, { cwd: mirrorRoot });
}

function applyMigrations(container, migrations, tempRoot) {
  const mirrorRoot = writeMirror(path.join(tempRoot, "prisma-mirror"), migrations);
  for (const args of [["validate"], ["migrate", "deploy"], ["migrate", "status"]]) {
    const response = prismaCommand(mirrorRoot, container.databaseUrl, tempRoot, args);
    if (response.exitCode !== 0) throw new Error(`prisma-${args.join("-")}-failed`);
  }
  return mirrorRoot;
}

function dump(container, environment, args) {
  const response = run("docker", ["exec", container.id, "pg_dump", ...args], environment, { binary: true });
  if (response.exitCode !== 0 || !Buffer.isBuffer(response.stdout) || response.stdout.length === 0) throw new Error("pg_dump-failed");
  return response.stdout;
}

function restore(container, environment, dumpBuffer) {
  const response = run("docker", [
    "exec", "-i", container.id, "psql", "-U", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-d", "celebratedeal_test",
  ], environment, { input: dumpBuffer });
  if (response.exitCode !== 0) throw new Error(`psql-restore-failed:${classifyDatabaseFailure(response.stderr)}`);
}

function prepareDisposableTarget(container, environment) {
  const inspected = dockerInspect(container.id, environment);
  if (!isOwnedContainerInspection(inspected, container)) throw new Error("restore-target-ownership-failed");
  const marker = psql(container.id, "SELECT COALESCE(obj_description(oid, 'pg_namespace'), '') FROM pg_namespace WHERE nspname = 'public'", environment);
  if (marker.exitCode !== 0 || text(marker.stdout).trim() !== container.marker) throw new Error("restore-target-marker-failed");
  const extensions = psql(container.id, "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm;", environment);
  if (extensions.exitCode !== 0) throw new Error("restore-target-extension-prepare-failed");
}

function querySnapshot(container, environment) {
  const migrations = psql(container.id, "SELECT count(*)::text || '|' || count(*) FILTER (WHERE finished_at IS NOT NULL)::text || '|' || count(*) FILTER (WHERE rolled_back_at IS NULL)::text FROM public._prisma_migrations", environment);
  const tables = psql(container.id, "SELECT count(*)::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'", environment);
  const columns = psql(container.id, "SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public'", environment);
  const extensions = psql(container.id, "SELECT COALESCE(string_agg(extname, ',' ORDER BY extname), '') FROM pg_extension WHERE extname IN ('pgcrypto', 'pg_trgm')", environment);
  if (migrations.exitCode !== 0 || tables.exitCode !== 0 || columns.exitCode !== 0 || extensions.exitCode !== 0) throw new Error("aggregate-query-failed");
  return {
    migrations: text(migrations.stdout).trim(),
    tables: text(tables.stdout).trim(),
    columns: text(columns.stdout).trim(),
    extensions: text(extensions.stdout).trim(),
  };
}

function digest(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function cleanupContainer(container, environment) {
  if (!container) return "NOT_CREATED";
  const inspected = dockerInspect(container.id, environment);
  const owned = isOwnedContainerInspection(inspected, container);
  const databaseMarker = owned ? psql(container.id, "SELECT COALESCE(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = 'celebratedeal_test'", environment, "postgres") : null;
  const schemaMarker = owned ? psql(container.id, "SELECT COALESCE(obj_description(oid, 'pg_namespace'), '') FROM pg_namespace WHERE nspname = 'public'", environment) : null;
  const schemaMarkerText = schemaMarker ? text(schemaMarker.stdout).trim() : "";
  const markerMatches = owned
    && databaseMarker?.exitCode === 0
    && text(databaseMarker.stdout).trim() === container.marker
    && schemaMarker?.exitCode === 0
    && schemaMarkerText === container.marker;
  if (!markerMatches) return "CLEANUP_BLOCKED";
  const removed = run("docker", ["rm", "-f", container.id], environment);
  const verified = run("docker", ["inspect", container.id], environment);
  return removed.exitCode === 0 && verified.exitCode !== 0 ? "PASS" : "FAIL";
}

function cleanupTempRoot(tempRoot, marker) {
  const resolved = path.resolve(tempRoot);
  const tempBase = path.resolve(os.tmpdir());
  const markerPath = path.join(resolved, ".marker");
  if (!resolved.startsWith(`${tempBase}${path.sep}`) || !tempNamePattern.test(path.basename(resolved)) || !fs.existsSync(markerPath) || fs.readFileSync(markerPath, "utf8") !== marker) return "CLEANUP_BLOCKED";
  fs.rmSync(resolved, { recursive: true, force: true });
  return fs.existsSync(resolved) ? "FAIL" : "PASS";
}

function writeReceipt(receipt) {
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

export async function main() {
  if (process.argv[2] === "--verify-receipt") {
    const candidate = process.argv[3];
    const valid = Boolean(candidate && fs.existsSync(candidate) && validateReceipt(JSON.parse(fs.readFileSync(candidate, "utf8"))));
    process.exitCode = valid ? 0 : 1;
    return valid;
  }

  const migrations = listCanonicalMigrations(migrationsRoot);
  const identifier = runId();
  const tempRoot = path.join(os.tmpdir(), `celebratedeal-staging-backup-${identifier}`);
  const marker = `staging-backup:${identifier}`;
  const environment = safeEnvironment(tempRoot);
  const receipt = createReceipt(migrations);
  let source = null;
  let target = null;

  try {
    if (migrations.length === 0 || migrations.some((name) => !migrationNamePattern.test(name))) throw new Error("migration-inventory-invalid");
    if (run("docker", ["image", "inspect", dockerImage], environment).exitCode !== 0) throw new Error("docker-image-unavailable");
    fs.mkdirSync(path.join(tempRoot, "tmp"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "home"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "docker-config"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, ".marker"), marker, "utf8");

    source = startContainer(tempRoot, identifier, "source", environment);
    target = startContainer(tempRoot, identifier, "target", environment);
    const sourceMirror = applyMigrations(source, migrations, tempRoot);
    receipt.migrations.source = "PASS";

    const schemaDump = dump(source, environment, ["-U", "postgres", "--no-owner", "--no-privileges", "--schema-only", "--schema=public", "-d", "celebratedeal_test"]);
    const dataDump = dump(source, environment, ["-U", "postgres", "--no-owner", "--no-privileges", "--data-only", "--schema=public", "--inserts", "-d", "celebratedeal_test"]);
    const normalizedSchemaDump = normalizePublicSchemaDump(schemaDump);
    receipt.backup = {
      schema: "PASS",
      data: "PASS",
      schemaBytes: schemaDump.byteLength,
      dataBytes: dataDump.byteLength,
      schemaSha256: digest(schemaDump),
      dataSha256: digest(dataDump),
    };

    prepareDisposableTarget(target, environment);
    restore(target, environment, normalizedSchemaDump);
    markContainer(target, environment);
    receipt.restore.schema = "PASS";
    restore(target, environment, dataDump);
    receipt.restore.data = "PASS";

    const targetStatus = prismaCommand(sourceMirror, target.databaseUrl, tempRoot, ["migrate", "status"]);
    if (targetStatus.exitCode !== 0) throw new Error("restored-migration-status-failed");
    receipt.migrations.restored = "PASS";
    receipt.migrations.status = "PASS";
    const sourceSnapshot = querySnapshot(source, environment);
    const targetSnapshot = querySnapshot(target, environment);
    if (JSON.stringify(sourceSnapshot) !== JSON.stringify(targetSnapshot)) throw new Error("aggregate-mismatch");
    receipt.restore.aggregate = "PASS";
    receipt.status = "PASS";
  } catch (error) {
    receipt.failure.category = classifyFailure(error);
  } finally {
    receipt.cleanup.sourceContainer = cleanupContainer(source, environment);
    receipt.cleanup.targetContainer = cleanupContainer(target, environment);
    receipt.cleanup.tempRoot = cleanupTempRoot(tempRoot, marker);
    if (receipt.status === "PASS" && Object.values(receipt.cleanup).some((status) => status !== "PASS")) receipt.status = "BLOCKED_OR_FAILED";
    writeReceipt(receipt);
  }

  if (!validateReceipt(receipt, migrations)) process.exitCode = 1;
  else if (receipt.status !== "PASS") process.exitCode = 1;
  else process.stdout.write(`${JSON.stringify({ workPackage: receipt.workPackage, status: receipt.status, migrationCount: migrations.length, backup: { schema: receipt.backup.schema, data: receipt.backup.data }, restore: receipt.restore, cleanup: receipt.cleanup })}\n`);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) await main();
