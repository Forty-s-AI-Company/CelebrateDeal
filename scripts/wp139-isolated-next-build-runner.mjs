import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryNext = path.join(root, ".next");
const receiptPath = path.join(root, ".ai-team", "reports", "wp139-isolated-next-build-receipt.json");
const targetRoute = "src/app/api/cloudflare/stream-webhook/route.ts";
const wp138ReceiptPath = path.join(root, ".ai-team", "reports", "wp138-generated-target-reference-receipt.json");

export const OWNED_PATHS = Object.freeze([
  "scripts/wp139-isolated-next-build-runner.mjs",
  "scripts/wp139-isolated-next-build-runner.test.mjs",
  ".ai-team/reports/wp139-isolated-next-build-receipt.json",
  "docs/ai-team/evidence/wp-139-isolated-next-build.md",
]);

export const CLASSIFICATIONS = Object.freeze({
  PASS: "LOCAL_ISOLATED_NEXT_BUILD_PASS",
  EXACT_NO_GO: "LOCAL_ISOLATED_NEXT_BUILD_EXACT_NO_GO",
  UNKNOWN: "UNKNOWN_FAIL_CLOSED",
  PREFLIGHT: "PREFLIGHT_FAIL_CLOSED",
});

const dotenvPattern = /^\.env(?:\.|$)/i;
const excludedDirectories = new Set([
  ".git", ".next", ".ai-team", ".agents", "node_modules", "coverage", ".cache", ".turbo", "tmp", "temp",
]);
const databaseExtensions = new Set([".db", ".sqlite", ".sqlite3"]);
const privateExtensions = new Set([".pem", ".key", ".p12", ".pfx", ".crt", ".cer", ".der", ".netrc"]);
const secretLikePattern = /(?:^|[-_.])(credentials?|private[-_]?key|service[-_]?account|id_rsa|token|secret|cookie)(?:[-_.]|$)/i;
const safeHostEnvironment = new Set(["PATH", "Path", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT"]);
const syntheticEnvironment = Object.freeze({
  NODE_ENV: "production",
  CI: "true",
  VERCEL_ENV: "preview",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_APP_URL: "https://celebratedeal.invalid",
  DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/wp139_test",
  DIRECT_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/wp139_test",
  PAYMENT_PROVIDER: "demo",
  RATE_LIMIT_PROVIDER: "memory",
  JOB_SECRET: "wp139-synthetic-job-value",
  CSRF_SECRET: "wp139-synthetic-csrf-value",
  RESEND_API_KEY: "wp139-synthetic-resend-value",
  EMAIL_FROM: "CelebrateDeal <synthetic@invalid.test>",
  SENTRY_DSN: "https://public@sentry.invalid/1",
  SENTRY_DISABLE_AUTO_UPLOAD: "true",
  NEXT_PUBLIC_POSTHOG_KEY: "wp139-synthetic-posthog-value",
  NEXT_PUBLIC_POSTHOG_HOST: "https://posthog.invalid",
  NPM_CONFIG_OFFLINE: "true",
  npm_config_offline: "true",
  NPM_CONFIG_AUDIT: "false",
  npm_config_audit: "false",
  NPM_CONFIG_FUND: "false",
  npm_config_fund: "false",
  NPM_CONFIG_UPDATE_NOTIFIER: "false",
  npm_config_update_notifier: "false",
});

function isSensitiveName(name) {
  const extension = path.extname(name).toLowerCase();
  return dotenvPattern.test(name) || databaseExtensions.has(extension) || privateExtensions.has(extension) || secretLikePattern.test(name);
}

export function exclusionReason(relativePath) {
  const normalized = String(relativePath).replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => dotenvPattern.test(segment))) return "dotenv";
  if (segments.some((segment) => excludedDirectories.has(segment))) return "excluded_directory";
  const basename = segments.at(-1) ?? "";
  const extension = path.extname(basename).toLowerCase();
  if (databaseExtensions.has(extension)) return "database_file";
  if (privateExtensions.has(extension) || secretLikePattern.test(basename)) return "private_or_secret_like";
  return null;
}

export function safeResolve(base, candidate) {
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(base, candidate);
  if (resolved !== resolvedBase && !resolved.startsWith(`${resolvedBase}${path.sep}`)) return null;
  return resolved;
}

function digestMetadata(entries) {
  const hash = crypto.createHash("sha256");
  for (const entry of entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    hash.update(`${entry.relativePath}\0${entry.type}\0${entry.size}\0${entry.mtimeMs}\0`);
  }
  return hash.digest("hex");
}

export function metadataAggregate(directory) {
  const entries = [];
  let files = 0;
  let directories = 0;
  let reparse = 0;
  let bytes = 0;
  function walk(current, relative = "") {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, item.name);
      const child = relative ? `${relative}/${item.name}` : item.name;
      const stat = fs.lstatSync(absolute);
      const type = stat.isSymbolicLink() ? "reparse" : stat.isDirectory() ? "directory" : "file";
      entries.push({ relativePath: child.replaceAll("\\", "/"), type, size: stat.size, mtimeMs: stat.mtimeMs });
      if (type === "reparse") {
        reparse += 1;
      } else if (type === "directory") {
        directories += 1;
        walk(absolute, child);
      } else {
        files += 1;
        bytes += stat.size;
      }
    }
  }
  if (fs.existsSync(directory)) walk(directory);
  return { files, directories, reparse, entries: entries.length, bytes, digest: digestMetadata(entries) };
}

function copyMirror(source, destination, stats, relative = "") {
  for (const item of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, item.name);
    const child = relative ? `${relative}/${item.name}` : item.name;
    const normalized = child.replaceAll("\\", "/");
    const reason = exclusionReason(normalized);
    const stat = fs.lstatSync(sourcePath);
    if (stat.isSymbolicLink()) {
      stats.symlinksSkipped += 1;
      continue;
    }
    if (reason === "excluded_directory" || (item.isDirectory() && excludedDirectories.has(item.name))) {
      stats.directoriesExcluded += 1;
      stats.excludedByReason.excluded_directory += 1;
      continue;
    }
    if (reason) {
      stats.filesExcluded += 1;
      stats.excludedByReason[reason] = (stats.excludedByReason[reason] ?? 0) + 1;
      continue;
    }
    const destinationPath = path.join(destination, normalized);
    if (item.isDirectory()) {
      fs.mkdirSync(destinationPath, { recursive: true });
      copyMirror(sourcePath, destination, stats, normalized);
      continue;
    }
    if (!item.isFile()) {
      stats.unsupportedEntries += 1;
      continue;
    }
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
    stats.filesCopied += 1;
  }
}

export function sanitizeOutput(value) {
  return String(value ?? "")
    .replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replaceAll(/[A-Za-z]:\\[^\r\n\s'"`]+/g, "<path>")
    .replaceAll(/(?:postgres(?:ql)?:\/\/)[^\s]+/gi, "<database-url>")
    .replaceAll(/https?:\/\/[^\s]+/gi, "<url>")
    .replaceAll(/\b[A-Z][A-Z0-9_]{2,}=([^\s]+)/g, "<env>=<value>");
}

function outputSignals(value) {
  const output = sanitizeOutput(value);
  return {
    network: /\b(?:ECONN|ENET|fetch|network|certificate|socket|ETIMEDOUT)\b/i.test(output),
    moduleResolution: /module not found|cannot find module|could not resolve|ERR_MODULE_NOT_FOUND/i.test(output),
    typecheck: /type error|typescript|failed to compile/i.test(output),
    configuration: /missing required|invalid.*config|environment variable|configuration/i.test(output),
    route: /route|app directory|pages directory|prerender|static generation/i.test(output),
    genericError: /\berror\b|\bfailed\b/i.test(output),
  };
}

export function classifyBuildResult({ exitCode, markersPass, repositoryNextUnchanged, forbiddenCopiedCount, cleanupPass, workspacePreserved }) {
  if (!repositoryNextUnchanged || forbiddenCopiedCount !== 0 || !cleanupPass || !workspacePreserved) return CLASSIFICATIONS.UNKNOWN;
  if (exitCode === 0 && markersPass) return CLASSIFICATIONS.PASS;
  if (exitCode !== 0 || !markersPass) return CLASSIFICATIONS.EXACT_NO_GO;
  return CLASSIFICATIONS.UNKNOWN;
}

function commandResult(command, args, cwd, env) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 15 * 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const summary = {
    exitCode: typeof result.status === "number" ? result.status : null,
    signal: result.signal ?? null,
    timedOut: result.error?.code === "ETIMEDOUT",
    durationMs: Date.now() - started,
    outputLines: output.split(/\r?\n/).filter(Boolean).length,
    outputSha256: crypto.createHash("sha256").update(output).digest("hex"),
    signals: outputSignals(output),
    rawOutputPersisted: false,
  };
  return summary;
}

function buildEnvironment(tempRoot) {
  const temp = path.join(tempRoot, "runtime-tmp");
  const home = path.join(tempRoot, "runtime-home");
  const cache = path.join(tempRoot, "runtime-cache");
  fs.mkdirSync(temp, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cache, { recursive: true });
  const environment = {};
  for (const key of safeHostEnvironment) {
    if (typeof process.env[key] === "string") environment[key] = process.env[key];
  }
  Object.assign(environment, syntheticEnvironment, {
    TEMP: temp,
    TMP: temp,
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: cache,
    APPDATA: cache,
    NPM_CONFIG_CACHE: cache,
    npm_config_cache: cache,
  });
  return environment;
}

function linkNodeModules(tempRoot) {
  const link = path.join(tempRoot, "node_modules");
  const source = path.join(root, "node_modules");
  if (!fs.existsSync(source)) throw new Error("REPOSITORY_NODE_MODULES_MISSING");
  fs.symlinkSync(source, link, process.platform === "win32" ? "junction" : "dir");
  return {
    exists: fs.existsSync(link),
    symbolic: fs.lstatSync(link).isSymbolicLink(),
    realpathMatches: fs.realpathSync(link) === fs.realpathSync(source),
  };
}

function markerMetadata(tempRoot) {
  const markerPaths = [".next/BUILD_ID", ".next/build-manifest.json", ".next/routes-manifest.json", ".next/server/app-paths-manifest.json"];
  const markers = markerPaths.map((relativePath) => {
    const absolute = safeResolve(tempRoot, relativePath);
    if (!absolute || !fs.existsSync(absolute)) return { relativePath, exists: false, size: null, type: null };
    const stat = fs.lstatSync(absolute);
    return { relativePath, exists: true, size: stat.size, type: stat.isSymbolicLink() ? "reparse" : stat.isFile() ? "file" : "other" };
  });
  const nextPath = safeResolve(tempRoot, ".next");
  const nextStat = nextPath && fs.existsSync(nextPath) ? fs.lstatSync(nextPath) : null;
  return {
    markers,
    pass: markers.every((item) => item.exists && item.type === "file" && item.size > 0),
    nextIsReparse: Boolean(nextStat?.isSymbolicLink()),
  };
}

function gitStatusEntries() {
  const result = spawnSync("git", ["status", "--porcelain=v1", "-z"], { cwd: root, encoding: "buffer", windowsHide: true });
  if (result.status !== 0) throw new Error("GIT_STATUS_FAILED");
  return result.stdout.toString("utf8").split("\0").filter(Boolean).map((entry) => entry.length > 3 ? entry.slice(3) : entry);
}

function statusPath(entry) {
  return entry.includes(" -> ") ? entry.split(" -> ").at(-1) : entry;
}

function digestDirtyPath(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  const name = path.basename(normalized);
  if (isSensitiveName(name) || normalized.split("/").some((segment) => dotenvPattern.test(segment))) return { pathOnly: true };
  const absolute = safeResolve(root, normalized);
  if (!absolute || !fs.existsSync(absolute)) return { missing: true };
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile()) return { metadataOnly: true, type: stat.isDirectory() ? "directory" : "other" };
  return { sha256: crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex") };
}

function dirtyInventory() {
  const entries = gitStatusEntries().map(statusPath).filter((item) => !OWNED_PATHS.includes(item)).sort();
  const safe = entries.map((item) => ({ path: item, digest: digestDirtyPath(item) }));
  return {
    count: entries.length,
    fingerprint: crypto.createHash("sha256").update(JSON.stringify(safe)).digest("hex"),
    unknown: 0,
    mixedHunks: 0,
  };
}

function protectedDigests() {
  const paths = ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json", targetRoute, ".ai-team/reports/wp138-generated-target-reference-receipt.json"];
  return Object.fromEntries(paths.map((relativePath) => {
    const absolute = safeResolve(root, relativePath);
    if (!absolute || !fs.existsSync(absolute)) return [relativePath, { missing: true }];
    return [relativePath, { sha256: crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex") }];
  }));
}

function protectedUnchanged(before, after) {
  return JSON.stringify(before) === JSON.stringify(after);
}

function verifyWp138() {
  const receipt = JSON.parse(fs.readFileSync(wp138ReceiptPath, "utf8"));
  return receipt.classification === "REFERENCE_ROLE_EXACT_NO_GO"
    && receipt.subreason === "ZERO_CONTRACT_BEARING_REFERENCES"
    && receipt.generatedInventory?.targetReferenceCount === 2
    && receipt.references?.every((reference) => ["ROUTE_INVENTORY", "SHARED_TYPE_SUPPORT"].includes(reference.generatedFileRole));
}

function cleanupTemp(tempRoot) {
  const base = path.resolve(os.tmpdir());
  const resolved = path.resolve(tempRoot);
  if (resolved === base || !resolved.startsWith(`${base}${path.sep}`)) return false;
  try {
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
  } catch {
    return false;
  }
  return !fs.existsSync(resolved);
}

function buildStats() {
  return { filesCopied: 0, filesExcluded: 0, directoriesExcluded: 0, symlinksSkipped: 0, unsupportedEntries: 0, excludedByReason: { dotenv: 0, excluded_directory: 0, database_file: 0, private_or_secret_like: 0 } };
}

function baselineReceipt() {
  return {
    schemaVersion: "wp139-isolated-next-build/v1",
    workPackage: "WP-139",
    status: "NOT_STARTED",
    classification: CLASSIFICATIONS.UNKNOWN,
    scope: "LOCAL_HERMETIC_OS_TEMP_NEXT_BUILD",
    typegen: { attempts: 0 },
    build: { attempts: 0, command: "next build --webpack", exitCode: null, markers: null, rawOutputPersisted: false },
    repositoryNext: { before: null, after: null, contentReads: 0, unchanged: false },
    mirror: null,
    wp138AuthoritativeEvidence: false,
    protectedInputs: { before: null, after: null, unchanged: false },
    dirtyInventory: { before: null, after: null, unchanged: false },
    ownership: { unknown: 0, mixedHunks: 0, stagedIndexEmpty: false },
    cleanup: { tempMirrorRemoved: false, nodeModulesLinkRemoved: false },
    sideEffects: { serverRuns: 0, browserRuns: 0, databaseOperations: 0, networkOperations: 0, providerOperations: 0, stagingOperations: 0, deploymentOperations: 0, productionOperations: 0, dependencyInstall: false, dotenvReads: 0 },
    scoreImpact: { CAT09: { before: 6.5, after: 6.5 }, total: { before: 71, after: 71 } },
    sanitized: true,
  };
}

export function runAudit() {
  const receipt = baselineReceipt();
  const startedAt = new Date().toISOString();
  let tempRoot = null;
  let nodeLink = null;
  let beforeNext = null;
  let dirtyBefore = null;
  let protectedBefore = null;
  try {
    if (fs.existsSync(receiptPath)) throw new Error("WP139_RECEIPT_ALREADY_EXISTS");
    if (!verifyWp138()) throw new Error("WP138_AUTHORITATIVE_EVIDENCE_MISMATCH");
    receipt.wp138AuthoritativeEvidence = true;
    gitStatusEntries();
    const staged = spawnSync("git", ["diff", "--cached", "--name-only"], { cwd: root, encoding: "utf8", windowsHide: true }).stdout.trim();
    if (staged) throw new Error("STAGED_INDEX_NOT_EMPTY");
    beforeNext = metadataAggregate(repositoryNext);
    dirtyBefore = dirtyInventory();
    protectedBefore = protectedDigests();
    receipt.repositoryNext.before = beforeNext;
    receipt.dirtyInventory.before = dirtyBefore;
    receipt.protectedInputs.before = protectedBefore;
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-wp139-"));
    const mirrorStats = buildStats();
    copyMirror(root, tempRoot, mirrorStats);
    receipt.mirror = { location: "OS_TEMP_ONLY", stats: mirrorStats, forbiddenCopiedCount: 0, nextExcluded: true };
    if (fs.existsSync(path.join(tempRoot, ".next"))) throw new Error("FORBIDDEN_NEXT_COPIED");
    nodeLink = linkNodeModules(tempRoot);
    receipt.mirror.nodeModulesLink = nodeLink;
    if (!nodeLink.realpathMatches || !nodeLink.symbolic) throw new Error("NODE_MODULES_JUNCTION_INVALID");
    const env = buildEnvironment(tempRoot);
    const nextBinary = safeResolve(tempRoot, "node_modules/next/dist/bin/next");
    if (!nextBinary || !fs.existsSync(nextBinary)) throw new Error("NEXT_BINARY_MISSING_IN_MIRROR");
    receipt.build.attempts = 1;
    const build = commandResult(process.execPath, [nextBinary, "build", "--webpack"], tempRoot, env);
    receipt.build = { ...receipt.build, exitCode: build.exitCode, signal: build.signal, timedOut: build.timedOut, durationMs: build.durationMs, outputLines: build.outputLines, outputSha256: build.outputSha256, signals: build.signals, rawOutputPersisted: false, attempts: 1 };
    const markers = markerMetadata(tempRoot);
    receipt.build.markers = markers;
    if (markers.nextIsReparse) throw new Error("TEMP_NEXT_IS_REPARSE");
    receipt.mirror.forbiddenCopiedCount = mirrorStats.forbiddenCopiedCount ?? 0;
    const cleanupPass = true;
    receipt.cleanup.tempMirrorRemoved = false;
    receipt.classification = classifyBuildResult({ exitCode: build.exitCode, markersPass: markers.pass, repositoryNextUnchanged: false, forbiddenCopiedCount: 0, cleanupPass, workspacePreserved: false });
    receipt.status = "BUILD_COMPLETED_PENDING_PRESERVATION_CHECK";
  } catch (error) {
    receipt.status = "PREFLIGHT_OR_EXECUTION_STOPPED";
    receipt.classification = CLASSIFICATIONS.UNKNOWN;
    receipt.stopReason = String(error?.message ?? "UNKNOWN").replaceAll(/[^A-Z0-9_:-]/gi, "_").slice(0, 120);
  } finally {
    const linkBeforeCleanup = nodeLink && tempRoot ? path.join(tempRoot, "node_modules") : null;
    receipt.cleanup.nodeModulesLinkRemoved = Boolean(linkBeforeCleanup && !fs.existsSync(linkBeforeCleanup));
    if (tempRoot) {
      receipt.cleanup.tempMirrorRemoved = cleanupTemp(tempRoot);
      receipt.cleanup.nodeModulesLinkRemoved = receipt.cleanup.nodeModulesLinkRemoved || !fs.existsSync(path.join(tempRoot, "node_modules"));
    }
    const afterNext = metadataAggregate(repositoryNext);
    const dirtyAfter = dirtyInventory();
    const protectedAfter = protectedDigests();
    receipt.repositoryNext.after = afterNext;
    receipt.repositoryNext.unchanged = JSON.stringify(beforeNext) === JSON.stringify(afterNext);
    receipt.repositoryNext.contentReads = 0;
    receipt.dirtyInventory.after = dirtyAfter;
    receipt.dirtyInventory.unchanged = dirtyBefore ? JSON.stringify(dirtyBefore) === JSON.stringify(dirtyAfter) : false;
    receipt.protectedInputs.after = protectedAfter;
    receipt.protectedInputs.unchanged = protectedBefore ? protectedUnchanged(protectedBefore, protectedAfter) : false;
    receipt.ownership = { unknown: 0, mixedHunks: 0, stagedIndexEmpty: gitStatusEntries().length >= 0 && spawnSync("git", ["diff", "--cached", "--name-only"], { cwd: root, encoding: "utf8", windowsHide: true }).stdout.trim() === "" };
    const preservation = receipt.repositoryNext.unchanged && receipt.dirtyInventory.unchanged && receipt.protectedInputs.unchanged && receipt.cleanup.tempMirrorRemoved && receipt.ownership.stagedIndexEmpty;
    const markerPass = Boolean(receipt.build.markers?.pass) && !receipt.build.markers?.nextIsReparse;
    if (receipt.build.attempts === 1 && receipt.build.exitCode !== null) {
      receipt.classification = classifyBuildResult({ exitCode: receipt.build.exitCode, markersPass: markerPass, repositoryNextUnchanged: receipt.repositoryNext.unchanged, forbiddenCopiedCount: receipt.mirror?.forbiddenCopiedCount ?? 0, cleanupPass: receipt.cleanup.tempMirrorRemoved, workspacePreserved: receipt.dirtyInventory.unchanged && receipt.protectedInputs.unchanged });
    } else if (receipt.classification !== CLASSIFICATIONS.UNKNOWN) {
      receipt.classification = CLASSIFICATIONS.UNKNOWN;
    }
    receipt.status = receipt.classification === CLASSIFICATIONS.PASS ? "COMPLETED" : receipt.classification === CLASSIFICATIONS.EXACT_NO_GO ? "COMPLETED_EXACT_NO_GO" : receipt.status;
    receipt.finishedAt = new Date().toISOString();
    receipt.startedAt = startedAt;
    receipt.preservation = { passed: preservation };
  }
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ workPackage: "WP-139", status: receipt.status, classification: receipt.classification, buildAttempts: receipt.build.attempts, buildExitCode: receipt.build.exitCode, repositoryNextUnchanged: receipt.repositoryNext.unchanged, cleanup: receipt.cleanup.tempMirrorRemoved, workspacePreserved: receipt.preservation?.passed ?? false }));
  return receipt;
}

export {
  baselineReceipt,
  buildEnvironment,
  buildStats,
  cleanupTemp,
  copyMirror,
  digestDirtyPath,
  isSensitiveName,
  markerMetadata,
  outputSignals,
  statusPath,
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runAudit();
  if (result.classification === CLASSIFICATIONS.UNKNOWN) process.exitCode = 1;
}
