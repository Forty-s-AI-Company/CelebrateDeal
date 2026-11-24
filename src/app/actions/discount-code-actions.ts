"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { requireVendorManagerContext } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import {
  createDiscountCode,
  DiscountCodeAdminError,
  parseDiscountCodeForm,
  setDiscountCodeActive,
  updateDiscountCode,
  type DiscountCodeDraft,
} from "@/lib/discount-code-admin";

const LIST_PATH = "/discount-codes";
const ID = /^[A-Za-z0-9_-]{1,128}$/u;

function formId(formData: FormData) {
  const value = formData.get("id");
  return typeof value === "string" && ID.test(value) ? value : null;
}

/** Audit keeps the terms, never buyer data. */
function auditTerms(draft: DiscountCodeDraft) {
  return auditSnapshot({
    code: draft.normalizedCode,
    discountType: draft.discountType,
    discountValue: draft.discountValue,
    appliesToAllProducts: draft.appliesToAllProducts,
    productCount: draft.productIds.length,
    startsAt: draft.startsAt?.toISOString() ?? null,
    endsAt: draft.endsAt?.toISOString() ?? null,
    maxRedemptions: draft.maxRedemptions,
    maxRedemptionsPerBuyer: draft.maxRedemptionsPerBuyer,
    minSubtotalCents: draft.minSubtotalCents,
    isActive: draft.isActive,
  });
}

export async function createDiscountCodeAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext(LIST_PATH);
  const parsed = parseDiscountCodeForm(formData, vendor.timezone);
  if (!parsed.ok) redirect(`${LIST_PATH}?error=${parsed.error}`);
  let created: { id: string };
  try {
    created = await createDiscountCode(getDb(), vendor.id, parsed.draft);
  } catch (error) {
    if (error instanceof DiscountCodeAdminError) redirect(`${LIST_PATH}?error=${error.code}`);
    throw error;
  }
  await writeAuditLog({ vendorId: vendor.id, actorId: auth.user.id, action: "discount_code_created", targetType: "DiscountCode", targetId: created.id, after: auditTerms(parsed.draft) });
  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}?updated=created`);
}

export async function updateDiscountCodeAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext(LIST_PATH);
  const id = formId(formData);
  if (!id) redirect(`${LIST_PATH}?error=not_found`);
  const editPath = `${LIST_PATH}/${encodeURIComponent(id)}`;
  const parsed = parseDiscountCodeForm(formData, vendor.timezone);
  if (!parsed.ok) redirect(`${editPath}?error=${parsed.error}`);
  try {
    await updateDiscountCode(getDb(), vendor.id, id, parsed.draft);
  } catch (error) {
    if (error instanceof DiscountCodeAdminError) redirect(`${error.code === "not_found" ? LIST_PATH : editPath}?error=${error.code}`);
    throw error;
  }
  await writeAuditLog({ vendorId: vendor.id, actorId: auth.user.id, action: "discount_code_updated", targetType: "DiscountCode", targetId: id, after: auditTerms(parsed.draft) });
  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}?updated=saved`);
}

export async function setDiscountCodeActiveAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext(LIST_PATH);
  const id = formId(formData);
  if (!id) redirect(`${LIST_PATH}?error=not_found`);
  const isActive = formData.get("isActive") === "true";
  try {
    await setDiscountCodeActive(getDb(), vendor.id, id, isActive);
  } catch (error) {
    if (error instanceof DiscountCodeAdminError) redirect(`${LIST_PATH}?error=${error.code}`);
    throw error;
  }
  await writeAuditLog({ vendorId: vendor.id, actorId: auth.user.id, action: isActive ? "discount_code_enabled" : "discount_code_disabled", targetType: "DiscountCode", targetId: id, after: auditSnapshot({ isActive }) });
  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}?updated=${isActive ? "enabled" : "disabled"}`);
}
