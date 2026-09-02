import assert from "node:assert/strict";
import test from "node:test";

import {
  FIXED_PAYUNI_ENV,
  MVP_PAYUNI_SANDBOX_E2E_SCHEMA,
  SIDE_EFFECT_BUDGET,
  createReceipt,
  fixedCheckoutIdempotencyKey,
  readFixedInputs,
  runMvpPayUniSandboxE2E,
  validateInvocation,
  validateMvpPayUniReceipt,
  verifyMvpPayUniLineage,
} from "./mvp-payuni-sandbox-e2e.mjs";

const sourceSha = "a".repeat(40);
const previewHost = "celebratedeal-wp4-20bc897.vercel.app";
const validInput = Object.freeze({
  sourceSha,
  previewHost,
  jobSecret: "test-job-secret",
  cardNumber: "4111 1111 1111 1111",
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
        return response(200, { status: "COMPLETED", purpose: "buyer_order", phase: "partial", providerWriteAttempted: true });
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
    PAYUNI_SANDBOX_ONETIME_CARD_NO: "4111111111111111",
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
  assert.equal(receipt.failure, "PAYMENT_ATTEMPT_REJECTED");
  assert.equal(browserSubmits, 0);
  assert.equal(receipt.sideEffects.refundPosts, 0);
});

test("an already-paid retry resumes at refund without a second payment submission", async () => {
  const calls = [];
  const dependencies = successfulDependencies(calls);
  const originalRequest = dependencies.request;
  dependencies.request = async (request) => request.url.endsWith("/wp4-payment-attempt")
    ? response(200, { status: "ALREADY_PAID", reservationCreated: false })
    : originalRequest(request);
  let browserSubmits = 0;
  dependencies.browserSubmit = async () => { browserSubmits += 1; return true; };

  const receipt = await runMvpPayUniSandboxE2E(validInput, dependencies);
  assert.equal(receipt.result, "PASS");
  assert.equal(browserSubmits, 0);
  assert.equal(receipt.sideEffects.payments, 0);
  assert.equal(receipt.checks.reconciled, true);
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
