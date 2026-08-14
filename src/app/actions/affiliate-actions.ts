"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFinanceAdmin } from "@/lib/auth";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { appendCommissionLedgerEntry, commissionLedgerBalance } from "@/lib/affiliate-commission-accounting";
import { assertAffiliateCommissionTransition } from "@/lib/affiliate-commission";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";

function text(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : fallback;
}

class PayoutBatchClaimConflict extends Error {}

export async function voidAffiliateCommissionAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const reason = text(formData, "reason") || null;
  const commission = await getDb().affiliateCommission.findUnique({ where: { id } });
  if (!commission || commission.status === "void") {
    redirect("/admin/billing/dashboard?error=commission");
  }

  if (commission.status !== "paid") assertAffiliateCommissionTransition(commission.status, "void");
  const updated = await getDb().$transaction(async (tx) => {
    const balance = await commissionLedgerBalance(tx, commission.vendorId, commission.id);
    if (balance > 0) {
      await appendCommissionLedgerEntry(tx, {
        vendorId: commission.vendorId,
        affiliateCommissionId: commission.id,
        entryType: "reversal",
        providerName: "admin",
        // Reason is intentionally excluded from identity: repeating a request
        // must return the original immutable reversal rather than double it.
        eventIdentity: `admin:void:${commission.id}`,
        amountCents: -balance,
        occurredAt: new Date(),
      });
    }
    if (commission.status === "paid") {
      return tx.affiliateCommission.findUniqueOrThrow({ where: { id } });
    }
    const transition = await tx.affiliateCommission.updateMany({
      where: { id, vendorId: commission.vendorId, status: commission.status },
      // Never rewrite the original amount after it has entered accounting.
      data: { status: "void", settledAt: new Date() },
    });
    if (transition.count !== 1) throw new PayoutBatchClaimConflict();
    return tx.affiliateCommission.findUniqueOrThrow({ where: { id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await writeAuditLog({
    vendorId: commission.vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: "void_affiliate_commission",
    targetType: "AffiliateCommission",
    targetId: commission.id,
    before: auditSnapshot(commission),
    after: auditSnapshot({ commission: updated, reason }),
  });

  revalidatePath("/admin/billing/dashboard");
  revalidatePath("/affiliates/commissions");
  redirect("/admin/billing/dashboard");
}
