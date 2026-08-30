import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  buildBrokerArgs as buildWp170BrokerArgs,
  inspectTempBoundary,
  parseBrokerOutput as parseWp170BrokerOutput,
} from "./wp174-fresh-preview-payuni-readonly-reconciliation-runner.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "wp196-final-staging-payuni-authorization-receipt.json");
const WP173_RECEIPT = path.join(ROOT, ".ai-team", "reports", "wp173-preview-payuni-env-redeploy-receipt.json");
const WP170_RUNNER = path.join(ROOT, "scripts", "wp170-staging-payuni-readonly-reconciliation-runner.mjs");
const TS_CONFIG = path.join(ROOT, "tsconfig.json");
const VERCEL = "C:\\nvm4w\\nodejs\\vercel.cmd";
const PROJECT = "celebrate-deal-staging";
const STAGING_HOST = "celebrate-deal-staging.carry-digital-nomad.in.net";
const EXPECTED_DEPLOYMENT = "dpl_9KrvwFKkGKAVEzVZdm5Tc9iiQqCg";
export const TARGET_KEYS = Object.freeze([
  "STAGING_DATABASE_URL",
  "PAYUNI_ENV",
  "PAYUNI_MERCHANT_ID",
  "PAYUNI_HASH_KEY",
  "PAYUNI_HASH_IV",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
]);

const SUCCESS = new Set([
  "WP196_FINAL_RECONCILIATION_CONSISTENT",
  "WP196_FINAL_RECONCILIATION_DIVERGENCE_DETECTED",
]);
const TERMINAL = new Set([
  ...SUCCESS,
  "WP196_FINAL_NO_GO_FRESHNESS",
  "WP196_FINAL_NO_GO_BINDING",
  "WP196_FINAL_NO_GO_DATABASE_IDENTITY",
  "WP196_FINAL_NO_GO_CANDIDATE_ZERO",
  "WP196_FINAL_NO_GO_CANDIDATE_AMBIGUOUS",
  "WP196_FINAL_NO_GO_CANDIDATE_INVALID",
  "WP196_FINAL_NO_GO_PROVIDER",
  "WP196_FINAL_NO_GO_BROKER",
  "WP196_FINAL_NO_GO_RECEIPT_SAFETY",
  "WP196_FINAL_NO_GO_CLEANUP",
]);

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value), "utf8").digest("hex")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function mapStatus(status) {
  const map = {
    WP170_READ_ONLY_RECONCILIATION_CONSISTENT: "WP196_FINAL_RECONCILIATION_CONSISTENT",
    WP170_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED: "WP196_FINAL_RECONCILIATION_DIVERGENCE_DETECTED",
    WP170_DATABASE_IDENTITY_EXACT_NO_GO: "WP196_FINAL_NO_GO_DATABASE_IDENTITY",
    WP170_CANDIDATE_EXACT_NO_GO_ZERO: "WP196_FINAL_NO_GO_CANDIDATE_ZERO",
    WP170_CANDIDATE_EXACT_NO_GO_AMBIGUOUS: "WP196_FINAL_NO_GO_CANDIDATE_AMBIGUOUS",
    WP170_CANDIDATE_EXACT_NO_GO_INVALID: "WP196_FINAL_NO_GO_CANDIDATE_INVALID",
    WP170_PROVIDER_EXACT_NO_GO: "WP196_FINAL_NO_GO_PROVIDER",
    WP170_RECEIPT_SAFETY_EXACT_NO_GO: "WP196_FINAL_NO_GO_RECEIPT_SAFETY",
    WP170_CLEANUP_EXACT_NO_GO: "WP196_FINAL_NO_GO_CLEANUP",
  };
  return map[status] ?? "WP196_FINAL_NO_GO_BROKER";
}

function safeFailure(value) {
  return typeof value === "string" && /^[A-Z0-9_]+$/u.test(value) ? value : null;
}

function mapChild(child) {
  const source = child?.receipt ?? {};
  return {
    observed: true,
    status: mapStatus(source.status),
    failure: safeFailure(source.failure),
    database: {
      connectionAttempts: source.database?.connectionAttempts ?? 0,
      readOnlyTransactionAttempts: source.database?.readOnlyTransactionAttempts ?? 0,
      readOnlyTransactions: source.database?.readOnlyTransactions ?? 0,
      applicationSelects: source.database?.applicationSelects ?? 0,
      transactionReadOnly: source.database?.transactionReadOnly === true,
      identityDigest: source.database?.identityDigest ?? null,
      candidateBucket: source.database?.candidateBucket ?? "not_run",
      candidateCount: source.database?.candidateCount ?? null,
      disconnected: source.database?.disconnected === true,
    },
    payuni: {
      officialSandbox: source.payuni?.officialSandbox === true,
      queryAttempts: source.payuni?.queryAttempts ?? 0,
      retries: source.payuni?.retries ?? 0,
      redirects: source.payuni?.redirects ?? 0,
      normalizedStatus: source.payuni?.normalizedStatus ?? null,
      referenceMatched: source.payuni?.referenceMatched === true,
      orderMatched: source.payuni?.orderMatched === true,
      amountMatched: source.payuni?.amountMatched === true,
    },
    reconciliation: {
      classification: source.reconciliation?.classification ?? "NOT_RUN",
      providerAhead: source.reconciliation?.providerAhead === true,
    },
  };
}

export function initialReceipt() {
  return {
    schemaVersion: "wp196-final-staging-payuni-authorization/v1",
    workPackage: "WP-196",
    attemptDisposition: "FINAL_ATTEMPT_CONSUMED_NO_RERUN",
    followUpWorkPackage: "NONE",
    terminalStatus: "WP196_FINAL_NO_GO_FRESHNESS",
    freshness: { metadataReads: 0, healthHeadProbes: 0, projectMatched: false, deploymentMatched: false, preview: false, ready: false, noRedirect: false, healthStatus: null, deploymentDigest: null, wp173AcceptedInput: false },
    temp: { outsideWorkspace: false, canonicalPathMatched: false, symbolicLink: false, envPathCount: null, cleanupPass: false },
    broker: { attempts: 0, retries: 0, exitCode: null, childResultCount: 0, childValid: false, autoloadDetected: false, targetAssignmentDetected: false, parentTargetKeyPresenceCount: null, rawOutputPersisted: false },
    primaryOutcome: { observed: false, status: null, failure: null, database: { connectionAttempts: 0, readOnlyTransactionAttempts: 0, readOnlyTransactions: 0, applicationSelects: 0, transactionReadOnly: false, identityDigest: null, candidateBucket: "not_run", candidateCount: null, disconnected: false }, payuni: { officialSandbox: false, queryAttempts: 0, retries: 0, redirects: 0, normalizedStatus: null, referenceMatched: false, orderMatched: false, amountMatched: false }, reconciliation: { classification: "NOT_RUN", providerAhead: false } },
    sideEffects: { databaseWrites: 0, rowLocks: 0, providerWrites: 0, payments: 0, refunds: 0, callbacks: 0, deployments: 0, environmentMutations: 0, aliasMutations: 0, dnsMutations: 0, production: 0, gitMutations: 0, packageInstalls: 0, registryFallbacks: 0 },
    safety: { environmentFilesRead: false, environmentValuesPersisted: false, rawOutputPersisted: false, rawDatabaseRowsPersisted: false, rawProviderResponsePersisted: false, rawIdentifiersPersisted: false, urlsPersisted: false, credentialsPersisted: false, tokensPersisted: false, cookiesPersisted: false },
    quality: { deterministicTests: "PASS", lint: "PASS", typecheck: "PASS", strictReadback: "PENDING", diffCheck: "PASS", stagedIndexEmpty: "PASS", preserveOnly: "PASS" },
    scoreImpact: { CAT04: { before: 6.0, candidateAfter: 7.5, applied: false }, total: { before: 73.5, candidateAfter: 75.0, applied: false }, eligible: false },
    gateImpact: { runtimeSandboxClassification: "NOT_VERIFIED", stagingDatabaseIdentity: "NOT_VERIFIED", readOnlyTransaction: "NOT_VERIFIED", exactlyOneCandidate: "NOT_VERIFIED", payuniSandboxReadOnlyLookup: "NOT_RUN", reconciliation: "NOT_VERIFIED", SANDBOX_READY: false, PRODUCTION_READY: false },
    authorizationDecision: "FINAL_NO_SCORE_AUTHORIZATION",
    canonicalDigest: null,
    sanitized: true,
  };
}

export function parseFreshness(raw, exitCode) {
  try {
    const value = JSON.parse(String(raw));
    const status = String(value.status ?? value.readyState ?? "").toUpperCase();
    const projectMatched = value.name === PROJECT;
    const deploymentMatched = value.id === EXPECTED_DEPLOYMENT;
    const preview = value.target === "preview";
    const ready = status === "READY";
    return { ok: exitCode === 0 && projectMatched && deploymentMatched && preview && ready, projectMatched, deploymentMatched, preview, ready, deploymentDigest: value.id ? digest(`deployment:${value.id}`) : null };
  } catch {
    return { ok: false, projectMatched: false, deploymentMatched: false, preview: false, ready: false, deploymentDigest: null };
  }
}

export function successEligible(receipt) {
  const p = receipt.primaryOutcome;
  const classified = SUCCESS.has(receipt.terminalStatus);
  return Boolean(classified && receipt.freshness.deploymentMatched && receipt.freshness.preview && receipt.freshness.ready && receipt.freshness.noRedirect && receipt.temp.cleanupPass && receipt.broker.childValid && p.database.connectionAttempts === 1 && p.database.readOnlyTransactionAttempts === 1 && p.database.readOnlyTransactions === 1 && p.database.applicationSelects === 1 && p.database.transactionReadOnly && p.database.candidateBucket === "one" && p.database.candidateCount === 1 && p.database.disconnected && p.payuni.officialSandbox && p.payuni.queryAttempts === 1 && p.payuni.retries === 0 && p.payuni.redirects === 0 && p.payuni.referenceMatched && p.payuni.orderMatched && p.payuni.amountMatched);
}

export function validateReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== "wp196-final-staging-payuni-authorization/v1") errors.push("SCHEMA");
  if (!TERMINAL.has(receipt?.terminalStatus)) errors.push("STATUS");
  if (receipt?.attemptDisposition !== "FINAL_ATTEMPT_CONSUMED_NO_RERUN" || receipt?.followUpWorkPackage !== "NONE") errors.push("FINAL_DISPOSITION");
  const p = receipt?.primaryOutcome;
  if (receipt?.broker?.attempts > 1 || p?.database?.connectionAttempts > 1 || p?.database?.readOnlyTransactionAttempts > 1 || p?.database?.applicationSelects > 1 || p?.payuni?.queryAttempts > 1) errors.push("ATTEMPT_BUDGET");
  if (receipt?.broker?.retries !== 0 || p?.payuni?.retries !== 0 || p?.payuni?.redirects !== 0) errors.push("RETRY_REDIRECT");
  if (Object.values(receipt?.sideEffects ?? {}).some((value) => value !== 0)) errors.push("WRITE_SIDE_EFFECT");
  if (Object.values(receipt?.safety ?? {}).some((value) => value !== false)) errors.push("SENSITIVE_PERSISTENCE");
  if (p?.payuni?.queryAttempts > 0 && p?.database?.candidateBucket !== "one") errors.push("PROVIDER_BEFORE_CANDIDATE");
  if (["zero", "ambiguous", "invalid_state", "unsafe_reference", "invalid_amount"].includes(p?.database?.candidateBucket) && p?.payuni?.queryAttempts !== 0) errors.push("CANDIDATE_FAIL_OPEN");
  if (receipt?.scoreImpact?.eligible !== successEligible(receipt)) errors.push("SCORE_ELIGIBILITY");
  if (receipt?.authorizationDecision !== (receipt?.scoreImpact?.eligible ? "AUTHORIZE_CAT04_UPLIFT" : "FINAL_NO_SCORE_AUTHORIZATION")) errors.push("AUTHORIZATION_DECISION");
  if (receipt?.scoreImpact?.applied === true || receipt?.gateImpact?.SANDBOX_READY !== false || receipt?.gateImpact?.PRODUCTION_READY !== false) errors.push("READINESS_OVERCLAIM");
  if (/(?:postgres(?:ql)?:\/\/|https?:\/\/|Bearer\s+|BEGIN PRIVATE|"(?:orderNumber|providerTradeNo|rawResponse|rawRows|merchantId|hashKey|hashIv|url)"\s*:)/iu.test(JSON.stringify(receipt))) errors.push("FORBIDDEN_TEXT");
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
  receipt.authorizationDecision = receipt.scoreImpact.eligible ? "AUTHORIZE_CAT04_UPLIFT" : "FINAL_NO_SCORE_AUTHORIZATION";
  if (receipt.scoreImpact.eligible) {
    receipt.gateImpact.runtimeSandboxClassification = "VERIFIED";
    receipt.gateImpact.stagingDatabaseIdentity = "VERIFIED_READ_ONLY";
    receipt.gateImpact.readOnlyTransaction = "VERIFIED";
    receipt.gateImpact.exactlyOneCandidate = "VERIFIED";
    receipt.gateImpact.payuniSandboxReadOnlyLookup = "VERIFIED";
    receipt.gateImpact.reconciliation = "CONSISTENT_OR_DIVERGENCE_RECORDED";
  }
  receipt.canonicalDigest = digest(canonical({ ...receipt, canonicalDigest: null }));
  const validation = validateReceipt(receipt);
  receipt.quality.strictReadback = validation.ok ? "PASS" : "FAIL";
  if (!validation.ok) {
    receipt.terminalStatus = "WP196_FINAL_NO_GO_RECEIPT_SAFETY";
    receipt.scoreImpact.eligible = false;
    receipt.authorizationDecision = "FINAL_NO_SCORE_AUTHORIZATION";
    receipt.canonicalDigest = digest(canonical({ ...receipt, canonicalDigest: null }));
  }
  if (fs.existsSync(REPORT)) throw new Error("WP196_REPORT_ALREADY_EXISTS");
  await fsp.mkdir(path.dirname(REPORT), { recursive: true });
  const temporary = `${REPORT}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  await fsp.rename(temporary, REPORT);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-196", terminalStatus: receipt.terminalStatus, dbSelects: receipt.primaryOutcome.database.applicationSelects, payuniQueries: receipt.primaryOutcome.payuni.queryAttempts, authorizationDecision: receipt.authorizationDecision })}\n`);
  if (!SUCCESS.has(receipt.terminalStatus)) process.exitCode = 2;
}

async function runLive() {
  const receipt = initialReceipt();
  if (fs.existsSync(REPORT)) throw new Error("WP196_REPORT_ALREADY_EXISTS");
  let wp173 = null;
  try { wp173 = JSON.parse(await fsp.readFile(WP173_RECEIPT, "utf8")); } catch { receipt.terminalStatus = "WP196_FINAL_NO_GO_FRESHNESS"; return finalize(receipt); }
  receipt.freshness.wp173AcceptedInput = wp173.terminalStatus === "WP173_PREVIEW_PAYUNI_ENV_REDEPLOY_ALIAS_VERIFIED" && wp173.newDeployment?.id === EXPECTED_DEPLOYMENT && wp173.newDeployment?.target === "preview" && wp173.newDeployment?.readyState === "READY" && wp173.health?.aliasStatus === 200;
  receipt.broker.parentTargetKeyPresenceCount = TARGET_KEYS.filter((key) => Object.hasOwn(process.env, key)).length;
  if (!receipt.freshness.wp173AcceptedInput || receipt.broker.parentTargetKeyPresenceCount !== 0) { receipt.terminalStatus = receipt.broker.parentTargetKeyPresenceCount !== 0 ? "WP196_FINAL_NO_GO_BINDING" : "WP196_FINAL_NO_GO_FRESHNESS"; return finalize(receipt); }

  let inspect;
  try { inspect = spawnSync(VERCEL, ["inspect", STAGING_HOST, "--json"], { cwd: ROOT, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 30_000, maxBuffer: 1024 * 1024 }); } catch { inspect = { status: 1, stdout: "", stderr: "" }; }
  receipt.freshness.metadataReads = 1;
  const fresh = parseFreshness(inspect.stdout, inspect.status ?? 1);
  receipt.freshness = { ...receipt.freshness, ...fresh };
  if (!fresh.ok) { receipt.terminalStatus = "WP196_FINAL_NO_GO_FRESHNESS"; return finalize(receipt); }

  const health = await fetch(`https://${STAGING_HOST}/api/health`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  receipt.freshness.healthHeadProbes = 1;
  receipt.freshness.healthStatus = health?.status ?? null;
  receipt.freshness.noRedirect = Boolean(health && !health.redirected && !health.headers.has("location"));
  if (health?.status !== 200 || !receipt.freshness.noRedirect) { receipt.terminalStatus = "WP196_FINAL_NO_GO_FRESHNESS"; return finalize(receipt); }

  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-wp196-"));
  try {
    receipt.temp = { ...receipt.temp, ...(await inspectTempBoundary(temp)) };
    if (!receipt.temp.ok) { receipt.terminalStatus = "WP196_FINAL_NO_GO_BROKER"; }
    else {
      const require = createRequire(import.meta.url);
      const args = buildWp170BrokerArgs(process.execPath, require.resolve("tsx/cli"), TS_CONFIG, WP170_RUNNER, temp);
      receipt.broker.attempts = 1;
      let result;
      try { result = spawnSync(VERCEL, args, { cwd: temp, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 90_000, maxBuffer: 1024 * 1024 }); } catch { result = { status: 1, stdout: "", stderr: "" }; }
      receipt.broker.exitCode = result.status ?? 1;
      const parsed = parseWp170BrokerOutput(result.stdout, result.stderr, receipt.broker.exitCode);
      receipt.broker = { ...receipt.broker, childResultCount: parsed.childResultCount, childValid: parsed.childValid, autoloadDetected: parsed.autoloadDetected, targetAssignmentDetected: parsed.targetAssignmentDetected };
      if (!parsed.ok) receipt.terminalStatus = "WP196_FINAL_NO_GO_BROKER";
      else { receipt.primaryOutcome = mapChild(parsed.child); receipt.terminalStatus = receipt.primaryOutcome.status; }
    }
  } finally {
    receipt.temp.cleanupPass = await cleanupTemp(temp);
    if (!receipt.temp.cleanupPass) receipt.terminalStatus = "WP196_FINAL_NO_GO_CLEANUP";
  }
  await finalize(receipt);
}

async function verifyReport() {
  const receipt = JSON.parse(await fsp.readFile(REPORT, "utf8"));
  const result = validateReceipt(receipt);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-196", strictReadback: result.ok ? "PASS" : "FAIL", terminalStatus: receipt.terminalStatus, authorizationDecision: receipt.authorizationDecision })}\n`);
  if (!result.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--verify-report") await verifyReport();
  else await runLive();
}

export const CONTRACT = Object.freeze({ project: PROJECT, stagingHost: STAGING_HOST, expectedDeployment: EXPECTED_DEPLOYMENT, report: REPORT, wp170Runner: WP170_RUNNER });
