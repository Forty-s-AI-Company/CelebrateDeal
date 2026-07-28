import { Prisma, type WebhookEvent } from "@prisma/client";
import { z } from "zod";
import {
  AffiliateCommissionRateBps,
  assertAffiliateCommissionAmounts,
  buildCommissionDeduplicationKey,
  commissionAmountCents,
} from "@/lib/affiliate-commission";
import {
  appendCommissionLedgerEntry,
  appendDisputeLedgerEntry,
  commissionLedgerBalance,
} from "@/lib/affiliate-commission-accounting";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { applyPaymentInventoryTransition } from "@/lib/inventory-reservations";
import {
  isRefundEvent,
  isDisputeEvent,
  isPaymentLifecycleEvent,
  resolvePaymentStatus,
  validatePaymentWebhookInvariants,
} from "@/lib/payment-webhook-invariants";

export const PaymentWebhookPayload = z.object({
  provider: z.string().min(1),
  eventId: z.string().min(1),
  eventType: z.enum(["paid", "refunded", "partially_refunded", "failed", "dispute_opened", "dispute_released", "dispute_lost"]),
  vendorSlug: z.string().optional(),
  vendorId: z.string().optional(),
  orderNumber: z.string().min(1),
  providerTradeNo: z.string().optional(),
  paymentMode: z.enum(["platform", "byo"]).default("platform"),
  grossAmountCents: z.number().int().nonnegative().default(0),
  gatewayFeeCents: z.number().int().nonnegative().default(0),
  platformFeeCents: z.number().int().nonnegative().default(0),
  netAmountCents: z.number().int().nonnegative().optional(),
  currency: z.string().trim().length(3).optional(),
  occurredAt: z.string().datetime().optional(),
  refundAmountCents: z.number().int().nonnegative().default(0),
  gatewayFeeRefundCents: z.number().int().nonnegative().default(0),
  platformFeeRefundCents: z.number().int().nonnegative().default(0),
  refundReason: z.string().optional(),
  disputeCaseId: z.string().trim().min(1).optional(),
  referralCode: z.string().optional(),
  commissionRateBps: AffiliateCommissionRateBps.optional(),
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

function affiliateClickIdFromMetadata(metadata: unknown) {
  const affiliateClickId = metadataObject(metadata).affiliateClickId;
  return typeof affiliateClickId === "string" && affiliateClickId.length > 0 ? affiliateClickId : null;
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

    // The zero/multiple guards above prove the singleton exists.
    const transaction = matchingTransactions[0]!;
    return { vendor: transaction.vendor, existingTransaction: transaction };
  }

  const vendor = await findVendor(payload);
  if (!vendor) {
    throw new Error("找不到 webhook 對應商家。");
  }

  const existingTransaction = await db.paymentTransaction.findFirst({
    where: {
      vendorId: vendor.id,
      providerName: payload.provider,
      orderNumber: payload.orderNumber,
    },
    include: { refunds: true },
  });
  return { vendor, existingTransaction };
}

async function upsertAffiliateCommission(
  db: Pick<Prisma.TransactionClient, "affiliate" | "affiliateCommission" | "affiliateCommissionLedgerEntry">,
  payload: PaymentWebhookPayloadInput,
  vendorId: string,
  transactionId: string,
  grossAmountCents: number,
  occurredAt: Date,
  hasRefundedOrder: boolean,
  referralCode: string | null | undefined,
) {
  if (!referralCode || payload.eventType !== "paid") return null;

  const normalizedReferralCode = referralCode.toUpperCase();
  const affiliate = await db.affiliate.findFirst({
    where: {
      vendorId,
      code: normalizedReferralCode,
      isActive: true,
    },
  });

  if (!affiliate) return null;

  const commissionRateBps = AffiliateCommissionRateBps.parse(
    payload.commissionRateBps ?? affiliate.commissionRateBps,
  );
  const calculatedCommissionCents = commissionAmountCents(grossAmountCents, commissionRateBps);
  const sourceType = "webhook";
  const deduplicationKey = buildCommissionDeduplicationKey({
    affiliateId: affiliate.id,
    sourceType,
    sourceId: transactionId,
  });
  assertAffiliateCommissionAmounts({
    sourceType,
    orderAmountCents: grossAmountCents,
    commissionAmountCents: calculatedCommissionCents,
  });
  const immutableData = {
    affiliateId: affiliate.id,
    sourceType,
    sourceId: transactionId,
    referralCode: normalizedReferralCode,
    orderNumber: payload.orderNumber,
    orderAmountCents: grossAmountCents,
    commissionRateBps,
    commissionAmountCents: calculatedCommissionCents,
  };
  const uniqueCommission = {
    vendorId,
    deduplicationKey,
  };
  const existing = await db.affiliateCommission.findUnique({
    where: { vendorId_deduplicationKey: uniqueCommission },
  });

  if (existing) {
    for (const [field, value] of Object.entries(immutableData)) {
      if (existing[field as keyof typeof immutableData] !== value) {
        throw new Error(`相同佣金去重鍵的不可變身分不一致：${field}`);
      }
    }
    if (hasRefundedOrder || existing.status === "void") {
      return existing;
    }
    return existing;
  }

  if (hasRefundedOrder) return null;

  const saved = await db.affiliateCommission.upsert({
    where: { vendorId_deduplicationKey: uniqueCommission },
    create: {
      vendorId,
      monthKey: monthKeyFromDate(occurredAt),
      deduplicationKey,
      ...immutableData,
      status: "pending",
    },
    // A concurrent winner must never have its immutable business identity
    // rewritten by a duplicate webhook.
    update: {},
  });
  for (const [field, value] of Object.entries(immutableData)) {
    if (saved[field as keyof typeof immutableData] !== value) {
      throw new Error(`相同佣金去重鍵的不可變身分不一致：${field}`);
    }
  }
  await appendCommissionLedgerEntry(db, {
    vendorId,
    affiliateCommissionId: saved.id,
    entryType: "accrual",
    providerName: payload.provider,
    eventIdentity: payload.eventId,
    amountCents: saved.commissionAmountCents,
    occurredAt,
  });
  return saved;
}

async function applyRefundToCommission(
  db: Pick<Prisma.TransactionClient, "affiliateCommission" | "affiliateCommissionLedgerEntry">,
  payload: PaymentWebhookPayloadInput,
  vendorId: string,
) {
  if (!["refunded", "partially_refunded"].includes(payload.eventType)) return null;

  const commission = await db.affiliateCommission.findFirst({
    where: {
      vendorId,
      orderNumber: payload.orderNumber,
      sourceType: { not: "refund_adjustment" },
    },
  });

  if (!commission) return null;
  const currentBalance = await commissionLedgerBalance(db, vendorId, commission.id);
  const calculatedRefund = commissionAmountCents(payload.refundAmountCents, commission.commissionRateBps);
  const refundAmount = payload.eventType === "refunded"
    ? currentBalance
    : Math.min(currentBalance, calculatedRefund);
  if (refundAmount > 0) {
    await appendCommissionLedgerEntry(db, {
      vendorId,
      affiliateCommissionId: commission.id,
      entryType: "refund",
      providerName: payload.provider,
      eventIdentity: payload.eventId,
      amountCents: -refundAmount,
      occurredAt: new Date(payload.occurredAt ?? new Date().toISOString()),
    });
  }
  if (commission.status !== "paid") {
    const voided = await db.affiliateCommission.updateMany({
      where: { id: commission.id, vendorId, status: { in: ["pending", "approved", "locked"] } },
      // The original amount is immutable accounting evidence. Ledger entries
      // express the refund/reversal rather than erasing this source amount.
      data: { status: "void", settledAt: new Date() },
    });
    if (voided.count !== 1 && commission.status !== "void") {
      throw new Error("退款佣金狀態已被其他交易變更。");
    }
  }
  return db.affiliateCommission.findUnique({ where: { id: commission.id } });
}

async function applyDisputeToCommission(
  db: Pick<Prisma.TransactionClient, "affiliateCommission" | "affiliateCommissionLedgerEntry">,
  payload: PaymentWebhookPayloadInput,
  vendorId: string,
) {
  if (!isDisputeEvent(payload.eventType)) return null;
  if (!payload.disputeCaseId) throw new Error("synthetic dispute webhook 缺少 disputeCaseId。");
  const commission = await db.affiliateCommission.findFirst({
    where: { vendorId, orderNumber: payload.orderNumber, sourceType: { not: "refund_adjustment" } },
  });
  if (!commission) throw new Error("dispute webhook 找不到對應佣金。");
  return appendDisputeLedgerEntry(db, {
    vendorId,
    affiliateCommissionId: commission.id,
    entryType: payload.eventType,
    providerName: payload.provider,
    eventIdentity: payload.eventId,
    disputeCaseId: payload.disputeCaseId,
    occurredAt: new Date(payload.occurredAt ?? new Date().toISOString()),
  });
}

async function processPaymentWebhookOnce(payload: PaymentWebhookPayloadInput, event?: WebhookEvent) {
  const db = getDb();
  const { vendor, existingTransaction } = await resolveWebhookScope(payload);

  const occurredAt = new Date(payload.occurredAt ?? new Date().toISOString());
  if (isDisputeEvent(payload.eventType) && !payload.disputeCaseId) {
    throw new Error("synthetic dispute webhook 缺少 disputeCaseId。");
  }
  const {
    transaction,
    commission,
    refundCommission,
    disputeEntry,
  // The ordered re-read and writes must remain in one serializable closure.
  // eslint-disable-next-line complexity -- splitting this scope weakens its transaction invariant.
  } = await db.$transaction(async (tx) => {
    // Re-read the logical order inside the serializable transaction. This keeps
    // amount, refund and state checks bound to the row version being updated.
    const currentTransaction = await tx.paymentTransaction.findFirst({
      where: {
        vendorId: vendor.id,
        providerName: payload.provider,
        orderNumber: payload.orderNumber,
      },
      include: { refunds: true },
    });
    const invariant = validatePaymentWebhookInvariants({
      eventId: payload.eventId,
      eventType: payload.eventType,
      grossAmountCents: payload.grossAmountCents > 0 ? payload.grossAmountCents : undefined,
      refundAmountCents: payload.refundAmountCents,
      currency: payload.currency,
    }, currentTransaction);
    if (!currentTransaction && payload.eventType === "paid" && payload.grossAmountCents <= 0) {
      throw new Error("付款 webhook 缺少有效訂單金額。");
    }

    const hasRefundedOrder = Boolean(currentTransaction && (
      currentTransaction.refundedAmountCents > 0
      || currentTransaction.refunds.length > 0
      || ["refunded", "partially_refunded"].includes(currentTransaction.status)
    ));
    const grossAmountCents = currentTransaction?.grossAmountCents || payload.grossAmountCents;
    const gatewayFeeCents = payload.eventType === "paid"
      ? payload.gatewayFeeCents || currentTransaction?.gatewayFeeCents || 0
      : currentTransaction?.gatewayFeeCents || 0;
    const platformFeeCents = payload.eventType === "paid"
      ? payload.platformFeeCents || currentTransaction?.platformFeeCents || 0
      : currentTransaction?.platformFeeCents || 0;
    const netAmountCents = payload.eventType === "paid"
      ? payload.netAmountCents ?? currentTransaction?.netAmountCents ?? Math.max(0, grossAmountCents - gatewayFeeCents - platformFeeCents)
      : currentTransaction?.netAmountCents ?? Math.max(0, grossAmountCents - gatewayFeeCents - platformFeeCents);
    const currency = currentTransaction?.currency ?? payload.currency ?? "TWD";
    const existingMetadata = metadataObject(currentTransaction?.metadata);
    const checkoutReferralCode = referralCodeFromMetadata(existingMetadata);
    const checkoutAffiliateClickId = affiliateClickIdFromMetadata(existingMetadata);
    const payloadMetadata = { ...metadataObject(payload.metadata) };
    delete payloadMetadata.referralCode;
    delete payloadMetadata.affiliateClickId;
    const formSubmissionId = payload.eventType === "paid"
      ? formSubmissionIdFromMetadata(payloadMetadata) ?? formSubmissionIdFromMetadata(existingMetadata)
      : formSubmissionIdFromMetadata(existingMetadata);
    const transactionMetadata = {
      ...existingMetadata,
      ...payloadMetadata,
      ...(checkoutReferralCode ? { referralCode: checkoutReferralCode } : {}),
      ...(formSubmissionId ? { formSubmissionId } : {}),
    } as Prisma.InputJsonObject;
    const nextStatus = resolvePaymentStatus(currentTransaction?.status ?? null, payload.eventType);
    const ignoredIncomingState = nextStatus !== payload.eventType;
    const noOpTransactionEvent = ignoredIncomingState || invariant.duplicateRefundEvent;
    const updatesOccurredAt = !currentTransaction
      || (currentTransaction.status !== nextStatus && !isRefundEvent(payload.eventType));

    const savedTransaction = currentTransaction
      ? await tx.paymentTransaction.update({
          where: { id: currentTransaction.id },
          data: noOpTransactionEvent ? { status: nextStatus } : {
            providerName: payload.provider,
            providerTradeNo: payload.providerTradeNo ?? currentTransaction.providerTradeNo,
            paymentMode: payload.paymentMode,
            grossAmountCents,
            gatewayFeeCents,
            platformFeeCents,
            netAmountCents,
            currency,
            status: nextStatus,
            ...(updatesOccurredAt ? { occurredAt } : {}),
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
            currency,
            status: nextStatus,
            occurredAt,
            metadata: transactionMetadata,
          },
        });

    // Product identity is trusted only from the server-created checkout
    // transaction. Provider metadata must never choose another tenant's stock.
    if (isPaymentLifecycleEvent(payload.eventType) && !ignoredIncomingState && !invariant.duplicateRefundEvent) {
      await applyPaymentInventoryTransition(tx, {
        transaction: savedTransaction,
        eventType: payload.eventType,
        trustedCheckoutMetadata: existingMetadata,
        now: occurredAt,
      });
    }

    let refundCommission = null;
    if (["refunded", "partially_refunded"].includes(payload.eventType) && payload.refundAmountCents > 0) {
      if (!invariant.duplicateRefundEvent) {
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
            refundedAmountCents: savedTransaction.refundedAmountCents + payload.refundAmountCents,
            refundReason: payload.refundReason,
            refundedAt: occurredAt,
          },
        });
        refundCommission = await applyRefundToCommission(tx, payload, vendor.id);
      }
    }

    const disputeEntry = await applyDisputeToCommission(tx, payload, vendor.id);

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

    // Keep commission creation in the same serializable transaction as the
    // logical payment row so concurrent callbacks cannot both commit it.
    const commission = await upsertAffiliateCommission(
      tx,
      payload,
      vendor.id,
      savedTransaction.id,
      savedTransaction.grossAmountCents,
      occurredAt,
      hasRefundedOrder,
      currentTransaction ? checkoutReferralCode : payload.referralCode,
    );

    // Conversion attribution can only be established by checkout metadata. The
    // provider payload is intentionally not a source of click IDs or referral codes.
    if (
      payload.eventType === "paid"
      && currentTransaction
      && !hasRefundedOrder
      && checkoutAffiliateClickId
      && checkoutReferralCode
    ) {
      await tx.affiliateClick.updateMany({
        where: {
          id: checkoutAffiliateClickId,
          vendorId: vendor.id,
          referralCode: checkoutReferralCode,
          convertedAt: null,
        },
        data: { convertedAt: occurredAt },
      });
    }

    if (event) {
      const processedEvent = await tx.webhookEvent.updateMany({
        where: {
          id: event.id,
          status: event.status,
          retryCount: event.retryCount,
        },
        data: {
          vendorId: vendor.id,
          status: "processed",
          processedAt: new Date(),
          errorMessage: null,
        },
      });
      if (processedEvent.count !== 1) {
        throw new Error("付款 webhook 事件處理權已變更。");
      }
    }

    return {
      transaction: savedTransaction,
      commission,
      refundCommission,
      disputeEntry,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await writeAuditLog({
    vendorId: vendor.id,
    actorLabel: `webhook:${payload.provider}`,
    action: `payment_webhook_${payload.eventType}`,
    targetType: "WebhookEvent",
    targetId: event?.id ?? payload.eventId,
    before: auditSnapshot(existingTransaction),
    after: auditSnapshot({ transaction, commission, refundCommission, disputeEntry, eventId: payload.eventId }),
  });

  return { vendor, transaction, commission, refundCommission, disputeEntry };
}

function isRetryableCommissionWriteConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === "P2034" || error.code === "P2002");
}

/**
 * A serializable abort is expected when two callbacks race for the same
 * business identity. Retry a bounded number of times; the second read/upsert
 * then returns the existing commission instead of creating another row.
 */
export async function processPaymentWebhook(payload: PaymentWebhookPayloadInput, event?: WebhookEvent) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await processPaymentWebhookOnce(payload, event);
    } catch (error) {
      lastError = error;
      if (!isRetryableCommissionWriteConflict(error) || attempt === 1) break;
    }
  }
  throw lastError;
}
