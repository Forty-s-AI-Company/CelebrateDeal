"use server";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z, ZodError } from "zod";
import { requireAuth, requireVendorManagerContext } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { BankAccountEncryptionError } from "@/lib/bank-account";
import { AffiliatePayeeConflict, approveAffiliatePayeeProfile, submitAffiliatePayeeProfile } from "@/lib/affiliate-payee-profile";
import { createAffiliateRemunerationQuote, signAffiliateRemunerationQuote } from "@/lib/affiliate-remuneration-quotes";
import { AffiliateRemunerationInputError } from "@/lib/affiliate-remuneration";
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/u);
const Revision = z.string().regex(/^\d{1,10}$/u).transform(Number).pipe(z.number().int().min(0).max(2_147_483_646));
async function memberContext(form: FormData) {
  await assertServerActionSecurity(form);
  const vendorSlug = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/u).parse(form.get("vendorSlug"));
  const affiliateId = Id.parse(form.get("affiliateId"));
  const path = `/affiliate-portal/${encodeURIComponent(vendorSlug)}/${encodeURIComponent(affiliateId)}/remuneration`;
  const auth = await requireAuth({ nextPath: path });
  const vendor = await getDb().vendor.findFirst({ where: { slug: vendorSlug, enabledFeatureModules: { hasEvery: ["affiliate_program", "tax_remuneration"] } }, select: { id: true } });
  if (!vendor) notFound();
  return { actor: { userId: auth.user.id }, scope: { vendorId: vendor.id, affiliateId }, path };
}
async function finish(path: string, mutation: () => Promise<unknown>) {
  let conflict = false;
  try {
    const result = await mutation();
    conflict = !result || (typeof result === "object" && result !== null && "status" in result && result.status === "stale");
  } catch (failure) {
    if (failure instanceof AffiliatePayeeConflict || failure instanceof AffiliateRemunerationInputError || failure instanceof BankAccountEncryptionError || failure instanceof ZodError || (failure instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(failure.code))) conflict = true;
    else throw failure;
  }
  if (conflict) redirect(`${path}?error=conflict`);
  revalidatePath(path);
  redirect(`${path}?saved=1`);
}
export async function submitAffiliatePayeeProfileAction(form: FormData) {
  const context = await memberContext(form);
  const optional = (name: string) => { const value = form.get(name); return typeof value === "string" && value.trim() ? value.trim() : undefined; };
  return finish(context.path, () => submitAffiliatePayeeProfile(getDb(), context.actor, context.scope, {
    expectedRevision: Revision.parse(form.get("expectedRevision")),
    bank: { accountName: form.get("accountName"), bankCode: form.get("bankCode"), accountNumber: form.get("accountNumber") },
    taxIdentity: form.get("taxIdentity"), recipientType: form.get("recipientType"), nhiTreatment: form.get("nhiTreatment"), exemptionReference: optional("exemptionReference"), invoiceReference: optional("invoiceReference"),
  }));
}
export async function createAffiliateRemunerationQuoteAction(form: FormData) {
  const context = await memberContext(form);
  return finish(context.path, async () => {
    const policy = await getDb().merchantAffiliatePayoutPolicy.findUnique({ where: { vendorId: context.scope.vendorId }, select: { bankFeeCents: true, enabled: true } });
    if (!policy?.enabled) return null;
    return createAffiliateRemunerationQuote(getDb(), context.actor, context.scope, Id.parse(form.get("payoutId")), { bankFeeCents: policy.bankFeeCents });
  });
}
export async function signAffiliateRemunerationQuoteAction(form: FormData) {
  const context = await memberContext(form);
  return finish(context.path, async () => {
    if (form.get("consent") !== "on") return null;
    return signAffiliateRemunerationQuote(getDb(), context.actor, context.scope, Id.parse(form.get("snapshotId")), Revision.parse(form.get("expectedRevision")));
  });
}
export async function approveAffiliatePayeeProfileAction(form: FormData) {
  await assertServerActionSecurity(form);
  const { vendor, auth } = await requireVendorManagerContext();
  if (!["affiliate_program", "tax_remuneration"].every(feature => vendor.enabledFeatureModules.includes(feature))) notFound();
  const affiliateId = Id.parse(form.get("affiliateId"));
  const path = `/affiliates/${encodeURIComponent(affiliateId)}/remuneration`;
  return finish(path, async () => {
    if (form.get("reviewConfirmed") !== "on") return null;
    return approveAffiliatePayeeProfile(getDb(), { userId: auth.user.id }, { vendorId: vendor.id, affiliateId }, Revision.parse(form.get("expectedRevision")));
  });
}
