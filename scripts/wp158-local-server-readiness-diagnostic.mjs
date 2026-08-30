import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { canonicalSnapshotDigest, createCleanupCoordinator } from "./wp156-local-server-readiness-diagnostic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK_PACKAGE = "WP-158";
const SCHEMA_VERSION = "wp158-local-server-readiness-diagnostic/v1";
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
const nonce = crypto.randomBytes(4).toString("hex");
const tempRoot = path.join(os.tmpdir(), `celebratedeal-wp158-${runId}-${nonce}`);
const port = 32256 + Number.parseInt(nonce.slice(0, 2), 16) % 100;

const PHASES = Object.freeze(["PREFLIGHT", "SPAWN", "PROCESS_RUNNING", "LOOPBACK_BIND", "READINESS_PROBE", "TERMINAL"]);
const EXIT_SIGNAL_FAMILIES = Object.freeze([
  "PROCESS_STILL_RUNNING_AT_SNAPSHOT",
  "NORMAL_EXIT_BEFORE_READY",
  "NONZERO_EXIT_BEFORE_READY",
  "SIGNALLED_BEFORE_READY",
  "SPAWN_FAILED",
  "NOT_APPLICABLE",
  "UNKNOWN",
]);
const BIND_CLASSES = Object.freeze([
  "LOOPBACK_BOUND_TO_CHILD",
  "LOOPBACK_ACCEPTING_UNATTRIBUTED",
  "LOOPBACK_NOT_OBSERVED",
  "NON_LOOPBACK_REJECTED",
  "PORT_CONFLICT",
  "UNKNOWN",
]);
const TIMEOUT_BOUNDARIES = Object.freeze(["NO_TIMEOUT", "BEFORE_PROCESS_RUNNING", "AFTER_RUNNING_BEFORE_BIND", "AFTER_BIND_BEFORE_READY", "UNKNOWN"]);

const protectedPaths = [
  ".ai-team/reports/wp155-public-unavailable-browser-receipt.json",
  ".ai-team/reports/wp156-local-server-readiness-diagnostic-receipt.json",
  ".ai-team/reports/wp157-wp156-cleanup-receipt-remediation.json",
  "docs/ai-team/evidence/wp-155-public-unavailable-browser.md",
  "docs/ai-team/evidence/wp-156-local-server-readiness-diagnostic.md",
  "scripts/wp155-public-unavailable-browser-runner.mjs",
  "scripts/wp155-public-unavailable-browser-runner.test.mjs",
  "scripts/wp156-local-server-readiness-diagnostic.mjs",
  "scripts/wp156-local-server-readiness-diagnostic.test.mjs",
  "scripts/wp157-wp156-cleanup-receipt-remediation.test.mjs",
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
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
    E2E_BASE_URL: `http://127.0.0.1:${port}`,
    E2E_TEST_MODE: "true",
    CSRF_SECRET: "wp158-local-csrf-synthetic-value",
    JOB_SECRET: "wp158-local-job-synthetic-value",
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

function classifyExit({ code = null, signal = null, spawnError = false, running = false } = {}) {
  if (spawnError) return "SPAWN_FAILED";
  if (running) return "PROCESS_STILL_RUNNING_AT_SNAPSHOT";
  if (signal) return "SIGNALLED_BEFORE_READY";
  if (typeof code === "number") return code === 0 ? "NORMAL_EXIT_BEFORE_READY" : "NONZERO_EXIT_BEFORE_READY";
  return "NOT_APPLICABLE";
}

function initialDiagnosticState() {
  return {
    phase: "PREFLIGHT",
    attempt: 0,
    serverAttempts: 0,
    readinessWindows: 0,
    retries: 0,
    restarts: 0,
    browserCases: 0,
    exitSignalFamily: "NOT_APPLICABLE",
    loopbackBindClass: "LOOPBACK_NOT_OBSERVED",
    timeoutBoundary: "NO_TIMEOUT",
    ready: false,
    events: [],
  };
}

function diagnosticTransition(state, event, details = {}) {
  if (!state || !PHASES.includes(state.phase)) throw new Error("WP158_DIAGNOSTIC_STATE_INVALID");
  if (state.phase === "TERMINAL") return { ...state, events: [...state.events, `IGNORED:${event}`] };
  const next = { ...state, events: [...state.events, event] };
  switch (event) {
    case "PREFLIGHT_PASS":
      if (state.phase !== "PREFLIGHT") throw new Error("WP158_PREFLIGHT_STATE_INVALID");
      return { ...next, phase: "SPAWN" };
    case "SPAWN_REQUEST":
      if (state.phase !== "SPAWN" || state.serverAttempts !== 0 || state.restarts !== 0) throw new Error("WP158_SPAWN_DUPLICATE");
      return { ...next, attempt: 1, serverAttempts: 1, readinessWindows: 1, phase: "PROCESS_RUNNING" };
    case "SPAWN_FAILED":
      if (state.phase !== "SPAWN") throw new Error("WP158_SPAWN_FAIL_STATE_INVALID");
      return { ...next, attempt: 1, serverAttempts: 1, exitSignalFamily: "SPAWN_FAILED", timeoutBoundary: "BEFORE_PROCESS_RUNNING", phase: "TERMINAL" };
    case "LOOPBACK_BOUND":
      if (!["PROCESS_RUNNING", "LOOPBACK_BIND", "READINESS_PROBE"].includes(state.phase)) throw new Error("WP158_BIND_STATE_INVALID");
      if (!BIND_CLASSES.includes(details.loopbackBindClass)) throw new Error("WP158_BIND_CLASS_INVALID");
      return { ...next, phase: "LOOPBACK_BIND", loopbackBindClass: details.loopbackBindClass };
    case "READINESS_PROBE":
      if (!["LOOPBACK_BIND", "READINESS_PROBE"].includes(state.phase)) throw new Error("WP158_PROBE_STATE_INVALID");
      return { ...next, phase: "READINESS_PROBE", ready: details.ready === true && state.loopbackBindClass === "LOOPBACK_BOUND_TO_CHILD" };
    case "READY":
      if (!["LOOPBACK_BIND", "READINESS_PROBE"].includes(state.phase) || state.loopbackBindClass !== "LOOPBACK_BOUND_TO_CHILD") throw new Error("WP158_READY_STATE_INVALID");
      return { ...next, phase: "TERMINAL", ready: true, exitSignalFamily: "PROCESS_STILL_RUNNING_AT_SNAPSHOT", timeoutBoundary: "NO_TIMEOUT" };
    case "PROCESS_EXIT":
      if (!["PROCESS_RUNNING", "LOOPBACK_BIND", "READINESS_PROBE"].includes(state.phase)) throw new Error("WP158_EXIT_STATE_INVALID");
      return { ...next, phase: "TERMINAL", exitSignalFamily: classifyExit(details), timeoutBoundary: "NO_TIMEOUT" };
    case "TIMEOUT":
      if (!["PROCESS_RUNNING", "LOOPBACK_BIND", "READINESS_PROBE"].includes(state.phase)) throw new Error("WP158_TIMEOUT_STATE_INVALID");
      return { ...next, phase: "TERMINAL", exitSignalFamily: "PROCESS_STILL_RUNNING_AT_SNAPSHOT", timeoutBoundary: ["LOOPBACK_BIND", "READINESS_PROBE"].includes(state.phase) ? "AFTER_BIND_BEFORE_READY" : "AFTER_RUNNING_BEFORE_BIND" };
    case "RETRY":
    case "RESTART":
      throw new Error("WP158_RETRY_RESTART_FORBIDDEN");
    default:
      throw new Error(`WP158_EVENT_INVALID:${event}`);
  }
}

async function probeLoopbackBind(host, targetPort, netAdapter = net) {
  return new Promise((resolve) => {
    const socket = netAdapter.createConnection({ host, port: targetPort });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish({ accepting: true, class: "LOOPBACK_ACCEPTING_UNATTRIBUTED" }));
    socket.once("error", () => finish({ accepting: false, class: "LOOPBACK_NOT_OBSERVED" }));
  });
}

async function runDiagnostic({ processAdapter, bindProbe, readinessProbe, clock, maxMs = 30_000 }) {
  let state = initialDiagnosticState();
  state = diagnosticTransition(state, "PREFLIGHT_PASS");
  let processHandle;
  try {
    processHandle = await processAdapter.spawn();
  } catch {
    return diagnosticTransition(state, "SPAWN_FAILED");
  }
  state = diagnosticTransition(state, "SPAWN_REQUEST");
  if (processHandle?.spawnError === true) return diagnosticTransition(state, "PROCESS_EXIT", { spawnError: true });
  const deadline = clock.now() + maxMs;
  while (clock.now() < deadline) {
    if (processHandle.exited) return diagnosticTransition(state, "PROCESS_EXIT", { code: processHandle.code, signal: processHandle.signal, spawnError: processHandle.spawnError === true });
    const bind = await bindProbe();
    if (bind.accepting && state.phase === "PROCESS_RUNNING") state = diagnosticTransition(state, "LOOPBACK_BOUND", { loopbackBindClass: bind.class });
    if (state.phase === "LOOPBACK_BIND" || state.phase === "READINESS_PROBE") {
      const ready = await readinessProbe();
      state = diagnosticTransition(state, "READINESS_PROBE", { ready });
      if (ready && state.loopbackBindClass === "LOOPBACK_BOUND_TO_CHILD") return diagnosticTransition(state, "READY");
    }
    await clock.sleep(100);
  }
  return diagnosticTransition(state, "TIMEOUT");
}

const RECEIPT_KEYS = new Set(["schemaVersion", "workPackage", "status", "diagnostic", "diagnosticDigest", "attemptContract", "quality", "ownership", "sideEffects", "scoreImpact", "cleanup", "snapshotDigest", "rawOutputPersisted", "rawOutputExposed", "sourceEnvContentsRead", "sanitized", "failure", "startedAt", "finishedAt"]);

function validateReceipt(receipt) {
  const required = ["schemaVersion", "workPackage", "status", "diagnostic", "diagnosticDigest", "attemptContract", "quality", "ownership", "sideEffects", "scoreImpact", "rawOutputPersisted", "rawOutputExposed", "sourceEnvContentsRead", "sanitized"];
  for (const key of required) if (!(key in receipt)) throw new Error(`WP158_RECEIPT_MISSING_${key}`);
  for (const key of Object.keys(receipt)) if (!RECEIPT_KEYS.has(key)) throw new Error("WP158_RECEIPT_SCHEMA_UNEXPECTED_KEY");
  if (receipt.schemaVersion !== SCHEMA_VERSION || receipt.workPackage !== WORK_PACKAGE) throw new Error("WP158_RECEIPT_SCHEMA_INVALID");
  if (!["WP158_LOCAL_SERVER_READINESS_VERIFIED", "WP158_EXACT_NO_GO_NO_RETRY_DIAGNOSTIC_CLASSIFIED", "WP158_EXACT_NO_GO_NO_RETRY_DIAGNOSTIC_INCOMPLETE"].includes(receipt.status)) throw new Error("WP158_RECEIPT_STATUS_INVALID");
  const diagnostic = receipt.diagnostic;
  if (!PHASES.includes(diagnostic.phase) || !EXIT_SIGNAL_FAMILIES.includes(diagnostic.exitSignalFamily) || !BIND_CLASSES.includes(diagnostic.loopbackBindClass) || !TIMEOUT_BOUNDARIES.includes(diagnostic.timeoutBoundary) || typeof diagnostic.ready !== "boolean") throw new Error("WP158_RECEIPT_DIAGNOSTIC_ENUM_INVALID");
  if (receipt.attemptContract.serverAttempts > 1 || receipt.attemptContract.readinessWindows > 1 || receipt.attemptContract.retries !== 0 || receipt.attemptContract.restarts !== 0 || receipt.attemptContract.browserCases !== 0) throw new Error("WP158_RECEIPT_EXACTLY_ONCE_INVALID");
  if (receipt.rawOutputPersisted !== false || receipt.rawOutputExposed !== false || receipt.sourceEnvContentsRead !== false || receipt.sanitized !== true) throw new Error("WP158_RECEIPT_SAFETY_INVALID");
  if (Object.values(receipt.sideEffects).some((value) => value !== 0)) throw new Error("WP158_RECEIPT_SIDE_EFFECT_INVALID");
  if (receipt.scoreImpact.CAT06.before !== 7.0 || receipt.scoreImpact.CAT06.after !== 7.0 || receipt.scoreImpact.total.before !== 71.5 || receipt.scoreImpact.total.after !== 71.5) throw new Error("WP158_RECEIPT_SCORE_MUTATION_FORBIDDEN");
  if (typeof receipt.diagnosticDigest !== "string" || !receipt.diagnosticDigest.startsWith("sha256:")) throw new Error("WP158_RECEIPT_DIAGNOSTIC_DIGEST_INVALID");
  return true;
}

function makeReceipt() {
  const diagnostic = { phase: "PREFLIGHT", exitSignalFamily: "NOT_APPLICABLE", loopbackBindClass: "LOOPBACK_NOT_OBSERVED", timeoutBoundary: "NO_TIMEOUT", ready: false };
  return {
    schemaVersion: SCHEMA_VERSION,
    workPackage: WORK_PACKAGE,
    status: "WP158_EXACT_NO_GO_NO_RETRY_DIAGNOSTIC_INCOMPLETE",
    diagnostic,
    diagnosticDigest: canonicalSnapshotDigest(diagnostic),
    attemptContract: { serverAttempts: 0, readinessWindows: 0, retries: 0, restarts: 0, browserCases: 0 },
    quality: { wp157Acceptance: "NOT_RUN", pureRegressions: "NOT_RUN", eslint: "NOT_RUN", typecheck: "NOT_RUN", diffCheck: "NOT_RUN" },
    ownership: { before: protectedDigestSnapshot(), after: null, protectedUnchanged: false, wp155ReceiptImmutable: false, wp156ReceiptImmutable: false, repositoryNextUntouched: false, stagedIndexEmpty: false, unknown: 0, mixedHunks: 0 },
    sideEffects: { network: 0, database: 0, provider: 0, payuni: 0, staging: 0, production: 0, deployment: 0, browser: 0, telemetry: 0, server: 0 },
    scoreImpact: { CAT06: { before: 7.0, after: 7.0 }, total: { before: 71.5, after: 71.5 } },
    cleanup: { classification: "NOT_STARTED", cleanupAttempts: 0, idempotent: true },
    snapshotDigest: null,
    rawOutputPersisted: false,
    rawOutputExposed: false,
    sourceEnvContentsRead: false,
    sanitized: true,
    failure: null,
  };
}

function writeReceipt(targetPath, receipt) {
  validateReceipt(receipt);
  const tempPath = `${targetPath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    const roundTrip = JSON.parse(fs.readFileSync(tempPath, "utf8"));
    validateReceipt(roundTrip);
    fs.renameSync(tempPath, targetPath);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
}

function mapToWp156Diagnostic(diagnostic) {
  const exitSignalFamily = diagnostic.exitSignalFamily === "PROCESS_STILL_RUNNING_AT_SNAPSHOT" ? "PROCESS_STILL_RUNNING" : diagnostic.exitSignalFamily === "NOT_APPLICABLE" ? "NOT_OBSERVED" : diagnostic.exitSignalFamily;
  const loopbackBindClass = ["LOOPBACK_BOUND_TO_CHILD", "LOOPBACK_ACCEPTING_UNATTRIBUTED"].includes(diagnostic.loopbackBindClass) ? "LOOPBACK_ACCEPTING" : diagnostic.loopbackBindClass;
  return { phase: diagnostic.phase, exitSignalFamily, loopbackBindClass, timeoutBoundary: diagnostic.timeoutBoundary, ready: diagnostic.ready };
}

function preflight(receipt) {
  if (runQuiet("git", ["diff", "--cached", "--name-only"], process.env).stdoutBytes > 0) throw new Error("WP158_PREFLIGHT_STAGED_INDEX_NOT_EMPTY");
  const wp157 = JSON.parse(fs.readFileSync(path.join(root, ".ai-team/reports/wp157-wp156-cleanup-receipt-remediation.json"), "utf8"));
  if (wp157.solAcceptance !== "ACCEPT" || wp157.classification !== "WP157_CLEANUP_RECEIPT_CONTRACT_REMEDIATED_READY") throw new Error("WP158_PREFLIGHT_WP157_ACCEPTANCE_INVALID");
  const wp155 = JSON.parse(fs.readFileSync(path.join(root, ".ai-team/reports/wp155-public-unavailable-browser-receipt.json"), "utf8"));
  const wp156 = JSON.parse(fs.readFileSync(path.join(root, ".ai-team/reports/wp156-local-server-readiness-diagnostic-receipt.json"), "utf8"));
  if (wp155.status !== "WP155_EXACT_NO_GO_NO_RETRY" || wp156.workPackage !== "WP-156" || wp156.attemptContract?.serverAttempts !== 1 || wp156.attemptContract?.retries !== 0) throw new Error("WP158_PREFLIGHT_PRESERVED_RECEIPT_INVALID");
  if (!fs.existsSync(path.join(root, "node_modules", "next", "dist", "bin", "next"))) throw new Error("WP158_PREFLIGHT_NEXT_BINARY_MISSING");
  receipt.quality.wp157Acceptance = "ACCEPT";
}

export { BIND_CLASSES, EXIT_SIGNAL_FAMILIES, PHASES, TIMEOUT_BOUNDARIES, canonicalSnapshotDigest, classifyExit, diagnosticTransition, initialDiagnosticState, makeReceipt, mapToWp156Diagnostic, probeLoopbackBind, runDiagnostic, validateReceipt };

export async function main() {
  const receipt = makeReceipt();
  const startedAt = new Date().toISOString();
  receipt.startedAt = startedAt;
  const nextBefore = nextMetadataSnapshot();
  const env = syntheticEnvironment();
  let server;
  const targetPath = path.join(root, ".ai-team", "reports", "wp158-local-server-readiness-diagnostic-receipt.json");
  try {
    preflight(receipt);
    copyMirror();
    const tests = runQuiet(process.execPath, ["--test", "scripts/wp154-wp153-readiness-contract-remediation.test.mjs", "scripts/wp155-public-unavailable-browser-runner.test.mjs", "scripts/wp156-local-server-readiness-diagnostic.test.mjs", "scripts/wp157-wp156-cleanup-receipt-remediation.test.mjs", "scripts/wp158-local-server-readiness-diagnostic.test.mjs"], process.env, root);
    if (tests.exitCode !== 0) throw new Error("WP158_DETERMINISTIC_REGRESSIONS_FAILED");
    receipt.quality.pureRegressions = "WP154_WP155_WP156_WP157_WP158_PURE_TESTS_PASS";
    const eslint = path.join(tempRoot, "node_modules", ".bin", process.platform === "win32" ? "eslint.cmd" : "eslint");
    if (runQuiet(eslint, ["scripts/wp158-local-server-readiness-diagnostic.mjs", "scripts/wp158-local-server-readiness-diagnostic.test.mjs"], env, tempRoot).exitCode !== 0) throw new Error("WP158_SCOPED_ESLINT_FAILED");
    receipt.quality.eslint = "PASS";
    const tsc = path.join(tempRoot, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
    if (runQuiet(tsc, ["--noEmit"], env, tempRoot).exitCode !== 0) throw new Error("WP158_TYPECHECK_FAILED");
    receipt.quality.typecheck = "PASS";
    if (runQuiet("git", ["diff", "--check"], process.env).exitCode !== 0) throw new Error("WP158_DIFF_CHECK_FAILED");
    receipt.quality.diffCheck = "PASS";
    const processHandle = { exited: false, code: null, signal: null, spawnError: false };
    const processAdapter = {
      spawn: async () => {
        server = spawn(process.execPath, [path.join(tempRoot, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: tempRoot, env, windowsHide: true, stdio: "ignore" });
        server.once("error", () => { processHandle.exited = true; processHandle.spawnError = true; });
        server.once("exit", (code, signal) => { processHandle.exited = true; processHandle.code = code; processHandle.signal = signal; });
        return processHandle;
      },
    };
    const clock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
    const diagnostic = await runDiagnostic({
      processAdapter,
      bindProbe: () => probeLoopbackBind("127.0.0.1", port),
      readinessProbe: async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/login`);
          return response.status >= 200 && response.status < 500;
        } catch {
          return false;
        }
      },
      clock,
      maxMs: 30_000,
    });
    receipt.diagnostic = { phase: diagnostic.phase, exitSignalFamily: diagnostic.exitSignalFamily, loopbackBindClass: diagnostic.loopbackBindClass, timeoutBoundary: diagnostic.timeoutBoundary, ready: diagnostic.ready };
    receipt.diagnosticDigest = canonicalSnapshotDigest(receipt.diagnostic);
    receipt.attemptContract.serverAttempts = diagnostic.serverAttempts;
    receipt.attemptContract.readinessWindows = diagnostic.readinessWindows;
    if (diagnostic.exitSignalFamily === "UNKNOWN" || diagnostic.loopbackBindClass === "UNKNOWN" || diagnostic.timeoutBoundary === "UNKNOWN") receipt.status = "WP158_EXACT_NO_GO_NO_RETRY_DIAGNOSTIC_INCOMPLETE";
    else if (diagnostic.ready) receipt.status = "WP158_LOCAL_SERVER_READINESS_VERIFIED";
    else receipt.status = "WP158_EXACT_NO_GO_NO_RETRY_DIAGNOSTIC_CLASSIFIED";
  } catch {
    receipt.status = "WP158_EXACT_NO_GO_NO_RETRY_DIAGNOSTIC_INCOMPLETE";
    receipt.diagnostic = { phase: "TERMINAL", exitSignalFamily: "UNKNOWN", loopbackBindClass: "UNKNOWN", timeoutBoundary: "UNKNOWN", ready: false };
    receipt.diagnosticDigest = canonicalSnapshotDigest(receipt.diagnostic);
    receipt.failure = "WP158_EXACT_NO_GO_NO_RETRY_DIAGNOSTIC_INCOMPLETE";
  } finally {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const coordinator = createCleanupCoordinator({
      snapshot: { ...receipt, diagnostic: mapToWp156Diagnostic(receipt.diagnostic) },
      atomicCommit: () => writeReceipt(targetPath, receipt),
      readback: () => {
        const read = JSON.parse(fs.readFileSync(targetPath, "utf8"));
        return { ...read, diagnostic: mapToWp156Diagnostic(read.diagnostic) };
      },
      quiesceProcess: () => {
        if (!server?.pid) return;
        if (process.platform === "win32") runQuiet("taskkill", ["/PID", String(server.pid), "/T", "/F"], process.env);
        else server.kill("SIGTERM");
      },
      closeStreams: () => undefined,
      releaseHandles: () => undefined,
      removeRuntime: () => {
        if (!fs.existsSync(tempRoot)) return;
        const resolvedTemp = path.resolve(tempRoot);
        const resolvedTmp = path.resolve(os.tmpdir());
        if (!resolvedTemp.startsWith(`${resolvedTmp}${path.sep}`)) throw new Error("WP158_TEMP_ROOT_BOUNDARY_INVALID");
        fs.rmSync(resolvedTemp, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      },
      writeFinalEnvelope: (envelope) => {
        receipt.cleanup = { classification: envelope.classification, cleanupAttempts: envelope.cleanupAttempts, idempotent: envelope.idempotent };
        receipt.snapshotDigest = envelope.snapshotDigest;
        writeReceipt(targetPath, receipt);
      },
    });
    const cleanup = coordinator.run();
    receipt.cleanup = { classification: cleanup.classification, cleanupAttempts: cleanup.cleanupAttempts, idempotent: cleanup.idempotent };
    receipt.snapshotDigest = cleanup.snapshotDigest;
    receipt.ownership.after = protectedDigestSnapshot();
    receipt.ownership.protectedUnchanged = JSON.stringify(receipt.ownership.before) === JSON.stringify(receipt.ownership.after);
    receipt.ownership.wp155ReceiptImmutable = receipt.ownership.before[".ai-team/reports/wp155-public-unavailable-browser-receipt.json"] === receipt.ownership.after[".ai-team/reports/wp155-public-unavailable-browser-receipt.json"];
    receipt.ownership.wp156ReceiptImmutable = receipt.ownership.before[".ai-team/reports/wp156-local-server-readiness-diagnostic-receipt.json"] === receipt.ownership.after[".ai-team/reports/wp156-local-server-readiness-diagnostic-receipt.json"];
    receipt.ownership.repositoryNextUntouched = JSON.stringify(nextBefore) === JSON.stringify(nextMetadataSnapshot());
    receipt.ownership.stagedIndexEmpty = runQuiet("git", ["diff", "--cached", "--name-only"], process.env).stdoutBytes === 0;
    receipt.finishedAt = new Date().toISOString();
    writeReceipt(targetPath, receipt);
    process.stdout.write(`${JSON.stringify({ status: receipt.status, phase: receipt.diagnostic.phase, exitSignalFamily: receipt.diagnostic.exitSignalFamily, loopbackBindClass: receipt.diagnostic.loopbackBindClass, timeoutBoundary: receipt.diagnostic.timeoutBoundary, serverAttempts: receipt.attemptContract.serverAttempts, readinessWindows: receipt.attemptContract.readinessWindows, retries: receipt.attemptContract.retries, restarts: receipt.attemptContract.restarts, rawOutputPersisted: receipt.rawOutputPersisted })}\n`);
  }
  if (receipt.status === "WP158_EXACT_NO_GO_NO_RETRY_DIAGNOSTIC_INCOMPLETE") process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();
