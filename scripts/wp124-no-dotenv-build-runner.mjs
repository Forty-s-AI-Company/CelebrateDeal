import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = path.join(workspace, "scripts", "wp124-no-dotenv-build-contract.json");
const receiptPath = path.join(workspace, ".ai-team", "reports", "wp124-no-dotenv-build-receipt.json");
const ownedPaths = new Set([
  "scripts/wp124-no-dotenv-build-contract.json",
  "scripts/wp124-no-dotenv-build-runner.mjs",
  "scripts/wp124-no-dotenv-build-runner.test.mjs",
  "docs/ai-team/evidence/wp-124-no-dotenv-build.md",
]);
const allowedEnvironment = new Set(JSON.parse(fs.readFileSync(contractPath, "utf8")).synthetic_environment_allowlist);
const dotenvPattern = /^\.env(?:\.|$)/i;
const excludedDirectoryNames = new Set([".git", ".next", "node_modules", "coverage", ".ai-team", ".agents", ".cache", "tmp", "temp"]);
const secretLikePattern = /(?:^|[-_.])(credentials?|private[-_]?key|service[-_]?account|id_rsa)(?:[-_.]|$)/i;
const secretExtensions = new Set([".pem", ".key", ".p12", ".pfx", ".crt", ".cer", ".der", ".netrc"]);
const databaseExtensions = new Set([".db", ".sqlite", ".sqlite3"]);

function relative(value) {
  return path.relative(workspace, value).replaceAll(path.sep, "/");
}

function classifyExcluded(name) {
  const ext = path.extname(name).toLowerCase();
  if (dotenvPattern.test(name)) return "dotenv";
  if (secretLikePattern.test(name) || secretExtensions.has(ext)) return "private_key_or_certificate";
  if (databaseExtensions.has(ext)) return "database_file";
  return null;
}

function shouldExclude(name, segments) {
  if (segments.some((segment) => excludedDirectoryNames.has(segment))) return "build_output";
  return classifyExcluded(name);
}

function walkFiles(current, output, stats) {
  const entries = fs.readdirSync(current, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(current, entry.name);
    const rel = relative(source);
    const segments = rel.split("/");
    if (entry.isSymbolicLink()) {
      stats.symlinksSkipped += 1;
      continue;
    }
    if (entry.isDirectory()) {
      if (excludedDirectoryNames.has(entry.name) || segments.some((segment) => excludedDirectoryNames.has(segment))) {
        stats.directoriesExcluded += 1;
        continue;
      }
      fs.mkdirSync(path.join(output, rel), { recursive: true });
      walkFiles(source, output, stats);
      continue;
    }
    const excluded = shouldExclude(entry.name, segments);
    if (excluded) {
      stats.filesExcluded[excluded] = (stats.filesExcluded[excluded] ?? 0) + 1;
      continue;
    }
    const destination = path.join(output, rel);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    stats.filesCopied += 1;
  }
}

function hostEnvironment() {
  const result = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(Path|PATH|SystemRoot|WINDIR|ComSpec|PATHEXT|TEMP|TMP)$/i.test(key) && typeof value === "string") {
      result[key] = value;
    }
  }
  const synthetic = {
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/synthetic",
    DIRECT_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/synthetic",
    NEXT_PUBLIC_APP_URL: "https://celebratedeal.invalid",
    JOB_SECRET: "wp124-synthetic-job-secret-32-bytes",
    CSRF_SECRET: "wp124-synthetic-csrf-secret-32-bytes",
    RATE_LIMIT_PROVIDER: "cloudflare_waf",
    PAYMENT_PROVIDER: "demo",
    RESEND_API_KEY: "wp124-synthetic-resend-key",
    EMAIL_FROM: "CelebrateDeal <synthetic@invalid.test>",
    SENTRY_DSN: "https://public@sentry.invalid/1",
    SENTRY_DISABLE_AUTO_UPLOAD: "true",
    NEXT_PUBLIC_POSTHOG_KEY: "wp124-synthetic-posthog-key",
    NEXT_PUBLIC_POSTHOG_HOST: "https://posthog.invalid",
    NEXT_TELEMETRY_DISABLED: "1",
    NPM_CONFIG_OFFLINE: "true",
    npm_config_offline: "true",
    NPM_CONFIG_AUDIT: "false",
    npm_config_audit: "false",
    NPM_CONFIG_FUND: "false",
    npm_config_fund: "false",
  };
  for (const [key, value] of Object.entries(synthetic)) {
    if (!allowedEnvironment.has(key)) throw new Error(`contract environment drift: ${key}`);
    result[key] = value;
  }
  return result;
}

function gitStatus() {
  const result = spawnSync("git", ["status", "--porcelain=v1", "-z"], { cwd: workspace, encoding: "buffer", windowsHide: true });
  if (result.status !== 0) throw new Error("git status failed");
  return result.stdout.toString("utf8").split("\0").filter(Boolean);
}

function statusPath(entry) {
  const value = entry.slice(3);
  return value.includes(" -> ") ? value.split(" -> ").at(-1) : value;
}

function isSensitivePath(filePath) {
  const name = path.basename(filePath);
  return dotenvPattern.test(name) || classifyExcluded(name) !== null;
}

function digestPath(filePath) {
  if (isSensitivePath(filePath)) return { path: filePath, pathOnly: true };
  const absolute = path.join(workspace, filePath);
  try {
    if (!fs.statSync(absolute).isFile()) return { path: filePath, missing: true };
    return { path: filePath, sha256: crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex") };
  } catch {
    return { path: filePath, unreadable: true };
  }
}

function inventory() {
  const entries = gitStatus().filter((entry) => !ownedPaths.has(statusPath(entry)));
  const safe = entries.map(statusPath).sort().map(digestPath);
  return { entries: entries.map(statusPath).sort(), safe };
}

function run(command, args, cwd, env, timeout = 15 * 60 * 1000) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout, windowsHide: true, shell: false, maxBuffer: 1024 * 1024 });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const diagnosticSignals = {
    dotenvMentioned: /\.env(?:\.|\b)/i.test(output),
    moduleResolution: /module not found|cannot find module|could not resolve|ERR_MODULE_NOT_FOUND/i.test(output),
    missingFile: /ENOENT|no such file|missing/i.test(output),
    nextConfig: /next\.config|invalid.*config/i.test(output),
    routeOrPage: /route|page|app directory|pages directory/i.test(output),
    staticRendering: /prerender|static generation|collecting page data|generating static/i.test(output),
    typecheck: /type error|typescript|failed to compile/i.test(output),
    prisma: /prisma/i.test(output),
    network: /ECONN|fetch|network|certificate/i.test(output),
  };
  const diagnosticCodes = {
    noAppOrPages: /couldn.t find any pages or app directory/i.test(output),
    appRouteError: /app route|route handler|route module/i.test(output),
    exportError: /export error|prerender error/i.test(output),
    dynamicServerUsage: /dynamic server usage|cookies\(\)|headers\(\)/i.test(output),
    buildWorker: /build worker|worker exited/i.test(output),
    pageDataCollection: /failed to collect page data|collecting page data/i.test(output),
    runtimeTypeError: /typeerror:\s*cannot read properties/i.test(output),
    runtimeReferenceError: /referenceerror:/i.test(output),
    runtimeSyntaxError: /syntaxerror:/i.test(output),
    externalRuntime: /error:.*(?:fetch|connect|database|query|socket)/i.test(output),
    requestContextRuntime: /error:.*(?:request|response|headers|cookies)/i.test(output),
    typescriptDiagnosticCode: /\bTS\d{3,5}\b/.test(output),
    webpack: /webpack/i.test(output),
    turbopack: /turbopack/i.test(output),
    swc: /swc/i.test(output),
    sentry: /sentry/i.test(output),
    genericError: /\berror\b|\bfailed\b/i.test(output),
  };
  const errorHeads = [...output.matchAll(/\b(?:Error|TypeError|ReferenceError|SyntaxError):\s*([A-Za-z][A-Za-z0-9_]*)/g)]
    .map((match) => match[1])
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 8);
  const typeErrorHeads = [...output.matchAll(/\bType error:\s*([A-Za-z][A-Za-z0-9_]*)/gi)]
    .map((match) => match[1])
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 8);
  const typeErrorKinds = {
    cannotFind: /type error:\s*cannot find/i.test(output),
    propertyMissing: /type error:.*property .* does not exist/i.test(output),
    argumentType: /type error:.*argument of type/i.test(output),
    nullability: /type error:.*possibly ['"]?(?:undefined|null)/i.test(output),
    jsxElement: /type error:.*jsx element/i.test(output),
    incompatibleTypes: /type error:\s*type .* is not assignable/i.test(output),
    typeCheckingFailed: /type error:.*(?:type checking|typecheck|checking failed|type errors?)/i.test(output),
    moduleDeclaration: /type error:.*declaration/i.test(output),
  };
  const typeErrorPhrase = output.match(/\bType error:\s*([A-Za-z]+(?:\s+[A-Za-z]+){0,5})/i)?.[1] ?? null;
  const failureClass = result.status === 0
    ? null
    : /module not found|cannot find module|could not resolve/i.test(output)
      ? "MODULE_RESOLUTION"
      : /type error|failed to compile/i.test(output)
        ? "COMPILE_OR_TYPECHECK"
        : /prisma/i.test(output)
          ? "PRISMA_OR_SCHEMA"
          : /permission denied|eacces|access is denied/i.test(output)
            ? "PERMISSION"
            : /environment|missing required|invalid.*config/i.test(output)
              ? "ENV_OR_CONFIGURATION"
              : "BUILD_NONZERO";
  return {
    command,
    exitCode: typeof result.status === "number" ? result.status : null,
    signal: result.signal ?? null,
    timedOut: Boolean(result.error?.code === "ETIMEDOUT"),
    durationMs: Date.now() - started,
    failureClass,
    outputLineCount: output.split(/\r?\n/).filter(Boolean).length,
    outputSha256: crypto.createHash("sha256").update(output).digest("hex"),
    diagnosticSignals,
    diagnosticCodes,
    errorHeads,
    typeErrorHeads,
    typeErrorKinds,
    typeErrorPhrase,
    outputDiscarded: true,
  };
}

function artifactSummary(mirror) {
  const required = [
    [".next/BUILD_ID", false],
    [".next/build-manifest.json", true],
    [".next/routes-manifest.json", true],
    [".next/server/app-paths-manifest.json", true],
  ];
  const artifacts = required.map(([rel, json]) => {
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
  return { artifacts, pass: artifacts.every((item) => item.exists && item.parseable) };
}

function containsForbiddenFiles(root) {
  const violations = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        visit(absolute);
        continue;
      }
      if (dotenvPattern.test(entry.name) || classifyExcluded(entry.name)) violations.push(relative(absolute));
    }
  }
  visit(root);
  return violations;
}

function stableEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function main() {
  const startedAt = new Date().toISOString();
  const before = inventory();
  const mirror = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-wp124-"));
  let cleanup = { attempted: false, pass: false };
  let copyStats = { filesCopied: 0, directoriesExcluded: 0, symlinksSkipped: 0, filesExcluded: {} };
  let preflight;
  let build;
  let artifacts = { artifacts: [], pass: false };
  let violations = [];
  let junction = { created: false, type: null };
  let mirrorStructure = {};
  let status = "FAIL";
  try {
    walkFiles(workspace, mirror, copyStats);
    const nodeModules = path.join(mirror, "node_modules");
    fs.symlinkSync(path.join(workspace, "node_modules"), nodeModules, "junction");
    junction = { created: true, type: fs.lstatSync(nodeModules).isSymbolicLink() ? "junction" : "unknown" };
    violations = containsForbiddenFiles(mirror);
    if (violations.length > 0) throw new Error("forbidden files found in mirror");
    mirrorStructure = {
      package_json: fs.existsSync(path.join(mirror, "package.json")),
      next_config: fs.existsSync(path.join(mirror, "next.config.ts")),
      src_app: fs.existsSync(path.join(mirror, "src", "app")),
      src_pages: fs.existsSync(path.join(mirror, "src", "pages")),
      public: fs.existsSync(path.join(mirror, "public")),
    };
    const env = hostEnvironment();
    preflight = run(process.execPath, ["--import", "tsx", "scripts/preflight.ts"], mirror, env);
    build = preflight.exitCode === 0
      ? run(process.execPath, [path.join("node_modules", "next", "dist", "bin", "next"), "build", "--webpack"], mirror, env)
      : { command: "next build", exitCode: null, signal: null, timedOut: false, durationMs: 0, outputDiscarded: true, skipped: "preflight_failed" };
    artifacts = artifactSummary(mirror);
    status = preflight.exitCode === 0 && build.exitCode === 0 && artifacts.pass ? "PASS" : "FAIL";
  } catch {
    status = "FAIL";
    preflight ??= { skipped: true };
    build ??= { skipped: true };
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
  const workspacePreserved = stableEqual(before, after);
  if (!workspacePreserved || !cleanup.pass) status = "FAIL";
  const receipt = {
    work_package: "WP-124",
    status,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    scope: "LOCAL_ONLY",
    external_side_effects: false,
    dotenv_content_read: false,
    dependency_install: false,
    network_requested: false,
    database_contacted: false,
    provider_contacted: false,
    deployment_attempted: false,
    environment: { allowlisted_names_only: true, values_saved: false, source: "synthetic" },
    mirror: { location: "OS_TEMP_ONLY", node_modules: junction, copy: copyStats, forbidden_files: violations },
    mirror_structure: mirrorStructure,
    commands: { preflight, build },
    artifacts,
    cleanup,
    workspace_preserved: workspacePreserved,
    dirty_entries_before: before.entries.length,
    dirty_entries_after: after.entries.length,
    staged_index: "NOT_MODIFIED",
    output_logs_saved: false,
    sensitive_values_saved: false,
  };
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ work_package: "WP-124", status, preflight: preflight?.exitCode ?? null, build: build?.exitCode ?? null, artifacts: artifacts.pass, cleanup: cleanup.pass, workspace_preserved: workspacePreserved }));
  if (status !== "PASS") process.exitCode = 1;
}

main();
