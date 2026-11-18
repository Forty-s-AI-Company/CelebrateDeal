// Pure constants and functions only: the rule form (a client component) imports
// this file, so it must never import a server module (db, next/headers, after).
// automation-workflow.ts re-exports everything here for its existing callers.

/**
 * Every trigger the engine understands. Stored rules may use any of them and
 * keep parsing, so this list never shrinks; what a merchant may choose is
 * AVAILABLE_AUTOMATION_TRIGGERS in automation-workflow.ts.
 */
export const AUTOMATION_TRIGGERS = [
  "payment_paid",
  "viewer_watch_progress",
  "webinar_attended_duration_gte",
  "form_registered",
  "consultation_booked",
  "consultation_no_show",
  "form_no_show",
] as const;
export type AutomationTrigger = typeof AUTOMATION_TRIGGERS[number];

export const AUTOMATION_TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  payment_paid: "訂單付款完成",
  viewer_watch_progress: "觀看直播達到指定進度",
  webinar_attended_duration_gte: "觀看直播累計達指定時間",
  form_registered: "表單報名成功",
  consultation_booked: "諮詢預約成功",
  consultation_no_show: "諮詢未出席",
  form_no_show: "報名後未出席直播",
};

export const AUTOMATION_EMAIL_TEMPLATES = ["consultation_confirmation", "class_reminder", "repurchase_followup", "webinar_replay"] as const;
export type AutomationEmailTemplate = typeof AUTOMATION_EMAIL_TEMPLATES[number];

export const AUTOMATION_EMAIL_TEMPLATE_LABELS: Record<AutomationEmailTemplate, string> = {
  consultation_confirmation: "諮詢預約確認",
  class_reminder: "課前提醒",
  repurchase_followup: "追購通知",
  webinar_replay: "缺席回放與諮詢邀請",
};

/**
 * Which triggers carry the link each e-mail template is built around (Q-18).
 * Taken from what each trigger's event really supplies:
 * - `consultationUrl`: the two consultation triggers (the booking's meeting URL);
 * - `webinarUrl`: only `form_no_show`, and only while the replay is open;
 * - form_registered, payment_paid, viewer_watch_progress and
 *   webinar_attended_duration_gte (Q-11: the viewer is, or just was, on the
 *   viewer page) events carry no link at all;
 * - `{{voucher_url}}` exists only when an `issue_repurchase_voucher` action runs
 *   in the same rule or the same delayed step (runRuleActions), so
 *   `repurchase_followup` is usable on any trigger, but only next to a voucher.
 * A template used elsewhere would say "請由下方連結進入" with no link. The same
 * check guards new rules, recipes and step changes; rules and steps stored
 * before it keep sending untouched (see automationEmailTemplateAdvice).
 */
const EMAIL_TEMPLATE_LINK_TRIGGERS: Record<Exclude<AutomationEmailTemplate, "repurchase_followup">, readonly AutomationTrigger[]> = {
  consultation_confirmation: ["consultation_booked", "consultation_no_show"],
  // 「課程即將開始」對已結束的場次語意錯誤，所以未出席直播也不開放；只有 webinarUrl 並不夠。
  class_reminder: [],
  webinar_replay: ["form_no_show"],
};

/** Whether the actions of one rule or one delayed step include a voucher (which gives `{{voucher_url}}`). */
export function automationActionsIssueVoucher(actions: unknown) {
  return Array.isArray(actions) && actions.some((action) => Boolean(action) && typeof action === "object" && (action as { type?: unknown }).type === "issue_repurchase_voucher");
}

/** Whether `template` has the link it needs on `trigger`; `hasVoucher`: the same rule or step also issues a voucher. */
export function automationEmailTemplateUsable(template: string, trigger: string, options: { hasVoucher: boolean }) {
  if (template === "repurchase_followup") return options.hasVoucher;
  const triggers = (EMAIL_TEMPLATE_LINK_TRIGGERS as Record<string, readonly string[] | undefined>)[template];
  return Boolean(triggers?.includes(trigger));
}

/** The templates a merchant may choose for a new e-mail action on `trigger`. */
export function usableAutomationEmailTemplates(trigger: string, options: { hasVoucher: boolean }) {
  return AUTOMATION_EMAIL_TEMPLATES.filter((template) => automationEmailTemplateUsable(template, trigger, options));
}

/**
 * Create-time check of the e-mail actions of one rule or step. `keep`: the
 * templates the stored step already had, which an edit may leave as they are
 * (so changing only a step's delay never forces a legacy step to change).
 */
export function automationActionsEmailTemplatesUsable(trigger: string, actions: ReadonlyArray<{ type: string; template?: string }>, keep: readonly string[] = []) {
  const hasVoucher = actions.some((action) => action.type === "issue_repurchase_voucher");
  return actions.every((action) => (
    action.type !== "send_email_notification"
    || !action.template
    || keep.includes(action.template)
    || automationEmailTemplateUsable(action.template, trigger, { hasVoucher })
  ));
}

/** The templates of the stored e-mail actions in `actions`, for an edit to keep. */
export function automationActionsEmailTemplates(actions: unknown) {
  if (!Array.isArray(actions)) return [];
  return actions.flatMap((action) => (
    action && typeof action === "object" && (action as { type?: unknown }).type === "send_email_notification" && typeof (action as { template?: unknown }).template === "string"
      ? [(action as { template: string }).template]
      : []
  ));
}

/**
 * Hints for the stored e-mail actions of one rule or step whose template has no
 * link on the rule's trigger. Advice only: nothing about such a rule changes.
 */
export function automationEmailTemplateAdvice(trigger: string, actions: unknown) {
  const hasVoucher = automationActionsIssueVoucher(actions);
  const triggerLabel = (AUTOMATION_TRIGGER_LABELS as Record<string, string>)[trigger] ?? trigger;
  const alternatives = usableAutomationEmailTemplates(trigger, { hasVoucher }).map((template) => `「${AUTOMATION_EMAIL_TEMPLATE_LABELS[template]}」`);
  const notes = automationActionsEmailTemplates(actions).flatMap((template) => {
    if (!(AUTOMATION_EMAIL_TEMPLATES as readonly string[]).includes(template)) return [];
    if (automationEmailTemplateUsable(template, trigger, { hasVoucher })) return [];
    const label = AUTOMATION_EMAIL_TEMPLATE_LABELS[template as AutomationEmailTemplate];
    const what = template === "repurchase_followup"
      ? `「${label}」要有同一份動作裡的「派發回購券」才有領券連結，目前沒有`
      : `「${label}」在「${triggerLabel}」下沒有可用的連結`;
    const fix = alternatives.length
      ? `建議改用${alternatives.join("或")}。`
      : template === "repurchase_followup"
        ? "建議同時派發回購券，或移除這個 Email 動作。"
        : "這個觸發條件目前沒有適用的 Email 範本，建議移除這個 Email 動作，或同時派發回購券並改用「追購通知」。";
    return [`${what}，信件可能因為沒有內容而不會寄出。${fix}`];
  });
  return [...new Set(notes)];
}
