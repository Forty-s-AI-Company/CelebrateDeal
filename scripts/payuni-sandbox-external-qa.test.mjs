import assert from "node:assert/strict";
import { test, vi } from "vitest";

import {
  PayUniQueryFailure,
  callbackTimeoutDiagnostic,
  payUniRequest,
  paymentPageStructure,
  providerResultDiagnostic,
  reconcileCallbackTimeout,
} from "./payuni-sandbox-external-qa.mjs";

const DIAGNOSTIC_HASH_KEY = "12345678901234567890123456789012";

function pageAt(url) {
  return { url: () => url };
}

function withHashKey(key, callback) {
  const previous = process.env.PAYUNI_HASH_KEY;
  process.env.PAYUNI_HASH_KEY = key;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.PAYUNI_HASH_KEY;
    else process.env.PAYUNI_HASH_KEY = previous;
  }
}

function diagnosticForDisposition(disposition) {
  const cases = {
    "terminal-authentication": { Status: "QUERY01002" },
    "terminal-invalid-request": { Status: "QUERY02002" },
    "retryable-not-found": { Status: "QUERY03001" },
    "retryable-processing": { Status: "API00009" },
    "retryable-provider": { Status: "QUERY01006" },
    unknown: { Status: "UNRECOGNISED-CODE" },
  };
  return providerResultDiagnostic({ ...cases[disposition], Message: "neutral" });
}

test("provider disposition is derived only from fixed documented status cases", () => {
  const cases = [
    ["QUERY01002", "terminal-authentication"],
    ["QUERY02002", "terminal-invalid-request"],
    ["QUERY03001", "retryable-not-found"],
    ["API00009", "retryable-processing"],
    ["QUERY01006", "retryable-provider"],
    ["UNRECOGNISED-STATUS", "unknown"],
  ];
  for (const [status, disposition] of cases) {
    const diagnostic = providerResultDiagnostic({ Status: status, Message: "" });
    assert.equal(diagnostic.providerDisposition, disposition, status);
  }
});

test("provider disposition is derived only from fixed documented ErrorCode cases", () => {
  const cases = [
    ["QUERY01002", "terminal-authentication"],
    ["QUERY02002", "terminal-invalid-request"],
    ["QUERY03001", "retryable-not-found"],
    ["API00009", "retryable-processing"],
    ["QUERY01006", "retryable-provider"],
  ];
  for (const [errorCode, disposition] of cases) {
    const diagnostic = providerResultDiagnostic({ Status: "FAIL", ErrorCode: errorCode, Message: "neutral" });
    assert.equal(diagnostic.providerDisposition, disposition, errorCode);
  }
});

test("only envelope Status and ErrorCode affect disposition, with ErrorCode taking precedence", () => {
  const aliases = ["Code", "StatusCode", "RespondCode"];
  for (const field of aliases) {
    assert.equal(providerResultDiagnostic({ Status: "FAIL", [field]: "QUERY01002", Message: "" }).providerDisposition, "unknown", field);
    assert.equal(providerResultDiagnostic({ Status: "FAIL", Result: { [field]: "QUERY01002" }, Message: "" }).providerDisposition, "unknown", `Result.${field}`);
    assert.equal(providerResultDiagnostic({ Status: "API00009", [field]: "QUERY01002", Message: "" }).providerDisposition, "retryable-processing", `${field} conflict`);
  }
  assert.equal(
    providerResultDiagnostic({ Status: "API00009", ErrorCode: "QUERY01002", Message: "" }).providerDisposition,
    "terminal-authentication",
  );
  assert.equal(providerResultDiagnostic({ Status: "FAIL", ErrorCode: "NOT-DOCUMENTED", Message: "" }).providerDisposition, "unknown");
});

test("neutral, blank, and misleading provider messages never select a disposition", () => {
  for (const message of ["", "neutral", "驗證成功", "參數處理中"]) {
    const diagnostic = withHashKey(DIAGNOSTIC_HASH_KEY, () => providerResultDiagnostic({
      Status: "FAIL",
      ErrorCode: "UNRECOGNISED-CODE",
      Message: message,
    }));
    assert.equal(diagnostic.providerDisposition, "unknown");
    assert.equal(diagnostic.providerStatus.code, "unavailable");
    assert.equal(diagnostic.providerMessage.category, "unavailable");
    assert.equal(diagnostic.providerMessage.jsonType, "string");
    assert.match(diagnostic.providerMessage.reference, /^hmac-sha256:[a-f0-9]{16}$/);
    if (message) assert.equal(JSON.stringify(diagnostic).includes(message), false);
  }
});

test("documented query failures expose only the exact allowlisted code and safe message category", () => {
  const diagnostic = withHashKey(DIAGNOSTIC_HASH_KEY, () => providerResultDiagnostic({
    Status: "QUERY03001",
    Message: "查無符合訂單資料",
  }));
  assert.equal(diagnostic.providerDisposition, "retryable-not-found");
  assert.equal(diagnostic.providerStatus.code, "QUERY03001");
  assert.equal(diagnostic.providerErrorCode.code, "unavailable");
  assert.equal(diagnostic.providerMessage.category, "transaction-not-found");
  assert.equal(JSON.stringify(diagnostic).includes("查無符合訂單資料"), false);
});

test("terminal dispositions stop early while retryable and unknown dispositions consume the fixed budget", async () => {
  const cases = [
    ["terminal-authentication", 1, []],
    ["terminal-invalid-request", 1, []],
    ["retryable-not-found", 3, [1_000, 1_000]],
    ["retryable-processing", 3, [1_000, 1_000]],
    ["retryable-provider", 3, [1_000, 1_000]],
    ["unknown", 3, [1_000, 1_000]],
  ];

  for (const [disposition, attemptsExpected, delaysExpected] of cases) {
    const delays = [];
    const result = await reconcileCallbackTimeout({
      orderNumber: "order-private",
      page: pageAt("https://sandbox-api.payuni.com.tw/api/upp?token=private"),
      stage: "waiting-payment-callback",
      query: async () => {
        throw new PayUniQueryFailure("provider-result", diagnosticForDisposition(disposition));
      },
      sleep: async (milliseconds) => delays.push(milliseconds),
    });
    assert.equal(result.attempts.length, attemptsExpected, disposition);
    assert.deepEqual(delays, delaysExpected, disposition);
    assert.deepEqual(result.attempts.map((attempt) => attempt.providerDisposition), Array(attemptsExpected).fill(disposition));
  }
});

test("an unbranded disposition cannot create an early terminal stop", async () => {
  const result = await reconcileCallbackTimeout({
    orderNumber: "order-private",
    page: pageAt("https://sandbox-api.payuni.com.tw/api/upp"),
    stage: "waiting-payment-callback",
    query: async () => {
      throw new PayUniQueryFailure("provider-result", { providerDisposition: "terminal-invalid-request" });
    },
    sleep: async () => {},
  });
  assert.equal(result.attempts.length, 3);
  assert.deepEqual(result.attempts.map((attempt) => attempt.providerDisposition), ["unknown", "unknown", "unknown"]);
});

test("only provider-result failures can retain a table-backed disposition", async () => {
  const providerDiagnostic = diagnosticForDisposition("terminal-invalid-request");
  const result = await reconcileCallbackTimeout({
    orderNumber: "order-private",
    page: pageAt("https://sandbox-api.payuni.com.tw/api/upp"),
    stage: "waiting-payment-callback",
    query: async () => {
      throw new PayUniQueryFailure("network-request", providerDiagnostic);
    },
    sleep: async () => {},
  });
  assert.equal(result.attempts.length, 3);
  assert.deepEqual(result.attempts.map((attempt) => attempt.providerDisposition), ["unknown", "unknown", "unknown"]);
});

test("callback diagnostics discard a forged disposition but retain an internally built one", async () => {
  const reconciliation = await reconcileCallbackTimeout({
    orderNumber: "order-private",
    page: pageAt("https://sandbox-api.payuni.com.tw/api/upp"),
    stage: "waiting-payment-callback",
    query: async () => { throw new PayUniQueryFailure("provider-result", diagnosticForDisposition("terminal-invalid-request")); },
    sleep: async () => {},
  });
  const diagnostic = callbackTimeoutDiagnostic({
    stage: "waiting-payment-callback",
    page: pageAt("https://sandbox-api.payuni.com.tw/api/upp"),
    confirmationDialogAppeared: false,
    confirmationDialogClicked: false,
    checkoutStatus: 200,
    paymentPage: {},
    callbackQueryAttempts: reconciliation.attempts,
  });
  assert.equal(diagnostic.checks.providerChecks.callbackTradeQueries[0].providerDisposition, "terminal-invalid-request");

  const forged = callbackTimeoutDiagnostic({
    stage: "waiting-payment-callback",
    page: pageAt("https://sandbox-api.payuni.com.tw/api/upp"),
    confirmationDialogAppeared: false,
    confirmationDialogClicked: false,
    checkoutStatus: 200,
    paymentPage: {},
    callbackQueryAttempts: [{ querySucceeded: false, providerDisposition: "terminal-invalid-request" }],
  });
  assert.equal(forged.checks.providerChecks.callbackTradeQueries[0].providerDisposition, "unknown");
});

test("a normal pending trade is retryable and a paid trade ends reconciliation", async () => {
  let calls = 0;
  const result = await reconcileCallbackTimeout({
    orderNumber: "order-private",
    page: pageAt("https://sandbox-api.payuni.com.tw/api/upp"),
    stage: "waiting-payment-callback",
    query: async () => {
      calls += 1;
      return calls === 1 ? { TradeStatus: "0" } : { TradeStatus: "1", TradeNo: "trade-private" };
    },
    sleep: async () => {},
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.attempts.map((attempt) => attempt.providerDisposition), ["retryable-processing", "unknown"]);
  assert.equal(result.attempts[1].tradeNoPresent, true);
  assert.equal(result.paidTransactionFound, true);
  assert.equal("paidTransaction" in result, false);
  assert.equal(JSON.stringify(result).includes("trade-private"), false);
});

test("successful provider rows remain internal to reconciliation", async () => {
  const privateRow = {
    TradeStatus: "1",
    TradeNo: "trade-private-7A9B",
    TradeAmt: "499",
    MerTradeNo: "order-private-7A9B",
    Card6No: "411111",
    Card4No: "1111",
  };
  const result = await reconcileCallbackTimeout({
    orderNumber: "order-private-7A9B",
    page: pageAt("https://sandbox-api.payuni.com.tw/api/upp"),
    stage: "waiting-payment-callback",
    query: async () => privateRow,
    sleep: async () => {},
  });
  const serialized = JSON.stringify(result);
  assert.equal(result.paidTransactionFound, true);
  for (const secret of [
    privateRow.TradeNo,
    privateRow.TradeAmt,
    privateRow.MerTradeNo,
    privateRow.Card6No,
    privateRow.Card4No,
  ]) assert.equal(serialized.includes(secret), false);
});

test("payUniRequest rejects each non-string response envelope field", async () => {
  const previous = {
    fetch: globalThis.fetch,
    hashKey: process.env.PAYUNI_HASH_KEY,
    hashIv: process.env.PAYUNI_HASH_IV,
    merchantId: process.env.PAYUNI_MERCHANT_ID,
  };
  let outerResponse;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify(outerResponse),
  });
  process.env.PAYUNI_HASH_KEY = DIAGNOSTIC_HASH_KEY;
  process.env.PAYUNI_HASH_IV = "1234567890123456";
  process.env.PAYUNI_MERCHANT_ID = "merchant-test";
  try {
    for (const invalidEnvelope of [
      { EncryptInfo: 7, HashInfo: "not-used" },
      { EncryptInfo: "not-used", HashInfo: { malicious: true } },
    ]) {
      outerResponse = invalidEnvelope;
      await assert.rejects(
        () => payUniRequest("/api/trade/query", "2.0", { MerTradeNo: "order-private", Timestamp: 1 }),
        (error) => error instanceof PayUniQueryFailure && error.failureStage === "response-envelope",
      );
    }
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [name, value] of Object.entries({
      PAYUNI_HASH_KEY: previous.hashKey,
      PAYUNI_HASH_IV: previous.hashIv,
      PAYUNI_MERCHANT_ID: previous.merchantId,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("hung queries use the per-query timeout and never exceed the total reconciliation budget", async () => {
  vi.useFakeTimers();
  try {
    let calls = 0;
    const pending = reconcileCallbackTimeout({
      orderNumber: "order-private",
      page: pageAt("https://sandbox-api.payuni.com.tw/api/upp"),
      stage: "waiting-payment-callback",
      query: async () => {
        calls += 1;
        return new Promise(() => {});
      },
      sleep: async () => new Promise(() => {}),
    });
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(16_999);
    assert.equal(settled, false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    assert.equal(calls, 3);
    assert.equal(result.attempts.length, 3);
    assert.deepEqual(result.attempts.map((attempt) => attempt.failureStage), ["query-timeout", "query-timeout", "query-timeout"]);
    assert.equal(vi.getTimerCount(), 0);
  } finally {
    vi.useRealTimers();
  }
});

test("a locator failure is entirely best effort and does not interrupt all provider checks", async () => {
  const secret = "CredentialToken7A9B";
  const page = {
    url: () => "https://sandbox-api.payuni.com.tw/api/upp?token=CredentialToken7A9B",
    locator: () => { throw new Error(secret); },
    getByRole: () => { throw new Error(secret); },
  };
  const structure = await paymentPageStructure(page);
  assert.deepEqual(structure, {
    paymentForm: "unavailable",
    paymentSubmitButton: "unavailable",
    confirmationDialog: "unavailable",
    validationError: "unavailable",
  });

  let queries = 0;
  const reconciliation = await reconcileCallbackTimeout({
    orderNumber: "order-private",
    page,
    stage: "waiting-payment-callback",
    query: async () => {
      queries += 1;
      return { TradeStatus: "0" };
    },
    sleep: async () => {},
  });
  assert.equal(queries, 3);
  assert.equal(reconciliation.attempts.length, 3);
  assert.equal(JSON.stringify({ structure, reconciliation }).includes(secret), false);
});

test("a closed or detached page is unavailable observation and does not interrupt reconciliation", async () => {
  const page = {
    url: () => { throw new Error("Target page, context or browser has been closed"); },
    locator: () => { throw new Error("Frame was detached"); },
    getByRole: () => { throw new Error("Frame was detached"); },
  };
  assert.deepEqual(await paymentPageStructure(page), {
    paymentForm: "unavailable",
    paymentSubmitButton: "unavailable",
    confirmationDialog: "unavailable",
    validationError: "unavailable",
  });
  let queries = 0;
  const reconciliation = await reconcileCallbackTimeout({
    orderNumber: "order-private",
    page,
    stage: "waiting-payment-callback",
    query: async () => {
      queries += 1;
      return { TradeStatus: "0" };
    },
    sleep: async () => {},
  });
  assert.equal(queries, 3);
  assert.deepEqual(reconciliation.attempts.map((attempt) => attempt.currentHttpsHostPath), ["unavailable", "unavailable", "unavailable"]);
});

test("only the exact PayUni UPP location can appear in attempts, diagnostics, or error text", async () => {
  const secret = "CredentialToken7A9B";
  const locations = [
    "https://sandbox-api.payuni.com.tw/api/private/" + secret,
    "https://other.example/api/upp?token=" + secret,
    "http://sandbox-api.payuni.com.tw/api/upp?token=" + secret,
    "https://sandbox-api.payuni.com.tw:443/api/upp?token=" + secret,
    "https://user:password@sandbox-api.payuni.com.tw/api/upp?token=" + secret,
  ];

  for (const location of locations) {
    const result = await reconcileCallbackTimeout({
      orderNumber: "order-private",
      page: pageAt(location),
      stage: "waiting-payment-callback",
      query: async () => ({ TradeStatus: "0" }),
      sleep: async () => {},
    });
    assert.deepEqual(result.attempts.map((attempt) => attempt.currentHttpsHostPath), ["unavailable", "unavailable", "unavailable"]);
    const diagnostic = callbackTimeoutDiagnostic({
      stage: "waiting-payment-callback",
      page: pageAt(location),
      confirmationDialogAppeared: false,
      confirmationDialogClicked: false,
      checkoutStatus: 200,
      paymentPage: {},
      callbackQueryAttempts: result.attempts,
    });
    const output = JSON.stringify(diagnostic);
    assert.equal(output.includes(secret), false);
    assert.equal(output.includes("/api/private"), false);
    assert.equal(output.includes("other.example"), false);
  }
});

test("the exact UPP location is fixed while query and fragment are never serialized", async () => {
  const secret = "CredentialToken7A9B";
  const location = `https://sandbox-api.payuni.com.tw/api/upp?token=${secret}#${secret}`;
  const result = await reconcileCallbackTimeout({
    orderNumber: "order-private",
    page: pageAt(location),
    stage: "waiting-payment-callback",
    query: async () => ({ TradeStatus: "0" }),
    sleep: async () => {},
  });
  const diagnostic = callbackTimeoutDiagnostic({
    stage: "waiting-payment-callback",
    page: pageAt(location),
    confirmationDialogAppeared: true,
    confirmationDialogClicked: true,
    checkoutStatus: 200,
    paymentPage: {},
    callbackQueryAttempts: result.attempts,
  });
  const output = JSON.stringify({ result, diagnostic });
  assert.deepEqual(result.attempts.map((attempt) => attempt.currentHttpsHostPath), Array(3).fill("sandbox-api.payuni.com.tw/api/upp"));
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes("token="), false);
});

test("the receipt boundary removes mutated raw provider fields", async () => {
  const secret = "4111111111111111 CredentialToken7A9B order-private trade-private";
  const failure = new PayUniQueryFailure("provider-result", diagnosticForDisposition("terminal-invalid-request"));
  failure.providerDisposition = secret;
  failure.providerStatus = secret;
  failure.providerErrorCode = { valuePresent: true, jsonType: "raw", lengthBucket: secret, reference: secret };
  failure.providerMessage = { jsonType: "string", lengthBucket: "33-128", reference: secret };

  const result = await reconcileCallbackTimeout({
    orderNumber: "order-private",
    page: pageAt("https://sandbox-api.payuni.com.tw/api/upp"),
    stage: "waiting-payment-callback",
    query: async () => { throw failure; },
    sleep: async () => {},
  });
  assert.equal(result.attempts.length, 1);
  for (const attempt of result.attempts) {
    assert.equal(attempt.providerDisposition, "terminal-invalid-request");
    assert.deepEqual(attempt.providerStatus, { valuePresent: false, code: "unavailable", jsonType: "absent", lengthBucket: "absent" });
    assert.deepEqual(attempt.providerErrorCode, { valuePresent: false, code: "unavailable", jsonType: "absent", lengthBucket: "absent" });
    assert.deepEqual(attempt.providerMessage, { category: "unavailable", jsonType: "string", lengthBucket: "33-128" });
  }
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("callback timeout diagnostics rebuild attempts instead of retaining caller objects", () => {
  const secret = "https://attacker.invalid/private?card=4111111111111111";
  const diagnostic = callbackTimeoutDiagnostic({
    stage: "waiting-payment-callback",
    page: pageAt("https://sandbox-api.payuni.com.tw/api/upp"),
    confirmationDialogAppeared: secret,
    confirmationDialogClicked: secret,
    checkoutStatus: 200,
    paymentPage: {},
    callbackQueryAttempts: [{
      attempt: 1,
      querySucceeded: false,
      failureStage: "provider-result",
      errorCategory: secret,
      providerDisposition: "retryable-processing",
      providerStatus: secret,
      providerErrorCode: secret,
      providerMessage: secret,
      currentHttpsHostPath: secret,
      flowStage: secret,
      orderNumber: secret,
      card: secret,
    }],
  });
  const attempt = diagnostic.checks.providerChecks.callbackTradeQueries[0];
  assert.equal(diagnostic.checks.providerChecks.confirmationDialogAppeared, false);
  assert.equal(diagnostic.checks.providerChecks.confirmationDialogClicked, false);
  assert.deepEqual(attempt, {
    attempt: 1,
    querySucceeded: false,
    tradeStatus: "unavailable",
    tradeNoPresent: false,
    providerDisposition: "unknown",
    currentHttpsHostPath: "unavailable",
    flowStage: "unavailable",
    failureStage: "provider-result",
    errorCategory: "provider-rejection",
    providerStatus: { valuePresent: false, code: "unavailable", jsonType: "absent", lengthBucket: "absent" },
    providerErrorCode: { valuePresent: false, code: "unavailable", jsonType: "absent", lengthBucket: "absent" },
    providerMessage: { category: "unavailable", jsonType: "absent", lengthBucket: "absent" },
  });
  assert.equal(JSON.stringify(diagnostic).includes(secret), false);
});
