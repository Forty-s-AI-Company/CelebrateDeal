import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PaymentResultLoading from "./loading";

describe("payment result loading UI", () => {
  it("announces a safe pending state without claiming payment success", () => {
    const html = renderToStaticMarkup(<PaymentResultLoading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain("正在安全確認付款與訂單狀態");
    expect(html).not.toContain("付款完成");
  });
});
