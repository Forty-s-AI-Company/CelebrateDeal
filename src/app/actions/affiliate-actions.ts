"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFinanceAdmin } from "@/lib/auth";
import { requireVendorManager } from "@/lib/auth";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { appendCommissionLedgerEntry, commissionLedgerBalance } from "@/lib/affiliate-commission-accounting";
import { AffiliateCommissionRateBps, AffiliateProfile, assertAffiliateCommissionTransition } from "@/lib/affiliate-commission";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { hashPasswordAsync } from "@/lib/password";
import { z } from "zod";

function text(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : fallback;
}

function optionalText(formData: FormData, key: string) {
  const value = text(formData, key);
  return value || null;
}

class PayoutBatchClaimConflict extends Error {}

export async function upsertAffiliateAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = optionalText(formData, "id");
  const commissionRate = AffiliateCommissionRateBps.safeParse(Number(text(formData, "commissionRateBps")));
  if (!commissionRate.success) redirect("/affiliates?error=invalid_commission_rate");

  const profile = AffiliateProfile.safeParse({
    name: text(formData, "name"),
    code: text(formData, "code"),
    source: optionalText(formData, "source"),
    contactEmail: optionalText(formData, "contactEmail"),
  });
  if (!profile.success) redirect("/affiliates?error=invalid_affiliate");

  const portalEmail = optionalText(formData, "portalEmail")?.toLowerCase() ?? null;
  const portalPassword = text(formData, "portalPassword");
  if (portalEmail && !z.string().email().max(254).safeParse(portalEmail).success) {
    redirect("/affiliates?error=invalid_portal_email");
  }
  if (portalEmail && portalPassword && (portalPassword.length < 12 || portalPassword.length > 128)) {
    redirect("/affiliates?error=weak_portal_password");
  }

  const data = {
    ...profile.data,
    commissionRateBps: commissionRate.data,
    isActive: formData.get("isActive") === "on",
  };
  const newPortalPasswordHash = portalEmail && portalPassword ? await hashPasswordAsync(portalPassword) : null;
  await getDb().$transaction(async (tx) => {
    let portalUserId: string | undefined;
    if (portalEmail) {
      const existingPortalUser = await tx.user.findUnique({
        where: { email: portalEmail },
        select: { id: true, status: true },
      });
      if (existingPortalUser?.status !== undefined && existingPortalUser.status !== "active") {
        redirect("/affiliates?error=inactive_portal_user");
      }
      if (existingPortalUser) {
        portalUserId = existingPortalUser.id;
      } else {
        if (!newPortalPasswordHash) redirect("/affiliates?error=portal_password_required");
        const user = await tx.user.create({
          data: { email: portalEmail, name: profile.data.name, passwordHash: newPortalPasswordHash },
          select: { id: true },
        });
        portalUserId = user.id;
      }
      const occupied = await tx.affiliate.findFirst({
        where: { vendorId: vendor.id, userId: portalUserId, ...(id ? { id: { not: id } } : {}) },
        select: { id: true },
      });
      if (occupied) redirect("/affiliates?error=portal_user_in_use");
    }

    if (!id) {
      await tx.affiliate.create({
        data: { vendorId: vendor.id, ...data, ...(portalUserId ? { userId: portalUserId } : {}) },
      });
      return;
    }
    const existing = await tx.affiliate.findFirst({
      where: { id, vendorId: vendor.id },
      select: { id: true },
    });
    if (!existing) redirect("/affiliates?error=affiliate_not_found");
    await tx.affiliate.update({
      where: { id, vendorId: vendor.id },
      data: { ...data, ...(portalUserId ? { userId: portalUserId } : {}) },
    });
  });
  redirect("/affiliates");
}

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
