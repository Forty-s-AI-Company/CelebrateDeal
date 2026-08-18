import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import DashboardError from "./error";

describe("dashboard error state", () => {
  it("offers a safe retry without exposing the underlying error", () => {
    const reset = vi.fn();
    const html = renderToStaticMarkup(<DashboardError error={new Error("database endpoint detail")} reset={reset} />);

    expect(html).toContain('role="alert"');
    expect(html).toContain("營運資料暫時無法載入");
    expect(html).toContain("資料服務可能暫停或連線不穩");
    expect(html).toContain("重新載入營運資料");
    expect(html).not.toContain("database endpoint detail");
  });
});
