"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { requireVendorOwner } from "@/lib/auth";
import { parseCommissionRuleForm } from "@/lib/commission-rule-form";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";

const SETTINGS_PATH = "/settings/commissions";

function redirectError(code: string): never {
  redirect(`${SETTINGS_PATH}?error=${encodeURIComponent(code)}`);
}

export async function saveCommissionRuleAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  let parsed: ReturnType<typeof parseCommissionRuleForm>;
  try {
    parsed = parseCommissionRuleForm(formData);
  } catch {
    redirectError("invalid_rule");
  }

  const now = new Date();
  let created;
  try {
    created = await getDb().$transaction(async (tx) => {
      const latest = await tx.commissionRuleSet.findFirst({
        where: { vendorId: auth.vendor.id },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      await tx.commissionRuleSet.updateMany({
        where: { vendorId: auth.vendor.id, currency: parsed.currency, status: "ACTIVE" },
        data: { status: "ARCHIVED", archivedAt: now },
      });
      const ruleSet = await tx.commissionRuleSet.create({
        data: {
          vendorId: auth.vendor.id,
          name: `${parsed.currency} 推廣分潤規則`,
          version: (latest?.version ?? 0) + 1,
          currency: parsed.currency,
          maxTotalRateBps: parsed.maxTotalRateBps,
          activatedAt: now,
        },
      });
      await tx.commissionRateTier.createMany({
        data: parsed.tiers.map((tier) => ({
          vendorId: auth.vendor.id,
          commissionRuleSetId: ruleSet.id,
          ...tier,
        })),
      });
      if (parsed.uplineLevels.length > 0) {
        await tx.commissionUplineLevel.createMany({
          data: parsed.uplineLevels.map((level) => ({
            vendorId: auth.vendor.id,
            commissionRuleSetId: ruleSet.id,
            ...level,
          })),
        });
      }
      return tx.commissionRuleSet.findUniqueOrThrow({
        where: { id: ruleSet.id },
        include: { tiers: true, uplineLevels: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
      redirectError("rule_conflict");
    }
    throw error;
  }

  await writeAuditLog({
    vendorId: auth.vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: "activate_commission_rule",
    targetType: "CommissionRuleSet",
    targetId: created.id,
    after: auditSnapshot(created),
  });
  revalidatePath(SETTINGS_PATH);
  redirect(`${SETTINGS_PATH}?updated=rule_saved`);
}
