import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BillingUsageLoading from "./loading";

describe("billing usage loading UI", () => {
  it("announces pending state without presenting stale usage as final", () => {
    const html = renderToStaticMarkup(<BillingUsageLoading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain("正在載入用量資料");
    expect(html).not.toContain("Stream 額度已用完");
  });
});
