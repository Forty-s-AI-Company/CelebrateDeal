import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { PaymentWebhookPayload, processManualRefund, processPaymentWebhook } from "@/lib/payment-webhooks";
import { reconcileWebhookEvent } from "@/lib/reconciliation";
import { processDueWebhookRetries } from "@/lib/webhook-retry";
import { generateSettlementRecord, lockSettlementRecord } from "@/lib/settlement-operations";

const createdVendorIds: string[] = [];
const createdWebhookEventIds: string[] = [];
const createdPlanIds: string[] = [];

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
  createdPlanIds.push(plan.id);
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

async function createPendingOrder(
  vendorId: string,
  orderNumber: string,
  grossAmountCents = 100000,
  attribution?: { affiliateId: string; referralCode: string; commissionRateBps: number; attributionClickId?: string },
) {
  return getDb().paymentTransaction.create({
    data: {
      vendorId,
      providerName: "demo",
      orderNumber,
      paymentMode: "platform",
      grossAmountCents,
      netAmountCents: grossAmountCents,
      currency: "TWD",
      status: "pending",
      metadata: attribution ? {
        ...attribution,
        attributionPolicyVersion: "last-touch-30d-v1",
      } : {},
    },
  });
}

afterEach(async () => {
  vi.unstubAllEnvs();
  const db = getDb();
  const vendorIds = createdVendorIds.splice(0);
  await db.webhookEvent.deleteMany({ where: { id: { in: createdWebhookEventIds.splice(0) } } });
  await db.auditLog.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  await db.billingPlan.deleteMany({ where: { id: { in: createdPlanIds.splice(0) } } });
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

    await createPendingOrder(vendor.id, payload.orderNumber, payload.grossAmountCents);
    await processPaymentWebhook(PaymentWebhookPayload.parse(payload));
    await processPaymentWebhook(PaymentWebhookPayload.parse({ ...payload, eventId: `evt-paid-${suffix}-retry` }));

    const transactions = await db.paymentTransaction.findMany({ where: { vendorId: vendor.id, orderNumber: payload.orderNumber } });
    expect(transactions).toHaveLength(1);
  });

  it("does not create duplicate refund records for the same refund event", async () => {
    const suffix = `${Date.now()}b`;
    const { db, vendor } = await createFixture(suffix);
    const orderNumber = `ORDER-${suffix}`;

    await createPendingOrder(vendor.id, orderNumber);
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

    await createPendingOrder(vendor.id, orderNumber, 100000, {
      affiliateId: affiliate.id,
      referralCode: affiliate.code,
      commissionRateBps: affiliate.commissionRateBps,
    });
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

  it("marks the immutable attribution click as converted only after paid", async () => {
    const suffix = `${Date.now()}paid-click`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const click = await db.affiliateClick.create({
      data: {
        vendorId: vendor.id,
        affiliateId: affiliate.id,
        referralCode: affiliate.code,
        visitorId: `visitor-${suffix}`,
        landingPath: `/live/example?ref=${affiliate.code}`,
        leadAt: new Date(),
      },
    });
    const orderNumber = `ORDER-${suffix}`;
    await createPendingOrder(vendor.id, orderNumber, 100000, {
      affiliateId: affiliate.id,
      referralCode: affiliate.code,
      commissionRateBps: affiliate.commissionRateBps,
      attributionClickId: click.id,
    });
    await expect(db.affiliateClick.findUniqueOrThrow({ where: { id: click.id } })).resolves.toMatchObject({ convertedAt: null });

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid",
      orderNumber,
      grossAmountCents: 100000,
    }));

    const converted = await db.affiliateClick.findUniqueOrThrow({ where: { id: click.id } });
    expect(converted.convertedAt).not.toBeNull();
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
    await createPendingOrder(vendor.id, duePayload.orderNumber, duePayload.grossAmountCents);
    await createPendingOrder(vendor.id, futurePayload.orderNumber, futurePayload.grossAmountCents);
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

  it("allows only one worker to claim a due webhook event", async () => {
    const suffix = `${Date.now()}claim`;
    const { db, vendor } = await createFixture(suffix);
    const orderNumber = `ORDER-CLAIM-${suffix}`;
    await createPendingOrder(vendor.id, orderNumber);
    const payload = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-claim-${suffix}`,
      eventType: "paid",
      orderNumber,
      grossAmountCents: 100000,
    });
    const event = await db.webhookEvent.create({
      data: {
        provider: "demo",
        eventId: payload.eventId,
        eventType: payload.eventType,
        status: "failed",
        nextRetryAt: new Date(Date.now() - 1000),
        payload: webhookPayloadJson(payload),
      },
    });
    createdWebhookEventIds.push(event.id);

    await Promise.all([processDueWebhookRetries(), processDueWebhookRetries()]);

    await expect(db.auditLog.count({ where: { action: "retry_webhook_event", targetId: event.id } })).resolves.toBe(1);
    const transaction = await db.paymentTransaction.findUniqueOrThrow({
      where: { providerName_orderNumber: { providerName: "demo", orderNumber } },
    });
    expect(transaction.status).toBe("paid");
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

  it("exhausts a legacy demo retry in production without processing its order", async () => {
    const suffix = `${Date.now()}legacy`;
    const { db, vendor } = await createFixture(suffix);
    const orderNumber = `ORDER-LEGACY-${suffix}`;
    await createPendingOrder(vendor.id, orderNumber);
    const payload = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-legacy-${suffix}`,
      eventType: "paid",
      orderNumber,
      grossAmountCents: 100000,
    });
    const event = await db.webhookEvent.create({
      data: {
        provider: "demo",
        eventId: payload.eventId,
        eventType: payload.eventType,
        status: "failed",
        nextRetryAt: new Date(Date.now() - 1000),
        payload: webhookPayloadJson(payload),
      },
    });
    createdWebhookEventIds.push(event.id);
    vi.stubEnv("NODE_ENV", "production");

    const results = await processDueWebhookRetries();

    expect(results).toContainEqual({ eventId: event.id, status: "exhausted" });
    const transaction = await db.paymentTransaction.findUniqueOrThrow({
      where: { providerName_orderNumber: { providerName: "demo", orderNumber } },
    });
    expect(transaction.status).toBe("pending");
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
    await createPendingOrder(vendor.id, payload.orderNumber, payload.grossAmountCents);
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

  it("rejects an unknown order without creating a transaction", async () => {
    const suffix = `${Date.now()}g`;
    const { db, vendor } = await createFixture(suffix);
    const payload = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-unknown-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber: `ORDER-UNKNOWN-${suffix}`,
      grossAmountCents: 100000,
    });

    await expect(processPaymentWebhook(payload)).rejects.toThrow("Unknown payment order");
    await expect(db.paymentTransaction.count({ where: { orderNumber: payload.orderNumber } })).resolves.toBe(0);
  });

  it("handles concurrent duplicate refunds exactly once", async () => {
    const suffix = `${Date.now()}h`;
    const { db, vendor } = await createFixture(suffix);
    const orderNumber = `ORDER-CONCURRENT-${suffix}`;
    await createPendingOrder(vendor.id, orderNumber);
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid",
      orderNumber,
      grossAmountCents: 100000,
    }));
    const refund = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-refund-${suffix}`,
      eventType: "partially_refunded",
      orderNumber,
      refundAmountCents: 20000,
    });

    await Promise.all([processPaymentWebhook(refund), processPaymentWebhook(refund)]);

    const transaction = await db.paymentTransaction.findUniqueOrThrow({
      where: { providerName_orderNumber: { providerName: "demo", orderNumber } },
    });
    expect(transaction.refundedAmountCents).toBe(20000);
    await expect(db.refundRecord.count({ where: { paymentTransactionId: transaction.id } })).resolves.toBe(1);
  });

  it("normalizes a partial-amount refunded event to a proportional commission adjustment", async () => {
    const suffix = `${Date.now()}partial-full-label`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-PARTIAL-FULL-LABEL-${suffix}`;
    await createPendingOrder(vendor.id, orderNumber, 100000, {
      affiliateId: affiliate.id,
      referralCode: affiliate.code,
      commissionRateBps: affiliate.commissionRateBps,
    });
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid",
      orderNumber,
      grossAmountCents: 100000,
    }));
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-refund-${suffix}`,
      eventType: "refunded",
      orderNumber,
      refundAmountCents: 10000,
    }));

    const transaction = await db.paymentTransaction.findUniqueOrThrow({
      where: { providerName_orderNumber: { providerName: "demo", orderNumber } },
    });
    const ledger = await db.affiliateCommission.findMany({ where: { vendorId: vendor.id, orderNumber }, orderBy: { createdAt: "asc" } });
    expect(transaction.status).toBe("partially_refunded");
    expect(ledger.find((entry) => entry.sourceType === "payment")?.status).toBe("pending");
    expect(ledger.find((entry) => entry.sourceType === "refund_adjustment")?.commissionAmountCents).toBe(-800);
    expect(ledger.reduce((sum, entry) => sum + entry.commissionAmountCents, 0)).toBe(7200);
  });

  it("serializes a late paid webhook with settlement lock and books commission in an immutable period", async () => {
    const suffix = `${Date.now()}paid-lock-race`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-PAID-LOCK-${suffix}`;
    await createPendingOrder(vendor.id, orderNumber, 100000, {
      affiliateId: affiliate.id,
      referralCode: affiliate.code,
      commissionRateBps: affiliate.commissionRateBps,
    });
    const settlement = await generateSettlementRecord(vendor.id, "2026-07");

    await Promise.allSettled([
      processPaymentWebhook(PaymentWebhookPayload.parse({
        provider: "demo",
        eventId: `evt-paid-${suffix}`,
        eventType: "paid",
        orderNumber,
        grossAmountCents: 100000,
        occurredAt: "2026-07-15T12:00:00.000Z",
      })),
      lockSettlementRecord(settlement.settlement.id, "reviewer-payment-race"),
    ]);

    const finalSettlement = await db.settlement.findUniqueOrThrow({ where: { id: settlement.settlement.id } });
    const transaction = await db.paymentTransaction.findUniqueOrThrow({ where: { providerName_orderNumber: { providerName: "demo", orderNumber } } });
    const commission = await db.affiliateCommission.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber, sourceType: "payment" } });
    expect(finalSettlement.status).toBe("locked");
    expect(transaction.bookingMonthKey).toBe(commission.monthKey);
    await expect(db.affiliateCommission.count({
      where: { vendorId: vendor.id, monthKey: "2026-07", status: { in: ["pending", "approved"] } },
    })).resolves.toBe(0);
    if (commission.monthKey === "2026-07") expect(commission.status).toBe("locked");
    else expect(commission.monthKey).toBe("2026-08");
  });

  it("carries refund records and negative commission adjustments into the next open period", async () => {
    const suffix = `${Date.now()}refund-closed-period`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-REFUND-CLOSED-${suffix}`;
    await createPendingOrder(vendor.id, orderNumber, 100000, {
      affiliateId: affiliate.id,
      referralCode: affiliate.code,
      commissionRateBps: affiliate.commissionRateBps,
    });
    await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "demo", eventId: `evt-paid-${suffix}`, eventType: "paid", orderNumber, grossAmountCents: 100000, gatewayFeeCents: 2000, platformFeeCents: 1000, occurredAt: "2026-07-15T12:00:00.000Z" }));
    const settlement = await generateSettlementRecord(vendor.id, "2026-07");
    await lockSettlementRecord(settlement.settlement.id, "reviewer-refund-carry");
    const refundPayload = PaymentWebhookPayload.parse({ provider: "demo", eventId: `evt-refund-${suffix}`, eventType: "refunded", orderNumber, refundAmountCents: 100000, gatewayFeeRefundCents: 2000, platformFeeRefundCents: 1000, occurredAt: "2026-07-20T12:00:00.000Z" });
    await processPaymentWebhook(refundPayload);
    await processPaymentWebhook(refundPayload);

    await expect(db.refundRecord.findFirstOrThrow({ where: { vendorId: vendor.id, providerEventId: `evt-refund-${suffix}` } })).resolves.toMatchObject({ monthKey: "2026-08" });
    await expect(db.affiliateCommission.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber, sourceType: "refund_adjustment" } })).resolves.toMatchObject({ monthKey: "2026-08", status: "approved", commissionAmountCents: -8000 });
    await expect(db.affiliateCommission.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber, sourceType: "payment" } })).resolves.toMatchObject({ monthKey: "2026-07", status: "locked" });
    await expect(db.refundRecord.count({ where: { vendorId: vendor.id, providerEventId: `evt-refund-${suffix}` } })).resolves.toBe(1);

    const august = await generateSettlementRecord(vendor.id, "2026-08");
    expect(august.settlement).toMatchObject({
      grossRevenueCents: -100000,
      paymentGatewayFeeCents: -2000,
      transactionServiceFeeCents: -1000,
      payoutableAmountCents: -89000,
      carryInAmountCents: 0,
      carryForwardAmountCents: -89000,
      finalPayoutAmountCents: 0,
    });
    const staleSeptember = await generateSettlementRecord(vendor.id, "2026-09");
    expect(staleSeptember.settlement.carryInAmountCents).toBe(0);
    await lockSettlementRecord(august.settlement.id, "reviewer-refund-carry-august");

    const septemberOrder = `ORDER-RECOVERY-${suffix}`;
    await createPendingOrder(vendor.id, septemberOrder, 50000);
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-recovery-${suffix}`,
      eventType: "paid",
      orderNumber: septemberOrder,
      grossAmountCents: 50000,
      occurredAt: "2026-09-10T12:00:00.000Z",
    }));
    await lockSettlementRecord(staleSeptember.settlement.id, "reviewer-refund-carry-september");
    const september = await db.settlement.findUniqueOrThrow({ where: { id: staleSeptember.settlement.id } });
    expect(september).toMatchObject({
      payoutableAmountCents: 49500,
      carryInAmountCents: -89000,
      carryForwardAmountCents: -39500,
      finalPayoutAmountCents: 0,
    });
  });

  it("rejects cumulative fee refunds above the fees collected", async () => {
    const suffix = `${Date.now()}fee-cap`;
    const { db, vendor } = await createFixture(suffix);
    const orderNumber = `ORDER-FEE-CAP-${suffix}`;
    await createPendingOrder(vendor.id, orderNumber, 100000);
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid",
      orderNumber,
      grossAmountCents: 100000,
      gatewayFeeCents: 2000,
      platformFeeCents: 1000,
    }));

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-refund-fee-valid-${suffix}`,
      eventType: "partially_refunded",
      orderNumber,
      refundAmountCents: 1000,
      gatewayFeeRefundCents: 1000,
      platformFeeRefundCents: 500,
    }));

    await expect(processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-refund-fee-${suffix}`,
      eventType: "partially_refunded",
      orderNumber,
      refundAmountCents: 1000,
      gatewayFeeRefundCents: 1001,
    }))).rejects.toThrow("Invalid refund fee amount");
    const transaction = await db.paymentTransaction.findUniqueOrThrow({
      where: { providerName_orderNumber: { providerName: "demo", orderNumber } },
    });
    await expect(processManualRefund({
      transactionId: transaction.id,
      refundAmountCents: 1000,
      gatewayFeeRefundCents: 0,
      platformFeeRefundCents: 501,
      reason: "fee cap",
      monthKey: "2026-07",
    })).rejects.toThrow("Invalid refund fee amount");
    await expect(db.paymentTransaction.update({
      where: { id: transaction.id },
      data: { refundedGatewayFeeCents: 2001 },
    })).rejects.toThrow();
    await expect(db.refundRecord.create({
      data: {
        vendorId: vendor.id,
        paymentTransactionId: transaction.id,
        providerEventId: `direct-over-cap-${suffix}`,
        monthKey: "2026-07",
        refundAmountCents: 1000,
        gatewayFeeRefundCents: 1001,
      },
    })).rejects.toThrow();
    const failedRefund = await db.refundRecord.create({
      data: {
        vendorId: vendor.id,
        paymentTransactionId: transaction.id,
        providerEventId: `direct-failed-${suffix}`,
        monthKey: "2026-07",
        refundAmountCents: 1000,
        gatewayFeeRefundCents: 1001,
        status: "failed",
      },
    });
    await expect(db.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } })).resolves.toMatchObject({
      refundedAmountCents: 1000,
      refundedGatewayFeeCents: 1000,
      refundedPlatformFeeCents: 500,
    });
    await expect(db.refundRecord.update({
      where: { id: failedRefund.id },
      data: { status: "processed" },
    })).rejects.toThrow();
    await db.refundRecord.delete({ where: { id: failedRefund.id } });
    await expect(db.refundRecord.count({ where: { paymentTransactionId: transaction.id } })).resolves.toBe(1);
  });

  it("rejects cross-tenant RefundRecord relations without changing counters", async () => {
    const suffix = `${Date.now()}refund-tenant-fk`;
    const first = await createFixture(`${suffix}-a`);
    const second = await createFixture(`${suffix}-b`);
    const transaction = await createPendingOrder(second.vendor.id, `ORDER-TENANT-FK-${suffix}`, 1000);

    await expect(first.db.refundRecord.create({
      data: {
        vendorId: first.vendor.id,
        paymentTransactionId: transaction.id,
        providerEventId: `cross-tenant-${suffix}`,
        monthKey: "2026-07",
        refundAmountCents: 100,
      },
    })).rejects.toMatchObject({ code: "P2003" });
    await expect(first.db.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } })).resolves.toMatchObject({
      refundedAmountCents: 0,
      refundedGatewayFeeCents: 0,
      refundedPlatformFeeCents: 0,
    });
  });

  it("does not create commission when a full refund arrives before paid", async () => {
    const suffix = `${Date.now()}full-first`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-FULL-FIRST-${suffix}`;
    await createPendingOrder(vendor.id, orderNumber, 100000, {
      affiliateId: affiliate.id,
      referralCode: affiliate.code,
      commissionRateBps: affiliate.commissionRateBps,
    });
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-refund-${suffix}`,
      eventType: "refunded",
      orderNumber,
      grossAmountCents: 100000,
      refundAmountCents: 100000,
    }));
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid",
      orderNumber,
      grossAmountCents: 100000,
    }));

    const transaction = await db.paymentTransaction.findUniqueOrThrow({
      where: { providerName_orderNumber: { providerName: "demo", orderNumber } },
    });
    expect(transaction.status).toBe("refunded");
    await expect(db.affiliateCommission.count({ where: { vendorId: vendor.id, orderNumber } })).resolves.toBe(0);
  });

  it("uses the immutable checkout rate for partial-refund-before-paid", async () => {
    const suffix = `${Date.now()}partial-first`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-PARTIAL-FIRST-${suffix}`;
    await createPendingOrder(vendor.id, orderNumber, 100000, {
      affiliateId: affiliate.id,
      referralCode: affiliate.code,
      commissionRateBps: affiliate.commissionRateBps,
    });
    await db.affiliate.update({ where: { id: affiliate.id }, data: { code: `CHANGED${suffix}`.toUpperCase(), commissionRateBps: 2500, isActive: false } });
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-partial-${suffix}`,
      eventType: "partially_refunded",
      orderNumber,
      refundAmountCents: 20000,
    }));
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid",
      orderNumber,
      grossAmountCents: 100000,
    }));

    const commission = await db.affiliateCommission.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber, sourceType: "payment" } });
    expect(commission.referralCode).toBe(`REF${suffix}`.toUpperCase());
    expect(commission.commissionRateBps).toBe(800);
    expect(commission.commissionAmountCents).toBe(6400);
  });

  it("does not recalculate the positive commission after paid-refund-paid replay", async () => {
    const suffix = `${Date.now()}paid-replay`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-PAID-REPLAY-${suffix}`;
    await createPendingOrder(vendor.id, orderNumber, 100000, {
      affiliateId: affiliate.id,
      referralCode: affiliate.code,
      commissionRateBps: affiliate.commissionRateBps,
    });
    await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "demo", eventId: `evt-failed-${suffix}`, eventType: "failed", orderNumber, grossAmountCents: 100000 }));
    await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "demo", eventId: `evt-paid-a-${suffix}`, eventType: "paid", orderNumber, grossAmountCents: 100000, gatewayFeeCents: 2000, platformFeeCents: 9000 }));
    await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "demo", eventId: `evt-refund-${suffix}`, eventType: "partially_refunded", orderNumber, refundAmountCents: 20000 }));
    await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "demo", eventId: `evt-paid-b-${suffix}`, eventType: "paid", orderNumber, grossAmountCents: 100000, gatewayFeeCents: 5000, platformFeeCents: 5000 }));

    const ledger = await db.affiliateCommission.findMany({
      where: { vendorId: vendor.id, orderNumber, status: { in: ["pending", "approved", "locked", "paid"] } },
    });
    expect(ledger.find((entry) => entry.sourceType === "payment")?.commissionAmountCents).toBe(8000);
    expect(ledger.reduce((sum, entry) => sum + entry.commissionAmountCents, 0)).toBe(6400);
    await expect(db.paymentTransaction.findUniqueOrThrow({
      where: { providerName_orderNumber: { providerName: "demo", orderNumber } },
    })).resolves.toMatchObject({ gatewayFeeCents: 2000, platformFeeCents: 1000 });
  });

  it("serializes different concurrent refunds and leaves zero commission net", async () => {
    const suffix = `${Date.now()}split`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-SPLIT-${suffix}`;
    await createPendingOrder(vendor.id, orderNumber, 100000, {
      affiliateId: affiliate.id,
      referralCode: affiliate.code,
      commissionRateBps: affiliate.commissionRateBps,
    });
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid",
      orderNumber,
      grossAmountCents: 100000,
    }));

    await Promise.all([
      processPaymentWebhook(PaymentWebhookPayload.parse({
        provider: "demo", eventId: `evt-refund-60-${suffix}`, eventType: "partially_refunded", orderNumber, refundAmountCents: 60000,
      })),
      processPaymentWebhook(PaymentWebhookPayload.parse({
        provider: "demo", eventId: `evt-refund-40-${suffix}`, eventType: "partially_refunded", orderNumber, refundAmountCents: 40000,
      })),
    ]);

    const transaction = await db.paymentTransaction.findUniqueOrThrow({
      where: { providerName_orderNumber: { providerName: "demo", orderNumber } },
    });
    const refundTotal = await db.refundRecord.aggregate({ where: { paymentTransactionId: transaction.id }, _sum: { refundAmountCents: true } });
    const commissionTotal = await db.affiliateCommission.aggregate({
      where: { vendorId: vendor.id, orderNumber, status: { in: ["pending", "approved", "locked", "paid"] } },
      _sum: { commissionAmountCents: true },
    });
    expect(transaction.status).toBe("refunded");
    expect(transaction.refundedAmountCents).toBe(100000);
    expect(refundTotal._sum.refundAmountCents).toBe(100000);
    expect(commissionTotal._sum.commissionAmountCents ?? 0).toBe(0);
  }, 15_000);

  it("serializes concurrent manual refunds and adjusts a locked commission", async () => {
    const suffix = `${Date.now()}manual-split`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-MANUAL-SPLIT-${suffix}`;
    const pending = await createPendingOrder(vendor.id, orderNumber, 100000, {
      affiliateId: affiliate.id,
      referralCode: affiliate.code,
      commissionRateBps: affiliate.commissionRateBps,
    });
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid",
      orderNumber,
      grossAmountCents: 100000,
    }));
    await db.affiliateCommission.updateMany({
      where: { vendorId: vendor.id, orderNumber, sourceType: "payment" },
      data: { status: "locked" },
    });

    await Promise.all([
      processManualRefund({ transactionId: pending.id, refundAmountCents: 60000, gatewayFeeRefundCents: 0, platformFeeRefundCents: 0, reason: "manual-a", monthKey: "2026-07" }),
      processManualRefund({ transactionId: pending.id, refundAmountCents: 40000, gatewayFeeRefundCents: 0, platformFeeRefundCents: 0, reason: "manual-b", monthKey: "2026-07" }),
    ]);

    const transaction = await db.paymentTransaction.findUniqueOrThrow({ where: { id: pending.id } });
    const refundTotal = await db.refundRecord.aggregate({ where: { paymentTransactionId: pending.id }, _sum: { refundAmountCents: true } });
    const commissionTotal = await db.affiliateCommission.aggregate({
      where: { vendorId: vendor.id, orderNumber, status: { in: ["pending", "approved", "locked", "paid"] } },
      _sum: { commissionAmountCents: true },
    });
    expect(transaction.status).toBe("refunded");
    expect(transaction.refundedAmountCents).toBe(100000);
    expect(refundTotal._sum.refundAmountCents).toBe(100000);
    expect(commissionTotal._sum.commissionAmountCents ?? 0).toBe(0);
  });
});
