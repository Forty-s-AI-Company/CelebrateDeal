import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MvpBillingNotice } from "./mvp-billing-notice";

describe("MVP billing notices", () => {
  it("explains quota enforcement without denying post-purchase support", () => {
    const html = renderToStaticMarkup(<MvpBillingNotice kind="usage" />);
    expect(html).toContain('aria-label="首發收費範圍"');
    expect(html).toContain("阻擋新增用量");
    expect(html).toContain("查單、退款與客服仍可使用");
    expect(html).toContain("既有帳單與應付款項保留");
  });
  it("distinguishes disabled new commissions from existing liabilities", () => {
    const html = renderToStaticMarkup(<MvpBillingNotice kind="commission" />);
    expect(html).toContain("暫停新增推廣與團隊佣金");
    expect(html).toContain("退款沖回、爭議及應付款項仍保留");
  });
});
