import { createCipheriv, createDecipheriv, createHash, createHmac, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, errors } from "playwright";

const SCHEMA = "celebratedeal-payuni-sandbox-qa/v1";
const KNOWN_PRODUCTION_APP_HOST = "celebratedeal.carry-digital-nomad.in.net";
const PAYUNI_HOST = "sandbox-api.payuni.com.tw";
const PAYUNI_API_ORIGIN = `https://${PAYUNI_HOST}`;
const DEFAULT_LIVE_PATH = "/live/summer-glow-live";
const CALLBACK_TIMEOUT_ERROR_MAX_LENGTH = 280;
const CALLBACK_QUERY_ATTEMPTS = 3;
const CALLBACK_QUERY_INTERVAL_MS = 1_000;
const CALLBACK_QUERY_TIMEOUT_MS = 5_000;
const CALLBACK_RECONCILIATION_MAX_WAIT_MS = (
  (CALLBACK_QUERY_ATTEMPTS * CALLBACK_QUERY_TIMEOUT_MS)
  + ((CALLBACK_QUERY_ATTEMPTS - 1) * CALLBACK_QUERY_INTERVAL_MS)
);
const PAYUNI_TRADE_STATUSES = new Set(["0", "1"]);
// These values are deliberately small allowlists.  PayUni's Message and the
// rest of a response can contain merchant or payment data, so they must never
// become part of the external-QA receipt.
const PROVIDER_DIAGNOSTIC_JSON_TYPES = new Set(["absent", "null", "string", "number", "boolean", "array", "object"]);
const PROVIDER_DIAGNOSTIC_LENGTH_BUCKETS = new Set(["absent", "0", "1-8", "9-32", "33-128", "129-512", "513+"]);
const PROVIDER_DIAGNOSTIC_REFERENCE = /^hmac-sha256:[a-f0-9]{16}$/;
const PROVIDER_DISPOSITIONS = new Set([
  "terminal-authentication",
  "terminal-invalid-request",
  "retryable-not-found",
  "retryable-processing",
  "retryable-provider",
  "unknown",
]);
const PROVIDER_MESSAGE_CATEGORIES = new Set([
  "merchant-configuration",
  "request-cryptography",
  "request-validation",
  "transaction-not-found",
  "provider-temporary",
  "unavailable",
]);
// Exact codes from PayUni's official trade-query v2 and common API error
// tables. Message is untrusted diagnostic data and never selects retry
// behaviour or enters the receipt as plaintext.
const PAYUNI_DOCUMENTED_STATUS_DISPOSITIONS = Object.freeze({
  QUERY01001: "terminal-invalid-request",
  QUERY01002: "terminal-authentication",
  QUERY01003: "terminal-invalid-request",
  QUERY01004: "terminal-invalid-request",
  QUERY01005: "terminal-authentication",
  QUERY01006: "retryable-provider",
  QUERY02001: "terminal-invalid-request",
  QUERY02002: "terminal-invalid-request",
  QUERY02003: "terminal-invalid-request",
  QUERY02004: "terminal-invalid-request",
  QUERY02005: "terminal-invalid-request",
  QUERY02006: "terminal-invalid-request",
  QUERY02007: "terminal-invalid-request",
  QUERY02008: "terminal-invalid-request",
  QUERY02009: "terminal-invalid-request",
  QUERY02010: "terminal-invalid-request",
  QUERY02011: "terminal-invalid-request",
  QUERY02012: "terminal-invalid-request",
  QUERY02013: "terminal-invalid-request",
  QUERY03001: "retryable-not-found",
  QUERY04001: "retryable-provider",
  QUERY04002: "retryable-provider",
  API00008: "retryable-provider",
  API00009: "retryable-processing",
  DEF01005: "terminal-authentication",
  DEF01006: "terminal-authentication",
  DEF01007: "terminal-authentication",
});
const PAYUNI_DOCUMENTED_MESSAGE_CATEGORIES = Object.freeze({
  QUERY01001: "merchant-configuration",
  QUERY01002: "request-cryptography",
  QUERY01003: "request-cryptography",
  QUERY01004: "request-validation",
  QUERY01005: "merchant-configuration",
  QUERY01006: "provider-temporary",
  QUERY02001: "merchant-configuration",
  QUERY02002: "request-validation",
  QUERY02003: "request-validation",
  QUERY02004: "request-validation",
  QUERY02005: "request-validation",
  QUERY02006: "request-validation",
  QUERY02007: "request-validation",
  QUERY02008: "request-validation",
  QUERY02009: "request-validation",
  QUERY02010: "request-validation",
  QUERY02011: "request-validation",
  QUERY02012: "request-validation",
  QUERY02013: "request-validation",
  QUERY03001: "transaction-not-found",
  QUERY04001: "provider-temporary",
  QUERY04002: "provider-temporary",
  API00008: "provider-temporary",
  API00009: "provider-temporary",
  DEF01005: "merchant-configuration",
  DEF01006: "merchant-configuration",
  DEF01007: "request-cryptography",
});
const PAYUNI_PROVIDER_DISPOSITION_TABLES = Object.freeze({
  status: PAYUNI_DOCUMENTED_STATUS_DISPOSITIONS,
  // PayUni documents these values in Status. If a compatible envelope also
  // supplies one as ErrorCode, it may be disclosed only through this same
  // closed official set.
  errorCode: PAYUNI_DOCUMENTED_STATUS_DISPOSITIONS,
});
const PROVIDER_DIAGNOSTIC_DISPOSITIONS = new WeakMap();
const PAYUNI_FAILURE_DISPOSITIONS = new WeakMap();
const CALLBACK_RECEIPT_DISPOSITIONS = new WeakMap();
// Successful query rows are needed only for the in-process timeout cleanup.
// Keep them out of reconciliation results and Error own-properties, both of
// which may be serialized by the QA orchestrator.
const RECONCILIATION_PAID_TRANSACTIONS = new WeakMap();
const CALLBACK_TIMEOUT_CLEANUP = new WeakMap();
const FLOW_STAGES = new Set([
  "opening-live-page",
  "submitting-checkout",
  "waiting-payuni-checkout",
  "filling-payment-form",
  "submitting-payment",
  "waiting-confirmation-dialog",
  "confirming-payment",
  "waiting-payment-callback",
  "verifying-payment-callback",
]);
const CALLBACK_QUERY_FAILURES = new Map([
  ["query-timeout", "bounded-timeout"],
  ["request-configuration", "configuration"],
  ["network-request", "network"],
  ["http-response", "http"],
  ["response-envelope", "response-envelope"],
  ["signature-decryption", "signature-decryption"],
  ["provider-result", "provider-rejection"],
  ["order-validation", "order-mismatch"],
  ["unknown", "unknown"],
]);
const STRUCTURAL_VISIBILITY = new Set(["visible", "not-visible", "unavailable"]);

function env(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactHttpsHost(rawUrl, expectedHost, label) {
  const url = new URL(rawUrl);
  assert(url.protocol === "https:" && url.hostname === expectedHost, `${label} 必須使用核准的 HTTPS 網域。`);
  return url;
}

function resolvePayUniStagingAppUrl(source = process.env) {
  const rawUrl = String(source.PAYUNI_TEST_APP_URL ?? "").trim();
  const allowedHost = String(source.PAYUNI_STAGING_ALLOWED_HOST ?? "").trim().toLowerCase();
  const productionHost = String(
    source.PAYUNI_PRODUCTION_APP_HOST ?? KNOWN_PRODUCTION_APP_HOST,
  ).trim().toLowerCase();

  assert(rawUrl, "PAYUNI_TEST_APP_URL 必須明確指定 Staging HTTPS 網址。");
  assert(allowedHost, "PAYUNI_STAGING_ALLOWED_HOST 必須明確指定核准的 Staging host。");

  const url = new URL(rawUrl);
  assert(
    url.protocol === "https:" && !url.username && !url.password && !url.port,
    "CelebrateDeal Staging 必須使用無憑證、無自訂連接埠的 HTTPS 網址。",
  );
  assert(url.hostname.toLowerCase() === allowedHost, "PAYUNI_TEST_APP_URL 不在核准的 Staging host 白名單。 ");
  assert(url.hostname.toLowerCase() !== productionHost, "PayUni Sandbox QA 禁止使用 Production host。");
  return url.origin;
}

function vercelProtectionBypassCookieUrl(appUrl, source = process.env) {
  const bypassSecret = String(source.VERCEL_AUTOMATION_BYPASS_SECRET ?? "").trim();
  if (!bypassSecret) return null;

  const url = new URL("/", appUrl);
  url.searchParams.set("x-vercel-protection-bypass", bypassSecret);
  url.searchParams.set("x-vercel-set-bypass-cookie", "true");
  return url.toString();
}

async function installVercelProtectionBypassCookie(page, appUrl) {
  const bypassUrl = vercelProtectionBypassCookieUrl(appUrl);
  if (!bypassUrl) return;

  await page.goto(bypassUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
}

function reference(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function truncate(value, maximumLength) {
  const text = String(value ?? "").trim();
  return text.length <= maximumLength ? text : `${text.slice(0, maximumLength - 1)}…`;
}

function safeHttpsHostPath(rawUrl) {
  try {
    const source = typeof rawUrl === "string" ? rawUrl : "";
    const fixedOriginPath = `https://${PAYUNI_HOST}/api/upp`;
    const url = new URL(source);
    if (
      url.protocol !== "https:"
      || url.hostname !== PAYUNI_HOST
      || url.port !== ""
      || url.pathname !== "/api/upp"
      || url.username
      || url.password
      // URL normalisation hides an explicitly supplied default port. Require
      // the literal approved origin/path prefix so the host and port are the
      // single fixed sandbox endpoint, while still allowing query/fragment.
      || !source.startsWith(fixedOriginPath)
      || !["", "?", "#"].includes(source.slice(fixedOriginPath.length, fixedOriginPath.length + 1))
    ) return "unavailable";
    // Query and fragment are intentionally ignored: provider data in either
    // must never be represented in a receipt.
    return "sandbox-api.payuni.com.tw/api/upp";
  } catch {
    return "unavailable";
  }
}

function safePageHttpsHostPath(page) {
  try {
    return safeHttpsHostPath(page?.url?.());
  } catch {
    return "unavailable";
  }
}

function safeDiagnosticToken(value) {
  const token = String(value ?? "").trim();
  return FLOW_STAGES.has(token) ? token : "unavailable";
}

function safeTradeStatus(value) {
  const status = String(value ?? "").trim();
  return PAYUNI_TRADE_STATUSES.has(status) ? status : "unavailable";
}

function safeHttpStatus(value) {
  return Number.isInteger(value) ? value : null;
}

function diagnosticHashKey() {
  const key = env("PAYUNI_HASH_KEY");
  return Buffer.byteLength(key) === 32 ? key : null;
}

function diagnosticJsonType(value) {
  if (value === undefined) return "absent";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return typeof value;
  return "object";
}

function diagnosticValueText(value) {
  if (typeof value === "string") return value;
  try {
    const text = JSON.stringify(value);
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

function diagnosticLengthBucket(value) {
  const text = diagnosticValueText(value);
  if (text === null) return "513+";
  const length = text.length;
  if (length === 0) return "0";
  if (length <= 8) return "1-8";
  if (length <= 32) return "9-32";
  if (length <= 128) return "33-128";
  return length <= 512 ? "129-512" : "513+";
}

function diagnosticReference(value, purpose) {
  const key = diagnosticHashKey();
  const text = diagnosticValueText(value);
  if (!key || text === null) return undefined;
  // The field-specific separator prevents one field's reference from being
  // compared as if it were another field's value.
  return `hmac-sha256:${createHmac("sha256", key)
    .update(`celebratedeal-payuni-sandbox-qa/v1/${purpose}\u0000${text}`)
    .digest("hex")
    .slice(0, 16)}`;
}

function documentedProviderCode(value) {
  return typeof value === "string" && Object.hasOwn(PAYUNI_DOCUMENTED_STATUS_DISPOSITIONS, value)
    ? value
    : "unavailable";
}

function providerMessageCategory(status, errorCode) {
  const code = documentedProviderCode(errorCode) !== "unavailable"
    ? errorCode
    : status;
  const category = typeof code === "string" ? PAYUNI_DOCUMENTED_MESSAGE_CATEGORIES[code] : undefined;
  return PROVIDER_MESSAGE_CATEGORIES.has(category) ? category : "unavailable";
}

function providerValueDiagnostic(value, purpose) {
  const jsonType = diagnosticJsonType(value);
  const reference = jsonType === "absent" ? undefined : diagnosticReference(value, purpose);
  return {
    valuePresent: jsonType !== "absent",
    code: documentedProviderCode(value),
    jsonType,
    lengthBucket: jsonType === "absent" ? "absent" : diagnosticLengthBucket(value),
    ...(reference ? { reference } : {}),
  };
}

function providerMessageDiagnostic(value, category) {
  const diagnostic = providerValueDiagnostic(value, "provider-message");
  return {
    category: PROVIDER_MESSAGE_CATEGORIES.has(category) ? category : "unavailable",
    jsonType: diagnostic.jsonType,
    lengthBucket: diagnostic.lengthBucket,
    ...(diagnostic.reference ? { reference: diagnostic.reference } : {}),
  };
}

function providerResultValue(result) {
  if (typeof result !== "string") return result;
  try {
    return JSON.parse(result);
  } catch {
    const parsed = Object.fromEntries(new URLSearchParams(result));
    return Object.keys(parsed).length > 0 ? parsed : null;
  }
}

function exactProviderDisposition(status, errorCode) {
  if (typeof errorCode === "string" && Object.hasOwn(PAYUNI_PROVIDER_DISPOSITION_TABLES.errorCode, errorCode)) {
    return PAYUNI_PROVIDER_DISPOSITION_TABLES.errorCode[errorCode];
  }
  if (typeof status === "string" && Object.hasOwn(PAYUNI_PROVIDER_DISPOSITION_TABLES.status, status)) {
    return PAYUNI_PROVIDER_DISPOSITION_TABLES.status[status];
  }
  return "unknown";
}

function safeProviderDisposition(value) {
  return PROVIDER_DISPOSITIONS.has(value) ? value : "unknown";
}

function providerResultDiagnostic(response) {
  const result = response?.Result;
  const parsedResult = providerResultValue(result);
  const resultRow = Array.isArray(parsedResult) ? parsedResult[0] : parsedResult;
  // PayUni's trade-query envelope names these fields Status and ErrorCode.
  // Do not treat similarly named Result fields (or Code/StatusCode/RespondCode
  // aliases from other namespaces) as an ErrorCode: a matching string there
  // must not change retry behaviour or cause an early terminal stop.
  const errorCode = response?.ErrorCode;
  const message = response?.Message ?? resultRow?.Message;
  const diagnostic = {
    providerDisposition: exactProviderDisposition(response?.Status, errorCode),
    providerStatus: providerValueDiagnostic(response?.Status, "provider-status"),
    providerErrorCode: providerValueDiagnostic(errorCode, "provider-error-code"),
    // Message is recorded solely as bounded shape metadata and a keyed HMAC.
    providerMessage: providerMessageDiagnostic(message, providerMessageCategory(response?.Status, errorCode)),
  };
  // Only this table-backed factory can attach a non-unknown disposition to a
  // provider-result failure. The marker is not serializable and is ignored by
  // callers that construct an open lookalike object.
  PROVIDER_DIAGNOSTIC_DISPOSITIONS.set(diagnostic, diagnostic.providerDisposition);
  return diagnostic;
}

function safeProviderValueDiagnostic(value) {
  const present = value?.valuePresent === true;
  const code = documentedProviderCode(value?.code);
  const jsonType = value?.jsonType;
  const lengthBucket = value?.lengthBucket;
  const reference = value?.reference;
  if (!present || !PROVIDER_DIAGNOSTIC_JSON_TYPES.has(jsonType) || jsonType === "absent" || !PROVIDER_DIAGNOSTIC_LENGTH_BUCKETS.has(lengthBucket) || lengthBucket === "absent") {
    return {
      valuePresent: false,
      code: "unavailable",
      jsonType: "absent",
      lengthBucket: "absent",
    };
  }
  return {
    valuePresent: true,
    code,
    jsonType,
    lengthBucket,
    ...(typeof reference === "string" && PROVIDER_DIAGNOSTIC_REFERENCE.test(reference) ? { reference } : {}),
  };
}

function safeProviderMessageDiagnostic(value) {
  const category = PROVIDER_MESSAGE_CATEGORIES.has(value?.category) ? value.category : "unavailable";
  const jsonType = value?.jsonType;
  const lengthBucket = value?.lengthBucket;
  const reference = value?.reference;
  if (!PROVIDER_DIAGNOSTIC_JSON_TYPES.has(jsonType) || !PROVIDER_DIAGNOSTIC_LENGTH_BUCKETS.has(lengthBucket)) {
    return { category: "unavailable", jsonType: "absent", lengthBucket: "absent" };
  }
  if ((jsonType === "absent") !== (lengthBucket === "absent")) {
    return { category: "unavailable", jsonType: "absent", lengthBucket: "absent" };
  }
  return {
    category,
    jsonType,
    lengthBucket,
    ...(typeof reference === "string" && PROVIDER_DIAGNOSTIC_REFERENCE.test(reference) ? { reference } : {}),
  };
}

function boundedQueryTimeout(value) {
  if (!Number.isFinite(value) || value < 1) return CALLBACK_QUERY_TIMEOUT_MS;
  return Math.min(Math.floor(value), CALLBACK_QUERY_TIMEOUT_MS);
}

export class PayUniQueryFailure extends Error {
  constructor(failureStage, details = {}) {
    const errorCategory = CALLBACK_QUERY_FAILURES.get(failureStage) ?? "unknown";
    super("PayUni trade query failed.", { cause: details.cause });
    this.name = "PayUniQueryFailure";
    this.failureStage = CALLBACK_QUERY_FAILURES.has(failureStage) ? failureStage : "unknown";
    this.errorCategory = errorCategory;
    this.httpStatus = safeHttpStatus(details.httpStatus);
    // A table-backed provider disposition is meaningful exclusively for an
    // actual provider-result failure. Network and envelope failures must
    // consume the bounded retry budget even if a caller supplies a branded
    // provider diagnostic object alongside them.
    this.providerDisposition = this.failureStage === "provider-result"
      ? safeProviderDisposition(PROVIDER_DIAGNOSTIC_DISPOSITIONS.get(details))
      : "unknown";
    this.providerStatus = safeProviderValueDiagnostic(details.providerStatus);
    this.providerErrorCode = safeProviderValueDiagnostic(details.providerErrorCode);
    this.providerMessage = safeProviderMessageDiagnostic(details.providerMessage);
    PAYUNI_FAILURE_DISPOSITIONS.set(this, this.providerDisposition);
  }
}

function callbackQueryFailure(error) {
  if (!(error instanceof PayUniQueryFailure)) {
    return { failureStage: "unknown", errorCategory: "unknown" };
  }
  const expectedCategory = CALLBACK_QUERY_FAILURES.get(error.failureStage);
  if (!expectedCategory || error.errorCategory !== expectedCategory) {
    return { failureStage: "unknown", errorCategory: "unknown" };
  }
  // Error instances can be modified after construction. Rebuild the closed
  // receipt fields at the boundary so raw provider data cannot enter it.
  const httpStatus = safeHttpStatus(error.httpStatus);
  const providerDisposition = error.failureStage === "provider-result"
    ? safeProviderDisposition(PAYUNI_FAILURE_DISPOSITIONS.get(error))
    : "unknown";
  return {
    failureStage: error.failureStage,
    errorCategory: error.errorCategory,
    ...(httpStatus !== null ? { httpStatus } : {}),
    providerDisposition,
    providerStatus: safeProviderValueDiagnostic(error.providerStatus),
    providerErrorCode: safeProviderValueDiagnostic(error.providerErrorCode),
    providerMessage: safeProviderMessageDiagnostic(error.providerMessage),
  };
}

function queryDisposition(row) {
  return String(row?.TradeStatus ?? "") === "0" ? "retryable-processing" : "unknown";
}

// The only constructor for externally serializable reconciliation attempts.
// Its fields are all bounded scalars or closed enumerations; it never accepts
// raw URLs, provider Status/Message, or order, trade, or card values.
function buildCallbackReceipt({ attempt, row, error, page, stage, sourceReceipt }) {
  const source = sourceReceipt && typeof sourceReceipt === "object" ? sourceReceipt : null;
  const querySucceeded = source ? source.querySucceeded === true : !error;
  const failure = source
    ? (querySucceeded ? null : {
      failureStage: CALLBACK_QUERY_FAILURES.has(source.failureStage) ? source.failureStage : "unknown",
      errorCategory: CALLBACK_QUERY_FAILURES.get(source.failureStage) ?? "unknown",
      ...(safeHttpStatus(source.httpStatus) !== null ? { httpStatus: safeHttpStatus(source.httpStatus) } : {}),
      providerStatus: safeProviderValueDiagnostic(source.providerStatus),
      providerErrorCode: safeProviderValueDiagnostic(source.providerErrorCode),
      providerMessage: safeProviderMessageDiagnostic(source.providerMessage),
    })
    : (error ? callbackQueryFailure(error) : null);
  // A provider disposition is meaningful only when it was created by this
  // builder or by providerResultDiagnostic's exact table lookup.  In
  // particular, receipt-like objects supplied to callbackTimeoutDiagnostic
  // cannot manufacture a terminal result.
  const disposition = source
    ? (!querySucceeded && source.failureStage !== "provider-result"
      ? "unknown"
      : safeProviderDisposition(CALLBACK_RECEIPT_DISPOSITIONS.get(source)))
    : (failure?.providerDisposition ?? queryDisposition(row));
  const receipt = {
    attempt: Number.isInteger(attempt) && attempt > 0 && attempt <= CALLBACK_QUERY_ATTEMPTS ? attempt : 0,
    querySucceeded,
    tradeStatus: source
      ? (querySucceeded ? safeTradeStatus(source.tradeStatus) : "unavailable")
      : (error ? "unavailable" : safeTradeStatus(row?.TradeStatus)),
    tradeNoPresent: source
      ? querySucceeded && source.tradeNoPresent === true
      : !error && String(row?.TradeNo ?? "").trim().length > 0,
    providerDisposition: disposition,
    currentHttpsHostPath: source
      ? safeReceiptHostPath(source.currentHttpsHostPath)
      : safePageHttpsHostPath(page),
    flowStage: source ? safeDiagnosticToken(source.flowStage) : safeDiagnosticToken(stage),
    ...(failure ? failure : {}),
  };
  CALLBACK_RECEIPT_DISPOSITIONS.set(receipt, disposition);
  return receipt;
}

function safeReceiptHostPath(value) {
  return safeHttpsHostPath(
    value === "sandbox-api.payuni.com.tw/api/upp"
      ? "https://sandbox-api.payuni.com.tw/api/upp"
      : "",
  );
}

async function queryWithTimeout(query, orderNumber, timeoutMs) {
  const controller = new AbortController();
  let timeoutId;
  try {
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new PayUniQueryFailure("query-timeout"));
      }, timeoutMs);
    });
    return await Promise.race([
      Promise.resolve().then(() => query(orderNumber, { signal: controller.signal })),
      timeout,
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sleepWithinBudget(sleep, milliseconds, remainingMs) {
  const boundedDelay = Math.max(0, Math.min(milliseconds, remainingMs));
  if (boundedDelay === 0) return;
  let timeoutId;
  try {
    await Promise.race([
      Promise.resolve().then(() => sleep(boundedDelay)),
      new Promise((resolve) => { timeoutId = setTimeout(resolve, boundedDelay); }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function reconcileCallbackTimeout({
  orderNumber,
  page,
  stage,
  query = queryTransaction,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  queryTimeoutMs = CALLBACK_QUERY_TIMEOUT_MS,
}) {
  const attempts = [];
  let paidTransaction = null;
  const boundedQueryTimeoutMs = boundedQueryTimeout(queryTimeoutMs);
  const deadline = Date.now() + CALLBACK_RECONCILIATION_MAX_WAIT_MS;
  for (let attempt = 1; attempt <= CALLBACK_QUERY_ATTEMPTS; attempt += 1) {
    const remainingBeforeQuery = deadline - Date.now();
    if (remainingBeforeQuery < 1) break;
    try {
      const row = await queryWithTimeout(query, orderNumber, Math.min(boundedQueryTimeoutMs, remainingBeforeQuery));
      const receipt = buildCallbackReceipt({ attempt, row, page, stage });
      attempts.push(receipt);
      if (String(row?.TradeStatus) === "1" && String(row?.TradeNo ?? "").trim()) {
        paidTransaction = row;
        break;
      }
    } catch (error) {
      // Do not expose PayUni response or request details in the QA receipt.
      const receipt = buildCallbackReceipt({ attempt, error, page, stage });
      attempts.push(receipt);
      if (receipt.providerDisposition.startsWith("terminal-")) break;
    }
    const disposition = attempts.at(-1).providerDisposition;
    if (attempt < CALLBACK_QUERY_ATTEMPTS && (disposition.startsWith("retryable-") || disposition === "unknown")) {
      await sleepWithinBudget(sleep, CALLBACK_QUERY_INTERVAL_MS, deadline - Date.now());
    }
  }
  const reconciliation = {
    attempts,
    paidTransactionFound: paidTransaction !== null,
  };
  if (paidTransaction) RECONCILIATION_PAID_TRANSACTIONS.set(reconciliation, paidTransaction);
  return reconciliation;
}

function paidTransactionFor(reconciliation) {
  return RECONCILIATION_PAID_TRANSACTIONS.get(reconciliation) ?? null;
}

async function visibleLocatorState(locator) {
  try {
    return (await locator.isVisible({ timeout: 1_000 })) ? "visible" : "not-visible";
  } catch {
    return "unavailable";
  }
}

async function paymentPageStructure(page) {
  const unavailable = () => ({
    paymentForm: "unavailable",
    paymentSubmitButton: "unavailable",
    confirmationDialog: "unavailable",
    validationError: "unavailable",
  });
  try {
    // A detached frame, closed page, or navigation race is observational only.
    // It must not stop the bounded provider reconciliation that follows.
    if (safePageHttpsHostPath(page) === "unavailable") return unavailable();
    const structure = await Promise.all([
      visibleLocatorState(page.locator('input[name="radioOptionpayGroupCredit"], input[placeholder="16 碼或 19 碼"]').first()),
      visibleLocatorState(page.getByRole("button", { name: "確認送出", exact: true })),
      visibleLocatorState(page.getByRole("button", { name: "確定", exact: true })),
      visibleLocatorState(page.locator('[role="alert"], .error, .invalid, .validation-error, .field-error').first()),
    ]);
    // Keep the receipt schema scalar-only and reject any accidental locator
    // implementation value that is not one of the fixed visibility states.
    return safePaymentPageStructure({
      paymentForm: structure[0],
      paymentSubmitButton: structure[1],
      confirmationDialog: structure[2],
      validationError: structure[3],
    });
  } catch {
    return unavailable();
  }
}

function safePaymentPageStructure(value) {
  const structure = value && typeof value === "object" ? value : {};
  return Object.fromEntries([
    "paymentForm",
    "paymentSubmitButton",
    "confirmationDialog",
    "validationError",
  ].map((key) => [key, STRUCTURAL_VISIBILITY.has(structure[key]) ? structure[key] : "unavailable"]));
}

function callbackTimeoutDiagnostic({
  stage,
  page,
  confirmationDialogAppeared,
  confirmationDialogClicked,
  checkoutStatus,
  paymentPage,
  callbackQueryAttempts,
}) {
  const safeStage = safeDiagnosticToken(stage);
  const currentUrl = safePageHttpsHostPath(page);
  const safeConfirmationDialogAppeared = confirmationDialogAppeared === true;
  const safeConfirmationDialogClicked = safeConfirmationDialogAppeared && confirmationDialogClicked === true;
  const confirmationDialog = safeConfirmationDialogAppeared
    ? (safeConfirmationDialogClicked ? "appeared-clicked" : "appeared-not-clicked")
    : "not-appeared";
  const checkoutHttpStatus = safeHttpStatus(checkoutStatus);
  const safePaymentPage = safePaymentPageStructure(paymentPage);
  const safeAttempts = Array.isArray(callbackQueryAttempts)
    ? callbackQueryAttempts.slice(0, CALLBACK_QUERY_ATTEMPTS).map((attempt, index) => buildCallbackReceipt({
      attempt: index + 1,
      sourceReceipt: attempt,
    }))
    : [];
  const error = truncate(
    `PayUni callback timeout; stage=${safeStage}; url=${currentUrl}; confirm=${confirmationDialog}; checkoutHttp=${checkoutHttpStatus ?? "unknown"}`,
    CALLBACK_TIMEOUT_ERROR_MAX_LENGTH,
  );
  return {
    error,
    checks: {
      browserCheckout: "incomplete",
      paymentCallbackMatched: "timeout",
      providerChecks: {
        stage: safeStage,
        currentHttpsHostPath: currentUrl,
        confirmationDialog,
        confirmationDialogAppeared: safeConfirmationDialogAppeared,
        confirmationDialogClicked: safeConfirmationDialogClicked,
        checkoutHttpStatus,
        paymentPage: safePaymentPage,
        callbackTradeQueries: safeAttempts,
      },
    },
  };
}

class CallbackTimeoutError extends Error {
  constructor(diagnostic, cause, { checkout, paidTransaction } = {}) {
    super(diagnostic.error, { cause });
    this.name = "CallbackTimeoutError";
    this.diagnostic = diagnostic;
    if (checkout && paidTransaction) {
      CALLBACK_TIMEOUT_CLEANUP.set(this, { checkout, paidTransaction });
    }
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function keyMaterial() {
  const key = env("PAYUNI_HASH_KEY");
  const iv = env("PAYUNI_HASH_IV");
  if (Buffer.byteLength(key) !== 32 || Buffer.byteLength(iv) !== 16) {
    throw new PayUniQueryFailure("request-configuration");
  }
  return { key, iv };
}

function encryptInfo(payload) {
  const { key, iv } = keyMaterial();
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(iv), { authTagLength: 16 });
  const query = new URLSearchParams(
    Object.entries(payload).map(([payloadKey, value]) => [payloadKey, String(value)]),
  ).toString();
  const encrypted = Buffer.concat([cipher.update(query, "utf8"), cipher.final()]).toString("base64");
  const tag = cipher.getAuthTag().toString("base64");
  return Buffer.from(`${encrypted}:::${tag}`).toString("hex");
}

function decryptInfo(value) {
  const { key, iv } = keyMaterial();
  let encrypted;
  let tag;
  try {
    [encrypted, tag] = Buffer.from(value, "hex").toString("utf8").split(":::");
  } catch (error) {
    throw new PayUniQueryFailure("response-envelope", { cause: error });
  }
  if (!encrypted || !tag) throw new PayUniQueryFailure("response-envelope");
  try {
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(iv));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return Object.fromEntries(new URLSearchParams(plaintext));
  } catch (error) {
    throw new PayUniQueryFailure("signature-decryption", { cause: error });
  }
}

function hashInfo(value) {
  const { key, iv } = keyMaterial();
  return createHash("sha256").update(`${key}${value}${iv}`).digest("hex").toUpperCase();
}

function parseOuterPayload(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

async function payUniRequest(path, version, payload, { signal } = {}) {
  assert(path === "/api/trade/query" || path === "/api/trade/close", "未核准的 PayUni API 路徑。");
  const url = assertExactHttpsHost(`${PAYUNI_API_ORIGIN}${path}`, PAYUNI_HOST, "PayUni API");
  const merId = env("PAYUNI_MERCHANT_ID");
  if (!merId) throw new PayUniQueryFailure("request-configuration");
  const encrypted = encryptInfo({ MerID: merId, ...payload });
  const body = new URLSearchParams({
    MerID: merId,
    Version: version,
    EncryptInfo: encrypted,
    HashInfo: hashInfo(encrypted),
  });
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "CelebrateDeal-AI-Team-Sandbox-QA/1.0",
      },
      body,
      redirect: "error",
      signal: signal ?? AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new PayUniQueryFailure("network-request", { cause: error });
  }
  if (!response.ok) throw new PayUniQueryFailure("http-response", { httpStatus: response.status });
  let text;
  try {
    text = await response.text();
  } catch (error) {
    throw new PayUniQueryFailure("network-request", { cause: error });
  }
  const outer = parseOuterPayload(text);
  if (
    typeof outer.EncryptInfo !== "string"
    || !outer.EncryptInfo.trim()
    || typeof outer.HashInfo !== "string"
    || !outer.HashInfo.trim()
  ) {
    throw new PayUniQueryFailure("response-envelope");
  }
  const responseEncrypted = outer.EncryptInfo;
  const responseHash = outer.HashInfo.trim();
  if (!safeEqual(hashInfo(responseEncrypted), responseHash)) {
    throw new PayUniQueryFailure("signature-decryption");
  }
  return decryptInfo(responseEncrypted);
}

function resultRow(queryResponse) {
  if (Array.isArray(queryResponse.Result)) return queryResponse.Result[0];
  if (typeof queryResponse.Result === "string") {
    try {
      const parsed = JSON.parse(queryResponse.Result);
      return Array.isArray(parsed) ? parsed[0] : parsed;
    } catch {
      const parsed = Object.fromEntries(new URLSearchParams(queryResponse.Result));
      return Object.keys(parsed).length > 0 ? parsed : null;
    }
  }
  if (queryResponse.Result && typeof queryResponse.Result === "object") {
    if ("MerTradeNo" in queryResponse.Result) return queryResponse.Result;
    const nested = Object.values(queryResponse.Result).find(
      (value) => value && typeof value === "object" && "MerTradeNo" in value,
    );
    if (nested) return nested;
    return queryResponse.Result;
  }
  const bracketRows = new Map();
  for (const [key, value] of Object.entries(queryResponse)) {
    const match = /^Result(?:\[(\d+)\])?\[([^\]]+)\]$/.exec(key);
    if (!match) continue;
    const index = Number(match[1] ?? "0");
    const row = bracketRows.get(index) ?? {};
    row[match[2]] = value;
    bracketRows.set(index, row);
  }
  if (bracketRows.size > 0) {
    return bracketRows.get(Math.min(...bracketRows.keys()));
  }
  return queryResponse;
}

async function queryTransaction(orderNumber, { signal } = {}) {
  const response = await payUniRequest("/api/trade/query", "2.0", {
    MerTradeNo: orderNumber,
    Timestamp: Math.floor(Date.now() / 1000),
  }, { signal });
  if (!response || typeof response !== "object" || !("Status" in response)) {
    throw new PayUniQueryFailure("response-envelope");
  }
  if (response.Status !== "SUCCESS") {
    throw new PayUniQueryFailure("provider-result", providerResultDiagnostic(response));
  }
  const row = resultRow(response);
  if (!row || typeof row !== "object" || !("MerTradeNo" in row)) {
    throw new PayUniQueryFailure("response-envelope");
  }
  if (String(row.MerTradeNo) !== orderNumber) throw new PayUniQueryFailure("order-validation");
  return row;
}

async function refundTransaction(tradeNo, amount) {
  const response = await payUniRequest("/api/trade/close", "1.0", {
    TradeNo: tradeNo,
    Timestamp: Math.floor(Date.now() / 1000),
    CloseType: 2,
    TradeAmt: amount,
  });
  assert(response.Status === "SUCCESS", `PayUni Sandbox 退款失敗：${response.Status ?? "UNKNOWN"}`);
  const row = resultRow(response);
  assert(row && String(row.TradeNo) === tradeNo, "PayUni 退款回應與本次交易不一致。");
  assert(String(row.CloseType) === "2", "PayUni 退款回應不是退款類型。");
}

async function waitForRefund(orderNumber) {
  let row = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    row = await queryTransaction(orderNumber);
    if (["1", "2", "8"].includes(String(row.RefundStatus ?? ""))) return row;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return row;
}

async function runCheckout(appUrl) {
  // An explicitly defined but blank PAYUNI_TEST_CARD_NUMBER should still use
  // the existing Sandbox one-time card value from local, gitignored config.
  const cardNumber = (env("PAYUNI_TEST_CARD_NUMBER") || env("PAYUNI_SANDBOX_ONETIME_CARD_NO")).replace(
    /\D/g,
    "",
  );
  const expiry = env("PAYUNI_TEST_EXPIRY").replace(/\D/g, "");
  const cvv = env("PAYUNI_TEST_CVV").replace(/\D/g, "");
  assert(/^\d{16,19}$/.test(cardNumber), "缺少有效的 Sandbox 測試卡號。");
  assert(/^\d{4}$/.test(expiry), "PAYUNI_TEST_EXPIRY 必須是 MMYY。");
  assert(/^\d{3}$/.test(cvv), "PAYUNI_TEST_CVV 必須是三碼。");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: "zh-TW" });
  const appHost = new URL(appUrl).hostname;
  let flowStage = "opening-live-page";
  let checkoutStatus = null;
  let confirmationDialogAppeared = false;
  let confirmationDialogClicked = false;
  try {
    const livePath = env("PAYUNI_TEST_LIVE_PATH", DEFAULT_LIVE_PATH);
    assert(livePath.startsWith("/"), "PAYUNI_TEST_LIVE_PATH 必須是站內絕對路徑。");
    await installVercelProtectionBypassCookie(page, appUrl);
    flowStage = "opening-live-page";
    await page.goto(new URL(livePath, appUrl).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    let checkout = null;
    await page.route(`${appUrl}/api/payments/checkout`, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      checkoutStatus = response.status();
      try {
        checkout = JSON.parse(body);
      } finally {
        // Return the captured body to the application before its form submit
        // navigates away and Chromium discards the response-body identifier.
        await route.fulfill({ response, body });
      }
    });
    flowStage = "submitting-checkout";
    await page.getByRole("button", { name: "立即搶購" }).click();
    // PayUni 的 Sandbox 頁面可能持續載入第三方資源；網址與 DOM 已完成切換時
    // 就可以繼續填表，不應再等待整頁 load 而把成功導頁誤判成逾時。
    flowStage = "waiting-payuni-checkout";
    await page.waitForURL((url) => url.protocol === "https:" && url.hostname === PAYUNI_HOST, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    assert(
      typeof checkoutStatus === "number" && checkoutStatus >= 200 && checkoutStatus < 300,
      `CelebrateDeal checkout 回應 HTTP ${checkoutStatus ?? "UNKNOWN"}。`,
    );
    assert(checkout?.ok === true && checkout?.provider === "payuni", "CelebrateDeal 未建立 PayUni 結帳。");
    assertExactHttpsHost(String(checkout.formAction ?? ""), PAYUNI_HOST, "PayUni 結帳頁");
    assert(typeof checkout.orderNumber === "string" && checkout.orderNumber.length > 0, "結帳回應缺少訂單編號。");
    assert(typeof checkout.transactionId === "string" && checkout.transactionId.length > 0, "結帳回應缺少交易識別。");

    flowStage = "filling-payment-form";
    await page.getByText("一次付清", { exact: true }).click();
    await page.locator('input[name="radioOptionpayGroupCredit"]').check({ force: true });
    await page.getByPlaceholder("16 碼或 19 碼").fill(cardNumber);
    await page.getByPlaceholder("MM/YY").fill(expiry);
    await page.getByPlaceholder("***").fill(cvv);
    await page.getByPlaceholder("example@example.com").fill("qa-sandbox@example.com");
    flowStage = "submitting-payment";
    await page.getByRole("button", { name: "確認送出", exact: true }).click();
    const confirmButton = page.getByRole("button", { name: "確定", exact: true });
    try {
      flowStage = "waiting-confirmation-dialog";
      await confirmButton.waitFor({ state: "visible", timeout: 5_000 });
      confirmationDialogAppeared = true;
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) throw error;
    }
    if (confirmationDialogAppeared) {
      flowStage = "confirming-payment";
      await confirmButton.click();
      confirmationDialogClicked = true;
    }

    flowStage = "waiting-payment-callback";
    try {
      await page.waitForURL((url) => url.protocol === "https:" && url.hostname === appHost, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) throw error;
      const paymentPage = await paymentPageStructure(page);
      const reconciliation = await reconcileCallbackTimeout({
        orderNumber: checkout.orderNumber,
        page,
        stage: flowStage,
      });
      throw new CallbackTimeoutError(
        callbackTimeoutDiagnostic({
          stage: flowStage,
          page,
          confirmationDialogAppeared,
          confirmationDialogClicked,
          checkoutStatus,
          paymentPage,
          callbackQueryAttempts: reconciliation.attempts,
        }),
        error,
        { checkout, paidTransaction: paidTransactionFor(reconciliation) },
      );
    }
    flowStage = "verifying-payment-callback";
    const callback = JSON.parse((await page.locator("body").innerText()).trim());
    assert(callback?.ok === true, "CelebrateDeal 未接受 PayUni 付款通知。");
    assert(callback.transactionId === checkout.transactionId, "付款通知與結帳交易識別不一致。");
    return {
      orderNumber: checkout.orderNumber,
      transactionId: checkout.transactionId,
      amount: Math.round(Number(checkout.amountCents) / 100),
      callbackEventId: String(callback.eventId ?? ""),
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  const appUrl = resolvePayUniStagingAppUrl();
  assert(env("PAYUNI_ENV") === "sandbox", "此命令只允許 PAYUNI_ENV=sandbox。");
  assert(env("PAYUNI_SANDBOX_QA_ENABLED") === "true", "需明確設定 PAYUNI_SANDBOX_QA_ENABLED=true。");
  assert(env("PAYUNI_SANDBOX_REFUND_ENABLED") === "true", "需明確設定 PAYUNI_SANDBOX_REFUND_ENABLED=true。");

  const checkout = await runCheckout(appUrl);
  assert(Number.isInteger(checkout.amount) && checkout.amount > 0, "Sandbox 退款金額無效。");
  const paid = await queryTransaction(checkout.orderNumber);
  assert(String(paid.TradeStatus) === "1", "PayUni 後台查詢尚未顯示已付款。");
  assert(String(paid.TradeNo ?? "").length > 0, "PayUni 後台查詢缺少交易序號。");
  assert(Number(paid.TradeAmt) === checkout.amount, "PayUni 後台金額與 CelebrateDeal 結帳金額不一致。");

  await refundTransaction(String(paid.TradeNo), checkout.amount);
  const refunded = await waitForRefund(checkout.orderNumber);
  const refundStatus = String(refunded?.RefundStatus ?? "");
  assert(["1", "2", "8"].includes(refundStatus), "PayUni 後台尚未記錄 Sandbox 退款。");

  return {
    schema: SCHEMA,
    success: true,
    environment: "sandbox",
    appHost: new URL(appUrl).hostname,
    providerHost: PAYUNI_HOST,
    projectRevision: env("AI_TEAM_PROJECT_REVISION") || null,
    startedAt,
    completedAt: new Date().toISOString(),
    orderRef: reference(checkout.orderNumber),
    tradeRef: reference(paid.TradeNo),
    transactionRef: reference(checkout.transactionId),
    checks: {
      browserCheckout: "passed",
      paymentCallbackMatched: "passed",
      providerReconciliation: "passed",
      sandboxRefundAccepted: "passed",
      refundVisibleInProviderQuery: "passed",
    },
    providerState: {
      tradeStatus: String(refunded.TradeStatus ?? ""),
      paymentType: String(refunded.PaymentType ?? ""),
      refundStatus,
      refundAmount: Number(refunded.RefundAmt ?? checkout.amount),
    },
    productionValidation: {
      status: "human-approval-required",
      automatedChargeAllowed: false,
    },
  };
}

async function cleanUpTimedOutPayment(error) {
  const { checkout, paidTransaction: paid } = CALLBACK_TIMEOUT_CLEANUP.get(error) ?? {};
  if (!checkout || !paid) return;

  try {
    const amount = Math.round(Number(checkout.amountCents) / 100);
    assert(Number.isInteger(amount) && amount > 0, "Sandbox 退款金額無效。");
    assert(String(paid.TradeStatus) === "1", "PayUni 後台查詢尚未顯示已付款。");
    assert(String(paid.TradeNo ?? "").length > 0, "PayUni 後台查詢缺少交易序號。");
    assert(Number(paid.TradeAmt) === amount, "PayUni 後台金額與 CelebrateDeal 結帳金額不一致。");

    await refundTransaction(String(paid.TradeNo), amount);
    const refunded = await waitForRefund(checkout.orderNumber);
    const refundStatus = String(refunded?.RefundStatus ?? "");
    assert(["1", "2", "8"].includes(refundStatus), "PayUni 後台尚未記錄 Sandbox 退款。");
    error.diagnostic.checks.sandboxRefundAccepted = "passed";
    error.diagnostic.checks.refundVisibleInProviderQuery = "passed";
  } catch {
    // The callback timeout is the primary QA failure. Keep cleanup details
    // constrained so provider failures cannot disclose transaction data.
    error.diagnostic.checks.sandboxRefundAccepted = "failed";
  }
}

async function execute() {
  try {
    console.log(JSON.stringify(await main()));
  } catch (error) {
    if (error instanceof CallbackTimeoutError) await cleanUpTimedOutPayment(error);
    const callbackTimeout = error instanceof CallbackTimeoutError ? error.diagnostic : null;
    console.log(JSON.stringify({
      schema: SCHEMA,
      success: false,
      environment: "sandbox",
      completedAt: new Date().toISOString(),
      // A browser/provider exception can carry a URL, response body, or card
      // field. Only the closed callback receipt is allowed to supply detail.
      error: callbackTimeout?.error ?? "PayUni Sandbox QA failed.",
      ...(callbackTimeout ? { checks: callbackTimeout.checks } : {}),
      productionValidation: {
        status: "human-approval-required",
        automatedChargeAllowed: false,
      },
    }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await execute();

export {
  PAYUNI_PROVIDER_DISPOSITION_TABLES,
  callbackTimeoutDiagnostic,
  payUniRequest,
  paymentPageStructure,
  providerResultDiagnostic,
  resolvePayUniStagingAppUrl,
  safeDiagnosticToken,
  safeTradeStatus,
  vercelProtectionBypassCookieUrl,
};
