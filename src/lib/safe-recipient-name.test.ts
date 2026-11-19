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

const escape = (text: string) => Array.from(text, (char) => `U+${char.codePointAt(0)!.toString(16).toUpperCase()}`).join(" ");

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

  it("removes every default-ignorable and format character before judging, not only a known list (#670 MAJOR-1)", () => {
    // Characters the first version let through between "evil" and ".test".
    for (const hidden of ["͏", "︀", "️", "\u{e0020}", "\u{e007f}", "᠋", "឴", "឵", "￹", "￻", "\u{1bca0}", "\u{1bca3}", "\u{1d173}", "\u{1d17a}", "⁥", "ㅤ", "ᅟ"]) {
      expect(looksLikeWebAddress(`evil${hidden}.test`), escape(hidden)).toBe(true);
      expect(looksLikeWebAddress(`evil.${hidden}test`), escape(hidden)).toBe(true);
      expect(safeRecipientName(`evil${hidden}.test`), escape(hidden)).toBe("");
    }
    // A combining mark on either side of the dot still reads as an address.
    for (const mark of ["́", "̈́", "⃝"]) {
      expect(safeRecipientName(`evil.${mark}test`)).toBe("");
      expect(safeRecipientName(`evil${mark}.test`)).toBe("");
    }
  });

  it("removes the same default-ignorable and format characters from the name that is shown (#670 second review NIT)", () => {
    for (const hidden of ["͏", "︀", "\u{e0020}", "᠋", "឴", "￹", "\u{1bca0}", "\u{1d173}", "‍", "⁥"]) {
      expect(safeRecipientName(`王${hidden}小明`), escape(hidden)).toBe("王小明");
    }
    // An emoji keeps its base character; its presentation selector is dropped.
    expect(safeRecipientName("Ann❤️")).toBe("Ann❤");
  });

  it("drops a name joined by a full-width dot, which NFKC turns into `.` (documented trade-off)", () => {
    expect(safeRecipientName("麥可．喬丹")).toBe("");
    expect(safeRecipientNameOr("麥可．喬丹", "你")).toBe("你");
    // The middle dot used in transliterated names is not a dot and is kept.
    expect(safeRecipientName("麥可・喬丹")).toBe("麥可・喬丹");
    expect(safeRecipientName("麥可·喬丹")).toBe("麥可·喬丹");
  });

  it("shows the NFKC form of the name (documented: what is shown can differ from what was typed)", () => {
    expect(safeRecipientName("ＭＡＲＹ　ＪＡＮＥ")).toBe("MARY JANE");
    expect(safeRecipientName("ｶﾀｶﾅ")).toBe("カタカナ");
    expect(safeRecipientName("José")).toBe("José");
    expect(safeRecipientName("José")).toBe("José");
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
