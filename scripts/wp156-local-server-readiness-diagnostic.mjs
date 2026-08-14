import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK_PACKAGE = "WP-156";
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
const nonce = crypto.randomBytes(4).toString("hex");
const tempRoot = path.join(os.tmpdir(), `celebratedeal-wp156-${runId}-${nonce}`);
const port = 32156 + Number.parseInt(nonce.slice(0, 2), 16) % 100;
const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=wp156_${runId}_${nonce}`;

const PHASES = Object.freeze(["PREFLIGHT", "SPAWN", "PROCESS_RUNNING", "LOOPBACK_BIND", "READINESS_PROBE", "TERMINAL"]);
const EXIT_SIGNAL_FAMILIES = Object.freeze(["PROCESS_STILL_RUNNING", "NORMAL_EXIT_BEFORE_READY", "NONZERO_EXIT_BEFORE_READY", "SIGNALLED_BEFORE_READY", "SPAWN_FAILED", "NOT_OBSERVED", "UNKNOWN"]);
const BIND_CLASSES = Object.freeze(["LOOPBACK_ACCEPTING", "LOOPBACK_NOT_OBSERVED", "NON_LOOPBACK_REJECTED", "PORT_CONFLICT", "UNKNOWN"]);
const TIMEOUT_BOUNDARIES = Object.freeze(["NO_TIMEOUT", "BEFORE_PROCESS_RUNNING", "AFTER_RUNNING_BEFORE_BIND", "AFTER_BIND_BEFORE_READY", "UNKNOWN"]);
const CLEANUP_CLASSES = Object.freeze(["CLEANUP_PASS", "WINDOWS_EBUSY_RECOVERED", "WINDOWS_EBUSY_RETRY_EXHAUSTED", "NON_EBUSY_CLEANUP_FAILED", "DIAGNOSTIC_SNAPSHOT_WRITE_FAILED", "FINAL_ENVELOPE_WRITE_FAILED"]);

const protectedPaths = [
  ".ai-team/reports/wp155-public-unavailable-browser-receipt.json",
  ".ai-team/reports/wp154-wp153-readiness-contract-remediation.json",
  ".ai-team/reports/wp153-public-unavailable-browser-receipt.json",
  ".ai-team/reports/wp152-wp151-fixture-contract-remediation.json",
  "docs/ai-team/evidence/wp-155-public-unavailable-browser.md",
  "scripts/wp155-public-unavailable-browser-runner.mjs",
  "scripts/wp155-public-unavailable-browser-runner.test.mjs",
  "scripts/wp154-wp153-readiness-contract-remediation.test.mjs",
  "tests/e2e/wp128-public-partner-unavailable-state.spec.ts",
  "src/components/team-funnel-public-page.tsx",
  "src/components/team-funnel-public-page.test.tsx",
  "package.json",
  "package-lock.json",
];

export function runQuiet(command, args, environment, cwd = root) {
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

export function syntheticEnvironment() {
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
    CSRF_SECRET: "wp156-local-csrf-synthetic-value",
    JOB_SECRET: "wp156-local-job-synthetic-value",
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

export function nextMetadataSnapshot() {
  const target = path.join(root, ".next");
  if (!fs.existsSync(target)) return { exists: false, size: 0, mtimeMs: null };
  const stat = fs.statSync(target);
  return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs };
}

function classifyExit({ code = null, signal = null, spawnError = false, running = false } = {}) {
  if (spawnError) return "SPAWN_FAILED";
  if (running) return "PROCESS_STILL_RUNNING";
  if (signal) return "SIGNALLED_BEFORE_READY";
  if (typeof code === "number") return code === 0 ? "NORMAL_EXIT_BEFORE_READY" : "NONZERO_EXIT_BEFORE_READY";
  return "NOT_OBSERVED";
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
    exitSignalFamily: "NOT_OBSERVED",
    loopbackBindClass: "LOOPBACK_NOT_OBSERVED",
    timeoutBoundary: "NO_TIMEOUT",
    ready: false,
    events: [],
  };
}

function diagnosticTransition(state, event, details = {}) {
  if (!state || !PHASES.includes(state.phase)) throw new Error("DIAGNOSTIC_STATE_INVALID");
  if (state.phase === "TERMINAL") return { ...state, events: [...state.events, `IGNORED:${event}`] };
  const next = { ...state, events: [...state.events, event] };
  switch (event) {
    case "PREFLIGHT_PASS":
      if (state.phase !== "PREFLIGHT") throw new Error("DIAGNOSTIC_PREFLIGHT_STATE_INVALID");
      return { ...next, phase: "SPAWN" };
    case "SPAWN_REQUEST":
      if (state.phase !== "SPAWN" || state.serverAttempts !== 0 || state.restarts !== 0) throw new Error("DIAGNOSTIC_SPAWN_DUPLICATE");
      return { ...next, attempt: 1, serverAttempts: 1, readinessWindows: 1, phase: "PROCESS_RUNNING" };
    case "SPAWN_FAILED":
      if (state.phase !== "SPAWN") throw new Error("DIAGNOSTIC_SPAWN_FAIL_STATE_INVALID");
      return { ...next, attempt: 1, serverAttempts: 1, exitSignalFamily: "SPAWN_FAILED", timeoutBoundary: "BEFORE_PROCESS_RUNNING", phase: "TERMINAL" };
    case "LOOPBACK_BOUND":
      if (state.phase !== "PROCESS_RUNNING") throw new Error("DIAGNOSTIC_BIND_STATE_INVALID");
      return { ...next, phase: "LOOPBACK_BIND", loopbackBindClass: details.loopbackBindClass ?? "UNKNOWN" };
    case "READINESS_PROBE":
      if (!["PROCESS_RUNNING", "LOOPBACK_BIND", "READINESS_PROBE"].includes(state.phase)) throw new Error("DIAGNOSTIC_PROBE_STATE_INVALID");
      return { ...next, phase: "READINESS_PROBE", ready: details.ready === true };
    case "READY":
      if (!["LOOPBACK_BIND", "READINESS_PROBE"].includes(state.phase)) throw new Error("DIAGNOSTIC_READY_STATE_INVALID");
      return { ...next, phase: "TERMINAL", ready: true, exitSignalFamily: "PROCESS_STILL_RUNNING", timeoutBoundary: "NO_TIMEOUT" };
    case "PROCESS_EXIT":
      if (!["PROCESS_RUNNING", "LOOPBACK_BIND", "READINESS_PROBE"].includes(state.phase)) throw new Error("DIAGNOSTIC_EXIT_STATE_INVALID");
      return { ...next, phase: "TERMINAL", exitSignalFamily: classifyExit(details), timeoutBoundary: "NO_TIMEOUT" };
    case "TIMEOUT":
      if (!["PROCESS_RUNNING", "LOOPBACK_BIND", "READINESS_PROBE"].includes(state.phase)) throw new Error("DIAGNOSTIC_TIMEOUT_STATE_INVALID");
      return { ...next, phase: "TERMINAL", exitSignalFamily: "PROCESS_STILL_RUNNING", timeoutBoundary: state.phase === "LOOPBACK_BIND" || state.phase === "READINESS_PROBE" ? "AFTER_BIND_BEFORE_READY" : "AFTER_RUNNING_BEFORE_BIND" };
    case "RETRY":
    case "RESTART":
      throw new Error("DIAGNOSTIC_RETRY_RESTART_FORBIDDEN");
    default:
      throw new Error(`DIAGNOSTIC_EVENT_INVALID:${event}`);
  }
}

export async function probeLoopbackBind(host, targetPort, netAdapter = net) {
  return new Promise((resolve) => {
    const socket = netAdapter.createConnection({ host, port: targetPort });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish({ accepting: true, class: "LOOPBACK_ACCEPTING" }));
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
  const deadline = clock.now() + maxMs;
  while (clock.now() < deadline) {
    if (processHandle.exited) return diagnosticTransition(state, "PROCESS_EXIT", { code: processHandle.code, signal: processHandle.signal, spawnError: processHandle.spawnError === true });
    const bind = await bindProbe();
    if (bind.accepting && state.phase === "PROCESS_RUNNING") state = diagnosticTransition(state, "LOOPBACK_BOUND", { loopbackBindClass: bind.class });
    if (state.phase === "LOOPBACK_BIND" || state.phase === "READINESS_PROBE") {
      const ready = await readinessProbe();
      state = diagnosticTransition(state, "READINESS_PROBE", { ready });
      if (ready) return diagnosticTransition(state, "READY");
    }
    await clock.sleep(100);
  }
  return diagnosticTransition(state, "TIMEOUT");
}

const RECEIPT_KEYS = new Set(["schemaVersion", "workPackage", "status", "diagnostic", "attemptContract", "quality", "ownership", "sideEffects", "scoreImpact", "cleanup", "snapshotDigest", "rawOutputPersisted", "rawOutputExposed", "sourceEnvContentsRead", "sanitized", "failure", "startedAt", "finishedAt"]);

function validateReceipt(receipt) {
  const required = ["schemaVersion", "workPackage", "status", "diagnostic", "attemptContract", "quality", "ownership", "sideEffects", "scoreImpact", "rawOutputPersisted", "rawOutputExposed", "sourceEnvContentsRead", "sanitized"];
  for (const key of required) if (!(key in receipt)) throw new Error(`RECEIPT_MISSING_${key}`);
  for (const key of Object.keys(receipt)) if (!RECEIPT_KEYS.has(key)) throw new Error("RECEIPT_SCHEMA_UNEXPECTED_KEY");
  if (receipt.schemaVersion !== "wp156-local-server-readiness-diagnostic/v1" || receipt.workPackage !== WORK_PACKAGE) throw new Error("RECEIPT_SCHEMA_INVALID");
  if (!["WP156_LOCAL_SERVER_READINESS_VERIFIED", "WP156_EXACT_NO_GO_NO_RETRY_DIAGNOSTIC_CLASSIFIED", "WP156_EXACT_NO_GO_NO_RETRY_DIAGNOSTIC_INCOMPLETE"].includes(receipt.status)) throw new Error("RECEIPT_STATUS_INVALID");
  if (!PHASES.includes(receipt.diagnostic.phase) || !EXIT_SIGNAL_FAMILIES.includes(receipt.diagnostic.exitSignalFamily) || !BIND_CLASSES.includes(receipt.diagnostic.loopbackBindClass) || !TIMEOUT_BOUNDARIES.includes(receipt.diagnostic.timeoutBoundary)) throw new Error("RECEIPT_DIAGNOSTIC_ENUM_INVALID");
  if (receipt.attemptContract.serverAttempts > 1 || receipt.attemptContract.readinessWindows > 1 || receipt.attemptContract.retries !== 0 || receipt.attemptContract.restarts !== 0 || receipt.attemptContract.browserCases !== 0) throw new Error("RECEIPT_EXACTLY_ONCE_INVALID");
  if (receipt.rawOutputPersisted !== false || receipt.rawOutputExposed !== false || receipt.sourceEnvContentsRead !== false || receipt.sanitized !== true) throw new Error("RECEIPT_SAFETY_INVALID");
  if (Object.values(receipt.sideEffects).some((value) => value !== 0)) throw new Error("RECEIPT_SIDE_EFFECT_INVALID");
  if (receipt.scoreImpact.CAT06.after !== 7.0 || receipt.scoreImpact.total.after !== 71.5) throw new Error("RECEIPT_SCORE_MUTATION_FORBIDDEN");
  return true;
}

function makeReceipt() {
  return {
    schemaVersion: "wp156-local-server-readiness-diagnostic/v1",
    workPackage: WORK_PACKAGE,
    status: "WP156_EXACT_NO_GO_NO_RETRY_DIAGNOSTIC_INCOMPLETE",
    diagnostic: { phase: "PREFLIGHT", exitSignalFamily: "NOT_OBSERVED", loopbackBindClass: "LOOPBACK_NOT_OBSERVED", timeoutBoundary: "NO_TIMEOUT", ready: false },
    attemptContract: { serverAttempts: 0, readinessWindows: 0, retries: 0, restarts: 0, browserCases: 0 },
    quality: { wp155Terminal: "NOT_RUN", wp154Acceptance: "NOT_RUN", pureRegressions: "NOT_RUN", eslint: "NOT_RUN", typecheck: "NOT_RUN", diffCheck: "NOT_RUN" },
    ownership: { before: protectedDigestSnapshot(), after: null, protectedUnchanged: false, wp155ReceiptImmutable: false, repositoryNextUntouched: false, stagedIndexEmpty: false, unknown: 0, mixedHunks: 0 },
    sideEffects: { network: 0, database: 0, provider: 0, payuni: 0, staging: 0, production: 0, deployment: 0, browser: 0, telemetry: 0, server: 0 },
    scoreImpact: { CAT06: { before: 7.0, after: 7.0 }, total: { before: 71.5, after: 71.5 } },
    cleanup: { classification: "NOT_STARTED", cleanupAttempts: 0, idempotent: true },
    snapshotDigest: null,
    rawOutputPersisted: false,
    rawOutputExposed: false,
    sourceEnvContentsRead: false,
    sanitized: true,
  };
}

export function writeReceipt(targetPath, receipt) {
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

function canonicalSnapshotDigest(snapshot) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}`;
}

function validateDiagnosticSnapshot(snapshot) {
  const allowed = new Set(["phase", "exitSignalFamily", "loopbackBindClass", "timeoutBoundary", "ready"]);
  if (!snapshot || Object.keys(snapshot).some((key) => !allowed.has(key))) throw new Error("DIAGNOSTIC_SNAPSHOT_SAFETY_INVALID");
  if (!PHASES.includes(snapshot.phase) || !EXIT_SIGNAL_FAMILIES.includes(snapshot.exitSignalFamily) || !BIND_CLASSES.includes(snapshot.loopbackBindClass) || !TIMEOUT_BOUNDARIES.includes(snapshot.timeoutBoundary) || typeof snapshot.ready !== "boolean") throw new Error("DIAGNOSTIC_SNAPSHOT_ENUM_INVALID");
  return true;
}

function runCleanupReceiptContract({ snapshot, atomicCommit, readback, quiesceProcess, closeStreams, releaseHandles, removeRuntime, writeFinalEnvelope, maxAttempts = 3 }) {
  let terminal;
  let snapshotDigest;
  let cleanupAttempts = 0;
  const events = [];
  const result = () => terminal;
  if (typeof atomicCommit !== "function" || typeof readback !== "function" || typeof quiesceProcess !== "function" || typeof closeStreams !== "function" || typeof releaseHandles !== "function" || typeof removeRuntime !== "function" || typeof writeFinalEnvelope !== "function") throw new Error("CLEANUP_ADAPTER_REQUIRED");
  if (terminal) return result();
  try {
    validateDiagnosticSnapshot(snapshot.diagnostic);
    events.push("SNAPSHOT_VALIDATE");
    snapshotDigest = canonicalSnapshotDigest(snapshot);
    atomicCommit(snapshot);
    events.push("SNAPSHOT_ATOMIC_COMMIT");
    const committed = readback();
    validateDiagnosticSnapshot(committed.diagnostic);
    events.push("SNAPSHOT_READBACK");
  } catch {
    terminal = { classification: "DIAGNOSTIC_SNAPSHOT_WRITE_FAILED", cleanupAttempts: 0, snapshotDigest: null, events: [...events, "SNAPSHOT_WRITE_FAILED"], idempotent: true };
    try { quiesceProcess(); events.push("PROCESS_QUIESCED"); } catch { /* sanitized fail-closed result remains */ }
    try { closeStreams(); events.push("STREAMS_CLOSED"); } catch { /* sanitized fail-closed result remains */ }
    try { releaseHandles(); events.push("HANDLES_RELEASED"); } catch { /* sanitized fail-closed result remains */ }
    return terminal;
  }
  quiesceProcess();
  events.push("PROCESS_QUIESCED");
  closeStreams();
  events.push("STREAMS_CLOSED");
  releaseHandles();
  events.push("HANDLES_RELEASED");
  let classification = "CLEANUP_PASS";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    cleanupAttempts = attempt;
    try {
      removeRuntime();
      events.push(`CLEANUP_ATTEMPT_${attempt}`);
      classification = attempt === 1 ? "CLEANUP_PASS" : "WINDOWS_EBUSY_RECOVERED";
      break;
    } catch (error) {
      if (error?.code === "EBUSY") {
        if (attempt === maxAttempts) classification = "WINDOWS_EBUSY_RETRY_EXHAUSTED";
        else continue;
      } else {
        classification = "NON_EBUSY_CLEANUP_FAILED";
        break;
      }
    }
  }
  const envelope = { classification, cleanupAttempts, snapshotDigest, events, idempotent: true };
  try {
    writeFinalEnvelope(envelope);
    events.push("FINAL_ENVELOPE_COMMITTED");
  } catch {
    terminal = { classification: "FINAL_ENVELOPE_WRITE_FAILED", cleanupAttempts, snapshotDigest, events: [...events, "FINAL_ENVELOPE_WRITE_FAILED"], idempotent: true };
    return terminal;
  }
  terminal = { ...envelope, events: [...events] };
  return terminal;
}

function createCleanupCoordinator(options) {
  let terminal;
  return {
    run() {
      if (terminal) return terminal;
      terminal = runCleanupReceiptContract(options);
      return terminal;
    },
  };
}

export function preflight(receipt) {
  if (runQuiet("git", ["diff", "--cached", "--name-only"], process.env).stdoutBytes > 0) throw new Error("PREFLIGHT_STAGED_INDEX_NOT_EMPTY");
  const wp155 = JSON.parse(fs.readFileSync(path.join(root, ".ai-team/reports/wp155-public-unavailable-browser-receipt.json"), "utf8"));
  if (wp155.status !== "WP155_EXACT_NO_GO_NO_RETRY" || wp155.attempt !== 1 || wp155.server?.ready !== false || wp155.browser?.desktop?.passed !== 0 || wp155.browser?.mobile390?.passed !== 0) throw new Error("PREFLIGHT_WP155_TERMINAL_INVALID");
  const wp154 = JSON.parse(fs.readFileSync(path.join(root, ".ai-team/reports/wp154-wp153-readiness-contract-remediation.json"), "utf8"));
  if (wp154.solAcceptance !== "ACCEPT" || wp154.classification !== "WP154_WP153_READINESS_CONTRACT_REMEDIATED_READY") throw new Error("PREFLIGHT_WP154_ACCEPTANCE_INVALID");
  if (!fs.existsSync(path.join(root, "node_modules", "next", "dist", "bin", "next"))) throw new Error("PREFLIGHT_NEXT_BINARY_MISSING");
  receipt.quality.wp155Terminal = "PRESERVE_ONLY_TERMINAL";
  receipt.quality.wp154Acceptance = "ACCEPT";
}

export { BIND_CLASSES, CLEANUP_CLASSES, EXIT_SIGNAL_FAMILIES, PHASES, TIMEOUT_BOUNDARIES, canonicalSnapshotDigest, classifyExit, createCleanupCoordinator, diagnosticTransition, initialDiagnosticState, makeReceipt, runCleanupReceiptContract, runDiagnostic, validateDiagnosticSnapshot, validateReceipt };

export async function main() {
  const receipt = makeReceipt();
  const startedAt = new Date().toISOString();
  const nextBefore = nextMetadataSnapshot();
  const env = syntheticEnvironment();
  let server;
  try {
    preflight(receipt);
    copyMirror();
    const tests = runQuiet(process.execPath, ["--test", "scripts/wp154-wp153-readiness-contract-remediation.test.mjs", "scripts/wp155-public-unavailable-browser-runner.test.mjs", "scripts/wp156-local-server-readiness-diagnostic.test.mjs"], process.env, root);
    if (tests.exitCode !== 0) throw new Error("DETERMINISTIC_REGRESSIONS_FAILED");
    receipt.quality.pureRegressions = "WP154_WP155_WP156_PURE_TESTS_PASS";
    const eslint = path.join(tempRoot, "node_modules", ".bin", process.platform === "win32" ? "eslint.cmd" : "eslint");
    if (runQuiet(eslint, ["scripts/wp156-local-server-readiness-diagnostic.mjs", "scripts/wp156-local-server-readiness-diagnostic.test.mjs"], env, tempRoot).exitCode !== 0) throw new Error("SCOPED_ESLINT_FAILED");
    receipt.quality.eslint = "PASS";
    const tsc = path.join(tempRoot, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
    if (runQuiet(tsc, ["--noEmit"], env, tempRoot).exitCode !== 0) throw new Error("TYPECHECK_FAILED");
    receipt.quality.typecheck = "PASS";
    if (runQuiet("git", ["diff", "--check"], process.env).exitCode !== 0) throw new Error("DIFF_CHECK_FAILED");
    receipt.quality.diffCheck = "PASS";
    server = spawn(process.execPath, [path.join(tempRoot, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: tempRoot, env, windowsHide: true, stdio: "ignore" });
    const processHandle = { exited: false, code: null, signal: null };
    server.once("error", () => { processHandle.exited = true; processHandle.spawnError = true; });
    server.once("exit", (code, signal) => { processHandle.exited = true; processHandle.code = code; processHandle.signal = signal; });
    const clock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
    const diagnostic = await runDiagnostic({
      processAdapter: { spawn: async () => processHandle },
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
    receipt.attemptContract.serverAttempts = diagnostic.serverAttempts;
    receipt.attemptContract.readinessWindows = diagnostic.readinessWindows;
    if (diagnostic.exitSignalFamily === "UNKNOWN" || diagnostic.loopbackBindClass === "UNKNOWN" || diagnostic.timeoutBoundary === "UNKNOWN") receipt.status = "WP156_EXACT_NO_GO_NO_RETRY_DIAGNOSTIC_INCOMPLETE";
    else if (diagnostic.ready) receipt.status = "WP156_LOCAL_SERVER_READINESS_VERIFIED";
    else receipt.status = "WP156_EXACT_NO_GO_NO_RETRY_DIAGNOSTIC_CLASSIFIED";
  } catch (error) {
    receipt.status = "WP156_EXACT_NO_GO_NO_RETRY_DIAGNOSTIC_INCOMPLETE";
    receipt.diagnostic = { phase: "TERMINAL", exitSignalFamily: "UNKNOWN", loopbackBindClass: "UNKNOWN", timeoutBoundary: "UNKNOWN", ready: false };
    receipt.failure = error instanceof Error ? "WP156_EXACT_NO_GO_NO_RETRY_DIAGNOSTIC_INCOMPLETE" : "WP156_EXACT_NO_GO_NO_RETRY_DIAGNOSTIC_INCOMPLETE";
  } finally {
    if (server?.pid) {
      if (process.platform === "win32") runQuiet("taskkill", ["/PID", String(server.pid), "/T", "/F"], process.env);
      else server.kill("SIGTERM");
    }
    receipt.finishedAt = new Date().toISOString();
    receipt.startedAt = startedAt;
    const targetPath = path.join(root, ".ai-team", "reports", "wp156-local-server-readiness-diagnostic-receipt.json");
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const coordinator = createCleanupCoordinator({
      snapshot: receipt,
      atomicCommit: (snapshot) => writeReceipt(targetPath, snapshot),
      readback: () => JSON.parse(fs.readFileSync(targetPath, "utf8")),
      quiesceProcess: () => undefined,
      closeStreams: () => undefined,
      releaseHandles: () => undefined,
      removeRuntime: () => {
        if (!fs.existsSync(tempRoot)) return;
        if (!path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()))) throw new Error("TEMP_ROOT_BOUNDARY_INVALID");
        fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
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
    receipt.ownership.repositoryNextUntouched = JSON.stringify(nextBefore) === JSON.stringify(nextMetadataSnapshot());
    receipt.ownership.stagedIndexEmpty = runQuiet("git", ["diff", "--cached", "--name-only"], process.env).stdoutBytes === 0;
    writeReceipt(targetPath, receipt);
    process.stdout.write(`${JSON.stringify({ status: receipt.status, phase: receipt.diagnostic.phase, exitSignalFamily: receipt.diagnostic.exitSignalFamily, loopbackBindClass: receipt.diagnostic.loopbackBindClass, timeoutBoundary: receipt.diagnostic.timeoutBoundary, serverAttempts: receipt.attemptContract.serverAttempts, readinessWindows: receipt.attemptContract.readinessWindows, rawOutputPersisted: receipt.rawOutputPersisted })}\n`);
  }
  if (receipt.status === "WP156_EXACT_NO_GO_NO_RETRY_DIAGNOSTIC_INCOMPLETE") process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();
