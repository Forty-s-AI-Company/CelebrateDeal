import { afterEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { PaymentWebhookPayload, processPaymentWebhook } from "@/lib/payment-webhooks";
import { reconcileWebhookEvent } from "@/lib/reconciliation";
import { processDueWebhookRetries } from "@/lib/webhook-retry";

const createdVendorIds: string[] = [];
const createdBillingPlanIds: string[] = [];
const createdWebhookEventIds: string[] = [];
const createdUserIds: string[] = [];

function webhookPayloadJson(payload: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify({ normalized: payload })) as Prisma.InputJsonValue;
}

async function createFixture(suffix: string) {
  const db = getDb();
  const plan = await db.billingPlan.create({
    data: {
      name: `Test Plan ${suffix}`,
      code: `test-plan-${suffix}`,
      monthlyPriceCents: 100000,
      transactionFeeRateBps: 100,
    },
  });
  createdBillingPlanIds.push(plan.id);
  const vendor = await db.vendor.create({
    data: {
      name: `Webhook Vendor ${suffix}`,
      slug: `webhook-vendor-${suffix}`,
      email: `webhook-${suffix}@example.com`,
      passwordHash: "test",
      subscriptions: {
        create: {
          planId: plan.id,
          paymentMode: "platform",
          status: "active",
        },
      },
    },
  });
  const affiliate = await db.affiliate.create({
    data: {
      vendorId: vendor.id,
      name: `Partner ${suffix}`,
      code: `REF${suffix}`.toUpperCase(),
      commissionRateBps: 800,
    },
  });
  createdVendorIds.push(vendor.id);
  return { db, vendor, affiliate };
}

async function createTeamLeadAttributionFixture(vendorId: string, suffix: string) {
  const db = getDb();
  const user = await db.user.create({
    data: {
      name: `Webhook Attribution User ${suffix}`,
      email: `webhook-attribution-${suffix}@example.com`,
      passwordHash: "test",
    },
  });
  createdUserIds.push(user.id);

  const [vendorMember, team] = await Promise.all([
    db.vendorMember.create({ data: { vendorId, userId: user.id } }),
    db.salesTeam.create({ data: { vendorId, name: `Webhook Attribution Team ${suffix}`, slug: `webhook-attribution-team-${suffix}` } }),
  ]);
  const membership = await db.teamMembership.create({
    data: { vendorId, teamId: team.id, vendorMemberId: vendorMember.id },
  });
  const template = await db.teamFunnelTemplate.create({
    data: { vendorId, teamId: team.id, name: `Webhook Attribution Template ${suffix}` },
  });
  const templateVersion = await db.teamFunnelTemplateVersion.create({
    data: {
      vendorId,
      teamId: team.id,
      templateId: template.id,
      version: 1,
      contentOwnerMembershipId: membership.id,
      createdByMemberId: vendorMember.id,
      headline: "Headline",
      ctaLabel: "Register",
    },
  });
  const page = await db.partnerFunnelPage.create({
    data: {
      vendorId,
      teamId: team.id,
      templateVersionId: templateVersion.id,
      promoterMembershipId: membership.id,
      contentOwnerMembershipId: membership.id,
      slug: `webhook-attribution-page-${suffix}`,
      headline: "Headline",
      ctaLabel: "Register",
    },
  });
  const form = await db.registrationForm.create({
    data: {
      vendorId,
      name: `Webhook Attribution Form ${suffix}`,
      slug: `webhook-attribution-form-${suffix}`,
      headline: "Register",
      fields: [],
    },
  });
  const formSubmission = await db.formSubmission.create({
    data: {
      formId: form.id,
      name: "Webhook Attribution Lead",
      email: `webhook-attribution-lead-${suffix}@example.com`,
    },
  });
  const leadAttribution = await db.teamLeadAttribution.create({
    data: {
      vendorId,
      teamId: team.id,
      formSubmissionId: formSubmission.id,
      pageId: page.id,
      leaderMembershipId: membership.id,
      promoterMembershipId: membership.id,
      contentOwnerMembershipId: membership.id,
      seminarOwnerMembershipId: membership.id,
      source: "REFERRAL",
      referralCode: `TEAM${suffix}`.toUpperCase(),
    },
  });

  return { formSubmission, leadAttribution };
}

afterEach(async () => {
  const db = getDb();
  const vendorIds = createdVendorIds.splice(0);
  const billingPlanIds = createdBillingPlanIds.splice(0);
  const userIds = createdUserIds.splice(0);
  await db.webhookEvent.deleteMany({ where: { id: { in: createdWebhookEventIds.splice(0) } } });
  await db.teamConversionAttribution.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.teamLeadAttribution.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.partnerFunnelPage.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.teamFunnelTemplateVersion.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.teamFunnelTemplate.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.teamMembership.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.salesTeam.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.registrationForm.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendorMember.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  await db.billingPlan.deleteMany({ where: { id: { in: billingPlanIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("payment webhook processing", () => {
  it("rejects a payload without vendorId or vendorSlug before creating a transaction", async () => {
    const suffix = `${Date.now()}-unscoped`;
    const db = getDb();
    const payload = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-unscoped-${suffix}`,
      eventType: "paid",
      orderNumber: `ORDER-UNSCOPED-${suffix}`,
      grossAmountCents: 100000,
    });

    await expect(processPaymentWebhook(payload)).rejects.toThrow("付款 webhook 缺少商家識別");

    const transactions = await db.paymentTransaction.findMany({ where: { orderNumber: payload.orderNumber } });
    expect(transactions).toHaveLength(0);
  });

  it("does not create duplicate transactions for the same order", async () => {
    const suffix = `${Date.now()}a`;
    const { db, vendor } = await createFixture(suffix);
    const payload = {
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid" as const,
      vendorSlug: vendor.slug,
      orderNumber: `ORDER-${suffix}`,
      grossAmountCents: 100000,
      gatewayFeeCents: 2000,
      platformFeeCents: 1000,
      referralCode: `REF${suffix}`.toUpperCase(),
    };

    await processPaymentWebhook(PaymentWebhookPayload.parse(payload));
    await processPaymentWebhook(PaymentWebhookPayload.parse({ ...payload, eventId: `evt-paid-${suffix}-retry` }));

    const transactions = await db.paymentTransaction.findMany({ where: { vendorId: vendor.id, orderNumber: payload.orderNumber } });
    expect(transactions).toHaveLength(1);
  });

  it("snapshots a same-vendor lead attribution for paid webhooks and deduplicates retries", async () => {
    const suffix = `${Date.now()}-team-conversion`;
    const { db, vendor } = await createFixture(suffix);
    const { formSubmission, leadAttribution } = await createTeamLeadAttributionFixture(vendor.id, suffix);
    const orderNumber = `ORDER-TEAM-CONVERSION-${suffix}`;
    await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "demo",
        orderNumber,
        paymentMode: "platform",
        grossAmountCents: 100000,
        netAmountCents: 100000,
        currency: "TWD",
        status: "pending",
        metadata: { formSubmissionId: formSubmission.id },
      },
    });
    const payload = {
      provider: "demo",
      eventId: `evt-team-conversion-${suffix}`,
      eventType: "paid" as const,
      vendorId: vendor.id,
      orderNumber,
      grossAmountCents: 100000,
    };

    await processPaymentWebhook(PaymentWebhookPayload.parse(payload));
    await processPaymentWebhook(PaymentWebhookPayload.parse({ ...payload, eventId: `evt-team-conversion-retry-${suffix}` }));

    const transaction = await db.paymentTransaction.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber: payload.orderNumber } });
    expect(transaction.metadata).toMatchObject({ formSubmissionId: formSubmission.id });
    const attributions = await db.teamConversionAttribution.findMany({ where: { vendorId: vendor.id, paymentTransactionId: transaction.id } });
    expect(attributions).toHaveLength(1);
    expect(attributions[0]).toMatchObject({
      vendorId: vendor.id,
      paymentTransactionId: transaction.id,
      teamId: leadAttribution.teamId,
      leadAttributionId: leadAttribution.id,
      pageId: leadAttribution.pageId,
      leaderMembershipId: leadAttribution.leaderMembershipId,
      promoterMembershipId: leadAttribution.promoterMembershipId,
      contentOwnerMembershipId: leadAttribution.contentOwnerMembershipId,
      seminarOwnerMembershipId: leadAttribution.seminarOwnerMembershipId,
      source: leadAttribution.source,
      referralCode: leadAttribution.referralCode,
    });
  });

  it("does not attribute cross-vendor or non-payment webhooks", async () => {
    const suffix = `${Date.now()}-team-rejected`;
    const { db, vendor: leadVendor } = await createFixture(`${suffix}-lead`);
    const { vendor: paymentVendor } = await createFixture(`${suffix}-payment`);
    const { formSubmission } = await createTeamLeadAttributionFixture(leadVendor.id, suffix);

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-cross-vendor-${suffix}`,
      eventType: "paid",
      vendorId: paymentVendor.id,
      orderNumber: `ORDER-CROSS-VENDOR-${suffix}`,
      grossAmountCents: 100000,
      metadata: { formSubmissionId: formSubmission.id },
    }));
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-refund-no-attribution-${suffix}`,
      eventType: "refunded",
      vendorId: leadVendor.id,
      orderNumber: `ORDER-REFUND-NO-ATTRIBUTION-${suffix}`,
      metadata: { formSubmissionId: formSubmission.id },
    }));

    expect(await db.teamConversionAttribution.count({ where: { vendorId: { in: [leadVendor.id, paymentVendor.id] } } })).toBe(0);
  });

  it("processes a webhook identified by vendorId", async () => {
    const suffix = `${Date.now()}-vendor-id`;
    const { db, vendor } = await createFixture(suffix);
    const payload = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-vendor-id-${suffix}`,
      eventType: "paid",
      vendorId: vendor.id,
      orderNumber: `ORDER-VENDOR-ID-${suffix}`,
      grossAmountCents: 100000,
    });

    await processPaymentWebhook(payload);

    const transaction = await db.paymentTransaction.findFirst({ where: { vendorId: vendor.id, orderNumber: payload.orderNumber } });
    expect(transaction).not.toBeNull();
  });

  it("rejects inconsistent vendor identifiers before updating a transaction", async () => {
    const suffix = `${Date.now()}-vendor-mismatch`;
    const { db, vendor: vendorById } = await createFixture(`${suffix}-id`);
    const { vendor: vendorBySlug } = await createFixture(`${suffix}-slug`);
    const orderNumber = `ORDER-VENDOR-MISMATCH-${suffix}`;
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-vendor-mismatch-initial-${suffix}`,
      eventType: "paid",
      vendorId: vendorById.id,
      orderNumber,
      grossAmountCents: 100000,
    }));
    const payload = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-vendor-mismatch-${suffix}`,
      eventType: "paid",
      vendorId: vendorById.id,
      vendorSlug: vendorBySlug.slug,
      orderNumber,
      grossAmountCents: 200000,
    });

    await expect(processPaymentWebhook(payload)).rejects.toThrow("付款 webhook 商家識別不一致");

    const transactions = await db.paymentTransaction.findMany({ where: { orderNumber: payload.orderNumber } });
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.grossAmountCents).toBe(100000);
  });

  it("rejects dual vendor identifiers when either identifier cannot be resolved", async () => {
    const suffix = `${Date.now()}-vendor-missing`;
    const { db, vendor } = await createFixture(suffix);
    const payload = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-vendor-missing-${suffix}`,
      eventType: "paid",
      vendorId: vendor.id,
      vendorSlug: `missing-vendor-${suffix}`,
      orderNumber: `ORDER-VENDOR-MISSING-${suffix}`,
      grossAmountCents: 100000,
    });

    await expect(processPaymentWebhook(payload)).rejects.toThrow("付款 webhook 商家識別無效");

    const transactions = await db.paymentTransaction.findMany({ where: { orderNumber: payload.orderNumber } });
    expect(transactions).toHaveLength(0);
  });

  it("does not create duplicate refund records for the same refund event", async () => {
    const suffix = `${Date.now()}b`;
    const { db, vendor } = await createFixture(suffix);
    const orderNumber = `ORDER-${suffix}`;

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber,
      grossAmountCents: 100000,
      gatewayFeeCents: 2000,
      platformFeeCents: 1000,
    }));

    const refundPayload = {
      provider: "demo",
      eventId: `evt-refund-${suffix}`,
      eventType: "partially_refunded" as const,
      vendorSlug: vendor.slug,
      orderNumber,
      refundAmountCents: 20000,
      refundReason: "test refund",
    };

    await processPaymentWebhook(PaymentWebhookPayload.parse(refundPayload));
    await processPaymentWebhook(PaymentWebhookPayload.parse(refundPayload));

    const transaction = await db.paymentTransaction.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber } });
    const refunds = await db.refundRecord.findMany({ where: { paymentTransactionId: transaction.id, providerEventId: refundPayload.eventId } });
    expect(refunds).toHaveLength(1);
    expect(transaction.refundedAmountCents).toBe(20000);
  });

  it.each(["refunded", "partially_refunded"] as const)("preserves the payment occurrence date while accumulating cross-month %s events", async (eventType) => {
    const suffix = `${Date.now()}-cross-month-refund`;
    const { db, vendor } = await createFixture(suffix);
    const orderNumber = `ORDER-${suffix}`;
    const paidAt = "2026-01-31T15:30:00.000Z";
    const firstRefundAt = "2026-02-02T08:00:00.000Z";
    const secondRefundAt = "2026-02-15T09:45:00.000Z";

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber,
      grossAmountCents: 100000,
      occurredAt: paidAt,
    }));

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-refund-first-${suffix}`,
      eventType,
      vendorSlug: vendor.slug,
      orderNumber,
      refundAmountCents: 20000,
      occurredAt: firstRefundAt,
    }));
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-refund-second-${suffix}`,
      eventType,
      vendorSlug: vendor.slug,
      orderNumber,
      refundAmountCents: 30000,
      occurredAt: secondRefundAt,
    }));

    const transaction = await db.paymentTransaction.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber } });
    expect(transaction.status).toBe(eventType);
    expect(transaction.occurredAt.toISOString()).toBe(paidAt);
    expect(transaction.refundedAt?.toISOString()).toBe(secondRefundAt);
    expect(transaction.refundedAmountCents).toBe(50000);
  });

  it("creates affiliate commission when referralCode is present", async () => {
    const suffix = `${Date.now()}c`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-${suffix}`;

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber,
      grossAmountCents: 100000,
      gatewayFeeCents: 2000,
      platformFeeCents: 1000,
      referralCode: affiliate.code,
    }));

    const commission = await db.affiliateCommission.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber } });
    expect(commission.affiliateId).toBe(affiliate.id);
    expect(commission.commissionAmountCents).toBe(8000);
  });

  it("retry worker only processes due webhook events", async () => {
    const suffix = `${Date.now()}d`;
    const { db, vendor } = await createFixture(suffix);
    const duePayload = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-due-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber: `ORDER-DUE-${suffix}`,
      grossAmountCents: 100000,
    });
    const futurePayload = PaymentWebhookPayload.parse({
      ...duePayload,
      eventId: `evt-future-${suffix}`,
      orderNumber: `ORDER-FUTURE-${suffix}`,
    });
    const due = await db.webhookEvent.create({
      data: {
        provider: "demo",
        eventId: duePayload.eventId,
        eventType: duePayload.eventType,
        status: "failed",
        nextRetryAt: new Date(Date.now() - 1000),
        payload: webhookPayloadJson(duePayload),
      },
    });
    const future = await db.webhookEvent.create({
      data: {
        provider: "demo",
        eventId: futurePayload.eventId,
        eventType: futurePayload.eventType,
        status: "failed",
        nextRetryAt: new Date(Date.now() + 1000 * 60 * 60),
        payload: webhookPayloadJson(futurePayload),
      },
    });
    createdWebhookEventIds.push(due.id, future.id);

    const results = await processDueWebhookRetries();

    expect(results.some((result) => result.eventId === due.id && result.status === "processed")).toBe(true);
    expect(results.some((result) => result.eventId === future.id)).toBe(false);
  });

  it("marks webhook exhausted after max retries", async () => {
    const suffix = `${Date.now()}e`;
    const { db } = await createFixture(suffix);
    const payload = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-exhaust-${suffix}`,
      eventType: "paid",
      vendorSlug: `missing-${suffix}`,
      orderNumber: `ORDER-EXHAUST-${suffix}`,
      grossAmountCents: 100000,
    });
    const event = await db.webhookEvent.create({
      data: {
        provider: "demo",
        eventId: payload.eventId,
        eventType: payload.eventType,
        status: "failed",
        retryCount: 0,
        maxRetries: 1,
        nextRetryAt: new Date(Date.now() - 1000),
        payload: webhookPayloadJson(payload),
      },
    });
    createdWebhookEventIds.push(event.id);

    await processDueWebhookRetries();

    const updated = await db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(updated.status).toBe("exhausted");
    expect(updated.retryCount).toBe(1);
  });

  it("reconciliation detects refund amount mismatch", async () => {
    const suffix = `${Date.now()}f`;
    const { db, vendor } = await createFixture(suffix);
    const payload = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-reconcile-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber: `ORDER-RECON-${suffix}`,
      grossAmountCents: 100000,
    });
    await processPaymentWebhook(payload);
    const transaction = await db.paymentTransaction.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber: payload.orderNumber } });
    await db.paymentTransaction.update({ where: { id: transaction.id }, data: { refundedAmountCents: 12345 } });
    const event = await db.webhookEvent.create({
      data: {
        vendorId: vendor.id,
        provider: "demo",
        eventId: payload.eventId,
        eventType: payload.eventType,
        status: "processed",
        payload: webhookPayloadJson(payload),
      },
    });
    createdWebhookEventIds.push(event.id);

    const checks = await reconcileWebhookEvent(event);
    expect(checks.find((check) => check.key === "refund_total")?.status).toBe("fail");
  });
});
