import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listCanonicalMigrations, writeMirror } from "./prisma-loopback-disposable-migration-runner.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const receiptPath = path.join(workspaceRoot, ".ai-team", "reports", "g7-01-finance-disposable-20260808.json");
const digestPath = `${receiptPath}.sha256`;
const image = "postgres:16-alpine";
const requiredTests = [
  "gives one reader the settlement and redirects the other safely to conflict",
  "creates exactly one merchant self-pay AffiliatePayout when two locks race",
  "persists a paid affiliate payout outcome reference in the tenant schema",
  "settles the vendor payout without marking the separate merchant affiliate payout paid",
  "rolls back a paid item when its settlement is not eligible for that payout batch",
];

function run(command, args, environment, cwd = workspaceRoot) {
  const child = spawnSync(command, args, {
    cwd,
    env: environment,
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
    CHECKPOINT_DISABLE: "1",
    PRISMA_HIDE_UPDATE_MESSAGE: "true",
    NO_COLOR: "1",
  };
}

function waitForPostgres(container, environment) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ready = run("docker", ["exec", container, "pg_isready", "-U", "postgres", "-d", "celebratedeal_test"], environment);
    if (ready.exitCode === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
  }
  return false;
}

function psql(container, sql, environment, database = "celebratedeal_test") {
  return run("docker", [
    "exec", container, "psql", "-U", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q",
    "-d", database, "-c", sql,
  ], environment);
}

function inspectContainer(container, environment) {
  return run("docker", [
    "inspect", "--format",
    "{{.Id}}\t{{.Name}}\t{{index .Config.Labels \"celebratedeal.run-id\"}}\t{{index .Config.Labels \"celebratedeal.marker\"}}\t{{range .Mounts}}{{.Type}}={{.Destination}}{{end}}",
    container,
  ], environment);
}

function parseInspection(value) {
  const fields = String(value).replace(/\r?\n$/, "").split("\t");
  if (fields.length !== 5) return null;
  const [id, name, runId, marker, mount] = fields;
  return { id, name: name.replace(/^\//, ""), runId, marker, mount };
}

function parseVitestResult(value, exitCode) {
  const payload = JSON.parse(value);
  const suites = Array.isArray(payload.testResults) ? payload.testResults : [];
  const assertions = suites.flatMap((suite) => Array.isArray(suite.assertionResults) ? suite.assertionResults : []);
  const titles = assertions.map((assertion) => String(assertion.title ?? assertion.fullName ?? assertion.ancestorTitles?.at(-1) ?? ""));
  const statuses = assertions.map((assertion) => String(assertion.status ?? "").toLowerCase());
  const missingTests = requiredTests.filter((required) => !titles.some((title) => title.includes(required)));
  const failed = statuses.filter((status) => status === "failed").length;
  const skipped = statuses.filter((status) => ["pending", "skipped", "todo"].includes(status)).length;
  const passed = statuses.filter((status) => status === "passed").length;
  const exactSuite = suites.length === 1 && String(suites[0]?.name ?? "").replaceAll("\\", "/").endsWith("src/app/actions.payout-db.test.ts");
  return {
    status: exitCode === 0 && exactSuite && assertions.length >= requiredTests.length && missingTests.length === 0 && failed === 0 && skipped === 0
      ? "PASS"
      : "BLOCKED_OR_FAILED",
    suites: suites.length,
    exactSuite,
    tests: { total: assertions.length, passed, failed, skipped },
    missingTests,
  };
}

function migrationRows(container, schema, environment, expected) {
  const rows = psql(
    container,
    `SELECT migration_name, (finished_at IS NOT NULL)::text, (rolled_back_at IS NULL)::text FROM "${schema}"._prisma_migrations ORDER BY migration_name;`,
    environment,
  );
  if (rows.exitCode !== 0) return false;
  const parsed = rows.stdout.trim() === "" ? [] : rows.stdout.trim().split(/\r?\n/).map((row) => row.split("|"));
  return parsed.length === expected.length
    && parsed.every(([name, finished, active], index) => name === expected[index] && finished === "true" && active === "true");
}

function cleanup(container, tempRoot, expected, environment, receipt) {
  if (!container) {
    receipt.cleanup.container = "NOT_CREATED";
  } else {
    const inspected = inspectContainer(container.id, environment);
    const actual = inspected.exitCode === 0 ? parseInspection(inspected.stdout) : null;
    const ephemeralMount = actual?.mount === "" || actual?.mount === "tmpfs=/var/lib/postgresql/data";
    const databaseMarker = actual ? psql(container.id, "SELECT COALESCE(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = 'celebratedeal_test';", environment, "postgres") : null;
    const schemaMarker = actual ? psql(container.id, `SELECT COALESCE(obj_description(oid, 'pg_namespace'), '') FROM pg_namespace WHERE nspname = '${expected.schema}';`, environment) : null;
    const exactOwner = actual
      && actual.id === container.id
      && actual.name === expected.name
      && actual.runId === expected.runId
      && actual.marker === expected.marker
      && ephemeralMount
      && databaseMarker?.exitCode === 0
      && databaseMarker.stdout.trim() === expected.marker
      && schemaMarker?.exitCode === 0
      && schemaMarker.stdout.trim() === expected.marker;
    if (!exactOwner) {
      receipt.cleanup.container = "CLEANUP_BLOCKED";
    } else {
      const removed = run("docker", ["rm", "-f", container.id], environment);
      const absent = run("docker", ["inspect", container.id], environment);
      receipt.cleanup.container = removed.exitCode === 0 && absent.exitCode !== 0 ? "PASS" : "FAIL";
    }
  }

  const resolved = path.resolve(tempRoot);
  const markerPath = path.join(resolved, ".marker");
  const safeTemp = resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)
    && path.basename(resolved) === expected.name
    && fs.existsSync(markerPath)
    && fs.readFileSync(markerPath, "utf8") === expected.marker;
  if (!safeTemp) {
    receipt.cleanup.tempRoot = "CLEANUP_BLOCKED";
  } else {
    fs.rmSync(resolved, { recursive: true, force: true });
    receipt.cleanup.tempRoot = fs.existsSync(resolved) ? "FAIL" : "PASS";
  }
}

function writeReceipt(receipt) {
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  fs.writeFileSync(receiptPath, serialized, "utf8");
  const digest = crypto.createHash("sha256").update(serialized).digest("hex").toUpperCase();
  fs.writeFileSync(digestPath, `${digest}  ${path.basename(receiptPath)}\n`, "utf8");
}

export async function main() {
  const runId = crypto.randomBytes(8).toString("hex");
  const name = `celebratedeal-g7-finance-${runId}`;
  const schema = `wp18_g7_${runId}`;
  const marker = `g7-finance:${runId}`;
  const tempRoot = path.join(os.tmpdir(), name);
  const expected = { runId, name, schema, marker };
  const migrations = listCanonicalMigrations();
  const receipt = {
    schemaVersion: "celebratedeal-g7-finance-disposable/v1",
    workPackage: "G7-01",
    runId,
    status: "BLOCKED_OR_FAILED",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    migrationCount: migrations.length,
    phases: { validate: "NOT_STARTED", deploy: "NOT_STARTED", status: "NOT_STARTED", payoutIntegration: "NOT_STARTED" },
    testResult: { suites: 0, exactSuite: false, tests: { total: 0, passed: 0, failed: 0, skipped: 0 }, missingTests: requiredTests },
    cleanup: { container: "NOT_STARTED", tempRoot: "NOT_STARTED" },
    safety: { sourceEnvContentsRead: false, loopbackOnly: true, noPersistentVolume: true, syntheticFixturesOnly: true, productionSideEffects: false, rawOutputPersisted: false },
    failure: null,
  };
  const environment = isolatedEnvironment(tempRoot);
  let container = null;

  try {
    if (!/^celebratedeal-g7-finance-[a-f0-9]{16}$/.test(name) || !/^wp18_g7_[a-f0-9]{16}$/.test(schema) || migrations.length === 0) {
      throw new Error("runner-contract-invalid");
    }
    fs.mkdirSync(path.join(tempRoot, "tmp"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "profile"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "docker-config"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, ".marker"), marker, "utf8");
    if (run("docker", ["image", "inspect", image], environment).exitCode !== 0) throw new Error("docker-image-unavailable");

    const created = run("docker", [
      "run", "-d", "--pull=never", "--name", name,
      "--label", `celebratedeal.run-id=${runId}`, "--label", `celebratedeal.marker=${marker}`,
      "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=celebratedeal_test",
      "--tmpfs", "/var/lib/postgresql/data", "-p", "127.0.0.1::5432", image,
    ], environment);
    if (created.exitCode !== 0 || !/^[a-f0-9]{64}\s*$/i.test(created.stdout)) throw new Error("container-create-failed");
    container = { id: created.stdout.trim() };
    if (!waitForPostgres(container.id, environment)) throw new Error("database-unreachable");
    const portResult = run("docker", ["port", container.id, "5432/tcp"], environment);
    const port = /^127\.0\.0\.1:(\d+)\s*$/m.exec(portResult.stdout)?.[1];
    if (!port) throw new Error("loopback-port-invalid");

    const databaseComment = psql(container.id, `COMMENT ON DATABASE celebratedeal_test IS '${marker}';`, environment, "postgres");
    const schemaCreate = psql(container.id, `CREATE SCHEMA "${schema}"; COMMENT ON SCHEMA "${schema}" IS '${marker}';`, environment);
    if (databaseComment.exitCode !== 0 || schemaCreate.exitCode !== 0) throw new Error("marker-write-failed");

    const databaseUrl = ["postgres", "ql://"].join("") + `postgres:postgres@127.0.0.1:${port}/celebratedeal_test?schema=${schema}`;
    const databaseEnvironment = {
      ...environment,
      DATABASE_URL: databaseUrl,
      DIRECT_URL: databaseUrl,
      WP18_DISPOSABLE_SCHEMA: schema,
    };
    const mirrorRoot = writeMirror(tempRoot, migrations);
    const prismaCli = path.join(workspaceRoot, "node_modules", "prisma", "build", "index.js");
    for (const [phase, args] of [["validate", ["validate"]], ["deploy", ["migrate", "deploy"]], ["status", ["migrate", "status"]]]) {
      const result = run(process.execPath, [prismaCli, ...args, "--config", path.join(mirrorRoot, "prisma.config.mjs")], databaseEnvironment, mirrorRoot);
      receipt.phases[phase] = result.exitCode === 0 ? "PASS" : "FAIL";
      if (result.exitCode !== 0) throw new Error(`prisma-${phase}-failed`);
    }
    if (!migrationRows(container.id, schema, environment, migrations)) throw new Error("migration-state-mismatch");

    const outputPath = path.join(tempRoot, "vitest.json");
    const vitestCli = path.join(workspaceRoot, "node_modules", "vitest", "vitest.mjs");
    const testRun = run(process.execPath, [
      vitestCli, "run", "--config", path.join(workspaceRoot, "vitest.g7-finance-db.config.ts"),
      "--reporter=json", "--outputFile", outputPath,
    ], databaseEnvironment);
    if (!fs.existsSync(outputPath)) throw new Error("vitest-json-missing");
    const parsed = parseVitestResult(fs.readFileSync(outputPath, "utf8"), testRun.exitCode);
    receipt.testResult = { suites: parsed.suites, exactSuite: parsed.exactSuite, tests: parsed.tests, missingTests: parsed.missingTests };
    receipt.phases.payoutIntegration = parsed.status;
    if (parsed.status !== "PASS") throw new Error("payout-integration-failed");
    receipt.status = "PASS";
  } catch (error) {
    receipt.failure = error instanceof Error ? error.message : "runner-failed";
  } finally {
    cleanup(container, tempRoot, expected, environment, receipt);
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
