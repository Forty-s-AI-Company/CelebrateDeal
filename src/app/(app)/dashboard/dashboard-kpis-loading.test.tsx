import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DashboardKpisLoading from "./dashboard-kpis-loading";

describe("dashboard KPI loading", () => {
  it("renders an accessible local skeleton", () => {
    const html = renderToStaticMarkup(<DashboardKpisLoading />);
    expect(html).toContain('data-dashboard-scope="kpis-shell"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("正在載入 Dashboard KPI");
  });
});
