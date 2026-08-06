import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

import { fixtureScript } from "./wp149-public-unavailable-browser-runner.mjs";
import { buildWp151FixtureScript } from "./wp151-public-unavailable-browser-runner.mjs";
import {
  classifyServerOutput,
  normalizeLoopbackEndpoint,
  readinessTransition,
  READINESS_STATES,
} from "./wp153-public-unavailable-browser-runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK_PACKAGE = "WP-155";
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
const nonce = crypto.randomBytes(4).toString("hex");
const schema = `wp155_${runId}_${nonce}`;
const marker = `celebratedeal:wp155:${runId}:${nonce}`;
const tempRoot = path.join(os.tmpdir(), `celebratedeal-wp155-${runId}-${nonce}`);
const port = 32155 + Number.parseInt(nonce.slice(0, 2), 16) % 100;
const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=${schema}`;
const protectedPaths = [
  ".ai-team/reports/wp151-public-unavailable-browser-receipt.json",
  ".ai-team/reports/wp152-wp151-fixture-contract-remediation.json",
  ".ai-team/reports/wp153-public-unavailable-browser-receipt.json",
  ".ai-team/reports/wp154-wp153-readiness-contract-remediation.json",
  "scripts/wp151-public-unavailable-browser-runner.mjs",
  "scripts/wp151-public-unavailable-browser-runner.test.mjs",
  "scripts/wp152-wp151-fixture-contract-remediation.test.mjs",
  "scripts/wp153-public-unavailable-browser-runner.mjs",
  "scripts/wp153-public-unavailable-browser-runner.test.mjs",
  "scripts/wp154-wp153-readiness-contract-remediation.test.mjs",
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
  return {
    exitCode: result.status ?? 1,
    stdoutBytes: Buffer.byteLength(result.stdout ?? ""),
    stderrBytes: Buffer.byteLength(result.stderr ?? ""),
  };
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
    CSRF_SECRET: "wp155-local-csrf-synthetic-value",
    JOB_SECRET: "wp155-local-job-synthetic-value",
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

function attachSanitizedStream(child, diagnostics) {
  const onData = (chunk) => {
    const lines = String(chunk).split(/\r?\n/).filter(Boolean);
    diagnostics.lineCount += lines.length;
    for (const line of lines) {
      const classification = classifyServerOutput(line);
      if (classification && !diagnostics.classifications.includes(classification)) diagnostics.classifications.push(classification);
      if (/\bready\b|started server|listening/i.test(line)) diagnostics.markerSeen = true;
    }
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
}

async function waitForServer(baseURL, child, diagnostics) {
  let machine = { state: READINESS_STATES.NOT_STARTED, markerSeen: false, probeSeen: false, spawnCount: 0, ignoredEvents: 0, events: [] };
  machine = readinessTransition(machine, "SPAWN_REQUEST");
  machine = readinessTransition(machine, "SPAWN_ACCEPTED");
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      machine = readinessTransition(machine, "EARLY_EXIT");
      throw new Error(`SERVER_READINESS_EXACT_NO_GO:${machine.state}`);
    }
    try {
      const response = await fetch(`${baseURL}/login`);
      if (response.status >= 200 && response.status < 500) {
        diagnostics.probeSeen = true;
        if (diagnostics.markerSeen) machine = readinessTransition(machine, "READY_MARKER");
        machine = readinessTransition(machine, "PROBE_READY");
        if (machine.state === READINESS_STATES.READY) return machine;
      }
    } catch {
      // Readiness probes are loopback-only and intentionally sanitized.
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  machine = readinessTransition(machine, "TIMEOUT");
  throw new Error(`SERVER_READINESS_EXACT_NO_GO:${machine.state}`);
}

let activeBrowser;

async function assertUnavailableCase(baseURL, slug, viewport) {
  if (!activeBrowser) activeBrowser = await chromium.launch({ headless: true });
  const page = await activeBrowser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  const externalRequests = [];
  page.on("request", (request) => {
    try {
      const url = new URL(request.url());
      if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "::1", "[::1]"].includes(url.hostname)) externalRequests.push("external");
    } catch {
      externalRequests.push("malformed");
    }
  });
  try {
    const response = await page.goto(`${baseURL}/p/${slug}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (response?.status() !== 200) throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
    if (!(await page.getByRole("heading", { name: "此頁尚未公開" }).isVisible())) throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
    const status = page.getByRole("status");
    if (!(await status.isVisible()) || !(await status.getByText("目前無法提供瀏覽").isVisible())) throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
    if (await page.getByText("WP128 fixture headline").count() !== 0) throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
    if (await page.getByText("fixture@example.invalid").count() !== 0) throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
    const recovery = page.getByRole("link", { name: "返回首頁" });
    if (await recovery.getAttribute("href") !== "/") throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
    await recovery.focus();
    if (!(await recovery.evaluate((element) => document.activeElement === element))) throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
    const box = await recovery.boundingBox();
    if (!box || box.height < 44) throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    if (axe.violations.some((violation) => violation.impact === "critical" || violation.impact === "serious")) throw new Error("BROWSER_ACCEPTANCE_EXACT_NO_GO");
    if (externalRequests.length > 0) throw new Error("NON_LOOPBACK_REQUEST_EXACT_NO_GO");
    return { viewport: viewport.name, status: "PASS", heading: true, statusMessage: true, recoveryHref: "/", focused: true, touchTargetMin44: true, horizontalOverflow: overflow, axeCriticalSerious: 0, externalRequests: 0 };
  } finally {
    await page.close().catch(() => undefined);
  }
}

const RECEIPT_KEYS = new Set([
  "schemaVersion", "workPackage", "status", "attempt", "server", "browser", "database", "cleanup", "ownership", "quality", "sideEffects", "scoreImpact", "rawOutputPersisted", "rawOutputExposed", "sourceEnvContentsRead", "sanitized", "failure", "startedAt", "finishedAt",
]);

function validateReceipt(receipt) {
  const required = ["schemaVersion", "workPackage", "status", "attempt", "server", "browser", "database", "cleanup", "ownership", "quality", "sideEffects", "scoreImpact", "rawOutputPersisted", "rawOutputExposed", "sourceEnvContentsRead", "sanitized"];
  for (const key of required) if (!(key in receipt)) throw new Error(`RECEIPT_MISSING_${key}`);
  for (const key of Object.keys(receipt)) if (!RECEIPT_KEYS.has(key)) throw new Error("RECEIPT_SCHEMA_UNEXPECTED_KEY");
  if (receipt.schemaVersion !== "wp155-public-unavailable-browser/v1" || receipt.workPackage !== WORK_PACKAGE) throw new Error("RECEIPT_SCHEMA_INVALID");
  if (!["WP155_PUBLIC_UNAVAILABLE_BROWSER_VERIFIED", "WP155_EXACT_NO_GO_NO_RETRY"].includes(receipt.status)) throw new Error("RECEIPT_STATUS_INVALID");
  if (![0, 1].includes(receipt.attempt) || receipt.server.expected !== 1 || receipt.browser.desktop.expected !== 1 || receipt.browser.mobile390.expected !== 1) throw new Error("RECEIPT_COUNTER_INVALID");
  if (receipt.server.started > 1 || receipt.server.readinessWindowsAttempted > 1 || receipt.browser.desktop.navigationCount > 1 || receipt.browser.mobile390.navigationCount > 1 || receipt.browser.desktop.retries !== 0 || receipt.browser.mobile390.retries !== 0) throw new Error("RECEIPT_EXACTLY_ONCE_INVALID");
  if (receipt.rawOutputPersisted !== false || receipt.rawOutputExposed !== false || receipt.sourceEnvContentsRead !== false || receipt.sanitized !== true) throw new Error("RECEIPT_SAFETY_INVALID");
  if (Object.values(receipt.sideEffects).some((value) => value !== 0)) throw new Error("RECEIPT_SIDE_EFFECT_INVALID");
  if (receipt.status === "WP155_PUBLIC_UNAVAILABLE_BROWSER_VERIFIED" && (receipt.attempt !== 1 || receipt.server.started !== 1 || receipt.server.ready !== true || receipt.browser.desktop.passed !== 1 || receipt.browser.mobile390.passed !== 1 || receipt.cleanup.fixture !== "PASS" || receipt.cleanup.schema !== "PASS" || receipt.cleanup.tempRoot !== true)) throw new Error("RECEIPT_PASS_GATE_INVALID");
  if (receipt.status === "WP155_EXACT_NO_GO_NO_RETRY" && (receipt.scoreImpact.CAT06.after !== 7.0 || receipt.scoreImpact.total.after !== 71.5)) throw new Error("RECEIPT_NO_GO_SCORE_INVALID");
  return true;
}

function makeReceipt() {
  return {
    schemaVersion: "wp155-public-unavailable-browser/v1",
    workPackage: WORK_PACKAGE,
    status: "WP155_EXACT_NO_GO_NO_RETRY",
    attempt: 0,
    server: { expected: 1, started: 0, ready: false, readinessWindowsAttempted: 0, externalRequests: 0, diagnostic: null },
    browser: {
      desktop: { expected: 1, passed: 0, navigationCount: 0, retries: 0 },
      mobile390: { expected: 1, passed: 0, navigationCount: 0, retries: 0 },
    },
    database: { boundary: "marker-owned loopback disposable schema only", schemaCreated: false, fixtureCreated: false },
    cleanup: { fixture: "NOT_STARTED", server: false, browser: false, schema: "NOT_STARTED", tempRoot: false },
    ownership: { before: protectedDigestSnapshot(), after: null, protectedUnchanged: false, wp153ReceiptImmutable: false, wp154ReportImmutable: false, repositoryNextUntouched: false, stagedIndexEmpty: false, unknown: 0, mixedHunks: 0 },
    quality: { wp152Acceptance: "NOT_RUN", wp154Acceptance: "NOT_RUN", regressions: "NOT_RUN", componentUnit: "NOT_RUN", eslint: "NOT_RUN", typecheck: "NOT_RUN", diffCheck: "NOT_RUN" },
    sideEffects: { network: 0, database: 0, provider: 0, payuni: 0, staging: 0, production: 0, deployment: 0, server: 0, browser: 0, telemetry: 0 },
    scoreImpact: { CAT06: { before: 7.0, after: 7.0 }, total: { before: 71.5, after: 71.5 } },
    rawOutputPersisted: false,
    rawOutputExposed: false,
    sourceEnvContentsRead: false,
    sanitized: true,
  };
}

function writeReceipt(targetPath, receipt) {
  validateReceipt(receipt);
  const temporaryPath = `${targetPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    const roundTrip = JSON.parse(fs.readFileSync(temporaryPath, "utf8"));
    validateReceipt(roundTrip);
    fs.renameSync(temporaryPath, targetPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
}

function preflightDependencyBoundary(receipt) {
  if (runQuiet("git", ["diff", "--cached", "--name-only"], process.env).stdoutBytes > 0) throw new Error("PREFLIGHT_STAGED_INDEX_NOT_EMPTY");
  const wp153Receipt = JSON.parse(fs.readFileSync(path.join(root, ".ai-team/reports/wp153-public-unavailable-browser-receipt.json"), "utf8"));
  if (wp153Receipt.status !== "WP153_EXACT_NO_GO_NO_RETRY" || wp153Receipt.attempt !== 1 || wp153Receipt.server?.started !== 1 || wp153Receipt.browser?.desktop?.passed !== 0 || wp153Receipt.browser?.mobile390?.passed !== 0) throw new Error("PREFLIGHT_WP153_TERMINAL_INVALID");
  const wp154Report = JSON.parse(fs.readFileSync(path.join(root, ".ai-team/reports/wp154-wp153-readiness-contract-remediation.json"), "utf8"));
  if (wp154Report.solAcceptance !== "ACCEPT" || wp154Report.classification !== "WP154_WP153_READINESS_CONTRACT_REMEDIATED_READY" || wp154Report.realServerReadiness !== "NOT_VERIFIED" || wp154Report.browserEvidence !== "NOT_VERIFIED") throw new Error("PREFLIGHT_WP154_ACCEPTANCE_INVALID");
  const wp152Report = JSON.parse(fs.readFileSync(path.join(root, ".ai-team/reports/wp152-wp151-fixture-contract-remediation.json"), "utf8"));
  if (wp152Report.solAcceptance !== "ACCEPT" || wp152Report.classification !== "WP152_WP151_FIXTURE_CONTRACT_REMEDIATED_READY") throw new Error("PREFLIGHT_WP152_ACCEPTANCE_INVALID");
  if (!fs.existsSync(path.join(root, "node_modules", "next", "dist", "bin", "next")) || !fs.existsSync(path.join(root, "node_modules", "@playwright", "test"))) throw new Error("PREFLIGHT_DEPENDENCY_MISSING");
  receipt.quality.wp152Acceptance = "ACCEPT";
  receipt.quality.wp154Acceptance = "ACCEPT";
}

export {
  assertUnavailableCase,
  buildWp151FixtureScript,
  makeReceipt,
  normalizeLoopbackEndpoint,
  readinessTransition,
  validateReceipt,
};

export async function main() {
  const receipt = makeReceipt();
  const startedAt = new Date().toISOString();
  const env = syntheticEnvironment();
  const nextBefore = nextMetadataSnapshot();
  let fixtureCreateScript;
  let fixtureCleanupScript;
  let fixturePath;
  let slug;
  let container;
  let schemaCreated = false;
  let server;
  try {
    preflightDependencyBoundary(receipt);
    fixtureCreateScript = buildWp151FixtureScript();
    fixtureCleanupScript = fixtureScript(true);
    slug = extractFixtureSlug(fixtureCreateScript);
    copyMirror();
    const nodeTests = runQuiet(process.execPath, ["--test", "scripts/wp152-wp151-fixture-contract-remediation.test.mjs", "scripts/wp153-public-unavailable-browser-runner.test.mjs", "scripts/wp154-wp153-readiness-contract-remediation.test.mjs", "scripts/wp155-public-unavailable-browser-runner.test.mjs"], process.env, root);
    if (nodeTests.exitCode !== 0) throw new Error("DETERMINISTIC_REGRESSIONS_FAILED");
    receipt.quality.regressions = "WP152_WP153_WP154_WP155_PURE_TESTS_PASS";
    const vitest = path.join(tempRoot, "node_modules", ".bin", process.platform === "win32" ? "vitest.cmd" : "vitest");
    if (runQuiet(vitest, ["run", "src/components/team-funnel-public-page.test.tsx"], env, tempRoot).exitCode !== 0) throw new Error("COMPONENT_UNIT_FAILED");
    receipt.quality.componentUnit = "PASS";
    const eslint = path.join(tempRoot, "node_modules", ".bin", process.platform === "win32" ? "eslint.cmd" : "eslint");
    if (runQuiet(eslint, ["scripts/wp155-public-unavailable-browser-runner.mjs", "scripts/wp155-public-unavailable-browser-runner.test.mjs"], env, tempRoot).exitCode !== 0) throw new Error("SCOPED_ESLINT_FAILED");
    receipt.quality.eslint = "PASS";
    const tsc = path.join(tempRoot, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
    if (runQuiet(tsc, ["--noEmit"], env, tempRoot).exitCode !== 0) throw new Error("TYPECHECK_FAILED");
    receipt.quality.typecheck = "PASS";
    if (runQuiet("git", ["diff", "--check"], process.env).exitCode !== 0) throw new Error("DIFF_CHECK_FAILED");
    receipt.quality.diffCheck = "PASS";
    const containerProbe = spawnSync("docker", ["ps", "--filter", "ancestor=postgres:16-alpine", "--format", "{{.ID}}"], { encoding: "utf8", windowsHide: true });
    container = (containerProbe.stdout ?? "").trim().split(/\r?\n/).filter(Boolean)[0];
    if (containerProbe.status !== 0 || !container) throw new Error("PREFLIGHT_POSTGRES_CONTAINER_UNAVAILABLE");
    const create = psql(container, `CREATE SCHEMA "${schema}"; COMMENT ON SCHEMA "${schema}" IS '${marker}';`, env);
    if (create.exitCode !== 0) throw new Error("DISPOSABLE_SCHEMA_CREATE_FAILED");
    schemaCreated = true;
    receipt.database.schemaCreated = true;
    const prisma = path.join(tempRoot, "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
    if (runQuiet(prisma, ["migrate", "deploy", "--schema", "prisma/schema.prisma"], env, tempRoot).exitCode !== 0) throw new Error("DISPOSABLE_MIGRATION_FAILED");
    fixturePath = path.join(tempRoot, "wp155-fixture.mjs");
    fs.writeFileSync(fixturePath, fixtureCreateScript, "utf8");
    if (runQuiet(process.execPath, [fixturePath], env, tempRoot).exitCode !== 0) throw new Error("FIXTURE_EXACT_NO_GO_NO_RETRY");
    receipt.database.fixtureCreated = true;
    fs.writeFileSync(fixturePath, fixtureCleanupScript, "utf8");
    server = spawn(process.execPath, [path.join(tempRoot, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: tempRoot, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    receipt.attempt = 1;
    receipt.server.started = 1;
    receipt.server.readinessWindowsAttempted = 1;
    const diagnostics = { classifications: [], lineCount: 0, markerSeen: false, probeSeen: false };
    attachSanitizedStream(server, diagnostics);
    const baseURL = normalizeLoopbackEndpoint(`http://127.0.0.1:${port}`);
    const readiness = await waitForServer(baseURL, server, diagnostics);
    receipt.server.ready = readiness.state === READINESS_STATES.READY;
    receipt.server.diagnostic = { phase: readiness.state, lineCount: diagnostics.lineCount, classifications: diagnostics.classifications };
    const desktop = await assertUnavailableCase(baseURL, slug, { name: "desktop", width: 1280, height: 800 });
    receipt.browser.desktop.navigationCount = 1;
    receipt.browser.desktop.passed = 1;
    receipt.browser.desktop.result = desktop;
    const mobile = await assertUnavailableCase(baseURL, slug, { name: "mobile390", width: 390, height: 844 });
    receipt.browser.mobile390.navigationCount = 1;
    receipt.browser.mobile390.passed = 1;
    receipt.browser.mobile390.result = mobile;
    receipt.status = "WP155_PUBLIC_UNAVAILABLE_BROWSER_VERIFIED";
    receipt.scoreImpact = { CAT06: { before: 7.0, after: 7.5 }, total: { before: 71.5, after: 72.0 } };
  } catch (error) {
    receipt.failure = error instanceof Error ? (error.message.includes("NON_LOOPBACK") ? "NON_LOOPBACK_REQUEST_EXACT_NO_GO" : "WP155_EXACT_NO_GO_NO_RETRY") : "WP155_EXACT_NO_GO_NO_RETRY";
    receipt.server.diagnostic = receipt.server.diagnostic ?? (error instanceof Error && /SERVER|MODULE|SOURCE|PORT/.test(error.message) ? { phase: "NOT_VERIFIED", classifications: [], lineCount: 0 } : null);
  } finally {
    if (activeBrowser) {
      await activeBrowser.close().catch(() => undefined);
      activeBrowser = null;
      receipt.cleanup.browser = true;
    }
    if (server?.pid) {
      if (process.platform === "win32") runQuiet("taskkill", ["/PID", String(server.pid), "/T", "/F"], process.env);
      else server.kill("SIGTERM");
      receipt.cleanup.server = true;
    }
    if (fixturePath && receipt.database.fixtureCreated) {
      fs.writeFileSync(fixturePath, fixtureCleanupScript, "utf8");
      receipt.cleanup.fixture = runQuiet(process.execPath, [fixturePath], env, tempRoot).exitCode === 0 ? "PASS" : "FAIL";
    } else {
      receipt.cleanup.fixture = "NOT_NEEDED";
    }
    if (schemaCreated && container) {
      const drop = psql(container, `DROP SCHEMA IF EXISTS "${schema}" CASCADE;`, env);
      receipt.cleanup.schema = drop.exitCode === 0 ? "PASS" : "FAIL";
    } else {
      receipt.cleanup.schema = "NOT_NEEDED";
    }
    if (fs.existsSync(tempRoot)) {
      if (!path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()))) throw new Error("TEMP_ROOT_BOUNDARY_INVALID");
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
    receipt.cleanup.tempRoot = !fs.existsSync(tempRoot);
    receipt.ownership.after = protectedDigestSnapshot();
    receipt.ownership.protectedUnchanged = JSON.stringify(receipt.ownership.before) === JSON.stringify(receipt.ownership.after);
    receipt.ownership.wp153ReceiptImmutable = receipt.ownership.before[".ai-team/reports/wp153-public-unavailable-browser-receipt.json"] === receipt.ownership.after[".ai-team/reports/wp153-public-unavailable-browser-receipt.json"];
    receipt.ownership.wp154ReportImmutable = receipt.ownership.before[".ai-team/reports/wp154-wp153-readiness-contract-remediation.json"] === receipt.ownership.after[".ai-team/reports/wp154-wp153-readiness-contract-remediation.json"];
    receipt.ownership.repositoryNextUntouched = JSON.stringify(nextBefore) === JSON.stringify(nextMetadataSnapshot());
    receipt.ownership.stagedIndexEmpty = runQuiet("git", ["diff", "--cached", "--name-only"], process.env).stdoutBytes === 0;
    if (receipt.status === "WP155_PUBLIC_UNAVAILABLE_BROWSER_VERIFIED" && (receipt.cleanup.fixture !== "PASS" || receipt.cleanup.schema !== "PASS" || !receipt.cleanup.tempRoot)) receipt.status = "WP155_EXACT_NO_GO_NO_RETRY";
    if (receipt.status === "WP155_EXACT_NO_GO_NO_RETRY") receipt.scoreImpact = { CAT06: { before: 7.0, after: 7.0 }, total: { before: 71.5, after: 71.5 } };
    receipt.finishedAt = new Date().toISOString();
    receipt.startedAt = startedAt;
    const targetPath = path.join(root, ".ai-team", "reports", "wp155-public-unavailable-browser-receipt.json");
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    writeReceipt(targetPath, receipt);
    process.stdout.write(`${JSON.stringify({ status: receipt.status, attempt: receipt.attempt, serverStarted: receipt.server.started, serverReady: receipt.server.ready, desktopPassed: receipt.browser.desktop.passed, mobile390Passed: receipt.browser.mobile390.passed, cleanup: receipt.cleanup, rawOutputPersisted: receipt.rawOutputPersisted })}\n`);
  }
  if (receipt.status === "WP155_EXACT_NO_GO_NO_RETRY") process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();
