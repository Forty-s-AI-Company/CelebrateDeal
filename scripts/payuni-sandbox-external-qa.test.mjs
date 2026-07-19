import assert from "node:assert/strict";
import { test } from "vitest";

import { reconcileCallbackTimeout } from "./payuni-sandbox-external-qa.mjs";

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
  assert.deepEqual(result.attempts.map((attempt) => attempt.errorCategory), ["query-failed", "query-failed", "query-failed"]);
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
  assert.deepEqual(result.attempts.map((attempt) => attempt.errorCategory), ["query-failed", "query-failed", "query-failed"]);
});
