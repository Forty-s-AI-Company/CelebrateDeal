import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "./db";
import { applyPlatformSubscriptionRefundProjection } from "./platform-subscription-refund";
import { reconcilePayUniRefund } from "./payuni-refund-reconciliation";
const db = getDb(), vendors: string[] = [], plans: string[] = [];
async function fixture() {
 const suffix = randomUUID();
 const vendor = await db.vendor.create({ data: { name: "Synthetic subscription", slug: suffix, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } }); vendors.push(vendor.id);
 const plan = await db.billingPlan.create({ data: { code: suffix, name: "Synthetic plan", monthlyPriceCents: 100, includedStreamMinutes: 10 } }); plans.push(plan.id);
 const subscription = await db.vendorSubscription.create({ data: { vendorId: vendor.id, planId: plan.id, status: "active", paymentMode: "platform" } });
 await db.vendorUsageLimit.create({ data: { vendorId: vendor.id, billingPlanId: plan.id, streamMinutesLimit: 10, streamMinutesUsed: 4, creditsLimit: 50, creditsUsed: 3, resetAt: new Date("2026-11-01Z") } });
 const payment = await db.paymentTransaction.create({ data: { vendorId: vendor.id, providerName: "demo", paymentMode: "platform", grossAmountCents: 100, status: "refunded", refundedAmountCents: 100,
  metadata: { billingPurpose: "platform_subscription_checkout", billingPlanId: plan.id, platformSubscriptionId: subscription.id } } });
 await db.refundRecord.create({ data: { vendorId: vendor.id, paymentTransactionId: payment.id, monthKey: "2026-10", refundAmountCents: 100, status: "processed" } });
 return { vendor, plan, subscription, payment };
}
afterEach(async () => {
 await db.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
 await db.billingPlan.deleteMany({ where: { id: { in: plans.splice(0) } } });
});
describe("subscription PostgreSQL refund permission boundaries", () => {
 it.each([false, true])("forward migration repairs legacy full refund and preserves independent B=%s", async (hasB) => {
  const f = await fixture();
  let b: { id: string } | undefined;
  if (hasB) b = await db.vendorSubscription.create({ data: { vendorId: f.vendor.id, planId: f.plan.id, status: "active" } });
  const sql = readFileSync("prisma/migrations/20261007002000_reconcile_legacy_subscription_refund_state/migration.sql", "utf8");
  // Execute the exact forward migration against rows representing pre-upgrade state.
  for (let replay = 0; replay < 2; replay++) await db.$transaction(async tx => {
   for (const statement of sql.split(";").filter(value => value.trim())) await tx.$executeRawUnsafe(statement);
  });
  expect(await db.vendorSubscription.findUniqueOrThrow({ where: { id: f.subscription.id } })).toMatchObject({ status: "payment_refunded", endedAt: expect.any(Date) });
  expect(await db.vendorUsageLimit.findUniqueOrThrow({ where: { vendorId: f.vendor.id } })).toMatchObject({ entitlementStatus: hasB ? "active" : "revoked", streamMinutesUsed: 4, creditsUsed: 3, streamMinutesLimit: 10, creditsLimit: 50 });
  if (b) expect((await db.vendorSubscription.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("active");
  expect(await db.refundRecord.count({ where: { paymentTransactionId: f.payment.id } })).toBe(1);
 });
 it("already reconciled provider ledger repairs historical active subscription on replay", async () => {
  const f = await fixture();
  const payment = await db.paymentTransaction.update({ where: { id: f.payment.id }, data: { providerName: "payuni", providerTradeNo: `synthetic-${f.payment.id}`, orderNumber: `synthetic-${f.payment.id}` } });
  for (let replay = 0; replay < 2; replay++) {
   const outcome = await reconcilePayUniRefund({ db, transactionId: payment.id, actor: { id: "synthetic-ops", label: "synthetic-recovery" },
    providerSnapshot: { status: "refunded", providerTradeNo: payment.providerTradeNo!, orderNumber: payment.orderNumber!, grossAmountCents: 100, refundedAmountCents: 100, remainingRefundableAmountCents: 0 } });
   expect(outcome).toMatchObject({ disposition: "already_reconciled", processedRefundRecordCount: 0 });
  }
  expect((await db.vendorSubscription.findUniqueOrThrow({ where: { id: f.subscription.id } })).status).toBe("payment_refunded");
  expect(await db.vendorUsageLimit.findUniqueOrThrow({ where: { vendorId: f.vendor.id } })).toMatchObject({ entitlementStatus: "revoked", streamMinutesUsed: 4, creditsUsed: 3 });
  expect(await db.refundRecord.count({ where: { paymentTransactionId: payment.id } })).toBe(1);
 });
 it("revokes exactly once without resetting counters or inventing unlimited access", async () => {
  const f = await fixture();
  for (let retry = 0; retry < 2; retry++) await db.$transaction(tx => applyPlatformSubscriptionRefundProjection(tx, f.payment, new Date()), { isolationLevel: "Serializable" });
  expect(await db.vendorSubscription.findUniqueOrThrow({ where: { id: f.subscription.id } })).toMatchObject({ status: "payment_refunded", endedAt: expect.any(Date) });
  expect(await db.vendorUsageLimit.findUniqueOrThrow({ where: { vendorId: f.vendor.id } })).toMatchObject({ entitlementStatus: "revoked", streamMinutesLimit: 10, streamMinutesUsed: 4, creditsLimit: 50, creditsUsed: 3 });
  expect(await db.refundRecord.count({ where: { paymentTransactionId: f.payment.id, status: "processed" } })).toBe(1);
 });
 it("preserves the independently active B entitlement when A refunds", async () => {
  const f = await fixture();
  const next = await db.billingPlan.create({ data: { code: randomUUID(), name: "Synthetic B", monthlyPriceCents: 200, includedStreamMinutes: 20 } }); plans.push(next.id);
  const b = await db.vendorSubscription.create({ data: { vendorId: f.vendor.id, planId: next.id, status: "active" } });
  await db.vendorUsageLimit.update({ where: { vendorId: f.vendor.id }, data: { billingPlanId: next.id, streamMinutesLimit: 20 } });
  await db.$transaction(tx => applyPlatformSubscriptionRefundProjection(tx, f.payment, new Date()), { isolationLevel: "Serializable" });
  expect(await db.vendorUsageLimit.findUniqueOrThrow({ where: { vendorId: f.vendor.id } })).toMatchObject({ billingPlanId: next.id, entitlementStatus: "active", streamMinutesLimit: 20, streamMinutesUsed: 4 });
  expect((await db.vendorSubscription.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("active");
 });
 it("rejects a foreign subscription metadata reference atomically", async () => {
  const f = await fixture(), other = await fixture();
  const forged = { ...f.payment, metadata: { billingPurpose: "platform_subscription_checkout", billingPlanId: other.plan.id, platformSubscriptionId: other.subscription.id } };
  await expect(db.$transaction(tx => applyPlatformSubscriptionRefundProjection(tx, forged, new Date()), { isolationLevel: "Serializable" })).rejects.toThrow("可信付款");
  expect((await db.vendorSubscription.findUniqueOrThrow({ where: { id: other.subscription.id } })).status).toBe("active");
  expect((await db.vendorUsageLimit.findUniqueOrThrow({ where: { vendorId: f.vendor.id } })).entitlementStatus).toBe("active");
 });
});
