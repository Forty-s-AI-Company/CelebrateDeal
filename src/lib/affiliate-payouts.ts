import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { lockSettlementPeriod } from "@/lib/settlement-operations";

export class AffiliatePayoutError extends Error {
  constructor(public readonly code: "not_found" | "invalid_state" | "empty" | "invalid_amount" | "closed_period") {
    super(code);
    this.name = "AffiliatePayoutError";
  }
}

function validMonthKey(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

async function lockLedger(tx: Prisma.TransactionClient, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

export async function approveAffiliateCommission(id: string) {
  const db = getDb();
  const initial = await db.affiliateCommission.findUnique({ where: { id } });
  if (!initial) throw new AffiliatePayoutError("not_found");
  return db.$transaction(async (tx) => {
    await lockSettlementPeriod(tx, initial.vendorId, initial.monthKey);
    const settlement = await tx.settlement.findUnique({
      where: { vendorId_monthKey: { vendorId: initial.vendorId, monthKey: initial.monthKey } },
      select: { lockedAt: true },
    });
    if (settlement?.lockedAt) throw new AffiliatePayoutError("closed_period");
    const updated = await tx.affiliateCommission.updateMany({
      where: { id, status: "pending", affiliatePayoutId: null },
      data: { status: "approved" },
    });
    if (updated.count !== 1) throw new AffiliatePayoutError("invalid_state");
    return tx.affiliateCommission.findUniqueOrThrow({ where: { id } });
  });
}

export async function reverseAffiliateCommission(id: string) {
  const db = getDb();
  const initial = await db.affiliateCommission.findUnique({ where: { id } });
  if (!initial) throw new AffiliatePayoutError("not_found");
  return db.$transaction(async (tx) => {
    await lockSettlementPeriod(tx, initial.vendorId, initial.monthKey);
    const before = await tx.affiliateCommission.findUnique({ where: { id } });
    if (!before) throw new AffiliatePayoutError("not_found");
    const settlement = await tx.settlement.findUnique({
      where: { vendorId_monthKey: { vendorId: before.vendorId, monthKey: before.monthKey } },
      select: { lockedAt: true },
    });
    if (settlement?.lockedAt || !["pending", "approved"].includes(before.status) || before.affiliatePayoutId) {
      throw new AffiliatePayoutError("closed_period");
    }
    const now = new Date();
    const changed = await tx.affiliateCommission.updateMany({
      where: { id, status: { in: ["pending", "approved"] }, affiliatePayoutId: null },
      data: { status: "reversed", settledAt: now, reversedAt: now },
    });
    if (changed.count !== 1) throw new AffiliatePayoutError("invalid_state");
    const commission = await tx.affiliateCommission.findUniqueOrThrow({ where: { id } });
    return { before, commission };
  });
}

export async function createAffiliatePayout(input: { vendorId: string; affiliateId: string; monthKey: string }) {
  if (!validMonthKey(input.monthKey)) throw new AffiliatePayoutError("invalid_state");
  const db = getDb();
  return db.$transaction(async (tx) => {
    await lockLedger(tx, `affiliate-payout:${input.vendorId}:${input.affiliateId}:${input.monthKey}`);
    const existing = await tx.affiliatePayout.findUnique({
      where: { vendorId_affiliateId_monthKey: input },
    });
    if (existing) return existing;

    const commissions = await tx.affiliateCommission.findMany({
      where: {
        vendorId: input.vendorId,
        affiliateId: input.affiliateId,
        monthKey: input.monthKey,
        status: "locked",
        affiliatePayoutId: null,
      },
      orderBy: { id: "asc" },
    });
    if (commissions.length === 0) throw new AffiliatePayoutError("empty");
    const commissionAmountCents = commissions.reduce((sum, item) => sum + item.commissionAmountCents, 0);
    if (commissionAmountCents <= 0) throw new AffiliatePayoutError("invalid_amount");
    const adjustmentAmountCents = commissions
      .filter((item) => item.sourceType === "refund_adjustment" || item.sourceType === "manual_adjustment")
      .reduce((sum, item) => sum + item.commissionAmountCents, 0);
    const payout = await tx.affiliatePayout.create({
      data: {
        vendorId: input.vendorId,
        affiliateId: input.affiliateId,
        monthKey: input.monthKey,
        commissionAmountCents,
        adjustmentAmountCents,
        finalAmountCents: commissionAmountCents,
        status: "pending",
      },
    });
    const assigned = await tx.affiliateCommission.updateMany({
      where: { id: { in: commissions.map((item) => item.id) }, status: "locked", affiliatePayoutId: null },
      data: { affiliatePayoutId: payout.id },
    });
    if (assigned.count !== commissions.length) throw new AffiliatePayoutError("invalid_state");
    return payout;
  });
}

export async function transitionAffiliatePayout(id: string, nextStatus: "approved" | "paid" | "reversed") {
  const db = getDb();
  return db.$transaction(async (tx) => {
    await lockLedger(tx, `affiliate-payout:${id}`);
    const payout = await tx.affiliatePayout.findUnique({ where: { id } });
    if (!payout) throw new AffiliatePayoutError("not_found");
    const allowed = payout.status === "pending"
      ? new Set(["approved", "reversed"])
      : payout.status === "approved"
        ? new Set(["paid", "reversed"])
        : new Set<string>();
    if (!allowed.has(nextStatus)) throw new AffiliatePayoutError("invalid_state");
    const now = new Date();

    if (nextStatus === "paid") {
      const updated = await tx.affiliateCommission.updateMany({
        where: { affiliatePayoutId: id, vendorId: payout.vendorId, status: "locked" },
        data: { status: "paid", settledAt: now },
      });
      const expected = await tx.affiliateCommission.count({ where: { affiliatePayoutId: id, vendorId: payout.vendorId } });
      if (expected === 0 || updated.count !== expected) throw new AffiliatePayoutError("invalid_state");
    }

    if (nextStatus === "reversed") {
      await tx.affiliateCommission.updateMany({
        where: { affiliatePayoutId: id, vendorId: payout.vendorId, status: "locked" },
        data: { status: "reversed", reversedAt: now, settledAt: now },
      });
    }

    return tx.affiliatePayout.update({
      where: { id },
      data: {
        status: nextStatus,
        approvedAt: nextStatus === "approved" ? now : payout.approvedAt,
        paidAt: nextStatus === "paid" ? now : payout.paidAt,
        reversedAt: nextStatus === "reversed" ? now : payout.reversedAt,
      },
    });
  });
}

export async function createManualCommissionAdjustment(input: {
  affiliateId: string;
  monthKey: string;
  amountCents: number;
  reason: string;
}) {
  if (!validMonthKey(input.monthKey) || !Number.isInteger(input.amountCents) || input.amountCents === 0) {
    throw new AffiliatePayoutError("invalid_amount");
  }
  return getDb().$transaction(async (tx) => {
    const affiliate = await tx.affiliate.findFirst({ where: { id: input.affiliateId, isActive: true } });
    if (!affiliate) throw new AffiliatePayoutError("not_found");
    await lockLedger(tx, `commission-period:${affiliate.vendorId}:${input.monthKey}`);
    const [settlement, payout] = await Promise.all([
      tx.settlement.findUnique({ where: { vendorId_monthKey: { vendorId: affiliate.vendorId, monthKey: input.monthKey } }, select: { lockedAt: true } }),
      tx.affiliatePayout.findUnique({ where: { vendorId_affiliateId_monthKey: { vendorId: affiliate.vendorId, affiliateId: affiliate.id, monthKey: input.monthKey } }, select: { id: true } }),
    ]);
    if (settlement?.lockedAt || payout) throw new AffiliatePayoutError("closed_period");
    return tx.affiliateCommission.create({
      data: {
        vendorId: affiliate.vendorId,
        affiliateId: input.affiliateId,
        monthKey: input.monthKey,
        sourceType: "manual_adjustment",
        sourceId: `manual:${randomUUID()}`,
        referralCode: affiliate.code,
        commissionAmountCents: input.amountCents,
        status: "approved",
        orderNumber: input.reason.slice(0, 120),
      },
    });
  });
}
