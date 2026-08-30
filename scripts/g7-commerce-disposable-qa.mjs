import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listCanonicalMigrations, writeMirror } from "./prisma-loopback-disposable-migration-runner.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const receiptPath = path.join(root, ".ai-team", "reports", "g7-04-commerce-disposable-20260808.json");
const image = "postgres:16-alpine";
const requiredTests = [
  "atomically persists payment, inventory, encrypted order snapshot and the correct fulfillment",
  "rolls back stock and payment when canonical order creation fails",
  "converges a verified payment to a granted digital entitlement exactly once",
  "reconciles partial and full refunds and cancels unfulfilled physical delivery",
  "enforces refund totals and fulfillment type invariants in PostgreSQL",
  "allows only one concurrent checkout to reserve the final unit",
  "never persists provider callback metadata or lets it replace checkout-owned identity",
  "retains a canonical commerce checkout key after payment for safe browser retries",
  "revokes a fully refunded digital entitlement and destroys its access capability",
  "keeps consecutive partial refunds on one PayUni trade independently idempotent",
  "deduplicates resent partial-refund ledger entries while accumulating distinct refunds",
];
const requiredSuites = [
  "src/lib/commerce-orders.db.test.ts",
  "src/lib/inventory-reservations.test.ts",
  "src/lib/payment-webhooks.test.ts",
  "src/lib/payuni-refund-reconciliation.test.ts",
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

function inspectContainer(containerId, env) {
  return run("docker", [
    "inspect", "--format",
    "{{.Id}}\t{{.Name}}\t{{index .Config.Labels \"celebratedeal.run-id\"}}\t{{index .Config.Labels \"celebratedeal.marker\"}}\t{{range .Mounts}}{{.Type}}={{.Destination}}{{end}}",
    containerId,
  ], env);
}

function parseInspection(value) {
  const fields = String(value).replace(/\r?\n$/u, "").split("\t");
  if (fields.length !== 5) return null;
  return { id: fields[0], name: fields[1].replace(/^\//u, ""), runId: fields[2], marker: fields[3], mount: fields[4] };
}

function parseVitest(filePath, exitCode) {
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const suites = Array.isArray(payload.testResults) ? payload.testResults : [];
  const assertions = suites.flatMap((suite) => Array.isArray(suite.assertionResults) ? suite.assertionResults : []);
  const titles = assertions.map((assertion) => String(assertion.title ?? assertion.fullName ?? ""));
  const statuses = assertions.map((assertion) => String(assertion.status ?? "").toLowerCase());
  const missing = requiredTests.filter((title) => !titles.some((actual) => actual.includes(title)));
  const failed = statuses.filter((status) => status === "failed").length;
  const skipped = statuses.filter((status) => ["pending", "skipped", "todo"].includes(status)).length;
  const passed = statuses.filter((status) => status === "passed").length;
  const suiteNames = suites.map((suite) => String(suite.name ?? "").replaceAll("\\", "/"));
  const exactSuite = suites.length === requiredSuites.length
    && requiredSuites.every((required) => suiteNames.some((name) => name.endsWith(required)));
  return {
    status: exitCode === 0 && exactSuite && assertions.length >= requiredTests.length && missing.length === 0 && failed === 0 && skipped === 0 ? "PASS" : "BLOCKED_OR_FAILED",
    suites: suites.length,
    exactSuite,
    tests: { total: assertions.length, passed, failed, skipped },
    missing,
    failedTitles: assertions
      .filter((assertion) => String(assertion.status ?? "").toLowerCase() === "failed")
      .map((assertion) => String(assertion.title ?? assertion.fullName ?? "unnamed test").slice(0, 240)),
  };
}

function migrationRows(containerId, schema, env, expected) {
  const result = psql(containerId, `SELECT migration_name, (finished_at IS NOT NULL)::text, (rolled_back_at IS NULL)::text FROM "${schema}"._prisma_migrations ORDER BY migration_name;`, env);
  if (result.exitCode !== 0) return false;
  const rows = result.stdout.trim() ? result.stdout.trim().split(/\r?\n/u).map((row) => row.split("|")) : [];
  return rows.length === expected.length && rows.every(([name, finished, active], index) => name === expected[index] && finished === "true" && active === "true");
}

function seedHistoricalProductRows(containerId, schema, env) {
  const result = psql(containerId, `
    INSERT INTO "${schema}"."Vendor" ("id", "name", "slug", "email", "passwordHash", "updatedAt")
    VALUES ('g7-backfill-vendor', 'Synthetic Backfill Vendor', 'g7-backfill-vendor', 'g7-backfill@example.test', 'synthetic', CURRENT_TIMESTAMP);
    INSERT INTO "${schema}"."Product" ("id", "vendorId", "name", "slug", "priceCents", "commerceDomain", "updatedAt")
    VALUES
      ('g7-old-merchant', 'g7-backfill-vendor', 'Synthetic Merchant', 'g7-old-merchant', 1200, 'merchant', CURRENT_TIMESTAMP),
      ('g7-old-course', 'g7-backfill-vendor', 'Synthetic Course', 'g7-old-course', 1200, 'course', CURRENT_TIMESTAMP);
  `, env);
  return result.exitCode === 0;
}

function verifyProductBackfill(containerId, schema, env) {
  const inserted = psql(containerId, `
    INSERT INTO "${schema}"."Product" ("id", "vendorId", "name", "slug", "priceCents", "commerceDomain", "updatedAt")
    VALUES ('g7-new-merchant', 'g7-backfill-vendor', 'Synthetic New Merchant', 'g7-new-merchant', 1200, 'merchant', CURRENT_TIMESTAMP);
  `, env);
  if (inserted.exitCode !== 0) return false;
  const result = psql(containerId, `
    SELECT "id", "fulfillmentType"::text, "fulfillmentTypeConfirmed"::text
    FROM "${schema}"."Product"
    WHERE "id" IN ('g7-old-merchant', 'g7-old-course', 'g7-new-merchant')
    ORDER BY "id";
  `, env);
  if (result.exitCode !== 0) return false;
  const actual = new Map(result.stdout.trim().split(/\r?\n/u).map((row) => {
    const [id, fulfillmentType, confirmed] = row.split("|");
    return [id, `${fulfillmentType}|${confirmed}`];
  }));
  return actual.get("g7-old-merchant") === "physical|false"
    && actual.get("g7-old-course") === "course|true"
    && actual.get("g7-new-merchant") === "physical|true";
}

function writeReceipt(receipt) {
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  fs.writeFileSync(receiptPath, serialized, "utf8");
  const digest = crypto.createHash("sha256").update(serialized).digest("hex").toUpperCase();
  fs.writeFileSync(`${receiptPath}.sha256`, `${digest}  ${path.basename(receiptPath)}\n`, "utf8");
}

function cleanup(container, tempRoot, expected, env, receipt) {
  if (!container) {
    receipt.cleanup.container = "NOT_CREATED";
  } else {
    const inspected = inspectContainer(container.id, env);
    const actual = inspected.exitCode === 0 ? parseInspection(inspected.stdout) : null;
    const databaseMarker = actual ? psql(container.id, "SELECT COALESCE(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = 'celebratedeal_test';", env, "postgres") : null;
    const schemaMarker = actual ? psql(container.id, `SELECT COALESCE(obj_description(oid, 'pg_namespace'), '') FROM pg_namespace WHERE nspname = '${expected.schema}';`, env) : null;
    const exactOwner = actual
      && actual.id === container.id
      && actual.name === expected.name
      && actual.runId === expected.runId
      && actual.marker === expected.marker
      && (actual.mount === "" || actual.mount === "tmpfs=/var/lib/postgresql/data")
      && databaseMarker?.stdout.trim() === expected.marker
      && schemaMarker?.stdout.trim() === expected.marker;
    if (!exactOwner) receipt.cleanup.container = "CLEANUP_BLOCKED";
    else {
      const removed = run("docker", ["rm", "-f", container.id], env);
      const absent = run("docker", ["inspect", container.id], env);
      receipt.cleanup.container = removed.exitCode === 0 && absent.exitCode !== 0 ? "PASS" : "FAIL";
    }
  }

  const resolved = path.resolve(tempRoot);
  const markerPath = path.join(resolved, ".marker");
  const safe = resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)
    && path.basename(resolved) === expected.name
    && fs.existsSync(markerPath)
    && fs.readFileSync(markerPath, "utf8") === expected.marker;
  if (!safe) receipt.cleanup.tempRoot = "CLEANUP_BLOCKED";
  else {
    fs.rmSync(resolved, { recursive: true, force: true });
    receipt.cleanup.tempRoot = fs.existsSync(resolved) ? "FAIL" : "PASS";
  }
}

export async function main() {
  const runId = crypto.randomBytes(8).toString("hex");
  const name = `celebratedeal-g7-commerce-${runId}`;
  const schema = `g7_04_${runId}`;
  const marker = `g7-commerce:${runId}`;
  const tempRoot = path.join(os.tmpdir(), name);
  const expected = { runId, name, schema, marker };
  const migrations = listCanonicalMigrations();
  const receipt = {
    schemaVersion: "celebratedeal-g7-commerce-disposable/v1",
    workPackage: "G7-04",
    runId,
    status: "BLOCKED_OR_FAILED",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    migrationCount: migrations.length,
    phases: { validate: "NOT_STARTED", deploy: "NOT_STARTED", status: "NOT_STARTED", productBackfill: "NOT_STARTED", commerceIntegration: "NOT_STARTED" },
    testResult: { suites: 0, exactSuite: false, tests: { total: 0, passed: 0, failed: 0, skipped: 0 }, missing: requiredTests, failedTitles: [] },
    cleanup: { container: "NOT_STARTED", tempRoot: "NOT_STARTED" },
    safety: { sourceEnvContentsRead: false, loopbackOnly: true, noPersistentVolume: true, syntheticFixturesOnly: true, productionSideEffects: false, rawOutputPersisted: false },
    failure: null,
  };
  const env = isolatedEnvironment(tempRoot);
  let container = null;

  try {
    if (!/^celebratedeal-g7-commerce-[a-f0-9]{16}$/u.test(name) || !/^g7_04_[a-f0-9]{16}$/u.test(schema) || migrations.length === 0) throw new Error("runner-contract-invalid");
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
    container = { id: created.stdout.trim() };
    if (!waitForPostgres(container.id, env)) throw new Error("database-unreachable");
    const portResult = run("docker", ["port", container.id, "5432/tcp"], env);
    const port = /^127\.0\.0\.1:(\d+)\s*$/mu.exec(portResult.stdout)?.[1];
    if (!port) throw new Error("loopback-port-invalid");
    if (psql(container.id, `COMMENT ON DATABASE celebratedeal_test IS '${marker}';`, env, "postgres").exitCode !== 0) throw new Error("database-marker-failed");
    if (psql(container.id, `CREATE SCHEMA "${schema}"; COMMENT ON SCHEMA "${schema}" IS '${marker}';`, env).exitCode !== 0) throw new Error("schema-marker-failed");

    const databaseUrl = ["postgres", "ql://"].join("") + `postgres:postgres@127.0.0.1:${port}/celebratedeal_test?schema=${schema}`;
    const dbEnv = { ...env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, G7_COMMERCE_DISPOSABLE_SCHEMA: schema };
    const commerceMigration = "20260808110000_g7_04_commerce_orders";
    if (migrations.at(-1) !== commerceMigration) throw new Error("commerce-migration-order-invalid");
    let mirrorRoot = writeMirror(tempRoot, migrations.slice(0, -1));
    const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
    const validate = run(process.execPath, [prismaCli, "validate", "--config", path.join(mirrorRoot, "prisma.config.mjs")], dbEnv, mirrorRoot);
    receipt.phases.validate = validate.exitCode === 0 ? "PASS" : "FAIL";
    if (validate.exitCode !== 0) throw new Error("prisma-validate-failed");
    const preDeploy = run(process.execPath, [prismaCli, "migrate", "deploy", "--config", path.join(mirrorRoot, "prisma.config.mjs")], dbEnv, mirrorRoot);
    if (preDeploy.exitCode !== 0 || !seedHistoricalProductRows(container.id, schema, env)) {
      receipt.phases.deploy = "FAIL";
      throw new Error("prisma-pre-commerce-deploy-failed");
    }
    mirrorRoot = writeMirror(tempRoot, migrations);
    const deploy = run(process.execPath, [prismaCli, "migrate", "deploy", "--config", path.join(mirrorRoot, "prisma.config.mjs")], dbEnv, mirrorRoot);
    receipt.phases.deploy = deploy.exitCode === 0 ? "PASS" : "FAIL";
    if (deploy.exitCode !== 0) throw new Error("prisma-deploy-failed");
    const status = run(process.execPath, [prismaCli, "migrate", "status", "--config", path.join(mirrorRoot, "prisma.config.mjs")], dbEnv, mirrorRoot);
    receipt.phases.status = status.exitCode === 0 ? "PASS" : "FAIL";
    if (status.exitCode !== 0) throw new Error("prisma-status-failed");
    if (!migrationRows(container.id, schema, env, migrations)) throw new Error("migration-state-mismatch");
    receipt.phases.productBackfill = verifyProductBackfill(container.id, schema, env) ? "PASS" : "FAIL";
    if (receipt.phases.productBackfill !== "PASS") throw new Error("product-backfill-contract-failed");

    const outputPath = path.join(tempRoot, "vitest.json");
    const testRun = run(process.execPath, [
      path.join(root, "node_modules", "vitest", "vitest.mjs"), "run",
      "--config", path.join(root, "vitest.g7-commerce-db.config.ts"),
      "--reporter=json", "--outputFile", outputPath,
    ], dbEnv);
    if (!fs.existsSync(outputPath)) throw new Error("vitest-json-missing");
    const parsed = parseVitest(outputPath, testRun.exitCode);
    receipt.testResult = { suites: parsed.suites, exactSuite: parsed.exactSuite, tests: parsed.tests, missing: parsed.missing, failedTitles: parsed.failedTitles };
    receipt.phases.commerceIntegration = parsed.status;
    if (parsed.status !== "PASS") throw new Error("commerce-integration-failed");
    receipt.status = "PASS";
  } catch (error) {
    receipt.failure = error instanceof Error ? error.message : "runner-failed";
  } finally {
    cleanup(container, tempRoot, expected, env, receipt);
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
