import type { Prisma } from "@prisma/client";
import { calculateSettlement, invoiceNumber } from "@/lib/billing";
import { getDb } from "@/lib/db";

export class SettlementOperationError extends Error {
  constructor(public readonly code: "not_found" | "locked" | "out_of_order") {
    super(code);
    this.name = "SettlementOperationError";
  }
}

function splitSettlementBalance(payoutableAmountCents: number, carryInAmountCents: number, adjustmentAmountCents: number) {
  const balanceCents = payoutableAmountCents + carryInAmountCents + adjustmentAmountCents;
  return {
    finalPayoutAmountCents: Math.max(0, balanceCents),
    carryForwardAmountCents: Math.min(0, balanceCents),
  };
}

export async function lockSettlementPeriod(tx: Prisma.TransactionClient, vendorId: string, monthKey: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`commission-period:${vendorId}:${monthKey}`}))`;
}

function followingMonth(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 1));
  return date.toISOString().slice(0, 7);
}

export async function resolveOpenSettlementMonth(tx: Prisma.TransactionClient, vendorId: string, desiredMonthKey: string) {
  let monthKey = desiredMonthKey;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await lockSettlementPeriod(tx, vendorId, monthKey);
    const settlement = await tx.settlement.findUnique({
      where: { vendorId_monthKey: { vendorId, monthKey } },
      select: { lockedAt: true },
    });
    if (!settlement?.lockedAt) return monthKey;
    monthKey = followingMonth(monthKey);
  }
  throw new SettlementOperationError("locked");
}

export async function generateSettlementRecord(vendorId: string, monthKey: string) {
  return getDb().$transaction(async (tx) => {
    await lockSettlementPeriod(tx, vendorId, monthKey);
    const [vendor, before] = await Promise.all([
      tx.vendor.findUnique({ where: { id: vendorId }, select: { id: true, slug: true } }),
      tx.settlement.findUnique({ where: { vendorId_monthKey: { vendorId, monthKey } } }),
    ]);
    if (!vendor) throw new SettlementOperationError("not_found");
    if (before?.lockedAt) throw new SettlementOperationError("locked");

    const calculation = await calculateSettlement(vendorId, monthKey, tx);
    const adjustmentAmountCents = before?.adjustmentAmountCents ?? 0;
    const adjustmentReason = before?.adjustmentReason ?? null;
    const { finalPayoutAmountCents, carryForwardAmountCents } = splitSettlementBalance(
      calculation.payoutableAmountCents,
      calculation.carryInAmountCents,
      adjustmentAmountCents,
    );
    const settlement = await tx.settlement.upsert({
      where: { vendorId_monthKey: { vendorId, monthKey } },
      create: {
        vendorId,
        monthKey,
        monthlyFeeCents: calculation.monthlyFeeCents,
        overflowFeeCents: calculation.overflowFeeCents,
        paymentServiceFeeCents: calculation.paymentServiceFeeCents,
        transactionServiceFeeCents: calculation.transactionServiceFeeCents,
        affiliateManagementFeeCents: calculation.affiliateManagementFeeCents,
        paymentGatewayFeeCents: calculation.paymentGatewayFeeCents,
        grossRevenueCents: calculation.grossRevenueCents,
        payoutableAmountCents: calculation.payoutableAmountCents,
        carryInAmountCents: calculation.carryInAmountCents,
        carryForwardAmountCents,
        adjustmentAmountCents,
        adjustmentReason,
        finalPayoutAmountCents,
        status: "draft",
      },
      update: {
        monthlyFeeCents: calculation.monthlyFeeCents,
        overflowFeeCents: calculation.overflowFeeCents,
        paymentServiceFeeCents: calculation.paymentServiceFeeCents,
        transactionServiceFeeCents: calculation.transactionServiceFeeCents,
        affiliateManagementFeeCents: calculation.affiliateManagementFeeCents,
        paymentGatewayFeeCents: calculation.paymentGatewayFeeCents,
        grossRevenueCents: calculation.grossRevenueCents,
        payoutableAmountCents: calculation.payoutableAmountCents,
        carryInAmountCents: calculation.carryInAmountCents,
        carryForwardAmountCents,
        finalPayoutAmountCents,
        status: "draft",
      },
    });
    const subtotalCents = calculation.monthlyFeeCents
      + calculation.overflowFeeCents
      + calculation.paymentServiceFeeCents
      + calculation.transactionServiceFeeCents
      + calculation.affiliateManagementFeeCents;
    await tx.invoice.upsert({
      where: { invoiceNumber: invoiceNumber(vendor.slug, monthKey) },
      create: {
        vendorId,
        monthKey,
        invoiceNumber: invoiceNumber(vendor.slug, monthKey),
        invoiceType: "monthly",
        monthlyFeeCents: calculation.monthlyFeeCents,
        overflowFeeCents: calculation.overflowFeeCents,
        paymentServiceFeeCents: calculation.paymentServiceFeeCents,
        transactionServiceFeeCents: calculation.transactionServiceFeeCents,
        affiliateManagementFeeCents: calculation.affiliateManagementFeeCents,
        subtotalCents,
        totalCents: subtotalCents,
        status: "issued",
      },
      update: {
        monthlyFeeCents: calculation.monthlyFeeCents,
        overflowFeeCents: calculation.overflowFeeCents,
        paymentServiceFeeCents: calculation.paymentServiceFeeCents,
        transactionServiceFeeCents: calculation.transactionServiceFeeCents,
        affiliateManagementFeeCents: calculation.affiliateManagementFeeCents,
        subtotalCents,
        totalCents: subtotalCents,
        status: "issued",
      },
    });
    return { before, settlement, calculation };
  });
}

export async function updateSettlementAdjustmentRecord(input: {
  id: string;
  adjustmentAmountCents: number;
  adjustmentReason: string | null;
  reviewedBy: string;
}) {
  const db = getDb();
  const initial = await db.settlement.findUnique({ where: { id: input.id } });
  if (!initial) throw new SettlementOperationError("not_found");
  return db.$transaction(async (tx) => {
    await lockSettlementPeriod(tx, initial.vendorId, initial.monthKey);
    const before = await tx.settlement.findUnique({ where: { id: input.id } });
    if (!before) throw new SettlementOperationError("not_found");
    if (before.lockedAt) throw new SettlementOperationError("locked");
    const { finalPayoutAmountCents, carryForwardAmountCents } = splitSettlementBalance(
      before.payoutableAmountCents,
      before.carryInAmountCents,
      input.adjustmentAmountCents,
    );
    const changed = await tx.settlement.updateMany({
      where: { id: input.id, lockedAt: null },
      data: {
        adjustmentAmountCents: input.adjustmentAmountCents,
        adjustmentReason: input.adjustmentReason,
        reviewedBy: input.reviewedBy,
        finalPayoutAmountCents,
        carryForwardAmountCents,
      },
    });
    if (changed.count !== 1) throw new SettlementOperationError("locked");
    const settlement = await tx.settlement.findUniqueOrThrow({ where: { id: input.id } });
    return { before, settlement };
  });
}

export async function lockSettlementRecord(id: string, memberId: string) {
  const db = getDb();
  const initial = await db.settlement.findUnique({ where: { id } });
  if (!initial) throw new SettlementOperationError("not_found");
  return db.$transaction(async (tx) => {
    await lockSettlementPeriod(tx, initial.vendorId, initial.monthKey);
    const before = await tx.settlement.findUnique({ where: { id } });
    if (!before) throw new SettlementOperationError("not_found");
    if (before.lockedAt) throw new SettlementOperationError("locked");
    const latestLocked = await tx.settlement.findFirst({
      where: { vendorId: before.vendorId, lockedAt: { not: null } },
      orderBy: { monthKey: "desc" },
      select: { monthKey: true },
    });
    if (latestLocked && followingMonth(latestLocked.monthKey) !== before.monthKey) {
      throw new SettlementOperationError("out_of_order");
    }
    const calculation = await calculateSettlement(before.vendorId, before.monthKey, tx);
    const { finalPayoutAmountCents, carryForwardAmountCents } = splitSettlementBalance(
      calculation.payoutableAmountCents,
      calculation.carryInAmountCents,
      before.adjustmentAmountCents,
    );
    const now = new Date();
    const changed = await tx.settlement.updateMany({
      where: { id, lockedAt: null },
      data: {
        monthlyFeeCents: calculation.monthlyFeeCents,
        overflowFeeCents: calculation.overflowFeeCents,
        paymentServiceFeeCents: calculation.paymentServiceFeeCents,
        transactionServiceFeeCents: calculation.transactionServiceFeeCents,
        affiliateManagementFeeCents: calculation.affiliateManagementFeeCents,
        paymentGatewayFeeCents: calculation.paymentGatewayFeeCents,
        grossRevenueCents: calculation.grossRevenueCents,
        payoutableAmountCents: calculation.payoutableAmountCents,
        carryInAmountCents: calculation.carryInAmountCents,
        carryForwardAmountCents,
        finalPayoutAmountCents,
        status: "locked",
        lockedAt: now,
        lockedBy: memberId,
        reviewedBy: memberId,
      },
    });
    if (changed.count !== 1) throw new SettlementOperationError("locked");
    const subtotalCents = calculation.monthlyFeeCents
      + calculation.overflowFeeCents
      + calculation.paymentServiceFeeCents
      + calculation.transactionServiceFeeCents
      + calculation.affiliateManagementFeeCents;
    await tx.invoice.updateMany({
      where: { vendorId: before.vendorId, monthKey: before.monthKey },
      data: {
        monthlyFeeCents: calculation.monthlyFeeCents,
        overflowFeeCents: calculation.overflowFeeCents,
        paymentServiceFeeCents: calculation.paymentServiceFeeCents,
        transactionServiceFeeCents: calculation.transactionServiceFeeCents,
        affiliateManagementFeeCents: calculation.affiliateManagementFeeCents,
        subtotalCents,
        totalCents: subtotalCents,
      },
    });
    await tx.affiliateCommission.updateMany({
      where: { vendorId: before.vendorId, monthKey: before.monthKey, status: { in: ["pending", "approved"] } },
      data: { status: "locked", settledAt: now },
    });
    const settlement = await tx.settlement.findUniqueOrThrow({ where: { id } });
    return { before, settlement };
  });
}
