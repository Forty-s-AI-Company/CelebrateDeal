import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { PaymentWebhookPayload, processPaymentWebhook } from "@/lib/payment-webhooks";
import { coursePolicySnapshotFromProduct } from "@/lib/course-policy-snapshot";

const createdVendorIds: string[] = [];
const createdPlanIds: string[] = [];
const createdUserIds: string[] = [];

async function createCourseFixture(suffix: string) {
  const db = getDb();
  const plan = await db.billingPlan.create({
    data: { name: `Course Plan ${suffix}`, code: `course-plan-${suffix}`, monthlyPriceCents: 100_000 },
  });
  const vendor = await db.vendor.create({
    data: {
      name: `Course Vendor ${suffix}`,
      slug: `course-vendor-${suffix}`,
      email: `course-vendor-${suffix}@example.test`,
      passwordHash: "test",
      subscriptions: { create: { planId: plan.id, paymentMode: "platform", status: "active" } },
    },
  });
  const [fUser, gUser] = await Promise.all([
    db.user.create({ data: { name: `F ${suffix}`, email: `course-f-${suffix}@example.test`, passwordHash: "test" } }),
    db.user.create({ data: { name: `G ${suffix}`, email: `course-g-${suffix}@example.test`, passwordHash: "test" } }),
  ]);
  const [fVendorMember, gVendorMember] = await Promise.all([
    db.vendorMember.create({ data: { vendorId: vendor.id, userId: fUser.id } }),
    db.vendorMember.create({ data: { vendorId: vendor.id, userId: gUser.id } }),
  ]);
  const team = await db.salesTeam.create({ data: { vendorId: vendor.id, name: `Course Team ${suffix}`, slug: `course-team-${suffix}` } });
  const [fMembership, gMembership] = await Promise.all([
    db.teamMembership.create({ data: { vendorId: vendor.id, teamId: team.id, vendorMemberId: fVendorMember.id } }),
    db.teamMembership.create({ data: { vendorId: vendor.id, teamId: team.id, vendorMemberId: gVendorMember.id } }),
  ]);
  createdVendorIds.push(vendor.id);
  createdPlanIds.push(plan.id);
  createdUserIds.push(fUser.id, gUser.id);
  return { db, vendor, fMembership, gMembership };
}

async function createCourseProduct(fixture: Awaited<ReturnType<typeof createCourseFixture>>, suffix: string) {
  return fixture.db.product.create({
    data: {
      vendorId: fixture.vendor.id,
      name: `Course ${suffix}`,
      slug: `course-${suffix}`,
      priceCents: 100_000,
      inventory: 3,
      commerceDomain: "course",
      courseContentOwnerMembershipId: fixture.fMembership.id,
      coursePromoterShareBps: 2_000,
      coursePolicyVersion: 1,
    },
  });
}

afterEach(async () => {
  const db = getDb();
  const vendorIds = createdVendorIds.splice(0);
  const planIds = createdPlanIds.splice(0);
  const userIds = createdUserIds.splice(0);
  await db.courseCommissionLedgerEntry.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.courseCommissionAllocation.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.teamConversionAttribution.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.paymentTransaction.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.product.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.teamMembership.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.salesTeam.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendorMember.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  await db.billingPlan.deleteMany({ where: { id: { in: planIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("course F/G payment accounting", () => {
  it("snapshots F/G once, survives a policy edit, and refunds by the original split", async () => {
    const suffix = `${Date.now()}-split`;
    const fixture = await createCourseFixture(suffix);
    const product = await createCourseProduct(fixture, suffix);
    const orderNumber = `COURSE-${suffix}`;
    const transaction = await fixture.db.paymentTransaction.create({
      data: {
        vendorId: fixture.vendor.id,
        providerName: "demo",
        orderNumber,
        grossAmountCents: 100_000,
        netAmountCents: 100_000,
        currency: "TWD",
        status: "pending",
        metadata: { productId: product.id, coursePolicySnapshot: coursePolicySnapshotFromProduct(product) },
      },
    });
    await fixture.db.teamConversionAttribution.create({
      data: {
        vendorId: fixture.vendor.id,
        teamId: (await fixture.db.teamMembership.findUniqueOrThrow({ where: { id: fixture.gMembership.id } })).teamId,
        paymentTransactionId: transaction.id,
        leaderMembershipId: fixture.fMembership.id,
        promoterMembershipId: fixture.gMembership.id,
        contentOwnerMembershipId: fixture.fMembership.id,
        source: "REFERRAL",
      },
    });

    const paid = PaymentWebhookPayload.parse({
      provider: "demo",
      eventType: "paid",
      eventId: `paid-${suffix}`,
      vendorId: fixture.vendor.id,
      orderNumber,
      grossAmountCents: 100_000,
    });
    await fixture.db.product.update({ where: { id: product.id }, data: { coursePromoterShareBps: 3_000, coursePolicyVersion: 2 } });
    await processPaymentWebhook(paid);
    await processPaymentWebhook(PaymentWebhookPayload.parse({ ...paid, eventId: `paid-retry-${suffix}` }));

    const allocations = await fixture.db.courseCommissionAllocation.findMany({ where: { paymentTransactionId: transaction.id }, orderBy: { recipientRole: "asc" } });
    expect(allocations).toHaveLength(2);
    expect(allocations).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipientMembershipId: fixture.fMembership.id, recipientRole: "content_owner", shareBps: 8_000, amountCents: 80_000, policyVersion: 1 }),
      expect.objectContaining({ recipientMembershipId: fixture.gMembership.id, recipientRole: "promoter", shareBps: 2_000, amountCents: 20_000, policyVersion: 1 }),
    ]));

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      ...paid,
      eventId: `refund-partial-${suffix}`,
      eventType: "partially_refunded",
      refundAmountCents: 10_000,
    }));
    expect(await fixture.db.courseCommissionLedgerEntry.aggregate({ where: { vendorId: fixture.vendor.id, courseCommissionAllocationId: allocations[0]!.id }, _sum: { amountCents: true } })).toMatchObject({ _sum: { amountCents: 72_000 } });
    expect(await fixture.db.courseCommissionLedgerEntry.aggregate({ where: { vendorId: fixture.vendor.id, courseCommissionAllocationId: allocations[1]!.id }, _sum: { amountCents: true } })).toMatchObject({ _sum: { amountCents: 18_000 } });

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      ...paid,
      eventId: `refund-full-${suffix}`,
      eventType: "refunded",
      refundAmountCents: 90_000,
    }));
    expect(await fixture.db.courseCommissionLedgerEntry.aggregate({ where: { vendorId: fixture.vendor.id, courseCommissionAllocationId: { in: allocations.map((allocation) => allocation.id) } }, _sum: { amountCents: true } })).toMatchObject({ _sum: { amountCents: 0 } });
  });

  it("allocates a direct F purchase to F only", async () => {
    const suffix = `${Date.now()}-direct`;
    const fixture = await createCourseFixture(suffix);
    const product = await createCourseProduct(fixture, suffix);
    const orderNumber = `COURSE-DIRECT-${suffix}`;
    await fixture.db.paymentTransaction.create({
      data: {
        vendorId: fixture.vendor.id,
        providerName: "demo",
        orderNumber,
        grossAmountCents: 100_000,
        netAmountCents: 100_000,
        currency: "TWD",
        status: "pending",
        metadata: { productId: product.id, coursePolicySnapshot: coursePolicySnapshotFromProduct(product) },
      },
    });
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventType: "paid",
      eventId: `paid-direct-${suffix}`,
      vendorId: fixture.vendor.id,
      orderNumber,
      grossAmountCents: 100_000,
    }));
    await expect(fixture.db.courseCommissionAllocation.findMany({ where: { vendorId: fixture.vendor.id, paymentTransaction: { orderNumber } } })).resolves.toEqual([
      expect.objectContaining({ recipientMembershipId: fixture.fMembership.id, recipientRole: "content_owner", shareBps: 10_000, amountCents: 100_000 }),
    ]);
  });
});
