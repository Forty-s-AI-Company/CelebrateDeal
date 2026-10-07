import { describe, expect, it, vi } from "vitest";
import { readWp4SubscriptionState } from "./wp4-subscription-state";
import { WP4_SANDBOX_FIXTURE } from "./wp4-sandbox-fixture";
const source = "a".repeat(40);
function database(refunded = false) {
 const tx = {
  paymentTransaction: { findMany: vi.fn().mockResolvedValue([{ id: "payment-A", status: refunded ? "refunded" : "paid", refundedAmountCents: refunded ? 100 : 0,
   metadata: { platformSubscriptionId: "subscription-A" } }]) },
  vendorSubscription: { findFirst: vi.fn().mockResolvedValue({ status: refunded ? "payment_refunded" : "active", endedAt: refunded ? new Date() : null }), count: vi.fn().mockResolvedValue(refunded ? 0 : 1) },
  vendorUsageLimit: { findUnique: vi.fn().mockResolvedValue({ billingPlanId: WP4_SANDBOX_FIXTURE.planId, entitlementStatus: refunded ? "revoked" : "active", streamMinutesLimit: 10 }) },
  refundRecord: { aggregate: vi.fn().mockResolvedValue({ _count: refunded ? 1 : 0, _sum: { refundAmountCents: refunded ? 100 : null } }) },
 };
 const $transaction = vi.fn(async (callback, options) => { expect(options).toEqual({ isolationLevel: "RepeatableRead" }); return callback(tx); });
 return { tx, db: { $transaction } };
}
describe("WP4 exact subscription persisted proof", () => {
 it("verifies active native payment and tenant-scoped subscription/usage", async () => {
  const { db, tx } = database(); await expect(readWp4SubscriptionState(db as never, source)).resolves.toEqual({ status: "ACTIVE_VERIFIED" });
  expect(tx.paymentTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: WP4_SANDBOX_FIXTURE.vendorId, paymentMode: "platform", grossAmountCents: 100, currency: "TWD" }), take: 2 }));
  expect(tx.vendorSubscription.findFirst).toHaveBeenCalledWith({ where: { id: "subscription-A", vendorId: WP4_SANDBOX_FIXTURE.vendorId, planId: WP4_SANDBOX_FIXTURE.planId } });
 });
 it("requires one processed exact refund and explicit revocation", async () => {
  const { db, tx } = database(true); await expect(readWp4SubscriptionState(db as never, source)).resolves.toEqual({ status: "REFUNDED_VERIFIED" });
  tx.vendorUsageLimit.findUnique.mockResolvedValue({ billingPlanId: WP4_SANDBOX_FIXTURE.planId, entitlementStatus: "active", streamMinutesLimit: 0 });
  await expect(readWp4SubscriptionState(db as never, source)).resolves.toEqual({ status: "STATE_MISMATCH" });
 });
 it("cannot declare refund verified while another active subscription exists", async () => {
  const { db, tx } = database(true); tx.vendorSubscription.count.mockResolvedValue(1);
  await expect(readWp4SubscriptionState(db as never, source)).resolves.toEqual({ status: "STATE_MISMATCH" });
 });
 it("rejects duplicate payments before reading entitlement", async () => {
  const { db, tx } = database(); tx.paymentTransaction.findMany.mockResolvedValue([{ id: "A" }, { id: "B" }] as never);
  await expect(readWp4SubscriptionState(db as never, source)).resolves.toEqual({ status: "CANDIDATE_AMBIGUOUS" });
  expect(tx.vendorSubscription.findFirst).not.toHaveBeenCalled();
 });
});
