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
const SESSION_COOKIE_NAME = "celebrate_session";
const WP4_SESSION_TTL_SECONDS = 15 * 60;
export const WP4_NETWORK_REQUEST_TIMEOUT_MS = 10_000;
export const WP4_CHILD_TIMEOUT_MS = 45_000;
export const WP4_CHILD_MAX_REQUESTS = 4;

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
  "JOB_SECRET",
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

const ACTIVE_SECRET_KEYS = Object.freeze(["GITHUB_TOKEN", "JOB_SECRET"]);
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
export const OWNER_SESSION_COMPLETE_GAPS = Object.freeze([
  "FIXED_PRODUCT_FLOW_EXECUTOR_UNAVAILABLE",
  "FIXED_SANDBOX_REFUND_EXECUTOR_UNAVAILABLE",
]);

export const DIAGNOSTIC_CATEGORIES = Object.freeze([
  "NOT_RUN",
  "REQUIRED_BINDING_MISSING",
  "SOURCE_SHA_INVALID",
  "DEPLOYMENT_HOST_INVALID",
  "GITHUB_DEPLOYMENT_READ_FAILED",
  "GITHUB_DEPLOYMENT_AMBIGUOUS",
  "GITHUB_DEPLOYMENT_STATUS_READ_FAILED",
  "GITHUB_DEPLOYMENT_LINEAGE_MISMATCH",
  "STAGING_HEALTH_FAILED",
  "CHILD_EXECUTION_FAILED",
  "CHILD_OUTPUT_INVALID",
  "CHILD_OUTPUT_UNREADABLE",
  "CHILD_RECEIPT_INVALID",
  "FIXED_EXECUTION_PREREQUISITES_UNAVAILABLE",
  "RECEIPT_VALIDATION_FAILED",
  "UNCLASSIFIED_INTERNAL_FAILURE",
]);

const TOP_KEYS = ["schemaVersion", "task", "sourceCommit", "result", "executedAtUtc", "lineage", "fixturePreflight", "ownerSession", "environment", "prerequisites", "purposes", "reconciliation", "network", "safety", "sideEffects", "failureCategory", "diagnosticCategory"];
const PURPOSE_KEYS = ["purpose", "candidateCount", "localStatus", "providerStatus", "referenceMatched", "orderMatched", "amountMatched", "refundMatched", "projectionMatched", "duplicateSideEffectsAbsent", "outOfOrderFailClosed", "overRefundRejected", "failureOrCancellationObserved", "status"];
const FIXTURE_PREFLIGHT_KEYS = ["requests", "outcome", "responseAccepted", "buyerOrderReady", "platformSubscriptionReady", "invoicePaymentReady"];
const FIXTURE_PREFLIGHT_FAILURE_OUTCOMES = new Set([
  "AUTHORIZATION_REJECTED",
  "DISABLED_OR_FIXTURE_UNAVAILABLE",
  "EXECUTOR_DISABLED",
  "FIXTURE_UNAVAILABLE",
  "CONFIGURATION_UNAVAILABLE",
  "HTTP_REJECTED",
  "RESPONSE_INVALID",
  "NETWORK_FAILED",
]);
const OWNER_SESSION_KEYS = ["bootstrapRequests", "bootstrapAuthenticated", "sessionCookieCount", "sessionCreationAttempts", "sessionCreationOutcome", "sessionRowsCreated", "sessionTtlSeconds", "userRowsUpdated", "plansProbeRequests", "plansProbeAuthenticated", "invoicesProbeRequests", "invoicesProbeAuthenticated"];
const CHILD_RESULT_KEYS = ["fixturePreflight", "ownerSession"];
const NESTED_KEYS = Object.freeze({
  lineage: ["deploymentReads", "deploymentMatched", "sourceMatched", "preview", "ready", "healthStatus", "noRedirect"],
  fixturePreflight: FIXTURE_PREFLIGHT_KEYS,
  ownerSession: OWNER_SESSION_KEYS,
  environment: ["requiredBindingsPresent", "payuniSandbox", "stagingDatabaseMatched", "productionDetected"],
  prerequisites: ["requiredSecretBindings", "requiredConfigBindings", "fixedTask", "exactPreviewLineage", "fixedHostEgress", "sterileChildEnvironment", "gaps"],
  reconciliation: ["callbackConsistency", "duplicateRejected", "outOfOrderFailClosed", "overRefundRejected", "allPurposesMatched"],
  network: ["policy", "githubDeployments", "stagingPreview", "supabaseStaging", "payuniSandbox", "arbitraryOutbound"],
  safety: ["sanitized", "envFilesRead", "envEnumerated", "secretValuesPrinted", "secretValuesPersisted", "rawOutputPersisted", "rawDatabaseRowsPersisted", "rawProviderResponsePersisted", "customerOrPaymentDataPersisted"],
  sideEffects: ["sessionCreationAttempts", "sessionCreationOutcome", "sessionRowsCreated", "sessionTtlSeconds", "userRowsUpdated", "providerQueries", "providerWrites", "transactionsCreated", "payments", "refunds", "callbackReplays", "deployments", "aliasMutations", "productionOperations"],
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

function initialFixturePreflight() {
  return {
    requests: 0,
    outcome: "NOT_RUN",
    responseAccepted: false,
    buyerOrderReady: false,
    platformSubscriptionReady: false,
    invoicePaymentReady: false,
  };
}

function failedFixturePreflight(outcome = "HTTP_REJECTED") {
  return { ...initialFixturePreflight(), requests: 1, outcome };
}

function uncertainFixturePreflight() {
  return {
    requests: 1,
    outcome: "UNKNOWN",
    responseAccepted: null,
    buyerOrderReady: null,
    platformSubscriptionReady: null,
    invoicePaymentReady: null,
  };
}

function initialOwnerSession() {
  return {
    bootstrapRequests: 0,
    bootstrapAuthenticated: false,
    sessionCookieCount: 0,
    sessionCreationAttempts: 0,
    sessionCreationOutcome: "NOT_ATTEMPTED",
    sessionRowsCreated: 0,
    sessionTtlSeconds: 0,
    userRowsUpdated: 0,
    plansProbeRequests: 0,
    plansProbeAuthenticated: false,
    invoicesProbeRequests: 0,
    invoicesProbeAuthenticated: false,
  };
}

function uncertainOwnerSession() {
  return {
    ...initialOwnerSession(),
    bootstrapRequests: 1,
    sessionCreationAttempts: 1,
    sessionCreationOutcome: "UNKNOWN",
    sessionRowsCreated: null,
    sessionTtlSeconds: WP4_SESSION_TTL_SECONDS,
  };
}

function fixedPreviewUrl(host, pathname) {
  return `https://${host}${pathname}`;
}

function responseMatches(response, host, pathname, status) {
  if (!response || response.status !== status || response.headers?.has("location")) return false;
  try {
    const url = new URL(response.url);
    return url.protocol === "https:"
      && url.host === host
      && url.pathname === pathname
      && url.search === ""
      && url.hash === ""
      && url.username === ""
      && url.password === "";
  } catch {
    return false;
  }
}

async function discardResponseBody(response) {
  try {
    await response?.body?.cancel();
  } catch {
    // The response body is never parsed or persisted. A closed stream is safe.
  }
}

function captureSessionCookie(headers) {
  const values = typeof headers?.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers?.get?.("set-cookie")].filter((value) => typeof value === "string" && value.length > 0);
  if (values.length !== 1) throw new Error("SESSION_COOKIE_COUNT_INVALID");
  const match = /^celebrate_session=([A-Za-z0-9_-]{43});(?:\s|$)/u.exec(values[0]);
  if (!match) throw new Error("SESSION_COOKIE_INVALID");
  return `${SESSION_COOKIE_NAME}=${match[1]}`;
}

async function readBoundedJsonObject(response, maximumBytes = 1_024) {
  const reader = response?.body?.getReader?.();
  if (!reader) throw new Error("PREFLIGHT_BODY_UNAVAILABLE");
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error("PREFLIGHT_BODY_INVALID");
      total += value.byteLength;
      if (total > maximumBytes) throw new Error("PREFLIGHT_BODY_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The fixed response has already been bounded; cancellation is best effort.
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}

function ownerSessionState(owner) {
  if (!exactKeys(owner, OWNER_SESSION_KEYS)) return "INVALID";
  const notRun = owner.bootstrapRequests === 0 && owner.bootstrapAuthenticated === false
    && owner.sessionCookieCount === 0 && owner.sessionCreationAttempts === 0
    && owner.sessionCreationOutcome === "NOT_ATTEMPTED" && owner.sessionRowsCreated === 0
    && owner.sessionTtlSeconds === 0 && owner.userRowsUpdated === 0
    && owner.plansProbeRequests === 0 && owner.plansProbeAuthenticated === false
    && owner.invoicesProbeRequests === 0 && owner.invoicesProbeAuthenticated === false;
  const bootstrapFailed = owner.bootstrapRequests === 1 && owner.bootstrapAuthenticated === false
    && owner.sessionCookieCount === 0 && owner.sessionCreationAttempts === 1
    && owner.sessionCreationOutcome === "UNKNOWN" && owner.sessionRowsCreated === null
    && owner.sessionTtlSeconds === WP4_SESSION_TTL_SECONDS && owner.userRowsUpdated === 0
    && owner.plansProbeRequests === 0
    && owner.plansProbeAuthenticated === false && owner.invoicesProbeRequests === 0
    && owner.invoicesProbeAuthenticated === false;
  const plansFailed = owner.bootstrapRequests === 1 && owner.bootstrapAuthenticated === true
    && owner.sessionCookieCount === 1 && owner.sessionCreationAttempts === 1
    && owner.sessionCreationOutcome === "CONFIRMED" && owner.sessionRowsCreated === 1
    && owner.sessionTtlSeconds === WP4_SESSION_TTL_SECONDS && owner.userRowsUpdated === 0
    && owner.plansProbeRequests === 1
    && owner.plansProbeAuthenticated === false && owner.invoicesProbeRequests === 0
    && owner.invoicesProbeAuthenticated === false;
  const invoicesFailed = owner.bootstrapRequests === 1 && owner.bootstrapAuthenticated === true
    && owner.sessionCookieCount === 1 && owner.sessionCreationAttempts === 1
    && owner.sessionCreationOutcome === "CONFIRMED" && owner.sessionRowsCreated === 1
    && owner.sessionTtlSeconds === WP4_SESSION_TTL_SECONDS && owner.userRowsUpdated === 0
    && owner.plansProbeRequests === 1
    && owner.plansProbeAuthenticated === true && owner.invoicesProbeRequests === 1
    && owner.invoicesProbeAuthenticated === false;
  const complete = owner.bootstrapRequests === 1 && owner.bootstrapAuthenticated === true
    && owner.sessionCookieCount === 1 && owner.sessionCreationAttempts === 1
    && owner.sessionCreationOutcome === "CONFIRMED" && owner.sessionRowsCreated === 1
    && owner.sessionTtlSeconds === WP4_SESSION_TTL_SECONDS && owner.userRowsUpdated === 0
    && owner.plansProbeRequests === 1
    && owner.plansProbeAuthenticated === true && owner.invoicesProbeRequests === 1
    && owner.invoicesProbeAuthenticated === true;
  if (complete) return "COMPLETE";
  if (invoicesFailed) return "INVOICES_FAILED";
  if (plansFailed) return "PLANS_FAILED";
  if (bootstrapFailed) return "BOOTSTRAP_FAILED";
  if (notRun) return "NOT_RUN";
  return "INVALID";
}

function fixturePreflightState(preflight) {
  if (!exactKeys(preflight, FIXTURE_PREFLIGHT_KEYS)) return "INVALID";
  const notRun = preflight.requests === 0
    && preflight.outcome === "NOT_RUN"
    && preflight.responseAccepted === false
    && preflight.buyerOrderReady === false
    && preflight.platformSubscriptionReady === false
    && preflight.invoicePaymentReady === false;
  const failed = preflight.requests === 1
    && FIXTURE_PREFLIGHT_FAILURE_OUTCOMES.has(preflight.outcome)
    && preflight.responseAccepted === false
    && preflight.buyerOrderReady === false
    && preflight.platformSubscriptionReady === false
    && preflight.invoicePaymentReady === false;
  const complete = preflight.requests === 1
    && preflight.outcome === "ACCEPTED"
    && preflight.responseAccepted === true
    && preflight.buyerOrderReady === true
    && preflight.platformSubscriptionReady === true
    && preflight.invoicePaymentReady === true;
  const unknown = preflight.requests === 1
    && preflight.outcome === "UNKNOWN"
    && preflight.responseAccepted === null
    && preflight.buyerOrderReady === null
    && preflight.platformSubscriptionReady === null
    && preflight.invoicePaymentReady === null;
  if (complete) return "COMPLETE";
  if (unknown) return "UNKNOWN";
  if (failed) return "FAILED";
  if (notRun) return "NOT_RUN";
  return "INVALID";
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
    schemaVersion: "celebratedeal-secure-staging-wp4/v7",
    task: TASK,
    sourceCommit: SAFE_SHA.test(sourceCommit) ? sourceCommit : "unknown",
    result: "BLOCKED",
    executedAtUtc: new Date().toISOString(),
    lineage: { deploymentReads: 0, deploymentMatched: false, sourceMatched: false, preview: false, ready: false, healthStatus: null, noRedirect: false },
    fixturePreflight: initialFixturePreflight(),
    ownerSession: initialOwnerSession(),
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
    sideEffects: { sessionCreationAttempts: 0, sessionCreationOutcome: "NOT_ATTEMPTED", sessionRowsCreated: 0, sessionTtlSeconds: 0, userRowsUpdated: 0, providerQueries: 0, providerWrites: 0, transactionsCreated: 0, payments: 0, refunds: 0, callbackReplays: 0, deployments: 0, aliasMutations: 0, productionOperations: 0 },
    failureCategory: "FIXED_EXECUTION_PREREQUISITES_UNAVAILABLE",
    diagnosticCategory: "NOT_RUN",
  };
}

export function safeDiagnosticCategory(error, fallback = "UNCLASSIFIED_INTERNAL_FAILURE") {
  const candidate = typeof error === "string"
    ? error
    : typeof error?.message === "string"
      ? error.message
      : "";
  return DIAGNOSTIC_CATEGORIES.includes(candidate) ? candidate : fallback;
}

export function validateReceipt(receipt) {
  const errors = [];
  if (!exactKeys(receipt, TOP_KEYS)) errors.push("SCHEMA_KEYS");
  for (const [key, keys] of Object.entries(NESTED_KEYS)) {
    if (!exactKeys(receipt?.[key], keys)) errors.push(`SCHEMA_${key.toUpperCase()}`);
  }
  if (receipt?.schemaVersion !== "celebratedeal-secure-staging-wp4/v7" || receipt?.task !== TASK) errors.push("SCHEMA");
  if (!SAFE_SHA.test(receipt?.sourceCommit ?? "")) errors.push("SOURCE");
  if (receipt?.result !== "BLOCKED") errors.push("RESULT_MUST_BE_BLOCKED");
  if (Number.isNaN(Date.parse(receipt?.executedAtUtc ?? ""))) errors.push("EXECUTED_AT");
  if (receipt?.failureCategory !== "FIXED_EXECUTION_PREREQUISITES_UNAVAILABLE") errors.push("FAILURE_CATEGORY");
  if (!DIAGNOSTIC_CATEGORIES.includes(receipt?.diagnosticCategory)) errors.push("DIAGNOSTIC_CATEGORY");
  if (!exactArray(receipt?.prerequisites?.requiredSecretBindings, REQUIRED_SECRET_KEYS) || !exactArray(receipt?.prerequisites?.requiredConfigBindings, REQUIRED_CONFIG_KEYS)) errors.push("PREREQUISITE_BINDINGS");
  const fixtureState = fixturePreflightState(receipt?.fixturePreflight);
  const ownerState = ownerSessionState(receipt?.ownerSession);
  const expectedGaps = fixtureState === "COMPLETE" && ownerState === "COMPLETE"
    ? OWNER_SESSION_COMPLETE_GAPS
    : FIXED_PREREQUISITE_GAPS;
  if (receipt?.prerequisites?.fixedTask !== true || receipt?.prerequisites?.fixedHostEgress !== true || receipt?.prerequisites?.sterileChildEnvironment !== true || typeof receipt?.prerequisites?.exactPreviewLineage !== "boolean" || !exactArray(receipt?.prerequisites?.gaps, expectedGaps)) errors.push("PREREQUISITE_CONTRACT");
  if (ownerState === "INVALID") errors.push("OWNER_SESSION_CONTRACT");
  if (fixtureState === "INVALID") errors.push("FIXTURE_PREFLIGHT_CONTRACT");
  const ownerSequenceValid = (fixtureState === "COMPLETE" && ownerState !== "NOT_RUN" && ownerState !== "INVALID")
    || (fixtureState === "FAILED" && ownerState === "NOT_RUN")
    || (fixtureState === "UNKNOWN" && ownerState === "BOOTSTRAP_FAILED")
    || (fixtureState === "NOT_RUN" && ownerState === "NOT_RUN");
  if (!ownerSequenceValid) errors.push("OWNER_WITHOUT_FIXTURES");
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
  if (!lineageProven && (fixtureState !== "NOT_RUN" || ownerState !== "NOT_RUN")) errors.push("CHILD_WITHOUT_LINEAGE");
  if (receipt?.environment?.requiredBindingsPresent !== false || receipt?.environment?.payuniSandbox !== false || receipt?.environment?.stagingDatabaseMatched !== false || receipt?.environment?.productionDetected !== false) errors.push("ENVIRONMENT_MUST_NOT_RUN");
  if (Object.values(receipt?.reconciliation ?? {}).some((value) => value !== false)) errors.push("RECONCILIATION_MUST_NOT_RUN");
  if (receipt?.network?.policy !== "fixed-host-egress" || receipt?.network?.arbitraryOutbound !== false || receipt?.network?.payuniSandbox !== false || receipt?.network?.supabaseStaging !== false) errors.push("NETWORK_POLICY");
  if (receipt?.safety?.sanitized !== true || Object.entries(receipt?.safety ?? {}).some(([key, value]) => key !== "sanitized" && value !== false)) errors.push("SENSITIVE_PERSISTENCE");
  const expectedSessionEffects = ownerState === "NOT_RUN"
    ? { attempts: 0, outcome: "NOT_ATTEMPTED", rows: 0, ttl: 0 }
    : ownerState === "BOOTSTRAP_FAILED"
      ? { attempts: 1, outcome: "UNKNOWN", rows: null, ttl: WP4_SESSION_TTL_SECONDS }
      : { attempts: 1, outcome: "CONFIRMED", rows: 1, ttl: WP4_SESSION_TTL_SECONDS };
  if (receipt?.sideEffects?.sessionCreationAttempts !== expectedSessionEffects.attempts
    || receipt?.sideEffects?.sessionCreationOutcome !== expectedSessionEffects.outcome
    || receipt?.sideEffects?.sessionRowsCreated !== expectedSessionEffects.rows
    || receipt?.sideEffects?.sessionTtlSeconds !== expectedSessionEffects.ttl
    || receipt?.sideEffects?.userRowsUpdated !== 0) errors.push("SESSION_SIDE_EFFECTS");
  if (["providerQueries", "providerWrites", "transactionsCreated", "payments", "refunds", "callbackReplays", "deployments", "aliasMutations", "productionOperations"].some((key) => receipt?.sideEffects?.[key] !== 0)) errors.push("FORBIDDEN_SIDE_EFFECTS");
  const serialized = JSON.stringify(receipt);
  if (/(?:postgres(?:ql)?:\/\/|https?:\/\/|Bearer\s+|BEGIN\s+(?:RSA|OPENSSH|EC)\s+PRIVATE\s+KEY|set-cookie|celebrate_session|EncryptInfo|HashInfo|MerchantId|providerTradeNo|orderNumber|transactionReference)/iu.test(serialized)) errors.push("FORBIDDEN_TEXT");
  return { ok: errors.length === 0, errors };
}

export function childEnvironment(source) {
  return {
    ...systemEnvironment(source),
    JOB_SECRET: source.JOB_SECRET,
    CELEBRATEDEAL_SOURCE_SHA: source.CELEBRATEDEAL_SOURCE_SHA,
    CELEBRATEDEAL_DEPLOYMENT_HOST: source.CELEBRATEDEAL_DEPLOYMENT_HOST,
  };
}

export async function runFixturePreflight(source, fetchImpl = fetch) {
  const initial = initialFixturePreflight();
  if (!hasValue(source, "JOB_SECRET")
    || !SAFE_SHA.test(source.CELEBRATEDEAL_SOURCE_SHA ?? "")
    || !SAFE_HOST.test(source.CELEBRATEDEAL_DEPLOYMENT_HOST ?? "")
    || !source.CELEBRATEDEAL_DEPLOYMENT_HOST.endsWith(".vercel.app")) return initial;
  try {
    const pathname = "/api/admin/ops/payuni/wp4-preflight";
    const response = await fetchImpl(fixedPreviewUrl(source.CELEBRATEDEAL_DEPLOYMENT_HOST, pathname), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${source.JOB_SECRET}`,
        "x-celebratedeal-source-sha": source.CELEBRATEDEAL_SOURCE_SHA,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(WP4_NETWORK_REQUEST_TIMEOUT_MS),
    });
    const contentType = response.headers?.get?.("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (!responseMatches(response, source.CELEBRATEDEAL_DEPLOYMENT_HOST, pathname, 200)) {
      await discardResponseBody(response);
      const closedPreflightOutcome = response.headers?.get?.("x-celebratedeal-wp4-preflight");
      const outcome = response.status === 401
        ? "AUTHORIZATION_REJECTED"
        : response.status === 404
          ? closedPreflightOutcome === "EXECUTOR_DISABLED" || closedPreflightOutcome === "FIXTURE_UNAVAILABLE"
            ? closedPreflightOutcome
            : "DISABLED_OR_FIXTURE_UNAVAILABLE"
          : response.status === 503
            ? "CONFIGURATION_UNAVAILABLE"
            : "HTTP_REJECTED";
      return failedFixturePreflight(outcome);
    }
    if (contentType !== "application/json") {
      await discardResponseBody(response);
      return failedFixturePreflight("RESPONSE_INVALID");
    }
    const body = await readBoundedJsonObject(response);
    if (!exactKeys(body, ["ready", "buyerOrder", "platformSubscription", "invoicePayment"])
      || body.ready !== true
      || body.buyerOrder !== true
      || body.platformSubscription !== true
      || body.invoicePayment !== true) return failedFixturePreflight("RESPONSE_INVALID");
    return {
      requests: 1,
      outcome: "ACCEPTED",
      responseAccepted: true,
      buyerOrderReady: true,
      platformSubscriptionReady: true,
      invoicePaymentReady: true,
    };
  } catch {
    return failedFixturePreflight("NETWORK_FAILED");
  }
}

export async function runOwnerSession(source, fetchImpl = fetch) {
  let owner = initialOwnerSession();
  let sessionCookie = "";
  if (!hasValue(source, "JOB_SECRET")
    || !SAFE_SHA.test(source.CELEBRATEDEAL_SOURCE_SHA ?? "")
    || !SAFE_HOST.test(source.CELEBRATEDEAL_DEPLOYMENT_HOST ?? "")
    || !source.CELEBRATEDEAL_DEPLOYMENT_HOST.endsWith(".vercel.app")) return owner;
  try {
    owner = uncertainOwnerSession();
    const bootstrapPath = "/api/admin/ops/payuni/wp4-session";
    const bootstrap = await fetchImpl(fixedPreviewUrl(source.CELEBRATEDEAL_DEPLOYMENT_HOST, bootstrapPath), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${source.JOB_SECRET}`,
        "x-celebratedeal-source-sha": source.CELEBRATEDEAL_SOURCE_SHA,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(WP4_NETWORK_REQUEST_TIMEOUT_MS),
    });
    if (!responseMatches(bootstrap, source.CELEBRATEDEAL_DEPLOYMENT_HOST, bootstrapPath, 204)) {
      await discardResponseBody(bootstrap);
      return owner;
    }
    sessionCookie = captureSessionCookie(bootstrap.headers);
    owner.bootstrapAuthenticated = true;
    owner.sessionCookieCount = 1;
    owner.sessionCreationOutcome = "CONFIRMED";
    owner.sessionRowsCreated = 1;
    await discardResponseBody(bootstrap);

    for (const [pathname, requestKey, authenticatedKey] of [
      ["/billing/plans", "plansProbeRequests", "plansProbeAuthenticated"],
      ["/billing/invoices", "invoicesProbeRequests", "invoicesProbeAuthenticated"],
    ]) {
      owner[requestKey] = 1;
      const response = await fetchImpl(fixedPreviewUrl(source.CELEBRATEDEAL_DEPLOYMENT_HOST, pathname), {
        method: "GET",
        headers: { Cookie: sessionCookie },
        redirect: "manual",
        signal: AbortSignal.timeout(WP4_NETWORK_REQUEST_TIMEOUT_MS),
      });
      if (!responseMatches(response, source.CELEBRATEDEAL_DEPLOYMENT_HOST, pathname, 200)) {
        await discardResponseBody(response);
        return owner;
      }
      owner[authenticatedKey] = true;
      await discardResponseBody(response);
    }
    return owner;
  } catch {
    return owner;
  } finally {
    sessionCookie = "";
  }
}

export async function runWp4Child(source, fetchImpl = fetch) {
  const fixturePreflight = await runFixturePreflight(source, fetchImpl);
  const ownerSession = fixturePreflightState(fixturePreflight) === "COMPLETE"
    ? await runOwnerSession(source, fetchImpl)
    : initialOwnerSession();
  return { fixturePreflight, ownerSession };
}

export function parseChildOutput(stdout, exitCode) {
  const nonEmpty = String(stdout ?? "").split(/\r?\n/u).filter(Boolean);
  const lines = nonEmpty.filter((line) => line.startsWith(CHILD_PREFIX));
  if (exitCode !== 2 || lines.length !== 1 || nonEmpty.length !== 1) return { ok: false, reason: "CHILD_OUTPUT_INVALID" };
  try {
    const result = JSON.parse(lines[0].slice(CHILD_PREFIX.length));
    const fixtureState = fixturePreflightState(result?.fixturePreflight);
    const ownerState = ownerSessionState(result?.ownerSession);
    const validSequence = fixtureState === "COMPLETE"
      ? ownerState !== "INVALID" && ownerState !== "NOT_RUN"
      : fixtureState === "FAILED" && ownerState === "NOT_RUN";
    return exactKeys(result, CHILD_RESULT_KEYS) && validSequence
      ? { ok: true, ...result }
      : { ok: false, reason: "CHILD_RECEIPT_INVALID" };
  } catch {
    return { ok: false, reason: "CHILD_OUTPUT_UNREADABLE" };
  }
}

export function markChildAttemptUnknown(receipt) {
  receipt.fixturePreflight = uncertainFixturePreflight();
  receipt.ownerSession = uncertainOwnerSession();
  receipt.sideEffects.sessionCreationAttempts = 1;
  receipt.sideEffects.sessionCreationOutcome = "UNKNOWN";
  receipt.sideEffects.sessionRowsCreated = null;
  receipt.sideEffects.sessionTtlSeconds = WP4_SESSION_TTL_SECONDS;
  return receipt;
}

async function writeReceipt(receipt, runnerTemp) {
  const directory = path.resolve(runnerTemp, "celebratedeal-secure-receipts");
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const receiptPath = path.join(directory, RECEIPT_NAME);
  await fsp.writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return receiptPath;
}

export async function runParent(source, dependencies = {}) {
  const verifyDeploymentImpl = dependencies.verifyDeploymentImpl ?? verifyDeployment;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const spawnSyncImpl = dependencies.spawnSyncImpl ?? spawnSync;
  let receipt = createInitialReceipt(source.CELEBRATEDEAL_SOURCE_SHA);
  const invocation = validateInvocation(TASK, source);
  if (!invocation.ok) {
    receipt.diagnosticCategory = safeDiagnosticCategory(invocation.reason);
    return writeReceipt(receipt, source.RUNNER_TEMP);
  }
  let childStarted = false;
  try {
    const lineage = await verifyDeploymentImpl(source);
    const health = await fetchImpl(`https://${lineage.host}/api/health`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(WP4_NETWORK_REQUEST_TIMEOUT_MS),
    });
    const noRedirect = health.status === 200 && !health.headers.has("location");
    if (!noRedirect) throw new Error("STAGING_HEALTH_FAILED");
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
    if (receipt.prerequisites.exactPreviewLineage) {
      markChildAttemptUnknown(receipt);
      childStarted = true;
      const child = spawnSyncImpl(process.execPath, [fileURLToPath(import.meta.url), "--child"], {
        cwd: ROOT,
        env: childEnvironment(source),
        encoding: "utf8",
        shell: false,
        windowsHide: true,
        timeout: WP4_CHILD_TIMEOUT_MS,
        maxBuffer: 64 * 1024,
      });
      const childExecutionFailed = Boolean(child.error)
        || (child.signal !== null && child.signal !== undefined)
        || child.status === null;
      const parsed = childExecutionFailed
        ? { ok: false, reason: "CHILD_EXECUTION_FAILED" }
        : parseChildOutput(child.stdout, child.status ?? 1);
      if (parsed.ok) {
        receipt.fixturePreflight = parsed.fixturePreflight;
        receipt.ownerSession = parsed.ownerSession;
        receipt.sideEffects.sessionCreationAttempts = parsed.ownerSession.sessionCreationAttempts;
        receipt.sideEffects.sessionCreationOutcome = parsed.ownerSession.sessionCreationOutcome;
        receipt.sideEffects.sessionRowsCreated = parsed.ownerSession.sessionRowsCreated;
        receipt.sideEffects.sessionTtlSeconds = parsed.ownerSession.sessionTtlSeconds;
        receipt.sideEffects.userRowsUpdated = parsed.ownerSession.userRowsUpdated;
        if (fixturePreflightState(parsed.fixturePreflight) === "COMPLETE"
          && ownerSessionState(parsed.ownerSession) === "COMPLETE") {
          receipt.prerequisites.gaps = [...OWNER_SESSION_COMPLETE_GAPS];
        }
        receipt.diagnosticCategory = "FIXED_EXECUTION_PREREQUISITES_UNAVAILABLE";
      } else {
        receipt.diagnosticCategory = safeDiagnosticCategory(parsed.reason);
      }
    }
  } catch (error) {
    receipt.diagnosticCategory = safeDiagnosticCategory(error);
  }
  let safeReceipt = receipt;
  if (!validateReceipt(safeReceipt).ok) {
    const fallback = createInitialReceipt(source.CELEBRATEDEAL_SOURCE_SHA);
    fallback.diagnosticCategory = "RECEIPT_VALIDATION_FAILED";
    if (receipt.prerequisites.exactPreviewLineage === true) {
      fallback.lineage = { ...receipt.lineage };
      fallback.prerequisites.exactPreviewLineage = true;
      if (childStarted) markChildAttemptUnknown(fallback);
    }
    safeReceipt = fallback;
  }
  return writeReceipt(safeReceipt, source.RUNNER_TEMP);
}

async function main() {
  if (process.argv[2] === "--child") {
    const result = await runWp4Child(process.env);
    process.stdout.write(`${CHILD_PREFIX}${JSON.stringify(result)}\n`);
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
