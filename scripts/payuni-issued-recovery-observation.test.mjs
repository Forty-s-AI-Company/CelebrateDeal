import test from "node:test";
import assert from "node:assert/strict";
import { observeIssuedRecovery } from "./payuni-issued-recovery-observation.mjs";

const expected = { orderNumber: "synthetic_order", amount: 1 };
const row = (status, extra = {}) => ({ MerTradeNo: expected.orderNumber,
  TradeNo: "synthetic_trade", TradeAmt: 1, PaymentType: "1", TradeStatus: status, ...extra });

function fixture(before, after = row("1"), available = true) {
  const calls = [];
  return { calls, input: { expected,
    queryProvider: async order => { calls.push(["query", order]); return calls.length === 1 ? before : after; },
    originalPage: {
      retryAvailable: async () => { calls.push(["availability"]); return available; },
      retryOnce: async () => { calls.push(["retry"]); },
    },
  } };
}

for (const status of ["2", "3", "4"]) test(`observes original trade after terminal unpaid status ${status}`, async () => {
  const { input, calls } = fixture(row(status));
  const receipt = await observeIssuedRecovery(input);
  assert.equal(receipt.result, "SAME_TRADE_PAYMENT_OBSERVED");
  assert.deepEqual(calls.map(c => c[0]), ["query", "availability", "retry", "query"]);
  assert.equal(receipt.retryAttempts, 1);
  assert.equal(receipt.replacementCheckoutRequested, false);
  assert.equal(JSON.stringify(receipt).includes("synthetic_trade"), false);
  assert.equal(JSON.stringify(receipt).includes("synthetic_order"), false);
});

for (const status of ["0", "9", "1", "8", "unknown"]) test(`does not retry ambiguous or nonterminal status ${status}`, async () => {
  const { input, calls } = fixture(row(status));
  await assert.rejects(observeIssuedRecovery(input), /OBSERVATION_REJECTED/);
  assert.deepEqual(calls.map(c => c[0]), ["query"]);
});

test("records no retry button without attempting a payment", async () => {
  const { input, calls } = fixture(row("2"), row("1"), false);
  assert.equal((await observeIssuedRecovery(input)).result, "ORIGINAL_PAGE_RETRY_UNAVAILABLE");
  assert.deepEqual(calls.map(c => c[0]), ["query", "availability"]);
});

test("detects a new provider trade rather than passing a paid replacement", async () => {
  const { input } = fixture(row("2"), row("1", { TradeNo: "replacement_trade" }));
  const receipt = await observeIssuedRecovery(input);
  assert.equal(receipt.result, "REPLACEMENT_TRADE_DETECTED");
  assert.equal(receipt.sameTrade, false);
});

test("rejects changed amount or order before allowing retry", async () => {
  for (const extra of [{ TradeAmt: 2 }, { MerTradeNo: "another_order" }, { PaymentType: "2" }, { TradeNo: "" }]) {
    const { input, calls } = fixture(row("2", extra));
    await assert.rejects(observeIssuedRecovery(input));
    assert.deepEqual(calls.map(c => c[0]), ["query"]);
  }
});

test("does not retry again if original-page retry or final query fails", async () => {
  for (const failing of ["retry", "final-query"]) {
    const { input, calls } = fixture(row("2"));
    if (failing === "retry") input.originalPage.retryOnce = async () => { calls.push(["retry"]); throw new Error("synthetic"); };
    else input.queryProvider = async () => { calls.push(["query"]); if (calls.length > 1) throw new Error("synthetic"); return row("2"); };
    await assert.rejects(observeIssuedRecovery(input));
    assert.equal(calls.filter(c => c[0] === "retry").length, 1);
  }
});

test("reports a still-unpaid original trade without claiming success", async () => {
  const { input } = fixture(row("2"), row("2"));
  const receipt = await observeIssuedRecovery(input);
  assert.equal(receipt.result, "SAME_TRADE_NOT_PAID");
  assert.equal(receipt.paid, false);
});
