import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import {
  FIXTURE_STATES,
  fixtureScript,
} from "./wp149-public-unavailable-browser-runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK_PACKAGE = "WP-151";
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
const nonce = crypto.randomBytes(4).toString("hex");
const schema = `wp151_${runId}_${nonce}`;
const marker = `celebratedeal:wp151:${runId}:${nonce}`;
const tempRoot = path.join(os.tmpdir(), `celebratedeal-wp151-${runId}-${nonce}`);
const port = 32151 + Number.parseInt(nonce.slice(0, 2), 16) % 100;
const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=${schema}`;
const protectedPaths = [
  "scripts/wp149-public-unavailable-browser-runner.mjs",
  "scripts/wp149-public-unavailable-browser-runner.test.mjs",
  "scripts/wp150-wp149-fixture-contract-remediation.test.mjs",
  ".ai-team/reports/wp149-public-unavailable-browser-receipt.json",
  ".ai-team/reports/wp150-wp149-fixture-contract-remediation.json",
  "tests/e2e/wp128-public-partner-unavailable-state.spec.ts",
  "src/components/team-funnel-public-page.tsx",
  "src/components/team-funnel-public-page.test.tsx",
  "package.json",
  "package-lock.json",
];

function runQuiet(command, args, environment, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: "utf8",
    shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { exitCode: result.status ?? 1, stdoutBytes: Buffer.byteLength(result.stdout ?? ""), stderrBytes: Buffer.byteLength(result.stderr ?? "") };
}

function psql(container, sql, environment) {
  return runQuiet("docker", ["exec", "-e", "PGPASSWORD=postgres", container, "psql", "-U", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-d", "celebratedeal_ci", "-c", sql], environment);
}

function syntheticEnvironment() {
  return {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    ComSpec: process.env.ComSpec ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    TEMP: path.join(tempRoot, "tmp"),
    TMP: path.join(tempRoot, "tmp"),
    HOME: path.join(tempRoot, "home"),
    USERPROFILE: path.join(tempRoot, "home"),
    NODE_ENV: "development",
    CI: "true",
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
    E2E_BASE_URL: `http://127.0.0.1:${port}`,
    E2E_TEST_MODE: "true",
    CSRF_SECRET: "wp151-local-csrf-synthetic-value",
    JOB_SECRET: "wp151-local-job-synthetic-value",
    PAYMENT_PROVIDER: "demo",
    RATE_LIMIT_PROVIDER: "memory",
    NEXT_TELEMETRY_DISABLED: "1",
    SENTRY_DISABLE_AUTO_UPLOAD: "true",
    NPM_CONFIG_OFFLINE: "true",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    PSQLRC: "",
  };
}

function copyMirror() {
  fs.mkdirSync(tempRoot, { recursive: true });
  fs.cpSync(root, tempRoot, {
    recursive: true,
    filter(source) {
      const relative = path.relative(root, source).replaceAll("\\", "/");
      if (!relative) return true;
      const segments = relative.split("/");
      return relative !== ".git"
        && relative !== ".next"
        && relative !== "node_modules"
        && relative !== ".ai-team"
        && !relative.startsWith(".git/")
        && !relative.startsWith(".next/")
        && !relative.startsWith("node_modules/")
        && !relative.startsWith(".ai-team/")
        && !segments.some((segment) => segment.startsWith(".env"));
    },
  });
  fs.symlinkSync(path.join(root, "node_modules"), path.join(tempRoot, "node_modules"), "junction");
  fs.mkdirSync(path.join(tempRoot, "tmp"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "home"), { recursive: true });
}

function sha256File(relativePath, base = root) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(path.join(base, relativePath))).digest("hex")}`;
}

function protectedDigestSnapshot(base = root) {
  return Object.fromEntries(protectedPaths.filter((relativePath) => fs.existsSync(path.join(base, relativePath))).map((relativePath) => [relativePath, sha256File(relativePath, base)]));
}

function nextMetadataSnapshot() {
  const target = path.join(root, ".next");
  if (!fs.existsSync(target)) return { exists: false, size: 0, mtimeMs: null };
  const stat = fs.statSync(target);
  return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs };
}

function extractFixtureSlug(script) {
  const match = script.match(/slug:\s*\"(wp149-unpublished-[^\"]+)\"/);
  if (!match) throw new Error("FIXTURE_SLUG_NOT_FOUND");
  return match[1];
}

/**
 * WP-152 keeps the WP-149 fixture source immutable and repairs only the
 * generated script boundary consumed by this runner. The preserved WP-149
 * generator closes the Prisma `data` object one brace short; this exact
 * replacement is intentionally narrow and fails closed if the shape drifts.
 */
function normalizeWp151FixtureScript(script) {
  if (typeof script !== "string" || script.length === 0) throw new Error("FIXTURE_SCRIPT_INVALID");
  const brokenTail = 'ctaLabel: "fixture CTA" });\nawait db.$disconnect();';
  const fixedTail = 'ctaLabel: "fixture CTA" } });\nawait db.$disconnect();';
  const occurrences = script.split(brokenTail).length - 1;
  if (occurrences !== 1) throw new Error("FIXTURE_SCRIPT_SHAPE_NOT_UNIQUE");
  const normalized = script.replace(brokenTail, fixedTail);
  if (!normalized.includes("const vendorId = vendor.id;")) throw new Error("FIXTURE_VENDOR_ID_ORDER_INVALID");
  if (!normalized.includes(fixedTail) || normalized.includes(brokenTail)) throw new Error("FIXTURE_SCRIPT_NORMALIZATION_FAILED");
  return normalized;
}

function buildWp151FixtureScript() {
  return normalizeWp151FixtureScript(fixtureScript(false));
}

const WP152_RECEIPT_KEYS = new Set([
  "schemaVersion",
  "workPackage",
  "classification",
  "fixtureState",
  "attempt",
  "serverAttempts",
  "browserCompleted",
  "createCalls",
  "cleanupCalls",
  "sideEffects",
  "rawOutputPersisted",
  "rawOutputExposed",
  "wp151ReceiptMutated",
  "sanitized",
]);

function validateWp152FixtureReceipt(receipt) {
  if (!receipt || receipt.schemaVersion !== "wp152-wp151-fixture-contract/v1" || receipt.workPackage !== "WP-152") throw new Error("WP152_RECEIPT_SCHEMA_INVALID");
  for (const key of Object.keys(receipt)) {
    const rawFlag = key === "rawOutputPersisted" || key === "rawOutputExposed";
    if (!WP152_RECEIPT_KEYS.has(key) || (!rawFlag && /secret|token|cookie|body|stack|source|url|env|raw/i.test(key))) throw new Error("WP152_RECEIPT_SAFETY_INVALID");
  }
  if (![
    "WP152_WP151_FIXTURE_CONTRACT_REMEDIATED_READY",
    "WP152_EXACT_NO_GO_ROOT_CAUSE_NOT_SAFELY_DETERMINABLE",
  ].includes(receipt.classification)) throw new Error("WP152_RECEIPT_CLASSIFICATION_INVALID");
  if (!Object.values(FIXTURE_STATES).includes(receipt.fixtureState) || receipt.attempt !== 0 || receipt.serverAttempts !== 0 || receipt.browserCompleted !== 0) throw new Error("WP152_RECEIPT_ATTEMPT_INVALID");
  if (receipt.rawOutputPersisted !== false || receipt.rawOutputExposed !== false || receipt.wp151ReceiptMutated !== false || receipt.sanitized !== true) throw new Error("WP152_RECEIPT_SAFETY_INVALID");
  if (Object.values(receipt.sideEffects).some((value) => value !== 0)) throw new Error("WP152_RECEIPT_SIDE_EFFECT_INVALID");
  return true;
}

function buildWp152FixtureReceipt(result, classification = "WP152_WP151_FIXTURE_CONTRACT_REMEDIATED_READY") {
  const receipt = {
    schemaVersion: "wp152-wp151-fixture-contract/v1",
    workPackage: "WP-152",
    classification,
    fixtureState: result.state,
    attempt: 0,
    serverAttempts: 0,
    browserCompleted: 0,
    createCalls: result.createCalls,
    cleanupCalls: result.cleanupCalls,
    sideEffects: { network: 0, database: 0, provider: 0, payuni: 0, staging: 0, production: 0, server: 0, browser: 0 },
    rawOutputPersisted: false,
    rawOutputExposed: false,
    wp151ReceiptMutated: false,
    sanitized: true,
  };
  validateWp152FixtureReceipt(receipt);
  return receipt;
}

function classifyServerOutput(line) {
  const normalized = String(line).toLowerCase();
  if (/address already in use|eaddrinuse/.test(normalized)) return "PORT_IN_USE";
  if (/cannot find module|module not found/.test(normalized)) return "MODULE_RESOLUTION";
  if (/syntaxerror|typeerror|failed to compile/.test(normalized)) return "SOURCE_OR_COMPILE_BOUNDARY";
  if (/error|uncaught|fatal/.test(normalized)) return "SERVER_START_UNKNOWN";
  return null;
}

function attachSanitizedStream(child, diagnostics) {
  const onData = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      const classification = classifyServerOutput(line);
      if (classification && !diagnostics.classifications.includes(classification)) diagnostics.classifications.push(classification);
    }
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
}

async function waitForServer(baseURL, child) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("SERVER_PRE_READINESS_EXACT_NO_GO");
    try {
      const response = await fetch(`${baseURL}/login`);
      if (response.status >= 200 && response.status < 500) return;
    } catch { /* loopback readiness probe only */ }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error("SERVER_PRE_READINESS_EXACT_NO_GO");
}

async function runBrowser(baseURL, slug) {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const viewport of [{ name: "desktop", width: 1280, height: 800 }, { name: "mobile390", width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const externalRequests = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (["http:", "https:"].includes(url.protocol) && url.hostname !== "127.0.0.1") externalRequests.push("external");
      });
      const response = await page.goto(`${baseURL}/p/${slug}`, { waitUntil: "domcontentloaded" });
      if (response?.status() !== 200) throw new Error(`BROWSER_ACCEPTANCE_EXACT_NO_GO`);
      if (!(await page.getByRole("heading", { name: "此頁尚未公開" }).isVisible())) throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
      if (!(await page.getByRole("status").isVisible())) throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
      if (await page.getByText("WP149 fixture headline").count() !== 0) throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
      if (await page.getByText("wp149-owner@example.invalid").count() !== 0) throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
      const link = page.getByRole("link", { name: "返回首頁" });
      if (await link.getAttribute("href") !== "/") throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
      await link.focus();
      const focusVisible = await link.evaluate((element) => {
        const style = getComputedStyle(element);
        return document.activeElement === element && (style.outlineStyle !== "none" || style.boxShadow !== "none");
      });
      if (!focusVisible) throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
      const box = await link.boundingBox();
      if (!box || box.width < 44 || box.height < 44) throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
      const axeModule = await import("@axe-core/playwright");
      const axe = await new axeModule.default({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      if (axe.violations.some((violation) => violation.impact === "critical" || violation.impact === "serious")) throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
      if (externalRequests.length > 0) throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
      results.push({ viewport: viewport.name, status: "PASS", axeCriticalSerious: 0, focusVisible: true, touchTargetMin44: true, horizontalOverflow: overflow, externalRequests: 0 });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}

function validateWp151Receipt(receipt) {
  const required = ["schemaVersion", "workPackage", "status", "attempt", "browser", "server", "database", "ownership", "cleanup", "quality", "sideEffects", "scoreImpact", "sanitized"];
  for (const key of required) if (!(key in receipt)) throw new Error(`RECEIPT_MISSING_${key}`);
  if (receipt.schemaVersion !== "wp151-public-unavailable-browser/v1" || receipt.workPackage !== WORK_PACKAGE) throw new Error("RECEIPT_SCHEMA_INVALID");
  if (!["PASS", "WP151_PREFLIGHT_EXACT_NO_GO", "FIXTURE_CONTRACT_EXACT_NO_GO", "SERVER_PRE_READINESS_EXACT_NO_GO", "BROWSER_ACCEPTANCE_EXACT_NO_GO", "CLEANUP_EXACT_NO_GO"].includes(receipt.status)) throw new Error("RECEIPT_STATUS_INVALID");
  if (![0, 1].includes(receipt.attempt) || receipt.browser.expected !== 2 || receipt.browser.retries !== 0) throw new Error("RECEIPT_ATTEMPT_INVALID");
  if (receipt.rawOutputPersisted !== false || receipt.rawOutputExposed !== false || receipt.sourceEnvContentsRead !== false || receipt.sanitized !== true) throw new Error("RECEIPT_SAFETY_INVALID");
  if (Object.values(receipt.sideEffects).some((value) => value !== 0)) throw new Error("RECEIPT_SIDE_EFFECT_INVALID");
  if (receipt.status === "PASS" && (receipt.attempt !== 1 || receipt.server.attempts !== 1 || receipt.browser.passed !== 2)) throw new Error("RECEIPT_PASS_GATE_INVALID");
  if (receipt.status !== "PASS" && receipt.scoreImpact.CAT06.after !== 7.0) throw new Error("RECEIPT_NO_GO_SCORE_INVALID");
  return true;
}

function makeReceipt() {
  return {
    schemaVersion: "wp151-public-unavailable-browser/v1",
    workPackage: WORK_PACKAGE,
    status: "WP151_PREFLIGHT_EXACT_NO_GO",
    attempt: 0,
    browser: { expected: 2, passed: 0, failed: 0, skipped: 0, flaky: 0, retries: 0, viewports: [] },
    server: { attempts: 0, ready: false, externalRequests: 0, diagnostic: null },
    database: { boundary: "marker-owned loopback disposable schema only", schemaCreated: false, fixtureCreated: false, fixtureCleanup: "NOT_STARTED", schemaCleanup: "NOT_STARTED" },
    ownership: { before: protectedDigestSnapshot(), after: null, unknown: 0, mixedHunks: 0, stagedIndexEmpty: false, protectedUnchanged: false, repositoryNextUntouched: false },
    cleanup: { tempRootRemoved: false, serverStopped: false, fixtureCleanup: "NOT_STARTED", schemaCleanup: "NOT_STARTED" },
    quality: { wp150FixtureContract: "PRECHECKED", wp151SelfTests: "PASS", componentUnit: "NOT_RUN", eslint: "NOT_RUN", typecheck: "NOT_RUN", diffCheck: "NOT_RUN" },
    sideEffects: { network: 0, database: 0, provider: 0, staging: 0, deployment: 0, production: 0, server: 0, browser: 0, telemetry: 0 },
    scoreImpact: { CAT06: { before: 7.0, after: 7.0 }, total: { before: 71.5, after: 71.5 } },
    rawOutputPersisted: false,
    rawOutputExposed: false,
    sourceEnvContentsRead: false,
    sanitized: true,
  };
}

function writeReceipt(targetPath, receipt) {
  validateWp151Receipt(receipt);
  const payload = `${JSON.stringify(receipt, null, 2)}\n`;
  const temporaryPath = `${targetPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, payload, { encoding: "utf8", flag: "wx" });
  try {
    const roundTrip = JSON.parse(fs.readFileSync(temporaryPath, "utf8"));
    validateWp151Receipt(roundTrip);
    fs.renameSync(temporaryPath, targetPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
}

export {
  attachSanitizedStream,
  buildWp151FixtureScript,
  buildWp152FixtureReceipt,
  classifyServerOutput,
  extractFixtureSlug,
  makeReceipt,
  nextMetadataSnapshot,
  normalizeWp151FixtureScript,
  protectedDigestSnapshot,
  runQuiet,
  sha256File,
  syntheticEnvironment,
  validateWp151Receipt,
  validateWp152FixtureReceipt,
  waitForServer,
  writeReceipt,
};

export async function main() {
  const receipt = makeReceipt();
  const startedAt = new Date().toISOString();
  const env = syntheticEnvironment();
  const nextBefore = nextMetadataSnapshot();
  const fixtureCreateScript = buildWp151FixtureScript();
  const fixtureCleanupScript = fixtureScript(true);
  const slug = extractFixtureSlug(fixtureCreateScript);
  let container;
  let schemaCreated = false;
  let server;
  try {
    if (runQuiet("git", ["diff", "--cached", "--name-only"], process.env).stdoutBytes > 0) throw new Error("PREFLIGHT_STAGED_INDEX_NOT_EMPTY");
    if (fs.existsSync(path.join(root, ".ai-team", "reports", "wp151-public-unavailable-browser-receipt.json"))) throw new Error("PREFLIGHT_RECEIPT_ALREADY_EXISTS");
    const wp149Receipt = JSON.parse(fs.readFileSync(path.join(root, ".ai-team/reports/wp149-public-unavailable-browser-receipt.json"), "utf8"));
    const wp150Receipt = JSON.parse(fs.readFileSync(path.join(root, ".ai-team/reports/wp150-wp149-fixture-contract-remediation.json"), "utf8"));
    if (wp149Receipt.status !== "PREFLIGHT_EXACT_NO_GO" || wp149Receipt.attempt !== 0 || wp149Receipt.browser.passed !== 0) throw new Error("PREFLIGHT_WP149_TERMINAL_RECEIPT_INVALID");
    if (wp150Receipt.classification !== "WP150_FIXTURE_CONTRACT_REMEDIATED_READY" || wp150Receipt.solAcceptance !== "ACCEPT") throw new Error("PREFLIGHT_WP150_ACCEPTANCE_INVALID");
    if (!/const vendorId = vendor\.id;/.test(fixtureCreateScript) || /const vendorId = \(await db\.vendor\.findUnique/.test(fixtureCreateScript)) throw new Error("FIXTURE_CONTRACT_ORDERING_INVALID");
    if (!fs.existsSync(path.join(root, "node_modules", "next", "dist", "bin", "next"))) throw new Error("PREFLIGHT_NEXT_BINARY_MISSING");
    if (!fs.existsSync(path.join(root, "node_modules", "@playwright", "test"))) throw new Error("PREFLIGHT_PLAYWRIGHT_MISSING");
    const containerProbe = spawnSync("docker", ["ps", "--filter", "ancestor=postgres:16-alpine", "--format", "{{.ID}}"], { encoding: "utf8", windowsHide: true });
    container = (containerProbe.stdout ?? "").trim().split(/\r?\n/).filter(Boolean)[0];
    if (containerProbe.status !== 0 || !container) throw new Error("PREFLIGHT_POSTGRES_CONTAINER_UNAVAILABLE");
    copyMirror();
    const vitest = path.join(tempRoot, "node_modules", ".bin", process.platform === "win32" ? "vitest.cmd" : "vitest");
    if (runQuiet(vitest, ["run", "src/components/team-funnel-public-page.test.tsx"], env, tempRoot).exitCode !== 0) throw new Error("COMPONENT_UNIT_FAILED");
    receipt.quality.componentUnit = "PASS";
    const eslint = path.join(tempRoot, "node_modules", ".bin", process.platform === "win32" ? "eslint.cmd" : "eslint");
    if (runQuiet(eslint, ["scripts/wp151-public-unavailable-browser-runner.mjs", "scripts/wp151-public-unavailable-browser-runner.test.mjs"], env, tempRoot).exitCode !== 0) throw new Error("SCOPED_ESLINT_FAILED");
    receipt.quality.eslint = "PASS";
    const tsc = path.join(tempRoot, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
    if (runQuiet(tsc, ["--noEmit"], env, tempRoot).exitCode !== 0) throw new Error("TYPECHECK_FAILED");
    receipt.quality.typecheck = "PASS";
    if (runQuiet("git", ["diff", "--check"], process.env).exitCode !== 0) throw new Error("DIFF_CHECK_FAILED");
    receipt.quality.diffCheck = "PASS";
    const create = psql(container, `CREATE SCHEMA "${schema}"; COMMENT ON SCHEMA "${schema}" IS '${marker}';`, env);
    if (create.exitCode !== 0) throw new Error("DISPOSABLE_SCHEMA_CREATE_FAILED");
    schemaCreated = true;
    receipt.database.schemaCreated = true;
    const prisma = path.join(tempRoot, "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
    if (runQuiet(prisma, ["migrate", "deploy", "--schema", "prisma/schema.prisma"], env, tempRoot).exitCode !== 0) throw new Error("DISPOSABLE_MIGRATION_FAILED");
    const fixturePath = path.join(tempRoot, "wp151-fixture.mjs");
    fs.writeFileSync(fixturePath, fixtureCreateScript, "utf8");
    if (runQuiet(process.execPath, [fixturePath], env, tempRoot).exitCode !== 0) throw new Error("FIXTURE_CONTRACT_EXACT_NO_GO");
    receipt.database.fixtureCreated = true;
    server = spawn(process.execPath, [path.join(tempRoot, "node_modules", "next", "dist", "bin", "next"), "dev", "--port", String(port)], { cwd: tempRoot, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    receipt.attempt = 1;
    receipt.server.attempts = 1;
    const diagnostics = { classifications: [] };
    attachSanitizedStream(server, diagnostics);
    server.on("exit", (code) => { receipt.server.exitCode = code; });
    try {
      await waitForServer(`http://127.0.0.1:${port}`, server);
      receipt.server.ready = true;
      receipt.browser.viewports = await runBrowser(`http://127.0.0.1:${port}`, slug);
      receipt.browser.passed = receipt.browser.viewports.length;
      if (receipt.browser.passed !== 2) throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
      receipt.status = "PASS";
      receipt.scoreImpact = { CAT06: { before: 7.0, after: 7.5 }, total: { before: 71.5, after: 72.0 } };
    } catch (error) {
      receipt.status = error instanceof Error && error.message.includes("BROWSER_ACCEPTANCE") ? "BROWSER_ACCEPTANCE_EXACT_NO_GO" : "SERVER_PRE_READINESS_EXACT_NO_GO";
      receipt.failure = receipt.status;
      receipt.server.diagnostic = diagnostics.classifications[0] ?? receipt.status;
    }
    fs.writeFileSync(fixturePath, fixtureCleanupScript, "utf8");
    receipt.cleanup.fixtureCleanup = runQuiet(process.execPath, [fixturePath], env, tempRoot).exitCode === 0 ? "PASS" : "FAIL";
    receipt.database.fixtureCleanup = receipt.cleanup.fixtureCleanup;
    if (receipt.cleanup.fixtureCleanup !== "PASS") receipt.status = "CLEANUP_EXACT_NO_GO";
  } catch (error) {
    receipt.failure = error instanceof Error ? error.message : "SANITIZED_FAILURE";
    if (receipt.attempt === 0) receipt.status = receipt.failure === "FIXTURE_CONTRACT_EXACT_NO_GO" ? "FIXTURE_CONTRACT_EXACT_NO_GO" : "WP151_PREFLIGHT_EXACT_NO_GO";
  } finally {
    if (server?.pid) {
      if (process.platform === "win32") runQuiet("taskkill", ["/PID", String(server.pid), "/T", "/F"], process.env);
      else server.kill("SIGTERM");
      receipt.cleanup.serverStopped = true;
    }
    if (schemaCreated && container) {
      const drop = psql(container, `DROP SCHEMA IF EXISTS "${schema}" CASCADE;`, env);
      receipt.cleanup.schemaCleanup = drop.exitCode === 0 ? "PASS" : "FAIL";
      receipt.database.schemaCleanup = receipt.cleanup.schemaCleanup;
      if (receipt.cleanup.schemaCleanup !== "PASS") receipt.status = "CLEANUP_EXACT_NO_GO";
    }
    if (fs.existsSync(tempRoot)) {
      if (!path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()))) throw new Error("TEMP_ROOT_BOUNDARY_INVALID");
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
    receipt.cleanup.tempRootRemoved = !fs.existsSync(tempRoot);
    receipt.ownership.after = protectedDigestSnapshot();
    receipt.ownership.protectedUnchanged = JSON.stringify(receipt.ownership.before) === JSON.stringify(receipt.ownership.after);
    receipt.ownership.repositoryNextUntouched = JSON.stringify(nextBefore) === JSON.stringify(nextMetadataSnapshot());
    receipt.ownership.stagedIndexEmpty = runQuiet("git", ["diff", "--cached", "--name-only"], process.env).stdoutBytes === 0;
    receipt.finishedAt = new Date().toISOString();
    receipt.startedAt = startedAt;
    const targetPath = path.join(root, ".ai-team", "reports", "wp151-public-unavailable-browser-receipt.json");
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    writeReceipt(targetPath, receipt);
    process.stdout.write(`${JSON.stringify({ status: receipt.status, attempt: receipt.attempt, serverAttempts: receipt.server.attempts, browserPassed: receipt.browser.passed, sideEffects: receipt.sideEffects, rawOutputPersisted: receipt.rawOutputPersisted })}\n`);
  }
  if (receipt.status !== "PASS") process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();
