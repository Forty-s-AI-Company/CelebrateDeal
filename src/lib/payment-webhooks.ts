import { randomUUID } from "node:crypto";
import type { Prisma, WebhookEvent } from "@prisma/client";
import { z } from "zod";
import { auditSnapshot, requestAuditMeta, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { resolveOpenSettlementMonth } from "@/lib/settlement-operations";

export const PaymentWebhookPayload = z.object({
  provider: z.string().min(1),
  eventId: z.string().min(1),
  eventType: z.enum(["paid", "refunded", "partially_refunded", "failed"]),
  vendorSlug: z.string().optional(),
  vendorId: z.string().optional(),
  orderNumber: z.string().min(1),
  providerTradeNo: z.string().optional(),
  paymentMode: z.enum(["platform", "byo"]).default("platform"),
  grossAmountCents: z.number().int().nonnegative().default(0),
  gatewayFeeCents: z.number().int().nonnegative().default(0),
  platformFeeCents: z.number().int().nonnegative().default(0),
  netAmountCents: z.number().int().nonnegative().optional(),
  currency: z.string().default("TWD"),
  occurredAt: z.string().datetime().optional(),
  refundAmountCents: z.number().int().nonnegative().default(0),
  gatewayFeeRefundCents: z.number().int().nonnegative().default(0),
  platformFeeRefundCents: z.number().int().nonnegative().default(0),
  refundReason: z.string().optional(),
  referralCode: z.string().optional(),
  commissionRateBps: z.number().int().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).superRefine((payload, context) => {
  if (payload.eventType === "paid" && payload.grossAmountCents <= 0) {
    context.addIssue({ code: "custom", path: ["grossAmountCents"], message: "Paid event requires a positive gross amount" });
  }
  if ((payload.eventType === "refunded" || payload.eventType === "partially_refunded") && payload.refundAmountCents <= 0) {
    context.addIssue({ code: "custom", path: ["refundAmountCents"], message: "Refund event requires a positive refund amount" });
  }
});

export type PaymentWebhookPayloadInput = z.infer<typeof PaymentWebhookPayload>;

function monthKeyFromDate(date: Date) {
  return date.toISOString().slice(0, 7);
}

type LedgerDb = Prisma.TransactionClient;

type AttributionSnapshot = {
  affiliateId: string;
  attributionClickId: string | null;
  referralCode: string;
  commissionRateBps: number;
  policyVersion: string;
};

function transactionAttributionSnapshot(metadata: Prisma.JsonValue | null): AttributionSnapshot | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = metadata as Record<string, unknown>;
  if (
    typeof value.affiliateId !== "string"
    || typeof value.referralCode !== "string"
    || typeof value.commissionRateBps !== "number"
    || !Number.isInteger(value.commissionRateBps)
    || value.commissionRateBps < 0
    || value.commissionRateBps > 10000
    || typeof value.attributionPolicyVersion !== "string"
  ) return null;
  return {
    affiliateId: value.affiliateId,
    attributionClickId: typeof value.attributionClickId === "string" ? value.attributionClickId : null,
    referralCode: value.referralCode.toUpperCase(),
    commissionRateBps: value.commissionRateBps,
    policyVersion: value.attributionPolicyVersion,
  };
}

async function markPaidAttributionConversion(
  db: LedgerDb,
  metadata: Prisma.JsonValue | null,
  vendorId: string,
  eventType: PaymentWebhookPayloadInput["eventType"],
  transactionStatus: string,
  occurredAt: Date,
) {
  if (eventType !== "paid" || transactionStatus === "refunded") return 0;
  const snapshot = transactionAttributionSnapshot(metadata);
  if (!snapshot?.attributionClickId) return 0;
  const updated = await db.affiliateClick.updateMany({
    where: {
      id: snapshot.attributionClickId,
      vendorId,
      affiliateId: snapshot.affiliateId,
      convertedAt: null,
    },
    data: { convertedAt: occurredAt },
  });
  return updated.count;
}

async function upsertAffiliateCommission(
  db: LedgerDb,
  payload: PaymentWebhookPayloadInput,
  vendorId: string,
  transactionId: string,
  transactionMetadata: Prisma.JsonValue | null,
  refundedAmountCents: number,
  bookingMonthKey: string,
) {
  if (payload.eventType !== "paid") return null;
  const snapshot = transactionAttributionSnapshot(transactionMetadata);
  if (!snapshot) return null;

  const affiliate = await db.affiliate.findFirst({
    where: { id: snapshot.affiliateId, vendorId },
  });
  if (!affiliate) return null;

  const eligibleAmountCents = Math.max(0, payload.grossAmountCents - refundedAmountCents);
  const existing = await db.affiliateCommission.findFirst({
    where: { vendorId, sourceId: transactionId, sourceType: { in: ["payment", "webhook"] } },
  });
  if (existing?.sourceType === "webhook") {
    return db.affiliateCommission.update({ where: { id: existing.id }, data: { sourceType: "payment" } });
  }
  if (existing || eligibleAmountCents === 0) return existing;

  const commissionAmountCents = Math.round((eligibleAmountCents * snapshot.commissionRateBps) / 10000);
  return db.affiliateCommission.create({
    data: {
      vendorId,
      affiliateId: snapshot.affiliateId,
      monthKey: bookingMonthKey,
      sourceType: "payment",
      sourceId: transactionId,
      referralCode: snapshot.referralCode,
      orderNumber: payload.orderNumber,
      orderAmountCents: payload.grossAmountCents,
      commissionRateBps: snapshot.commissionRateBps,
      commissionAmountCents,
      status: "pending",
    },
  });
}

async function applyRefundToCommission(
  db: LedgerDb,
  payload: PaymentWebhookPayloadInput,
  vendorId: string,
  bookingMonthKey: string,
) {
  if (!(["refunded", "partially_refunded"] as string[]).includes(payload.eventType)) return null;
  const commission = await db.affiliateCommission.findFirst({
    where: { vendorId, orderNumber: payload.orderNumber, sourceType: "payment" },
  });
  if (!commission) return null;
  if (commission.status === "reversed") return commission;

  const isFullRefund = payload.eventType === "refunded";
  const priorAdjustments = await db.affiliateCommission.aggregate({
    where: {
      vendorId,
      orderNumber: payload.orderNumber,
      sourceType: "refund_adjustment",
      status: { in: ["pending", "approved", "locked", "paid"] },
    },
    _sum: { commissionAmountCents: true },
  });
  const desiredAdjustment = isFullRefund
    ? -commission.commissionAmountCents - (priorAdjustments._sum.commissionAmountCents ?? 0)
    : -Math.round((payload.refundAmountCents * commission.commissionRateBps) / 10000);
  const sourceId = `${payload.provider}:${payload.eventId}`;
  const modern = await db.affiliateCommission.findUnique({
    where: { vendorId_sourceType_sourceId: { vendorId, sourceType: "refund_adjustment", sourceId } },
  });
  if (modern) return modern;
  const legacy = await db.affiliateCommission.findFirst({
    where: {
      vendorId,
      orderNumber: payload.orderNumber,
      sourceType: "refund_adjustment",
      sourceId: commission.id,
      commissionAmountCents: desiredAdjustment,
    },
  });
  if (legacy) return db.affiliateCommission.update({ where: { id: legacy.id }, data: { sourceId } });

  return db.affiliateCommission.create({
    data: {
      vendorId,
      affiliateId: commission.affiliateId,
      monthKey: bookingMonthKey,
      sourceType: "refund_adjustment",
      sourceId,
      referralCode: commission.referralCode,
      orderNumber: payload.orderNumber,
      orderAmountCents: -payload.refundAmountCents,
      commissionRateBps: commission.commissionRateBps,
      commissionAmountCents: desiredAdjustment,
      status: "approved",
    },
  });
}

function nextTransactionStatus(currentStatus: string, eventType: PaymentWebhookPayloadInput["eventType"], refundedAmountCents: number, grossAmountCents: number) {
  if (refundedAmountCents >= grossAmountCents && grossAmountCents > 0) return "refunded";
  if (refundedAmountCents > 0) return "partially_refunded";
  if (["paid", "refunded", "partially_refunded"].includes(currentStatus) && eventType === "failed") return currentStatus;
  if (["refunded", "partially_refunded"].includes(currentStatus) && eventType === "paid") return currentStatus;
  return eventType;
}

export async function processPaymentWebhook(payload: PaymentWebhookPayloadInput, event?: WebhookEvent) {
  const db = getDb();
  const occurredAt = new Date(payload.occurredAt ?? new Date().toISOString());
  const auditMeta = await requestAuditMeta();
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1::int AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${`${payload.provider}:${payload.orderNumber}`}, 0))`;
    const existingTransaction = await tx.paymentTransaction.findUnique({
      where: { providerName_orderNumber: { providerName: payload.provider, orderNumber: payload.orderNumber } },
      include: { refunds: true, vendor: true },
    });
    if (!existingTransaction) throw new Error("Unknown payment order");
    if (payload.vendorId && payload.vendorId !== existingTransaction.vendorId) throw new Error("Payment order vendor mismatch");
    if (payload.vendorSlug && payload.vendorSlug !== existingTransaction.vendor.slug) throw new Error("Payment order vendor mismatch");
    if (payload.grossAmountCents > 0 && payload.grossAmountCents !== existingTransaction.grossAmountCents) throw new Error("Payment order amount mismatch");
    if (payload.currency !== existingTransaction.currency) throw new Error("Payment order currency mismatch");
    const bookingMonthKey = await resolveOpenSettlementMonth(
      tx,
      existingTransaction.vendorId,
      monthKeyFromDate(occurredAt),
    );

    const isRefund = (["refunded", "partially_refunded"] as string[]).includes(payload.eventType);
    const remainingRefundableCents = existingTransaction.grossAmountCents - existingTransaction.refundedAmountCents;
    const refundAmountCents = payload.eventType === "refunded" && payload.refundAmountCents === 0
      ? remainingRefundableCents
      : payload.refundAmountCents;
    const existingRefund = existingTransaction.refunds.some((refund) => refund.providerEventId === payload.eventId);
    if (isRefund && !existingRefund && (refundAmountCents <= 0 || refundAmountCents > remainingRefundableCents)) {
      throw new Error("Invalid refund amount");
    }
    if (isRefund && !existingRefund && (
      existingTransaction.refundedGatewayFeeCents + payload.gatewayFeeRefundCents > existingTransaction.gatewayFeeCents
      || existingTransaction.refundedPlatformFeeCents + payload.platformFeeRefundCents > existingTransaction.platformFeeCents
    )) {
      throw new Error("Invalid refund fee amount");
    }

    let insertedRefund = false;
    if (isRefund) {
      const created = await tx.refundRecord.createMany({
        data: [{
          vendorId: existingTransaction.vendorId,
          paymentTransactionId: existingTransaction.id,
          providerEventId: payload.eventId,
          monthKey: bookingMonthKey,
          refundAmountCents,
          gatewayFeeRefundCents: payload.gatewayFeeRefundCents,
          platformFeeRefundCents: payload.platformFeeRefundCents,
          reason: payload.refundReason,
        }],
        skipDuplicates: true,
      });
      insertedRefund = created.count === 1;
    }

    const currentTransaction = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: existingTransaction.id } });
    const capturesPaidSnapshot = payload.eventType === "paid" && !currentTransaction.bookingMonthKey;
    let capturedPlatformFeeCents = currentTransaction.platformFeeCents;
    if (capturesPaidSnapshot && currentTransaction.paymentMode === "platform") {
      const subscription = await tx.vendorSubscription.findFirst({
        where: {
          vendorId: currentTransaction.vendorId,
          status: { in: ["active", "trialing"] },
          startedAt: { lte: occurredAt },
          OR: [{ endedAt: null }, { endedAt: { gte: occurredAt } }],
        },
        include: { plan: true },
        orderBy: { startedAt: "desc" },
      });
      if (!subscription) throw new Error("Payment order has no active billing plan");
      const feeRateBps = subscription.customFeeRateBps ?? subscription.plan.transactionFeeRateBps;
      capturedPlatformFeeCents = Math.round((currentTransaction.grossAmountCents * feeRateBps) / 10000);
    }
    let transaction = await tx.paymentTransaction.update({
      where: { id: existingTransaction.id },
      data: {
        providerTradeNo: payload.providerTradeNo ?? existingTransaction.providerTradeNo,
        gatewayFeeCents: capturesPaidSnapshot ? payload.gatewayFeeCents : existingTransaction.gatewayFeeCents,
        platformFeeCents: capturesPaidSnapshot ? capturedPlatformFeeCents : existingTransaction.platformFeeCents,
        netAmountCents: payload.netAmountCents ?? existingTransaction.netAmountCents,
        refundReason: insertedRefund ? payload.refundReason : currentTransaction.refundReason,
        refundedAt: insertedRefund ? occurredAt : currentTransaction.refundedAt,
        occurredAt: payload.eventType === "paid" ? occurredAt : currentTransaction.occurredAt,
        bookingMonthKey: payload.eventType === "paid" && !currentTransaction.bookingMonthKey
          ? bookingMonthKey
          : currentTransaction.bookingMonthKey,
      },
    });
    const status = nextTransactionStatus(transaction.status, payload.eventType, transaction.refundedAmountCents, transaction.grossAmountCents);
    if (transaction.status !== status) {
      transaction = await tx.paymentTransaction.update({ where: { id: transaction.id }, data: { status } });
    }

    const effectivePayload = {
      ...payload,
      eventType: isRefund
        ? transaction.status === "refunded"
          ? "refunded" as const
          : "partially_refunded" as const
        : payload.eventType,
      grossAmountCents: transaction.grossAmountCents,
      refundAmountCents,
    };
    const commission = await upsertAffiliateCommission(
      tx,
      effectivePayload,
      transaction.vendorId,
      transaction.id,
      transaction.metadata,
      transaction.refundedAmountCents,
      bookingMonthKey,
    );
    const attributedConversionCount = await markPaidAttributionConversion(
      tx,
      transaction.metadata,
      transaction.vendorId,
      payload.eventType,
      transaction.status,
      occurredAt,
    );
    const refundCommission = await applyRefundToCommission(tx, effectivePayload, transaction.vendorId, bookingMonthKey);
    if (event) {
      await tx.webhookEvent.update({
        where: { id: event.id },
        data: { vendorId: transaction.vendorId, status: "processed", processedAt: new Date(), errorMessage: null },
      });
    }
    await writeAuditLog({
      vendorId: transaction.vendorId,
      actorLabel: `webhook:${payload.provider}`,
      action: `payment_webhook_${payload.eventType}`,
      targetType: "WebhookEvent",
      targetId: event?.id ?? payload.eventId,
      before: auditSnapshot(existingTransaction),
      after: auditSnapshot({ transaction, commission, refundCommission, attributedConversionCount, eventId: payload.eventId }),
    }, { client: tx, meta: auditMeta });
    return { before: existingTransaction, vendor: existingTransaction.vendor, transaction, commission, refundCommission, attributedConversionCount };
  });

  return { vendor: result.vendor, transaction: result.transaction, commission: result.commission, refundCommission: result.refundCommission };
}

export async function processManualRefund(input: {
  transactionId: string;
  refundAmountCents: number;
  gatewayFeeRefundCents: number;
  platformFeeRefundCents: number;
  reason: string | null;
  monthKey: string;
}) {
  const db = getDb();
  const occurredAt = new Date();
  const eventId = `manual:${randomUUID()}`;
  return db.$transaction(async (tx) => {
    const initial = await tx.paymentTransaction.findUnique({ where: { id: input.transactionId } });
    if (!initial?.orderNumber) throw new Error("Payment transaction not refundable");
    await tx.$queryRaw`SELECT 1::int AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${`${initial.providerName}:${initial.orderNumber}`}, 0))`;
    const transaction = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: input.transactionId } });
    const bookingMonthKey = await resolveOpenSettlementMonth(tx, transaction.vendorId, input.monthKey);
    const remaining = transaction.grossAmountCents - transaction.refundedAmountCents;
    if (input.refundAmountCents <= 0 || input.refundAmountCents > remaining) throw new Error("Invalid refund amount");
    if (
      transaction.refundedGatewayFeeCents + input.gatewayFeeRefundCents > transaction.gatewayFeeCents
      || transaction.refundedPlatformFeeCents + input.platformFeeRefundCents > transaction.platformFeeCents
    ) throw new Error("Invalid refund fee amount");
    await tx.refundRecord.create({
      data: {
        vendorId: transaction.vendorId,
        paymentTransactionId: transaction.id,
        providerEventId: eventId,
        monthKey: bookingMonthKey,
        refundAmountCents: input.refundAmountCents,
        gatewayFeeRefundCents: input.gatewayFeeRefundCents,
        platformFeeRefundCents: input.platformFeeRefundCents,
        reason: input.reason,
      },
    });
    const incremented = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } });
    const status = incremented.refundedAmountCents >= incremented.grossAmountCents ? "refunded" : "partially_refunded";
    const updated = await tx.paymentTransaction.update({
      where: { id: transaction.id },
      data: { status, refundReason: input.reason, refundedAt: occurredAt },
    });
    const refundCommission = await applyRefundToCommission(tx, {
      provider: transaction.providerName,
      eventId,
      eventType: status,
      orderNumber: transaction.orderNumber!,
      paymentMode: transaction.paymentMode === "byo" ? "byo" : "platform",
      grossAmountCents: transaction.grossAmountCents,
      gatewayFeeCents: transaction.gatewayFeeCents,
      platformFeeCents: transaction.platformFeeCents,
      netAmountCents: transaction.netAmountCents,
      currency: transaction.currency,
      refundAmountCents: input.refundAmountCents,
      gatewayFeeRefundCents: input.gatewayFeeRefundCents,
      platformFeeRefundCents: input.platformFeeRefundCents,
      refundReason: input.reason ?? undefined,
    }, transaction.vendorId, bookingMonthKey);
    return { before: transaction, transaction: updated, refundCommission, eventId };
  });
}
