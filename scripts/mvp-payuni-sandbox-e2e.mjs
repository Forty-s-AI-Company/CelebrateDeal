import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { verifyDeployment } from "./secure-staging-runner.mjs";

const SOURCE_SHA = /^[a-f0-9]{40}$/u;
const PREVIEW_HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ADMISSION_TOKEN = /^ca1\.[A-Za-z0-9_-]{1,768}\.[A-Za-z0-9_-]{43}$/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;

export const MVP_PAYUNI_SANDBOX_E2E_SCHEMA = "celebratedeal-mvp-payuni-sandbox-e2e/v1";
export const FIXED_PURPOSE = "buyer_order";
export const FIXED_SUBSCRIPTION_PURPOSE = "platform_subscription";
export const FIXED_PAYUNI_ENV = "sandbox";
export const EXISTING_REFUND_RECOVERY_SOURCE_SHA = "1052a46d002149b5c06104927ed0fab32b049214";
export const EXISTING_REFUND_RECOVERY_SCHEMA = "celebratedeal-mvp-payuni-sandbox-refund-recovery/v2";
export const FIXED_FIXTURE = Object.freeze({
  vendorId: "wp4_synthetic_vendor_v1",
  productId: "wp4_synthetic_product_v1",
});
export const SIDE_EFFECT_BUDGET = Object.freeze({
  fixturePosts: 1,
  admissionPosts: 1,
  checkoutPosts: 1,
  paymentAttemptPosts: 1,
  paymentReservationsCreated: 1,
  browserPaymentSubmissions: 1,
  refundPosts: 1,
  reconcilePosts: 12,
  transactionsCreated: 1,
  payments: 1,
  refunds: 1,
});
const SUBSCRIPTION_SIDE_EFFECT_BUDGET = Object.freeze({
  fixturePosts: 1,
  sessionPosts: 1,
  planSelections: 1,
  paymentAttemptPosts: 1,
  paymentReservationsCreated: 1,
  browserPaymentSubmissions: 1,
  refundPosts: 1,
  reconcilePosts: 12,
  statePosts: 2,
  transactionsCreated: 1,
  payments: 1,
  refunds: 1,
});

const RECEIPT_KEYS = Object.freeze([
  "schemaVersion",
  "purpose",
  "sourceSha",
  "environment",
  "result",
  "failure",
  "checks",
  "sideEffects",
  "safety",
]);
const CHECK_KEYS = Object.freeze([
  "fixtureReady",
  "sameOriginAdmission",
  "checkoutCreated",
  "paymentAttemptReserved",
  "payuniFormAccepted",
  "returnCallbackMapped",
  "refundCompleted",
  "reconciled",
]);
const SUBSCRIPTION_CHECK_KEYS = Object.freeze([
  "fixtureReady",
  "ownerSessionIssued",
  "nativePlanCheckoutCreated",
  "paymentAttemptReserved",
  "payuniFormSubmitted",
  "trustedSubscriptionPayment",
  "activeEntitlementVerified",
  "refundCompleted",
  "reconciled",
  "refundedEntitlementVerified",
]);
const SAFETY_KEYS = Object.freeze([
  "sanitized",
  "envFilesRead",
  "envEnumerated",
  "rawLogsPersisted",
  "rawIdentifiersPersisted",
  "rawUrlsPersisted",
  "secretsPersisted",
  "arbitraryInputAccepted",
  "sideEffectBudgetExceeded",
]);
const FAILURE_CODES = new Set([
  "NONE",
  "INPUT_REJECTED",
  "FIXTURE_REJECTED",
  "FIXTURE_AUTHORIZATION_REJECTED",
  "FIXTURE_EXECUTOR_DISABLED",
  "FIXTURE_SOURCE_CONFIGURATION_UNAVAILABLE",
  "FIXTURE_SOURCE_MISMATCH",
  "FIXTURE_BODY_REJECTED",
  "FIXTURE_CONFLICT",
  "FIXTURE_HTTP_REJECTED",
  "ADMISSION_REJECTED",
  "CHECKOUT_REJECTED",
  "PAYMENT_ATTEMPT_REJECTED",
  "PAYMENT_ATTEMPT_ALREADY_RESERVED",
  "PAYMENT_ATTEMPT_ALREADY_FINISHED",
  "PAYMENT_ATTEMPT_CANDIDATE_AMBIGUOUS",
  "PAYMENT_ATTEMPT_FIXTURE_UNAVAILABLE",
  "PAYMENT_REJECTED",
  "PAYMENT_PAGE_UNREACHED",
  "PAYMENT_FORM_NOT_SUBMITTED",
  "PAYMENT_PROVIDER_HTTP_REJECTED",
  "PAYMENT_PROVIDER_NETWORK_REJECTED",
  "PAYMENT_API_NETWORK_REJECTED",
  "PAYMENT_API_DNS_REJECTED",
  "PAYMENT_API_CONNECTION_REJECTED",
  "PAYMENT_API_TIMEOUT_REJECTED",
  "PAYMENT_API_TLS_REJECTED",
  "PAYMENT_API_CLIENT_BLOCKED",
  "PAYMENT_API_NAVIGATION_ABORTED",
  "PAYMENT_API_PROTOCOL_REJECTED",
  "PAYMENT_API_EMPTY_RESPONSE",
  "PAYMENT_API_GENERIC_FAILED",
  "PAYMENT_VENDOR_NETWORK_REJECTED",
  "PAYMENT_REDIRECT_UNOBSERVED",
  "PAYMENT_VENDOR_NAV_UNCOMMITTED",
  "PAYMENT_METHOD_UNAVAILABLE",
  "PAYMENT_FIELDS_REJECTED",
  "PAYMENT_SUBMIT_REJECTED",
  "PAYMENT_CONFIRMATION_AMBIGUOUS",
  "RETURN_CALLBACK_UNMAPPED",
  "RETURN_RESULT_UNMAPPED",
  "RETURN_CALLBACK_PROOF_REQUIRED",
  "REFUND_REJECTED",
  "SUBSCRIPTION_STATE_REJECTED",
  "RECONCILE_REJECTED",
  "NETWORK_REJECTED",
  "INTERNAL_REJECTED",
]);
const PAYUNI_UPP_URL = "https://sandbox-api.payuni.com.tw/api/upp";
const PAYUNI_PAYMENT_HOST = new URL(PAYUNI_UPP_URL).hostname;
const REQUEST_TIMEOUT_MS = 30_000;
const RECEIPT_DIRECTORY = "celebratedeal-secure-receipts";
const RECEIPT_FILENAME = "wp4-payuni-sandbox-reconciliation-receipt.json";
const RECOVERY_RECEIPT_FILENAME = "wp4-payuni-sandbox-refund-recovery-receipt.json";
const SUBSCRIPTION_RECEIPT_FILENAME = "wp4-payuni-sandbox-subscription-receipt.json";
export const MVP_PAYUNI_SANDBOX_SUBSCRIPTION_SCHEMA = "celebratedeal-mvp-payuni-sandbox-subscription-e2e/v2";
const FIXED_RECEIPT_FILENAMES = new Set([RECEIPT_FILENAME, RECOVERY_RECEIPT_FILENAME, SUBSCRIPTION_RECEIPT_FILENAME]);
const RECOVERY_RECEIPT_KEYS = Object.freeze([
  "schemaVersion",
  "purpose",
  "sourceSha",
  "transactionSourceSha",
  "result",
  "status",
  "queryAttempts",
  "paymentSubmissions",
  "refundSubmissions",
]);
const RECOVERY_QUERY_FAILURES = Object.freeze([
  "QUERY_AUTHENTICATION_FAILED",
  "QUERY_REQUEST_REJECTED",
  "QUERY_RESPONSE_REJECTED",
  "QUERY_NETWORK_FAILED",
  "QUERY_UNKNOWN_FAILED",
]);
const RECOVERY_STATUSES = new Set([
  ...RECOVERY_QUERY_FAILURES,
  "RECONCILED",
  "FIXTURE_UNAVAILABLE",
  "CANDIDATE_AMBIGUOUS",
  "PENDING_RESERVATION_UNAVAILABLE",
  "REFUND_NOT_CONFIRMED",
  "PROJECTION_UNAVAILABLE",
  "INPUT_REJECTED",
  "NETWORK_REJECTED",
  "RESPONSE_INVALID",
]);

/**
 * Converts Chromium's request-failure text into a fixed, non-sensitive
 * category. The raw browser error must never enter logs or evidence.
 */
export function classifyPayUniApiNetworkFailure(errorText) {
  if (typeof errorText !== "string") return "PAYMENT_API_NETWORK_REJECTED";
  if (errorText.includes("ERR_NAME_NOT_RESOLVED")) return "PAYMENT_API_DNS_REJECTED";
  if (errorText.includes("ERR_CONNECTION_TIMED_OUT") || errorText.includes("ERR_TIMED_OUT")) {
    return "PAYMENT_API_TIMEOUT_REJECTED";
  }
  if (errorText.includes("ERR_CERT_") || errorText.includes("ERR_SSL_") || errorText.includes("ERR_TLS_")) {
    return "PAYMENT_API_TLS_REJECTED";
  }
  if (errorText.includes("ERR_BLOCKED_BY_CLIENT")) return "PAYMENT_API_CLIENT_BLOCKED";
  if (errorText.includes("ERR_ABORTED")) return "PAYMENT_API_NAVIGATION_ABORTED";
  if (errorText.includes("ERR_HTTP2_") || errorText.includes("ERR_HTTP3_")) {
    return "PAYMENT_API_PROTOCOL_REJECTED";
  }
  if (errorText.includes("ERR_EMPTY_RESPONSE")) return "PAYMENT_API_EMPTY_RESPONSE";
  if (errorText.includes("ERR_FAILED")) return "PAYMENT_API_GENERIC_FAILED";
  if (
    errorText.includes("ERR_CONNECTION_REFUSED")
    || errorText.includes("ERR_CONNECTION_RESET")
    || errorText.includes("ERR_CONNECTION_CLOSED")
    || errorText.includes("ERR_ADDRESS_UNREACHABLE")
  ) {
    return "PAYMENT_API_CONNECTION_REJECTED";
  }
  return "PAYMENT_API_NETWORK_REJECTED";
}

export function isPayUniPaymentPageUrl(value) {
  try {
    const url = value instanceof URL ? value : new URL(value);
    return url.protocol === "https:"
      && url.hostname === PAYUNI_PAYMENT_HOST
      && url.pathname === "/api/upp";
  } catch {
    return false;
  }
}

const SYNTHETIC_BUYER = Object.freeze({
  name: "WP4 Sandbox Buyer",
  email: "wp4-buyer-v1@invalid.example",
  phone: "0000000000",
});
const SYNTHETIC_SHIPPING = Object.freeze({
  recipientName: "WP4 Sandbox Buyer",
  phone: "0000000000",
  countryCode: "TW",
  postalCode: "000",
  administrativeArea: "Sandbox",
  locality: "Fixture",
  addressLine1: "1 Synthetic Way",
});

function exactKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function allFalse(value, keys) {
  return keys.every((key) => value?.[key] === false);
}

function boundedInteger(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function fixedOrigin(host) {
  return `https://${host}`;
}

function fixedUrl(host, pathname) {
  return `${fixedOrigin(host)}${pathname}`;
}

export function fixedCheckoutIdempotencyKey(sourceSha) {
  if (!SOURCE_SHA.test(sourceSha)) return null;
  const hex = createHash("sha256").update(`celebratedeal-mvp-payuni:${sourceSha}`, "utf8").digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function requiredText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeCard(value) {
  const digits = typeof value === "string" ? value.replace(/\D/gu, "") : "";
  return /^\d{16,19}$/u.test(digits) ? digits : null;
}

function normalizeExpiry(value) {
  const digits = typeof value === "string" ? value.replace(/\D/gu, "") : "";
  const month = Number(digits.slice(0, 2));
  return /^\d{4}$/u.test(digits) && month >= 1 && month <= 12 ? digits : null;
}

function normalizeCvv(value) {
  const digits = typeof value === "string" ? value.replace(/\D/gu, "") : "";
  return /^\d{3}$/u.test(digits) ? digits : null;
}

/**
 * Reads only the seven documented inputs.  It intentionally never enumerates
 * process.env, accepts command-line arguments, or loads an env file.
 */
export function readFixedInputs(source = process.env) {
  return {
    sourceSha: source.CELEBRATEDEAL_SOURCE_SHA,
    previewHost: source.CELEBRATEDEAL_DEPLOYMENT_HOST,
    jobSecret: source.JOB_SECRET,
    cardNumber: source.PAYUNI_SANDBOX_ONETIME_CARD_NO,
    cardExpiry: source.PAYUNI_TEST_EXPIRY,
    cardCvv: source.PAYUNI_TEST_CVV,
    payuniEnv: source.PAYUNI_ENV,
  };
}

/**
 * This recovery path intentionally reads neither card nor provider bindings.
 * It can only query the one historical, source-owned buyer refund candidate.
 */
export function readExistingRefundRecoveryInputs(source = process.env) {
  return {
    sourceSha: source.CELEBRATEDEAL_SOURCE_SHA,
    previewHost: source.CELEBRATEDEAL_DEPLOYMENT_HOST,
    jobSecret: source.JOB_SECRET,
  };
}

export function validateInvocation(input) {
  const sourceSha = typeof input?.sourceSha === "string" ? input.sourceSha.trim().toLowerCase() : "";
  const previewHost = typeof input?.previewHost === "string" ? input.previewHost.trim().toLowerCase() : "";
  if (!SOURCE_SHA.test(sourceSha)) return { ok: false, code: "INPUT_REJECTED" };
  if (!PREVIEW_HOST.test(previewHost)) return { ok: false, code: "INPUT_REJECTED" };
  if (input?.payuniEnv !== FIXED_PAYUNI_ENV) return { ok: false, code: "INPUT_REJECTED" };
  if (!requiredText(input?.jobSecret)) return { ok: false, code: "INPUT_REJECTED" };

  const cardNumber = normalizeCard(input?.cardNumber);
  const cardExpiry = normalizeExpiry(input?.cardExpiry);
  const cardCvv = normalizeCvv(input?.cardCvv);
  if (!cardNumber || !cardExpiry || !cardCvv) return { ok: false, code: "INPUT_REJECTED" };

  return {
    ok: true,
    sourceSha,
    previewHost,
    jobSecret: input.jobSecret,
    cardNumber,
    cardExpiry,
    cardCvv,
  };
}

export function validateExistingRefundRecoveryInvocation(input) {
  const sourceSha = typeof input?.sourceSha === "string" ? input.sourceSha.trim().toLowerCase() : "";
  const previewHost = typeof input?.previewHost === "string" ? input.previewHost.trim().toLowerCase() : "";
  if (!SOURCE_SHA.test(sourceSha) || !PREVIEW_HOST.test(previewHost) || !requiredText(input?.jobSecret)) {
    return { ok: false };
  }
  return { ok: true, sourceSha, previewHost, jobSecret: input.jobSecret };
}

/**
 * Verifies the immutable Preview host against the protected GitHub deployment
 * record before any PayUni or application secret is injected into the job.
 */
export async function verifyMvpPayUniLineage(source = process.env, dependencies = {}) {
  const sourceSha = typeof source.CELEBRATEDEAL_SOURCE_SHA === "string"
    ? source.CELEBRATEDEAL_SOURCE_SHA.trim().toLowerCase()
    : "";
  const previewHost = typeof source.CELEBRATEDEAL_DEPLOYMENT_HOST === "string"
    ? source.CELEBRATEDEAL_DEPLOYMENT_HOST.trim().toLowerCase()
    : "";
  if (!SOURCE_SHA.test(sourceSha) || !PREVIEW_HOST.test(previewHost) || !requiredText(source.GITHUB_TOKEN)) return false;

  try {
    const verifyDeploymentImpl = dependencies.verifyDeploymentImpl ?? verifyDeployment;
    const fetchImpl = dependencies.fetchImpl ?? fetch;
    const lineage = await verifyDeploymentImpl({
      CELEBRATEDEAL_SOURCE_SHA: sourceSha,
      CELEBRATEDEAL_DEPLOYMENT_HOST: previewHost,
      GITHUB_TOKEN: source.GITHUB_TOKEN,
    });
    if (lineage.host !== previewHost
      || lineage.deploymentMatched !== true
      || lineage.sourceMatched !== true
      || lineage.preview !== true
      || lineage.ready !== true) return false;

    const health = await fetchImpl(fixedUrl(previewHost, "/api/health"), {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return health.status === 200 && !health.headers.has("location");
  } catch {
    return false;
  }
}

export function createReceipt(sourceSha = "0".repeat(40)) {
  return {
    schemaVersion: MVP_PAYUNI_SANDBOX_E2E_SCHEMA,
    purpose: FIXED_PURPOSE,
    sourceSha: SOURCE_SHA.test(sourceSha) ? sourceSha : "0".repeat(40),
    environment: FIXED_PAYUNI_ENV,
    result: "BLOCKED",
    failure: "INPUT_REJECTED",
    checks: {
      fixtureReady: false,
      sameOriginAdmission: false,
      checkoutCreated: false,
      paymentAttemptReserved: false,
      payuniFormAccepted: false,
      returnCallbackMapped: false,
      refundCompleted: false,
      reconciled: false,
    },
    sideEffects: {
      fixturePosts: 0,
      admissionPosts: 0,
      checkoutPosts: 0,
      paymentAttemptPosts: 0,
      paymentReservationsCreated: 0,
      browserPaymentSubmissions: 0,
      refundPosts: 0,
      reconcilePosts: 0,
      transactionsCreated: 0,
      payments: 0,
      refunds: 0,
    },
    safety: {
      sanitized: true,
      envFilesRead: false,
      envEnumerated: false,
      rawLogsPersisted: false,
      rawIdentifiersPersisted: false,
      rawUrlsPersisted: false,
      secretsPersisted: false,
      arbitraryInputAccepted: false,
      sideEffectBudgetExceeded: false,
    },
  };
}

export function createSubscriptionReceipt(sourceSha = "0".repeat(40)) {
  return {
    schemaVersion: MVP_PAYUNI_SANDBOX_SUBSCRIPTION_SCHEMA,
    purpose: FIXED_SUBSCRIPTION_PURPOSE,
    sourceSha: SOURCE_SHA.test(sourceSha) ? sourceSha : "0".repeat(40),
    environment: FIXED_PAYUNI_ENV,
    result: "BLOCKED",
    failure: "INPUT_REJECTED",
    checks: {
      fixtureReady: false,
      ownerSessionIssued: false,
      nativePlanCheckoutCreated: false,
      paymentAttemptReserved: false,
      payuniFormSubmitted: false,
      trustedSubscriptionPayment: false,
      activeEntitlementVerified: false,
      refundCompleted: false,
      reconciled: false,
      refundedEntitlementVerified: false,
    },
    sideEffects: {
      fixturePosts: 0,
      sessionPosts: 0,
      planSelections: 0,
      paymentAttemptPosts: 0,
      paymentReservationsCreated: 0,
      browserPaymentSubmissions: 0,
      refundPosts: 0,
      reconcilePosts: 0,
      statePosts: 0,
      transactionsCreated: 0,
      payments: 0,
      refunds: 0,
    },
    safety: {
      sanitized: true,
      envFilesRead: false,
      envEnumerated: false,
      rawLogsPersisted: false,
      rawIdentifiersPersisted: false,
      rawUrlsPersisted: false,
      secretsPersisted: false,
      arbitraryInputAccepted: false,
      sideEffectBudgetExceeded: false,
    },
  };
}

function withinBudget(receipt) {
  return Object.entries(SIDE_EFFECT_BUDGET).every(([key, maximum]) => boundedInteger(receipt?.sideEffects?.[key], maximum));
}

function completedPrefix(receipt) {
  const checks = receipt.checks;
  const effects = receipt.sideEffects;
  if (checks.fixtureReady && effects.fixturePosts !== 1) return false;
  if (checks.sameOriginAdmission && (!checks.fixtureReady || effects.admissionPosts !== 1)) return false;
  if (checks.checkoutCreated && (!checks.sameOriginAdmission || effects.checkoutPosts !== 1 || effects.transactionsCreated !== 1)) return false;
  if (checks.paymentAttemptReserved && (!checks.checkoutCreated || effects.paymentAttemptPosts !== 1)) return false;
  if (checks.payuniFormAccepted && (!checks.paymentAttemptReserved || effects.browserPaymentSubmissions !== effects.paymentReservationsCreated)) return false;
  if (checks.returnCallbackMapped && (!checks.payuniFormAccepted || effects.payments !== effects.paymentReservationsCreated)) return false;
  if (checks.refundCompleted && (!checks.returnCallbackMapped || effects.refundPosts !== 1 || effects.refunds !== 1)) return false;
  if (checks.reconciled && (!checks.refundCompleted || effects.reconcilePosts < 1)) return false;
  if (effects.admissionPosts > 0 && !checks.fixtureReady) return false;
  if (effects.checkoutPosts > 0 && !checks.sameOriginAdmission) return false;
  if (effects.paymentAttemptPosts > 0 && !checks.checkoutCreated) return false;
  if (effects.paymentReservationsCreated > 0 && !checks.paymentAttemptReserved) return false;
  if (effects.browserPaymentSubmissions > 0 && !checks.paymentAttemptReserved) return false;
  if (effects.refundPosts > 0 && !checks.returnCallbackMapped) return false;
  if (effects.reconcilePosts > 0 && !checks.refundCompleted && receipt.failure !== "RECONCILE_REJECTED") return false;
  if (effects.transactionsCreated > 0 && !checks.checkoutCreated) return false;
  if (effects.payments > 0 && !checks.returnCallbackMapped) return false;
  if (effects.refunds > 0 && !checks.refundCompleted) return false;
  return true;
}

export function validateMvpPayUniReceipt(receipt) {
  const errors = [];
  if (!exactKeys(receipt, RECEIPT_KEYS)) errors.push("SCHEMA_KEYS");
  if (!exactKeys(receipt?.checks, CHECK_KEYS)) errors.push("CHECK_KEYS");
  if (!exactKeys(receipt?.sideEffects, Object.keys(SIDE_EFFECT_BUDGET))) errors.push("SIDE_EFFECT_KEYS");
  if (!exactKeys(receipt?.safety, SAFETY_KEYS)) errors.push("SAFETY_KEYS");
  if (receipt?.schemaVersion !== MVP_PAYUNI_SANDBOX_E2E_SCHEMA || receipt?.purpose !== FIXED_PURPOSE || receipt?.environment !== FIXED_PAYUNI_ENV) errors.push("FIXED_ENUMS");
  if (!SOURCE_SHA.test(receipt?.sourceSha ?? "")) errors.push("SOURCE_SHA");
  if (!new Set(["PASS", "BLOCKED"]).has(receipt?.result)) errors.push("RESULT");
  if (!FAILURE_CODES.has(receipt?.failure)) errors.push("FAILURE");
  if (!withinBudget(receipt) || receipt?.safety?.sideEffectBudgetExceeded !== false) errors.push("SIDE_EFFECT_BUDGET");
  if (receipt?.safety?.sanitized !== true || !allFalse(receipt?.safety, SAFETY_KEYS.filter((key) => key !== "sanitized" && key !== "sideEffectBudgetExceeded"))) errors.push("SANITIZATION");
  if (![...CHECK_KEYS].every((key) => typeof receipt?.checks?.[key] === "boolean")) errors.push("CHECK_VALUES");
  if (!completedPrefix(receipt)) errors.push("SEQUENCE");

  const completed = CHECK_KEYS.every((key) => receipt?.checks?.[key] === true);
  if (receipt?.result === "PASS") {
    if (!completed || receipt.failure !== "NONE") errors.push("PASS_COMPLETENESS");
    const effects = receipt.sideEffects;
    const fixedOne = ["fixturePosts", "admissionPosts", "checkoutPosts", "paymentAttemptPosts", "refundPosts", "transactionsCreated", "refunds"];
    const currentExecution = effects.paymentReservationsCreated === 1 && effects.browserPaymentSubmissions === 1 && effects.payments === 1;
    if (fixedOne.some((key) => effects[key] !== 1) || !currentExecution) errors.push("PASS_EFFECTS");
  } else if (receipt?.failure === "NONE" || completed) {
    errors.push("BLOCKED_COMPLETENESS");
  }
  return { ok: errors.length === 0, errors };
}

function completedSubscriptionPrefix(receipt) {
  const checks = receipt.checks;
  const effects = receipt.sideEffects;
  if (checks.fixtureReady && effects.fixturePosts !== 1) return false;
  if (checks.ownerSessionIssued && (!checks.fixtureReady || effects.sessionPosts !== 1)) return false;
  if (checks.nativePlanCheckoutCreated && (!checks.ownerSessionIssued || effects.planSelections !== 1 || effects.transactionsCreated !== 1)) return false;
  if (checks.paymentAttemptReserved && (!checks.nativePlanCheckoutCreated || effects.paymentAttemptPosts !== 1)) return false;
  if (checks.payuniFormSubmitted && (!checks.paymentAttemptReserved || effects.browserPaymentSubmissions !== effects.paymentReservationsCreated)) return false;
  if (checks.trustedSubscriptionPayment && (!checks.payuniFormSubmitted || effects.payments !== effects.paymentReservationsCreated)) return false;
  if (checks.activeEntitlementVerified && (!checks.trustedSubscriptionPayment || effects.statePosts < 1)) return false;
  if (checks.refundedEntitlementVerified && (!checks.reconciled || effects.statePosts !== 2)) return false;
  if (checks.refundCompleted && (!checks.activeEntitlementVerified || effects.refundPosts !== 1 || effects.refunds !== 1)) return false;
  if (checks.reconciled && (!checks.refundCompleted || effects.reconcilePosts < 1)) return false;
  if (effects.sessionPosts > 0 && !checks.fixtureReady) return false;
  if (effects.planSelections > 0 && !checks.ownerSessionIssued) return false;
  if (effects.paymentAttemptPosts > 0 && !checks.nativePlanCheckoutCreated) return false;
  if (effects.paymentReservationsCreated > 0 && !checks.paymentAttemptReserved) return false;
  if (effects.browserPaymentSubmissions > 0 && !checks.paymentAttemptReserved) return false;
  if (effects.statePosts > 0 && !checks.payuniFormSubmitted) return false;
  if (effects.statePosts === 2 && !checks.reconciled) return false;
  if (effects.refundPosts > 0 && !checks.activeEntitlementVerified) return false;
  if (effects.reconcilePosts > 0 && !checks.refundCompleted && receipt.failure !== "RECONCILE_REJECTED") return false;
  if (effects.transactionsCreated > 0 && !checks.nativePlanCheckoutCreated) return false;
  if (effects.payments > 0 && !checks.trustedSubscriptionPayment) return false;
  if (effects.refunds > 0 && !checks.refundCompleted) return false;
  return true;
}

export function validateMvpPayUniSubscriptionReceipt(receipt) {
  const errors = [];
  if (!exactKeys(receipt, RECEIPT_KEYS)) errors.push("SCHEMA_KEYS");
  if (!exactKeys(receipt?.checks, SUBSCRIPTION_CHECK_KEYS)) errors.push("CHECK_KEYS");
  if (!exactKeys(receipt?.sideEffects, Object.keys(SUBSCRIPTION_SIDE_EFFECT_BUDGET))) errors.push("SIDE_EFFECT_KEYS");
  if (!exactKeys(receipt?.safety, SAFETY_KEYS)) errors.push("SAFETY_KEYS");
  if (receipt?.schemaVersion !== MVP_PAYUNI_SANDBOX_SUBSCRIPTION_SCHEMA || receipt?.purpose !== FIXED_SUBSCRIPTION_PURPOSE || receipt?.environment !== FIXED_PAYUNI_ENV) errors.push("FIXED_ENUMS");
  if (!SOURCE_SHA.test(receipt?.sourceSha ?? "")) errors.push("SOURCE_SHA");
  if (!new Set(["PASS", "BLOCKED"]).has(receipt?.result)) errors.push("RESULT");
  if (!FAILURE_CODES.has(receipt?.failure)) errors.push("FAILURE");
  if (!Object.entries(SUBSCRIPTION_SIDE_EFFECT_BUDGET).every(([key, maximum]) => boundedInteger(receipt?.sideEffects?.[key], maximum)) || receipt?.safety?.sideEffectBudgetExceeded !== false) errors.push("SIDE_EFFECT_BUDGET");
  if (receipt?.safety?.sanitized !== true || !allFalse(receipt?.safety, SAFETY_KEYS.filter((key) => key !== "sanitized" && key !== "sideEffectBudgetExceeded"))) errors.push("SANITIZATION");
  if (![...SUBSCRIPTION_CHECK_KEYS].every((key) => typeof receipt?.checks?.[key] === "boolean")) errors.push("CHECK_VALUES");
  if (!completedSubscriptionPrefix(receipt)) errors.push("SEQUENCE");

  const completed = SUBSCRIPTION_CHECK_KEYS.every((key) => receipt?.checks?.[key] === true);
  if (receipt?.result === "PASS") {
    if (!completed || receipt.failure !== "NONE") errors.push("PASS_COMPLETENESS");
    const effects = receipt.sideEffects;
    const fixedOne = ["fixturePosts", "sessionPosts", "planSelections", "paymentAttemptPosts", "refundPosts", "transactionsCreated", "refunds"];
    const currentExecution = effects.paymentReservationsCreated === 1 && effects.browserPaymentSubmissions === 1 && effects.payments === 1;
    if (fixedOne.some((key) => effects[key] !== 1) || !currentExecution || effects.statePosts !== 2) errors.push("PASS_EFFECTS");
  } else if (receipt?.failure === "NONE" || completed) {
    errors.push("BLOCKED_COMPLETENESS");
  }
  return { ok: errors.length === 0, errors };
}

export function finalizeMvpPayUniSubscriptionReceipt(receipt) {
  return validateMvpPayUniSubscriptionReceipt(receipt).ok ? receipt : fail(receipt, "INTERNAL_REJECTED");
}

export const validateReceipt = validateMvpPayUniReceipt;

export function createExistingRefundRecoveryReceipt(sourceSha = "0".repeat(40)) {
  return {
    schemaVersion: EXISTING_REFUND_RECOVERY_SCHEMA,
    purpose: FIXED_PURPOSE,
    sourceSha: SOURCE_SHA.test(sourceSha) ? sourceSha : "0".repeat(40),
    transactionSourceSha: EXISTING_REFUND_RECOVERY_SOURCE_SHA,
    result: "BLOCKED",
    status: "INPUT_REJECTED",
    queryAttempts: 0,
    paymentSubmissions: 0,
    refundSubmissions: 0,
  };
}

export function validateExistingRefundRecoveryReceipt(receipt) {
  const errors = [];
  if (!exactKeys(receipt, RECOVERY_RECEIPT_KEYS)) errors.push("SCHEMA_KEYS");
  if (receipt?.schemaVersion !== EXISTING_REFUND_RECOVERY_SCHEMA || receipt?.purpose !== FIXED_PURPOSE || !SOURCE_SHA.test(receipt?.sourceSha ?? "") || receipt?.transactionSourceSha !== EXISTING_REFUND_RECOVERY_SOURCE_SHA) {
    errors.push("FIXED_IDENTITY");
  }
  if (!new Set(["RECONCILED", "UNRESOLVED", "BLOCKED"]).has(receipt?.result)) errors.push("RESULT");
  if (!RECOVERY_STATUSES.has(receipt?.status)) errors.push("STATUS");
  if (!boundedInteger(receipt?.queryAttempts, 1)) errors.push("QUERY_BUDGET");
  if (receipt?.paymentSubmissions !== 0 || receipt?.refundSubmissions !== 0) errors.push("SUBMISSION_BUDGET");

  const queriedStatuses = new Set([
    ...RECOVERY_QUERY_FAILURES,
    "RECONCILED",
    "FIXTURE_UNAVAILABLE",
    "CANDIDATE_AMBIGUOUS",
    "PENDING_RESERVATION_UNAVAILABLE",
    "REFUND_NOT_CONFIRMED",
    "PROJECTION_UNAVAILABLE",
    "NETWORK_REJECTED",
    "RESPONSE_INVALID",
  ]);
  if (receipt?.status === "INPUT_REJECTED") {
    if (receipt?.result !== "BLOCKED" || receipt?.queryAttempts !== 0) errors.push("INPUT_SEQUENCE");
  } else if (queriedStatuses.has(receipt?.status) && receipt?.queryAttempts !== 1) {
    errors.push("QUERY_SEQUENCE");
  }
  if (receipt?.status === "RECONCILED" && receipt?.result !== "RECONCILED") errors.push("RECONCILED_RESULT");
  if (["NETWORK_REJECTED", "RESPONSE_INVALID"].includes(receipt?.status) && receipt?.result !== "BLOCKED") errors.push("BLOCKED_RESULT");
  if ([...RECOVERY_QUERY_FAILURES, "FIXTURE_UNAVAILABLE", "CANDIDATE_AMBIGUOUS", "PENDING_RESERVATION_UNAVAILABLE", "REFUND_NOT_CONFIRMED", "PROJECTION_UNAVAILABLE"].includes(receipt?.status) && receipt?.result !== "UNRESOLVED") {
    errors.push("UNRESOLVED_RESULT");
  }
  return { ok: errors.length === 0, errors };
}

function fail(receipt, code) {
  receipt.result = "BLOCKED";
  receipt.failure = FAILURE_CODES.has(code) ? code : "INTERNAL_REJECTED";
  return receipt;
}

function responseJson(response) {
  if (!response || typeof response !== "object" || !Number.isInteger(response.status) || !response.body || typeof response.body !== "object") {
    throw new Error("NETWORK_REJECTED");
  }
  return response;
}

function assertFixtureResponse(response) {
  return response.status === 200
    && exactKeys(response.body, ["ready", "createdCount", "reusedCount"])
    && response.body.ready === true
    && boundedInteger(response.body.createdCount, 5)
    && boundedInteger(response.body.reusedCount, 5)
    && response.body.createdCount + response.body.reusedCount === 5;
}

function assertSubscriptionFixtureResponse(response) {
  return response.status === 200
    && exactKeys(response.body, ["ready", "createdCount", "reusedCount"])
    && response.body.ready === true
    && boundedInteger(response.body.createdCount, 5)
    && boundedInteger(response.body.reusedCount, 5)
    && response.body.createdCount + response.body.reusedCount === 5;
}

function assertAdmissionResponse(response) {
  return response.status === 200
    && exactKeys(response.body, ["admissionToken", "idempotencyKey", "expiresAt"])
    && ADMISSION_TOKEN.test(response.body.admissionToken)
    && UUID.test(response.body.idempotencyKey)
    && !Number.isNaN(Date.parse(response.body.expiresAt))
    && typeof response.sessionCookie === "string"
    && response.sessionCookie.length > 0;
}

function validFormPayload(value) {
  const fields = ["MerID", "Version", "EncryptInfo", "HashInfo"];
  return exactKeys(value, fields)
    && fields.every((key) => typeof value[key] === "string" && value[key].length > 0 && value[key].length <= 4096);
}

function assertCheckoutResponse(response) {
  const body = response.body;
  return response.status === 200
    && exactKeys(body, ["ok", "provider", "orderNumber", "transactionId", "amountCents", "currency", "checkoutUrl", "formAction", "formMethod", "formPayload", "nextAction", "externalRequired"])
    && body.ok === true
    && body.provider === "payuni"
    && SAFE_IDENTIFIER.test(body.orderNumber)
    && SAFE_IDENTIFIER.test(body.transactionId)
    && body.amountCents === 100
    && body.currency === "TWD"
    && body.checkoutUrl === null
    && body.formAction === PAYUNI_UPP_URL
    && body.formMethod === "POST"
    && validFormPayload(body.formPayload)
    && body.nextAction === "submit_payuni_upp_form"
    && body.externalRequired === false
    && typeof response.supportCookie === "string"
    && response.supportCookie.length > 0;
}

function assertPaymentAttemptResponse(response) {
  return response.status === 200
    && exactKeys(response.body, ["status", "reservationCreated"])
    && (
      (response.body.status === "SUBMIT_ALLOWED" && response.body.reservationCreated === true)
      || (response.body.status === "ALREADY_PAID" && response.body.reservationCreated === false)
    );
}

function assertRefundResponse(response) {
  return response.status === 200
    && exactKeys(response.body, ["status", "purpose", "phase", "providerWriteAttempted"])
    && response.body.status === "COMPLETED"
    && response.body.purpose === FIXED_PURPOSE
    && response.body.phase === "remaining"
    && response.body.providerWriteAttempted === true;
}

function assertReconcileResponse(response) {
  return response.status === 200
    && exactKeys(response.body, ["reconciled", "status"])
    && response.body.reconciled === true
    && response.body.status === "RECONCILED";
}

function safeSetCookie(headers) {
  const values = typeof headers?.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers?.get?.("set-cookie")].filter((value) => typeof value === "string");
  return values;
}

function cookieValue(cookies, prefix) {
  const candidate = cookies.find((value) => value.startsWith(prefix));
  if (!candidate) return null;
  const separator = candidate.indexOf(";");
  const pair = separator === -1 ? candidate : candidate.slice(0, separator);
  const equals = pair.indexOf("=");
  return equals > 0 && pair.slice(equals + 1).length > 0 ? pair : null;
}

async function parseFetchResponse(response, cookiePrefix, outcomeHeader) {
  if (!response || !Number.isInteger(response.status)) throw new Error("NETWORK_REJECTED");
  if (response.status === 204) {
    return {
      status: response.status,
      ...(cookiePrefix ? { sessionCookie: cookieValue(safeSetCookie(response.headers), cookiePrefix) } : {}),
    };
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("NETWORK_REJECTED");
  }
  return {
    status: response.status,
    body,
    ...(outcomeHeader ? { outcome: response.headers?.get?.(outcomeHeader) ?? null } : {}),
    ...(cookiePrefix ? { sessionCookie: cookieValue(safeSetCookie(response.headers), cookiePrefix) } : {}),
    ...(cookiePrefix === "celebrate_support_" ? { supportCookie: cookieValue(safeSetCookie(response.headers), cookiePrefix) } : {}),
  };
}

async function defaultRequest(request) {
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return parseFetchResponse(response, request.cookiePrefix, request.outcomeHeader);
}

function assertRefundRequiresReconciliation(response) {
  return response.status === 503
    && exactKeys(response.body, ["status", "purpose", "phase", "providerWriteAttempted"])
    && response.body.status === "RECONCILIATION_REQUIRED"
    && response.body.purpose === FIXED_PURPOSE
    && response.body.phase === "remaining"
    && response.body.providerWriteAttempted === true;
}

function paymentAttemptFailure(response) {
  const status = response?.body?.status;
  if (status === "ALREADY_RESERVED") return "PAYMENT_ATTEMPT_ALREADY_RESERVED";
  if (status === "ALREADY_FINISHED") return "PAYMENT_ATTEMPT_ALREADY_FINISHED";
  if (status === "CANDIDATE_AMBIGUOUS") return "PAYMENT_ATTEMPT_CANDIDATE_AMBIGUOUS";
  if (status === "FIXTURE_UNAVAILABLE") return "PAYMENT_ATTEMPT_FIXTURE_UNAVAILABLE";
  return "PAYMENT_ATTEMPT_REJECTED";
}

function fixtureFailure(response) {
  if (response.status === 401) return "FIXTURE_AUTHORIZATION_REJECTED";
  const outcomes = {
    EXECUTOR_DISABLED: "FIXTURE_EXECUTOR_DISABLED",
    SOURCE_CONFIGURATION_UNAVAILABLE: "FIXTURE_SOURCE_CONFIGURATION_UNAVAILABLE",
    SOURCE_MISMATCH: "FIXTURE_SOURCE_MISMATCH",
    BODY_REJECTED: "FIXTURE_BODY_REJECTED",
  };
  if (typeof response.outcome === "string" && outcomes[response.outcome]) return outcomes[response.outcome];
  if (response.status === 409) return "FIXTURE_CONFLICT";
  return "FIXTURE_HTTP_REJECTED";
}

function guardedHeaders(invocation) {
  return {
    authorization: `Bearer ${invocation.jobSecret}`,
    "x-celebratedeal-source-sha": invocation.sourceSha,
  };
}

function recoveryResult(response) {
  const expectedStatus = {
    ...Object.fromEntries(RECOVERY_QUERY_FAILURES.map((status) => [status, 503])),
    RECONCILED: 200,
    FIXTURE_UNAVAILABLE: 404,
    CANDIDATE_AMBIGUOUS: 409,
    PENDING_RESERVATION_UNAVAILABLE: 409,
    REFUND_NOT_CONFIRMED: 409,
    PROJECTION_UNAVAILABLE: 503,
  };
  if (!response || !Number.isInteger(response.status) || !exactKeys(response.body, ["reconciled", "status"])) return null;
  const status = response.body.status;
  if (typeof response.body.reconciled !== "boolean" || !Object.hasOwn(expectedStatus, status) || response.status !== expectedStatus[status]) return null;
  if ((status === "RECONCILED") !== response.body.reconciled) return null;
  return status;
}

/**
 * Performs one query-only recovery using an exact verified current Preview.
 * The server fixes the historical transaction source; it is never caller input.
 * The endpoint may repair local reconciliation state after its provider query,
 * but this command never creates a checkout, reserves payment, or sends a refund.
 */
export async function recoverExistingWp4BuyerRefund(input, dependencies = {}) {
  const invocation = validateExistingRefundRecoveryInvocation(input);
  const receipt = createExistingRefundRecoveryReceipt(invocation.ok ? invocation.sourceSha : "0".repeat(40));
  if (!invocation.ok) return receipt;

  const request = dependencies.request ?? defaultRequest;
  receipt.queryAttempts = 1;
  try {
    const response = await request({
      url: fixedUrl(invocation.previewHost, "/api/admin/ops/payuni/wp4-refund-recovery"),
      headers: guardedHeaders(invocation),
      body: undefined,
    });
    const status = recoveryResult(response);
    if (!status) {
      receipt.status = "RESPONSE_INVALID";
      return receipt;
    }
    receipt.status = status;
    receipt.result = status === "RECONCILED" ? "RECONCILED" : "UNRESOLVED";
  } catch {
    receipt.status = "NETWORK_REJECTED";
  }
  return receipt;
}

export async function defaultBrowserSubmit(input, dependencies = {}) {
  const { chromium, errors } = dependencies.playwright ?? await import("playwright");
  // The trusted runner already pins every allowlisted A record in /etc/hosts
  // and permits that exact set in iptables. Do not collapse a multi-edge host
  // to one address here: a single unhealthy edge would make the payment flow
  // fail even though another allowlisted address remains reachable.
  const browser = await chromium.launch({
    headless: true,
    // Never inherit runner secrets or arbitrary environment into Chromium.
    env: fixedBrowserEnvironment(),
    args: [
      "--no-proxy-server",
      "--disable-quic",
    ],
  });
  const context = await browser.newContext({ locale: "zh-TW" });
  const page = await context.newPage();
  const origin = fixedOrigin(input.previewHost);
  let stage = "PAYMENT_PAGE_UNREACHED";
  let apiPostSeen = false;
  let apiStatus = null;
  let apiNetworkRejected = false;
  let apiNetworkFailure = "PAYMENT_API_NETWORK_REJECTED";
  try {
    page.on("request", (request) => {
      try {
        const url = new URL(request.url());
        if (url.protocol === "https:" && url.hostname === "sandbox-api.payuni.com.tw" && url.pathname === "/api/upp" && request.method() === "POST") apiPostSeen = true;
      } catch {}
    });
    page.on("response", (response) => {
      try {
        const url = new URL(response.url());
        if (url.protocol === "https:" && url.hostname === "sandbox-api.payuni.com.tw" && url.pathname === "/api/upp") apiStatus = response.status();
      } catch {}
    });
    page.on("requestfailed", (request) => {
      try {
        const url = new URL(request.url());
        if (
          request.isNavigationRequest()
          && request.method() === "POST"
          && isPayUniPaymentPageUrl(url)
        ) {
          apiNetworkRejected = true;
          apiNetworkFailure = classifyPayUniApiNetworkFailure(request.failure()?.errorText);
        }
      } catch {}
    });
    const [name, value] = input.supportCookie.split("=", 2);
    if (!name?.startsWith("celebrate_support_") || !value) throw new Error("PAYMENT_REJECTED");
    await context.addCookies([{ name, value, url: origin, httpOnly: true, sameSite: "Lax", secure: true }]);
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: REQUEST_TIMEOUT_MS });
    // Chromium can report ERR_ABORTED for a cross-origin native POST
    // navigation even when PayUni returned its payment document. Fetch that
    // exact response inside the same isolated browser context, then fulfill a
    // single exact-host navigation from the in-memory response. The encrypted
    // provider payload never enters logs, disk, or the receipt.
    apiPostSeen = true;
    const paymentDocument = await context.request.post(PAYUNI_UPP_URL, {
      form: input.formPayload,
      failOnStatusCode: false,
      maxRedirects: 0,
      timeout: REQUEST_TIMEOUT_MS,
    });
    apiStatus = paymentDocument.status();
    if (!paymentDocument.ok()) throw new Error("PAYMENT_PROVIDER_HTTP_REJECTED");
    await page.route(PAYUNI_UPP_URL, (route) => route.fulfill({ response: paymentDocument }), { times: 1 });
    await page.goto(PAYUNI_UPP_URL, {
      // Optional third-party resources remain blocked by the fixed egress
      // allowlist; the committed provider document is sufficient for the
      // authoritative field checks below.
      waitUntil: "commit",
      timeout: REQUEST_TIMEOUT_MS,
    });
    stage = "PAYMENT_METHOD_UNAVAILABLE";
    await page.getByText("一次付清", { exact: true }).click();
    await page.locator('input[name="radioOptionpayGroupCredit"]').check({ force: true });
    stage = "PAYMENT_FIELDS_REJECTED";
    await page.getByPlaceholder("16 碼或 19 碼").pressSequentially(input.cardNumber);
    await page.getByPlaceholder("MM/YY").pressSequentially(input.cardExpiry);
    await page.getByPlaceholder("***").pressSequentially(input.cardCvv);
    await page.getByPlaceholder("example@example.com").fill("wp4-buyer-v1@invalid.example");
    stage = "PAYMENT_SUBMIT_REJECTED";
    await page.getByRole("button", { name: "確認送出", exact: true }).click();
    const confirmation = page.getByRole("button", { name: "確定", exact: true });
    try {
      await confirmation.waitFor({ state: "visible", timeout: 5_000 });
      return "PAYMENT_CONFIRMATION_AMBIGUOUS";
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) throw error;
    }
    stage = "RETURN_CALLBACK_UNMAPPED";
    await page.waitForURL((url) => (
      url.protocol === "https:"
      && url.hostname === input.previewHost
      && url.pathname === "/checkout/result"
      && url.searchParams.get("payment") === "updated"
    ), { waitUntil: "domcontentloaded", timeout: 60_000 });
    stage = "RETURN_RESULT_UNMAPPED";
    const resultText = await page.locator("body").innerText();
    return resultText.includes(input.orderNumber) && resultText.includes("付款完成");
  } catch {
    if (stage !== "PAYMENT_PAGE_UNREACHED") return stage;
    if (!apiPostSeen) return "PAYMENT_FORM_NOT_SUBMITTED";
    if (Number.isInteger(apiStatus) && apiStatus >= 400) return "PAYMENT_PROVIDER_HTTP_REJECTED";
    if (apiNetworkRejected) return apiNetworkFailure;
    return "PAYMENT_REDIRECT_UNOBSERVED";
  } finally {
    await browser.close();
  }
}

/**
 * Opens only the fixed server-owned WP4 plan form. The pending checkout is
 * reserved only after the native form rendered PayUni's server-created fields;
 * no runner argument can select a plan, transaction, purpose, or amount.
 */
export async function defaultSubscriptionBrowserSubmit(input, dependencies = {}) {
  const { chromium, errors } = dependencies.playwright ?? await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    env: fixedBrowserEnvironment(),
    args: ["--no-proxy-server", "--disable-quic"],
  });
  const context = await browser.newContext({ locale: "zh-TW" });
  const page = await context.newPage();
  const origin = fixedOrigin(input.previewHost);
  let stage = "CHECKOUT_REJECTED";
  let apiPostSeen = false;
  let apiStatus = null;
  let apiNetworkRejected = false;
  let apiNetworkFailure = "PAYMENT_API_NETWORK_REJECTED";
  try {
    page.on("request", (request) => {
      try {
        const url = new URL(request.url());
        if (url.protocol === "https:" && url.hostname === PAYUNI_PAYMENT_HOST && url.pathname === "/api/upp" && request.method() === "POST") apiPostSeen = true;
      } catch {}
    });
    page.on("response", (response) => {
      try {
        const url = new URL(response.url());
        if (url.protocol === "https:" && url.hostname === PAYUNI_PAYMENT_HOST && url.pathname === "/api/upp") apiStatus = response.status();
      } catch {}
    });
    page.on("requestfailed", (request) => {
      try {
        const url = new URL(request.url());
        if (request.isNavigationRequest() && request.method() === "POST" && isPayUniPaymentPageUrl(url)) {
          apiNetworkRejected = true;
          apiNetworkFailure = classifyPayUniApiNetworkFailure(request.failure()?.errorText);
        }
      } catch {}
    });
    const [name, value] = input.ownerSessionCookie.split("=", 2);
    if (name !== "celebrate_session" || !value) return "PAYMENT_REJECTED";
    await context.addCookies([{ name, value, url: origin, httpOnly: true, sameSite: "Lax", secure: true }]);
    await page.goto(`${origin}/billing/plans`, { waitUntil: "domcontentloaded", timeout: REQUEST_TIMEOUT_MS });
    const planForm = page.locator('form[action="/api/billing/plans/select"]:has(input[name="planId"][value="wp4_synthetic_plan_v1"])');
    await Promise.all([
      page.waitForURL((url) => url.origin === origin && url.pathname === "/billing/plans" && url.searchParams.get("status") === "checkout", { waitUntil: "domcontentloaded", timeout: REQUEST_TIMEOUT_MS }),
      planForm.getByRole("button", { name: "選擇方案", exact: true }).click(),
    ]);
    if (input.markNativePlanCheckoutCreated?.() !== true) return "CHECKOUT_REJECTED";
    const formPayload = await page.locator(`form[action="${PAYUNI_UPP_URL}"] input[type="hidden"]`).evaluateAll((inputs) => Object.fromEntries(
      inputs.map((element) => [element.getAttribute("name"), element.getAttribute("value")]),
    ));
    if (!validFormPayload(formPayload)) return "CHECKOUT_REJECTED";
    const reservation = await input.reservePaymentAttempt();
    if (reservation !== true) return typeof reservation === "string" && FAILURE_CODES.has(reservation)
      ? reservation
      : "PAYMENT_ATTEMPT_REJECTED";

    stage = "PAYMENT_PAGE_UNREACHED";
    apiPostSeen = true;
    const paymentDocument = await context.request.post(PAYUNI_UPP_URL, {
      form: formPayload,
      failOnStatusCode: false,
      maxRedirects: 0,
      timeout: REQUEST_TIMEOUT_MS,
    });
    apiStatus = paymentDocument.status();
    if (!paymentDocument.ok()) throw new Error("PAYMENT_PROVIDER_HTTP_REJECTED");
    await page.route(PAYUNI_UPP_URL, (route) => route.fulfill({ response: paymentDocument }), { times: 1 });
    await page.goto(PAYUNI_UPP_URL, { waitUntil: "commit", timeout: REQUEST_TIMEOUT_MS });
    stage = "PAYMENT_METHOD_UNAVAILABLE";
    await page.getByText("一次付清", { exact: true }).click();
    await page.locator('input[name="radioOptionpayGroupCredit"]').check({ force: true });
    stage = "PAYMENT_FIELDS_REJECTED";
    await page.getByPlaceholder("16 碼或 19 碼").pressSequentially(input.cardNumber);
    await page.getByPlaceholder("MM/YY").pressSequentially(input.cardExpiry);
    await page.getByPlaceholder("***").pressSequentially(input.cardCvv);
    await page.getByPlaceholder("example@example.com").fill("wp4-subscription-v1@invalid.example");
    stage = "PAYMENT_SUBMIT_REJECTED";
    if (input.markPaymentSubmission?.() !== true) return "PAYMENT_SUBMIT_REJECTED";
    await page.getByRole("button", { name: "確認送出", exact: true }).click();
    const confirmation = page.getByRole("button", { name: "確定", exact: true });
    try {
      await confirmation.waitFor({ state: "visible", timeout: 5_000 });
      return "PAYMENT_CONFIRMATION_AMBIGUOUS";
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) throw error;
    }
    stage = "RETURN_CALLBACK_UNMAPPED";
    await page.waitForURL((url) => url.origin === origin && url.pathname === "/checkout/result" && url.searchParams.get("payment") === "updated", { waitUntil: "domcontentloaded", timeout: 60_000 });
    // This only observes the provider return. It is not payment proof: SaaS has
    // no buyer-order capability on this page. The fixed subscription refund and
    // reconciliation operations provide the trusted paid/refund evidence.
    return true;
  } catch {
    if (stage !== "PAYMENT_PAGE_UNREACHED") return stage;
    if (!apiPostSeen) return "PAYMENT_FORM_NOT_SUBMITTED";
    if (Number.isInteger(apiStatus) && apiStatus >= 400) return "PAYMENT_PROVIDER_HTTP_REJECTED";
    if (apiNetworkRejected) return apiNetworkFailure;
    return "PAYMENT_REDIRECT_UNOBSERVED";
  } finally {
    await browser.close();
  }
}

/**
 * Executes exactly one fixed buyer-order path.  All response values that can
 * identify a buyer, order, transaction, provider payload, or secret remain in
 * local variables only and are discarded before the receipt is returned.
 */
export async function runMvpPayUniSandboxE2E(input, dependencies = {}) {
  const invocation = validateInvocation(input);
  const receipt = createReceipt(invocation.ok ? invocation.sourceSha : "0".repeat(40));
  if (!invocation.ok) return fail(receipt, invocation.code);

  const request = dependencies.request ?? defaultRequest;
  const browserSubmit = dependencies.browserSubmit ?? defaultBrowserSubmit;
  const wait = dependencies.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const base = fixedOrigin(invocation.previewHost);
  const guarded = guardedHeaders(invocation);
  let admission;
  let checkout;

  try {
    receipt.sideEffects.fixturePosts = 1;
    const fixture = responseJson(await request({
      url: fixedUrl(invocation.previewHost, "/api/admin/ops/payuni/wp4-fixture"),
      headers: guarded,
      body: undefined,
      outcomeHeader: "x-celebratedeal-wp4-fixture",
    }));
    if (!assertFixtureResponse(fixture)) return fail(receipt, fixtureFailure(fixture));
    receipt.checks.fixtureReady = true;

    receipt.sideEffects.admissionPosts = 1;
    admission = responseJson(await request({
      url: fixedUrl(invocation.previewHost, "/api/payments/checkout/admission"),
      headers: {
        origin: base,
        "x-celebratedeal-client": "web",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...FIXED_FIXTURE,
        idempotencyKey: fixedCheckoutIdempotencyKey(invocation.sourceSha),
      }),
      cookiePrefix: "celebratedeal_checkout_session=",
    }));
    if (!assertAdmissionResponse(admission)) return fail(receipt, "ADMISSION_REJECTED");
    receipt.checks.sameOriginAdmission = true;

    receipt.sideEffects.checkoutPosts = 1;
    checkout = responseJson(await request({
      url: fixedUrl(invocation.previewHost, "/api/payments/checkout"),
      headers: {
        origin: base,
        "x-celebratedeal-client": "web",
        "content-type": "application/json",
        cookie: admission.sessionCookie,
      },
      body: JSON.stringify({
        ...FIXED_FIXTURE,
        idempotencyKey: admission.body.idempotencyKey,
        admissionToken: admission.body.admissionToken,
        buyer: SYNTHETIC_BUYER,
        shipping: SYNTHETIC_SHIPPING,
      }),
      cookiePrefix: "celebrate_support_",
    }));
    if (!assertCheckoutResponse(checkout)) return fail(receipt, "CHECKOUT_REJECTED");
    receipt.checks.checkoutCreated = true;
    receipt.sideEffects.transactionsCreated = 1;

    receipt.sideEffects.paymentAttemptPosts = 1;
    const paymentAttempt = responseJson(await request({
      url: fixedUrl(invocation.previewHost, "/api/admin/ops/payuni/wp4-payment-attempt"),
      headers: guarded,
      body: undefined,
    }));
    if (!assertPaymentAttemptResponse(paymentAttempt)) return fail(receipt, paymentAttemptFailure(paymentAttempt));
    // ALREADY_PAID proves only the current transaction state.  It does not
    // carry a persisted, exact-source Return callback success proof, so it
    // cannot authorize this runner to infer a browser submission, refund, or
    // reconciliation.  Keep every later side effect at zero and fail closed.
    if (paymentAttempt.body.status === "ALREADY_PAID") return fail(receipt, "RETURN_CALLBACK_PROOF_REQUIRED");
    receipt.checks.paymentAttemptReserved = true;

    receipt.sideEffects.paymentReservationsCreated = 1;
    receipt.sideEffects.browserPaymentSubmissions = 1;
    const callbackMapped = await browserSubmit({
      previewHost: invocation.previewHost,
      cardNumber: invocation.cardNumber,
      cardExpiry: invocation.cardExpiry,
      cardCvv: invocation.cardCvv,
      formPayload: checkout.body.formPayload,
      supportCookie: checkout.supportCookie,
      orderNumber: checkout.body.orderNumber,
      transactionId: checkout.body.transactionId,
    });
    if (callbackMapped !== true) {
      const browserFailure = typeof callbackMapped === "string" && FAILURE_CODES.has(callbackMapped)
        ? callbackMapped
        : "RETURN_CALLBACK_UNMAPPED";
      return fail(receipt, browserFailure);
    }
    receipt.sideEffects.payments = 1;
    receipt.checks.payuniFormAccepted = true;
    receipt.checks.returnCallbackMapped = true;

    receipt.sideEffects.refundPosts = 1;
    const refund = responseJson(await request({
      url: fixedUrl(invocation.previewHost, "/api/admin/ops/payuni/wp4-refund"),
      headers: guarded,
      body: undefined,
    }));
    const refundCompletedInline = assertRefundResponse(refund);
    const refundRequiresReconciliation = assertRefundRequiresReconciliation(refund);
    if (!refundCompletedInline && !refundRequiresReconciliation) return fail(receipt, "REFUND_REJECTED");
    if (refundCompletedInline) {
      receipt.checks.refundCompleted = true;
      receipt.sideEffects.refunds = 1;
    }

    let reconciliation;
    const maximumReconcileAttempts = refundRequiresReconciliation ? SIDE_EFFECT_BUDGET.reconcilePosts : 1;
    for (let attempt = 1; attempt <= maximumReconcileAttempts; attempt += 1) {
      receipt.sideEffects.reconcilePosts = attempt;
      reconciliation = responseJson(await request({
        url: fixedUrl(invocation.previewHost, "/api/admin/ops/payuni/wp4-reconcile"),
        headers: guarded,
        body: undefined,
      }));
      if (assertReconcileResponse(reconciliation)) break;
      if (!refundRequiresReconciliation || attempt === maximumReconcileAttempts) {
        return fail(receipt, "RECONCILE_REJECTED");
      }
      await wait(10_000);
    }
    // A provider write can succeed while the application loses the success
    // response or its local completion transaction fails. The reconciliation
    // endpoint queries PayUni and validates order, trade and amount before it
    // repairs the exact-source reservation, so a successful response is also
    // authoritative proof that the refund occurred.
    if (refundRequiresReconciliation) {
      receipt.checks.refundCompleted = true;
      receipt.sideEffects.refunds = 1;
    }
    receipt.checks.reconciled = true;
    receipt.result = "PASS";
    receipt.failure = "NONE";
  } catch (error) {
    fail(receipt, error instanceof Error && error.message === "NETWORK_REJECTED" ? "NETWORK_REJECTED" : "INTERNAL_REJECTED");
  }

  if (!validateMvpPayUniReceipt(receipt).ok) return fail(createReceipt(invocation.sourceSha), "INTERNAL_REJECTED");
  return receipt;
}

function assertSubscriptionSessionResponse(response) {
  return response?.status === 204
    && typeof response.sessionCookie === "string"
    && response.sessionCookie.startsWith("celebrate_session=")
    && response.sessionCookie.length > "celebrate_session=".length;
}

function assertSubscriptionRefundResponse(response) {
  return response.status === 200
    && exactKeys(response.body, ["status", "purpose", "phase", "providerWriteAttempted"])
    && response.body.status === "COMPLETED"
    && response.body.purpose === FIXED_SUBSCRIPTION_PURPOSE
    && response.body.phase === "remaining"
    && response.body.providerWriteAttempted === true;
}

function assertSubscriptionRefundRequiresReconciliation(response) {
  return response.status === 503
    && exactKeys(response.body, ["status", "purpose", "phase", "providerWriteAttempted"])
    && response.body.status === "RECONCILIATION_REQUIRED"
    && response.body.purpose === FIXED_SUBSCRIPTION_PURPOSE
    && response.body.phase === "remaining"
    && response.body.providerWriteAttempted === true;
}

function fixedBrowserEnvironment() {
  return process.platform === "win32"
    ? { PATH: "C:\\Windows\\System32;C:\\Windows", SystemRoot: "C:\\Windows", TEMP: "C:\\Windows\\Temp", TMP: "C:\\Windows\\Temp" }
    : { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", HOME: "/tmp", TMPDIR: "/tmp" };
}

/** Executes only the fixed, server-owned WP4 SaaS checkout and refund path. */
export async function runMvpPayUniSandboxSubscriptionE2E(input, dependencies = {}) {
  const invocation = validateInvocation(input);
  const receipt = createSubscriptionReceipt(invocation.ok ? invocation.sourceSha : "0".repeat(40));
  if (!invocation.ok) return fail(receipt, invocation.code);

  const request = dependencies.request ?? defaultRequest;
  const browserSubmit = dependencies.browserSubmit ?? defaultSubscriptionBrowserSubmit;
  const wait = dependencies.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const guarded = guardedHeaders(invocation);
  try {
    receipt.sideEffects.fixturePosts = 1;
    const fixture = responseJson(await request({
      url: fixedUrl(invocation.previewHost, "/api/admin/ops/payuni/wp4-fixture"),
      headers: guarded,
      body: undefined,
      outcomeHeader: "x-celebratedeal-wp4-fixture",
    }));
    if (!assertSubscriptionFixtureResponse(fixture)) return fail(receipt, fixtureFailure(fixture));
    receipt.checks.fixtureReady = true;

    receipt.sideEffects.sessionPosts = 1;
    const session = await request({
      url: fixedUrl(invocation.previewHost, "/api/admin/ops/payuni/wp4-session"),
      headers: guarded,
      body: undefined,
      cookiePrefix: "celebrate_session=",
    });
    if (!assertSubscriptionSessionResponse(session)) return fail(receipt, "CHECKOUT_REJECTED");
    receipt.checks.ownerSessionIssued = true;

    receipt.sideEffects.planSelections = 1;
    const callbackMapped = await browserSubmit({
      previewHost: invocation.previewHost,
      ownerSessionCookie: session.sessionCookie,
      cardNumber: invocation.cardNumber,
      cardExpiry: invocation.cardExpiry,
      cardCvv: invocation.cardCvv,
      markNativePlanCheckoutCreated: () => {
        if (receipt.checks.nativePlanCheckoutCreated || receipt.sideEffects.transactionsCreated !== 0) return false;
        receipt.checks.nativePlanCheckoutCreated = true;
        receipt.sideEffects.transactionsCreated = 1;
        return true;
      },
      reservePaymentAttempt: async () => {
        receipt.sideEffects.paymentAttemptPosts = 1;
        const paymentAttempt = responseJson(await request({
          url: fixedUrl(invocation.previewHost, "/api/admin/ops/payuni/wp4-subscription-payment-attempt"),
          headers: guarded,
          body: undefined,
        }));
        if (!assertPaymentAttemptResponse(paymentAttempt)) return paymentAttemptFailure(paymentAttempt);
        if (paymentAttempt.body.status === "ALREADY_PAID") return "RETURN_CALLBACK_PROOF_REQUIRED";
        receipt.checks.paymentAttemptReserved = true;
        receipt.sideEffects.paymentReservationsCreated = 1;
        return true;
      },
      markPaymentSubmission: () => {
        if (receipt.sideEffects.browserPaymentSubmissions !== 0) return false;
        receipt.sideEffects.browserPaymentSubmissions = 1;
        return true;
      },
    });
    if (callbackMapped !== true) {
      const browserFailure = typeof callbackMapped === "string" && FAILURE_CODES.has(callbackMapped)
        ? callbackMapped
        : "RETURN_CALLBACK_UNMAPPED";
      return fail(receipt, browserFailure);
    }
    receipt.checks.payuniFormSubmitted = true;

    // Read only the server-owned subscription state. A provider return URL
    // alone cannot prove activation or quota, and must not authorize a refund.
    receipt.sideEffects.statePosts = 1;
    const activeState = responseJson(await request({
      url: fixedUrl(invocation.previewHost, "/api/admin/ops/payuni/wp4-subscription-state"),
      headers: guarded,
      body: undefined,
    }));
    if (activeState?.status !== 200 || !exactKeys(activeState.body, ["status"]) || activeState.body.status !== "ACTIVE_VERIFIED") {
      return fail(receipt, "SUBSCRIPTION_STATE_REJECTED");
    }
    receipt.sideEffects.payments = 1;
    receipt.checks.trustedSubscriptionPayment = true;
    receipt.checks.activeEntitlementVerified = true;

    receipt.sideEffects.refundPosts = 1;
    const refund = responseJson(await request({
      url: fixedUrl(invocation.previewHost, "/api/admin/ops/payuni/wp4-subscription-refund"),
      headers: guarded,
      body: undefined,
    }));
    const refundCompletedInline = assertSubscriptionRefundResponse(refund);
    const refundRequiresReconciliation = assertSubscriptionRefundRequiresReconciliation(refund);
    if (!refundCompletedInline && !refundRequiresReconciliation) return fail(receipt, "REFUND_REJECTED");
    if (refundCompletedInline) {
      receipt.checks.refundCompleted = true;
      receipt.sideEffects.refunds = 1;
    }

    const maximumReconcileAttempts = refundRequiresReconciliation ? SUBSCRIPTION_SIDE_EFFECT_BUDGET.reconcilePosts : 1;
    for (let attempt = 1; attempt <= maximumReconcileAttempts; attempt += 1) {
      receipt.sideEffects.reconcilePosts = attempt;
      const reconciliation = responseJson(await request({
        url: fixedUrl(invocation.previewHost, "/api/admin/ops/payuni/wp4-subscription-reconcile"),
        headers: guarded,
        body: undefined,
      }));
      if (assertReconcileResponse(reconciliation)) break;
      if (!refundRequiresReconciliation || attempt === maximumReconcileAttempts) return fail(receipt, "RECONCILE_REJECTED");
      await wait(10_000);
    }
    if (refundRequiresReconciliation) {
      receipt.checks.refundCompleted = true;
      receipt.sideEffects.refunds = 1;
    }
    receipt.checks.reconciled = true;
    receipt.sideEffects.statePosts = 2;
    const refundedState = responseJson(await request({
      url: fixedUrl(invocation.previewHost, "/api/admin/ops/payuni/wp4-subscription-state"),
      headers: guarded,
      body: undefined,
    }));
    if (refundedState?.status !== 200 || !exactKeys(refundedState.body, ["status"]) || refundedState.body.status !== "REFUNDED_VERIFIED") {
      return fail(receipt, "SUBSCRIPTION_STATE_REJECTED");
    }
    receipt.checks.refundedEntitlementVerified = true;
    receipt.result = "PASS";
    receipt.failure = "NONE";
  } catch (error) {
    fail(receipt, error instanceof Error && error.message === "NETWORK_REJECTED" ? "NETWORK_REJECTED" : "INTERNAL_REJECTED");
  }

  return finalizeMvpPayUniSubscriptionReceipt(receipt);
}

function fixedReceiptPath(runnerTemp, receiptName) {
  if (typeof runnerTemp !== "string" || runnerTemp.trim().length === 0) throw new Error("RECEIPT_PATH_REJECTED");
  if (!FIXED_RECEIPT_FILENAMES.has(receiptName)) throw new Error("RECEIPT_PATH_REJECTED");
  const directory = path.resolve(runnerTemp, RECEIPT_DIRECTORY);
  return { directory, receiptPath: path.join(directory, receiptName) };
}

async function writeFixedReceipt(receipt, runnerTemp, receiptName) {
  const { directory, receiptPath } = fixedReceiptPath(runnerTemp, receiptName);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return receiptPath;
}

export async function writeMvpPayUniReceipt(receipt, runnerTemp) {
  return writeFixedReceipt(receipt, runnerTemp, RECEIPT_FILENAME);
}

export async function writeExistingRefundRecoveryReceipt(receipt, runnerTemp) {
  return writeFixedReceipt(receipt, runnerTemp, RECOVERY_RECEIPT_FILENAME);
}

export async function writeMvpPayUniSubscriptionReceipt(receipt, runnerTemp) {
  return writeFixedReceipt(receipt, runnerTemp, SUBSCRIPTION_RECEIPT_FILENAME);
}

export async function validateWrittenMvpPayUniReceipt(runnerTemp) {
  try {
    const { receiptPath } = fixedReceiptPath(runnerTemp, RECEIPT_FILENAME);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    return validateMvpPayUniReceipt(receipt).ok;
  } catch {
    return false;
  }
}

export async function validateWrittenExistingRefundRecoveryReceipt(runnerTemp) {
  try {
    const { receiptPath } = fixedReceiptPath(runnerTemp, RECOVERY_RECEIPT_FILENAME);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    return validateExistingRefundRecoveryReceipt(receipt).ok;
  } catch {
    return false;
  }
}

export async function validateWrittenMvpPayUniSubscriptionReceipt(runnerTemp) {
  try {
    const { receiptPath } = fixedReceiptPath(runnerTemp, SUBSCRIPTION_RECEIPT_FILENAME);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    return validateMvpPayUniSubscriptionReceipt(receipt).ok;
  } catch {
    return false;
  }
}

async function main() {
  const runnerTemp = process.env.RUNNER_TEMP;
  if (process.argv.length === 3 && process.argv[2] === "--verify-lineage") {
    const valid = await verifyMvpPayUniLineage();
    process.stdout.write(`mvp_payuni_lineage=${valid ? "PASS" : "BLOCKED"}\n`);
    process.exitCode = valid ? 0 : 2;
    return;
  }
  if (process.argv.length === 3 && process.argv[2] === "--validate-receipt") {
    const valid = await validateWrittenMvpPayUniReceipt(runnerTemp);
    process.stdout.write(`mvp_payuni_receipt=${valid ? "PASS" : "BLOCKED"}\n`);
    process.exitCode = valid ? 0 : 2;
    return;
  }
  if (process.argv.length === 3 && process.argv[2] === "--validate-recovery-receipt") {
    const valid = await validateWrittenExistingRefundRecoveryReceipt(runnerTemp);
    process.stdout.write(`mvp_payuni_refund_recovery_receipt=${valid ? "PASS" : "BLOCKED"}\n`);
    process.exitCode = valid ? 0 : 2;
    return;
  }
  if (process.argv.length === 3 && process.argv[2] === "--validate-subscription-receipt") {
    const valid = await validateWrittenMvpPayUniSubscriptionReceipt(runnerTemp);
    process.stdout.write(`mvp_payuni_subscription_receipt=${valid ? "PASS" : "BLOCKED"}\n`);
    process.exitCode = valid ? 0 : 2;
    return;
  }
  if (process.argv.length === 3 && process.argv[2] === "--recover-existing-refund") {
    const receipt = await recoverExistingWp4BuyerRefund(readExistingRefundRecoveryInputs());
    try {
      await writeExistingRefundRecoveryReceipt(receipt, runnerTemp);
      process.stdout.write(`mvp_payuni_refund_recovery=${receipt.result}; status=${receipt.status}\n`);
      process.exitCode = receipt.result === "RECONCILED" ? 0 : 2;
    } catch {
      process.stdout.write("mvp_payuni_refund_recovery=BLOCKED; status=RESPONSE_INVALID\n");
      process.exitCode = 2;
    }
    return;
  }
  if (process.argv.length === 3 && process.argv[2] === "--subscription") {
    let subscriptionReceipt;
    try {
      subscriptionReceipt = await runMvpPayUniSandboxSubscriptionE2E(readFixedInputs());
    } catch {
      subscriptionReceipt = fail(createSubscriptionReceipt(), "INTERNAL_REJECTED");
    }
    try {
      await writeMvpPayUniSubscriptionReceipt(subscriptionReceipt, runnerTemp);
      process.stdout.write(`mvp_payuni_subscription=${subscriptionReceipt.result}\n`);
      process.exitCode = subscriptionReceipt.result === "PASS" ? 0 : 2;
    } catch {
      process.stdout.write("mvp_payuni_subscription=BLOCKED\n");
      process.exitCode = 2;
    }
    return;
  }
  let receipt;
  if (process.argv.length !== 2) {
    receipt = fail(createReceipt(), "INPUT_REJECTED");
  } else {
    try {
      receipt = await runMvpPayUniSandboxE2E(readFixedInputs());
    } catch {
      receipt = fail(createReceipt(), "INTERNAL_REJECTED");
    }
  }
  try {
    await writeMvpPayUniReceipt(receipt, runnerTemp);
    process.stdout.write(`mvp_payuni_sandbox_e2e=${receipt.result}\n`);
    process.exitCode = receipt.result === "PASS" ? 0 : 2;
  } catch {
    process.stdout.write("mvp_payuni_sandbox_e2e=BLOCKED\n");
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { process.exitCode = 2; });
}
