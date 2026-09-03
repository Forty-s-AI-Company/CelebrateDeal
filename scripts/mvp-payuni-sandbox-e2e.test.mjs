import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyPayUniApiNetworkFailure,
  isPayUniPaymentPageUrl,
  FIXED_PAYUNI_ENV,
  MVP_PAYUNI_SANDBOX_E2E_SCHEMA,
  SIDE_EFFECT_BUDGET,
  createReceipt,
  fixedCheckoutIdempotencyKey,
  readFixedInputs,
  runMvpPayUniSandboxE2E,
  validateInvocation,
  validateMvpPayUniReceipt,
  validateWrittenMvpPayUniReceipt,
  verifyMvpPayUniLineage,
  writeMvpPayUniReceipt,
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
