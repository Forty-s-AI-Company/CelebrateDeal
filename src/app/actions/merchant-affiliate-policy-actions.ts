"use server";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { requireVendorManagerContext } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { MerchantAffiliateTermsValidationError } from "@/lib/affiliate-tier-policy";
import { merchantAffiliatePolicyFromForm, merchantAffiliateRevisionFromForm } from "@/lib/merchant-affiliate-policy-form";
import { publishMerchantAffiliatePolicy, pauseMerchantAffiliatePolicy, MerchantAffiliatePolicyConflict, MerchantAffiliatePolicyDenied } from "@/lib/merchant-affiliate-policy-service";

export async function saveMerchantAffiliatePolicyAction(_previous: { message: string; revision: number | null }, form: FormData) {
  await assertServerActionSecurity(form);
  const { vendor, auth } = await requireVendorManagerContext("/affiliates/policy");
  if (!auth.user) throw new MerchantAffiliatePolicyDenied("請重新登入。");
  try {
    const actor = { vendorId: vendor.id, userId: auth.user.id };
    const result = form.get("intent") === "pause"
      ? await pauseMerchantAffiliatePolicy(getDb(), actor, merchantAffiliateRevisionFromForm(form))
      : await publishMerchantAffiliatePolicy(getDb(), actor, merchantAffiliatePolicyFromForm(form));
    revalidatePath("/affiliates/policy");
    return { message: form.get("intent") === "pause" ? "政策已暫停；既有結帳仍依原始政策計算。" : "佣金政策已發布；只適用於之後的新結帳。", revision: result.revision };
  } catch (error) {
    if (error instanceof MerchantAffiliatePolicyConflict || (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))) return { message: "政策已由其他人變更，請重新整理後確認最新設定。", revision: null };
    if (error instanceof MerchantAffiliatePolicyDenied) return { message: "無權設定政策，或所選商品不屬於此商家。", revision: null };
    if (error instanceof MerchantAffiliateTermsValidationError || error instanceof ZodError || (error instanceof Error && ["件數與版本必須是非負整數。", "佣金比例最多保留兩位小數。", "佣金設定列數不一致或超出上限。"].includes(error.message))) return { message: "請檢查連續階梯、商品、比例與佣金總上限。", revision: null };
    throw error;
  }
}
