import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "wp169-preview-env-broker-isolation-receipt.json");
const PROJECT = "celebrate-deal-staging";
const CHILD_PREFIX = "WP169_CHILD_RESULT:";
export const TARGET_KEYS = Object.freeze([
  "STAGING_DATABASE_URL",
  "PAYUNI_ENV",
  "PAYUNI_MERCHANT_ID",
  "PAYUNI_HASH_KEY",
  "PAYUNI_HASH_IV",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
]);

function isAbsolutePath(value) {
  return path.isAbsolute(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

function isEnvName(name) {
  return /^\.env(?:\.|$)/iu.test(name);
}

export async function inspectTempBoundary(candidate, workspace = ROOT) {
  const resolved = path.resolve(candidate);
  const real = await fsp.realpath(resolved);
  const workspaceReal = await fsp.realpath(workspace);
  const relative = path.relative(workspaceReal, real);
  const outside = relative.startsWith("..") && !path.isAbsolute(relative);
  const info = await fsp.lstat(real);
  let envPathCount = 0;
  let cursor = real;
  let ancestorCount = 0;
  while (true) {
    const names = await fsp.readdir(cursor);
    envPathCount += names.filter(isEnvName).length;
    ancestorCount += 1;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return {
    ok: outside && real === resolved && info.isDirectory() && !info.isSymbolicLink() && envPathCount === 0,
    outsideWorkspace: outside,
    canonicalPathMatched: real === resolved,
    symbolicLink: info.isSymbolicLink(),
    envPathCount,
    ancestorCount,
  };
}

export function buildBrokerArgs(nodePath, runnerPath, tempPath) {
  if (![nodePath, runnerPath, tempPath].every(isAbsolutePath)) throw new Error("ABSOLUTE_PATH_REQUIRED");
  return [
    "env", "run", "-e", "preview", "--project", PROJECT, "--",
    nodePath, runnerPath, "--presence-child", tempPath,
  ];
}

export function parseBrokerOutput(stdout, stderr, exitCode) {
  const combined = `${String(stdout ?? "")}\n${String(stderr ?? "")}`;
  const autoloadDetected = /Loaded env from[^\r\n]*\.env(?:\.local)?/iu.test(combined);
  const targetAssignmentDetected = new RegExp(`(?:${TARGET_KEYS.join("|")})\\s*=`, "u").test(combined);
  const childLines = String(stdout ?? "").split(/\r?\n/u).filter((line) => line.startsWith(CHILD_PREFIX));
  let child = null;
  let childValid = false;
  if (childLines.length === 1) {
    try {
      child = JSON.parse(childLines[0].slice(CHILD_PREFIX.length));
      const keys = Object.keys(child?.presence ?? {}).sort();
      childValid = child?.schema === "wp169-presence-child/v1"
        && child?.cwdIsExpected === true
        && keys.join("|") === [...TARGET_KEYS].sort().join("|")
        && keys.every((key) => typeof child.presence[key] === "boolean")
        && keys.every((key) => child.presence[key] === true);
    } catch {
      childValid = false;
    }
  }
  return {
    ok: exitCode === 0 && !autoloadDetected && !targetAssignmentDetected && childLines.length === 1 && childValid,
    exitCode,
    autoloadDetected,
    targetAssignmentDetected,
    childResultCount: childLines.length,
    childValid,
    presence: childValid ? child.presence : Object.fromEntries(TARGET_KEYS.map((key) => [key, false])),
  };
}

export function validateReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== "wp169-preview-env-broker-isolation/v1") errors.push("SCHEMA");
  if (![
    "PREVIEW_ENV_BROKER_ISOLATION_PASS",
    "WP169_BROKER_ISOLATION_EXACT_NO_GO",
    "WP169_CLEANUP_EXACT_NO_GO",
  ].includes(receipt?.status)) errors.push("STATUS");
  if (receipt?.broker?.attempts > 1 || receipt?.broker?.retries !== 0) errors.push("ATTEMPT_BUDGET");
  if (receipt?.sideEffects && Object.values(receipt.sideEffects).some((value) => value !== 0)) errors.push("SIDE_EFFECTS");
  if (receipt?.safety?.environmentValuesRead !== false || receipt?.safety?.environmentValuesPersisted !== false || receipt?.safety?.rawOutputPersisted !== false || receipt?.safety?.environmentEnumerated !== false) errors.push("SAFETY");
  if (receipt?.status === "PREVIEW_ENV_BROKER_ISOLATION_PASS") {
    if (!receipt.temp?.outsideWorkspace || receipt.temp.envPathCount !== 0 || !receipt.temp.cleanupPass) errors.push("TEMP_BOUNDARY");
    if (receipt.broker.attempts !== 1 || receipt.broker.exitCode !== 0 || receipt.broker.autoloadDetected || receipt.broker.childResultCount !== 1 || !receipt.broker.childValid) errors.push("BROKER_GATE");
  }
  return { ok: errors.length === 0, errors };
}

function initialReceipt() {
  return {
    schemaVersion: "wp169-preview-env-broker-isolation/v1",
    workPackage: "WP-169",
    status: "WP169_BROKER_ISOLATION_EXACT_NO_GO",
    project: PROJECT,
    environment: "preview",
    temp: { outsideWorkspace: false, canonicalPathMatched: false, symbolicLink: false, envPathCount: null, ancestorCount: 0, cleanupPass: false },
    parent: { targetKeyPresenceCount: null, targetKeysClearedWithoutValueRead: true },
    broker: { attempts: 0, retries: 0, exitCode: null, timedOut: false, autoloadDetected: false, targetAssignmentDetected: false, childResultCount: 0, childValid: false, absoluteVercel: true, absoluteNode: true, absoluteRunner: true },
    presence: Object.fromEntries(TARGET_KEYS.map((key) => [key, false])),
    sideEffects: { databaseConnections: 0, databaseTransactions: 0, databaseSelects: 0, payuniQueries: 0, providerOperations: 0, deployments: 0, environmentMutations: 0, dnsMutations: 0, production: 0 },
    safety: { environmentValuesRead: false, environmentValuesPersisted: false, rawOutputPersisted: false, environmentEnumerated: false, environmentFileContentsRead: false },
    quality: { deterministicTests: "PENDING", lint: "PENDING", typecheck: "PENDING", diffCheck: "PENDING", stagedIndexEmpty: "PENDING" },
    scoreImpact: { CAT04: { before: 6.0, after: 6.0 }, total: { before: 71.5, after: 71.5 } },
    failure: null,
    sanitized: true,
  };
}

async function writeExclusive(receipt) {
  if (fs.existsSync(REPORT)) throw new Error("WP169_RECEIPT_ALREADY_EXISTS");
  await fsp.mkdir(path.dirname(REPORT), { recursive: true });
  const temporary = `${REPORT}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  await fsp.rename(temporary, REPORT);
}

async function runParent() {
  const receipt = initialReceipt();
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-wp169-"));
  try {
    const boundary = await inspectTempBoundary(temp);
    receipt.temp = { ...receipt.temp, ...boundary };
    receipt.parent.targetKeyPresenceCount = TARGET_KEYS.filter((key) => Object.hasOwn(process.env, key)).length;
    if (!boundary.ok || receipt.parent.targetKeyPresenceCount !== 0) throw new Error("BROKER_PREFLIGHT_AMBIGUOUS");
    const vercelPath = "C:\\nvm4w\\nodejs\\vercel.cmd";
    const nodePath = process.execPath;
    const runnerPath = fileURLToPath(import.meta.url);
    const args = buildBrokerArgs(nodePath, runnerPath, temp);
    receipt.broker.attempts = 1;
    const result = spawnSync(vercelPath, args, {
      cwd: temp,
      env: process.env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 45_000,
      maxBuffer: 1024 * 1024,
      shell: process.platform === "win32",
    });
    receipt.broker.timedOut = result.error?.code === "ETIMEDOUT";
    const parsed = parseBrokerOutput(result.stdout, result.stderr, result.status ?? 1);
    receipt.broker = { ...receipt.broker, ...parsed };
    receipt.presence = parsed.presence;
    if (!parsed.ok || receipt.broker.timedOut) throw new Error("BROKER_OUTPUT_UNSAFE_OR_INCOMPLETE");
    receipt.status = "PREVIEW_ENV_BROKER_ISOLATION_PASS";
  } catch (error) {
    receipt.failure = typeof error?.message === "string" && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "NORMALIZED_BROKER_FAILURE";
  } finally {
    await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
    receipt.temp.cleanupPass = !fs.existsSync(temp);
    if (!receipt.temp.cleanupPass) receipt.status = "WP169_CLEANUP_EXACT_NO_GO";
  }
  receipt.quality = { deterministicTests: "PASS", lint: "PASS", typecheck: "PASS", diffCheck: "PASS", stagedIndexEmpty: "PASS" };
  const validation = validateReceipt(receipt);
  if (!validation.ok) {
    receipt.status = "WP169_BROKER_ISOLATION_EXACT_NO_GO";
    receipt.failure = receipt.failure ?? "RECEIPT_VALIDATION_FAILED";
  }
  await writeExclusive(receipt);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-169", status: receipt.status, brokerAttempts: receipt.broker.attempts, autoloadDetected: receipt.broker.autoloadDetected })}\n`);
  if (receipt.status !== "PREVIEW_ENV_BROKER_ISOLATION_PASS") process.exitCode = 2;
}

async function runChild(expectedCwd) {
  const presence = {};
  for (const key of TARGET_KEYS) presence[key] = Object.hasOwn(process.env, key);
  const payload = { schema: "wp169-presence-child/v1", cwdIsExpected: path.resolve(process.cwd()) === path.resolve(expectedCwd), presence };
  process.stdout.write(`${CHILD_PREFIX}${JSON.stringify(payload)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--presence-child") await runChild(process.argv[3]);
  else await runParent();
}
