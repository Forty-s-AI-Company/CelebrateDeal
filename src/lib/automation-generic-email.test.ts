import { describe, expect, it } from "vitest";
import {
  GENERIC_EMAIL_BODY_MAX,
  GENERIC_EMAIL_SUBJECT_MAX,
  genericEmailContentUsable,
  genericEmailVariablesForTrigger,
  genericEmailVariableValue,
  normalizeGenericEmailContent,
  renderGenericEmail,
} from "@/lib/automation-generic-email";
import { parseAutomationRule } from "@/lib/automation-workflow";
import { richTextToEmailHtml } from "@/lib/rich-text";
import { ensureEmailUnsubscribeFooter } from "@/lib/email-delivery-format";

describe("generic e-mail content (A2-04)", () => {
  it("trims, normalizes line breaks and keeps plain text as typed", () => {
    expect(normalizeGenericEmailContent({ subject: "  感謝你  ", body: "第一行\r\n第二行\r\n\r\n第三段  " })).toEqual({ subject: "感謝你", body: "第一行\n第二行\n\n第三段" });
  });

  it.each([
    ["CR in the subject", { subject: "a\rBcc: x@evil.test", body: "ok" }],
    ["LF in the subject", { subject: "a\nBcc: x@evil.test", body: "ok" }],
    ["CRLF in the subject", { subject: "a\r\nBcc: x@evil.test", body: "ok" }],
    ["Unicode line separator in the subject", { subject: "a b", body: "ok" }],
    ["NUL in the subject", { subject: "a\u0000b", body: "ok" }],
    ["empty subject", { subject: "   ", body: "ok" }],
    ["empty body", { subject: "ok", body: "  \n " }],
    ["a subject over the limit", { subject: "字".repeat(GENERIC_EMAIL_SUBJECT_MAX + 1), body: "ok" }],
    ["a body over the limit", { subject: "ok", body: "字".repeat(GENERIC_EMAIL_BODY_MAX + 1) }],
    ["a NUL in the body", { subject: "ok", body: "a\u0000b" }],
    ["a non-string subject", { subject: 1, body: "ok" }],
  ])("refuses %s", (_name, input) => {
    expect(normalizeGenericEmailContent(input)).toBeNull();
  });

  it("accepts the exact limits", () => {
    expect(normalizeGenericEmailContent({ subject: "字".repeat(GENERIC_EMAIL_SUBJECT_MAX), body: "字".repeat(GENERIC_EMAIL_BODY_MAX) })).not.toBeNull();
  });

  it("offers each trigger only the variables its subject can supply", () => {
    expect(genericEmailVariablesForTrigger("payment_paid")).toEqual(["vendor_name"]);
    expect(genericEmailVariablesForTrigger("consultation_booked")).toEqual(["name", "vendor_name"]);
    expect(genericEmailVariablesForTrigger("consultation_no_show")).toEqual(["name", "vendor_name"]);
    for (const trigger of ["form_registered", "viewer_watch_progress", "webinar_attended_duration_gte", "form_no_show"]) {
      expect(genericEmailVariablesForTrigger(trigger)).toEqual(["name", "vendor_name", "live_title"]);
    }
    expect(genericEmailVariablesForTrigger("made_up")).toEqual([]);
  });

  it("accepts only the variables of the trigger, and no stray braces", () => {
    const usable = (trigger: string, body: string, subject = "主旨") => genericEmailContentUsable(trigger, { subject, body });
    expect(usable("form_registered", "{{name}} 你好，{{ live_title }} by {{vendor_name}}")).toBe(true);
    expect(usable("payment_paid", "{{vendor_name}} 謝謝")).toBe(true);
    expect(usable("payment_paid", "{{name}} 謝謝")).toBe(false);
    expect(usable("consultation_booked", "{{live_title}}")).toBe(false);
    expect(usable("form_registered", "{{voucher_url}}")).toBe(false);
    expect(usable("form_registered", "{{webinar_url}}")).toBe(false);
    expect(usable("form_registered", "{{unsubscribe_url}}")).toBe(false);
    expect(usable("form_registered", "你好 {{name")).toBe(false);
    expect(usable("form_registered", "你好 }}")).toBe(false);
    expect(usable("form_registered", "ok", "{{live_title}}")).toBe(true);
    expect(usable("payment_paid", "ok", "{{name}}")).toBe(false);
  });
});

describe("generic e-mail rendering (A2-04)", () => {
  const content = { subject: "{{name}}，感謝你看了 {{live_title}}", body: "{{name}} 你好\n\n感謝你的參與。\n{{vendor_name}}" };

  it("fills the variables from the server's values", () => {
    expect(renderGenericEmail(content, { name: "王小明", live_title: "新品發表", vendor_name: "示範商家" })).toEqual({
      subject: "王小明，感謝你看了 新品發表",
      body: "王小明 你好\n\n感謝你的參與。\n示範商家",
    });
  });

  it("falls back to neutral words when a value is missing", () => {
    const rendered = renderGenericEmail(content, { name: null, live_title: undefined, vendor_name: "  " });
    expect(rendered.subject).toBe("你，感謝你看了 這場直播");
    expect(rendered.body).toBe("你 你好\n\n感謝你的參與。\n我們");
  });

  it("never lets a value start a link, a heading, a list or another variable", () => {
    const hostile = [
      "[點我](https://evil.test)",
      "https://evil.test/phish",
      "**粗體**",
      "# 標題",
      "- 項目",
      "1. 項目",
      "{{vendor_name}}",
      "<script>alert(1)</script>",
      "a\r\nBcc: x@evil.test",
    ];
    for (const name of hostile) {
      const rendered = renderGenericEmail({ subject: "{{name}}", body: "{{name}}" }, { name, vendor_name: "商家" });
      for (const text of [rendered.subject, rendered.body]) {
        expect(text).not.toMatch(/[\r\n]/u);
        expect(text).not.toContain("{{");
        expect(text).not.toContain("](");
        expect(text).not.toContain("http");
        expect(text).not.toMatch(/[<>*[\]]/u);
        expect(text).not.toMatch(/^(?:#|-|\d+[.)])/u);
      }
      // The pipeline's own renderer finds no link or markup in the filled body.
      expect(richTextToEmailHtml(rendered.body)).toMatch(/^<p>[^<>]*<\/p>$/u);
    }
    expect(renderGenericEmail({ subject: "{{name}}", body: "x" }, { name: "{{vendor_name}}", vendor_name: "商家" }).subject).toBe("vendor_name");
  });

  it("does not read a value twice (one pass)", () => {
    expect(renderGenericEmail({ subject: "{{name}}", body: "{{name}}" }, { name: "{{live_title}}", live_title: "X" }).body).toBe("live_title");
  });

  it("keeps the subject on one line even if the stored text somehow had a break", () => {
    expect(renderGenericEmail({ subject: "a\r\nBcc: x y", body: "b" }, {}).subject).toBe("a Bcc: x y");
  });

  it("turns a value into at most one clean line of 80 characters", () => {
    expect(genericEmailVariableValue("a\n\n b\t c")).toBe("a b c");
    expect(genericEmailVariableValue("字".repeat(200))).toHaveLength(80);
    expect(genericEmailVariableValue(null)).toBe("");
  });

  it("is escaped and line-broken by the e-mail pipeline, with the unsubscribe link at the end", () => {
    // The merchant's own text may contain markup characters; it reaches the mail as text.
    const rendered = renderGenericEmail({ subject: "S", body: "<b>粗</b> & \"引號\"\n第二行" }, {});
    const body = ensureEmailUnsubscribeFooter(rendered.body, "https://app.example.test/unsubscribe?token=t");
    const html = richTextToEmailHtml(body);
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;粗&lt;/b&gt; &amp; &quot;引號&quot;<br>第二行");
    expect(body.endsWith("退訂：https://app.example.test/unsubscribe?token=t")).toBe(true);
  });
});

describe("generic e-mail action schema (A2-04)", () => {
  const parse = (action: Record<string, unknown>) => parseAutomationRule({ id: "r", condition: { type: "always" }, actions: [{ type: "send_email_notification", ...action }] });

  it("parses a generic action that carries a stored, trimmed subject and body", () => {
    expect(parse({ template: "generic_message", subject: "主旨", body: "內文" })?.actions).toEqual([{ type: "send_email_notification", template: "generic_message", subject: "主旨", body: "內文" }]);
  });

  it.each([
    ["no subject", { template: "generic_message", body: "內文" }],
    ["no body", { template: "generic_message", subject: "主旨" }],
    ["a subject with a line break", { template: "generic_message", subject: "a\nb", body: "內文" }],
    ["an untrimmed subject", { template: "generic_message", subject: " 主旨", body: "內文" }],
    ["a body over the limit", { template: "generic_message", subject: "主旨", body: "字".repeat(GENERIC_EMAIL_BODY_MAX + 1) }],
    ["text on a template that has its own", { template: "class_reminder", subject: "主旨", body: "內文" }],
    ["an unknown field", { template: "generic_message", subject: "主旨", body: "內文", html: "<b>x</b>" }],
  ])("refuses %s, so the rule never runs", (_name, action) => {
    expect(parse(action)).toBeNull();
  });

  it("still parses every earlier template without text", () => {
    for (const template of ["consultation_confirmation", "class_reminder", "repurchase_followup", "webinar_replay"]) {
      expect(parse({ template })).not.toBeNull();
    }
  });
});
