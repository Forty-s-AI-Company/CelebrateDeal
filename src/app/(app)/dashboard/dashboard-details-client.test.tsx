import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import DashboardDetailsClient from "./dashboard-details-client";

it("renders a nonblocking detail placeholder before browser hydration", () => {
  const html = renderToStaticMarkup(<DashboardDetailsClient diagnosticDelayMs={0} />);
  expect(html).toContain('data-dashboard-scope="details-shell"');
  expect(html).toContain("正在載入 Dashboard 明細");
  expect(html).not.toContain('data-dashboard-scope="details"');
});
