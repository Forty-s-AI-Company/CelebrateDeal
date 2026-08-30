import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CLASSIFICATIONS, classifyReceipt } from "./wp125-build-failure-classifier.mjs";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = path.join(workspace, "docs", "launch", "wp125-build-failure-classification-contract.json");
const receiptPath = path.join(workspace, ".ai-team", "reports", "wp125-build-failure-diagnostic-receipt.json");
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const ownedPaths = new Set([
  "docs/launch/wp125-build-failure-classification-contract.json",
  "scripts/wp125-build-failure-classifier.mjs",
  "scripts/wp125-build-failure-classifier.test.mjs",
  "scripts/wp125-no-dotenv-diagnostic-runner.mjs",
  "docs/ai-team/evidence/wp-125-build-failure-diagnostic.md",
]);
const dotenvPattern = /^\.env(?:\.|$)/i;
const excludedDirectories = new Set([".git", ".next", "node_modules", "coverage", ".ai-team", ".agents", ".cache", "tmp", "temp"]);
const secretLikePattern = /(?:^|[-_.])(credentials?|private[-_]?key|service[-_]?account|id_rsa)(?:[-_.]|$)/i;
const secretExtensions = new Set([".pem", ".key", ".p12", ".pfx", ".crt", ".cer", ".der", ".netrc"]);
const databaseExtensions = new Set([".db", ".sqlite", ".sqlite3"]);

function relative(value) {
  return path.relative(workspace, value).replaceAll(path.sep, "/");
}

function excludedFileClass(name) {
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
    if (entry.isSymbolicLink()) {
      stats.symlinksSkipped += 1;
      continue;
    }
    if (entry.isDirectory()) {
      if (segments.some((segment) => excludedDirectories.has(segment))) {
        stats.directoriesExcluded += 1;
        continue;
      }
      fs.mkdirSync(path.join(mirror, rel), { recursive: true });
      copyMirror(source, mirror, stats);
      continue;
    }
    if (segments.some((segment) => excludedDirectories.has(segment))) {
      stats.filesExcluded.build_output = (stats.filesExcluded.build_output ?? 0) + 1;
      continue;
    }
    const excluded = excludedFileClass(entry.name);
    if (excluded) {
      stats.filesExcluded[excluded] = (stats.filesExcluded[excluded] ?? 0) + 1;
      continue;
    }
    const destination = path.join(mirror, rel);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    stats.filesCopied += 1;
  }
}

function syntheticEnvironment() {
  const environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(Path|PATH|SystemRoot|WINDIR|ComSpec|PATHEXT|TEMP|TMP)$/i.test(key) && typeof value === "string") environment[key] = value;
  }
  const values = {
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/celebratedeal_test",
    DIRECT_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/celebratedeal_test",
    NEXT_PUBLIC_APP_URL: "https://celebratedeal.invalid",
    JOB_SECRET: "wp125-synthetic-job-secret-32-bytes",
    CSRF_SECRET: "wp125-synthetic-csrf-secret-32-bytes",
    RATE_LIMIT_PROVIDER: "cloudflare_waf",
    PAYMENT_PROVIDER: "demo",
    RESEND_API_KEY: "wp125-synthetic-resend-key",
    EMAIL_FROM: "CelebrateDeal <synthetic@invalid.test>",
    SENTRY_DSN: "https://public@sentry.invalid/1",
    SENTRY_DISABLE_AUTO_UPLOAD: "true",
    NEXT_PUBLIC_POSTHOG_KEY: "wp125-synthetic-posthog-key",
    NEXT_PUBLIC_POSTHOG_HOST: "https://posthog.invalid",
    NEXT_TELEMETRY_DISABLED: "1",
    NPM_CONFIG_OFFLINE: "true",
    npm_config_offline: "true",
    NPM_CONFIG_AUDIT: "false",
    npm_config_audit: "false",
    NPM_CONFIG_FUND: "false",
    npm_config_fund: "false",
  };
  for (const [key, value] of Object.entries(values)) {
    if (!contract.synthetic_environment_allowlist?.includes(key)) throw new Error(`environment contract missing ${key}`);
    environment[key] = value;
  }
  return environment;
}

function run(command, args, cwd, env, timeout = 15 * 60 * 1000) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout, windowsHide: true, shell: false, maxBuffer: 1024 * 1024 });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const output = `${stdout}\n${stderr}`;
  return {
    command,
    exitCode: typeof result.status === "number" ? result.status : null,
    signal: result.signal ?? null,
    timedOut: Boolean(result.error?.code === "ETIMEDOUT"),
    durationMs: Date.now() - started,
    output,
    outputLineCount: output.split(/\r?\n/).filter(Boolean).length,
    outputDigest: crypto.createHash("sha256").update(output).digest("hex"),
  };
}

function statusEntries() {
  const result = spawnSync("git", ["status", "--porcelain=v1", "-z"], { cwd: workspace, encoding: "buffer", windowsHide: true });
  if (result.status !== 0) throw new Error("git status failed");
  return result.stdout.toString("utf8").split("\0").filter(Boolean).map((entry) => entry.slice(3).replace(/^.* -> /, "")).filter((entry) => !ownedPaths.has(entry)).sort();
}

function digestInventory(entries) {
  return entries.map((filePath) => {
    const name = path.basename(filePath);
    if (dotenvPattern.test(name) || excludedFileClass(name)) return { path: filePath, pathOnly: true };
    try {
      const absolute = path.join(workspace, filePath);
      if (!fs.statSync(absolute).isFile()) return { path: filePath, missing: true };
      return { path: filePath, sha256: crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex") };
    } catch {
      return { path: filePath, unreadable: true };
    }
  });
}

function inventory() {
  const entries = statusEntries();
  return { entries, digests: digestInventory(entries) };
}

function requiredInputs(mirror) {
  return ["package.json", "next.config.ts", "tsconfig.json", "src/app", "public", "prisma/schema.prisma"]
    .filter((rel) => !fs.existsSync(path.join(mirror, rel)));
}

function artifacts(mirror) {
  const required = [
    [".next/BUILD_ID", false],
    [".next/build-manifest.json", true],
    [".next/routes-manifest.json", true],
    [".next/server/app-paths-manifest.json", true],
  ];
  const values = required.map(([rel, json]) => {
    const absolute = path.join(mirror, rel);
    if (!fs.existsSync(absolute)) return { path: rel, exists: false, parseable: false };
    if (!json) return { path: rel, exists: true, parseable: fs.statSync(absolute).size > 0 };
    try {
      JSON.parse(fs.readFileSync(absolute, "utf8"));
      return { path: rel, exists: true, parseable: true };
    } catch {
      return { path: rel, exists: true, parseable: false };
    }
  });
  return { values, pass: values.every((value) => value.exists && value.parseable) };
}

function main() {
  const before = inventory();
  const mirror = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-wp125-"));
  const stats = { filesCopied: 0, directoriesExcluded: 0, symlinksSkipped: 0, filesExcluded: {} };
  let preflight = null;
  let moduleResolution = null;
  let typecheck = null;
  let build = null;
  let missing = [];
  let junctionStable = false;
  let cleanup = { attempted: false, pass: false };
  let failure = null;
  let finalStatus = "UNKNOWN_FAIL_CLOSED";
  try {
    copyMirror(workspace, mirror, stats);
    const junctionPath = path.join(mirror, "node_modules");
    fs.symlinkSync(path.join(workspace, "node_modules"), junctionPath, "junction");
    junctionStable = fs.lstatSync(junctionPath).isSymbolicLink()
      && fs.realpathSync(junctionPath) === fs.realpathSync(path.join(workspace, "node_modules"));
    missing = requiredInputs(mirror);
    const env = syntheticEnvironment();
    preflight = run(process.execPath, ["--import", "tsx", "scripts/preflight.ts"], mirror, env);
    moduleResolution = run(process.execPath, ["-e", "for (const name of ['next','react','react-dom','typescript','tsx']) require.resolve(name);"], mirror, env);
    typecheck = run(process.execPath, [path.join("node_modules", "typescript", "bin", "tsc"), "--noEmit", "--pretty", "false"], mirror, env);
    if (preflight.exitCode === 0 && moduleResolution.exitCode === 0 && typecheck.exitCode === 0 && missing.length === 0) {
      build = run(process.execPath, [path.join("node_modules", "next", "dist", "bin", "next"), "build", "--webpack"], mirror, env);
    }
    const output = build?.output ?? `${preflight?.output ?? ""}\n${typecheck?.output ?? ""}`;
    failure = classifyReceipt({
      buildExitCode: build?.exitCode ?? (typecheck?.exitCode ?? preflight?.exitCode ?? 1),
      buildOutput: output,
      typecheckExitCode: typecheck?.exitCode ?? null,
      requiredInputsMissing: missing,
      moduleResolutionFailed: moduleResolution?.exitCode !== 0,
      junctionStable,
      unknownEnvironmentNames: [],
    });
    const buildArtifacts = artifacts(mirror);
    finalStatus = build?.exitCode === 0 && buildArtifacts.pass && failure.classification !== CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED
      ? "REMEDIATED_BUILD_PASS"
      : failure.outcome;
    failure = { ...failure, artifactsPass: buildArtifacts.pass, artifacts: buildArtifacts.values };
  } catch {
    failure = classifyReceipt({ buildExitCode: 1, buildOutput: "", typecheckExitCode: null, requiredInputsMissing: [], moduleResolutionFailed: false, junctionStable: false, unknownEnvironmentNames: [] });
    finalStatus = "UNKNOWN_FAIL_CLOSED";
  } finally {
    cleanup.attempted = true;
    try {
      const tempRoot = path.resolve(os.tmpdir());
      if (!mirror.startsWith(`${tempRoot}${path.sep}`)) throw new Error("unsafe temp mirror path");
      fs.rmSync(mirror, { recursive: true, force: true });
      cleanup.pass = !fs.existsSync(mirror);
    } catch {
      cleanup.pass = false;
    }
  }
  const after = inventory();
  const workspacePreserved = JSON.stringify(before) === JSON.stringify(after);
  if (!cleanup.pass || !workspacePreserved) finalStatus = "UNKNOWN_FAIL_CLOSED";
  const receipt = {
    work_package: "WP-125",
    status: finalStatus,
    classification: failure,
    scope: "LOCAL_ONLY",
    external_side_effects: false,
    dotenv_content_read: false,
    raw_stdout_saved: false,
    raw_stderr_saved: false,
    environment_values_saved: false,
    dependency_install: false,
    network_requested: false,
    database_contacted: false,
    provider_contacted: false,
    deployment_attempted: false,
    mirror: { location: "OS_TEMP_ONLY", copy: stats, junction_stable: junctionStable },
    commands: {
      preflight: preflight ? { exitCode: preflight.exitCode, durationMs: preflight.durationMs, outputDigest: preflight.outputDigest, outputLineCount: preflight.outputLineCount } : null,
      moduleResolution: moduleResolution ? { exitCode: moduleResolution.exitCode, durationMs: moduleResolution.durationMs, outputDigest: moduleResolution.outputDigest, outputLineCount: moduleResolution.outputLineCount } : null,
      typecheck: typecheck ? { exitCode: typecheck.exitCode, durationMs: typecheck.durationMs, outputDigest: typecheck.outputDigest, outputLineCount: typecheck.outputLineCount } : null,
      build: build ? { exitCode: build.exitCode, durationMs: build.durationMs, outputDigest: build.outputDigest, outputLineCount: build.outputLineCount } : null,
    },
    required_inputs_missing: missing,
    cleanup,
    workspace_preserved: workspacePreserved,
    dirty_entries_before: before.entries.length,
    dirty_entries_after: after.entries.length,
    staged_index: "NOT_MODIFIED",
  };
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ work_package: "WP-125", status: finalStatus, classification: failure.classification, owner: failure.owner, cleanup: cleanup.pass, workspace_preserved: workspacePreserved }));
  if (finalStatus === "UNKNOWN_FAIL_CLOSED") process.exitCode = 1;
}

export { artifacts, digestInventory, excludedFileClass, relative, requiredInputs, statusEntries, syntheticEnvironment };

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
