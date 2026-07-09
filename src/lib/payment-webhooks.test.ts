import { afterEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { PaymentWebhookPayload, processPaymentWebhook } from "@/lib/payment-webhooks";
import { reconcileWebhookEvent } from "@/lib/reconciliation";
import { processDueWebhookRetries } from "@/lib/webhook-retry";

const createdVendorIds: string[] = [];
const createdWebhookEventIds: string[] = [];

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

afterEach(async () => {
  const db = getDb();
  await db.webhookEvent.deleteMany({ where: { id: { in: createdWebhookEventIds.splice(0) } } });
  await db.vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
  await db.billingPlan.deleteMany({ where: { code: { startsWith: "test-plan-" } } });
});

describe("payment webhook processing", () => {
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
