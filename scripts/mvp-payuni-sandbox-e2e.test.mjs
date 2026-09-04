import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyPayUniApiNetworkFailure,
  defaultBrowserSubmit,
  defaultSubscriptionBrowserSubmit,
  finalizeMvpPayUniSubscriptionReceipt,
  isPayUniPaymentPageUrl,
  FIXED_PAYUNI_ENV,
  FIXED_SUBSCRIPTION_PURPOSE,
  EXISTING_REFUND_RECOVERY_SOURCE_SHA,
  EXISTING_REFUND_RECOVERY_SCHEMA,
  MVP_PAYUNI_SANDBOX_E2E_SCHEMA,
  MVP_PAYUNI_SANDBOX_SUBSCRIPTION_SCHEMA,
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
  writeExistingRefundRecoveryReceipt,
  writeMvpPayUniReceipt,
  writeMvpPayUniSubscriptionReceipt,
} from "./mvp-payuni-sandbox-e2e.mjs";

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
      if (request.url.endsWith("/wp4-fixture")) return response(200, { ready: true, createdCount: 5, reusedCount: 0 });
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
      return true;
    },
  };
}

function successfulSubscriptionDependencies(calls = []) {
  let stateReads = 0;
  return {
    async request(request) {
      calls.push(request);
      if (request.url.endsWith("/wp4-fixture")) return response(200, { ready: true, createdCount: 5, reusedCount: 0 });
      if (request.url.endsWith("/wp4-session")) {
        return { status: 204, sessionCookie: "celebrate_session=opaque-owner-session" };
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
      assert.equal(browserInput.ownerSessionCookie, "celebrate_session=opaque-owner-session");
      assert.equal(browserInput.markNativePlanCheckoutCreated(), true);
      assert.equal(await browserInput.reservePaymentAttempt(), true);
      assert.equal(browserInput.markPaymentSubmission(), true);
      return true;
    },
  };
}

test("buyer browser submission uses a fixed environment and fails closed on confirmation", async () => {
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
      if (options.name === "確定") return { async waitFor() {}, async click() { confirmationClicks += 1; } };
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
});

test("buyer fixture contract rejects retired six-entity and invalid counts", async () => {
  for (const createdCount of [6, 4]) {
    let browserCalled = false;
    const receipt = await runMvpPayUniSandboxE2E(validInput, {
      request: async () => response(200, { ready: true, createdCount, reusedCount: 0 }),
      browserSubmit: async () => { browserCalled = true; return true; },
    });
    assert.equal(receipt.failure, "FIXTURE_HTTP_REJECTED");
    assert.equal(browserCalled, false);
  }
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
    ownerSessionCookie: "celebrate_session=opaque-owner-session",
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
  assert.equal(ownerCookie.name, "celebrate_session");
  assert.equal(closed, 1);

  selected = 0;
  submitted = 0;
  reserved = 0;
  marked = 0;
  nativeCheckouts = 0;
  confirmationVisible = true;
  const ambiguous = await defaultSubscriptionBrowserSubmit({
    previewHost,
    ownerSessionCookie: "celebrate_session=opaque-owner-session",
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
    ownerSessionCookie: "celebrate_session=opaque-owner-session",
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
    [503, "untrusted-detail", "FIXTURE_HTTP_REJECTED"],
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

test("verifies exact ready Preview lineage and health before secret injection", async () => {
  const source = {
    CELEBRATEDEAL_SOURCE_SHA: sourceSha,
    CELEBRATEDEAL_DEPLOYMENT_HOST: previewHost,
    GITHUB_TOKEN: "test-github-token",
  };
  const valid = await verifyMvpPayUniLineage(source, {
    verifyDeploymentImpl: async (received) => {
      assert.equal(received.CELEBRATEDEAL_SOURCE_SHA, sourceSha);
      assert.equal(received.CELEBRATEDEAL_DEPLOYMENT_HOST, previewHost);
      return { host: previewHost, deploymentMatched: true, sourceMatched: true, preview: true, ready: true };
    },
    fetchImpl: async (url, init) => {
      assert.equal(url, `https://${previewHost}/api/health`);
      assert.equal(init.method, "HEAD");
      return new Response(null, { status: 200 });
    },
  });
  assert.equal(valid, true);

  assert.equal(await verifyMvpPayUniLineage({ ...source, CELEBRATEDEAL_DEPLOYMENT_HOST: "example.com" }), false);
  assert.equal(await verifyMvpPayUniLineage({ ...source, GITHUB_TOKEN: "" }), false);
  assert.equal(await verifyMvpPayUniLineage(source, {
    verifyDeploymentImpl: async () => ({ host: previewHost, deploymentMatched: true, sourceMatched: false, preview: true, ready: true }),
  }), false);
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
