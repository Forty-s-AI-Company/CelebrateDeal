import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { verifyDeployment } from "./secure-staging-runner.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TASK = "wp4-payuni-sandbox-reconciliation";
const RECEIPT_NAME = `${TASK}-receipt.json`;
const CHILD_PREFIX = "SECURE_WP4_RESULT:";
const SAFE_SHA = /^[a-f0-9]{40}$/u;
const SAFE_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/u;
const PURPOSES = Object.freeze(["buyer_order", "platform_subscription", "invoice_payment"]);

// These names are intentionally public contract metadata. Values stay only in
// the protected runner environment and are never printed or persisted.
export const REQUIRED_SECRET_KEYS = Object.freeze([
  "STAGING_DATABASE_URL",
  "PAYUNI_MERCHANT_ID",
  "PAYUNI_HASH_KEY",
  "PAYUNI_HASH_IV",
  "PAYUNI_SANDBOX_ONETIME_CARD_NO",
  "PAYUNI_TEST_EXPIRY",
  "PAYUNI_TEST_CVV",
]);
export const REQUIRED_CONFIG_KEYS = Object.freeze([
  "NEXT_PUBLIC_SUPABASE_URL",
  "CELEBRATEDEAL_SOURCE_SHA",
  "CELEBRATEDEAL_DEPLOYMENT_HOST",
  "RUNNER_TEMP",
  "PAYUNI_SANDBOX_REFUND_ENABLED",
  "AI_TEAM_AUTHORIZATION_RECORD_REF",
  "AI_TEAM_OWNER_REF",
  "AI_TEAM_SCOPE_REF",
  "AI_TEAM_NEW_EXECUTION_APPROVED",
  "AI_TEAM_NON_PRODUCTION",
  "AI_TEAM_FORBIDDEN_PROBE_REUSE",
  "AI_TEAM_PROVIDER_ENVIRONMENT",
]);

const ACTIVE_SECRET_KEYS = Object.freeze(["GITHUB_TOKEN"]);
const ACTIVE_CONFIG_KEYS = Object.freeze([
  "CELEBRATEDEAL_SOURCE_SHA",
  "CELEBRATEDEAL_DEPLOYMENT_HOST",
  "RUNNER_TEMP",
]);

export const FIXED_PREREQUISITE_GAPS = Object.freeze([
  "FIXED_PRODUCT_FLOW_EXECUTOR_UNAVAILABLE",
  "OWNER_SESSION_OR_SYNTHETIC_SETUP_UNAVAILABLE",
  "FIXED_SANDBOX_REFUND_EXECUTOR_UNAVAILABLE",
]);

const TOP_KEYS = ["schemaVersion", "task", "sourceCommit", "result", "executedAtUtc", "lineage", "environment", "prerequisites", "purposes", "reconciliation", "network", "safety", "sideEffects", "failureCategory"];
const PURPOSE_KEYS = ["purpose", "candidateCount", "localStatus", "providerStatus", "referenceMatched", "orderMatched", "amountMatched", "refundMatched", "projectionMatched", "duplicateSideEffectsAbsent", "outOfOrderFailClosed", "overRefundRejected", "failureOrCancellationObserved", "status"];
const NESTED_KEYS = Object.freeze({
  lineage: ["deploymentReads", "deploymentMatched", "sourceMatched", "preview", "ready", "healthStatus", "noRedirect"],
  environment: ["requiredBindingsPresent", "payuniSandbox", "stagingDatabaseMatched", "productionDetected"],
  prerequisites: ["requiredSecretBindings", "requiredConfigBindings", "fixedTask", "exactPreviewLineage", "fixedHostEgress", "sterileChildEnvironment", "gaps"],
  reconciliation: ["callbackConsistency", "duplicateRejected", "outOfOrderFailClosed", "overRefundRejected", "allPurposesMatched"],
  network: ["policy", "githubDeployments", "stagingPreview", "supabaseStaging", "payuniSandbox", "arbitraryOutbound"],
  safety: ["sanitized", "envFilesRead", "envEnumerated", "secretValuesPrinted", "secretValuesPersisted", "rawOutputPersisted", "rawDatabaseRowsPersisted", "rawProviderResponsePersisted", "customerOrPaymentDataPersisted"],
  sideEffects: ["databaseConnections", "databaseReads", "databaseWrites", "providerQueries", "providerWrites", "transactionsCreated", "payments", "refunds", "callbackReplays", "deployments", "aliasMutations", "productionOperations"],
});

function hasValue(source, key) {
  return typeof source?.[key] === "string" && source[key].length > 0;
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function exactArray(value, expected) {
  return Array.isArray(value) && value.join("\0") === expected.join("\0");
}

function systemEnvironment(source = process.env) {
  return Object.fromEntries(
    ["PATH", "HOME", "USERPROFILE", "TMP", "TEMP", "RUNNER_TEMP", "SystemRoot", "ComSpec", "PATHEXT"]
      .filter((key) => hasValue(source, key))
      .map((key) => [key, source[key]]),
  );
}

export function validateInvocation(task, source = process.env) {
  if (task !== TASK) return { ok: false, reason: "TASK_NOT_ALLOWLISTED" };
  if (![...ACTIVE_SECRET_KEYS, ...ACTIVE_CONFIG_KEYS].every((key) => hasValue(source, key))) {
    return { ok: false, reason: "REQUIRED_BINDING_MISSING" };
  }
  if (!SAFE_SHA.test(source.CELEBRATEDEAL_SOURCE_SHA)) return { ok: false, reason: "SOURCE_SHA_INVALID" };
  if (!SAFE_HOST.test(source.CELEBRATEDEAL_DEPLOYMENT_HOST) || !source.CELEBRATEDEAL_DEPLOYMENT_HOST.endsWith(".vercel.app")) {
    return { ok: false, reason: "DEPLOYMENT_HOST_INVALID" };
  }
  return { ok: true, reason: null };
}

function initialPurpose(purpose) {
  return {
    purpose,
    candidateCount: 0,
    localStatus: "NOT_RUN",
    providerStatus: "NOT_RUN",
    referenceMatched: false,
    orderMatched: false,
    amountMatched: false,
    refundMatched: false,
    projectionMatched: false,
    duplicateSideEffectsAbsent: false,
    outOfOrderFailClosed: false,
    overRefundRejected: false,
    failureOrCancellationObserved: false,
    status: "NOT_RUN",
  };
}

export function createInitialReceipt(sourceCommit = "unknown") {
  return {
    schemaVersion: "celebratedeal-secure-staging-wp4/v3",
    task: TASK,
    sourceCommit: SAFE_SHA.test(sourceCommit) ? sourceCommit : "unknown",
    result: "BLOCKED",
    executedAtUtc: new Date().toISOString(),
    lineage: { deploymentReads: 0, deploymentMatched: false, sourceMatched: false, preview: false, ready: false, healthStatus: null, noRedirect: false },
    environment: { requiredBindingsPresent: false, payuniSandbox: false, stagingDatabaseMatched: false, productionDetected: false },
    prerequisites: {
      requiredSecretBindings: [...REQUIRED_SECRET_KEYS],
      requiredConfigBindings: [...REQUIRED_CONFIG_KEYS],
      fixedTask: true,
      exactPreviewLineage: false,
      fixedHostEgress: true,
      sterileChildEnvironment: true,
      gaps: [...FIXED_PREREQUISITE_GAPS],
    },
    purposes: PURPOSES.map(initialPurpose),
    reconciliation: { callbackConsistency: false, duplicateRejected: false, outOfOrderFailClosed: false, overRefundRejected: false, allPurposesMatched: false },
    network: { policy: "fixed-host-egress", githubDeployments: true, stagingPreview: true, supabaseStaging: false, payuniSandbox: false, arbitraryOutbound: false },
    safety: { sanitized: true, envFilesRead: false, envEnumerated: false, secretValuesPrinted: false, secretValuesPersisted: false, rawOutputPersisted: false, rawDatabaseRowsPersisted: false, rawProviderResponsePersisted: false, customerOrPaymentDataPersisted: false },
    sideEffects: { databaseConnections: 0, databaseReads: 0, databaseWrites: 0, providerQueries: 0, providerWrites: 0, transactionsCreated: 0, payments: 0, refunds: 0, callbackReplays: 0, deployments: 0, aliasMutations: 0, productionOperations: 0 },
    failureCategory: "FIXED_EXECUTION_PREREQUISITES_UNAVAILABLE",
  };
}

export function validateReceipt(receipt) {
  const errors = [];
  if (!exactKeys(receipt, TOP_KEYS)) errors.push("SCHEMA_KEYS");
  for (const [key, keys] of Object.entries(NESTED_KEYS)) {
    if (!exactKeys(receipt?.[key], keys)) errors.push(`SCHEMA_${key.toUpperCase()}`);
  }
  if (receipt?.schemaVersion !== "celebratedeal-secure-staging-wp4/v3" || receipt?.task !== TASK) errors.push("SCHEMA");
  if (!SAFE_SHA.test(receipt?.sourceCommit ?? "")) errors.push("SOURCE");
  if (receipt?.result !== "BLOCKED") errors.push("RESULT_MUST_BE_BLOCKED");
  if (Number.isNaN(Date.parse(receipt?.executedAtUtc ?? ""))) errors.push("EXECUTED_AT");
  if (receipt?.failureCategory !== "FIXED_EXECUTION_PREREQUISITES_UNAVAILABLE") errors.push("FAILURE_CATEGORY");
  if (!exactArray(receipt?.prerequisites?.requiredSecretBindings, REQUIRED_SECRET_KEYS) || !exactArray(receipt?.prerequisites?.requiredConfigBindings, REQUIRED_CONFIG_KEYS)) errors.push("PREREQUISITE_BINDINGS");
  if (receipt?.prerequisites?.fixedTask !== true || receipt?.prerequisites?.fixedHostEgress !== true || receipt?.prerequisites?.sterileChildEnvironment !== true || typeof receipt?.prerequisites?.exactPreviewLineage !== "boolean" || !exactArray(receipt?.prerequisites?.gaps, FIXED_PREREQUISITE_GAPS)) errors.push("PREREQUISITE_CONTRACT");
  if (!Array.isArray(receipt?.purposes) || receipt.purposes.length !== PURPOSES.length || receipt.purposes.map((item) => item?.purpose).join("|") !== PURPOSES.join("|")) errors.push("PURPOSES");
  for (const item of receipt?.purposes ?? []) {
    if (!exactKeys(item, PURPOSE_KEYS)) errors.push("PURPOSE_SCHEMA");
    if (item?.candidateCount !== 0 || item?.localStatus !== "NOT_RUN" || item?.providerStatus !== "NOT_RUN" || item?.status !== "NOT_RUN") errors.push("PURPOSE_MUST_NOT_RUN");
    if (["referenceMatched", "orderMatched", "amountMatched", "refundMatched", "projectionMatched", "duplicateSideEffectsAbsent", "outOfOrderFailClosed", "overRefundRejected", "failureOrCancellationObserved"].some((key) => item?.[key] !== false)) errors.push("PURPOSE_EVIDENCE_MUST_BE_FALSE");
  }
  const lineageProven = receipt?.lineage?.deploymentReads > 0
    && receipt?.lineage?.deploymentMatched === true
    && receipt?.lineage?.sourceMatched === true
    && receipt?.lineage?.preview === true
    && receipt?.lineage?.ready === true
    && receipt?.lineage?.healthStatus === 200
    && receipt?.lineage?.noRedirect === true;
  const lineageNotRun = receipt?.lineage?.deploymentReads === 0
    && receipt?.lineage?.deploymentMatched === false
    && receipt?.lineage?.sourceMatched === false
    && receipt?.lineage?.preview === false
    && receipt?.lineage?.ready === false
    && receipt?.lineage?.healthStatus === null
    && receipt?.lineage?.noRedirect === false;
  if ((!lineageProven && !lineageNotRun) || receipt?.prerequisites?.exactPreviewLineage !== lineageProven) errors.push("LINEAGE_CONTRACT");
  if (receipt?.environment?.requiredBindingsPresent !== false || receipt?.environment?.payuniSandbox !== false || receipt?.environment?.stagingDatabaseMatched !== false || receipt?.environment?.productionDetected !== false) errors.push("ENVIRONMENT_MUST_NOT_RUN");
  if (Object.values(receipt?.reconciliation ?? {}).some((value) => value !== false)) errors.push("RECONCILIATION_MUST_NOT_RUN");
  if (receipt?.network?.policy !== "fixed-host-egress" || receipt?.network?.arbitraryOutbound !== false || receipt?.network?.payuniSandbox !== false || receipt?.network?.supabaseStaging !== false) errors.push("NETWORK_POLICY");
  if (receipt?.safety?.sanitized !== true || Object.entries(receipt?.safety ?? {}).some(([key, value]) => key !== "sanitized" && value !== false)) errors.push("SENSITIVE_PERSISTENCE");
  if (Object.values(receipt?.sideEffects ?? {}).some((value) => value !== 0)) errors.push("SIDE_EFFECTS_MUST_BE_ZERO");
  const serialized = JSON.stringify(receipt);
  if (/(?:postgres(?:ql)?:\/\/|https?:\/\/|Bearer\s+|BEGIN\s+(?:RSA|OPENSSH|EC)\s+PRIVATE\s+KEY|set-cookie|EncryptInfo|HashInfo|MerchantId|providerTradeNo|orderNumber|transactionReference)/iu.test(serialized)) errors.push("FORBIDDEN_TEXT");
  return { ok: errors.length === 0, errors };
}

function childEnvironment(source) {
  return {
    ...systemEnvironment(source),
    CELEBRATEDEAL_SOURCE_SHA: source.CELEBRATEDEAL_SOURCE_SHA,
  };
}

export function parseChildOutput(stdout, exitCode) {
  const nonEmpty = String(stdout ?? "").split(/\r?\n/u).filter(Boolean);
  const lines = nonEmpty.filter((line) => line.startsWith(CHILD_PREFIX));
  if (exitCode !== 2 || lines.length !== 1 || nonEmpty.length !== 1) return { ok: false, reason: "CHILD_OUTPUT_INVALID" };
  try {
    const receipt = JSON.parse(lines[0].slice(CHILD_PREFIX.length));
    const validation = validateReceipt(receipt);
    return validation.ok ? { ok: true, receipt } : { ok: false, reason: "CHILD_RECEIPT_INVALID" };
  } catch {
    return { ok: false, reason: "CHILD_OUTPUT_UNREADABLE" };
  }
}

async function writeReceipt(receipt, runnerTemp) {
  const directory = path.resolve(runnerTemp, "celebratedeal-secure-receipts");
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const receiptPath = path.join(directory, RECEIPT_NAME);
  await fsp.writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return receiptPath;
}

async function runParent(source) {
  let receipt = createInitialReceipt(source.CELEBRATEDEAL_SOURCE_SHA);
  const invocation = validateInvocation(TASK, source);
  if (!invocation.ok) return writeReceipt(receipt, source.RUNNER_TEMP);
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child"], {
    cwd: ROOT,
    env: childEnvironment(source),
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 64 * 1024,
  });
  const parsed = parseChildOutput(child.stdout, child.status ?? 1);
  if (parsed.ok) receipt = parsed.receipt;
  try {
    const lineage = await verifyDeployment(source);
    const health = await fetch(`https://${lineage.host}/api/health`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    const noRedirect = health.status === 200 && !health.headers.has("location");
    receipt.lineage = {
      deploymentReads: lineage.reads,
      deploymentMatched: lineage.deploymentMatched,
      sourceMatched: lineage.sourceMatched,
      preview: lineage.preview,
      ready: lineage.ready,
      healthStatus: health.status,
      noRedirect,
    };
    receipt.prerequisites.exactPreviewLineage = Boolean(
      lineage.deploymentMatched && lineage.sourceMatched && lineage.preview && lineage.ready && noRedirect,
    );
  } catch {
    // Keep the canonical receipt blocked and value-free when lineage cannot
    // be proven. The missing executor remains the primary release blocker.
  }
  return writeReceipt(receipt, source.RUNNER_TEMP);
}

async function main() {
  if (process.argv[2] === "--child") {
    process.stdout.write(`${CHILD_PREFIX}${JSON.stringify(createInitialReceipt(process.env.CELEBRATEDEAL_SOURCE_SHA))}\n`);
    process.exitCode = 2;
    return;
  }
  const receiptPath = await runParent({
    ...systemEnvironment(),
    ...Object.fromEntries([...ACTIVE_SECRET_KEYS, ...ACTIVE_CONFIG_KEYS].map((key) => [key, process.env[key]])),
  });
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  process.stdout.write(`secure_staging_wp4=${receipt.result}\n`);
  process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { process.exitCode = 2; });
