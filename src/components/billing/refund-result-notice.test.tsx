import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const searchParams = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

import { RefundResultNotice } from "./refund-result-notice";

describe("RefundResultNotice", () => {
  beforeEach(() => {
    searchParams.get.mockReset();
  });

  it("renders nothing for unrelated or missing query errors", () => {
    for (const value of [null, "refund", "other"]) {
      searchParams.get.mockReturnValue(value);
      expect(renderToStaticMarkup(<RefundResultNotice />)).toBe("");
    }
    expect(searchParams.get).toHaveBeenCalledTimes(3);
    expect(searchParams.get).toHaveBeenCalledWith("error");
  });

  it("renders an accessible alert for an already-processed refund", () => {
    searchParams.get.mockReturnValue("refund_already_processed");

    const html = renderToStaticMarkup(<RefundResultNotice />);

    expect(html).toContain('role="alert"');
    expect(html).toContain('data-testid="billing-refund-already-processed"');
    expect(html).toContain("此交易已完成退款");
    expect(html).toContain("系統沒有再次送出退款請求");
  });
});
