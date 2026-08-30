import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import MessageDeliveriesError from "./error";

describe("MessageDeliveriesError", () => {
  it("offers safe recovery without exposing the exception", () => {
    const html = renderToStaticMarkup(createElement(MessageDeliveriesError, {
      error: new Error("sensitive database detail"),
      unstable_retry: vi.fn(),
    }));
    expect(html).toContain("暫時無法載入 Email 寄送紀錄");
    expect(html).toContain("重新載入");
    expect(html).toContain("沒有變更任何寄送排程");
    expect(html).not.toContain("sensitive database detail");
  });
});
