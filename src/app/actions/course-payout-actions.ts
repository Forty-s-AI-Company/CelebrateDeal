"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import {
  appendCourseCommissionLedgerEntry,
  courseCommissionLedgerBalance,
} from "@/lib/course-commission-accounting";
import { CoursePayoutMutationConflict } from "@/lib/course-payout-accounting";
import { auditSnapshot } from "@/lib/audit";
import { requireFinanceAdmin } from "@/lib/auth";
import { monthRange } from "@/lib/billing";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function recordCoursePayoutOutcomeAction(formData: FormData) {
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
    redirect("/admin/billing/course-payouts?error=invalid_outcome");
  }

  try {
    await getDb().$transaction(async (tx) => {
      const payout = await tx.coursePayout.findUnique({ where: { id } });
      if (!payout || payout.finalAmountCents <= 0 || payout.finalAmountCents !== payout.commissionAmountCents + payout.adjustmentAmountCents) {
        throw new CoursePayoutMutationConflict("課程 payout 金額不一致。");
      }
      if (payout.status === status) return;
      if (payout.status !== "pending") throw new CoursePayoutMutationConflict("課程 payout 已完成且不可逆轉。");

      const period = monthRange(payout.monthKey);
      const allocations = await tx.courseCommissionAllocation.findMany({
        where: {
          vendorId: payout.vendorId,
          recipientMembershipId: payout.recipientMembershipId,
          paymentTransaction: { occurredAt: { gte: period.start, lt: period.end } },
        },
        select: { id: true },
      });
      const balances: Array<{ id: string; amountCents: number }> = [];
      let currentBalanceCents = 0;
      for (const allocation of allocations) {
        const amountCents = await courseCommissionLedgerBalance(tx, payout.vendorId, allocation.id);
        if (amountCents < 0) throw new CoursePayoutMutationConflict("課程 payout ledger 淨額不可為負數。");
        balances.push({ id: allocation.id, amountCents });
        currentBalanceCents += amountCents;
      }
      if (currentBalanceCents !== payout.commissionAmountCents) {
        throw new CoursePayoutMutationConflict("課程 payout 與 immutable ledger 金額不一致。");
      }

      const transitionedAt = new Date();
      if (status === "void") {
        for (const balance of balances) {
          if (balance.amountCents === 0) continue;
          await appendCourseCommissionLedgerEntry(tx, {
            vendorId: payout.vendorId,
            courseCommissionAllocationId: balance.id,
            entryType: "reversal",
            providerName: "finance-admin",
            eventIdentity: `course-payout:void:${payout.id}:${balance.id}`,
            amountCents: -balance.amountCents,
            occurredAt: transitionedAt,
          });
        }
      }

      const claim = await tx.coursePayout.updateMany({
        where: { id: payout.id, status: "pending", finalAmountCents: payout.finalAmountCents },
        data: {
          status,
          outcomeReference: status === "paid" ? reference : null,
          outcomeReason: status === "void" ? reason : null,
          paidAt: status === "paid" ? transitionedAt : null,
        },
      });
      if (claim.count !== 1) throw new CoursePayoutMutationConflict("課程 payout 狀態已被其他交易變更。");
      const updated = await tx.coursePayout.findUnique({ where: { id: payout.id } });
      if (!updated || updated.status !== status) throw new CoursePayoutMutationConflict("課程 payout 更新後狀態不一致。");
      await tx.auditLog.create({
        data: {
          vendorId: payout.vendorId,
          actorId: member.id,
          actorLabel: member.role,
          action: status === "paid" ? "mark_course_payout_paid" : "mark_course_payout_void",
          targetType: "CoursePayout",
          targetId: payout.id,
          before: auditSnapshot(payout),
          after: auditSnapshot({ payout: updated, reference: status === "paid" ? reference : null, reason: status === "void" ? reason : null, transitionedAt }),
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof CoursePayoutMutationConflict || (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2025", "P2034"].includes(error.code))) {
      redirect("/admin/billing/course-payouts?error=conflict");
    }
    throw error;
  }

  redirect("/admin/billing/course-payouts");
}
