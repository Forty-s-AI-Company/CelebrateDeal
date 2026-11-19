import { describe, expect, it } from "vitest";
import { genericEmailVariableValue } from "@/lib/automation-generic-email";
import { MESSAGE_TEMPLATE_NAME_FALLBACK, renderMessageTemplate } from "@/lib/message-template";
import { cleanInlineEmailValue, looksLikeWebAddress, safeRecipientName, safeRecipientNameOr } from "@/lib/safe-recipient-name";
import {
  expectNoFormatting,
  expectNoPhishingTrace,
  NORMAL_NAMES,
  PHISHING_NAMES,
  STACKED_FORMAT_NAME,
} from "@/test/recipient-name-cases";

describe("safeRecipientName (A2-13)", () => {
  it.each(PHISHING_NAMES)("drops a name that reads as a web address whole: $label", ({ name }) => {
    expect(safeRecipientName(name)).toBe("");
    expect(safeRecipientNameOr(name, "您好")).toBe("您好");
  });

  it("removes stacked line-start formatting until nothing changes", () => {
    expect(safeRecipientName(STACKED_FORMAT_NAME.name)).toBe(STACKED_FORMAT_NAME.cleaned);
    expect(safeRecipientName("1. - > **王小明**")).toBe("王小明");
    expect(safeRecipientName("王小明\n# 標題\r\n- 清單")).toBe("王小明 # 標題 - 清單");
  });

  it.each(NORMAL_NAMES)("keeps an ordinary name as typed: %s", (name) => {
    expect(safeRecipientName(name)).toBe(name);
    expect(safeRecipientName(`  ${name}  `)).toBe(name);
  });

  it("folds invisible characters before judging, so they cannot hide an address", () => {
    expect(looksLikeWebAddress("evil​.​test")).toBe(true);
    expect(safeRecipientName("evil​.​test")).toBe("");
    expect(safeRecipientName("evil[.]test")).toBe("");
    expect(safeRecipientName("王‮小明")).toBe("王小明");
  });

  it("clips to the limit in code points and falls back when nothing is left", () => {
    expect(Array.from(safeRecipientName("王".repeat(200)))).toHaveLength(80);
    expect(safeRecipientName("😀".repeat(100))).toBe("😀".repeat(80));
    expect(safeRecipientNameOr("   ", "你")).toBe("你");
    expect(safeRecipientNameOr("**[]()**", "你")).toBe("你");
    expect(safeRecipientNameOr(null, "你")).toBe("你");
  });

  it("is the same cleaning the automation template uses (behaviour unchanged)", () => {
    for (const value of [...PHISHING_NAMES.map((entry) => entry.name), STACKED_FORMAT_NAME.name, ...NORMAL_NAMES, "{{vendor_name}}", "Node.js 入門"]) {
      expect(genericEmailVariableValue(value, { outsider: true })).toBe(safeRecipientName(value));
      expect(genericEmailVariableValue(value)).toBe(cleanInlineEmailValue(value));
    }
    // A vendor's own text keeps a dotted word; only a scheme or www drops it.
    expect(genericEmailVariableValue("Node.js 入門")).toBe("Node.js 入門");
    expect(genericEmailVariableValue("www.example 直播")).toBe("");
  });
});

describe("renderMessageTemplate {{name}} (A2-13)", () => {
  const variables = (name: string) => ({
    name,
    live_title: "新品直播",
    live_url: "https://app.example.test/live/new",
    live_start_at: "2026/08/08 12:00",
    vendor_name: "測試商家",
    unsubscribe_url: "https://app.example.test/unsubscribe?token=x",
  });
  const render = (name: string) => ({
    subject: renderMessageTemplate("{{name}}，你已報名 {{live_title}}", variables(name)),
    body: renderMessageTemplate("{{name}} 你好\n直播入口：{{live_url}}\n退訂：{{unsubscribe_url}}", variables(name)),
  });

  it.each(PHISHING_NAMES)("replaces a phishing name with the greeting in the subject and body: $label", ({ name }) => {
    const mail = render(name);
    expectNoPhishingTrace(mail);
    expect(mail.subject).toBe(`${MESSAGE_TEMPLATE_NAME_FALLBACK}，你已報名 新品直播`);
    expect(mail.body.startsWith(`${MESSAGE_TEMPLATE_NAME_FALLBACK} 你好\n`)).toBe(true);
  });

  it("does not let a name at the start of a line make a heading", () => {
    const mail = render(STACKED_FORMAT_NAME.name);
    expectNoFormatting(mail);
    expect(mail.body.startsWith("x 你好\n")).toBe(true);
  });

  it.each(NORMAL_NAMES)("keeps an ordinary name: %s", (name) => {
    expect(render(name).subject).toBe(`${name}，你已報名 新品直播`);
    expect(render(name).body.startsWith(`${name} 你好\n`)).toBe(true);
  });

  it("leaves the vendor's own variables untouched", () => {
    expect(renderMessageTemplate("{{live_url}} {{vendor_name}}", variables("王小明"))).toBe("https://app.example.test/live/new 測試商家");
  });
});
