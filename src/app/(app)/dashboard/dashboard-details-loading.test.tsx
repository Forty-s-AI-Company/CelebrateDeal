import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DashboardDetailsLoading from "./dashboard-details-loading";

describe("dashboard details loading", () => {
  it("renders a local accessible skeleton", () => {
    const html = renderToStaticMarkup(<DashboardDetailsLoading />);
    expect(html).toContain('data-dashboard-scope="details-shell"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-live="polite"');
  });
});
