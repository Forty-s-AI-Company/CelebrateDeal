import { expect, it, vi } from "vitest";
import { createPendingRefundHandoff, reference } from "./payuni-sandbox-payment-handoff.mjs";
import { assertProofMatchesHandoff, consumePendingRefund } from "./payuni-sandbox-pending-refund-consumer.mjs";

const source = "a".repeat(40);
const transactionId = "synthetic-transaction";
const order = "synthetic-order";
const trade = "synthetic-trade";
const now = new Date("2026-10-06T00:00:01Z");
function fixture() {
  const receipt = createPendingRefundHandoff({ startedAt: "2026-10-06T00:00:00Z", completedAt: now.toISOString(),
    appUrl: "https://celebrate-deal-staging.carry-digital-nomad.in.net",
    checkout: { transactionId, orderNumber: order, amount: 1 }, paid: { TradeStatus: "1", TradeNo: trade, TradeAmt: 1 } });
  const proof = { schemaVersion: "celebratedeal-payuni-pending-refund-proof/v1", environment: "preview",
    payuniEnvironment: "sandbox", providerHost: receipt.providerHost, appHost: receipt.appHost,
    sourceCommit: source, databaseBound: true, nonProductionScope: "fixed-staging-project",
    transactionRef: reference(transactionId), orderRef: reference(order), tradeRef: reference(trade),
    paymentCallbackMatched: true, grossAmountCents: 100, refundedAmountCents: 0, refundRecordCount: 0, status: "paid" };
  return { receipt, proof };
}
it.each([{ sourceCommit: "b".repeat(40) }, { orderRef: "b".repeat(12) }, { tradeRef: "b".repeat(12) },
  { transactionRef: "b".repeat(12) }, { paymentCallbackMatched: false }, { environment: "production" },
  { grossAmountCents: 200 }, { payuniEnvironment: "live" }, { databaseBound: false }, { nonProductionScope: "unverified" }])("rejects unsafe authenticated evidence before UI writes: %j", (mismatch) => {
  const { receipt, proof } = fixture();
  expect(() => assertProofMatchesHandoff(receipt, { ...proof, ...mismatch }, transactionId, source, now)).toThrow();
});

function pageFixture() {
  const click = vi.fn();
  const form = { count: vi.fn(async () => 1), locator: vi.fn((selector) => ({
    inputValue: vi.fn(async () => selector.includes('name="id"') ? transactionId : "synthetic-csrf"), fill: vi.fn(),
  })), getByRole: vi.fn(() => ({ click })) };
  const page = { goto: vi.fn(), getByTestId: vi.fn(() => form), waitForURL: vi.fn(), close: vi.fn() };
  return { page, form, click };
}
function runnerFixture({ completed = true, refundStatus = "2", finalCount = 1, providerPatch = {} } = {}) {
  const { receipt, proof } = fixture();
  const first = pageFixture(); const duplicate = pageFixture();
  const final = { ...proof, status: "refunded", refundedAmountCents: 100, refundRecordCount: 1,
    singleProcessedRefund: true, refundPersistencePassed: true };
  const loadProof = vi.fn().mockResolvedValue(completed ? final : { ...proof, refundRecordCount: 1 });
  loadProof.mockResolvedValueOnce(proof);
  if (completed) loadProof.mockResolvedValueOnce(final).mockResolvedValueOnce({ ...final, refundRecordCount: finalCount });
  return { first, duplicate, options: { receipt, transactionId, expectedSourceSha: source,
    context: { newPage: vi.fn().mockResolvedValueOnce(first.page).mockResolvedValueOnce(duplicate.page) }, loadProof,
    queryProvider: vi.fn(async () => ({ MerTradeNo: order, TradeNo: trade, TradeAmt: 1, RefundStatus: refundStatus,
      TradeStatus: "1", PaymentType: "1", DataSource: "A", RefundAmt: 1, RemainAmt: 0, ...providerPatch })),
    now: () => now, sleep: vi.fn() } };
}
it("unit orchestration uses the same real form contract twice and returns only safe references", async () => {
  const run = runnerFixture();
  const result = await consumePendingRefund(run.options);
  expect(result.status).toBe("COMPLETED");
  expect(JSON.stringify(result)).not.toContain(transactionId);
  expect(run.first.click).toHaveBeenCalledTimes(1);
  expect(run.duplicate.click).toHaveBeenCalledTimes(1);
  expect(run.duplicate.page.waitForURL).toHaveBeenCalledWith(expect.stringContaining("error=refund_already_processed"));
  expect(run.first.form.locator).toHaveBeenCalledWith('input[name="_csrf"]');
  expect(run.first.page.close).toHaveBeenCalledTimes(1);
});
it("stops on pending persistence without resubmitting the reserved refund", async () => {
  const run = runnerFixture({ completed: false });
  await expect(consumePendingRefund(run.options)).rejects.toThrow();
  expect(run.first.click).toHaveBeenCalledTimes(1);
  expect(run.duplicate.click).not.toHaveBeenCalled();
  expect(run.options.queryProvider).not.toHaveBeenCalled();
  expect(run.duplicate.page.close).toHaveBeenCalledTimes(1);
});
it.each(["0", "1", "3", "8"])("does not accept incomplete/ambiguous provider state %s", async (refundStatus) => {
  const run = runnerFixture({ refundStatus });
  await expect(consumePendingRefund(run.options)).rejects.toThrow();
  expect(run.duplicate.click).not.toHaveBeenCalled();
  expect(run.options.queryProvider).toHaveBeenCalledTimes(20);
});
it("waits for terminal provider success without resubmitting a pending refund", async () => {
  const run = runnerFixture();
  run.options.queryProvider.mockResolvedValueOnce({ MerTradeNo: order, TradeNo: trade, TradeAmt: 1,
    TradeStatus: "1", PaymentType: "1", DataSource: "A", RefundStatus: "1", RefundAmt: 1, RemainAmt: 0 });
  await expect(consumePendingRefund(run.options)).resolves.toMatchObject({ status: "COMPLETED" });
  expect(run.options.queryProvider).toHaveBeenCalledTimes(2);
  expect(run.first.click).toHaveBeenCalledTimes(1);
  expect(run.duplicate.click).toHaveBeenCalledTimes(1);
});
it.each([{ DataSource: "B" }, { PaymentType: "2" }, { TradeStatus: "4" }, { RefundAmt: 0 },
  { RefundAmt: 2 }, { RemainAmt: 1 }, { TradeAmt: "1junk" }, { TradeNo: "other-trade" },
  { MerTradeNo: "other-order" }, { MerTradeNo: undefined }, { TradeNo: undefined },
  { MerTradeNo: ` ${order}` }])("rejects incomplete or mismatched terminal provider evidence %j", async (providerPatch) => {
  const run = runnerFixture({ providerPatch });
  await expect(consumePendingRefund(run.options)).rejects.toThrow();
  expect(run.first.click).toHaveBeenCalledTimes(1);
  expect(run.duplicate.click).not.toHaveBeenCalled();
});
it("rejects an additional refund row after the duplicate action", async () => {
  const run = runnerFixture({ finalCount: 2 });
  await expect(consumePendingRefund(run.options)).rejects.toThrow();
});
it("does not fall back to another dashboard transaction when the exact target is absent", async () => {
  const run = runnerFixture();
  run.first.form.count.mockResolvedValue(0);
  await expect(consumePendingRefund(run.options)).rejects.toThrow();
  expect(run.first.page.getByTestId).toHaveBeenCalledExactlyOnceWith(`billing-refund-${transactionId}`);
  expect(run.first.click).not.toHaveBeenCalled();
});
