import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DashboardLoading from "./loading";

describe("dashboard loading state", () => {
  it("announces that operational metrics are loading", () => {
    const html = renderToStaticMarkup(<DashboardLoading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("正在載入營運總覽");
    expect(html).toContain("報名、觀看、訂單與 Email 寄送狀態");
  });
});
