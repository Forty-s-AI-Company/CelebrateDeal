import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SupportPage from "./page";

describe("/support route", () => {
  it("offers existing support paths without unconfirmed response promises", () => {
    const html = renderToStaticMarkup(<SupportPage />);

    expect(html).toContain("客服與付款協助");
    expect(html).toContain("Carry Digital Nomad 凱瑞數位");
    expect(html).toContain('href="mailto:a88221144@gmail.com"');
    expect(html).toContain("客服信箱：a88221144@gmail.com");
    expect(html).toContain("服務時段尚未公告");
    expect(html).not.toContain("客服聯絡管道與服務時段尚未公告");
    expect(html).toContain("一般客服目前無法承諾固定回應時間");
    expect(html).toContain("平台方案目前不會自動扣款");
    expect(html).toContain("查看退款政策 →");
    expect(html).not.toContain("發布狀態");
    expect(html).toContain("請勿提供完整卡號、卡片安全碼、帳號密碼、登入憑證或一次性驗證碼");
    expect(html).toContain('href="/support/orders"');
    expect(html).toContain('href="/policies/refunds"');
    expect(html).toContain('href="/merchant-onboarding"');
    expect(html).toContain('href="/support/requests"');
    for(const internal of ["DRAFT","HUMAN OWNER","P0","P1","P2","owner","webhook","目標 15 分鐘","目標 1 小時","目標 1 個工作日"])expect(html).not.toContain(internal);
  });
});
