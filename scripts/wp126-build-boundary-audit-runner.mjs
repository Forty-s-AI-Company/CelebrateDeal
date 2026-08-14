import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { auditBoundary, extractImportChain, normalizeDiagnostic } from "./wp126-build-boundary-auditor.mjs";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receiptPath = path.join(workspace, ".ai-team", "reports", "wp126-build-boundary-audit-receipt.json");
const excludedDirectories = new Set([".git", ".next", "node_modules", "coverage", ".ai-team", ".agents", ".cache", "tmp", "temp"]);
const dotenvPattern = /^\.env(?:\.|$)/i;
const secretLikePattern = /(?:^|[-_.])(credentials?|private[-_]?key|service[-_]?account|id_rsa)(?:[-_.]|$)/i;
const secretExtensions = new Set([".pem", ".key", ".p12", ".pfx", ".crt", ".cer", ".der", ".netrc"]);
const databaseExtensions = new Set([".db", ".sqlite", ".sqlite3"]);
const ownedPaths = new Set([
  "docs/launch/wp126-build-boundary-audit-contract.json",
  "scripts/wp126-build-boundary-auditor.mjs",
  "scripts/wp126-build-boundary-auditor.test.mjs",
  "scripts/wp126-build-boundary-audit-runner.mjs",
  "docs/ai-team/evidence/wp-126-build-boundary-audit.md",
]);

function relative(value) { return path.relative(workspace, value).replaceAll(path.sep, "/"); }

function excludedFile(name) {
  const ext = path.extname(name).toLowerCase();
  if (dotenvPattern.test(name)) return "dotenv";
  if (secretLikePattern.test(name) || secretExtensions.has(ext)) return "private_key_or_certificate";
  if (databaseExtensions.has(ext)) return "database_file";
  return null;
}

function copyMirror(current, mirror, stats) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const source = path.join(current, entry.name);
    const rel = relative(source);
    const segments = rel.split("/");
    if (entry.isSymbolicLink()) { stats.symlinksSkipped += 1; continue; }
    if (entry.isDirectory()) {
      if (segments.some((segment) => excludedDirectories.has(segment))) { stats.directoriesExcluded += 1; continue; }
      fs.mkdirSync(path.join(mirror, rel), { recursive: true });
      copyMirror(source, mirror, stats);
      continue;
    }
    if (segments.some((segment) => excludedDirectories.has(segment))) { stats.filesExcluded.build_output = (stats.filesExcluded.build_output ?? 0) + 1; continue; }
    const kind = excludedFile(entry.name);
    if (kind) { stats.filesExcluded[kind] = (stats.filesExcluded[kind] ?? 0) + 1; continue; }
    const destination = path.join(mirror, rel);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    stats.filesCopied += 1;
  }
}

function environment() {
  const result = {};
  for (const [key, value] of Object.entries(process.env)) if (/^(Path|PATH|SystemRoot|WINDIR|ComSpec|PATHEXT|TEMP|TMP)$/i.test(key) && typeof value === "string") result[key] = value;
  Object.assign(result, {
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/celebratedeal_test",
    DIRECT_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/celebratedeal_test",
    NEXT_PUBLIC_APP_URL: "https://celebratedeal.invalid",
    JOB_SECRET: "wp126-synthetic-job-secret-32-bytes",
    CSRF_SECRET: "wp126-synthetic-csrf-secret-32-bytes",
    RATE_LIMIT_PROVIDER: "cloudflare_waf",
    PAYMENT_PROVIDER: "demo",
    RESEND_API_KEY: "wp126-synthetic-resend-key",
    EMAIL_FROM: "CelebrateDeal <synthetic@invalid.test>",
    SENTRY_DSN: "https://public@sentry.invalid/1",
    SENTRY_DISABLE_AUTO_UPLOAD: "true",
    NEXT_PUBLIC_POSTHOG_KEY: "wp126-synthetic-posthog-key",
    NEXT_PUBLIC_POSTHOG_HOST: "https://posthog.invalid",
    NEXT_TELEMETRY_DISABLED: "1",
    NPM_CONFIG_OFFLINE: "true",
    npm_config_offline: "true",
    NPM_CONFIG_AUDIT: "false",
    npm_config_audit: "false",
    NPM_CONFIG_FUND: "false",
    npm_config_fund: "false",
  });
  return result;
}

function run(command, args, cwd, env, timeout = 15 * 60 * 1000) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout, windowsHide: true, shell: false, maxBuffer: 1024 * 1024 });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return { exitCode: typeof result.status === "number" ? result.status : null, signal: result.signal ?? null, timedOut: Boolean(result.error?.code === "ETIMEDOUT"), durationMs: Date.now() - started, output, outputDigest: crypto.createHash("sha256").update(output).digest("hex"), outputLineCount: output.split(/\r?\n/).filter(Boolean).length };
}

function statusEntries() {
  const result = spawnSync("git", ["status", "--porcelain=v1", "-z"], { cwd: workspace, encoding: "buffer", windowsHide: true });
  if (result.status !== 0) throw new Error("git status failed");
  return result.stdout.toString("utf8").split("\0").filter(Boolean).map((entry) => entry.slice(3).replace(/^.* -> /, "")).filter((entry) => !ownedPaths.has(entry)).sort();
}

function inventory() {
  const entries = statusEntries();
  return { entries, digests: entries.map((filePath) => {
    const name = path.basename(filePath);
    if (dotenvPattern.test(name) || excludedFile(name)) return { path: filePath, pathOnly: true };
    try {
      const absolute = path.join(workspace, filePath);
      return fs.statSync(absolute).isFile() ? { path: filePath, sha256: crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex") } : { path: filePath, missing: true };
    } catch { return { path: filePath, unreadable: true }; }
  }) };
}

function pathMetadata(paths) {
  const result = {};
  for (const filePath of paths) {
    const status = spawnSync("git", ["status", "--porcelain=v1", "--", filePath], { cwd: workspace, encoding: "utf8", windowsHide: true }).stdout.trim();
    result[filePath] = { dirty: Boolean(status), status: status ? status.slice(0, 2) : "clean" };
  }
  return result;
}

function commandSummary(value) {
  return value ? { exitCode: value.exitCode, signal: value.signal, timedOut: value.timedOut, durationMs: value.durationMs, outputDigest: value.outputDigest, outputLineCount: value.outputLineCount } : null;
}

function main() {
  const before = inventory();
  const mirror = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-wp126-"));
  const stats = { filesCopied: 0, directoriesExcluded: 0, symlinksSkipped: 0, filesExcluded: {} };
  let preflight = null;
  let moduleResolution = null;
  let typecheck = null;
  const builds = [];
  let normalized = null;
  let audit = null;
  let mirrorJunctionStable = false;
  let cleanup = { attempted: false, pass: false };
  try {
    copyMirror(workspace, mirror, stats);
    const junction = path.join(mirror, "node_modules");
    fs.symlinkSync(path.join(workspace, "node_modules"), junction, "junction");
    mirrorJunctionStable = fs.lstatSync(junction).isSymbolicLink() && fs.realpathSync(junction) === fs.realpathSync(path.join(workspace, "node_modules"));
    const env = environment();
    preflight = run(process.execPath, ["--import", "tsx", "scripts/preflight.ts"], mirror, env);
    moduleResolution = run(process.execPath, ["-e", "for (const name of ['next','react','react-dom','typescript','tsx']) require.resolve(name);"], mirror, env);
    typecheck = run(process.execPath, [path.join("node_modules", "typescript", "bin", "tsc"), "--noEmit", "--pretty", "false"], mirror, env);
    if (preflight.exitCode === 0 && moduleResolution.exitCode === 0 && typecheck.exitCode === 0 && mirrorJunctionStable) {
      const command = [path.join("node_modules", "next", "dist", "bin", "next"), "build", "--webpack"];
      builds.push(run(process.execPath, command, mirror, env));
      if (builds[0].exitCode !== 0) builds.push(run(process.execPath, command, mirror, env));
    }
    const output = builds.map((build) => build.output).join("\n");
    const first = normalizeDiagnostic(builds[0]?.output ?? output, workspace);
    const second = builds[1] ? normalizeDiagnostic(builds[1].output, workspace) : first;
    const stable = first.phase === second.phase && JSON.stringify(first.diagnosticCodes) === JSON.stringify(second.diagnosticCodes) && JSON.stringify(first.relativePaths) === JSON.stringify(second.relativePaths);
    normalized = { ...first, fingerprintStable: stable, runCount: builds.length, secondFingerprint: second.fingerprint };
    const metadata = pathMetadata(first.relativePaths);
    audit = auditBoundary({ normalized, fingerprintStable: stable, pathMetadata: metadata, workspaceRoot: workspace });
    audit.paths = audit.paths?.map((item) => ({ ...item, importChain: item.path.startsWith("node_modules/") || item.path.startsWith(".next/") ? [] : extractImportChain(item.path, workspace, 2) }));
  } catch {
    normalized = normalizeDiagnostic("", workspace);
    audit = { classification: "UNKNOWN_FAIL_CLOSED", confidence: "fail-closed", normalized };
  } finally {
    cleanup.attempted = true;
    try {
      const tempRoot = path.resolve(os.tmpdir());
      if (!mirror.startsWith(`${tempRoot}${path.sep}`)) throw new Error("unsafe temp mirror path");
      fs.rmSync(mirror, { recursive: true, force: true });
      cleanup.pass = !fs.existsSync(mirror);
    } catch { cleanup.pass = false; }
  }
  const after = inventory();
  const workspacePreserved = JSON.stringify(before) === JSON.stringify(after);
  if (!cleanup.pass || !workspacePreserved) audit = { ...audit, classification: "UNKNOWN_FAIL_CLOSED", confidence: "preservation-failed" };
  const status = audit.classification === "CLEAN_SEPARABLE_CANDIDATE" ? "EXACT_REMEDIATION_CANDIDATE_FOUND" : audit.classification === "UNKNOWN_FAIL_CLOSED" || audit.classification === "NONDETERMINISTIC_FAILURE" ? audit.classification : "EXACT_NO_GO_FOUND";
  const receipt = {
    work_package: "WP-126",
    status,
    classification: audit,
    scope: "LOCAL_READ_ONLY_DIAGNOSTIC",
    commands: { preflight: commandSummary(preflight), moduleResolution: commandSummary(moduleResolution), typecheck: commandSummary(typecheck), builds: builds.map(commandSummary) },
    mirror: { location: "OS_TEMP_ONLY", copy: stats, junction_stable: mirrorJunctionStable },
    dotenv_content_read: false,
    raw_stdout_saved: false,
    raw_stderr_saved: false,
    source_snippets_saved: false,
    environment_values_saved: false,
    dependency_install: false,
    network_requested: false,
    database_contacted: false,
    provider_contacted: false,
    deployment_attempted: false,
    cleanup,
    workspace_preserved: workspacePreserved,
    dirty_entries_before: before.entries.length,
    dirty_entries_after: after.entries.length,
    staged_index: "NOT_MODIFIED",
  };
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ work_package: "WP-126", status, classification: audit.classification, paths: audit.paths?.map((item) => item.path) ?? [], cleanup: cleanup.pass, workspace_preserved: workspacePreserved }));
  if (status === "UNKNOWN_FAIL_CLOSED" || status === "NONDETERMINISTIC_FAILURE") process.exitCode = 1;
}

export { commandSummary, environment, excludedFile, inventory, pathMetadata, relative };

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
