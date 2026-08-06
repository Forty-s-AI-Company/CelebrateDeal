import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = new URL(".", import.meta.url);
const defaultSourceRoot = resolve(fileURLToPath(new URL("../..", scriptDirectory)));
const defaultConfigPath = join(defaultSourceRoot, "config", "build-env.controlled.json");
const defaultReceiptPath = join(defaultSourceRoot, ".ai-team", "reports", "wp98-controlled-production-build-receipt.json");
const requiredKeys = new Set([
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXT_PUBLIC_APP_URL",
  "JOB_SECRET",
  "CSRF_SECRET",
  "RATE_LIMIT_PROVIDER",
  "PAYMENT_PROVIDER",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "SENTRY_DSN",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_POSTHOG_HOST",
]);
const runtimeEnvironmentKeys = ["PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "ComSpec", "COMSPEC", "PATHEXT"];
const unsafeValue = /(production|prod[._-]|live[._-]|secret|token|password|private[_ -]?key|api[_ -]?key)/i;

function isEnvironmentFile(name) {
  return name === ".env" || name.startsWith(".env.");
}

function assertSyntheticUrl(value, key) {
  const url = new URL(value);
  if (key === "DATABASE_URL" || key === "DIRECT_URL") {
    if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "1") {
      throw new Error(`controlled config rejected ${key}`);
    }
    return;
  }
  if (url.protocol !== "https:" || url.hostname !== "build.invalid") {
    throw new Error(`controlled config rejected ${key}`);
  }
}

export function validateControlledEnvironment(environment) {
  const keys = Object.keys(environment).sort();
  if (keys.length !== requiredKeys.size || keys.some((key) => !requiredKeys.has(key))) {
    throw new Error("controlled config must contain exactly the allowlisted keys");
  }

  for (const key of requiredKeys) {
    const value = environment[key];
    if (typeof value !== "string" || value.length === 0 || unsafeValue.test(value)) {
      throw new Error(`controlled config rejected ${key}`);
    }
  }

  assertSyntheticUrl(environment.DATABASE_URL, "DATABASE_URL");
  assertSyntheticUrl(environment.DIRECT_URL, "DIRECT_URL");
  assertSyntheticUrl(environment.NEXT_PUBLIC_APP_URL, "NEXT_PUBLIC_APP_URL");
  assertSyntheticUrl(environment.SENTRY_DSN, "SENTRY_DSN");
  assertSyntheticUrl(environment.NEXT_PUBLIC_POSTHOG_HOST, "NEXT_PUBLIC_POSTHOG_HOST");

  if (environment.RATE_LIMIT_PROVIDER !== "cloudflare_waf" || environment.PAYMENT_PROVIDER !== "demo") {
    throw new Error("controlled config rejected provider selection");
  }
}

export async function loadControlledEnvironment(configPath = defaultConfigPath) {
  const parsed = JSON.parse(await readFile(configPath, "utf8"));
  if (parsed.schemaVersion !== 1 || !parsed.environment || typeof parsed.environment !== "object") {
    throw new Error("controlled config has an unsupported schema");
  }
  validateControlledEnvironment(parsed.environment);
  return parsed.environment;
}

export function createControlledChildEnvironment(controlledEnvironment, hostEnvironment = process.env) {
  const childEnvironment = {
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    SENTRY_DISABLE_AUTO_UPLOAD: "true",
    ...controlledEnvironment,
  };
  for (const key of runtimeEnvironmentKeys) {
    if (hostEnvironment[key]) childEnvironment[key] = hostEnvironment[key];
  }
  return childEnvironment;
}

function mirrorFilter(sourceRoot) {
  return (source) => {
    const relativePath = relative(sourceRoot, source);
    if (!relativePath) return true;
    const parts = relativePath.split(sep);
    return !parts.some((part) => isEnvironmentFile(part) || [".git", "node_modules", ".next", "coverage"].includes(part));
  };
}

export async function createNoEnvMirror(sourceRoot = defaultSourceRoot) {
  const uniqueRoot = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "celebratedeal-controlled-build-")));
  await cp(sourceRoot, uniqueRoot, { recursive: true, filter: mirrorFilter(sourceRoot) });
  await symlink(join(sourceRoot, "node_modules"), join(uniqueRoot, "node_modules"), "junction");
  return uniqueRoot;
}

export function runChild({ executable, args, cwd, environment }) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, args, {
      cwd,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    // Keep diagnostics in-memory because dependency failures may reflect child
    // configuration. The public receipt contains only a fixed category/code.
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", rejectRun);
    child.once("close", (code, signal) => resolveRun({ code: code ?? 1, signal, output }));
  });
}

export function classifyBuildFailure(output) {
  if (/database|prisma|econnrefused|connection refused/i.test(output)) return "DATABASE_ACCESS_DURING_BUILD";
  if (/environment|env validation|required.*(?:key|variable)|missing.*(?:key|variable)/i.test(output)) return "CONTROLLED_ENV_INCOMPLETE";
  if (/fetch failed|network|enotfound|timeout/i.test(output)) return "EXTERNAL_NETWORK_DEPENDENCY";
  if (/module not found|cannot find module/i.test(output)) return "MIRROR_MODULE_RESOLUTION";
  if (/type error|typescript|eslint/i.test(output)) return "SOURCE_QUALITY_FAILURE";
  return "BUILD_FAILURE_UNCLASSIFIED";
}

export async function runControlledProductionBuild({
  sourceRoot = defaultSourceRoot,
  configPath = defaultConfigPath,
  hostEnvironment = process.env,
  createMirror = createNoEnvMirror,
  run = runChild,
} = {}) {
  const controlledEnvironment = await loadControlledEnvironment(configPath);
  const childEnvironment = createControlledChildEnvironment(controlledEnvironment, hostEnvironment);
  const mirrorRoot = await createMirror(sourceRoot);
  let cleanup = false;
  try {
    const nextCli = join(mirrorRoot, "node_modules", "next", "dist", "bin", "next");
    const result = await run({
      executable: process.execPath,
      // The no-env mirror deliberately uses a node_modules junction. Use the
      // supported webpack builder so this release gate does not depend on the
      // known Turbopack+junction browser-toolchain failure mode.
      args: [nextCli, "build", "--webpack"],
      cwd: mirrorRoot,
      environment: childEnvironment,
    });
    return {
      exitCode: result.code,
      signal: result.signal,
      failureCategory: result.code === 0 ? "NOT_APPLICABLE" : classifyBuildFailure(result.output),
      inheritedApplicationEnvironment: false,
      controlledKeyNames: Object.keys(controlledEnvironment).sort(),
    };
  } finally {
    await rm(mirrorRoot, { recursive: true, force: true });
    cleanup = true;
    if (!cleanup) throw new Error("controlled mirror cleanup failed");
  }
}

async function writeReceipt(receiptPath, receipt) {
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

async function main() {
  try {
    const result = await runControlledProductionBuild();
    await writeReceipt(defaultReceiptPath, {
      schemaVersion: 1,
      workPackage: "WP-98",
      status: result.exitCode === 0 ? "PASS" : "FAIL",
      exitCode: result.exitCode,
      signal: result.signal,
      failureCategory: result.failureCategory,
      inheritedApplicationEnvironment: result.inheritedApplicationEnvironment,
      controlledKeyNames: result.controlledKeyNames,
      mirrorCleanup: "PASS",
    });
    if (result.exitCode === 0) {
      console.log("controlled production build: PASS");
    } else {
      console.error(`controlled production build: FAIL (exit ${result.exitCode})`);
    }
    process.exitCode = result.exitCode;
  } catch {
    await writeReceipt(defaultReceiptPath, {
      schemaVersion: 1,
      workPackage: "WP-98",
      status: "BLOCKED",
      exitCode: 1,
      failureCategory: "RUNNER_BLOCKED",
      inheritedApplicationEnvironment: false,
      mirrorCleanup: "NOT_CONFIRMED",
    });
    console.error("controlled production build: BLOCKED");
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
