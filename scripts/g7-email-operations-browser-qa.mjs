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
const runNamePattern = /^celebratedeal-g7-email-operations-browser-[a-f0-9]{16}$/u;
const schemaPattern = /^g7_55_browser_[a-f0-9]{16}$/u;
const migrationPattern = /^\d{12,14}_[a-z0-9_]+$/u;
export const EXPECTED_CANONICAL_MIGRATIONS = 59;
const sourceDigestPaths = [
  "prisma/schema.prisma",
  "prisma/migrations/20260810060000_g7_55_email_delivery_operations/migration.sql",
  "src/app/(app)/messages/deliveries/page.tsx",
  "src/app/(app)/messages/deliveries/loading.tsx",
  "src/app/(app)/messages/deliveries/error.tsx",
  "src/components/email-delivery-operations-workbench.tsx",
  "src/app/actions/email-delivery-operations-actions.ts",
  "src/lib/email-delivery-operations-contract.ts",
  "src/lib/email-delivery-operations.ts",
  "src/lib/email-delivery.ts",
  "src/lib/email-delivery-pii.ts",
  "src/lib/auth.ts",
  "src/lib/csrf.ts",
];

function run(command, args, env, cwd = root) {
  const child = spawnSync(command, args, { cwd, env, encoding: "utf8", windowsHide: true, shell: process.platform === "win32" && command.endsWith(".cmd"), maxBuffer: 8 * 1024 * 1024 });
  return { exitCode: child.status ?? 1, stdout: child.stdout ?? "", stderr: child.stderr ?? "" };
}

function hashFile(filePath) { return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"); }

export function canonicalMigrations() {
  return fs.readdirSync(path.join(root, "prisma", "migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && migrationPattern.test(entry.name)).map((entry) => entry.name).sort();
}

export function safeSourceDigest() {
  const digest = crypto.createHash("sha256");
  for (const relativePath of sourceDigestPaths) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) throw new Error(`source-digest-path-missing:${relativePath}`);
    digest.update(relativePath).update("\0").update(fs.readFileSync(absolutePath)).update("\0");
  }
  for (const name of canonicalMigrations()) digest.update(name).update("\0").update(fs.readFileSync(path.join(root, "prisma", "migrations", name, "migration.sql"))).update("\0");
  return digest.digest("hex");
}

export function ignoredMirrorPath(relativePath) {
  const parts = relativePath.replaceAll("\\", "/").split("/");
  return !relativePath || parts.some((part) => [".git", ".next", "node_modules", ".ai-team", "test-results", "playwright-report", "tmp"].includes(part)) || parts.some((part) => part === ".env" || part.startsWith(".env."));
}

function copySourceTree(source, destination, relative = "") {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (ignoredMirrorPath(childRelative)) continue;
    const sourcePath = path.join(source, entry.name); const destinationPath = path.join(destination, entry.name);
    if (fs.lstatSync(sourcePath).isSymbolicLink()) continue;
    if (entry.isDirectory()) copySourceTree(sourcePath, destinationPath, childRelative);
    else if (entry.isFile()) fs.copyFileSync(sourcePath, destinationPath);
  }
}

function linkNodeModules(mirror) {
  const source = path.join(root, "node_modules"); const target = path.join(mirror, "node_modules");
  if (!fs.existsSync(source)) throw new Error("node-modules-missing");
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".prisma" || entry.name === "@prisma") continue;
    const from = path.join(source, entry.name); const to = path.join(target, entry.name);
    if (entry.name === "next") fs.cpSync(from, to, { recursive: true, dereference: false });
    else fs.symlinkSync(from, to, fs.statSync(from).isDirectory() ? "junction" : "file");
  }
  fs.cpSync(path.join(source, "@prisma"), path.join(target, "@prisma"), { recursive: true, dereference: false });
}

function writePrismaConfig(mirror) {
  const config = path.join(mirror, "prisma.g7-email-operations.config.mjs");
  fs.writeFileSync(config, 'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\nconst { defineConfig } = require("prisma/config");\nexport default defineConfig({ schema: "prisma/schema.prisma", engine: "classic", migrations: { path: "prisma/migrations" }, datasource: { url: process.env.DATABASE_URL } });\n');
  return config;
}

function writeNetworkGuard(tempRoot) {
  const guard = path.join(tempRoot, "loopback-network-guard.cjs");
  fs.writeFileSync(guard, [
    'const allowed = new Set(["127.0.0.1", "localhost", "::1"]);',
    'const host = (value) => { try { if (typeof value === "string") return new URL(value).hostname; return String(value?.hostname || value?.host || "").replace(/^\\[/, "").replace(/\\]$/, "").split(":")[0]; } catch { return null; } };',
    'const local = (value) => { const valueHost = host(value); return valueHost === null || allowed.has(valueHost); };',
    'const denied = () => { throw new Error("G7_EMAIL_OPERATIONS_EXTERNAL_NETWORK_DENIED"); };',
    'for (const name of ["http", "https"]) { const value = require(name); const request = value.request; value.request = function (...args) { if (!local(args[0])) return denied(); return request.apply(this, args); }; }',
    'const net = require("net"); const connect = net.connect; net.connect = net.createConnection = function (...args) { if (!local(args[0])) return denied(); return connect.apply(this, args); };',
    'if (global.fetch) { const fetch = global.fetch; global.fetch = (input, init) => local(input) ? fetch(input, init) : Promise.reject(new Error("G7_EMAIL_OPERATIONS_EXTERNAL_NETWORK_DENIED")); }',
  ].join("\n"));
  return guard;
}

function allocatePort() { return new Promise((resolve) => { const server = net.createServer(); server.once("error", () => resolve(null)); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(typeof address === "object" && address ? address.port : null)); }); }); }

async function waitForPostgres(containerId, env) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (run("docker", ["exec", containerId, "pg_isready", "-U", "postgres", "-d", "celebratedeal_test"], env).exitCode === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("postgres-start-timeout");
}

export function safeEnvironment({ tempRoot, port, databaseUrl, schema, screenshotDirectory, networkGuard, playwrightBrowsersPath }) {
  return {
    PATH: process.env.PATH ?? process.env.Path ?? "", SystemRoot: process.env.SystemRoot ?? "", WINDIR: process.env.WINDIR ?? "", ComSpec: process.env.ComSpec ?? "", PATHEXT: process.env.PATHEXT ?? "",
    TEMP: path.join(tempRoot, "tmp"), TMP: path.join(tempRoot, "tmp"), USERPROFILE: path.join(tempRoot, "home"), DOCKER_CONFIG: path.join(tempRoot, "docker-config"),
    NODE_ENV: "production", CI: "true", NEXT_TELEMETRY_DISABLED: "1", NPM_CONFIG_OFFLINE: "true", NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false", PRISMA_HIDE_UPDATE_MESSAGE: "true", PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
    DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, E2E_BASE_URL: `http://127.0.0.1:${port}`, NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`, G7_EMAIL_OPERATIONS_BROWSER_SCHEMA: schema, G7_EMAIL_OPERATIONS_SCREENSHOT_DIR: screenshotDirectory,
    PAYMENT_PROVIDER: "demo", RATE_LIMIT_PROVIDER: "memory", JOB_SECRET: "g7-55-local-synthetic-job-secret", CSRF_SECRET: "g7-55-local-synthetic-csrf-secret", RESEND_API_KEY: "", SENTRY_DSN: "", NEXT_PUBLIC_SENTRY_DSN: "", SENTRY_DISABLE_AUTO_UPLOAD: "true", NODE_OPTIONS: `--require=${networkGuard}`,
  };
}

export function sanitize(value, tempRoot) {
  // Keep enough sanitized lines to diagnose every Playwright test. A global
  // 20-line cap previously discarded the second and third failure entirely.
  return String(value).replaceAll(tempRoot, "<temp>").replace(/postgres(?:ql)?:\/\/[^\s@]+@/giu, "postgresql://<redacted>@").replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, "<redacted-email>").replace(/\b[a-f0-9]{32,}\b/giu, "<redacted-id>").replace(/\b[^\s]{48,}\b/gu, "<synthetic-value>").split(/\r?\n/u).filter(Boolean).slice(0, 80);
}

export function classifyFailure(value) {
  const text = String(value);
  if (/G7_EMAIL_OPERATIONS_EXTERNAL_NETWORK_DENIED/u.test(text)) return "EXTERNAL_NETWORK_DENIED";
  if (/Cannot connect to the Docker daemon/u.test(text)) return "DOCKER_UNAVAILABLE";
  if (/Another next build process/u.test(text)) return "NEXT_BUILD_LOCKED";
  if (/Failed to compile/u.test(text)) return "NEXT_COMPILE_FAILED";
  if (/Failed to collect page data|prerender/u.test(text)) return "NEXT_PRERENDER_FAILED";
  if (/AXE_BLOCKING/u.test(text)) return "PLAYWRIGHT_AXE_BLOCKING";
  if (/RWD_HORIZONTAL_OVERFLOW/u.test(text)) return "PLAYWRIGHT_RWD_HORIZONTAL_OVERFLOW";
  if (/Timeout|strict mode violation/u.test(text)) return "PLAYWRIGHT_CONTRACT_FAILED";
  return "RUNNER_FAILED_UNCLASSIFIED";
}

export function parseContainerInspection(value) {
  const fields = String(value).trim().split("\t");
  return fields.length === 5 && fields.every(Boolean) ? { id: fields[0], name: fields[1], runId: fields[2], marker: fields[3], mount: fields[4] } : null;
}
export function isOwnedContainerInspection(actual, expected) { return Boolean(actual && actual.id === expected.id && actual.name === `/${expected.name}` && actual.runId === expected.runId && actual.marker === expected.marker && actual.mount === '{"/var/lib/postgresql/data":""}'); }

export function removeTempRoot(tempRoot, marker) {
  const expected = path.join(os.tmpdir(), path.basename(tempRoot));
  if (tempRoot !== expected || !runNamePattern.test(path.basename(tempRoot)) || fs.readFileSync(path.join(tempRoot, ".marker"), "utf8") !== marker) return "CLEANUP_BLOCKED";
  const modules = path.join(tempRoot, "mirror", "node_modules");
  if (fs.existsSync(modules)) fs.rmSync(modules, { recursive: true, force: true, maxRetries: 3 });
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3 });
  return fs.existsSync(tempRoot) ? "FAIL" : "PASS";
}

function psql(containerId, sql, env) {
  return run("docker", ["exec", containerId, "psql", "-U", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-d", "celebratedeal_test", "-c", sql], env);
}

function inspectContainer(containerId, env) {
  return run("docker", ["inspect", "--format", '{{.Id}}\t{{.Name}}\t{{index .Config.Labels "g7.runId"}}\t{{index .Config.Labels "g7.marker"}}\t{{json .HostConfig.Tmpfs}}', containerId], env);
}

function summarizePlaywrightReport(report, tempRoot) {
  const specs = [];
  const visit = (suite) => { for (const spec of suite?.specs ?? []) specs.push(spec); for (const child of suite?.suites ?? []) visit(child); };
  for (const suite of report?.suites ?? []) visit(suite);
  const statuses = specs.flatMap((spec) => spec.tests ?? []).map((test) => test.results?.at(-1)?.status ?? "unknown");
  const diagnostics = specs.flatMap((spec) => (spec.tests ?? []).flatMap((test) => (test.results ?? []).flatMap((result) => (result.errors ?? []).map((error) => `${spec.title}: ${error.message ?? error.stack ?? "browser assertion failed"}`))));
  return {
    passed: statuses.filter((status) => status === "passed").length,
    failed: statuses.filter((status) => status === "failed" || status === "timedOut" || status === "interrupted").length,
    skipped: statuses.filter((status) => status === "skipped").length,
    tests: specs.map((spec) => ({
      title: spec.title,
      status: spec.tests?.at(-1)?.results?.at(-1)?.status ?? "unknown",
    })),
    diagnostics: sanitize(diagnostics.join("\n"), tempRoot),
  };
}

export function mergeBrowserObservations(observations) {
  const merged = {
    axeCriticalOrSerious: 0,
    pageSize: 0,
    search: "NOT_RUN",
    filters: "NOT_RUN",
    pagination: "NOT_RUN",
    privacy: "NOT_RUN",
    requeue: "NOT_RUN",
    providerRejected: "NOT_RUN",
    pending: "NOT_RUN",
    csrf: "NOT_RUN",
    keyboard: "NOT_RUN",
    tenantIsolation: "NOT_RUN",
    rwd: { desktop: "NOT_RUN", mobile: "NOT_RUN" },
  };
  const behaviorKeys = ["search", "filters", "pagination", "privacy", "requeue", "providerRejected", "pending", "csrf", "keyboard", "tenantIsolation"];
  for (const observation of observations) {
    merged.axeCriticalOrSerious += Number.isFinite(observation?.axeCriticalOrSerious)
      ? observation.axeCriticalOrSerious
      : 0;
    merged.pageSize = Math.max(merged.pageSize, Number.isFinite(observation?.pageSize) ? observation.pageSize : 0);
    for (const key of behaviorKeys) {
      if (observation?.[key] === "PASS") merged[key] = "PASS";
    }
    if (observation?.rwd?.desktop === "PASS") merged.rwd.desktop = "PASS";
    if (observation?.rwd?.mobile === "PASS") merged.rwd.mobile = "PASS";
  }
  return merged;
}

export function validateReceipt(receipt) {
  const required = ["schemaVersion", "runId", "workPackage", "status", "startedAt", "finishedAt", "sourceDigest", "commands", "expected", "phases", "browser", "cleanup", "safety", "screenshots"];
  const screenHashes = [receipt?.screenshots?.desktop?.sha256, receipt?.screenshots?.mobile?.sha256];
  const phaseKeys = ["mirror", "prismaGenerate", "prismaValidate", "prismaDeploy", "prismaStatus", "nextBuild", "server", "browser"];
  const behaviorKeys = ["search", "filters", "pagination", "privacy", "requeue", "providerRejected", "pending", "csrf", "keyboard", "tenantIsolation"];
  return required.every((key) => key in (receipt ?? {}))
    && receipt.schemaVersion === "celebratedeal-g7-55-email-operations-browser-qa/v1"
    && receipt.workPackage === "G7-55"
    && receipt.status === "PASS"
    && /^[a-f0-9]{16}$/u.test(receipt.runId)
    && /^[a-f0-9]{64}$/u.test(receipt.sourceDigest)
    && Array.isArray(receipt.commands)
    && receipt.commands.every((command) => command && typeof command.name === "string" && command.exitCode === 0)
    && receipt.expected?.canonicalMigrations === EXPECTED_CANONICAL_MIGRATIONS
    && receipt.expected?.emailDeliveries >= 55
    && receipt.expected?.browserTests === 5
    && receipt.browser?.passed === 5
    && receipt.browser?.failed === 0
    && receipt.browser?.skipped === 0
    && receipt.browser?.axeCriticalOrSerious === 0
    && receipt.browser?.pageSize === 25
    && receipt.browser?.rwd?.desktop === "PASS"
    && receipt.browser?.rwd?.mobile === "PASS"
    && behaviorKeys.every((key) => receipt.browser?.[key] === "PASS")
    && phaseKeys.every((key) => receipt.phases?.[key] === "PASS")
    && Object.values(receipt.cleanup).every((value) => value === "PASS")
    && Object.values(receipt.safety).every((value) => value === false)
    && screenHashes.every((value) => /^[a-f0-9]{64}$/u.test(value));
}

export function assertStaticSafety(source) { const inspected = String(source).replace(/export function assertStaticSafety[^\n]*\n/u, ""); return !/(?:require|import)[^(;]*\(?\s*["']do[t]env|do[t]env\s*\.\s*config|launchPersistentContext|userDataDir|(?:fetch|request|goto)\(\s*["']https:\/\/(?!localhost|127\.0\.0\.1)/u.test(inspected); }

function writeVerifiedBrowserFiles(mirror) {
  const specPath = path.join(mirror, "tests", "e2e", "g7-email-operations-verified.spec.ts");
  const configPath = path.join(mirror, "playwright.g7-email-operations.config.ts");
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.writeFileSync(configPath, `import { defineConfig, devices } from "@playwright/test";
export default defineConfig({ testDir: "./tests/e2e", testMatch: "g7-email-operations-verified.spec.ts", workers: 1, retries: 0, timeout: 45000, expect: { timeout: 10000 }, use: { baseURL: process.env.E2E_BASE_URL, trace: "off", screenshot: "off", video: "off" }, projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }] });
`);
  fs.writeFileSync(specPath, `import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createEmailRecipientHash } from "../../src/lib/email-delivery-pii";

const baseURL = process.env.E2E_BASE_URL!; const screenshotDir = process.env.G7_EMAIL_OPERATIONS_SCREENSHOT_DIR!; const db = new PrismaClient(); const suffix = crypto.randomBytes(8).toString("hex");
const targetEmail = "target-" + suffix + "@example.test"; const foreignEmail = "foreign-" + suffix + "@example.test"; const foreignCanary = "G7-55 FOREIGN CANARY " + suffix;
const fixture = { vendorId: "", foreignVendorId: "", token: "", failedId: "", liveReminderFailedId: "", rejectedId: "" };
function freshEvidence() { return { axeCriticalOrSerious: 0, pageSize: 0, search: "NOT_RUN", filters: "NOT_RUN", pagination: "NOT_RUN", privacy: "NOT_RUN", requeue: "NOT_RUN", providerRejected: "NOT_RUN", pending: "NOT_RUN", csrf: "NOT_RUN", keyboard: "NOT_RUN", tenantIsolation: "NOT_RUN", rwd: { desktop: "NOT_RUN", mobile: "NOT_RUN" } }; }
let evidence = freshEvidence();
async function persist(title: string) { const key = crypto.createHash("sha256").update(title).digest("hex").slice(0, 12); await mkdir(screenshotDir, { recursive: true }); await writeFile(join(screenshotDir, "observation-" + key + ".json"), JSON.stringify(evidence)); }
async function owner(page: any) { await page.context().addCookies([{ name: "celebrate_session", value: fixture.token, url: baseURL, httpOnly: true, sameSite: "Lax" }]); }
async function axe(page: any) { const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze(); const blockers = result.violations.filter((item: any) => item.impact === "critical" || item.impact === "serious"); evidence.axeCriticalOrSerious += blockers.length; expect(blockers).toEqual([]); }
async function noOverflow(page: any, viewport: "desktop" | "mobile") { expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1); evidence.rwd[viewport] = "PASS"; }
async function expectResultCount(page: any, expected: number) { try { await expect(page.locator("article")).toHaveCount(expected); } catch { const alerts = await page.locator('[role="alert"]:visible').allTextContents(); const statuses = await page.locator('[role="status"]:visible').allTextContents(); const freshness = await page.locator("form[data-result-freshness]").getAttribute("data-result-freshness"); const actual = await page.locator("article").count(); throw new Error("EMAIL_OPERATIONS_UI_RESULT_MISMATCH expected=" + expected + " actual=" + actual + " freshness=" + freshness + " alerts=" + alerts.join("|") + " statuses=" + statuses.slice(0, 4).join("|")); } }

test.beforeAll(async () => { const vendor = await db.vendor.create({ data: { name: "G7-55 Owner", slug: "g7-55-owner-" + suffix, email: "owner-" + suffix + "@celebratedeal.test", passwordHash: "synthetic", tracking: { create: {} } } }); const foreign = await db.vendor.create({ data: { name: "G7-55 Foreign", slug: "g7-55-foreign-" + suffix, email: "foreign-" + suffix + "@celebratedeal.test", passwordHash: "synthetic", tracking: { create: {} } } }); const user = await db.user.create({ data: { email: "operator-" + suffix + "@celebratedeal.test", name: "G7-55 operator", passwordHash: "synthetic", status: "active", memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } } } }); fixture.vendorId = vendor.id; fixture.foreignVendorId = foreign.id; fixture.token = crypto.randomBytes(32).toString("base64url"); await db.userSession.create({ data: { userId: user.id, vendorId: vendor.id, tokenHash: crypto.createHash("sha256").update(fixture.token).digest("hex"), expiresAt: new Date(Date.now() + 3600000) } }); const rows = Array.from({ length: 55 }, (_, index) => ({ id: "g755_" + suffix + "_" + index, vendorId: vendor.id, sourceTemplateId: "template-" + suffix, trigger: index === 3 ? "registration_confirmed" : index % 2 ? "live_reminder" : "registration_confirmed", payloadEncryptedEnvelope: "synthetic-envelope", recipientHash: index === 0 ? createEmailRecipientHash(targetEmail, vendor.id) : crypto.createHash("sha256").update("row-" + index + suffix).digest("hex"), recipientMaskedEmail: "u***" + index + "@example.test", idempotencyKey: "g755-" + suffix + "-" + index, status: index === 1 || index === 2 ? "exhausted" : index === 3 || index === 5 ? "failed" : "sent", attemptCount: index === 1 || index === 2 ? 5 : 1, maxAttempts: 5, lastErrorCode: index === 2 ? "provider_rejected" : index === 1 || index === 3 || index === 5 ? "network" : null, createdAt: new Date(Date.UTC(2026, 7, 10, 0, index)) })); await db.emailDelivery.createMany({ data: rows }); fixture.rejectedId = rows[2].id; fixture.failedId = rows[3].id; fixture.liveReminderFailedId = rows[5].id; await db.emailDelivery.create({ data: { ...rows[0], id: "g755_foreign_" + suffix, vendorId: foreign.id, idempotencyKey: "foreign-" + suffix, recipientHash: createEmailRecipientHash(foreignEmail, foreign.id), recipientMaskedEmail: foreignCanary } }); });
test.beforeEach(async () => { evidence = freshEvidence(); });
test.afterEach(async ({}, testInfo) => { await persist(testInfo.title); });
test.afterAll(async () => { try { await db.vendor.deleteMany({ where: { id: { in: [fixture.vendorId, fixture.foreignVendorId] } } }); } finally { await db.$disconnect(); } });

test("desktop search filters reset pagination and URL privacy", async ({ page }) => { await owner(page); await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto("/messages/deliveries"); await expect(page.getByRole("heading", { name: "Email 寄送營運" })).toBeVisible(); await expectResultCount(page, 25); evidence.pageSize = await page.locator("article").count(); await page.getByRole("button", { name: "下一頁" }).click(); await expect(page.getByRole("status").filter({ hasText: "共" })).toContainText("第 2／3 頁"); evidence.pagination = "PASS"; await page.getByLabel("完整收件 Email 或寄送編號").fill(targetEmail); await page.getByRole("button", { name: "查詢", exact: true }).click(); await expectResultCount(page, 1); await expect(page.locator("article")).toContainText("u***0@example.test"); expect(page.url()).toBe(baseURL + "/messages/deliveries"); evidence.search = "PASS"; evidence.privacy = "PASS"; await page.getByRole("button", { name: "清除", exact: true }).click(); await expectResultCount(page, 25); await page.getByLabel("寄送狀態").selectOption("failed"); await page.getByLabel("通知類型").selectOption("live_reminder"); await page.getByRole("button", { name: "查詢", exact: true }).click(); await expectResultCount(page, 1); await expect(page.locator("article")).toContainText(fixture.liveReminderFailedId); evidence.filters = "PASS"; await noOverflow(page, "desktop"); await axe(page); await page.screenshot({ path: join(screenshotDir, "desktop.png"), fullPage: true }); });

test("safe requeue preserves immutable provider identity and permanent rejection stays closed", async ({ page }) => { await owner(page); await page.goto("/messages/deliveries"); await page.getByLabel("完整收件 Email 或寄送編號").fill(fixture.failedId); await page.getByRole("button", { name: "查詢", exact: true }).click(); await expectResultCount(page, 1); const before = await db.emailDelivery.findUniqueOrThrow({ where: { id: fixture.failedId }, select: { idempotencyKey: true, payloadEncryptedEnvelope: true } }); page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "重新排程" }).click(); await expect(page.getByRole("status").filter({ hasText: "重新排入寄送佇列" })).toBeVisible(); await expect(db.emailDelivery.findUnique({ where: { id: fixture.failedId } })).resolves.toMatchObject({ status: "queued", manualRetryCount: 1, idempotencyKey: before.idempotencyKey, payloadEncryptedEnvelope: before.payloadEncryptedEnvelope }); evidence.requeue = "PASS"; await page.getByLabel("完整收件 Email 或寄送編號").fill(fixture.rejectedId); await page.getByRole("button", { name: "查詢", exact: true }).click(); await expectResultCount(page, 1); const rejected = page.locator("article").filter({ hasText: fixture.rejectedId }); await expect(rejected).toBeVisible(); await expect(rejected.getByRole("button", { name: "重新排程" })).toHaveCount(0); await expect(db.emailDelivery.findUnique({ where: { id: fixture.rejectedId } })).resolves.toMatchObject({ status: "exhausted", lastErrorCode: "provider_rejected" }); evidence.providerRejected = "PASS"; });

test("mobile RWD keyboard and Axe", async ({ page }) => { await owner(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/messages/deliveries"); await expectResultCount(page, 25); await noOverflow(page, "mobile"); await axe(page); await page.screenshot({ path: join(screenshotDir, "mobile.png"), fullPage: true }); await page.setViewportSize({ width: 1440, height: 1000 }); await page.reload(); const query = page.getByLabel("完整收件 Email 或寄送編號"); const status = page.getByLabel("寄送狀態"); const trigger = page.getByLabel("通知類型"); const submit = page.getByRole("button", { name: "查詢", exact: true }); await expect(query).toBeVisible(); await expect(query).toBeEnabled(); await query.click(); await expect(query).toBeFocused(); await page.keyboard.press("Tab"); await expect(status).toBeFocused(); await page.keyboard.press("Tab"); await expect(trigger).toBeFocused(); await page.keyboard.press("Tab"); await expect(submit).toBeFocused(); await query.fill(""); await status.selectOption("failed"); await trigger.selectOption("live_reminder"); await submit.focus(); await expect(submit).toBeFocused(); await page.keyboard.press("Enter"); await expectResultCount(page, 1); evidence.keyboard = "PASS"; });

test("pending disables duplicate submit and expired CSRF does not echo query", async ({ page }) => { await owner(page); await page.goto("/messages/deliveries"); let release: (() => void) | undefined; const held = new Promise<void>((resolve) => { release = resolve; }); let intercepted = false; await page.route("**/messages/deliveries", async (route) => { if (route.request().method() === "POST" && !intercepted) { intercepted = true; await held; } await route.continue(); }); const click = page.getByRole("button", { name: "查詢", exact: true }).click({ noWaitAfter: true }); await expect(page.getByRole("button", { name: "查詢中…" })).toBeDisabled(); await expect(page.locator("form[aria-busy=true]")).toBeVisible(); expect(intercepted).toBe(true); evidence.pending = "PASS"; release?.(); await click; await page.unroute("**/messages/deliveries"); await expect(page.locator("form[aria-busy=false]")).toBeVisible(); const privateQuery = "private-" + suffix + "@example.test"; await page.getByLabel("完整收件 Email 或寄送編號").fill(privateQuery); await page.locator('#email-delivery-operations-form input[name="_csrf"]').evaluate((element) => { (element as HTMLInputElement).value = "invalid"; }); await page.getByRole("button", { name: "查詢", exact: true }).click(); const alert = page.locator('#email-delivery-operations-form p[role="alert"]'); await expect(alert).toContainText("安全驗證已失效"); await expect(alert).toContainText("本次條件尚未套用"); await expect(alert).not.toContainText(privateQuery); expect(await page.content()).not.toContain(privateQuery); evidence.csrf = "PASS"; });

test("foreign tenant exact email search leaks no identity", async ({ page }) => { await owner(page); await page.goto("/messages/deliveries"); await page.getByLabel("完整收件 Email 或寄送編號").fill(foreignEmail); await page.getByRole("button", { name: "查詢", exact: true }).click(); await expectResultCount(page, 0); await expect(page.getByRole("status").filter({ hasText: "共" })).toContainText("0"); await expect(page.getByText(foreignCanary, { exact: true })).toHaveCount(0); expect(await page.content()).not.toContain(foreignCanary); expect(page.url()).toBe(baseURL + "/messages/deliveries"); evidence.tenantIsolation = "PASS"; });
`);
  return { specPath, configPath };
}

function writeReceipt(receipt, receiptPath) {
  if (fs.existsSync(receiptPath)) throw new Error("receipt-exists-no-overwrite");
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  fs.writeFileSync(receiptPath, serialized, { flag: "wx" });
  const digest = crypto.createHash("sha256").update(serialized).digest("hex");
  fs.writeFileSync(`${receiptPath}.sha256`, `${digest}  ${path.basename(receiptPath)}\n`, { flag: "wx" });
  return digest;
}

function stopServer(server) {
  if (!server?.pid || server.exitCode !== null) return "PASS";
  if (process.platform === "win32") return run("taskkill", ["/PID", String(server.pid), "/T", "/F"], process.env).exitCode === 0 ? "PASS" : "FAIL";
  server.kill("SIGTERM");
  return "PASS";
}

export async function main() {
  const runId = crypto.randomBytes(8).toString("hex");
  const name = `celebratedeal-g7-email-operations-browser-${runId}`;
  const marker = `g7-55-browser:${runId}`;
  const schema = `g7_55_browser_${runId}`;
  const tempRoot = path.join(os.tmpdir(), name);
  const receiptStem = `g7-55-email-operations-browser-qa-${runId}`;
  const receiptPath = path.join(evidenceRoot, `${receiptStem}.json`);
  const screenshots = path.join(evidenceRoot, `${receiptStem}-screenshots`);
  const receipt = {
    schemaVersion: "celebratedeal-g7-55-email-operations-browser-qa/v1",
    runId,
    workPackage: "G7-55",
    status: "BLOCKED_OR_FAILED",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    sourceDigest: safeSourceDigest(),
    commands: [],
    expected: { canonicalMigrations: EXPECTED_CANONICAL_MIGRATIONS, emailDeliveries: 55, pageSize: 25, browserTests: 5 },
    phases: { mirror: "NOT_RUN", prismaGenerate: "NOT_RUN", prismaValidate: "NOT_RUN", prismaDeploy: "NOT_RUN", prismaStatus: "NOT_RUN", nextBuild: "NOT_RUN", server: "NOT_RUN", browser: "NOT_RUN" },
    browser: { passed: 0, failed: 0, skipped: 0, axeCriticalOrSerious: -1, pageSize: 0, search: "NOT_RUN", filters: "NOT_RUN", pagination: "NOT_RUN", privacy: "NOT_RUN", requeue: "NOT_RUN", providerRejected: "NOT_RUN", pending: "NOT_RUN", csrf: "NOT_RUN", keyboard: "NOT_RUN", tenantIsolation: "NOT_RUN", rwd: { desktop: "NOT_RUN", mobile: "NOT_RUN" } },
    cleanup: { syntheticRows: "NOT_RUN", server: "NOT_RUN", container: "NOT_RUN", tempRoot: "NOT_RUN" },
    safety: { dotenvContentsRead: false, userBrowserProfileRead: false, externalOperations: false, productionOperations: false },
    screenshots: { desktop: null, mobile: null },
    failure: null,
  };
  let server = null;
  let serverLogHandle = null;
  let container = null;
  let env = null;
  const dockerEnv = { PATH: process.env.PATH ?? process.env.Path ?? "", SystemRoot: process.env.SystemRoot ?? "", WINDIR: process.env.WINDIR ?? "", ComSpec: process.env.ComSpec ?? "", PATHEXT: process.env.PATHEXT ?? "" };
  const note = (nameValue, result) => receipt.commands.push({ name: nameValue, exitCode: result.exitCode });

  try {
    if (!runNamePattern.test(name) || !schemaPattern.test(schema) || canonicalMigrations().length !== EXPECTED_CANONICAL_MIGRATIONS || !assertStaticSafety(fs.readFileSync(scriptPath, "utf8"))) throw new Error("runner-contract-invalid");
    fs.mkdirSync(tempRoot, { recursive: true });
    for (const directory of ["tmp", "home", "docker-config", "screenshots"]) fs.mkdirSync(path.join(tempRoot, directory), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, ".marker"), marker, { encoding: "utf8", flag: "wx" });
    const mirror = path.join(tempRoot, "mirror");
    copySourceTree(root, mirror);
    linkNodeModules(mirror);
    if (fs.existsSync(path.join(mirror, ".env")) || fs.existsSync(path.join(mirror, ".env.local"))) throw new Error("mirror-dotenv-leak");
    receipt.phases.mirror = "PASS";

    const appPort = await allocatePort();
    const databasePort = await allocatePort();
    if (!appPort || !databasePort) throw new Error("loopback-port-unavailable");
    const configuredBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
    const localAppDataBrowsers = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "ms-playwright") : null;
    const browsers = configuredBrowsers && fs.existsSync(configuredBrowsers) ? configuredBrowsers : localAppDataBrowsers;
    if (!browsers || path.basename(browsers) !== "ms-playwright" || !fs.existsSync(browsers)) throw new Error("playwright-cache-missing");
    const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${databasePort}/celebratedeal_test?schema=${schema}`;
    env = safeEnvironment({ tempRoot, port: appPort, databaseUrl, schema, screenshotDirectory: path.join(tempRoot, "screenshots"), networkGuard: writeNetworkGuard(tempRoot), playwrightBrowsersPath: browsers });

    const imageCheck = run("docker", ["image", "inspect", image], dockerEnv); note("docker image inspect", imageCheck); if (imageCheck.exitCode !== 0) throw new Error("docker-image-unavailable");
    const started = run("docker", ["run", "-d", "--pull=never", "--name", name, "--label", `g7.runId=${runId}`, "--label", `g7.marker=${marker}`, "--tmpfs", "/var/lib/postgresql/data", "-p", `127.0.0.1:${databasePort}:5432`, "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=celebratedeal_test", image], dockerEnv);
    note("docker run disposable postgres", started);
    if (started.exitCode !== 0 || !/^[a-f0-9]{64}\s*$/iu.test(started.stdout)) throw new Error("container-create-failed");
    container = { id: started.stdout.trim(), name, runId, marker };
    await waitForPostgres(container.id, dockerEnv);

    const prismaConfig = writePrismaConfig(mirror);
    const { configPath } = writeVerifiedBrowserFiles(mirror);
    const prismaCli = path.join(mirror, "node_modules", "prisma", "build", "index.js");
    for (const [phase, args] of [["prismaGenerate", ["generate"]], ["prismaValidate", ["validate"]], ["prismaDeploy", ["migrate", "deploy"]], ["prismaStatus", ["migrate", "status"]]]) {
      const result = run(process.execPath, [prismaCli, ...args, "--config", prismaConfig], env, mirror);
      note(`prisma ${args.join(" ")}`, result);
      receipt.phases[phase] = result.exitCode === 0 ? "PASS" : "FAIL";
      if (result.exitCode !== 0) throw new Error(`${phase}-failed:${sanitize(`${result.stdout}\n${result.stderr}`, tempRoot).join(" ")}`);
    }

    const nextCli = path.join(mirror, "node_modules", "next", "dist", "bin", "next");
    const build = run(process.execPath, [nextCli, "build", "--webpack"], env, mirror);
    note("next build --webpack", build);
    receipt.phases.nextBuild = build.exitCode === 0 ? "PASS" : "FAIL";
    if (build.exitCode !== 0) throw new Error(`next-build-failed:${sanitize(`${build.stdout}\n${build.stderr}`, tempRoot).join(" ")}`);

    const serverLogPath = path.join(tempRoot, "server.log");
    serverLogHandle = fs.openSync(serverLogPath, "a");
    server = spawn(process.execPath, [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(appPort)], { cwd: mirror, env, windowsHide: true, stdio: ["ignore", serverLogHandle, serverLogHandle] });
    const deadline = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < deadline && server.exitCode === null) {
      try { const response = await fetch(env.E2E_BASE_URL, { redirect: "manual" }); if (response.status > 0) { ready = true; break; } } catch { /* loopback server is still starting */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error("next-server-not-ready");
    receipt.commands.push({ name: "next start loopback", exitCode: 0 });
    receipt.phases.server = "PASS";

    const playwrightCli = path.join(mirror, "node_modules", "playwright", "cli.js");
    const browserRun = run(process.execPath, [playwrightCli, "test", "--config", configPath, "--project", "chromium", "--reporter", "json"], env, mirror);
    note("playwright g7-55 chromium", browserRun);
    let report = null;
    try { report = JSON.parse(browserRun.stdout || "null"); } catch { throw new Error("playwright-json-invalid"); }
    Object.assign(receipt.browser, summarizePlaywrightReport(report, tempRoot));
    const observationDirectory = path.join(tempRoot, "screenshots");
    const observationFiles = fs.existsSync(observationDirectory)
      ? fs.readdirSync(observationDirectory).filter((name) => /^observation-[a-f0-9]{12}\.json$/u.test(name))
      : [];
    if (observationFiles.length !== 5) throw new Error(`browser-observation-count:${observationFiles.length}`);
    const observations = observationFiles.map((name) => JSON.parse(fs.readFileSync(path.join(observationDirectory, name), "utf8")));
    Object.assign(receipt.browser, mergeBrowserObservations(observations));
    const behaviorKeys = ["search", "filters", "pagination", "privacy", "requeue", "providerRejected", "pending", "csrf", "keyboard", "tenantIsolation"];
    const browserPass = browserRun.exitCode === 0 && receipt.browser.passed === 5 && receipt.browser.failed === 0 && receipt.browser.skipped === 0 && receipt.browser.axeCriticalOrSerious === 0 && receipt.browser.pageSize === 25 && receipt.browser.rwd.desktop === "PASS" && receipt.browser.rwd.mobile === "PASS" && behaviorKeys.every((key) => receipt.browser[key] === "PASS");
    receipt.phases.browser = browserPass ? "PASS" : "FAIL";
    if (!browserPass) throw new Error(`browser-contract-failed:${sanitize(browserRun.stderr, tempRoot).join(" ")}`);

    fs.mkdirSync(screenshots, { recursive: true });
    for (const kind of ["desktop", "mobile"]) {
      const source = path.join(tempRoot, "screenshots", `${kind}.png`);
      if (!fs.existsSync(source)) throw new Error(`screenshot-missing:${kind}`);
      const target = path.join(screenshots, `${kind}.png`);
      fs.copyFileSync(source, target);
      receipt.screenshots[kind] = { filename: `${kind}.png`, sha256: hashFile(target) };
    }
    receipt.status = "PASS";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    receipt.failure = { classification: classifyFailure(message), details: sanitize(message, tempRoot) };
  } finally {
    receipt.cleanup.server = stopServer(server);
    if (serverLogHandle !== null) { try { fs.closeSync(serverLogHandle); } catch { receipt.cleanup.server = "FAIL"; } }
    if (!container) {
      receipt.cleanup.container = "PASS";
      receipt.cleanup.syntheticRows = "PASS";
    } else {
      const cleanupEnv = env ?? dockerEnv;
      const inspected = inspectContainer(container.id, cleanupEnv);
      const actual = inspected.exitCode === 0 ? parseContainerInspection(inspected.stdout) : null;
      if (!isOwnedContainerInspection(actual, container)) {
        receipt.cleanup.container = "CLEANUP_BLOCKED";
        receipt.cleanup.syntheticRows = "CLEANUP_BLOCKED";
      } else {
        const synthetic = psql(container.id, `SELECT COUNT(*) FROM "${schema}"."Vendor" WHERE "slug" LIKE 'g7-55-%';`, cleanupEnv);
        receipt.cleanup.syntheticRows = synthetic.exitCode === 0 && synthetic.stdout.trim() === "0" ? "PASS" : "FAIL";
        const removed = run("docker", ["rm", "-f", container.id], cleanupEnv);
        const absent = run("docker", ["inspect", container.id], cleanupEnv);
        receipt.cleanup.container = removed.exitCode === 0 && absent.exitCode !== 0 ? "PASS" : "FAIL";
      }
    }
    receipt.cleanup.tempRoot = fs.existsSync(tempRoot) ? removeTempRoot(tempRoot, marker) : "PASS";
    if (receipt.status === "PASS" && Object.values(receipt.cleanup).some((value) => value !== "PASS")) { receipt.status = "BLOCKED_OR_FAILED"; receipt.failure = { classification: "CLEANUP_FAILED", details: [] }; }
    receipt.finishedAt = new Date().toISOString();
    writeReceipt(receipt, receiptPath);
  }

  if (!validateReceipt(receipt)) process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) main().then((receipt) => process.stdout.write(`${receipt.status} ${receipt.runId}\n`));
