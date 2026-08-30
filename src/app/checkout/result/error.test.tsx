import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import PaymentResultError from "./error";

describe("payment result error UI", () => {
  it("provides an accessible retry without exposing server error details", () => {
    const html = renderToStaticMarkup(createElement(PaymentResultError, {
      error: new Error("private provider response detail"),
      reset: vi.fn(),
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain("重新載入付款狀態");
    expect(html).not.toContain("private provider response detail");
  });
});
