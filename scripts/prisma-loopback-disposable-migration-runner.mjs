import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { classifyPrismaMigrateStatus } from "./prisma-migrate-status-diagnostic.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const migrationsRoot = path.join(workspaceRoot, "prisma", "migrations");
const migrationLockSource = path.join(migrationsRoot, "migration_lock.toml");
const schemaSource = path.join(workspaceRoot, "prisma", "schema.prisma");
const receiptPath = path.join(workspaceRoot, ".ai-team", "reports", "prisma-loopback-disposable-migration-receipt.json");
const runNamePattern = /^celebratedeal-prisma-migrate-[a-f0-9]{16}$/;
const tempNamePattern = /^celebratedeal-prisma-migrate-[a-f0-9]{16}$/;
// Preserve every canonical migration directory, including legacy 12-digit
// prefixes, while still rejecting arbitrary files from the mirror.
const migrationNamePattern = /^\d{12,14}_[a-z0-9_]+$/;
const receiptSchema = "celebratedeal-prisma-loopback-migration/v1";
const dockerImage = "postgres:16-alpine";

function result(command, args, environment, cwd = workspaceRoot) {
  const child = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
    maxBuffer: 4 * 1024 * 1024,
  });
  return { exitCode: child.status ?? 1, stdout: child.stdout ?? "", stderr: child.stderr ?? "" };
}

function selectedSystemEnvironment(tempRoot) {
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
    CHECKPOINT_DISABLE: "1",
    PRISMA_HIDE_UPDATE_MESSAGE: "true",
    NO_COLOR: "1",
  };
}

export function listCanonicalMigrations(directory = migrationsRoot) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && migrationNamePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function classifyFailure(output, knownMigrationNames) {
  const diagnostic = classifyPrismaMigrateStatus(output, { knownMigrationNames });
  return { category: diagnostic.category, errorCode: diagnostic.errorCode, rootCauseConfirmed: diagnostic.rootCauseConfirmed };
}

function runId() {
  return crypto.randomBytes(8).toString("hex");
}

export function parseContainerInspection(value) {
  // Do not trim the final tab: Docker represents a zero-mount container with
  // an intentionally empty final field.
  const fields = String(value).replace(/\r?\n$/, "").split("\t");
  if (fields.length !== 5) return null;
  const [id, name, run, marker, mount] = fields;
  return { id, name: name?.replace(/^\//, ""), run, marker, mount };
}

function containerInspection(container, environment) {
  const inspected = result("docker", [
    "inspect", "--format",
    "{{.Id}}\t{{.Name}}\t{{index .Config.Labels \"celebratedeal.run-id\"}}\t{{index .Config.Labels \"celebratedeal.marker\"}}\t{{range .Mounts}}{{.Type}}={{.Destination}}{{end}}",
    container,
  ], environment);
  if (inspected.exitCode !== 0) return null;
  return parseContainerInspection(inspected.stdout);
}

function hasOnlyEphemeralDataMount(inspection) {
  // Docker Desktop may omit a tmpfs mount from `.Mounts`; both shapes prove
  // that the postgres image did not create a persistent named volume.
  return inspection?.mount === "" || inspection?.mount === "tmpfs=/var/lib/postgresql/data";
}

function dockerPort(container, environment) {
  const port = result("docker", ["port", container, "5432/tcp"], environment);
  if (port.exitCode !== 0) return null;
  const match = /^127\.0\.0\.1:(\d+)\s*$/m.exec(port.stdout);
  return match ? Number(match[1]) : null;
}

function waitForPostgres(container, environment) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ready = result("docker", ["exec", container, "pg_isready", "-U", "postgres", "-d", "celebratedeal_test"], environment);
    if (ready.exitCode === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  return false;
}

function psql(container, sql, environment, database = "celebratedeal_test") {
  return result("docker", [
    "exec", container, "psql", "-U", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q",
    "-d", database, "-c", sql,
  ], environment);
}

export function writeMirror(tempRoot, migrations) {
  const mirrorRoot = path.join(tempRoot, "mirror");
  const mirrorMigrations = path.join(mirrorRoot, "migrations");
  if (!fs.existsSync(migrationLockSource)) throw new Error("migration-lock-missing");
  fs.mkdirSync(mirrorMigrations, { recursive: true });
  fs.copyFileSync(schemaSource, path.join(mirrorRoot, "schema.prisma"));
  fs.copyFileSync(migrationLockSource, path.join(mirrorMigrations, "migration_lock.toml"));
  for (const migration of migrations) {
    const source = path.join(migrationsRoot, migration, "migration.sql");
    if (!fs.existsSync(source)) throw new Error("migration-file-missing");
    const destinationDirectory = path.join(mirrorMigrations, migration);
    fs.mkdirSync(destinationDirectory, { recursive: true });
    fs.copyFileSync(source, path.join(destinationDirectory, "migration.sql"));
  }
  const requirePath = path.join(workspaceRoot, "package.json").replaceAll("\\", "\\\\");
  fs.writeFileSync(path.join(mirrorRoot, "prisma.config.mjs"), [
    'import { createRequire } from "node:module";',
    `const require = createRequire("${requirePath}");`,
    'const { defineConfig } = require("prisma/config");',
    'export default defineConfig({',
    '  schema: "./schema.prisma",',
    '  engine: "classic",',
    '  migrations: { path: "./migrations" },',
    '  datasource: { url: process.env.DATABASE_URL },',
    '});',
    '',
  ].join("\n"), "utf8");
  return mirrorRoot;
}

function prismaCommand(mirrorRoot, databaseUrl, tempRoot, args) {
  const prismaCli = path.join(workspaceRoot, "node_modules", "prisma", "build", "index.js");
  if (!fs.existsSync(prismaCli)) return { exitCode: 1, stdout: "", stderr: "prisma-cli-missing" };
  const environment = {
    ...selectedSystemEnvironment(tempRoot),
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
  };
  return result(process.execPath, [prismaCli, ...args, "--config", path.join(mirrorRoot, "prisma.config.mjs")], environment, mirrorRoot);
}

function migrationRows(container, environment, migrations) {
  const query = "SELECT migration_name, (finished_at IS NOT NULL)::text, (rolled_back_at IS NULL)::text FROM public._prisma_migrations ORDER BY migration_name";
  const rows = psql(container, query, environment);
  if (rows.exitCode !== 0) return null;
  const expected = new Set(migrations);
  const parsed = rows.stdout.trim() === "" ? [] : rows.stdout.trim().split(/\r?\n/).map((line) => line.split("|"));
  if (parsed.some(([name, finished, active]) => !expected.has(name) || finished !== "true" || active !== "true")) return null;
  const actual = parsed.map(([name]) => name).sort();
  return actual.length === migrations.length && actual.every((name, index) => name === migrations[index]) ? actual : null;
}

function writeReceipt(receipt) {
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

export function verifyReceipt(value) {
  let receipt;
  try {
    receipt = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return false;
  }
  const hasExactKeys = (candidate, keys) => (
    candidate && typeof candidate === "object" && !Array.isArray(candidate)
    && Object.keys(candidate).length === keys.length
    && keys.every((key) => Object.hasOwn(candidate, key))
  );
  const migrationNames = listCanonicalMigrations();
  if (!hasExactKeys(receipt, ["schemaVersion", "workPackage", "status", "phases", "migrationNames", "failure", "cleanup", "safety"])) return false;
  if (receipt.schemaVersion !== receiptSchema || receipt.workPackage !== "PRISMA_NO_DOTENV_DISPOSABLE") return false;
  if (!Array.isArray(receipt.migrationNames) || receipt.migrationNames.length === 0) return false;
  if (new Set(receipt.migrationNames).size !== receipt.migrationNames.length) return false;
  if (receipt.migrationNames.some((name) => !migrationNamePattern.test(name))) return false;
  if (JSON.stringify(receipt.migrationNames) !== JSON.stringify(migrationNames)) return false;
  if (!hasExactKeys(receipt.phases, ["validate", "deploy", "status"]) || Object.values(receipt.phases).some((status) => status !== "PASS")) return false;
  if (!hasExactKeys(receipt.failure, ["category", "errorCode", "rootCauseConfirmed"])) return false;
  if (receipt.failure.category !== "none" || receipt.failure.errorCode !== null || receipt.failure.rootCauseConfirmed !== false) return false;
  if (!hasExactKeys(receipt.cleanup, ["container", "tempRoot"]) || receipt.cleanup.container !== "PASS" || receipt.cleanup.tempRoot !== "PASS") return false;
  if (!hasExactKeys(receipt.safety, ["sourceEnvContentsRead", "rawOutputPersisted", "loopbackOnly", "noPersistentVolume"])) return false;
  return receipt.status === "PASS" && receipt.safety.sourceEnvContentsRead === false && receipt.safety.rawOutputPersisted === false && receipt.safety.loopbackOnly === true && receipt.safety.noPersistentVolume === true;
}

function cleanup(container, tempRoot, marker, environment, receipt) {
  if (container) {
    const inspected = containerInspection(container.id, environment);
    const markerOkay = inspected
      && inspected.id === container.id
      && inspected.name === container.name
      && inspected.run === container.runId
      && inspected.marker === marker
      && hasOnlyEphemeralDataMount(inspected);
    const databaseMarker = markerOkay ? psql(container.id, "SELECT COALESCE(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = 'celebratedeal_test'", environment) : null;
    const schemaMarker = markerOkay ? psql(container.id, "SELECT COALESCE(obj_description(oid, 'pg_namespace'), '') FROM pg_namespace WHERE nspname = 'public'", environment) : null;
    if (!markerOkay || databaseMarker?.exitCode !== 0 || schemaMarker?.exitCode !== 0 || databaseMarker?.stdout.trim() !== marker || schemaMarker?.stdout.trim() !== marker) {
      receipt.cleanup.container = "CLEANUP_BLOCKED";
    } else {
      const removed = result("docker", ["rm", "-f", container.id], environment);
      const verified = result("docker", ["inspect", container.id], environment);
      receipt.cleanup.container = removed.exitCode === 0 && verified.exitCode !== 0 ? "PASS" : "FAIL";
    }
  } else receipt.cleanup.container = "NOT_CREATED";

  const tempBase = path.resolve(os.tmpdir());
  const resolved = path.resolve(tempRoot);
  const markerPath = path.join(resolved, ".marker");
  if (!resolved.startsWith(`${tempBase}${path.sep}`) || !tempNamePattern.test(path.basename(resolved)) || !fs.existsSync(markerPath) || fs.readFileSync(markerPath, "utf8") !== marker) {
    receipt.cleanup.tempRoot = "CLEANUP_BLOCKED";
  } else {
    fs.rmSync(resolved, { recursive: true, force: true });
    receipt.cleanup.tempRoot = fs.existsSync(resolved) ? "FAIL" : "PASS";
  }
}

export async function main() {
  if (process.argv[2] === "--verify-receipt") {
    const candidate = process.argv[3];
    const valid = candidate && fs.existsSync(candidate) && verifyReceipt(fs.readFileSync(candidate, "utf8"));
    process.exitCode = valid ? 0 : 1;
    return valid;
  }

  const migrations = listCanonicalMigrations();
  const id = runId();
  const name = `celebratedeal-prisma-migrate-${id}`;
  const marker = `prisma-no-dotenv:${id}`;
  const tempRoot = path.join(os.tmpdir(), name);
  const receipt = {
    schemaVersion: receiptSchema,
    workPackage: "PRISMA_NO_DOTENV_DISPOSABLE",
    status: "BLOCKED_OR_FAILED",
    phases: { validate: "NOT_STARTED", deploy: "NOT_STARTED", status: "NOT_STARTED" },
    migrationNames: migrations,
    failure: { category: "none", errorCode: null, rootCauseConfirmed: false },
    cleanup: { container: "NOT_STARTED", tempRoot: "NOT_STARTED" },
    safety: { sourceEnvContentsRead: false, rawOutputPersisted: false, loopbackOnly: true, noPersistentVolume: true },
  };
  const environment = selectedSystemEnvironment(tempRoot);
  let container = null;
  try {
    if (!runNamePattern.test(name) || migrations.length === 0) throw new Error("runner-contract");
    if (result("docker", ["image", "inspect", dockerImage], environment).exitCode !== 0) throw new Error("toolchain-missing");
    fs.mkdirSync(path.join(tempRoot, "tmp"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "home"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "docker-config"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, ".marker"), marker, "utf8");
    const created = result("docker", [
      "run", "-d", "--pull=never", "--name", name,
      "--label", `celebratedeal.run-id=${id}`, "--label", `celebratedeal.marker=${marker}`,
      "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=celebratedeal_test",
      "--tmpfs", "/var/lib/postgresql/data",
      "-p", "127.0.0.1::5432", dockerImage,
    ], environment);
    if (created.exitCode !== 0 || !/^[a-f0-9]{64}\s*$/i.test(created.stdout)) throw new Error("toolchain-missing");
    const containerId = created.stdout.trim();
    container = { id: containerId, name, runId: id };
    if (!waitForPostgres(containerId, environment)) throw new Error("database-unreachable");
    const port = dockerPort(containerId, environment);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("loopback-port-invalid");
    const databaseComment = psql(containerId, `COMMENT ON DATABASE celebratedeal_test IS '${marker}';`, environment, "postgres");
    const schemaComment = psql(containerId, `COMMENT ON SCHEMA public IS '${marker}';`, environment);
    if (databaseComment.exitCode !== 0 || schemaComment.exitCode !== 0) throw new Error("marker-write-failed");
    const mirrorRoot = writeMirror(tempRoot, migrations);
    const databaseUrl = ["postgres", "ql://"].join("") + `postgres:postgres@127.0.0.1:${port}/celebratedeal_test?schema=public`;
    for (const [key, args] of [["validate", ["validate"]], ["deploy", ["migrate", "deploy"]], ["status", ["migrate", "status"]]]) {
      const response = prismaCommand(mirrorRoot, databaseUrl, tempRoot, args);
      receipt.phases[key] = response.exitCode === 0 ? "PASS" : "FAIL";
      if (response.exitCode !== 0) {
        receipt.failure = classifyFailure(`${response.stdout}\n${response.stderr}`, migrations);
        throw new Error("prisma-command-failed");
      }
    }
    const actualMigrations = migrationRows(containerId, environment, migrations);
    if (!actualMigrations) throw new Error("migration-state-mismatch");
    receipt.status = "PASS";
  } catch (error) {
    if (receipt.failure.category === "none") {
      const message = error instanceof Error ? error.message : "runner-contract";
      receipt.failure = { category: message, errorCode: null, rootCauseConfirmed: false };
    }
  } finally {
    cleanup(container, tempRoot, marker, environment, receipt);
    if (receipt.status === "PASS" && (receipt.cleanup.container !== "PASS" || receipt.cleanup.tempRoot !== "PASS")) receipt.status = "BLOCKED_OR_FAILED";
    writeReceipt(receipt);
  }
  if (receipt.status !== "PASS") process.exitCode = 1;
  else process.stdout.write(`${JSON.stringify({ workPackage: receipt.workPackage, status: receipt.status, migrationCount: receipt.migrationNames.length, cleanup: receipt.cleanup })}\n`);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) await main();
