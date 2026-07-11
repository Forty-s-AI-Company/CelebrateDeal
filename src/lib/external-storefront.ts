import { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { safeCommerceUrlOrNull } from "@/lib/safe-commerce-url";

const EXTERNAL_COMMISSION_SOURCE = "external_order_evidence";

export type ExternalStorefrontErrorCode =
  | "invalid_url"
  | "ownership_mismatch"
  | "product_not_external"
  | "no_safe_url"
  | "duplicate_order"
  | "invalid_transition"
  | "platform_admin_required";

export class ExternalStorefrontError extends Error {
  constructor(public readonly code: ExternalStorefrontErrorCode, message: string) {
    super(message);
    this.name = "ExternalStorefrontError";
  }
}

type AuditMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

function monthKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

function strictHttpsCommerceUrlOrNull(value: string | null | undefined) {
  const safeUrl = safeCommerceUrlOrNull(value);
  if (!safeUrl) return null;
  return new URL(safeUrl).protocol === "https:" ? safeUrl : null;
}

export function normalizeExternalStorefrontUrl(value: string | null | undefined) {
  const safeUrl = strictHttpsCommerceUrlOrNull(value);
  if (!safeUrl) {
    throw new ExternalStorefrontError("invalid_url", "External storefront URL must be an absolute HTTPS URL");
  }
  return safeUrl;
}

export function productCheckoutSettings(mode: string, externalUrl: string | null | undefined) {
  if (mode === "platform") {
    return { checkoutMode: "platform", checkoutUrl: null } as const;
  }
  if (mode !== "external") {
    throw new ExternalStorefrontError("product_not_external", "Unsupported checkout mode");
  }
  return {
    checkoutMode: "external",
    checkoutUrl: normalizeExternalStorefrontUrl(externalUrl),
  } as const;
}

export async function resolveExternalStorefrontRedirect(input: {
  vendorId: string;
  productId: string;
  affiliateId?: string | null;
}) {
  const db = getDb();
  const product = await db.product.findFirst({
    where: { id: input.productId, vendorId: input.vendorId, isActive: true },
    select: { id: true, checkoutMode: true, checkoutUrl: true },
  });

  if (!product) {
    throw new ExternalStorefrontError("ownership_mismatch", "External product is not available");
  }
  if (product.checkoutMode !== "external") {
    throw new ExternalStorefrontError("product_not_external", "Product does not use external checkout");
  }

  if (input.affiliateId) {
    const link = await db.affiliateProductLink.findFirst({
      where: {
        vendorId: input.vendorId,
        affiliateId: input.affiliateId,
        productId: input.productId,
        isActive: true,
        affiliate: { vendorId: input.vendorId, isActive: true },
        product: { vendorId: input.vendorId, checkoutMode: "external", isActive: true },
      },
      select: { id: true, url: true },
    });
    const affiliateUrl = strictHttpsCommerceUrlOrNull(link?.url);
    if (link && affiliateUrl) {
      return { redirectUrl: affiliateUrl, source: "affiliate" as const, affiliateProductLinkId: link.id };
    }
  }

  const productUrl = strictHttpsCommerceUrlOrNull(product.checkoutUrl);
  if (productUrl) {
    return { redirectUrl: productUrl, source: "product" as const, affiliateProductLinkId: null };
  }

  throw new ExternalStorefrontError("no_safe_url", "No safe external checkout URL is configured");
}

export async function upsertAffiliateProductLink(input: {
  vendorId: string;
  actorUserId: string;
  affiliateId: string;
  productId: string;
  url: string;
  isActive: boolean;
  auditMeta?: AuditMeta;
}) {
  const url = normalizeExternalStorefrontUrl(input.url);
  return getDb().$transaction(async (tx) => {
    const [ownerMembership, affiliate, product, existing] = await Promise.all([
      tx.vendorMember.findFirst({
        where: {
          vendorId: input.vendorId,
          userId: input.actorUserId,
          role: "owner",
          status: "active",
        },
        select: { id: true },
      }),
      tx.affiliate.findFirst({ where: { id: input.affiliateId, vendorId: input.vendorId }, select: { id: true } }),
      tx.product.findFirst({
        where: { id: input.productId, vendorId: input.vendorId, checkoutMode: "external" },
        select: { id: true },
      }),
      tx.affiliateProductLink.findUnique({
        where: { affiliateId_productId: { affiliateId: input.affiliateId, productId: input.productId } },
        select: { id: true, vendorId: true, url: true, isActive: true },
      }),
    ]);

    if (!ownerMembership || !affiliate || !product || existing && existing.vendorId !== input.vendorId) {
      throw new ExternalStorefrontError("ownership_mismatch", "Affiliate and product must belong to the current vendor");
    }

    const link = await tx.affiliateProductLink.upsert({
      where: { affiliateId_productId: { affiliateId: input.affiliateId, productId: input.productId } },
      create: {
        vendorId: input.vendorId,
        affiliateId: input.affiliateId,
        productId: input.productId,
        url,
        isActive: input.isActive,
      },
      update: { url, isActive: input.isActive },
    });

    await tx.auditLog.create({
      data: {
        vendorId: input.vendorId,
        actorId: input.actorUserId,
        actorLabel: "owner",
        action: existing ? "affiliate_product_link_updated" : "affiliate_product_link_created",
        targetType: "AffiliateProductLink",
        targetId: link.id,
        before: existing ? { url: existing.url, isActive: existing.isActive } : undefined,
        after: { affiliateId: link.affiliateId, productId: link.productId, url: link.url, isActive: link.isActive },
        ipAddress: input.auditMeta?.ipAddress ?? null,
        userAgent: input.auditMeta?.userAgent ?? null,
      },
    });

    return link;
  });
}

export async function submitExternalOrderEvidence(input: {
  vendorId: string;
  affiliateId: string;
  productId: string;
  externalOrderReference: string;
  amountCents: number;
  currency: string;
  submittedByUserId: string;
  auditMeta?: AuditMeta;
}) {
  const externalOrderReference = input.externalOrderReference.trim();
  const currency = input.currency.trim().toUpperCase();

  try {
    return await getDb().$transaction(async (tx) => {
      const [ownerMembership, affiliate, product] = await Promise.all([
        tx.vendorMember.findFirst({
          where: {
            vendorId: input.vendorId,
            userId: input.submittedByUserId,
            role: "owner",
            status: "active",
          },
          select: { id: true },
        }),
        tx.affiliate.findFirst({
          where: { id: input.affiliateId, vendorId: input.vendorId },
          select: { id: true, code: true, commissionRateBps: true, isActive: true },
        }),
        tx.product.findFirst({
          where: { id: input.productId, vendorId: input.vendorId, checkoutMode: "external" },
          select: { id: true },
        }),
      ]);

      if (!ownerMembership || !affiliate?.isActive || !product) {
        throw new ExternalStorefrontError(
          "ownership_mismatch",
          "Owner, affiliate, and external product must belong to the same vendor",
        );
      }

      const evidence = await tx.externalOrderEvidence.create({
        data: {
          vendorId: input.vendorId,
          affiliateId: input.affiliateId,
          productId: input.productId,
          externalOrderReference,
          amountCents: input.amountCents,
          currency,
          referralCode: affiliate.code,
          commissionRateBps: affiliate.commissionRateBps,
          submittedByUserId: input.submittedByUserId,
          status: "pending_review",
        },
      });

      await tx.auditLog.create({
        data: {
          vendorId: input.vendorId,
          actorId: input.submittedByUserId,
          actorLabel: "owner",
          action: "external_order_evidence_submitted",
          targetType: "ExternalOrderEvidence",
          targetId: evidence.id,
          after: {
            affiliateId: evidence.affiliateId,
            productId: evidence.productId,
            externalOrderReference: evidence.externalOrderReference,
            amountCents: evidence.amountCents,
            currency: evidence.currency,
            referralCode: evidence.referralCode,
            commissionRateBps: evidence.commissionRateBps,
            status: evidence.status,
          },
          ipAddress: input.auditMeta?.ipAddress ?? null,
          userAgent: input.auditMeta?.userAgent ?? null,
        },
      });

      return evidence;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ExternalStorefrontError("duplicate_order", "External order reference already exists for this vendor");
    }
    throw error;
  }
}

export async function reviewExternalOrderEvidence(input: {
  evidenceId: string;
  decision: "confirmed" | "rejected";
  reviewNote?: string | null;
  reviewedByUserId: string;
  auditMeta?: AuditMeta;
}) {
  const reviewedAt = new Date();
  const db = getDb();

  return db.$transaction(async (tx) => {
    const reviewer = await tx.user.findFirst({
      where: { id: input.reviewedByUserId, platformRole: "platform_admin", status: "active" },
      select: { id: true },
    });
    if (!reviewer) {
      throw new ExternalStorefrontError("platform_admin_required", "Platform admin review is required");
    }

    const evidence = await tx.externalOrderEvidence.findUnique({
      where: { id: input.evidenceId },
      include: { affiliate: true, product: true },
    });
    if (
      !evidence
      || evidence.affiliate.vendorId !== evidence.vendorId
      || evidence.product.vendorId !== evidence.vendorId
      || evidence.product.checkoutMode !== "external"
    ) {
      throw new ExternalStorefrontError("ownership_mismatch", "External order evidence relations are invalid");
    }

    if (evidence.status !== "pending_review" && evidence.status !== input.decision) {
      throw new ExternalStorefrontError("invalid_transition", "Reviewed external order evidence is immutable");
    }

    const claimed = evidence.status === "pending_review"
      ? await tx.externalOrderEvidence.updateMany({
          where: { id: evidence.id, status: "pending_review" },
          data: {
            status: input.decision,
            reviewedByUserId: reviewer.id,
            reviewedAt,
            reviewNote: input.reviewNote?.trim() || null,
          },
        })
      : { count: 0 };

    const current = claimed.count === 1
      ? { ...evidence, status: input.decision, reviewedByUserId: reviewer.id, reviewedAt }
      : await tx.externalOrderEvidence.findUniqueOrThrow({ where: { id: evidence.id } });
    if (current.status !== input.decision) {
      throw new ExternalStorefrontError("invalid_transition", "External order evidence was reviewed concurrently");
    }

    const commission = input.decision === "confirmed"
      ? await tx.affiliateCommission.upsert({
          where: {
            vendorId_sourceType_sourceId: {
              vendorId: evidence.vendorId,
              sourceType: EXTERNAL_COMMISSION_SOURCE,
              sourceId: evidence.id,
            },
          },
          create: {
            vendorId: evidence.vendorId,
            affiliateId: evidence.affiliateId,
            monthKey: monthKey(current.reviewedAt ?? reviewedAt),
            sourceType: EXTERNAL_COMMISSION_SOURCE,
            sourceId: evidence.id,
            referralCode: evidence.referralCode,
            orderNumber: evidence.externalOrderReference,
            orderAmountCents: evidence.amountCents,
            commissionRateBps: evidence.commissionRateBps,
            commissionAmountCents: Math.round((evidence.amountCents * evidence.commissionRateBps) / 10000),
            status: "approved",
            attributedAt: current.reviewedAt ?? reviewedAt,
          },
          update: {},
        })
      : null;

    await tx.auditLog.create({
      data: {
        vendorId: evidence.vendorId,
        actorId: reviewer.id,
        actorLabel: "platform_admin",
        action: claimed.count === 1
          ? `external_order_evidence_${input.decision}`
          : `external_order_evidence_${input.decision}_replayed`,
        targetType: "ExternalOrderEvidence",
        targetId: evidence.id,
        before: { status: evidence.status },
        after: {
          status: current.status,
          reviewedAt: (current.reviewedAt ?? reviewedAt).toISOString(),
          commissionId: commission?.id ?? null,
        },
        ipAddress: input.auditMeta?.ipAddress ?? null,
        userAgent: input.auditMeta?.userAgent ?? null,
      },
    });

    return { evidence: current, commission, idempotentReplay: claimed.count === 0 };
  });
}
