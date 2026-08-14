import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
const nonce = crypto.randomBytes(4).toString("hex");
const schema = `wp128_${runId}_${nonce}`;
const marker = `celebratedeal:wp128:${runId}:${nonce}`;
const slug = `wp128-unpublished-${runId}-${nonce}`;
const tempRoot = path.join(os.tmpdir(), `celebratedeal-wp128-${runId}-${nonce}`);
const port = 32128 + Number.parseInt(nonce.slice(0, 2), 16) % 100;
const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=${schema}`;

export function run(command, args, environment, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: "utf8",
    shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function psql(container, sql, environment) {
  return run("docker", ["exec", "-e", "PGPASSWORD=postgres", container, "psql", "-U", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-d", "celebratedeal_ci", "-c", sql], environment);
}

export function environment() {
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
    CSRF_SECRET: "wp128-local-csrf-synthetic-value",
    JOB_SECRET: "wp128-local-job-synthetic-value",
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
      return relative !== ".git"
        && relative !== ".next"
        && relative !== "node_modules"
        && relative !== ".ai-team"
        && !relative.startsWith(".git/")
        && !relative.startsWith(".next/")
        && !relative.startsWith("node_modules/")
        && !relative.startsWith(".ai-team/")
        && !relative.startsWith(".env");
    },
  });
  fs.symlinkSync(path.join(root, "node_modules"), path.join(tempRoot, "node_modules"), "junction");
  fs.mkdirSync(path.join(tempRoot, "tmp"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "home"), { recursive: true });
}

export function fixtureScript(remove = false) {
  const operation = remove
    ? `await db.partnerFunnelPage.deleteMany({ where: { slug: ${JSON.stringify(slug)} } });
await db.teamFunnelTemplateVersion.deleteMany({ where: { headline: "WP128 fixture headline" } });
await db.teamFunnelTemplate.deleteMany({ where: { name: "WP128 fixture template" } });
await db.teamMembership.deleteMany({ where: { vendorId: vendorId } });
await db.salesTeam.deleteMany({ where: { vendorId: vendorId } });
await db.vendorMember.deleteMany({ where: { vendorId: vendorId } });
await db.user.deleteMany({ where: { email: "wp128-owner@example.invalid" } });
await db.vendor.deleteMany({ where: { slug: "wp128-fixture-vendor" } });`
    : `const user = await db.user.create({ data: { email: "wp128-owner@example.invalid", name: "WP128 Synthetic Owner", passwordHash: "synthetic-hash", status: "active" } });
const vendor = await db.vendor.create({ data: { name: "WP128 Synthetic Vendor", slug: "wp128-fixture-vendor", email: "wp128-vendor@example.invalid", passwordHash: "synthetic-hash" } });
const member = await db.vendorMember.create({ data: { vendorId: vendor.id, userId: user.id, role: "owner", status: "active" } });
const team = await db.salesTeam.create({ data: { vendorId: vendor.id, name: "WP128 Synthetic Team", slug: "wp128-team" } });
const membership = await db.teamMembership.create({ data: { vendorId: vendor.id, teamId: team.id, vendorMemberId: member.id, status: "ACTIVE" } });
const template = await db.teamFunnelTemplate.create({ data: { vendorId: vendor.id, teamId: team.id, name: "WP128 fixture template" } });
const version = await db.teamFunnelTemplateVersion.create({ data: { vendorId: vendor.id, teamId: team.id, templateId: template.id, version: 1, contentOwnerMembershipId: membership.id, createdByMemberId: member.id, headline: "WP128 fixture headline", ctaLabel: "fixture CTA" } });
await db.partnerFunnelPage.create({ data: { vendorId: vendor.id, teamId: team.id, templateVersionId: version.id, promoterMembershipId: membership.id, contentOwnerMembershipId: membership.id, slug: ${JSON.stringify(slug)}, headline: "WP128 fixture headline", ctaLabel: "fixture CTA" } });
console.log(JSON.stringify({ slug: ${JSON.stringify(slug)} }));`;
  return `import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const vendorId = (await db.vendor.findUnique({ where: { slug: "wp128-fixture-vendor" }, select: { id: true } }))?.id;
${operation}
await db.$disconnect();
`;
}

async function runBrowser(baseURL) {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const viewport of [{ name: "desktop", width: 1280, height: 800 }, { name: "mobile", width: 320, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const externalRequests = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (["http:", "https:"].includes(url.protocol) && url.hostname !== "127.0.0.1") externalRequests.push("external");
      });
      const response = await page.goto(`${baseURL}/p/${slug}`, { waitUntil: "domcontentloaded" });
      if (response?.status() !== 200) throw new Error(`unavailable route status ${response?.status() ?? "unknown"}`);
      if (!(await page.getByRole("heading", { name: "此頁尚未公開" }).isVisible())) throw new Error("unpublished heading missing");
      if (await page.getByText("WP128 fixture headline").count() !== 0) throw new Error("fixture headline leaked");
      if (await page.getByText("wp128-owner@example.invalid").count() !== 0) throw new Error("fixture email leaked");
      const link = page.getByRole("link", { name: "返回首頁" });
      if (await link.getAttribute("href") !== "/") throw new Error("recovery href mismatch");
      await link.focus();
      if (!(await link.evaluate((element) => document.activeElement === element))) throw new Error("recovery link is not focusable");
      const box = await link.boundingBox();
      if (!box || box.height < 44) throw new Error("recovery target is below 44px");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) throw new Error("horizontal overflow detected");
      const axeModule = await import("@axe-core/playwright");
      const axe = await new axeModule.default({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      const blocking = axe.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
      if (blocking.length > 0) throw new Error("blocking axe violations detected");
      if (externalRequests.length > 0) throw new Error("external request detected");
      results.push({ viewport: viewport.name, status: "PASS", axeBlocking: 0, overflow, externalRequests: 0 });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}

async function waitForServer(baseURL, child) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("local next dev server exited before readiness");
    try {
      const response = await fetch(`${baseURL}/login`);
      if (response.status >= 200 && response.status < 500) return;
    } catch { /* keep polling */ }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error("local next dev server readiness timeout");
}

export async function main() {
  const startedAt = new Date().toISOString();
  const receipt = {
    workPackage: "WP-128",
    status: "BLOCKED_OR_FAILED",
    scope: "LOCAL_PUBLIC_PARTNER_UNAVAILABLE_STATE",
    browser: { expected: 2, passed: 0, failed: 0, skipped: 0, viewports: [] },
    database: { boundary: "loopback disposable schema only", schemaCleanup: "NOT_STARTED", fixtureCleanup: "NOT_STARTED", sourceEnvContentsRead: false },
    externalSideEffects: false,
    generatedArtifactTouched: false,
    stagedIndexEmpty: false,
    failure: null,
    startedAt,
    finishedAt: null,
  };
  let container;
  let schemaCreated = false;
  let server;
  let serverStderr = "";
  let serverStdout = "";
  let serverErrorCode = null;
  let serverExitCode = null;
  const env = environment();
  try {
    const beforeStaged = run("git", ["diff", "--cached", "--name-only"], process.env).stdout.trim();
    if (beforeStaged) throw new Error("staged index is not empty");
    copyMirror();
    container = run("docker", ["ps", "--filter", "ancestor=postgres:16-alpine", "--format", "{{.ID}}"], process.env).stdout.trim().split(/\r?\n/).filter(Boolean)[0];
    if (!container) throw new Error("PostgreSQL 16 container unavailable");
    const create = psql(container, `CREATE SCHEMA \"${schema}\"; COMMENT ON SCHEMA \"${schema}\" IS '${marker}';`, env);
    if (create.exitCode !== 0) throw new Error("disposable schema creation failed");
    schemaCreated = true;
    const prisma = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
    if (run(prisma, ["migrate", "deploy", "--schema", "prisma/schema.prisma"], env, tempRoot).exitCode !== 0) throw new Error("disposable migration failed");
    const fixturePath = path.join(tempRoot, "wp128-fixture.mjs");
    fs.writeFileSync(fixturePath, fixtureScript(false), "utf8");
    if (run(process.execPath, [fixturePath], env, tempRoot).exitCode !== 0) throw new Error("fixture creation failed");
    const nextBin = path.join(tempRoot, "node_modules", "next", "dist", "bin", "next");
    server = spawn(process.execPath, [nextBin, "dev", "--port", String(port)], { cwd: tempRoot, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout?.on("data", (chunk) => {
      serverStdout = `${serverStdout}${String(chunk)}`.slice(-8_000);
    });
    server.stderr?.on("data", (chunk) => {
      serverStderr = `${serverStderr}${String(chunk)}`.slice(-8_000);
    });
    server.on("error", (error) => { serverErrorCode = error.code ?? "SPAWN_ERROR"; });
    server.on("exit", (code) => { serverExitCode = code; });
    await waitForServer(`http://127.0.0.1:${port}`, server);
    receipt.browser.viewports = await runBrowser(`http://127.0.0.1:${port}`);
    receipt.browser.passed = receipt.browser.viewports.length;
    receipt.status = receipt.browser.passed === 2 ? "PASS" : "BLOCKED_OR_FAILED";
    fs.writeFileSync(fixturePath, fixtureScript(true), "utf8");
    if (run(process.execPath, [fixturePath], env, tempRoot).exitCode !== 0) throw new Error("fixture cleanup failed");
    receipt.database.fixtureCleanup = "PASS";
  } catch (error) {
    receipt.failure = error instanceof Error ? error.message : String(error);
    const serverOutput = `${serverStdout}\n${serverStderr}`;
    if (serverErrorCode) receipt.serverDiagnostic = `SPAWN_${serverErrorCode}`;
    else if (serverExitCode !== null) receipt.serverExitCode = serverExitCode;
    if (serverOutput.trim()) {
      receipt.serverDiagnostic = /address already in use/i.test(serverOutput)
        ? "PORT_IN_USE"
        : /cannot find module|module not found/i.test(serverOutput)
          ? "MODULE_RESOLUTION"
          : /syntaxerror|typeerror|failed to compile/i.test(serverOutput)
            ? "SOURCE_OR_COMPILE_BOUNDARY"
            : "SERVER_START_UNKNOWN";
    }
  } finally {
    if (server?.pid) {
      if (process.platform === "win32") run("taskkill", ["/PID", String(server.pid), "/T", "/F"], process.env);
      else server.kill("SIGTERM");
    }
    if (schemaCreated && container) {
      const drop = psql(container, `DROP SCHEMA IF EXISTS \"${schema}\" CASCADE;`, env);
      receipt.database.schemaCleanup = drop.exitCode === 0 ? "PASS" : "FAIL";
    }
    if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true });
    receipt.stagedIndexEmpty = !run("git", ["diff", "--cached", "--name-only"], process.env).stdout.trim();
    receipt.finishedAt = new Date().toISOString();
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }
  if (receipt.status !== "PASS") process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();
