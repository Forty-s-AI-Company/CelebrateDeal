import { describe, expect, it } from "vitest";
import {
  AUTOMATION_EMAIL_TEMPLATES,
  AUTOMATION_RECIPES,
  AUTOMATION_TRIGGERS,
  automationActionsEmailTemplatesUsable,
  automationEmailTemplateAdvice,
  automationEmailTemplateUsable,
  usableAutomationEmailTemplates,
} from "@/lib/automation-workflow";

// Q-18: which e-mail template has its link on which trigger. What each trigger's
// event carries: consultation triggers the booking's meeting URL, form_no_show
// the replay's viewer page, form_registered and payment_paid nothing, and a
// voucher link exists only next to an issue_repurchase_voucher action.
const WITHOUT_VOUCHER: Record<string, string[]> = {
  form_registered: [],
  form_no_show: ["webinar_replay"],
  consultation_booked: ["consultation_confirmation"],
  consultation_no_show: ["consultation_confirmation"],
  payment_paid: [],
  viewer_watch_progress: [],
  webinar_attended_duration_gte: [],
};

describe("e-mail templates by trigger (Q-18)", () => {
  it("covers every trigger in the matrix below", () => {
    expect(Object.keys(WITHOUT_VOUCHER).sort()).toEqual([...AUTOMATION_TRIGGERS].sort());
  });

  it.each(Object.entries(WITHOUT_VOUCHER))("%s offers only the templates whose link its event carries", (trigger, expected) => {
    expect(usableAutomationEmailTemplates(trigger, { hasVoucher: false })).toEqual(AUTOMATION_EMAIL_TEMPLATES.filter((template) => expected.includes(template)));
    for (const template of AUTOMATION_EMAIL_TEMPLATES) {
      expect(automationEmailTemplateUsable(template, trigger, { hasVoucher: false })).toBe(expected.includes(template));
    }
  });

  it.each(Object.entries(WITHOUT_VOUCHER))("%s also offers 追購通知 next to a voucher, and nothing else changes", (trigger, expected) => {
    expect(usableAutomationEmailTemplates(trigger, { hasVoucher: true })).toEqual(AUTOMATION_EMAIL_TEMPLATES.filter((template) => template === "repurchase_followup" || expected.includes(template)));
  });

  it("treats an unknown template or trigger as unusable", () => {
    expect(automationEmailTemplateUsable("made_up", "form_no_show", { hasVoucher: true })).toBe(false);
    expect(automationEmailTemplateUsable("class_reminder", "made_up", { hasVoucher: true })).toBe(false);
  });

  it("checks every e-mail action of a new rule or step against its own actions", () => {
    const email = (template: string) => ({ type: "send_email_notification", template });
    const voucher = { type: "issue_repurchase_voucher" };
    const tag = { type: "add_customer_tag" };
    expect(automationActionsEmailTemplatesUsable("form_registered", [tag])).toBe(true);
    expect(automationActionsEmailTemplatesUsable("form_registered", [email("class_reminder")])).toBe(false);
    expect(automationActionsEmailTemplatesUsable("form_registered", [email("repurchase_followup")])).toBe(false);
    expect(automationActionsEmailTemplatesUsable("form_registered", [voucher, email("repurchase_followup")])).toBe(true);
    expect(automationActionsEmailTemplatesUsable("consultation_booked", [email("consultation_confirmation"), email("webinar_replay")])).toBe(false);
    expect(automationActionsEmailTemplatesUsable("payment_paid", [email("consultation_confirmation")])).toBe(false);
    // An edit may leave a template the stored step already had.
    expect(automationActionsEmailTemplatesUsable("form_registered", [email("class_reminder")], ["class_reminder"])).toBe(true);
    expect(automationActionsEmailTemplatesUsable("form_registered", [email("webinar_replay")], ["class_reminder"])).toBe(false);
  });

  it("keeps every built-in recipe on templates that have their link", () => {
    for (const recipe of AUTOMATION_RECIPES) {
      expect(automationActionsEmailTemplatesUsable(recipe.trigger, recipe.actions as unknown as Array<{ type: string; template?: string }>), recipe.id).toBe(true);
    }
  });

  it("advises on a stored rule without changing it, and says nothing when it is fine", () => {
    const stored = [{ type: "add_customer_tag", tag: "x" }, { type: "send_email_notification", template: "consultation_confirmation" }];
    const before = JSON.stringify(stored);
    const [note, ...rest] = automationEmailTemplateAdvice("form_registered", stored);
    expect(rest).toEqual([]);
    expect(note).toContain("「諮詢預約確認」在「表單報名成功」下沒有可用的連結");
    expect(note).toContain("不會寄出");
    expect(JSON.stringify(stored)).toBe(before);

    // Names the templates that do fit the trigger.
    expect(automationEmailTemplateAdvice("form_no_show", [{ type: "send_email_notification", template: "consultation_confirmation" }])[0]).toContain("建議改用「缺席回放與諮詢邀請」");
    // 追購通知 without a voucher in the same actions.
    expect(automationEmailTemplateAdvice("consultation_booked", [{ type: "send_email_notification", template: "repurchase_followup" }])[0]).toContain("「追購通知」要有同一份動作裡的「派發回購券」才有領券連結");
    // Fine, or not an e-mail action, or unreadable data: no advice.
    expect(automationEmailTemplateAdvice("consultation_booked", [{ type: "send_email_notification", template: "consultation_confirmation" }])).toEqual([]);
    expect(automationEmailTemplateAdvice("form_registered", [{ type: "issue_repurchase_voucher" }, { type: "send_email_notification", template: "repurchase_followup" }])).toEqual([]);
    expect(automationEmailTemplateAdvice("form_registered", "oops")).toEqual([]);
    expect(automationEmailTemplateAdvice("form_registered", [{ type: "send_email_notification", template: "retired_template" }])).toEqual([]);
  });
});
