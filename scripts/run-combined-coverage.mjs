import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseTypeScript } from "@babel/parser";
import { mergeProcessCovs } from "@bcoe/v8-coverage";
import astV8ToIstanbul from "ast-v8-to-istanbul";
import libCoverage from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";
import { parseAstAsync } from "vitest/node";

import { listCanonicalMigrations, writeMirror } from "./prisma-loopback-disposable-migration-runner.mjs";

const workspaceRoot = process.cwd();
const reportsDirectory = path.join(workspaceRoot, "coverage");
const nodeTapCoverageDirectory = path.join(reportsDirectory, "node-tap-v8");
const coverageFinalPath = path.join(reportsDirectory, "coverage-final.json");
const coverageThresholds = { statements: 63, branches: 57, functions: 60, lines: 65 };
const libThresholds = { statements: 86, branches: 80, functions: 88, lines: 88 };
const dockerImage = "postgres:16-alpine";
const coverageRunNamePattern = /^celebratedeal-combined-coverage-[a-f0-9]{16}$/;

function run(command, args, environment) {
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    env: environment,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed with exit code ${result.status ?? 1}: ${path.basename(command)}`);
}

function capture(command, args, environment, cwd = workspaceRoot) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
}

export function selectedCoverageEnvironment(tempRoot, additions = {}) {
  return {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    WINDIR: process.env.WINDIR ?? "",
    ComSpec: process.env.ComSpec ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    TEMP: path.join(tempRoot, "tmp"),
    TMP: path.join(tempRoot, "tmp"),
    DOCKER_CONFIG: path.join(tempRoot, "docker-config"),
    NODE_ENV: "test",
    CI: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    PRISMA_HIDE_UPDATE_MESSAGE: "true",
    NO_COLOR: "1",
    PAYMENT_PROVIDER: "demo",
    E2E_TEST_MODE: "true",
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:31023",
    JOB_SECRET: "combined-coverage-synthetic-job-secret",
    CSRF_SECRET: "combined-coverage-synthetic-csrf-secret",
    RATE_LIMIT_PROVIDER: "memory",
    RESEND_API_KEY: "",
    EMAIL_FROM: "",
    ...additions,
  };
}

export function parseCoverageContainerInspection(value) {
  const fields = String(value).replace(/\r?\n$/, "").split("\t");
  if (fields.length !== 5) return null;
  const [id, name, runId, marker, mount] = fields;
  return { id, name: name.replace(/^\//, ""), runId, marker, mount };
}

function inspectContainer(containerId, environment) {
  const inspected = capture("docker", [
    "inspect",
    "--format",
    "{{.Id}}\t{{.Name}}\t{{index .Config.Labels \"celebratedeal.run-id\"}}\t{{index .Config.Labels \"celebratedeal.marker\"}}\t{{range .Mounts}}{{.Type}}={{.Destination}}{{end}}",
    containerId,
  ], environment);
  return inspected.exitCode === 0 ? parseCoverageContainerInspection(inspected.stdout) : null;
}

export function isOwnedCoverageContainer(inspection, expected) {
  return Boolean(
    inspection
    && inspection.id === expected.id
    && inspection.name === expected.name
    && inspection.runId === expected.runId
    && inspection.marker === expected.marker
    && (inspection.mount === "" || inspection.mount === "tmpfs=/var/lib/postgresql/data"),
  );
}

function dockerPort(containerId, environment) {
  const response = capture("docker", ["port", containerId, "5432/tcp"], environment);
  const match = response.exitCode === 0 ? /^127\.0\.0\.1:(\d+)\s*$/m.exec(response.stdout) : null;
  return match ? Number(match[1]) : null;
}

function waitForPostgres(containerId, environment) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ready = capture("docker", ["exec", containerId, "pg_isready", "-U", "postgres", "-d", "celebratedeal_test"], environment);
    if (ready.exitCode === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  return false;
}

function psql(containerId, sql, environment, database = "celebratedeal_test") {
  return capture("docker", [
    "exec", containerId, "psql", "-U", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q",
    "-d", database, "-c", sql,
  ], environment);
}

async function createDisposableDatabase() {
  const runId = crypto.randomBytes(8).toString("hex");
  const name = `celebratedeal-combined-coverage-${runId}`;
  const marker = `combined-coverage:${runId}`;
  const tempRoot = path.join(os.tmpdir(), name);
  if (!coverageRunNamePattern.test(name)) throw new Error("Disposable coverage runner name contract failed.");

  await fs.mkdir(path.join(tempRoot, "tmp"), { recursive: true });
  await fs.mkdir(path.join(tempRoot, "docker-config"), { recursive: true });
  await fs.writeFile(path.join(tempRoot, ".marker"), marker, "utf8");
  const baseEnvironment = selectedCoverageEnvironment(tempRoot);
  if (capture("docker", ["image", "inspect", dockerImage], baseEnvironment).exitCode !== 0) {
    await cleanupDisposableDatabase({ id: null, name, runId, marker, tempRoot, environment: baseEnvironment });
    throw new Error(`Required local image is unavailable: ${dockerImage}`);
  }

  const created = capture("docker", [
    "run", "-d", "--pull=never", "--name", name,
    "--label", `celebratedeal.run-id=${runId}`,
    "--label", `celebratedeal.marker=${marker}`,
    "-e", "POSTGRES_USER=postgres",
    "-e", "POSTGRES_PASSWORD=postgres",
    "-e", "POSTGRES_DB=celebratedeal_test",
    "--tmpfs", "/var/lib/postgresql/data",
    "-p", "127.0.0.1::5432",
    dockerImage,
  ], baseEnvironment);
  if (created.exitCode !== 0 || !/^[a-f0-9]{64}\s*$/i.test(created.stdout)) {
    await cleanupDisposableDatabase({ id: null, name, runId, marker, tempRoot, environment: baseEnvironment });
    throw new Error("Disposable PostgreSQL container could not be created.");
  }

  const id = created.stdout.trim();
  const disposable = { id, name, runId, marker, tempRoot, environment: baseEnvironment };
  try {
    if (!waitForPostgres(id, baseEnvironment)) throw new Error("Disposable PostgreSQL did not become ready.");
    const port = dockerPort(id, baseEnvironment);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Disposable PostgreSQL loopback port is invalid.");
    const databaseMarker = psql(id, `COMMENT ON DATABASE celebratedeal_test IS '${marker}';`, baseEnvironment, "postgres");
    const schemaMarker = psql(id, `COMMENT ON SCHEMA public IS '${marker}';`, baseEnvironment);
    if (databaseMarker.exitCode !== 0 || schemaMarker.exitCode !== 0) throw new Error("Disposable PostgreSQL ownership marker could not be written.");

    const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/celebratedeal_test?schema=public`;
    const migrations = listCanonicalMigrations();
    if (migrations.length === 0) throw new Error("Canonical migration inventory is empty.");
    const mirrorRoot = writeMirror(tempRoot, migrations);
    const environment = selectedCoverageEnvironment(tempRoot, { DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl });
    const prismaCli = path.join(workspaceRoot, "node_modules", "prisma", "build", "index.js");
    if (!existsSync(prismaCli)) throw new Error("Prisma CLI is unavailable.");
    for (const args of [["validate"], ["migrate", "deploy"], ["migrate", "status"]]) {
      const response = capture(process.execPath, [prismaCli, ...args, "--config", path.join(mirrorRoot, "prisma.config.mjs")], environment, mirrorRoot);
      if (response.error || response.exitCode !== 0) throw new Error(`Prisma ${args.join(" ")} failed for the disposable coverage database.`);
    }
    return { ...disposable, environment, migrationCount: migrations.length };
  } catch (error) {
    await cleanupDisposableDatabase(disposable);
    throw error;
  }
}

async function cleanupDisposableDatabase(disposable) {
  let containerCleanup = disposable.id ? "BLOCKED" : "NOT_CREATED";
  if (disposable.id) {
    const inspection = inspectContainer(disposable.id, disposable.environment);
    const databaseMarker = inspection && isOwnedCoverageContainer(inspection, disposable)
      ? psql(disposable.id, "SELECT COALESCE(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = 'celebratedeal_test'", disposable.environment)
      : null;
    const schemaMarker = inspection && isOwnedCoverageContainer(inspection, disposable)
      ? psql(disposable.id, "SELECT COALESCE(obj_description(oid, 'pg_namespace'), '') FROM pg_namespace WHERE nspname = 'public'", disposable.environment)
      : null;
    const ownsContainer = isOwnedCoverageContainer(inspection, disposable)
      && databaseMarker?.exitCode === 0
      && schemaMarker?.exitCode === 0
      && databaseMarker.stdout.trim() === disposable.marker
      && schemaMarker.stdout.trim() === disposable.marker;
    if (ownsContainer) {
      const removed = capture("docker", ["rm", "-f", disposable.id], disposable.environment);
      const verified = capture("docker", ["inspect", disposable.id], disposable.environment);
      containerCleanup = removed.exitCode === 0 && verified.exitCode !== 0 ? "PASS" : "FAIL";
    }
  }

  const resolvedTempRoot = path.resolve(disposable.tempRoot);
  const tempBase = path.resolve(os.tmpdir());
  const markerPath = path.join(resolvedTempRoot, ".marker");
  const markerMatches = resolvedTempRoot.startsWith(`${tempBase}${path.sep}`)
    && coverageRunNamePattern.test(path.basename(resolvedTempRoot))
    && existsSync(markerPath)
    && await fs.readFile(markerPath, "utf8") === disposable.marker;
  let tempCleanup = "BLOCKED";
  if (markerMatches) {
    await fs.rm(resolvedTempRoot, { recursive: true, force: true });
    tempCleanup = existsSync(resolvedTempRoot) ? "FAIL" : "PASS";
  }
  return { container: containerCleanup, tempRoot: tempCleanup };
}

export function isProductionScriptCoverage(result, root = workspaceRoot) {
  if (!result.url.startsWith("file:")) return false;
  const filename = fileURLToPath(result.url.split("?")[0]);
  const relativePath = path.relative(root, filename).split(path.sep).join("/");
  return relativePath.startsWith("scripts/")
    && /\.(?:mjs|ts)$/.test(relativePath)
    && !relativePath.endsWith(".test.mjs")
    && !relativePath.endsWith(".test.ts");
}

async function collectNodeTapCoverage() {
  const coverageFiles = await fs.readdir(nodeTapCoverageDirectory);
  let merged = { result: [] };
  for (const filename of coverageFiles) {
    const raw = JSON.parse(await fs.readFile(path.join(nodeTapCoverageDirectory, filename), "utf8"));
    merged = mergeProcessCovs([merged, raw]);
  }

  const coverageMap = libCoverage.createCoverageMap({});
  const nodeTapScripts = merged.result.filter((result) => isProductionScriptCoverage(result, workspaceRoot));
  if (nodeTapScripts.length === 0) throw new Error("Node TAP did not produce coverage for any production scripts.");

  for (const script of nodeTapScripts) {
    const url = script.url.split("?")[0];
    const filename = fileURLToPath(url);
    const source = await fs.readFile(filename, "utf8");
    const ast = filename.endsWith(".ts")
      ? parseTypeScript(source, { sourceType: "unambiguous", plugins: ["typescript"] }).program
      : await parseAstAsync(source);
    const converted = await astV8ToIstanbul({ code: source, ast, coverage: { functions: script.functions, url } });
    coverageMap.merge(converted);
  }
  return coverageMap;
}

function percentage(summary, metric) {
  return summary.data[metric].pct;
}

function enforceThresholds(coverageMap) {
  const checks = [
    { label: "global", thresholds: coverageThresholds, files: coverageMap.files() },
    { label: "src/lib/**.ts", thresholds: libThresholds, files: coverageMap.files().filter((filename) => filename.replace(/\\/g, "/").includes("/src/lib/") && filename.endsWith(".ts")) },
  ];
  const failures = [];
  for (const check of checks) {
    const map = libCoverage.createCoverageMap({});
    for (const filename of check.files) map.addFileCoverage(coverageMap.fileCoverageFor(filename));
    const summary = map.getCoverageSummary();
    for (const [metric, threshold] of Object.entries(check.thresholds)) {
      const actual = percentage(summary, metric);
      if (actual < threshold) failures.push(`${check.label} ${metric}: ${actual}% < ${threshold}%`);
    }
  }
  if (failures.length > 0) throw new Error(`Coverage threshold failure: ${failures.join("; ")}`);
}

async function main() {
  const disposable = await createDisposableDatabase();
  let taskError = null;
  try {
    await fs.rm(nodeTapCoverageDirectory, { recursive: true, force: true });
    await fs.mkdir(nodeTapCoverageDirectory, { recursive: true });
    // Vitest transforms its own modules; thresholds are enforced after the map
    // is merged with Node TAP's V8 coverage below.
    const vitestCli = path.join(workspaceRoot, "node_modules", "vitest", "vitest.mjs");
    run(process.execPath, [vitestCli, "run", "--coverage"], {
      ...disposable.environment,
      COMBINED_COVERAGE_COLLECTION: "true",
    });
    run(process.execPath, ["--import", "tsx", "scripts/run-node-tap-contracts.ts"], {
      ...disposable.environment,
      NODE_V8_COVERAGE: nodeTapCoverageDirectory,
    });
    if (!existsSync(coverageFinalPath)) throw new Error("Vitest did not write coverage-final.json.");

    const vitestCoverage = JSON.parse(await fs.readFile(coverageFinalPath, "utf8"));
    const coverageMap = libCoverage.createCoverageMap(vitestCoverage);
    coverageMap.merge(await collectNodeTapCoverage());
    const context = libReport.createContext({ dir: reportsDirectory, coverageMap });
    reports.create("text-summary").execute(context);
    reports.create("json-summary").execute(context);
    reports.create("json").execute(context);
    enforceThresholds(coverageMap);
    process.stdout.write(`${JSON.stringify({ disposableDatabase: "PASS", migrationCount: disposable.migrationCount })}\n`);
  } catch (error) {
    taskError = error;
  } finally {
    const cleanup = await cleanupDisposableDatabase(disposable);
    process.stdout.write(`${JSON.stringify({ disposableCleanup: cleanup })}\n`);
    if (cleanup.container !== "PASS" || cleanup.tempRoot !== "PASS") {
      taskError ??= new Error(`Disposable coverage cleanup failed: ${JSON.stringify(cleanup)}`);
    }
  }
  if (taskError) throw taskError;
}

const invokedScript = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentScript = fileURLToPath(import.meta.url);

if (invokedScript === currentScript) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
