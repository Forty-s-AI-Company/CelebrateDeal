import { afterEach, describe, expect, it, vi } from "vitest";
import {
  genericEmailTextLooksLikeLink,
  GENERIC_EMAIL_BODY_MAX,
  GENERIC_EMAIL_SUBJECT_MAX,
  genericEmailContentUsable,
  genericEmailVariablesForTrigger,
  genericEmailVariableValue,
  normalizeGenericEmailContent,
  renderGenericEmail,
} from "@/lib/automation-generic-email";
import { parseAutomationRule } from "@/lib/automation-workflow";
import { protectEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import { richTextToEmailHtml } from "@/lib/rich-text";
import { ensureEmailUnsubscribeFooter } from "@/lib/email-delivery-format";
import { expectNoFormatting, expectNoPhishingTrace, NORMAL_NAMES, PHISHING_NAMES, STACKED_FORMAT_NAME } from "@/test/recipient-name-cases";

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
    expect(rendered.subject).toBe("你，感謝你看了 本活動");
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

describe("generic e-mail review fixes (A2-04, #665)", () => {
  const nameOf = (name: string) => renderGenericEmail({ subject: "{{name}}", body: "{{name}}" }, { name });

  it.each([
    "hthttps://tps://evil.test/login",
    "hthttp://tp://e.test",
    "https://evil.test",
    "www.evil-bank.test",
    "evil.test",
    "Evil.Test/login",
    "ｅｖｉｌ．ｔｅｓｔ",
    "ｗｗｗ．ｅｖｉｌ．ｔｅｓｔ",
    "evil​.test",
    "ev­il.test",
    "[x](evil.test)",
    "Mr.Wang",
  ])("drops the whole name when it looks like a web address (%j)", (name) => {
    const rendered = nameOf(name);
    expect(rendered).toEqual({ subject: "你", body: "你" });
  });

  it("keeps an ordinary name, in any script", () => {
    expect(nameOf("王小明")).toEqual({ subject: "王小明", body: "王小明" });
    expect(nameOf("Mary O'Neil Jr.")).toEqual({ subject: "Mary O'Neil Jr.", body: "Mary O'Neil Jr." });
  });

  it("cleans until nothing changes, so removing one piece never rebuilds another", () => {
    // Without an address look (vendor-typed values), the cleaning itself must not leave a scheme behind.
    for (const raw of ["hthttps://tps://x", "hthttp://tp://x", "hhttps://ttps://x"]) {
      expect(genericEmailVariableValue(raw)).not.toMatch(/:\/\//u);
      expect(genericEmailVariableValue(raw)).toBe("x");
    }
    expect(genericEmailVariableValue("[[x]]((y))")).toBe("xy");
  });

  it.each([
    ["# # x", "x"],
    ["1.1. x", "x"],
    ["- - x", "x"],
    ["> # - x", "x"],
    ["+ * x", "x"],
    ["  ## 1) x", "x"],
  ])("removes stacked leading format symbols (%j)", (raw, expected) => {
    expect(genericEmailVariableValue(raw)).toBe(expected);
    expect(richTextToEmailHtml(renderGenericEmail({ subject: "s", body: "{{vendor_name}}" }, { vendor_name: raw }).body)).toBe(`<p>${expected}</p>`);
  });

  it("removes direction marks and zero-width characters from a value, and refuses them in the merchant's text", () => {
    expect(genericEmailVariableValue("a‎b‏c؜d​e⁠f﻿g")).toBe("abcdefg");
    for (const mark of ["‎", "‏", "؜", "​", "⁠", "﻿"]) {
      expect(normalizeGenericEmailContent({ subject: `a${mark}b`, body: "ok" })).toBeNull();
      expect(normalizeGenericEmailContent({ subject: "ok", body: `a${mark}b` })).toBeNull();
    }
  });

  it("counts and cuts by code point, never in the middle of a surrogate pair", () => {
    const emoji = "😀";
    expect(normalizeGenericEmailContent({ subject: emoji.repeat(GENERIC_EMAIL_SUBJECT_MAX), body: "ok" })).not.toBeNull();
    expect(normalizeGenericEmailContent({ subject: emoji.repeat(GENERIC_EMAIL_SUBJECT_MAX + 1), body: "ok" })).toBeNull();
    const cut = genericEmailVariableValue(emoji.repeat(100));
    expect(Array.from(cut)).toHaveLength(80);
    expect(cut).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/u);
  });

  it("falls back to 本活動 when the form has no Live", () => {
    expect(renderGenericEmail({ subject: "{{live_title}}", body: "{{live_title}}" }, {})).toEqual({ subject: "本活動", body: "本活動" });
  });

  it.each([
    "https://example.test",
    "http://example.test/a",
    "[點我](example.test)",
    "看 www.example.test",
    "看 example.test",
    "看 shop.example.com/path",
    "ｅｘａｍｐｌｅ．ｔｅｓｔ",
    "mailto:a@example.test",
    "javascript:alert(1)",
  ])("refuses a link or web address in the merchant's text (%j)", (text) => {
    expect(genericEmailTextLooksLikeLink(text)).toBe(true);
    expect(normalizeGenericEmailContent({ subject: "ok", body: text })).toBeNull();
    expect(normalizeGenericEmailContent({ subject: text, body: "ok" })).toBeNull();
    expect(genericEmailContentUsable("form_registered", { subject: "ok", body: text })).toBe(false);
  });

  it("still allows basic formatting and ordinary numbers and abbreviations", () => {
    for (const text of ["# 標題\n- 項目\n1. 項目\n**粗體**", "約 3.5 小時，即 e.g. 這樣", "價格 NT$1,200.50", "你好 {{name}}。"]) {
      expect(genericEmailTextLooksLikeLink(text), text).toBe(false);
      expect(normalizeGenericEmailContent({ subject: "ok", body: text }), text).not.toBeNull();
    }
  });
});

describe("generic e-mail second review fixes (A2-04, #665)", () => {
  it.each([
    "用 Node.js 和 Next.js 寫",
    "ASP.NET 與 Express.js",
    "Mr.Lin 你好",
    "附上 report.pdf 和 index.html",
    "JavaScript: 從零開始",
    "Data: 三個重點",
    "Mailto: 是什麼",
    "版本 v1.2.3，價格 1,200.50",
  ])("lets an ordinary text through (%j)", (text) => {
    expect(genericEmailTextLooksLikeLink(text), text).toBe(false);
    expect(normalizeGenericEmailContent({ subject: "ok", body: text }), text).not.toBeNull();
  });

  it.each([
    "https://evil.test/login",
    "http://evil.test",
    "HTTPS://EVIL.TEST",
    "www.evil.test",
    "evil.com",
    "bank.example.com/login",
    "evil.xyz",
    "evil.tw",
    "evil.io 立即登入",
    "evil.unknown/login",
    "evil.unknown:8080",
    "javascript:alert(1)",
    "mailto:a@evil.test",
    "data:text/html;base64,AAAA",
    "[click](evil.com)",
    "ｅｖｉｌ．ｃｏｍ",
    "evil\u200b.com",
  ])("still blocks a real address (%j)", (text) => {
    expect(genericEmailTextLooksLikeLink(text), text).toBe(true);
    expect(normalizeGenericEmailContent({ subject: "ok", body: `請看 ${text}` })).toBeNull();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("cuts a subject at 200 UTF-16 units without splitting a surrogate pair, and the delivery accepts it", () => {
    vi.stubEnv("CSRF_SECRET", "generic-email-test-secret-that-is-longer-than-thirty-two-bytes");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
    const emoji = "😀";
    const rendered = renderGenericEmail({ subject: `{{live_title}}${emoji.repeat(90)}`, body: "內文" }, { live_title: emoji.repeat(80) });
    expect(rendered.subject.length).toBeLessThanOrEqual(200);
    expect(rendered.subject.length % 2).toBe(0);
    expect(rendered.subject).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u);
    expect(Array.from(rendered.subject).every((char) => char === emoji)).toBe(true);
    expect(() => protectEmailDeliveryPayload({ recipientEmail: "a@example.test", subject: rendered.subject, body: rendered.body }, { vendorId: "v1", deliveryId: "d1" })).not.toThrow();
    // An odd leftover unit is dropped, not split: a 199-unit budget cannot end in half a pair.
    expect(renderGenericEmail({ subject: `a${emoji.repeat(100)}`, body: "x" }, {}).subject.length).toBeLessThanOrEqual(200);
  });

  it.each([
    "王。evil。com",
    "evil。com",
    "例子.中國",
    "пример.рф",
    "ｅｖｉｌ。ｃｏｍ",
  ])("drops a name that is a non-ASCII or ideographic-dot address (%j)", (name) => {
    expect(renderGenericEmail({ subject: "{{name}}", body: "{{name}}" }, { name })).toEqual({ subject: "你", body: "你" });
  });
});

describe("generic e-mail {{name}} through the shared recipient-name cleaning (A2-13)", () => {
  const content = { subject: "{{name}}，感謝你", body: "{{name}} 你好\n{{vendor_name}}" };

  it.each(PHISHING_NAMES)("greets with 你 instead of a phishing name: $label", ({ name }) => {
    const rendered = renderGenericEmail(content, { name, vendor_name: "商家" });
    expectNoPhishingTrace(rendered);
    expect(rendered).toEqual({ subject: "你，感謝你", body: "你 你好\n商家" });
  });

  it("removes a stacked line-start format prefix", () => {
    const rendered = renderGenericEmail(content, { name: STACKED_FORMAT_NAME.name, vendor_name: "商家" });
    expectNoFormatting(rendered);
    expect(rendered.body).toBe(`${STACKED_FORMAT_NAME.cleaned} 你好\n商家`);
  });

  it.each(NORMAL_NAMES)("keeps an ordinary name: %s", (name) => {
    expect(renderGenericEmail(content, { name, vendor_name: "商家" })).toEqual({ subject: `${name}，感謝你`, body: `${name} 你好\n商家` });
  });

  it.each([
    ["CGJ U+034F", "evil͏.com"],
    ["variation selector U+FE00", "evil︀.com"],
    ["variation selector U+FE0F after the dot", "evil.️com"],
    ["tag space U+E0020", "evil\u{e0020}.com"],
    ["Mongolian FVS U+180B", "evil᠋.com"],
    ["Khmer U+17B4", "evil឴.com"],
    ["interlinear anchor U+FFF9", "evil￹.com"],
    ["shorthand overlap U+1BCA0", "evil\u{1bca0}.com"],
    ["musical beam U+1D173", "evil\u{1d173}.com"],
    ["combining acute U+0301 after the dot", "evil.́com"],
    ["combining acute U+0301 before the dot", "eviĺ.com"],
    ["hidden character inside www", "w͏ww.evil.test"],
  ])("refuses a merchant text that hides an address with %s (#670 MAJOR-1)", (_label, address) => {
    expect(genericEmailTextLooksLikeLink(`請看 ${address}`)).toBe(true);
    expect(normalizeGenericEmailContent({ subject: "ok", body: `請看 ${address}` })).toBeNull();
    expect(normalizeGenericEmailContent({ subject: `請看 ${address}`, body: "ok" })).toBeNull();
  });

  it.each(["例子.com", "eviĺ.com", "пример.org/login", "請看 evil.com立即登入"])("refuses an internationalized or run-on host (%j)", (address) => {
    expect(genericEmailTextLooksLikeLink(address)).toBe(true);
  });

  it("still lets ordinary merchant text with accents, Indic marks and emoji through", () => {
    for (const text of ["Café 與 José Müller 的分享", "राहुल का सत्र", "❤️ 感謝參加", "版本 v1.2.3", "Next.js 入門"]) {
      expect(genericEmailTextLooksLikeLink(text), text).toBe(false);
    }
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
