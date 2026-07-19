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

function metadataObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function formSubmissionIdFromMetadata(metadata: unknown) {
  const formSubmissionId = metadataObject(metadata).formSubmissionId;
  return typeof formSubmissionId === "string" && formSubmissionId.length > 0 ? formSubmissionId : null;
}

function referralCodeFromMetadata(metadata: unknown) {
  const referralCode = metadataObject(metadata).referralCode;
  return typeof referralCode === "string" && referralCode.trim().length > 0 ? referralCode.trim() : null;
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

async function resolveWebhookScope(payload: PaymentWebhookPayloadInput) {
  const db = getDb();

  // PayUni 的真實 UPP 回呼不保證帶回自訂 VendorId，因此只在已驗簽且
  // 缺少商家識別時，使用結帳時建立的 provider + orderNumber 交易反查。
  if (!payload.vendorId && !payload.vendorSlug) {
    const matchingTransactions = await db.paymentTransaction.findMany({
      where: {
        providerName: payload.provider,
        orderNumber: payload.orderNumber,
      },
      include: { vendor: true, refunds: true },
      take: 2,
    });

    if (matchingTransactions.length === 0) {
      throw new Error("付款 webhook 缺少商家識別，且找不到對應的既存結帳交易。");
    }
    if (matchingTransactions.length > 1) {
      throw new Error("付款 webhook 訂單識別不唯一，拒絕自動歸屬商家。");
    }

    const [transaction] = matchingTransactions;
    return { vendor: transaction.vendor, existingTransaction: transaction };
  }

  const vendor = await findVendor(payload);
  if (!vendor) {
    throw new Error("找不到 webhook 對應商家。");
  }

  const existingTransaction = await db.paymentTransaction.findFirst({
    where: { vendorId: vendor.id, orderNumber: payload.orderNumber },
    include: { refunds: true },
  });
  return { vendor, existingTransaction };
}

async function upsertAffiliateCommission(
  payload: PaymentWebhookPayloadInput,
  vendorId: string,
  transactionId: string,
  occurredAt: Date,
  hasRefundedOrder: boolean,
  referralCode: string | null | undefined,
) {
  if (!referralCode || payload.eventType !== "paid") return null;

  const db = getDb();
  const normalizedReferralCode = referralCode.toUpperCase();
  const affiliate = await db.affiliate.findFirst({
    where: {
      vendorId,
      code: normalizedReferralCode,
      isActive: true,
    },
  });

  if (!affiliate) return null;

  const commissionRateBps = payload.commissionRateBps ?? affiliate.commissionRateBps;
  const commissionAmountCents = Math.round((payload.grossAmountCents * commissionRateBps) / 10000);
  const existing = await db.affiliateCommission.findFirst({
    where: { vendorId, orderNumber: payload.orderNumber, referralCode: normalizedReferralCode },
  });

  if (existing) {
    if (hasRefundedOrder || existing.status === "void") {
      return existing;
    }

    return db.affiliateCommission.update({
      where: { id: existing.id },
      data: {
        affiliateId: affiliate.id,
        orderAmountCents: payload.grossAmountCents,
        commissionRateBps,
        commissionAmountCents,
        status: existing.status,
      },
    });
  }

  if (hasRefundedOrder) return null;

  return db.affiliateCommission.create({
    data: {
      vendorId,
      affiliateId: affiliate.id,
      monthKey: monthKeyFromDate(occurredAt),
      sourceType: "webhook",
      sourceId: transactionId,
      referralCode: normalizedReferralCode,
      orderNumber: payload.orderNumber,
      orderAmountCents: payload.grossAmountCents,
      commissionRateBps,
      commissionAmountCents,
      status: "pending",
    },
  });
}

async function applyRefundToCommission(
  db: Pick<Prisma.TransactionClient, "affiliateCommission">,
  payload: PaymentWebhookPayloadInput,
  vendorId: string,
) {
  if (!["refunded", "partially_refunded"].includes(payload.eventType)) return null;

  const commission = await db.affiliateCommission.findFirst({
    where: {
      vendorId,
      orderNumber: payload.orderNumber,
      sourceType: { not: "refund_adjustment" },
      status: { in: ["pending", "approved", "locked"] },
    },
  });

  if (payload.eventType === "refunded") {
    const settledAt = new Date();
    const voidedCommission = commission
      ? await db.affiliateCommission.update({
          where: { id: commission.id },
          data: {
            status: "void",
            commissionAmountCents: 0,
            settledAt,
            sourceType: `${commission.sourceType}: webhook_refund`,
          },
        })
      : null;

    await db.affiliateCommission.updateMany({
      where: {
        vendorId,
        orderNumber: payload.orderNumber,
        sourceType: "refund_adjustment",
      },
      data: {
        status: "void",
        commissionAmountCents: 0,
        settledAt,
      },
    });

    return voidedCommission;
  }

  if (!commission) return null;

  if (payload.refundAmountCents >= commission.orderAmountCents) {
    return db.affiliateCommission.update({
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
  return db.affiliateCommission.create({
    data: {
      vendorId,
      affiliateId: commission.affiliateId,
      monthKey: monthKeyFromDate(new Date(payload.occurredAt ?? new Date().toISOString())),
      sourceType: "refund_adjustment",
      sourceId: payload.eventId,
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
  const { vendor, existingTransaction } = await resolveWebhookScope(payload);

  const occurredAt = new Date(payload.occurredAt ?? new Date().toISOString());
  if (existingTransaction && payload.eventType === "paid" && (
    payload.grossAmountCents !== existingTransaction.grossAmountCents
    || payload.currency !== existingTransaction.currency
  )) {
    throw new Error("付款 webhook 訂單金額或幣別與既存交易不一致。");
  }

  const hasRefundedOrder = Boolean(existingTransaction && (
    existingTransaction.refundedAmountCents > 0
    || existingTransaction.refunds.length > 0
    || ["refunded", "partially_refunded"].includes(existingTransaction.status)
  ));
  const grossAmountCents = payload.grossAmountCents || existingTransaction?.grossAmountCents || 0;
  const gatewayFeeCents = payload.gatewayFeeCents || existingTransaction?.gatewayFeeCents || 0;
  const platformFeeCents = payload.platformFeeCents || existingTransaction?.platformFeeCents || 0;
  const netAmountCents = payload.netAmountCents ?? existingTransaction?.netAmountCents ?? Math.max(0, grossAmountCents - gatewayFeeCents - platformFeeCents);
  const existingMetadata = metadataObject(existingTransaction?.metadata);
  const checkoutReferralCode = referralCodeFromMetadata(existingMetadata);
  const payloadMetadata = { ...metadataObject(payload.metadata) };
  delete payloadMetadata.referralCode;
  const formSubmissionId = payload.eventType === "paid"
    ? formSubmissionIdFromMetadata(payloadMetadata) ?? formSubmissionIdFromMetadata(existingMetadata)
    : formSubmissionIdFromMetadata(existingMetadata);
  const transactionMetadata = {
    ...existingMetadata,
    ...payloadMetadata,
    ...(checkoutReferralCode ? { referralCode: checkoutReferralCode } : {}),
    ...(formSubmissionId ? { formSubmissionId } : {}),
  } as Prisma.InputJsonObject;
  const preservesOccurredAt = Boolean(existingTransaction) && ["refunded", "partially_refunded"].includes(payload.eventType);
  const preservesRefundState = payload.eventType === "paid" && hasRefundedOrder;

  const { transaction, refundCommission } = await db.$transaction(async (tx) => {
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
            status: preservesRefundState ? existingTransaction.status : payload.eventType === "paid" ? "paid" : payload.eventType,
            ...(preservesOccurredAt ? {} : { occurredAt }),
            metadata: transactionMetadata,
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
            metadata: transactionMetadata,
          },
        });

    let refundCommission = null;
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
        refundCommission = await applyRefundToCommission(tx, payload, vendor.id);
      }
    }

    if (payload.eventType === "paid" && formSubmissionId) {
      const leadAttribution = await tx.teamLeadAttribution.findFirst({
        where: { vendorId: vendor.id, formSubmissionId },
      });

      if (leadAttribution) {
        const attributionSnapshot = {
          teamId: leadAttribution.teamId,
          leadAttributionId: leadAttribution.id,
          pageId: leadAttribution.pageId,
          leaderMembershipId: leadAttribution.leaderMembershipId,
          promoterMembershipId: leadAttribution.promoterMembershipId,
          contentOwnerMembershipId: leadAttribution.contentOwnerMembershipId,
          seminarOwnerMembershipId: leadAttribution.seminarOwnerMembershipId,
          source: leadAttribution.source,
          referralCode: leadAttribution.referralCode,
        };

        await tx.teamConversionAttribution.upsert({
          where: {
            vendorId_paymentTransactionId: {
              vendorId: vendor.id,
              paymentTransactionId: savedTransaction.id,
            },
          },
          create: {
            vendorId: vendor.id,
            paymentTransactionId: savedTransaction.id,
            ...attributionSnapshot,
          },
          update: attributionSnapshot,
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

    return { transaction: savedTransaction, refundCommission };
  });

  const commission = await upsertAffiliateCommission(
    payload,
    vendor.id,
    transaction.id,
    occurredAt,
    hasRefundedOrder,
    existingTransaction ? checkoutReferralCode : payload.referralCode,
  );

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
