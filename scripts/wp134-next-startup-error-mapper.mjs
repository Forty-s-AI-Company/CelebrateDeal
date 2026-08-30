import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(root, ".ai-team", "reports", "wp134-next-startup-error-mapping-receipt.json");
const sourcePath = "src/app/api/cloudflare/stream-webhook/route.ts";
const requiredInputs = [
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "playwright.config.ts",
  "tsconfig.json",
  sourcePath,
];
const historicalReceipts = Object.freeze({
  wp126: ".ai-team/reports/wp126-build-boundary-audit-receipt.json",
  wp129: ".ai-team/reports/wp129-public-partner-server-diagnostic-receipt.json",
  wp133: ".ai-team/reports/wp133-public-unavailable-browser-receipt.json",
});

export const CLASSIFICATIONS = Object.freeze({
  CLEAN_SEPARABLE_CANDIDATE: "CLEAN_SEPARABLE_CANDIDATE",
  EXACT_PRESERVE_ONLY_NO_GO: "EXACT_PRESERVE_ONLY_NO_GO",
  UNKNOWN_FAIL_CLOSED: "UNKNOWN_FAIL_CLOSED",
  PREFLIGHT_FAILURE: "PREFLIGHT_FAILURE",
});

export const ERROR_FAMILIES = Object.freeze({
  TYPESCRIPT_TYPE_ERROR: "TYPESCRIPT_TYPE_ERROR",
  NEXT_COMPILE_FAILURE: "NEXT_COMPILE_FAILURE",
  MODULE_RESOLUTION_FAILURE: "MODULE_RESOLUTION_FAILURE",
  JAVASCRIPT_SYNTAX_ERROR: "JAVASCRIPT_SYNTAX_ERROR",
  JAVASCRIPT_TYPE_ERROR: "JAVASCRIPT_TYPE_ERROR",
  PORT_IN_USE: "PORT_IN_USE",
  RUNTIME_CONFIGURATION_FAILURE: "RUNTIME_CONFIGURATION_FAILURE",
  UNKNOWN: "UNKNOWN",
});

export { requiredInputs };

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

function mirrorFilter(source) {
  const relative = path.relative(root, source).replaceAll("\\", "/");
  if (!relative) return true;
  if ([".git", ".next", "node_modules", ".ai-team"].includes(relative)) return false;
  return !isForbiddenPath(relative);
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
    .replaceAll(/[A-Za-z]:\\[^\r\n\s'"`]+/g, "<path>")
    .replaceAll(/\b[A-Z][A-Z0-9_]{2,}=([^\s]+)/g, "<env>=<value>")
    .replaceAll(/(?:postgres(?:ql)?:\/\/)[^\s]+/gi, "<database-url>")
    .replaceAll(/https?:\/\/[^\s]+/gi, "<url>");
}

function normalizePathToken(value, tempRoot) {
  let candidate = String(value ?? "").replaceAll("\\", "/");
  candidate = candidate.replace(/[),\]}>'"`]+$/g, "").replace(/:\d+(?::\d+)?$/, "");
  const mirror = tempRoot.replaceAll("\\", "/").replace(/\/$/, "");
  if (candidate.toLowerCase().startsWith(`${mirror.toLowerCase()}/`)) candidate = candidate.slice(mirror.length + 1);
  const srcIndex = candidate.indexOf("src/");
  if (srcIndex >= 0) return candidate.slice(srcIndex);
  const generatedIndex = candidate.indexOf(".next/types/");
  if (generatedIndex >= 0) return candidate.slice(generatedIndex);
  return null;
}

export function mapGeneratedToSource(generatedPath) {
  if (!generatedPath || !generatedPath.startsWith(".next/types/")) return null;
  const mapped = generatedPath.slice(".next/types/".length);
  return mapped.startsWith("app/") || mapped.startsWith("pages/") ? `src/${mapped}` : null;
}

function extractPaths(output, tempRoot) {
  const candidates = String(output ?? "").match(/(?:[A-Za-z]:[\\/][^\r\n\s'"`]+|(?:src|\.next)[\\/][^\r\n\s'"`]+)/g) ?? [];
  const normalized = candidates.map((candidate) => normalizePathToken(candidate, tempRoot)).filter(Boolean);
  const generatedPath = normalized.find((candidate) => candidate.startsWith(".next/types/")) ?? null;
  const directSourcePath = normalized.find((candidate) => candidate.startsWith("src/")) ?? null;
  return { generatedPath, sourcePath: directSourcePath ?? mapGeneratedToSource(generatedPath) };
}

function extractLocation(output) {
  const match = /(?:\.ts|\.tsx):([0-9]+):([0-9]+)/.exec(String(output ?? ""));
  return match ? { line: Number(match[1]), column: Number(match[2]) } : { line: null, column: null };
}

export function classifyErrorFamily(output) {
  const value = String(output ?? "");
  if (/Type error:|TypeScript|TS\d{4}/i.test(value)) return ERROR_FAMILIES.TYPESCRIPT_TYPE_ERROR;
  if (/Cannot find module|Module not found|ERR_MODULE_NOT_FOUND/i.test(value)) return ERROR_FAMILIES.MODULE_RESOLUTION_FAILURE;
  if (/SyntaxError|Unexpected token/i.test(value)) return ERROR_FAMILIES.JAVASCRIPT_SYNTAX_ERROR;
  if (/TypeError/i.test(value)) return ERROR_FAMILIES.JAVASCRIPT_TYPE_ERROR;
  if (/EADDRINUSE|address already in use/i.test(value)) return ERROR_FAMILIES.PORT_IN_USE;
  if (/Failed to compile|failed to compile/i.test(value)) return ERROR_FAMILIES.NEXT_COMPILE_FAILURE;
  if (/DATABASE_URL|PrismaClient|configuration/i.test(value)) return ERROR_FAMILIES.RUNTIME_CONFIGURATION_FAILURE;
  return ERROR_FAMILIES.UNKNOWN;
}

export function classifyPhase(output, family) {
  const value = String(output ?? "");
  if (family === ERROR_FAMILIES.TYPESCRIPT_TYPE_ERROR || /TypeScript|typecheck/i.test(value)) return "TYPECHECK";
  if (family === ERROR_FAMILIES.MODULE_RESOLUTION_FAILURE) return "MODULE_RESOLUTION";
  if (family === ERROR_FAMILIES.NEXT_COMPILE_FAILURE || /compile/i.test(value)) return "NEXT_COMPILE";
  if (family === ERROR_FAMILIES.PORT_IN_USE) return "SERVER_BIND";
  return "SERVER_STARTUP";
}

function findSymbol(source, line) {
  if (!source || !fs.existsSync(path.join(root, source))) return null;
  const lines = fs.readFileSync(path.join(root, source), "utf8").split(/\r?\n/);
  const end = Math.min(Math.max(Number(line) || lines.length, 1), lines.length);
  for (let index = end - 1; index >= 0; index -= 1) {
    const declaration = /(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)|(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=|^\s*([A-Za-z_$][\w$]*)\s*:/u.exec(lines[index]);
    if (declaration) return declaration[1] ?? declaration[2] ?? declaration[3] ?? null;
  }
  return null;
}

function hunkRanges(diff) {
  return [...String(diff ?? "").matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].map((match) => ({ start: Number(match[1]), count: Number(match[2] ?? 1) }));
}

export function hunkOverlapForPath(relative, line) {
  if (!relative) return { dirty: false, hunkCount: 0, overlap: null, ownership: "UNKNOWN" };
  const status = run("git", ["status", "--short", "--", relative], process.env).stdout.trim();
  const diff = run("git", ["diff", "--unified=0", "--", relative], process.env).stdout;
  const ranges = hunkRanges(diff);
  const dirty = Boolean(status);
  const ownership = status.startsWith("??") ? "UNTRACKED" : dirty ? "PRESERVE_ONLY_DIRTY" : "TRACKED_CLEAN";
  const overlap = Number.isInteger(line) && line > 0 ? ranges.some((range) => line >= range.start && line <= range.start + Math.max(range.count, 1) - 1) : null;
  return { dirty, statusCode: status.slice(0, 2) || "", hunkCount: ranges.length, overlap, ownership };
}

export function classifyOwnership({ source, family, symbol, hunk }) {
  if (!source || !family || family === ERROR_FAMILIES.UNKNOWN || !symbol || !hunk) return CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
  if (hunk.ownership === "PRESERVE_ONLY_DIRTY") return hunk.overlap === true ? CLASSIFICATIONS.EXACT_PRESERVE_ONLY_NO_GO : CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
  if (hunk.ownership === "TRACKED_CLEAN" && hunk.overlap === false) return CLASSIFICATIONS.CLEAN_SEPARABLE_CANDIDATE;
  if (hunk.ownership === "UNTRACKED") return CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
  return CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
}

export {
  currentDirtyInventory,
  environment,
  extractLocation,
  extractPaths,
  findSymbol,
  hunkRanges,
  inspectMirror,
  isForbiddenPath,
  mirrorFilter,
  normalizePathToken,
  preflight,
  sourceIntegrity,
};

function sourceIntegrity() {
  return Object.fromEntries(requiredInputs.map((relative) => [relative, digest(path.join(root, relative))]));
}

function currentDirtyInventory() {
  const status = run("git", ["status", "--porcelain=v1"], process.env).stdout;
  return {
    count: status ? status.split(/\r?\n/).filter(Boolean).length : 0,
    pathStatusFingerprint: crypto.createHash("sha256").update(status).digest("hex"),
  };
}

function preflight() {
  const stagedIndexEmpty = !run("git", ["diff", "--cached", "--name-only"], process.env).stdout.trim();
  const inputsPresent = requiredInputs.every((relative) => fs.existsSync(path.join(root, relative)));
  return { stagedIndexEmpty, inputsPresent, sourceIntegrity: sourceIntegrity(), dirtyInventory: currentDirtyInventory() };
}

function environment(tempRoot, port) {
  const databaseUrl = "postgresql://synthetic:synthetic@127.0.0.1:54329/wp134_test";
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
    PAYMENT_PROVIDER: "demo",
    RATE_LIMIT_PROVIDER: "memory",
    CSRF_SECRET: "wp134-local-csrf-synthetic-value",
    JOB_SECRET: "wp134-local-job-synthetic-value",
    NEXT_TELEMETRY_DISABLED: "1",
    SENTRY_DISABLE_AUTO_UPLOAD: "true",
    NPM_CONFIG_OFFLINE: "true",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
  };
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

function loadHistorical() {
  return Object.fromEntries(Object.entries(historicalReceipts).map(([key, relative]) => {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) return [key, { present: false }];
    try {
      const receipt = JSON.parse(fs.readFileSync(absolute, "utf8"));
      return [key, { present: true, classification: receipt.classification ?? receipt.status ?? "UNKNOWN", fingerprint: receipt.diagnosticFingerprint ?? receipt.server?.diagnosticFingerprint ?? null }];
    } catch {
      return [key, { present: true, parseable: false }];
    }
  }));
}

function normalizedDiagnostic({ output, tempRoot }) {
  const family = classifyErrorFamily(output);
  const paths = extractPaths(output, tempRoot);
  const location = extractLocation(output);
  const source = paths.sourcePath;
  const symbol = findSymbol(source, location.line);
  const phase = classifyPhase(output, family);
  const safeSummary = `${family}|${phase}|${paths.generatedPath ?? "<none>"}|${source ?? "<none>"}|${symbol ?? "<none>"}`;
  return {
    errorFamily: family,
    phase,
    generatedPath: paths.generatedPath,
    sourcePath: source,
    symbol,
    line: location.line,
    column: location.column,
    fingerprint: crypto.createHash("sha256").update(safeSummary).digest("hex"),
    rawOutputPersisted: false,
  };
}

async function waitForServer(baseURL, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return { ready: false, processExited: true, exitCode: child.exitCode };
    try {
      const response = await fetch(`${baseURL}/login`);
      if (response.status >= 200 && response.status < 500) return { ready: true, processExited: false, exitCode: null };
    } catch { /* readiness probe only */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { ready: false, processExited: false, exitCode: null };
}

function stopProcess(child) {
  if (!child?.pid || child.exitCode !== null) return true;
  if (process.platform === "win32") return run("taskkill", ["/PID", String(child.pid), "/T", "/F"], process.env).exitCode === 0;
  child.kill("SIGTERM");
  return true;
}

function removeTempRoot(tempRoot) {
  const base = path.resolve(os.tmpdir());
  const resolved = path.resolve(tempRoot);
  if (!resolved.startsWith(`${base}${path.sep}`)) throw new Error("TEMP_ROOT_OUTSIDE_OS_TEMP");
  const junction = path.join(resolved, "node_modules");
  if (fs.existsSync(junction)) fs.rmSync(junction, { recursive: false, force: true });
  if (fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  return !fs.existsSync(resolved);
}

export async function main() {
  const startedAt = new Date().toISOString();
  const runId = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const tempRoot = path.join(os.tmpdir(), `celebratedeal-wp134-${runId}`);
  const receipt = {
    workPackage: "WP-134",
    status: "BLOCKED_OR_FAILED",
    classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED,
    scope: "LOCAL_SINGLE_NEXT_STARTUP_ERROR_MAPPING",
    launchBudget: { nextServerLaunches: 0, maximum: 1, browserRuns: 0, retries: 0 },
    preflight: null,
    mirror: null,
    junction: null,
    resolution: null,
    port: null,
    server: { spawned: false, ready: false, processExited: false, exitBeforeReady: false, exitCode: null, diagnosticFingerprint: null },
    diagnostic: null,
    ownership: null,
    historicalComparison: null,
    cleanup: { process: "NOT_STARTED", mirror: "NOT_STARTED" },
    sourceIntegrity: { before: null, after: null, unchanged: false },
    dirtyInventory: { before: null, after: null, unchanged: false },
    stagedIndexEmpty: false,
    rawOutputPersisted: false,
    dotenvContentRead: false,
    externalOperations: false,
    databaseOperations: false,
    browserRuns: 0,
    productionOperations: false,
    scoreImpact: { CAT06_before: 7.0, CAT06_after: 7.0, CAT09_before: 6.5, CAT09_after: 6.5, total_before: 71.0, total_after: 71.0 },
    startedAt,
    finishedAt: null,
  };
  let tempCreated = false;
  let server = null;
  let env = null;
  try {
    receipt.preflight = preflight();
    receipt.sourceIntegrity.before = receipt.preflight.sourceIntegrity;
    receipt.dirtyInventory.before = receipt.preflight.dirtyInventory;
    receipt.stagedIndexEmpty = receipt.preflight.stagedIndexEmpty;
    if (!receipt.preflight.inputsPresent || !receipt.preflight.stagedIndexEmpty) receipt.classification = CLASSIFICATIONS.PREFLIGHT_FAILURE;
    else {
      fs.mkdirSync(tempRoot, { recursive: true });
      tempCreated = true;
      fs.cpSync(root, tempRoot, { recursive: true, filter: mirrorFilter });
      fs.symlinkSync(path.join(root, "node_modules"), path.join(tempRoot, "node_modules"), "junction");
      fs.mkdirSync(path.join(tempRoot, "tmp"), { recursive: true });
      fs.mkdirSync(path.join(tempRoot, "home"), { recursive: true });
      const mirror = inspectMirror(tempRoot);
      receipt.mirror = { missing: mirror.missing, forbiddenCopied: mirror.forbiddenCopied, forbiddenCopiedCount: mirror.forbiddenCopied.length, sourceDigests: mirror.sourceDigests };
      const junctionPath = path.join(tempRoot, "node_modules");
      const target = fs.realpathSync(junctionPath);
      receipt.junction = { ok: fs.lstatSync(junctionPath).isSymbolicLink() && target === fs.realpathSync(path.join(root, "node_modules")), targetDigest: digest(path.join(target, "next", "package.json")) };
      const resolver = createRequire(path.join(tempRoot, "package.json"));
      const packages = ["next/package.json", "react/package.json", "react-dom/package.json", "typescript/package.json"];
      const resolvedCount = packages.filter((entry) => { try { resolver.resolve(entry); return true; } catch { return false; } }).length;
      receipt.resolution = { ok: resolvedCount === packages.length, resolvedCount, expected: packages.length };
      receipt.port = await allocatePort();
      if (receipt.port.ok && receipt.junction.ok && receipt.resolution.ok && mirror.missing.length === 0 && mirror.forbiddenCopied.length === 0) {
        env = environment(tempRoot, receipt.port.port);
        const nextBin = path.join(tempRoot, "node_modules", "next", "dist", "bin", "next");
        server = spawn(process.execPath, [nextBin, "dev", "--port", String(receipt.port.port), "--hostname", "127.0.0.1"], { cwd: tempRoot, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        receipt.launchBudget.nextServerLaunches = 1;
        receipt.server.spawned = server.pid !== undefined;
        let output = "";
        server.stdout?.on("data", (chunk) => { output = `${output}${String(chunk)}`.slice(-64_000); });
        server.stderr?.on("data", (chunk) => { output = `${output}${String(chunk)}`.slice(-64_000); });
        const readiness = await waitForServer(`http://127.0.0.1:${receipt.port.port}`, server);
        receipt.server.ready = readiness.ready;
        receipt.server.processExited = readiness.processExited;
        receipt.server.exitBeforeReady = !readiness.ready;
        receipt.server.exitCode = readiness.exitCode ?? server.exitCode;
        const diagnostic = normalizedDiagnostic({ output, tempRoot });
        receipt.diagnostic = diagnostic;
        receipt.server.diagnosticFingerprint = diagnostic.fingerprint;
        receipt.historicalComparison = loadHistorical();
        receipt.ownership = hunkOverlapForPath(diagnostic.sourcePath, diagnostic.line);
        receipt.classification = classifyOwnership({ source: diagnostic.sourcePath, family: diagnostic.errorFamily, symbol: diagnostic.symbol, line: diagnostic.line, hunk: receipt.ownership });
      }
    }
  } catch (error) {
    receipt.failureCode = error?.code ?? "MAPPER_EXCEPTION";
  } finally {
    receipt.cleanup.process = stopProcess(server) ? "PASS" : "FAIL";
    if (tempCreated) {
      try { receipt.cleanup.mirror = removeTempRoot(tempRoot) ? "PASS" : "FAIL"; } catch { receipt.cleanup.mirror = "FAIL"; }
    } else receipt.cleanup.mirror = "NOT_REQUIRED";
    receipt.sourceIntegrity.after = sourceIntegrity();
    receipt.sourceIntegrity.unchanged = JSON.stringify(receipt.sourceIntegrity.before) === JSON.stringify(receipt.sourceIntegrity.after);
    receipt.dirtyInventory.after = currentDirtyInventory();
    receipt.dirtyInventory.unchanged = JSON.stringify(receipt.dirtyInventory.before) === JSON.stringify(receipt.dirtyInventory.after);
    receipt.stagedIndexEmpty = !run("git", ["diff", "--cached", "--name-only"], process.env).stdout.trim();
    receipt.workspacePreserved = receipt.sourceIntegrity.unchanged && receipt.dirtyInventory.unchanged && receipt.stagedIndexEmpty;
    receipt.finishedAt = new Date().toISOString();
    if (!receipt.workspacePreserved || receipt.cleanup.process === "FAIL" || receipt.cleanup.mirror === "FAIL") receipt.classification = CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
    receipt.status = receipt.classification === CLASSIFICATIONS.CLEAN_SEPARABLE_CANDIDATE || receipt.classification === CLASSIFICATIONS.EXACT_PRESERVE_ONLY_NO_GO ? "PASS" : "BLOCKED_OR_FAILED";
    fs.writeFileSync(reportPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }
  if (receipt.status !== "PASS") process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();
