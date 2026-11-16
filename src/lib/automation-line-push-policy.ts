import type { Prisma } from "@prisma/client";

/**
 * Owner decision 2026-11-14: the custom LINE push action of an automation
 * (`line_push`: merchant-written text and button URL sent through the vendor's
 * linked LINE Official Account) is configured by the vendor owner only. An
 * admin still manages every automation without one.
 *
 * Owner decision 2026-11-15: the same holds for the LINE notification a
 * voucher action sends with the platform's fixed text ("感謝支持，您的專屬回購
 * 折價券已經準備好了。" + a button to the voucher) when its actions have no
 * `line_push` of their own. Whether a voucher action sends it is its
 * `lineNotification` flag (VOUCHER_LINE_NOTIFICATION_FIELD); an action stored
 * before the flag existed has none and keeps sending (treated as true).
 *
 * A rule "sends LINE" when its immediate actions or any of its delayed steps
 * (active or not) carry a `line_push` or a voucher action whose LINE
 * notification is on (true or missing). Such a rule is read-only for an admin
 * except for the safe directions: switching it off, deleting it and deleting
 * its steps. Rules an admin saved before these changes keep running unchanged.
 *
 * Every writer of automation actions calls the helpers below with the
 * server-parsed actions and the stored rule, never a form flag:
 * - /settings/automations: create rule, apply recipe, switch on, add or edit a
 *   delayed step (src/app/actions/automation-actions.ts and
 *   src/lib/automation-delayed-steps.ts);
 * - the funnel editor: create, edit, switch on (src/lib/funnel-automation-service.ts).
 * Writers first set every voucher action's flag explicitly
 * (withVoucherLineNotification): an admin's is always false, so an admin can
 * still create voucher rules, only without the LINE notification.
 */
export const LINE_PUSH_OWNER_ONLY = "line_push_owner_only" as const;

export const LINE_PUSH_OWNER_ONLY_MESSAGE = "LINE 推播僅限擁有者設定。";

export const VOUCHER_LINE_NOTIFICATION_OWNER_ONLY_MESSAGE = "派券的 LINE 通知僅限擁有者設定。";

/** The key of a voucher action's LINE notification flag in the stored action JSON. */
export const VOUCHER_LINE_NOTIFICATION_FIELD = "lineNotification" as const;

/** The membership role that may write or re-enable a custom LINE push or a voucher's LINE notification (the same `member.role === "owner"` check as the other owner-only settings). */
export function mayConfigureAutomationLinePush(role: string | null | undefined) {
  return role === "owner";
}

function actionType(action: unknown) {
  return Boolean(action) && typeof action === "object" ? (action as { type?: unknown }).type : undefined;
}

/** Whether a list of actions (parsed or stored, untrusted JSON) carries a `line_push`. */
export function automationActionsIncludeLinePush(actions: unknown) {
  return Array.isArray(actions) && actions.some((action) => actionType(action) === "line_push");
}

/**
 * Whether one action (untrusted JSON) is a voucher whose LINE notification is
 * on. Only an explicit `false` turns it off: an action stored before the flag
 * existed keeps sending, as it did.
 */
export function voucherActionSendsLine(action: unknown) {
  return actionType(action) === "issue_repurchase_voucher"
    && (action as Record<string, unknown>)[VOUCHER_LINE_NOTIFICATION_FIELD] !== false;
}

/** Whether a list of actions sends a LINE message: a `line_push`, or a voucher with its LINE notification on. */
export function automationActionsSendLine(actions: unknown) {
  return automationActionsIncludeLinePush(actions)
    || (Array.isArray(actions) && actions.some(voucherActionSendsLine));
}

type RuleActions = { actions: unknown; steps?: ReadonlyArray<{ actions: unknown }> | null };

/** A rule's immediate actions and every delayed step's actions, as read from the database, carry a `line_push`. */
export function automationRuleIncludesLinePush(rule: RuleActions) {
  return automationActionsIncludeLinePush(rule.actions)
    || (rule.steps ?? []).some((step) => automationActionsIncludeLinePush(step.actions));
}

/** A rule's immediate actions or any delayed step's actions send LINE (automationActionsSendLine). */
export function automationRuleSendsLine(rule: RuleActions) {
  return automationActionsSendLine(rule.actions)
    || (rule.steps ?? []).some((step) => automationActionsSendLine(step.actions));
}

/**
 * The actions about to be saved, with every voucher action's LINE notification
 * set explicitly: false without `linePushAllowed` (not the owner), whatever
 * was asked; otherwise the action's own value, on unless it is `false`. Other
 * actions are returned unchanged. Called by every writer before the checks
 * below, so an admin's voucher never counts as sending LINE.
 */
export function withVoucherLineNotification<T>(actions: readonly T[], linePushAllowed: boolean): T[] {
  return actions.map((action) => (actionType(action) === "issue_repurchase_voucher"
    ? { ...action, [VOUCHER_LINE_NOTIFICATION_FIELD]: linePushAllowed && voucherActionSendsLine(action) }
    : action));
}

/** Whether `role` may save these new actions (after withVoucherLineNotification). */
export function mayWriteAutomationActions(role: string | null | undefined, actions: unknown) {
  return mayConfigureAutomationLinePush(role) || !automationActionsSendLine(actions);
}

/**
 * Whether the stored rule `ruleId` of `vendorId` sends LINE anywhere
 * (automationRuleSendsLine). `null` when the rule is not this vendor's (or is
 * gone, or outside the optional funnel page / trigger scope). Callers that
 * change the rule read it inside the transaction that holds the rule row FOR
 * UPDATE, so an owner adding a LINE push or LINE-notified voucher step at the
 * same moment is serialized.
 */
export async function storedAutomationRuleSendsLine(
  db: Pick<Prisma.TransactionClient, "automationRule">,
  input: { vendorId: string; ruleId: string; funnelPageId?: string; trigger?: string },
) {
  const rule = await db.automationRule.findFirst({
    where: {
      id: input.ruleId,
      vendorId: input.vendorId,
      ...(input.funnelPageId === undefined ? {} : { funnelPageId: input.funnelPageId }),
      ...(input.trigger === undefined ? {} : { trigger: input.trigger }),
    },
    select: { actions: true, steps: { where: { vendorId: input.vendorId }, select: { actions: true } } },
  });
  return rule ? automationRuleSendsLine(rule) : null;
}
