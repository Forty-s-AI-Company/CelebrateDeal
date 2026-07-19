import { createCipheriv, createDecipheriv, createHash, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, errors } from "playwright";

const SCHEMA = "celebratedeal-payuni-sandbox-qa/v1";
const APP_HOST = "celebratedeal.carry-digital-nomad.in.net";
const PAYUNI_HOST = "sandbox-api.payuni.com.tw";
const PAYUNI_API_ORIGIN = `https://${PAYUNI_HOST}`;
const DEFAULT_APP_URL = `https://${APP_HOST}`;
const DEFAULT_LIVE_PATH = "/live/summer-glow-live";
const CALLBACK_TIMEOUT_ERROR_MAX_LENGTH = 280;
const CALLBACK_QUERY_ATTEMPTS = 3;
const CALLBACK_QUERY_INTERVAL_MS = 1_000;
const CALLBACK_QUERY_TIMEOUT_MS = 5_000;
const PAYUNI_TRADE_STATUSES = new Set(["0", "1"]);
// These values are deliberately small allowlists.  PayUni's Message and the
// rest of a response can contain merchant or payment data, so they must never
// become part of the external-QA receipt.
const PROVIDER_RESPONSE_STATUSES = new Set(["FAIL", "FAILED", "ERROR", "PENDING", "PROCESSING", "REJECTED"]);
const PROVIDER_RESULT_FIELDS = new Set([
  "MerTradeNo",
  "TradeNo",
  "TradeStatus",
  "PaymentType",
  "RespondCode",
  "Auth",
  "RefundStatus",
  "CloseType",
  "TradeAmt",
  "RefundAmt",
  "ErrorCode",
  "Code",
  "Status",
]);
const PROVIDER_RESULT_FIELD_MAX_COUNT = 8;
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

function reference(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function truncate(value, maximumLength) {
  const text = String(value ?? "").trim();
  return text.length <= maximumLength ? text : `${text.slice(0, maximumLength - 1)}…`;
}

function safeHttpsHostPath(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return "unavailable";
    // Deliberately omit query and fragment: callback parameters can contain
    // provider data that does not belong in a QA receipt.
    return truncate(`${url.hostname}${url.pathname}`, 80);
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

function safeProviderQueryStatus(value) {
  return PROVIDER_RESPONSE_STATUSES.has(value) ? value : "unavailable";
}

function safeProviderErrorCode(value) {
  const code = String(value ?? "").trim();
  // Error codes are useful to distinguish a missing order from a payment
  // rejection.  Restrict them to conventional short provider-code forms;
  // arbitrary tokens, messages, and identifiers are not diagnostics.
  return /^(?:\d{1,8}|[A-Z]{1,8}-\d{1,8}|MPG\d{5,8})$/.test(code) ? code : "unavailable";
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

function safeProviderResultType(result) {
  if (result === undefined || result === null) return "absent";
  if (Array.isArray(result)) return "array";
  if (typeof result === "string") return "string";
  if (typeof result === "object") return "object";
  return "other";
}

function safeProviderResultFields(result) {
  const parsed = providerResultValue(result);
  const candidate = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
  return [...PROVIDER_RESULT_FIELDS]
    .filter((field) => Object.hasOwn(candidate, field))
    .slice(0, PROVIDER_RESULT_FIELD_MAX_COUNT);
}

function providerResultDiagnostic(response) {
  const result = response?.Result;
  const parsedResult = providerResultValue(result);
  const resultRow = Array.isArray(parsedResult) ? parsedResult[0] : parsedResult;
  const errorCode = [
    response?.ErrorCode,
    response?.Code,
    response?.StatusCode,
    resultRow?.ErrorCode,
    resultRow?.Code,
    resultRow?.StatusCode,
  ]
    .map(safeProviderErrorCode)
    .find((code) => code !== "unavailable") ?? "unavailable";
  return {
    providerStatus: safeProviderQueryStatus(response?.Status),
    providerErrorCode: errorCode,
    providerResultType: safeProviderResultType(result),
    providerResultFields: safeProviderResultFields(result),
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
    this.providerStatus = safeProviderQueryStatus(details.providerStatus);
    this.providerErrorCode = safeProviderErrorCode(details.providerErrorCode);
    this.providerResultType = ["absent", "array", "string", "object", "other"].includes(details.providerResultType)
      ? details.providerResultType
      : "unavailable";
    this.providerResultFields = Array.isArray(details.providerResultFields)
      ? details.providerResultFields.filter((field) => PROVIDER_RESULT_FIELDS.has(field)).slice(0, PROVIDER_RESULT_FIELD_MAX_COUNT)
      : [];
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
  // Error instances can be modified after construction. Re-apply the scalar
  // allowlists at the receipt boundary so a query implementation cannot add
  // provider data to the diagnostic after the failure was created.
  const httpStatus = safeHttpStatus(error.httpStatus);
  const providerStatus = safeProviderQueryStatus(error.providerStatus);
  const providerErrorCode = safeProviderErrorCode(error.providerErrorCode);
  const providerResultType = ["absent", "array", "string", "object", "other"].includes(error.providerResultType)
    ? error.providerResultType
    : "unavailable";
  const providerResultFields = Array.isArray(error.providerResultFields)
    ? error.providerResultFields.filter((field) => PROVIDER_RESULT_FIELDS.has(field)).slice(0, PROVIDER_RESULT_FIELD_MAX_COUNT)
    : [];
  return {
    failureStage: error.failureStage,
    errorCategory: error.errorCategory,
    ...(httpStatus !== null ? { httpStatus } : {}),
    ...(providerStatus !== "unavailable" ? { providerStatus } : {}),
    ...(providerErrorCode !== "unavailable" ? { providerErrorCode } : {}),
    ...(providerResultType !== "unavailable" ? { providerResultType } : {}),
    ...(providerResultFields.length > 0 ? { providerResultFields } : {}),
  };
}

function callbackQuerySummary({ attempt, row, error, page, stage }) {
  return {
    attempt,
    querySucceeded: !error,
    tradeStatus: error ? "unavailable" : safeTradeStatus(row?.TradeStatus),
    tradeNoPresent: !error && String(row?.TradeNo ?? "").trim().length > 0,
    currentHttpsHostPath: safeHttpsHostPath(page.url()),
    flowStage: safeDiagnosticToken(stage),
    ...(error ? callbackQueryFailure(error) : {}),
  };
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
  for (let attempt = 1; attempt <= CALLBACK_QUERY_ATTEMPTS; attempt += 1) {
    try {
      const row = await queryWithTimeout(query, orderNumber, boundedQueryTimeoutMs);
      attempts.push(callbackQuerySummary({ attempt, row, page, stage }));
      if (String(row?.TradeStatus) === "1" && String(row?.TradeNo ?? "").trim()) {
        paidTransaction = row;
        break;
      }
    } catch (error) {
      // Do not expose PayUni response or request details in the QA receipt.
      attempts.push(callbackQuerySummary({ attempt, error, page, stage }));
    }
    if (attempt < CALLBACK_QUERY_ATTEMPTS) await sleep(CALLBACK_QUERY_INTERVAL_MS);
  }
  return { attempts, paidTransaction };
}

async function visibleLocatorState(locator) {
  try {
    return (await locator.isVisible({ timeout: 1_000 })) ? "visible" : "not-visible";
  } catch {
    return "unavailable";
  }
}

async function paymentPageStructure(page) {
  try {
    if (new URL(page.url()).hostname !== PAYUNI_HOST) {
      return {
        paymentForm: "unavailable",
        paymentSubmitButton: "unavailable",
        confirmationDialog: "unavailable",
        validationError: "unavailable",
      };
    }
    const structure = {
      paymentForm: await visibleLocatorState(page.locator('input[name="radioOptionpayGroupCredit"], input[placeholder="16 碼或 19 碼"]').first()),
      paymentSubmitButton: await visibleLocatorState(page.getByRole("button", { name: "確認送出", exact: true })),
      confirmationDialog: await visibleLocatorState(page.getByRole("button", { name: "確定", exact: true })),
      validationError: await visibleLocatorState(page.locator('[role="alert"], .error, .invalid, .validation-error, .field-error').first()),
    };
    // Keep the receipt schema scalar-only and reject any accidental locator
    // implementation value that is not one of the fixed visibility states.
    return Object.fromEntries(Object.entries(structure).map(([key, value]) => [
      key,
      STRUCTURAL_VISIBILITY.has(value) ? value : "unavailable",
    ]));
  } catch {
    return {
      paymentForm: "unavailable",
      paymentSubmitButton: "unavailable",
      confirmationDialog: "unavailable",
      validationError: "unavailable",
    };
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
  const currentUrl = safeHttpsHostPath(page.url());
  const confirmationDialog = confirmationDialogAppeared
    ? (confirmationDialogClicked ? "appeared-clicked" : "appeared-not-clicked")
    : "not-appeared";
  const checkoutHttpStatus = safeHttpStatus(checkoutStatus);
  const safePaymentPage = safePaymentPageStructure(paymentPage);
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
        confirmationDialogAppeared,
        confirmationDialogClicked,
        checkoutHttpStatus,
        paymentPage: safePaymentPage,
        callbackTradeQueries: callbackQueryAttempts,
      },
    },
  };
}

class CallbackTimeoutError extends Error {
  constructor(diagnostic, cause, { checkout, paidTransaction } = {}) {
    super(diagnostic.error, { cause });
    this.name = "CallbackTimeoutError";
    this.diagnostic = diagnostic;
    this.checkout = checkout;
    this.paidTransaction = paidTransaction;
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
  let flowStage = "opening-live-page";
  let checkoutStatus = null;
  let confirmationDialogAppeared = false;
  let confirmationDialogClicked = false;
  try {
    const livePath = env("PAYUNI_TEST_LIVE_PATH", DEFAULT_LIVE_PATH);
    assert(livePath.startsWith("/"), "PAYUNI_TEST_LIVE_PATH 必須是站內絕對路徑。");
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
      await page.waitForURL((url) => url.protocol === "https:" && url.hostname === APP_HOST, {
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
        { checkout, paidTransaction: reconciliation.paidTransaction },
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
  const appUrl = assertExactHttpsHost(env("PAYUNI_TEST_APP_URL", DEFAULT_APP_URL), APP_HOST, "CelebrateDeal Staging").origin;
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
    appHost: APP_HOST,
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
  const checkout = error.checkout;
  const paid = error.paidTransaction;
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
      error: callbackTimeout?.error ?? (error instanceof Error ? error.message : "未知錯誤"),
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
  callbackTimeoutDiagnostic,
  callbackQuerySummary,
  payUniRequest,
  paymentPageStructure,
  providerResultDiagnostic,
  safeDiagnosticToken,
  safeTradeStatus,
};
