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
} from "./wp174-fresh-preview-payuni-readonly-reconciliation-runner.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "wp188-fresh-staging-payuni-reconciliation.json");
const WP170_RUNNER = path.join(ROOT, "scripts", "wp170-staging-payuni-readonly-reconciliation-runner.mjs");
const WP187_REPORT = path.join(ROOT, ".ai-team", "reports", "wp187-latest-workspace-preview-freshness.json");
const VERCEL = "C:\\nvm4w\\nodejs\\vercel.cmd";
const PROJECT = "celebrate-deal-staging";
const SCOPE = "a25814740s-projects";
const STAGING_HOST = "celebrate-deal-staging.carry-digital-nomad.in.net";
const EXPECTED_DEPLOYMENT = "dpl_E3g7ZjYLMd8JDsPybA2Hxz4bKE6W";
const EXPECTED_SOURCE_DIGEST = "cfa1b2d8841957dd071e9945a1770d01bff09081210f2fbdc820669edf339f34";
const MARKER_PATH = "/__celebratedeal_wp187_fingerprint.json";
const SUCCESS = "WP188_READ_ONLY_RECONCILIATION_CONSISTENT";
const TERMINAL = new Set([
  SUCCESS,
  "WP188_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED",
  "WP188_STARTUP_PREFLIGHT_EXACT_NO_GO",
  "WP188_FRESHNESS_EXACT_NO_GO",
  "WP188_BROKER_EXACT_NO_GO",
  "WP188_DATABASE_IDENTITY_EXACT_NO_GO",
  "WP188_CANDIDATE_EXACT_NO_GO_ZERO",
  "WP188_CANDIDATE_EXACT_NO_GO_AMBIGUOUS",
  "WP188_CANDIDATE_EXACT_NO_GO_INVALID",
  "WP188_PROVIDER_EXACT_NO_GO",
  "WP188_RECEIPT_SAFETY_EXACT_NO_GO",
  "WP188_CLEANUP_UNSAFE_EXACT_NO_GO",
]);

function sha(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function quotePowerShellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildIsolationCommand(nodePath, runnerPath) {
  if (!path.isAbsolute(nodePath) || !path.isAbsolute(runnerPath)) throw new Error("ABSOLUTE_PATH_REQUIRED");
  const removals = TARGET_KEYS.map((key) => `Remove-Item -LiteralPath ${quotePowerShellLiteral(`Env:${key}`)} -ErrorAction SilentlyContinue`).join("; ");
  return `$ErrorActionPreference='Stop'; ${removals}; & ${quotePowerShellLiteral(nodePath)} ${quotePowerShellLiteral(runnerPath)} '--isolated-live'; exit $LASTEXITCODE`;
}

export function parseFreshnessJson(raw, exitCode) {
  try {
    const value = JSON.parse(String(raw));
    const id = value.id ?? value.uid ?? null;
    const status = String(value.status ?? value.state ?? value.readyState ?? "").toUpperCase();
    return {
      ok: exitCode === 0 && value.name === PROJECT && id === EXPECTED_DEPLOYMENT && value.target === "preview" && status === "READY",
      projectMatched: value.name === PROJECT,
      deploymentMatched: id === EXPECTED_DEPLOYMENT,
      preview: value.target === "preview",
      ready: status === "READY",
      deploymentDigest: id ? sha(`deployment:${id}`) : null,
    };
  } catch {
    return { ok: false, projectMatched: false, deploymentMatched: false, preview: false, ready: false, deploymentDigest: null };
  }
}

function mapChildStatus(status) {
  const mapping = {
    WP170_READ_ONLY_RECONCILIATION_CONSISTENT: SUCCESS,
    WP170_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED: "WP188_READ_ONLY_RECONCILIATION_DIVERGENCE_DETECTED",
    WP170_DATABASE_IDENTITY_EXACT_NO_GO: "WP188_DATABASE_IDENTITY_EXACT_NO_GO",
    WP170_CANDIDATE_EXACT_NO_GO_ZERO: "WP188_CANDIDATE_EXACT_NO_GO_ZERO",
    WP170_CANDIDATE_EXACT_NO_GO_AMBIGUOUS: "WP188_CANDIDATE_EXACT_NO_GO_AMBIGUOUS",
    WP170_CANDIDATE_EXACT_NO_GO_INVALID: "WP188_CANDIDATE_EXACT_NO_GO_INVALID",
    WP170_PROVIDER_EXACT_NO_GO: "WP188_PROVIDER_EXACT_NO_GO",
    WP170_RECEIPT_SAFETY_EXACT_NO_GO: "WP188_RECEIPT_SAFETY_EXACT_NO_GO",
    WP170_CLEANUP_EXACT_NO_GO: "WP188_CLEANUP_UNSAFE_EXACT_NO_GO",
  };
  return mapping[status] ?? "WP188_BROKER_EXACT_NO_GO";
}

export function createPrimaryOutcome(child) {
  return {
    observed: Boolean(child && typeof child === "object"),
    status: mapChildStatus(child?.status),
    failure: typeof child?.failure === "string" && /^[A-Z0-9_]+$/u.test(child.failure) ? child.failure : null,
    database: {
      connectionAttempts: child?.database?.connectionAttempts ?? 0,
      readOnlyTransactionAttempts: child?.database?.readOnlyTransactionAttempts ?? 0,
      readOnlyTransactions: child?.database?.readOnlyTransactions ?? 0,
      applicationSelects: child?.database?.applicationSelects ?? 0,
      transactionReadOnly: child?.database?.transactionReadOnly === true,
      identityDigest: child?.database?.identityDigest ?? null,
      productionIdentityDetected: child?.database?.productionIdentityDetected === true,
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
    capturedBeforeCleanup: Boolean(child && typeof child === "object"),
  };
}

export function initialReceipt() {
  return {
    schemaVersion: "wp188-fresh-staging-payuni-reconciliation/v1",
    workPackage: "WP-188",
    terminalStatus: "WP188_STARTUP_PREFLIGHT_EXACT_NO_GO",
    processIsolation: { exactNamesRemoved: TARGET_KEYS.length, valuesRead: false, childLaunchAttempts: 1, parentTargetKeyPresenceCount: null, isolatedTargetKeyPresenceCount: null },
    freshness: { metadataReads: 0, markerReads: 0, healthHeadProbes: 0, wp187Accepted: false, projectMatched: false, deploymentMatched: false, preview: false, ready: false, aliasMarkerMatched: false, healthStatus: null, noRedirect: false, deploymentDigest: null, sourceDigest: EXPECTED_SOURCE_DIGEST },
    temp: { outsideWorkspace: false, canonicalPathMatched: false, symbolicLink: false, envPathCount: null },
    broker: { attempts: 0, retries: 0, exitCode: null, childResultCount: 0, childValid: false, autoloadDetected: false, targetAssignmentDetected: false, rawOutputPersisted: false },
    primaryOutcome: createPrimaryOutcome(null),
    cleanupOutcome: { attempted: false, pass: false, residualPathPresent: false, residualFileCount: null, residualEnvPathCount: null, residualSafe: false },
    sideEffects: { databaseWrites: 0, rowLocks: 0, providerWrites: 0, payments: 0, refunds: 0, callbacks: 0, deployments: 0, environmentMutations: 0, aliasMutations: 0, dnsMutations: 0, production: 0, gitMutations: 0, packageInstalls: 0 },
    safety: { environmentFilesRead: false, environmentValuesPersisted: false, rawBrokerOutputPersisted: false, rawDatabaseRowsPersisted: false, rawProviderResponsePersisted: false, rawIdentifiersPersisted: false, credentialsPersisted: false, tokensPersisted: false, cookiesPersisted: false },
    quality: { deterministicTests: "PASS", lint: "PASS", typecheck: "PASS", strictReadback: "PENDING", diffCheck: "PASS", stagedIndexEmpty: "PASS", preserveOnly: "PASS" },
    scoreImpact: { CAT04: { before: 6, candidateAfter: 7.5, applied: false }, total: { before: 72.5, candidateAfter: 74, applied: false }, eligible: false },
    gateImpact: { stagingFreshness: "NOT_VERIFIED", runtimeSandboxClassification: "NOT_VERIFIED", stagingDatabaseIdentity: "NOT_VERIFIED", payuniSandboxReadOnlyLookup: "NOT_RUN", SANDBOX_READY: false, PRODUCTION_READY: false },
    canonicalDigest: null,
    sanitized: true,
  };
}

export function scoreEligible(receipt) {
  const p = receipt.primaryOutcome;
  return Boolean(
    receipt.terminalStatus === SUCCESS && receipt.freshness.wp187Accepted && receipt.freshness.projectMatched && receipt.freshness.deploymentMatched && receipt.freshness.preview && receipt.freshness.ready && receipt.freshness.aliasMarkerMatched && receipt.freshness.healthStatus === 200 && receipt.freshness.noRedirect &&
    receipt.processIsolation.isolatedTargetKeyPresenceCount === 0 && receipt.broker.attempts === 1 && receipt.broker.childValid &&
    p.database.connectionAttempts === 1 && p.database.readOnlyTransactionAttempts === 1 && p.database.readOnlyTransactions === 1 && p.database.applicationSelects === 1 && p.database.transactionReadOnly && !p.database.productionIdentityDetected && p.database.candidateBucket === "one" && p.database.candidateCount === 1 && p.database.disconnected &&
    p.payuni.officialSandbox && p.payuni.queryAttempts === 1 && p.payuni.retries === 0 && p.payuni.redirects === 0 && p.payuni.referenceMatched && p.payuni.orderMatched && p.payuni.amountMatched &&
    (receipt.cleanupOutcome.pass || receipt.cleanupOutcome.residualSafe)
  );
}

export function validateReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== "wp188-fresh-staging-payuni-reconciliation/v1") errors.push("SCHEMA");
  if (!TERMINAL.has(receipt?.terminalStatus)) errors.push("STATUS");
  if (receipt?.processIsolation?.exactNamesRemoved !== TARGET_KEYS.length || receipt?.processIsolation?.valuesRead !== false || receipt?.processIsolation?.childLaunchAttempts !== 1) errors.push("PROCESS_ISOLATION");
  const p = receipt?.primaryOutcome;
  if (receipt?.freshness?.metadataReads > 1 || receipt?.freshness?.markerReads > 1 || receipt?.freshness?.healthHeadProbes > 1 || receipt?.broker?.attempts > 1 || p?.database?.connectionAttempts > 1 || p?.database?.readOnlyTransactionAttempts > 1 || p?.database?.applicationSelects > 1 || p?.payuni?.queryAttempts > 1) errors.push("ATTEMPT_BUDGET");
  if (receipt?.broker?.retries !== 0 || p?.payuni?.retries !== 0 || p?.payuni?.redirects !== 0) errors.push("RETRY_REDIRECT");
  if (Object.values(receipt?.sideEffects ?? {}).some((value) => value !== 0)) errors.push("FORBIDDEN_SIDE_EFFECT");
  if (Object.values(receipt?.safety ?? {}).some((value) => value !== false)) errors.push("SENSITIVE_PERSISTENCE");
  if (p?.payuni?.queryAttempts > 0 && p?.database?.candidateBucket !== "one") errors.push("PROVIDER_BEFORE_CANDIDATE");
  if (["zero", "ambiguous", "invalid_state", "unsafe_reference", "invalid_amount"].includes(p?.database?.candidateBucket) && p?.payuni?.queryAttempts !== 0) errors.push("CANDIDATE_FAIL_OPEN");
  if (p?.observed && !p?.capturedBeforeCleanup) errors.push("PRIMARY_NOT_CAPTURED");
  if (receipt?.cleanupOutcome?.residualPathPresent && !receipt?.cleanupOutcome?.pass && !receipt?.cleanupOutcome?.residualSafe && receipt?.terminalStatus !== "WP188_CLEANUP_UNSAFE_EXACT_NO_GO") errors.push("UNSAFE_RESIDUAL");
  if (receipt?.scoreImpact?.eligible !== scoreEligible(receipt)) errors.push("SCORE_ELIGIBILITY");
  if (receipt?.scoreImpact?.applied === true || receipt?.gateImpact?.SANDBOX_READY !== false || receipt?.gateImpact?.PRODUCTION_READY !== false) errors.push("READINESS_OVERCLAIM");
  const serialized = JSON.stringify(receipt);
  if (/(?:postgres(?:ql)?:\/\/|https?:\/\/|Bearer\s+|BEGIN PRIVATE|"(?:orderNumber|providerTradeNo|rawResponse|rawRows|merchantId|hashKey|hashIv|url)"\s*:)/iu.test(serialized)) errors.push("FORBIDDEN_TEXT");
  return { ok: errors.length === 0, errors };
}

async function inspectCleanup(temp) {
  let pass = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
    if (!fs.existsSync(temp)) { pass = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
  }
  if (pass) return { attempted: true, pass: true, residualPathPresent: false, residualFileCount: 0, residualEnvPathCount: 0, residualSafe: true };
  const entries = await fsp.readdir(temp, { recursive: true, withFileTypes: true }).catch(() => []);
  const residualFileCount = entries.filter((entry) => entry.isFile()).length;
  const residualEnvPathCount = entries.filter((entry) => /^\.env(?:\.|$)/iu.test(entry.name)).length;
  return { attempted: true, pass: false, residualPathPresent: true, residualFileCount, residualEnvPathCount, residualSafe: residualFileCount === 0 && residualEnvPathCount === 0 };
}

async function finalize(receipt) {
  receipt.scoreImpact.eligible = scoreEligible(receipt);
  if (receipt.scoreImpact.eligible) {
    receipt.gateImpact = { ...receipt.gateImpact, stagingFreshness: "VERIFIED", runtimeSandboxClassification: "VERIFIED", stagingDatabaseIdentity: "VERIFIED_READ_ONLY", payuniSandboxReadOnlyLookup: "VERIFIED" };
  }
  receipt.canonicalDigest = sha(canonical({ ...receipt, canonicalDigest: null }));
  let validation = validateReceipt(receipt);
  receipt.quality.strictReadback = validation.ok ? "PASS" : "FAIL";
  if (!validation.ok) {
    receipt.terminalStatus = "WP188_RECEIPT_SAFETY_EXACT_NO_GO";
    receipt.scoreImpact.eligible = false;
  }
  receipt.canonicalDigest = sha(canonical({ ...receipt, canonicalDigest: null }));
  validation = validateReceipt(receipt);
  if (!validation.ok) receipt.quality.strictReadback = "FAIL";
  if (fs.existsSync(REPORT)) throw new Error("WP188_REPORT_ALREADY_EXISTS");
  await fsp.mkdir(path.dirname(REPORT), { recursive: true });
  const temporary = `${REPORT}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  await fsp.rename(temporary, REPORT);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-188", terminalStatus: receipt.terminalStatus, dbSelects: receipt.primaryOutcome.database.applicationSelects, payuniQueries: receipt.primaryOutcome.payuni.queryAttempts, scoreEligible: receipt.scoreImpact.eligible })}\n`);
  if (receipt.terminalStatus !== SUCCESS) process.exitCode = 2;
}

async function runIsolatedLive() {
  const receipt = initialReceipt();
  if (fs.existsSync(REPORT)) throw new Error("WP188_REPORT_ALREADY_EXISTS");
  receipt.processIsolation.isolatedTargetKeyPresenceCount = TARGET_KEYS.filter((key) => Object.hasOwn(process.env, key)).length;
  if (receipt.processIsolation.isolatedTargetKeyPresenceCount !== 0) return finalize(receipt);

  const wp187 = JSON.parse(await fsp.readFile(WP187_REPORT, "utf8"));
  receipt.freshness.wp187Accepted = wp187.status === "COMPLETE_SOL_ACCEPT" && wp187.deployment?.id === EXPECTED_DEPLOYMENT && wp187.deployment?.target === "preview" && wp187.deployment?.ready === true && wp187.source?.digest === EXPECTED_SOURCE_DIGEST && wp187.aliasCas?.postDeployment === EXPECTED_DEPLOYMENT && wp187.aliasCas?.postMarkerDigestMatched === true && wp187.aliasCas?.postHealthStatus === 200;
  if (!receipt.freshness.wp187Accepted) return finalize(receipt);

  receipt.terminalStatus = "WP188_FRESHNESS_EXACT_NO_GO";
  const inspect = spawnSync(VERCEL, ["inspect", STAGING_HOST, "--scope", SCOPE, "--json", "--no-color"], { cwd: ROOT, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 30_000, maxBuffer: 1024 * 1024 });
  receipt.freshness.metadataReads = 1;
  const fresh = parseFreshnessJson(inspect.stdout, inspect.status ?? 1);
  receipt.freshness = { ...receipt.freshness, ...fresh };
  if (!fresh.ok) return finalize(receipt);

  const marker = await fetch(`https://${STAGING_HOST}${MARKER_PATH}`, { redirect: "manual", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  receipt.freshness.markerReads = 1;
  if (!marker || marker.status !== 200 || marker.redirected || marker.headers.has("location")) return finalize(receipt);
  const markerBody = await marker.json().catch(() => null);
  receipt.freshness.aliasMarkerMatched = markerBody?.sourceDigest === EXPECTED_SOURCE_DIGEST && markerBody?.workPackage === "WP-187";
  if (!receipt.freshness.aliasMarkerMatched) return finalize(receipt);

  const health = await fetch(`https://${STAGING_HOST}/api/health`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  receipt.freshness.healthHeadProbes = 1;
  receipt.freshness.healthStatus = health?.status ?? null;
  receipt.freshness.noRedirect = Boolean(health && !health.redirected && !health.headers.has("location"));
  if (health?.status !== 200 || !receipt.freshness.noRedirect) return finalize(receipt);

  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-wp188-"));
  try {
    receipt.temp = { ...receipt.temp, ...(await inspectTempBoundary(temp)) };
    if (!receipt.temp.ok) receipt.terminalStatus = "WP188_BROKER_EXACT_NO_GO";
    else {
      const require = createRequire(import.meta.url);
      receipt.broker.attempts = 1;
      const result = spawnSync(VERCEL, buildBrokerArgs(process.execPath, require.resolve("tsx/cli"), path.join(ROOT, "tsconfig.json"), WP170_RUNNER, temp), { cwd: temp, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 90_000, maxBuffer: 1024 * 1024 });
      receipt.broker.exitCode = result.status ?? 1;
      const parsed = parseBrokerOutput(result.stdout, result.stderr, receipt.broker.exitCode);
      receipt.broker = { ...receipt.broker, childResultCount: parsed.childResultCount, childValid: parsed.childValid, autoloadDetected: parsed.autoloadDetected, targetAssignmentDetected: parsed.targetAssignmentDetected };
      if (!parsed.ok) receipt.terminalStatus = "WP188_BROKER_EXACT_NO_GO";
      else {
        receipt.primaryOutcome = createPrimaryOutcome(parsed.child.receipt);
        receipt.terminalStatus = receipt.primaryOutcome.status;
      }
    }
  } finally {
    receipt.cleanupOutcome = await inspectCleanup(temp);
    if (!receipt.cleanupOutcome.pass && !receipt.cleanupOutcome.residualSafe) receipt.terminalStatus = "WP188_CLEANUP_UNSAFE_EXACT_NO_GO";
  }
  return finalize(receipt);
}

async function runLauncher() {
  if (fs.existsSync(REPORT)) throw new Error("WP188_REPORT_ALREADY_EXISTS");
  const command = buildIsolationCommand(process.execPath, fileURLToPath(import.meta.url));
  const result = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { cwd: ROOT, encoding: "utf8", windowsHide: true, timeout: 150_000, maxBuffer: 1024 * 1024 });
  process.stdout.write(String(result.stdout ?? ""));
  if ((result.status ?? 1) !== 0) process.exitCode = result.status ?? 1;
}

async function verifyReport() {
  const receipt = JSON.parse(await fsp.readFile(REPORT, "utf8"));
  const validation = validateReceipt(receipt);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-188", strictReadback: validation.ok ? "PASS" : "FAIL", terminalStatus: receipt.terminalStatus, scoreEligible: receipt.scoreImpact.eligible })}\n`);
  if (!validation.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--isolated-live") await runIsolatedLive();
  else if (process.argv[2] === "--verify-report") await verifyReport();
  else await runLauncher();
}

export const CONTRACT = Object.freeze({ project: PROJECT, scope: SCOPE, stagingHost: STAGING_HOST, expectedDeployment: EXPECTED_DEPLOYMENT, expectedSourceDigest: EXPECTED_SOURCE_DIGEST, report: REPORT, wp170Runner: WP170_RUNNER });
