import { Prisma, type PaymentTransaction, type WebhookEvent } from "@prisma/client";
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
} from "@/lib/affiliate-commission-accounting";
import {
  appendCourseCommissionLedgerEntry,
  appendCourseDisputeLedgerEntry,
} from "@/lib/course-commission-accounting";
import { calculateCourseAllocationPlan } from "@/lib/course-commission";
import { coursePolicySnapshotFromMetadata } from "@/lib/course-policy-snapshot";
import { mvpCommissionPolicy } from "@/lib/mvp-commission-policy";
import {
  applyPaymentRefundAccounting,
  calculateNetReferenceAmountCents,
} from "@/lib/payment-refund-accounting";
import { applyPlatformRefundProjection } from "@/lib/platform-refund-projection";
import {
  accruePlatformReferralCommission,
  applyPlatformReferralDispute,
  applyPlatformReferralRefund,
} from "@/lib/platform-referral-commission";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { reconcileCommerceOrderPaymentTransition } from "@/lib/commerce-orders";
import { ensureCommerceOrderPaidDelivery } from "@/lib/commerce-order-email";
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

type TeamConversionAttributionDb = Pick<
  Prisma.TransactionClient,
  "teamLeadAttribution" | "teamClickAttribution" | "teamConversionAttribution"
>;

export async function reconcileTeamConversionAttribution(
  db: TeamConversionAttributionDb,
  input: {
    vendorId: string;
    paymentTransactionId: string;
    formSubmissionId: string | null;
    affiliateClickId: string | null;
  },
) {
  const select = {
    id: true,
    teamId: true,
    pageId: true,
    leaderMembershipId: true,
    promoterMembershipId: true,
    contentOwnerMembershipId: true,
    seminarOwnerMembershipId: true,
    source: true,
    referralCode: true,
  } as const;
  const leadAttribution = input.formSubmissionId
    ? await db.teamLeadAttribution.findFirst({
        where: { vendorId: input.vendorId, formSubmissionId: input.formSubmissionId },
        select,
      })
    : null;
  const clickAttribution = !leadAttribution && input.affiliateClickId
    ? await db.teamClickAttribution.findFirst({
        where: { vendorId: input.vendorId, affiliateClickId: input.affiliateClickId },
        select,
      })
    : null;
  const sourceAttribution = leadAttribution ?? clickAttribution;
  if (!sourceAttribution) return null;

  const attributionSnapshot = {
    teamId: sourceAttribution.teamId,
    leadAttributionId: leadAttribution?.id ?? null,
    pageId: sourceAttribution.pageId,
    leaderMembershipId: sourceAttribution.leaderMembershipId,
    promoterMembershipId: sourceAttribution.promoterMembershipId,
    contentOwnerMembershipId: sourceAttribution.contentOwnerMembershipId,
    seminarOwnerMembershipId: sourceAttribution.seminarOwnerMembershipId,
    source: sourceAttribution.source,
    referralCode: sourceAttribution.referralCode,
  };
  const existingAttribution = await db.teamConversionAttribution.findUnique({
    where: {
      vendorId_paymentTransactionId: {
        vendorId: input.vendorId,
        paymentTransactionId: input.paymentTransactionId,
      },
    },
  });
  if (existingAttribution) {
    for (const [field, value] of Object.entries(attributionSnapshot)) {
      if (existingAttribution[field as keyof typeof attributionSnapshot] !== value) {
        throw new Error(`相同付款交易的 team conversion attribution 不可變身分不一致：${field}`);
      }
    }
    return existingAttribution;
  }

  return db.teamConversionAttribution.create({
    data: {
      vendorId: input.vendorId,
      paymentTransactionId: input.paymentTransactionId,
      ...attributionSnapshot,
    },
  });
}

function platformSubscriptionIdFromMetadata(metadata: unknown) {
  const subscriptionId = metadataObject(metadata).platformSubscriptionId;
  return typeof subscriptionId === "string" && subscriptionId.trim().length > 0 ? subscriptionId.trim() : null;
}

function billingPurposeFromMetadata(metadata: unknown) {
  const purpose = metadataObject(metadata).billingPurpose;
  return typeof purpose === "string" && purpose.trim().length > 0 ? purpose.trim() : null;
}

function invoiceIdFromMetadata(metadata: unknown) {
  const invoiceId = metadataObject(metadata).invoiceId;
  return typeof invoiceId === "string" && invoiceId.trim().length > 0 ? invoiceId.trim() : null;
}

function billingPlanIdFromMetadata(metadata: unknown) {
  const planId = metadataObject(metadata).billingPlanId;
  return typeof planId === "string" && planId.trim().length > 0 ? planId.trim() : null;
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
  netReferenceAmountCents: number,
  occurredAt: Date,
  hasRefundedOrder: boolean,
  referralCode: string | null | undefined,
) {
  if (!mvpCommissionPolicy.allowsNewAccrual("affiliate")) return null;
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
  // A zero-rate partner remains a valid attribution target, but it must not
  // create a zero-value liability because accrual ledger entries are positive.
  if (calculatedCommissionCents === 0) return null;
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
    commissionBaseAmountCents: grossAmountCents,
    netReferenceAmountCents,
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

type CourseCommissionDb = Pick<Prisma.TransactionClient, "courseCommissionAllocation" | "courseCommissionLedgerEntry" | "product" | "teamMembership" | "teamConversionAttribution">;

async function upsertCourseCommissionAllocations(
  db: CourseCommissionDb,
  vendorId: string,
  transactionId: string,
  grossAmountCents: number,
  currency: string,
  providerName: string,
  occurredAt: Date,
  trustedCheckoutMetadata: unknown,
  hasExistingCheckoutTransaction: boolean,
) {
  if (!mvpCommissionPolicy.allowsNewAccrual("team_course")) return [];
  // A course allocation is only eligible when the product identity came from
  // the server-created checkout row. Provider metadata alone cannot select a
  // tenant or a recipient.
  if (!hasExistingCheckoutTransaction) return [];
  const policySnapshot = coursePolicySnapshotFromMetadata(trustedCheckoutMetadata);
  if (!policySnapshot) return [];

  const product = await db.product.findFirst({
    where: { vendorId, id: policySnapshot.productId },
    select: { id: true },
  });
  if (!product) throw new Error("課程付款 snapshot 對應的商品不存在於同一商家。 ");

  // A retry after a product policy edit must return the original snapshot,
  // never re-evaluate the current product split.
  const existing = await db.courseCommissionAllocation.findMany({
    where: { vendorId, paymentTransactionId: transactionId },
    orderBy: { recipientRole: "asc" },
  });
  if (existing.length > 0) {
    if (existing.some((allocation) => allocation.productId !== product.id
      || allocation.grossAmountCents !== grossAmountCents
      || allocation.currency !== currency)) {
      throw new Error("課程付款分潤 snapshot 的付款／商品身分不一致。 ");
    }
    return existing;
  }
  const contentOwner = await db.teamMembership.findFirst({
    where: {
      vendorId,
      id: policySnapshot.contentOwnerMembershipId,
    },
    select: { id: true },
  });
  if (!contentOwner) throw new Error("課程內容所有人 F 不在付款 snapshot 的同一商家。 ");

  const attribution = await db.teamConversionAttribution.findUnique({
    where: { vendorId_paymentTransactionId: { vendorId, paymentTransactionId: transactionId } },
    select: {
      id: true,
      teamId: true,
      promoterMembershipId: true,
      contentOwnerMembershipId: true,
    },
  });
  if (attribution && attribution.contentOwnerMembershipId !== contentOwner.id) {
    throw new Error("課程付款的 F 歸因與商品 policy 不一致，拒絕建立分潤 snapshot。 ");
  }

  let promoterMembershipId: string | null = null;
  if (attribution && attribution.promoterMembershipId !== contentOwner.id) {
    const promoter = await db.teamMembership.findFirst({
      where: {
        vendorId,
        id: attribution.promoterMembershipId,
        teamId: attribution.teamId,
        status: "ACTIVE",
        leftAt: null,
      },
      select: { id: true },
    });
    if (!promoter) throw new Error("課程付款的實際 G 不在同一商家／團隊或已停用。 ");
    promoterMembershipId = promoter.id;
  }

  const plan = calculateCourseAllocationPlan({
    grossAmountCents,
    policyVersion: policySnapshot.policyVersion,
    contentOwnerMembershipId: contentOwner.id,
    promoterMembershipId,
    promoterShareBps: policySnapshot.promoterShareBps,
  });
  const allocationIdentity = {
    productId: product.id,
    teamConversionAttributionId: attribution?.id ?? null,
    grossAmountCents,
    currency,
    policyVersion: plan.policyVersion,
  };
  const created = [];
  for (const item of plan.allocations) {
    const allocation = await db.courseCommissionAllocation.create({
      data: {
        vendorId,
        paymentTransactionId: transactionId,
        productId: allocationIdentity.productId,
        teamConversionAttributionId: allocationIdentity.teamConversionAttributionId,
        recipientMembershipId: item.recipientMembershipId,
        recipientRole: item.recipientRole,
        policyVersion: allocationIdentity.policyVersion,
        grossAmountCents: allocationIdentity.grossAmountCents,
        shareBps: item.shareBps,
        amountCents: item.amountCents,
        currency: allocationIdentity.currency,
        deduplicationKey: `course-allocation:v1:${transactionId}:${item.recipientRole}`,
      },
    });
    await appendCourseCommissionLedgerEntry(db, {
      vendorId,
      courseCommissionAllocationId: allocation.id,
      entryType: "accrual",
      providerName,
      eventIdentity: `paid:${transactionId}`,
      amountCents: allocation.amountCents,
      occurredAt,
    });
    created.push(allocation);
  }
  return created;
}

async function applyDisputeToCommission(
  db: Pick<Prisma.TransactionClient, "affiliateCommission" | "affiliateCommissionLedgerEntry">,
  payload: PaymentWebhookPayloadInput,
  vendorId: string,
  transactionId: string,
) {
  if (!isDisputeEvent(payload.eventType)) return null;
  if (!payload.disputeCaseId) throw new Error("synthetic dispute webhook 缺少 disputeCaseId。");
  const commission = await db.affiliateCommission.findFirst({
    // A vendor may legitimately receive the same order number from multiple
    // providers. The server-owned transaction identity is the only safe
    // boundary for applying a dispute to the matching commission.
    where: { vendorId, sourceType: "webhook", sourceId: transactionId },
  });
  if (!commission) return null;
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

async function applyDisputeToCourseAllocations(
  db: CourseCommissionDb,
  payload: PaymentWebhookPayloadInput,
  vendorId: string,
  transactionId: string,
) {
  if (!isDisputeEvent(payload.eventType)) return [];
  if (!payload.disputeCaseId) throw new Error("synthetic dispute webhook 缺少 disputeCaseId。 ");
  const allocations = await db.courseCommissionAllocation.findMany({
    where: { vendorId, paymentTransactionId: transactionId },
    orderBy: { recipientRole: "asc" },
  });
  const entries = [];
  for (const allocation of allocations) {
    entries.push(await appendCourseDisputeLedgerEntry(db, {
      vendorId,
      courseCommissionAllocationId: allocation.id,
      entryType: payload.eventType,
      providerName: payload.provider,
      eventIdentity: payload.eventId,
      disputeCaseId: payload.disputeCaseId,
      occurredAt: new Date(payload.occurredAt ?? new Date().toISOString()),
    }));
  }
  return entries;
}

async function accruePlatformReferralFromTrustedTransaction(
  db: Parameters<typeof accruePlatformReferralCommission>[0],
  input: {
    vendorId: string;
    subscriptionId: string | null;
    paymentTransactionId: string;
    providerName: string;
    eventIdentity: string;
    grossAmountCents: number;
    currency: string;
    occurredAt: Date;
    hasRefundedOrder: boolean;
    currentTransactionExists: boolean;
    subscriptionStatus: string | null;
  },
) {
  if (!mvpCommissionPolicy.allowsNewAccrual("platform_referral")) return null;
  // Legacy server-created platform referral fixtures may predate the explicit
  // billing-purpose metadata. Keep those trusted subscription snapshots
  // compatible; an explicitly reconciled non-active subscription is never
  // eligible for a new platform referral commission.
  if (!input.currentTransactionExists || !input.subscriptionId || (input.subscriptionStatus !== null && input.subscriptionStatus !== "active")) return null;
  return accruePlatformReferralCommission(db, {
    vendorId: input.vendorId,
    subscriptionId: input.subscriptionId,
    paymentTransactionId: input.paymentTransactionId,
    providerName: input.providerName,
    eventIdentity: input.eventIdentity,
    grossAmountCents: input.grossAmountCents,
    currency: input.currency,
    occurredAt: input.occurredAt,
    hasRefundedOrder: input.hasRefundedOrder,
  });
}

async function reconcilePlatformReferralRefund(
  db: Parameters<typeof applyPlatformReferralRefund>[0],
  input: {
    eventType: PaymentWebhookPayloadInput["eventType"];
    paymentTransactionId: string;
    providerName: string;
    eventIdentity: string;
    refundAmountCents: number;
    occurredAt: Date;
  },
) {
  if (!isRefundEvent(input.eventType) || input.refundAmountCents <= 0) return null;
  return applyPlatformReferralRefund(db, {
    paymentTransactionId: input.paymentTransactionId,
    providerName: input.providerName,
    eventIdentity: input.eventIdentity,
    refundAmountCents: input.refundAmountCents,
    isFullRefund: input.eventType === "refunded",
    occurredAt: input.occurredAt,
  });
}

async function reconcilePlatformReferralDispute(
  db: Parameters<typeof applyPlatformReferralDispute>[0],
  input: {
    eventType: PaymentWebhookPayloadInput["eventType"];
    paymentTransactionId: string;
    providerName: string;
    eventIdentity: string;
    disputeCaseId?: string;
    occurredAt: Date;
  },
) {
  if (!isDisputeEvent(input.eventType)) return null;
  if (!input.disputeCaseId) throw new Error("平台推薦 dispute webhook 缺少 disputeCaseId。 ");
  return applyPlatformReferralDispute(db, {
    paymentTransactionId: input.paymentTransactionId,
    entryType: input.eventType,
    providerName: input.providerName,
    eventIdentity: input.eventIdentity,
    disputeCaseId: input.disputeCaseId,
    occurredAt: input.occurredAt,
  });
}

/**
 * Activates only a subscription referenced by the server-created pending
 * transaction. Provider payload metadata is never allowed to select a plan.
 */
async function reconcilePlatformSubscription(
  db: Prisma.TransactionClient,
  input: {
    vendorId: string;
    eventType: PaymentWebhookPayloadInput["eventType"];
    transaction: PaymentTransaction;
    trustedMetadata: unknown;
    currentTransactionExists: boolean;
    occurredAt: Date;
  },
) {
  if (!input.currentTransactionExists) return null;
  if (input.transaction.paymentMode !== "platform") return null;
  if (billingPurposeFromMetadata(input.trustedMetadata) !== "platform_subscription_checkout") return null;

  const subscriptionId = platformSubscriptionIdFromMetadata(input.trustedMetadata);
  if (!subscriptionId) return null;

  const expectedPlanId = billingPlanIdFromMetadata(input.trustedMetadata);
  const subscription = await db.vendorSubscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true },
  });
  if (!subscription || subscription.vendorId !== input.vendorId) {
    throw new Error("平台方案付款找不到可信的訂閱交易。 ");
  }
  if (expectedPlanId && subscription.planId !== expectedPlanId) {
    throw new Error("平台方案付款的方案 snapshot 不一致。 ");
  }

  if (input.eventType === "paid") {
    // A retry of the same paid callback is a no-op after the first activation.
    if (subscription.status === "active") return subscription;
    if (subscription.status === "payment_superseded") return subscription;
    if (subscription.status !== "pending_payment") {
      throw new Error("平台方案付款狀態不可啟用。 ");
    }

    const newerPendingSubscription = await db.vendorSubscription.findFirst({
      where: {
        vendorId: input.vendorId,
        status: "pending_payment",
        createdAt: { gt: subscription.createdAt },
      },
      select: { id: true },
    });
    if (newerPendingSubscription) {
      return db.vendorSubscription.update({
        where: { id: subscription.id },
        data: { status: "payment_superseded", endedAt: input.occurredAt },
      });
    }

    await db.vendorSubscription.updateMany({
      where: { vendorId: input.vendorId, status: "active", id: { not: subscription.id } },
      data: { status: "ended", endedAt: input.occurredAt },
    });
    const activated = await db.vendorSubscription.update({
      where: { id: subscription.id },
      data: { status: "active", startedAt: input.occurredAt },
    });
    await db.vendorUsageLimit.upsert({
      where: { vendorId: input.vendorId },
      create: {
        vendorId: input.vendorId,
        billingPlanId: subscription.planId,
        streamMinutesLimit: subscription.plan.includedStreamMinutes,
        storageMinutesLimit: subscription.plan.includedStorageMinutes,
        creditsLimit: subscription.plan.includedCredits,
        resetAt: new Date(Date.UTC(input.occurredAt.getUTCFullYear(), input.occurredAt.getUTCMonth() + 1, 1)),
      },
      update: {
        billingPlanId: subscription.planId,
        streamMinutesLimit: subscription.plan.includedStreamMinutes,
        storageMinutesLimit: subscription.plan.includedStorageMinutes,
        creditsLimit: subscription.plan.includedCredits,
      },
    });
    return activated;
  }

  if (input.eventType === "failed" && subscription.status === "pending_payment") {
    // A failed provider callback is not payment proof. Release only this
    // unconverted snapshot so the same server-owned referral click can be
    // retried; paid/refunded subscriptions keep their attribution history.
    await db.platformReferralAttribution.deleteMany({
      where: { subscriptionId: subscription.id },
    });
    return db.vendorSubscription.update({
      where: { id: subscription.id },
      data: { status: "payment_failed" },
    });
  }

  return subscription;
}

async function applyPaymentRefundsInWebhook(
  db: Prisma.TransactionClient,
  input: {
    payload: PaymentWebhookPayloadInput;
    vendorId: string;
    transaction: PaymentTransaction;
    duplicateRefundEvent: boolean;
    occurredAt: Date;
  },
) {
  if (!isRefundEvent(input.payload.eventType) || input.payload.refundAmountCents <= 0) {
    return {
      refundCommission: null,
      platformReferralRefund: null,
      courseRefundAllocations: [],
      commerceOrderRefund: null,
      platformRefundProjection: { subscription: null, invoice: null },
    };
  }
  if (input.duplicateRefundEvent) {
    // A duplicate callback never creates another refund record or ledger
    // reversal. It may still repair the idempotent SaaS quota/invoice state of
    // a verified historical terminal transaction.
    const platformRefundProjection = await applyPlatformRefundProjection(
      db,
      input.transaction,
      input.occurredAt,
    );
    return {
      refundCommission: null,
      platformReferralRefund: null,
      courseRefundAllocations: [],
      commerceOrderRefund: null,
      platformRefundProjection,
    };
  }

  const refundRecord = await db.refundRecord.create({
    data: {
      vendorId: input.vendorId,
      paymentTransactionId: input.transaction.id,
      providerEventId: input.payload.eventId,
      monthKey: monthKeyFromDate(input.occurredAt),
      refundAmountCents: input.payload.refundAmountCents,
      gatewayFeeRefundCents: input.payload.gatewayFeeRefundCents,
      platformFeeRefundCents: input.payload.platformFeeRefundCents,
      reason: input.payload.refundReason,
    },
  });
  const updatedTransaction = await db.paymentTransaction.update({
    where: { id: input.transaction.id },
    data: {
      refundedAmountCents: input.transaction.refundedAmountCents + input.payload.refundAmountCents,
      refundReason: input.payload.refundReason,
      refundedAt: input.occurredAt,
    },
  });
  const platformRefundProjection = await applyPlatformRefundProjection(
    db,
    updatedTransaction,
    input.occurredAt,
  );
  const refundedFeeTotals = await db.refundRecord.aggregate({
    where: { paymentTransactionId: input.transaction.id, status: "processed" },
    _sum: { gatewayFeeRefundCents: true, platformFeeRefundCents: true },
  });
  const refundAccounting = await applyPaymentRefundAccounting(db, {
    vendorId: input.vendorId,
    transactionId: input.transaction.id,
    orderNumber: input.payload.orderNumber,
    providerName: input.payload.provider,
    eventIdentity: input.payload.eventId,
    refundRecordId: refundRecord.id,
    refundAmountCents: input.payload.refundAmountCents,
    netReferenceAmountCents: calculateNetReferenceAmountCents({
      netAmountCents: input.transaction.netAmountCents,
      refundedAmountCents: input.transaction.refundedAmountCents + input.payload.refundAmountCents,
      gatewayFeeRefundCents: refundedFeeTotals._sum.gatewayFeeRefundCents ?? 0,
      platformFeeRefundCents: refundedFeeTotals._sum.platformFeeRefundCents ?? 0,
    }),
    isFullRefund: input.payload.eventType === "refunded",
    transactionOccurredAt: input.transaction.occurredAt,
    occurredAt: new Date(input.payload.occurredAt ?? new Date().toISOString()),
  });

  return {
    refundCommission: refundAccounting.affiliateCommission,
    courseRefundAllocations: refundAccounting.courseRefundAllocations,
    commerceOrderRefund: refundAccounting.commerceOrderRefund,
    platformRefundProjection,
    platformReferralRefund: await reconcilePlatformReferralRefund(db, {
      eventType: input.payload.eventType,
      paymentTransactionId: input.transaction.id,
      providerName: input.payload.provider,
      eventIdentity: input.payload.eventId,
      refundAmountCents: input.payload.refundAmountCents,
      occurredAt: input.occurredAt,
    }),
  };
}

/**
 * Reconciles a server-created manual invoice checkout. The invoice identity
 * comes only from the stored checkout metadata; provider callback metadata is
 * never allowed to select a tenant or invoice.
 */
async function reconcileInvoicePayment(
  db: Prisma.TransactionClient,
  input: {
    vendorId: string;
    eventType: PaymentWebhookPayloadInput["eventType"];
    transaction: PaymentTransaction;
    trustedMetadata: unknown;
    currentTransactionExists: boolean;
    occurredAt: Date;
  },
) {
  if (!input.currentTransactionExists) return null;
  if (input.transaction.paymentMode !== "platform") return null;
  if (billingPurposeFromMetadata(input.trustedMetadata) !== "invoice_payment") return null;

  const invoiceId = invoiceIdFromMetadata(input.trustedMetadata);
  if (!invoiceId) throw new Error("帳單付款交易缺少可信的 invoiceId。 ");

  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, vendorId: input.vendorId },
  });
  if (!invoice) throw new Error("帳單付款交易找不到可信的商家帳單。 ");
  if (input.transaction.grossAmountCents !== invoice.totalCents) {
    throw new Error("帳單付款金額與帳單總額不一致。 ");
  }

  if (input.eventType === "failed") return invoice;

  if (input.eventType === "paid") {
    if (["paid", "partially_refunded", "refunded"].includes(invoice.status)) return invoice;
    if (!["issued", "overdue"].includes(invoice.status)) {
      throw new Error("帳單付款的帳單狀態不可標記為已付款。 ");
    }

    const updated = await db.invoice.updateMany({
      where: {
        id: invoice.id,
        vendorId: input.vendorId,
        status: { in: ["issued", "overdue"] },
        totalCents: input.transaction.grossAmountCents,
      },
      data: { status: "paid", paidAt: input.occurredAt },
    });
    if (updated.count === 1) return db.invoice.findUnique({ where: { id: invoice.id } });

    const current = await db.invoice.findFirst({ where: { id: invoice.id, vendorId: input.vendorId } });
    if (current && ["paid", "partially_refunded", "refunded"].includes(current.status)) return current;
    throw new Error("帳單付款更新發生狀態衝突。 ");
  }

  return invoice;
}

async function reconcileCommercePaymentLifecycle(
  db: Prisma.TransactionClient,
  input: {
    vendorId: string;
    transactionId: string;
    eventType: PaymentWebhookPayloadInput["eventType"];
    eventIdentity: string;
    occurredAt: Date;
  },
) {
  if (input.eventType !== "paid" && input.eventType !== "failed") return null;
  return reconcileCommerceOrderPaymentTransition(db, {
    vendorId: input.vendorId,
    paymentTransactionId: input.transactionId,
    eventIdentity: input.eventIdentity,
    transition: input.eventType,
    occurredAt: input.occurredAt,
  });
}

/** Only generic billing sessions release their reusable transient checkout key. */
function shouldClearTransientCheckoutKey(eventType: PaymentWebhookPayloadInput["eventType"], hasCanonicalOrder: boolean) {
  return isPaymentLifecycleEvent(eventType) && !hasCanonicalOrder;
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
    platformReferralCommission,
    platformReferralRefund,
    platformReferralDispute,
    disputeEntry,
    courseAllocations,
    courseRefundAllocations,
    courseDisputeEntries,
    platformSubscription,
    invoicePayment,
    commerceOrderRefund,
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
      include: { refunds: true, primaryCommerceOrder: { select: { id: true } } },
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
    // Platform referral commission can only use metadata from a server-created
    // pending transaction. A provider payload cannot choose a subscription.
    const platformSubscriptionId = platformSubscriptionIdFromMetadata(existingMetadata);
    // Provider callback metadata is untrusted and may contain buyer PII. The
    // durable transaction snapshot is owned exclusively by the server-created
    // checkout; callbacks may advance state, but may not extend or replace it.
    const formSubmissionId = formSubmissionIdFromMetadata(existingMetadata);
    const transactionMetadata = {
      ...existingMetadata,
      ...(checkoutReferralCode ? { referralCode: checkoutReferralCode } : {}),
      ...(formSubmissionId ? { formSubmissionId } : {}),
    } as Prisma.InputJsonObject;
    const nextStatus = resolvePaymentStatus(currentTransaction?.status ?? null, payload.eventType);
    const ignoredIncomingState = nextStatus !== payload.eventType;
    const noOpTransactionEvent = ignoredIncomingState || invariant.duplicateRefundEvent;
    const clearsTransientCheckoutKey = shouldClearTransientCheckoutKey(payload.eventType, Boolean(currentTransaction?.primaryCommerceOrder));
    const updatesOccurredAt = !currentTransaction
      || (currentTransaction.status !== nextStatus && !isRefundEvent(payload.eventType));

    const savedTransaction = currentTransaction
      ? await tx.paymentTransaction.update({
          where: { id: currentTransaction.id },
          data: noOpTransactionEvent ? {
            status: nextStatus,
            ...(clearsTransientCheckoutKey ? { checkoutIdempotencyKey: null } : {}),
          } : {
            providerName: payload.provider,
            providerTradeNo: payload.providerTradeNo ?? currentTransaction.providerTradeNo,
            paymentMode: payload.paymentMode,
            grossAmountCents,
            gatewayFeeCents,
            platformFeeCents,
            netAmountCents,
            currency,
            status: nextStatus,
            ...(clearsTransientCheckoutKey ? { checkoutIdempotencyKey: null } : {}),
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

    const reconciledPlatformSubscription = await reconcilePlatformSubscription(tx, {
      vendorId: vendor.id,
      eventType: payload.eventType,
      transaction: savedTransaction,
      trustedMetadata: existingMetadata,
      currentTransactionExists: Boolean(currentTransaction),
      occurredAt,
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
      await reconcileCommercePaymentLifecycle(tx, {
        vendorId: vendor.id, transactionId: savedTransaction.id,
        eventType: payload.eventType, eventIdentity: payload.eventId, occurredAt,
      });
      if (payload.eventType === "paid") {
        await ensureCommerceOrderPaidDelivery(tx, {
          vendorId: vendor.id,
          paymentTransactionId: savedTransaction.id,
          occurredAt,
        });
      }
    }

    const {
      refundCommission,
      platformReferralRefund,
      courseRefundAllocations,
      commerceOrderRefund,
      platformRefundProjection,
    } = await applyPaymentRefundsInWebhook(tx, {
      payload,
      vendorId: vendor.id,
      transaction: savedTransaction,
      duplicateRefundEvent: invariant.duplicateRefundEvent,
      occurredAt,
    });

    const reconciledInvoicePayment = await reconcileInvoicePayment(tx, {
      vendorId: vendor.id,
      eventType: payload.eventType,
      transaction: savedTransaction,
      trustedMetadata: existingMetadata,
      currentTransactionExists: Boolean(currentTransaction),
      occurredAt,
    });

    const platformSubscription = platformRefundProjection.subscription ?? reconciledPlatformSubscription;
    const invoicePayment = platformRefundProjection.invoice ?? reconciledInvoicePayment;

    const disputeEntry = await applyDisputeToCommission(tx, payload, vendor.id, savedTransaction.id);
    const courseDisputeEntries = await applyDisputeToCourseAllocations(tx, payload, vendor.id, savedTransaction.id);
    const platformReferralDispute = await reconcilePlatformReferralDispute(tx, {
      eventType: payload.eventType,
      paymentTransactionId: savedTransaction.id,
      providerName: payload.provider,
      eventIdentity: payload.eventId,
      disputeCaseId: payload.disputeCaseId,
      occurredAt,
    });
    if (isDisputeEvent(payload.eventType) && !disputeEntry && courseDisputeEntries.length === 0 && !platformReferralDispute) {
      throw new Error("dispute webhook 找不到對應的佣金或課程分潤 snapshot。");
    }

    if (payload.eventType === "paid") {
      await reconcileTeamConversionAttribution(tx, {
        vendorId: vendor.id,
        paymentTransactionId: savedTransaction.id,
        formSubmissionId,
        affiliateClickId: checkoutAffiliateClickId,
      });
    }

    const courseAllocations = payload.eventType === "paid"
      ? await upsertCourseCommissionAllocations(
          tx,
          vendor.id,
          savedTransaction.id,
          savedTransaction.grossAmountCents,
          savedTransaction.currency,
          payload.provider,
          occurredAt,
          existingMetadata,
          Boolean(currentTransaction),
        )
      : [];

    // Keep commission creation in the same serializable transaction as the
    // logical payment row so concurrent callbacks cannot both commit it.
    const commission = await upsertAffiliateCommission(
      tx,
      payload,
      vendor.id,
      savedTransaction.id,
      savedTransaction.grossAmountCents,
      savedTransaction.netAmountCents,
      occurredAt,
      hasRefundedOrder,
      currentTransaction ? checkoutReferralCode : payload.referralCode,
    );
    const platformReferralCommission = payload.eventType === "paid"
      ? await accruePlatformReferralFromTrustedTransaction(tx, {
          vendorId: vendor.id,
          subscriptionId: platformSubscriptionId,
          paymentTransactionId: savedTransaction.id,
          providerName: payload.provider,
          eventIdentity: payload.eventId,
          grossAmountCents: savedTransaction.grossAmountCents,
          currency: savedTransaction.currency,
          occurredAt,
          hasRefundedOrder,
          currentTransactionExists: Boolean(currentTransaction),
          subscriptionStatus: platformSubscription?.status ?? null,
        })
      : null;

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
      platformReferralCommission,
      platformReferralRefund,
      platformReferralDispute,
      platformSubscription,
      disputeEntry,
      courseAllocations,
      courseRefundAllocations,
      courseDisputeEntries,
      invoicePayment,
      commerceOrderRefund,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    // Payment, stock, accounting and delivery projection commit atomically.
    // Keep a bounded budget for the full set of database writes on remote DBs.
    timeout: 15_000,
  });

  await writeAuditLog({
    vendorId: vendor.id,
    actorLabel: `webhook:${payload.provider}`,
    action: `payment_webhook_${payload.eventType}`,
    targetType: "WebhookEvent",
    targetId: event?.id ?? payload.eventId,
    before: auditSnapshot(existingTransaction),
      after: auditSnapshot({ transaction, commission, refundCommission, platformReferralCommission, platformReferralRefund, platformReferralDispute, platformSubscription, invoicePayment, disputeEntry, courseAllocations, courseRefundAllocations, courseDisputeEntries, commerceOrderRefund, eventId: payload.eventId }),
  });

  return { vendor, transaction, commission, refundCommission, platformReferralCommission, platformReferralRefund, platformReferralDispute, platformSubscription, invoicePayment, disputeEntry, courseAllocations, courseRefundAllocations, courseDisputeEntries, commerceOrderRefund };
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
