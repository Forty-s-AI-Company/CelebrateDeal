"use server";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { requireVendorManagerContext } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { MerchantAffiliatePayoutPolicyConflict, setMerchantAffiliatePayoutPolicy } from "@/lib/merchant-affiliate-payout-policy";
const Path = "/affiliates/payout-policy";
const IntegerField = z.string().regex(/^\d{1,10}$/u).transform(Number);
export async function saveMerchantAffiliatePayoutPolicyAction(form: FormData) {
  await assertServerActionSecurity(form);
  const { vendor, auth } = await requireVendorManagerContext(Path);
  if (!["affiliate_program", "tax_remuneration"].every(feature => vendor.enabledFeatureModules.includes(feature))) notFound();
  let conflict = false;
  try {
    const result = await setMerchantAffiliatePayoutPolicy(getDb(), { userId: auth.user.id }, vendor.id, {
      expectedRevision: IntegerField.parse(form.get("expectedRevision")),
      bankFeeCents: IntegerField.parse(form.get("bankFeeCents")),
      enabled: form.get("enabled") === "on",
    });
    conflict = !result;
  } catch (failure) {
    if (failure instanceof MerchantAffiliatePayoutPolicyConflict || failure instanceof ZodError || (failure instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(failure.code))) conflict = true;
    else throw failure;
  }
  if (conflict) redirect(`${Path}?error=conflict`);
  revalidatePath(Path);
  revalidatePath("/affiliate-portal", "layout");
  redirect(`${Path}?saved=1`);
}
