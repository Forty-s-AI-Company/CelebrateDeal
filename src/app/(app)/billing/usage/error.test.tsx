import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import BillingUsageError from "./error";

describe("billing usage error UI", () => {
  it("shows a safe retry path without exposing the exception message", () => {
    const html = renderToStaticMarkup(createElement(BillingUsageError, {
      error: new Error("database connection secret detail"),
      reset: vi.fn(),
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain("暫時無法載入用量資料");
    expect(html).toContain("重新載入");
    expect(html).not.toContain("database connection secret detail");
  });
});
