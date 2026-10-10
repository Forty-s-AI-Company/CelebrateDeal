import { test } from "node:test";
import assert from "node:assert/strict";
import { reference } from "./payuni-sandbox-payment-handoff.mjs";
import { createOriginalRefundHandoff, assertOriginalProofMatchesHandoff, originalPaidQueryChecks, originalPaidQueryShape, ORIGINAL_TRANSACTION_SOURCE } from "./q1-original-refund-handoff.mjs";
const source = "a".repeat(40), now = new Date("2026-10-11T00:00:00Z");
function fixture() {
  const target = { transactionId: "synthetic-original", orderNumber: "synthetic-order", providerTradeNo: "synthetic-trade" };
  const proof = { schemaVersion: "celebratedeal-payuni-pending-refund-proof/v1", sourceCommit: source,
    transactionSourceCommit: ORIGINAL_TRANSACTION_SOURCE, historicalOriginalBound: true, vendorId: "wp4_synthetic_vendor_v1",
    environment: "preview", payuniEnvironment: "sandbox", appHost: "celebrate-deal-staging.carry-digital-nomad.in.net",
    providerHost: "sandbox-api.payuni.com.tw", databaseBound: true, nonProductionScope: "fixed-staging-project",
    paymentCallbackMatched: true, grossAmountCents: 100, status: "paid", refundedAmountCents: 0, refundRecordCount: 0,
    transactionRef: reference(target.transactionId), orderRef: reference(target.orderNumber), tradeRef: reference(target.providerTradeNo) };
  return { proof, target, paid: { MerTradeNo: target.orderNumber, TradeNo: target.providerTradeNo,
    TradeStatus: "1", TradeAmt: "1", PaymentType: "1", DataSource: "A", RemainAmt: "1", RefundAmt: "0" },
    browser: { origin: `https://${proof.appHost}`, exactTransactionRef: proof.transactionRef,
      formTransactionRef: proof.transactionRef, exactRefundFormCount: 1, csrfPresent: true, financeAuthenticated: true },
    executionSource: source, startedAt: now.toISOString(), completedAt: now.toISOString(), now };
}
test("fresh exact original handoff preserves provenance and never claims historical checkout", () => {
  const input = fixture(), receipt = createOriginalRefundHandoff(input);
  assertOriginalProofMatchesHandoff(receipt, input.proof, input.target.transactionId, source, now);
  assert.equal(receipt.transactionSourceCommit, ORIGINAL_TRANSACTION_SOURCE);
  assert.equal(receipt.executionSource, source); assert.equal(receipt.checks.browserCheckout, undefined);
  assert.ok(!JSON.stringify(receipt).includes(input.target.transactionId));
});
for (const [key, value] of Object.entries({ sourceCommit: "b".repeat(40), transactionSourceCommit: source,
  historicalOriginalBound: false, vendorId: "foreign", payuniEnvironment: "production", databaseBound: false,
  nonProductionScope: "disposable", paymentCallbackMatched: false, grossAmountCents: 200,
  status: "refunded", refundedAmountCents: 100, refundRecordCount: 1 })) {
  test(`rejects original proof drift ${key}`, () => { const input = fixture(); input.proof[key] = value; assert.throws(() => createOriginalRefundHandoff(input)); });
}
for (const [key, value] of Object.entries({ MerTradeNo: "other", TradeNo: "other", TradeStatus: "2", TradeAmt: "2",
  PaymentType: "2", DataSource: "B", RemainAmt: "0", RefundAmt: "1" })) {
  test(`rejects signed provider observation mismatch ${key}`, () => {
    const input = fixture(); input.paid[key] = value;
    assert.throws(() => createOriginalRefundHandoff(input));
    const checks = Object.values(originalPaidQueryChecks(input.paid, input.target));
    assert.equal(checks.filter(value => value === false).length, 1);
    assert.ok(checks.every(value => typeof value === "boolean"));
  });
}

test("paid query diagnostics emit only immutable booleans, never raw response or identities", () => {
  const input = fixture(); input.paid.unrecognizedResponse = "opaque-provider-probe-do-not-emit";
  const checks = originalPaidQueryChecks(input.paid, input.target);
  assert.equal(Object.keys(checks).length, 8);
  assert.ok(Object.values(checks).every(value => value === true));
  assert.ok(Object.isFrozen(checks));
  const serialized = JSON.stringify(checks);
  for (const value of [input.target.orderNumber, input.target.providerTradeNo, input.paid.unrecognizedResponse]) {
    assert.ok(!serialized.includes(value));
  }
});

test("diagnostics preserve rejection of absent, empty, malformed and boolean balances", () => {
  for (const value of [undefined, null, "", " ", true, false, {}, "01", "1e0"]) {
    for (const [field, check] of [["RefundAmt", "zeroReportedRefund"], ["RemainAmt", "fullOriginalBalance"]]) {
      const input = fixture(); input.paid[field] = value;
      assert.equal(originalPaidQueryChecks(input.paid, input.target)[check], false);
      assert.throws(() => createOriginalRefundHandoff(input));
    }
  }
});

test("query shape distinguishes absence from a value without disclosing an amount", () => {
  for (const [value, category] of [[undefined, "ABSENT"], [null, "NULL"], ["", "EMPTY"],
    [false, "INVALID"], ["opaque-provider-value", "INVALID"], [0, "VALID_INTEGER"], [1, "VALID_INTEGER"], [29, "VALID_INTEGER"]]) {
    const shape = originalPaidQueryShape({ RemainAmt: value, RefundAmt: value });
    assert.deepEqual(shape, { remainingAmount: category, lastRefundAmount: category });
    assert.ok(Object.isFrozen(shape));
  }
});
for (const [key, value] of Object.entries({ origin: "https://foreign.invalid", exactRefundFormCount: 2,
  exactTransactionRef: reference("other"), formTransactionRef: reference("other"), csrfPresent: false, financeAuthenticated: false })) {
  test(`rejects finance browser observation ${key}`, () => { const input = fixture(); input.browser[key] = value; assert.throws(() => createOriginalRefundHandoff(input)); });
}
test("rejects stale/future/invalid observation and swapped original on later polls", () => {
  for (const timestamp of ["2026-10-10T00:00:00Z", "2026-10-12T00:00:00Z", "invalid"]) {
    const input = fixture(); input.startedAt = timestamp; input.completedAt = timestamp; assert.throws(() => createOriginalRefundHandoff(input));
  }
  const input = fixture(), receipt = createOriginalRefundHandoff(input);
  assert.throws(() => assertOriginalProofMatchesHandoff(receipt, input.proof, "other", source, now));
  assert.throws(() => assertOriginalProofMatchesHandoff(receipt, input.proof, input.target.transactionId, source, new Date(now.getTime() + 300001)));
});
test("later processed refund projection remains original-bound without authorizing another submission", () => {
  const input = fixture(), receipt = createOriginalRefundHandoff(input);
  input.proof.status = "refunded"; input.proof.refundedAmountCents = 100; input.proof.refundRecordCount = 1;
  assertOriginalProofMatchesHandoff(receipt, input.proof, input.target.transactionId, source, now);
  assert.throws(() => createOriginalRefundHandoff(input));
});
test("empty/null/boolean provider balances never imply an unrefunded original", () => {
  for (const value of ["", null, false, "00", "0.5"]) {
    const input = fixture(); input.paid.RefundAmt = value; assert.throws(() => createOriginalRefundHandoff(input));
  }
});
