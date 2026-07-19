import assert from "node:assert/strict";
import { test } from "vitest";

import {
  PayUniQueryFailure,
  callbackTimeoutDiagnostic,
  payUniRequest,
  paymentPageStructure,
  providerResultDiagnostic,
  reconcileCallbackTimeout,
} from "./payuni-sandbox-external-qa.mjs";

function pageAt(url) {
  return { url: () => url };
}

test("callback timeout reconciliation records three unsuccessful provider checks", async () => {
  const delays = [];
  const result = await reconcileCallbackTimeout({
    orderNumber: "order-1",
    page: pageAt("https://sandbox-api.payuni.com.tw/api/upp?token=hidden"),
    stage: "waiting-payment-callback",
    query: async () => ({ TradeStatus: "0" }),
    sleep: async (milliseconds) => delays.push(milliseconds),
  });

  assert.equal(result.paidTransaction, null);
  assert.deepEqual(delays, [1_000, 1_000]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.querySucceeded), [true, true, true]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.tradeStatus), ["0", "0", "0"]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.tradeNoPresent), [false, false, false]);
  assert.equal(result.attempts[0].currentHttpsHostPath, "sandbox-api.payuni.com.tw/api/upp");
});

test("callback timeout reconciliation retains a transaction found after a delay", async () => {
  let queries = 0;
  const delays = [];
  const paid = { TradeStatus: "1", TradeNo: "payuni-trade-1", TradeAmt: "100" };
  const result = await reconcileCallbackTimeout({
    orderNumber: "order-2",
    page: pageAt("https://sandbox-api.payuni.com.tw/api/upp"),
    stage: "waiting-payment-callback",
    query: async () => {
      queries += 1;
      return queries === 1 ? { TradeStatus: "0" } : paid;
    },
    sleep: async (milliseconds) => delays.push(milliseconds),
  });

  assert.equal(result.paidTransaction, paid);
  assert.equal(queries, 2);
  assert.deepEqual(delays, [1_000]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.tradeStatus), ["0", "1"]);
  assert.equal(result.attempts[1].tradeNoPresent, true);
});

test("callback timeout reconciliation constrains provider query errors and sensitive values", async () => {
  const secret = "CredentialToken7A9B";
  const result = await reconcileCallbackTimeout({
    orderNumber: "order-3",
    page: pageAt(`https://sandbox-api.payuni.com.tw/api/upp?detail=${encodeURIComponent(secret)}`),
    stage: "waiting-payment-callback",
    query: async () => {
      throw new Error(secret);
    },
    sleep: async () => {},
  });

  const output = JSON.stringify(result.attempts);
  assert.equal(result.paidTransaction, null);
  assert.equal(result.attempts.length, 3);
  assert.deepEqual(result.attempts.map((attempt) => attempt.failureStage), ["unknown", "unknown", "unknown"]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.errorCategory), ["unknown", "unknown", "unknown"]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.tradeStatus), ["unavailable", "unavailable", "unavailable"]);
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes("CredentialToken"), false);
});

test("callback timeout reconciliation does not leak unknown alphanumeric provider values", async () => {
  const secret = "ApiKey7A9BSecret";
  const result = await reconcileCallbackTimeout({
    orderNumber: "order-4",
    page: pageAt("https://sandbox-api.payuni.com.tw/api/upp"),
    stage: "waiting-payment-callback",
    query: async () => ({ TradeStatus: secret, TradeNo: secret }),
    sleep: async () => {},
  });

  const output = JSON.stringify(result.attempts);
  assert.equal(result.paidTransaction, null);
  assert.deepEqual(result.attempts.map((attempt) => attempt.tradeStatus), ["unavailable", "unavailable", "unavailable"]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.tradeNoPresent), [true, true, true]);
  assert.equal(output.includes(secret), false);
});

test("callback timeout reconciliation bounds a hung query and continues retrying", async () => {
  const delays = [];
  let queries = 0;
  const result = await reconcileCallbackTimeout({
    orderNumber: "order-5",
    page: pageAt("https://sandbox-api.payuni.com.tw/api/upp"),
    stage: "waiting-payment-callback",
    query: async (_orderNumber, { signal }) => {
      queries += 1;
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    },
    sleep: async (milliseconds) => delays.push(milliseconds),
    queryTimeoutMs: 1,
  });

  assert.equal(result.paidTransaction, null);
  assert.equal(queries, 3);
  assert.deepEqual(delays, [1_000, 1_000]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.failureStage), ["query-timeout", "query-timeout", "query-timeout"]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.errorCategory), ["bounded-timeout", "bounded-timeout", "bounded-timeout"]);
});

test("callback timeout reconciliation serializes only allowlisted query failure classifications", async () => {
  const cases = [
    ["request-configuration", "configuration"],
    ["network-request", "network"],
    ["http-response", "http", { httpStatus: 503 }],
    ["response-envelope", "response-envelope"],
    ["signature-decryption", "signature-decryption"],
    ["provider-result", "provider-rejection", { providerStatus: "FAIL", providerErrorCode: "MPG01001", providerResultType: "object", providerResultFields: ["Code"] }],
    ["order-validation", "order-mismatch"],
  ];

  for (const [failureStage, errorCategory, details = {}] of cases) {
    const result = await reconcileCallbackTimeout({
      orderNumber: "order-6",
      page: pageAt("https://sandbox-api.payuni.com.tw/api/upp"),
      stage: "waiting-payment-callback",
      query: async () => { throw new PayUniQueryFailure(failureStage, details); },
      sleep: async () => {},
    });

    for (const attempt of result.attempts) {
      assert.equal(attempt.failureStage, failureStage);
      assert.equal(attempt.errorCategory, errorCategory);
      assert.equal(attempt.httpStatus, details.httpStatus);
      assert.equal(attempt.providerStatus, details.providerStatus);
    }
  }
});

test("callback timeout reconciliation does not serialize sensitive failure details", async () => {
  const secret = "https://sandbox-api.payuni.com.tw/api/trade/query?token=CredentialToken7A9B";
  const result = await reconcileCallbackTimeout({
    orderNumber: "order-7",
    page: pageAt(`https://sandbox-api.payuni.com.tw/api/upp?detail=${encodeURIComponent(secret)}`),
    stage: "waiting-payment-callback",
    query: async () => {
      throw new PayUniQueryFailure("http-response", {
        httpStatus: 502.5,
        providerStatus: secret,
        cause: new Error(secret),
      });
    },
    sleep: async () => {},
  });

  const output = JSON.stringify(result);
  assert.deepEqual(result.attempts.map((attempt) => attempt.failureStage), ["http-response", "http-response", "http-response"]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.errorCategory), ["http", "http", "http"]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.httpStatus), [undefined, undefined, undefined]);
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes("CredentialToken"), false);
  assert.equal(output.includes("/api/trade/query"), false);
});

test("callback timeout reconciliation revalidates mutable failure scalar fields", async () => {
  const secret = "CredentialToken7A9B";
  const failure = new PayUniQueryFailure("http-response", {
    httpStatus: 503,
    providerStatus: "FAIL",
  });
  failure.httpStatus = secret;
  failure.providerStatus = secret;

  const result = await reconcileCallbackTimeout({
    orderNumber: "order-8",
    page: pageAt("https://sandbox-api.payuni.com.tw/api/upp"),
    stage: "waiting-payment-callback",
    query: async () => { throw failure; },
    sleep: async () => {},
  });

  const output = JSON.stringify(result.attempts);
  for (const attempt of result.attempts) {
    assert.equal(attempt.failureStage, "http-response");
    assert.equal(attempt.errorCategory, "http");
    assert.equal(attempt.httpStatus, undefined);
    assert.equal(attempt.providerStatus, undefined);
  }
  assert.equal(output.includes(secret), false);
});

test("provider rejection retains only allowlisted response diagnostics", () => {
  const diagnostic = providerResultDiagnostic({
    Status: "FAIL",
    Message: "card 4111 1111 1111 1111 was declined",
    Result: {
      MerTradeNo: "order-sensitive",
      TradeNo: "trade-sensitive",
      ErrorCode: "MPG01001",
      Message: "credential=CredentialToken7A9B",
      Unexpected: "keep-out",
    },
  });

  assert.deepEqual(diagnostic, {
    providerStatus: "FAIL",
    providerErrorCode: "MPG01001",
    providerResultType: "object",
    providerResultFields: ["MerTradeNo", "TradeNo", "ErrorCode"],
  });
  assert.equal(JSON.stringify(diagnostic).includes("CredentialToken"), false);
  assert.equal(JSON.stringify(diagnostic).includes("4111"), false);
});

test("provider rejection suppresses unknown or malicious response values", async () => {
  const secret = "CredentialToken7A9B";
  const diagnostic = providerResultDiagnostic({
    Status: secret,
    ErrorCode: secret,
    Result: `Message=${encodeURIComponent(secret)}&CardNumber=4111111111111111`,
  });
  const result = await reconcileCallbackTimeout({
    orderNumber: "order-10",
    page: pageAt("https://sandbox-api.payuni.com.tw/api/upp?token=hidden"),
    stage: "waiting-payment-callback",
    query: async () => { throw new PayUniQueryFailure("provider-result", diagnostic); },
    sleep: async () => {},
  });

  const output = JSON.stringify(result);
  for (const attempt of result.attempts) {
    assert.equal(attempt.failureStage, "provider-result");
    assert.equal(attempt.providerStatus, undefined);
    assert.equal(attempt.providerErrorCode, undefined);
    assert.equal(attempt.providerResultType, "string");
    assert.deepEqual(attempt.providerResultFields, undefined);
  }
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes("411111"), false);
  assert.equal(output.includes("token=hidden"), false);
});

test("provider result field diagnostics are allowlisted and bounded", () => {
  const diagnostic = providerResultDiagnostic({
    Status: "FAILED",
    Code: "E-12",
    Result: [{
      MerTradeNo: "order-sensitive",
      TradeNo: "trade-sensitive",
      TradeStatus: "0",
      PaymentType: "CREDIT",
      RespondCode: "00",
      Auth: "auth-sensitive",
      RefundStatus: "0",
      CloseType: "2",
      TradeAmt: "500",
      RefundAmt: "0",
      ErrorCode: "MPG01001",
      Code: "E-12",
      Status: "FAIL",
    }],
  });

  assert.equal(diagnostic.providerResultType, "array");
  assert.deepEqual(diagnostic.providerResultFields, [
    "MerTradeNo", "TradeNo", "TradeStatus", "PaymentType",
    "RespondCode", "Auth", "RefundStatus", "CloseType",
  ]);
  assert.equal(diagnostic.providerResultFields.length, 8);
  assert.equal(diagnostic.providerErrorCode, "E-12");
});

test("payment page structure records visibility without text or input values", async () => {
  const secret = "CredentialToken7A9B";
  const visible = { isVisible: async () => true };
  const hidden = { isVisible: async () => false };
  const unavailable = { isVisible: async () => { throw new Error(secret); } };
  const page = {
    url: () => `https://sandbox-api.payuni.com.tw/api/upp?token=${secret}`,
    locator: (selector) => ({
      first: () => (selector.includes("validation-error") ? unavailable : visible),
    }),
    getByRole: (_role, options) => (options.name === "確認送出" ? hidden : visible),
  };

  const structure = await paymentPageStructure(page);
  assert.deepEqual(structure, {
    paymentForm: "visible",
    paymentSubmitButton: "not-visible",
    confirmationDialog: "visible",
    validationError: "unavailable",
  });
  assert.equal(JSON.stringify(structure).includes(secret), false);
});

test("callback timeout receipt redacts URL and rejects non-structural page values", () => {
  const secret = "CredentialToken7A9B";
  const diagnostic = callbackTimeoutDiagnostic({
    stage: secret,
    page: pageAt(`https://sandbox-api.payuni.com.tw/api/upp?token=${secret}`),
    confirmationDialogAppeared: true,
    confirmationDialogClicked: true,
    checkoutStatus: 200,
    paymentPage: {
      paymentForm: secret,
      paymentSubmitButton: "visible",
      confirmationDialog: "not-visible",
      validationError: "visible",
    },
    callbackQueryAttempts: [],
  });

  assert.deepEqual(diagnostic.checks.providerChecks.paymentPage, {
    paymentForm: "unavailable",
    paymentSubmitButton: "visible",
    confirmationDialog: "not-visible",
    validationError: "visible",
  });
  assert.equal(diagnostic.checks.providerChecks.stage, "unavailable");
  assert.equal(JSON.stringify(diagnostic).includes(secret), false);
  assert.equal(JSON.stringify(diagnostic).includes("token="), false);
});

test("PayUni request classifies malformed non-string outer fields as a response envelope", async () => {
  const environmentKeys = ["PAYUNI_MERCHANT_ID", "PAYUNI_HASH_KEY", "PAYUNI_HASH_IV"];
  const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.PAYUNI_MERCHANT_ID = "merchant-test";
  process.env.PAYUNI_HASH_KEY = "12345678901234567890123456789012";
  process.env.PAYUNI_HASH_IV = "1234567890123456";

  try {
    for (const outer of [
      { EncryptInfo: { sensitive: "CredentialToken7A9B" }, HashInfo: "hash" },
      { EncryptInfo: "encrypted", HashInfo: ["CredentialToken7A9B"] },
    ]) {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(outer),
      });
      await assert.rejects(
        () => payUniRequest("/api/trade/query", "2.0", { MerTradeNo: "order-9" }),
        (error) => error instanceof PayUniQueryFailure && error.failureStage === "response-envelope",
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
