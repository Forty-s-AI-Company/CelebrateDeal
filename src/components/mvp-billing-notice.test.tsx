import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MvpBillingNotice } from "./mvp-billing-notice";

describe("MVP billing notices", () => {
  it("explains enabled metered billing and immutable historical invoices", () => {
    const html = renderToStaticMarkup(<MvpBillingNotice kind="usage" />);
    expect(html).toContain('aria-label="首發收費範圍"');
    expect(html).toContain("用量超額計費已正式啟用");
    expect(html).toContain("觀看分鐘、活動、推廣者與儲存分鐘");
    expect(html).toContain("歷史帳單維持原始金額");
    expect(html).toContain("不會回溯重算");
  });
  it("explains enabled commissions and the immutable follow-up lifecycle", () => {
    const html = renderToStaticMarkup(<MvpBillingNotice kind="commission" />);
    expect(html).toContain("聯盟推廣與團隊分潤已啟用");
    expect(html).toContain("付款成功後寫入帳本");
    expect(html).toContain("退款沖回、爭議及應付款項");
  });
});
