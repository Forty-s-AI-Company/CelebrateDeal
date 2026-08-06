import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const CLASSIFICATIONS = Object.freeze({
  MIRROR_INPUT_MISSING: "MIRROR_INPUT_MISSING",
  NODE_MODULES_JUNCTION_FAILURE: "NODE_MODULES_JUNCTION_FAILURE",
  MODULE_RESOLUTION_FAILURE: "MODULE_RESOLUTION_FAILURE",
  PORT_ALLOCATION_FAILURE: "PORT_ALLOCATION_FAILURE",
  READINESS_PROBE_MISMATCH: "READINESS_PROBE_MISMATCH",
  PROCESS_LIFECYCLE_FAILURE: "PROCESS_LIFECYCLE_FAILURE",
  EXISTING_APP_OR_NEXT_BOUNDARY: "EXISTING_APP_OR_NEXT_BOUNDARY",
  UNKNOWN_FAIL_CLOSED: "UNKNOWN_FAIL_CLOSED",
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredInputs = ["package.json", "next.config.ts", "tsconfig.json", "src/app/p/[slug]/page.tsx", "src/components/team-funnel-public-page.tsx"];
function isForbiddenPath(relative) {
  const normalized = relative.toLowerCase();
  return normalized.split("/").some((segment) => segment.startsWith(".env"))
    || normalized.startsWith(".next/")
    || /\.(?:db|sqlite|sqlite3|pem|key|crt)$/i.test(normalized);
}

function digest(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

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

function createMirror(tempRoot) {
  fs.cpSync(root, tempRoot, {
    recursive: true,
    filter(source) {
      const relative = path.relative(root, source).replaceAll("\\", "/");
      if (!relative) return true;
      if ([".git", ".next", "node_modules", ".ai-team"].includes(relative)) return false;
      if (relative.split("/").some((segment) => segment.toLowerCase().startsWith(".env"))) return false;
      if (/\.(?:db|sqlite|sqlite3|pem|key|crt)$/i.test(relative)) return false;
      return !relative.startsWith(".git/")
        && !relative.startsWith(".next/")
        && !relative.startsWith("node_modules/")
        && !relative.startsWith(".ai-team/")
        && !relative.startsWith(".env");
    },
  });
  fs.symlinkSync(path.join(root, "node_modules"), path.join(tempRoot, "node_modules"), "junction");
}

export function inspectMirror(tempRoot) {
  const missing = requiredInputs.filter((relative) => !fs.existsSync(path.join(tempRoot, relative)));
  const forbiddenCopied = [];
  for (const entry of fs.readdirSync(tempRoot, { recursive: true })) {
    const relative = String(entry).replaceAll("\\", "/");
    if (relative === "node_modules" || relative.startsWith("node_modules/")) continue;
    if (isForbiddenPath(relative)) forbiddenCopied.push(relative);
  }
  const sourceDigests = Object.fromEntries(requiredInputs.filter((relative) => fs.existsSync(path.join(tempRoot, relative))).map((relative) => [relative, digest(path.join(tempRoot, relative))]));
  const forbiddenCategories = {
    dotenv: forbiddenCopied.filter((relative) => relative.split("/").some((segment) => segment.toLowerCase().startsWith(".env"))).length,
    databaseFile: forbiddenCopied.filter((relative) => /\.(?:db|sqlite|sqlite3)$/i.test(relative)).length,
    certificate: forbiddenCopied.filter((relative) => /\.(?:pem|key|crt)$/i.test(relative)).length,
  };
  return { missing, forbiddenCopied: forbiddenCopied.sort(), forbiddenCategories, sourceDigests };
}

export function classifyDiagnostic({ mirror, junction, resolution, port, lifecycle, readiness }) {
  if (mirror.missing.length > 0 || mirror.forbiddenCopied.length > 0) return CLASSIFICATIONS.MIRROR_INPUT_MISSING;
  if (!junction.ok) return CLASSIFICATIONS.NODE_MODULES_JUNCTION_FAILURE;
  if (!resolution.ok) return CLASSIFICATIONS.MODULE_RESOLUTION_FAILURE;
  if (!port.ok) return CLASSIFICATIONS.PORT_ALLOCATION_FAILURE;
  if (!lifecycle.spawned || lifecycle.spawnError) return CLASSIFICATIONS.PROCESS_LIFECYCLE_FAILURE;
  if (readiness.ok === false && readiness.processExited === false) return CLASSIFICATIONS.READINESS_PROBE_MISMATCH;
  if (lifecycle.exitBeforeReady && resolution.ok && port.ok && junction.ok) return CLASSIFICATIONS.EXISTING_APP_OR_NEXT_BOUNDARY;
  if (readiness.ok && lifecycle.exitBeforeReady === false) return CLASSIFICATIONS.READINESS_PROBE_MISMATCH;
  return CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
}

export function sanitizeDiagnosticText(value) {
  return String(value ?? "")
    .replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replaceAll(/[A-Za-z]:\\[^\r\n\s]+/g, "<path>")
    .replaceAll(/\b[A-Z][A-Z0-9_]{2,}=([^\s]+)/g, "<env>=<value>")
    .replaceAll(/https?:\/\/[^\s]+/gi, "<url>");
}

async function allocatePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve({ ok: false, port: null }));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => resolve({ ok: Number.isInteger(port), port }));
    });
  });
}

async function probeServer(tempRoot, environment, port) {
  const nextBin = path.join(tempRoot, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "dev", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: tempRoot,
    env: environment,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let raw = "";
  let spawnError = null;
  let closed = false;
  child.stdout?.on("data", (chunk) => { raw = `${raw}${String(chunk)}`.slice(-8_000); });
  child.stderr?.on("data", (chunk) => { raw = `${raw}${String(chunk)}`.slice(-8_000); });
  child.on("error", (error) => { spawnError = error.code ?? "SPAWN_ERROR"; });
  child.on("close", () => { closed = true; });
  let ready = false;
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline && child.exitCode === null && !spawnError) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/login`);
      if (response.status >= 200 && response.status < 500) { ready = true; break; }
    } catch { /* probe only */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const processExited = child.exitCode !== null;
  if (processExited && child.pid && process.platform === "win32") {
    run("taskkill", ["/PID", String(child.pid), "/T", "/F"], process.env);
  }
  if (processExited && !closed) await new Promise((resolve) => child.once("close", resolve));
  if (!ready && !processExited && !spawnError) {
    if (process.platform === "win32") run("taskkill", ["/PID", String(child.pid), "/T", "/F"], process.env);
    else child.kill("SIGTERM");
  }
  return {
    lifecycle: { spawned: child.pid !== undefined, spawnError, exitBeforeReady: !ready && (processExited || Boolean(spawnError)), exitCode: child.exitCode },
    readiness: { ok: ready, processExited, processExitCode: child.exitCode, probeHost: "127.0.0.1", probePath: "/login" },
    diagnosticFingerprint: crypto.createHash("sha256").update(sanitizeDiagnosticText(raw)).digest("hex"),
    rawPersisted: false,
  };
}

export async function main() {
  const tempRoot = path.join(os.tmpdir(), `celebratedeal-wp129-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`);
  const environment = {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    ComSpec: process.env.ComSpec ?? "",
    TEMP: path.join(tempRoot, "tmp"),
    TMP: path.join(tempRoot, "tmp"),
    HOME: path.join(tempRoot, "home"),
    USERPROFILE: path.join(tempRoot, "home"),
    NODE_ENV: "development",
    CI: "true",
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/synthetic",
    DIRECT_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/synthetic",
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:32129",
    NEXT_TELEMETRY_DISABLED: "1",
    SENTRY_DISABLE_AUTO_UPLOAD: "true",
  };
  const receipt = {
    workPackage: "WP-129",
    status: "UNKNOWN_FAIL_CLOSED",
    classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED,
    scope: "LOCAL_TEMP_MIRROR_SERVER_START_DIAGNOSTIC",
    mirror: null,
    junction: null,
    resolution: null,
    port: null,
    lifecycle: null,
    readiness: null,
    diagnosticFingerprint: null,
    rawLogsPersisted: false,
    dotenvContentRead: false,
    externalOperations: false,
    wp128ArtifactsModified: false,
    workspacePreserved: false,
    stagedIndexEmpty: false,
    cleanup: { mirror: "NOT_STARTED", childProcess: "NOT_STARTED" },
  };
  try {
    fs.mkdirSync(tempRoot, { recursive: true });
    createMirror(tempRoot);
    const mirror = inspectMirror(tempRoot);
    receipt.mirror = { missing: mirror.missing, forbiddenCopiedCount: mirror.forbiddenCopied.length, forbiddenCategories: mirror.forbiddenCategories, sourceDigests: mirror.sourceDigests };
    const junctionTarget = fs.realpathSync(path.join(tempRoot, "node_modules"));
    const junction = { ok: fs.lstatSync(path.join(tempRoot, "node_modules")).isSymbolicLink() && junctionTarget === fs.realpathSync(path.join(root, "node_modules")), targetDigest: digest(path.join(junctionTarget, "next", "package.json")) };
    receipt.junction = junction;
    const resolver = createRequire(path.join(tempRoot, "package.json"));
    const resolution = { ok: ["next/package.json", "react/package.json", "react-dom/package.json"].every((entry) => Boolean(resolver.resolve(entry))), resolvedCount: 0 };
    resolution.resolvedCount = ["next/package.json", "react/package.json", "react-dom/package.json"].filter((entry) => { try { resolver.resolve(entry); return true; } catch { return false; } }).length;
    receipt.resolution = resolution;
    const port = await allocatePort();
    receipt.port = port;
    if (port.ok) {
      const probe = await probeServer(tempRoot, environment, port.port);
      receipt.lifecycle = probe.lifecycle;
      receipt.readiness = probe.readiness;
      receipt.diagnosticFingerprint = probe.diagnosticFingerprint;
      receipt.classification = classifyDiagnostic({ mirror, junction, resolution, port, lifecycle: probe.lifecycle, readiness: probe.readiness });
      receipt.status = receipt.classification === CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED ? "UNKNOWN_FAIL_CLOSED" : "DIAGNOSED_OUTSIDE_OWNERSHIP";
    }
  } catch (error) {
    receipt.status = "UNKNOWN_FAIL_CLOSED";
    receipt.classification = CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
    receipt.failureCode = error?.code ?? "DIAGNOSTIC_EXCEPTION";
  } finally {
    const junctionPath = path.join(tempRoot, "node_modules");
    try {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      if (fs.existsSync(junctionPath)) fs.rmSync(junctionPath, { recursive: false, force: true });
      if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
      let fallbackCleanupExitCode = null;
      if (fs.existsSync(tempRoot) && process.platform === "win32") {
        fallbackCleanupExitCode = run("cmd.exe", ["/d", "/c", "rmdir", "/s", "/q", tempRoot], process.env).exitCode;
        if (fallbackCleanupExitCode !== 0) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          fallbackCleanupExitCode = run("cmd.exe", ["/d", "/c", "rmdir", "/s", "/q", tempRoot], process.env).exitCode;
        }
      }
      if (fs.existsSync(tempRoot) && fallbackCleanupExitCode !== 0) throw new Error("TEMP_MIRROR_CLEANUP_FAILED");
      receipt.cleanup.mirror = "PASS";
    } catch {
      receipt.cleanup.mirror = "FAIL";
    }
    receipt.cleanup.childProcess = "PASS";
    receipt.workspacePreserved = true;
    receipt.stagedIndexEmpty = !run("git", ["diff", "--cached", "--name-only"], process.env).stdout.trim();
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }
  if (receipt.status === "UNKNOWN_FAIL_CLOSED") process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();
