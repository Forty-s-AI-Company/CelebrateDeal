import type { Prisma } from "@prisma/client";

/**
 * Owner decision 2026-11-14: the custom LINE push action of an automation
 * (`line_push`: merchant-written text and button URL sent through the vendor's
 * linked LINE Official Account) is configured by the vendor owner only. An
 * admin still manages every automation without one.
 *
 * Every writer of automation actions calls the helpers below with the
 * server-parsed actions and the stored rule, never a form flag:
 * - /settings/automations: create rule, apply recipe, switch on, add or edit a
 *   delayed step (src/app/actions/automation-actions.ts and
 *   src/lib/automation-delayed-steps.ts);
 * - the funnel editor: create, edit, switch on (src/lib/funnel-automation-service.ts).
 *
 * A rule "has a LINE push" when its immediate actions or any of its delayed
 * steps (active or not) carry one. Such a rule is read-only for an admin except
 * for the safe directions: switching it off, deleting it and deleting its
 * steps. Rules an admin saved before this change keep running unchanged.
 */
export const LINE_PUSH_OWNER_ONLY = "line_push_owner_only" as const;

export const LINE_PUSH_OWNER_ONLY_MESSAGE = "LINE 推播僅限擁有者設定。";

/** The membership role that may write or re-enable a custom LINE push (the same `member.role === "owner"` check as the other owner-only settings). */
export function mayConfigureAutomationLinePush(role: string | null | undefined) {
  return role === "owner";
}

/** Whether a list of actions (parsed or stored, untrusted JSON) carries a `line_push`. */
export function automationActionsIncludeLinePush(actions: unknown) {
  return Array.isArray(actions)
    && actions.some((action) => Boolean(action) && typeof action === "object" && (action as { type?: unknown }).type === "line_push");
}

/** A rule's immediate actions and every delayed step's actions, as read from the database. */
export function automationRuleIncludesLinePush(rule: { actions: unknown; steps?: ReadonlyArray<{ actions: unknown }> | null }) {
  return automationActionsIncludeLinePush(rule.actions)
    || (rule.steps ?? []).some((step) => automationActionsIncludeLinePush(step.actions));
}

/** Whether `role` may save these new actions. */
export function mayWriteAutomationActions(role: string | null | undefined, actions: unknown) {
  return mayConfigureAutomationLinePush(role) || !automationActionsIncludeLinePush(actions);
}

/**
 * Whether the stored rule `ruleId` of `vendorId` has a LINE push anywhere.
 * `null` when the rule is not this vendor's (or is gone, or outside the
 * optional funnel page / trigger scope). Callers that change the rule read it
 * inside the transaction that holds the rule row FOR UPDATE, so an owner
 * adding a LINE push step at the same moment is serialized.
 */
export async function storedAutomationRuleIncludesLinePush(
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
  return rule ? automationRuleIncludesLinePush(rule) : null;
}
