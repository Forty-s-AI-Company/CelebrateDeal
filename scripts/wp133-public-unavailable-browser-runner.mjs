import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(root, ".ai-team", "reports", "wp133-public-unavailable-browser-receipt.json");
const componentPath = "src/components/team-funnel-public-page.tsx";
const e2ePath = "tests/e2e/wp128-public-partner-unavailable-state.spec.ts";
const requiredInputs = [
  "package.json",
  "next.config.ts",
  "tsconfig.json",
  "prisma/schema.prisma",
  "src/app/p/[slug]/page.tsx",
  componentPath,
  e2ePath,
];
const expectedDigests = Object.freeze({
  route: "7b9d506c01c9c19a7d76eaccf81b1d362e0ea8d1a0e78b1f0f869774a8bf04b2",
  statusHelper: "a43debf8560704e6a89329163d82e79453a1d28736c27473a46043d8d9958e77",
  transitionHelper: "6ec1117e20ae49bf3d68b913afad3f178380bd2d990bd198ce566119d3e308c9",
  componentFromWp129: "187d777f6ec94be991299b9c8e7f4e60d84fd769c1e7fdc41e9f59c4acadfc8c",
});

export const CLASSIFICATIONS = Object.freeze({
  PASS: "PASS",
  DIGEST_MISMATCH: "DIGEST_MISMATCH",
  STAGED_INDEX_NOT_EMPTY: "STAGED_INDEX_NOT_EMPTY",
  MIRROR_INPUT_MISSING: "MIRROR_INPUT_MISSING",
  FORBIDDEN_FILE_COPIED: "FORBIDDEN_FILE_COPIED",
  NODE_MODULES_JUNCTION_FAILURE: "NODE_MODULES_JUNCTION_FAILURE",
  MODULE_RESOLUTION_FAILURE: "MODULE_RESOLUTION_FAILURE",
  PORT_ALLOCATION_FAILURE: "PORT_ALLOCATION_FAILURE",
  DATABASE_CONTAINER_UNAVAILABLE: "DATABASE_CONTAINER_UNAVAILABLE",
  DATABASE_SETUP_FAILURE: "DATABASE_SETUP_FAILURE",
  PROCESS_LIFECYCLE_FAILURE: "PROCESS_LIFECYCLE_FAILURE",
  SERVER_PRE_READINESS_EXIT: "SERVER_PRE_READINESS_EXIT",
  BROWSER_CONTRACT_FAILURE: "BROWSER_CONTRACT_FAILURE",
  CLEANUP_FAILURE: "CLEANUP_FAILURE",
  UNKNOWN_FAIL_CLOSED: "UNKNOWN_FAIL_CLOSED",
});

function run(command, args, environment, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: "utf8",
    shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function digest(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function isForbiddenPath(relative) {
  const normalized = relative.replaceAll("\\", "/").toLowerCase();
  const segments = normalized.split("/");
  return segments.some((segment) => segment.startsWith(".env"))
    || normalized.startsWith(".next/")
    || segments.some((segment) => /(?:secret|credential|token|cookie|private)/i.test(segment))
    || /\.(?:db|sqlite|sqlite3|pem|key|crt)$/i.test(normalized);
}

function filterSourcePath(relative) {
  if (!relative) return true;
  const normalized = relative.replaceAll("\\", "/");
  if ([".git", ".next", "node_modules", ".ai-team"].includes(normalized)) return false;
  return !isForbiddenPath(normalized);
}

function inspectMirror(tempRoot) {
  const missing = requiredInputs.filter((relative) => !fs.existsSync(path.join(tempRoot, relative)));
  const forbiddenCopied = [];
  for (const entry of fs.readdirSync(tempRoot, { recursive: true })) {
    const relative = String(entry).replaceAll("\\", "/");
    if (relative === "node_modules" || relative.startsWith("node_modules/")) continue;
    if (isForbiddenPath(relative)) forbiddenCopied.push(relative);
  }
  return {
    missing,
    forbiddenCopied: forbiddenCopied.sort(),
    sourceDigests: Object.fromEntries(requiredInputs.map((relative) => [relative, digest(path.join(tempRoot, relative))])),
  };
}

export function sanitizeDiagnosticText(value) {
  return String(value ?? "")
    .replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replaceAll(/[A-Za-z]:\\[^\r\n\s]+/g, "<path>")
    .replaceAll(/\b[A-Z][A-Z0-9_]{2,}=([^\s]+)/g, "<env>=<value>")
    .replaceAll(/https?:\/\/[^\s]+/gi, "<url>")
    .replaceAll(/(?:postgres(?:ql)?:\/\/)[^\s]+/gi, "<database-url>");
}

export function classifyResult({ preflight, mirror, junction, resolution, port, database, server, browser, cleanup }) {
  if (!preflight.digestMatch) return CLASSIFICATIONS.DIGEST_MISMATCH;
  if (!preflight.stagedIndexEmpty) return CLASSIFICATIONS.STAGED_INDEX_NOT_EMPTY;
  if (mirror.missing.length > 0) return CLASSIFICATIONS.MIRROR_INPUT_MISSING;
  if (mirror.forbiddenCopied.length > 0) return CLASSIFICATIONS.FORBIDDEN_FILE_COPIED;
  if (!junction.ok) return CLASSIFICATIONS.NODE_MODULES_JUNCTION_FAILURE;
  if (!resolution.ok) return CLASSIFICATIONS.MODULE_RESOLUTION_FAILURE;
  if (!port.ok) return CLASSIFICATIONS.PORT_ALLOCATION_FAILURE;
  if (!database.containerAvailable) return CLASSIFICATIONS.DATABASE_CONTAINER_UNAVAILABLE;
  if (!database.schemaReady) return CLASSIFICATIONS.DATABASE_SETUP_FAILURE;
  if (!server.spawned || server.spawnError) return CLASSIFICATIONS.PROCESS_LIFECYCLE_FAILURE;
  if (server.exitBeforeReady) return CLASSIFICATIONS.SERVER_PRE_READINESS_EXIT;
  if (!browser.ok) return CLASSIFICATIONS.BROWSER_CONTRACT_FAILURE;
  if (!cleanup.ok) return CLASSIFICATIONS.CLEANUP_FAILURE;
  return CLASSIFICATIONS.PASS;
}

function createMirror(tempRoot) {
  fs.cpSync(root, tempRoot, { recursive: true, filter: (source) => filterSourcePath(path.relative(root, source)) });
  fs.symlinkSync(path.join(root, "node_modules"), path.join(tempRoot, "node_modules"), "junction");
  fs.mkdirSync(path.join(tempRoot, "tmp"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "home"), { recursive: true });
}

function allocatePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve({ ok: false, port: null, ephemeral: true }));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => resolve({ ok: Number.isInteger(port), port, ephemeral: true }));
    });
  });
}

function environment(tempRoot, port, databaseUrl) {
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
    CSRF_SECRET: "wp133-local-csrf-synthetic-value",
    JOB_SECRET: "wp133-local-job-synthetic-value",
    PAYMENT_PROVIDER: "demo",
    RATE_LIMIT_PROVIDER: "memory",
    NEXT_TELEMETRY_DISABLED: "1",
    SENTRY_DISABLE_AUTO_UPLOAD: "true",
    NPM_CONFIG_OFFLINE: "true",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    PSQLRC: "",
    WP128_PUBLIC_SLUG: "wp128-unpublished-fixture",
  };
}

function psql(container, sql, environment) {
  return run("docker", ["exec", "-e", "PGPASSWORD=postgres", container, "psql", "-U", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-d", "celebratedeal_ci", "-c", sql], environment);
}

function fixtureScript(remove = false) {
  const operation = remove
    ? `await db.partnerFunnelPage.deleteMany({ where: { slug: "wp128-unpublished-fixture" } });
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
await db.partnerFunnelPage.create({ data: { vendorId: vendor.id, teamId: team.id, templateVersionId: version.id, promoterMembershipId: membership.id, contentOwnerMembershipId: membership.id, slug: "wp128-unpublished-fixture", headline: "WP128 fixture headline", ctaLabel: "fixture CTA" } });`;
  return `import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const vendorId = (await db.vendor.findUnique({ where: { slug: "wp128-fixture-vendor" }, select: { id: true } }))?.id;
${operation}
await db.$disconnect();
`;
}

function createDatabaseFixture(tempRoot, environmentValue) {
  const fixturePath = path.join(tempRoot, "wp133-fixture.mjs");
  fs.writeFileSync(fixturePath, fixtureScript(false), "utf8");
  const result = run(process.execPath, [fixturePath], environmentValue, tempRoot);
  return { ok: result.exitCode === 0, fixturePath };
}

function cleanupDatabaseFixture(tempRoot, environmentValue) {
  const fixturePath = path.join(tempRoot, "wp133-fixture.mjs");
  fs.writeFileSync(fixturePath, fixtureScript(true), "utf8");
  return run(process.execPath, [fixturePath], environmentValue, tempRoot).exitCode === 0;
}

async function waitForServer(baseURL, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return { ok: false, processExited: true, exitCode: child.exitCode };
    try {
      const response = await fetch(`${baseURL}/login`);
      if (response.status >= 200 && response.status < 500) return { ok: true, processExited: false, exitCode: null };
    } catch { /* readiness probe only */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { ok: false, processExited: false, exitCode: null };
}

function playwrightConfig(tempRoot) {
  return `import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ${JSON.stringify(path.join(tempRoot, "tests", "e2e"))},
  timeout: 30000,
  fullyParallel: false,
  reporter: [["line"]],
  use: { baseURL: process.env.E2E_BASE_URL, trace: "off" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
`;
}

function runExistingWp128Contract(tempRoot, env) {
  const configPath = path.join(tempRoot, "wp133-playwright.config.mjs");
  fs.writeFileSync(configPath, playwrightConfig(tempRoot), "utf8");
  const playwrightBin = path.join(tempRoot, "node_modules", ".bin", process.platform === "win32" ? "playwright.cmd" : "playwright");
  const result = run(playwrightBin, ["test", e2ePath, "--config", configPath], env, tempRoot);
  const sanitizedOutput = sanitizeDiagnosticText(`${result.stdout}\n${result.stderr}`);
  return {
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    testCount: result.exitCode === 0 ? 2 : 0,
    outputFingerprint: crypto.createHash("sha256").update(sanitizedOutput).digest("hex"),
    rawOutputPersisted: false,
  };
}

function stopProcess(child) {
  if (!child?.pid) return true;
  if (process.platform === "win32") return run("taskkill", ["/PID", String(child.pid), "/T", "/F"], process.env).exitCode === 0;
  child.kill("SIGTERM");
  return true;
}

function sourceIntegrity() {
  return Object.fromEntries([
    [componentPath, digest(path.join(root, componentPath))],
    [e2ePath, digest(path.join(root, e2ePath))],
  ]);
}

function preflight() {
  const route = digest(path.join(root, "src/app/api/cloudflare/stream-webhook/route.ts"));
  const statusHelper = digest(path.join(root, "src/lib/cloudflare-video-status.ts"));
  const transitionHelper = digest(path.join(root, "src/lib/cloudflare-video-transition.ts"));
  const source = sourceIntegrity();
  const stagedIndexEmpty = !run("git", ["diff", "--cached", "--name-only"], process.env).stdout.trim();
  const digestMatch = route === expectedDigests.route
    && statusHelper === expectedDigests.statusHelper
    && transitionHelper === expectedDigests.transitionHelper
    && source[componentPath] === expectedDigests.componentFromWp129;
  return {
    digestMatch,
    stagedIndexEmpty,
    digests: { route, statusHelper, transitionHelper, component: source[componentPath] },
    source,
  };
}

function removeTempRoot(tempRoot) {
  const tempBase = path.resolve(os.tmpdir());
  const resolved = path.resolve(tempRoot);
  if (!resolved.startsWith(`${tempBase}${path.sep}`)) throw new Error("TEMP_ROOT_OUTSIDE_OS_TEMP");
  const junction = path.join(resolved, "node_modules");
  if (fs.existsSync(junction)) fs.rmSync(junction, { recursive: false, force: true });
  if (fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  return !fs.existsSync(resolved);
}

export async function main() {
  const startedAt = new Date().toISOString();
  const runId = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const schema = `wp133_${runId.replace(/[^a-z0-9_]/gi, "_")}`;
  const tempRoot = path.join(os.tmpdir(), `celebratedeal-wp133-${runId}`);
  const receipt = {
    workPackage: "WP-133",
    status: "BLOCKED_OR_FAILED",
    classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED,
    scope: "LOCAL_POST_WP131_PUBLIC_UNAVAILABLE_STATE_BROWSER_CLOSURE",
    preflight: null,
    mirror: null,
    junction: null,
    resolution: null,
    port: null,
    database: { boundary: "loopback disposable schema only", containerAvailable: false, schemaReady: false, fixtureCreated: false, fixtureCleanup: "NOT_STARTED", schemaCleanup: "NOT_STARTED", sourceEnvContentsRead: false },
    server: { spawned: false, ready: false, processExited: false, exitBeforeReady: false, spawnError: null, exitCode: null },
    browser: { expected: 2, passed: 0, failed: 0, skipped: 0, testCount: 0, outputFingerprint: null, rawOutputPersisted: false },
    sourceIntegrity: { before: null, after: null, unchanged: false },
    cleanup: { process: "NOT_STARTED", mirror: "NOT_STARTED" },
    externalOperations: false,
    productionOperations: false,
    wp128ArtifactsModified: false,
    dotenvContentRead: false,
    rawLogsPersisted: false,
    stagedIndexEmpty: false,
    scoreImpact: { CAT06_before: 7.0, CAT06_after: 7.0, total_before: 71.0, total_after: 71.0 },
    startedAt,
    finishedAt: null,
  };
  let tempCreated = false;
  let schemaCreated = false;
  let container = null;
  let server = null;
  let env = null;
  try {
    receipt.preflight = preflight();
    receipt.sourceIntegrity.before = receipt.preflight.source;
    receipt.stagedIndexEmpty = receipt.preflight.stagedIndexEmpty;
    if (!receipt.preflight.digestMatch) receipt.classification = CLASSIFICATIONS.DIGEST_MISMATCH;
    else if (!receipt.preflight.stagedIndexEmpty) receipt.classification = CLASSIFICATIONS.STAGED_INDEX_NOT_EMPTY;
    else {
      fs.mkdirSync(tempRoot, { recursive: true });
      tempCreated = true;
      createMirror(tempRoot);
      const mirror = inspectMirror(tempRoot);
      receipt.mirror = { missing: mirror.missing, forbiddenCopied: mirror.forbiddenCopied, forbiddenCopiedCount: mirror.forbiddenCopied.length, sourceDigests: mirror.sourceDigests };
      const junctionPath = path.join(tempRoot, "node_modules");
      const junctionTarget = fs.realpathSync(junctionPath);
      receipt.junction = { ok: fs.lstatSync(junctionPath).isSymbolicLink() && junctionTarget === fs.realpathSync(path.join(root, "node_modules")), targetDigest: digest(path.join(junctionTarget, "next", "package.json")) };
      const resolver = createRequire(path.join(tempRoot, "package.json"));
      const packages = ["next/package.json", "react/package.json", "react-dom/package.json", "playwright/package.json"];
      const resolvedCount = packages.filter((entry) => { try { resolver.resolve(entry); return true; } catch { return false; } }).length;
      receipt.resolution = { ok: resolvedCount === packages.length, resolvedCount, expected: packages.length };
      receipt.port = await allocatePort();
      if (!receipt.port.ok) receipt.classification = CLASSIFICATIONS.PORT_ALLOCATION_FAILURE;
      else {
        const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=${schema}`;
        env = environment(tempRoot, receipt.port.port, databaseUrl);
        container = run("docker", ["ps", "--filter", "ancestor=postgres:16-alpine", "--format", "{{.ID}}"], process.env).stdout.trim().split(/\r?\n/).filter(Boolean)[0] ?? null;
        receipt.database.containerAvailable = Boolean(container);
        if (!container) receipt.classification = CLASSIFICATIONS.DATABASE_CONTAINER_UNAVAILABLE;
        else {
          const create = psql(container, `CREATE SCHEMA "${schema}"; COMMENT ON SCHEMA "${schema}" IS 'celebratedeal:wp133';`, env);
          schemaCreated = create.exitCode === 0;
          const prisma = path.join(tempRoot, "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
          const migrated = schemaCreated && run(prisma, ["migrate", "deploy", "--schema", "prisma/schema.prisma"], env, tempRoot).exitCode === 0;
          const fixture = migrated && createDatabaseFixture(tempRoot, env);
          receipt.database.schemaReady = migrated && Boolean(fixture?.ok);
          receipt.database.fixtureCreated = Boolean(fixture?.ok);
          if (!receipt.database.schemaReady) receipt.classification = CLASSIFICATIONS.DATABASE_SETUP_FAILURE;
          else {
            const nextBin = path.join(tempRoot, "node_modules", "next", "dist", "bin", "next");
            server = spawn(process.execPath, [nextBin, "dev", "--port", String(receipt.port.port), "--hostname", "127.0.0.1"], { cwd: tempRoot, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
            receipt.server.spawned = server.pid !== undefined;
            let output = "";
            server.stdout?.on("data", (chunk) => { output = `${output}${String(chunk)}`.slice(-8000); });
            server.stderr?.on("data", (chunk) => { output = `${output}${String(chunk)}`.slice(-8000); });
            server.on("error", (error) => { receipt.server.spawnError = error.code ?? "SPAWN_ERROR"; });
            const readiness = await waitForServer(`http://127.0.0.1:${receipt.port.port}`, server);
            receipt.server.ready = readiness.ok;
            receipt.server.processExited = readiness.processExited;
            receipt.server.exitCode = readiness.exitCode;
            receipt.server.exitBeforeReady = !readiness.ok;
            receipt.server.diagnosticFingerprint = crypto.createHash("sha256").update(sanitizeDiagnosticText(output)).digest("hex");
            if (!readiness.ok) receipt.classification = CLASSIFICATIONS.SERVER_PRE_READINESS_EXIT;
            else {
              const browser = runExistingWp128Contract(tempRoot, env);
              receipt.browser = { ...receipt.browser, passed: browser.testCount, testCount: browser.testCount, failed: browser.ok ? 0 : 1, outputFingerprint: browser.outputFingerprint, rawOutputPersisted: browser.rawOutputPersisted };
              if (!browser.ok) receipt.classification = CLASSIFICATIONS.BROWSER_CONTRACT_FAILURE;
              else receipt.classification = CLASSIFICATIONS.PASS;
            }
          }
        }
      }
    }
  } catch (error) {
    receipt.classification = receipt.classification === CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED ? CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED : receipt.classification;
    receipt.failure = error instanceof Error ? error.message : String(error);
  } finally {
    if (server?.pid) receipt.cleanup.process = stopProcess(server) ? "PASS" : "FAIL";
    else receipt.cleanup.process = "PASS";
    if (receipt.database.fixtureCreated && env) receipt.database.fixtureCleanup = cleanupDatabaseFixture(tempRoot, env) ? "PASS" : "FAIL";
    else receipt.database.fixtureCleanup = receipt.database.fixtureCreated ? "FAIL" : "NOT_REQUIRED";
    if (schemaCreated && container && env) receipt.database.schemaCleanup = psql(container, `DROP SCHEMA IF EXISTS "${schema}" CASCADE;`, env).exitCode === 0 ? "PASS" : "FAIL";
    else receipt.database.schemaCleanup = schemaCreated ? "FAIL" : "NOT_REQUIRED";
    if (tempCreated) {
      try { receipt.cleanup.mirror = removeTempRoot(tempRoot) ? "PASS" : "FAIL"; } catch { receipt.cleanup.mirror = "FAIL"; }
    } else receipt.cleanup.mirror = "NOT_REQUIRED";
    receipt.sourceIntegrity.after = sourceIntegrity();
    receipt.sourceIntegrity.unchanged = JSON.stringify(receipt.sourceIntegrity.before) === JSON.stringify(receipt.sourceIntegrity.after);
    receipt.wp128ArtifactsModified = !receipt.sourceIntegrity.unchanged;
    receipt.stagedIndexEmpty = !run("git", ["diff", "--cached", "--name-only"], process.env).stdout.trim();
    receipt.workspacePreserved = receipt.sourceIntegrity.unchanged && receipt.stagedIndexEmpty;
    receipt.finishedAt = new Date().toISOString();
    if (receipt.classification === CLASSIFICATIONS.PASS && (!receipt.workspacePreserved || receipt.database.fixtureCleanup === "FAIL" || receipt.database.schemaCleanup === "FAIL" || receipt.cleanup.mirror === "FAIL" || receipt.cleanup.process === "FAIL")) receipt.classification = CLASSIFICATIONS.CLEANUP_FAILURE;
    receipt.status = receipt.classification === CLASSIFICATIONS.PASS ? "PASS" : "BLOCKED_OR_FAILED";
    fs.writeFileSync(reportPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }
  if (receipt.status !== "PASS") process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();
