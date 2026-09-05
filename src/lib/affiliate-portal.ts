import type { PrismaClient } from "@prisma/client";
import { getCanonicalAppUrl } from "@/lib/app-url";

export type AffiliatePortalScope = {
  vendorId: string;
  affiliateId: string;
  userId: string;
};

export async function getAffiliatePortalDashboard(
  db: PrismaClient,
  scope: AffiliatePortalScope,
) {
  const affiliate = await db.affiliate.findFirst({
    where: {
      id: scope.affiliateId,
      vendorId: scope.vendorId,
      userId: scope.userId,
      isActive: true,
    },
    select: {
      id: true,
      vendorId: true,
      name: true,
      code: true,
      bankAccountEncrypted: true,
    },
  });
  if (!affiliate) return null;

  const commissionWhere = {
    vendorId: scope.vendorId,
    affiliateId: scope.affiliateId,
  } as const;
  const [clickCount, conversionCount, sales, walletRows, commissions, payouts] = await Promise.all([
    db.affiliateClick.count({ where: commissionWhere }),
    db.affiliateCommission.count({
      where: { ...commissionWhere, sourceType: { not: "refund_adjustment" }, status: { not: "void" } },
    }),
    db.affiliateCommission.aggregate({
      where: { ...commissionWhere, sourceType: { not: "refund_adjustment" }, status: { not: "void" } },
      _sum: { commissionBaseAmountCents: true },
    }),
    db.affiliateCommission.groupBy({
      by: ["status"],
      where: commissionWhere,
      _sum: { commissionAmountCents: true },
    }),
    db.affiliateCommission.findMany({
      where: commissionWhere,
      orderBy: [{ attributedAt: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        id: true,
        monthKey: true,
        orderNumber: true,
        commissionBaseAmountCents: true,
        commissionAmountCents: true,
        status: true,
        attributedAt: true,
      },
    }),
    db.affiliatePayout.findMany({
      where: commissionWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        id: true,
        monthKey: true,
        finalAmountCents: true,
        status: true,
        requestedAt: true,
        paidAt: true,
        createdAt: true,
      },
    }),
  ]);

  const origin = getCanonicalAppUrl();
  const referralUrl = new URL(`/r/${encodeURIComponent(affiliate.code)}`, origin);
  const wallet = walletRows.reduce((total, row) => {
    const amount = row._sum.commissionAmountCents ?? 0;
    if (row.status === "pending") total.pending += amount;
    else if (row.status === "paid") total.paid += amount;
    else if (row.status !== "void") total.approved += amount;
    return total;
  }, { pending: 0, approved: 0, paid: 0 });

  return {
    affiliate,
    metrics: {
      clickCount,
      conversionCount,
      salesAmountCents: sales._sum.commissionBaseAmountCents ?? 0,
    },
    wallet,
    commissions,
    payouts,
    referralUrl: referralUrl.toString(),
  };
}
