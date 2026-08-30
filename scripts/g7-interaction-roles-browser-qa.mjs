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
const runNamePattern = /^celebratedeal-g7-interaction-roles-browser-[a-f0-9]{16}$/u;
const schemaPattern = /^g7_06_browser_[a-f0-9]{16}$/u;
const migrationPattern = /^\d{12,14}_[a-z0-9_]+$/u;

// Keep this explicit: the receipt must prove the browser run matched every
// server/client boundary that can change tenant isolation or public playback.
export const sourceDigestPaths = [
  "prisma/schema.prisma",
  "src/app/actions.ts",
  "src/lib/auth.ts",
  "src/lib/csrf.ts",
  "src/lib/csrf-constants.ts",
  "src/lib/db.ts",
  "src/lib/interaction-role.ts",
  "src/lib/interaction-role-label.ts",
  "src/lib/interaction-event.ts",
  "src/lib/interaction-timeline.ts",
  "src/components/csrf-field.tsx",
  "src/components/form-submit-button.tsx",
  "src/components/interaction-roles-workbench.tsx",
  "src/components/interaction-role-form.tsx",
  "src/components/interaction-script-form.tsx",
  "src/components/live-playback.tsx",
  "src/components/ui.tsx",
  "src/app/(app)/interaction-roles/page.tsx",
  "src/app/(app)/interaction-roles/new/page.tsx",
  "src/app/(app)/interaction-roles/[id]/edit/page.tsx",
  "src/app/(app)/interaction-scripts/page.tsx",
  "src/app/(app)/interaction-scripts/new/page.tsx",
  "src/app/(app)/interaction-scripts/[id]/edit/page.tsx",
  "src/app/(app)/lives/[id]/preview/page.tsx",
  "src/app/(viewer)/live/[slug]/page.tsx",
  "src/app/api/live-playback-source/route.ts",
];

function run(command, args, env, cwd = root) {
  const child = spawnSync(command, args, { cwd, env, encoding: "utf8", windowsHide: true, shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"), maxBuffer: 8 * 1024 * 1024 });
  return { exitCode: child.status ?? 1, stdout: child.stdout ?? "", stderr: child.stderr ?? "" };
}

function canonicalMigrations() {
  return fs.readdirSync(path.join(root, "prisma", "migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && migrationPattern.test(entry.name)).map((entry) => entry.name).sort();
}

function sourceDigest() {
  const digest = crypto.createHash("sha256");
  for (const relativePath of sourceDigestPaths) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) throw new Error(`source-digest-path-missing:${relativePath}`);
    digest.update(relativePath).update("\0").update(fs.readFileSync(absolutePath)).update("\0");
  }
  for (const migration of canonicalMigrations()) {
    const relativePath = `prisma/migrations/${migration}/migration.sql`;
    digest.update(relativePath).update("\0").update(fs.readFileSync(path.join(root, relativePath))).update("\0");
  }
  return digest.digest("hex");
}

function ignoredMirrorPath(relativePath) {
  const parts = relativePath.replaceAll("\\", "/").split("/");
  return !relativePath || parts.some((part) => [".git", ".next", "node_modules", ".ai-team", "test-results", "playwright-report", "tmp"].includes(part)) || parts.some((part) => part === ".env" || part.startsWith(".env."));
}

function copySourceTree(source, destination, relative = "") {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (ignoredMirrorPath(childRelative)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (fs.lstatSync(from).isSymbolicLink()) continue;
    if (entry.isDirectory()) copySourceTree(from, to, childRelative);
    if (entry.isFile()) fs.copyFileSync(from, to);
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
  const prismaFrom = path.join(source, "@prisma");
  const prismaTo = path.join(target, "@prisma");
  fs.mkdirSync(prismaTo, { recursive: true });
  for (const entry of fs.readdirSync(prismaFrom, { withFileTypes: true })) {
    const from = path.join(prismaFrom, entry.name);
    const to = path.join(prismaTo, entry.name);
    if (entry.name === "client") fs.cpSync(from, to, { recursive: true, dereference: false });
    else fs.symlinkSync(from, to, fs.statSync(from).isDirectory() ? "junction" : "file");
  }
}

function writePrismaConfig(mirror) {
  const config = path.join(mirror, "prisma.g7-interaction-roles.config.mjs");
  fs.writeFileSync(config, 'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\nconst { defineConfig } = require("prisma/config");\nexport default defineConfig({ schema: "prisma/schema.prisma", engine: "classic", migrations: { path: "prisma/migrations" }, datasource: { url: process.env.DATABASE_URL } });\n', "utf8");
  return config;
}

function writePendingProbe(mirror) {
  const probeRoot = path.join(mirror, "src", "app", "g7-06-pending-probe");
  fs.mkdirSync(probeRoot, { recursive: true });
  fs.writeFileSync(path.join(probeRoot, "page.tsx"), 'import { FormSubmitButton } from "@/components/form-submit-button";\n\nasync function pendingProbeAction() {\n  "use server";\n  await new Promise((resolve) => setTimeout(resolve, 1500));\n}\n\nexport default function G706PendingProbePage() {\n  return <form action={pendingProbeAction}><FormSubmitButton data-testid="pending-probe-submit" pendingChildren="Probe pending" pendingMessage="Probe pending message">Probe submit</FormSubmitButton></form>;\n}\n', "utf8");
}

function writeNetworkGuard(tempRoot) {
  const guard = path.join(tempRoot, "loopback-network-guard.cjs");
  fs.writeFileSync(guard, 'const allowed = new Set(["127.0.0.1", "localhost", "::1"]);\nconst host = (v) => { try { if (typeof v === "string") return new URL(v).hostname; return String(v?.hostname || v?.host || "").replace(/^\\[/, "").replace(/\\]$/, "").split(":")[0] || null; } catch { return null; } };\nconst local = (v) => host(v) === null || allowed.has(host(v));\nconst denied = () => { throw new Error("G7_INTERACTION_ROLES_EXTERNAL_NETWORK_DENIED"); };\nfor (const name of ["http", "https"]) { const m = require(name); const request = m.request; m.request = function (...a) { if (!local(a[0])) return denied(); return request.apply(this, a); }; }\nconst net = require("net"); const connect = net.connect; net.connect = net.createConnection = function (...a) { if (!local(a[0])) return denied(); return connect.apply(this, a); };\nif (global.fetch) { const fetch = global.fetch; global.fetch = (input, init) => local(input) ? fetch(input, init) : Promise.reject(new Error("G7_INTERACTION_ROLES_EXTERNAL_NETWORK_DENIED")); }\n', "utf8");
  return guard;
}

function allocatePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(null));
    server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(typeof address === "object" && address ? address.port : null)); });
  });
}

function safeEnvironment({ tempRoot, appPort, databaseUrl, schema, screenshotDirectory, guard, browsers }) {
  return {
    PATH: process.env.PATH ?? process.env.Path ?? "", SystemRoot: process.env.SystemRoot ?? "", WINDIR: process.env.WINDIR ?? "", ComSpec: process.env.ComSpec ?? "", PATHEXT: process.env.PATHEXT ?? "",
    TEMP: path.join(tempRoot, "tmp"), TMP: path.join(tempRoot, "tmp"), USERPROFILE: path.join(tempRoot, "home"), DOCKER_CONFIG: path.join(tempRoot, "docker-config"),
    NODE_ENV: "production", CI: "true", NEXT_TELEMETRY_DISABLED: "1", NPM_CONFIG_OFFLINE: "true", NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false", PRISMA_HIDE_UPDATE_MESSAGE: "true",
    DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${appPort}`, E2E_BASE_URL: `http://127.0.0.1:${appPort}`,
    G7_INTERACTION_ROLES_SCHEMA: schema, G7_INTERACTION_ROLES_SCREENSHOT_DIR: screenshotDirectory, PLAYWRIGHT_BROWSERS_PATH: browsers, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
    PAYMENT_PROVIDER: "demo", RATE_LIMIT_PROVIDER: "memory", JOB_SECRET: "g7-06-local-synthetic-job-secret", CSRF_SECRET: "g7-06-local-synthetic-csrf-secret", SENTRY_DISABLE_AUTO_UPLOAD: "true", SENTRY_DSN: "", NEXT_PUBLIC_SENTRY_DSN: "", RESEND_API_KEY: "", EMAIL_FROM: "",
    NODE_OPTIONS: `--require=${guard}`,
  };
}

function waitForPostgres(containerId, env) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (run("docker", ["exec", containerId, "pg_isready", "-U", "postgres", "-d", "celebratedeal_test"], env).exitCode === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  return false;
}

function psql(containerId, sql, env, database = "celebratedeal_test") {
  return run("docker", ["exec", containerId, "psql", "-U", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-d", database, "-c", sql], env);
}

async function waitForServer(baseURL, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try { const response = await fetch(`${baseURL}/login`); if (response.status >= 200 && response.status < 500) return true; } catch { /* loopback readiness */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function sanitize(value, tempRoot) {
  const escape = (item) => item.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return String(value ?? "").replace(/\u001b\[[0-9;]*m/gu, "").split(/\r?\n/u).map((line) => line.replace(new RegExp(escape(tempRoot), "giu"), "<temp>").replace(new RegExp(escape(root), "giu"), "<workspace>").replace(/postgres(?:ql)?:\/\/[^@\s]+@/giu, "postgresql://<redacted>@").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "<redacted-email>").replace(/g7-06-[A-Za-z0-9_-]{6,}/gu, "<synthetic-value>").replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, 360)).filter(Boolean).slice(-24);
}

function classifyFailure(output) {
  const text = String(output ?? "");
  if (/G7_INTERACTION_ROLES_EXTERNAL_NETWORK_DENIED/u.test(text)) return "EXTERNAL_NETWORK_DENIED";
  if (/docker-image-unavailable|Cannot connect to the Docker/u.test(text)) return "DOCKER_UNAVAILABLE";
  if (/Another next build process/u.test(text)) return "NEXT_BUILD_LOCKED";
  if (/Failed to compile/u.test(text)) return "NEXT_COMPILE_FAILED";
  if (/Type error:|TypeScript/u.test(text)) return "NEXT_TYPECHECK_FAILED";
  if (/AXE_BLOCKING/u.test(text)) return "PLAYWRIGHT_AXE_BLOCKING";
  if (/RWD_HORIZONTAL_OVERFLOW/u.test(text)) return "PLAYWRIGHT_RWD_HORIZONTAL_OVERFLOW";
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
      tests.push({ title: [...titles, spec.title ?? "untitled"].filter(Boolean).join(" > "), status: result.status ?? "unknown", message: [result.error?.message, ...(result.errors ?? []).map((error) => error?.message)].filter(Boolean).join("\n") });
    }
    for (const child of Array.isArray(suite.suites) ? suite.suites : []) visit(child, titles);
  };
  for (const suite of Array.isArray(report?.suites) ? report.suites : []) visit(suite);
  const failed = new Set(["failed", "timedOut", "interrupted", "unknown"]);
  return { passed: tests.filter((item) => item.status === "passed").length, failed: tests.filter((item) => failed.has(item.status)).length, skipped: tests.filter((item) => ["skipped", "pending"].includes(item.status)).length, diagnostics: tests.filter((item) => failed.has(item.status)).slice(0, 4).map((item) => ({ title: item.title.slice(0, 240), status: item.status, classification: classifyFailure(item.message), details: sanitize(item.message, tempRoot).slice(0, 12) })) };
}

export function validateReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") return false;
  const required = ["schemaVersion", "workPackage", "status", "startedAt", "finishedAt", "sourceDigest", "commands", "browser", "cleanup", "safety", "screenshots"];
  if (!required.every((key) => key in receipt) || receipt.workPackage !== "G7-06" || !/^[a-f0-9]{64}$/u.test(receipt.sourceDigest) || !Array.isArray(receipt.commands)) return false;
  const safety = receipt.safety;
  return safety?.dotenvContentsRead === false && safety?.mirrorExcludesDotenv === true && safety?.loopbackOnly === true && safety?.postgresTmpfs === true && safety?.committedMigrationsOnly === true && safety?.userBrowserProfileRead === false && safety?.externalOperations === false && safety?.productionOperations === false && typeof receipt.browser?.passed === "number" && typeof receipt.browser?.failed === "number" && typeof receipt.browser?.skipped === "number" && "desktop" in receipt.screenshots && "mobile" in receipt.screenshots;
}

export function assertStaticSafety(source) {
  const value = String(source).split(/\r?\n/u).filter((line) => !line.includes("const forbidden")).join("\n");
  const forbidden = [/(?:from\s*["']dotenv(?:\/[^"']*)?|import\s*["']dotenv(?:\/[^"']*)?|require\(\s*["']dotenv(?:\/[^"']*)?)/iu, /launchPersistentContext/u, /\buserDataDir\b/u, /Chrome[\\/]User Data/iu, /https:\/\/(?!127\.0\.0\.1|localhost)/iu, /process\.env\.HOME/u];
  return forbidden.every((pattern) => !pattern.test(value));
}

function playwrightSpec() {
  return String.raw`import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient(); const runId = randomUUID().replace(/-/g, ""); const baseURL = process.env.E2E_BASE_URL!;
const token = "g7-06-local-playwright-session-token"; const tokenHash = createHash("sha256").update(token).digest("hex");
const fixture = { vendorId: "", foreignVendorId: "", userId: "", roleId: "", foreignRoleId: "", scriptId: "", foreignScriptId: "", liveId: "", liveSlug: "", foreignCanary: "", createdRoleId: "" };
const evidence = { axe: { criticalOrSerious: -1 }, rwd: { desktop: "NOT_RUN", mobile: "NOT_RUN" }, keyboard: "NOT_RUN", roles: "NOT_RUN", script: "NOT_RUN", publicLive: "NOT_RUN", tenant: "NOT_RUN", pending: "NOT_RUN" };
const persist = async () => writeFile(join(resolve(process.env.G7_INTERACTION_ROLES_SCREENSHOT_DIR || "."), "g7-06-browser-observation.json"), JSON.stringify(evidence));
async function owner(page: Page) { await page.context().addCookies([{ name: "celebrate_session", value: token, url: baseURL, httpOnly: true, sameSite: "Lax" }]); }
async function capture(page: Page, name: string) { const dir = process.env.G7_INTERACTION_ROLES_SCREENSHOT_DIR; if (!dir) return; await mkdir(dir, { recursive: true }); await page.screenshot({ path: join(resolve(dir), name), fullPage: true }); }
async function overflow(page: Page, viewport: "desktop" | "mobile") { const value = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (value > 1) throw new Error("RWD_HORIZONTAL_OVERFLOW:" + viewport + ":" + value); evidence.rwd[viewport] = "PASS"; }
async function axe(page: Page) { const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze(); return result.violations.filter((v) => v.impact === "critical" || v.impact === "serious"); }
async function keyboard(page: Page, expected: string[]) { const found = new Set<string>(); for (let i = 0; i < 120 && found.size < expected.length; i += 1) { await page.keyboard.press("Tab"); const name = await page.evaluate(() => { const e = document.activeElement as HTMLElement | null; return e?.getAttribute("aria-label") || e?.textContent?.trim() || ""; }); for (const value of expected) if (name.includes(value)) found.add(value); } expect([...found].sort()).toEqual([...expected].sort()); evidence.keyboard = "PASS"; }

test.beforeEach(async ({ page }) => { await page.route("**/*", async (route) => { const url = new URL(route.request().url()); if (["127.0.0.1", "localhost"].includes(url.hostname)) return route.continue(); return route.abort(); }); });
test.beforeAll(async () => {
  const [vendor, foreign] = await Promise.all([
    db.vendor.create({ data: { name: "G7-06 合成商家", slug: "g7-06-owner-" + runId, email: "g7-06-owner-" + runId + "@example.test", passwordHash: "synthetic", tracking: { create: {} } } }),
    db.vendor.create({ data: { name: "G7-06 Foreign", slug: "g7-06-foreign-" + runId, email: "g7-06-foreign-" + runId + "@example.test", passwordHash: "synthetic", tracking: { create: {} } } }),
  ]);
  const user = await db.user.create({ data: { email: "g7-06-manager-" + runId + "@example.test", name: "G7-06 Manager", passwordHash: "synthetic", status: "active", memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } } } });
  await db.userSession.create({ data: { userId: user.id, vendorId: vendor.id, tokenHash, expiresAt: new Date("2030-01-01T00:00:00.000Z") } });
  const [role, foreignRole, product] = await Promise.all([
    db.interactionRole.create({ data: { vendorId: vendor.id, name: "G7-06 官方小編", label: "官方角色", roleType: "official", tone: "合成角色", isActive: true } }),
    db.interactionRole.create({ data: { vendorId: foreign.id, name: "G7-06 Foreign Role", label: "Foreign Canary", roleType: "official", isActive: true } }),
    db.product.create({ data: { vendorId: vendor.id, name: "G7-06 商品", slug: "g7-06-product-" + runId, description: "合成商品", priceCents: 168000, fulfillmentTypeConfirmed: true, isActive: true } }),
  ]);
  const script = await db.interactionScript.create({ data: { vendorId: vendor.id, name: "G7-06 草稿腳本", description: "四種可見事件", status: "draft", events: { create: [
    { eventType: "chat_message", triggerSec: 0, title: "官方留言", message: "這是合成官方留言", roleId: role.id },
    { eventType: "reminder", triggerSec: 0, title: "提醒", message: "這是合成提醒", roleId: role.id },
    { eventType: "product_spotlight", triggerSec: 0, title: "商品聚焦", productId: product.id },
    { eventType: "cta_switch", triggerSec: 0, title: "立即查看", ctaLabel: "立即查看合成商品", ctaUrl: baseURL + "/live/g7-06-local" },
  ] } } });
  const published = await db.interactionScript.create({ data: { vendorId: vendor.id, name: "G7-06 公開腳本", status: "published", events: { create: [
    { eventType: "chat_message", triggerSec: 0, title: "官方留言", message: "這是合成官方留言", roleId: role.id },
    { eventType: "reminder", triggerSec: 0, title: "提醒", message: "這是合成提醒", roleId: role.id },
    { eventType: "product_spotlight", triggerSec: 0, title: "商品聚焦", productId: product.id },
    { eventType: "cta_switch", triggerSec: 0, title: "立即查看", ctaLabel: "立即查看合成商品", ctaUrl: baseURL + "/live/g7-06-local" },
  ] } } });
  const foreignScript = await db.interactionScript.create({ data: { vendorId: foreign.id, name: "G7-06 Foreign Script", status: "draft", events: { create: [{ eventType: "chat_message", triggerSec: 0, title: "Foreign Canary", message: "foreign" }] } } });
  const live = await db.live.create({ data: { vendorId: vendor.id, title: "G7-06 公開 Live", slug: "g7-06-live-" + runId, description: "合成公開 Live", scheduledAt: new Date("2030-01-01T00:00:00.000Z"), status: "scheduled", interactionScriptId: published.id } });
  await db.liveProduct.create({ data: { vendorId: vendor.id, liveId: live.id, productId: product.id, sortOrder: 0, isPinned: true } });
  Object.assign(fixture, { vendorId: vendor.id, foreignVendorId: foreign.id, userId: user.id, roleId: role.id, foreignRoleId: foreignRole.id, scriptId: script.id, foreignScriptId: foreignScript.id, liveId: live.id, liveSlug: live.slug, foreignCanary: "Foreign Canary" });
});
test.afterEach(async () => { await persist(); });
test.afterAll(async () => { try { await db.vendor.deleteMany({ where: { id: { in: [fixture.vendorId, fixture.foreignVendorId] } } }); await db.user.deleteMany({ where: { id: fixture.userId } }); } finally { await persist(); await db.$disconnect(); } });

test("角色清單、新增、鍵盤、desktop/mobile 與 Axe contract", async ({ page }) => {
  await owner(page); await page.setViewportSize({ width: 1440, height: 1000 }); const response = await page.goto("/interaction-roles/new"); expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "互動角色清單" })).toBeVisible(); await expect(page.getByRole("heading", { name: "新增互動角色" })).toBeVisible(); await expect(page.getByText("G7-06 官方小編", { exact: true })).toBeVisible(); await overflow(page, "desktop"); await keyboard(page, ["新增互動角色", "新增"]); await capture(page, "desktop.png");
  const desktopAxe = await axe(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/interaction-roles/new"); await overflow(page, "mobile"); await capture(page, "mobile.png"); const mobileAxe = await axe(page); if ([...desktopAxe, ...mobileAxe].length) throw new Error("AXE_BLOCKING:" + JSON.stringify([...desktopAxe, ...mobileAxe].map((v) => ({ id: v.id, impact: v.impact })))); evidence.axe.criticalOrSerious = 0;
  await page.getByLabel("暱稱").fill("G7-06 新增角色"); await page.getByRole("button", { name: "新增", exact: true }).click(); await expect(page).toHaveURL(/\/interaction-roles$/); const created = await db.interactionRole.findFirstOrThrow({ where: { vendorId: fixture.vendorId, name: "G7-06 新增角色" } }); fixture.createdRoleId = created.id; evidence.roles = "PASS";
});

test("角色可編輯、啟停，且 pending 按鈕防止重送", async ({ page }) => {
  await owner(page); await page.goto("/interaction-roles/" + fixture.createdRoleId + "/edit"); await expect(page.getByRole("heading", { name: "編輯互動角色" })).toBeVisible(); const enabled = page.locator('input[name="isActive"]'); await expect(enabled).toBeChecked(); await enabled.uncheck();
  await page.getByRole("button", { name: "儲存", exact: true }).click(); await expect(page).toHaveURL(/\/interaction-roles$/); expect((await db.interactionRole.findUniqueOrThrow({ where: { id: fixture.createdRoleId } })).isActive).toBe(false);
  const probeResponse = await page.goto("/g7-06-pending-probe"); expect(probeResponse?.status()).toBe(200); let release: (() => void) | undefined; const held = new Promise<void>((resolve) => { release = resolve; }); let heldRequest = false;
  await page.route("**/*", async (route) => { if (route.request().method() === "POST" && !heldRequest) { heldRequest = true; await held; } await route.continue(); }); const probe = page.getByTestId("pending-probe-submit"); await expect(probe).toHaveText("Probe submit"); await probe.click({ noWaitAfter: true }); await expect.poll(() => heldRequest).toBe(true); await expect(probe).toHaveText("Probe pending"); await expect(probe).toBeDisabled(); await expect(probe).toHaveAttribute("aria-busy", "true"); release?.(); evidence.pending = "PASS";
});

test("草稿與發布分離，四種事件時間軸可見，preview 與公開透明標示", async ({ page }) => {
  await owner(page); await page.goto("/interaction-scripts/" + fixture.scriptId + "/edit"); const values = await page.locator('select[name="eventType"]').evaluateAll((nodes) => nodes.map((node) => (node as HTMLSelectElement).value).sort()); expect(values).toEqual(["chat_message", "cta_switch", "product_spotlight", "reminder"]); await expect(page.getByTestId("interaction-timeline-outline")).toBeVisible(); await expect(page.getByRole("button", { name: "儲存變更" })).toBeVisible(); await expect(page.getByRole("button", { name: "發布並可選用" })).toBeVisible();
  await page.getByLabel("互動腳本名稱").fill("G7-06 已儲存草稿"); await page.getByRole("button", { name: "儲存變更" }).click(); await expect(page).toHaveURL(/\/interaction-scripts$/); expect((await db.interactionScript.findUniqueOrThrow({ where: { id: fixture.scriptId } })).status).toBe("draft"); await page.goto("/interaction-scripts/" + fixture.scriptId + "/edit"); await page.getByRole("button", { name: "發布並可選用" }).click(); await expect(page).toHaveURL(/\/interaction-scripts$/); expect((await db.interactionScript.findUniqueOrThrow({ where: { id: fixture.scriptId } })).status).toBe("published");
  await page.goto("/lives/" + fixture.liveId + "/preview"); await expect(page.getByRole("heading", { name: "直播預覽" })).toBeVisible(); await expect(page.getByText("互動腳本：G7-06 公開腳本", { exact: true })).toBeVisible(); const publicResponse = await page.goto("/live/" + fixture.liveSlug); expect(publicResponse?.status()).toBe(200); await expect(page.getByText("官方互動為商家預先設定的腳本，不代表即時真人留言、真實購買或觀看人數。", { exact: true })).toBeVisible(); await expect(page.getByRole("log", { name: "商家預設互動腳本" })).toContainText("這是合成官方留言"); await expect(page.getByText("腳本推薦", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "商家預設腳本導購：立即查看合成商品" })).toBeVisible(); await expect(page.getByText("預設腳本", { exact: true })).toHaveCount(2); evidence.script = "PASS"; evidence.publicLive = "PASS";
});

test("foreign tenant role 與 script direct route 皆 404 且不外洩", async ({ page }) => {
  await owner(page); const roleResponse = await page.goto("/interaction-roles/" + fixture.foreignRoleId + "/edit"); expect(roleResponse?.status()).toBe(404); expect(await page.content()).not.toContain(fixture.foreignCanary); const scriptResponse = await page.goto("/interaction-scripts/" + fixture.foreignScriptId + "/edit"); expect(scriptResponse?.status()).toBe(404); expect(await page.content()).not.toContain(fixture.foreignCanary); evidence.tenant = "PASS";
});
`;
}

function writePlaywrightFiles(mirror) {
  const configPath = path.join(mirror, "playwright.g7-interaction-roles.config.ts");
  const specPath = path.join(mirror, "tests", "e2e", "g7-interaction-roles-browser.spec.ts");
  fs.writeFileSync(configPath, 'import { defineConfig, devices } from "@playwright/test";\nconst schema = process.env.G7_INTERACTION_ROLES_SCHEMA; const baseURL = process.env.E2E_BASE_URL;\nif (!schema || !/^g7_06_browser_[a-f0-9]{16}$/.test(schema)) throw new Error("g7-06 schema rejected");\nif (!baseURL || !/^http:\\/\\/127\\.0\\.0\\.1:\\d+$/.test(baseURL)) throw new Error("g7-06 base URL rejected");\nexport default defineConfig({ testDir: "./tests/e2e", testMatch: "g7-interaction-roles-browser.spec.ts", timeout: 60000, expect: { timeout: 15000 }, fullyParallel: false, workers: 1, retries: 0, reporter: [["json"]], use: { baseURL, trace: "off", screenshot: "off", video: "off" }, projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }] });\n', "utf8");
  fs.writeFileSync(specPath, playwrightSpec(), "utf8");
  return configPath;
}

function stopServer(server) {
  if (!server?.pid || server.exitCode !== null) return "PASS";
  if (process.platform === "win32") return run("taskkill", ["/PID", String(server.pid), "/T", "/F"], process.env).exitCode === 0 ? "PASS" : "FAIL";
  server.kill("SIGTERM"); return "PASS";
}

function removeTempRoot(tempRoot, marker) {
  const resolved = path.resolve(tempRoot);
  const safe = resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`) && runNamePattern.test(path.basename(resolved)) && fs.existsSync(path.join(resolved, ".marker")) && fs.readFileSync(path.join(resolved, ".marker"), "utf8") === marker;
  if (!safe) return "CLEANUP_BLOCKED";
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3 });
  return fs.existsSync(resolved) ? "FAIL" : "PASS";
}

function hashFile(filePath) { return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"); }

function writeReceipt(receipt, receiptPath) {
  if (!validateReceipt(receipt)) throw new Error("receipt-schema-invalid");
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, serialized, { encoding: "utf8", flag: "wx" });
  fs.writeFileSync(`${receiptPath}.sha256`, `${crypto.createHash("sha256").update(serialized).digest("hex")}  ${path.basename(receiptPath)}\n`, { encoding: "utf8", flag: "wx" });
}

export async function main() {
  const runId = crypto.randomBytes(8).toString("hex"); const name = `celebratedeal-g7-interaction-roles-browser-${runId}`; const schema = `g7_06_browser_${runId}`; const marker = `g7-06-browser:${runId}`;
  const tempRoot = path.join(os.tmpdir(), name); const receiptPath = path.join(evidenceRoot, `g7-06-interaction-roles-browser-qa-${runId}.json`); const screenshots = path.join(evidenceRoot, `g7-06-interaction-roles-browser-qa-${runId}-screenshots`);
  const receipt = { schemaVersion: "celebratedeal-g7-06-interaction-roles-browser-qa/v1", workPackage: "G7-06", status: "BLOCKED_OR_FAILED", runId, startedAt: new Date().toISOString(), finishedAt: null, sourceDigest: sourceDigest(), commands: [], expected: { browserTests: 4, axeCriticalOrSerious: 0, viewports: ["1440x1000", "390x844"], contracts: ["roles", "create-edit-toggle", "pending-dedup", "timeline-four-event-types", "draft-publish", "preview", "public-disclosure", "tenant-404"] }, phases: { mirror: "NOT_STARTED", prismaGenerate: "NOT_STARTED", prismaValidate: "NOT_STARTED", prismaDeploy: "NOT_STARTED", prismaStatus: "NOT_STARTED", nextBuild: "NOT_STARTED", server: "NOT_STARTED", browser: "NOT_STARTED" }, browser: { passed: 0, failed: 0, skipped: 0, axeCriticalOrSerious: -1, rwd: { desktop: "NOT_RUN", mobile: "NOT_RUN" }, keyboard: "NOT_RUN", roles: "NOT_RUN", script: "NOT_RUN", publicLive: "NOT_RUN", tenant: "NOT_RUN", pending: "NOT_RUN" }, screenshots: { desktop: null, mobile: null }, diagnostics: { failureClass: null, details: [] }, cleanup: { syntheticRows: "NOT_RUN", server: "NOT_STARTED", container: "NOT_STARTED", tempRoot: "NOT_STARTED" }, safety: { dotenvContentsRead: false, mirrorExcludesDotenv: true, loopbackOnly: true, postgresTmpfs: true, committedMigrationsOnly: true, userBrowserProfileRead: false, externalOperations: false, productionOperations: false } };
  let container = null; let server = null; let env = null;
  const note = (nameValue, result) => receipt.commands.push({ name: nameValue, exitCode: result.exitCode, stdout: sanitize(result.stdout, tempRoot), stderr: sanitize(result.stderr, tempRoot) });
  try {
    if (!assertStaticSafety(fs.readFileSync(scriptPath, "utf8"))) throw new Error("runner-static-safety-failed");
    if (!schemaPattern.test(schema)) throw new Error("schema-pattern-failed");
    fs.mkdirSync(tempRoot, { recursive: true }); fs.writeFileSync(path.join(tempRoot, ".marker"), marker, "utf8"); fs.mkdirSync(path.join(tempRoot, "tmp"), { recursive: true }); fs.mkdirSync(path.join(tempRoot, "home"), { recursive: true });
    const mirror = path.join(tempRoot, "mirror"); copySourceTree(root, mirror); writePendingProbe(mirror); linkNodeModules(mirror); receipt.phases.mirror = "PASS";
    const dockerEnv = { PATH: process.env.PATH ?? process.env.Path ?? "", SystemRoot: process.env.SystemRoot ?? "", ComSpec: process.env.ComSpec ?? "", PATHEXT: process.env.PATHEXT ?? "" };
    const imageCheck = run("docker", ["image", "inspect", image], dockerEnv); note("docker image inspect", imageCheck); if (imageCheck.exitCode !== 0) throw new Error("docker-image-unavailable");
    const created = run("docker", ["run", "-d", "--pull=never", "--name", name, "--label", `celebratedeal.run-id=${runId}`, "--label", `celebratedeal.marker=${marker}`, "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=celebratedeal_test", "--tmpfs", "/var/lib/postgresql/data", "-p", "127.0.0.1::5432", image], dockerEnv); note("docker run disposable postgres tmpfs", created); if (created.exitCode !== 0 || !/^[a-f0-9]{64}\s*$/iu.test(created.stdout)) throw new Error("container-create-failed"); container = { id: created.stdout.trim() };
    if (!waitForPostgres(container.id, dockerEnv)) throw new Error("database-unreachable"); const portResult = run("docker", ["port", container.id, "5432/tcp"], dockerEnv); note("docker port", portResult); const postgresPort = /^127\.0\.0\.1:(\d+)\s*$/mu.exec(portResult.stdout)?.[1]; if (!postgresPort) throw new Error("database-loopback-port-invalid");
    const appPort = await allocatePort(); if (!appPort) throw new Error("app-loopback-port-invalid"); const browsers = process.env.LOCALAPPDATA ? path.resolve(process.env.LOCALAPPDATA, "ms-playwright") : null; if (!browsers || !fs.existsSync(browsers)) throw new Error("playwright-browser-cache-missing"); const tempScreenshots = path.join(tempRoot, "screenshots"); fs.mkdirSync(tempScreenshots, { recursive: true });
    env = safeEnvironment({ tempRoot, appPort, databaseUrl: `postgresql://postgres:postgres@127.0.0.1:${postgresPort}/celebratedeal_test?schema=${schema}`, schema, screenshotDirectory: tempScreenshots, guard: writeNetworkGuard(tempRoot), browsers });
    if (psql(container.id, `CREATE SCHEMA "${schema}"; COMMENT ON SCHEMA "${schema}" IS '${marker}';`, env).exitCode !== 0) throw new Error("database-marker-failed");
    const prismaConfig = writePrismaConfig(mirror); const prismaCli = path.join(mirror, "node_modules", "prisma", "build", "index.js");
    for (const [phase, args] of [["prismaGenerate", ["generate"]], ["prismaValidate", ["validate"]], ["prismaDeploy", ["migrate", "deploy"]], ["prismaStatus", ["migrate", "status"]]]) { const result = run(process.execPath, [prismaCli, ...args, "--config", prismaConfig], env, mirror); note(`prisma ${args.join(" ")}`, result); receipt.phases[phase] = result.exitCode === 0 ? "PASS" : "FAIL"; if (result.exitCode !== 0) throw new Error(`prisma-${phase}-failed`); }
    const nextCli = path.join(mirror, "node_modules", "next", "dist", "bin", "next"); const build = run(process.execPath, [nextCli, "build", "--webpack"], env, mirror); note("next build --webpack", build); receipt.phases.nextBuild = build.exitCode === 0 ? "PASS" : "FAIL"; if (build.exitCode !== 0) throw new Error(`next-build-failed:${sanitize(`${build.stdout}\n${build.stderr}`, tempRoot).join(" ")}`);
    server = spawn(process.execPath, [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(appPort)], { cwd: mirror, env, windowsHide: true, stdio: ["ignore", "ignore", "ignore"] }); if (!server.pid || !(await waitForServer(env.E2E_BASE_URL, server))) throw new Error("next-server-not-ready"); receipt.commands.push({ name: "next start loopback", exitCode: 0, stdout: [], stderr: [] }); receipt.phases.server = "PASS";
    const config = writePlaywrightFiles(mirror); const playwrightCli = path.join(mirror, "node_modules", "playwright", "cli.js"); const browserRun = run(process.execPath, [playwrightCli, "test", "--config", config, "--project", "chromium", "--reporter", "json"], env, mirror); note("playwright chromium", browserRun); let report = {}; try { report = JSON.parse(browserRun.stdout || "{}"); } catch { receipt.diagnostics.failureClass = "PLAYWRIGHT_JSON_REPORT_INVALID"; }
    Object.assign(receipt.browser, summarizePlaywrightReport(report, tempRoot)); receipt.diagnostics.details = receipt.browser.diagnostics; delete receipt.browser.diagnostics;
    const observation = path.join(tempScreenshots, "g7-06-browser-observation.json"); if (fs.existsSync(observation)) { Object.assign(receipt.browser, JSON.parse(fs.readFileSync(observation, "utf8"))); receipt.browser.axeCriticalOrSerious = receipt.browser.axe?.criticalOrSerious ?? -1; fs.rmSync(observation, { force: true }); }
    for (const nameValue of ["desktop", "mobile"]) { const source = path.join(tempScreenshots, `${nameValue}.png`); if (fs.existsSync(source)) { fs.mkdirSync(screenshots, { recursive: true }); const target = path.join(screenshots, `${nameValue}.png`); fs.copyFileSync(source, target); receipt.screenshots[nameValue] = { filename: `${nameValue}.png`, sha256: hashFile(target) }; } }
    const pass = browserRun.exitCode === 0 && receipt.browser.passed === receipt.expected.browserTests && receipt.browser.failed === 0 && receipt.browser.skipped === 0 && receipt.browser.axeCriticalOrSerious === 0 && receipt.browser.rwd?.desktop === "PASS" && receipt.browser.rwd?.mobile === "PASS" && ["keyboard", "roles", "script", "publicLive", "tenant", "pending"].every((key) => receipt.browser[key] === "PASS"); receipt.phases.browser = pass ? "PASS" : "FAIL"; if (!pass) throw new Error("interaction-roles-browser-contract-failed"); receipt.status = "PASS";
  } catch (error) { const message = error instanceof Error ? error.message : "runner-failed"; receipt.failure = message.split(":")[0]; receipt.diagnostics.failureClass ??= classifyFailure(message); receipt.diagnostics.details = [...receipt.diagnostics.details, ...sanitize(message, tempRoot)].slice(-24); }
  finally {
    receipt.cleanup.server = stopServer(server);
    if (!container) receipt.cleanup.container = "NOT_CREATED";
    else { const cleanupRows = psql(container.id, `DELETE FROM "${schema}"."Vendor" WHERE "slug" LIKE 'g7-06-%'; DELETE FROM "${schema}"."User" WHERE "email" LIKE 'g7-06-%'; SELECT (SELECT COUNT(*) FROM "${schema}"."Vendor" WHERE "slug" LIKE 'g7-06-%') + (SELECT COUNT(*) FROM "${schema}"."User" WHERE "email" LIKE 'g7-06-%');`, env ?? {}); receipt.cleanup.syntheticRows = cleanupRows.exitCode === 0 && cleanupRows.stdout.trim().endsWith("0") ? "PASS" : "FAIL"; const removed = run("docker", ["rm", "-f", container.id], env ?? {}); const absent = run("docker", ["inspect", container.id], env ?? {}); receipt.cleanup.container = removed.exitCode === 0 && absent.exitCode !== 0 ? "PASS" : "FAIL"; }
    receipt.cleanup.tempRoot = removeTempRoot(tempRoot, marker); if (receipt.status === "PASS" && Object.values(receipt.cleanup).some((value) => value !== "PASS")) { receipt.status = "BLOCKED_OR_FAILED"; receipt.failure = "cleanup-invariant-failed"; } receipt.finishedAt = new Date().toISOString(); writeReceipt(receipt, receiptPath);
  }
  process.stdout.write(`${JSON.stringify({ workPackage: receipt.workPackage, status: receipt.status, phases: receipt.phases, browser: receipt.browser, cleanup: receipt.cleanup, receipt: path.basename(receiptPath) })}\n`); if (receipt.status !== "PASS") process.exitCode = 1; return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) await main();
