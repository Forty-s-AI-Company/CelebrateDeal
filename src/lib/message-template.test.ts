import { describe, expect, it } from "vitest";
import {
  MESSAGE_TEMPLATE_VARIABLES,
  messageTemplateVariableLabel,
  normalizeMessageTemplateDraft,
} from "./message-template";

function validDraft(overrides: Record<string, unknown> = {}) {
  return {
    name: " 開播提醒 ",
    channel: "email",
    trigger: "live_reminder",
    subject: " {{live_title}} 即將開始 ",
    body: "嗨 {{name}}，{{vendor_name}} 的直播即將開始。\n{{unsubscribe_url}}",
    isActive: true,
    ...overrides,
  };
}

describe("message template draft", () => {
  it("normalizes a bounded email template and preserves supported variables", () => {
    expect(normalizeMessageTemplateDraft(validDraft())).toEqual({
      success: true,
      data: {
        name: "開播提醒",
        channel: "email",
        trigger: "live_reminder",
        subject: "{{live_title}} 即將開始",
        body: "嗨 {{name}}，{{vendor_name}} 的直播即將開始。\n{{unsubscribe_url}}",
        isActive: true,
      },
    });
    expect(MESSAGE_TEMPLATE_VARIABLES.map(messageTemplateVariableLabel)).toEqual([
      "{{name}}",
      "{{live_title}}",
      "{{live_start_at}}",
      "{{vendor_name}}",
      "{{unsubscribe_url}}",
    ]);
  });

  it("normalizes browser textarea CRLF into stable LF without changing content", () => {
    expect(normalizeMessageTemplateDraft(validDraft({ body: "第一行\r\n第二行\r{{unsubscribe_url}}" }))).toEqual({
      success: true,
      data: expect.objectContaining({ body: "第一行\n第二行\n{{unsubscribe_url}}" }),
    });
  });

  it.each(["sms", "line"])("rejects the unconnected %s channel", (channel) => {
    expect(normalizeMessageTemplateDraft(validDraft({ channel }))).toEqual({ success: false });
  });

  it("rejects cart follow-up until a trusted cart event source exists", () => {
    expect(normalizeMessageTemplateDraft(validDraft({ trigger: "cart_followup" }))).toEqual({ success: false });
  });

  it.each([
    ["missing subject", { subject: "" }],
    ["empty body", { body: "" }],
    ["unknown trigger", { trigger: "provider_magic" }],
    ["unknown variable", { body: "Hello {{secret_token}}" }],
    ["malformed variable", { body: "Hello {{secret-token}}" }],
    ["unclosed variable", { body: "Hello {{name" }],
    ["oversized body", { body: "x".repeat(20_001) }],
  ])("rejects %s", (_label, overrides) => {
    expect(normalizeMessageTemplateDraft(validDraft(overrides))).toEqual({ success: false });
  });
});
