import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const evidenceRoot = path.join(root, "docs", "ai-team", "evidence");
const image = "postgres:16-alpine";
const runNamePattern = /^celebratedeal-g7-form-builder-browser-[a-f0-9]{16}$/u;
const schemaPattern = /^g7_(?:53|54)_browser_[a-f0-9]{16}$/u;
const migrationPattern = /^\d{12,14}_[a-z0-9_]+$/u;
const sourceDigestPaths = [
  "prisma/schema.prisma",
  "src/app/(app)/forms/new/page.tsx",
  "src/app/(app)/forms/[id]/edit/page.tsx",
  "src/app/actions/form-actions.ts",
  "src/components/form-builder.tsx",
  "src/components/form-builder-client.tsx",
  "src/components/use-registration-form-draft.ts",
  "src/components/form-field-editor.tsx",
  "src/components/form-preview.tsx",
  "src/components/lead-form.tsx",
  "src/components/live-playback.tsx",
  "src/components/team-funnel-public-page.tsx",
  "src/app/api/form-submissions/route.ts",
  "src/app/form/[slug]/page.tsx",
  "src/app/(viewer)/live/[slug]/page.tsx",
  "src/lib/registration-form-builder.ts",
  "src/lib/registration-form-answers.ts",
  "src/lib/registration-form-fields.ts",
  "src/lib/registration-form-input.ts",
  "src/lib/registration-form-draft.ts",
  "src/lib/team-funnel-public-page.ts",
  "src/lib/auth.ts",
  "src/lib/csrf.ts",
  "src/app/(app)/forms/page.tsx",
  "src/app/(app)/forms/[id]/submissions/page.tsx",
  "src/app/(app)/forms/[id]/submissions/loading.tsx",
  "src/app/actions/form-submission-search-actions.ts",
  "src/components/form-submissions-workbench.tsx",
  "src/lib/form-submission-search.ts",
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

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function safeSourceDigest() {
  const digest = crypto.createHash("sha256");
  for (const relativePath of sourceDigestPaths) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) throw new Error(`source-digest-path-missing:${relativePath}`);
    digest.update(relativePath).update("\0").update(fs.readFileSync(absolutePath)).update("\0");
  }
  const migrationsRoot = path.join(root, "prisma", "migrations");
  for (const name of canonicalMigrations()) {
    digest.update(`prisma/migrations/${name}/migration.sql`).update("\0")
      .update(fs.readFileSync(path.join(migrationsRoot, name, "migration.sql"))).update("\0");
  }
  return digest.digest("hex");
}

export function canonicalMigrations() {
  return fs.readdirSync(path.join(root, "prisma", "migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && migrationPattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function ignoredMirrorPath(relativePath) {
  const parts = relativePath.replaceAll("\\", "/").split("/");
  return !relativePath
    || parts.some((part) => [".git", ".next", "node_modules", ".ai-team", "test-results", "playwright-report", "tmp"].includes(part))
    || parts.some((part) => part === ".env" || part.startsWith(".env."));
}

function copySourceTree(source, destination, relative = "") {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (ignoredMirrorPath(childRelative)) continue;
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    const stat = fs.lstatSync(sourcePath);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) copySourceTree(sourcePath, destinationPath, childRelative);
    if (stat.isFile()) fs.copyFileSync(sourcePath, destinationPath);
  }
}

function linkNodeModules(mirror) {
  const source = path.join(root, "node_modules");
  const target = path.join(mirror, "node_modules");
  if (!fs.existsSync(source)) throw new Error("node-modules-missing");
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".prisma" || entry.name === "@prisma") continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.name === "next") fs.cpSync(from, to, { recursive: true, dereference: false });
    else fs.symlinkSync(from, to, fs.statSync(from).isDirectory() ? "junction" : "file");
  }
  const sourcePrisma = path.join(source, "@prisma");
  const targetPrisma = path.join(target, "@prisma");
  fs.mkdirSync(targetPrisma, { recursive: true });
  for (const entry of fs.readdirSync(sourcePrisma, { withFileTypes: true })) {
    const from = path.join(sourcePrisma, entry.name);
    const to = path.join(targetPrisma, entry.name);
    if (entry.name === "client") fs.cpSync(from, to, { recursive: true, dereference: false });
    else fs.symlinkSync(from, to, fs.statSync(from).isDirectory() ? "junction" : "file");
  }
  return fs.existsSync(path.join(targetPrisma, "client"));
}

function writePrismaConfig(mirror) {
  const config = path.join(mirror, "prisma.g7-form-builder.config.mjs");
  fs.writeFileSync(config, [
    'import { createRequire } from "node:module";',
    'const require = createRequire(import.meta.url);',
    'const { defineConfig } = require("prisma/config");',
    'export default defineConfig({ schema: "prisma/schema.prisma", engine: "classic", migrations: { path: "prisma/migrations" }, datasource: { url: process.env.DATABASE_URL } });',
    "",
  ].join("\n"), "utf8");
  return config;
}

function writeNetworkGuard(tempRoot) {
  const guard = path.join(tempRoot, "loopback-network-guard.cjs");
  fs.writeFileSync(guard, [
    'const allowed = new Set(["127.0.0.1", "localhost", "::1"]);',
    'const hostname = (value) => { try { if (typeof value === "string") return new URL(value).hostname; if (value && typeof value === "object") return String(value.hostname || value.host || "").replace(/^\\[/, "").replace(/\\]$/, "").split(":")[0]; } catch {} return null; };',
    'const local = (value) => { const valueHost = hostname(value); return valueHost === null || allowed.has(valueHost); };',
    'const denied = () => { throw new Error("G7_FORM_BUILDER_EXTERNAL_NETWORK_DENIED"); };',
    'for (const name of ["http", "https"]) { const moduleValue = require(name); const original = moduleValue.request; moduleValue.request = function (...args) { if (!local(args[0])) return denied(); return original.apply(this, args); }; moduleValue.get = function (...args) { const request = moduleValue.request.apply(this, args); request.end(); return request; }; }',
    'const net = require("net"); const connect = net.connect; net.connect = net.createConnection = function (...args) { if (!local(args[0])) return denied(); return connect.apply(this, args); };',
    'if (global.fetch) { const fetch = global.fetch; global.fetch = function (input, init) { if (!local(input)) return Promise.reject(new Error("G7_FORM_BUILDER_EXTERNAL_NETWORK_DENIED")); return fetch(input, init); }; }',
    "",
  ].join("\n"), "utf8");
  return guard;
}

function allocatePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(null));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : null));
    });
  });
}

export function safeEnvironment({ tempRoot, port, databaseUrl, schema, screenshotDirectory, networkGuard, playwrightBrowsersPath }) {
  return {
    PATH: process.env.PATH ?? process.env.Path ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    WINDIR: process.env.WINDIR ?? "",
    ComSpec: process.env.ComSpec ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    TEMP: path.join(tempRoot, "tmp"),
    TMP: path.join(tempRoot, "tmp"),
    USERPROFILE: path.join(tempRoot, "home"),
    DOCKER_CONFIG: path.join(tempRoot, "docker-config"),
    NODE_ENV: "production",
    CI: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    NPM_CONFIG_OFFLINE: "true",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    PRISMA_HIDE_UPDATE_MESSAGE: "true",
    PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    E2E_BASE_URL: `http://127.0.0.1:${port}`,
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
    G7_FORM_BUILDER_BROWSER_SCHEMA: schema,
    G7_FORM_BUILDER_SCREENSHOT_DIR: screenshotDirectory,
    PAYMENT_PROVIDER: "demo",
    RATE_LIMIT_PROVIDER: "memory",
    JOB_SECRET: "g7-05-local-synthetic-job-secret",
    CSRF_SECRET: "g7-05-local-synthetic-csrf-secret",
    SENTRY_DISABLE_AUTO_UPLOAD: "true",
    SENTRY_DSN: "",
    NEXT_PUBLIC_SENTRY_DSN: "",
    RESEND_API_KEY: "",
    EMAIL_FROM: "",
    NODE_OPTIONS: `--require=${networkGuard}`,
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

export function parseContainerInspection(value) {
  const values = String(value).replace(/\r?\n$/u, "").split("\t");
  if (values.length !== 5) return null;
  return {
    id: values[0],
    name: values[1].replace(/^\//u, ""),
    runId: values[2],
    marker: values[3],
    mount: values[4],
  };
}

export function isOwnedContainerInspection(actual, expected) {
  return Boolean(
    actual
    && actual.id === expected.id
    && actual.name === expected.name
    && actual.runId === expected.runId
    && actual.marker === expected.marker
    && (actual.mount === "" || actual.mount === "tmpfs=/var/lib/postgresql/data"),
  );
}

function migrationRows(containerId, schema, migrations, env) {
  const result = psql(containerId, `SELECT migration_name, (finished_at IS NOT NULL)::text, (rolled_back_at IS NULL)::text FROM "${schema}"._prisma_migrations ORDER BY migration_name;`, env);
  if (result.exitCode !== 0) return false;
  const rows = result.stdout.trim() ? result.stdout.trim().split(/\r?\n/u).map((row) => row.split("|")) : [];
  return rows.length === migrations.length && rows.every(([name, finished, active], index) => name === migrations[index] && finished === "true" && active === "true");
}

async function waitForServer(baseURL, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const response = await fetch(`${baseURL}/login`);
      if (response.status >= 200 && response.status < 500) return true;
    } catch { /* loopback readiness only */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

export function sanitize(value, tempRoot) {
  const escapedTemp = tempRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return String(value ?? "").replace(/\u001b\[[0-9;]*m/gu, "").split(/\r?\n/u).map((line) => line
    .replace(new RegExp(escapedTemp, "giu"), "<temp>")
    .replace(new RegExp(escapedRoot, "giu"), "<workspace>")
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/giu, "postgresql://<redacted>@")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "<redacted-email>")
    .replace(/g7-(?:05|53|54)-[A-Za-z0-9_-]{8,}/gu, "<synthetic-value>")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/gu, "<redacted-long-value>")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").trim().slice(0, 320)).filter(Boolean).slice(-24);
}

export function classifyFailure(output) {
  const text = String(output ?? "");
  if (/G7_FORM_BUILDER_EXTERNAL_NETWORK_DENIED/u.test(text)) return "EXTERNAL_NETWORK_DENIED";
  if (/docker-image-unavailable|Cannot connect to the Docker/u.test(text)) return "DOCKER_UNAVAILABLE";
  if (/Another next build process/u.test(text)) return "NEXT_BUILD_LOCKED";
  if (/Failed to compile/u.test(text)) return "NEXT_COMPILE_FAILED";
  if (/Failed to collect page data/u.test(text)) return "NEXT_PAGE_DATA_COLLECTION_FAILED";
  if (/prerender/iu.test(text)) return "NEXT_PRERENDER_FAILED";
  if (/Type error:|TypeScript/u.test(text)) return "NEXT_TYPECHECK_FAILED";
  if (/AXE_BLOCKING/u.test(text)) return "PLAYWRIGHT_AXE_BLOCKING";
  if (/RWD_HORIZONTAL_OVERFLOW/u.test(text)) return "PLAYWRIGHT_RWD_HORIZONTAL_OVERFLOW";
  if (/strict mode violation|locator\(/iu.test(text)) return "PLAYWRIGHT_LOCATOR_CONTRACT_FAILED";
  if (/Timeout|timed out/u.test(text)) return "PLAYWRIGHT_TIMEOUT";
  return "RUNNER_FAILED_UNCLASSIFIED";
}

export function summarizePlaywrightReport(report, tempRoot) {
  const tests = [];
  const visit = (suite, parents = []) => {
    if (!suite || typeof suite !== "object") return;
    const titles = suite.title ? [...parents, suite.title] : parents;
    for (const spec of Array.isArray(suite.specs) ? suite.specs : []) for (const test of Array.isArray(spec.tests) ? spec.tests : []) {
      const result = test.results?.at(-1) ?? {};
      tests.push({ title: [...titles, spec.title ?? "untitled"].filter(Boolean).join(" > ").slice(0, 240), status: result.status ?? "unknown", message: [result.error?.message, ...(result.errors ?? []).map((error) => error?.message)].filter(Boolean).join("\n") });
    }
    for (const child of Array.isArray(suite.suites) ? suite.suites : []) visit(child, titles);
  };
  for (const suite of Array.isArray(report?.suites) ? report.suites : []) visit(suite);
  const failedStatuses = new Set(["failed", "timedOut", "interrupted", "unknown"]);
  const diagnostics = tests.filter((item) => failedStatuses.has(item.status)).slice(0, 4).map((item) => ({ title: item.title, status: item.status, classification: classifyFailure(item.message), details: sanitize(item.message, tempRoot).slice(0, 12) }));
  return { passed: tests.filter((item) => item.status === "passed").length, failed: tests.filter((item) => failedStatuses.has(item.status)).length, skipped: tests.filter((item) => ["skipped", "pending"].includes(item.status)).length, diagnostics };
}

export function validateReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") return false;
  const required = ["schemaVersion", "workPackage", "status", "startedAt", "finishedAt", "sourceDigest", "commands", "expected", "browser", "cleanup", "safety", "screenshots"];
  if (!required.every((key) => key in receipt) || receipt.workPackage !== "G7-53") return false;
  if (!/^[a-f0-9]{64}$/u.test(receipt.sourceDigest) || !Array.isArray(receipt.commands)) return false;
  if (receipt.safety?.dotenvContentsRead !== false || receipt.safety?.userBrowserProfileRead !== false || receipt.safety?.externalOperations !== false || receipt.safety?.productionOperations !== false) return false;
  if (!Number.isInteger(receipt.expected?.browserTests) || receipt.expected.browserTests < 1 || !Array.isArray(receipt.expected?.operations)) return false;
  if (![receipt.browser?.passed, receipt.browser?.failed, receipt.browser?.skipped].every(Number.isInteger)) return false;
  if (receipt.status !== "PASS") return receipt.status === "BLOCKED_OR_FAILED";
  const screenshotHashes = [receipt.screenshots?.desktop?.sha256, receipt.screenshots?.mobile?.sha256];
  const phaseKeys = ["mirror", "prismaGenerate", "prismaValidate", "prismaDeploy", "prismaStatus", "nextBuild", "server", "browser"];
  const cleanupKeys = ["syntheticRows", "server", "container", "tempRoot"];
  const draftKeys = ["autosave", "restore", "discard", "clearAfterSave", "failureRecovery", "crossTenant", "conflict", "staleConflict"];
  return receipt.browser.passed === receipt.expected.browserTests
    && receipt.browser.failed === 0
    && receipt.browser.skipped === 0
    && receipt.browser.axeCriticalOrSerious === 0
    && phaseKeys.every((key) => receipt.phases?.[key] === "PASS")
    && cleanupKeys.every((key) => receipt.cleanup?.[key] === "PASS")
    && draftKeys.every((key) => receipt.browser.draftRecovery?.[key] === "PASS")
    && screenshotHashes.every((value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value));
}

const FORM_SUBMISSION_PAGE_SIZE_FOR_RECEIPT = 25;

export function validateSubmissionsReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") return false;
  const required = ["schemaVersion", "workPackage", "status", "startedAt", "finishedAt", "sourceDigest", "commands", "expected", "browser", "cleanup", "safety", "screenshots"];
  if (!required.every((key) => key in receipt) || receipt.workPackage !== "G7-54") return false;
  if (!/^[a-f0-9]{64}$/u.test(receipt.sourceDigest) || !Array.isArray(receipt.commands)) return false;
  if (receipt.safety?.dotenvContentsRead !== false || receipt.safety?.userBrowserProfileRead !== false || receipt.safety?.externalOperations !== false || receipt.safety?.productionOperations !== false) return false;
  if (receipt.status !== "PASS") return receipt.status === "BLOCKED_OR_FAILED";
  const phaseKeys = ["mirror", "prismaGenerate", "prismaValidate", "prismaDeploy", "prismaStatus", "nextBuild", "server", "browser"];
  const cleanupKeys = ["syntheticRows", "server", "container", "tempRoot"];
  const behaviorKeys = ["search", "filters", "pagination", "privacy", "tenant", "loading", "error", "keyboard"];
  const screenshotHashes = [receipt.screenshots?.desktop?.sha256, receipt.screenshots?.mobile?.sha256];
  return receipt.expected?.browserTests === 5
    && receipt.expected?.databaseRows === 55
    && receipt.expected?.pageSize === FORM_SUBMISSION_PAGE_SIZE_FOR_RECEIPT
    && receipt.browser?.passed === 5
    && receipt.browser?.failed === 0
    && receipt.browser?.skipped === 0
    && receipt.browser?.axeCriticalOrSerious === 0
    && receipt.browser?.rwd?.desktop === "PASS"
    && receipt.browser?.rwd?.mobile === "PASS"
    && receipt.browser?.database?.rows === 55
    && receipt.browser?.database?.pageSize === FORM_SUBMISSION_PAGE_SIZE_FOR_RECEIPT
    && behaviorKeys.every((key) => receipt.browser?.[key] === "PASS")
    && phaseKeys.every((key) => receipt.phases?.[key] === "PASS")
    && cleanupKeys.every((key) => receipt.cleanup?.[key] === "PASS")
    && screenshotHashes.every((value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value));
}

export function assertStaticSafety(source) {
  // Exclude this declaration itself so the checker can safely describe the
  // patterns it rejects without tripping over its own documentation.
  const value = String(source).split(/\r?\n/u).filter((line) => !line.includes("const forbidden")).join("\n");
  const forbidden = [/(?:from\s*["']dotenv|require\(\s*["']dotenv)/iu, /launchPersistentContext/u, /\buserDataDir\b/u, /Chrome[\\/]User Data/iu, /https:\/\/(?!127\.0\.0\.1|localhost)/iu, /process\.env\.HOME/u];
  return forbidden.every((pattern) => !pattern.test(value));
}

function writePlaywrightFiles(mirror, submissionsMode = false) {
  const suiteName = submissionsMode ? "g7-form-submissions-browser" : "g7-form-builder-browser";
  const configPath = path.join(mirror, `playwright.${suiteName}.config.ts`);
  const specPath = path.join(mirror, "tests", "e2e", `${suiteName}.spec.ts`);
  fs.writeFileSync(configPath, [
    'import { defineConfig, devices } from "@playwright/test";',
    'const schema = process.env.G7_FORM_BUILDER_BROWSER_SCHEMA;',
    'const baseURL = process.env.E2E_BASE_URL;',
    'if (!schema || !/^g7_(?:53|54)_browser_[a-f0-9]{16}$/.test(schema)) throw new Error("g7-form-browser schema rejected");',
    'if (!baseURL || !/^http:\\/\\/127\\.0\\.0\\.1:\\d+$/.test(baseURL)) throw new Error("g7-form-builder base URL rejected");',
    `export default defineConfig({ testDir: "./tests/e2e", testMatch: "${suiteName}.spec.ts", timeout: 60000, expect: { timeout: 15000 }, fullyParallel: false, workers: 1, retries: 0, reporter: [["json"]], use: { baseURL, trace: "off", screenshot: "off", video: "off" }, projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }] });`,
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(specPath, submissionsMode ? submissionsPlaywrightSpec() : playwrightSpec(), "utf8");
  return { configPath, specPath };
}

function playwrightSpec() {
  return String.raw`import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const runId = randomUUID().replace(/-/g, "");
const baseURL = process.env.E2E_BASE_URL!;
const sessionToken = "g7-05-local-playwright-session-token";
const sessionTokenHash = createHash("sha256").update(sessionToken).digest("hex");
const foreignSessionToken = "g7-53-local-foreign-session-token";
const foreignSessionTokenHash = createHash("sha256").update(foreignSessionToken).digest("hex");
const fields = [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }, { key: "phone", label: "手機", type: "tel", required: false }];
const fixture = { vendorId: "", foreignVendorId: "", userId: "", foreignUserId: "", validFormId: "", invalidFormId: "", foreignFormId: "", foreignCanary: "" };
const evidence = { axe: { criticalOrSerious: -1 }, rwd: { desktop: "NOT_RUN", mobile: "NOT_RUN" }, tenant: "NOT_RUN", legacy: { valid: "NOT_RUN", invalidFailClosed: "NOT_RUN" }, loading: "NOT_RUN", keyboard: "NOT_RUN", draftRecovery: { autosave: "NOT_RUN", restore: "NOT_RUN", discard: "NOT_RUN", clearAfterSave: "NOT_RUN", failureRecovery: "NOT_RUN", crossTenant: "NOT_RUN", conflict: "NOT_RUN", staleConflict: "NOT_RUN" } };
async function persistEvidence() { await writeFile(join(resolve(process.env.G7_FORM_BUILDER_SCREENSHOT_DIR || "."), "g7-05-browser-observation.json"), JSON.stringify(evidence)); }

async function installOwnerSession(page: Page) { await page.context().addCookies([{ name: "celebrate_session", value: sessionToken, url: baseURL, httpOnly: true, sameSite: "Lax" }]); }
async function installForeignSession(page: Page) { await page.context().addCookies([{ name: "celebrate_session", value: foreignSessionToken, url: baseURL, httpOnly: true, sameSite: "Lax" }]); }
async function capture(page: Page, filename: string) { const directory = process.env.G7_FORM_BUILDER_SCREENSHOT_DIR; if (!directory) return; await mkdir(directory, { recursive: true }); await page.screenshot({ path: join(resolve(directory), filename), fullPage: true }); }
async function blockingAxe(page: Page, viewport: "desktop" | "mobile") { const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze(); return result.violations.filter((item) => item.impact === "critical" || item.impact === "serious").map((item) => ({ viewport, id: item.id, impact: item.impact, targets: item.nodes.map((node) => node.target) })); }
async function assertNoOverflow(page: Page, kind: "desktop" | "mobile") { const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (overflow > 1) throw new Error("RWD_HORIZONTAL_OVERFLOW:" + JSON.stringify({ kind, overflow })); evidence.rwd[kind] = "PASS"; }
async function keyboardReachable(page: Page, names: string[]) { const found = new Set<string>(); for (let step = 0; step < 100 && found.size < names.length; step += 1) { await page.keyboard.press("Tab"); const name = await page.evaluate(() => { const active = document.activeElement as HTMLElement | null; return active?.getAttribute("aria-label") || active?.textContent?.trim() || ""; }); for (const required of names) if (name.includes(required)) found.add(required); } expect([...found].sort()).toEqual([...names].sort()); evidence.keyboard = "PASS"; }

  test.describe("G7-05 視覺化表單 builder", () => {
  test.beforeAll(async () => {
    const [vendor, foreign] = await Promise.all([
      db.vendor.create({ data: { name: "G7-05 合成 Owner", slug: "g7-05-owner-" + runId, email: "g7-05-owner-" + runId + "@example.test", passwordHash: "synthetic", tracking: { create: {} } } }),
      db.vendor.create({ data: { name: "G7-05 合成 Foreign", slug: "g7-05-foreign-" + runId, email: "g7-05-foreign-" + runId + "@example.test", passwordHash: "synthetic", tracking: { create: {} } } }),
    ]);
    const [user, foreignUser] = await Promise.all([
      db.user.create({ data: { email: "g7-05-user-" + runId + "@example.test", name: "G7-05 Owner", passwordHash: "synthetic", status: "active", memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } } } }),
      db.user.create({ data: { email: "g7-53-foreign-user-" + runId + "@example.test", name: "G7-53 Foreign Owner", passwordHash: "synthetic", status: "active", memberships: { create: { vendorId: foreign.id, role: "owner", status: "active" } } } }),
    ]);
    await Promise.all([
      db.userSession.create({ data: { userId: user.id, vendorId: vendor.id, tokenHash: sessionTokenHash, expiresAt: new Date("2030-01-01T00:00:00.000Z") } }),
      db.userSession.create({ data: { userId: foreignUser.id, vendorId: foreign.id, tokenHash: foreignSessionTokenHash, expiresAt: new Date("2030-01-01T00:00:00.000Z") } }),
    ]);
    const [valid, invalid, foreignForm] = await Promise.all([
      db.registrationForm.create({ data: { vendorId: vendor.id, name: "G7-05 Legacy Valid", slug: "g7-05-legacy-" + runId, headline: "Legacy heading", description: "legacy", submitLabel: "送出", successMessage: "完成", fields: [...fields, { key: "legacy_ref", label: "舊識別碼", type: "url", required: false }], isActive: true } }),
      db.registrationForm.create({ data: { vendorId: vendor.id, name: "G7-05 Legacy Invalid", slug: "g7-05-invalid-" + runId, headline: "invalid", fields: [{ key: "broken key", label: "broken", type: "text", required: false }], isActive: true } }),
      db.registrationForm.create({ data: { vendorId: foreign.id, name: "G7-05 Foreign " + runId, slug: "g7-05-foreign-form-" + runId, headline: "foreign", fields, isActive: true } }),
    ]);
    Object.assign(fixture, { vendorId: vendor.id, foreignVendorId: foreign.id, userId: user.id, foreignUserId: foreignUser.id, validFormId: valid.id, invalidFormId: invalid.id, foreignFormId: foreignForm.id, foreignCanary: foreignForm.name });
  });
  test.afterAll(async () => { try { await db.vendor.deleteMany({ where: { id: { in: [fixture.vendorId, fixture.foreignVendorId] } } }); await db.user.deleteMany({ where: { id: { in: [fixture.userId, fixture.foreignUserId] } } }); } finally { await writeFile(join(resolve(process.env.G7_FORM_BUILDER_SCREENSHOT_DIR || "."), "g7-05-browser-observation.json"), JSON.stringify(evidence)); await db.$disconnect(); } });
  test.afterEach(async () => { await persistEvidence(); });

  test("owner sees visual builder at desktop and mobile without raw JSON, overflow, or Axe blockers", async ({ page }) => {
    await installOwnerSession(page); await page.setViewportSize({ width: 1440, height: 1000 }); const response = await page.goto("/forms/new"); expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "新增報名表" })).toBeVisible(); await expect(page.getByRole("heading", { name: "基本資料" })).toBeVisible(); await expect(page.getByRole("complementary", { name: "即時表單預覽" })).toBeVisible(); await expect(page.getByText("欄位 JSON", { exact: false })).toHaveCount(0); await expect(page.locator('textarea[name="fields"]')).toHaveCount(0); await expect(page.getByRole("button", { name: "新增欄位" })).toBeEnabled(); await expect(page.getByRole("button", { name: "儲存表單" })).toBeEnabled();
    await assertNoOverflow(page, "desktop"); await capture(page, "desktop.png"); await keyboardReachable(page, ["新增欄位", "儲存表單"]); const desktopAxe = await blockingAxe(page, "desktop");
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/forms/new"); await assertNoOverflow(page, "mobile"); await capture(page, "mobile.png"); const mobileAxe = await blockingAxe(page, "mobile"); const axeBlocking = [...desktopAxe, ...mobileAxe]; if (axeBlocking.length) throw new Error("AXE_BLOCKING:" + JSON.stringify(axeBlocking)); evidence.axe.criticalOrSerious = 0;
  });

  test("new custom field synchronizes preview, can move, remove, undo, and persists exact safe metadata while pending", async ({ page }) => {
    await installOwnerSession(page); await page.goto("/forms/new");
    await page.getByLabel("表單名稱").fill("G7-05 建立表單"); await page.getByLabel("公開網址").fill("g7-05-create-" + runId); await page.getByLabel("公開標題").fill("同步預覽標題"); await page.getByLabel("說明文字").fill("同步說明"); await page.getByLabel("送出按鈕文字").fill("立即送出"); await page.getByLabel("成功訊息").fill("已建立");
    await page.getByLabel("新欄位類型").selectOption("url"); await page.getByRole("button", { name: "新增欄位" }).click(); const custom = page.locator("#builder-field-field_1-label"); await expect(custom).toBeVisible(); await custom.fill("作品網址"); await expect(page.getByRole("complementary", { name: "即時表單預覽" }).getByText("作品網址", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "將「作品網址」上移" }).click(); await page.getByRole("button", { name: "將「作品網址」下移" }).click(); await page.getByRole("button", { name: "移除「作品網址」" }).click(); await expect(page.getByRole("button", { name: "復原" })).toBeVisible(); await page.getByRole("button", { name: "復原" }).click(); await expect(custom).toHaveValue("作品網址");
    let release: (() => void) | undefined; const held = new Promise<void>((resolve) => { release = resolve; }); let intercepted = false;
    await page.route("**/forms/new", async (route) => { if (route.request().method() === "POST" && !intercepted) { intercepted = true; await held; } await route.continue(); });
    const submitClick = page.getByRole("button", { name: "儲存表單" }).click({ noWaitAfter: true }); await expect(page.getByRole("button", { name: "儲存中…" })).toBeDisabled(); expect(intercepted).toBe(true); evidence.loading = "PASS"; release?.(); await submitClick; await expect(page).toHaveURL(/\/forms$/);
    const saved = await db.registrationForm.findFirstOrThrow({ where: { vendorId: fixture.vendorId, slug: "g7-05-create-" + runId } }); expect(saved).toMatchObject({ name: "G7-05 建立表單", headline: "同步預覽標題", description: "同步說明", submitLabel: "立即送出", successMessage: "已建立", isActive: true }); expect(saved.fields).toEqual([...fields, { key: "field_1", label: "作品網址", type: "url", required: false }]);
  });

  test("merchant can autosave, restore, discard, and clear a new-form browser draft", async ({ page }) => {
    await installOwnerSession(page); await page.goto("/forms/new");
    await page.getByLabel("表單名稱").fill("G7-53 尚未儲存草稿"); await page.getByLabel("公開標題").fill("草稿恢復標題");
    await expect(page.getByText("草稿已自動保存於這台裝置。", { exact: true })).toBeVisible(); evidence.draftRecovery.autosave = "PASS";
    await page.reload(); await expect(page.getByText("找到尚未儲存的表單草稿", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "恢復草稿" }).click();
    await expect(page.getByLabel("表單名稱")).toHaveValue("G7-53 尚未儲存草稿"); await expect(page.getByLabel("公開標題")).toHaveValue("草稿恢復標題"); evidence.draftRecovery.restore = "PASS";
    await page.getByLabel("表單名稱").fill("G7-53 準備捨棄"); await expect(page.getByText("草稿已自動保存於這台裝置。", { exact: true })).toBeVisible();
    await page.reload(); await page.getByRole("button", { name: "捨棄草稿" }).click(); await expect(page.getByLabel("表單名稱")).toHaveValue(""); evidence.draftRecovery.discard = "PASS";
    await page.getByLabel("表單名稱").fill("G7-53 草稿清除"); await page.getByLabel("公開網址").fill("g7-53-draft-clear-" + runId); await page.getByLabel("公開標題").fill("成功儲存會清除草稿");
    await expect(page.getByText("草稿已自動保存於這台裝置。", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "儲存表單" }).click(); await expect(page).toHaveURL(/\/forms$/);
    await page.goto("/forms/new"); await expect(page.getByText("找到尚未儲存的表單草稿", { exact: true })).toHaveCount(0); await expect(page.getByLabel("表單名稱")).toHaveValue(""); evidence.draftRecovery.clearAfterSave = "PASS";
  });

  test("same browser keeps owner and foreign vendor drafts isolated", async ({ page }) => {
    await installOwnerSession(page); await page.goto("/forms/new"); await page.getByLabel("表單名稱").fill("G7-53 Owner 私有草稿"); await page.getByLabel("公開標題").fill("Owner Only");
    await expect(page.getByText("草稿已自動保存於這台裝置。", { exact: true })).toBeVisible();
    await installForeignSession(page); await page.goto("/forms/new"); await expect(page.getByText("找到尚未儲存的表單草稿", { exact: true })).toHaveCount(0); await expect(page.getByLabel("表單名稱")).toHaveValue("");
    await installOwnerSession(page); await page.goto("/forms/new"); await expect(page.getByText("找到尚未儲存的表單草稿", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "捨棄草稿" }).click(); evidence.draftRecovery.crossTenant = "PASS";
  });

  test("server-side save failure re-establishes a recoverable browser draft", async ({ page }) => {
    await installOwnerSession(page); await page.goto("/forms/new"); await page.getByLabel("表單名稱").fill("G7-53 失敗後恢復"); await page.getByLabel("公開網址").fill("g7-05-legacy-" + runId); await page.getByLabel("公開標題").fill("保留失敗內容");
    await expect(page.getByText("草稿已自動保存於這台裝置。", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "儲存表單" }).click(); await expect(page.getByRole("alert").filter({ hasText: "公開網址已被使用" })).toBeVisible();
    await expect(page.getByText("草稿已自動保存於這台裝置。", { exact: true })).toBeVisible(); await page.reload(); await expect(page.getByText("找到尚未儲存的表單草稿", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "恢復草稿" }).click(); await expect(page.getByLabel("表單名稱")).toHaveValue("G7-53 失敗後恢復"); await expect(page.getByLabel("公開標題")).toHaveValue("保留失敗內容"); evidence.draftRecovery.failureRecovery = "PASS";
  });

  test("stale edit tab cannot overwrite a newer server version", async ({ page }) => {
    await installOwnerSession(page); await page.goto("/forms/" + fixture.validFormId + "/edit"); await page.getByLabel("表單名稱").fill("G7-53 舊分頁修改");
    await expect(page.getByText("草稿已自動保存於這台裝置。", { exact: true })).toBeVisible();
    const current = await db.registrationForm.findUniqueOrThrow({ where: { id: fixture.validFormId }, select: { updatedAt: true } });
    await db.registrationForm.update({ where: { id: fixture.validFormId }, data: { name: "G7-53 新版伺服器內容", updatedAt: new Date(current.updatedAt.getTime() + 60_000) } });
    await page.getByRole("button", { name: "儲存表單" }).click(); await expect(page.getByRole("alert").filter({ hasText: "較新的版本" })).toBeVisible();
    await expect(db.registrationForm.findUniqueOrThrow({ where: { id: fixture.validFormId }, select: { name: true } })).resolves.toEqual({ name: "G7-53 新版伺服器內容" }); evidence.draftRecovery.conflict = "PASS";
    await expect(page.getByText("草稿已自動保存於這台裝置。", { exact: true })).toBeVisible(); await page.reload(); await expect(page.getByText("找到較舊的瀏覽器草稿", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "恢復草稿" })).toHaveCount(0); await page.getByRole("button", { name: "捨棄這份草稿" }).click(); evidence.draftRecovery.staleConflict = "PASS";
  });

  test("valid legacy fields load visually and preserve stable key", async ({ page }) => { await installOwnerSession(page); const response = await page.goto("/forms/" + fixture.validFormId + "/edit"); expect(response?.status()).toBe(200); await expect(page.locator("#builder-field-legacy_ref-label")).toHaveValue("舊識別碼"); await expect(page.getByText("legacy_ref", { exact: true })).toBeVisible(); await expect(page.getByText("欄位 JSON", { exact: false })).toHaveCount(0); evidence.legacy.valid = "PASS"; });

  test("invalid legacy fields fail closed until explicit rebuild", async ({ page }) => { await installOwnerSession(page); await page.goto("/forms/" + fixture.invalidFormId + "/edit"); await expect(page.locator('div[role="alert"]').filter({ hasText: "儲存已停用" })).toBeVisible(); await expect(page.getByRole("button", { name: "儲存表單" })).toBeDisabled(); await page.getByRole("button", { name: "重建安全欄位" }).click(); await expect(page.getByRole("button", { name: "儲存表單" })).toBeEnabled(); await expect(page.locator("#builder-field-name-label")).toBeVisible(); await expect(page.locator("#builder-field-email-label")).toBeVisible(); evidence.legacy.invalidFailClosed = "PASS"; });

  test("foreign vendor edit is a not-found response and leaks no form data", async ({ page }) => { await installOwnerSession(page); const response = await page.goto("/forms/" + fixture.foreignFormId + "/edit"); expect(response?.status()).toBe(404); await expect(page.getByText(fixture.foreignCanary, { exact: true })).toHaveCount(0); expect(await page.content()).not.toContain(fixture.foreignCanary); evidence.tenant = "PASS"; });
});
`;
}

function submissionsPlaywrightSpec() {
  return String.raw`import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const runId = randomUUID().replace(/-/g, "");
const baseURL = process.env.E2E_BASE_URL!;
const sessionToken = "g7-54-local-playwright-session-token";
const sessionTokenHash = createHash("sha256").update(sessionToken).digest("hex");
const fields = [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }];
const fixture = { vendorId: "", userId: "", formId: "", foreignVendorId: "", foreignFormId: "", foreignCanary: "" };
const evidence = { axe: { criticalOrSerious: 0 }, rwd: { desktop: "NOT_RUN", mobile: "NOT_RUN" }, search: "NOT_RUN", filters: "NOT_RUN", pagination: "NOT_RUN", privacy: "NOT_RUN", tenant: "NOT_RUN", loading: "NOT_RUN", error: "NOT_RUN", keyboard: "NOT_RUN", database: { rows: 0, pageSize: 0 } };
const observationPath = () => join(resolve(process.env.G7_FORM_BUILDER_SCREENSHOT_DIR || "."), "g7-54-browser-observation.json");
async function persistEvidence() { await writeFile(observationPath(), JSON.stringify(evidence)); }
async function installSession(page: Page) { await page.context().addCookies([{ name: "celebrate_session", value: sessionToken, url: baseURL, httpOnly: true, sameSite: "Lax" }]); }
async function capture(page: Page, filename: string) { const directory = process.env.G7_FORM_BUILDER_SCREENSHOT_DIR; if (!directory) return; await mkdir(directory, { recursive: true }); await page.screenshot({ path: join(resolve(directory), filename), fullPage: true }); }
async function assertNoOverflow(page: Page, kind: "desktop" | "mobile") { const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (overflow > 1) throw new Error("RWD_HORIZONTAL_OVERFLOW:" + JSON.stringify({ kind, overflow })); evidence.rwd[kind] = "PASS"; }
async function assertNoAxeBlockers(page: Page) { const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze(); const blockers = result.violations.filter((item) => item.impact === "critical" || item.impact === "serious").map((item) => ({ id: item.id, impact: item.impact, targets: item.nodes.map((node) => node.target) })); evidence.axe.criticalOrSerious += blockers.length; if (blockers.length) throw new Error("AXE_BLOCKING:" + JSON.stringify(blockers)); }

test.describe("G7-54 報名名單查找與管理", () => {
  test.beforeAll(async () => {
    const [vendor, foreignVendor] = await Promise.all([
      db.vendor.create({ data: { name: "G7-54 合成商家", slug: "g7-54-owner-" + runId, email: "g7-54-owner-" + runId + "@example.test", passwordHash: "synthetic", tracking: { create: {} } } }),
      db.vendor.create({ data: { name: "G7-54 外部商家", slug: "g7-54-foreign-" + runId, email: "g7-54-foreign-" + runId + "@example.test", passwordHash: "synthetic", tracking: { create: {} } } }),
    ]);
    const user = await db.user.create({ data: { email: "g7-54-user-" + runId + "@example.test", name: "G7-54 Owner", passwordHash: "synthetic", status: "active", memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } } } });
    await db.userSession.create({ data: { userId: user.id, vendorId: vendor.id, tokenHash: sessionTokenHash, expiresAt: new Date("2030-01-01T00:00:00.000Z") } });
    const [form, foreignForm] = await Promise.all([
      db.registrationForm.create({ data: { vendorId: vendor.id, name: "G7-54 活動報名", slug: "g7-54-form-" + runId, headline: "合成名單", fields, isActive: true } }),
      db.registrationForm.create({ data: { vendorId: foreignVendor.id, name: "G7-54 FOREIGN CANARY " + runId, slug: "g7-54-foreign-form-" + runId, headline: "foreign", fields, isActive: true } }),
    ]);
    const live = await db.live.create({ data: { vendorId: vendor.id, formId: form.id, title: "G7-54 新品直播", slug: "g7-54-live-" + runId, scheduledAt: new Date("2026-08-10T01:00:00.000Z"), status: "draft" } });
    await db.formSubmission.createMany({ data: Array.from({ length: 55 }, (_, index) => ({
      formId: form.id,
      liveId: index < 20 ? live.id : null,
      name: index === 42 ? "G7-54 精準搜尋者" : "G7-54 報名者 " + String(index + 1).padStart(2, "0"),
      email: "g7-54-lead-" + String(index + 1).padStart(2, "0") + "@example.test",
      phone: index % 3 === 0 ? null : "0900" + String(index).padStart(6, "0"),
      source: index < 20 ? "live" : "form",
      verificationStatus: index % 2 === 0 ? "VERIFIED" : "UNVERIFIED",
      createdAt: new Date(Date.UTC(2026, 7, 10, 0, index)),
    })) });
    Object.assign(fixture, { vendorId: vendor.id, userId: user.id, formId: form.id, foreignVendorId: foreignVendor.id, foreignFormId: foreignForm.id, foreignCanary: foreignForm.name });
    evidence.database.rows = await db.formSubmission.count({ where: { formId: form.id } });
  });

  test.afterAll(async () => { try { await db.vendor.deleteMany({ where: { id: { in: [fixture.vendorId, fixture.foreignVendorId] } } }); await db.user.deleteMany({ where: { id: fixture.userId } }); } finally { await persistEvidence(); await db.$disconnect(); } });
  test.afterEach(async () => { await persistEvidence(); });

  test("desktop search, filters, reset, pagination, and URL privacy use the bounded dataset", async ({ page }) => {
    const runtimeErrors: string[] = []; const actionResponses: number[] = []; page.on("pageerror", (error) => runtimeErrors.push("pageerror:" + error.message)); page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push("console:" + message.text()); }); page.on("response", (responseValue) => { if (responseValue.request().method() === "POST") actionResponses.push(responseValue.status()); });
    await installSession(page); await page.setViewportSize({ width: 1440, height: 1000 }); const response = await page.goto("/forms/" + fixture.formId + "/submissions"); expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "G7-54 活動報名 名單" })).toBeVisible(); await expect(page.getByRole("status").filter({ hasText: "共" })).toContainText("55"); await expect(page.locator("table tbody tr")).toHaveCount(25); evidence.database.pageSize = await page.locator("table tbody tr").count();
    await page.getByRole("button", { name: "下一頁" }).click(); await expect(page.getByRole("status").filter({ hasText: "共" })).toContainText("第 2／3 頁"); await expect(page.locator("table tbody tr")).toHaveCount(25);
    await page.getByRole("button", { name: "下一頁" }).click(); await page.waitForTimeout(1_000); const pageThreeStatus = page.getByRole("status").filter({ hasText: "共" }); if (await pageThreeStatus.count() === 0) { const diagnostic = { url: page.url().replace(baseURL, "<loopback>"), formCount: await page.locator("#form-submissions-search").count(), alerts: await page.getByRole("alert").allInnerTexts(), actionResponses, runtimeErrors: runtimeErrors.slice(-8), body: (await page.locator("body").innerText()).slice(0, 800) }; throw new Error("PAGE3_STATE:" + JSON.stringify(diagnostic)); } await expect(pageThreeStatus).toContainText("第 3／3 頁"); await expect(page.locator("table tbody tr")).toHaveCount(5); evidence.pagination = "PASS";
    await page.getByLabel("姓名、Email 或手機").fill("精準搜尋者"); await page.getByRole("button", { name: "查詢", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "共" })).toContainText("1"); await expect(page.locator("table tbody tr")).toHaveCount(1); await expect(page.getByRole("cell", { name: "G7-54 精準搜尋者", exact: true })).toBeVisible(); expect(page.url()).toBe(baseURL + "/forms/" + fixture.formId + "/submissions"); evidence.search = "PASS"; evidence.privacy = "PASS";
    await page.getByRole("button", { name: "清除條件" }).click(); await expect(page.getByLabel("姓名、Email 或手機")).toHaveValue(""); await expect(page.getByRole("status").filter({ hasText: "共" })).toContainText("55");
    await page.getByLabel("驗證狀態").selectOption("UNVERIFIED"); await page.getByLabel("報名來源").selectOption("LIVE"); await page.getByRole("button", { name: "查詢", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "共" })).toContainText("10"); await expect(page.locator("table tbody tr")).toHaveCount(10); await expect(page.locator("table").getByText("待驗證", { exact: true }).first()).toBeVisible(); await expect(page.locator("table").getByText("G7-54 新品直播", { exact: true }).first()).toBeVisible(); evidence.filters = "PASS";
    await assertNoOverflow(page, "desktop"); await assertNoAxeBlockers(page); await capture(page, "desktop.png");
  });

  test("mobile cards remain usable, keyboard reachable, and free of blocking accessibility findings", async ({ page }) => {
    await installSession(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/forms/" + fixture.formId + "/submissions"); await expect(page.locator("article")).toHaveCount(25); await expect(page.locator("article").first()).toBeVisible(); await assertNoOverflow(page, "mobile");
    const query = page.getByLabel("姓名、Email 或手機"); await query.focus(); await page.keyboard.press("Tab"); await expect(page.getByLabel("驗證狀態")).toBeFocused(); await page.keyboard.press("Tab"); await expect(page.getByLabel("報名來源")).toBeFocused(); await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "查詢", exact: true })).toBeFocused(); evidence.keyboard = "PASS";
    await assertNoAxeBlockers(page); await capture(page, "mobile.png");
  });

  test("search exposes pending feedback and prevents duplicate submission", async ({ page }) => {
    await installSession(page); await page.goto("/forms/" + fixture.formId + "/submissions"); let release: (() => void) | undefined; const held = new Promise<void>((resolve) => { release = resolve; }); let intercepted = false;
    await page.route("**/forms/" + fixture.formId + "/submissions", async (route) => { if (route.request().method() === "POST" && !intercepted) { intercepted = true; await held; } await route.continue(); });
    const click = page.getByRole("button", { name: "查詢", exact: true }).click({ noWaitAfter: true }); await expect(page.getByRole("button", { name: "查詢中…" })).toBeDisabled(); await expect(page.locator("form[aria-busy=true]")).toBeVisible(); expect(intercepted).toBe(true); evidence.loading = "PASS"; release?.(); await click; await expect(page.getByRole("button", { name: "查詢", exact: true })).toBeEnabled();
  });

  test("expired CSRF fails safely without echoing submitted contact filters", async ({ page }) => {
    await installSession(page); await page.goto("/forms/" + fixture.formId + "/submissions"); await page.getByLabel("姓名、Email 或手機").fill("never-echo-this-private-query"); await page.locator('#form-submissions-search input[name="_csrf"]').evaluate((element) => { (element as HTMLInputElement).value = "invalid"; }); await page.getByRole("button", { name: "查詢", exact: true }).click();
    const csrfAlert = page.getByRole("alert").filter({ hasText: "安全驗證已失效" }); await expect(csrfAlert).toContainText("安全驗證已失效"); await expect(csrfAlert).not.toContainText("never-echo-this-private-query"); evidence.error = "PASS";
  });

  test("cross-tenant form is a 404 and leaks no foreign form identity", async ({ page }) => {
    await installSession(page); const response = await page.goto("/forms/" + fixture.foreignFormId + "/submissions"); expect([200, 404]).toContain(response?.status()); await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/); await expect(page.getByText(fixture.foreignCanary, { exact: true })).toHaveCount(0); expect(await page.content()).not.toContain(fixture.foreignCanary); evidence.tenant = "PASS";
  });
});
`;
}

function stopServer(server) {
  if (!server?.pid || server.exitCode !== null) return "PASS";
  if (process.platform === "win32") return run("taskkill", ["/PID", String(server.pid), "/T", "/F"], process.env).exitCode === 0 ? "PASS" : "FAIL";
  server.kill("SIGTERM");
  return "PASS";
}

export function removeTempRoot(tempRoot, marker) {
  const resolved = path.resolve(tempRoot);
  const safe = resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`) && runNamePattern.test(path.basename(resolved)) && fs.existsSync(path.join(resolved, ".marker")) && fs.readFileSync(path.join(resolved, ".marker"), "utf8") === marker;
  if (!safe) return "CLEANUP_BLOCKED";
  const modules = path.join(resolved, "mirror", "node_modules");
  if (fs.existsSync(modules)) fs.rmSync(modules, { recursive: true, force: true, maxRetries: 3 });
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3 });
  return fs.existsSync(resolved) ? "FAIL" : "PASS";
}

function writeReceipt(receipt, receiptPath) {
  const valid = receipt?.workPackage === "G7-54"
    ? validateSubmissionsReceipt(receipt)
    : validateReceipt(receipt);
  if (!valid) throw new Error("receipt-schema-invalid");
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, serialized, { encoding: "utf8", flag: "wx" });
  const digest = crypto.createHash("sha256").update(serialized).digest("hex");
  fs.writeFileSync(`${receiptPath}.sha256`, `${digest}  ${path.basename(receiptPath)}\n`, { encoding: "utf8", flag: "wx" });
  return digest;
}

export async function main() {
  const submissionsMode = process.argv.includes("--submissions");
  const runId = crypto.randomBytes(8).toString("hex");
  const name = `celebratedeal-g7-form-builder-browser-${runId}`;
  const schema = `g7_${submissionsMode ? "54" : "53"}_browser_${runId}`;
  const marker = `g7-${submissionsMode ? "54" : "53"}-browser:${runId}`;
  const tempRoot = path.join(os.tmpdir(), name);
  const receiptStem = submissionsMode ? `g7-54-form-submissions-browser-qa-${runId}` : `g7-53-form-draft-browser-qa-${runId}`;
  const receiptPath = path.join(evidenceRoot, `${receiptStem}.json`);
  const screenshots = path.join(evidenceRoot, `${receiptStem}-screenshots`);
  const migrations = canonicalMigrations();
  const receipt = {
    schemaVersion: submissionsMode ? "celebratedeal-g7-54-form-submissions-browser-qa/v1" : "celebratedeal-g7-53-form-draft-browser-qa/v1",
    workPackage: submissionsMode ? "G7-54" : "G7-53",
    status: "BLOCKED_OR_FAILED",
    runId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    sourceDigest: safeSourceDigest(),
    commands: [],
    expected: submissionsMode
      ? { browserTests: 5, axeCriticalOrSerious: 0, databaseRows: 55, pageSize: 25, viewports: ["1440x1000", "390x844"], operations: ["search", "verification-filter", "source-filter", "reset", "pagination", "url-privacy", "pending", "csrf-error", "tenant-not-found-noindex-no-leak", "axe", "rwd", "keyboard"] }
      : { browserTests: 9, axeCriticalOrSerious: 0, viewports: ["1440x1000", "390x844"], operations: ["visual-builder", "preview-sync", "move", "remove-undo", "pending", "draft-autosave", "draft-restore", "draft-discard", "draft-clear-after-save", "draft-failure-recovery", "draft-cross-tenant", "optimistic-conflict", "stale-conflict-fail-closed", "legacy", "tenant-404"] },
    phases: { mirror: "NOT_STARTED", prismaGenerate: "NOT_STARTED", prismaValidate: "NOT_STARTED", prismaDeploy: "NOT_STARTED", prismaStatus: "NOT_STARTED", nextBuild: "NOT_STARTED", server: "NOT_STARTED", browser: "NOT_STARTED" },
    browser: submissionsMode
      ? { passed: 0, failed: 0, skipped: 0, axeCriticalOrSerious: -1, rwd: { desktop: "NOT_RUN", mobile: "NOT_RUN" }, search: "NOT_RUN", filters: "NOT_RUN", pagination: "NOT_RUN", privacy: "NOT_RUN", tenant: "NOT_RUN", loading: "NOT_RUN", error: "NOT_RUN", keyboard: "NOT_RUN", database: { rows: 0, pageSize: 0 } }
      : { passed: 0, failed: 0, skipped: 0, axeCriticalOrSerious: -1, rwd: { desktop: "NOT_RUN", mobile: "NOT_RUN" }, tenant: "NOT_RUN", legacy: { valid: "NOT_RUN", invalidFailClosed: "NOT_RUN" }, loading: "NOT_RUN", keyboard: "NOT_RUN", draftRecovery: { autosave: "NOT_RUN", restore: "NOT_RUN", discard: "NOT_RUN", clearAfterSave: "NOT_RUN", failureRecovery: "NOT_RUN", crossTenant: "NOT_RUN", conflict: "NOT_RUN", staleConflict: "NOT_RUN" } },
    screenshots: { desktop: null, mobile: null },
    cleanup: { syntheticRows: "NOT_RUN", server: "NOT_STARTED", container: "NOT_STARTED", tempRoot: "NOT_STARTED" },
    safety: { dotenvContentsRead: false, mirrorExcludesDotenv: true, loopbackOnly: true, postgresTmpfs: true, committedMigrationsOnly: true, userBrowserProfileRead: false, playwrightBrowserCacheReuseOnly: true, externalOperations: false, productionOperations: false, rawOutputPersisted: false },
    diagnostics: { failureClass: null, details: [] },
    failure: null,
  };
  let env = null;
  let container = null;
  let server = null;
  let serverLogHandle = null;
  const dockerEnv = {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    ComSpec: process.env.ComSpec ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
  };
  const noteCommand = (nameValue, result) => receipt.commands.push({ name: nameValue, exitCode: result.exitCode });
  try {
    if (!runNamePattern.test(name) || !schemaPattern.test(schema) || migrations.length === 0 || !assertStaticSafety(fs.readFileSync(scriptPath, "utf8"))) throw new Error("runner-contract-invalid");
    fs.mkdirSync(tempRoot, { recursive: true });
    for (const directory of ["tmp", "home", "docker-config"]) fs.mkdirSync(path.join(tempRoot, directory), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, ".marker"), marker, { encoding: "utf8", flag: "wx" });
    const mirror = path.join(tempRoot, "mirror");
    copySourceTree(root, mirror);
    if (!linkNodeModules(mirror) || fs.existsSync(path.join(mirror, ".env")) || fs.existsSync(path.join(mirror, ".env.local"))) throw new Error("mirror-contract-failed");
    receipt.phases.mirror = "PASS";

    const imageCheck = run("docker", ["image", "inspect", image], dockerEnv); noteCommand("docker image inspect", imageCheck); if (imageCheck.exitCode !== 0) throw new Error("docker-image-unavailable");
    const created = run("docker", ["run", "-d", "--pull=never", "--name", name, "--label", `celebratedeal.run-id=${runId}`, "--label", `celebratedeal.marker=${marker}`, "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=celebratedeal_test", "--tmpfs", "/var/lib/postgresql/data", "-p", "127.0.0.1::5432", image], dockerEnv);
    noteCommand("docker run disposable postgres", created); if (created.exitCode !== 0 || !/^[a-f0-9]{64}\s*$/iu.test(created.stdout)) throw new Error("container-create-failed");
    container = { id: created.stdout.trim(), name, runId, marker, schema };
    if (!waitForPostgres(container.id, dockerEnv)) throw new Error("database-unreachable");
    const portResult = run("docker", ["port", container.id, "5432/tcp"], dockerEnv); noteCommand("docker port", portResult);
    const postgresPort = /^127\.0\.0\.1:(\d+)\s*$/mu.exec(portResult.stdout)?.[1]; if (!postgresPort) throw new Error("database-loopback-port-invalid");
    const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${postgresPort}/celebratedeal_test?schema=${schema}`;
    const appPort = await allocatePort(); if (!appPort) throw new Error("app-loopback-port-invalid");
    const tempScreenshots = path.join(tempRoot, "screenshots");
    fs.mkdirSync(tempScreenshots, { recursive: true });
    const localAppData = process.env.LOCALAPPDATA;
    const browsers = localAppData ? path.resolve(localAppData, "ms-playwright") : null;
    if (!browsers || path.basename(browsers) !== "ms-playwright" || !fs.existsSync(browsers)) throw new Error("playwright-browser-cache-missing");
    env = safeEnvironment({ tempRoot, port: appPort, databaseUrl, schema, screenshotDirectory: tempScreenshots, networkGuard: writeNetworkGuard(tempRoot), playwrightBrowsersPath: browsers });
    if (psql(container.id, `COMMENT ON DATABASE celebratedeal_test IS '${marker}';`, env, "postgres").exitCode !== 0 || psql(container.id, `CREATE SCHEMA "${schema}"; COMMENT ON SCHEMA "${schema}" IS '${marker}';`, env).exitCode !== 0) throw new Error("database-marker-failed");

    const prismaConfig = writePrismaConfig(mirror);
    const prismaCli = path.join(mirror, "node_modules", "prisma", "build", "index.js");
    for (const [phase, args] of [["prismaGenerate", ["generate"]], ["prismaValidate", ["validate"]], ["prismaDeploy", ["migrate", "deploy"]], ["prismaStatus", ["migrate", "status"]]]) {
      const result = run(process.execPath, [prismaCli, ...args, "--config", prismaConfig], env, mirror); noteCommand(`prisma ${args.join(" ")}`, result); receipt.phases[phase] = result.exitCode === 0 ? "PASS" : "FAIL"; if (result.exitCode !== 0) throw new Error(`prisma-${phase}-failed:${sanitize(`${result.stdout}\n${result.stderr}`, tempRoot).join(" ")}`);
    }
    if (!migrationRows(container.id, schema, migrations, env)) throw new Error("canonical-migrations-mismatch");
    const nextCli = path.join(mirror, "node_modules", "next", "dist", "bin", "next");
    const build = run(process.execPath, [nextCli, "build", "--webpack"], env, mirror); noteCommand("next build --webpack", build); receipt.phases.nextBuild = build.exitCode === 0 ? "PASS" : "FAIL"; if (build.exitCode !== 0) throw new Error(`next-build-failed:${sanitize(`${build.stdout}\n${build.stderr}`, tempRoot).join(" ")}`);
    const serverLogPath = path.join(tempRoot, "server.log");
    serverLogHandle = fs.openSync(serverLogPath, "a");
    server = spawn(process.execPath, [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(appPort)], { cwd: mirror, env, windowsHide: true, stdio: ["ignore", serverLogHandle, serverLogHandle] });
    if (!server.pid || !(await waitForServer(env.E2E_BASE_URL, server))) throw new Error("next-server-not-ready");
    receipt.commands.push({ name: "next start loopback", exitCode: 0 });
    receipt.phases.server = "PASS";
    const { configPath } = writePlaywrightFiles(mirror, submissionsMode);
    const playwrightCli = path.join(mirror, "node_modules", "playwright", "cli.js");
    const browserRun = run(process.execPath, [playwrightCli, "test", "--config", configPath, "--project", "chromium", "--reporter", "json"], env, mirror); noteCommand(submissionsMode ? "playwright g7-54 chromium" : "playwright g7-53 chromium", browserRun);
    let report = {}; try { report = JSON.parse(browserRun.stdout || "{}"); } catch { receipt.diagnostics.failureClass = "PLAYWRIGHT_JSON_REPORT_INVALID"; }
    const summary = summarizePlaywrightReport(report, tempRoot); Object.assign(receipt.browser, summary); receipt.diagnostics.details = summary.diagnostics;
    const observationPath = path.join(tempScreenshots, submissionsMode ? "g7-54-browser-observation.json" : "g7-05-browser-observation.json");
    if (fs.existsSync(observationPath)) {
      const observation = JSON.parse(fs.readFileSync(observationPath, "utf8"));
      receipt.browser.axeCriticalOrSerious = observation.axe?.criticalOrSerious ?? -1;
      receipt.browser.rwd = observation.rwd ?? receipt.browser.rwd;
      receipt.browser.tenant = observation.tenant ?? receipt.browser.tenant;
      receipt.browser.legacy = observation.legacy ?? receipt.browser.legacy;
      receipt.browser.loading = observation.loading ?? receipt.browser.loading;
      receipt.browser.keyboard = observation.keyboard ?? receipt.browser.keyboard;
      if (submissionsMode) {
        receipt.browser.search = observation.search ?? receipt.browser.search;
        receipt.browser.filters = observation.filters ?? receipt.browser.filters;
        receipt.browser.pagination = observation.pagination ?? receipt.browser.pagination;
        receipt.browser.privacy = observation.privacy ?? receipt.browser.privacy;
        receipt.browser.error = observation.error ?? receipt.browser.error;
        receipt.browser.database = observation.database ?? receipt.browser.database;
      } else {
        receipt.browser.draftRecovery = observation.draftRecovery ?? receipt.browser.draftRecovery;
      }
      fs.rmSync(observationPath, { force: true });
    }
    const sharedBrowserPass = browserRun.exitCode === 0 && receipt.browser.passed === receipt.expected.browserTests && receipt.browser.failed === 0 && receipt.browser.skipped === 0 && receipt.browser.axeCriticalOrSerious === 0 && receipt.browser.rwd.desktop === "PASS" && receipt.browser.rwd.mobile === "PASS" && receipt.browser.tenant === "PASS" && receipt.browser.loading === "PASS" && receipt.browser.keyboard === "PASS";
    const browserPass = submissionsMode
      ? sharedBrowserPass && ["search", "filters", "pagination", "privacy", "error"].every((key) => receipt.browser[key] === "PASS") && receipt.browser.database.rows === receipt.expected.databaseRows && receipt.browser.database.pageSize === receipt.expected.pageSize
      : sharedBrowserPass && receipt.browser.legacy.valid === "PASS" && receipt.browser.legacy.invalidFailClosed === "PASS" && Object.values(receipt.browser.draftRecovery).every((value) => value === "PASS");
    if (browserPass) {
      fs.mkdirSync(screenshots, { recursive: true });
      for (const nameValue of ["desktop", "mobile"]) { const file = path.join(tempScreenshots, `${nameValue}.png`); if (!fs.existsSync(file)) throw new Error(`screenshot-missing:${nameValue}`); const target = path.join(screenshots, `${nameValue}.png`); fs.copyFileSync(file, target); receipt.screenshots[nameValue] = { filename: `${nameValue}.png`, sha256: hashFile(target) }; }
    }
    receipt.phases.browser = browserPass ? "PASS" : "FAIL";
    if (!browserPass && fs.existsSync(serverLogPath)) receipt.diagnostics.serverDetails = sanitize(fs.readFileSync(serverLogPath, "utf8"), tempRoot).slice(-24);
    if (!browserPass) throw new Error("form-builder-browser-contract-failed");
    receipt.status = "PASS";
  } catch (error) {
    const message = error instanceof Error ? error.message : "runner-failed";
    receipt.failure = message.split(":")[0]; receipt.diagnostics.failureClass ??= classifyFailure(message); receipt.diagnostics.details = [...receipt.diagnostics.details, ...sanitize(message, tempRoot)].slice(-24);
  } finally {
    receipt.cleanup.server = stopServer(server);
    if (serverLogHandle !== null) { try { fs.closeSync(serverLogHandle); } catch { receipt.cleanup.server = "FAIL"; } }
    if (!container) receipt.cleanup.container = "NOT_CREATED";
    else {
      const cleanupEnv = env ?? dockerEnv;
      const inspected = inspectContainer(container.id, cleanupEnv);
      const actual = inspected.exitCode === 0 ? parseContainerInspection(inspected.stdout) : null;
      const labelOwned = isOwnedContainerInspection(actual, container);
      const databaseMarker = labelOwned
        ? psql(container.id, "SELECT COALESCE(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = 'celebratedeal_test';", cleanupEnv, "postgres")
        : null;
      const schemaMarker = labelOwned
        ? psql(container.id, `SELECT COALESCE(obj_description(oid, 'pg_namespace'), '') FROM pg_namespace WHERE nspname = '${container.schema}';`, cleanupEnv)
        : null;
      const owned = labelOwned
        && databaseMarker?.exitCode === 0
        && schemaMarker?.exitCode === 0
        && databaseMarker.stdout.trim() === container.marker
        && schemaMarker.stdout.trim() === container.marker;
      if (!owned) {
        receipt.cleanup.syntheticRows = "CLEANUP_BLOCKED";
        receipt.cleanup.container = "CLEANUP_BLOCKED";
      } else {
        const synthetic = psql(container.id, `SELECT COUNT(*) FROM "${schema}"."RegistrationForm" WHERE "slug" LIKE 'g7-%';`, cleanupEnv);
        receipt.cleanup.syntheticRows = synthetic.exitCode === 0 && synthetic.stdout.trim() === "0" ? "PASS" : "FAIL";
        const removed = run("docker", ["rm", "-f", container.id], cleanupEnv);
        const absent = run("docker", ["inspect", container.id], cleanupEnv);
        receipt.cleanup.container = removed.exitCode === 0 && absent.exitCode !== 0 ? "PASS" : "FAIL";
      }
    }
    receipt.cleanup.tempRoot = removeTempRoot(tempRoot, marker);
    if (receipt.status === "PASS" && Object.values(receipt.cleanup).some((value) => value !== "PASS")) { receipt.status = "BLOCKED_OR_FAILED"; receipt.failure = "cleanup-invariant-failed"; }
    receipt.finishedAt = new Date().toISOString();
    writeReceipt(receipt, receiptPath);
  }
  process.stdout.write(`${JSON.stringify({ workPackage: receipt.workPackage, status: receipt.status, phases: receipt.phases, browser: receipt.browser, cleanup: receipt.cleanup, receipt: path.basename(receiptPath) })}\n`);
  if (receipt.status !== "PASS") process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) await main();
