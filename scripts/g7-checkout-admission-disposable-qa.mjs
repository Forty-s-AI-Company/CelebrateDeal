import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listCanonicalMigrations, writeMirror } from "./prisma-loopback-disposable-migration-runner.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const receiptPath = path.join(root, ".ai-team", "reports", "g7-14-checkout-admission-disposable-20260809.json");
const image = "postgres:16-alpine";
const requiredSuites = [
  "src/lib/checkout-admission.db.test.ts",
  "src/lib/inventory-reservations.test.ts",
];
const requiredTests = [
  "binds one server-issued checkout identity to one durable reservation under concurrency",
  "allows only one concurrent checkout to reserve the final unit",
  "allows only one concurrent transaction for the same checkout idempotency key",
];

function run(command, args, env, cwd = root) {
  const child = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
    maxBuffer: 8 * 1024 * 1024,
  });
  return { exitCode: child.status ?? 1, stdout: child.stdout ?? "", stderr: child.stderr ?? "" };
}

function isolatedEnvironment(tempRoot) {
  return {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    ComSpec: process.env.ComSpec ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    TEMP: path.join(tempRoot, "tmp"),
    TMP: path.join(tempRoot, "tmp"),
    USERPROFILE: path.join(tempRoot, "profile"),
    DOCKER_CONFIG: path.join(tempRoot, "docker-config"),
    NODE_ENV: "test",
    CI: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    PRISMA_HIDE_UPDATE_MESSAGE: "true",
    NO_COLOR: "1",
  };
}

function waitForPostgres(containerId, env) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (run("docker", ["exec", containerId, "pg_isready", "-U", "postgres", "-d", "celebratedeal_test"], env).exitCode === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
  }
  return false;
}

function psql(containerId, sql, env, database = "celebratedeal_test") {
  return run("docker", ["exec", containerId, "psql", "-U", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-d", database, "-c", sql], env);
}

function parseVitest(filePath, exitCode) {
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const suites = Array.isArray(payload.testResults) ? payload.testResults : [];
  const assertions = suites.flatMap((suite) => Array.isArray(suite.assertionResults) ? suite.assertionResults : []);
  const titles = assertions.map((assertion) => String(assertion.title ?? assertion.fullName ?? ""));
  const statuses = assertions.map((assertion) => String(assertion.status ?? "").toLowerCase());
  const suiteNames = suites.map((suite) => String(suite.name ?? "").replaceAll("\\", "/"));
  const exactSuite = suites.length === requiredSuites.length
    && requiredSuites.every((required) => suiteNames.some((name) => name.endsWith(required)));
  const missing = requiredTests.filter((required) => !titles.some((title) => title.includes(required)));
  const failed = statuses.filter((status) => status === "failed").length;
  const skipped = statuses.filter((status) => ["pending", "skipped", "todo"].includes(status)).length;
  const passed = statuses.filter((status) => status === "passed").length;
  return {
    status: exitCode === 0 && exactSuite && missing.length === 0 && failed === 0 && skipped === 0 ? "PASS" : "BLOCKED_OR_FAILED",
    suites: suites.length,
    exactSuite,
    tests: { total: assertions.length, passed, failed, skipped },
    missing,
    failedTitles: assertions
      .filter((assertion) => String(assertion.status ?? "").toLowerCase() === "failed")
      .map((assertion) => String(assertion.title ?? assertion.fullName ?? "unnamed test").slice(0, 240)),
  };
}

function writeReceipt(receipt) {
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  fs.writeFileSync(receiptPath, serialized, "utf8");
  const digest = crypto.createHash("sha256").update(serialized).digest("hex").toUpperCase();
  fs.writeFileSync(`${receiptPath}.sha256`, `${digest}  ${path.basename(receiptPath)}\n`, "utf8");
}

function cleanup(containerId, expected, tempRoot, env, receipt) {
  if (!containerId) receipt.cleanup.container = "NOT_CREATED";
  else {
    const inspected = run("docker", [
      "inspect", "--format",
      "{{.Id}}\t{{.Name}}\t{{index .Config.Labels \"celebratedeal.run-id\"}}\t{{index .Config.Labels \"celebratedeal.marker\"}}\t{{range .Mounts}}{{.Type}}={{.Destination}}{{end}}",
      containerId,
    ], env);
    const fields = inspected.stdout.replace(/\r?\n$/u, "").split("\t");
    const databaseMarker = psql(containerId, "SELECT COALESCE(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = 'celebratedeal_test';", env, "postgres");
    const schemaMarker = psql(containerId, `SELECT COALESCE(obj_description(oid, 'pg_namespace'), '') FROM pg_namespace WHERE nspname = '${expected.schema}';`, env);
    const exactOwner = inspected.exitCode === 0
      && fields[0] === containerId
      && fields[1]?.replace(/^\//u, "") === expected.name
      && fields[2] === expected.runId
      && fields[3] === expected.marker
      && (fields[4] === "" || fields[4] === "tmpfs=/var/lib/postgresql/data")
      && databaseMarker.stdout.trim() === expected.marker
      && schemaMarker.stdout.trim() === expected.marker;
    if (!exactOwner) receipt.cleanup.container = "CLEANUP_BLOCKED";
    else {
      const removed = run("docker", ["rm", "-f", containerId], env);
      receipt.cleanup.container = removed.exitCode === 0 && run("docker", ["inspect", containerId], env).exitCode !== 0 ? "PASS" : "FAIL";
    }
  }

  const resolved = path.resolve(tempRoot);
  const markerPath = path.join(resolved, ".marker");
  const safeTemp = resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)
    && path.basename(resolved) === expected.name
    && fs.existsSync(markerPath)
    && fs.readFileSync(markerPath, "utf8") === expected.marker;
  if (!safeTemp) receipt.cleanup.tempRoot = "CLEANUP_BLOCKED";
  else {
    fs.rmSync(resolved, { recursive: true, force: true });
    receipt.cleanup.tempRoot = fs.existsSync(resolved) ? "FAIL" : "PASS";
  }
}

export async function main() {
  const runId = crypto.randomBytes(8).toString("hex");
  const name = `celebratedeal-g7-checkout-admission-${runId}`;
  const schema = `g7_14_${runId}`;
  const marker = `g7-checkout-admission:${runId}`;
  const tempRoot = path.join(os.tmpdir(), name);
  const expected = { runId, name, schema, marker };
  const migrations = listCanonicalMigrations();
  const receipt = {
    schemaVersion: "celebratedeal-g7-checkout-admission-disposable/v1",
    workPackage: "G7-14",
    runId,
    status: "BLOCKED_OR_FAILED",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    migrationCount: migrations.length,
    phases: { validate: "NOT_STARTED", deploy: "NOT_STARTED", status: "NOT_STARTED", migrationState: "NOT_STARTED", admissionReservationConcurrency: "NOT_STARTED" },
    testResult: { suites: 0, exactSuite: false, tests: { total: 0, passed: 0, failed: 0, skipped: 0 }, missing: requiredTests, failedTitles: [] },
    cleanup: { container: "NOT_STARTED", tempRoot: "NOT_STARTED" },
    safety: { sourceEnvContentsRead: false, loopbackOnly: true, noPersistentVolume: true, syntheticFixturesOnly: true, productionSideEffects: false, rawOutputPersisted: false },
    failure: null,
  };
  const env = isolatedEnvironment(tempRoot);
  let containerId = null;

  try {
    if (!/^celebratedeal-g7-checkout-admission-[a-f0-9]{16}$/u.test(name) || !/^g7_14_[a-f0-9]{16}$/u.test(schema) || migrations.length === 0) throw new Error("runner-contract-invalid");
    for (const directory of ["tmp", "profile", "docker-config"]) fs.mkdirSync(path.join(tempRoot, directory), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, ".marker"), marker, "utf8");
    if (run("docker", ["image", "inspect", image], env).exitCode !== 0) throw new Error("docker-image-unavailable");
    const created = run("docker", [
      "run", "-d", "--pull=never", "--name", name,
      "--label", `celebratedeal.run-id=${runId}`, "--label", `celebratedeal.marker=${marker}`,
      "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=celebratedeal_test",
      "--tmpfs", "/var/lib/postgresql/data", "-p", "127.0.0.1::5432", image,
    ], env);
    if (created.exitCode !== 0 || !/^[a-f0-9]{64}\s*$/iu.test(created.stdout)) throw new Error("container-create-failed");
    containerId = created.stdout.trim();
    if (!waitForPostgres(containerId, env)) throw new Error("database-unreachable");
    const port = /^127\.0\.0\.1:(\d+)\s*$/mu.exec(run("docker", ["port", containerId, "5432/tcp"], env).stdout)?.[1];
    if (!port) throw new Error("loopback-port-invalid");
    if (psql(containerId, `COMMENT ON DATABASE celebratedeal_test IS '${marker}';`, env, "postgres").exitCode !== 0) throw new Error("database-marker-failed");
    if (psql(containerId, `CREATE SCHEMA "${schema}"; COMMENT ON SCHEMA "${schema}" IS '${marker}';`, env).exitCode !== 0) throw new Error("schema-marker-failed");

    const databaseUrl = ["postgres", "ql://"].join("") + `postgres:postgres@127.0.0.1:${port}/celebratedeal_test?schema=${schema}`;
    const dbEnv = { ...env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, G7_CHECKOUT_ADMISSION_DISPOSABLE_SCHEMA: schema };
    const mirrorRoot = writeMirror(tempRoot, migrations);
    const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
    const prismaConfig = path.join(mirrorRoot, "prisma.config.mjs");
    const validate = run(process.execPath, [prismaCli, "validate", "--config", prismaConfig], dbEnv, mirrorRoot);
    receipt.phases.validate = validate.exitCode === 0 ? "PASS" : "FAIL";
    if (validate.exitCode !== 0) throw new Error("prisma-validate-failed");
    const deploy = run(process.execPath, [prismaCli, "migrate", "deploy", "--config", prismaConfig], dbEnv, mirrorRoot);
    receipt.phases.deploy = deploy.exitCode === 0 ? "PASS" : "FAIL";
    if (deploy.exitCode !== 0) throw new Error("prisma-deploy-failed");
    const status = run(process.execPath, [prismaCli, "migrate", "status", "--config", prismaConfig], dbEnv, mirrorRoot);
    receipt.phases.status = status.exitCode === 0 ? "PASS" : "FAIL";
    if (status.exitCode !== 0) throw new Error("prisma-status-failed");
    const migrationRows = psql(containerId, `SELECT COUNT(*)::text FROM "${schema}"._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;`, env);
    receipt.phases.migrationState = migrationRows.exitCode === 0 && Number(migrationRows.stdout.trim()) === migrations.length ? "PASS" : "FAIL";
    if (receipt.phases.migrationState !== "PASS") throw new Error("migration-state-mismatch");

    const outputPath = path.join(tempRoot, "vitest.json");
    const testRun = run(process.execPath, [
      path.join(root, "node_modules", "vitest", "vitest.mjs"), "run",
      "--config", path.join(root, "vitest.g7-checkout-admission-db.config.ts"),
      "--reporter=json", "--outputFile", outputPath,
    ], dbEnv);
    if (!fs.existsSync(outputPath)) throw new Error("vitest-json-missing");
    const parsed = parseVitest(outputPath, testRun.exitCode);
    receipt.testResult = { suites: parsed.suites, exactSuite: parsed.exactSuite, tests: parsed.tests, missing: parsed.missing, failedTitles: parsed.failedTitles };
    receipt.phases.admissionReservationConcurrency = parsed.status;
    if (parsed.status !== "PASS") throw new Error("admission-reservation-concurrency-failed");
    receipt.status = "PASS";
  } catch (error) {
    receipt.failure = error instanceof Error ? error.message : "runner-failed";
  } finally {
    cleanup(containerId, expected, tempRoot, env, receipt);
    if (receipt.status === "PASS" && (receipt.cleanup.container !== "PASS" || receipt.cleanup.tempRoot !== "PASS")) {
      receipt.status = "BLOCKED_OR_FAILED";
      receipt.failure = receipt.failure ?? "cleanup-invariant-failed";
    }
    receipt.finishedAt = new Date().toISOString();
    writeReceipt(receipt);
  }

  if (receipt.status !== "PASS") process.exitCode = 1;
  else process.stdout.write(`${JSON.stringify({ workPackage: receipt.workPackage, status: receipt.status, migrationCount: receipt.migrationCount, phases: receipt.phases, tests: receipt.testResult.tests, cleanup: receipt.cleanup })}\n`);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) await main();
