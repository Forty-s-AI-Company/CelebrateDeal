import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MessageDeliveriesLoading from "./loading";

describe("MessageDeliveriesLoading", () => {
  it("announces the pending route state accessibly", () => {
    const html = renderToStaticMarkup(<MessageDeliveriesLoading />);
    expect(html).toContain("aria-busy=\"true\"");
    expect(html).toContain("正在載入 Email 寄送營運資料");
    expect(html).toContain("role=\"status\"");
  });
});
