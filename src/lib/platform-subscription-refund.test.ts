import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { applyPlatformSubscriptionRefundProjection } from "./platform-subscription-refund";
const payment = { id: "synthetic-payment", vendorId: "synthetic-vendor", paymentMode: "platform", status: "refunded", grossAmountCents: 100, refundedAmountCents: 100,
 metadata: { billingPurpose: "platform_subscription_checkout", platformSubscriptionId: "subscription-A", billingPlanId: "plan-A" } };
function db(otherActive = false) {
 const subscription = { id: "subscription-A", vendorId: payment.vendorId, planId: "plan-A", status: "active" };
 const mocks = { vendorSubscription: { findFirst: vi.fn().mockResolvedValueOnce(subscription).mockResolvedValueOnce(otherActive ? { id: "subscription-B" } : null), update: vi.fn().mockResolvedValue({ ...subscription, status: "payment_refunded" }) },
 refundRecord: { aggregate: vi.fn().mockResolvedValue({ _sum: { refundAmountCents: 100 } }) }, vendorUsageLimit: { upsert: vi.fn() } };
 return { mocks, client: mocks as unknown as Prisma.TransactionClient };
}
describe("native subscription full refund projection", () => {
 it("revokes permission explicitly while preserving existing counters and limits", async () => {
  const { mocks, client } = db(); await applyPlatformSubscriptionRefundProjection(client, payment, new Date("2026-10-06Z"));
  expect(mocks.vendorUsageLimit.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: payment.vendorId }, update: { entitlementStatus: "revoked" } }));
  expect(mocks.vendorSubscription.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "subscription-A", vendorId: payment.vendorId, status: "active" } }));
 });
 it("cannot overwrite independently active subscription B", async () => {
  const { mocks, client } = db(true); await applyPlatformSubscriptionRefundProjection(client, payment, new Date());
  expect(mocks.vendorUsageLimit.upsert).not.toHaveBeenCalled();
 });
 it("rejects an unmatched processed refund before changing either projection", async () => {
  const { mocks, client } = db(); mocks.refundRecord.aggregate.mockResolvedValue({ _sum: { refundAmountCents: 99 } });
  await expect(applyPlatformSubscriptionRefundProjection(client, payment, new Date())).rejects.toThrow("可信付款");
  expect(mocks.vendorSubscription.update).not.toHaveBeenCalled(); expect(mocks.vendorUsageLimit.upsert).not.toHaveBeenCalled();
 });
 it("partial refund cannot revoke subscription", async () => {
  const { mocks, client } = db(); expect(await applyPlatformSubscriptionRefundProjection(client, { ...payment, status: "partially_refunded", refundedAmountCents: 50 }, new Date())).toBeNull();
  expect(mocks.vendorSubscription.findFirst).not.toHaveBeenCalled();
 });
});
