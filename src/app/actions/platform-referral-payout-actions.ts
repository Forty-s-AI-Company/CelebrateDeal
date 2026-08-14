"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { auditSnapshot } from "@/lib/audit";
import { requireFinanceAdmin } from "@/lib/auth";
import {
  PlatformReferralPayoutMutationConflict,
  createPlatformReferralPayoutBatch,
  syncPlatformReferralPayoutsForMonth,
  voidPlatformReferralPayout,
} from "@/lib/platform-referral-payout";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Records a human-reviewed local outcome; it never calls a payment provider. */
export async function recordPlatformReferralPayoutOutcomeAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const status = text(formData, "status");
  const reference = text(formData, "outcomeReference");
  const reason = text(formData, "outcomeReason");
  if (
    !id
    || id.length > 200
    || (status !== "paid" && status !== "void")
    || (status === "paid" && (reference.length < 1 || reference.length > 200))
    || (status === "void" && (reason.length < 1 || reason.length > 500))
  ) {
    redirect("/admin/billing/platform-referral-payouts?error=invalid_outcome");
  }

  try {
    await getDb().$transaction(async (tx) => {
      const payout = await tx.platformReferralPayout.findUnique({ where: { id } });
      if (!payout || payout.finalAmountCents <= 0 || payout.finalAmountCents !== payout.commissionAmountCents + payout.adjustmentAmountCents) {
        throw new PlatformReferralPayoutMutationConflict("平台推薦 payout 金額不一致。");
      }
      if (payout.status === status) return;

      let updated;
      if (status === "void") {
        updated = await voidPlatformReferralPayout(tx, {
          payoutId: payout.id,
          reason,
          occurredAt: new Date(),
        });
      } else {
        if (payout.status !== "batched") throw new PlatformReferralPayoutMutationConflict("平台推薦 payout 尚未進入批次。");
        const transitionedAt = new Date();
        const claim = await tx.platformReferralPayout.updateMany({
          where: { id: payout.id, status: "batched", finalAmountCents: payout.finalAmountCents },
          data: { status: "paid", outcomeReference: reference, outcomeReason: null, paidAt: transitionedAt },
        });
        if (claim.count !== 1) throw new PlatformReferralPayoutMutationConflict("平台推薦 payout 狀態已被其他交易變更。");
        updated = await tx.platformReferralPayout.findUnique({ where: { id: payout.id } });
        if (!updated || updated.status !== "paid") throw new PlatformReferralPayoutMutationConflict("平台推薦 payout 更新後狀態不一致。");
      }
      await tx.auditLog.create({
        data: {
          vendorId: null,
          actorId: member.id,
          actorLabel: member.role,
          action: status === "paid" ? "mark_platform_referral_payout_paid" : "mark_platform_referral_payout_void",
          targetType: "PlatformReferralPayout",
          targetId: payout.id,
          before: auditSnapshot(payout),
          after: auditSnapshot({ payout: updated, reference: status === "paid" ? reference : null, reason: status === "void" ? reason : null }),
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof PlatformReferralPayoutMutationConflict || (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2025", "P2034"].includes(error.code))) {
      redirect("/admin/billing/platform-referral-payouts?error=conflict");
    }
    throw error;
  }

  redirect("/admin/billing/platform-referral-payouts");
}

/** Rebuilds the local owner/month read model and groups pending rows into a batch. */
export async function createPlatformReferralPayoutBatchAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const monthKey = text(formData, "monthKey");
  const batchNumber = text(formData, "batchNumber");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(monthKey) || !batchNumber || batchNumber.length > 120) {
    redirect("/admin/billing/platform-referral-payouts?error=invalid_batch");
  }

  try {
    await getDb().$transaction(async (tx) => {
      const synced = await syncPlatformReferralPayoutsForMonth(tx, { monthKey });
      const batch = await createPlatformReferralPayoutBatch(tx, {
        monthKey,
        batchNumber,
        batchDate: new Date(),
      });
      if (!batch) throw new PlatformReferralPayoutMutationConflict("目前月份沒有可批次的平台推薦 payout。");
      await tx.auditLog.create({
        data: {
          vendorId: null,
          actorId: member.id,
          actorLabel: member.role,
          action: "create_platform_referral_payout_batch",
          targetType: "PlatformReferralPayoutBatch",
          targetId: batch.id,
          before: Prisma.JsonNull,
          after: auditSnapshot({ batch, syncedCount: synced.length }),
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof PlatformReferralPayoutMutationConflict || (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2025", "P2034"].includes(error.code))) {
      redirect("/admin/billing/platform-referral-payouts?error=conflict");
    }
    throw error;
  }

  redirect("/admin/billing/platform-referral-payouts");
}
