"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { requireVendorManagerMember } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import {
  automationTriggerNeedsThreshold,
  dryRunAutomationRule,
  isAutomationTrigger,
  isAvailableAutomationTrigger,
  isSafeNewAutomationButtonUrl,
  materializeAutomationRecipe,
} from "@/lib/automation-workflow";
import { getDb } from "@/lib/db";

// Owner and admin manage automations here, the same roles as the funnel
// automation panel (requireVendorManagerContext) and message templates (F-4
// gap 3). Every action resolves the vendor from the session and binds each
// rule id to it in the final query.
const PATH = "/settings/automations";
const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const number = (form: FormData, name: string) => Number(text(form, name));
function fail(code: string): never { redirect(`${PATH}?error=${encodeURIComponent(code)}`); }

class TriggerUnavailableError extends Error {
  constructor() { super("trigger_unavailable"); }
}

function lineAction(form: FormData): Record<string, unknown> | null {
  if (form.get("actionLine") !== "on") return null;
  const message = text(form, "lineMessage");
  const buttonLabel = text(form, "buttonLabel");
  const buttonUrl = text(form, "buttonUrl");
  if (!message || message.length > 1500 || (buttonLabel && !buttonUrl)) throw new Error("invalid");
  if (!isSafeNewAutomationButtonUrl(buttonUrl)) throw new Error("invalid_button_url");
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

/** Kept for every known trigger, so the threshold triggers work again once they are made available. */
function ruleCondition(trigger: string, conditionValue: number) {
  if (automationTriggerNeedsThreshold(trigger) && (!Number.isInteger(conditionValue) || conditionValue < 1)) throw new Error("invalid");
  if (trigger === "payment_paid") return { type: "order_amount_gte", amountCents: Math.round(conditionValue * 100) };
  if (trigger === "viewer_watch_progress" || trigger === "webinar_attended_duration_gte") return { type: "watch_seconds_gte", seconds: Math.round(conditionValue) };
  return { type: "always" };
}

function parseRule(form: FormData) {
  const name = text(form, "name");
  const trigger = text(form, "trigger");
  const conditionValue = number(form, "conditionValue");
  if (!name || name.length > 120 || !isAutomationTrigger(trigger)) throw new Error("invalid");
  // A known trigger without a production caller (F-4 gap 2) is refused here,
  // not only hidden in the form.
  if (!isAvailableAutomationTrigger(trigger)) throw new TriggerUnavailableError();
  const condition = ruleCondition(trigger, conditionValue);
  const actions = [voucherAction(form), lineAction(form), emailAction(form), tagAction(form)]
    .filter((action): action is Record<string, unknown> => action !== null);
  if (!actions.length) throw new Error("no_action");
  return { name, trigger, condition, actions };
}


export async function createAutomationRecipeAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { user, vendor, member } = await requireVendorManagerMember(PATH);
  const recipeId = text(formData, "recipeId");
  const productId = text(formData, "productId") || undefined;
  const recipe = materializeAutomationRecipe(recipeId, productId);
  if (!recipe) fail(productId ? "invalid_recipe" : "recipe_requires_product");
  if (!isAvailableAutomationTrigger(recipe.trigger)) fail("trigger_unavailable");
  if (recipe.actions.some((action) => action.type === "issue_repurchase_voucher")) {
    const validProduct = await getDb().product.findFirst({ where: { id: productId, vendorId: vendor.id, isActive: true }, select: { id: true } });
    if (!validProduct) fail("invalid_product");
  }
  const created = await getDb().automationRule.create({ data: {
    vendorId: vendor.id,
    name: recipe.name,
    description: recipe.description,
    trigger: recipe.trigger,
    condition: recipe.condition as Prisma.InputJsonValue,
    actions: recipe.actions as Prisma.InputJsonArray,
  } });
  await writeAuditLog({ vendorId: vendor.id, actorId: user.id, actorLabel: member.role, action: "create_automation_recipe", targetType: "AutomationRule", targetId: created.id, after: auditSnapshot(created) });
  revalidatePath(PATH);
  redirect(`${PATH}?updated=recipe_created`);
}

export async function dryRunAutomationRuleAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { vendor } = await requireVendorManagerMember(PATH);
  const id = text(formData, "ruleId");
  const existing = await getDb().automationRule.findFirst({ where: { id, vendorId: vendor.id }, select: { id: true, condition: true, actions: true, trigger: true } });
  if (!existing || !isAutomationTrigger(existing.trigger)) fail("not_found");
  // A rule whose trigger never fires would always "dispatch" in a simulation;
  // say that it does not run instead of a misleading result.
  if (!isAvailableAutomationTrigger(existing.trigger)) {
    redirect(`${PATH}?dryRun=trigger_unavailable`);
  }
  const result = dryRunAutomationRule({ condition: existing.condition, actions: existing.actions }, {
    vendorId: vendor.id,
    eventId: "dry-run",
    trigger: existing.trigger,
    subjectType: "buyer_registration",
    subjectId: "dry-run",
    subjectKeyHash: "dry-run",
    orderAmountCents: Math.round(number(formData, "orderAmount") * 100),
    watchSecondsTotal: Math.round(number(formData, "watchSeconds")),
    hasPurchased: formData.get("hasPurchased") === "on",
  });
  redirect(`${PATH}?dryRun=${encodeURIComponent(result.status)}`);
}

export async function createAutomationRuleAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { user, vendor, member } = await requireVendorManagerMember(PATH);
  let parsed: ReturnType<typeof parseRule>;
  try { parsed = parseRule(formData); } catch (error) { fail(error instanceof Error && (error.message === "no_action" || error.message === "invalid_button_url" || error.message === "trigger_unavailable") ? error.message : "invalid_rule"); }
  const productId = parsed.actions.find((a) => a.type === "issue_repurchase_voucher")?.productId;
  if (productId && !(await getDb().product.findFirst({ where: { id: String(productId), vendorId: vendor.id, isActive: true }, select: { id: true } }))) fail("invalid_product");
  const created = await getDb().automationRule.create({ data: { vendorId: vendor.id, name: parsed.name, trigger: parsed.trigger, condition: parsed.condition as Prisma.InputJsonValue, actions: parsed.actions as Prisma.InputJsonArray } });
  await writeAuditLog({ vendorId: vendor.id, actorId: user.id, actorLabel: member.role, action: "create_automation_rule", targetType: "AutomationRule", targetId: created.id, after: auditSnapshot(created) });
  revalidatePath(PATH);
  redirect(`${PATH}?updated=created`);
}

export async function toggleAutomationRuleAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { user, vendor, member } = await requireVendorManagerMember(PATH);
  const id = text(formData, "ruleId");
  if (!id) fail("invalid_rule");
  const existing = await getDb().automationRule.findFirst({ where: { id, vendorId: vendor.id }, select: { id: true, isActive: true, trigger: true } });
  if (!existing) fail("not_found");
  // Switching off always works; switching on needs a trigger that can run.
  if (!existing.isActive && !isAvailableAutomationTrigger(existing.trigger)) fail("trigger_unavailable");
  // Conditional on the state just read, so a rule deleted (or switched) in
  // the meantime is reported instead of throwing.
  const updated = await getDb().automationRule.updateMany({
    where: { id: existing.id, vendorId: vendor.id, isActive: existing.isActive },
    data: { isActive: !existing.isActive },
  });
  if (updated.count !== 1) fail("not_found");
  const after = { ...existing, isActive: !existing.isActive };
  await writeAuditLog({ vendorId: vendor.id, actorId: user.id, actorLabel: member.role, action: after.isActive ? "activate_automation_rule" : "deactivate_automation_rule", targetType: "AutomationRule", targetId: existing.id, before: auditSnapshot(existing), after: auditSnapshot(after) });
  revalidatePath(PATH);
  redirect(`${PATH}?updated=toggled`);
}

/** A delete waits at most this long for a running execution to commit its log row. */
const DELETE_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

type DeleteOutcome =
  | { code: "not_found" | "delete_requires_inactive" | "delete_has_history" }
  | { code: "deleted"; before: { id: string; name: string; trigger: string; isActive: boolean; funnelPageId: string | null } };

/**
 * Deletes a switched-off rule that has never run. Execution logs cascade to
 * the tags and vouchers they issued (schema onDelete: Cascade), so a rule with
 * history is kept and can only be switched off.
 *
 * The rule row is locked FOR UPDATE first. An execution log being written
 * holds a key-share lock on it (its foreign key), so the delete waits for that
 * write to commit; the checks then run as new statements and see the log, and
 * the rule stays. An execution that starts after the lock waits instead and
 * finds its rule gone (runAutomationEvent skips it). A concurrent re-enable is
 * serialized the same way.
 */
export async function deleteAutomationRuleAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { user, vendor, member } = await requireVendorManagerMember(PATH);
  const id = text(formData, "ruleId");
  if (!id) fail("invalid_rule");
  const outcome = await getDb().$transaction(async (tx): Promise<DeleteOutcome> => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "AutomationRule" WHERE "id" = ${id} AND "vendorId" = ${vendor.id} FOR UPDATE
    `;
    if (locked.length === 0) return { code: "not_found" };
    const rule = await tx.automationRule.findFirst({
      where: { id, vendorId: vendor.id },
      select: { id: true, name: true, trigger: true, isActive: true, funnelPageId: true },
    });
    if (!rule) return { code: "not_found" };
    if (rule.isActive) return { code: "delete_requires_inactive" };
    const history = await tx.automationExecutionLog.count({ where: { vendorId: vendor.id, ruleId: rule.id } });
    if (history > 0) return { code: "delete_has_history" };
    await tx.automationRule.delete({ where: { vendorId_id: { vendorId: vendor.id, id: rule.id } } });
    return { code: "deleted", before: rule };
  }, DELETE_TRANSACTION_OPTIONS);
  if (outcome.code !== "deleted") fail(outcome.code);
  await writeAuditLog({ vendorId: vendor.id, actorId: user.id, actorLabel: member.role, action: "delete_automation_rule", targetType: "AutomationRule", targetId: outcome.before.id, before: auditSnapshot(outcome.before) });
  revalidatePath(PATH);
  redirect(`${PATH}?updated=deleted`);
}
