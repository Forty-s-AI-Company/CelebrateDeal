"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditSnapshot, requestAuditMeta } from "@/lib/audit";
import { requireVendorOwner } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";

const PLAN_CHANGE_MAX_ATTEMPTS = 3;

function formText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function nextMonthlyReset(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

function isSerializationConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

export async function selectBillingPlanAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { vendor, member } = await requireVendorOwner();
  const planId = formText(formData, "planId");

  if (!planId || planId.length > 64) {
    redirect("/billing/plans?error=unavailable");
  }
  const auditMeta = await requestAuditMeta();

  for (let attempt = 1; attempt <= PLAN_CHANGE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const changedAt = new Date();
      const result = await getDb().$transaction(async (tx) => {
        // The plan price and quotas are always re-read from the server. Client
        // fields other than planId cannot influence billing or entitlements.
        const plan = await tx.billingPlan.findFirst({
          where: { id: planId, isActive: true },
        });
        if (!plan) return { outcome: "unavailable" as const };

        const activeSubscriptions = await tx.vendorSubscription.findMany({
          where: { vendorId: vendor.id, status: "active" },
          orderBy: { startedAt: "desc" },
        });

        if (activeSubscriptions.length === 1 && activeSubscriptions[0]?.planId === plan.id) {
          return {
            outcome: "current" as const,
            plan,
            previousSubscriptions: activeSubscriptions,
            subscription: activeSubscriptions[0],
          };
        }

        const previousSubscription = activeSubscriptions[0];
        await tx.vendorSubscription.updateMany({
          where: { vendorId: vendor.id, status: "active" },
          data: { status: "ended", endedAt: changedAt },
        });

        const subscription = await tx.vendorSubscription.create({
          data: {
            vendorId: vendor.id,
            planId: plan.id,
            paymentMode: previousSubscription?.paymentMode ?? "byo",
            billingCycleDay: previousSubscription?.billingCycleDay ?? 5,
            status: "active",
            startedAt: changedAt,
          },
        });

        await tx.vendorUsageLimit.upsert({
          where: { vendorId: vendor.id },
          create: {
            vendorId: vendor.id,
            billingPlanId: plan.id,
            streamMinutesLimit: plan.includedStreamMinutes,
            storageMinutesLimit: plan.includedStorageMinutes,
            creditsLimit: plan.includedCredits,
            resetAt: nextMonthlyReset(changedAt),
          },
          update: {
            billingPlanId: plan.id,
            streamMinutesLimit: plan.includedStreamMinutes,
            storageMinutesLimit: plan.includedStorageMinutes,
            creditsLimit: plan.includedCredits,
          },
        });

        await tx.auditLog.create({
          data: {
            vendorId: vendor.id,
            actorId: member.id,
            actorLabel: member.role,
            action: "select_billing_plan",
            targetType: "VendorSubscription",
            targetId: subscription.id,
            before: auditSnapshot({ subscriptions: activeSubscriptions }),
            after: auditSnapshot({
              subscription,
              plan: { id: plan.id, code: plan.code, monthlyPriceCents: plan.monthlyPriceCents },
            }),
            ipAddress: auditMeta.ipAddress,
            userAgent: auditMeta.userAgent,
          },
        });

        return {
          outcome: "changed" as const,
          plan,
          previousSubscriptions: activeSubscriptions,
          subscription,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      if (result.outcome === "unavailable") {
        redirect("/billing/plans?error=unavailable");
      }

      revalidatePath("/billing/plans");
      revalidatePath("/billing/usage");
      revalidatePath("/dashboard");
      redirect(`/billing/plans?status=${result.outcome}`);
    } catch (error) {
      if (!isSerializationConflict(error)) {
        throw error;
      }
      if (attempt === PLAN_CHANGE_MAX_ATTEMPTS) {
        redirect("/billing/plans?error=conflict");
      }
    }
  }

  redirect("/billing/plans?error=conflict");
}
