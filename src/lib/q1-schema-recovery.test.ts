import { beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { retryQ1OriginalAfterSchemaRepair, retryQ1OriginalBuyerCallback } from "./wp4-buyer-callback-retry";
import { retryWebhookEvent } from "./webhook-retry";
import { Q1_DOWNSTREAM_MODELS, readQ1Downstream } from "./q1-downstream-readonly";
import { WP4_SANDBOX_FIXTURE } from "./wp4-sandbox-fixture";

vi.mock("./webhook-retry", () => ({ retryWebhookEvent: vi.fn() }));
vi.mock("./q1-downstream-readonly", async importOriginal => {
  const actual = await importOriginal<typeof import("./q1-downstream-readonly")>();
  return { ...actual, readQ1Downstream: vi.fn() };
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readQ1Downstream).mockResolvedValue(successfulProbe());
  vi.mocked(retryWebhookEvent).mockResolvedValue({ status: "processed" } as Awaited<ReturnType<typeof retryWebhookEvent>>);
});
function successfulProbe(): Awaited<ReturnType<typeof readQ1Downstream>> {
  return { classification: "DOWNSTREAM_OBSERVED", decrypt: "OK", protect: "OK",
    billingPurposeClass: "buyer_order", coursePolicySnapshotClass: "ABSENT",
    schema: Q1_DOWNSTREAM_MODELS.map(model => ({ model, compatible: true, missingColumns: [] })),
    enums: [{ name: "synthetic", compatible: true, missingLabels: [] }],
    readStage: "CRYPTO", readClass: "NONE", merchantSnapshotExists: false, emailDeliveryExists: false, paidOrderEventExists: false,
    databaseWrites: false, callbackPosts: 0, callbackReplayAuthorized: false };
}
function fixture() {
  const payment = { id: "q1-original", vendorId: WP4_SANDBOX_FIXTURE.vendorId, status: "pending", refundedAmountCents: 0,
    providerName: "payuni", providerTradeNo: null, grossAmountCents: 100, currency: "TWD", orderNumber: "synthetic-original",
    metadata: { wp4PaymentSubmissionReserved: true, wp4CallbackRetryReserved: true } as Record<string, unknown> };
  const event = { id: "q1-original-event", eventId: "original-paid", vendorId: null, status: "failed", retryCount: 3, maxRetries: 5,
    updatedAt: new Date("2026-10-10T07:00:00Z"), payload: { normalized: { provider: "payuni", eventId: "original-paid", eventType: "paid",
      orderNumber: payment.orderNumber, providerTradeNo: "original-trade", grossAmountCents: 100, currency: "TWD" } } };
  const reserve = vi.fn().mockResolvedValue(payment), fence = vi.fn().mockResolvedValue({ count: 1 });
  const raw = vi.fn().mockResolvedValueOnce([{ checksum: "1dc83cfe4e3db8d6116c116e6e918625f125ccc802bed306d3f85a076132c3dd" }])
    .mockResolvedValueOnce([{ total: 1, fixed: 1 }]);
  const refunds = vi.fn().mockResolvedValue(0);
  const tx = { paymentTransaction: { findMany: vi.fn().mockResolvedValue([payment]), update: reserve },
    webhookEvent: { findMany: vi.fn().mockResolvedValue([event]), updateMany: fence }, $queryRaw: raw, refundRecord: { count: refunds } };
  const db = { $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)) } as unknown as Pick<PrismaClient, "$transaction">;
  return { db, payment, event, reserve, fence, raw, refunds };
}
it("preserves the consumed old marker and reserves one distinct schema recovery with the original event version", async () => {
  const f = fixture();
  await expect(retryQ1OriginalAfterSchemaRepair(f.db)).resolves.toMatchObject({ status: "PROCESSED", retryAttempts: 1 });
  expect(f.reserve).toHaveBeenCalledExactlyOnceWith({ where: { id: f.payment.id, vendorId: f.payment.vendorId },
    data: { metadata: { wp4PaymentSubmissionReserved: true, wp4CallbackRetryReserved: true, q1SchemaRecoveryReserved: true } } });
  expect(retryWebhookEvent).toHaveBeenCalledExactlyOnceWith(f.event.id, "q1_sandbox_schema_recovery",
    expect.objectContaining({ retryCount: 3, paymentScope: expect.objectContaining({ paymentTransactionId: f.payment.id }) }));
  expect(f.fence.mock.calls[0]![0].data).not.toHaveProperty("retryCount");
});
it("keeps the old endpoint closed after its reservation was consumed", async () => {
  const f = fixture();
  await expect(retryQ1OriginalBuyerCallback(f.db)).resolves.toMatchObject({ status: "RETRY_REJECTED", retryAttempts: 0 });
  expect(f.raw).not.toHaveBeenCalled(); expect(f.reserve).not.toHaveBeenCalled(); expect(retryWebhookEvent).not.toHaveBeenCalled();
});
it.each(["READ_FAILED", "SCHEMA_INCOMPATIBLE"] as const)("rejects %s before the reservation transaction", async classification => {
  const f = fixture();
  vi.mocked(readQ1Downstream).mockResolvedValue({ ...successfulProbe(), classification, schema: [], enums: [] });
  await expect(retryQ1OriginalAfterSchemaRepair(f.db)).resolves.toMatchObject({ status: "RETRY_REJECTED" });
  expect(f.db.$transaction).not.toHaveBeenCalled(); expect(retryWebhookEvent).not.toHaveBeenCalled();
});
it.each(["marker", "budget", "state", "refund", "ledger", "audit", "cas"])("rejects changed %s without dispatch", async drift => {
  const f = fixture();
  if (drift === "marker") f.payment.metadata.q1SchemaRecoveryReserved = true;
  if (drift === "budget") f.event.retryCount = 4;
  if (drift === "state") f.payment.status = "paid";
  if (drift === "refund") f.refunds.mockResolvedValue(1);
  if (drift === "ledger") f.raw.mockReset().mockResolvedValue([{ checksum: "wrong" }]);
  if (drift === "audit") f.raw.mockReset().mockResolvedValueOnce([{ checksum: "1dc83cfe4e3db8d6116c116e6e918625f125ccc802bed306d3f85a076132c3dd" }]).mockResolvedValueOnce([{ total: 2, fixed: 1 }]);
  if (drift === "cas") f.fence.mockResolvedValue({ count: 0 });
  await expect(retryQ1OriginalAfterSchemaRepair(f.db)).resolves.toMatchObject({ status: "RETRY_REJECTED", retryAttempts: 0 });
  expect(f.reserve).not.toHaveBeenCalled(); expect(retryWebhookEvent).not.toHaveBeenCalled();
});
it("retains durable reservation when dispatch fails", async () => {
  const f = fixture(); vi.mocked(retryWebhookEvent).mockRejectedValueOnce(new Error("synthetic lost response"));
  await expect(retryQ1OriginalAfterSchemaRepair(f.db)).resolves.toMatchObject({ status: "RETRY_FAILED", retryAttempts: 1 });
  expect(f.reserve).toHaveBeenCalledTimes(1); expect(f.fence).toHaveBeenCalledTimes(1);
});
