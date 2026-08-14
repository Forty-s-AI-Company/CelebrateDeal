import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import OrderNotFound from "./not-found";

describe("orders not-found UI", () => {
  it("explains the tenant-safe outcome without exposing order details", () => {
    const html = renderToStaticMarkup(<OrderNotFound />);

    expect(html).toContain("找不到這筆訂單");
    expect(html).toContain("不屬於目前登入的商家");
    expect(html).toContain('href="/orders"');
  });
});
