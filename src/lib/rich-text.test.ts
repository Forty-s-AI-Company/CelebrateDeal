import { describe, expect, it } from "vitest";
import { insertTextAtSelection, parseRichText, richTextToEmailHtml, richTextToPlainText } from "./rich-text";

describe("rich-text", () => {
  it("inserts a template token at the exact selection and restores a collapsed caret", () => {
    expect(insertTextAtSelection("嗨 訪客", 2, 4, "{{name}}")).toEqual({
      value: "嗨 {{name}}",
      selectionStart: 10,
      selectionEnd: 10,
    });
    expect(insertTextAtSelection("內容", -5, 99, "{{live_title}}")).toEqual({
      value: "{{live_title}}",
      selectionStart: 14,
      selectionEnd: 14,
    });
  });

  it("keeps the supported heading, inline, and list syntax structured", () => {
    const blocks = parseRichText("# 活動重點\n\n**限時** *優惠* [查看商品](https://example.test/offer)\n\n- 第一項\n- 第二項\n\n1. 報名\n2. 上課");

    expect(blocks).toMatchObject([
      { type: "heading", level: 2, inlines: [{ type: "text", value: "活動重點" }] },
      { type: "paragraph", inlines: [{ type: "strong", value: "限時" }, { type: "text", value: " " }, { type: "emphasis", value: "優惠" }, { type: "text", value: " " }, { type: "link", label: "查看商品", href: "https://example.test/offer" }] },
      { type: "unordered-list", items: [[{ type: "text", value: "第一項" }], [{ type: "text", value: "第二項" }]] },
      { type: "ordered-list", items: [[{ type: "text", value: "報名" }], [{ type: "text", value: "上課" }]] },
    ]);
  });

  it("renders an escaped Email representation and plaintext fallback without raw HTML", () => {
    const value = "## <script>不執行</script>\n\n**安全** [官網](https://example.test/?q=a&b=c)\n\n[危險](javascript:alert(1))";

    expect(richTextToEmailHtml(value)).toContain("&lt;script&gt;不執行&lt;/script&gt;");
    expect(richTextToEmailHtml(value)).toContain('<a href="https://example.test/?q=a&amp;b=c">官網</a>');
    expect(richTextToEmailHtml(value)).not.toContain('href="javascript:');
    expect(richTextToPlainText(value)).toContain("安全 官網 (https://example.test/?q=a&b=c)");
    expect(richTextToPlainText(value)).toContain("[危險](javascript:alert(1))");
  });

  it("turns a safe bare unsubscribe URL into a click target while keeping surrounding punctuation outside", () => {
    const value = "退訂：https://example.test/unsubscribe。";

    expect(richTextToEmailHtml(value)).toContain('<a href="https://example.test/unsubscribe">https://example.test/unsubscribe</a>。');
    expect(richTextToPlainText(value)).toBe("退訂：https://example.test/unsubscribe (https://example.test/unsubscribe)。");
  });

  it("keeps existing plain text readable without forcing merchants to migrate", () => {
    const value = "原本第一行\n原本第二行";

    expect(richTextToPlainText(value)).toBe(value);
    expect(richTextToEmailHtml(value)).toBe("<p>原本第一行<br>原本第二行</p>");
  });
});
