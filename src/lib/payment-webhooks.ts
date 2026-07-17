import type { Prisma, WebhookEvent } from "@prisma/client";
import { z } from "zod";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";

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
});

export type PaymentWebhookPayloadInput = z.infer<typeof PaymentWebhookPayload>;

function monthKeyFromDate(date: Date) {
  return date.toISOString().slice(0, 7);
}

async function findVendor(payload: PaymentWebhookPayloadInput) {
  const db = getDb();

  if (payload.vendorId && payload.vendorSlug) {
    const [vendorById, vendorBySlug] = await Promise.all([
      db.vendor.findUnique({ where: { id: payload.vendorId } }),
      db.vendor.findUnique({ where: { slug: payload.vendorSlug } }),
    ]);

    if (!vendorById || !vendorBySlug) {
      throw new Error("付款 webhook 商家識別無效：vendorId 或 vendorSlug 找不到對應商家。");
    }

    if (vendorById.id !== vendorBySlug.id) {
      throw new Error("付款 webhook 商家識別不一致：vendorId 與 vendorSlug 必須對應同一商家。");
    }

    return vendorById;
  }

  if (payload.vendorId) {
    return db.vendor.findUnique({ where: { id: payload.vendorId } });
  }
  if (payload.vendorSlug) {
    return db.vendor.findUnique({ where: { slug: payload.vendorSlug } });
  }
  throw new Error("付款 webhook 缺少商家識別（vendorId 或 vendorSlug）。");
}

async function upsertAffiliateCommission(payload: PaymentWebhookPayloadInput, vendorId: string, transactionId: string, occurredAt: Date) {
  if (!payload.referralCode || payload.eventType !== "paid") return null;

  const db = getDb();
  const affiliate = await db.affiliate.findFirst({
    where: {
      vendorId,
      code: payload.referralCode.toUpperCase(),
      isActive: true,
    },
  });

  if (!affiliate) return null;

  const commissionRateBps = payload.commissionRateBps ?? affiliate.commissionRateBps;
  const commissionAmountCents = Math.round((payload.grossAmountCents * commissionRateBps) / 10000);
  const existing = await db.affiliateCommission.findFirst({
    where: { vendorId, orderNumber: payload.orderNumber, referralCode: payload.referralCode.toUpperCase() },
  });

  if (existing) {
    return db.affiliateCommission.update({
      where: { id: existing.id },
      data: {
        affiliateId: affiliate.id,
        orderAmountCents: payload.grossAmountCents,
        commissionRateBps,
        commissionAmountCents,
        status: existing.status === "void" ? "pending" : existing.status,
      },
    });
  }

  return db.affiliateCommission.create({
    data: {
      vendorId,
      affiliateId: affiliate.id,
      monthKey: monthKeyFromDate(occurredAt),
      sourceType: "webhook",
      sourceId: transactionId,
      referralCode: payload.referralCode.toUpperCase(),
      orderNumber: payload.orderNumber,
      orderAmountCents: payload.grossAmountCents,
      commissionRateBps,
      commissionAmountCents,
      status: "pending",
    },
  });
}

async function applyRefundToCommission(payload: PaymentWebhookPayloadInput, vendorId: string) {
  if (!["refunded", "partially_refunded"].includes(payload.eventType)) return null;

  const commission = await getDb().affiliateCommission.findFirst({
    where: {
      vendorId,
      orderNumber: payload.orderNumber,
      status: { in: ["pending", "approved", "locked"] },
    },
  });

  if (!commission) return null;

  if (payload.eventType === "refunded" || payload.refundAmountCents >= commission.orderAmountCents) {
    return getDb().affiliateCommission.update({
      where: { id: commission.id },
      data: {
        status: "void",
        commissionAmountCents: 0,
        settledAt: new Date(),
        sourceType: `${commission.sourceType}: webhook_refund`,
      },
    });
  }

  const negativeAmount = -Math.round((payload.refundAmountCents * commission.commissionRateBps) / 10000);
  return getDb().affiliateCommission.create({
    data: {
      vendorId,
      affiliateId: commission.affiliateId,
      monthKey: monthKeyFromDate(new Date(payload.occurredAt ?? new Date().toISOString())),
      sourceType: "refund_adjustment",
      sourceId: commission.id,
      referralCode: commission.referralCode,
      orderNumber: payload.orderNumber,
      orderAmountCents: -payload.refundAmountCents,
      commissionRateBps: commission.commissionRateBps,
      commissionAmountCents: negativeAmount,
      status: "approved",
    },
  });
}

export async function processPaymentWebhook(payload: PaymentWebhookPayloadInput, event?: WebhookEvent) {
  const db = getDb();
  const vendor = await findVendor(payload);
  if (!vendor) {
    throw new Error("找不到 webhook 對應商家。");
  }

  const occurredAt = new Date(payload.occurredAt ?? new Date().toISOString());
  const existingTransaction = await db.paymentTransaction.findFirst({
    where: { vendorId: vendor.id, orderNumber: payload.orderNumber },
    include: { refunds: true },
  });
  const grossAmountCents = payload.grossAmountCents || existingTransaction?.grossAmountCents || 0;
  const gatewayFeeCents = payload.gatewayFeeCents || existingTransaction?.gatewayFeeCents || 0;
  const platformFeeCents = payload.platformFeeCents || existingTransaction?.platformFeeCents || 0;
  const netAmountCents = payload.netAmountCents ?? existingTransaction?.netAmountCents ?? Math.max(0, grossAmountCents - gatewayFeeCents - platformFeeCents);

  const transaction = await db.$transaction(async (tx) => {
    const savedTransaction = existingTransaction
      ? await tx.paymentTransaction.update({
          where: { id: existingTransaction.id },
          data: {
            providerName: payload.provider,
            providerTradeNo: payload.providerTradeNo,
            paymentMode: payload.paymentMode,
            grossAmountCents,
            gatewayFeeCents,
            platformFeeCents,
            netAmountCents,
            currency: payload.currency,
            status: payload.eventType === "paid" ? "paid" : payload.eventType,
            occurredAt,
            metadata: (payload.metadata ?? {}) as Prisma.InputJsonObject,
          },
        })
      : await tx.paymentTransaction.create({
          data: {
            vendorId: vendor.id,
            providerName: payload.provider,
            providerTradeNo: payload.providerTradeNo,
            orderNumber: payload.orderNumber,
            paymentMode: payload.paymentMode,
            grossAmountCents,
            gatewayFeeCents,
            platformFeeCents,
            netAmountCents,
            currency: payload.currency,
            status: payload.eventType === "paid" ? "paid" : payload.eventType,
            occurredAt,
            metadata: (payload.metadata ?? {}) as Prisma.InputJsonObject,
          },
        });

    if (["refunded", "partially_refunded"].includes(payload.eventType) && payload.refundAmountCents > 0) {
      const alreadyRefunded = existingTransaction?.refunds.some((refund) => refund.providerEventId === payload.eventId) ?? false;
      if (!alreadyRefunded) {
        await tx.refundRecord.create({
          data: {
            vendorId: vendor.id,
            paymentTransactionId: savedTransaction.id,
            providerEventId: payload.eventId,
            monthKey: monthKeyFromDate(occurredAt),
            refundAmountCents: payload.refundAmountCents,
            gatewayFeeRefundCents: payload.gatewayFeeRefundCents,
            platformFeeRefundCents: payload.platformFeeRefundCents,
            reason: payload.refundReason,
          },
        });
        await tx.paymentTransaction.update({
          where: { id: savedTransaction.id },
          data: {
            refundedAmountCents: Math.min(grossAmountCents, savedTransaction.refundedAmountCents + payload.refundAmountCents),
            refundReason: payload.refundReason,
            refundedAt: occurredAt,
          },
        });
      }
    }

    if (event) {
      await tx.webhookEvent.update({
        where: { id: event.id },
        data: {
          vendorId: vendor.id,
          status: "processed",
          processedAt: new Date(),
          errorMessage: null,
        },
      });
    }

    return savedTransaction;
  });

  const commission = await upsertAffiliateCommission(payload, vendor.id, transaction.id, occurredAt);
  const refundCommission = await applyRefundToCommission(payload, vendor.id);

  await writeAuditLog({
    vendorId: vendor.id,
    actorLabel: `webhook:${payload.provider}`,
    action: `payment_webhook_${payload.eventType}`,
    targetType: "WebhookEvent",
    targetId: event?.id ?? payload.eventId,
    before: auditSnapshot(existingTransaction),
    after: auditSnapshot({ transaction, commission, refundCommission, eventId: payload.eventId }),
  });

  return { vendor, transaction, commission, refundCommission };
}
