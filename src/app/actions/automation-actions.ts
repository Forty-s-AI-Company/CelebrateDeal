"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { requireVendorManagerMember } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { genericEmailContentUsable, normalizeGenericEmailContent } from "@/lib/automation-generic-email";
import {
  AUTOMATION_DELAYED_STEPS_FEATURE,
  AUTOMATION_EMAIL_TEMPLATES,
  automationActionsEmailTemplatesUsable,
  automationTriggerNeedsThreshold,
  dryRunAutomationRule,
  isAutomationRuleRunnableForVendor,
  isAutomationTrigger,
  isAutomationTriggerAvailableForVendor,
  isSafeNewAutomationButtonUrl,
  isWatchDurationMinutes,
  isWatchProgressPercent,
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
  storedAutomationRuleSendsLine,
  withVoucherLineNotification,
} from "@/lib/automation-line-push-policy";
import { reportCancelledRuleLockWait } from "@/lib/automation-rule-lock";
import { getDb } from "@/lib/db";
import { requireFeature } from "@/lib/feature-gates";
import { isRuleWriteBusy } from "@/lib/serializable-retry";
import type { FeatureGateVendor } from "@/lib/vendor-feature-toggles";

// Owner and admin manage automations here, the same roles as the funnel
// automation panel (requireVendorManagerContext) and message templates (F-4
// gap 3). Every action resolves the vendor from the session and binds each
// rule id to it in the final query. The custom LINE push action and a
// voucher's LINE notification are owner-only (owner decisions 2026-11-14 and
// 2026-11-15, src/lib/automation-line-push-policy.ts): judged on the
// server-parsed actions and the stored rule, before anything is written. An
// admin's voucher actions are always saved with the LINE notification off.
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

/**
 * The owner's "also tell the buyer by LINE" checkbox. The form marks that it
 * showed the checkbox (`voucherLineNotificationShown`), so an unticked box is
 * off; a form without the marker (rendered before the checkbox existed) keeps
 * the previous behaviour, on. withVoucherLineNotification turns it off for
 * anyone but the owner, whatever was sent.
 */
function voucherLineNotificationRequested(form: FormData) {
  return form.get("voucherLineNotificationShown") !== "1" || form.get("voucherLineNotification") === "on";
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
    lineNotification: voucherLineNotificationRequested(form),
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
  if (!(AUTOMATION_EMAIL_TEMPLATES as readonly string[]).includes(template)) throw new Error("invalid");
  if (template !== "generic_message") return { type: "send_email_notification", template };
  // A2-04: the merchant's own subject (one line) and plain-text body.
  const content = normalizeGenericEmailContent({ subject: String(form.get("emailSubject") ?? ""), body: String(form.get("emailBody") ?? "") });
  if (!content) throw new Error("invalid_email_content");
  return { type: "send_email_notification", template, subject: content.subject, body: content.body };
}

/**
 * payment_paid needs a paid-amount threshold (NT$, stored in cents and
 * compared with the order's server-recorded paidAmountCents).
 * viewer_watch_progress (Q-11) needs a whole watch percent from 1 to 100 (its
 * own `watchPercent` field; the page offers 25/50/75/90), compared with the
 * server-counted progress. webinar_attended_duration_gte (Q-11) needs a whole
 * number of minutes from 1 to 1440 (its own `watchMinutes` field; the page
 * offers 5/15/30/60), compared with the same server-counted watch time.
 */
function ruleCondition(trigger: string, form: FormData) {
  if (trigger === "viewer_watch_progress") {
    const percent = number(form, "watchPercent");
    if (!isWatchProgressPercent(percent)) throw new Error("invalid");
    return { type: "watch_percent_gte", percent };
  }
  if (trigger === "webinar_attended_duration_gte") {
    const minutes = number(form, "watchMinutes");
    if (!isWatchDurationMinutes(minutes)) throw new Error("invalid");
    return { type: "watch_minutes_gte", minutes };
  }
  const conditionValue = number(form, "conditionValue");
  if (automationTriggerNeedsThreshold(trigger) && (!Number.isInteger(conditionValue) || conditionValue < 1)) throw new Error("invalid");
  if (trigger === "payment_paid") return { type: "order_amount_gte", amountCents: Math.round(conditionValue * 100) };
  return { type: "always" };
}

/**
 * The action checkboxes and fields shared by the rule form and every
 * delayed-step form. `linePushAllowed`: the actor is the owner; otherwise every
 * voucher is saved without its LINE notification.
 */
function parseActions(form: FormData, linePushAllowed: boolean) {
  const actions = [voucherAction(form), lineAction(form), emailAction(form), tagAction(form)]
    .filter((action): action is Record<string, unknown> => action !== null);
  if (!actions.length) throw new Error("no_action");
  return withVoucherLineNotification(actions, linePushAllowed);
}

function parseRule(form: FormData, linePushAllowed: boolean, vendor: FeatureGateVendor) {
  const name = text(form, "name");
  const trigger = text(form, "trigger");
  if (!name || name.length > 120 || !isAutomationTrigger(trigger)) throw new Error("invalid");
  // A known trigger without a production caller (F-4 gap 2), or one this
  // vendor's closed-beta grants do not open (form_no_show, Q-11 M-1;
  // viewer_watch_progress and webinar_attended_duration_gte, Q-11), is refused
  // here, not only hidden in the form.
  if (!isAutomationTriggerAvailableForVendor(trigger, vendor)) throw new TriggerUnavailableError();
  const condition = ruleCondition(trigger, form);
  const actions = parseActions(form, linePushAllowed);
  // Q-18: a template needs the link its trigger's event carries (or a voucher
  // in the same rule). Only new rules are held to it; stored ones are untouched.
  const emailActions = actions as Array<{ type: string; template?: string; subject?: unknown; body?: unknown }>;
  // A2-04: only the variables this trigger can supply may appear in the text.
  if (emailActions.some((action) => action.template === "generic_message" && !genericEmailContentUsable(trigger, action))) throw new Error("invalid_email_content");
  if (!automationActionsEmailTemplatesUsable(trigger, emailActions)) throw new Error("email_template_unavailable");
  return { name, trigger, condition, actions };
}


export async function createAutomationRecipeAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { user, vendor, member } = await requireVendorManagerMember(PATH);
  const recipeId = text(formData, "recipeId");
  const productId = text(formData, "productId") || undefined;
  const recipe = materializeAutomationRecipe(recipeId, productId);
  if (!recipe) fail(productId ? "invalid_recipe" : "recipe_requires_product");
  // A recipe whose condition its trigger does not run (「高意向追單漏斗」: the
  // old watch seconds and "not purchased yet", Q-11) is refused like a hidden one.
  if (!isAutomationRuleRunnableForVendor(recipe, vendor)) fail("trigger_unavailable");
  if (!automationActionsEmailTemplatesUsable(recipe.trigger, recipe.actions)) fail("email_template_unavailable");
  // A recipe's voucher announces itself by LINE for the owner, never for an admin.
  const actions = withVoucherLineNotification(recipe.actions, mayConfigureAutomationLinePush(member.role));
  if (!mayWriteAutomationActions(member.role, actions)) fail(LINE_PUSH_OWNER_ONLY);
  if (actions.some((action) => action.type === "issue_repurchase_voucher")) {
    const validProduct = await getDb().product.findFirst({ where: { id: productId, vendorId: vendor.id, isActive: true }, select: { id: true } });
    if (!validProduct) fail("invalid_product");
  }
  const created = await getDb().automationRule.create({ data: {
    vendorId: vendor.id,
    name: recipe.name,
    description: recipe.description,
    trigger: recipe.trigger,
    condition: recipe.condition as Prisma.InputJsonValue,
    actions: actions as Prisma.InputJsonArray,
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
  // say that it does not run instead of a misleading result. The same holds
  // for a watch-progress or watch-duration rule with the old watch-seconds
  // condition.
  if (!isAutomationRuleRunnableForVendor(existing, vendor)) {
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
    // webinar_attended_duration_gte (Q-11) is simulated in minutes, like its threshold.
    watchSecondsTotal: existing.trigger === "webinar_attended_duration_gte"
      ? Math.round(number(formData, "watchMinutes") * 60)
      : Math.round(number(formData, "watchSeconds")),
    watchPercent: Math.round(number(formData, "watchPercent")),
    hasPurchased: formData.get("hasPurchased") === "on",
  });
  redirect(`${PATH}?dryRun=${encodeURIComponent(result.status)}`);
}

export async function createAutomationRuleAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { user, vendor, member } = await requireVendorManagerMember(PATH);
  let parsed: ReturnType<typeof parseRule>;
  try { parsed = parseRule(formData, mayConfigureAutomationLinePush(member.role), vendor); } catch (error) { fail(error instanceof Error && (error.message === "no_action" || error.message === "invalid_button_url" || error.message === "trigger_unavailable" || error.message === "email_template_unavailable" || error.message === "invalid_email_content") ? error.message : "invalid_rule"); }
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
  const existing = await getDb().automationRule.findFirst({ where: { id, vendorId: vendor.id }, select: { id: true, isActive: true, trigger: true, condition: true } });
  if (!existing) fail("not_found");
  // Switching off always works; switching on needs a trigger that can run.
  if (!existing.isActive && !isAutomationTriggerAvailableForVendor(existing.trigger, vendor)) fail("trigger_unavailable");
  // ... and, for viewer_watch_progress and webinar_attended_duration_gte, the
  // watch-percent or watch-minutes condition (Q-11): a rule saved with the old
  // watch-seconds condition would never run.
  if (!existing.isActive && !isAutomationRuleRunnableForVendor(existing, vendor)) fail("condition_unsupported");
  let outcome: ToggleOutcome;
  try {
    outcome = await toggleRule(vendor.id, existing, mayConfigureAutomationLinePush(member.role));
  } catch (error) {
    if (!isRuleWriteBusy(error)) throw error;
    reportCancelledRuleLockWait(error);
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
 * Switching on starts the rule's LINE messages again (a custom LINE push or a
 * voucher's LINE notification), so without `linePushAllowed` (not the owner) a
 * rule that sends LINE (immediate actions or any step, read after the lock)
 * stays off. Switching off is always allowed.
 */
function toggleRule(vendorId: string, existing: { id: string; isActive: boolean }, linePushAllowed: boolean) {
  return getDb().$transaction(async (tx): Promise<ToggleOutcome> => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
    await tx.$queryRaw`SELECT "id" FROM "AutomationRule" WHERE "id" = ${existing.id} AND "vendorId" = ${vendorId} FOR UPDATE`;
    if (!existing.isActive && !linePushAllowed) {
      const sendsLine = await storedAutomationRuleSendsLine(tx, { vendorId, ruleId: existing.id });
      if (sendsLine === null) return { code: "not_found" };
      if (sendsLine) return { code: LINE_PUSH_OWNER_ONLY };
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
    if (!isRuleWriteBusy(error)) throw error;
    // The rule stayed locked by a running execution (or no connection was
    // free) for too long: nothing changed, the merchant can simply retry.
    reportCancelledRuleLockWait(error);
    fail("delete_busy");
  }
  if (outcome.code !== "deleted") fail(outcome.code);
  await writeAuditLog({ vendorId: vendor.id, actorId: user.id, actorLabel: member.role, action: "delete_automation_rule", targetType: "AutomationRule", targetId: outcome.before.id, before: auditSnapshot(outcome.before) });
  revalidatePath(PATH);
  redirect(`${PATH}?updated=deleted`);
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
  "condition_unsupported",
  "steps_unsupported",
  "invalid_step",
  "invalid_delay",
  "duplicate_delay",
  "step_limit",
  "invalid_product",
  "step_busy",
  "no_action",
  "invalid_button_url",
  "email_template_unavailable",
  "invalid_email_content",
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

function parseStep(form: FormData, linePushAllowed: boolean): AutomationStepInput {
  let delayMinutes: number;
  try { delayMinutes = stepDelayMinutes(form); } catch { throw new Error("invalid_delay"); }
  return {
    delayMinutes,
    // A delayed step runs for everyone its rule's event reached (the rule's
    // own condition, e.g. payment_paid's amount threshold, already decided
    // that), so steps saved here are "always". The worker still evaluates a
    // step's condition against the subject read again (Q-09: an order's paid
    // amount from the server's record).
    condition: { type: "always" },
    actions: parseActions(form, linePushAllowed),
    isActive: form.get("stepActive") === "on",
  };
}

function parsedStepOrFail(form: FormData, linePushAllowed: boolean) {
  try {
    return parseStep(form, linePushAllowed);
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
  const linePushAllowed = mayConfigureAutomationLinePush(member.role);
  const step = parsedStepOrFail(formData, linePushAllowed);
  // Refused before any query; whether the rule itself sends LINE is checked under its lock.
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
  const linePushAllowed = mayConfigureAutomationLinePush(member.role);
  const step = parsedStepOrFail(formData, linePushAllowed);
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
