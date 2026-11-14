"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { requireVendorManagerMember } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import {
  AUTOMATION_DELAYED_STEPS_FEATURE,
  automationTriggerNeedsThreshold,
  dryRunAutomationRule,
  isAutomationTrigger,
  isAvailableAutomationTrigger,
  isSafeNewAutomationButtonUrl,
  materializeAutomationRecipe,
} from "@/lib/automation-workflow";
import {
  createAutomationRuleStep,
  deleteAutomationRuleStep,
  stopDelayedStepRunsOfRule,
  updateAutomationRuleStep,
  type AutomationStepInput,
} from "@/lib/automation-delayed-steps";
import {
  LINE_PUSH_OWNER_ONLY,
  mayConfigureAutomationLinePush,
  mayWriteAutomationActions,
  storedAutomationRuleIncludesLinePush,
} from "@/lib/automation-line-push-policy";
import { getDb } from "@/lib/db";
import { requireFeature } from "@/lib/feature-gates";
import { isLockTimeout } from "@/lib/serializable-retry";

// Owner and admin manage automations here, the same roles as the funnel
// automation panel (requireVendorManagerContext) and message templates (F-4
// gap 3). Every action resolves the vendor from the session and binds each
// rule id to it in the final query. The custom LINE push action is owner-only
// (owner decision 2026-11-14, src/lib/automation-line-push-policy.ts): judged
// on the server-parsed actions and the stored rule, before anything is written.
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

/**
 * payment_paid needs a paid-amount threshold (NT$, stored in cents and
 * compared with the order's server-recorded paidAmountCents). The watch
 * triggers keep theirs for when they are made available again.
 */
function ruleCondition(trigger: string, conditionValue: number) {
  if (automationTriggerNeedsThreshold(trigger) && (!Number.isInteger(conditionValue) || conditionValue < 1)) throw new Error("invalid");
  if (trigger === "payment_paid") return { type: "order_amount_gte", amountCents: Math.round(conditionValue * 100) };
  if (trigger === "viewer_watch_progress" || trigger === "webinar_attended_duration_gte") return { type: "watch_seconds_gte", seconds: Math.round(conditionValue) };
  return { type: "always" };
}

/** The action checkboxes and fields shared by the rule form and every delayed-step form. */
function parseActions(form: FormData) {
  const actions = [voucherAction(form), lineAction(form), emailAction(form), tagAction(form)]
    .filter((action): action is Record<string, unknown> => action !== null);
  if (!actions.length) throw new Error("no_action");
  return actions;
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
  const actions = parseActions(form);
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
  if (!mayWriteAutomationActions(member.role, recipe.actions)) fail(LINE_PUSH_OWNER_ONLY);
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
  if (!mayWriteAutomationActions(member.role, parsed.actions)) fail(LINE_PUSH_OWNER_ONLY);
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
  let outcome: ToggleOutcome;
  try {
    outcome = await toggleRule(vendor.id, existing, mayConfigureAutomationLinePush(member.role));
  } catch (error) {
    if (!isDeleteBusy(error)) throw error;
    fail("toggle_busy");
  }
  if (outcome.code !== "toggled") fail(outcome.code);
  const after = { ...existing, isActive: !existing.isActive, cancelledRuns: outcome.cancelledRuns };
  await writeAuditLog({ vendorId: vendor.id, actorId: user.id, actorLabel: member.role, action: after.isActive ? "activate_automation_rule" : "deactivate_automation_rule", targetType: "AutomationRule", targetId: existing.id, before: auditSnapshot(existing), after: auditSnapshot(after) });
  revalidatePath(PATH);
  redirect(`${PATH}?updated=toggled`);
}

type ToggleOutcome = { code: "toggled"; cancelledRuns: number } | { code: "toggle_conflict" | "not_found" | typeof LINE_PUSH_OWNER_ONLY };

/**
 * Switches a rule on or off. The rule row is locked FOR UPDATE first (bound to
 * the vendor), in the same order as the delayed-step worker (rule FOR SHARE,
 * then the run) and the step editor (rule FOR UPDATE). The update stays
 * conditional on the state read before, so a rule switched or deleted in the
 * meantime is reported instead of overwritten. Switching off also stops every
 * active delayed-step run of the rule in the same transaction
 * (`definition_paused`, F-4 review M1): switching it on again never revives
 * them, even before their next step was due.
 *
 * Switching on starts the rule's custom LINE pushes again, so without
 * `linePushAllowed` (not the owner) a rule that has one (immediate actions or
 * any step, read after the lock) stays off. Switching off is always allowed.
 */
function toggleRule(vendorId: string, existing: { id: string; isActive: boolean }, linePushAllowed: boolean) {
  return getDb().$transaction(async (tx): Promise<ToggleOutcome> => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
    await tx.$queryRaw`SELECT "id" FROM "AutomationRule" WHERE "id" = ${existing.id} AND "vendorId" = ${vendorId} FOR UPDATE`;
    if (!existing.isActive && !linePushAllowed) {
      const hasLinePush = await storedAutomationRuleIncludesLinePush(tx, { vendorId, ruleId: existing.id });
      if (hasLinePush === null) return { code: "not_found" };
      if (hasLinePush) return { code: LINE_PUSH_OWNER_ONLY };
    }
    const updated = await tx.automationRule.updateMany({
      where: { id: existing.id, vendorId, isActive: existing.isActive },
      data: { isActive: !existing.isActive },
    });
    if (updated.count !== 1) {
      const stillThere = await tx.automationRule.findFirst({ where: { id: existing.id, vendorId }, select: { id: true } });
      return { code: stillThere ? "toggle_conflict" : "not_found" };
    }
    if (!existing.isActive) return { code: "toggled", cancelledRuns: 0 };
    const cancelled = await stopDelayedStepRunsOfRule(tx, { vendorId, ruleId: existing.id });
    return { code: "toggled", cancelledRuns: cancelled };
  }, DELETE_TRANSACTION_OPTIONS);
}

/** A delete waits at most this long for a running execution to commit its log row. */
const DELETE_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

type DeleteOutcome =
  | { code: "not_found" | "delete_requires_inactive" | "delete_has_history" }
  | { code: "deleted"; before: { id: string; name: string; trigger: string; isActive: boolean; funnelPageId: string | null } };

/**
 * Deletes a switched-off rule that has never run. Execution logs cascade to
 * the tags and vouchers they issued (schema onDelete: Cascade), so a rule with
 * history is kept and can only be switched off. The same holds for a rule
 * with delayed-step runs (F-4): it is never deleted, only switched off, which
 * stops its active runs at their next step (definition_paused).
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
  let outcome: DeleteOutcome;
  try {
    outcome = await deleteRuleIfUnused(vendor.id, id);
  } catch (error) {
    if (!isDeleteBusy(error)) throw error;
    // The rule stayed locked by a running execution (or no connection was
    // free) for too long: nothing changed, the merchant can simply retry.
    fail("delete_busy");
  }
  if (outcome.code !== "deleted") fail(outcome.code);
  await writeAuditLog({ vendorId: vendor.id, actorId: user.id, actorLabel: member.role, action: "delete_automation_rule", targetType: "AutomationRule", targetId: outcome.before.id, before: auditSnapshot(outcome.before) });
  revalidatePath(PATH);
  redirect(`${PATH}?updated=deleted`);
}

/** lock_timeout (55P03) on the rule row, or the transaction could not start or finish in time (P2028). */
function isDeleteBusy(error: unknown) {
  return isLockTimeout(error) || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028");
}

function deleteRuleIfUnused(vendorId: string, id: string) {
  return getDb().$transaction(async (tx): Promise<DeleteOutcome> => {
    // Waiting for a running execution is bounded well inside the transaction timeout.
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "AutomationRule" WHERE "id" = ${id} AND "vendorId" = ${vendorId} FOR UPDATE
    `;
    if (locked.length === 0) return { code: "not_found" };
    const rule = await tx.automationRule.findFirst({
      where: { id, vendorId },
      select: { id: true, name: true, trigger: true, isActive: true, funnelPageId: true },
    });
    if (!rule) return { code: "not_found" };
    if (rule.isActive) return { code: "delete_requires_inactive" };
    const history = await tx.automationExecutionLog.count({ where: { vendorId, ruleId: rule.id } });
    if (history > 0) return { code: "delete_has_history" };
    // F-4: a delayed-step run is only ever created after the event's
    // execution log, so a rule with runs already has history; checked here
    // too so a rule with people part-way through can never be deleted (its
    // steps would cascade under them). Its steps go with the rule.
    const runs = await tx.delayedStepRun.count({ where: { vendorId, automationRuleId: rule.id } });
    if (runs > 0) return { code: "delete_has_history" };
    await tx.automationRule.delete({ where: { vendorId_id: { vendorId, id: rule.id } } });
    return { code: "deleted", before: rule };
  }, DELETE_TRANSACTION_OPTIONS);
}

// ---------------------------------------------------------------------------
// F-4 delayed steps (docs/product/delayed-steps-design.md §8). Same roles and
// CSRF check as every action above; the rule and step ids from the form are
// bound to the session's vendor in the final query (automation-delayed-steps.ts
// locks the rule row by id AND vendorId, and reads or writes the step by id,
// vendorId AND ruleId), so another tenant's rule or step is "not_found".
// ---------------------------------------------------------------------------

const STEP_ERROR_CODES = new Set([
  "not_found",
  "trigger_unavailable",
  "steps_unsupported",
  "invalid_step",
  "invalid_delay",
  "duplicate_delay",
  "step_limit",
  "invalid_product",
  "step_busy",
  "no_action",
  "invalid_button_url",
  LINE_PUSH_OWNER_ONLY,
]);

function stepFail(code: string): never {
  fail(STEP_ERROR_CODES.has(code) ? code : "invalid_step");
}

/** Hours or days only (the job runs at most every few minutes; §3「時間精度」). */
function stepDelayMinutes(form: FormData) {
  const value = number(form, "delayValue");
  const unit = text(form, "delayUnit");
  if (!Number.isInteger(value) || value < 1 || (unit !== "hours" && unit !== "days")) throw new Error("invalid_delay");
  return value * (unit === "days" ? 1_440 : 60);
}

function parseStep(form: FormData): AutomationStepInput {
  let delayMinutes: number;
  try { delayMinutes = stepDelayMinutes(form); } catch { throw new Error("invalid_delay"); }
  return {
    delayMinutes,
    // The three triggers that take delayed steps (DELAYED_STEP_AUTOMATION_
    // TRIGGERS) carry no amount or watch time, so the existing condition
    // schema only has "always" for them. payment_paid rules take no steps.
    condition: { type: "always" },
    actions: parseActions(form),
    isActive: form.get("stepActive") === "on",
  };
}

function parsedStepOrFail(form: FormData) {
  try {
    return parseStep(form);
  } catch (error) {
    stepFail(error instanceof Error ? error.message : "invalid_step");
  }
}

export async function createAutomationRuleStepAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { user, vendor, member } = await requireVendorManagerMember(PATH);
  // Closed beta (F-4 review M3): only a vendor holding the grant.
  requireFeature(vendor, AUTOMATION_DELAYED_STEPS_FEATURE);
  const ruleId = text(formData, "ruleId");
  if (!ruleId) stepFail("not_found");
  const step = parsedStepOrFail(formData);
  const linePushAllowed = mayConfigureAutomationLinePush(member.role);
  // Refused before any query; the rule's own LINE push is checked under its lock.
  if (!mayWriteAutomationActions(member.role, step.actions)) stepFail(LINE_PUSH_OWNER_ONLY);
  const result = await createAutomationRuleStep({ vendorId: vendor.id, ruleId, step, linePushAllowed });
  if (!result.ok) stepFail(result.code);
  await writeAuditLog({ vendorId: vendor.id, actorId: user.id, actorLabel: member.role, action: "create_automation_rule_step", targetType: "AutomationRuleStep", targetId: result.id, after: auditSnapshot({ ruleId, ...result.after }) });
  revalidatePath(PATH);
  redirect(`${PATH}?updated=step_created`);
}

export async function updateAutomationRuleStepAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { user, vendor, member } = await requireVendorManagerMember(PATH);
  requireFeature(vendor, AUTOMATION_DELAYED_STEPS_FEATURE);
  const ruleId = text(formData, "ruleId");
  const stepId = text(formData, "stepId");
  if (!ruleId || !stepId) stepFail("not_found");
  const step = parsedStepOrFail(formData);
  const linePushAllowed = mayConfigureAutomationLinePush(member.role);
  if (!mayWriteAutomationActions(member.role, step.actions)) stepFail(LINE_PUSH_OWNER_ONLY);
  const result = await updateAutomationRuleStep({ vendorId: vendor.id, ruleId, stepId, step, linePushAllowed });
  if (!result.ok) stepFail(result.code);
  await writeAuditLog({ vendorId: vendor.id, actorId: user.id, actorLabel: member.role, action: "update_automation_rule_step", targetType: "AutomationRuleStep", targetId: result.id, before: auditSnapshot({ ruleId, ...result.before }), after: auditSnapshot({ ruleId, ...result.after }) });
  revalidatePath(PATH);
  redirect(`${PATH}?updated=step_updated`);
}

export async function deleteAutomationRuleStepAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { user, vendor, member } = await requireVendorManagerMember(PATH);
  requireFeature(vendor, AUTOMATION_DELAYED_STEPS_FEATURE);
  const ruleId = text(formData, "ruleId");
  const stepId = text(formData, "stepId");
  if (!ruleId || !stepId) stepFail("not_found");
  const result = await deleteAutomationRuleStep({ vendorId: vendor.id, ruleId, stepId });
  if (!result.ok) stepFail(result.code);
  await writeAuditLog({ vendorId: vendor.id, actorId: user.id, actorLabel: member.role, action: "delete_automation_rule_step", targetType: "AutomationRuleStep", targetId: result.id, before: auditSnapshot({ ruleId, ...result.before }) });
  revalidatePath(PATH);
  redirect(`${PATH}?updated=step_deleted`);
}
