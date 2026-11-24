import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { STAGING_ALIAS_HOST, verifyAliasAttestation, verifyDeployment, verifyShaOnProtectedMaster } from "./secure-staging-runner.mjs";

const SOURCE_SHA = /^[a-f0-9]{40}$/u;
const PREVIEW_HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ADMISSION_TOKEN = /^ca1\.[A-Za-z0-9_-]{1,768}\.[A-Za-z0-9_-]{43}$/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;

export const MVP_PAYUNI_SANDBOX_E2E_SCHEMA = "celebratedeal-mvp-payuni-sandbox-e2e/v2";
export const MVP_PAYUNI_PAYMENT_ONLY_SCHEMA = "celebratedeal-mvp-payuni-payment-only/v1";
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
  orderProofPosts: 2,
  callbackReplays: 1,
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
  "orderPersisted",
  "duplicateCallbackVerified",
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
  "FIXTURE_UNCLASSIFIED_FAILURE",
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
  "PAYMENT_VALIDATION_CARD",
  "PAYMENT_VALIDATION_EXPIRY",
  "PAYMENT_VALIDATION_CVV",
  "PAYMENT_VALIDATION_EMAIL",
  "PAYMENT_VALIDATION_FIELD",
  "RETURN_CALLBACK_UNMAPPED",
  "RETURN_RESULT_UNMAPPED",
  "RETURN_CALLBACK_PROOF_REQUIRED",
  "ORDER_PROOF_REJECTED",
  "CALLBACK_REPLAY_REJECTED",
  "DUPLICATE_PROOF_REJECTED",
  "REFUND_REJECTED",
  "SUBSCRIPTION_STATE_REJECTED",
  "RECONCILE_REJECTED",
  "NETWORK_REJECTED",
  "INTERNAL_REJECTED",
]);
const FIXTURE_HTTP_STATUSES = new Set([400, 403, 404, 429, 500, 502, 503, 504]);
for (const status of FIXTURE_HTTP_STATUSES) FAILURE_CODES.add(`FIXTURE_HTTP_${status}`);
FAILURE_CODES.add("FIXTURE_HTTP_OTHER");
// The server emits only fixed fixture stages and allowlisted Prisma categories.
// Enumerate the corresponding receipt values so no arbitrary header is trusted.
for (const stage of ["VENDOR", "OWNER", "MEMBERSHIP", "PRODUCT", "PLAN", "INVOICE", "TRANSACTION"]) {
  for (const code of ["P2022", "P2021", "P2002", "P2003", "P1001", "OTHER"]) {
    FAILURE_CODES.add(`FIXTURE_DB_${stage}_${code}`);
  }
}
const PAYUNI_UPP_URL = "https://sandbox-api.payuni.com.tw/api/upp";
const PAYUNI_PAYMENT_HOST = new URL(PAYUNI_UPP_URL).hostname;
const REQUEST_TIMEOUT_MS = 30_000;
const RECEIPT_DIRECTORY = "celebratedeal-secure-receipts";
const RECEIPT_FILENAME = "wp4-payuni-sandbox-reconciliation-receipt.json";
const PAYMENT_ONLY_RECEIPT_FILENAME = "wp4-payuni-sandbox-payment-only-receipt.json";
const RECOVERY_RECEIPT_FILENAME = "wp4-payuni-sandbox-refund-recovery-receipt.json";
const SUBSCRIPTION_RECEIPT_FILENAME = "wp4-payuni-sandbox-subscription-receipt.json";
const BUYER_CONTINUATION_RECEIPT_FILENAME = "wp4-payuni-buyer-existing-continuation-receipt.json";
export const MVP_PAYUNI_SANDBOX_SUBSCRIPTION_SCHEMA = "celebratedeal-mvp-payuni-sandbox-subscription-e2e/v2";
export const MVP_PAYUNI_BUYER_CONTINUATION_SCHEMA = "celebratedeal-wp4-buyer-existing-continuation/v1";
export const BUYER_CONTINUATION_TRANSACTION_SOURCE_SHA = "8497ec1ad66a07b0a286585dc050915c998d0f67";
const BUYER_PAYMENT_CHECK_FILE = "wp4-payuni-buyer-payment-check-receipt.json";
const BUYER_CALLBACK_RETRY_FILE = "wp4-payuni-buyer-callback-retry-receipt.json";
const FIXED_RECEIPT_FILENAMES = new Set([RECEIPT_FILENAME, PAYMENT_ONLY_RECEIPT_FILENAME, RECOVERY_RECEIPT_FILENAME, SUBSCRIPTION_RECEIPT_FILENAME, BUYER_PAYMENT_CHECK_FILE, BUYER_CALLBACK_RETRY_FILE, BUYER_CONTINUATION_RECEIPT_FILENAME]);
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
// Application-owned stages and coarse elapsed bands only; never copy error fields.
const RECOVERY_TRANSACTION_STAGES = new Set([
  "TRANSACTION_START", "LOAD_TRANSACTION", "LOAD_RESERVATIONS", "LOAD_TOTALS",
  "RELEASE_RESERVATION", "UPDATE_RESERVATION", "UPDATE_TRANSACTION",
  "PLATFORM_PROJECTION", "PAYMENT_ACCOUNTING", "AUDIT", "COMMIT",
]);
const RECOVERY_TRANSACTION_ELAPSED = new Set(["LT_5S", "FROM_5S_TO_15S", "GE_15S"]);
function validRecoveryTransactionFailure(value) {
  return exactKeys(value, ["stage", "elapsedBucket"])
    && RECOVERY_TRANSACTION_STAGES.has(value.stage)
    && RECOVERY_TRANSACTION_ELAPSED.has(value.elapsedBucket);
}
const RECOVERY_RECONCILIATION_FAILURES = Object.freeze([
  "RECONCILIATION_TRANSACTION_NOT_FOUND",
  "RECONCILIATION_PROVIDER_MISMATCH",
  "RECONCILIATION_PROVIDER_REF_MISMATCH",
  "RECONCILIATION_PROVIDER_AMOUNT_MISMATCH",
  "RECONCILIATION_UNSUPPORTED_STATUS",
  "RECONCILIATION_LOCAL_AMOUNT_MISMATCH",
  "RECONCILIATION_LOCAL_STATE_AMBIGUOUS",
  "RECONCILIATION_UNKNOWN_FAILED",
  "RECONCILIATION_DATABASE_TRANSACTION_FAILED",
  "RECONCILIATION_DATABASE_CONFLICT",
  "RECONCILIATION_DATABASE_CONSTRAINT_FAILED",
  "RECONCILIATION_DATABASE_SCHEMA_MISMATCH",
  "RECONCILIATION_DATABASE_RECORD_MISSING",
  "RECONCILIATION_DATABASE_REQUEST_FAILED",
  "RECONCILIATION_DATABASE_VALIDATION_FAILED",
  "RECONCILIATION_DATABASE_UNAVAILABLE",
  "RECONCILIATION_DATABASE_ENGINE_FAILED",
  "RECONCILIATION_PLATFORM_PROJECTION_REJECTED",
]);
const RECOVERY_STATUSES = new Set([
  ...RECOVERY_QUERY_FAILURES,
  ...RECOVERY_RECONCILIATION_FAILURES,
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
 * record before any PayUni or application secret is injected into the job, then
 * proves that the fixed staging alias is serving that exact deployment.
 * Returns a fixed reason code ("VERIFIED" on success); never throws.
 */
export async function diagnoseMvpPayUniLineage(source = process.env, dependencies = {}) {
  const sourceSha = typeof source.CELEBRATEDEAL_SOURCE_SHA === "string"
    ? source.CELEBRATEDEAL_SOURCE_SHA.trim().toLowerCase()
    : "";
  const previewHost = typeof source.CELEBRATEDEAL_DEPLOYMENT_HOST === "string"
    ? source.CELEBRATEDEAL_DEPLOYMENT_HOST.trim().toLowerCase()
    : "";
  if (!SOURCE_SHA.test(sourceSha) || !PREVIEW_HOST.test(previewHost) || !requiredText(source.GITHUB_TOKEN)) return "INPUT_REJECTED";

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
      || lineage.ready !== true) return "GITHUB_DEPLOYMENT_LINEAGE_MISMATCH";

    const surface = typeof source.CELEBRATEDEAL_BROWSER_SURFACE === "string" ? source.CELEBRATEDEAL_BROWSER_SURFACE : "";
    if (surface !== "" && surface !== "fixed_alias" && surface !== "immutable_preview") return "INPUT_REJECTED";
    // Every surface: the commit must be protected master itself or an ancestor. The alias
    // self-attestation below cannot detect a forged identity, only an unreviewed deployment.
    await (dependencies.verifyShaOnProtectedMasterImpl ?? verifyShaOnProtectedMaster)(sourceSha, source.GITHUB_TOKEN, fetchImpl);
    if (surface === "immutable_preview") {
      // Explicit pre-cutover mode only: the alias does not serve this deployment yet.
      const health = await fetchImpl(fixedUrl(previewHost, "/api/health"), {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return health.status === 200 && !health.headers.has("location") ? "VERIFIED" : "PREVIEW_HEALTH_FAILED";
    }
    // Vercel firewalls direct probes of the immutable preview host (403 deny). The
    // alias must instead attest, from inside the deployment it routes to, the same
    // commit SHA and Preview host that the GitHub record above bound together.
    const verifyAliasImpl = dependencies.verifyAliasAttestationImpl ?? verifyAliasAttestation;
    await verifyAliasImpl({ sourceSha, previewHost }, fetchImpl);
    return "VERIFIED";
  } catch (error) {
    const code = typeof error?.message === "string" ? error.message : "";
    return /^(?:(?:GITHUB_DEPLOYMENT|ALIAS_ATTESTATION)_[A-Z0-9_]+|SOURCE_NOT_ON_PROTECTED_MASTER|PROTECTED_MASTER_CHECK_FAILED)$/u.test(code) ? code : "LINEAGE_CHECK_FAILED";
  }
}

export async function verifyMvpPayUniLineage(source = process.env, dependencies = {}) {
  return await diagnoseMvpPayUniLineage(source, dependencies) === "VERIFIED";
}

/**
 * Re-attests the fixed alias immediately before a secret-bearing flow. The GitHub
 * lineage gate and the protected-master check already ran (--verify-lineage) in an
 * earlier step of the same protected job with the same immutable dispatch inputs;
 * this repeat only closes the window in which the alias could have been moved.
 * These execution steps intentionally carry no GITHUB_TOKEN.
 */
export async function attestOperationHost(input, dependencies = {}) {
  const sourceSha = typeof input?.sourceSha === "string" ? input.sourceSha.trim().toLowerCase() : "";
  const previewHost = typeof input?.previewHost === "string" ? input.previewHost.trim().toLowerCase() : "";
  if (!SOURCE_SHA.test(sourceSha) || !PREVIEW_HOST.test(previewHost)) return { ok: false, code: "INPUT_REJECTED" };
  try {
    const verifyAliasImpl = dependencies.verifyAliasAttestationImpl ?? verifyAliasAttestation;
    const attested = await verifyAliasImpl({ sourceSha, previewHost }, dependencies.fetchImpl ?? fetch);
    return attested?.host === STAGING_ALIAS_HOST ? { ok: true, operationHost: STAGING_ALIAS_HOST } : { ok: false, code: "ALIAS_ATTESTATION_FAILED" };
  } catch (error) {
    const code = typeof error?.message === "string" && /^ALIAS_ATTESTATION_[A-Z_]+$/u.test(error.message) ? error.message : "ALIAS_ATTESTATION_FAILED";
    return { ok: false, code };
  }
}

/**
 * Application requests go to the attested alias only. Without an attested
 * operation host a flow addresses the immutable Preview, which Vercel rejects;
 * the Q1 wrapper relies on that default and rewrites it to the alias itself.
 */
function operationHostFor(invocation, dependencies) {
  return dependencies?.operationHost === STAGING_ALIAS_HOST ? STAGING_ALIAS_HOST : invocation.previewHost;
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
      orderPersisted: false,
      duplicateCallbackVerified: false,
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
      orderProofPosts: 0,
      callbackReplays: 0,
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
  if (checks.orderPersisted && (!checks.returnCallbackMapped || effects.orderProofPosts < 1)) return false;
  if (checks.duplicateCallbackVerified && (!checks.orderPersisted || effects.callbackReplays !== 1 || effects.orderProofPosts !== 2)) return false;
  if (checks.refundCompleted && (!checks.duplicateCallbackVerified || effects.refundPosts !== 1 || effects.refunds !== 1)) return false;
  if (checks.reconciled && (!checks.refundCompleted || effects.reconcilePosts < 1)) return false;
  if (effects.admissionPosts > 0 && !checks.fixtureReady) return false;
  if (effects.checkoutPosts > 0 && !checks.sameOriginAdmission) return false;
  if (effects.paymentAttemptPosts > 0 && !checks.checkoutCreated) return false;
  if (effects.paymentReservationsCreated > 0 && !checks.paymentAttemptReserved) return false;
  if (effects.browserPaymentSubmissions > 0 && !checks.paymentAttemptReserved) return false;
  if (effects.orderProofPosts > 0 && !checks.returnCallbackMapped) return false;
  if (effects.orderProofPosts === 2 && effects.callbackReplays !== 1) return false;
  if (effects.callbackReplays > 0 && !checks.orderPersisted) return false;
  if (effects.refundPosts > 0 && !checks.duplicateCallbackVerified) return false;
  if (effects.reconcilePosts > 0 && !checks.refundCompleted && receipt.failure !== "RECONCILE_REJECTED") return false;
  if (effects.transactionsCreated > 0 && !checks.checkoutCreated) return false;
  if (effects.payments > 0 && !checks.returnCallbackMapped) return false;
  if (effects.refunds > 0 && !checks.refundCompleted) return false;
  return true;
}

export function validateMvpPayUniReceipt(receipt) {
  return validateBuyerReceipt(receipt, false);
}

/** Payment acceptance is distinct from the legacy payment-and-refund acceptance. */
export function validatePaymentOnlyReceipt(receipt) {
  return validateBuyerReceipt(receipt, true);
}

function validateBuyerReceipt(receipt, paymentOnly) {
  const errors = [];
  if (!exactKeys(receipt, RECEIPT_KEYS)) errors.push("SCHEMA_KEYS");
  if (!exactKeys(receipt?.checks, CHECK_KEYS)) errors.push("CHECK_KEYS");
  if (!exactKeys(receipt?.sideEffects, Object.keys(SIDE_EFFECT_BUDGET))) errors.push("SIDE_EFFECT_KEYS");
  if (!exactKeys(receipt?.safety, SAFETY_KEYS)) errors.push("SAFETY_KEYS");
  if (receipt?.schemaVersion !== (paymentOnly ? MVP_PAYUNI_PAYMENT_ONLY_SCHEMA : MVP_PAYUNI_SANDBOX_E2E_SCHEMA) || receipt?.purpose !== FIXED_PURPOSE || receipt?.environment !== FIXED_PAYUNI_ENV) errors.push("FIXED_ENUMS");
  if (!SOURCE_SHA.test(receipt?.sourceSha ?? "")) errors.push("SOURCE_SHA");
  if (!new Set(["PASS", "BLOCKED"]).has(receipt?.result)) errors.push("RESULT");
  if (!FAILURE_CODES.has(receipt?.failure)) errors.push("FAILURE");
  if (!withinBudget(receipt) || receipt?.safety?.sideEffectBudgetExceeded !== false) errors.push("SIDE_EFFECT_BUDGET");
  if (receipt?.safety?.sanitized !== true || !allFalse(receipt?.safety, SAFETY_KEYS.filter((key) => key !== "sanitized" && key !== "sideEffectBudgetExceeded"))) errors.push("SANITIZATION");
  if (![...CHECK_KEYS].every((key) => typeof receipt?.checks?.[key] === "boolean")) errors.push("CHECK_VALUES");
  if (!completedPrefix(receipt)) errors.push("SEQUENCE");

  const requiredChecks = paymentOnly ? CHECK_KEYS.filter((key) => !["refundCompleted", "reconciled"].includes(key)) : CHECK_KEYS;
  if (paymentOnly && (receipt?.checks?.refundCompleted !== false || receipt?.checks?.reconciled !== false
    || ["refundPosts", "refunds", "reconcilePosts"].some((key) => receipt?.sideEffects?.[key] !== 0))) errors.push("REFUNDS_FORBIDDEN");
  const completed = requiredChecks.every((key) => receipt?.checks?.[key] === true);
  if (receipt?.result === "PASS") {
    if (!completed || receipt.failure !== "NONE") errors.push("PASS_COMPLETENESS");
    const effects = receipt.sideEffects;
    const fixedOne = ["fixturePosts", "admissionPosts", "checkoutPosts", "paymentAttemptPosts", "transactionsCreated", "callbackReplays", ...(paymentOnly ? [] : ["refundPosts", "refunds"])];
    const currentExecution = effects.paymentReservationsCreated === 1 && effects.browserPaymentSubmissions === 1 && effects.payments === 1;
    if (fixedOne.some((key) => effects[key] !== 1) || effects.orderProofPosts !== 2 || !currentExecution) errors.push("PASS_EFFECTS");
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
  const hasDiagnostic = receipt != null && Object.hasOwn(receipt, "transactionFailure");
  if (!exactKeys(receipt, hasDiagnostic ? [...RECOVERY_RECEIPT_KEYS, "transactionFailure"] : RECOVERY_RECEIPT_KEYS)) errors.push("SCHEMA_KEYS");
  if (hasDiagnostic && (receipt.status !== "RECONCILIATION_DATABASE_TRANSACTION_FAILED"
    || !validRecoveryTransactionFailure(receipt.transactionFailure))) errors.push("TRANSACTION_DIAGNOSTIC");
  if (receipt?.schemaVersion !== EXISTING_REFUND_RECOVERY_SCHEMA || receipt?.purpose !== FIXED_PURPOSE || !SOURCE_SHA.test(receipt?.sourceSha ?? "") || receipt?.transactionSourceSha !== EXISTING_REFUND_RECOVERY_SOURCE_SHA) {
    errors.push("FIXED_IDENTITY");
  }
  if (!new Set(["RECONCILED", "UNRESOLVED", "BLOCKED"]).has(receipt?.result)) errors.push("RESULT");
  if (!RECOVERY_STATUSES.has(receipt?.status)) errors.push("STATUS");
  if (!boundedInteger(receipt?.queryAttempts, 1)) errors.push("QUERY_BUDGET");
  if (receipt?.paymentSubmissions !== 0 || receipt?.refundSubmissions !== 0) errors.push("SUBMISSION_BUDGET");

  const queriedStatuses = new Set([
    ...RECOVERY_QUERY_FAILURES,
    ...RECOVERY_RECONCILIATION_FAILURES,
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
  if ([...RECOVERY_QUERY_FAILURES, ...RECOVERY_RECONCILIATION_FAILURES, "FIXTURE_UNAVAILABLE", "CANDIDATE_AMBIGUOUS", "PENDING_RESERVATION_UNAVAILABLE", "REFUND_NOT_CONFIRMED", "PROJECTION_UNAVAILABLE"].includes(receipt?.status) && receipt?.result !== "UNRESOLVED") {
    errors.push("UNRESOLVED_RESULT");
  }
  return { ok: errors.length === 0, errors };
}

function fail(receipt, code) {
  receipt.result = "BLOCKED";
  receipt.failure = FAILURE_CODES.has(code) ? code : "INTERNAL_REJECTED";
  return receipt;
}

export function finalizeMvpPayUniReceipt(receipt) {
  // 驗證失敗仍須保留已發生的副作用，讓獨立 validator 拒絕不完整證據。
  return validateMvpPayUniReceipt(receipt).ok ? receipt : fail(receipt, "INTERNAL_REJECTED");
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
    && boundedInteger(response.body.createdCount, 6)
    && boundedInteger(response.body.reusedCount, 6)
    && response.body.createdCount + response.body.reusedCount === 6;
}

function assertSubscriptionFixtureResponse(response) {
  return response.status === 200
    && exactKeys(response.body, ["ready", "createdCount", "reusedCount"])
    && response.body.ready === true
    && boundedInteger(response.body.createdCount, 6)
    && boundedInteger(response.body.reusedCount, 6)
    && response.body.createdCount + response.body.reusedCount === 6;
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

export async function defaultRequest(request) {
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return parseFetchResponse(response, request.cookiePrefix, request.outcomeHeader);
}

const BUYER_ORDER_PROOF_KEYS = ["status", "paymentStatus", "orderStatus", "orderCount", "paidEventCount", "orderEventCount", "reservationStatus", "remainingInventory"];

function validBuyerOrderProof(response) {
  const body = response?.body;
  return response?.status === 200 && exactKeys(body, BUYER_ORDER_PROOF_KEYS)
    && body.status === "VERIFIED" && body.paymentStatus === "paid" && body.orderStatus === "paid"
    && body.orderCount === 1 && body.paidEventCount === 1
    && Number.isSafeInteger(body.orderEventCount) && body.orderEventCount >= 1
    && body.reservationStatus === "committed"
    && Number.isSafeInteger(body.remainingInventory) && body.remainingInventory >= 0;
}

function validSignedReturnCapture(capture) {
  return capture?.mapped === true && capture.firstStatus === 303
    && Buffer.isBuffer(capture.signedReturnBody)
    && capture.signedReturnBody.length > 0 && capture.signedReturnBody.length <= 16_384
    && typeof capture.contentType === "string"
    && /^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/iu.test(capture.contentType);
}

function validDuplicateAcknowledgement(response) {
  return response?.status === 200 && exactKeys(response.body, ["ok", "duplicate", "eventId"])
    && response.body.ok === true && response.body.duplicate === true
    && typeof response.body.eventId === "string" && response.body.eventId.length > 0;
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
  if (response.outcome === "UNCLASSIFIED_FAILURE") return "FIXTURE_UNCLASSIFIED_FAILURE";
  if (typeof response.outcome === "string" && response.outcome.startsWith("DB_")
    && FAILURE_CODES.has(`FIXTURE_${response.outcome}`)) {
    return `FIXTURE_${response.outcome}`;
  }
  if (response.status === 409) return "FIXTURE_CONFLICT";
  if (response.status === 200) return "FIXTURE_HTTP_REJECTED";
  return FIXTURE_HTTP_STATUSES.has(response.status) ? `FIXTURE_HTTP_${response.status}` : "FIXTURE_HTTP_OTHER";
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
  for (const status of RECOVERY_RECONCILIATION_FAILURES) expectedStatus[status] = 503;
  if (!response || !Number.isInteger(response.status)) return null;
  const hasDiagnostic = response.body != null && Object.hasOwn(response.body, "transactionFailure");
  if (!exactKeys(response.body, hasDiagnostic ? ["reconciled", "status", "transactionFailure"] : ["reconciled", "status"])) return null;
  const status = response.body.status;
  if (hasDiagnostic && (status !== "RECONCILIATION_DATABASE_TRANSACTION_FAILED"
    || !validRecoveryTransactionFailure(response.body.transactionFailure))) return null;
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
      url: fixedUrl(operationHostFor(invocation, dependencies), "/api/admin/ops/payuni/wp4-refund-recovery"),
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
    if (Object.hasOwn(response.body, "transactionFailure")) {
      // Reconstruct the exact validated shape, without retaining the response object.
      receipt.transactionFailure = {
        stage: response.body.transactionFailure.stage,
        elapsedBucket: response.body.transactionFailure.elapsedBucket,
      };
    }
  } catch {
    receipt.status = "NETWORK_REJECTED";
  }
  return receipt;
}

export const BUYER_PAYMENT_CHECK_SOURCE_SHA = "00099f7e3b3c8a7e923047e1ab72a827fcb78e4c";
export const BUYER_CALLBACK_RETRY_SOURCE_SHA = "8497ec1ad66a07b0a286585dc050915c998d0f67";
const unreferencedCheckStatuses = new Set(["UNREFERENCED_NOT_FOUND", "UNREFERENCED_FOUND", "UNREFERENCED_QUERY_FAILED"]);
const buyerCheckStatuses = new Set(["VERIFIED", "MISSING", "AMBIGUOUS", "REFERENCE_UNAVAILABLE", "QUERY_REJECTED", "QUERY_FAILED", "STATE_MISMATCH", ...unreferencedCheckStatuses]);
const buyerLocalStatuses = new Set(["UNKNOWN", "PENDING", "PAID", "PARTIALLY_REFUNDED", "REFUNDED", "FAILED"]);
const buyerProviderStatuses = new Set(["UNKNOWN", "PAID", "PARTIALLY_REFUNDED", "REFUNDED"]);
const buyerReferenceStates = new Set(["UNKNOWN", "AVAILABLE", "ORDER_MISSING", "PROVIDER_MISSING", "BOTH_MISSING"]);
const buyerCallbackStatuses = new Set(["NOT_OBSERVED", "RECEIVED", "PROCESSED", "FAILED", "AMBIGUOUS", "UNKNOWN"]);
const buyerCallbackFailures = new Set(["NONE", "SCOPE_MISSING", "SCOPE_INVALID", "SCOPE_MISMATCH", "ORDER_AMBIGUOUS", "AMOUNT_MISMATCH", "INVENTORY_CONFLICT", "PROCESSING_CLAIM_LOST", "PROCESSING_FAILED", "UNKNOWN"]);

function validBuyerCheckBody(body) {
  if (!exactKeys(body, ["status", "localStatus", "providerStatus", "referenceState", "queryAttempts", "callbackStatus", "callbackFailure"])
    || !buyerCheckStatuses.has(body.status) || !buyerLocalStatuses.has(body.localStatus)
    || !buyerProviderStatuses.has(body.providerStatus) || !buyerReferenceStates.has(body.referenceState) || !boundedInteger(body.queryAttempts, 1)
    || !buyerCallbackStatuses.has(body.callbackStatus) || !buyerCallbackFailures.has(body.callbackFailure)) return false;
  if (body.status === "REFERENCE_UNAVAILABLE" && !["ORDER_MISSING", "PROVIDER_MISSING", "BOTH_MISSING"].includes(body.referenceState)) return false;
  if (["MISSING", "AMBIGUOUS"].includes(body.status) && body.referenceState !== "UNKNOWN") return false;
  if (unreferencedCheckStatuses.has(body.status)) {
    if (body.referenceState !== "PROVIDER_MISSING" || body.localStatus !== "PENDING" || body.queryAttempts !== 1
      || body.callbackStatus !== "NOT_OBSERVED" || body.callbackFailure !== "NONE"
      || (body.status === "UNREFERENCED_FOUND") !== (body.providerStatus !== "UNKNOWN")) return false;
  } else if (!["REFERENCE_UNAVAILABLE", "MISSING", "AMBIGUOUS"].includes(body.status) && body.referenceState !== "AVAILABLE") return false;
  if (["NOT_OBSERVED", "RECEIVED", "PROCESSED"].includes(body.callbackStatus) && body.callbackFailure !== "NONE") return false;
  if (["UNKNOWN", "AMBIGUOUS"].includes(body.callbackStatus) && body.callbackFailure !== "UNKNOWN") return false;
  if (body.callbackStatus === "FAILED" && body.callbackFailure === "NONE") return false;
  if (body.queryAttempts === 0 && body.providerStatus !== "UNKNOWN") return false;
  if (body.status === "VERIFIED" && (body.queryAttempts !== 1 || body.providerStatus === "UNKNOWN" || body.localStatus !== body.providerStatus)) return false;
  return true;
}

export function validateBuyerPaymentCheckReceipt(receipt) {
  const errors = [];
  if (!exactKeys(receipt, ["schemaVersion", "purpose", "sourceSha", "transactionSourceSha", "environment", "result", "status", "localStatus", "providerStatus", "referenceState", "checkPosts", "queryAttempts", "paymentSubmissions", "refundSubmissions", "callbackStatus", "callbackFailure"])) errors.push("SCHEMA_KEYS");
  if (receipt?.schemaVersion !== "celebratedeal-wp4-buyer-payment-check/v2" || receipt?.purpose !== FIXED_PURPOSE
    || receipt?.environment !== "sandbox" || !SOURCE_SHA.test(receipt?.sourceSha ?? "")
    || receipt?.transactionSourceSha !== BUYER_PAYMENT_CHECK_SOURCE_SHA) errors.push("FIXED_IDENTITY");
  if (!boundedInteger(receipt?.checkPosts, 1) || !boundedInteger(receipt?.queryAttempts, 1)
    || receipt?.paymentSubmissions !== 0 || receipt?.refundSubmissions !== 0) errors.push("SIDE_EFFECT_BUDGET");
  if (!["PASS", "BLOCKED"].includes(receipt?.result)) errors.push("RESULT");
  const transportFailure = ["INPUT_REJECTED", "NETWORK_REJECTED", "RESPONSE_INVALID"].includes(receipt?.status);
  if (transportFailure) {
    if (receipt.result !== "BLOCKED" || receipt.queryAttempts !== (receipt.status === "INPUT_REJECTED" ? 0 : 1) || receipt.localStatus !== "UNKNOWN" || receipt.providerStatus !== "UNKNOWN" || receipt.referenceState !== "UNKNOWN" || receipt.callbackStatus !== "UNKNOWN" || receipt.callbackFailure !== "UNKNOWN"
      || receipt.checkPosts !== (receipt.status === "INPUT_REJECTED" ? 0 : 1)) errors.push("TRANSPORT_STATE");
  } else if (!validBuyerCheckBody({ status: receipt?.status, localStatus: receipt?.localStatus, providerStatus: receipt?.providerStatus, referenceState: receipt?.referenceState, queryAttempts: receipt?.queryAttempts, callbackStatus: receipt?.callbackStatus, callbackFailure: receipt?.callbackFailure })
    || receipt?.checkPosts !== 1 || (receipt?.result === "PASS") !== (receipt?.status === "VERIFIED")) errors.push("OBSERVED_STATE");
  return { ok: errors.length === 0, errors };
}

/** A single fixed, read-only observation. No checkout, payment or refund path is called. */
export async function checkExistingWp4BuyerPayment(input, dependencies = {}) {
  const invocation = validateExistingRefundRecoveryInvocation(input);
  const receipt = {
    schemaVersion: "celebratedeal-wp4-buyer-payment-check/v2", purpose: FIXED_PURPOSE,
    sourceSha: invocation.ok ? invocation.sourceSha : "0".repeat(40), transactionSourceSha: BUYER_PAYMENT_CHECK_SOURCE_SHA,
    environment: "sandbox", result: "BLOCKED", status: "INPUT_REJECTED", localStatus: "UNKNOWN", providerStatus: "UNKNOWN", referenceState: "UNKNOWN",
    callbackStatus: "UNKNOWN", callbackFailure: "UNKNOWN",
    checkPosts: 0, queryAttempts: 0, paymentSubmissions: 0, refundSubmissions: 0,
  };
  if (!invocation.ok) return receipt;
  receipt.checkPosts = 1;
  // Reserve the maximum query count before sending; a lost response cannot prove zero queries.
  receipt.queryAttempts = 1;
  try {
    const response = await (dependencies.request ?? defaultRequest)({
      url: fixedUrl(operationHostFor(invocation, dependencies), "/api/admin/ops/payuni/wp4-buyer-payment-check"),
      headers: guardedHeaders(invocation), body: undefined,
    });
    if (response?.status !== 200 || !validBuyerCheckBody(response.body)) {
      receipt.status = "RESPONSE_INVALID";
      return receipt;
    }
    receipt.status = response.body.status;
    receipt.localStatus = response.body.localStatus;
    receipt.providerStatus = response.body.providerStatus;
    receipt.referenceState = response.body.referenceState;
    receipt.queryAttempts = response.body.queryAttempts;
    receipt.callbackStatus = response.body.callbackStatus;
    receipt.callbackFailure = response.body.callbackFailure;
    receipt.result = receipt.status === "VERIFIED" ? "PASS" : "BLOCKED";
  } catch {
    receipt.status = "NETWORK_REJECTED";
  }
  return receipt;
}

const buyerRetryStatuses = new Set(["PROCESSED", "ALREADY_PROCESSED", "FIXTURE_UNAVAILABLE", "CANDIDATE_AMBIGUOUS", "EVENT_UNAVAILABLE", "RETRY_REJECTED", "RETRY_FAILED"]);
const buyerRetryFailures = new Set(["NONE", "UNKNOWN", "scope_missing", "scope_invalid", "scope_mismatch", "order_ambiguous", "amount_mismatch", "inventory_conflict", "processing_timeout", "processing_claim_lost", "processing_failed", "database_transaction_failed", "database_conflict", "MANUAL_RECONCILIATION"]);

function validBuyerRetryBody(body) {
  if (!exactKeys(body, ["status", "retryAttempts", "failureCode"]) || !buyerRetryStatuses.has(body.status)
    || !boundedInteger(body.retryAttempts, 1) || !buyerRetryFailures.has(body.failureCode)) return false;
  if (body.status === "PROCESSED" && (body.retryAttempts !== 1 || body.failureCode !== "NONE")) return false;
  if (body.status === "ALREADY_PROCESSED" && (body.retryAttempts !== 0 || body.failureCode !== "NONE")) return false;
  if (["FIXTURE_UNAVAILABLE", "CANDIDATE_AMBIGUOUS", "EVENT_UNAVAILABLE"].includes(body.status) && body.retryAttempts !== 0) return false;
  if (body.status === "RETRY_FAILED" && (body.retryAttempts !== 1 || body.failureCode === "NONE")) return false;
  return true;
}

export function validateBuyerCallbackRetryReceipt(receipt) {
  const errors = [];
  if (!exactKeys(receipt, ["schemaVersion", "purpose", "sourceSha", "transactionSourceSha", "environment", "result", "status", "failureCode", "retryPosts", "retryAttempts", "queryAttempts", "paymentSubmissions", "refundSubmissions"])) errors.push("SCHEMA_KEYS");
  if (receipt?.schemaVersion !== "celebratedeal-wp4-buyer-callback-retry/v1" || receipt?.purpose !== FIXED_PURPOSE
    || receipt?.environment !== "sandbox" || !SOURCE_SHA.test(receipt?.sourceSha ?? "")
    || receipt?.transactionSourceSha !== BUYER_CALLBACK_RETRY_SOURCE_SHA) errors.push("FIXED_IDENTITY");
  if (!boundedInteger(receipt?.retryPosts, 1) || !boundedInteger(receipt?.retryAttempts, 1)
    || receipt?.queryAttempts !== 0 || receipt?.paymentSubmissions !== 0 || receipt?.refundSubmissions !== 0) errors.push("SIDE_EFFECT_BUDGET");
  if (!["PASS", "BLOCKED"].includes(receipt?.result)) errors.push("RESULT");
  if (["INPUT_REJECTED", "NETWORK_REJECTED", "RESPONSE_INVALID"].includes(receipt?.status)) {
    const attempts = receipt.status === "INPUT_REJECTED" ? 0 : 1;
    if (receipt.retryPosts !== attempts || receipt.retryAttempts !== attempts || receipt.failureCode !== "UNKNOWN" || receipt.result !== "BLOCKED") errors.push("TRANSPORT_STATE");
  } else if (!validBuyerRetryBody({ status: receipt?.status, retryAttempts: receipt?.retryAttempts, failureCode: receipt?.failureCode })
    || receipt?.retryPosts !== 1 || (receipt?.result === "PASS") !== ["PROCESSED", "ALREADY_PROCESSED"].includes(receipt?.status)) errors.push("RETRY_STATE");
  return { ok: errors.length === 0, errors };
}

/** Replays only one stored, authenticated callback through the server's fixed CAS boundary. */
export async function retryFixedWp4BuyerCallback(input, dependencies = {}) {
  const invocation = validateExistingRefundRecoveryInvocation(input);
  const receipt = {
    schemaVersion: "celebratedeal-wp4-buyer-callback-retry/v1", purpose: FIXED_PURPOSE,
    sourceSha: invocation.ok ? invocation.sourceSha : "0".repeat(40), transactionSourceSha: BUYER_CALLBACK_RETRY_SOURCE_SHA,
    environment: "sandbox", result: "BLOCKED", status: "INPUT_REJECTED", failureCode: "UNKNOWN",
    retryPosts: 0, retryAttempts: 0, queryAttempts: 0, paymentSubmissions: 0, refundSubmissions: 0,
  };
  if (!invocation.ok) return receipt;
  // Reserve the full attempt budget before dispatch; a lost response is not zero effects.
  receipt.retryPosts = 1;
  receipt.retryAttempts = 1;
  try {
    const response = await (dependencies.request ?? defaultRequest)({
      url: fixedUrl(operationHostFor(invocation, dependencies), "/api/admin/ops/payuni/wp4-buyer-callback-retry"),
      headers: guardedHeaders(invocation), body: undefined,
    });
    if (response?.status !== 200 || !validBuyerRetryBody(response.body)) {
      receipt.status = "RESPONSE_INVALID";
      return receipt;
    }
    receipt.status = response.body.status;
    receipt.failureCode = response.body.failureCode;
    receipt.retryAttempts = response.body.retryAttempts;
    receipt.result = ["PROCESSED", "ALREADY_PROCESSED"].includes(receipt.status) ? "PASS" : "BLOCKED";
  } catch { receipt.status = "NETWORK_REJECTED"; }
  return receipt;
}

/** Classify only validation failures; a confirmation label can never prove payment success. */
export function classifyPayUniConfirmation(text) {
  if (typeof text !== "string" || text.length > 4096 || !/(?:錯誤|不正確|無效|請輸入|必填|invalid|required)/iu.test(text)) return "PAYMENT_CONFIRMATION_AMBIGUOUS";
  if (/(?:有效期限|到期|expiry|expiration)/iu.test(text)) return "PAYMENT_VALIDATION_EXPIRY";
  if (/(?:安全碼|檢查碼|CVV|CVC)/iu.test(text)) return "PAYMENT_VALIDATION_CVV";
  if (/(?:卡號|card\s*number)/iu.test(text)) return "PAYMENT_VALIDATION_CARD";
  if (/(?:電子郵件|電子信箱|email|e-mail)/iu.test(text)) return "PAYMENT_VALIDATION_EMAIL";
  return "PAYMENT_VALIDATION_FIELD";
}

/** Prepare the fixed synthetic checkout for the separate failure/retry probe.
 * This grants one initial browser submission only. It never submits a card,
 * selects a historical payment, or rebuilds an issued provider transaction.
 * Credentials and support cookies remain in memory, outside any receipt.
 */
export async function prepareIssuedRecoveryCheckout(input, dependencies = {}) {
  const invocation = validateInvocation(input);
  if (!invocation.ok || invocation.sourceSha === BUYER_PAYMENT_CHECK_SOURCE_SHA) {
    throw new Error("ISSUED_RECOVERY_PREPARATION_REJECTED");
  }
  const request = dependencies.request ?? defaultRequest;
  const base = fixedOrigin(operationHostFor(invocation, dependencies));
  const guarded = guardedHeaders(invocation);
  const sideEffects = { fixturePosts: 0, admissionPosts: 0, checkoutPosts: 0, paymentAttemptPosts: 0 };
  try {
    sideEffects.fixturePosts = 1;
    const fixture = responseJson(await request({ url: fixedUrl(operationHostFor(invocation, dependencies), "/api/admin/ops/payuni/wp4-fixture"),
      headers: guarded, body: undefined, outcomeHeader: "x-celebratedeal-wp4-fixture" }));
    if (!assertFixtureResponse(fixture)) throw new Error();
    sideEffects.admissionPosts = 1;
    const admission = responseJson(await request({ url: fixedUrl(operationHostFor(invocation, dependencies), "/api/payments/checkout/admission"),
      headers: { origin: base, "x-celebratedeal-client": "web", "content-type": "application/json" },
      body: JSON.stringify({ ...FIXED_FIXTURE, idempotencyKey: fixedCheckoutIdempotencyKey(invocation.sourceSha) }),
      cookiePrefix: "celebratedeal_checkout_session=" }));
    if (!assertAdmissionResponse(admission)) throw new Error();
    sideEffects.checkoutPosts = 1;
    const checkout = responseJson(await request({ url: fixedUrl(operationHostFor(invocation, dependencies), "/api/payments/checkout"),
      headers: { origin: base, "x-celebratedeal-client": "web", "content-type": "application/json", cookie: admission.sessionCookie },
      body: JSON.stringify({ ...FIXED_FIXTURE, idempotencyKey: admission.body.idempotencyKey,
        admissionToken: admission.body.admissionToken, buyer: SYNTHETIC_BUYER, shipping: SYNTHETIC_SHIPPING }),
      cookiePrefix: "celebrate_support_" }));
    if (!assertCheckoutResponse(checkout)) throw new Error();
    sideEffects.paymentAttemptPosts = 1;
    const reservation = responseJson(await request({ url: fixedUrl(operationHostFor(invocation, dependencies), "/api/admin/ops/payuni/wp4-payment-attempt"),
      headers: guarded, body: undefined }));
    if (!assertPaymentAttemptResponse(reservation) || reservation.body.status !== "SUBMIT_ALLOWED") throw new Error();
    return { invocation: { ...invocation, payuniEnv: FIXED_PAYUNI_ENV }, checkout: checkout.body, supportCookie: checkout.supportCookie, sideEffects };
  } catch {
    throw new Error("ISSUED_RECOVERY_PREPARATION_REJECTED");
  }
}

// PayUni hosted payment page fields, in the order the runner fills them. `placeholder` is the
// selector proven on the UPP page; `fallback` is the standard autofill attribute, used only when
// the placeholder times out and exactly one visible element matches (2026-11-05 run 42064928350:
// no card-number placeholder and no iframe on the UPP page). Run 42077292610 showed the redesigned
// UPP card placeholder `**** **** **** ****`; the old `16 碼或 19 碼` stays as `legacyPlaceholder`.
// Every placeholder match is exact: the CVV `***` is a substring of the card placeholder.
export const PAYUNI_CARD_FIELDS = Object.freeze([
  Object.freeze({ step: "CARD_NUMBER", placeholder: "**** **** **** ****", legacyPlaceholder: "16 碼或 19 碼", fallback: 'input[autocomplete="cc-number"]' }),
  Object.freeze({ step: "CARD_EXPIRY", placeholder: "MM/YY", fallback: 'input[autocomplete="cc-exp"]' }),
  Object.freeze({ step: "CARD_CVV", placeholder: "***", fallback: 'input[autocomplete="cc-csc"]' }),
  Object.freeze({ step: "EMAIL", placeholder: "example@example.com", fallback: 'input[type="email"]' }),
]);
// Credit-card tab on the UPP page; clicked only when no card-number field is found.
export const PAYUNI_CREDIT_TAB_TEXT = "信用卡";
const PAYUNI_FIELD_TIMEOUT_MS = 20_000;
const PAYUNI_FALLBACK_WAIT_MS = 10_000;
const PAYUNI_BROWSER_STEPS = new Set(["NONE", "METHOD", ...PAYUNI_CARD_FIELDS.map((field) => field.step), "PRESUBMIT", "SUBMIT"]);
const DIAGNOSTIC_ENUM = /^[A-Z_]{1,24}$/u;
const FIELD_SOURCES = new Set(["NONE", "PLACEHOLDER", "LEGACY_PLACEHOLDER", "AUTOCOMPLETE", "PLACEHOLDER_AFTER_TAB", "AUTOCOMPLETE_AFTER_TAB"]);
const CREDIT_TAB_RESULTS = new Set(["NOT_TRIED", "CLICKED", "NOT_FOUND", "AMBIGUOUS"]);
const RESOURCE_FAILURE_KEYS = Object.freeze(["payuniScript", "payuniOther", "externalScript", "externalOther"]);

/**
 * De-identified diagnostic for a failed PayUni page step. It holds only fixed enums and
 * small bounded counts: never a URL, provider text, card value, e-mail or identifier.
 */
export function createPayUniBrowserDiagnostic() {
  return {
    step: "NONE", error: "NONE", page: "NONE", mainFrameMatches: null, childFrames: null, childFrameMatches: null,
    fieldSource: "NONE", creditTab: "NOT_TRIED",
    // Sub-resource failures after the PayUni document opened (egress allowlist, CDN move). Counts only.
    resourceFailures: { payuniScript: 0, payuniOther: 0, externalScript: 0, externalOther: 0 },
    // Sanitized form-structure summary of the PayUni page; see sanitizePayUniPageStructure.
    structure: null,
    // Post-submit summary (dialogs, modal, host/path class, field errors); see capturePayUniSubmitDiagnostic.
    submit: { captured: false, dialogs: [], modal: "NONE", host: "NONE", path: "NONE", errors: [] },
    // De-identified dialog text/buttons and blocked third-party hosts; see formatPayUniDialogDiagnostic.
    dialogTexts: [],
    externalHosts: [],
    // Every reachable form control's state after a stopped submit; see capturePayUniFormFieldDiagnostic.
    formFields: null,
    // Page load, per-field match, button and PayUni traffic state before the one submit; see settlePayUniBeforeSubmit.
    presubmit: createPayUniPresubmitDiagnostic(),
  };
}

/** Count a failed sub-resource of the PayUni page by host class and type; never the URL. */
export function recordPayUniResourceFailure(diagnostic, request) {
  if (!diagnostic?.resourceFailures) return;
  try {
    if (request.isNavigationRequest()) return;
    const host = new URL(request.url()).hostname;
    const script = request.resourceType() === "script";
    const payuni = host === "payuni.com.tw" || host.endsWith(".payuni.com.tw");
    const key = payuni ? (script ? "payuniScript" : "payuniOther") : (script ? "externalScript" : "externalOther");
    diagnostic.resourceFailures[key] += 1;
    if (!payuni) recordPayUniExternalHost(diagnostic.externalHosts, host);
  } catch { /* Unclassifiable failures are not counted. */ }
}

export function markPayUniBrowserStep(diagnostic, step) {
  if (diagnostic && typeof diagnostic === "object" && PAYUNI_BROWSER_STEPS.has(step)) diagnostic.step = step;
}

/** Playwright errors reduced to a fixed vocabulary; their messages can include URLs or selectors. */
export function classifyPlaywrightErrorKind(error) {
  if (!(error instanceof Error)) return "OTHER";
  if (error.name === "TimeoutError" || /Timeout \d+ms exceeded/u.test(error.message)) return "TIMEOUT";
  if (/strict mode violation/iu.test(error.message)) return "STRICT_MODE";
  if (/Target page, context or browser has been closed|TargetClosedError/iu.test(error.message)) return "TARGET_CLOSED";
  return "OTHER";
}

/** Only the page class is reported: the PayUni payment host, the operation host, or other. */
export function classifyPayUniBrowserPage(url, operationHost) {
  try {
    const parsed = new URL(url);
    if (parsed.href === "about:blank") return "BLANK";
    if (parsed.protocol !== "https:") return "OTHER";
    if (parsed.hostname === PAYUNI_PAYMENT_HOST) return parsed.pathname === "/api/upp" ? "PAYUNI_UPP" : "PAYUNI_OTHER_PATH";
    if (parsed.hostname.endsWith(".payuni.com.tw")) return "PAYUNI_OTHER_HOST";
    if (parsed.hostname === operationHost) return "OPERATION_HOST";
    return "OTHER";
  } catch { return "INVALID"; }
}

function boundedDiagnosticCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? String(Math.min(value, 9)) : "UNKNOWN";
}

/** One log line of fixed enums and counts 0-9; anything unexpected prints as UNKNOWN. */
export function formatPayUniBrowserDiagnostic(diagnostic) {
  const failures = diagnostic?.resourceFailures;
  return [
    `step=${PAYUNI_BROWSER_STEPS.has(diagnostic?.step) ? diagnostic.step : "UNKNOWN"}`,
    `error=${DIAGNOSTIC_ENUM.test(diagnostic?.error ?? "") ? diagnostic.error : "UNKNOWN"}`,
    `page=${DIAGNOSTIC_ENUM.test(diagnostic?.page ?? "") ? diagnostic.page : "UNKNOWN"}`,
    `mainFrameMatches=${boundedDiagnosticCount(diagnostic?.mainFrameMatches)}`,
    `childFrames=${boundedDiagnosticCount(diagnostic?.childFrames)}`,
    `childFrameMatches=${boundedDiagnosticCount(diagnostic?.childFrameMatches)}`,
    `fieldSource=${FIELD_SOURCES.has(diagnostic?.fieldSource) ? diagnostic.fieldSource : "UNKNOWN"}`,
    `creditTab=${CREDIT_TAB_RESULTS.has(diagnostic?.creditTab) ? diagnostic.creditTab : "UNKNOWN"}`,
    ...RESOURCE_FAILURE_KEYS.map((key) => `failed_${key}=${boundedDiagnosticCount(failures?.[key])}`),
  ].join("; ");
}

const STRUCTURE_MAX_ITEMS = 25;
const STRUCTURE_MAX_FRAMES = 4;
const STRUCTURE_TEXT_MAX = 40;

/**
 * Whitelist sanitizer for page-structure text. E-mail addresses and URLs become fixed tokens, every
 * run of 3+ digits (card numbers, CVV, amounts, trade numbers) becomes "#", and only ASCII letters,
 * digits, a few punctuation marks and CJK characters survive. Truncated to 40 characters.
 */
export function sanitizeStructureText(value, max = STRUCTURE_TEXT_MAX) {
  if (typeof value !== "string") return "";
  let text = value.replace(/[\uFF10-\uFF19]/gu, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0));
  text = text.replace(/\s+/gu, " ").trim();
  text = text.replace(/[^\s@\uFF20]+[@\uFF20][^\s@\uFF20]+/gu, "EMAIL");
  text = text.replace(/(?:[a-z][a-z0-9+.-]*:)?\/\/\S*/giu, "URL");
  text = text.replace(/\d{3,}/gu, "#");
  text = text.replace(/[^A-Za-z0-9 _\-./*:()#~\u3000-\u303F\u4E00-\u9FFF\uFF01-\uFF1F\uFF21-\uFF5E]/gu, "");
  return text.length > max ? `${text.slice(0, max)}~` : text;
}

/**
 * Runs inside the PayUni page. Reads only tag, type, name, placeholder, aria-label and autocomplete
 * of form fields (never `value`) and the visible text of buttons, tabs and labels; hidden inputs
 * are counted, not listed. Node sanitizes everything again before printing.
 */
export function collectPageStructureInPage(limit) {
  const shown = (element) => {
    try {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    } catch { return false; }
  };
  const attribute = (element, name) => String(element.getAttribute(name) ?? "").slice(0, 200);
  const fields = [];
  let hiddenInputs = 0;
  for (const element of document.querySelectorAll("input, select, textarea")) {
    if (element.tagName === "INPUT" && attribute(element, "type").toLowerCase() === "hidden") { hiddenInputs += 1; continue; }
    if (fields.length >= limit) continue;
    fields.push({
      tag: element.tagName.toLowerCase(), type: attribute(element, "type"), name: attribute(element, "name"),
      placeholder: attribute(element, "placeholder"), ariaLabel: attribute(element, "aria-label"),
      autocomplete: attribute(element, "autocomplete"), visible: shown(element),
    });
  }
  const controls = [];
  for (const element of document.querySelectorAll('button, [role="tab"], [role="button"], [role="radio"], label, a')) {
    if (controls.length >= limit) break;
    if (!shown(element)) continue;
    const text = String(element.innerText ?? element.textContent ?? "").slice(0, 200);
    if (text.trim() === "") continue;
    controls.push({ role: String(element.getAttribute("role") || element.tagName.toLowerCase()).slice(0, 20), text });
  }
  return { fields, controls, hiddenInputs };
}

/** Sanitize one frame's raw structure; unknown shapes yield empty lists. */
export function sanitizePayUniPageStructure(raw, frame = 0) {
  const kind = (value) => (typeof value === "string" && /^[a-z-]{1,16}$/u.test(value.toLowerCase()) ? value.toLowerCase() : value ? "other" : "");
  const list = (value) => (Array.isArray(value) ? value.slice(0, STRUCTURE_MAX_ITEMS) : []);
  return {
    frame: Number.isSafeInteger(frame) && frame >= 0 ? Math.min(frame, 9) : 0,
    hiddenInputs: Number.isSafeInteger(raw?.hiddenInputs) && raw.hiddenInputs >= 0 ? Math.min(raw.hiddenInputs, 99) : 0,
    fields: list(raw?.fields).map((field) => ({
      tag: ["input", "select", "textarea"].includes(field?.tag) ? field.tag : "other",
      type: kind(field?.type),
      name: sanitizeStructureText(field?.name),
      placeholder: sanitizeStructureText(field?.placeholder),
      ariaLabel: sanitizeStructureText(field?.ariaLabel),
      autocomplete: kind(field?.autocomplete),
      visible: field?.visible === true,
    })),
    controls: list(raw?.controls).map((control) => ({
      role: kind(control?.role),
      text: sanitizeStructureText(control?.text, 20),
    })),
  };
}

/** Collect the sanitized structure of the main frame and up to three child frames; time-boxed. */
export async function capturePayUniPageStructure(page) {
  const frames = [];
  try {
    const all = page.frames().slice(0, STRUCTURE_MAX_FRAMES);
    for (const [index, frame] of all.entries()) {
      const raw = await withinMs(frame.evaluate(collectPageStructureInPage, STRUCTURE_MAX_ITEMS).catch(() => null), 2_000);
      if (raw) frames.push(sanitizePayUniPageStructure(raw, index));
    }
  } catch { /* No structure is better than a failed diagnostic. */ }
  return frames;
}

// ---- Required-field diagnostic (2026-11-24 run 45362693554: after 確認送出 PayUni showed
// "請確認付款資訊已填寫 確定" and one POST, but the page structure listed only the four fields the
// runner fills). When a runner stops on a PayUni dialog it lists every form control it can reach:
// main frame, open shadow roots and up to seven child frames; native inputs/selects/textareas,
// ARIA checkbox/switch/radio/combobox/textbox controls and contenteditable areas, plus class-only
// checkbox/agree widgets and the sentence around 條款／政策／同意 links. Per control only name, id,
// label or placeholder text, type, required/aria-required, and whether it is empty, checked,
// :invalid or disabled. A value never leaves the page: emptiness is computed in the page and only
// the boolean is returned. Names, ids and placeholders pass the dialog-text masks and then the
// page-structure whitelist; label and sentence text use the dialog-text sanitizer, and text that
// repeats a typed value of the frame is never used as a label. It never clicks, fills or submits.
export const PAYUNI_MISSING_INFO_TEXT = "請確認付款資訊已填寫";
const FORM_FIELDS_MAX = 25;
const FORM_CUSTOM_MAX = 10;
const FORM_AGREEMENT_MAX = 3;
const FORM_FRAMES_MAX = 8;
const FORM_LABEL_MAX = 60;
const FORM_AGREEMENT_TEXT_MAX = 120;
const FORM_CUSTOM_HINTS = new Set(["CHECKBOX", "AGREE", "CONSENT", "TERMS", "SWITCH", "TOGGLE", "OTHER"]);

/**
 * Runs inside one PayUni frame. Returns attributes and booleans only: `value` and the `textContent`
 * of an editable control are read solely to compute `empty` and to reject label text that echoes a
 * typed value; they are never returned. Label text skips every form control and editable area, and
 * a neighbour or parent is used only when it holds no other control, so a typed value cannot leak.
 *
 * A4-05 (run 45388812344 printed no field list at all): every stage is caught on its own, so a page
 * script that breaks one stage still returns the other stages, plus `stageErrors` as fixed
 * "STAGE:ErrorName" codes (never the message). When the typed-value stage fails no label or
 * agreement text is returned, because the echo guard could not be built.
 */
export function collectPayUniFormFieldsInPage(limit) {
  const ERROR_NAMES = ["TypeError", "ReferenceError", "RangeError", "SyntaxError", "EvalError", "URIError",
    "SecurityError", "NotSupportedError", "InvalidStateError"];
  const stageErrors = [];
  const failed = (stage, error) => {
    let name = "OTHER";
    try { if (ERROR_NAMES.includes(String(error?.name ?? ""))) name = String(error.name); } catch { /* Unreadable error. */ }
    const code = `${stage}:${name}`;
    if (!stageErrors.includes(code) && stageErrors.length < 5) stageErrors.push(code);
  };
  const VALUE_ROLES = new Set(["textbox", "combobox", "listbox", "spinbutton", "searchbox"]);
  const SKIP_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA", "OPTION", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME"]);
  const attribute = (element, name) => String(element?.getAttribute?.(name) ?? "").slice(0, 200);
  const holdsValue = (element) => SKIP_TAGS.has(element.tagName)
    || element.isContentEditable === true || ["", "true", "plaintext-only"].includes(element.getAttribute?.("contenteditable"))
    || VALUE_ROLES.has(attribute(element, "role").toLowerCase());
  const ownText = (element, max = 200) => {
    let text = "";
    const walk = (node, depth) => {
      if (!node || text.length >= max || depth > 8) return;
      if (node.nodeType === 3) { text += ` ${String(node.nodeValue ?? "")}`; return; }
      if (node.nodeType !== 1 || holdsValue(node)) return;
      for (const child of node.childNodes ?? []) walk(child, depth + 1);
    };
    walk(element, 0);
    return text.replace(/\s+/gu, " ").trim().slice(0, max);
  };
  const shown = (element) => {
    try {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    } catch { return false; }
  };
  const selector = 'input, select, textarea, [role="checkbox"], [role="switch"], [role="radio"], [role="combobox"], [role="textbox"], '
    + '[role="listbox"], [role="spinbutton"], [role="searchbox"], [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';
  const roots = [document];
  try {
    for (let index = 0; index < roots.length && roots.length < 20; index += 1) {
      for (const element of roots[index].querySelectorAll("*")) {
        if (element.shadowRoot && roots.length < 20) roots.push(element.shadowRoot);
      }
    }
  } catch (error) { failed("ROOTS", error); }
  // Typed values of this frame, kept in the page only so that text echoing one (a neighbour span
  // that mirrors the card holder or card number) is never used as a label. Never returned.
  const normalize = (value) => String(value ?? "").replace(/\s+/gu, " ").trim().toLowerCase();
  const typedValues = [];
  let echoGuard = true;
  try {
    for (const root of roots) {
      for (const element of root.querySelectorAll(selector)) {
        try {
          const tag = element.tagName;
          const type = attribute(element, "type").toLowerCase();
          let value = "";
          if (tag === "TEXTAREA" || (tag === "INPUT" && !["checkbox", "radio", "hidden", "button", "submit", "reset", "image", "file"].includes(type))) value = element.value;
          else if (tag !== "INPUT" && tag !== "SELECT" && holdsValue(element)) value = element.textContent;
          const text = normalize(value);
          if (text.length >= 2 && typedValues.length < 100) typedValues.push(text);
        } catch { echoGuard = false; }
      }
    }
  } catch (error) { echoGuard = false; failed("TYPED", error); }
  const isEcho = (text) => {
    const candidate = normalize(text);
    return candidate !== "" && typedValues.some((value) => candidate.includes(value) || (candidate.length >= 3 && value.includes(candidate)));
  };
  /** Text kept as a label only when the echo guard is complete and the text does not repeat a typed value. */
  const accept = (text) => (echoGuard && text && !isEcho(text) ? text : "");
  const fieldCount = (element) => {
    try {
      return (element?.matches?.(selector) ? 1 : 0) + (element?.querySelectorAll?.(selector).length ?? 0);
    } catch { return 0; }
  };
  /** The parent's text, only when the parent holds at most this one control (any kind, editable areas included). */
  const contextText = (element) => (element?.parentElement && fieldCount(element.parentElement) <= 1 ? accept(ownText(element.parentElement)) : "");
  const labelOf = (element) => {
    try {
      for (const label of Array.from(element.labels ?? []).slice(0, 2)) { const text = accept(ownText(label)); if (text) return text; }
    } catch { /* No labels collection. */ }
    const root = element.getRootNode?.() ?? document;
    for (const id of attribute(element, "aria-labelledby").split(/\s+/u).filter(Boolean).slice(0, 3)) {
      const reference = root.getElementById?.(id) ?? document.getElementById(id);
      const text = reference ? accept(ownText(reference)) : "";
      if (text) return text;
    }
    const wrapper = element.closest?.("label");
    const wrapped = wrapper ? accept(ownText(wrapper)) : "";
    if (wrapped) return wrapped;
    const named = accept(attribute(element, "aria-label") || attribute(element, "title"));
    if (named) return named;
    // A preceding neighbour only when it holds no control of any kind and does not echo a typed value.
    for (let node = element.previousElementSibling, index = 0; node && index < 2; node = node.previousElementSibling, index += 1) {
      if (fieldCount(node) > 0) break;
      const text = ownText(node);
      if (text) return accept(text);
    }
    return contextText(element);
  };
  const fields = [];
  let hiddenInputs = 0;
  let total = 0;
  try {
    for (const root of roots) {
      for (const element of root.querySelectorAll(selector)) {
        try {
          const tag = String(element.tagName ?? "").toLowerCase();
          const native = tag === "input" || tag === "select" || tag === "textarea";
          const role = attribute(element, "role").toLowerCase();
          const type = tag === "input" ? (attribute(element, "type").toLowerCase() || "text") : native ? tag : (role || "editable");
          if (tag === "input" && type === "hidden") { hiddenInputs += 1; continue; }
          total += 1;
          if (fields.length >= limit) continue;
          const toggle = ["checkbox", "radio", "switch"].includes(type);
          let empty = null;
          let checked = null;
          try {
            if (toggle) checked = native ? element.checked === true : attribute(element, "aria-checked") === "true";
            else if (native) empty = String(element.value ?? "") === "";
            else empty = String(element.textContent ?? "").trim() === "";
          } catch { /* Unknown state stays null. */ }
          let invalid = attribute(element, "aria-invalid") === "true";
          try { if (native && element.matches(":invalid")) invalid = true; } catch { /* No :invalid support. */ }
          let label = "";
          try { label = (!native && toggle ? accept(ownText(element)) : "") || labelOf(element); } catch (error) { failed("LABEL", error); }
          fields.push({
            tag, type, name: attribute(element, "name"), id: attribute(element, "id"),
            label,
            placeholder: attribute(element, "placeholder"), autocomplete: attribute(element, "autocomplete"),
            visible: shown(element),
            required: element.required === true || element.hasAttribute?.("required") === true,
            ariaRequired: attribute(element, "aria-required") === "true",
            empty, checked, invalid,
            disabled: element.disabled === true || attribute(element, "aria-disabled") === "true",
            shadow: root !== document,
          });
        } catch (error) { failed("FIELD", error); }
      }
    }
  } catch (error) { failed("FIELDS", error); }
  const hint = /(?:check-?box|agree|consent|terms|switch|toggle)/iu;
  const custom = [];
  try {
    for (const root of roots) {
      for (const element of root.querySelectorAll("[class]")) {
        if (custom.length >= 10) break;
        if (element.matches?.(selector) || !shown(element)) continue;
        const className = String(element.className?.baseVal ?? element.className ?? "");
        const match = className.match(hint);
        if (!match) continue;
        custom.push({
          tag: String(element.tagName ?? "").toLowerCase(), hint: match[0].replace("-", "").toUpperCase(),
          label: accept(ownText(element)) || contextText(element),
          checked: /(?:^|[\s_-])(?:is-)?(?:checked|active|selected|on)(?:$|[\s_-])/iu.test(className) || attribute(element, "aria-checked") === "true",
          containsInput: Boolean(element.querySelector?.("input")),
        });
      }
    }
  } catch (error) { failed("CUSTOM", error); }
  const agreementWords = /(?:條款|政策|同意)/u;
  const agreement = [];
  const seen = new Set();
  try {
    for (const root of roots) {
      for (const element of root.querySelectorAll("a, label, span, p, div, li")) {
        if (agreement.length >= 3) break;
        const own = ownText(element, 300);
        if (!agreementWords.test(own) || !shown(element)) continue;
        if (Array.from(element.children ?? []).some((child) => agreementWords.test(ownText(child, 300)))) continue;
        let container = element;
        // Climb to the agreement row, but never into a block that also holds a text, select or textarea field.
        for (let parent = element.parentElement, depth = 0; parent && depth < 3; parent = parent.parentElement, depth += 1) {
          if (ownText(parent, 300).length > 150) break;
          if (parent.querySelector?.('select, textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])')) break;
          container = parent;
        }
        const text = accept(ownText(container, 300));
        if (!text || seen.has(text)) continue;
        seen.add(text);
        const toggles = container.querySelectorAll?.('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="switch"], [class]') ?? [];
        agreement.push({
          text,
          hasToggle: Array.from(toggles).some((node) => node.matches?.('input, [role="checkbox"], [role="switch"]')
            || hint.test(String(node.className?.baseVal ?? node.className ?? ""))),
        });
      }
    }
  } catch (error) { failed("AGREEMENT", error); }
  return { fields, total, hiddenInputs, shadowRoots: roots.length - 1, custom, agreement, stageErrors };
}

function payUniFrameHost(frame) {
  try {
    const url = new URL(frame.url());
    if (url.href === "about:blank" || url.protocol === "about:") return "BLANK";
    return url.protocol === "https:" ? sanitizePayUniHostName(url.hostname) : "OTHER";
  } catch { return "UNKNOWN"; }
}

/**
 * name / id / placeholder: the dialog-text masks first (digit runs such as "12/30", letter+digit
 * identifiers such as "pay_8f3k2", 16+ character tokens), then the page-structure whitelist.
 */
function formIdentifier(value) {
  return sanitizeStructureText(sanitizePayUniDialogText(value, STRUCTURE_TEXT_MAX));
}

/** A frame host is sanitized once in capture and again when printed; "*.example.com" survives the second pass. */
function safePayUniFrameHost(host) {
  if (["MAIN", "BLANK", "UNKNOWN", "OTHER", "IP"].includes(host)) return host;
  if (typeof host === "string" && host.startsWith("*.")) {
    const rest = sanitizePayUniHostName(host.slice(2));
    return rest.includes(".") && !rest.startsWith("*.") ? `*.${rest}` : "OTHER";
  }
  return sanitizePayUniHostName(host);
}

/** Sanitize one frame's raw form controls; unknown shapes yield empty lists and every value is re-checked. */
export function sanitizePayUniFormFields(raw, frame = 0, host = "MAIN") {
  const source = raw !== null && typeof raw === "object" ? raw : {};
  const list = (value, max) => (Array.isArray(value) ? value.slice(0, max) : []);
  const kind = (value) => (typeof value === "string" && /^[a-z][a-z0-9-]{0,23}$/u.test(value.toLowerCase()) ? value.toLowerCase() : value ? "other" : "");
  const count = (value, cap) => (Number.isSafeInteger(value) && value >= 0 ? Math.min(value, cap) : 0);
  const tri = (value) => (value === true ? true : value === false ? false : null);
  return {
    frame: Number.isSafeInteger(frame) && frame >= 0 ? Math.min(frame, 9) : 0,
    host: safePayUniFrameHost(host),
    total: count(source.total, 999),
    hiddenInputs: count(source.hiddenInputs, 99),
    shadowRoots: count(source.shadowRoots, 99),
    fields: list(source.fields, FORM_FIELDS_MAX).map((field) => ({
      tag: kind(field?.tag),
      type: kind(field?.type),
      name: formIdentifier(field?.name),
      id: formIdentifier(field?.id),
      label: sanitizePayUniDialogText(field?.label, FORM_LABEL_MAX),
      placeholder: formIdentifier(field?.placeholder),
      autocomplete: kind(field?.autocomplete),
      visible: field?.visible === true,
      required: field?.required === true,
      ariaRequired: field?.ariaRequired === true,
      empty: tri(field?.empty),
      checked: tri(field?.checked),
      invalid: field?.invalid === true,
      disabled: field?.disabled === true,
      shadow: field?.shadow === true,
    })),
    custom: list(source.custom, FORM_CUSTOM_MAX).map((item) => ({
      tag: kind(item?.tag),
      hint: FORM_CUSTOM_HINTS.has(item?.hint) ? item.hint : "OTHER",
      label: sanitizePayUniDialogText(item?.label, FORM_LABEL_MAX),
      checked: item?.checked === true,
      containsInput: item?.containsInput === true,
    })),
    agreement: list(source.agreement, FORM_AGREEMENT_MAX).map((item) => ({
      text: sanitizePayUniDialogText(item?.text, FORM_AGREEMENT_TEXT_MAX),
      hasToggle: item?.hasToggle === true,
    })),
  };
}

/** True when a recorded dialog carries PayUni's "請確認付款資訊已填寫" (a required field is empty). */
export function isPayUniMissingInfoDialog(captures) {
  return Array.isArray(captures) && captures.some((capture) => typeof capture?.text === "string" && capture.text.includes(PAYUNI_MISSING_INFO_TEXT));
}

// ---- Field-list capture outcome (A4-05, run 45388812344: the drill stopped on the missing-info modal
// and printed the dialog line, but no `payuni_lost_callback_form_fields=` line at all). The old
// capture turned every per-frame failure (a 2 s time-box, an exception inside the PayUni page, a
// navigation that destroyed the context, a closed page, no frames) into the same `null`, and a null
// list was simply not printed. Now every capture carries a fixed `status` and one fixed `outcome`
// per frame, so the line is always printed and says why it is empty; values never leave the page.
export const PAYUNI_FORM_FIELD_STATUSES = Object.freeze([
  "CAPTURED", "PARTIAL", "NO_FRAMES", "PAGE_CLOSED", "TIMEOUT", "SCRIPT_ERROR", "CONTEXT_DESTROYED",
  "TARGET_CLOSED", "FRAME_DETACHED", "EMPTY", "SKIPPED", "OTHER", "CAPTURE_FAILED", "NOT_PAYUNI_PAGE",
]);
const FORM_FIELD_STATUS_SET = new Set(PAYUNI_FORM_FIELD_STATUSES);
const FORM_FRAME_OUTCOMES = new Set(["CAPTURED", "PARTIAL", "TIMEOUT", "SCRIPT_ERROR", "CONTEXT_DESTROYED", "TARGET_CLOSED",
  "FRAME_DETACHED", "EMPTY", "SKIPPED", "OTHER"]);
const FORM_STAGE_ERROR = /^(?:ROOTS|TYPED|FIELDS|FIELD|LABEL|CUSTOM|AGREEMENT):(?:TypeError|ReferenceError|RangeError|SyntaxError|EvalError|URIError|SecurityError|NotSupportedError|InvalidStateError|OTHER)$/u;
const FORM_STAGE_ERRORS_MAX = 5;
/** Main frame first and longest; the whole capture is bounded so a stop is never delayed by more than 15 s. */
export const PAYUNI_FORM_FIELD_BUDGET = Object.freeze({ mainFrameMs: 6_000, childFrameMs: 2_000, totalMs: 15_000 });

/** A Playwright evaluate failure reduced to a fixed code; the message (selectors, page text) is never kept. */
export function classifyPayUniEvaluateError(error) {
  if (!(error instanceof Error)) return "OTHER";
  const text = `${error.name} ${error.message}`;
  if (/Execution context was destroyed|because of a navigation/iu.test(text)) return "CONTEXT_DESTROYED";
  if (/Target page, context or browser has been closed|TargetClosedError|Target closed/iu.test(text)) return "TARGET_CLOSED";
  if (/Frame was detached|frame got detached|detached frame/iu.test(text)) return "FRAME_DETACHED";
  if (/\b(?:TypeError|ReferenceError|RangeError|SyntaxError|EvalError|URIError)\b/u.test(text)) return "SCRIPT_ERROR";
  if (error.name === "TimeoutError") return "TIMEOUT";
  return "OTHER";
}

function sanitizeFormStageErrors(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter((code) => typeof code === "string" && FORM_STAGE_ERROR.test(code)))]
    .slice(0, FORM_STAGE_ERRORS_MAX);
}

function sanitizeFormFrameOutcome(item) {
  return {
    frame: Number.isSafeInteger(item?.frame) && item.frame >= 0 ? Math.min(item.frame, 9) : 0,
    host: safePayUniFrameHost(item?.host),
    outcome: FORM_FRAME_OUTCOMES.has(item?.outcome) ? item.outcome : "OTHER",
    stageErrors: sanitizeFormStageErrors(item?.stageErrors),
  };
}

/** {value} | {error} | {timedOut}; the timer is always cleared. */
async function settleWithin(work, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(work).then((value) => ({ value }), (error) => ({ error })),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sanitized form controls of the main frame and up to seven child frames, with the overall status
 * and one fixed outcome per frame. Time-boxed per frame and overall; never throws, never clicks.
 */
export async function capturePayUniFormFieldResult(page, budget = PAYUNI_FORM_FIELD_BUDGET, now = Date.now) {
  const limits = Object.fromEntries(Object.entries(PAYUNI_FORM_FIELD_BUDGET).map(([key, value]) =>
    [key, Number.isSafeInteger(budget?.[key]) && budget[key] >= 0 ? budget[key] : value]));
  const frames = [];
  const outcomes = [];
  try { if (typeof page?.isClosed === "function" && page.isClosed() === true) return { status: "PAGE_CLOSED", frames, outcomes }; } catch { /* Unknown. */ }
  let all;
  try {
    all = page.frames().slice(0, FORM_FRAMES_MAX);
  } catch (error) {
    return { status: classifyPayUniEvaluateError(error) === "TARGET_CLOSED" ? "PAGE_CLOSED" : "NO_FRAMES", frames, outcomes };
  }
  if (!Array.isArray(all) || all.length === 0) return { status: "NO_FRAMES", frames, outcomes };
  const deadline = now() + limits.totalMs;
  for (const [index, frame] of all.entries()) {
    let host = "UNKNOWN";
    try { host = index === 0 ? "MAIN" : payUniFrameHost(frame); } catch { /* Unknown host. */ }
    const remaining = deadline - now();
    if (remaining <= 0) { outcomes.push({ frame: index, host, outcome: "SKIPPED", stageErrors: [] }); continue; }
    const settled = await settleWithin(() => frame.evaluate(collectPayUniFormFieldsInPage, FORM_FIELDS_MAX),
      Math.min(index === 0 ? limits.mainFrameMs : limits.childFrameMs, remaining));
    let outcome;
    let stageErrors = [];
    if (settled.timedOut) outcome = "TIMEOUT";
    else if (settled.error) outcome = classifyPayUniEvaluateError(settled.error);
    else if (!settled.value || typeof settled.value !== "object") outcome = "EMPTY";
    else {
      stageErrors = sanitizeFormStageErrors(settled.value.stageErrors);
      frames.push(sanitizePayUniFormFields(settled.value, index, host));
      outcome = stageErrors.length > 0 ? "PARTIAL" : "CAPTURED";
    }
    outcomes.push({ frame: index, host, outcome, stageErrors });
  }
  let status;
  if (frames.length === 0) status = outcomes[0]?.outcome ?? "NO_FRAMES";
  else status = outcomes.every((item) => item.outcome === "CAPTURED") ? "CAPTURED" : "PARTIAL";
  return { status, frames, outcomes: outcomes.map(sanitizeFormFrameOutcome) };
}

/** Sanitized form controls only (older callers); never throws. */
export async function capturePayUniFormFields(page) {
  try { return (await capturePayUniFormFieldResult(page)).frames; } catch { return []; }
}

/** A field-list diagnostic that carries only a failure status (the capture itself failed or was not possible). */
export function payUniFormFieldFailure(status, dialogCaptures = []) {
  return {
    status: FORM_FIELD_STATUS_SET.has(status) ? status : "CAPTURE_FAILED",
    missingInfoDialog: isPayUniMissingInfoDialog(dialogCaptures), frames: [], outcomes: [],
  };
}

/** `{status, missingInfoDialog, frames, outcomes}` for the dialog captures seen so far; never null, never throws. */
export async function capturePayUniFormFieldDiagnostic(page, dialogCaptures, budget = PAYUNI_FORM_FIELD_BUDGET) {
  try {
    const result = await capturePayUniFormFieldResult(page, budget);
    return { status: result.status, missingInfoDialog: isPayUniMissingInfoDialog(dialogCaptures), frames: result.frames, outcomes: result.outcomes };
  } catch {
    return payUniFormFieldFailure("CAPTURE_FAILED", dialogCaptures);
  }
}

/**
 * One JSON line of the re-sanitized field list. Any object prints, also with no frames, so a failed
 * capture is visible as its status; only a missing diagnostic (no capture was attempted) is null.
 */
export function formatPayUniFormFieldDiagnostic(value) {
  if (!value || typeof value !== "object") return null;
  const frames = (Array.isArray(value.frames) ? value.frames : []).slice(0, FORM_FRAMES_MAX)
    .map((frame) => sanitizePayUniFormFields(frame, frame?.frame, frame?.host));
  const outcomes = (Array.isArray(value.outcomes) ? value.outcomes : []).slice(0, FORM_FRAMES_MAX).map(sanitizeFormFrameOutcome);
  const status = FORM_FIELD_STATUS_SET.has(value.status) ? value.status : (frames.length > 0 ? "CAPTURED" : "NO_FRAMES");
  return JSON.stringify({ status, missingInfoDialog: value.missingInfoDialog === true, outcomes, frames });
}

function withinMs(promise, milliseconds) {
  return Promise.race([promise, new Promise((resolve) => { setTimeout(() => resolve(null), milliseconds); })]);
}

// ---- Post-submit diagnostics (2026-11-06 run 42098319335: submit accepted by the UI, PayUni never
// created the transaction, and the runner could not say why). Only fixed enums are ever stored or
// printed: dialog type, message category, host/path class and field step. Never message text,
// field values, e-mail, identifiers or URL query strings.
const SUBMIT_MESSAGE_CATEGORIES = new Set(["CARD_EXPIRED", "CARD_NUMBER_INVALID", "CVV_INVALID", "EMAIL_INVALID", "OTHER"]);
const SUBMIT_DIALOG_TYPES = new Set(["ALERT", "CONFIRM", "PROMPT", "OTHER"]);
const SUBMIT_ERROR_STEPS = new Set([...PAYUNI_CARD_FIELDS.map((field) => field.step), "UNKNOWN"]);
const SUBMIT_LOCATION_HOSTS = new Set(["NONE", "PAYUNI_UPP", "APP", "OTHER"]);
const SUBMIT_LOCATION_PATHS = new Set(["NONE", "UPP", "CHECKOUT", "CHECKOUT_RESULT", "ROOT", "OTHER"]);
const SUBMIT_MAX_ENTRIES = 8;

/** Fixed category of a dialog, modal or inline error message; the text itself is never kept. */
export function classifyPayUniSubmitMessage(text) {
  if (typeof text !== "string" || text.length > 4096) return "OTHER";
  if (/(?:過期|到期|有效期)/u.test(text)) return "CARD_EXPIRED";
  if (/(?:卡號|card\s*number)/iu.test(text)) return "CARD_NUMBER_INVALID";
  if (/(?:安全碼|檢查碼|CVV|CVC)/iu.test(text)) return "CVV_INVALID";
  if (/(?:e-?mail|電子郵件|電子信箱|信箱)/iu.test(text)) return "EMAIL_INVALID";
  return "OTHER";
}

/** Host class (PayUni UPP / this app / other) and path class of the page. The query is never read. */
export function classifyPayUniSubmitLocation(url, operationHost) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return { host: "OTHER", path: "NONE" };
    if (parsed.hostname === PAYUNI_PAYMENT_HOST) return { host: "PAYUNI_UPP", path: parsed.pathname === "/api/upp" ? "UPP" : "OTHER" };
    if (parsed.hostname === operationHost) {
      const pathname = parsed.pathname;
      if (pathname === "/checkout/result") return { host: "APP", path: "CHECKOUT_RESULT" };
      if (pathname === "/checkout" || pathname.startsWith("/checkout/")) return { host: "APP", path: "CHECKOUT" };
      return { host: "APP", path: pathname === "/" ? "ROOT" : "OTHER" };
    }
    return { host: "OTHER", path: "NONE" };
  } catch { return { host: "NONE", path: "NONE" }; }
}

/** Map a failing form field (placeholder / autocomplete / type, never its value) to a card-field step. */
export function classifyPayUniSubmitFieldStep(field) {
  const placeholder = typeof field?.placeholder === "string" ? field.placeholder : "";
  const autocomplete = typeof field?.autocomplete === "string" ? field.autocomplete : "";
  const type = typeof field?.type === "string" ? field.type.toLowerCase() : "";
  for (const item of PAYUNI_CARD_FIELDS) {
    if (placeholder === item.placeholder || (item.legacyPlaceholder && placeholder === item.legacyPlaceholder)) return item.step;
  }
  if (autocomplete === "cc-number") return "CARD_NUMBER";
  if (autocomplete === "cc-exp") return "CARD_EXPIRY";
  if (autocomplete === "cc-csc") return "CARD_CVV";
  if (type === "email") return "EMAIL";
  return "UNKNOWN";
}

/** Reduce raw in-page error elements to unique {step, category} pairs. */
export function sanitizePayUniSubmitErrors(raw) {
  const seen = new Set();
  const errors = [];
  for (const item of Array.isArray(raw) ? raw.slice(0, 40) : []) {
    const step = classifyPayUniSubmitFieldStep(item);
    const category = classifyPayUniSubmitMessage(item?.text);
    const key = `${step}:${category}`;
    if (seen.has(key) || errors.length >= SUBMIT_MAX_ENTRIES) continue;
    seen.add(key);
    errors.push({ step, category });
  }
  return errors;
}

/**
 * Runs inside the PayUni page. Collects visible validation-error elements and, for each, only the
 * placeholder / autocomplete / type of the associated field (never `value`) plus the raw message
 * text, which Node reduces to a fixed category and discards.
 */
export function collectSubmitErrorsInPage() {
  const shown = (element) => {
    try {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    } catch { return false; }
  };
  const attribute = (element, name) => String(element?.getAttribute?.(name) ?? "").slice(0, 100);
  const isField = (element) => element.matches?.("input, select, textarea") === true;
  const nearestField = (element) => {
    if (isField(element)) return element;
    let scope = element;
    for (let depth = 0; depth < 3 && scope; depth += 1, scope = scope.parentElement) {
      const field = scope.querySelector?.("input, select, textarea");
      if (field) return field;
    }
    return null;
  };
  const found = [];
  const elements = document.querySelectorAll('.error, [role="alert"], .invalid-feedback, [aria-invalid="true"]');
  for (const element of elements) {
    if (found.length >= 20) break;
    if (!shown(element)) continue;
    const field = nearestField(element);
    let text = isField(element) ? "" : String(element.innerText ?? element.textContent ?? "").slice(0, 200);
    if (text.trim() === "" && field) {
      const sibling = field.parentElement?.querySelector?.('.error, [role="alert"], .invalid-feedback');
      text = String(sibling?.innerText ?? sibling?.textContent ?? "").slice(0, 200);
    }
    found.push({ text, placeholder: attribute(field, "placeholder"), autocomplete: attribute(field, "autocomplete"), type: attribute(field, "type") });
  }
  return found;
}

/** Record a dialog's type and message category, then dismiss it. Never accepts, so it never re-submits. */
export function recordPayUniSubmitDialog(diagnostic, dialog) {
  try {
    const submit = diagnostic?.submit;
    if (submit && diagnostic.step === "SUBMIT" && submit.dialogs.length < SUBMIT_MAX_ENTRIES) {
      const rawType = String(dialog.type?.() ?? "").toUpperCase();
      submit.dialogs.push({
        type: ["ALERT", "CONFIRM", "PROMPT"].includes(rawType) ? rawType : "OTHER",
        category: classifyPayUniSubmitMessage(dialog.message?.()),
      });
    }
    if (diagnostic?.step === "SUBMIT") recordPayUniDialogCapture(diagnostic.dialogTexts, nativePayUniDialogCapture(dialog));
  } catch { /* Diagnostics never change behaviour. */ }
  return Promise.resolve().then(() => dialog.dismiss()).catch(() => {});
}

/** Register the dismiss-only dialog observer; call before the submit click. */
export function observePayUniSubmitDialogs(page, diagnostic) {
  try {
    page.on("dialog", (dialog) => { void recordPayUniSubmitDialog(diagnostic, dialog); });
  } catch { /* A page without dialog events is simply not observed. */ }
}

/** Category of the in-page "確定" modal text; OTHER when the modal text could not be read. */
export function recordPayUniSubmitModal(diagnostic, text) {
  if (!diagnostic?.submit) return;
  diagnostic.submit.modal = typeof text === "string" && text.trim() !== "" ? classifyPayUniSubmitMessage(text) : "OTHER";
}

// ---- Unknown-dialog text diagnostic (2026-11-24 runs 45304632382 and 45340752525: after 確認送出
// PayUni showed a single-button "確定" modal whose text the category diagnostic could not read,
// `modal=OTHER`). This records only the de-identified dialog text and button labels so the dialog
// can be identified: e-mail, URLs, long tokens and letter+digit identifiers are masked, every run of
// two or more digits (ASCII or Chinese numerals, also when split by spaces or - . / , 、 : _) becomes
// "#", and a text that still holds more than three digits is dropped as REDACTED; the text is capped
// at 200 characters. A dialog container that holds a form, input or iframe keeps no text at all. It
// never clicks, accepts or changes the stop decision (contract-tested masking and no-click rules).
export const PAYUNI_DIALOG_TEXT_MAX = 200;
const PAYUNI_DIALOG_BUTTON_TEXT_MAX = 40;
const PAYUNI_DIALOG_BUTTONS_MAX = 6;
const PAYUNI_DIALOG_CAPTURES_MAX = 3;
const PAYUNI_EXTERNAL_HOSTS_MAX = 5;
const PAYUNI_DIALOG_KINDS = new Set([
  "NATIVE_ALERT", "NATIVE_CONFIRM", "NATIVE_PROMPT", "NATIVE_BEFOREUNLOAD", "NATIVE_OTHER",
  "ROLE_DIALOG", "MODAL_CLASS", "FIXED_LAYER", "ANCESTOR", "NONE", "UNREADABLE", "OTHER",
]);
/** Fixed text kept instead of the content of a dialog container that holds a form, input or iframe. */
export const PAYUNI_DIALOG_CONTAINS_FORM = "CONTAINS_FORM";
const PAYUNI_NUMERAL = "[0-9〇零一二三四五六七八九]";
// Two or more numerals separated by nothing but spaces or - . / , 、 : _ (a spaced card number,
// "CVV 1 2 3", an expiry "1/30", a spelled-out Chinese number) collapse into one "#".
const PAYUNI_NUMERAL_RUN = new RegExp(`${PAYUNI_NUMERAL}(?:[\\s\\-./,、:_]*${PAYUNI_NUMERAL})+`, "gu");
// Digits left after masking; a lone "一" is not counted because it is part of everyday words (統一, 一次).
const PAYUNI_COUNTED_DIGIT = /[0-9〇零二三四五六七八九]/gu;
const PAYUNI_DIALOG_MAX_DIGITS = 3;

/** De-identify dialog text: NFKC, then e-mail/URL/token/identifier/digit-run masks and a character whitelist. */
export function sanitizePayUniDialogText(value, max = PAYUNI_DIALOG_TEXT_MAX) {
  if (typeof value !== "string") return "";
  let text = value.slice(0, 8_192).normalize("NFKC").replace(/\s+/gu, " ").trim();
  text = text.replace(/[^\s@]+@[^\s@]+/gu, "EMAIL");
  text = text.replace(/(?:[a-z][a-z0-9+.-]*:)?\/\/\S*/giu, "URL");
  text = text.replace(/(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#]\S*)?/giu, "URL");
  text = text.replace(/(?=[A-Za-z0-9+/=_-]*[A-Za-z])[A-Za-z0-9+/=_-]{16,}/gu, "TOKEN");
  // Letter+digit identifiers (order / trade numbers); pure digit runs become "#" below.
  text = text.replace(/(?<![A-Za-z0-9])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{6,}(?![A-Za-z0-9])/gu, "ID");
  text = text.replace(PAYUNI_NUMERAL_RUN, "#");
  text = text.replace(/[^A-Za-z0-9 _\-./*:()#~,!?%$[\]　-〿㐀-䶿一-鿿！-～]/gu, "");
  text = text.replace(/ {2,}/gu, " ").trim();
  if (/\d{2,}|@|:\/\//u.test(text) || (text.match(PAYUNI_COUNTED_DIGIT) ?? []).length > PAYUNI_DIALOG_MAX_DIGITS) return "REDACTED";
  return text.length > max ? `${text.slice(0, max - 1)}~` : text;
}

/**
 * Runs inside the PayUni page on the visible "確定" button. Finds the nearest dialog-like ancestor
 * (role/aria-modal, a modal/popup class, or a fixed layer; else the nearest ancestor with more text)
 * and returns its visible text plus the labels of its visible buttons. Input values are never read;
 * Node de-identifies everything before it is kept.
 */
export function collectPayUniDialogInPage(button) {
  const textOf = (element) => String(element?.innerText ?? element?.textContent ?? "").slice(0, 2_000);
  const shown = (element) => {
    try {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    } catch { return false; }
  };
  const kindOf = (element) => {
    const role = String(element.getAttribute?.("role") ?? "").toLowerCase();
    if (element.tagName === "DIALOG" || role === "dialog" || role === "alertdialog" || element.getAttribute?.("aria-modal") === "true") return "ROLE_DIALOG";
    const className = String(element.className?.baseVal ?? element.className ?? "");
    if (/(?:modal|dialog|popup|pop-up|swal|alert|lightbox|overlay)/iu.test(className)) return "MODAL_CLASS";
    try { if (getComputedStyle(element).position === "fixed") return "FIXED_LAYER"; } catch { /* Unknown style. */ }
    return null;
  };
  const own = textOf(button).trim();
  let container = null;
  let kind = "NONE";
  let fallback = null;
  for (let element = button?.parentElement, depth = 0; element && element !== document.body && depth < 8; element = element.parentElement, depth += 1) {
    const found = kindOf(element);
    if (found) { container = element; kind = found; break; }
    const text = textOf(element).trim();
    // A plain ancestor counts only within three levels of the button.
    if (!fallback && depth < 3 && text !== "" && text !== own) fallback = element;
  }
  if (!container && fallback) { container = fallback; kind = "ANCESTOR"; }
  // A container that holds a form, a field or a frame is page content, not a dialog message: its
  // text never leaves the page, only the kind, the fixed CONTAINS_FORM marker and button labels.
  const containsForm = Boolean(container?.querySelector?.("form, input, select, textarea, iframe"));
  const buttons = [];
  for (const element of container ? container.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a') : []) {
    if (buttons.length >= 6) break;
    if (!shown(element)) continue;
    const label = element.tagName === "INPUT" ? String(element.getAttribute("value") ?? "") : textOf(element);
    if (label.trim() !== "") buttons.push(label.slice(0, 100));
  }
  return {
    kind, containsForm, text: container && !containsForm ? textOf(container) : "",
    buttons: buttons.length > 0 ? buttons : [own.slice(0, 100)],
  };
}

/**
 * Sanitized {kind, text, buttons}; a plain string is treated as the dialog text. A capture marked
 * `containsForm` keeps only the fixed CONTAINS_FORM text, whatever text it carried.
 */
export function sanitizePayUniDialogCapture(raw, kind = null) {
  const source = typeof raw === "string" ? { text: raw } : (raw !== null && typeof raw === "object" ? raw : {});
  const resolved = PAYUNI_DIALOG_KINDS.has(kind) ? kind : (PAYUNI_DIALOG_KINDS.has(source.kind) ? source.kind : "OTHER");
  const buttons = (Array.isArray(source.buttons) ? source.buttons : []).slice(0, PAYUNI_DIALOG_BUTTONS_MAX)
    .map((label) => sanitizePayUniDialogText(label, PAYUNI_DIALOG_BUTTON_TEXT_MAX)).filter((label) => label !== "");
  const text = source.containsForm === true ? PAYUNI_DIALOG_CONTAINS_FORM : sanitizePayUniDialogText(source.text);
  return { kind: resolved, text, buttons };
}

/** Read the visible "確定" dialog through its button locator; time-boxed, never throws, never clicks. */
export async function capturePayUniConfirmationDialog(confirmation) {
  try {
    const raw = await withinMs(Promise.resolve().then(() => confirmation.evaluate(collectPayUniDialogInPage)), 2_000);
    return raw === null || raw === undefined ? { kind: "UNREADABLE", text: "", buttons: [] } : sanitizePayUniDialogCapture(raw);
  } catch { return { kind: "UNREADABLE", text: "", buttons: [] }; }
}

/** A native alert/confirm/prompt reduced to its type and de-identified message. Never accepts it. */
export function nativePayUniDialogCapture(dialog) {
  let type = "";
  let message = "";
  try { type = String(dialog?.type?.() ?? "").toUpperCase(); } catch { /* Unknown type. */ }
  try { message = dialog?.message?.(); } catch { /* Unreadable message. */ }
  const kind = ["ALERT", "CONFIRM", "PROMPT", "BEFOREUNLOAD"].includes(type) ? `NATIVE_${type}` : "NATIVE_OTHER";
  return sanitizePayUniDialogCapture({ text: message }, kind);
}

/**
 * Hostname of a blocked third-party sub-resource. A host whose sub-domain labels carry a digit or a
 * random-looking length keeps only its last two labels ("*.cloudfront.net"); an IP address is "IP".
 */
export function sanitizePayUniHostName(value) {
  if (typeof value !== "string") return "OTHER";
  const host = value.toLowerCase();
  if (!/^[a-z0-9.-]{1,100}$/u.test(host) || !host.includes(".")) return "OTHER";
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) return "IP";
  const labels = host.split(".");
  const randomLooking = (label) => /\d/u.test(label) || label.length > 24;
  const registrable = labels.slice(-2);
  if (registrable.some((label) => label.length > 24)) return "OTHER";
  return labels.slice(0, -2).some(randomLooking) ? `*.${registrable.join(".")}` : host;
}

/** Remember up to five distinct sanitized third-party hosts. */
export function recordPayUniExternalHost(hosts, hostname) {
  if (!Array.isArray(hosts)) return;
  const host = sanitizePayUniHostName(hostname);
  if (!hosts.includes(host) && hosts.length < PAYUNI_EXTERNAL_HOSTS_MAX) hosts.push(host);
}

/** Keep up to three dialog captures in arrival order. */
export function recordPayUniDialogCapture(captures, capture) {
  if (Array.isArray(captures) && capture && captures.length < PAYUNI_DIALOG_CAPTURES_MAX) captures.push(capture);
}

/**
 * One JSON line: de-identified dialog captures, blocked third-party hosts, and (drill only) the
 * PayUni POST count and seconds after the submit click. Every value is re-sanitized here.
 */
export function formatPayUniDialogDiagnostic(value) {
  if (!value || typeof value !== "object") return null;
  const dialogs = (Array.isArray(value.dialogs) ? value.dialogs : []).slice(0, PAYUNI_DIALOG_CAPTURES_MAX)
    .map((capture) => sanitizePayUniDialogCapture(capture, capture?.kind));
  const externalHosts = [...new Set((Array.isArray(value.externalHosts) ? value.externalHosts : [])
    .slice(0, PAYUNI_EXTERNAL_HOSTS_MAX).map(sanitizePayUniHostName))];
  const count = (number, cap) => (Number.isSafeInteger(number) && number >= 0 ? Math.min(number, cap) : null);
  const payuniPostsAfterSubmit = count(value.payuniPostsAfterSubmit, 99);
  const afterSubmitSeconds = count(value.afterSubmitSeconds, 999);
  if (dialogs.length === 0 && externalHosts.length === 0 && payuniPostsAfterSubmit === null) return null;
  return JSON.stringify({ dialogs, externalHosts, payuniPostsAfterSubmit, afterSubmitSeconds });
}

/**
 * After a non-successful submit: where the browser is (host/path class only), which validation
 * errors are visible on the PayUni page, and a fresh sanitized page structure. Time-boxed; never throws.
 */
export async function capturePayUniSubmitDiagnostic(page, diagnostic, operationHost) {
  if (!diagnostic?.submit) return;
  const submit = diagnostic.submit;
  submit.captured = true;
  // The field list always ends with a status (A4-05): CAPTURE_FAILED or NOT_PAYUNI_PAGE instead of nothing.
  diagnostic.formFields = payUniFormFieldFailure("CAPTURE_FAILED", diagnostic.dialogTexts);
  try {
    const location = classifyPayUniSubmitLocation(page.url(), operationHost);
    submit.host = location.host;
    submit.path = location.path;
    if (location.host !== "PAYUNI_UPP") {
      diagnostic.formFields = payUniFormFieldFailure("NOT_PAYUNI_PAGE", diagnostic.dialogTexts);
      return;
    }
    const frames = page.frames().slice(0, STRUCTURE_MAX_FRAMES);
    const collected = [];
    for (const frame of frames) {
      const raw = await withinMs(frame.evaluate(collectSubmitErrorsInPage).catch(() => null), 2_000);
      if (Array.isArray(raw)) collected.push(...raw);
    }
    submit.errors = sanitizePayUniSubmitErrors(collected);
    const structure = await capturePayUniPageStructure(page);
    if (structure.length > 0) diagnostic.structure = structure;
  } catch { /* No diagnostic is better than a changed failure code. */ }
  if (diagnostic.formFields.status === "NOT_PAYUNI_PAGE") return;
  // Read-only list of every control and whether it is empty/checked/invalid; never a value. Never throws.
  diagnostic.formFields = await capturePayUniFormFieldDiagnostic(page, diagnostic.dialogTexts);
}

/** One fixed-vocabulary log line; every value is re-validated against its whitelist. */
export function formatPayUniSubmitDiagnostic(diagnostic) {
  const submit = diagnostic?.submit;
  if (!submit || submit.captured !== true) return null;
  const dialogs = (Array.isArray(submit.dialogs) ? submit.dialogs : []).slice(0, SUBMIT_MAX_ENTRIES).map((item) =>
    `${SUBMIT_DIALOG_TYPES.has(item?.type) ? item.type : "OTHER"}:${SUBMIT_MESSAGE_CATEGORIES.has(item?.category) ? item.category : "OTHER"}`);
  const errors = (Array.isArray(submit.errors) ? submit.errors : []).slice(0, SUBMIT_MAX_ENTRIES).map((item) =>
    `${SUBMIT_ERROR_STEPS.has(item?.step) ? item.step : "UNKNOWN"}:${SUBMIT_MESSAGE_CATEGORIES.has(item?.category) ? item.category : "OTHER"}`);
  const modal = submit.modal === "NONE" ? "NONE" : (SUBMIT_MESSAGE_CATEGORIES.has(submit.modal) ? submit.modal : "OTHER");
  return [
    `dialogs=${dialogs.length > 0 ? dialogs.join(",") : "NONE"}`,
    `modal=${modal}`,
    `host=${SUBMIT_LOCATION_HOSTS.has(submit.host) ? submit.host : "NONE"}`,
    `path=${SUBMIT_LOCATION_PATHS.has(submit.path) ? submit.path : "NONE"}`,
    `errors=${errors.length > 0 ? errors.join(",") : "NONE"}`,
  ].join("; ");
}

/**
 * After a failed step, count where the expected field is: in the main frame, or in a child
 * frame (a provider move to hosted iframes shows up here). Counts only, bounded and time-boxed.
 */
export async function recordPayUniBrowserFailure(page, diagnostic, error, operationHost) {
  if (!diagnostic || typeof diagnostic !== "object") return;
  try {
    diagnostic.error = classifyPlaywrightErrorKind(error);
    diagnostic.page = classifyPayUniBrowserPage(page.url(), operationHost);
    if (diagnostic.step === "SUBMIT") await capturePayUniSubmitDiagnostic(page, diagnostic, operationHost);
    else if (diagnostic.page.startsWith("PAYUNI_") && diagnostic.step !== "NONE") diagnostic.structure = await capturePayUniPageStructure(page);
    // A page that never settled: the read-only field list, after the stop decision (A4-05 MINOR-3).
    if (diagnostic.step === "PRESUBMIT") {
      diagnostic.formFields = diagnostic.page.startsWith("PAYUNI_")
        ? await capturePayUniFormFieldDiagnostic(page, diagnostic.dialogTexts)
        : payUniFormFieldFailure("NOT_PAYUNI_PAGE", diagnostic.dialogTexts);
    }
    const field = PAYUNI_CARD_FIELDS.find((item) => item.step === diagnostic.step);
    if (!field) return;
    diagnostic.mainFrameMatches = await withinMs(page.getByPlaceholder(field.placeholder, { exact: true }).count(), 2_000);
    const children = page.frames().filter((frame) => frame !== page.mainFrame());
    diagnostic.childFrames = children.length;
    let matches = 0;
    for (const frame of children.slice(0, 9)) {
      const count = await withinMs(frame.getByPlaceholder(field.placeholder, { exact: true }).count().catch(() => 0), 1_000);
      if (Number.isSafeInteger(count) && count > 0) matches += 1;
    }
    diagnostic.childFrameMatches = matches;
  } catch { /* Diagnostics never change the fixed failure code. */ }
}

export async function selectPayUniOneTimeCredit(page, diagnostic) {
  markPayUniBrowserStep(diagnostic, "METHOD");
  await page.getByText("一次付清", { exact: true }).click({ timeout: 20_000 });
  await page.locator('input[name="radioOptionpayGroupCredit"]').check({ force: true, timeout: 10_000 });
}

async function sleep(milliseconds) {
  await new Promise((resolve) => { setTimeout(resolve, milliseconds); });
}

/** The locator when exactly one visible element matches within `waitMs`; otherwise null. */
async function uniqueVisible(locator, waitMs) {
  const deadline = Date.now() + waitMs;
  do {
    try {
      if (await withinMs(locator.count(), 1_000) === 1 && await locator.isVisible()) return locator;
    } catch { return null; }
    await sleep(250);
  } while (Date.now() < deadline);
  return null;
}

/** Click the credit-card tab only when exactly one visible element carries its exact text. */
export async function clickPayUniCreditTab(page) {
  try {
    for (const locator of [page.getByRole("tab", { name: PAYUNI_CREDIT_TAB_TEXT, exact: true }), page.getByText(PAYUNI_CREDIT_TAB_TEXT, { exact: true })]) {
      const count = await withinMs(locator.count(), 1_000);
      if (count === 1 && await locator.isVisible()) {
        await locator.click({ timeout: 5_000 });
        // The tab may re-render the installment choice; keep 一次付清 selected if it is there.
        const credit = page.locator('input[name="radioOptionpayGroupCredit"]');
        if (await withinMs(credit.count(), 1_000) > 0) await credit.first().check({ force: true, timeout: 5_000 });
        return "CLICKED";
      }
      if (Number.isSafeInteger(count) && count > 1) return "AMBIGUOUS";
    }
    return "NOT_FOUND";
  } catch { return "NOT_FOUND"; }
}

/** Fallback for a field whose proven placeholder timed out; null keeps the original failure. */
async function findPayUniFallbackField(page, field, diagnostic, waitMs = PAYUNI_FALLBACK_WAIT_MS) {
  try {
    if (field.legacyPlaceholder) {
      const legacy = await uniqueVisible(page.getByPlaceholder(field.legacyPlaceholder, { exact: true }), waitMs);
      if (legacy) return { locator: legacy, source: "LEGACY_PLACEHOLDER" };
    }
    const fallback = await uniqueVisible(page.locator(field.fallback), waitMs);
    if (fallback) return { locator: fallback, source: "AUTOCOMPLETE" };
    if (field.step !== "CARD_NUMBER") return null;
    diagnostic.creditTab = await clickPayUniCreditTab(page);
    if (diagnostic.creditTab !== "CLICKED") return null;
    const primary = await uniqueVisible(page.getByPlaceholder(field.placeholder, { exact: true }), waitMs);
    if (primary) return { locator: primary, source: "PLACEHOLDER_AFTER_TAB" };
    const afterTab = await uniqueVisible(page.locator(field.fallback), 2_000);
    return afterTab ? { locator: afterTab, source: "AUTOCOMPLETE_AFTER_TAB" } : null;
  } catch { return null; }
}

// ---- Fill timing (A4-05: "請確認付款資訊已填寫" after 確認送出 came and went between runs of the
// same code: 45362693554 and 45388812344 stopped on it, 45376157147 paid). The runner opened the
// UPP document at `commit`, started typing as soon as each field was visible, set the e-mail with a
// single `fill()` (input event only, no key events) and clicked 確認送出 in the same tick. Any PayUni
// script that binds its handlers late, formats on key events, or updates its own state after
// change/blur or after a request could see an empty field that the DOM already showed. Now both
// runners: wait for the document to load, type every field key by key and blur it, then re-check
// in the page that each field holds the expected (formatted or masked) value, that 確認送出 is
// enabled and that no PayUni request is in flight, twice in a row, before the one and only click.
// A page that never settles is not submitted at all. A dialog after the click still stops the run.
export const PAYUNI_SETTLE = Object.freeze({
  pageLoadMs: 15_000, timeoutMs: 15_000, quietMs: 1_000, pollMs: 250, stablePolls: 2, typeDelayMs: 40, staleRequestMs: 5_000,
});
export const PAYUNI_PRESUBMIT_STATUSES = Object.freeze([
  "NOT_RUN", "SETTLED", "FIELDS_UNSETTLED", "SUBMIT_DISABLED", "NETWORK_BUSY", "UNSTABLE", "DIALOG_BEFORE_SUBMIT",
]);
const PRESUBMIT_STATUS_SET = new Set(PAYUNI_PRESUBMIT_STATUSES);
const PAGE_LOAD_STATES = new Set(["NOT_RUN", "LOADED", "DOM_ONLY", "TIMEOUT", "FAILED"]);
const PRESUBMIT_FIELD_STEPS = Object.freeze(PAYUNI_CARD_FIELDS.map((field) => field.step));
const TRACKED_PAYUNI_RESOURCES = new Set(["document", "script", "xhr", "fetch"]);

/** De-identified pre-submit state: fixed enums, per-field booleans and bounded counts only. */
export function createPayUniPresubmitDiagnostic() {
  return {
    status: "NOT_RUN", pageLoad: "NOT_RUN",
    fields: Object.fromEntries(PRESUBMIT_FIELD_STEPS.map((step) => [step, null])),
    submitEnabled: null, payuniInflight: null, payuniIgnored: null,
    dialogsBeforeSubmit: 0, confirmationVisible: null, settleMs: null, checks: 0,
  };
}

/** One JSON line of the re-validated pre-submit state; null when no state exists. */
export function formatPayUniPresubmitDiagnostic(value) {
  if (!value || typeof value !== "object") return null;
  const bool = (item) => (item === true ? true : item === false ? false : null);
  const count = (item, cap) => (Number.isSafeInteger(item) && item >= 0 ? Math.min(item, cap) : null);
  return JSON.stringify({
    status: PRESUBMIT_STATUS_SET.has(value.status) ? value.status : "NOT_RUN",
    pageLoad: PAGE_LOAD_STATES.has(value.pageLoad) ? value.pageLoad : "NOT_RUN",
    fields: Object.fromEntries(PRESUBMIT_FIELD_STEPS.map((step) => [step, bool(value.fields?.[step])])),
    submitEnabled: bool(value.submitEnabled),
    payuniInflight: count(value.payuniInflight, 99),
    payuniIgnored: count(value.payuniIgnored, 99),
    dialogsBeforeSubmit: count(value.dialogsBeforeSubmit, 9) ?? 0,
    confirmationVisible: bool(value.confirmationVisible),
    settleMs: count(value.settleMs, 99_999),
    checks: count(value.checks, 999) ?? 0,
  });
}

function isPayUniHostRequest(request) {
  try {
    const url = new URL(request.url());
    return url.protocol === "https:" && (url.hostname === "payuni.com.tw" || url.hostname.endsWith(".payuni.com.tw"));
  } catch { return false; }
}

/**
 * Counts PayUni document/script/XHR/fetch requests still in flight and when the last one started or
 * ended. Third-party and long-lived (websocket, event-stream) requests are not counted, and a request
 * that has been waiting longer than `staleMs` (a long poll or keep-alive) is reported as ignored
 * instead of blocking the submit forever. Never reads a URL beyond its host, a body or a header.
 */
export function trackPayUniRequests(page, now = Date.now, staleMs = PAYUNI_SETTLE.staleRequestMs) {
  const pending = new Map();
  let lastActivityAt = null;
  const relevant = (request) => {
    try { return isPayUniHostRequest(request) && TRACKED_PAYUNI_RESOURCES.has(request.resourceType()); } catch { return false; }
  };
  try {
    page.on("request", (request) => { if (relevant(request)) { const at = now(); pending.set(request, at); lastActivityAt = at; } });
    const done = (request) => { if (pending.delete(request)) lastActivityAt = now(); };
    page.on("requestfinished", done);
    page.on("requestfailed", done);
  } catch { /* A page without request events reports no PayUni traffic. */ }
  const stale = (at) => [...pending.values()].filter((startedAt) => at - startedAt > staleMs).length;
  return Object.freeze({
    /** Requests in flight that started at most `staleMs` ago. */
    inflight: (at = now()) => pending.size - stale(at),
    /** Requests in flight for longer than `staleMs`; printed, never waited for. */
    ignored: (at = now()) => stale(at),
    quietFor: (at) => (lastActivityAt === null ? Number.POSITIVE_INFINITY : at - lastActivityAt),
  });
}

/**
 * Counts native dialogs (alert/confirm/prompt) that open before the one submit click. It only
 * counts: the runner's own dialog handler still dismisses them. `markSubmitted()` freezes the count.
 */
export function countPayUniDialogsBeforeSubmit(page) {
  let count = 0;
  let submitted = false;
  try { page.on("dialog", () => { if (!submitted) count += 1; }); } catch { /* No dialog events: nothing to count. */ }
  return Object.freeze({ count: () => count, markSubmitted: () => { submitted = true; } });
}

/** Wait for DOMContentLoaded and then load, bounded; a timeout is recorded and the settle check still decides. */
export async function waitForPayUniPageReady(page, presubmit, waitMs = PAYUNI_SETTLE.pageLoadMs, now = Date.now) {
  const deadline = now() + waitMs;
  let state = "FAILED";
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: Math.max(1, deadline - now()) });
    state = "DOM_ONLY";
    await page.waitForLoadState("load", { timeout: Math.max(1, deadline - now()) });
    state = "LOADED";
  } catch (error) {
    if (state === "FAILED" && classifyPlaywrightErrorKind(error) === "TIMEOUT") state = "TIMEOUT";
  }
  if (presubmit && typeof presubmit === "object") presubmit.pageLoad = state;
  return state;
}

/**
 * Runs inside the PayUni page on one card field. Compares the field's current value with the value
 * the runner typed and returns only true or false; the value never leaves the page. Separators the
 * page inserts while formatting (spaces, "-", "/") are ignored, and a character the page masked
 * ("*", "•", "●", "x") counts as matching, but the length must be exact.
 */
export function payUniFieldMatchesInPage(element, expected) {
  try {
    const value = String(element?.value ?? "");
    const want = String(expected?.value ?? "");
    if (want === "" || value === "") return false;
    if (expected?.step === "EMAIL") return value.trim() === want;
    if (!/^[0-9\s\-/*•●xX]+$/u.test(value)) return false;
    const got = value.replace(/[\s\-/]/gu, "");
    if (got.length !== want.length) return false;
    for (let index = 0; index < want.length; index += 1) {
      if (got[index] !== want[index] && !/[*•●xX]/u.test(got[index])) return false;
    }
    if (expected?.step === "CARD_EXPIRY") return /^\d{2}\s*\/?\s*\d{2}$/u.test(value.trim()) || /[*•●xX]/u.test(got);
    return true;
  } catch { return false; }
}

/** Clear one known field, type it key by key, then blur it so change/blur handlers run before anything else. */
async function enterPayUniField(locator, value, timeout, typeDelayMs) {
  await locator.clear({ timeout });
  await locator.pressSequentially(value, { delay: typeDelayMs, timeout });
  await locator.blur({ timeout });
}

/**
 * Fills the four known card fields in a fixed order (clear, then key by key, then blur), and records
 * only which step is active; never submits. Returns the locator used for each step so the same
 * elements are re-checked before the submit.
 */
export async function fillPayUniCardFields(page, input, email, fallbackWaitMs = PAYUNI_FALLBACK_WAIT_MS, typeDelayMs = PAYUNI_SETTLE.typeDelayMs) {
  const values = { CARD_NUMBER: input.cardNumber, CARD_EXPIRY: input.cardExpiry, CARD_CVV: input.cardCvv, EMAIL: email };
  const diagnostic = input.diagnostic ?? createPayUniBrowserDiagnostic();
  const entered = {};
  for (const field of PAYUNI_CARD_FIELDS) {
    markPayUniBrowserStep(input.diagnostic, field.step);
    const primary = page.getByPlaceholder(field.placeholder, { exact: true });
    try {
      await enterPayUniField(primary, values[field.step], PAYUNI_FIELD_TIMEOUT_MS, typeDelayMs);
      entered[field.step] = primary;
      diagnostic.fieldSource = "PLACEHOLDER";
    } catch (error) {
      if (classifyPlaywrightErrorKind(error) !== "TIMEOUT") throw error;
      const fallback = await findPayUniFallbackField(page, field, diagnostic, fallbackWaitMs);
      if (!fallback) throw error;
      diagnostic.fieldSource = fallback.source;
      await enterPayUniField(fallback.locator, values[field.step], PAYUNI_FIELD_TIMEOUT_MS, typeDelayMs);
      entered[field.step] = fallback.locator;
    }
  }
  return Object.freeze({ locators: Object.freeze(entered), values: Object.freeze(values) });
}

/**
 * The pre-submit gate. Polls until every filled field holds its expected value (checked in the
 * page, true/false only), 確認送出 is enabled and no PayUni request has been in flight for
 * `quietMs`, on `stablePolls` consecutive checks; otherwise returns why it did not settle.
 *
 * A native dialog that opened before the submit (`dialogs.count() > 0`) or a visible "確定" modal
 * (`confirmation`) ends the gate at once with DIALOG_BEFORE_SUBMIT: the page is not in a state to be
 * submitted, and the modal is never clicked. Every wait inside one check is cut to the time left, so
 * the gate as a whole never runs past `timeoutMs` by more than one bookkeeping step. It never clicks,
 * types or submits anything.
 */
export async function settlePayUniBeforeSubmit({
  filled, submit, tracker = null, dialogs = null, confirmation = null, presubmit, timing = PAYUNI_SETTLE, now = Date.now, pause = sleep,
}) {
  const state = presubmit && typeof presubmit === "object" ? presubmit : createPayUniPresubmitDiagnostic();
  const startedAt = now();
  const deadline = startedAt + timing.timeoutMs;
  const left = (cap) => Math.min(cap, Math.max(0, deadline - now()));
  // At least one settled check, whatever the timing says: zero would let an unchecked page through.
  const needed = Math.max(1, Number.isSafeInteger(timing.stablePolls) ? timing.stablePolls : PAYUNI_SETTLE.stablePolls);
  let stable = 0;
  let status = "FIELDS_UNSETTLED";
  for (;;) {
    state.checks += 1;
    // A call that timed out only because the overall budget ran out says nothing about the page.
    let cutShort = false;
    const bounded = async (work, cap) => {
      const budget = left(cap);
      const result = await settleWithin(() => work(budget), budget);
      if (result.timedOut && budget < cap) cutShort = true;
      return result;
    };
    const dialogCount = dialogs ? dialogs.count() : 0;
    state.dialogsBeforeSubmit = dialogCount;
    if (dialogCount > 0) { status = "DIALOG_BEFORE_SUBMIT"; stable = 0; break; }
    const visible = confirmation ? await bounded(() => confirmation.isVisible(), 2_000) : { value: false };
    if (visible.value === true) { state.confirmationVisible = true; status = "DIALOG_BEFORE_SUBMIT"; stable = 0; break; }
    const fields = {};
    for (const step of PRESUBMIT_FIELD_STEPS) {
      const locator = filled?.locators?.[step];
      const result = locator
        ? await bounded(() => locator.evaluate(payUniFieldMatchesInPage, { step, value: filled.values[step] }), 2_000)
        : { value: false };
      fields[step] = result.value === true;
    }
    const enabled = await bounded((budget) => submit.isEnabled({ timeout: Math.max(1, budget) }), 2_000);
    // A check cut short by the deadline keeps the previous complete check's state (the first one is always kept).
    if (cutShort && state.checks > 1) { state.checks -= 1; break; }
    const at = now();
    const inflight = tracker ? tracker.inflight(at) : 0;
    const quiet = inflight === 0 && (tracker ? tracker.quietFor(at) : Number.POSITIVE_INFINITY) >= timing.quietMs;
    state.confirmationVisible = visible.value === false ? false : null;
    Object.assign(state, { fields, submitEnabled: enabled.value === true, payuniInflight: inflight, payuniIgnored: tracker?.ignored ? tracker.ignored(at) : 0 });
    if (!Object.values(fields).every(Boolean)) status = "FIELDS_UNSETTLED";
    else if (enabled.value !== true) status = "SUBMIT_DISABLED";
    else if (!quiet) status = "NETWORK_BUSY";
    // The modal check could not answer: not a dialog, but not a settled page either.
    else if (state.confirmationVisible !== false) status = "UNSTABLE";
    else status = "SETTLED";
    stable = status === "SETTLED" ? stable + 1 : 0;
    if (stable >= needed || now() >= deadline) break;
    await pause(left(timing.pollMs));
    if (now() >= deadline) break;
  }
  state.status = stable >= needed ? "SETTLED" : (status === "SETTLED" ? "UNSTABLE" : status);
  state.settleMs = Math.max(0, now() - startedAt);
  return state.status;
}

/** Settle timing; tests may shorten it. Only non-negative safe integers override PAYUNI_SETTLE. */
export function settleTiming(dependencies = {}) {
  const override = dependencies?.payuniSettle;
  if (!override || typeof override !== "object") return PAYUNI_SETTLE;
  return Object.freeze(Object.fromEntries(Object.entries(PAYUNI_SETTLE).map(([key, value]) =>
    [key, Number.isSafeInteger(override[key]) && override[key] >= 0 ? override[key] : value])));
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
  observePayUniSubmitDialogs(page, input.diagnostic);
  const payuniTraffic = trackPayUniRequests(page, Date.now, settleTiming(dependencies).staleRequestMs);
  const dialogsBeforeSubmit = countPayUniDialogsBeforeSubmit(page);
  const presubmit = input.diagnostic?.presubmit ?? createPayUniPresubmitDiagnostic();
  const origin = fixedOrigin(input.previewHost);
  let stage = "PAYMENT_PAGE_UNREACHED";
  let apiPostSeen = false;
  let apiStatus = null;
  let apiNetworkRejected = false;
  let apiNetworkFailure = "PAYMENT_API_NETWORK_REJECTED";
  let signedReturnBody = null;
  let signedReturnContentType = null;
  let returnRequestCount = 0;
  let returnStatus = null;
  let paymentPageOpened = false;
  try {
    page.on("request", (request) => {
      try {
        const url = new URL(request.url());
        if (url.protocol === "https:" && url.hostname === "sandbox-api.payuni.com.tw" && url.pathname === "/api/upp" && request.method() === "POST") apiPostSeen = true;
        if (input.captureReturnCallback === true && url.origin === origin
          && url.pathname === "/api/webhooks/payments" && url.search === "?provider=payuni&source=return"
          && request.method() === "POST") {
          returnRequestCount += 1;
          const body = request.postDataBuffer();
          signedReturnBody = Buffer.isBuffer(body) ? body : null;
          signedReturnContentType = request.headers()["content-type"] ?? null;
        }
      } catch {}
    });
    page.on("response", (response) => {
      try {
        const url = new URL(response.url());
        if (url.protocol === "https:" && url.hostname === "sandbox-api.payuni.com.tw" && url.pathname === "/api/upp") apiStatus = response.status();
        if (input.captureReturnCallback === true && url.origin === origin
          && url.pathname === "/api/webhooks/payments" && url.search === "?provider=payuni&source=return"
          && response.request().method() === "POST") returnStatus = response.status();
      } catch {}
    });
    page.on("requestfailed", (request) => {
      if (paymentPageOpened) recordPayUniResourceFailure(input.diagnostic, request);
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
    paymentPageOpened = true;
    await page.goto(PAYUNI_UPP_URL, {
      // Optional third-party resources remain blocked by the fixed egress
      // allowlist; the committed provider document is sufficient for the
      // authoritative field checks below.
      waitUntil: "commit",
      timeout: REQUEST_TIMEOUT_MS,
    });
    await waitForPayUniPageReady(page, presubmit, settleTiming(dependencies).pageLoadMs);
    stage = "PAYMENT_METHOD_UNAVAILABLE";
    await selectPayUniOneTimeCredit(page, input.diagnostic);
    stage = "PAYMENT_FIELDS_REJECTED";
    const filled = await fillPayUniCardFields(page, input, "wp4-buyer-v1@invalid.example", dependencies.payuniFallbackWaitMs, settleTiming(dependencies).typeDelayMs);
    const submitButton = page.getByRole("button", { name: "確認送出", exact: true });
    // Only a settled page is submitted; an unsettled one ends here with no click at all.
    markPayUniBrowserStep(input.diagnostic, "PRESUBMIT");
    if (await settlePayUniBeforeSubmit({ filled, submit: submitButton, tracker: payuniTraffic, dialogs: dialogsBeforeSubmit,
      confirmation: page.getByRole("button", { name: "確定", exact: true }), presubmit, timing: settleTiming(dependencies) }) !== "SETTLED") {
      throw new Error("PAYMENT_FIELDS_UNSETTLED");
    }
    stage = "PAYMENT_SUBMIT_REJECTED";
    markPayUniBrowserStep(input.diagnostic, "SUBMIT");
    dialogsBeforeSubmit.markSubmitted();
    await submitButton.click();
    const confirmation = page.getByRole("button", { name: "確定", exact: true });
    try {
      await confirmation.waitFor({ state: "visible", timeout: 5_000 });
      // Read only the displayed dialog and immediately reduce it to a closed enum.
      // Never click a second submit/confirmation or persist provider text/card details.
      let confirmationText = "";
      try {
        confirmationText = await confirmation.evaluate((button) =>
          button.closest('[role="dialog"], .modal, .swal2-popup')?.innerText?.slice(0, 4097) ?? "");
      } catch { /* Unreadable/unknown dialogs stay ambiguous. */ }
      recordPayUniSubmitModal(input.diagnostic, confirmationText);
      // Text-only diagnostic of the same dialog (de-identified, 200 characters); it is still never clicked.
      recordPayUniDialogCapture(input.diagnostic?.dialogTexts, await capturePayUniConfirmationDialog(confirmation));
      await capturePayUniSubmitDiagnostic(page, input.diagnostic, input.previewHost);
      return classifyPayUniConfirmation(confirmationText);
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
    if (!resultText.includes(input.orderNumber) || !resultText.includes("付款完成")) {
      await capturePayUniSubmitDiagnostic(page, input.diagnostic, input.previewHost);
      return false;
    }
    if (input.captureReturnCallback !== true) return true;
    if (returnRequestCount !== 1 || returnStatus !== 303 || !Buffer.isBuffer(signedReturnBody)
      || signedReturnBody.length === 0 || signedReturnBody.length > 16_384
      || !/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/iu.test(signedReturnContentType ?? "")) {
      return "RETURN_CALLBACK_PROOF_REQUIRED";
    }
    // The signed provider body remains in process memory until one replay. It never enters a receipt.
    return { mapped: true, firstStatus: 303, signedReturnBody, contentType: signedReturnContentType };
  } catch (error) {
    await recordPayUniBrowserFailure(page, input.diagnostic, error, input.previewHost);
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
  observePayUniSubmitDialogs(page, input.diagnostic);
  const payuniTraffic = trackPayUniRequests(page, Date.now, settleTiming(dependencies).staleRequestMs);
  const dialogsBeforeSubmit = countPayUniDialogsBeforeSubmit(page);
  const presubmit = input.diagnostic?.presubmit ?? createPayUniPresubmitDiagnostic();
  const origin = fixedOrigin(input.previewHost);
  let stage = "CHECKOUT_REJECTED";
  let paymentPageOpened = false;
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
      if (paymentPageOpened) recordPayUniResourceFailure(input.diagnostic, request);
      try {
        const url = new URL(request.url());
        if (request.isNavigationRequest() && request.method() === "POST" && isPayUniPaymentPageUrl(url)) {
          apiNetworkRejected = true;
          apiNetworkFailure = classifyPayUniApiNetworkFailure(request.failure()?.errorText);
        }
      } catch {}
    });
    const [name, value] = input.ownerSessionCookie.split("=", 2);
    if (name !== "__Host-celebrate_session" || !value) return "PAYMENT_REJECTED";
    // F-036: a __Host- cookie must be host-only with Secure and Path=/.
    await context.addCookies([{ name, value, domain: new URL(origin).hostname, path: "/", httpOnly: true, sameSite: "Lax", secure: true }]);
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
    paymentPageOpened = true;
    await page.goto(PAYUNI_UPP_URL, { waitUntil: "commit", timeout: REQUEST_TIMEOUT_MS });
    await waitForPayUniPageReady(page, presubmit, settleTiming(dependencies).pageLoadMs);
    stage = "PAYMENT_METHOD_UNAVAILABLE";
    await selectPayUniOneTimeCredit(page, input.diagnostic);
    stage = "PAYMENT_FIELDS_REJECTED";
    const filled = await fillPayUniCardFields(page, input, "wp4-subscription-v1@invalid.example", dependencies.payuniFallbackWaitMs, settleTiming(dependencies).typeDelayMs);
    const submitButton = page.getByRole("button", { name: "確認送出", exact: true });
    // Settled before the submission is marked: an unsettled page is never submitted.
    markPayUniBrowserStep(input.diagnostic, "PRESUBMIT");
    if (await settlePayUniBeforeSubmit({ filled, submit: submitButton, tracker: payuniTraffic, dialogs: dialogsBeforeSubmit,
      confirmation: page.getByRole("button", { name: "確定", exact: true }), presubmit, timing: settleTiming(dependencies) }) !== "SETTLED") {
      throw new Error("PAYMENT_FIELDS_UNSETTLED");
    }
    stage = "PAYMENT_SUBMIT_REJECTED";
    if (input.markPaymentSubmission?.() !== true) return "PAYMENT_SUBMIT_REJECTED";
    markPayUniBrowserStep(input.diagnostic, "SUBMIT");
    dialogsBeforeSubmit.markSubmitted();
    await submitButton.click();
    const confirmation = page.getByRole("button", { name: "確定", exact: true });
    try {
      await confirmation.waitFor({ state: "visible", timeout: 5_000 });
      // Same dismiss-only handling: read the modal into a fixed category, never click it.
      let confirmationText = "";
      try {
        confirmationText = await confirmation.evaluate((button) =>
          button.closest('[role="dialog"], .modal, .swal2-popup')?.innerText?.slice(0, 4097) ?? "");
      } catch { /* Unreadable modal stays OTHER. */ }
      recordPayUniSubmitModal(input.diagnostic, confirmationText);
      recordPayUniDialogCapture(input.diagnostic?.dialogTexts, await capturePayUniConfirmationDialog(confirmation));
      await capturePayUniSubmitDiagnostic(page, input.diagnostic, input.previewHost);
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
  } catch (error) {
    await recordPayUniBrowserFailure(page, input.diagnostic, error, input.previewHost);
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
  return runBuyerPayment(input, dependencies, false);
}

/** A distinct trusted entry point stops after the paid order and replay proof; never refunds. */
export async function runMvpPayUniPaymentOnly(input, dependencies = {}) {
  return runBuyerPayment(input, dependencies, true);
}

async function runBuyerPayment(input, dependencies, paymentOnly) {
  const invocation = validateInvocation(input);
  const receipt = createReceipt(invocation.ok ? invocation.sourceSha : "0".repeat(40));
  if (paymentOnly) receipt.schemaVersion = MVP_PAYUNI_PAYMENT_ONLY_SCHEMA;
  if (!invocation.ok) return fail(receipt, invocation.code);
  // The unresolved historical attempt is never eligible for a new browser submission.
  if (paymentOnly && invocation.sourceSha === BUYER_PAYMENT_CHECK_SOURCE_SHA) return fail(receipt, "INPUT_REJECTED");

  const request = dependencies.request ?? defaultRequest;
  const browserSubmit = dependencies.browserSubmit ?? defaultBrowserSubmit;
  const wait = dependencies.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const base = fixedOrigin(operationHostFor(invocation, dependencies));
  const guarded = guardedHeaders(invocation);
  let admission;
  let checkout;

  try {
    receipt.sideEffects.fixturePosts = 1;
    const fixture = responseJson(await request({
      url: fixedUrl(operationHostFor(invocation, dependencies), "/api/admin/ops/payuni/wp4-fixture"),
      headers: guarded,
      body: undefined,
      outcomeHeader: "x-celebratedeal-wp4-fixture",
    }));
    if (!assertFixtureResponse(fixture)) return fail(receipt, fixtureFailure(fixture));
    receipt.checks.fixtureReady = true;

    receipt.sideEffects.admissionPosts = 1;
    admission = responseJson(await request({
      url: fixedUrl(operationHostFor(invocation, dependencies), "/api/payments/checkout/admission"),
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
      url: fixedUrl(operationHostFor(invocation, dependencies), "/api/payments/checkout"),
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
      url: fixedUrl(operationHostFor(invocation, dependencies), "/api/admin/ops/payuni/wp4-payment-attempt"),
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
      // The attested operation host; PayUni returns to NEXT_PUBLIC_APP_URL, which is this alias on staging.
      previewHost: operationHostFor(invocation, dependencies),
      cardNumber: invocation.cardNumber,
      cardExpiry: invocation.cardExpiry,
      cardCvv: invocation.cardCvv,
      formPayload: checkout.body.formPayload,
      supportCookie: checkout.supportCookie,
      orderNumber: checkout.body.orderNumber,
      transactionId: checkout.body.transactionId,
      captureReturnCallback: true,
      diagnostic: dependencies.browserDiagnostic,
    });
    if (!validSignedReturnCapture(callbackMapped)) {
      const browserFailure = typeof callbackMapped === "string" && FAILURE_CODES.has(callbackMapped)
        ? callbackMapped
        : callbackMapped === false ? "RETURN_CALLBACK_UNMAPPED" : "RETURN_CALLBACK_PROOF_REQUIRED";
      return fail(receipt, browserFailure);
    }
    receipt.sideEffects.payments = 1;
    receipt.checks.payuniFormAccepted = true;
    receipt.checks.returnCallbackMapped = true;

    receipt.sideEffects.orderProofPosts = 1;
    const firstProof = responseJson(await request({
      url: fixedUrl(operationHostFor(invocation, dependencies), "/api/admin/ops/payuni/wp4-buyer-order-proof"),
      headers: guarded, body: undefined,
    }));
    if (!validBuyerOrderProof(firstProof)) return fail(receipt, "ORDER_PROOF_REJECTED");
    receipt.checks.orderPersisted = true;

    // Replay exactly the captured signed Return body once against the fixed Notify route.
    // A caller cannot choose the callback URL, event, amount or payload.
    receipt.sideEffects.callbackReplays = 1;
    const duplicate = responseJson(await request({
      url: fixedUrl(operationHostFor(invocation, dependencies), "/api/webhooks/payments?provider=payuni&source=notify"),
      headers: { "content-type": callbackMapped.contentType },
      body: callbackMapped.signedReturnBody,
    }));
    if (!validDuplicateAcknowledgement(duplicate)) return fail(receipt, "CALLBACK_REPLAY_REJECTED");

    receipt.sideEffects.orderProofPosts = 2;
    const afterReplay = responseJson(await request({
      url: fixedUrl(operationHostFor(invocation, dependencies), "/api/admin/ops/payuni/wp4-buyer-order-proof"),
      headers: guarded, body: undefined,
    }));
    if (!validBuyerOrderProof(afterReplay)
      || JSON.stringify(firstProof.body) !== JSON.stringify(afterReplay.body)) {
      return fail(receipt, "DUPLICATE_PROOF_REJECTED");
    }
    receipt.checks.duplicateCallbackVerified = true;

    if (paymentOnly) {
      receipt.result = "PASS";
      receipt.failure = "NONE";
      return validatePaymentOnlyReceipt(receipt).ok ? receipt : fail(receipt, "INTERNAL_REJECTED");
    }

    receipt.sideEffects.refundPosts = 1;
    const refund = responseJson(await request({
      url: fixedUrl(operationHostFor(invocation, dependencies), "/api/admin/ops/payuni/wp4-refund"),
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
        url: fixedUrl(operationHostFor(invocation, dependencies), "/api/admin/ops/payuni/wp4-reconcile"),
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

  return paymentOnly
    ? (validatePaymentOnlyReceipt(receipt).ok ? receipt : fail(receipt, "INTERNAL_REJECTED"))
    : finalizeMvpPayUniReceipt(receipt);
}

function assertSubscriptionSessionResponse(response) {
  return response?.status === 204
    && typeof response.sessionCookie === "string"
    && response.sessionCookie.startsWith("__Host-celebrate_session=")
    && response.sessionCookie.length > "__Host-celebrate_session=".length;
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

export function fixedBrowserEnvironment() {
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
      url: fixedUrl(operationHostFor(invocation, dependencies), "/api/admin/ops/payuni/wp4-fixture"),
      headers: guarded,
      body: undefined,
      outcomeHeader: "x-celebratedeal-wp4-fixture",
    }));
    if (!assertSubscriptionFixtureResponse(fixture)) return fail(receipt, fixtureFailure(fixture));
    receipt.checks.fixtureReady = true;

    receipt.sideEffects.sessionPosts = 1;
    const session = await request({
      url: fixedUrl(operationHostFor(invocation, dependencies), "/api/admin/ops/payuni/wp4-session"),
      headers: guarded,
      body: undefined,
      cookiePrefix: "__Host-celebrate_session=",
    });
    if (!assertSubscriptionSessionResponse(session)) return fail(receipt, "CHECKOUT_REJECTED");
    receipt.checks.ownerSessionIssued = true;

    receipt.sideEffects.planSelections = 1;
    const callbackMapped = await browserSubmit({
      // The attested operation host; PayUni returns to NEXT_PUBLIC_APP_URL, which is this alias on staging.
      previewHost: operationHostFor(invocation, dependencies),
      ownerSessionCookie: session.sessionCookie,
      cardNumber: invocation.cardNumber,
      cardExpiry: invocation.cardExpiry,
      cardCvv: invocation.cardCvv,
      diagnostic: dependencies.browserDiagnostic,
      markNativePlanCheckoutCreated: () => {
        if (receipt.checks.nativePlanCheckoutCreated || receipt.sideEffects.transactionsCreated !== 0) return false;
        receipt.checks.nativePlanCheckoutCreated = true;
        receipt.sideEffects.transactionsCreated = 1;
        return true;
      },
      reservePaymentAttempt: async () => {
        receipt.sideEffects.paymentAttemptPosts = 1;
        const paymentAttempt = responseJson(await request({
          url: fixedUrl(operationHostFor(invocation, dependencies), "/api/admin/ops/payuni/wp4-subscription-payment-attempt"),
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
      url: fixedUrl(operationHostFor(invocation, dependencies), "/api/admin/ops/payuni/wp4-subscription-state"),
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
      url: fixedUrl(operationHostFor(invocation, dependencies), "/api/admin/ops/payuni/wp4-subscription-refund"),
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
        url: fixedUrl(operationHostFor(invocation, dependencies), "/api/admin/ops/payuni/wp4-subscription-reconcile"),
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
      url: fixedUrl(operationHostFor(invocation, dependencies), "/api/admin/ops/payuni/wp4-subscription-state"),
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

const BUYER_CONTINUATION_FAILURES = new Set(["NONE", "INPUT_REJECTED", "NETWORK_REJECTED", "RESPONSE_INVALID", "STATE_REJECTED", "REFUND_REJECTED", "RECONCILE_REJECTED", "REFUNDED_STATE_REJECTED", "INTERNAL_REJECTED"]);
function createBuyerContinuationReceipt(sourceSha = "0".repeat(40)) {
  return {
    schemaVersion: MVP_PAYUNI_BUYER_CONTINUATION_SCHEMA,
    purpose: FIXED_PURPOSE,
    sourceSha: SOURCE_SHA.test(sourceSha) ? sourceSha : "0".repeat(40),
    transactionSourceSha: BUYER_CONTINUATION_TRANSACTION_SOURCE_SHA,
    environment: FIXED_PAYUNI_ENV,
    result: "BLOCKED",
    failure: "INPUT_REJECTED",
    checks: { stateVerified: false, refundAttempted: false, reconciled: false, refundedStateVerified: false },
    sideEffects: { statePosts: 0, refundPosts: 0, reconcilePosts: 0, queryAttempts: 0, paymentSubmissions: 0, providerRefundSubmissions: 0 },
    safety: { sanitized: true, envFilesRead: false, envEnumerated: false, rawLogsPersisted: false, rawIdentifiersPersisted: false, rawUrlsPersisted: false, secretsPersisted: false, arbitraryInputAccepted: false, sideEffectBudgetExceeded: false },
  };
}

function validBuyerContinuationState(body, refunded) {
  return body && exactKeys(body, ["status", "paymentStatus", "orderPaid", "inventoryCommitted", "notificationQueued", "refundReconciled"])
    && body.status === "VERIFIED"
    && body.paymentStatus === (refunded ? "REFUNDED" : "PAID")
    && body.orderPaid === true && body.inventoryCommitted === true && body.notificationQueued === true
    && body.refundReconciled === refunded;
}

export function validateBuyerContinuationReceipt(receipt) {
  const errors = [];
  if (!exactKeys(receipt, ["schemaVersion", "purpose", "sourceSha", "transactionSourceSha", "environment", "result", "failure", "checks", "sideEffects", "safety"]) || !exactKeys(receipt?.checks, ["stateVerified", "refundAttempted", "reconciled", "refundedStateVerified"])
    || !exactKeys(receipt?.sideEffects, ["statePosts", "refundPosts", "reconcilePosts", "queryAttempts", "paymentSubmissions", "providerRefundSubmissions"])
    || !exactKeys(receipt?.safety, SAFETY_KEYS)) errors.push("SCHEMA_KEYS");
  if (errors.length) return { ok: false, errors };
  if (receipt?.schemaVersion !== MVP_PAYUNI_BUYER_CONTINUATION_SCHEMA || receipt?.purpose !== FIXED_PURPOSE || receipt?.environment !== FIXED_PAYUNI_ENV
    || !SOURCE_SHA.test(receipt?.sourceSha ?? "") || receipt?.transactionSourceSha !== BUYER_CONTINUATION_TRANSACTION_SOURCE_SHA) errors.push("FIXED_IDENTITY");
  if (!BUYER_CONTINUATION_FAILURES.has(receipt?.failure) || !["PASS", "BLOCKED"].includes(receipt?.result)) errors.push("RESULT");
  if (!["PASS", "BLOCKED"].includes(receipt?.result) || !Object.values(receipt?.checks ?? {}).every((value) => typeof value === "boolean")) errors.push("CHECK_VALUES");
  const effects = receipt?.sideEffects;
  if (!boundedInteger(effects?.statePosts, 2) || !boundedInteger(effects?.refundPosts, 1) || !boundedInteger(effects?.reconcilePosts, 12) || !boundedInteger(effects?.queryAttempts, 12)
    || effects?.paymentSubmissions !== 0 || !boundedInteger(effects?.providerRefundSubmissions, 1)) errors.push("SIDE_EFFECT_BUDGET");
  if (effects?.queryAttempts !== effects?.reconcilePosts || effects?.providerRefundSubmissions > effects?.refundPosts || receipt?.safety?.sideEffectBudgetExceeded !== false) errors.push("COUNTER_SEQUENCE");
  if (receipt?.safety?.sanitized !== true || !allFalse(receipt?.safety, SAFETY_KEYS.filter((key) => key !== "sanitized" && key !== "sideEffectBudgetExceeded"))) errors.push("SANITIZATION");
  if (receipt?.checks?.stateVerified && effects?.statePosts < 1) errors.push("STATE_SEQUENCE");
  if (effects?.refundPosts > 0 && !receipt.checks.stateVerified) errors.push("REFUND_SEQUENCE");
  if (receipt?.checks?.refundAttempted && (!receipt.checks.stateVerified || effects?.refundPosts !== 1 || effects?.providerRefundSubmissions !== 1)) errors.push("REFUND_SEQUENCE");
  if (effects?.reconcilePosts > 0 && !receipt.checks.refundAttempted) errors.push("RECONCILE_SEQUENCE");
  if (receipt?.checks?.reconciled && (!receipt.checks.refundAttempted || effects?.reconcilePosts < 1)) errors.push("RECONCILE_SEQUENCE");
  if (receipt?.checks?.refundedStateVerified && (!receipt.checks.reconciled || effects?.statePosts !== 2)) errors.push("FINAL_STATE_SEQUENCE");
  if (effects?.statePosts === 2 && !receipt?.checks?.reconciled) errors.push("FINAL_STATE_SEQUENCE");
  if (receipt?.result === "PASS" && (!Object.values(receipt.checks).every(Boolean) || receipt.failure !== "NONE" || effects?.paymentSubmissions !== 0 || effects?.queryAttempts !== effects?.reconcilePosts)) errors.push("PASS_COMPLETENESS");
  if (receipt?.result === "BLOCKED" && (receipt.failure === "NONE" || Object.values(receipt.checks).every(Boolean))) errors.push("BLOCKED_COMPLETENESS");
  return { ok: errors.length === 0, errors };
}

export async function runMvpPayUniBuyerExistingContinuation(input, dependencies = {}) {
  const invocation = validateExistingRefundRecoveryInvocation(input);
  const receipt = createBuyerContinuationReceipt(invocation.ok ? invocation.sourceSha : "0".repeat(40));
  if (!invocation.ok) return receipt;
  const request = dependencies.request ?? defaultRequest;
  const wait = dependencies.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const headers = guardedHeaders(invocation);
  const get = async (path) => responseJson(await request({ url: fixedUrl(operationHostFor(invocation, dependencies), path), headers, body: undefined }));
  try {
    receipt.sideEffects.statePosts = 1;
    const initial = await get("/api/admin/ops/payuni/wp4-buyer-existing-state");
    if (initial.status !== 200 || !validBuyerContinuationState(initial.body, false)) return fail(receipt, "STATE_REJECTED");
    receipt.checks.stateVerified = true;
    receipt.sideEffects.refundPosts = 1;
    receipt.sideEffects.providerRefundSubmissions = 1;
    const refund = await get("/api/admin/ops/payuni/wp4-buyer-existing-refund");
    if (refund.status !== 200 || !exactKeys(refund.body, ["status", "providerWriteAttempted"]) || !["COMPLETED", "RECONCILIATION_REQUIRED"].includes(refund.body.status) || refund.body.providerWriteAttempted !== true) return fail(receipt, "REFUND_REJECTED");
    receipt.checks.refundAttempted = true;
    let reconciled = false;
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      receipt.sideEffects.reconcilePosts = attempt;
      receipt.sideEffects.queryAttempts = attempt;
      const reconciliation = await get("/api/admin/ops/payuni/wp4-buyer-existing-reconcile");
      if (reconciliation.status === 200 && exactKeys(reconciliation.body, ["status", "reconciled"]) && reconciliation.body.status === "RECONCILED" && reconciliation.body.reconciled === true) { reconciled = true; break; }
      if (reconciliation.status !== 200 || !exactKeys(reconciliation.body, ["status", "reconciled"]) || reconciliation.body.status !== "REFUND_NOT_CONFIRMED" || reconciliation.body.reconciled !== false) return fail(receipt, "RECONCILE_REJECTED");
      if (attempt === 12) return fail(receipt, "RECONCILE_REJECTED");
      await wait(10_000);
    }
    if (!reconciled) return fail(receipt, "RECONCILE_REJECTED");
    receipt.checks.reconciled = true;
    receipt.sideEffects.statePosts = 2;
    const finalState = await get("/api/admin/ops/payuni/wp4-buyer-existing-state");
    if (finalState.status !== 200 || !validBuyerContinuationState(finalState.body, true)) return fail(receipt, "REFUNDED_STATE_REJECTED");
    receipt.checks.refundedStateVerified = true;
    receipt.result = "PASS";
    receipt.failure = "NONE";
  } catch {
    fail(receipt, "NETWORK_REJECTED");
  }
  return validateBuyerContinuationReceipt(receipt).ok ? receipt : fail(receipt, "INTERNAL_REJECTED");
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

export async function writePaymentOnlyReceipt(receipt, runnerTemp) {
  if (!validatePaymentOnlyReceipt(receipt).ok) throw new Error("RECEIPT_INVALID");
  return writeFixedReceipt(receipt, runnerTemp, PAYMENT_ONLY_RECEIPT_FILENAME);
}

export async function validateWrittenPaymentOnlyReceipt(runnerTemp) {
  try {
    const { receiptPath } = fixedReceiptPath(runnerTemp, PAYMENT_ONLY_RECEIPT_FILENAME);
    return validatePaymentOnlyReceipt(JSON.parse(await readFile(receiptPath, "utf8"))).ok;
  } catch { return false; }
}

export async function writeBuyerPaymentCheckReceipt(receipt, runnerTemp) {
  if (!validateBuyerPaymentCheckReceipt(receipt).ok) throw new Error("RECEIPT_INVALID");
  return writeFixedReceipt(receipt, runnerTemp, BUYER_PAYMENT_CHECK_FILE);
}

export async function writeBuyerCallbackRetryReceipt(receipt, runnerTemp) {
  if (!validateBuyerCallbackRetryReceipt(receipt).ok) throw new Error("RECEIPT_INVALID");
  return writeFixedReceipt(receipt, runnerTemp, BUYER_CALLBACK_RETRY_FILE);
}

export async function validateWrittenBuyerCallbackRetryReceipt(runnerTemp) {
  try {
    const { receiptPath } = fixedReceiptPath(runnerTemp, BUYER_CALLBACK_RETRY_FILE);
    return validateBuyerCallbackRetryReceipt(JSON.parse(await readFile(receiptPath, "utf8"))).ok;
  } catch { return false; }
}

export async function validateWrittenBuyerPaymentCheckReceipt(runnerTemp) {
  try {
    const { receiptPath } = fixedReceiptPath(runnerTemp, BUYER_PAYMENT_CHECK_FILE);
    return validateBuyerPaymentCheckReceipt(JSON.parse(await readFile(receiptPath, "utf8"))).ok;
  } catch { return false; }
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

export async function writeBuyerExistingContinuationReceipt(receipt, runnerTemp) {
  if (!validateBuyerContinuationReceipt(receipt).ok) throw new Error("RECEIPT_INVALID");
  return writeFixedReceipt(receipt, runnerTemp, BUYER_CONTINUATION_RECEIPT_FILENAME);
}

export async function validateWrittenBuyerExistingContinuationReceipt(runnerTemp) {
  try {
    const { receiptPath } = fixedReceiptPath(runnerTemp, BUYER_CONTINUATION_RECEIPT_FILENAME);
    return validateBuyerContinuationReceipt(JSON.parse(await readFile(receiptPath, "utf8"))).ok;
  } catch { return false; }
}

/**
 * Every secret-bearing CLI flow re-attests the alias first. A failed attestation
 * writes no receipt and performs no application request: the job stays BLOCKED.
 */
async function attestedFlowDependencies(input) {
  const attestation = await attestOperationHost(input);
  if (attestation.ok) return { operationHost: attestation.operationHost, browserDiagnostic: createPayUniBrowserDiagnostic() };
  process.stdout.write(`mvp_payuni_alias_attestation=BLOCKED; reason=${attestation.code}\n`);
  process.exitCode = 2;
  return null;
}

/** Prints the de-identified PayUni page diagnostic only when a browser step failed. */
function printBrowserDiagnostic(flowDependencies, result) {
  const diagnostic = flowDependencies?.browserDiagnostic;
  if (!diagnostic) return;
  /** One line per diagnostic; a formatter that throws prints a fixed FORMAT_FAILED code instead of nothing. */
  const emit = (name, format) => {
    let line;
    try { line = format(); } catch { line = JSON.stringify({ status: "FORMAT_FAILED" }); }
    if (line) process.stdout.write(`wp4_payuni_${name}=${line}\n`);
  };
  // The pre-submit state is printed on a pass too, so passing and stopped runs can be compared.
  if (diagnostic.presubmit && diagnostic.presubmit.pageLoad !== "NOT_RUN") emit("presubmit", () => formatPayUniPresubmitDiagnostic(diagnostic.presubmit));
  if (result === "PASS" || (diagnostic.step === "NONE" && diagnostic.error === "NONE")) return;
  emit("browser_diagnostic", () => formatPayUniBrowserDiagnostic(diagnostic));
  emit("page_structure", () => formatPayUniPageStructure(diagnostic));
  emit("submit_diagnostic", () => formatPayUniSubmitDiagnostic(diagnostic));
  emit("dialog_text", () => formatPayUniDialogDiagnostic({ dialogs: diagnostic.dialogTexts, externalHosts: diagnostic.externalHosts }));
  emit("form_fields", () => formatPayUniFormFieldDiagnostic(diagnostic.formFields));
}

/** JSON of the already-sanitized frames, re-sanitized and capped; null when nothing was captured. */
export function formatPayUniPageStructure(diagnostic) {
  if (!Array.isArray(diagnostic?.structure) || diagnostic.structure.length === 0) return null;
  const frames = diagnostic.structure.slice(0, STRUCTURE_MAX_FRAMES).map((frame) => sanitizePayUniPageStructure(frame, frame?.frame));
  return JSON.stringify(frames);
}

async function main() {
  const runnerTemp = process.env.RUNNER_TEMP;
  if (process.argv.length === 3 && process.argv[2] === "--validate-payment-only-receipt") {
    const valid = await validateWrittenPaymentOnlyReceipt(runnerTemp);
    process.stdout.write(`wp4_payment_only_receipt=${valid ? "PASS" : "BLOCKED"}\n`);
    process.exitCode = valid ? 0 : 2;
    return;
  }
  if (process.argv.length === 3 && process.argv[2] === "--payment-only") {
    const input = readFixedInputs();
    const flowDependencies = await attestedFlowDependencies(input);
    if (!flowDependencies) return;
    const receipt = await runMvpPayUniPaymentOnly(input, flowDependencies);
    await writePaymentOnlyReceipt(receipt, runnerTemp);
    process.stdout.write(`wp4_payment_only=${receipt.result}; failure=${receipt.failure}\n`);
    printBrowserDiagnostic(flowDependencies, receipt.result);
    process.exitCode = receipt.result === "PASS" ? 0 : 2;
    return;
  }
  if (process.argv.length === 3 && process.argv[2] === "--validate-buyer-callback-retry-receipt") {
    const valid = await validateWrittenBuyerCallbackRetryReceipt(runnerTemp);
    process.stdout.write(`wp4_buyer_callback_retry_receipt=${valid ? "PASS" : "BLOCKED"}\n`);
    process.exitCode = valid ? 0 : 2;
    return;
  }
  if (process.argv.length === 3 && process.argv[2] === "--retry-buyer-callback") {
    const input = readExistingRefundRecoveryInputs();
    const flowDependencies = await attestedFlowDependencies(input);
    if (!flowDependencies) return;
    const receipt = await retryFixedWp4BuyerCallback(input, flowDependencies);
    await writeBuyerCallbackRetryReceipt(receipt, runnerTemp);
    process.stdout.write(`wp4_buyer_callback_retry=${receipt.result}; status=${receipt.status}\n`);
    process.exitCode = receipt.result === "PASS" ? 0 : 2;
    return;
  }
  if (process.argv.length === 3 && process.argv[2] === "--validate-buyer-payment-check-receipt") {
    try {
      const valid = await validateWrittenBuyerPaymentCheckReceipt(runnerTemp);
      process.stdout.write(`wp4_buyer_payment_check_receipt=${valid ? "PASS" : "BLOCKED"}\n`);
      process.exitCode = valid ? 0 : 2;
    } catch { process.exitCode = 2; }
    return;
  }
  if (process.argv.length === 3 && process.argv[2] === "--check-buyer-payment") {
    const input = readExistingRefundRecoveryInputs();
    const flowDependencies = await attestedFlowDependencies(input);
    if (!flowDependencies) return;
    const receipt = await checkExistingWp4BuyerPayment(input, flowDependencies);
    if (!validateBuyerPaymentCheckReceipt(receipt).ok) { process.exitCode = 2; return; }
    await writeBuyerPaymentCheckReceipt(receipt, runnerTemp);
    process.stdout.write(`wp4_buyer_payment_check=${receipt.result}; status=${receipt.status}\n`);
    process.exitCode = receipt.result === "PASS" ? 0 : 2;
    return;
  }
  if (process.argv.length === 3 && process.argv[2] === "--verify-lineage") {
    const reason = await diagnoseMvpPayUniLineage();
    const valid = reason === "VERIFIED";
    process.stdout.write(`mvp_payuni_lineage=${valid ? "PASS" : "BLOCKED"}; reason=${reason}\n`);
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
  if (process.argv.length === 3 && process.argv[2] === "--validate-buyer-continuation-receipt") {
    const valid = await validateWrittenBuyerExistingContinuationReceipt(runnerTemp);
    process.stdout.write(`wp4_buyer_existing_continuation_receipt=${valid ? "PASS" : "BLOCKED"}\n`);
    process.exitCode = valid ? 0 : 2;
    return;
  }
  if (process.argv.length === 3 && process.argv[2] === "--continue-existing-buyer") {
    const input = readExistingRefundRecoveryInputs();
    const flowDependencies = await attestedFlowDependencies(input);
    if (!flowDependencies) return;
    const receipt = await runMvpPayUniBuyerExistingContinuation(input, flowDependencies);
    if (!validateBuyerContinuationReceipt(receipt).ok) { process.exitCode = 2; return; }
    await writeBuyerExistingContinuationReceipt(receipt, runnerTemp);
    process.stdout.write(`wp4_buyer_existing_continuation=${receipt.result}; failure=${receipt.failure}\n`);
    process.exitCode = receipt.result === "PASS" ? 0 : 2;
    return;
  }
  if (process.argv.length === 3 && process.argv[2] === "--recover-existing-refund") {
    const input = readExistingRefundRecoveryInputs();
    const flowDependencies = await attestedFlowDependencies(input);
    if (!flowDependencies) return;
    const receipt = await recoverExistingWp4BuyerRefund(input, flowDependencies);
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
    const input = readFixedInputs();
    const flowDependencies = await attestedFlowDependencies(input);
    if (!flowDependencies) return;
    let subscriptionReceipt;
    try {
      subscriptionReceipt = await runMvpPayUniSandboxSubscriptionE2E(input, flowDependencies);
    } catch {
      subscriptionReceipt = fail(createSubscriptionReceipt(), "INTERNAL_REJECTED");
    }
    try {
      await writeMvpPayUniSubscriptionReceipt(subscriptionReceipt, runnerTemp);
      process.stdout.write(`mvp_payuni_subscription=${subscriptionReceipt.result}; failure=${subscriptionReceipt.failure}\n`);
      printBrowserDiagnostic(flowDependencies, subscriptionReceipt.result);
      process.exitCode = subscriptionReceipt.result === "PASS" ? 0 : 2;
    } catch {
      process.stdout.write("mvp_payuni_subscription=BLOCKED\n");
      process.exitCode = 2;
    }
    return;
  }
  let receipt;
  let flowDependencies = null;
  if (process.argv.length !== 2) {
    receipt = fail(createReceipt(), "INPUT_REJECTED");
  } else {
    const input = readFixedInputs();
    flowDependencies = await attestedFlowDependencies(input);
    if (!flowDependencies) return;
    try {
      receipt = await runMvpPayUniSandboxE2E(input, flowDependencies);
    } catch {
      receipt = fail(createReceipt(), "INTERNAL_REJECTED");
    }
  }
  try {
    await writeMvpPayUniReceipt(receipt, runnerTemp);
    // The failure is a fixed receipt enum; it never carries provider text, URLs or identifiers.
    process.stdout.write(`mvp_payuni_sandbox_e2e=${receipt.result}; failure=${receipt.failure}\n`);
    printBrowserDiagnostic(flowDependencies, receipt.result);
    process.exitCode = receipt.result === "PASS" ? 0 : 2;
  } catch {
    process.stdout.write("mvp_payuni_sandbox_e2e=BLOCKED\n");
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { process.exitCode = 2; });
}
