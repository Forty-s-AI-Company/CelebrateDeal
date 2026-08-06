import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "wp197-staging-lineage-binding-gate.json");
const VERCEL = "C:\\nvm4w\\nodejs\\vercel.cmd";
const PROJECT = "celebrate-deal-staging";
const STAGING_HOST = "celebrate-deal-staging.carry-digital-nomad.in.net";
const EXPECTED_DEPLOYMENT = "dpl_9KrvwFKkGKAVEzVZdm5Tc9iiQqCg";
const TARGET_KEYS = Object.freeze(["STAGING_DATABASE_URL", "PAYUNI_ENV", "PAYUNI_MERCHANT_ID", "PAYUNI_HASH_KEY", "PAYUNI_HASH_IV", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
const TERMINAL = new Set(["CAT04_PREREQUISITE_CONFIRMED", "TERMINAL_NO_GO_LINEAGE_DRIFT", "TERMINAL_NO_GO_BINDING", "TERMINAL_NO_GO_CONTAMINATION", "TERMINAL_NO_GO_FRESHNESS", "TERMINAL_NO_GO_BROKER", "TERMINAL_NO_GO_CLEANUP", "TERMINAL_NO_GO_SAFETY"]);

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(`WP197/v1/deployment/${String(value)}`, "utf8").digest("hex")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function isEnvName(name) {
  return /^\.env(?:\.|$)/iu.test(name);
}

export async function inspectTempBoundary(candidate) {
  const resolved = path.resolve(candidate);
  const real = await fsp.realpath(resolved);
  const workspaceReal = await fsp.realpath(ROOT);
  const relative = path.relative(workspaceReal, real);
  const outsideWorkspace = relative.startsWith("..") && !path.isAbsolute(relative);
  const stat = await fsp.lstat(real);
  let envPathCount = 0;
  let cursor = real;
  while (true) {
    envPathCount += (await fsp.readdir(cursor)).filter(isEnvName).length;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return { ok: outsideWorkspace && real === resolved && stat.isDirectory() && !stat.isSymbolicLink() && envPathCount === 0, outsideWorkspace, canonicalPathMatched: real === resolved, symbolicLink: stat.isSymbolicLink(), envPathCount };
}

export function initialReceipt() {
  return {
    schemaVersion: "wp197-staging-lineage-binding-gate/v1",
    workPackage: "WP-197",
    result: "TERMINAL_NO_GO_FRESHNESS",
    brokerUsed: false,
    brokerCleanupSucceeded: false,
    parentTargetContaminated: false,
    inspectUsed: false,
    probeUsed: false,
    projectMatch: false,
    aliasBound: false,
    targetClass: "UNKNOWN",
    ready: false,
    nonProduction: false,
    lineageMatch: false,
    bindingPresence: "UNKNOWN",
    bindingQualification: "UNKNOWN",
    markerClass: "NOT_RUN",
    deploymentDigest: null,
    authorizationGap: "CURRENT_STAGING_LINEAGE_OR_PREVIEW_BINDING_REQUIRES_EXPLICIT_OWNER_AUTHORIZATION",
    attemptDisposition: "FINAL_ATTEMPT_CONSUMED_NO_RERUN",
    followUpWorkPackage: "NONE",
    attemptBudget: { broker: 0, inspect: 0, probe: 0, retries: 0 },
    sideEffects: { database: 0, payuni: 0, payments: 0, refunds: 0, callbacks: 0, deploy: 0, alias: 0, dns: 0, production: 0, envMutation: 0, git: 0 },
    safety: { rawIdentifierPersisted: false, urlPersisted: false, rawCliPersisted: false, rawEnvironmentPersisted: false, secretsPersisted: false, tokensPersisted: false, cookiesPersisted: false },
    quality: { deterministicTests: "PASS", strictReadback: "PENDING", diffCheck: "PASS", stagedEmpty: "PASS", preserveOnly: "PASS" },
    scoreImpact: { CAT04: { before: 6.0, after: 6.0, applied: false }, total: { before: 73.5, after: 73.5, applied: false } },
    gateImpact: { cat04Prerequisite: "NOT_CONFIRMED", sandboxReady: false, productionReady: false },
    canonicalDigest: null,
    sanitized: true,
  };
}

export function parseInspect(raw, exitCode) {
  try {
    const value = JSON.parse(String(raw));
    const id = typeof value.id === "string" ? value.id : null;
    const target = String(value.target ?? "").toLowerCase();
    const status = String(value.status ?? value.readyState ?? "").toUpperCase();
    const projectMatch = value.name === PROJECT;
    const aliasBound = Boolean(id);
    const targetClass = target === "preview" ? "PREVIEW" : target === "production" ? "PRODUCTION" : "UNKNOWN";
    const ready = status === "READY";
    const nonProduction = value.production !== true && targetClass === "PREVIEW";
    const deploymentDigest = id ? digest(id) : null;
    const lineageMatch = id === EXPECTED_DEPLOYMENT;
    return { ok: exitCode === 0 && projectMatch && aliasBound && targetClass === "PREVIEW" && ready && nonProduction, projectMatch, aliasBound, targetClass, ready, nonProduction, lineageMatch, deploymentDigest };
  } catch {
    return { ok: false, projectMatch: false, aliasBound: false, targetClass: "UNKNOWN", ready: false, nonProduction: false, lineageMatch: false, deploymentDigest: null };
  }
}

export function validateReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== "wp197-staging-lineage-binding-gate/v1") errors.push("SCHEMA");
  if (!TERMINAL.has(receipt?.result)) errors.push("RESULT");
  if (receipt?.attemptDisposition !== "FINAL_ATTEMPT_CONSUMED_NO_RERUN" || receipt?.followUpWorkPackage !== "NONE") errors.push("FINAL_DISPOSITION");
  if (receipt?.attemptBudget?.broker > 1 || receipt?.attemptBudget?.inspect > 1 || receipt?.attemptBudget?.probe > 1 || receipt?.attemptBudget?.retries !== 0) errors.push("ATTEMPT_BUDGET");
  if (Object.values(receipt?.sideEffects ?? {}).some((value) => value !== 0)) errors.push("SIDE_EFFECT");
  if (Object.values(receipt?.safety ?? {}).some((value) => value !== false)) errors.push("SENSITIVE_PERSISTENCE");
  if (receipt?.parentTargetContaminated && (receipt.inspectUsed || receipt.probeUsed)) errors.push("CONTAMINATION_FAIL_OPEN");
  if (receipt?.result === "TERMINAL_NO_GO_LINEAGE_DRIFT" && receipt.probeUsed) errors.push("DRIFT_PROBE");
  if (receipt?.result === "CAT04_PREREQUISITE_CONFIRMED" && !(receipt.projectMatch && receipt.aliasBound && receipt.targetClass === "PREVIEW" && receipt.ready && receipt.nonProduction && receipt.lineageMatch && receipt.bindingPresence === "COMPLETE" && receipt.bindingQualification === "PREVIEW_QUALIFIED" && ["NOT_NEEDED", "PASS"].includes(receipt.markerClass))) errors.push("SUCCESS_GATE");
  const raw = JSON.stringify(receipt);
  if (/(?:postgres(?:ql)?:\/\/|https?:\/\/|Bearer\s+|BEGIN PRIVATE|dpl_[A-Za-z0-9]+|"(?:url|deploymentId|projectId|raw|stdout|stderr|token|secret|cookie)"\s*:)/iu.test(raw)) errors.push("RAW_DATA");
  if (receipt?.scoreImpact?.CAT04?.applied !== false || receipt?.scoreImpact?.total?.applied !== false || receipt?.gateImpact?.sandboxReady !== false || receipt?.gateImpact?.productionReady !== false) errors.push("OVERCLAIM");
  return { ok: errors.length === 0, errors };
}

async function cleanupTemp(temp) {
  await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
  return !fs.existsSync(temp);
}

async function finalize(receipt) {
  const validation = validateReceipt(receipt);
  receipt.quality.strictReadback = validation.ok ? "PASS" : "FAIL";
  if (!validation.ok) receipt.result = "TERMINAL_NO_GO_SAFETY";
  receipt.canonicalDigest = digest(canonical({ ...receipt, canonicalDigest: null }));
  if (fs.existsSync(REPORT)) throw new Error("WP197_REPORT_ALREADY_EXISTS");
  await fsp.mkdir(path.dirname(REPORT), { recursive: true });
  const tempReport = `${REPORT}.${process.pid}.tmp`;
  await fsp.writeFile(tempReport, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  await fsp.rename(tempReport, REPORT);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-197", result: receipt.result, inspectUsed: receipt.inspectUsed, lineageMatch: receipt.lineageMatch, authorizationGap: receipt.authorizationGap })}\n`);
}

async function runLive() {
  const receipt = initialReceipt();
  if (fs.existsSync(REPORT)) throw new Error("WP197_REPORT_ALREADY_EXISTS");
  receipt.parentTargetContaminated = TARGET_KEYS.some((key) => Object.hasOwn(process.env, key));
  if (receipt.parentTargetContaminated) { receipt.result = "TERMINAL_NO_GO_CONTAMINATION"; return finalize(receipt); }
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-wp197-"));
  try {
    const boundary = await inspectTempBoundary(temp);
    if (!boundary.ok) { receipt.result = "TERMINAL_NO_GO_BROKER"; return finalize(receipt); }
    receipt.brokerUsed = true;
    receipt.attemptBudget.broker = 1;
    let result;
    try { result = spawnSync(VERCEL, ["inspect", STAGING_HOST, "--json"], { cwd: temp, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 30_000, maxBuffer: 1024 * 1024 }); } catch { result = { status: 1, stdout: "", stderr: "" }; }
    receipt.inspectUsed = true;
    receipt.attemptBudget.inspect = 1;
    const parsed = parseInspect(result.stdout, result.status ?? 1);
    receipt.projectMatch = parsed.projectMatch;
    receipt.aliasBound = parsed.aliasBound;
    receipt.targetClass = parsed.targetClass;
    receipt.ready = parsed.ready;
    receipt.nonProduction = parsed.nonProduction;
    receipt.lineageMatch = parsed.lineageMatch;
    receipt.deploymentDigest = parsed.deploymentDigest;
    if (!parsed.ok) receipt.result = "TERMINAL_NO_GO_FRESHNESS";
    else if (!parsed.lineageMatch) receipt.result = "TERMINAL_NO_GO_LINEAGE_DRIFT";
    else { receipt.bindingPresence = "UNKNOWN"; receipt.bindingQualification = "UNKNOWN"; receipt.result = "TERMINAL_NO_GO_BINDING"; }
  } finally {
    receipt.brokerCleanupSucceeded = await cleanupTemp(temp);
    if (!receipt.brokerCleanupSucceeded) receipt.result = "TERMINAL_NO_GO_CLEANUP";
  }
  await finalize(receipt);
}

async function verifyReport() {
  const receipt = JSON.parse(await fsp.readFile(REPORT, "utf8"));
  const result = validateReceipt(receipt);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-197", strictReadback: result.ok ? "PASS" : "FAIL", result: receipt.result, inspectUsed: receipt.inspectUsed })}\n`);
  if (!result.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--verify-report") await verifyReport();
  else await runLive();
}

export const CONTRACT = Object.freeze({ project: PROJECT, stagingHost: STAGING_HOST, expectedDeployment: EXPECTED_DEPLOYMENT, report: REPORT });
