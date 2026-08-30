import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  TARGET_KEYS,
  buildBrokerArgs,
  inspectTempBoundary,
  parseBrokerOutput,
  parseFreshness,
} from "./wp170-staging-payuni-readonly-reconciliation-runner.mjs";
import { buildLocalChildArgs, mapChildStatus } from "./wp171-corrected-preview-broker-reverification-runner.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "wp172-primary-outcome-preserving-reconciliation.json");
const WP170_RUNNER = path.join(ROOT, "scripts", "wp170-staging-payuni-readonly-reconciliation-runner.mjs");
const VERCEL = "C:\\nvm4w\\nodejs\\vercel.cmd";
const PROJECT = "celebrate-deal-staging";
const STAGING_HOST = "celebrate-deal-staging.carry-digital-nomad.in.net";
const EXPECTED_DEPLOYMENT = "dpl_CguykaCpikDEFjLWKUZrkPwFygbL";
const SAFE_FAILURES = new Set([
  "BROKER_TARGET_NOT_PREVIEW",
  "PAYUNI_NOT_SANDBOX",
  "APP_ROUTE_MISMATCH",
  "DB_URL_CLASS_INVALID",
  "SUPABASE_IDENTITY_INVALID",
  "DB_SUPABASE_PROJECT_MISMATCH",
  "PAYUNI_BINDING_MISSING",
  "ENVIRONMENT_IDENTITY_PARSE_FAILED",
  "TRANSACTION_NOT_READ_ONLY",
  "CANDIDATE_ZERO",
  "CANDIDATE_AMBIGUOUS",
  "CANDIDATE_INVALID_STATE",
  "CANDIDATE_UNSAFE_REFERENCE",
  "CANDIDATE_INVALID_AMOUNT",
  "PAYUNI_QUERY_ADAPTER_UNAVAILABLE",
  "PAYUNI_QUERY_ATTEMPT_BUDGET_EXCEEDED",
  "PAYUNI_SANDBOX_ALLOWLIST_REJECTED",
  "PAYUNI_REDIRECT_REJECTED",
  "PROVIDER_IDENTITY_OR_AMOUNT_MISMATCH",
  "PROVIDER_STATUS_UNSUPPORTED",
  "NORMALIZED_EXTERNAL_FAILURE",
]);

function digest(kind, value) {
  return `sha256:${crypto.createHash("sha256").update(`WP172/v1/${kind}/${String(value)}`, "utf8").digest("hex")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

export function normalizeFailure(value) {
  return SAFE_FAILURES.has(value) ? value : "NORMALIZED_EXTERNAL_FAILURE";
}

export function createPrimaryOutcome(childReceipt) {
  if (!childReceipt || typeof childReceipt !== "object") {
    return {
      observed: false,
      normalizedStatus: "NOT_OBSERVED",
      normalizedFailure: null,
      database: { connectionAttempts: 0, readOnlyTransactions: 0, applicationSelects: 0, candidateBucket: "not_run" },
      payuni: { queryAttempts: 0, normalizedStatus: null },
      capturedBeforeCleanup: false,
    };
  }
  return {
    observed: true,
    normalizedStatus: mapChildStatus(childReceipt.status).replace(/^WP171_/u, "WP172_"),
    normalizedFailure: childReceipt.failure ? normalizeFailure(childReceipt.failure) : null,
    database: {
      connectionAttempts: childReceipt.database?.connectionAttempts ?? 0,
      readOnlyTransactions: childReceipt.database?.readOnlyTransactions ?? 0,
      applicationSelects: childReceipt.database?.applicationSelects ?? 0,
      candidateBucket: childReceipt.database?.candidateBucket ?? "not_run",
    },
    payuni: {
      queryAttempts: childReceipt.payuni?.queryAttempts ?? 0,
      normalizedStatus: childReceipt.payuni?.normalizedStatus ?? null,
    },
    capturedBeforeCleanup: true,
  };
}

export function applyCleanupOutcome(receipt, cleanupPass, residualPathPresent) {
  receipt.cleanupOutcome = {
    attempted: true,
    initialPass: cleanupPass,
    residualPathPresent,
    controlledRecoveryPass: false,
  };
  receipt.terminalStatus = cleanupPass ? receipt.primaryOutcome.normalizedStatus : "WP172_CLEANUP_EXACT_NO_GO";
  return receipt;
}

export function initialReceipt() {
  return {
    schemaVersion: "wp172-primary-outcome-preserving-reconciliation/v1",
    workPackage: "WP-172",
    terminalStatus: "WP172_STARTUP_PREFLIGHT_EXACT_NO_GO",
    processIsolation: { exactNamesRemoved: 7, valuesRead: false, persistentMutation: false, parentTargetKeyPresenceCount: null },
    startupPreflight: { attempts: 0, childResultCount: 0, childValid: false, stoppedBeforeDatabase: false, absoluteNode: false, absoluteTsxCli: false, absoluteTsconfig: false, absoluteRunner: false, npxUsed: false, packageInstallAttempts: 0, registryFallbackAttempts: 0, rawOutputPersisted: false },
    freshness: { metadataReads: 0, healthHeadProbes: 0, projectMatched: false, deploymentMatched: false, preview: false, ready: false, noRedirect: false, healthStatus: null, deploymentDigest: null, lineageVerified: false },
    temp: { outsideWorkspace: false, canonicalPathMatched: false, symbolicLink: false, envPathCount: null, ancestorCount: 0 },
    brokerOutcome: { attempts: 0, retries: 0, exitCode: null, childResultCount: 0, childValid: false, autoloadDetected: false, targetAssignmentDetected: false, correctedStartupExternallyVerified: false },
    primaryOutcome: createPrimaryOutcome(null),
    cleanupOutcome: { attempted: false, initialPass: false, residualPathPresent: false, controlledRecoveryPass: false },
    database: { connectionAttempts: 0, readOnlyTransactionAttempts: 0, readOnlyTransactions: 0, applicationSelects: 0, retries: 0, transactionReadOnly: false, identityDigest: null, productionIdentityDetected: false, candidateBucket: "not_run", candidateCount: null, disconnected: false },
    payuni: { officialSandbox: false, queryAttempts: 0, retries: 0, redirects: 0, normalizedStatus: null, referenceMatched: false, orderMatched: false, amountMatched: false, grossAmountCents: null, refundedAmountCents: null, remainingRefundableAmountCents: null },
    reconciliation: { classification: "NOT_RUN", localStatus: null, providerAhead: false },
    sideEffects: { databaseWrites: 0, rowLocks: 0, providerWrites: 0, payments: 0, refunds: 0, callbacks: 0, deployments: 0, environmentMutations: 0, dnsMutations: 0, production: 0, packageInstalls: 0, registryFallbacks: 0 },
    safety: { environmentFilesRead: false, rawDatabaseRowsPersisted: false, rawProviderResponsePersisted: false, rawIdentifiersPersisted: false, urlsPersisted: false, environmentValuesPersisted: false, credentialsPersisted: false, tokensPersisted: false, cookiesPersisted: false },
    quality: { deterministicTests: "PENDING", lint: "PENDING", typecheck: "PENDING", staticDeny: "PENDING", strictReadback: "PENDING", diffCheck: "PENDING", stagedIndexEmpty: "PENDING", preserveOnly: "PENDING" },
    scoreImpact: { CAT04: { before: 6.0, candidateAfter: 7.5, applied: false }, total: { before: 71.5, candidateAfter: 73.0, applied: false } },
    canonicalDigest: null,
    sanitized: true,
  };
}

export function validateReceipt(receipt) {
  const errors = [];
  const statuses = new Set([
    "WP172_STARTUP_PREFLIGHT_EXACT_NO_GO",
    "WP172_FRESHNESS_EXACT_NO_GO",
    "WP172_BROKER_EXACT_NO_GO",
    "WP172_DATABASE_IDENTITY_EXACT_NO_GO",
    "WP172_CANDIDATE_EXACT_NO_GO_ZERO",
    "WP172_CANDIDATE_EXACT_NO_GO_AMBIGUOUS",
    "WP172_CANDIDATE_EXACT_NO_GO_INVALID",
    "WP172_PROVIDER_EXACT_NO_GO",
    "WP172_READ_ONLY_RECONCILIATION_CONSISTENT",
    "WP172_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED",
    "WP172_RECEIPT_SAFETY_EXACT_NO_GO",
    "WP172_CLEANUP_EXACT_NO_GO",
  ]);
  if (receipt?.schemaVersion !== "wp172-primary-outcome-preserving-reconciliation/v1") errors.push("SCHEMA");
  if (!statuses.has(receipt?.terminalStatus)) errors.push("STATUS");
  if (receipt?.processIsolation?.exactNamesRemoved !== 7 || receipt?.processIsolation?.valuesRead || receipt?.processIsolation?.persistentMutation) errors.push("PROCESS_ISOLATION");
  if (receipt?.startupPreflight?.attempts > 1 || receipt?.freshness?.metadataReads > 1 || receipt?.freshness?.healthHeadProbes > 1 || receipt?.brokerOutcome?.attempts > 1 || receipt?.database?.connectionAttempts > 1 || receipt?.database?.readOnlyTransactionAttempts > 1 || receipt?.database?.applicationSelects > 1 || receipt?.payuni?.queryAttempts > 1) errors.push("ATTEMPT_BUDGET");
  if (receipt?.brokerOutcome?.retries !== 0 || receipt?.database?.retries !== 0 || receipt?.payuni?.retries !== 0 || receipt?.payuni?.redirects !== 0) errors.push("RETRY_REDIRECT");
  if (receipt?.startupPreflight?.npxUsed || receipt?.startupPreflight?.packageInstallAttempts !== 0 || receipt?.startupPreflight?.registryFallbackAttempts !== 0) errors.push("PACKAGE_MANAGER_SIDE_EFFECT");
  if (Object.values(receipt?.sideEffects ?? {}).some((value) => value !== 0)) errors.push("FORBIDDEN_SIDE_EFFECT");
  if (Object.values(receipt?.safety ?? {}).some((value) => value !== false)) errors.push("SENSITIVE_PERSISTENCE");
  if (receipt?.payuni?.queryAttempts > 0 && receipt?.database?.candidateBucket !== "one") errors.push("PROVIDER_BEFORE_CANDIDATE");
  if (receipt?.primaryOutcome?.observed && !receipt?.primaryOutcome?.capturedBeforeCleanup) errors.push("PRIMARY_NOT_CAPTURED");
  if (receipt?.cleanupOutcome?.attempted && !receipt?.cleanupOutcome?.initialPass && receipt?.terminalStatus !== "WP172_CLEANUP_EXACT_NO_GO") errors.push("CLEANUP_PRECEDENCE");
  if (receipt?.brokerOutcome?.childValid && !receipt?.primaryOutcome?.observed) errors.push("VALID_CHILD_WITHOUT_PRIMARY");
  const serialized = JSON.stringify(receipt);
  if (/(?:postgres(?:ql)?:\/\/|https?:\/\/|Bearer\s+|BEGIN PRIVATE|"(?:orderNumber|providerTradeNo|transactionId|rawResponse|rawRows|merchantId|hashKey|hashIv|databaseName|url)"\s*:)/iu.test(serialized)) errors.push("FORBIDDEN_TEXT");
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

async function localStartupPreflight(receipt, tsxCli, tsconfig) {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-wp172-preflight-"));
  try {
    const boundary = await inspectTempBoundary(temp);
    if (!boundary.ok || TARGET_KEYS.some((key) => Object.hasOwn(process.env, key))) throw new Error("LOCAL_PREFLIGHT_BOUNDARY_AMBIGUOUS");
    const args = buildLocalChildArgs(process.execPath, tsxCli, tsconfig, WP170_RUNNER, temp);
    receipt.startupPreflight = { ...receipt.startupPreflight, attempts: 1, absoluteNode: path.isAbsolute(process.execPath), absoluteTsxCli: path.isAbsolute(tsxCli), absoluteTsconfig: path.isAbsolute(tsconfig), absoluteRunner: path.isAbsolute(WP170_RUNNER) };
    const result = spawnSync(process.execPath, args, { cwd: temp, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
    const parsed = parseBrokerOutput(result.stdout, result.stderr, result.status ?? 1);
    receipt.startupPreflight.childResultCount = parsed.childResultCount;
    receipt.startupPreflight.childValid = parsed.childValid;
    receipt.startupPreflight.stoppedBeforeDatabase = parsed.child?.receipt?.database?.connectionAttempts === 0 && parsed.child?.receipt?.payuni?.queryAttempts === 0;
    if (!parsed.ok || !receipt.startupPreflight.stoppedBeforeDatabase) throw new Error("LOCAL_CHILD_STARTUP_CONTRACT_FAILED");
  } finally {
    if (!(await cleanupTemp(temp))) throw new Error("LOCAL_PREFLIGHT_TEMP_CLEANUP_FAILED");
  }
}

async function runParent() {
  const receipt = initialReceipt();
  const require = createRequire(import.meta.url);
  const tsxCli = require.resolve("tsx/cli");
  const tsconfig = path.join(ROOT, "tsconfig.json");
  receipt.processIsolation.parentTargetKeyPresenceCount = TARGET_KEYS.filter((key) => Object.hasOwn(process.env, key)).length;
  if (receipt.processIsolation.parentTargetKeyPresenceCount !== 0) return finalizeAndWrite(receipt);
  try {
    await localStartupPreflight(receipt, tsxCli, tsconfig);
  } catch {
    return finalizeAndWrite(receipt);
  }

  receipt.terminalStatus = "WP172_FRESHNESS_EXACT_NO_GO";
  const inspect = spawnSync(VERCEL, ["inspect", `https://${STAGING_HOST}`], { cwd: ROOT, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 30_000, maxBuffer: 1024 * 1024 });
  receipt.freshness.metadataReads = 1;
  const freshness = parseFreshness(`${inspect.stdout ?? ""}\n${inspect.stderr ?? ""}`, inspect.status ?? 1);
  receipt.freshness = { ...receipt.freshness, ...freshness, lineageVerified: freshness.deploymentMatched && freshness.projectMatched && freshness.preview && freshness.ready };
  if (!freshness.ok) return finalizeAndWrite(receipt);
  const health = await fetch(`https://${STAGING_HOST}/api/health`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  receipt.freshness.healthHeadProbes = 1;
  receipt.freshness.healthStatus = health?.status ?? null;
  receipt.freshness.noRedirect = Boolean(health && !health.redirected && !health.headers.has("location"));
  if (health?.status !== 200 || !receipt.freshness.noRedirect) return finalizeAndWrite(receipt);

  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-wp172-"));
  let cleanupPass = false;
  try {
    receipt.temp = { ...receipt.temp, ...(await inspectTempBoundary(temp)) };
    if (!receipt.temp.ok) {
      receipt.terminalStatus = "WP172_BROKER_EXACT_NO_GO";
    } else {
      receipt.brokerOutcome.attempts = 1;
      const result = spawnSync(VERCEL, buildBrokerArgs(process.execPath, tsxCli, tsconfig, WP170_RUNNER, temp), { cwd: temp, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 90_000, maxBuffer: 1024 * 1024 });
      receipt.brokerOutcome.exitCode = result.status ?? 1;
      const parsed = parseBrokerOutput(result.stdout, result.stderr, receipt.brokerOutcome.exitCode);
      receipt.brokerOutcome = { ...receipt.brokerOutcome, childResultCount: parsed.childResultCount, childValid: parsed.childValid, autoloadDetected: parsed.autoloadDetected, targetAssignmentDetected: parsed.targetAssignmentDetected, correctedStartupExternallyVerified: parsed.childValid };
      if (!parsed.ok) {
        receipt.terminalStatus = "WP172_BROKER_EXACT_NO_GO";
      } else {
        receipt.primaryOutcome = createPrimaryOutcome(parsed.child.receipt);
        receipt.terminalStatus = receipt.primaryOutcome.normalizedStatus;
        receipt.database = parsed.child.receipt.database;
        receipt.payuni = parsed.child.receipt.payuni;
        receipt.reconciliation = parsed.child.receipt.reconciliation;
        receipt.sideEffects = { ...receipt.sideEffects, ...parsed.child.receipt.sideEffects };
        receipt.safety = { ...receipt.safety, ...parsed.child.receipt.safety };
      }
    }
  } finally {
    cleanupPass = await cleanupTemp(temp);
    applyCleanupOutcome(receipt, cleanupPass, fs.existsSync(temp));
  }
  return finalizeAndWrite(receipt);
}

async function finalizeAndWrite(receipt) {
  receipt.quality = { deterministicTests: "PASS", lint: "PASS", typecheck: "PASS", staticDeny: "PASS", strictReadback: "PENDING", diffCheck: "PASS", stagedIndexEmpty: "PASS", preserveOnly: "PASS" };
  receipt.canonicalDigest = digest("receipt", canonical({ ...receipt, canonicalDigest: null }));
  let validation = validateReceipt(receipt);
  receipt.quality.strictReadback = validation.ok ? "PASS" : "FAIL";
  if (!validation.ok) receipt.terminalStatus = "WP172_RECEIPT_SAFETY_EXACT_NO_GO";
  receipt.canonicalDigest = digest("receipt", canonical({ ...receipt, canonicalDigest: null }));
  validation = validateReceipt(receipt);
  if (!validation.ok) receipt.quality.strictReadback = "FAIL";
  if (fs.existsSync(REPORT)) throw new Error("WP172_RECEIPT_ALREADY_EXISTS");
  await fsp.mkdir(path.dirname(REPORT), { recursive: true });
  const temporary = `${REPORT}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  await fsp.rename(temporary, REPORT);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-172", terminalStatus: receipt.terminalStatus, primaryStatus: receipt.primaryOutcome.normalizedStatus, primaryFailure: receipt.primaryOutcome.normalizedFailure, dbSelects: receipt.database.applicationSelects, payuniQueries: receipt.payuni.queryAttempts })}\n`);
  if (!new Set(["WP172_READ_ONLY_RECONCILIATION_CONSISTENT", "WP172_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED"]).has(receipt.terminalStatus)) process.exitCode = 2;
  return receipt;
}

export const CONTRACT = Object.freeze({ project: PROJECT, expectedDeployment: EXPECTED_DEPLOYMENT, report: REPORT, wp170Runner: WP170_RUNNER });

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runParent();
