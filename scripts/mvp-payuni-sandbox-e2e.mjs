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
export const FIXED_PAYUNI_ENV = "sandbox";
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
  reconcilePosts: 1,
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
  "PAYMENT_REJECTED",
  "PAYMENT_PAGE_UNREACHED",
  "PAYMENT_FORM_NOT_SUBMITTED",
  "PAYMENT_PROVIDER_HTTP_REJECTED",
  "PAYMENT_PROVIDER_NETWORK_REJECTED",
  "PAYMENT_API_NETWORK_REJECTED",
  "PAYMENT_VENDOR_NETWORK_REJECTED",
  "PAYMENT_REDIRECT_UNOBSERVED",
  "PAYMENT_VENDOR_NAV_UNCOMMITTED",
  "PAYMENT_METHOD_UNAVAILABLE",
  "PAYMENT_FIELDS_REJECTED",
  "PAYMENT_SUBMIT_REJECTED",
  "RETURN_CALLBACK_UNMAPPED",
  "RETURN_RESULT_UNMAPPED",
  "RETURN_CALLBACK_PROOF_REQUIRED",
  "REFUND_REJECTED",
  "RECONCILE_REJECTED",
  "NETWORK_REJECTED",
  "INTERNAL_REJECTED",
]);
const PAYUNI_UPP_URL = "https://sandbox-api.payuni.com.tw/api/upp";
const PAYUNI_PAYMENT_HOST = "sandbox-vendor.payuni.com.tw";
const REQUEST_TIMEOUT_MS = 30_000;
const RECEIPT_DIRECTORY = "celebratedeal-secure-receipts";
const RECEIPT_FILENAME = "wp4-payuni-sandbox-reconciliation-receipt.json";

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
  if (checks.reconciled && (!checks.refundCompleted || effects.reconcilePosts !== 1)) return false;
  if (effects.admissionPosts > 0 && !checks.fixtureReady) return false;
  if (effects.checkoutPosts > 0 && !checks.sameOriginAdmission) return false;
  if (effects.paymentAttemptPosts > 0 && !checks.checkoutCreated) return false;
  if (effects.paymentReservationsCreated > 0 && !checks.paymentAttemptReserved) return false;
  if (effects.browserPaymentSubmissions > 0 && !checks.paymentAttemptReserved) return false;
  if (effects.refundPosts > 0 && !checks.returnCallbackMapped) return false;
  if (effects.reconcilePosts > 0 && !checks.refundCompleted) return false;
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
    const fixedOne = ["fixturePosts", "admissionPosts", "checkoutPosts", "paymentAttemptPosts", "refundPosts", "reconcilePosts", "transactionsCreated", "refunds"];
    const currentExecution = effects.paymentReservationsCreated === 1 && effects.browserPaymentSubmissions === 1 && effects.payments === 1;
    if (fixedOne.some((key) => effects[key] !== 1) || !currentExecution) errors.push("PASS_EFFECTS");
  } else if (receipt?.failure === "NONE" || completed) {
    errors.push("BLOCKED_COMPLETENESS");
  }
  return { ok: errors.length === 0, errors };
}

export const validateReceipt = validateMvpPayUniReceipt;

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
    && response.body.phase === "partial"
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

async function defaultBrowserSubmit(input) {
  const { chromium, errors } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "zh-TW" });
  const page = await context.newPage();
  const origin = fixedOrigin(input.previewHost);
  let stage = "PAYMENT_PAGE_UNREACHED";
  let apiPostSeen = false;
  let apiStatus = null;
  let apiNetworkRejected = false;
  let vendorNetworkRejected = false;
  let vendorRequestSeen = false;
  try {
    page.on("request", (request) => {
      try {
        const url = new URL(request.url());
        if (url.protocol === "https:" && url.hostname === "sandbox-api.payuni.com.tw" && url.pathname === "/api/upp" && request.method() === "POST") apiPostSeen = true;
        if (url.protocol === "https:" && url.hostname === PAYUNI_PAYMENT_HOST) vendorRequestSeen = true;
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
        if (url.hostname === "sandbox-api.payuni.com.tw") apiNetworkRejected = true;
        if (url.hostname === PAYUNI_PAYMENT_HOST) vendorNetworkRejected = true;
      } catch {}
    });
    const [name, value] = input.supportCookie.split("=", 2);
    if (!name?.startsWith("celebrate_support_") || !value) throw new Error("PAYMENT_REJECTED");
    await context.addCookies([{ name, value, url: origin, httpOnly: true, sameSite: "Lax", secure: true }]);
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: REQUEST_TIMEOUT_MS });
    await page.evaluate(({ action, payload }) => {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = action;
      for (const [name, value] of Object.entries(payload)) {
        const field = document.createElement("input");
        field.type = "hidden";
        field.name = name;
        field.value = value;
        form.appendChild(field);
      }
      document.body.appendChild(form);
      // Schedule the native navigation after evaluate has returned. An
      // immediate submit can destroy Playwright's execution context before it
      // can observe the cross-origin payment page.
      window.setTimeout(() => form.submit(), 0);
    }, { action: PAYUNI_UPP_URL, payload: input.formPayload });
    await page.waitForURL((url) => url.protocol === "https:" && url.hostname === PAYUNI_PAYMENT_HOST, {
      // The runner intentionally blocks every non-allowlisted third-party
      // resource.  The PayUni document can therefore be committed before its
      // optional resources let DOMContentLoaded fire.  Field locators below
      // remain the authoritative proof that the payment UI is usable.
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
      await confirmation.click();
      await page.getByRole("button", { name: "確認送出", exact: true }).click();
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
    if (apiNetworkRejected) return "PAYMENT_API_NETWORK_REJECTED";
    if (vendorNetworkRejected) return "PAYMENT_VENDOR_NETWORK_REJECTED";
    if (vendorRequestSeen) return "PAYMENT_VENDOR_NAV_UNCOMMITTED";
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
    if (!assertPaymentAttemptResponse(paymentAttempt)) return fail(receipt, "PAYMENT_ATTEMPT_REJECTED");
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
    if (!assertRefundResponse(refund)) return fail(receipt, "REFUND_REJECTED");
    receipt.checks.refundCompleted = true;
    receipt.sideEffects.refunds = 1;

    receipt.sideEffects.reconcilePosts = 1;
    const reconciliation = responseJson(await request({
      url: fixedUrl(invocation.previewHost, "/api/admin/ops/payuni/wp4-reconcile"),
      headers: guarded,
      body: undefined,
    }));
    if (!assertReconcileResponse(reconciliation)) return fail(receipt, "RECONCILE_REJECTED");
    receipt.checks.reconciled = true;
    receipt.result = "PASS";
    receipt.failure = "NONE";
  } catch (error) {
    fail(receipt, error instanceof Error && error.message === "NETWORK_REJECTED" ? "NETWORK_REJECTED" : "INTERNAL_REJECTED");
  }

  if (!validateMvpPayUniReceipt(receipt).ok) return fail(createReceipt(invocation.sourceSha), "INTERNAL_REJECTED");
  return receipt;
}

export async function writeMvpPayUniReceipt(receipt, runnerTemp) {
  if (typeof runnerTemp !== "string" || runnerTemp.trim().length === 0) throw new Error("RECEIPT_PATH_REJECTED");
  const directory = path.resolve(runnerTemp, RECEIPT_DIRECTORY);
  const receiptPath = path.join(directory, RECEIPT_FILENAME);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return receiptPath;
}

export async function validateWrittenMvpPayUniReceipt(runnerTemp) {
  if (typeof runnerTemp !== "string" || runnerTemp.trim().length === 0) return false;
  try {
    const receiptPath = path.resolve(runnerTemp, RECEIPT_DIRECTORY, RECEIPT_FILENAME);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    return validateMvpPayUniReceipt(receipt).ok;
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
