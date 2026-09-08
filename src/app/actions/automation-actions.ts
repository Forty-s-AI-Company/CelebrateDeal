"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { requireVendorOwner } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { AUTOMATION_TRIGGERS, dryRunAutomationRule, materializeAutomationRecipe } from "@/lib/automation-workflow";
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
  if (buttonUrl && !["{{voucher_url}}", "{{consultation_url}}", "{{webinar_url}}"].includes(buttonUrl) && !/^https:\/\//i.test(buttonUrl)) throw new Error("invalid");
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

function emailAction(form: FormData): Record<string, unknown> | null {
  if (form.get("actionEmail") !== "on") return null;
  const template = text(form, "emailTemplate");
  if (!["consultation_confirmation", "class_reminder", "repurchase_followup", "webinar_replay"].includes(template)) throw new Error("invalid");
  return { type: "send_email_notification", template };
}

function parseRule(form: FormData) {
  const name = text(form, "name");
  const trigger = text(form, "trigger");
  const conditionValue = number(form, "conditionValue");
  if (!name || name.length > 120 || !AUTOMATION_TRIGGERS.includes(trigger as typeof AUTOMATION_TRIGGERS[number])) throw new Error("invalid");
  const needsThreshold = ["payment_paid", "viewer_watch_progress", "webinar_attended_duration_gte"].includes(trigger);
  const condition = trigger === "payment_paid"
    ? { type: "order_amount_gte", amountCents: Math.round(conditionValue * 100) }
    : ["viewer_watch_progress", "webinar_attended_duration_gte"].includes(trigger)
      ? { type: "watch_seconds_gte", seconds: Math.round(conditionValue) }
      : { type: "always" };
  if (needsThreshold && (!Number.isInteger(conditionValue) || conditionValue < 1)) throw new Error("invalid");
  const actions = [voucherAction(form), lineAction(form), emailAction(form), tagAction(form)]
    .filter((action): action is Record<string, unknown> => action !== null);
  if (!actions.length) throw new Error("no_action");
  return { name, trigger, condition, actions };
}


export async function createAutomationRecipeAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const recipeId = text(formData, "recipeId");
  const productId = text(formData, "productId") || undefined;
  const recipe = materializeAutomationRecipe(recipeId, productId);
  if (!recipe) fail(productId ? "invalid_recipe" : "recipe_requires_product");
  if (recipe.actions.some((action) => action.type === "issue_repurchase_voucher")) {
    const validProduct = await getDb().product.findFirst({ where: { id: productId, vendorId: auth.vendor.id, isActive: true }, select: { id: true } });
    if (!validProduct) fail("invalid_product");
  }
  const created = await getDb().automationRule.create({ data: {
    vendorId: auth.vendor.id,
    name: recipe.name,
    description: recipe.description,
    trigger: recipe.trigger,
    condition: recipe.condition as Prisma.InputJsonValue,
    actions: recipe.actions as Prisma.InputJsonArray,
  } });
  await writeAuditLog({ vendorId: auth.vendor.id, actorId: auth.user.id, actorLabel: auth.member.role, action: "create_automation_recipe", targetType: "AutomationRule", targetId: created.id, after: auditSnapshot(created) });
  revalidatePath(PATH);
  redirect(`${PATH}?updated=recipe_created`);
}

export async function dryRunAutomationRuleAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const id = text(formData, "ruleId");
  const existing = await getDb().automationRule.findFirst({ where: { id, vendorId: auth.vendor.id }, select: { id: true, condition: true, actions: true, trigger: true } });
  if (!existing || !AUTOMATION_TRIGGERS.includes(existing.trigger as typeof AUTOMATION_TRIGGERS[number])) fail("not_found");
  const result = dryRunAutomationRule({ condition: existing.condition, actions: existing.actions }, {
    vendorId: auth.vendor.id,
    eventId: "dry-run",
    trigger: existing.trigger as typeof AUTOMATION_TRIGGERS[number],
    subjectType: "buyer_registration",
    subjectId: "dry-run",
    subjectKeyHash: "dry-run",
    orderAmountCents: Math.round(number(formData, "orderAmount") * 100),
    watchSecondsTotal: Math.round(number(formData, "watchSeconds")),
    hasPurchased: formData.get("hasPurchased") === "on",
  });
  redirect(`${PATH}?dryRun=${encodeURIComponent(result.status)}&rule=${encodeURIComponent(id)}`);
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
