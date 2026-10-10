import test from "node:test";
import assert from "node:assert/strict";
import { reference } from "./payuni-sandbox-payment-handoff.mjs";
import { ORIGINAL_TRANSACTION_SOURCE } from "./q1-original-refund-handoff.mjs";
import { verifyReservedOriginalRefund } from "./q1-original-refund-verify.mjs";
const source = "a".repeat(40);
function fixture() {
  const target = { transactionId: "synthetic-original", orderNumber: "synthetic-order", providerTradeNo: "synthetic-trade", reservationVerified: true };
  const proof = { schemaVersion: "celebratedeal-payuni-pending-refund-proof/v1", sourceCommit: source,
    transactionSourceCommit: ORIGINAL_TRANSACTION_SOURCE, historicalOriginalBound: true, vendorId: "wp4_synthetic_vendor_v1",
    environment: "preview", payuniEnvironment: "sandbox", appHost: "celebrate-deal-staging.carry-digital-nomad.in.net",
    providerHost: "sandbox-api.payuni.com.tw", databaseBound: true, nonProductionScope: "fixed-staging-project",
    paymentCallbackMatched: true, grossAmountCents: 100, status: "refunded", refundedAmountCents: 100, refundRecordCount: 1,
    singleProcessedRefund: true, refundPersistencePassed: true, transactionRef: reference(target.transactionId),
    orderRef: reference(target.orderNumber), tradeRef: reference(target.providerTradeNo) };
  const paid = { MerTradeNo: target.orderNumber, TradeNo: target.providerTradeNo, TradeStatus: "1", TradeAmt: 1,
    PaymentType: "1", DataSource: "A", RefundStatus: "2", RemainAmt: 0, RefundAmt: 1 };
  return { target, executionSource: source, proof, paid, loadProof: async () => proof, queryProvider: async () => paid, sleep: async () => {},
    now: () => new Date("2026-10-12T00:00:00Z") };
}
test("fresh readonly verification works after old handoff expiry without claiming duplicate UI", async () => {
  const input = fixture(); const receipt = await verifyReservedOriginalRefund(input);
  assert.equal(receipt.status, "ORIGINAL_REFUND_TERMINAL_VERIFIED"); assert.equal(receipt.refundSubmitted, false);
  assert.equal(receipt.checks.refundIdempotency, "not-observed-by-readonly-resume");
  assert.ok(!JSON.stringify(receipt).includes(input.target.transactionId));
});
test("absent durable reservation cannot authorize verification", async () => {
  const input = fixture(); input.target.reservationVerified = false; let observations = 0;
  input.loadProof = async () => { observations++; return input.proof; };
  await assert.rejects(verifyReservedOriginalRefund(input)); assert.equal(observations, 0);
});
test("pending CREDIT1/8 only polls the same original until terminal", async () => {
  const input = fixture(); let count = 0, sleeps = 0;
  input.queryProvider = async order => { assert.equal(order, input.target.orderNumber); count++;
    return count < 3 ? { ...input.paid, RefundStatus: count === 1 ? "1" : "8", RemainAmt: 1 } : input.paid; };
  input.sleep = async () => { sleeps++; };
  const receipt = await verifyReservedOriginalRefund(input); assert.equal(receipt.refundSubmitted, false);
  assert.equal(count, 3); assert.equal(sleeps, 2);
});
for (const [key, value] of Object.entries({ sourceCommit: "b".repeat(40), transactionSourceCommit: source,
  transactionRef: reference("foreign"), status: "paid", refundRecordCount: 2, refundPersistencePassed: false })) {
  test(`readonly verification rejects ${key} drift`, async () => { const input = fixture(); input.proof[key] = value; await assert.rejects(verifyReservedOriginalRefund(input)); });
}
test("foreign provider trade cannot satisfy terminal proof or trigger submission", async () => {
  const input = fixture(); input.paid.TradeNo = "foreign"; await assert.rejects(verifyReservedOriginalRefund(input));
});
test("only durable original browser duplicate evidence can supply idempotency pass", async () => {
  const input = fixture(); input.target.duplicateUIVerified = true;
  const receipt = await verifyReservedOriginalRefund(input); assert.equal(receipt.checks.refundIdempotency, "passed");
  assert.equal(receipt.refundSubmitted, false);
});