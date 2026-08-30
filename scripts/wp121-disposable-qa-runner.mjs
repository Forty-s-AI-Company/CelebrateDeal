import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const manifestPath = path.join(root, "scripts", "wp121-suite-manifest.json");
const receiptPath = path.join(root, ".ai-team", "reports", "wp121-disposable-qa-receipt.json");
const protectedPaths = [
  ".ai-team/scripts/Invoke-Wp107PayuniWebhookDisposableSchemaQa.ps1",
  ".ai-team/scripts/Invoke-Wp113PayuniWebhookDisposableSchemaMirrorQa.ps1",
];

const normalizeRelative = (value) => value.replaceAll("\\", "/").replace(/^\.\//, "");

export function loadSuiteManifest(value) {
  const manifest = typeof value === "string" ? JSON.parse(value) : value;
  if (!manifest || manifest.schemaVersion !== "celebratedeal-ai-team-wp121-suite-manifest/v1") {
    throw new Error("WP-121 suite manifest schema is invalid.");
  }
  if (!Array.isArray(manifest.requiredSuites) || manifest.requiredSuites.length === 0) {
    throw new Error("WP-121 suite manifest is empty.");
  }
  const suites = manifest.requiredSuites.map((suite) => normalizeRelative(String(suite)));
  if (new Set(suites).size !== suites.length || suites.some((suite) => suite.includes("..") || path.isAbsolute(suite))) {
    throw new Error("WP-121 suite manifest contains unsafe or duplicate paths.");
  }
  return { ...manifest, requiredSuites: suites };
}

function suiteName(entry) {
  if (!entry || typeof entry !== "object") return "";
  return normalizeRelative(String(entry.name ?? entry.filePath ?? entry.file ?? ""));
}

function numeric(value, field) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Vitest JSON field ${field} is invalid.`);
  return value;
}

function topLevelCount(payload, field) {
  if (!(field in payload)) return null;
  return numeric(payload[field], field);
}

export function parseVitestJson(value, { exitCode = 0, manifest, workspaceRoot = root } = {}) {
  const payload = typeof value === "string" ? JSON.parse(value) : value;
  const loadedManifest = loadSuiteManifest(manifest);
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.testResults)) {
    throw new Error("Vitest JSON is missing testResults.");
  }

  const discoveredSuites = payload.testResults.map(suiteName).filter(Boolean);
  if (discoveredSuites.length !== payload.testResults.length || new Set(discoveredSuites).size !== discoveredSuites.length) {
    throw new Error("Vitest JSON contains an unnamed or duplicate suite.");
  }
  const relativeSuites = discoveredSuites.map((name) => {
    const absolute = path.isAbsolute(name) ? name : path.resolve(workspaceRoot, name);
    const relative = path.relative(workspaceRoot, absolute);
    return normalizeRelative(relative);
  });
  const missingSuites = loadedManifest.requiredSuites.filter((suite) => !relativeSuites.includes(suite));

  const aggregate = { total: 0, passed: 0, failed: 0, skipped: 0 };
  let assertionCount = 0;
  for (const suite of payload.testResults) {
    const assertions = Array.isArray(suite.assertionResults)
      ? suite.assertionResults
      : Array.isArray(suite.testResults)
        ? suite.testResults
        : Array.isArray(suite.tests)
          ? suite.tests
          : [];
    for (const assertion of assertions) {
      assertionCount += 1;
      const status = String(assertion?.status ?? "").toLowerCase();
      aggregate.total += 1;
      if (status === "passed") aggregate.passed += 1;
      else if (status === "failed") aggregate.failed += 1;
      else if (["pending", "skipped", "todo"].includes(status)) aggregate.skipped += 1;
      else throw new Error("Vitest JSON contains an unknown assertion status.");
    }
  }

  const topCounts = {
    total: topLevelCount(payload, "numTotalTests"),
    passed: topLevelCount(payload, "numPassedTests"),
    failed: topLevelCount(payload, "numFailedTests"),
    skipped: topLevelCount(payload, "numPendingTests"),
  };
  if (assertionCount === 0 && Object.values(topCounts).some((value) => value === null)) {
    throw new Error("Vitest JSON has no assertion details or complete aggregate counts.");
  }
  const counts = assertionCount > 0 ? aggregate : topCounts;
  if (assertionCount > 0 && Object.values(topCounts).some((value) => value !== null)) {
    if (Object.keys(counts).some((key) => topCounts[key] !== null && topCounts[key] !== counts[key])) {
      throw new Error("Vitest JSON aggregate counts do not match assertion details.");
    }
  }

  const result = {
    discoveredSuites: relativeSuites.sort(),
    requiredSuites: [...loadedManifest.requiredSuites].sort(),
    missingSuites,
    testCounts: counts,
    exitCode,
  };
  result.status = exitCode === 0 && missingSuites.length === 0 && counts.failed === 0 && counts.skipped === 0
    ? "PASS"
    : "BLOCKED_OR_FAILED";
  return result;
}

function run(command, args, environment, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: "utf8",
    // Native executables (docker/git) must receive argv without cmd.exe
    // re-parsing; only Windows .cmd shims need a shell.
    shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function commandPath(name) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  return path.join(root, "node_modules", ".bin", `${name}${suffix}`);
}

function gitManifest() {
  return run("git", ["status", "--porcelain=v1", "--untracked-files=all"], process.env).stdout
    .split(/\r?\n/).filter(Boolean).sort();
}

function digest(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function safeEnvironment(databaseUrl, tempRoot) {
  return {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    ComSpec: process.env.ComSpec ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    TEMP: path.join(tempRoot, "tmp"),
    TMP: path.join(tempRoot, "tmp"),
    HOME: path.join(tempRoot, "home"),
    USERPROFILE: path.join(tempRoot, "home"),
    NODE_ENV: "test",
    CI: "true",
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    NPM_CONFIG_OFFLINE: "true",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    PSQLRC: "",
  };
}

function psql(container, sql, environment) {
  return run("docker", [
    "exec", "-e", "PGPASSWORD=postgres", container, "psql", "-U", "postgres", "-X",
    "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-d", "celebratedeal_ci", "-c", sql,
  ], environment);
}

function schemaIsSafe(schema) {
  return /^wp121_[0-9]{17}_[a-f0-9]{8}$/.test(schema);
}

function writeReceipt(receipt) {
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

export function buildSyntheticFixture({ suiteNames, passed, failed = 0, skipped = 0 } = {}) {
  const testsPerSuite = Math.floor(passed / suiteNames.length);
  const remainder = passed % suiteNames.length;
  const testResults = suiteNames.map((name, index) => {
    const count = testsPerSuite + (index < remainder ? 1 : 0);
    return {
      name,
      assertionResults: Array.from({ length: count }, () => ({ status: "passed" })),
    };
  });
  if (failed > 0) testResults[0].assertionResults.push(...Array.from({ length: failed }, () => ({ status: "failed" })));
  if (skipped > 0) testResults[0].assertionResults.push(...Array.from({ length: skipped }, () => ({ status: "pending" })));
  return {
    numTotalTests: passed + failed + skipped,
    numPassedTests: passed,
    numFailedTests: failed,
    numPendingTests: skipped,
    testResults,
  };
}

export async function main() {
  const startedAt = new Date().toISOString();
  const manifest = loadSuiteManifest(fs.readFileSync(manifestPath, "utf8"));
  const preManifest = gitManifest();
  const protectedBefore = Object.fromEntries(protectedPaths.map((relative) => [relative, digest(path.join(root, relative))]));
  const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
  const nonce = crypto.randomBytes(4).toString("hex");
  const schema = `wp121_${runId}_${nonce}`;
  const tempRoot = path.join(os.tmpdir(), `celebratedeal-wp121-${runId}-${nonce}`);
  const marker = `wp121:${runId}:${nonce}`;
  const receipt = {
    schemaVersion: "celebratedeal-ai-team-wp121/v1",
    workPackage: "WP-121",
    status: "BLOCKED_OR_FAILED",
    startedAt,
    finishedAt: null,
    runner: "additive-v2",
    manifest: manifest.requiredSuites,
    discoveredSuites: [],
    missingSuites: [],
    testCounts: { total: 0, passed: 0, failed: 0, skipped: 0 },
    exitCode: null,
    migrationCount: 0,
    migrationStatus: "NOT_STARTED",
    schemaCleanup: "NOT_STARTED",
    tempCleanup: "NOT_STARTED",
    externalSideEffects: false,
    sandboxPaymentCreated: false,
    environmentFileContentsRead: false,
    databaseBoundary: "loopback disposable schema only",
    protectedFilesUnchanged: false,
    preserveManifestUnchanged: false,
    stagedIndexEmpty: false,
    failureCategory: "unknown",
    failure: null,
  };
  let container = null;
  let schemaCreated = false;
  try {
    if (runId.length !== 17 || !schemaIsSafe(schema)) throw new Error("Generated WP-121 identifiers are unsafe.");
    if (run("git", ["diff", "--cached", "--name-only"], process.env).stdout.trim()) throw new Error("Staged index is not empty.");
    const containers = run("docker", ["ps", "--filter", "ancestor=postgres:16-alpine", "--format", "{{.ID}}"], process.env).stdout
      .split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (containers.length !== 1) throw new Error("Exactly one PostgreSQL 16 container is required.");
    container = containers[0];
    fs.mkdirSync(path.join(tempRoot, "tmp"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "home"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, ".wp121-marker"), marker, "utf8");
    const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=${schema}`;
    const environment = safeEnvironment(databaseUrl, tempRoot);
    const version = psql(container, "SELECT current_setting('server_version');", environment);
    if (version.exitCode !== 0 || !/^16\./m.test(version.stdout.trim())) throw new Error("PostgreSQL 16 preflight failed.");
    const create = psql(container, `CREATE SCHEMA ${schema}; COMMENT ON SCHEMA ${schema} IS '${marker}';`, environment);
    if (create.exitCode !== 0) throw new Error("Disposable schema creation failed.");
    schemaCreated = true;
    const prisma = commandPath("prisma");
    const generated = run(prisma, ["generate", "--schema", "prisma/schema.prisma"], environment);
    if (generated.exitCode !== 0) throw new Error("Prisma generate failed.");
    const migrate = run(prisma, ["migrate", "deploy", "--schema", "prisma/schema.prisma"], environment);
    if (migrate.exitCode !== 0) throw new Error("Prisma migration deploy failed.");
    const status = run(prisma, ["migrate", "status", "--schema", "prisma/schema.prisma"], environment);
    if (status.exitCode !== 0 || !/13 migrations found in prisma[\\/]migrations/.test(status.stdout)) throw new Error("Expected 13 migrations were not confirmed.");
    receipt.migrationCount = 13;
    receipt.migrationStatus = "PASS";
    const outputPath = path.join(tempRoot, "vitest.json");
    const vitest = run(commandPath("vitest"), ["run", "--reporter=json", "--outputFile", outputPath, ...manifest.requiredSuites], environment);
    receipt.exitCode = vitest.exitCode;
    if (!fs.existsSync(outputPath)) throw new Error("Vitest JSON output was not produced.");
    const parsed = parseVitestJson(fs.readFileSync(outputPath, "utf8"), { exitCode: vitest.exitCode, manifest, workspaceRoot: root });
    receipt.discoveredSuites = parsed.discoveredSuites;
    receipt.missingSuites = parsed.missingSuites;
    receipt.testCounts = parsed.testCounts;
    if (parsed.status !== "PASS") throw new Error("WP-121 dynamic suite contract rejected the Vitest result.");
    receipt.status = "PASS";
    receipt.failureCategory = "none";
  } catch (error) {
    receipt.failure = error instanceof Error ? error.message : String(error);
    receipt.failureCategory = /migration|schema|PostgreSQL/.test(receipt.failure) ? "schema-or-migration" : "runner-contract";
  } finally {
    if (schemaCreated && container) {
      const cleanup = psql(container, `SELECT COALESCE(obj_description(oid, 'pg_namespace'), '') = '${marker}' FROM pg_namespace WHERE nspname = '${schema}';`, safeEnvironment(`postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=${schema}`, tempRoot));
      if (cleanup.exitCode === 0 && cleanup.stdout.trim() === "t") {
        const dropped = psql(container, `DROP SCHEMA ${schema} CASCADE;`, safeEnvironment(`postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=${schema}`, tempRoot));
        const verified = psql(container, `SELECT COUNT(*) FROM pg_namespace WHERE nspname = '${schema}';`, safeEnvironment(`postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=${schema}`, tempRoot));
        receipt.schemaCleanup = dropped.exitCode === 0 && verified.exitCode === 0 && verified.stdout.trim() === "0" ? "PASS" : "FAIL";
      } else receipt.schemaCleanup = "FAIL";
    } else receipt.schemaCleanup = "NOT_CREATED";
    const markerPath = path.join(tempRoot, ".wp121-marker");
    if (fs.existsSync(markerPath) && fs.readFileSync(markerPath, "utf8") === marker) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      receipt.tempCleanup = "PASS";
    } else receipt.tempCleanup = "FAIL";
    const protectedAfter = Object.fromEntries(protectedPaths.map((relative) => [relative, digest(path.join(root, relative))]));
    receipt.protectedFilesUnchanged = JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter);
    receipt.preserveManifestUnchanged = JSON.stringify(preManifest) === JSON.stringify(gitManifest());
    receipt.stagedIndexEmpty = !run("git", ["diff", "--cached", "--name-only"], process.env).stdout.trim();
    if (receipt.status === "PASS" && (!receipt.protectedFilesUnchanged || !receipt.preserveManifestUnchanged || !receipt.stagedIndexEmpty || receipt.schemaCleanup !== "PASS" || receipt.tempCleanup !== "PASS")) {
      receipt.status = "BLOCKED_OR_FAILED";
      receipt.failureCategory = "ownership-or-cleanup";
      receipt.failure = receipt.failure ?? "Ownership or cleanup invariant failed.";
    }
    receipt.finishedAt = new Date().toISOString();
    writeReceipt(receipt);
  }
  if (receipt.status !== "PASS") process.exitCode = 1;
  else console.log(JSON.stringify({ workPackage: "WP-121", status: "PASS", suites: receipt.discoveredSuites.length, tests: receipt.testCounts.total, migrationCount: receipt.migrationCount, schemaCleanup: receipt.schemaCleanup }));
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) await main();
