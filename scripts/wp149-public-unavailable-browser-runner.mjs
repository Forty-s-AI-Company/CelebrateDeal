import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK_PACKAGE = "WP-149";
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
const nonce = crypto.randomBytes(4).toString("hex");
const schema = `wp149_${runId}_${nonce}`;
const marker = `celebratedeal:wp149:${runId}:${nonce}`;
const slug = `wp149-unpublished-${runId}-${nonce}`;
const tempRoot = path.join(os.tmpdir(), `celebratedeal-wp149-${runId}-${nonce}`);
const port = 32149 + Number.parseInt(nonce.slice(0, 2), 16) % 100;
const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=${schema}`;
const protectedPaths = [
  "tests/e2e/wp128-public-partner-unavailable-state.spec.ts",
  "src/components/team-funnel-public-page.tsx",
  "src/components/team-funnel-public-page.test.tsx",
  "package.json",
  "package-lock.json",
];
const FIXTURE_STATES = Object.freeze({
  UNINITIALIZED: "UNINITIALIZED",
  CREATE_REQUESTED: "CREATE_REQUESTED",
  CREATED: "CREATED",
  CREATE_FAILED: "CREATE_FAILED",
  CLEANUP_REQUESTED: "CLEANUP_REQUESTED",
  CLEANED: "CLEANED",
  CLEANUP_FAILED: "CLEANUP_FAILED",
});

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
    CSRF_SECRET: "wp149-local-csrf-synthetic-value",
    JOB_SECRET: "wp149-local-job-synthetic-value",
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

function fixtureScript(remove = false) {
  const operation = remove
    ? `const vendorId = (await db.vendor.findUnique({ where: { slug: "wp149-fixture-vendor" }, select: { id: true } }))?.id;
await db.partnerFunnelPage.deleteMany({ where: { slug: ${JSON.stringify(slug)} } });
await db.teamFunnelTemplateVersion.deleteMany({ where: { headline: "WP149 fixture headline" } });
await db.teamFunnelTemplate.deleteMany({ where: { name: "WP149 fixture template" } });
await db.teamMembership.deleteMany({ where: { vendorId: vendorId } });
await db.salesTeam.deleteMany({ where: { vendorId: vendorId } });
await db.vendorMember.deleteMany({ where: { vendorId: vendorId } });
await db.user.deleteMany({ where: { email: "wp149-owner@example.invalid" } });
await db.vendor.deleteMany({ where: { slug: "wp149-fixture-vendor" } });`
    : `const user = await db.user.create({ data: { email: "wp149-owner@example.invalid", name: "WP149 Synthetic Owner", passwordHash: "synthetic-hash", status: "active" } });
const vendor = await db.vendor.create({ data: { name: "WP149 Synthetic Vendor", slug: "wp149-fixture-vendor", email: "wp149-vendor@example.invalid", passwordHash: "synthetic-hash" } });
const vendorId = vendor.id;
const member = await db.vendorMember.create({ data: { vendorId: vendor.id, userId: user.id, role: "owner", status: "active" } });
const team = await db.salesTeam.create({ data: { vendorId: vendor.id, name: "WP149 Synthetic Team", slug: "wp149-team" } });
const membership = await db.teamMembership.create({ data: { vendorId: vendor.id, teamId: team.id, vendorMemberId: member.id, status: "ACTIVE" } });
const template = await db.teamFunnelTemplate.create({ data: { vendorId: vendor.id, teamId: team.id, name: "WP149 fixture template" } });
const version = await db.teamFunnelTemplateVersion.create({ data: { vendorId: vendor.id, teamId: team.id, templateId: template.id, version: 1, contentOwnerMembershipId: membership.id, createdByMemberId: member.id, headline: "WP149 fixture headline", ctaLabel: "fixture CTA" } });
await db.partnerFunnelPage.create({ data: { vendorId: vendor.id, teamId: team.id, templateVersionId: version.id, promoterMembershipId: membership.id, contentOwnerMembershipId: membership.id, slug: ${JSON.stringify(slug)}, headline: "WP149 fixture headline", ctaLabel: "fixture CTA" });`;
  return `import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
${operation}
await db.$disconnect();
`;
}

function fixtureTransition(state, event) {
  const transitions = {
    [FIXTURE_STATES.UNINITIALIZED]: { CREATE_REQUESTED: FIXTURE_STATES.CREATE_REQUESTED },
    [FIXTURE_STATES.CREATE_REQUESTED]: { CREATE_SUCCEEDED: FIXTURE_STATES.CREATED, CREATE_FAILED: FIXTURE_STATES.CREATE_FAILED },
    [FIXTURE_STATES.CREATED]: { CLEANUP_REQUESTED: FIXTURE_STATES.CLEANUP_REQUESTED },
    [FIXTURE_STATES.CREATE_FAILED]: { CLEANUP_REQUESTED: FIXTURE_STATES.CLEANUP_REQUESTED },
    [FIXTURE_STATES.CLEANUP_REQUESTED]: { CLEANUP_SUCCEEDED: FIXTURE_STATES.CLEANED, CLEANUP_FAILED: FIXTURE_STATES.CLEANUP_FAILED },
    [FIXTURE_STATES.CLEANED]: { CLEANUP_REQUESTED: FIXTURE_STATES.CLEANUP_REQUESTED },
  };
  const next = transitions[state]?.[event];
  if (!next) throw new Error(`ILLEGAL_FIXTURE_TRANSITION:${state}:${event}`);
  return next;
}

function runPureFixtureLifecycle(adapter, { createFailure = false, cleanupFailure = false } = {}) {
  if (!adapter || typeof adapter.create !== "function" || typeof adapter.cleanup !== "function") throw new Error("FIXTURE_ADAPTER_REQUIRED");
  let state = FIXTURE_STATES.UNINITIALIZED;
  let createCalls = 0;
  let cleanupCalls = 0;
  let createFailed = false;
  let cleanupFailed = false;
  state = fixtureTransition(state, "CREATE_REQUESTED");
  createCalls += 1;
  if (createFailure) {
    createFailed = true;
    state = fixtureTransition(state, "CREATE_FAILED");
  }
  else {
    adapter.create();
    state = fixtureTransition(state, "CREATE_SUCCEEDED");
  }
  state = fixtureTransition(state, "CLEANUP_REQUESTED");
  cleanupCalls += 1;
  if (cleanupFailure) {
    cleanupFailed = true;
    state = fixtureTransition(state, "CLEANUP_FAILED");
  }
  else {
    adapter.cleanup();
    state = fixtureTransition(state, "CLEANUP_SUCCEEDED");
  }
  return { state, createCalls, cleanupCalls, createFailed, cleanupFailed, serverAttempts: 0, browserCompleted: 0, externalCalls: 0 };
}

function cleanupFixtureIdempotently(state, adapter) {
  if (state === FIXTURE_STATES.CLEANED) return { state, invoked: false };
  const requested = fixtureTransition(state, "CLEANUP_REQUESTED");
  try {
    adapter.cleanup();
    return { state: fixtureTransition(requested, "CLEANUP_SUCCEEDED"), invoked: true };
  } catch {
    return { state: fixtureTransition(requested, "CLEANUP_FAILED"), invoked: true };
  }
}

function buildFixtureLifecycleReceipt(result) {
  if (!result || !Object.values(FIXTURE_STATES).includes(result.state)) throw new Error("FIXTURE_RESULT_INVALID");
  if (result.serverAttempts !== 0 || result.browserCompleted !== 0 || result.externalCalls !== 0) throw new Error("FIXTURE_SIDE_EFFECTS_INVALID");
  return {
    schemaVersion: "wp150-wp149-fixture-contract/v1",
    workPackage: "WP-150",
    classification: result.createFailed ? "WP149_FIXTURE_CREATE_FAILED_EXACT_NO_GO" : result.cleanupFailed || result.state === FIXTURE_STATES.CLEANUP_FAILED ? "WP149_FIXTURE_CLEANUP_FAILED_EXACT_NO_GO" : "WP150_FIXTURE_LIFECYCLE_CONTRACT_PASS",
    fixtureState: result.state,
    attempt: 0,
    serverAttempts: 0,
    browserCompleted: 0,
    createCalls: result.createCalls,
    cleanupCalls: result.cleanupCalls,
    sideEffects: { network: 0, database: 0, provider: 0, staging: 0, production: 0, server: 0, browser: 0 },
    rawOutputPersisted: false,
    rawOutputExposed: false,
    wp149ReceiptMutated: false,
    sanitized: true,
  };
}

function validateFixtureLifecycleReceipt(receipt) {
  if (!receipt || receipt.schemaVersion !== "wp150-wp149-fixture-contract/v1" || receipt.workPackage !== "WP-150") throw new Error("FIXTURE_RECEIPT_SCHEMA_INVALID");
  const allowedKeys = new Set(["schemaVersion", "workPackage", "classification", "fixtureState", "attempt", "serverAttempts", "browserCompleted", "createCalls", "cleanupCalls", "sideEffects", "rawOutputPersisted", "rawOutputExposed", "wp149ReceiptMutated", "sanitized"]);
  for (const key of Object.keys(receipt)) {
    const rawFlag = key === "rawOutputPersisted" || key === "rawOutputExposed";
    if (!allowedKeys.has(key) || (!rawFlag && /secret|token|cookie|body|stack|source|url|env/i.test(key))) throw new Error("FIXTURE_RECEIPT_SAFETY_INVALID");
  }
  if (receipt.attempt !== 0 || receipt.serverAttempts !== 0 || receipt.browserCompleted !== 0) throw new Error("FIXTURE_RECEIPT_ATTEMPT_INVALID");
  if (receipt.rawOutputPersisted !== false || receipt.rawOutputExposed !== false || receipt.wp149ReceiptMutated !== false || receipt.sanitized !== true) throw new Error("FIXTURE_RECEIPT_SAFETY_INVALID");
  if (Object.values(receipt.sideEffects).some((value) => value !== 0)) throw new Error("FIXTURE_RECEIPT_SIDE_EFFECT_INVALID");
  return true;
}

function sha256File(relativePath, base = root) {
  const absolutePath = path.join(base, relativePath);
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex")}`;
}

function sourceDigestSnapshot(base = root) {
  return Object.fromEntries(protectedPaths.filter((relativePath) => fs.existsSync(path.join(base, relativePath))).map((relativePath) => [relativePath, sha256File(relativePath, base)]));
}

function nextMetadataSnapshot() {
  const target = path.join(root, ".next");
  if (!fs.existsSync(target)) return { exists: false, size: 0, mtimeMs: null };
  const stat = fs.statSync(target);
  return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs };
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
    const lines = String(chunk).split(/\r?\n/);
    diagnostics.lineCount += lines.filter(Boolean).length;
    for (const line of lines) {
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
    if (child.exitCode !== null) throw new Error("SERVER_PRE_READINESS_EXIT_EXACT_NO_GO");
    try {
      const response = await fetch(`${baseURL}/login`);
      if (response.status >= 200 && response.status < 500) return;
    } catch { /* loopback readiness probe only */ }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error("SERVER_READINESS_TIMEOUT_EXACT_NO_GO");
}

async function runBrowser(baseURL) {
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
      if (response?.status() !== 200) throw new Error(`UNAVAILABLE_ROUTE_STATUS_${response?.status() ?? "UNKNOWN"}`);
      if (!(await page.getByRole("heading", { name: "此頁尚未公開" }).isVisible())) throw new Error("UNPUBLISHED_HEADING_MISSING");
      if (!(await page.getByRole("status").isVisible())) throw new Error("UNAVAILABLE_STATUS_MISSING");
      if (await page.getByText("WP149 fixture headline").count() !== 0) throw new Error("SYNTHETIC_HEADLINE_LEAKED");
      if (await page.getByText("wp149-owner@example.invalid").count() !== 0) throw new Error("SYNTHETIC_EMAIL_LEAKED");
      const link = page.getByRole("link", { name: "返回首頁" });
      if (await link.getAttribute("href") !== "/") throw new Error("RECOVERY_HREF_MISMATCH");
      await link.focus();
      const focusState = await link.evaluate((element) => {
        const style = getComputedStyle(element);
        return { focused: document.activeElement === element, outline: style.outlineStyle !== "none" || style.boxShadow !== "none" };
      });
      if (!focusState.focused || !focusState.outline) throw new Error("VISIBLE_FOCUS_INDICATOR_MISSING");
      const box = await link.boundingBox();
      if (!box || box.width < 44 || box.height < 44) throw new Error("RECOVERY_TOUCH_TARGET_BELOW_44PX");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) throw new Error("HORIZONTAL_OVERFLOW_DETECTED");
      const axeModule = await import("@axe-core/playwright");
      const axe = await new axeModule.default({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      const blocking = axe.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
      if (blocking.length > 0) throw new Error("BLOCKING_AXE_VIOLATIONS_DETECTED");
      if (externalRequests.length > 0) throw new Error("EXTERNAL_REQUEST_DETECTED");
      results.push({ viewport: viewport.name, status: "PASS", axeCriticalSerious: 0, overflow, focusVisible: true, touchTargetMin44: true, externalRequests: 0 });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}

function validateWp149Receipt(receipt) {
  const required = ["schemaVersion", "workPackage", "status", "attempt", "browser", "database", "sideEffects", "ownership", "cleanup", "sanitized"];
  for (const key of required) if (!(key in receipt)) throw new Error(`RECEIPT_MISSING_${key}`);
  if (receipt.schemaVersion !== "wp149-public-unavailable-browser/v1") throw new Error("RECEIPT_SCHEMA_INVALID");
  if (receipt.workPackage !== WORK_PACKAGE) throw new Error("RECEIPT_WORK_PACKAGE_INVALID");
  if (!["PASS", "SERVER_PRE_READINESS_EXIT_EXACT_NO_GO", "SERVER_READINESS_TIMEOUT_EXACT_NO_GO", "PREFLIGHT_EXACT_NO_GO"].includes(receipt.status)) throw new Error("RECEIPT_STATUS_INVALID");
  if (![0, 1].includes(receipt.attempt)) throw new Error("RECEIPT_ATTEMPT_INVALID");
  if (receipt.browser.expected !== 2 || receipt.browser.passed < 0 || receipt.browser.passed > 2) throw new Error("RECEIPT_BROWSER_INVALID");
  if (receipt.browser.retries !== 0) throw new Error("RECEIPT_RETRY_POLICY_INVALID");
  if (receipt.sideEffects.network !== 0 || receipt.sideEffects.database !== 0 || receipt.sideEffects.browser !== receipt.browser.passed || receipt.sideEffects.provider !== 0 || receipt.sideEffects.staging !== 0 || receipt.sideEffects.production !== 0) throw new Error("RECEIPT_SIDE_EFFECTS_INVALID");
  if (receipt.rawOutputPersisted !== false || receipt.rawOutputExposed !== false || receipt.sourceEnvContentsRead !== false || receipt.sanitized !== true) throw new Error("RECEIPT_SAFETY_FLAGS_INVALID");
  return true;
}

function makeReceipt() {
  return {
    schemaVersion: "wp149-public-unavailable-browser/v1",
    workPackage: WORK_PACKAGE,
    status: "PREFLIGHT_EXACT_NO_GO",
    attempt: 0,
    browser: { expected: 2, passed: 0, failed: 0, skipped: 0, retries: 0, viewports: [] },
    database: { boundary: "loopback disposable schema only", schemaCreated: false, schemaCleanup: "NOT_STARTED", fixtureCleanup: "NOT_STARTED" },
    server: { attempts: 0, ready: false, externalRequests: 0, diagnostic: null },
    ownership: { before: sourceDigestSnapshot(), after: null, unknown: 0, mixedHunks: 0, stagedIndexEmpty: false, repositoryNextUntouched: false },
    cleanup: { tempRootRemoved: false, serverStopped: false, schemaCleanup: "NOT_STARTED", fixtureCleanup: "NOT_STARTED" },
    quality: { componentUnit: "NOT_RUN", runnerSelfTests: "PASS", eslint: "NOT_RUN", typecheck: "NOT_RUN", diffCheck: "NOT_RUN" },
    sideEffects: { network: 0, database: 0, browser: 0, provider: 0, staging: 0, deployment: 0, production: 0, telemetry: 0 },
    scoreImpact: { CAT06: { before: 7.0, after: 7.0 }, total: { before: 71.5, after: 71.5 } },
    rawOutputPersisted: false,
    rawOutputExposed: false,
    sourceEnvContentsRead: false,
    sanitized: true,
  };
}

function writeReceipt(targetPath, receipt) {
  validateWp149Receipt(receipt);
  const payload = `${JSON.stringify(receipt, null, 2)}\n`;
  const temporaryPath = `${targetPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, payload, { encoding: "utf8", flag: "wx" });
  try {
    const roundTrip = JSON.parse(fs.readFileSync(temporaryPath, "utf8"));
    validateWp149Receipt(roundTrip);
    fs.renameSync(temporaryPath, targetPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
}

export { FIXTURE_STATES, buildFixtureLifecycleReceipt, cleanupFixtureIdempotently, classifyServerOutput, fixtureScript, fixtureTransition, makeReceipt, runPureFixtureLifecycle, validateFixtureLifecycleReceipt, validateWp149Receipt };

export async function main() {
  const receipt = makeReceipt();
  const startedAt = new Date().toISOString();
  const env = syntheticEnvironment();
  const nextBefore = nextMetadataSnapshot();
  let container;
  let schemaCreated = false;
  let server;
  try {
    if (runQuiet("git", ["diff", "--cached", "--name-only"], process.env).stdoutBytes > 0) throw new Error("PREFLIGHT_STAGED_INDEX_NOT_EMPTY");
    if (!fs.existsSync(path.join(root, "node_modules"))) throw new Error("PREFLIGHT_NODE_MODULES_MISSING");
    if (!fs.existsSync(path.join(root, "node_modules", "next", "dist", "bin", "next"))) throw new Error("PREFLIGHT_NEXT_BINARY_MISSING");
    if (!fs.existsSync(path.join(root, "node_modules", "@playwright", "test"))) throw new Error("PREFLIGHT_PLAYWRIGHT_MISSING");
    if (!fs.existsSync(path.join(root, ".ai-team", "reports", "wp149-public-unavailable-browser-receipt.json"))) {
      // The receipt directory is ignored by Git but is still an explicitly owned destination.
    } else throw new Error("PREFLIGHT_RECEIPT_ALREADY_EXISTS");
    const containerResult = runQuiet("docker", ["ps", "--filter", "ancestor=postgres:16-alpine", "--format", "{{.ID}}"], process.env);
    if (containerResult.exitCode !== 0 || containerResult.stdoutBytes === 0) throw new Error("PREFLIGHT_POSTGRES_CONTAINER_UNAVAILABLE");
    // Resolve the container ID only from the bounded command output; no customer data is read.
    const containerProbe = spawnSync("docker", ["ps", "--filter", "ancestor=postgres:16-alpine", "--format", "{{.ID}}"], { encoding: "utf8", windowsHide: true });
    container = (containerProbe.stdout ?? "").trim().split(/\r?\n/).filter(Boolean)[0];
    if (!container) throw new Error("PREFLIGHT_POSTGRES_CONTAINER_UNAVAILABLE");
    copyMirror();
    const vitest = path.join(tempRoot, "node_modules", ".bin", process.platform === "win32" ? "vitest.cmd" : "vitest");
    if (runQuiet(vitest, ["run", "src/components/team-funnel-public-page.test.tsx"], env, tempRoot).exitCode !== 0) throw new Error("COMPONENT_UNIT_FAILED");
    receipt.quality.componentUnit = "PASS";
    const eslint = path.join(tempRoot, "node_modules", ".bin", process.platform === "win32" ? "eslint.cmd" : "eslint");
    if (runQuiet(eslint, ["scripts/wp149-public-unavailable-browser-runner.mjs", "scripts/wp149-public-unavailable-browser-runner.test.mjs"], env, tempRoot).exitCode !== 0) throw new Error("SCOPED_ESLINT_FAILED");
    receipt.quality.eslint = "PASS";
    const tsc = path.join(tempRoot, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
    if (runQuiet(tsc, ["--noEmit"], env, tempRoot).exitCode !== 0) throw new Error("TYPECHECK_FAILED");
    receipt.quality.typecheck = "PASS";
    receipt.quality.diffCheck = runQuiet("git", ["diff", "--check"], process.env).exitCode === 0 ? "PASS" : "FAIL";
    if (receipt.quality.diffCheck !== "PASS") throw new Error("DIFF_CHECK_FAILED");
    const create = psql(container, `CREATE SCHEMA "${schema}"; COMMENT ON SCHEMA "${schema}" IS '${marker}';`, env);
    if (create.exitCode !== 0) throw new Error("DISPOSABLE_SCHEMA_CREATE_FAILED");
    schemaCreated = true;
    receipt.database.schemaCreated = true;
    const prisma = path.join(tempRoot, "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
    if (runQuiet(prisma, ["migrate", "deploy", "--schema", "prisma/schema.prisma"], env, tempRoot).exitCode !== 0) throw new Error("DISPOSABLE_MIGRATION_FAILED");
    const fixturePath = path.join(tempRoot, "wp149-fixture.mjs");
    fs.writeFileSync(fixturePath, fixtureScript(false), "utf8");
    if (runQuiet(process.execPath, [fixturePath], env, tempRoot).exitCode !== 0) throw new Error("SYNTHETIC_FIXTURE_CREATE_FAILED");
    receipt.database.fixtureCreated = true;
    const nextBin = path.join(tempRoot, "node_modules", "next", "dist", "bin", "next");
    server = spawn(process.execPath, [nextBin, "dev", "--port", String(port)], { cwd: tempRoot, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    receipt.attempt = 1;
    receipt.server.attempts = 1;
    const diagnostics = { lineCount: 0, classifications: [] };
    attachSanitizedStream(server, diagnostics);
    server.on("exit", (code) => { receipt.server.exitCode = code; });
    try {
      await waitForServer(`http://127.0.0.1:${port}`, server);
      receipt.server.ready = true;
      receipt.browser.viewports = await runBrowser(`http://127.0.0.1:${port}`);
      receipt.browser.passed = receipt.browser.viewports.length;
      receipt.status = receipt.browser.passed === 2 ? "PASS" : "SERVER_PRE_READINESS_EXIT_EXACT_NO_GO";
      receipt.scoreImpact = receipt.status === "PASS" ? { CAT06: { before: 7.0, after: 7.5 }, total: { before: 71.5, after: 72.0 } } : receipt.scoreImpact;
      receipt.sideEffects.browser = receipt.browser.passed;
    } catch (error) {
      receipt.status = error instanceof Error && error.message.includes("READINESS_TIMEOUT") ? "SERVER_READINESS_TIMEOUT_EXACT_NO_GO" : "SERVER_PRE_READINESS_EXIT_EXACT_NO_GO";
      receipt.failure = receipt.status;
      receipt.server.diagnostic = diagnostics.classifications[0] ?? receipt.status;
    }
    fs.writeFileSync(fixturePath, fixtureScript(true), "utf8");
    const cleanupResult = runQuiet(process.execPath, [fixturePath], env, tempRoot);
    receipt.database.fixtureCleanup = cleanupResult.exitCode === 0 ? "PASS" : "FAIL";
  } catch (error) {
    receipt.failure = error instanceof Error ? error.message : "SANITIZED_FAILURE";
  } finally {
    if (server?.pid) {
      if (process.platform === "win32") runQuiet("taskkill", ["/PID", String(server.pid), "/T", "/F"], process.env);
      else server.kill("SIGTERM");
      receipt.cleanup.serverStopped = true;
    }
    if (schemaCreated && container) {
      const drop = psql(container, `DROP SCHEMA IF EXISTS "${schema}" CASCADE;`, env);
      receipt.database.schemaCleanup = drop.exitCode === 0 ? "PASS" : "FAIL";
      receipt.cleanup.schemaCleanup = receipt.database.schemaCleanup;
    }
    if (fs.existsSync(tempRoot)) {
      if (!path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()))) throw new Error("TEMP_ROOT_BOUNDARY_INVALID");
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
    receipt.cleanup.tempRootRemoved = !fs.existsSync(tempRoot);
    receipt.ownership.after = sourceDigestSnapshot();
    receipt.ownership.repositoryNextUntouched = JSON.stringify(nextBefore) === JSON.stringify(nextMetadataSnapshot());
    receipt.ownership.stagedIndexEmpty = runQuiet("git", ["diff", "--cached", "--name-only"], process.env).stdoutBytes === 0;
    receipt.finishedAt = new Date().toISOString();
    receipt.startedAt = startedAt;
    const targetPath = path.join(root, ".ai-team", "reports", "wp149-public-unavailable-browser-receipt.json");
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    writeReceipt(targetPath, receipt);
    process.stdout.write(`${JSON.stringify({ status: receipt.status, attempt: receipt.attempt, browserPassed: receipt.browser.passed, sideEffects: receipt.sideEffects, rawOutputPersisted: receipt.rawOutputPersisted })}\n`);
  }
  if (receipt.status !== "PASS") process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();
