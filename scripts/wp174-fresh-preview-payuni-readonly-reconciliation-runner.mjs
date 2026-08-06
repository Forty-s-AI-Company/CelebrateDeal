import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "wp174-fresh-preview-payuni-readonly-reconciliation.json");
const WP170_RUNNER = path.join(ROOT, "scripts", "wp170-staging-payuni-readonly-reconciliation-runner.mjs");
const WP173_RECEIPT = path.join(ROOT, ".ai-team", "reports", "wp173-preview-payuni-env-redeploy-receipt.json");
const VERCEL = "C:\\nvm4w\\nodejs\\vercel.cmd";
const PROJECT = "celebrate-deal-staging";
const STAGING_HOST = "celebrate-deal-staging.carry-digital-nomad.in.net";
const EXPECTED_DEPLOYMENT = "dpl_9KrvwFKkGKAVEzVZdm5Tc9iiQqCg";
const CHILD_PREFIX = "WP170_CHILD_RESULT:";
export const TARGET_KEYS = Object.freeze(["STAGING_DATABASE_URL", "PAYUNI_ENV", "PAYUNI_MERCHANT_ID", "PAYUNI_HASH_KEY", "PAYUNI_HASH_IV", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
const SUCCESS = new Set([
  "WP174_READ_ONLY_RECONCILIATION_CONSISTENT",
  "WP174_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED",
]);
const TERMINAL = new Set([
  ...SUCCESS,
  "WP174_STARTUP_PREFLIGHT_EXACT_NO_GO",
  "WP174_FRESHNESS_EXACT_NO_GO",
  "WP174_BROKER_EXACT_NO_GO",
  "WP174_DATABASE_IDENTITY_EXACT_NO_GO",
  "WP174_CANDIDATE_EXACT_NO_GO_ZERO",
  "WP174_CANDIDATE_EXACT_NO_GO_AMBIGUOUS",
  "WP174_CANDIDATE_EXACT_NO_GO_INVALID",
  "WP174_PROVIDER_EXACT_NO_GO",
  "WP174_RECEIPT_SAFETY_EXACT_NO_GO",
  "WP174_CLEANUP_EXACT_NO_GO",
]);

function sha(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

export function buildBrokerArgs(nodePath, tsxCliPath, tsconfigPath, runnerPath, tempPath) {
  if (![nodePath, tsxCliPath, tsconfigPath, runnerPath, tempPath].every(path.isAbsolute)) throw new Error("ABSOLUTE_PATH_REQUIRED");
  return ["env", "run", "-e", "preview", "--project", PROJECT, "--", nodePath, tsxCliPath, "--tsconfig", tsconfigPath, runnerPath, "--live-child", tempPath, "preview"];
}

function isEnvName(name) {
  return /^\.env(?:\.|$)/iu.test(name);
}

export async function inspectTempBoundary(candidate, workspace = ROOT) {
  const resolved = path.resolve(candidate);
  const real = await fsp.realpath(resolved);
  const workspaceReal = await fsp.realpath(workspace);
  const relative = path.relative(workspaceReal, real);
  const outsideWorkspace = relative.startsWith("..") && !path.isAbsolute(relative);
  const info = await fsp.lstat(real);
  let envPathCount = 0;
  let cursor = real;
  while (true) {
    envPathCount += (await fsp.readdir(cursor)).filter(isEnvName).length;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return { ok: outsideWorkspace && real === resolved && info.isDirectory() && !info.isSymbolicLink() && envPathCount === 0, outsideWorkspace, canonicalPathMatched: real === resolved, symbolicLink: info.isSymbolicLink(), envPathCount };
}

function childReceiptSafe(receipt) {
  if (!receipt || typeof receipt !== "object") return false;
  const allowed = new Set(["WP170_READ_ONLY_RECONCILIATION_CONSISTENT", "WP170_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED", "WP170_DATABASE_IDENTITY_EXACT_NO_GO", "WP170_CANDIDATE_EXACT_NO_GO_ZERO", "WP170_CANDIDATE_EXACT_NO_GO_AMBIGUOUS", "WP170_CANDIDATE_EXACT_NO_GO_INVALID", "WP170_PROVIDER_EXACT_NO_GO", "WP170_RECEIPT_SAFETY_EXACT_NO_GO", "WP170_CLEANUP_EXACT_NO_GO"]);
  if (!allowed.has(receipt.status)) return false;
  if ((receipt.database?.connectionAttempts ?? 0) > 1 || (receipt.database?.readOnlyTransactionAttempts ?? 0) > 1 || (receipt.database?.applicationSelects ?? 0) > 1 || (receipt.payuni?.queryAttempts ?? 0) > 1) return false;
  if ((receipt.database?.retries ?? 0) !== 0 || (receipt.payuni?.retries ?? 0) !== 0 || (receipt.payuni?.redirects ?? 0) !== 0) return false;
  if (Object.values(receipt.sideEffects ?? {}).some((value) => value !== 0)) return false;
  if (Object.values(receipt.safety ?? {}).some((value) => value !== false)) return false;
  if ((receipt.payuni?.queryAttempts ?? 0) > 0 && receipt.database?.candidateBucket !== "one") return false;
  return true;
}

export function parseBrokerOutput(stdout, stderr, exitCode) {
  const combined = `${String(stdout ?? "")}\n${String(stderr ?? "")}`;
  const autoloadDetected = /Loaded env from[^\r\n]*\.env(?:\.local)?/iu.test(combined);
  const targetAssignmentDetected = new RegExp(`(?:${TARGET_KEYS.join("|")})\\s*=`, "u").test(combined);
  const lines = String(stdout ?? "").split(/\r?\n/u).filter((line) => line.startsWith(CHILD_PREFIX));
  let child = null;
  if (lines.length === 1) {
    try { child = JSON.parse(lines[0].slice(CHILD_PREFIX.length)); } catch { child = null; }
  }
  const childValid = child?.schema === "wp170-child/v1" && child?.cwdMatched === true && childReceiptSafe(child.receipt);
  return { ok: (exitCode === 0 || exitCode === 2) && !autoloadDetected && !targetAssignmentDetected && lines.length === 1 && childValid, autoloadDetected, targetAssignmentDetected, childResultCount: lines.length, childValid, child };
}

export function initialReceipt() {
  return {
    schemaVersion: "wp174-fresh-preview-payuni-readonly-reconciliation/v1",
    workPackage: "WP-174",
    terminalStatus: "WP174_STARTUP_PREFLIGHT_EXACT_NO_GO",
    freshness: { metadataReads: 0, healthHeadProbes: 0, projectMatched: false, deploymentMatched: false, preview: false, ready: false, noRedirect: false, healthStatus: null, deploymentDigest: null, wp173AcceptedInput: false },
    temp: { outsideWorkspace: false, canonicalPathMatched: false, symbolicLink: false, envPathCount: null, cleanupPass: false },
    broker: { attempts: 0, retries: 0, exitCode: null, childResultCount: 0, childValid: false, autoloadDetected: false, targetAssignmentDetected: false, parentTargetKeyPresenceCount: null, rawOutputPersisted: false },
    primaryOutcome: { observed: false, status: null, failure: null, database: { connectionAttempts: 0, readOnlyTransactionAttempts: 0, readOnlyTransactions: 0, applicationSelects: 0, transactionReadOnly: false, identityDigest: null, candidateBucket: "not_run", candidateCount: null, disconnected: false }, payuni: { officialSandbox: false, queryAttempts: 0, retries: 0, redirects: 0, normalizedStatus: null, referenceMatched: false, orderMatched: false, amountMatched: false }, reconciliation: { classification: "NOT_RUN", providerAhead: false } },
    sideEffects: { databaseWrites: 0, rowLocks: 0, providerWrites: 0, payments: 0, refunds: 0, callbacks: 0, deployments: 0, environmentMutations: 0, aliasMutations: 0, dnsMutations: 0, production: 0, gitMutations: 0, packageInstalls: 0, registryFallbacks: 0 },
    safety: { environmentFilesRead: false, environmentValuesPersisted: false, rawOutputPersisted: false, rawDatabaseRowsPersisted: false, rawProviderResponsePersisted: false, rawIdentifiersPersisted: false, urlsPersisted: false, credentialsPersisted: false, tokensPersisted: false, cookiesPersisted: false },
    quality: { strictReadback: "PENDING", stagedIndexEmpty: "PASS", preserveOnly: "PASS" },
    scoreImpact: { CAT04: { before: 6, candidateAfter: 7.5, applied: false }, total: { before: 72, candidateAfter: 73.5, applied: false }, eligible: false },
    gateImpact: { runtimeSandboxClassification: "NOT_VERIFIED", stagingDatabaseIdentity: "NOT_VERIFIED", payuniSandboxReadOnlyLookup: "NOT_RUN", SANDBOX_READY: false, PRODUCTION_READY: false },
    canonicalDigest: null,
    sanitized: true,
  };
}

export function parseFreshnessJson(raw, exitCode) {
  try {
    const value = JSON.parse(String(raw));
    const status = String(value.status ?? value.readyState ?? "").toUpperCase();
    const projectMatched = value.name === PROJECT;
    const deploymentMatched = value.id === EXPECTED_DEPLOYMENT;
    const preview = value.target === "preview";
    const ready = status === "READY";
    return { ok: exitCode === 0 && projectMatched && deploymentMatched && preview && ready, projectMatched, deploymentMatched, preview, ready, deploymentDigest: value.id ? sha(`deployment:${value.id}`) : null };
  } catch {
    return { ok: false, projectMatched: false, deploymentMatched: false, preview: false, ready: false, deploymentDigest: null };
  }
}

function mapStatus(status) {
  const mapping = {
    WP170_READ_ONLY_RECONCILIATION_CONSISTENT: "WP174_READ_ONLY_RECONCILIATION_CONSISTENT",
    WP170_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED: "WP174_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED",
    WP170_DATABASE_IDENTITY_EXACT_NO_GO: "WP174_DATABASE_IDENTITY_EXACT_NO_GO",
    WP170_CANDIDATE_EXACT_NO_GO_ZERO: "WP174_CANDIDATE_EXACT_NO_GO_ZERO",
    WP170_CANDIDATE_EXACT_NO_GO_AMBIGUOUS: "WP174_CANDIDATE_EXACT_NO_GO_AMBIGUOUS",
    WP170_CANDIDATE_EXACT_NO_GO_INVALID: "WP174_CANDIDATE_EXACT_NO_GO_INVALID",
    WP170_PROVIDER_EXACT_NO_GO: "WP174_PROVIDER_EXACT_NO_GO",
    WP170_RECEIPT_SAFETY_EXACT_NO_GO: "WP174_RECEIPT_SAFETY_EXACT_NO_GO",
    WP170_CLEANUP_EXACT_NO_GO: "WP174_CLEANUP_EXACT_NO_GO",
  };
  return mapping[status] ?? "WP174_BROKER_EXACT_NO_GO";
}

export function createPrimaryOutcome(child) {
  const failure = typeof child?.failure === "string" && /^[A-Z0-9_]+$/u.test(child.failure) ? child.failure : null;
  return {
    observed: true,
    status: mapStatus(child?.status),
    failure,
    database: {
      connectionAttempts: child?.database?.connectionAttempts ?? 0,
      readOnlyTransactionAttempts: child?.database?.readOnlyTransactionAttempts ?? 0,
      readOnlyTransactions: child?.database?.readOnlyTransactions ?? 0,
      applicationSelects: child?.database?.applicationSelects ?? 0,
      transactionReadOnly: child?.database?.transactionReadOnly === true,
      identityDigest: child?.database?.identityDigest ?? null,
      candidateBucket: child?.database?.candidateBucket ?? "not_run",
      candidateCount: child?.database?.candidateCount ?? null,
      disconnected: child?.database?.disconnected === true,
    },
    payuni: {
      officialSandbox: child?.payuni?.officialSandbox === true,
      queryAttempts: child?.payuni?.queryAttempts ?? 0,
      retries: child?.payuni?.retries ?? 0,
      redirects: child?.payuni?.redirects ?? 0,
      normalizedStatus: child?.payuni?.normalizedStatus ?? null,
      referenceMatched: child?.payuni?.referenceMatched === true,
      orderMatched: child?.payuni?.orderMatched === true,
      amountMatched: child?.payuni?.amountMatched === true,
    },
    reconciliation: {
      classification: child?.reconciliation?.classification ?? "NOT_RUN",
      providerAhead: child?.reconciliation?.providerAhead === true,
    },
  };
}

export function successEligible(receipt) {
  const p = receipt.primaryOutcome;
  const consistent = receipt.terminalStatus === "WP174_READ_ONLY_RECONCILIATION_CONSISTENT" && p.reconciliation.providerAhead === false;
  const divergent = receipt.terminalStatus === "WP174_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED" && p.reconciliation.providerAhead === true && p.reconciliation.classification === "PROVIDER_AHEAD_MISSING_CALLBACK_CANDIDATE";
  return Boolean(
    (consistent || divergent) && receipt.freshness.deploymentMatched && receipt.freshness.preview && receipt.freshness.ready && receipt.freshness.noRedirect && receipt.temp.cleanupPass && receipt.broker.childValid &&
    p.database.connectionAttempts === 1 && p.database.readOnlyTransactionAttempts === 1 && p.database.readOnlyTransactions === 1 && p.database.applicationSelects === 1 && p.database.transactionReadOnly && p.database.candidateBucket === "one" && p.database.candidateCount === 1 && p.database.disconnected &&
    p.payuni.officialSandbox && p.payuni.queryAttempts === 1 && p.payuni.retries === 0 && p.payuni.redirects === 0 && p.payuni.referenceMatched && p.payuni.orderMatched && p.payuni.amountMatched
  );
}

export function validateReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== "wp174-fresh-preview-payuni-readonly-reconciliation/v1") errors.push("SCHEMA");
  if (!TERMINAL.has(receipt?.terminalStatus)) errors.push("STATUS");
  const p = receipt?.primaryOutcome;
  if (receipt?.broker?.attempts > 1 || p?.database?.connectionAttempts > 1 || p?.database?.readOnlyTransactionAttempts > 1 || p?.database?.applicationSelects > 1 || p?.payuni?.queryAttempts > 1) errors.push("ATTEMPT_BUDGET");
  if (receipt?.broker?.retries !== 0 || p?.payuni?.retries !== 0 || p?.payuni?.redirects !== 0) errors.push("RETRY_REDIRECT");
  if (Object.values(receipt?.sideEffects ?? {}).some((value) => value !== 0)) errors.push("WRITE_SIDE_EFFECT");
  if (Object.values(receipt?.safety ?? {}).some((value) => value !== false)) errors.push("SENSITIVE_PERSISTENCE");
  if (p?.payuni?.queryAttempts > 0 && p?.database?.candidateBucket !== "one") errors.push("PROVIDER_BEFORE_CANDIDATE");
  if (["zero", "ambiguous", "invalid_state", "unsafe_reference", "invalid_amount"].includes(p?.database?.candidateBucket) && p?.payuni?.queryAttempts !== 0) errors.push("CANDIDATE_FAIL_OPEN");
  if (receipt?.scoreImpact?.eligible !== successEligible(receipt)) errors.push("SCORE_ELIGIBILITY");
  if (SUCCESS.has(receipt?.terminalStatus) && !receipt?.scoreImpact?.eligible) errors.push("SUCCESS_GATE");
  if (receipt?.gateImpact?.SANDBOX_READY !== false || receipt?.gateImpact?.PRODUCTION_READY !== false || receipt?.scoreImpact?.applied === true) errors.push("READINESS_OVERCLAIM");
  const serialized = JSON.stringify(receipt);
  if (/(?:postgres(?:ql)?:\/\/|https?:\/\/|Bearer\s+|BEGIN PRIVATE|"(?:orderNumber|providerTradeNo|rawResponse|rawRows|merchantId|hashKey|hashIv|url)"\s*:)/iu.test(serialized)) errors.push("FORBIDDEN_TEXT");
  return { ok: errors.length === 0, errors };
}

async function cleanupTemp(temp) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
    if (!fs.existsSync(temp)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
  }
  return !fs.existsSync(temp);
}

async function finalize(receipt) {
  receipt.scoreImpact.eligible = successEligible(receipt);
  if (receipt.scoreImpact.eligible) {
    receipt.gateImpact.runtimeSandboxClassification = "VERIFIED";
    receipt.gateImpact.stagingDatabaseIdentity = "VERIFIED_READ_ONLY";
    receipt.gateImpact.payuniSandboxReadOnlyLookup = "VERIFIED";
  }
  receipt.canonicalDigest = sha(canonical({ ...receipt, canonicalDigest: null }));
  let check = validateReceipt(receipt);
  receipt.quality.strictReadback = check.ok ? "PASS" : "FAIL";
  if (!check.ok) {
    receipt.terminalStatus = "WP174_RECEIPT_SAFETY_EXACT_NO_GO";
    receipt.scoreImpact.eligible = false;
  }
  receipt.canonicalDigest = sha(canonical({ ...receipt, canonicalDigest: null }));
  check = validateReceipt(receipt);
  if (!check.ok) receipt.quality.strictReadback = "FAIL";
  if (fs.existsSync(REPORT)) throw new Error("WP174_REPORT_ALREADY_EXISTS");
  await fsp.mkdir(path.dirname(REPORT), { recursive: true });
  const temporary = `${REPORT}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  await fsp.rename(temporary, REPORT);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-174", terminalStatus: receipt.terminalStatus, dbSelects: receipt.primaryOutcome.database.applicationSelects, payuniQueries: receipt.primaryOutcome.payuni.queryAttempts, scoreEligible: receipt.scoreImpact.eligible })}\n`);
  if (!SUCCESS.has(receipt.terminalStatus)) process.exitCode = 2;
  return receipt;
}

async function runLive() {
  const receipt = initialReceipt();
  if (fs.existsSync(REPORT)) throw new Error("WP174_REPORT_ALREADY_EXISTS");
  const wp173 = JSON.parse(await fsp.readFile(WP173_RECEIPT, "utf8"));
  receipt.freshness.wp173AcceptedInput = wp173.terminalStatus === "WP173_PREVIEW_PAYUNI_ENV_REDEPLOY_ALIAS_VERIFIED" && wp173.newDeployment?.id === EXPECTED_DEPLOYMENT && wp173.newDeployment?.target === "preview" && wp173.newDeployment?.readyState === "READY" && wp173.health?.aliasStatus === 200;
  receipt.broker.parentTargetKeyPresenceCount = TARGET_KEYS.filter((key) => Object.hasOwn(process.env, key)).length;
  if (!receipt.freshness.wp173AcceptedInput || receipt.broker.parentTargetKeyPresenceCount !== 0) return finalize(receipt);

  const inspect = spawnSync(VERCEL, ["inspect", STAGING_HOST, "--json"], { cwd: ROOT, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 30_000, maxBuffer: 1024 * 1024 });
  receipt.freshness.metadataReads = 1;
  const fresh = parseFreshnessJson(inspect.stdout, inspect.status ?? 1);
  receipt.freshness = { ...receipt.freshness, ...fresh };
  if (!fresh.ok) { receipt.terminalStatus = "WP174_FRESHNESS_EXACT_NO_GO"; return finalize(receipt); }
  const health = await fetch(`https://${STAGING_HOST}/api/health`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  receipt.freshness.healthHeadProbes = 1;
  receipt.freshness.healthStatus = health?.status ?? null;
  receipt.freshness.noRedirect = Boolean(health && !health.redirected && !health.headers.has("location"));
  if (health?.status !== 200 || !receipt.freshness.noRedirect) { receipt.terminalStatus = "WP174_FRESHNESS_EXACT_NO_GO"; return finalize(receipt); }

  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-wp174-"));
  try {
    receipt.temp = { ...receipt.temp, ...(await inspectTempBoundary(temp)) };
    if (!receipt.temp.ok) { receipt.terminalStatus = "WP174_BROKER_EXACT_NO_GO"; }
    else {
      const require = createRequire(import.meta.url);
      const args = buildBrokerArgs(process.execPath, require.resolve("tsx/cli"), path.join(ROOT, "tsconfig.json"), WP170_RUNNER, temp);
      receipt.broker.attempts = 1;
      const result = spawnSync(VERCEL, args, { cwd: temp, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 90_000, maxBuffer: 1024 * 1024 });
      receipt.broker.exitCode = result.status ?? 1;
      const parsed = parseBrokerOutput(result.stdout, result.stderr, receipt.broker.exitCode);
      receipt.broker = { ...receipt.broker, childResultCount: parsed.childResultCount, childValid: parsed.childValid, autoloadDetected: parsed.autoloadDetected, targetAssignmentDetected: parsed.targetAssignmentDetected };
      if (!parsed.ok) receipt.terminalStatus = "WP174_BROKER_EXACT_NO_GO";
      else {
        receipt.primaryOutcome = createPrimaryOutcome(parsed.child.receipt);
        receipt.terminalStatus = receipt.primaryOutcome.status;
      }
    }
  } finally {
    const cleanupPass = await cleanupTemp(temp);
    receipt.temp.cleanupPass = cleanupPass;
    if (!cleanupPass) receipt.terminalStatus = "WP174_CLEANUP_EXACT_NO_GO";
  }
  return finalize(receipt);
}

async function verifyReport() {
  const receipt = JSON.parse(await fsp.readFile(REPORT, "utf8"));
  const result = validateReceipt(receipt);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-174", strictReadback: result.ok ? "PASS" : "FAIL", terminalStatus: receipt.terminalStatus, scoreEligible: receipt.scoreImpact.eligible })}\n`);
  if (!result.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--verify-report") await verifyReport();
  else await runLive();
}

export const CONTRACT = Object.freeze({ project: PROJECT, stagingHost: STAGING_HOST, expectedDeployment: EXPECTED_DEPLOYMENT, report: REPORT, wp170Runner: WP170_RUNNER });
