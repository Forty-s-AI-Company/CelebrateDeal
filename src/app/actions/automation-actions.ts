"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { requireVendorOwner } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { AUTOMATION_TRIGGERS } from "@/lib/automation-workflow";
import { getDb } from "@/lib/db";

const PATH = "/settings/automations";
const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const number = (form: FormData, name: string) => Number(text(form, name));
function fail(code: string): never { redirect(`${PATH}?error=${encodeURIComponent(code)}`); }

function lineAction(form: FormData): Record<string, unknown> | null {
  if (form.get("actionLine") !== "on") return null;
  const message = text(form, "lineMessage");
  const buttonLabel = text(form, "buttonLabel");
  const buttonUrl = text(form, "buttonUrl");
  if (!message || message.length > 1500 || (buttonLabel && !buttonUrl)) throw new Error("invalid");
  if (buttonUrl && buttonUrl !== "{{voucher_url}}" && !/^https:\/\//i.test(buttonUrl)) throw new Error("invalid");
  return { type: "line_push", message, buttonLabel: buttonLabel || null, buttonUrl: buttonUrl || null };
}

function voucherAction(form: FormData): Record<string, unknown> | null {
  if (form.get("actionVoucher") !== "on") return null;
  const productId = text(form, "productId");
  const discountType = text(form, "discountType");
  const discountValue = number(form, "discountValue");
  const expiresInDays = number(form, "expiresInDays");
  if (!productId || !["fixed", "percentage"].includes(discountType) || !Number.isInteger(discountValue) || discountValue < 1 || (discountType === "percentage" && discountValue > 99) || !Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365) throw new Error("invalid");
  return {
    type: "issue_repurchase_voucher",
    productId,
    discountType,
    discountValue: discountType === "fixed" ? discountValue * 100 : discountValue,
    expiresInDays,
  };
}

function tagAction(form: FormData): Record<string, unknown> | null {
  if (form.get("actionTag") !== "on") return null;
  const tag = text(form, "customerTag");
  if (!tag || tag.length > 50) throw new Error("invalid");
  return { type: "add_customer_tag", tag };
}

function parseRule(form: FormData) {
  const name = text(form, "name");
  const trigger = text(form, "trigger");
  const conditionValue = number(form, "conditionValue");
  if (!name || name.length > 120 || !AUTOMATION_TRIGGERS.includes(trigger as typeof AUTOMATION_TRIGGERS[number])) throw new Error("invalid");
  const condition = trigger === "payment_paid"
    ? { type: "order_amount_gte", amountCents: Math.round(conditionValue * 100) }
    : { type: "watch_seconds_gte", seconds: Math.round(conditionValue) };
  if (!Number.isInteger(conditionValue) || conditionValue < 1) throw new Error("invalid");
  const actions = [voucherAction(form), lineAction(form), tagAction(form)]
    .filter((action): action is Record<string, unknown> => action !== null);
  if (!actions.length) throw new Error("no_action");
  return { name, trigger, condition, actions };
}

export async function createAutomationRuleAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  let parsed: ReturnType<typeof parseRule>;
  try { parsed = parseRule(formData); } catch (error) { fail(error instanceof Error && error.message === "no_action" ? "no_action" : "invalid_rule"); }
  const productId = parsed.actions.find((a) => a.type === "issue_repurchase_voucher")?.productId;
  if (productId && !(await getDb().product.findFirst({ where: { id: String(productId), vendorId: auth.vendor.id, isActive: true }, select: { id: true } }))) fail("invalid_product");
  const created = await getDb().automationRule.create({ data: { vendorId: auth.vendor.id, name: parsed.name, trigger: parsed.trigger, condition: parsed.condition as Prisma.InputJsonValue, actions: parsed.actions as Prisma.InputJsonArray } });
  await writeAuditLog({ vendorId: auth.vendor.id, actorId: auth.user.id, actorLabel: auth.member.role, action: "create_automation_rule", targetType: "AutomationRule", targetId: created.id, after: auditSnapshot(created) });
  revalidatePath(PATH);
  redirect(`${PATH}?updated=created`);
}

export async function toggleAutomationRuleAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const id = text(formData, "ruleId");
  if (!id) fail("invalid_rule");
  const existing = await getDb().automationRule.findFirst({ where: { id, vendorId: auth.vendor.id }, select: { id: true, isActive: true } });
  if (!existing) fail("not_found");
  const updated = await getDb().automationRule.update({
    where: { vendorId_id: { vendorId: auth.vendor.id, id: existing.id } },
    data: { isActive: !existing.isActive },
  });
  await writeAuditLog({ vendorId: auth.vendor.id, actorId: auth.user.id, actorLabel: auth.member.role, action: updated.isActive ? "activate_automation_rule" : "deactivate_automation_rule", targetType: "AutomationRule", targetId: updated.id, before: auditSnapshot(existing), after: auditSnapshot(updated) });
  revalidatePath(PATH);
  redirect(`${PATH}?updated=toggled`);
}
