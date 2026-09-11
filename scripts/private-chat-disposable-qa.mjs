import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listCanonicalMigrations, writeMirror } from "./prisma-loopback-disposable-migration-runner.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const image = "postgres:16-alpine";
export const receiptPath = path.join(root, "docs", "live-feature-handoffs", "private-chat-db-evidence.json");
const receiptSchema = "celebratedeal-private-chat-disposable/v1";
const workPackage = "PRIVATE-CHAT";
const runIdPattern = /^[a-f0-9]{16}$/u;
const namePattern = /^celebratedeal-private-chat-[a-f0-9]{16}$/u;
const schemaPattern = /^private_chat_[a-f0-9]{16}$/u;
const markerPattern = /^private-chat:[a-f0-9]{16}$/u;
const requiredTestTitle = "converges retries, rejects changed bodies and separates instructor/viewer idempotency";
const disposableSensitiveDataSeed = "private-chat-disposable-only-sensitive-data-seed";
const allowedFailureCodes = new Set([
  "RUNNER_CONTRACT_INVALID",
  "DOCKER_IMAGE_UNAVAILABLE",
  "DOCKER_ACCESS_DENIED",
  "CONTAINER_CREATE_FAILED",
  "DATABASE_UNREACHABLE",
  "LOOPBACK_PORT_INVALID",
  "MARKER_WRITE_FAILED",
  "PRISMA_CLI_MISSING",
  "PRISMA_VALIDATE_FAILED",
  "PRISMA_DEPLOY_FAILED",
  "PRISMA_STATUS_FAILED",
  "MIGRATION_STATE_MISMATCH",
  "LIVE_CHAT_DB_REPORT_MISSING",
  "LIVE_CHAT_DB_TESTS_FAILED",
  "CLEANUP_BLOCKED",
  "CLEANUP_FAILED",
  "RUNNER_FAILED",
]);

function run(command, args, environment, cwd = root) {
  const child = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    exitCode: child.status ?? 1,
    stdout: child.stdout ?? "",
    stderr: child.stderr ?? "",
  };
}

function waitForPostgres(containerId, environment) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ready = run(
      "docker",
      ["exec", containerId, "pg_isready", "-U", "postgres", "-d", "celebratedeal_test"],
      environment,
    );
    if (ready.exitCode === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
  }
  return false;
}

function psql(containerId, sql, environment, database = "celebratedeal_test") {
  return run(
    "docker",
    [
      "exec",
      containerId,
      "psql",
      "-U",
      "postgres",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-A",
      "-t",
      "-q",
      "-d",
      database,
      "-c",
      sql,
    ],
    environment,
  );
}

export function buildRunIdentity(runId) {
  if (!runIdPattern.test(runId)) throw new Error("invalid-run-id");
  return {
    runId,
    name: `celebratedeal-private-chat-${runId}`,
    schema: `private_chat_${runId}`,
    marker: `private-chat:${runId}`,
  };
}

export function buildIsolatedEnvironment(tempRoot, options = {}) {
  const databaseUrl = options.databaseUrl;
  const directUrl = options.directUrl ?? databaseUrl;
  const environment = {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    ComSpec: process.env.ComSpec ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    TEMP: path.join(tempRoot, "tmp"),
    TMP: path.join(tempRoot, "tmp"),
    HOME: path.join(tempRoot, "home"),
    USERPROFILE: path.join(tempRoot, "profile"),
    DOCKER_CONFIG: path.join(tempRoot, "docker-config"),
    NODE_ENV: "test",
    CI: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    PRISMA_HIDE_UPDATE_MESSAGE: "true",
    NO_COLOR: "1",
  };

  if (typeof databaseUrl === "string") {
    environment.DATABASE_URL = databaseUrl;
    environment.DIRECT_URL = directUrl ?? databaseUrl;
  }
  if (options.enableDatabaseTest === true) {
    environment.RT01_D2_DISPOSABLE_DB = "true";
    environment.CSRF_SECRET = disposableSensitiveDataSeed;
  }
  return environment;
}

function inspectContainer(containerId, environment) {
  return run(
    "docker",
    [
      "inspect",
      "--format",
      '{{.Id}}\t{{.Name}}\t{{index .Config.Labels "celebratedeal.work-package"}}\t{{index .Config.Labels "celebratedeal.run-id"}}\t{{index .Config.Labels "celebratedeal.marker"}}\t{{range .Mounts}}{{.Type}}={{.Destination}}{{end}}',
      containerId,
    ],
    environment,
  );
}

export function parseContainerInspection(value) {
  const fields = String(value).replace(/\r?\n$/u, "").split("\t");
  if (fields.length !== 6) return null;
  const [id, name, packageName, runId, marker, mount] = fields;
  return {
    id,
    name: name?.replace(/^\//u, ""),
    workPackage: packageName,
    runId,
    marker,
    mount,
  };
}

export function hasOnlyEphemeralDataMount(inspection) {
  return inspection?.mount === "" || inspection?.mount === "tmpfs=/var/lib/postgresql/data";
}

function dockerPort(containerId, environment) {
  const result = run("docker", ["port", containerId, "5432/tcp"], environment);
  if (result.exitCode !== 0) return null;
  const match = /^127\.0\.0\.1:(\d+)\s*$/mu.exec(result.stdout);
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null;
}

function parseMigrationRows(value, migrations) {
  const rows = String(value).trim() === ""
    ? []
    : String(value).trim().split(/\r?\n/u).map((line) => line.split("|"));
  if (rows.length !== migrations.length) return false;
  return rows.every(([name, finished, active], index) => (
    name === migrations[index] && finished === "true" && active === "true"
  ));
}

function sanitizeRuntimeDiagnostic(value) {
  return String(value)
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/giu, "[database-url]")
    .replace(/https?:\/\/[^\s"']+/giu, "[url]")
    .replace(/[A-Za-z]:\\[^\r\n]+/gu, "[local-path]")
    .replace(/127\.0\.0\.1:\d{2,5}/gu, "127.0.0.1:[port]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu, "[email]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/gu, "[redacted]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 1_200);
}

function parseVitestReport(filePath, exitCode) {
  if (!fs.existsSync(filePath)) return null;

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }

  const suites = Array.isArray(payload.testResults) ? payload.testResults : [];
  const assertions = suites.flatMap((suite) => (
    Array.isArray(suite.assertionResults) ? suite.assertionResults : []
  ));
  const suiteNames = suites.map((suite) => String(suite.name ?? "").replaceAll("\\", "/"));
  const titles = assertions.map((assertion) => String(assertion.title ?? assertion.fullName ?? ""));
  const statuses = assertions.map((assertion) => String(assertion.status ?? "").toLowerCase());
  const skipped = statuses.filter((status) => ["pending", "skipped", "todo"].includes(status)).length;
  const failed = statuses.filter((status) => status === "failed").length;
  const passed = statuses.filter((status) => status === "passed").length;
  const exactSuite = suites.length === 1 && suiteNames.every((name) => name.endsWith("src/lib/live-private-chat.db.test.ts"));
  const requiredTestPassed = titles.some((title, index) => (
    title.includes(requiredTestTitle) && statuses[index] === "passed"
  ));
  const diagnostic = sanitizeRuntimeDiagnostic([
    ...assertions.flatMap((assertion) => (
      Array.isArray(assertion.failureMessages) ? assertion.failureMessages : []
    )),
    ...suites.map((suite) => suite.message ?? ""),
  ].filter(Boolean).join(" "));

  return {
    suiteCount: suites.length,
    exactSuite,
    requiredTestPassed,
    diagnostic,
    tests: { total: assertions.length, passed, failed, skipped },
    status: exitCode === 0
      && exactSuite
      && requiredTestPassed
      && assertions.length === 5
      && failed === 0
      && skipped === 0
      && passed === assertions.length
      ? "PASS"
      : "BLOCKED_OR_FAILED",
  };
}

function createInitialReceipt(identity, migrations, startedAt = new Date().toISOString()) {
  return {
    schemaVersion: receiptSchema,
    workPackage,
    status: "BLOCKED_OR_FAILED",
    runId: identity.runId,
    startedAt,
    finishedAt: null,
    migrationNames: migrations,
    phases: {
      validate: "NOT_STARTED",
      deploy: "NOT_STARTED",
      status: "NOT_STARTED",
      migrationState: "NOT_STARTED",
      liveChatDbTests: "NOT_STARTED",
    },
    testResult: {
      suiteCount: 0,
      exactSuite: false,
      requiredTestPassed: false,
      tests: { total: 0, passed: 0, failed: 0, skipped: 0 },
    },
    cleanup: { container: "NOT_STARTED", tempRoot: "NOT_STARTED" },
    safety: {
      sourceEnvContentsRead: false,
      rawOutputPersisted: false,
      loopbackOnly: true,
      noPersistentVolume: false,
      syntheticFixturesOnly: true,
      productionSideEffects: false,
    },
    failure: { code: null },
  };
}

function setFailure(receipt, code) {
  receipt.failure = { code: allowedFailureCodes.has(code) ? code : "RUNNER_FAILED" };
}

function isSafeTempRoot(tempRoot, expectedName, marker) {
  const resolved = path.resolve(tempRoot);
  const tempBase = path.resolve(os.tmpdir());
  const insideTemp = resolved.startsWith(`${tempBase}${path.sep}`);
  const markerPath = path.join(resolved, ".marker");
  return insideTemp
    && path.basename(resolved) === expectedName
    && fs.existsSync(markerPath)
    && fs.readFileSync(markerPath, "utf8") === marker;
}

export function cleanupTempRoot(tempRoot, expectedName, marker) {
  if (!isSafeTempRoot(tempRoot, expectedName, marker)) return "CLEANUP_BLOCKED";
  fs.rmSync(path.resolve(tempRoot), { recursive: true, force: true });
  return fs.existsSync(path.resolve(tempRoot)) ? "FAIL" : "PASS";
}

function cleanupContainer(container, identity, environment, receipt) {
  if (!container) {
    receipt.cleanup.container = "NOT_CREATED";
    return;
  }

  const inspectedResult = inspectContainer(container.id, environment);
  const inspected = inspectedResult.exitCode === 0 ? parseContainerInspection(inspectedResult.stdout) : null;
  receipt.safety.noPersistentVolume = hasOnlyEphemeralDataMount(inspected);
  const labelsAndMountMatch = inspected
    && inspected.id === container.id
    && inspected.name === identity.name
    && inspected.workPackage === workPackage
    && inspected.runId === identity.runId
    && inspected.marker === identity.marker
    && hasOnlyEphemeralDataMount(inspected);
  const databaseMarker = labelsAndMountMatch
    ? psql(
      container.id,
      'SELECT COALESCE(shobj_description(oid, \'pg_database\'), \'\') FROM pg_database WHERE datname = \'celebratedeal_test\';',
      environment,
      "postgres",
    )
    : null;
  const schemaMarker = labelsAndMountMatch
    ? psql(
      container.id,
      `SELECT COALESCE(obj_description(oid, 'pg_namespace'), '') FROM pg_namespace WHERE nspname = '${identity.schema}';`,
      environment,
    )
    : null;
  const owned = labelsAndMountMatch
    && databaseMarker?.exitCode === 0
    && databaseMarker.stdout.trim() === identity.marker
    && schemaMarker?.exitCode === 0
    && schemaMarker.stdout.trim() === identity.marker;

  if (!owned) {
    receipt.cleanup.container = "CLEANUP_BLOCKED";
    return;
  }

  const removed = run("docker", ["rm", "-f", container.id], environment);
  const absent = run("docker", ["inspect", container.id], environment);
  receipt.cleanup.container = removed.exitCode === 0 && absent.exitCode !== 0 ? "PASS" : "FAIL";
}

function writeReceipt(receipt, targetPath = receiptPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  fs.writeFileSync(targetPath, serialized, "utf8");
}

function hasExactKeys(value, keys) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function isIsoTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function verifyReceipt(value) {
  let receipt;
  try {
    receipt = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return false;
  }

  const migrations = listCanonicalMigrations();
  if (receipt?.mode === "new-loopback-database") {
    return receipt.schemaVersion === receiptSchema
      && receipt.workPackage === workPackage
      && receipt.status === "PASS"
      && runIdPattern.test(receipt.runId)
      && isIsoTimestamp(receipt.startedAt) && isIsoTimestamp(receipt.finishedAt)
      && JSON.stringify(receipt.migrationNames) === JSON.stringify(migrations)
      && hasExactKeys(receipt.phases, ["validate", "deploy", "status", "migrationState", "liveChatDbTests"])
      && Object.values(receipt.phases).every((phase) => phase === "PASS")
      && receipt.testResult?.suiteCount === 1 && receipt.testResult?.exactSuite === true
      && receipt.testResult?.requiredTestPassed === true && receipt.testResult?.status === "PASS"
      && receipt.testResult?.tests?.total === 5 && receipt.testResult?.tests?.passed === 5
      && receipt.testResult?.tests?.failed === 0 && receipt.testResult?.tests?.skipped === 0
      && receipt.ownership?.absentBeforeCreate === true && receipt.ownership?.markerVerified === true
      && receipt.cleanup?.container === "NOT_CREATED" && receipt.cleanup?.database === "PASS" && receipt.cleanup?.tempRoot === "PASS"
      && receipt.safety?.sourceEnvContentsRead === false && receipt.safety?.rawOutputPersisted === false
      && receipt.safety?.loopbackOnly === true && receipt.safety?.syntheticFixturesOnly === true
      && receipt.safety?.productionSideEffects === false && receipt.failure?.code === null;
  }
  if (!hasExactKeys(receipt, [
    "schemaVersion",
    "workPackage",
    "status",
    "runId",
    "startedAt",
    "finishedAt",
    "migrationNames",
    "phases",
    "testResult",
    "cleanup",
    "safety",
    "failure",
  ])) return false;
  if (receipt.schemaVersion !== receiptSchema || receipt.workPackage !== workPackage || receipt.status !== "PASS") return false;
  if (!runIdPattern.test(receipt.runId) || !isIsoTimestamp(receipt.startedAt) || !isIsoTimestamp(receipt.finishedAt)) return false;
  if (!Array.isArray(receipt.migrationNames) || JSON.stringify(receipt.migrationNames) !== JSON.stringify(migrations)) return false;
  if (!hasExactKeys(receipt.phases, ["validate", "deploy", "status", "migrationState", "liveChatDbTests"])) return false;
  if (Object.values(receipt.phases).some((status) => status !== "PASS")) return false;
  if (!hasExactKeys(receipt.testResult, ["suiteCount", "exactSuite", "requiredTestPassed", "tests"])) return false;
  if (!Number.isInteger(receipt.testResult.suiteCount) || receipt.testResult.suiteCount < 1) return false;
  if (receipt.testResult.exactSuite !== true || receipt.testResult.requiredTestPassed !== true) return false;
  if (!hasExactKeys(receipt.testResult.tests, ["total", "passed", "failed", "skipped"])) return false;
  const testCounts = receipt.testResult.tests;
  if (!Number.isInteger(testCounts.total) || testCounts.total !== 5
    || testCounts.passed !== testCounts.total
    || testCounts.failed !== 0
    || testCounts.skipped !== 0) return false;
  if (!hasExactKeys(receipt.cleanup, ["container", "tempRoot"]) || receipt.cleanup.container !== "PASS" || receipt.cleanup.tempRoot !== "PASS") return false;
  if (!hasExactKeys(receipt.safety, [
    "sourceEnvContentsRead",
    "rawOutputPersisted",
    "loopbackOnly",
    "noPersistentVolume",
    "syntheticFixturesOnly",
    "productionSideEffects",
  ])) return false;
  if (receipt.safety.sourceEnvContentsRead !== false
    || receipt.safety.rawOutputPersisted !== false
    || receipt.safety.loopbackOnly !== true
    || receipt.safety.noPersistentVolume !== true
    || receipt.safety.syntheticFixturesOnly !== true
    || receipt.safety.productionSideEffects !== false) return false;
  return hasExactKeys(receipt.failure, ["code"]) && receipt.failure.code === null;
}

export function verifyReceiptFile(candidatePath = receiptPath) {
  if (!path.isAbsolute(candidatePath) || path.resolve(candidatePath) !== path.resolve(receiptPath)) return false;
  try {
    return verifyReceipt(fs.readFileSync(candidatePath, "utf8"));
  } catch {
    return false;
  }
}

export async function main() {
  const identity = buildRunIdentity(crypto.randomBytes(8).toString("hex"));
  const tempRoot = path.join(os.tmpdir(), identity.name);
  const migrations = listCanonicalMigrations();
  const receipt = createInitialReceipt(identity, migrations);
  const environment = buildIsolatedEnvironment(tempRoot);
  let container = null;

  try {
    if (!namePattern.test(identity.name) || !schemaPattern.test(identity.schema) || !markerPattern.test(identity.marker) || migrations.length === 0) {
      setFailure(receipt, "RUNNER_CONTRACT_INVALID");
      throw new Error("runner-contract-invalid");
    }
    for (const directory of ["tmp", "home", "profile", "docker-config"]) {
      fs.mkdirSync(path.join(tempRoot, directory), { recursive: true });
    }
    fs.writeFileSync(path.join(tempRoot, ".marker"), identity.marker, "utf8");

    const imageInspection = run("docker", ["image", "inspect", image], environment);
    if (imageInspection.exitCode !== 0) {
      // 僅保存固定錯誤分類，Docker 原始診斷不寫入 evidence。
      setFailure(receipt, /permission denied|access is denied|EACCES|EPERM/iu.test(`${imageInspection.stdout} ${imageInspection.stderr}`)
        ? "DOCKER_ACCESS_DENIED"
        : "DOCKER_IMAGE_UNAVAILABLE");
      throw new Error("docker-image-unavailable");
    }

    const created = run("docker", [
      "run",
      "-d",
      "--pull=never",
      "--name",
      identity.name,
      "--label",
      `celebratedeal.work-package=${workPackage}`,
      "--label",
      `celebratedeal.run-id=${identity.runId}`,
      "--label",
      `celebratedeal.marker=${identity.marker}`,
      "-e",
      "POSTGRES_USER=postgres",
      "-e",
      "POSTGRES_PASSWORD=postgres",
      "-e",
      "POSTGRES_DB=celebratedeal_test",
      "--tmpfs",
      "/var/lib/postgresql/data",
      "-p",
      "127.0.0.1::5432",
      image,
    ], environment);
    if (created.exitCode !== 0 || !/^[a-f0-9]{64}\s*$/iu.test(created.stdout)) {
      setFailure(receipt, "CONTAINER_CREATE_FAILED");
      throw new Error("container-create-failed");
    }
    container = { id: created.stdout.trim() };
    if (!waitForPostgres(container.id, environment)) {
      setFailure(receipt, "DATABASE_UNREACHABLE");
      throw new Error("database-unreachable");
    }

    const port = dockerPort(container.id, environment);
    if (!port) {
      setFailure(receipt, "LOOPBACK_PORT_INVALID");
      throw new Error("loopback-port-invalid");
    }
    const databaseMarker = psql(
      container.id,
      `COMMENT ON DATABASE "celebratedeal_test" IS '${identity.marker}';`,
      environment,
      "postgres",
    );
    const schemaMarker = psql(
      container.id,
      `CREATE SCHEMA "${identity.schema}"; COMMENT ON SCHEMA "${identity.schema}" IS '${identity.marker}';`,
      environment,
    );
    if (databaseMarker.exitCode !== 0 || schemaMarker.exitCode !== 0) {
      setFailure(receipt, "MARKER_WRITE_FAILED");
      throw new Error("marker-write-failed");
    }

    const protocol = ["postgres", "ql://"].join("");
    const databaseUrl = `${protocol}postgres:postgres@127.0.0.1:${port}/celebratedeal_test?schema=${identity.schema}`;
    const databaseEnvironment = buildIsolatedEnvironment(tempRoot, {
      databaseUrl,
      enableDatabaseTest: true,
    });
    const mirrorRoot = writeMirror(tempRoot, migrations);
    const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
    const config = path.join(mirrorRoot, "prisma.config.mjs");
    if (!fs.existsSync(prismaCli)) {
      setFailure(receipt, "PRISMA_CLI_MISSING");
      throw new Error("prisma-cli-missing");
    }

    for (const [phase, args, failureCode] of [
      ["validate", ["validate"], "PRISMA_VALIDATE_FAILED"],
      ["deploy", ["migrate", "deploy"], "PRISMA_DEPLOY_FAILED"],
      ["status", ["migrate", "status"], "PRISMA_STATUS_FAILED"],
    ]) {
      const result = run(process.execPath, [prismaCli, ...args, "--config", config], databaseEnvironment, mirrorRoot);
      receipt.phases[phase] = result.exitCode === 0 ? "PASS" : "FAIL";
      if (result.exitCode !== 0) {
        setFailure(receipt, failureCode);
        throw new Error("prisma-phase-failed");
      }
    }

    const migrationState = psql(
      container.id,
      `SELECT migration_name, (finished_at IS NOT NULL)::text, (rolled_back_at IS NULL)::text FROM "${identity.schema}"._prisma_migrations ORDER BY migration_name;`,
      environment,
    );
    receipt.phases.migrationState = migrationState.exitCode === 0 && parseMigrationRows(migrationState.stdout, migrations)
      ? "PASS"
      : "FAIL";
    if (receipt.phases.migrationState !== "PASS") {
      setFailure(receipt, "MIGRATION_STATE_MISMATCH");
      throw new Error("migration-state-mismatch");
    }

    const reportPath = path.join(tempRoot, "live-chat-vitest.json");
    const vitestCli = path.join(root, "node_modules", "vitest", "vitest.mjs");
    const tests = run(process.execPath, [
      vitestCli,
      "run",
      "src/lib/live-private-chat.db.test.ts",
      "--config",
      path.join(root, "vitest.config.ts"),
      "--reporter=json",
      "--outputFile",
      reportPath,
    ], databaseEnvironment);
    const parsed = parseVitestReport(reportPath, tests.exitCode);
    if (!parsed) {
      setFailure(receipt, "LIVE_CHAT_DB_REPORT_MISSING");
      throw new Error("live-chat-db-report-missing");
    }
    receipt.testResult = {
      suiteCount: parsed.suiteCount,
      exactSuite: parsed.exactSuite,
      requiredTestPassed: parsed.requiredTestPassed,
      tests: parsed.tests,
    };
    receipt.phases.liveChatDbTests = parsed.status;
    if (parsed.status !== "PASS") {
      if (parsed.diagnostic) process.stderr.write(`PRIVATE_CHAT_DB_DIAGNOSTIC:${parsed.diagnostic}\n`);
      setFailure(receipt, "LIVE_CHAT_DB_TESTS_FAILED");
      throw new Error("live-chat-db-tests-failed");
    }
    receipt.status = "PASS";
  } catch (error) {
    if (receipt.failure.code === null) {
      setFailure(receipt, error instanceof Error ? "RUNNER_FAILED" : "RUNNER_FAILED");
    }
  } finally {
    cleanupContainer(container, identity, environment, receipt);
    receipt.cleanup.tempRoot = cleanupTempRoot(tempRoot, identity.name, identity.marker);
    if (receipt.cleanup.container !== "PASS" || receipt.cleanup.tempRoot !== "PASS") {
      if (receipt.status === "PASS") receipt.status = "BLOCKED_OR_FAILED";
      if (receipt.failure.code === null) setFailure(receipt, receipt.cleanup.container === "CLEANUP_BLOCKED" || receipt.cleanup.tempRoot === "CLEANUP_BLOCKED" ? "CLEANUP_BLOCKED" : "CLEANUP_FAILED");
    }
    receipt.finishedAt = new Date().toISOString();
    writeReceipt(receipt);
  }

  return receipt;
}

// 容器不可用時，只允許在固定 loopback 上建立「原先不存在」的測試 DB。
export async function runLoopbackDatabase() {
  const identity = buildRunIdentity(crypto.randomBytes(8).toString("hex"));
  const tempRoot = path.join(os.tmpdir(), identity.name);
  const migrations = listCanonicalMigrations();
  const receipt = createInitialReceipt(identity, migrations);
  receipt.mode = "new-loopback-database"; receipt.validationBoundary = "Real API routes, domain and PostgreSQL; mocked manager authentication, trusted ingress IP and rate limiter. Not a real-login browser E2E.";
  receipt.previousAttempts = fs.existsSync(receiptPath)
    ? [JSON.parse(fs.readFileSync(receiptPath, "utf8"))] : [];
  receipt.ownership = { absentBeforeCreate: false, markerVerified: false };
  const environment = { ...buildIsolatedEnvironment(tempRoot), PGPASSWORD: "postgres", PGCONNECT_TIMEOUT: "5" };
  const psqlCli = "C:/Users/eden/scoop/apps/postgresql/current/bin/psql.exe";
  const query = (database, sql) => run(psqlCli, ["-X", "-w", "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-c", sql], environment);
  let ownedDatabase = null;
  try {
    for (const directory of ["tmp", "home", "profile", "docker-config"]) fs.mkdirSync(path.join(tempRoot, directory), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, ".marker"), identity.marker);
    // 這些 migration 只含 DB 內物件／權限，不得新增 cluster 角色或系統設定。
    for (const migration of migrations) {
      const sql = fs.readFileSync(path.join(root, "prisma", "migrations", migration, "migration.sql"), "utf8");
      if (/\b(?:CREATE|ALTER|DROP)\s+(?:ROLE|USER|DATABASE|SYSTEM)\b/iu.test(sql)) throw new Error("CLUSTER_MUTATION_REJECTED");
    }
    let candidate;
    for (const name of ["celebratedeal_ci", "celebratedeal_wp17_ci", "celebratedeal_wp18_ci"]) {
      const exists = query("postgres", `SELECT count(*) FROM pg_database WHERE datname = '${name}';`);
      if (exists.exitCode !== 0) throw new Error("LOOPBACK_UNREACHABLE");
      if (exists.stdout.trim() === "0") { candidate = name; break; }
    }
    if (!candidate) throw new Error("NO_UNUSED_ALLOWED_DATABASE");
    receipt.ownership.absentBeforeCreate = true;
    if (query("postgres", `CREATE DATABASE "${candidate}" TEMPLATE template0;`).exitCode !== 0) throw new Error("DATABASE_CREATE_FAILED");
    ownedDatabase = candidate;
    if (query("postgres", `COMMENT ON DATABASE "${candidate}" IS '${identity.marker}';`).exitCode !== 0) throw new Error("MARKER_WRITE_FAILED");
    const marker = () => query("postgres", `SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = '${candidate}';`);
    receipt.ownership.markerVerified = marker().stdout.trim() === identity.marker;
    if (!receipt.ownership.markerVerified) throw new Error("MARKER_VERIFY_FAILED");
    const databaseEnvironment = buildIsolatedEnvironment(tempRoot, {
      databaseUrl: `postgresql://postgres:postgres@127.0.0.1:54329/${candidate}?schema=public`, enableDatabaseTest: true,
    });
    const mirrorRoot = writeMirror(tempRoot, migrations);
    for (const [phase, args] of [["validate", ["validate"]], ["deploy", ["migrate", "deploy"]], ["status", ["migrate", "status"]]]) {
      const result = run(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), ...args, "--config", path.join(mirrorRoot, "prisma.config.mjs")], databaseEnvironment, mirrorRoot);
      receipt.phases[phase] = result.exitCode === 0 ? "PASS" : "FAIL";
      if (result.exitCode !== 0) throw new Error(`PRISMA_${phase.toUpperCase()}_FAILED`);
    }
    const state = query(candidate, 'SELECT migration_name, (finished_at IS NOT NULL)::text, (rolled_back_at IS NULL)::text FROM public._prisma_migrations ORDER BY migration_name;');
    receipt.phases.migrationState = state.exitCode === 0 && parseMigrationRows(state.stdout, migrations) ? "PASS" : "FAIL";
    if (receipt.phases.migrationState !== "PASS") throw new Error("MIGRATION_STATE_MISMATCH");
    const reportPath = path.join(tempRoot, "private-chat-vitest.json");
    const tests = run(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "src/lib/live-private-chat.db.test.ts", "--config", path.join(root, "vitest.config.ts"), "--reporter=json", "--outputFile", reportPath], databaseEnvironment);
    const parsed = parseVitestReport(reportPath, tests.exitCode);
    if (!parsed) throw new Error("LIVE_CHAT_DB_REPORT_MISSING");
    receipt.testResult = parsed;
    receipt.phases.liveChatDbTests = parsed.status;
    if (parsed.status !== "PASS") throw new Error("LIVE_CHAT_DB_TESTS_FAILED");
    receipt.status = "PASS";
  } catch (error) {
    receipt.failure.code = error instanceof Error && /^[A-Z_]+$/u.test(error.message) ? error.message : "RUNNER_FAILED";
  } finally {
    receipt.cleanup.container = "NOT_CREATED";
    receipt.cleanup.database = "NOT_CREATED";
    if (ownedDatabase) {
      const marker = query("postgres", `SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = '${ownedDatabase}';`);
      if (marker.exitCode === 0 && marker.stdout.trim() === identity.marker) {
        const removed = query("postgres", `DROP DATABASE "${ownedDatabase}";`);
        const absent = query("postgres", `SELECT count(*) FROM pg_database WHERE datname = '${ownedDatabase}';`);
        receipt.cleanup.database = removed.exitCode === 0 && absent.exitCode === 0 && absent.stdout.trim() === "0" ? "PASS" : "FAIL";
      } else receipt.cleanup.database = "CLEANUP_BLOCKED";
    }
    receipt.cleanup.tempRoot = cleanupTempRoot(tempRoot, identity.name, identity.marker);
    if (receipt.status === "PASS" && (receipt.cleanup.database !== "PASS" || receipt.cleanup.tempRoot !== "PASS")) {
      receipt.status = "BLOCKED_OR_FAILED";
      receipt.failure.code = "CLEANUP_FAILED";
    }
    receipt.finishedAt = new Date().toISOString();
    writeReceipt(receipt);
  }
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  if (process.argv[2] === "--verify-receipt") {
    const valid = verifyReceiptFile(process.argv[3] ?? receiptPath);
    if (!valid) {
      process.stderr.write("PRIVATE_CHAT_RECEIPT_INVALID\n");
      process.exitCode = 1;
    }
  } else {
    const receipt = process.argv[2] === "--loopback-database" ? await runLoopbackDatabase() : await main();
    if (receipt.status === "PASS") {
      process.stdout.write(`${JSON.stringify({
        workPackage: receipt.workPackage,
        status: receipt.status,
        phases: receipt.phases,
        tests: receipt.testResult.tests,
        cleanup: receipt.cleanup,
      })}\n`);
    } else {
      process.stderr.write("PRIVATE_CHAT_DISPOSABLE_QA_FAILED\n");
      process.exitCode = 1;
    }
  }
}
