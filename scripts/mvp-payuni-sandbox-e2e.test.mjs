import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  clickPayUniCreditTab,
  collectPageStructureInPage,
  formatPayUniPageStructure,
  recordPayUniResourceFailure,
  sanitizePayUniPageStructure,
  sanitizeStructureText,
  classifyPayUniBrowserPage,
  classifyPayUniSubmitMessage,
  classifyPayUniSubmitLocation,
  sanitizePayUniSubmitErrors,
  formatPayUniSubmitDiagnostic,
  collectSubmitErrorsInPage,
  capturePayUniSubmitDiagnostic,
  observePayUniSubmitDialogs,
  recordPayUniSubmitDialog,
  classifyPlaywrightErrorKind,
  createPayUniBrowserDiagnostic,
  formatPayUniBrowserDiagnostic,
  prepareIssuedRecoveryCheckout,
  runMvpPayUniPaymentOnly,
  validatePaymentOnlyReceipt,
  writePaymentOnlyReceipt,
  validateWrittenPaymentOnlyReceipt,
  MVP_PAYUNI_PAYMENT_ONLY_SCHEMA,
  classifyPayUniConfirmation,
  retryFixedWp4BuyerCallback,
  validateBuyerCallbackRetryReceipt,
  writeBuyerCallbackRetryReceipt,
  validateWrittenBuyerCallbackRetryReceipt,
  checkExistingWp4BuyerPayment,
  validateBuyerPaymentCheckReceipt,
  BUYER_PAYMENT_CHECK_SOURCE_SHA,
  BUYER_CALLBACK_RETRY_SOURCE_SHA,
  writeBuyerPaymentCheckReceipt,
  validateWrittenBuyerPaymentCheckReceipt,
  classifyPayUniApiNetworkFailure,
  defaultBrowserSubmit,
  defaultSubscriptionBrowserSubmit,
  finalizeMvpPayUniSubscriptionReceipt,
  finalizeMvpPayUniReceipt,
  isPayUniPaymentPageUrl,
  FIXED_PAYUNI_ENV,
  FIXED_SUBSCRIPTION_PURPOSE,
  EXISTING_REFUND_RECOVERY_SOURCE_SHA,
  EXISTING_REFUND_RECOVERY_SCHEMA,
  MVP_PAYUNI_SANDBOX_E2E_SCHEMA,
  MVP_PAYUNI_SANDBOX_SUBSCRIPTION_SCHEMA,
  MVP_PAYUNI_BUYER_CONTINUATION_SCHEMA,
  BUYER_CONTINUATION_TRANSACTION_SOURCE_SHA,
  runMvpPayUniBuyerExistingContinuation,
  validateBuyerContinuationReceipt,
  writeBuyerExistingContinuationReceipt,
  SIDE_EFFECT_BUDGET,
  createExistingRefundRecoveryReceipt,
  createReceipt,
  createSubscriptionReceipt,
  fixedCheckoutIdempotencyKey,
  readFixedInputs,
  readExistingRefundRecoveryInputs,
  recoverExistingWp4BuyerRefund,
  runMvpPayUniSandboxE2E,
  runMvpPayUniSandboxSubscriptionE2E,
  validateExistingRefundRecoveryInvocation,
  validateExistingRefundRecoveryReceipt,
  validateInvocation,
  validateMvpPayUniReceipt,
  validateMvpPayUniSubscriptionReceipt,
  validateWrittenExistingRefundRecoveryReceipt,
  validateWrittenMvpPayUniReceipt,
  validateWrittenMvpPayUniSubscriptionReceipt,
  verifyMvpPayUniLineage,
  attestOperationHost,
  diagnoseMvpPayUniLineage,
  writeExistingRefundRecoveryReceipt,
  writeMvpPayUniReceipt,
  writeMvpPayUniSubscriptionReceipt,
} from "./mvp-payuni-sandbox-e2e.mjs";

test("fixed callback replay submits one empty request and validates persisted bounded evidence", async () => {
  let calls = 0;
  const receipt = await retryFixedWp4BuyerCallback({ sourceSha: "b".repeat(40), previewHost: "fixed-preview.vercel.app", jobSecret: "synthetic" }, {
    request: async (request) => {
      calls++;
      assert.equal(request.url, "https://fixed-preview.vercel.app/api/admin/ops/payuni/wp4-buyer-callback-retry");
      assert.equal(request.body, undefined);
      return { status: 200, body: { status: "PROCESSED", retryAttempts: 1, failureCode: "NONE" } };
    },
  });
  assert.equal(calls, 1);
  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.transactionSourceSha, BUYER_CALLBACK_RETRY_SOURCE_SHA);
  assert.equal(validateBuyerCallbackRetryReceipt(receipt).ok, true);
  for (const patch of [{ retryAttempts: 0 }, { queryAttempts: 1 }, { paymentSubmissions: 1 }, { refundSubmissions: 1 }, { raw: "secret" }, { failureCode: "unknown-raw" }, { transactionSourceSha: "b".repeat(40) }]) {
    assert.equal(validateBuyerCallbackRetryReceipt({ ...receipt, ...patch }).ok, false);
  }
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp4-callback-retry-"));
  try {
    await writeBuyerCallbackRetryReceipt(receipt, temp);
    assert.equal(await validateWrittenBuyerCallbackRetryReceipt(temp), true);
    await assert.rejects(writeBuyerCallbackRetryReceipt({ ...receipt, raw: "secret" }, temp));
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith("wp4-callback-retry-"));
    await rm(temp, { recursive: true, force: true });
  }
});

test("callback replay fails closed without repeating ambiguous requests or leaking errors", async () => {
  const input = { sourceSha: "b".repeat(40), previewHost: "fixed-preview.vercel.app", jobSecret: "synthetic" };
  let calls = 0;
  const failed = await retryFixedWp4BuyerCallback(input, { request: async () => {
    calls++; return { status: 200, body: { status: "RETRY_FAILED", retryAttempts: 1, failureCode: "database_transaction_failed" } };
  } });
  assert.equal(calls, 1);
  assert.equal(failed.result, "BLOCKED");
  assert.equal(validateBuyerCallbackRetryReceipt(failed).ok, true);
  const lost = await retryFixedWp4BuyerCallback(input, { request: async () => { throw new Error("private error"); } });
  assert.equal(lost.retryAttempts, 1);
  assert.equal(lost.status, "NETWORK_REJECTED");
  assert.equal(JSON.stringify(lost).includes("private error"), false);
  assert.equal(validateBuyerCallbackRetryReceipt(lost).ok, true);
  const invalid = await retryFixedWp4BuyerCallback(input, { request: async () => ({ status: 200, body: { status: "PROCESSED", retryAttempts: 1, failureCode: "NONE", raw: "secret" } }) });
  assert.equal(invalid.status, "RESPONSE_INVALID");
  assert.equal(validateBuyerCallbackRetryReceipt(invalid).ok, true);
  const denied = await retryFixedWp4BuyerCallback({}, { request: async () => assert.fail("must not call") });
  assert.equal(validateBuyerCallbackRetryReceipt(denied).ok, true);
});

test("unreferenced Sandbox observations stay blocked and reject forged verification", async () => {
  for (const [status, providerStatus] of [["UNREFERENCED_NOT_FOUND", "UNKNOWN"], ["UNREFERENCED_FOUND", "PAID"], ["UNREFERENCED_QUERY_FAILED", "UNKNOWN"]]) {
    const receipt = await checkExistingWp4BuyerPayment({ sourceSha: "a".repeat(40), previewHost: "fixed-preview.vercel.app", jobSecret: "synthetic" }, {
      request: async () => ({ status: 200, body: { status, providerStatus, localStatus: "PENDING", referenceState: "PROVIDER_MISSING", queryAttempts: 1, callbackStatus: "NOT_OBSERVED", callbackFailure: "NONE" } }),
    });
    assert.equal(receipt.status, status);
    assert.equal(receipt.result, "BLOCKED");
    assert.equal(receipt.paymentSubmissions, 0);
    assert.equal(receipt.refundSubmissions, 0);
    assert.deepEqual(validateBuyerPaymentCheckReceipt(receipt), { ok: true, errors: [] });
    for (const patch of [{ result: "PASS" }, { queryAttempts: 0 }, { referenceState: "AVAILABLE" }, { localStatus: "PAID" }, { callbackStatus: "PROCESSED" }, { providerStatus: providerStatus === "UNKNOWN" ? "PAID" : "UNKNOWN" }]) {
      assert.equal(validateBuyerPaymentCheckReceipt({ ...receipt, ...patch }).ok, false);
    }
  }
});

test("buyer payment check has one fixed read-only request and rejects forged receipts", async () => {
  let calls = 0;
  const receipt = await checkExistingWp4BuyerPayment({ sourceSha: "a".repeat(40), previewHost: "fixed-preview.vercel.app", jobSecret: "synthetic" }, {
    request: async (request) => {
      calls++;
      assert.equal(request.url, "https://fixed-preview.vercel.app/api/admin/ops/payuni/wp4-buyer-payment-check");
      assert.equal(request.body, undefined);
      return { status: 200, body: { status: "VERIFIED", localStatus: "PAID", providerStatus: "PAID", referenceState: "AVAILABLE", queryAttempts: 1, callbackStatus: "PROCESSED", callbackFailure: "NONE" } };
    },
  });
  assert.equal(calls, 1);
  assert.equal(receipt.transactionSourceSha, BUYER_PAYMENT_CHECK_SOURCE_SHA);
  assert.equal(receipt.result, "PASS");
  assert.deepEqual(validateBuyerPaymentCheckReceipt(receipt), { ok: true, errors: [] });
  for (const patch of [{ paymentSubmissions: 1 }, { refundSubmissions: 1 }, { queryAttempts: 2 }, { queryAttempts: 0 }, { localStatus: "PENDING" }, { referenceState: "PROVIDER_MISSING" }, { transactionSourceSha: "a".repeat(40) }, { raw: "secret" }]) {
    assert.equal(validateBuyerPaymentCheckReceipt({ ...receipt, ...patch }).ok, false);
  }
});

test("buyer check records reference absence without a query and never leaks untrusted response", async () => {
  const input = { sourceSha: "a".repeat(40), previewHost: "fixed-preview.vercel.app", jobSecret: "synthetic" };
  const missing = await checkExistingWp4BuyerPayment(input, { request: async () => ({ status: 200, body: { status: "REFERENCE_UNAVAILABLE", localStatus: "PENDING", providerStatus: "UNKNOWN", referenceState: "PROVIDER_MISSING", queryAttempts: 0, callbackStatus: "FAILED", callbackFailure: "PROCESSING_FAILED" } }) });
  assert.equal(missing.result, "BLOCKED");
  assert.equal(missing.queryAttempts, 0);
  assert.equal(missing.callbackStatus, "FAILED");
  assert.equal(missing.callbackFailure, "PROCESSING_FAILED");
  assert.equal(missing.referenceState, "PROVIDER_MISSING");
  for (const patch of [{ callbackStatus: "raw-event" }, { callbackFailure: "secret" }, { callbackFailure: "NONE" }, { referenceState: "AVAILABLE" }, { referenceState: "secret" }]) {
    assert.equal(validateBuyerPaymentCheckReceipt({ ...missing, ...patch }).ok, false);
  }
  assert.equal(validateBuyerPaymentCheckReceipt(missing).ok, true);
  const malformed = await checkExistingWp4BuyerPayment(input, { request: async () => ({ status: 200, body: { status: "secret-token" } }) });
  assert.equal(malformed.status, "RESPONSE_INVALID");
  assert.equal(malformed.queryAttempts, 1);
  assert.equal(JSON.stringify(malformed).includes("secret-token"), false);
  assert.equal(validateBuyerPaymentCheckReceipt(malformed).ok, true);
  const network = await checkExistingWp4BuyerPayment(input, { request: async () => { throw new Error("secret-token"); } });
  assert.equal(network.status, "NETWORK_REJECTED");
  assert.equal(network.queryAttempts, 1);
  assert.equal(validateBuyerPaymentCheckReceipt(network).ok, true);
  const rejected = await checkExistingWp4BuyerPayment({}, { request: async () => { assert.fail("must not send"); } });
  assert.equal(validateBuyerPaymentCheckReceipt(rejected).ok, true);
});

test("buyer check receipt is written to its fixed allowlisted path and validated", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp4-buyer-check-"));
  try {
    const receipt = await checkExistingWp4BuyerPayment({});
    await writeBuyerPaymentCheckReceipt(receipt, temp);
    assert.equal(await validateWrittenBuyerPaymentCheckReceipt(temp), true);
    await assert.rejects(writeBuyerPaymentCheckReceipt({ ...receipt, raw: "must-not-persist" }, temp));
    assert.equal(await validateWrittenBuyerPaymentCheckReceipt(temp), true);
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith("wp4-buyer-check-"));
    await rm(temp, { recursive: true, force: true });
  }
});

test("classifies Chromium PayUni API network failures without persisting raw errors", () => {
  assert.equal(classifyPayUniApiNetworkFailure("net::ERR_NAME_NOT_RESOLVED"), "PAYMENT_API_DNS_REJECTED");
  assert.equal(classifyPayUniApiNetworkFailure("net::ERR_CONNECTION_TIMED_OUT"), "PAYMENT_API_TIMEOUT_REJECTED");
  assert.equal(classifyPayUniApiNetworkFailure("net::ERR_CERT_AUTHORITY_INVALID"), "PAYMENT_API_TLS_REJECTED");
  assert.equal(classifyPayUniApiNetworkFailure("net::ERR_CONNECTION_RESET"), "PAYMENT_API_CONNECTION_REJECTED");
  assert.equal(classifyPayUniApiNetworkFailure("net::ERR_BLOCKED_BY_CLIENT"), "PAYMENT_API_CLIENT_BLOCKED");
  assert.equal(classifyPayUniApiNetworkFailure("net::ERR_ABORTED"), "PAYMENT_API_NAVIGATION_ABORTED");
  assert.equal(classifyPayUniApiNetworkFailure("net::ERR_HTTP2_PROTOCOL_ERROR"), "PAYMENT_API_PROTOCOL_REJECTED");
  assert.equal(classifyPayUniApiNetworkFailure("net::ERR_EMPTY_RESPONSE"), "PAYMENT_API_EMPTY_RESPONSE");
  assert.equal(classifyPayUniApiNetworkFailure("net::ERR_FAILED"), "PAYMENT_API_GENERIC_FAILED");
  assert.equal(classifyPayUniApiNetworkFailure("opaque browser failure"), "PAYMENT_API_NETWORK_REJECTED");
  assert.equal(classifyPayUniApiNetworkFailure(undefined), "PAYMENT_API_NETWORK_REJECTED");
});

test("recognizes only the fixed PayUni Sandbox UPP payment page", () => {
  assert.equal(isPayUniPaymentPageUrl("https://sandbox-api.payuni.com.tw/api/upp"), true);
  assert.equal(isPayUniPaymentPageUrl(new URL("https://sandbox-api.payuni.com.tw/api/upp")), true);
  assert.equal(isPayUniPaymentPageUrl("https://sandbox-vendor.payuni.com.tw/api/upp"), false);
  assert.equal(isPayUniPaymentPageUrl("https://sandbox-api.payuni.com.tw/api/trade/query"), false);
  assert.equal(isPayUniPaymentPageUrl("http://sandbox-api.payuni.com.tw/api/upp"), false);
  assert.equal(isPayUniPaymentPageUrl("not-a-url"), false);
});

const sourceSha = "a".repeat(40);
const previewHost = "celebratedeal-wp4-20bc897.vercel.app";
const validInput = Object.freeze({
  sourceSha,
  previewHost,
  jobSecret: "test-job-secret",
  cardNumber: "4147 6310 0000 0001",
  cardExpiry: "1230",
  cardCvv: "123",
  payuniEnv: FIXED_PAYUNI_ENV,
});
const recoveryInput = Object.freeze({
  sourceSha,
  previewHost,
  jobSecret: "test-job-secret",
});

function response(status, body, cookies = []) {
  return { status, body, cookies };
}

function successfulDependencies(calls = []) {
  return {
    async request(request) {
      calls.push(request);
      if (request.url.endsWith("/wp4-fixture")) return response(200, { ready: true, createdCount: 6, reusedCount: 0 });
      if (request.url.endsWith("/checkout/admission")) {
        return {
          status: 200,
          body: {
            admissionToken: `ca1.${"a".repeat(64)}.${"b".repeat(43)}`,
            idempotencyKey: "11111111-1111-4111-8111-111111111111",
            expiresAt: "2030-01-01T00:00:00.000Z",
          },
          sessionCookie: "celebratedeal_checkout_session=opaque-admission-session",
        };
      }
      if (request.url.endsWith("/api/payments/checkout")) {
        return {
          status: 200,
          body: {
            ok: true,
            provider: "payuni",
            orderNumber: "CD-20300101000000-WP4A1",
            transactionId: "wp4-transaction-v1",
            amountCents: 100,
            currency: "TWD",
            checkoutUrl: null,
            formAction: "https://sandbox-api.payuni.com.tw/api/upp",
            formMethod: "POST",
            formPayload: { MerID: "merchant", Version: "2.0", EncryptInfo: "cipher", HashInfo: "hash" },
            nextAction: "submit_payuni_upp_form",
            externalRequired: false,
          },
          supportCookie: "celebrate_support_wp4=opaque-support-grant",
        };
      }
      if (request.url.endsWith("/wp4-payment-attempt")) {
        return response(200, { status: "SUBMIT_ALLOWED", reservationCreated: true });
      }
      if (request.url.endsWith("/wp4-buyer-order-proof")) {
        return response(200, { status: "VERIFIED", paymentStatus: "paid", orderStatus: "paid", orderCount: 1,
          paidEventCount: 1, orderEventCount: 1, reservationStatus: "committed", remainingInventory: 2 });
      }
      if (request.url.endsWith("/api/webhooks/payments?provider=payuni&source=notify")) {
        assert.deepEqual(request.body, Buffer.from("signed-synthetic-callback"));
        assert.deepEqual(request.headers, { "content-type": "application/x-www-form-urlencoded" });
        return response(200, { ok: true, duplicate: true, eventId: "synthetic-event" });
      }
      if (request.url.endsWith("/wp4-refund")) {
        return response(200, { status: "COMPLETED", purpose: "buyer_order", phase: "remaining", providerWriteAttempted: true });
      }
      if (request.url.endsWith("/wp4-reconcile")) return response(200, { reconciled: true, status: "RECONCILED" });
      throw new Error("unexpected request");
    },
    async browserSubmit(browserInput) {
      calls.push({ browserInput });
      assert.equal(browserInput.previewHost, previewHost);
      assert.equal(browserInput.transactionId, "wp4-transaction-v1");
      assert.equal(browserInput.captureReturnCallback, true);
      return { mapped: true, firstStatus: 303, signedReturnBody: Buffer.from("signed-synthetic-callback"), contentType: "application/x-www-form-urlencoded" };
    },
  };
}

test("issued recovery preparation reserves one checkout without submitting payment", async () => {
  const calls = [];
  const prepared = await prepareIssuedRecoveryCheckout(validInput, successfulDependencies(calls));
  assert.equal(prepared.checkout.formAction, "https://sandbox-api.payuni.com.tw/api/upp");
  assert.deepEqual(prepared.sideEffects, { fixturePosts: 1, admissionPosts: 1, checkoutPosts: 1, paymentAttemptPosts: 1 });
  assert.equal(calls.length, 4);
  assert.equal(calls.some((call) => call.browserInput), false);
});

test("issued recovery preparation rejects Production before any request", async () => {
  const calls = [];
  await assert.rejects(prepareIssuedRecoveryCheckout({ ...validInput, payuniEnv: "production" }, successfulDependencies(calls)), /ISSUED_RECOVERY_PREPARATION_REJECTED/u);
  assert.equal(calls.length, 0);
});

for (const [stage, expectedCalls] of [["/wp4-fixture", 1], ["/checkout/admission", 2], ["/api/payments/checkout", 3], ["/wp4-payment-attempt", 4]]) {
  test(`issued recovery preparation stops after invalid ${stage}`, async () => {
    const calls = [];
    const base = successfulDependencies(calls);
    await assert.rejects(prepareIssuedRecoveryCheckout(validInput, {
      request: async (request) => {
        const result = await base.request(request);
        return request.url.endsWith(stage) ? response(200, {}) : result;
      },
    }), /ISSUED_RECOVERY_PREPARATION_REJECTED/u);
    assert.equal(calls.length, expectedCalls);
  });
}

test("issued recovery preparation cannot resubmit an already paid checkout", async () => {
  const calls = [];
  const base = successfulDependencies(calls);
  await assert.rejects(prepareIssuedRecoveryCheckout(validInput, {
    request: async (request) => {
      const result = await base.request(request);
      return request.url.endsWith("/wp4-payment-attempt")
        ? response(200, { status: "ALREADY_PAID", reservationCreated: false }) : result;
    },
  }), /ISSUED_RECOVERY_PREPARATION_REJECTED/u);
  assert.equal(calls.length, 4);
  assert.equal(calls.some((call) => call.browserInput), false);
});

test("payment-only proves one paid order and duplicate callback without any refund or reconcile", async () => {
  const calls = [];
  const receipt = await runMvpPayUniPaymentOnly(validInput, successfulDependencies(calls));
  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.schemaVersion, MVP_PAYUNI_PAYMENT_ONLY_SCHEMA);
  assert.equal(receipt.checks.orderPersisted, true);
  assert.equal(receipt.checks.duplicateCallbackVerified, true);
  assert.equal(receipt.sideEffects.orderProofPosts, 2);
  assert.equal(receipt.sideEffects.callbackReplays, 1);
  assert.equal(receipt.sideEffects.browserPaymentSubmissions, 1);
  assert.equal(receipt.sideEffects.payments, 1);
  assert.equal(receipt.sideEffects.refundPosts, 0);
  assert.equal(receipt.sideEffects.refunds, 0);
  assert.equal(receipt.sideEffects.reconcilePosts, 0);
  assert.equal(calls.some(({ url }) => /refund|reconcile/u.test(url ?? "")), false);
  assert.deepEqual(validatePaymentOnlyReceipt(receipt), { ok: true, errors: [] });
  assert.equal(validateMvpPayUniReceipt(receipt).ok, false);
  const legacy = await runMvpPayUniSandboxE2E(validInput, successfulDependencies());
  assert.equal(legacy.result, "PASS");
  assert.equal(legacy.sideEffects.refunds, 1);
  assert.equal(validatePaymentOnlyReceipt(legacy).ok, false);
  for (const key of ["refundPosts", "refunds", "reconcilePosts"]) {
    assert.equal(validatePaymentOnlyReceipt({ ...receipt, sideEffects: { ...receipt.sideEffects, [key]: 1 } }).ok, false);
  }
  for (const key of ["returnCallbackMapped", "orderPersisted", "duplicateCallbackVerified"]) {
    assert.equal(validatePaymentOnlyReceipt({ ...receipt, checks: { ...receipt.checks, [key]: false } }).ok, false);
  }
});

test("payment-only stops on ambiguous submission, rejects original source and never retries", async () => {
  const calls = [];
  const dependencies = successfulDependencies(calls);
  let submits = 0;
  const browserDiagnostic = createPayUniBrowserDiagnostic();
  dependencies.browserDiagnostic = browserDiagnostic;
  dependencies.browserSubmit = async (browserInput) => {
    submits++;
    // The CLI-owned diagnostic sink reaches the browser step unchanged.
    assert.equal(browserInput.diagnostic, browserDiagnostic);
    return "PAYMENT_CONFIRMATION_AMBIGUOUS";
  };
  const receipt = await runMvpPayUniPaymentOnly(validInput, dependencies);
  assert.equal(submits, 1);
  assert.equal(Object.hasOwn(receipt, "diagnostic"), false);
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.failure, "PAYMENT_CONFIRMATION_AMBIGUOUS");
  assert.equal(receipt.sideEffects.callbackReplays, 0);
  assert.equal(receipt.sideEffects.refundPosts, 0);
  assert.equal(receipt.sideEffects.reconcilePosts, 0);
  assert.equal(validatePaymentOnlyReceipt(receipt).ok, true);
  calls.length = 0;
  const historical = await runMvpPayUniPaymentOnly({ ...validInput, sourceSha: BUYER_PAYMENT_CHECK_SOURCE_SHA }, dependencies);
  assert.equal(historical.failure, "INPUT_REJECTED");
  assert.equal(calls.length, 0);
  assert.equal(submits, 1);
});

test("payment-only persists only its own validated receipt at a fixed filename", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp4-payment-only-"));
  try {
    const receipt = await runMvpPayUniPaymentOnly(validInput, successfulDependencies());
    const written = await writePaymentOnlyReceipt(receipt, temp);
    assert.equal(path.basename(written), "wp4-payuni-sandbox-payment-only-receipt.json");
    assert.equal(await validateWrittenPaymentOnlyReceipt(temp), true);
    await assert.rejects(writePaymentOnlyReceipt({ ...receipt, raw: "private" }, temp));
    await assert.rejects(writePaymentOnlyReceipt(receipt, temp));
    assert.equal((await readFile(written, "utf8")).includes("signed-synthetic-callback"), false);
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith("wp4-payment-only-"));
    await rm(temp, { recursive: true, force: true });
  }
});

test("confirmation text becomes only a bounded failure category, never success", () => {
  for (const [text, expected] of [["卡號格式不正確", "CARD"], ["請輸入有效期限", "EXPIRY"],
    ["安全碼無效", "CVV"], ["電子信箱格式錯誤", "EMAIL"], ["持卡人姓名必填", "FIELD"]]) {
    assert.equal(classifyPayUniConfirmation(text), `PAYMENT_VALIDATION_${expected}`);
  }
  for (const text of ["付款成功", "是否確定付款？", "確定", "", undefined, "請輸入".repeat(1500)]) {
    assert.equal(classifyPayUniConfirmation(text), "PAYMENT_CONFIRMATION_AMBIGUOUS");
  }
});

function successfulSubscriptionDependencies(calls = []) {
  let stateReads = 0;
  return {
    async request(request) {
      calls.push(request);
      if (request.url.endsWith("/wp4-fixture")) return response(200, { ready: true, createdCount: 6, reusedCount: 0 });
      if (request.url.endsWith("/wp4-session")) {
        return { status: 204, sessionCookie: "__Host-celebrate_session=opaque-owner-session" };
      }
      if (request.url.endsWith("/wp4-subscription-payment-attempt")) {
        return response(200, { status: "SUBMIT_ALLOWED", reservationCreated: true });
      }
      if (request.url.endsWith("/wp4-subscription-state")) {
        stateReads += 1;
        return response(200, { status: stateReads === 1 ? "ACTIVE_VERIFIED" : "REFUNDED_VERIFIED" });
      }
      if (request.url.endsWith("/wp4-subscription-refund")) {
        return response(200, { status: "COMPLETED", purpose: FIXED_SUBSCRIPTION_PURPOSE, phase: "remaining", providerWriteAttempted: true });
      }
      if (request.url.endsWith("/wp4-subscription-reconcile")) return response(200, { reconciled: true, status: "RECONCILED" });
      throw new Error("unexpected request");
    },
    async browserSubmit(browserInput) {
      calls.push({ browserInput });
      assert.equal(browserInput.previewHost, previewHost);
      assert.equal(browserInput.ownerSessionCookie, "__Host-celebrate_session=opaque-owner-session");
      assert.equal(browserInput.markNativePlanCheckoutCreated(), true);
      assert.equal(await browserInput.reservePaymentAttempt(), true);
      assert.equal(browserInput.markPaymentSubmission(), true);
      return true;
    },
  };
}

test("buyer browser submission uses a fixed environment and fails closed on confirmation", async () => {
  let confirmationText = "是否確定付款？";
  let submitted = 0;
  let confirmationClicks = 0;
  let launchOptions;
  let postOptions;
  class TimeoutError extends Error {}
  const page = {
    on() {},
    async goto() {},
    async route() {},
    async waitForURL() {},
    getByText() { return { async click() {} }; },
    getByPlaceholder() { return { async pressSequentially() {}, async fill() {} }; },
    getByRole(_role, options) {
      if (options.name === "確認送出") return { async click() { submitted += 1; } };
      if (options.name === "確定") return { async waitFor() {}, async evaluate() { return confirmationText; }, async click() { confirmationClicks += 1; } };
      throw new Error("unexpected role");
    },
    locator() { return { async check() {} }; },
  };
  const browser = {
    async newContext() {
      return {
        async addCookies() {},
        async newPage() { return page; },
        request: { async post(_url, options) { postOptions = options; return { status: () => 200, ok: () => true }; } },
      };
    },
    async close() {},
  };
  const result = await defaultBrowserSubmit({
    previewHost,
    cardNumber: "4147631000000001",
    cardExpiry: "1230",
    cardCvv: "123",
    formPayload: { MerID: "merchant", Version: "2.0", EncryptInfo: "cipher", HashInfo: "hash" },
    supportCookie: "celebrate_support_wp4=opaque-support-grant",
    orderNumber: "CD-20300101000000-WP4A1",
  }, { playwright: { chromium: { async launch(options) { launchOptions = options; return browser; } }, errors: { TimeoutError } } });

  assert.equal(result, "PAYMENT_CONFIRMATION_AMBIGUOUS");
  assert.equal(submitted, 1);
  assert.equal(confirmationClicks, 0);
  assert.deepEqual(Object.keys(launchOptions.env).sort(), process.platform === "win32"
    ? ["PATH", "SystemRoot", "TEMP", "TMP"].sort()
    : ["HOME", "PATH", "TMPDIR"].sort());
  assert.equal(postOptions.maxRedirects, 0);
  confirmationText = "電子信箱格式錯誤 private@example.test";
  const classified = await defaultBrowserSubmit({ previewHost, cardNumber: "4147631000000001", cardExpiry: "1230", cardCvv: "123",
    formPayload: { MerID: "merchant" }, supportCookie: "celebrate_support_wp4=synthetic", orderNumber: "synthetic-order",
  }, { playwright: { chromium: { async launch() { return browser; } }, errors: { TimeoutError } } });
  assert.equal(classified, "PAYMENT_VALIDATION_EMAIL");
  assert.equal(submitted, 2); // Two independent mocked invocations, one submit each.
  assert.equal(confirmationClicks, 0);
  assert.equal(classified.includes("private@example.test"), false);
});

test("buyer browser captures only the exact signed Return POST after the real 303 callback", async () => {
  class TimeoutError extends Error {}
  const listeners = new Map();
  const signed = Buffer.from("signed-synthetic-callback");
  const callbackUrl = `https://${previewHost}/api/webhooks/payments?provider=payuni&source=return`;
  const page = {
    on(name, listener) { listeners.set(name, listener); },
    async goto() {}, async route() {}, async waitForURL() {},
    getByText() { return { async click() {} }; },
    getByPlaceholder() { return { async pressSequentially() {}, async fill() {} }; },
    getByRole(_role, options) {
      if (options.name === "確認送出") return { async click() {
        listeners.get("request")({ url: () => callbackUrl, method: () => "POST", postDataBuffer: () => signed,
          headers: () => ({ "content-type": "application/x-www-form-urlencoded" }) });
        listeners.get("response")({ url: () => callbackUrl, status: () => 303, request: () => ({ method: () => "POST" }) });
      } };
      if (options.name === "確定") return { async waitFor() { throw new TimeoutError(); } };
      throw new Error("unexpected role");
    },
    locator(selector) { return selector === "body"
      ? { async innerText() { return "CD-20300101000000-WP4A1 付款完成"; } }
      : { async check() {} }; },
  };
  const browser = { async newContext() { return { async addCookies() {}, async newPage() { return page; },
    request: { async post() { return { status: () => 200, ok: () => true }; } } }; }, async close() {} };
  const result = await defaultBrowserSubmit({ previewHost, cardNumber: "4147631000000001", cardExpiry: "1230",
    cardCvv: "123", formPayload: { MerID: "merchant" }, supportCookie: "celebrate_support_wp4=synthetic",
    orderNumber: "CD-20300101000000-WP4A1", captureReturnCallback: true,
  }, { playwright: { chromium: { async launch() { return browser; } }, errors: { TimeoutError } } });
  assert.deepEqual(result, { mapped: true, firstStatus: 303, signedReturnBody: signed,
    contentType: "application/x-www-form-urlencoded" });
});

test("a rejected PayUni card field records only the fixed step, error class and frame counts", async () => {
  class TimeoutError extends Error { constructor(message) { super(message); this.name = "TimeoutError"; } }
  const cardNumber = "4147631000000001";
  const mainFrame = { marker: "main" };
  const childFrame = { getByPlaceholder: (placeholder) => ({ count: async () => (placeholder === "MM/YY" ? 1 : 0) }) };
  const typed = [];
  const page = {
    on() {}, async goto() {}, async route() {}, async waitForURL() {},
    url: () => `https://sandbox-api.payuni.com.tw/api/upp?EncryptInfo=private-cipher&card=${cardNumber}`,
    mainFrame: () => mainFrame,
    frames: () => [mainFrame, childFrame],
    getByText() { return { async click() {} }; },
    getByPlaceholder(placeholder, options) {
      assert.equal(options?.exact, true, "every UPP placeholder lookup is exact");
      return {
        count: async () => 0,
        async pressSequentially(value) {
          if (placeholder === "MM/YY") throw new TimeoutError(`locator.pressSequentially: Timeout 30000ms exceeded. waiting for getByPlaceholder('MM/YY') ${cardNumber}`);
          typed.push(placeholder);
          assert.equal(typeof value, "string");
        },
        async fill() {},
      };
    },
    getByRole() { throw new Error("submit must not be reached"); },
    locator() { return { async check() {} }; },
  };
  const browser = { async newContext() { return { async addCookies() {}, async newPage() { return page; },
    request: { async post() { return { status: () => 200, ok: () => true }; } } }; }, async close() {} };
  const diagnostic = createPayUniBrowserDiagnostic();
  const result = await defaultBrowserSubmit({ previewHost, cardNumber, cardExpiry: "1230", cardCvv: "123",
    formPayload: { MerID: "merchant" }, supportCookie: "celebrate_support_wp4=synthetic",
    orderNumber: "CD-20300101000000-WP4A1", captureReturnCallback: true, diagnostic,
  }, { playwright: { chromium: { async launch() { return browser; } }, errors: { TimeoutError } } });
  assert.equal(result, "PAYMENT_FIELDS_REJECTED");
  assert.deepEqual(typed, ["**** **** **** ****"]);
  assert.deepEqual(diagnostic, {
    step: "CARD_EXPIRY", error: "TIMEOUT", page: "PAYUNI_UPP", mainFrameMatches: 0, childFrames: 1, childFrameMatches: 1,
    fieldSource: "PLACEHOLDER", creditTab: "NOT_TRIED",
    resourceFailures: { payuniScript: 0, payuniOther: 0, externalScript: 0, externalOther: 0 }, structure: [],
    submit: { captured: false, dialogs: [], modal: "NONE", host: "NONE", path: "NONE", errors: [] },
  });
  const line = formatPayUniBrowserDiagnostic(diagnostic);
  assert.equal(line, "step=CARD_EXPIRY; error=TIMEOUT; page=PAYUNI_UPP; mainFrameMatches=0; childFrames=1; childFrameMatches=1; fieldSource=PLACEHOLDER; creditTab=NOT_TRIED; failed_payuniScript=0; failed_payuniOther=0; failed_externalScript=0; failed_externalOther=0");
  assert.equal(line.includes(cardNumber), false);
});

test("browser diagnostic formatting rejects free text and unbounded counts", () => {
  assert.equal(formatPayUniBrowserDiagnostic({ step: "https://private", error: "x y", page: "PAYUNI_UPP", mainFrameMatches: 42, childFrames: -1, childFrameMatches: "1", fieldSource: "card 4147631000000001", creditTab: "x", resourceFailures: { payuniScript: 12, externalScript: "1" } }),
    "step=UNKNOWN; error=UNKNOWN; page=PAYUNI_UPP; mainFrameMatches=9; childFrames=UNKNOWN; childFrameMatches=UNKNOWN; fieldSource=UNKNOWN; creditTab=UNKNOWN; failed_payuniScript=9; failed_payuniOther=UNKNOWN; failed_externalScript=UNKNOWN; failed_externalOther=UNKNOWN");
  assert.equal(classifyPayUniBrowserPage(`https://${previewHost}/checkout/result?payment=updated`, previewHost), "OPERATION_HOST");
  assert.equal(classifyPayUniBrowserPage("https://sandbox-vendor.payuni.com.tw/x", previewHost), "PAYUNI_OTHER_HOST");
  assert.equal(classifyPayUniBrowserPage("https://evil.example.test/", previewHost), "OTHER");
  assert.equal(classifyPlaywrightErrorKind(new Error("strict mode violation: getByPlaceholder resolved to 2 elements")), "STRICT_MODE");
  assert.equal(classifyPlaywrightErrorKind("not an error"), "OTHER");
});

test("buyer fixture contract rejects stale five-entity and invalid counts", async () => {
  for (const createdCount of [5, 4]) {
    let browserCalled = false;
    const receipt = await runMvpPayUniSandboxE2E(validInput, {
      request: async () => response(200, { ready: true, createdCount, reusedCount: 0 }),
      browserSubmit: async () => { browserCalled = true; return true; },
    });
    assert.equal(receipt.failure, "FIXTURE_HTTP_REJECTED");
    assert.equal(browserCalled, false);
  }
});

test("buyer fixture accepts the six deterministic server rows before admission", async () => {
  const receipt = await runMvpPayUniSandboxE2E(validInput, {
    request: async () => response(200, { ready: true, createdCount: 2, reusedCount: 4 }),
  });
  assert.equal(receipt.checks.fixtureReady, true);
  assert.equal(receipt.sideEffects.admissionPosts, 1);
  assert.equal(receipt.failure, "ADMISSION_REJECTED");
  assert.deepEqual(validateMvpPayUniReceipt(receipt), { ok: true, errors: [] });
});

test("uses the native fixed plan browser flow once without treating the return page as subscription payment proof", async () => {
  class TimeoutError extends Error {}
  let selected = 0;
  let submitted = 0;
  let reserved = 0;
  let marked = 0;
  let nativeCheckouts = 0;
  let confirmationVisible = false;
  let confirmationClicks = 0;
  let ownerCookie;
  let closed = 0;
  const page = {
    on() {},
    async goto() {},
    async route() {},
    async waitForURL() {},
    getByText() { return { async click() {} }; },
    getByPlaceholder() { return { async pressSequentially() {}, async fill() {} }; },
    getByRole(_role, options) {
      if (options.name === "確認送出") return { async click() { submitted += 1; } };
      if (options.name === "確定") {
        return {
          async waitFor() { if (!confirmationVisible) throw new TimeoutError(); },
          async click() { confirmationClicks += 1; },
        };
      }
      throw new Error("unexpected role");
    },
    locator(selector) {
      if (selector.includes('/api/billing/plans/select')) {
        return { getByRole() { return { async click() { selected += 1; } }; } };
      }
      if (selector.includes('https://sandbox-api.payuni.com.tw/api/upp')) {
        return {
          async evaluateAll(callback) {
            return callback([
              { getAttribute: (name) => name === "name" ? "MerID" : "merchant" },
              { getAttribute: (name) => name === "name" ? "Version" : "2.0" },
              { getAttribute: (name) => name === "name" ? "EncryptInfo" : "cipher" },
              { getAttribute: (name) => name === "name" ? "HashInfo" : "hash" },
            ]);
          },
        };
      }
      return { async check() {} };
    },
  };
  const browser = {
    async newContext() {
      return {
        async addCookies(cookies) { ownerCookie = cookies[0]; },
        async newPage() { return page; },
        request: { async post() { return { status: () => 200, ok: () => true }; } },
      };
    },
    async close() { closed += 1; },
  };

  const result = await defaultSubscriptionBrowserSubmit({
    previewHost,
    ownerSessionCookie: "__Host-celebrate_session=opaque-owner-session",
    cardNumber: "4147631000000001",
    cardExpiry: "1230",
    cardCvv: "123",
    markNativePlanCheckoutCreated() { nativeCheckouts += 1; return nativeCheckouts === 1; },
    async reservePaymentAttempt() { reserved += 1; return true; },
    markPaymentSubmission() { marked += 1; return marked === 1; },
  }, { playwright: { chromium: { async launch() { return browser; } }, errors: { TimeoutError } } });

  assert.equal(result, true);
  assert.equal(selected, 1);
  assert.equal(reserved, 1);
  assert.equal(marked, 1);
  assert.equal(nativeCheckouts, 1);
  assert.equal(submitted, 1);
  assert.equal(ownerCookie.name, "__Host-celebrate_session");
  assert.equal(ownerCookie.path, "/");
  assert.equal(ownerCookie.secure, true);
  assert.equal(ownerCookie.url, undefined);
  assert.equal(closed, 1);

  selected = 0;
  submitted = 0;
  reserved = 0;
  marked = 0;
  nativeCheckouts = 0;
  confirmationVisible = true;
  const ambiguous = await defaultSubscriptionBrowserSubmit({
    previewHost,
    ownerSessionCookie: "__Host-celebrate_session=opaque-owner-session",
    cardNumber: "4147631000000001",
    cardExpiry: "1230",
    cardCvv: "123",
    markNativePlanCheckoutCreated() { nativeCheckouts += 1; return nativeCheckouts === 1; },
    async reservePaymentAttempt() { reserved += 1; return true; },
    markPaymentSubmission() { marked += 1; return marked === 1; },
  }, { playwright: { chromium: { async launch() { return browser; } }, errors: { TimeoutError } } });

  assert.equal(ambiguous, "PAYMENT_CONFIRMATION_AMBIGUOUS");
  assert.equal(selected, 1);
  assert.equal(reserved, 1);
  assert.equal(marked, 1);
  assert.equal(nativeCheckouts, 1);
  assert.equal(submitted, 1);
  assert.equal(confirmationClicks, 0);
});

test("subscription runner accepts only fixed server-owned subscription operations in mocked orchestration", async () => {
  const calls = [];
  const receipt = await runMvpPayUniSandboxSubscriptionE2E(validInput, successfulSubscriptionDependencies(calls));

  assert.equal(receipt.schemaVersion, MVP_PAYUNI_SANDBOX_SUBSCRIPTION_SCHEMA);
  assert.equal(receipt.purpose, FIXED_SUBSCRIPTION_PURPOSE);
  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.checks.trustedSubscriptionPayment, true);
  assert.equal(receipt.sideEffects.payments, 1);
  assert.equal(calls.some((call) => call.url?.endsWith("/wp4-subscription-payment-attempt")), true);
  assert.equal(calls.some((call) => call.url?.endsWith("/wp4-subscription-refund")), true);
  assert.equal(calls.some((call) => call.url?.endsWith("/wp4-subscription-reconcile")), true);
  assert.equal(JSON.stringify(receipt).includes("opaque-owner-session"), false);
  assert.deepEqual(validateMvpPayUniSubscriptionReceipt(receipt), { ok: true, errors: [] });
});

test("subscription marks the native transaction before rejecting an invalid server-rendered PayUni form", async () => {
  let marked = 0;
  let reservations = 0;
  let providerPosts = 0;
  const page = {
    on() {},
    async goto() {},
    async waitForURL() {},
    locator(selector) {
      if (selector.includes('/api/billing/plans/select')) {
        return { getByRole() { return { async click() {} }; } };
      }
      return {
        async evaluateAll(callback) {
          return callback([{ getAttribute: (name) => name === "name" ? "MerID" : "merchant" }]);
        },
      };
    },
  };
  const browser = {
    async newContext() {
      return {
        async addCookies() {},
        async newPage() { return page; },
        request: { async post() { providerPosts += 1; throw new Error("must not submit"); } },
      };
    },
    async close() {},
  };

  const result = await defaultSubscriptionBrowserSubmit({
    previewHost,
    ownerSessionCookie: "__Host-celebrate_session=opaque-owner-session",
    cardNumber: "4147631000000001",
    cardExpiry: "1230",
    cardCvv: "123",
    markNativePlanCheckoutCreated() { marked += 1; return true; },
    async reservePaymentAttempt() { reservations += 1; return true; },
    markPaymentSubmission() { throw new Error("must not submit"); },
  }, { playwright: { chromium: { async launch() { return browser; } }, errors: { TimeoutError: class TimeoutError extends Error {} } } });

  assert.equal(result, "CHECKOUT_REJECTED");
  assert.equal(marked, 1);
  assert.equal(reservations, 0);
  assert.equal(providerPosts, 0);
});

test("subscription checkout failure before the native redirect preserves zero transaction creation", async () => {
  const dependencies = successfulSubscriptionDependencies();
  dependencies.browserSubmit = async () => "CHECKOUT_REJECTED";

  const receipt = await runMvpPayUniSandboxSubscriptionE2E(validInput, dependencies);

  assert.equal(receipt.failure, "CHECKOUT_REJECTED");
  assert.equal(receipt.sideEffects.planSelections, 1);
  assert.equal(receipt.sideEffects.transactionsCreated, 0);
  assert.equal(receipt.sideEffects.paymentAttemptPosts, 0);
  assert.deepEqual(validateMvpPayUniSubscriptionReceipt(receipt), { ok: true, errors: [] });
});

test("subscription existing reservation stops before a second browser submission and preserves attempted counters", async () => {
  const calls = [];
  const dependencies = successfulSubscriptionDependencies(calls);
  const originalRequest = dependencies.request;
  dependencies.request = async (request) => request.url.endsWith("/wp4-subscription-payment-attempt")
    ? response(409, { status: "ALREADY_RESERVED", reservationCreated: false })
    : originalRequest(request);
  dependencies.browserSubmit = async (browserInput) => {
    assert.equal(browserInput.markNativePlanCheckoutCreated(), true);
    assert.equal(await browserInput.reservePaymentAttempt(), "PAYMENT_ATTEMPT_ALREADY_RESERVED");
    return "PAYMENT_ATTEMPT_ALREADY_RESERVED";
  };

  const receipt = await runMvpPayUniSandboxSubscriptionE2E(validInput, dependencies);

  assert.equal(receipt.failure, "PAYMENT_ATTEMPT_ALREADY_RESERVED");
  assert.equal(receipt.sideEffects.planSelections, 1);
  assert.equal(receipt.sideEffects.transactionsCreated, 1);
  assert.equal(receipt.sideEffects.paymentAttemptPosts, 1);
  assert.equal(receipt.sideEffects.browserPaymentSubmissions, 0);
  assert.equal(receipt.sideEffects.refundPosts, 0);
  assert.equal(calls.some((call) => call.url?.endsWith("/wp4-subscription-refund")), false);
  assert.deepEqual(validateMvpPayUniSubscriptionReceipt(receipt), { ok: true, errors: [] });
});

test("subscription rejects invalid or production input without any request or browser side effect", async () => {
  for (const input of [
    { ...validInput, payuniEnv: "production" },
    { ...validInput, previewHost: "app.example.test" },
    { ...validInput, sourceSha: "not-a-sha" },
  ]) {
    let requests = 0;
    let browserSubmissions = 0;
    const receipt = await runMvpPayUniSandboxSubscriptionE2E(input, {
      async request() { requests += 1; throw new Error("must not run"); },
      async browserSubmit() { browserSubmissions += 1; throw new Error("must not run"); },
    });
    assert.equal(receipt.failure, "INPUT_REJECTED");
    assert.equal(receipt.sideEffects.fixturePosts, 0);
    assert.equal(requests, 0);
    assert.equal(browserSubmissions, 0);
    assert.deepEqual(validateMvpPayUniSubscriptionReceipt(receipt), { ok: true, errors: [] });
  }
});

test("subscription already-paid candidate does not submit, refund, or reconcile without a dedicated payment proof", async () => {
  const calls = [];
  const dependencies = successfulSubscriptionDependencies(calls);
  const originalRequest = dependencies.request;
  dependencies.request = async (request) => request.url.endsWith("/wp4-subscription-payment-attempt")
    ? response(200, { status: "ALREADY_PAID", reservationCreated: false })
    : originalRequest(request);
  dependencies.browserSubmit = async (browserInput) => {
    assert.equal(browserInput.markNativePlanCheckoutCreated(), true);
    assert.equal(await browserInput.reservePaymentAttempt(), "RETURN_CALLBACK_PROOF_REQUIRED");
    return "RETURN_CALLBACK_PROOF_REQUIRED";
  };

  const receipt = await runMvpPayUniSandboxSubscriptionE2E(validInput, dependencies);

  assert.equal(receipt.failure, "RETURN_CALLBACK_PROOF_REQUIRED");
  assert.equal(receipt.sideEffects.browserPaymentSubmissions, 0);
  assert.equal(receipt.sideEffects.payments, 0);
  assert.equal(receipt.sideEffects.refundPosts, 0);
  assert.equal(receipt.sideEffects.reconcilePosts, 0);
  assert.equal(calls.some((call) => call.url?.endsWith("/wp4-subscription-refund")), false);
  assert.deepEqual(validateMvpPayUniSubscriptionReceipt(receipt), { ok: true, errors: [] });
});

test("subscription ambiguous browser outcome keeps its one submission counter and stops before refund", async () => {
  const calls = [];
  const dependencies = successfulSubscriptionDependencies(calls);
  dependencies.browserSubmit = async (browserInput) => {
    assert.equal(browserInput.markNativePlanCheckoutCreated(), true);
    assert.equal(await browserInput.reservePaymentAttempt(), true);
    assert.equal(browserInput.markPaymentSubmission(), true);
    return "PAYMENT_CONFIRMATION_AMBIGUOUS";
  };

  const receipt = await runMvpPayUniSandboxSubscriptionE2E(validInput, dependencies);

  assert.equal(receipt.failure, "PAYMENT_CONFIRMATION_AMBIGUOUS");
  assert.equal(receipt.sideEffects.browserPaymentSubmissions, 1);
  assert.equal(receipt.sideEffects.payments, 0);
  assert.equal(receipt.sideEffects.refundPosts, 0);
  assert.equal(receipt.sideEffects.reconcilePosts, 0);
  assert.equal(calls.some((call) => call.url?.endsWith("/wp4-subscription-refund")), false);
  assert.deepEqual(validateMvpPayUniSubscriptionReceipt(receipt), { ok: true, errors: [] });
});

test("subscription unresolved refund performs one refund request and only the bounded reconciliation queries", async () => {
  const calls = [];
  const dependencies = successfulSubscriptionDependencies(calls);
  const originalRequest = dependencies.request;
  dependencies.request = async (request) => {
    if (request.url.endsWith("/wp4-subscription-refund")) {
      calls.push(request);
      return response(503, { status: "RECONCILIATION_REQUIRED", purpose: FIXED_SUBSCRIPTION_PURPOSE, phase: "remaining", providerWriteAttempted: true });
    }
    if (request.url.endsWith("/wp4-subscription-reconcile")) {
      calls.push(request);
      return response(409, { reconciled: false, status: "UNKNOWN" });
    }
    return originalRequest(request);
  };
  dependencies.wait = async () => {};

  const receipt = await runMvpPayUniSandboxSubscriptionE2E(validInput, dependencies);

  assert.equal(receipt.failure, "RECONCILE_REJECTED");
  assert.equal(receipt.sideEffects.browserPaymentSubmissions, 1);
  assert.equal(receipt.sideEffects.refundPosts, 1);
  assert.equal(receipt.sideEffects.refunds, 0);
  assert.equal(receipt.sideEffects.reconcilePosts, 12);
  assert.equal(calls.filter((call) => call.url?.endsWith("/wp4-subscription-refund")).length, 1);
  assert.equal(calls.filter((call) => call.url?.endsWith("/wp4-subscription-reconcile")).length, 12);
  assert.deepEqual(validateMvpPayUniSubscriptionReceipt(receipt), { ok: true, errors: [] });
});

test("subscription wrong-purpose refund cannot produce a refund PASS despite verified activation", async () => {
  const dependencies = successfulSubscriptionDependencies();
  const originalRequest = dependencies.request;
  dependencies.request = async (request) => request.url.endsWith("/wp4-subscription-refund")
    ? response(200, { status: "COMPLETED", purpose: "buyer_order", phase: "remaining", providerWriteAttempted: true })
    : originalRequest(request);

  const receipt = await runMvpPayUniSandboxSubscriptionE2E(validInput, dependencies);

  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.failure, "REFUND_REJECTED");
  assert.equal(receipt.sideEffects.browserPaymentSubmissions, 1);
  assert.equal(receipt.sideEffects.refundPosts, 1);
  assert.equal(receipt.sideEffects.payments, 1);
  assert.equal(receipt.checks.trustedSubscriptionPayment, true);
  assert.equal(receipt.checks.refundCompleted, false);
  assert.equal(receipt.sideEffects.refunds, 0);
  assert.deepEqual(validateMvpPayUniSubscriptionReceipt(receipt), { ok: true, errors: [] });
});

test("subscription stops before refund when activation or quota is unverified", async () => {
  for (const body of [{ status: "STATE_UNVERIFIED" }, { status: "REFUNDED_VERIFIED" }, { status: "ACTIVE_VERIFIED", raw: "not-allowed" }]) {
    const calls = [];
    const dependencies = successfulSubscriptionDependencies(calls);
    const originalRequest = dependencies.request;
    dependencies.request = async (request) => request.url.endsWith("/wp4-subscription-state")
      ? response(200, body) : originalRequest(request);
    const receipt = await runMvpPayUniSandboxSubscriptionE2E(validInput, dependencies);
    assert.equal(receipt.failure, "SUBSCRIPTION_STATE_REJECTED");
    assert.equal(receipt.sideEffects.statePosts, 1);
    assert.equal(receipt.sideEffects.browserPaymentSubmissions, 1);
    assert.equal(receipt.sideEffects.refundPosts, 0);
    assert.equal(receipt.checks.activeEntitlementVerified, false);
    assert.equal(calls.some((call) => call.url?.endsWith("/wp4-subscription-refund")), false);
    assert.deepEqual(validateMvpPayUniSubscriptionReceipt(receipt), { ok: true, errors: [] });
  }
});

test("subscription cannot PASS while refunded entitlements remain active", async () => {
  const dependencies = successfulSubscriptionDependencies();
  const originalRequest = dependencies.request;
  dependencies.request = async (request) => request.url.endsWith("/wp4-subscription-state")
    ? response(200, { status: "ACTIVE_VERIFIED" }) : originalRequest(request);
  const receipt = await runMvpPayUniSandboxSubscriptionE2E(validInput, dependencies);
  assert.equal(receipt.failure, "SUBSCRIPTION_STATE_REJECTED");
  assert.equal(receipt.sideEffects.statePosts, 2);
  assert.equal(receipt.sideEffects.payments, 1);
  assert.equal(receipt.sideEffects.refunds, 1);
  assert.equal(receipt.checks.reconciled, true);
  assert.equal(receipt.checks.refundedEntitlementVerified, false);
  assert.deepEqual(validateMvpPayUniSubscriptionReceipt(receipt), { ok: true, errors: [] });
  assert.equal(validateMvpPayUniSubscriptionReceipt({ ...receipt, result: "PASS", failure: "NONE" }).ok, false);
});

test("subscription receipt rejects a wrong purpose or persisted session material", async () => {
  const receipt = createSubscriptionReceipt(sourceSha);
  receipt.purpose = "buyer_order";
  assert.equal(validateMvpPayUniSubscriptionReceipt(receipt).errors.includes("FIXED_ENUMS"), true);

  const unsafe = createSubscriptionReceipt(sourceSha);
  unsafe.ownerSessionCookie = "opaque-owner-session";
  assert.equal(validateMvpPayUniSubscriptionReceipt(unsafe).errors.includes("SCHEMA_KEYS"), true);
});

test("subscription receipt uses its fixed filename and rejects fabricated completion", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "celebratedeal-wp4-subscription-"));
  try {
    const receipt = await runMvpPayUniSandboxSubscriptionE2E(validInput, successfulSubscriptionDependencies());
    receipt.checks.trustedSubscriptionPayment = false;
    await writeMvpPayUniSubscriptionReceipt(receipt, temporaryRoot);
    assert.equal(await validateWrittenMvpPayUniSubscriptionReceipt(temporaryRoot), false);
    assert.equal(finalizeMvpPayUniSubscriptionReceipt(receipt).failure, "INTERNAL_REJECTED");
  } finally {
    assert.equal(path.dirname(temporaryRoot), os.tmpdir());
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 0 });
  }
});

test("reads only the fixed documented process inputs", () => {
  const input = readFixedInputs({
    CELEBRATEDEAL_SOURCE_SHA: sourceSha,
    CELEBRATEDEAL_DEPLOYMENT_HOST: previewHost,
    JOB_SECRET: "secret",
    PAYUNI_SANDBOX_ONETIME_CARD_NO: "4147631000000001",
    PAYUNI_TEST_EXPIRY: "1230",
    PAYUNI_TEST_CVV: "123",
    PAYUNI_ENV: "sandbox",
    UNRELATED_SECRET: "must-not-be-read",
  });
  assert.deepEqual(Object.keys(input).sort(), ["cardCvv", "cardExpiry", "cardNumber", "jobSecret", "payuniEnv", "previewHost", "sourceSha"].sort());
  assert.equal(validateInvocation(input).ok, true);
});

test("recovery reads only source, Preview host, and job binding", () => {
  const input = readExistingRefundRecoveryInputs({
    CELEBRATEDEAL_SOURCE_SHA: EXISTING_REFUND_RECOVERY_SOURCE_SHA,
    CELEBRATEDEAL_DEPLOYMENT_HOST: previewHost,
    JOB_SECRET: "secret",
    PAYUNI_SANDBOX_ONETIME_CARD_NO: "must-not-be-read",
    PAYUNI_TEST_EXPIRY: "must-not-be-read",
    PAYUNI_TEST_CVV: "must-not-be-read",
  });
  assert.deepEqual(Object.keys(input).sort(), ["jobSecret", "previewHost", "sourceSha"]);
  assert.equal(validateExistingRefundRecoveryInvocation(input).ok, true);
});

test("fixed existing-refund recovery performs one reconcile query with zero payment or refund submissions", async () => {
  const calls = [];
  const receipt = await recoverExistingWp4BuyerRefund(recoveryInput, {
    request: async (request) => {
      calls.push(request);
      assert.equal(request.url, `https://${previewHost}/api/admin/ops/payuni/wp4-refund-recovery`);
      assert.deepEqual(request.headers, {
        authorization: "Bearer test-job-secret",
        "x-celebratedeal-source-sha": sourceSha,
      });
      assert.equal(request.body, undefined);
      return response(200, { reconciled: true, status: "RECONCILED" });
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(receipt.schemaVersion, EXISTING_REFUND_RECOVERY_SCHEMA);
  assert.equal(receipt.sourceSha, sourceSha);
  assert.equal(receipt.transactionSourceSha, EXISTING_REFUND_RECOVERY_SOURCE_SHA);
  assert.equal(receipt.result, "RECONCILED");
  assert.equal(receipt.status, "RECONCILED");
  assert.equal(receipt.queryAttempts, 1);
  assert.equal(receipt.paymentSubmissions, 0);
  assert.equal(receipt.refundSubmissions, 0);
  assert.deepEqual(validateExistingRefundRecoveryReceipt(receipt), { ok: true, errors: [] });
});

test("existing-refund recovery fails closed for unknown responses and never queries a wrong source", async () => {
  const unknown = await recoverExistingWp4BuyerRefund(recoveryInput, {
    request: async () => response(200, { reconciled: true, status: "UNKNOWN" }),
  });
  assert.equal(unknown.result, "BLOCKED");
  assert.equal(unknown.status, "RESPONSE_INVALID");
  assert.equal(unknown.queryAttempts, 1);
  assert.equal(unknown.paymentSubmissions, 0);
  assert.equal(unknown.refundSubmissions, 0);
  assert.deepEqual(validateExistingRefundRecoveryReceipt(unknown), { ok: true, errors: [] });

  let requests = 0;
  const wrongSource = await recoverExistingWp4BuyerRefund({ ...recoveryInput, sourceSha: "invalid" }, {
    request: async () => { requests += 1; throw new Error("must not run"); },
  });
  assert.equal(requests, 0);
  assert.equal(wrongSource.result, "BLOCKED");
  assert.equal(wrongSource.status, "INPUT_REJECTED");
  assert.equal(wrongSource.queryAttempts, 0);
  assert.equal(wrongSource.paymentSubmissions, 0);
  assert.equal(wrongSource.refundSubmissions, 0);
  assert.deepEqual(validateExistingRefundRecoveryReceipt(wrongSource), { ok: true, errors: [] });
});

test("recovery preserves fixed query diagnostics without accepting raw provider fields", async () => {
  for (const status of ["QUERY_AUTHENTICATION_FAILED", "QUERY_REQUEST_REJECTED", "QUERY_RESPONSE_REJECTED", "QUERY_NETWORK_FAILED", "QUERY_UNKNOWN_FAILED"]) {
    let calls = 0;
    const receipt = await recoverExistingWp4BuyerRefund(recoveryInput, {
      request: async () => { calls += 1; return response(503, { reconciled: false, status }); },
    });
    assert.equal(calls, 1);
    assert.equal(receipt.result, "UNRESOLVED");
    assert.equal(receipt.status, status);
    assert.deepEqual(validateExistingRefundRecoveryReceipt(receipt), { ok: true, errors: [] });
    assert.equal(validateExistingRefundRecoveryReceipt({ ...receipt, result: "RECONCILED" }).ok, false);
    assert.equal(validateExistingRefundRecoveryReceipt({ ...receipt, transactionSourceSha: sourceSha }).ok, false);
    assert.equal(validateExistingRefundRecoveryReceipt({ ...receipt, queryAttempts: 0 }).ok, false);
  }
  for (const status of [
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
  ]) {
    const receipt = await recoverExistingWp4BuyerRefund(recoveryInput, {
      request: async () => response(503, { reconciled: false, status }),
    });
    assert.equal(receipt.result, "UNRESOLVED");
    assert.equal(receipt.status, status);
    assert.deepEqual(validateExistingRefundRecoveryReceipt(receipt), { ok: true, errors: [] });
  }
  for (const body of [
    { reconciled: false, status: "QUERY_RESPONSE_REJECTED", raw: "must-not-escape" },
    { reconciled: true, status: "QUERY_RESPONSE_REJECTED" },
  ]) {
    const receipt = await recoverExistingWp4BuyerRefund(recoveryInput, { request: async () => response(503, body) });
    assert.equal(receipt.status, "RESPONSE_INVALID");
    assert.equal(JSON.stringify(receipt).includes("must-not-escape"), false);
  }
  const arbitrary = await recoverExistingWp4BuyerRefund(recoveryInput, {
    request: async () => response(503, { reconciled: false, status: "RECONCILIATION_FORGED" }),
  });
  assert.equal(arbitrary.status, "RESPONSE_INVALID");
});

test("recovery preserves only fixed transaction stages and elapsed bands with zero submissions", async () => {
  const status = "RECONCILIATION_DATABASE_TRANSACTION_FAILED";
  for (const stage of ["TRANSACTION_START", "LOAD_TRANSACTION", "LOAD_RESERVATIONS", "LOAD_TOTALS", "RELEASE_RESERVATION", "UPDATE_RESERVATION", "UPDATE_TRANSACTION", "PLATFORM_PROJECTION", "PAYMENT_ACCOUNTING", "AUDIT", "COMMIT"]) {
    for (const elapsedBucket of ["LT_5S", "FROM_5S_TO_15S", "GE_15S"]) {
      const transactionFailure = { stage, elapsedBucket };
      let calls = 0;
      const receipt = await recoverExistingWp4BuyerRefund(recoveryInput, {
        request: async () => { calls += 1; return response(503, { reconciled: false, status, transactionFailure }); },
      });
      assert.equal(calls, 1);
      assert.equal(receipt.result, "UNRESOLVED");
      assert.equal(receipt.paymentSubmissions, 0);
      assert.equal(receipt.refundSubmissions, 0);
      assert.deepEqual(receipt.transactionFailure, transactionFailure);
      assert.notEqual(receipt.transactionFailure, transactionFailure);
      assert.deepEqual(validateExistingRefundRecoveryReceipt(receipt), { ok: true, errors: [] });
      assert.equal(validateExistingRefundRecoveryReceipt({ ...receipt, status: "RECONCILED", result: "RECONCILED" }).ok, false);
      assert.equal(validateExistingRefundRecoveryReceipt({ ...receipt, queryAttempts: 0 }).ok, false);
    }
  }
});

test("recovery rejects arbitrary transaction diagnostics in responses and stored receipts", async () => {
  const status = "RECONCILIATION_DATABASE_TRANSACTION_FAILED";
  for (const transactionFailure of [
    null, {}, { stage: "PAYMENT_ACCOUNTING" },
    { stage: "must-not-escape", elapsedBucket: "LT_5S" },
    { stage: "COMMIT", elapsedBucket: 5000 },
    { stage: "COMMIT", elapsedBucket: "LT_5S", raw: "must-not-escape" },
  ]) {
    const receipt = await recoverExistingWp4BuyerRefund(recoveryInput, {
      request: async () => response(503, { reconciled: false, status, transactionFailure }),
    });
    assert.equal(receipt.status, "RESPONSE_INVALID");
    assert.equal(Object.hasOwn(receipt, "transactionFailure"), false);
    assert.equal(JSON.stringify(receipt).includes("must-not-escape"), false);
    const forged = { ...createExistingRefundRecoveryReceipt(sourceSha), status, result: "UNRESOLVED", queryAttempts: 1, transactionFailure };
    assert.equal(validateExistingRefundRecoveryReceipt(forged).ok, false);
  }
  for (const [httpStatus, otherStatus, reconciled] of [[200, "RECONCILED", true], [503, "RECONCILIATION_UNKNOWN_FAILED", false]]) {
    const receipt = await recoverExistingWp4BuyerRefund(recoveryInput, {
      request: async () => response(httpStatus, { reconciled, status: otherStatus, transactionFailure: { stage: "COMMIT", elapsedBucket: "LT_5S" } }),
    });
    assert.equal(receipt.status, "RESPONSE_INVALID");
  }
});

test("recovery receipt is separately validated and cannot gain payment or refund submissions", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "celebratedeal-wp4-recovery-"));
  try {
    const receipt = await recoverExistingWp4BuyerRefund(recoveryInput, {
      request: async () => response(409, { reconciled: false, status: "REFUND_NOT_CONFIRMED" }),
    });
    await writeExistingRefundRecoveryReceipt(receipt, temporaryRoot);
    assert.equal(await validateWrittenExistingRefundRecoveryReceipt(temporaryRoot), true);

    const invalid = createExistingRefundRecoveryReceipt();
    invalid.paymentSubmissions = 1;
    assert.equal(validateExistingRefundRecoveryReceipt(invalid).errors.includes("SUBMISSION_BUDGET"), true);
  } finally {
    assert.equal(path.dirname(temporaryRoot), os.tmpdir());
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 0 });
  }
});

test("derives a stable UUID idempotency key from the exact source", () => {
  const key = fixedCheckoutIdempotencyKey(sourceSha);
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.equal(fixedCheckoutIdempotencyKey(sourceSha), key);
  assert.equal(fixedCheckoutIdempotencyKey("main"), null);
});

test("fails closed for non-preview host, non-sandbox env, invalid SHA, and invalid card fields", () => {
  for (const input of [
    { ...validInput, previewHost: "app.example.com" },
    { ...validInput, previewHost: "https://preview.vercel.app" },
    { ...validInput, payuniEnv: "production" },
    { ...validInput, sourceSha: "main" },
    { ...validInput, cardNumber: "411111111111111" },
    { ...validInput, cardExpiry: "1330" },
    { ...validInput, cardCvv: "1234" },
  ]) {
    assert.deepEqual(validateInvocation(input), { ok: false, code: "INPUT_REJECTED" });
  }
});

test("uses the trusted runner multi-address host map without a second single-edge pin", async () => {
  const source = await readFile(new URL("./mvp-payuni-sandbox-e2e.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:dns\/promises/u);
  assert.doesNotMatch(source, /--host-resolver-rules=/u);
  assert.match(source, /--no-proxy-server/u);
  assert.match(source, /--disable-quic/u);
});

test("preserves only allowlisted fixture failure classifications in the sanitized receipt", async () => {
  const cases = [
    [401, null, "FIXTURE_AUTHORIZATION_REJECTED"],
    [404, "EXECUTOR_DISABLED", "FIXTURE_EXECUTOR_DISABLED"],
    [503, "SOURCE_CONFIGURATION_UNAVAILABLE", "FIXTURE_SOURCE_CONFIGURATION_UNAVAILABLE"],
    [404, "SOURCE_MISMATCH", "FIXTURE_SOURCE_MISMATCH"],
    [404, "BODY_REJECTED", "FIXTURE_BODY_REJECTED"],
    [409, null, "FIXTURE_CONFLICT"],
    [503, "DB_PRODUCT_P2022", "FIXTURE_DB_PRODUCT_P2022"],
    [503, "DB_TRANSACTION_OTHER", "FIXTURE_DB_TRANSACTION_OTHER"],
    [503, "UNCLASSIFIED_FAILURE", "FIXTURE_UNCLASSIFIED_FAILURE"],
    [503, "DB_PRODUCT_PRIVATE", "FIXTURE_HTTP_503"],
    [503, "untrusted-detail", "FIXTURE_HTTP_503"],
    [403, null, "FIXTURE_HTTP_403"],
    [502, null, "FIXTURE_HTTP_502"],
  ];
  for (const [status, outcome, expected] of cases) {
    const receipt = await runMvpPayUniSandboxE2E(validInput, {
      request: async (request) => {
        assert.equal(request.outcomeHeader, "x-celebratedeal-wp4-fixture");
        return { status, body: { error: "Not found" }, outcome };
      },
    });
    assert.equal(receipt.failure, expected);
    assert.deepEqual(validateMvpPayUniReceipt(receipt), { ok: true, errors: [] });
  }
});

const stagingAlias = "celebrate-deal-staging.carry-digital-nomad.in.net";

function aliasHealthResponse({ commitSha = sourceSha, vercelUrl = previewHost, status = 200, body } = {}) {
  const payload = body ?? { ok: true, database: "ok", latencyMs: 2, deployment: { commitSha, deploymentId: "dpl_Fixture123", vercelUrl } };
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

const masterCompareUrl = `https://api.github.com/repos/Forty-s-AI-Company/CelebrateDeal/compare/${sourceSha}...master`;

function masterThenAlias(alias = () => aliasHealthResponse(), calls = [], compare = { status: "ahead", merge_base_commit: { sha: sourceSha } }) {
  return async (url, init) => {
    calls.push(String(url));
    if (String(url) === masterCompareUrl) return new Response(JSON.stringify(compare), { status: 200 });
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "manual");
    return alias();
  };
}

test("verifies exact Preview lineage, protected master, then proves the alias serves that deployment", async () => {
  const source = {
    CELEBRATEDEAL_SOURCE_SHA: sourceSha,
    CELEBRATEDEAL_DEPLOYMENT_HOST: previewHost,
    GITHUB_TOKEN: "test-github-token",
  };
  const verifyDeploymentImpl = async (received) => {
    assert.equal(received.CELEBRATEDEAL_SOURCE_SHA, sourceSha);
    assert.equal(received.CELEBRATEDEAL_DEPLOYMENT_HOST, previewHost);
    return { host: previewHost, deploymentMatched: true, sourceMatched: true, preview: true, ready: true };
  };
  const calls = [];
  assert.equal(await verifyMvpPayUniLineage(source, { verifyDeploymentImpl, fetchImpl: masterThenAlias(undefined, calls) }), true);
  // Vercel firewalls the immutable Preview host (403 deny); it is never probed directly.
  assert.deepEqual(calls, [masterCompareUrl, `https://${stagingAlias}/api/health`]);

  assert.equal(await verifyMvpPayUniLineage({ ...source, CELEBRATEDEAL_DEPLOYMENT_HOST: "example.com" }), false);
  assert.equal(await verifyMvpPayUniLineage({ ...source, GITHUB_TOKEN: "" }), false);
  assert.equal(await verifyMvpPayUniLineage(source, {
    verifyDeploymentImpl: async () => ({ host: previewHost, deploymentMatched: true, sourceMatched: false, preview: true, ready: true }),
  }), false);
});

test("a non-master SHA is BLOCKED on every surface even when the alias attestation would pass", async () => {
  const verifyDeploymentImpl = async () => ({ host: previewHost, deploymentMatched: true, sourceMatched: true, preview: true, ready: true });
  for (const surface of [undefined, "fixed_alias", "immutable_preview"]) {
    const source = {
      CELEBRATEDEAL_SOURCE_SHA: sourceSha,
      CELEBRATEDEAL_DEPLOYMENT_HOST: previewHost,
      GITHUB_TOKEN: "test-github-token",
      ...(surface ? { CELEBRATEDEAL_BROWSER_SURFACE: surface } : {}),
    };
    const calls = [];
    const fetchImpl = masterThenAlias(undefined, calls, { status: "diverged", merge_base_commit: { sha: "c".repeat(40) } });
    assert.equal(await diagnoseMvpPayUniLineage(source, { verifyDeploymentImpl, fetchImpl }), "SOURCE_NOT_ON_PROTECTED_MASTER", String(surface));
    assert.deepEqual(calls, [masterCompareUrl], String(surface));
  }
});

test("alias attestation failures keep the lineage gate BLOCKED with a fixed reason", async () => {
  const source = {
    CELEBRATEDEAL_SOURCE_SHA: sourceSha,
    CELEBRATEDEAL_DEPLOYMENT_HOST: previewHost,
    GITHUB_TOKEN: "test-github-token",
  };
  const verifyDeploymentImpl = async () => ({ host: previewHost, deploymentMatched: true, sourceMatched: true, preview: true, ready: true });
  const cases = [
    ["ALIAS_ATTESTATION_SHA_MISMATCH", masterThenAlias(() => aliasHealthResponse({ commitSha: "c".repeat(40) }))],
    ["ALIAS_ATTESTATION_HOST_MISMATCH", masterThenAlias(() => aliasHealthResponse({ vercelUrl: "older-preview.vercel.app" }))],
    ["ALIAS_ATTESTATION_UNREACHABLE", masterThenAlias(() => { throw new TypeError("fetch failed"); })],
    ["ALIAS_ATTESTATION_FIELDS_MISSING", masterThenAlias(() => aliasHealthResponse({ body: { ok: true, database: "ok", latencyMs: 1 } }))],
    ["ALIAS_ATTESTATION_HTTP_REJECTED", masterThenAlias(() => aliasHealthResponse({ status: 503 }))],
    ["PROTECTED_MASTER_CHECK_FAILED", async () => new Response("{}", { status: 403 })],
  ];
  for (const [reason, fetchImpl] of cases) {
    assert.equal(await diagnoseMvpPayUniLineage(source, { verifyDeploymentImpl, fetchImpl }), reason);
    assert.equal(await verifyMvpPayUniLineage(source, { verifyDeploymentImpl, fetchImpl }), false);
  }
  assert.equal(await diagnoseMvpPayUniLineage(source, {
    verifyDeploymentImpl: async () => { throw new Error("GITHUB_DEPLOYMENT_AMBIGUOUS"); },
  }), "GITHUB_DEPLOYMENT_AMBIGUOUS");
  assert.equal(await diagnoseMvpPayUniLineage(source, {
    verifyDeploymentImpl: async () => { throw new Error("https://unexpected.example/?token=secret"); },
  }), "LINEAGE_CHECK_FAILED");
});

test("browser smoke lineage accepts a merge-queue master commit and attests the fixed alias", async () => {
  const source = {
    CELEBRATEDEAL_SOURCE_SHA: sourceSha,
    CELEBRATEDEAL_DEPLOYMENT_HOST: previewHost,
    CELEBRATEDEAL_BROWSER_SURFACE: "fixed_alias",
    GITHUB_TOKEN: "test-github-token",
  };
  const verifyDeploymentImpl = async () => ({ host: previewHost, deploymentMatched: true, sourceMatched: true, preview: true, ready: true });
  const make = (compare, calls = [], alias = () => aliasHealthResponse()) => async (url, init) => {
    calls.push(String(url));
    if (String(url).startsWith("https://api.github.com/")) {
      assert.equal(String(url), `https://api.github.com/repos/Forty-s-AI-Company/CelebrateDeal/compare/${sourceSha}...master`);
      return new Response(JSON.stringify(compare), { status: 200 });
    }
    assert.equal(init.method, "GET");
    return alias();
  };

  for (const compare of [
    { status: "ahead", merge_base_commit: { sha: sourceSha } },
    { status: "identical", merge_base_commit: { sha: sourceSha } },
  ]) {
    const calls = [];
    assert.equal(await verifyMvpPayUniLineage(source, { verifyDeploymentImpl, fetchImpl: make(compare, calls) }), true);
    assert.equal(calls.at(-1), `https://${stagingAlias}/api/health`);
    assert.ok(!calls.some((url) => url.includes(previewHost)));
  }

  // Not on master: diverged or behind, or merge base is some other commit.
  for (const compare of [
    { status: "diverged", merge_base_commit: { sha: "c".repeat(40) } },
    { status: "behind", merge_base_commit: { sha: "c".repeat(40) } },
    { status: "ahead", merge_base_commit: { sha: "c".repeat(40) } },
  ]) {
    assert.equal(await verifyMvpPayUniLineage(source, { verifyDeploymentImpl, fetchImpl: make(compare) }), false);
  }
  assert.equal(await verifyMvpPayUniLineage(source, {
    verifyDeploymentImpl,
    fetchImpl: async () => new Response("{}", { status: 404 }),
  }), false);
  // A plain 200 from the alias (no identity) is no longer proof.
  assert.equal(await verifyMvpPayUniLineage(source, {
    verifyDeploymentImpl,
    fetchImpl: make({ status: "identical", merge_base_commit: { sha: sourceSha } }, [], () => new Response(null, { status: 200 })),
  }), false);

  // Host bound to a different SHA or a non-Vercel host never reaches the master check.
  let reached = false;
  const ok = make({ status: "identical", merge_base_commit: { sha: sourceSha } });
  const spy = async (...args) => { reached = true; return ok(...args); };
  assert.equal(await verifyMvpPayUniLineage(source, {
    verifyDeploymentImpl: async () => ({ host: previewHost, deploymentMatched: false, sourceMatched: true, preview: true, ready: true }),
    fetchImpl: spy,
  }), false);
  assert.equal(await verifyMvpPayUniLineage({ ...source, CELEBRATEDEAL_DEPLOYMENT_HOST: "evil.example.com" }, { verifyDeploymentImpl, fetchImpl: spy }), false);
  assert.equal(reached, false);
  assert.equal(await verifyMvpPayUniLineage({ ...source, CELEBRATEDEAL_BROWSER_SURFACE: "other" }, { verifyDeploymentImpl, fetchImpl: spy }), false);
});

test("secret-bearing flows re-attest the alias and then address only the alias", async () => {
  const attested = await attestOperationHost(validInput, { fetchImpl: async () => aliasHealthResponse() });
  assert.deepEqual(attested, { ok: true, operationHost: stagingAlias });
  for (const [code, fetchImpl] of [
    ["ALIAS_ATTESTATION_SHA_MISMATCH", async () => aliasHealthResponse({ commitSha: "d".repeat(40) })],
    ["ALIAS_ATTESTATION_HOST_MISMATCH", async () => aliasHealthResponse({ vercelUrl: "older-preview.vercel.app" })],
    ["ALIAS_ATTESTATION_UNREACHABLE", async () => { throw new TypeError("fetch failed"); }],
    ["ALIAS_ATTESTATION_FIELDS_MISSING", async () => aliasHealthResponse({ body: { ok: true, database: "ok" } })],
  ]) {
    assert.deepEqual(await attestOperationHost(validInput, { fetchImpl }), { ok: false, code });
  }
  assert.deepEqual(await attestOperationHost({ ...validInput, previewHost: stagingAlias }, { fetchImpl: async () => aliasHealthResponse() }), { ok: false, code: "INPUT_REJECTED" });

  const calls = [];
  const base = successfulDependencies(calls);
  const receipt = await runMvpPayUniSandboxE2E(validInput, {
    ...base,
    operationHost: stagingAlias,
    async browserSubmit(browserInput) {
      // PayUni returns to NEXT_PUBLIC_APP_URL, the alias on staging; the browser must expect that host.
      assert.equal(browserInput.previewHost, stagingAlias);
      return base.browserSubmit({ ...browserInput, previewHost });
    },
  });
  assert.equal(receipt.result, "PASS");
  const urls = calls.filter((call) => call.url).map((call) => new URL(call.url));
  assert.ok(urls.length > 0);
  assert.ok(urls.every((url) => url.hostname === stagingAlias));
  for (const call of calls.filter((item) => item.headers?.origin)) assert.equal(call.headers.origin, `https://${stagingAlias}`);

  // Only the fixed alias is accepted as an operation host; anything else falls back to the
  // (firewalled) Preview host and can never redirect requests to an arbitrary origin.
  const otherCalls = [];
  await runMvpPayUniSandboxE2E(validInput, { ...successfulDependencies(otherCalls), operationHost: "attacker.example" });
  assert.ok(otherCalls.filter((call) => call.url).every((call) => new URL(call.url).hostname === previewHost));

  let recoveryUrl = null;
  await recoverExistingWp4BuyerRefund({ sourceSha, previewHost, jobSecret: "test-job-secret" }, {
    operationHost: stagingAlias,
    request: async (request) => { recoveryUrl = request.url; return { status: 200, body: { reconciled: true, status: "RECONCILED" } }; },
  });
  assert.equal(recoveryUrl, `https://${stagingAlias}/api/admin/ops/payuni/wp4-refund-recovery`);
});

test("immutable_preview lineage still requires master and probes the preview host", async () => {
  const source = {
    CELEBRATEDEAL_SOURCE_SHA: sourceSha,
    CELEBRATEDEAL_DEPLOYMENT_HOST: previewHost,
    CELEBRATEDEAL_BROWSER_SURFACE: "immutable_preview",
    GITHUB_TOKEN: "test-github-token",
  };
  const verifyDeploymentImpl = async () => ({ host: previewHost, deploymentMatched: true, sourceMatched: true, preview: true, ready: true });
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return String(url).startsWith("https://api.github.com/")
      ? new Response(JSON.stringify({ status: "ahead", merge_base_commit: { sha: sourceSha } }), { status: 200 })
      : new Response(null, { status: 200 });
  };
  assert.equal(await verifyMvpPayUniLineage(source, { verifyDeploymentImpl, fetchImpl }), true);
  assert.equal(calls.at(-1), `https://${previewHost}/api/health`);
  assert.equal(await verifyMvpPayUniLineage(source, {
    verifyDeploymentImpl,
    fetchImpl: async (url) => String(url).startsWith("https://api.github.com/")
      ? new Response(JSON.stringify({ status: "diverged", merge_base_commit: { sha: "c".repeat(40) } }), { status: 200 })
      : new Response(null, { status: 200 }),
  }), false);
});

test("final validation failure preserves already executed payment and refund counters", async () => {
  const receipt = await runMvpPayUniSandboxE2E(validInput, successfulDependencies());
  assert.equal(receipt.result, "PASS");
  const actualEffects = { ...receipt.sideEffects };
  const actualChecks = { ...receipt.checks };
  // 模擬 mock 流程完成後才發現 schema 損壞，不得將實際副作用歸零。
  receipt.schemaVersion = "invalid-schema";
  const result = finalizeMvpPayUniReceipt(receipt);
  assert.equal(result, receipt);
  assert.equal(result.result, "BLOCKED");
  assert.equal(result.failure, "INTERNAL_REJECTED");
  assert.deepEqual(result.sideEffects, actualEffects);
  assert.deepEqual(result.checks, actualChecks);
  for (const key of ["paymentReservationsCreated", "browserPaymentSubmissions", "payments", "refundPosts", "reconcilePosts"]) {
    assert.equal(result.sideEffects[key], 1);
  }
  assert.equal(validateMvpPayUniReceipt(result).ok, false);
});

test("receipt validator accepts the complete fixed, sanitized one-purpose receipt", async () => {
  const calls = [];
  const receipt = await runMvpPayUniSandboxE2E(validInput, successfulDependencies(calls));
  assert.equal(receipt.schemaVersion, MVP_PAYUNI_SANDBOX_E2E_SCHEMA);
  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.sourceSha, sourceSha);
  const admission = calls.find((call) => call.url?.endsWith("/checkout/admission"));
  assert.equal(JSON.parse(admission.body).idempotencyKey, fixedCheckoutIdempotencyKey(sourceSha));
  assert.deepEqual(validateMvpPayUniReceipt(receipt), { ok: true, errors: [] });
});

test("receipt validator rejects a recovered PASS without current reservation, browser, and payment evidence", async () => {
  const receipt = await runMvpPayUniSandboxE2E(validInput, successfulDependencies());
  receipt.sideEffects.paymentReservationsCreated = 0;
  receipt.sideEffects.browserPaymentSubmissions = 0;
  receipt.sideEffects.payments = 0;

  const validation = validateMvpPayUniReceipt(receipt);

  assert.equal(validation.ok, false);
  assert.equal(validation.errors.includes("PASS_EFFECTS"), true);
});

test("written receipt validation shares the current-execution PASS requirement", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "celebratedeal-wp4-receipt-"));

  try {
    const receipt = await runMvpPayUniSandboxE2E(validInput, successfulDependencies());
    receipt.sideEffects.paymentReservationsCreated = 0;
    receipt.sideEffects.browserPaymentSubmissions = 0;
    receipt.sideEffects.payments = 0;

    await writeMvpPayUniReceipt(receipt, temporaryRoot);
    assert.equal(await validateWrittenMvpPayUniReceipt(temporaryRoot), false);
  } finally {
    assert.equal(path.dirname(temporaryRoot), os.tmpdir());
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 0 });
  }
});

test("receipt validator rejects raw data fields and fabricated successful evidence", () => {
  const receipt = createReceipt(sourceSha);
  receipt.result = "PASS";
  receipt.failure = "NONE";
  for (const key of Object.keys(receipt.checks)) receipt.checks[key] = true;
  for (const key of Object.keys(receipt.sideEffects)) receipt.sideEffects[key] = 1;
  receipt.transactionId = "must-not-appear";
  const validation = validateMvpPayUniReceipt(receipt);
  assert.equal(validation.ok, false);
  assert.equal(validation.errors.includes("SCHEMA_KEYS"), true);
});

test("receipt validation fails closed when a side-effect budget or sequence is exceeded", () => {
  const receipt = createReceipt(sourceSha);
  receipt.sideEffects.fixturePosts = SIDE_EFFECT_BUDGET.fixturePosts + 1;
  receipt.safety.sideEffectBudgetExceeded = true;
  receipt.checks.fixtureReady = true;
  const validation = validateMvpPayUniReceipt(receipt);
  assert.equal(validation.ok, false);
  assert.equal(validation.errors.includes("SIDE_EFFECT_BUDGET"), true);

  const outOfOrder = createReceipt(sourceSha);
  outOfOrder.checks.returnCallbackMapped = true;
  outOfOrder.sideEffects.browserPaymentSubmissions = 1;
  assert.equal(validateMvpPayUniReceipt(outOfOrder).errors.includes("SEQUENCE"), true);
});

test("stops before refund and reconciliation when return callback cannot map to the created transaction", async () => {
  const calls = [];
  const dependencies = successfulDependencies(calls);
  dependencies.browserSubmit = async () => false;
  const receipt = await runMvpPayUniSandboxE2E(validInput, dependencies);

  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.failure, "RETURN_CALLBACK_UNMAPPED");
  assert.equal(receipt.sideEffects.refundPosts, 0);
  assert.equal(receipt.sideEffects.reconcilePosts, 0);
  assert.equal(calls.some((call) => call.url?.endsWith("/wp4-refund")), false);
  assert.equal(calls.some((call) => call.url?.endsWith("/wp4-reconcile")), false);
  assert.deepEqual(validateMvpPayUniReceipt(receipt), { ok: true, errors: [] });
});

test("a browser success boolean cannot forge a signed Return callback capture", async () => {
  const calls = [];
  const dependencies = successfulDependencies(calls);
  dependencies.browserSubmit = async () => true;
  const receipt = await runMvpPayUniSandboxE2E(validInput, dependencies);
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.failure, "RETURN_CALLBACK_PROOF_REQUIRED");
  assert.equal(receipt.sideEffects.callbackReplays, 0);
  assert.equal(receipt.sideEffects.refundPosts, 0);
  assert.equal(calls.some((call) => call.url?.endsWith("/wp4-buyer-order-proof")), false);
});

test("a callback 200 without duplicate acknowledgement cannot pass or trigger refund", async () => {
  const calls = [];
  const dependencies = successfulDependencies(calls);
  const originalRequest = dependencies.request;
  dependencies.request = async (request) => request.url.endsWith("/api/webhooks/payments?provider=payuni&source=notify")
    ? response(200, { ok: true, duplicate: false, eventId: "synthetic-event" })
    : originalRequest(request);
  const receipt = await runMvpPayUniSandboxE2E(validInput, dependencies);
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.failure, "CALLBACK_REPLAY_REJECTED");
  assert.equal(receipt.sideEffects.callbackReplays, 1);
  assert.equal(receipt.sideEffects.orderProofPosts, 1);
  assert.equal(receipt.sideEffects.refundPosts, 0);
  assert.deepEqual(validateMvpPayUniReceipt(receipt), { ok: true, errors: [] });
});

test("successful buyer receipt contains only closed proof flags and counters", async () => {
  const receipt = await runMvpPayUniSandboxE2E(validInput, successfulDependencies());
  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.checks.orderPersisted, true);
  assert.equal(receipt.checks.duplicateCallbackVerified, true);
  assert.equal(receipt.sideEffects.orderProofPosts, 2);
  assert.equal(receipt.sideEffects.callbackReplays, 1);
  assert.equal(JSON.stringify(receipt).includes("signed-synthetic-callback"), false);
  assert.equal(JSON.stringify(receipt).includes("synthetic-event"), false);
});

test("a changed persisted inventory snapshot after replay cannot pass or trigger refund", async () => {
  const calls = [];
  const dependencies = successfulDependencies(calls);
  const originalRequest = dependencies.request;
  let proofReads = 0;
  dependencies.request = async (request) => {
    if (request.url.endsWith("/wp4-buyer-order-proof") && ++proofReads === 2) {
      return response(200, { status: "VERIFIED", paymentStatus: "paid", orderStatus: "paid", orderCount: 1,
        paidEventCount: 1, orderEventCount: 1, reservationStatus: "committed", remainingInventory: 1 });
    }
    return originalRequest(request);
  };
  const receipt = await runMvpPayUniSandboxE2E(validInput, dependencies);
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.failure, "DUPLICATE_PROOF_REJECTED");
  assert.equal(receipt.sideEffects.orderProofPosts, 2);
  assert.equal(receipt.sideEffects.refundPosts, 0);
  assert.deepEqual(validateMvpPayUniReceipt(receipt), { ok: true, errors: [] });
});

test("reconciles a provider-completed refund when local completion is ambiguous", async () => {
  const calls = [];
  const dependencies = successfulDependencies(calls);
  const originalRequest = dependencies.request;
  dependencies.request = async (request) => request.url.endsWith("/wp4-refund")
    ? response(503, {
        status: "RECONCILIATION_REQUIRED",
        purpose: "buyer_order",
        phase: "remaining",
        providerWriteAttempted: true,
      })
    : originalRequest(request);
  dependencies.wait = async () => {};

  const receipt = await runMvpPayUniSandboxE2E(validInput, dependencies);

  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.failure, "NONE");
  assert.equal(receipt.checks.refundCompleted, true);
  assert.equal(receipt.checks.reconciled, true);
  assert.equal(receipt.sideEffects.refundPosts, 1);
  assert.equal(receipt.sideEffects.refunds, 1);
  assert.equal(receipt.sideEffects.reconcilePosts, 1);
  assert.deepEqual(validateMvpPayUniReceipt(receipt), { ok: true, errors: [] });
});

test("preserves an allowlisted browser-stage failure without exposing provider data", async () => {
  const calls = [];
  const dependencies = successfulDependencies(calls);
  dependencies.browserSubmit = async () => "PAYMENT_FIELDS_REJECTED";
  const receipt = await runMvpPayUniSandboxE2E(validInput, dependencies);

  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.failure, "PAYMENT_FIELDS_REJECTED");
  assert.equal(receipt.sideEffects.refundPosts, 0);
  assert.equal(receipt.sideEffects.reconcilePosts, 0);
  assert.deepEqual(validateMvpPayUniReceipt(receipt), { ok: true, errors: [] });
});

test("a reserved pending retry never submits the PayUni form again", async () => {
  const calls = [];
  const dependencies = successfulDependencies(calls);
  const originalRequest = dependencies.request;
  dependencies.request = async (request) => request.url.endsWith("/wp4-payment-attempt")
    ? response(409, { status: "ALREADY_RESERVED", reservationCreated: false })
    : originalRequest(request);
  let browserSubmits = 0;
  dependencies.browserSubmit = async () => { browserSubmits += 1; return true; };

  const receipt = await runMvpPayUniSandboxE2E(validInput, dependencies);
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.failure, "PAYMENT_ATTEMPT_ALREADY_RESERVED");
  assert.equal(browserSubmits, 0);
  assert.equal(receipt.sideEffects.refundPosts, 0);
});

test("an already-paid retry without exact-source Return callback proof fails closed before refund", async () => {
  const calls = [];
  const dependencies = successfulDependencies(calls);
  const originalRequest = dependencies.request;
  dependencies.request = async (request) => request.url.endsWith("/wp4-payment-attempt")
    ? response(200, { status: "ALREADY_PAID", reservationCreated: false })
    : originalRequest(request);
  let browserSubmits = 0;
  dependencies.browserSubmit = async () => { browserSubmits += 1; return true; };

  const receipt = await runMvpPayUniSandboxE2E(validInput, dependencies);
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.failure, "RETURN_CALLBACK_PROOF_REQUIRED");
  assert.equal(browserSubmits, 0);
  assert.equal(receipt.sideEffects.payments, 0);
  assert.equal(receipt.checks.payuniFormAccepted, false);
  assert.equal(receipt.checks.returnCallbackMapped, false);
  assert.equal(receipt.sideEffects.refundPosts, 0);
  assert.equal(receipt.sideEffects.reconcilePosts, 0);
  assert.equal(calls.some((call) => call.url?.endsWith("/wp4-refund")), false);
  assert.equal(calls.some((call) => call.url?.endsWith("/wp4-reconcile")), false);
  assert.deepEqual(validateMvpPayUniReceipt(receipt), { ok: true, errors: [] });
});

test("does not perform any side effect when input validation fails", async () => {
  let requests = 0;
  const receipt = await runMvpPayUniSandboxE2E({ ...validInput, payuniEnv: "production" }, {
    request: async () => { requests += 1; throw new Error("must not run"); },
    browserSubmit: async () => { throw new Error("must not run"); },
  });
  assert.equal(requests, 0);
  assert.equal(receipt.failure, "INPUT_REJECTED");
  assert.equal(receipt.result, "BLOCKED");
  assert.deepEqual(validateMvpPayUniReceipt(receipt), { ok: true, errors: [] });
});

function continuationResponse(request, stateReads = { count: 0 }) {
  if (request.url.endsWith("/wp4-buyer-existing-state")) {
    stateReads.count += 1;
    return response(200, {
      status: "VERIFIED", paymentStatus: stateReads.count === 1 ? "PAID" : "REFUNDED",
      orderPaid: true, inventoryCommitted: true, notificationQueued: true,
      refundReconciled: stateReads.count === 2,
    });
  }
  if (request.url.endsWith("/wp4-buyer-existing-refund")) return response(200, { status: "COMPLETED", providerWriteAttempted: true });
  if (request.url.endsWith("/wp4-buyer-existing-reconcile")) return response(200, { status: "RECONCILED", reconciled: true });
  throw new Error("unexpected continuation request");
}

test("continues an existing paid buyer transaction with one refund and final state proof", async () => {
  const calls = [];
  const stateReads = { count: 0 };
  const receipt = await runMvpPayUniBuyerExistingContinuation(recoveryInput, {
    request: async (request) => { calls.push(request); return continuationResponse(request, stateReads); },
  });
  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.transactionSourceSha, BUYER_CONTINUATION_TRANSACTION_SOURCE_SHA);
  assert.deepEqual(receipt.checks, { stateVerified: true, refundAttempted: true, reconciled: true, refundedStateVerified: true });
  assert.deepEqual(receipt.sideEffects, { statePosts: 2, refundPosts: 1, reconcilePosts: 1, queryAttempts: 1, paymentSubmissions: 0, providerRefundSubmissions: 1 });
  assert.deepEqual(validateBuyerContinuationReceipt(receipt), { ok: true, errors: [] });
  assert.equal(calls.filter((request) => request.url.endsWith("/wp4-buyer-existing-state")).length, 2);
});

test("repeats reconciliation only for REFUND_NOT_CONFIRMED", async () => {
  let reconciles = 0;
  const stateReads = { count: 0 };
  const receipt = await runMvpPayUniBuyerExistingContinuation(recoveryInput, {
    request: async (request) => {
      if (request.url.endsWith("/wp4-buyer-existing-state")) return continuationResponse(request, stateReads);
      if (request.url.endsWith("/wp4-buyer-existing-refund")) return response(200, { status: "RECONCILIATION_REQUIRED", providerWriteAttempted: true });
      if (request.url.endsWith("/wp4-buyer-existing-reconcile")) {
        reconciles += 1;
        return reconciles === 1 ? response(200, { status: "REFUND_NOT_CONFIRMED", reconciled: false }) : response(200, { status: "RECONCILED", reconciled: true });
      }
      throw new Error("unexpected continuation request");
    },
    wait: async () => {},
  });
  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.sideEffects.reconcilePosts, 2);
});

test("stops on unknown network outcome with reserved refund budget", async () => {
  const receipt = await runMvpPayUniBuyerExistingContinuation(recoveryInput, {
    request: async (request) => {
      if (request.url.endsWith("/wp4-buyer-existing-state")) return continuationResponse(request, { count: 0 });
      throw new Error("network unknown");
    },
  });
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.failure, "NETWORK_REJECTED");
  assert.equal(receipt.sideEffects.refundPosts, 1);
  assert.deepEqual(validateBuyerContinuationReceipt(receipt), { ok: true, errors: [] });
});

test("rejects forged continuation PASS receipts and fixed receipt identity violations", () => {
  const receipt = createReceipt();
  receipt.schemaVersion = MVP_PAYUNI_BUYER_CONTINUATION_SCHEMA;
  receipt.transactionSourceSha = BUYER_CONTINUATION_TRANSACTION_SOURCE_SHA;
  assert.equal(validateBuyerContinuationReceipt(receipt).ok, false);
});

test("rejects forged continuation phases, unsafe receipts, and extra response fields", async () => {
  for (const malformed of [null, {}, { result: "PASS" }, { sideEffects: { refundPosts: 1 } }]) {
    assert.equal(validateBuyerContinuationReceipt(malformed).ok, false);
  }
  const stateReads = { count: 0 };
  const valid = await runMvpPayUniBuyerExistingContinuation(recoveryInput, {
    request: async (request) => continuationResponse(request, stateReads),
  });
  assert.equal(validateBuyerContinuationReceipt({ ...valid, checks: { ...valid.checks, reconciled: false } }).ok, false);
  assert.equal(validateBuyerContinuationReceipt({ ...valid, safety: { ...valid.safety, sideEffectBudgetExceeded: true } }).ok, false);

  const blocked = await runMvpPayUniBuyerExistingContinuation(recoveryInput, {
    request: async (request) => {
      if (request.url.endsWith("/wp4-buyer-existing-state")) return continuationResponse(request, { count: 0 });
      if (request.url.endsWith("/wp4-buyer-existing-refund")) return response(200, { status: "COMPLETED", providerWriteAttempted: true, raw: "must-not-escape" });
      throw new Error("unexpected continuation request");
    },
  });
  assert.equal(blocked.result, "BLOCKED");
  assert.equal(blocked.failure, "REFUND_REJECTED");
  assert.equal(blocked.sideEffects.reconcilePosts, 0);
});

test("refuses to persist an invalid continuation receipt", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "celebratedeal-wp4-buyer-continuation-"));
  try {
    await assert.rejects(() => writeBuyerExistingContinuationReceipt({ schemaVersion: "forged" }, temporaryRoot), /RECEIPT_INVALID/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 0 });
  }
});

const SYNTHETIC_CARD = "4147631000000001";

test("PayUni page-structure text keeps only whitelisted characters and never values", () => {
  assert.equal(sanitizeStructureText("16 碼或 19 碼"), "16 碼或 19 碼");
  assert.equal(sanitizeStructureText("MM/YY"), "MM/YY");
  assert.equal(sanitizeStructureText("example@example.com"), "EMAIL");
  assert.equal(sanitizeStructureText("寄送至 buyer.private@example.test 的收據"), "寄送至 EMAIL 的收據");
  assert.equal(sanitizeStructureText("付款 https://sandbox-api.payuni.com.tw/api/upp?EncryptInfo=abc&MerTradeNo=CD123"), "付款 URL");
  assert.equal(sanitizeStructureText(`卡號 ${SYNTHETIC_CARD}`), "卡號 #");
  assert.equal(sanitizeStructureText("4147 6310 0000 0001"), "# # # #");
  assert.equal(sanitizeStructureText("ＣＶＶ １２３"), "ＣＶＶ #");
  assert.equal(sanitizeStructureText("NT$ 1,280 元"), "NT 1# 元");
  assert.equal(sanitizeStructureText('"><script>alert(1)</script>'), "scriptalert(1)/script");
  assert.equal(sanitizeStructureText("a".repeat(60)), `${"a".repeat(40)}~`);
  assert.equal(sanitizeStructureText(42), "");
  assert.equal(sanitizeStructureText(null), "");
});

test("PayUni page structure lists attribute names and visible control text, never field values", async () => {
  const valueRead = [];
  const element = (tag, attributes, options = {}) => ({
    tagName: tag.toUpperCase(),
    getAttribute: (name) => attributes[name] ?? null,
    getBoundingClientRect: () => ({ width: options.hidden ? 0 : 100, height: options.hidden ? 0 : 20 }),
    get value() { valueRead.push(tag); return SYNTHETIC_CARD; },
    innerText: options.text,
  });
  const inputs = [
    element("input", { type: "hidden", name: "EncryptInfo", value: "cipher" }),
    element("input", { type: "tel", name: "CardNo", placeholder: "請輸入卡號", "aria-label": "信用卡卡號", autocomplete: "cc-number", value: SYNTHETIC_CARD }),
    element("input", { type: "email", name: "Email", placeholder: "example@example.com", value: "buyer@example.test" }),
    element("select", { name: "Installment" }, { hidden: true }),
  ];
  const controls = [
    element("button", { role: "tab" }, { text: "信用卡" }),
    element("button", {}, { text: `確認送出 ${SYNTHETIC_CARD}` }),
    element("a", { href: "https://example.test/?token=x" }, { text: "說明" }),
    element("label", {}, { text: "   " }),
    element("button", {}, { text: "隱藏", hidden: true }),
  ];
  const original = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle };
  let raw;
  try {
    globalThis.document = { querySelectorAll: (selector) => (selector.startsWith("input") ? inputs : controls) };
    globalThis.getComputedStyle = () => ({ visibility: "visible", display: "block" });
    raw = collectPageStructureInPage(25);
  } finally {
    globalThis.document = original.document;
    globalThis.getComputedStyle = original.getComputedStyle;
  }
  assert.deepEqual(valueRead, []);
  assert.equal(raw.hiddenInputs, 1);
  const structure = sanitizePayUniPageStructure({ ...raw, fields: raw.fields.map((field) => ({ ...field, value: SYNTHETIC_CARD })) }, 0);
  assert.deepEqual(structure, {
    frame: 0,
    hiddenInputs: 1,
    fields: [
      { tag: "input", type: "tel", name: "CardNo", placeholder: "請輸入卡號", ariaLabel: "信用卡卡號", autocomplete: "cc-number", visible: true },
      { tag: "input", type: "email", name: "Email", placeholder: "EMAIL", ariaLabel: "", autocomplete: "", visible: true },
      { tag: "select", type: "", name: "Installment", placeholder: "", ariaLabel: "", autocomplete: "", visible: false },
    ],
    controls: [{ role: "tab", text: "信用卡" }, { role: "button", text: "確認送出 #" }, { role: "a", text: "說明" }],
  });
  const line = formatPayUniPageStructure({ structure: [structure] });
  for (const secret of [SYNTHETIC_CARD, "cipher", "buyer@example.test", "token", "https:", "EncryptInfo"]) assert.equal(line.includes(secret), false, secret);
  assert.equal(formatPayUniPageStructure({ structure: [] }), null);
  assert.equal(formatPayUniPageStructure(null), null);
  // A tampered structure is sanitized again before printing.
  const tampered = formatPayUniPageStructure({ structure: [{ frame: 99, hiddenInputs: -1, fields: [{ tag: "script", name: `x ${SYNTHETIC_CARD}`, type: "<b>" }], controls: "x" }] });
  assert.equal(tampered.includes(SYNTHETIC_CARD), false);
  assert.match(tampered, /"frame":9,"hiddenInputs":0/u);
  assert.match(tampered, /"tag":"other","type":"other"/u);
});

test("PayUni sub-resource failures are counted by host class and type only", () => {
  const diagnostic = createPayUniBrowserDiagnostic();
  const request = (url, type, navigation = false) => ({ url: () => url, resourceType: () => type, isNavigationRequest: () => navigation });
  recordPayUniResourceFailure(diagnostic, request("https://sandbox-api.payuni.com.tw/js/app.js", "script"));
  recordPayUniResourceFailure(diagnostic, request("https://static.payuni.com.tw/css/a.css", "stylesheet"));
  recordPayUniResourceFailure(diagnostic, request("https://cdn.example.test/vue.js?x=1", "script"));
  recordPayUniResourceFailure(diagnostic, request("https://fonts.example.test/a.woff2", "font"));
  recordPayUniResourceFailure(diagnostic, request("https://sandbox-api.payuni.com.tw/api/upp", "document", true));
  recordPayUniResourceFailure(diagnostic, { url: () => "not a url", resourceType: () => "script", isNavigationRequest: () => false });
  recordPayUniResourceFailure(null, request("https://cdn.example.test/vue.js", "script"));
  assert.deepEqual(diagnostic.resourceFailures, { payuniScript: 1, payuniOther: 1, externalScript: 1, externalOther: 1 });
});

test("a missing card-number placeholder falls back to the autofill field, then to the credit tab", async () => {
  class TimeoutError extends Error { constructor(message) { super(message); this.name = "TimeoutError"; } }
  const NEW_CARD = "**** **** **** ****";
  const LEGACY_CARD = "16 碼或 19 碼";
  const run = async ({ autocompleteVisible, tabCount, placeholderAfterTab, legacyVisible = false, newVisible = false }) => {
    const typed = [];
    const nonExactLookups = [];
    let strictViolations = 0;
    let tabClicked = 0;
    let radioChecks = 0;
    const page = {
      on() {}, async goto() {}, async route() {}, async waitForURL() {},
      url: () => "https://sandbox-api.payuni.com.tw/api/upp",
      mainFrame: () => page, frames: () => [],
      getByText(text) {
        if (text === "信用卡") return { count: async () => tabCount, isVisible: async () => true, click: async () => { tabClicked += 1; } };
        return { async click() {} };
      },
      getByPlaceholder(placeholder, options) {
        if (!options?.exact) nonExactLookups.push(placeholder);
        // Simulated UPP page: the card placeholder contains the CVV `***` as a substring, so only an
        // exact lookup of `***` may resolve to a single element.
        const dom = [NEW_CARD, "MM/YY", "***", "example@example.com", ...(legacyVisible ? [LEGACY_CARD] : [])];
        const matched = dom.filter((item) => (options?.exact ? item === placeholder : item.includes(placeholder)));
        const newCardMissing = matched.includes(NEW_CARD) && !(newVisible || (tabClicked && placeholderAfterTab));
        const present = matched.filter((item) => item !== NEW_CARD || !newCardMissing);
        const missing = present.length === 0;
        const ambiguous = present.length > 1;
        return {
          count: async () => present.length, isVisible: async () => present.length === 1,
          async pressSequentially(value) {
            if (ambiguous) { strictViolations += 1; throw new Error(`strict mode violation: getByPlaceholder resolved to ${present.length} elements`); }
            if (missing) throw new TimeoutError(`Timeout 20000ms exceeded ${SYNTHETIC_CARD}`);
            typed.push(`placeholder:${placeholder}`);
            assert.equal(typeof value, "string");
          },
          async fill() { typed.push(`placeholder:${placeholder}`); },
        };
      },
      getByRole(role, options) {
        if (role === "tab") return { count: async () => 0, isVisible: async () => false };
        if (options?.name === "確認送出") return { async click() { typed.push("submit"); } };
        if (options?.name === "確定") return { async waitFor() { throw new TimeoutError("none"); } };
        throw new Error("unexpected role");
      },
      locator(selector) {
        if (selector === 'input[autocomplete="cc-number"]') {
          return { count: async () => (autocompleteVisible ? 1 : 0), isVisible: async () => autocompleteVisible,
            async pressSequentially() { typed.push("autocomplete:cc-number"); } };
        }
        if (selector === 'input[name="radioOptionpayGroupCredit"]') {
          return { count: async () => 1, first: () => ({ async check() { radioChecks += 1; } }), async check() { radioChecks += 1; } };
        }
        if (selector === "body") return { async innerText() { return "CD-20300101000000-WP4A1 付款完成"; } };
        return { count: async () => 0, isVisible: async () => false, async check() {} };
      },
    };
    const browser = { async newContext() { return { async addCookies() {}, async newPage() { return page; },
      request: { async post() { return { status: () => 200, ok: () => true }; } } }; }, async close() {} };
    const diagnostic = createPayUniBrowserDiagnostic();
    const sources = [];
    let currentSource = diagnostic.fieldSource;
    Object.defineProperty(diagnostic, "fieldSource", { enumerable: true, get: () => currentSource, set: (value) => { currentSource = value; sources.push(value); } });
    const result = await defaultBrowserSubmit({ previewHost, cardNumber: SYNTHETIC_CARD, cardExpiry: "1230", cardCvv: "123",
      formPayload: { MerID: "merchant" }, supportCookie: "celebrate_support_wp4=synthetic", orderNumber: "CD-20300101000000-WP4A1", diagnostic,
    }, { playwright: { chromium: { async launch() { return browser; } }, errors: { TimeoutError } }, payuniFallbackWaitMs: 50 });
    return { result, typed, tabClicked, radioChecks, diagnostic, sources, nonExactLookups, strictViolations };
  };

  // New placeholder is the primary path; the CVV `***` never matches the card field (exact lookups only).
  const primary = await run({ autocompleteVisible: false, tabCount: 1, placeholderAfterTab: false, newVisible: true });
  assert.equal(primary.result, true);
  assert.equal(primary.typed[0], `placeholder:${NEW_CARD}`);
  assert.equal(primary.sources[0], "PLACEHOLDER");
  assert.ok(primary.typed.includes("placeholder:***"), "CVV is typed through its own exact `***` lookup");
  assert.equal(primary.strictViolations, 0, "an exact `***` lookup never resolves to the card field");
  assert.deepEqual(primary.nonExactLookups, []);
  assert.equal(primary.tabClicked, 0);

  // A substring lookup of `***` would hit both the card and the CVV field (documents why exact is required).
  assert.ok(NEW_CARD.includes("***"));

  // Old placeholder is the fallback path when the new one times out.
  const legacy = await run({ autocompleteVisible: false, tabCount: 1, placeholderAfterTab: false, legacyVisible: true });
  assert.equal(legacy.result, true);
  assert.equal(legacy.typed[0], `placeholder:${LEGACY_CARD}`);
  assert.equal(legacy.sources[0], "LEGACY_PLACEHOLDER");
  assert.equal(legacy.tabClicked, 0);
  assert.equal(legacy.strictViolations, 0);
  assert.deepEqual(legacy.nonExactLookups, []);

  const autofill = await run({ autocompleteVisible: true, tabCount: 1, placeholderAfterTab: true });
  assert.equal(autofill.typed[0], "autocomplete:cc-number");
  assert.equal(autofill.tabClicked, 0);
  assert.equal(autofill.result, true);

  const tab = await run({ autocompleteVisible: false, tabCount: 1, placeholderAfterTab: true });
  assert.equal(tab.typed[0], `placeholder:${NEW_CARD}`);
  assert.equal(tab.tabClicked, 1);
  assert.equal(tab.diagnostic.creditTab, "CLICKED");
  assert.ok(tab.radioChecks >= 2, "一次付清 stays selected after the tab click");
  assert.equal(tab.result, true);

  const ambiguous = await run({ autocompleteVisible: false, tabCount: 2, placeholderAfterTab: true });
  assert.equal(ambiguous.result, "PAYMENT_FIELDS_REJECTED");
  assert.equal(ambiguous.tabClicked, 0);
  assert.equal(ambiguous.diagnostic.creditTab, "AMBIGUOUS");
  assert.equal(ambiguous.diagnostic.step, "CARD_NUMBER");
  assert.equal(ambiguous.typed.includes("submit"), false);
  assert.equal(formatPayUniBrowserDiagnostic(ambiguous.diagnostic).includes(SYNTHETIC_CARD), false);
});

test("credit tab is clicked only when exactly one visible element matches", async () => {
  const page = (tabs, texts) => ({
    getByRole: () => ({ count: async () => tabs, isVisible: async () => true, click: async () => {} }),
    getByText: () => ({ count: async () => texts, isVisible: async () => true, click: async () => {} }),
    locator: () => ({ count: async () => 0 }),
  });
  assert.equal(await clickPayUniCreditTab(page(1, 0)), "CLICKED");
  assert.equal(await clickPayUniCreditTab(page(0, 1)), "CLICKED");
  assert.equal(await clickPayUniCreditTab(page(0, 0)), "NOT_FOUND");
  assert.equal(await clickPayUniCreditTab(page(3, 1)), "AMBIGUOUS");
  assert.equal(await clickPayUniCreditTab({ getByRole: () => { throw new Error("closed"); } }), "NOT_FOUND");
});

// ---- Post-submit diagnostics (wp4_payuni_submit_diagnostic) ----

test("submit messages map to fixed categories and never echo the text", () => {
  const cases = [
    ["信用卡已過期", "CARD_EXPIRED"], ["到期日不正確", "CARD_EXPIRED"], ["有效期限錯誤", "CARD_EXPIRED"],
    ["卡號不正確", "CARD_NUMBER_INVALID"], ["Invalid card number", "CARD_NUMBER_INVALID"],
    ["安全碼錯誤", "CVV_INVALID"], ["CVV is required", "CVV_INVALID"],
    ["Email 格式錯誤", "EMAIL_INVALID"], ["請輸入電子信箱", "EMAIL_INVALID"],
    ["交易失敗", "OTHER"], ["", "OTHER"], [undefined, "OTHER"], [42, "OTHER"], ["過期".repeat(3000), "OTHER"],
  ];
  for (const [text, expected] of cases) assert.equal(classifyPayUniSubmitMessage(text), expected, String(text).slice(0, 20));
});

test("submit location reports only host and path classes, never the query", () => {
  assert.deepEqual(classifyPayUniSubmitLocation("https://sandbox-api.payuni.com.tw/api/upp?EncryptInfo=secret", previewHost), { host: "PAYUNI_UPP", path: "UPP" });
  assert.deepEqual(classifyPayUniSubmitLocation("https://sandbox-api.payuni.com.tw/api/other", previewHost), { host: "PAYUNI_UPP", path: "OTHER" });
  assert.deepEqual(classifyPayUniSubmitLocation(`https://${previewHost}/checkout/result?payment=updated&order=CD-1`, previewHost), { host: "APP", path: "CHECKOUT_RESULT" });
  assert.deepEqual(classifyPayUniSubmitLocation(`https://${previewHost}/checkout/abc`, previewHost), { host: "APP", path: "CHECKOUT" });
  assert.deepEqual(classifyPayUniSubmitLocation(`https://${previewHost}/`, previewHost), { host: "APP", path: "ROOT" });
  assert.deepEqual(classifyPayUniSubmitLocation(`https://${previewHost}/x`, previewHost), { host: "APP", path: "OTHER" });
  assert.deepEqual(classifyPayUniSubmitLocation("https://evil.example/api/upp", previewHost), { host: "OTHER", path: "NONE" });
  assert.deepEqual(classifyPayUniSubmitLocation("not a url", previewHost), { host: "NONE", path: "NONE" });
});

test("error elements map to card-field steps by placeholder, autocomplete or type", () => {
  const errors = sanitizePayUniSubmitErrors([
    { text: "卡號不正確 4147631000000001", placeholder: "**** **** **** ****" },
    { text: "有效期限已過期", placeholder: "MM/YY" },
    { text: "安全碼錯誤", autocomplete: "cc-csc" },
    { text: "請輸入電子信箱 buyer@example.test", type: "email" },
    { text: "請輸入電子信箱 buyer@example.test", type: "email" },
    { text: "系統忙碌", placeholder: "something else" },
  ]);
  assert.deepEqual(errors, [
    { step: "CARD_NUMBER", category: "CARD_NUMBER_INVALID" }, { step: "CARD_EXPIRY", category: "CARD_EXPIRED" },
    { step: "CARD_CVV", category: "CVV_INVALID" }, { step: "EMAIL", category: "EMAIL_INVALID" },
    { step: "UNKNOWN", category: "OTHER" },
  ]);
  assert.deepEqual(sanitizePayUniSubmitErrors("nope"), []);
  assert.equal(JSON.stringify(errors).includes("4147631000000001"), false);
  assert.equal(JSON.stringify(errors).includes("buyer@example.test"), false);
});

test("the submit diagnostic line is re-validated against its whitelists", () => {
  assert.equal(formatPayUniSubmitDiagnostic(createPayUniBrowserDiagnostic()), null);
  assert.equal(formatPayUniSubmitDiagnostic(null), null);
  const diagnostic = createPayUniBrowserDiagnostic();
  diagnostic.submit = {
    captured: true, modal: "free text 4147631000000001", host: "https://x.example/?q=1", path: "buyer@example.test",
    dialogs: [{ type: "ALERT", category: "CARD_EXPIRED" }, { type: "weird 123", category: "raw message" }],
    errors: [{ step: "CARD_EXPIRY", category: "CARD_EXPIRED" }, { step: "secret", category: "secret" }],
  };
  const line = formatPayUniSubmitDiagnostic(diagnostic);
  assert.equal(line, "dialogs=ALERT:CARD_EXPIRED,OTHER:OTHER; modal=OTHER; host=NONE; path=NONE; errors=CARD_EXPIRY:CARD_EXPIRED,UNKNOWN:OTHER");
  const empty = createPayUniBrowserDiagnostic();
  empty.submit.captured = true;
  assert.equal(formatPayUniSubmitDiagnostic(empty), "dialogs=NONE; modal=NONE; host=NONE; path=NONE; errors=NONE");
});

test("collectSubmitErrorsInPage reads visible error elements and the field's attributes, never values", () => {
  const element = (props) => ({
    getBoundingClientRect: () => ({ width: 10, height: 10 }), matches: (selector) => props.isField === true && selector.includes("input"),
    innerText: props.text, getAttribute: (name) => props.attrs?.[name] ?? null, parentElement: props.parent ?? null,
    querySelector: () => props.field ?? null,
  });
  const field = element({ isField: true, attrs: { placeholder: "MM/YY", autocomplete: "cc-exp", type: "text", value: "12/30" } });
  const hiddenBox = { ...element({ text: "hidden" }), getBoundingClientRect: () => ({ width: 0, height: 0 }) };
  const previous = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle };
  globalThis.document = { querySelectorAll: () => [element({ text: "有效期限已過期", field }), hiddenBox, field] };
  globalThis.getComputedStyle = () => ({ visibility: "visible", display: "block" });
  let raw;
  try { raw = collectSubmitErrorsInPage(); } finally {
    globalThis.document = previous.document; globalThis.getComputedStyle = previous.getComputedStyle;
  }
  assert.equal(raw.length, 2);
  assert.deepEqual(raw[0], { text: "有效期限已過期", placeholder: "MM/YY", autocomplete: "cc-exp", type: "text" });
  assert.equal(raw[1].text, "");
  assert.equal(JSON.stringify(raw).includes("12/30"), false);
});

async function runSubmitScenario({ confirmationText = null, dialog = null, url, errors = [], structureText = "確認送出" }) {
  class TimeoutError extends Error { constructor(message) { super(message); this.name = "TimeoutError"; } }
  const handlers = new Map();
  const dialogCalls = { dismiss: 0, accept: 0 };
  let submitted = 0;
  let confirmationClicks = 0;
  const frame = {
    async evaluate(fn) {
      if (fn === collectSubmitErrorsInPage) return errors;
      return { fields: [{ tag: "input", type: "text", name: "n", placeholder: "MM/YY", ariaLabel: "", autocomplete: "", value: SYNTHETIC_CARD, visible: true }],
        controls: [{ role: "button", text: structureText }], hiddenInputs: 2 };
    },
  };
  const page = {
    on(event, handler) { handlers.set(event, handler); },
    async goto() {}, async route() {}, async waitForURL() { throw new TimeoutError("Timeout 60000ms exceeded"); },
    url: () => url, frames: () => [frame],
    getByText() { return { async click() {} }; },
    getByPlaceholder() { return { async pressSequentially() {}, async fill() {} }; },
    getByRole(_role, options) {
      if (options.name === "確認送出") {
        return { async click() {
          submitted += 1;
          if (dialog) await handlers.get("dialog")?.({
            type: () => dialog.type, message: () => dialog.message,
            async dismiss() { dialogCalls.dismiss += 1; }, async accept() { dialogCalls.accept += 1; },
          });
        } };
      }
      if (options.name === "確定") {
        if (confirmationText === null) return { async waitFor() { throw new TimeoutError("none"); } };
        return { async waitFor() {}, async evaluate() { return confirmationText; }, async click() { confirmationClicks += 1; } };
      }
      throw new Error("unexpected role");
    },
    locator() { return { async check() {} }; },
  };
  const browser = { async newContext() { return { async addCookies() {}, async newPage() { return page; },
    request: { async post() { return { status: () => 200, ok: () => true }; } } }; }, async close() {} };
  const diagnostic = createPayUniBrowserDiagnostic();
  const result = await defaultBrowserSubmit({ previewHost, cardNumber: SYNTHETIC_CARD, cardExpiry: "1230", cardCvv: "123",
    formPayload: { MerID: "merchant" }, supportCookie: "celebrate_support_wp4=synthetic", orderNumber: "CD-20300101000000-WP4A1", diagnostic,
  }, { playwright: { chromium: { async launch() { return browser; } }, errors: { TimeoutError } } });
  return { result, diagnostic, submitted, confirmationClicks, dialogCalls };
}

test("an unaccepted submit reports a dismissed dialog, the page class, field errors and a fresh page structure", async () => {
  const { result, diagnostic, submitted, confirmationClicks, dialogCalls } = await runSubmitScenario({
    dialog: { type: "alert", message: `信用卡已過期 ${SYNTHETIC_CARD} buyer@example.test` },
    url: `https://sandbox-api.payuni.com.tw/api/upp?EncryptInfo=private-cipher&card=${SYNTHETIC_CARD}`,
    errors: [{ text: `有效期限不正確 ${SYNTHETIC_CARD}`, placeholder: "MM/YY" }, { text: "請輸入電子信箱 buyer@example.test", type: "email" }],
  });
  assert.equal(result, "RETURN_CALLBACK_UNMAPPED");
  assert.equal(submitted, 1, "a dialog never triggers a second submit");
  assert.equal(confirmationClicks, 0);
  assert.deepEqual(dialogCalls, { dismiss: 1, accept: 0 });
  const line = formatPayUniSubmitDiagnostic(diagnostic);
  assert.equal(line, "dialogs=ALERT:CARD_EXPIRED; modal=NONE; host=PAYUNI_UPP; path=UPP; errors=CARD_EXPIRY:CARD_EXPIRED,EMAIL:EMAIL_INVALID");
  const structure = formatPayUniPageStructure(diagnostic);
  assert.ok(structure.includes("確認送出"));
  for (const secret of [SYNTHETIC_CARD, "buyer@example.test", "private-cipher", "EncryptInfo", "已過期", "不正確"]) {
    assert.equal(line.includes(secret), false, `line leaked ${secret}`);
    assert.equal(structure.includes(secret), false, `structure leaked ${secret}`);
  }
});

test("each dialog type records only its type and a category; confirm and prompt are dismissed too", async () => {
  for (const [type, message, category] of [["confirm", "請確認卡號", "CARD_NUMBER_INVALID"], ["prompt", "輸入安全碼", "CVV_INVALID"], ["beforeunload", "x", "OTHER"]]) {
    const { diagnostic, dialogCalls, submitted } = await runSubmitScenario({
      dialog: { type, message }, url: "https://sandbox-api.payuni.com.tw/api/upp",
    });
    assert.deepEqual(diagnostic.submit.dialogs, [{ type: type === "beforeunload" ? "OTHER" : type.toUpperCase(), category }]);
    assert.deepEqual(dialogCalls, { dismiss: 1, accept: 0 });
    assert.equal(submitted, 1);
  }
});

test("a visible 確定 modal is categorised, left unclicked, and the redirect-back page class is reported", async () => {
  const modal = await runSubmitScenario({
    confirmationText: "此卡片已到期", url: "https://sandbox-api.payuni.com.tw/api/upp?x=1",
  });
  assert.equal(modal.result, "PAYMENT_CONFIRMATION_AMBIGUOUS");
  assert.equal(modal.confirmationClicks, 0);
  assert.equal(modal.submitted, 1);
  assert.equal(formatPayUniSubmitDiagnostic(modal.diagnostic), "dialogs=NONE; modal=CARD_EXPIRED; host=PAYUNI_UPP; path=UPP; errors=NONE");

  const back = await runSubmitScenario({ url: `https://${previewHost}/checkout/result?payment=failed&order=CD-1` });
  assert.equal(formatPayUniSubmitDiagnostic(back.diagnostic), "dialogs=NONE; modal=NONE; host=APP; path=CHECKOUT_RESULT; errors=NONE");
  assert.equal(back.diagnostic.structure, null, "no PayUni structure is read once the browser left PayUni");
});

test("an unreadable page never changes the failure code and still prints a closed diagnostic", async () => {
  const diagnostic = createPayUniBrowserDiagnostic();
  diagnostic.step = "SUBMIT";
  await capturePayUniSubmitDiagnostic({ url() { throw new Error("closed"); } }, diagnostic, previewHost);
  assert.equal(formatPayUniSubmitDiagnostic(diagnostic), "dialogs=NONE; modal=NONE; host=NONE; path=NONE; errors=NONE");
  await capturePayUniSubmitDiagnostic(null, null, previewHost);
  observePayUniSubmitDialogs({ on() { throw new Error("no events"); } }, diagnostic);
  await recordPayUniSubmitDialog(null, { dismiss: async () => { throw new Error("gone"); } });
});
