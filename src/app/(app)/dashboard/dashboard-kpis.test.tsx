import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const probe = vi.hoisted(() => ({ active: 0, peak: 0, completed: 0 }));

function count<T>(value: T): Promise<T> {
  probe.active += 1;
  probe.peak = Math.max(probe.peak, probe.active);
  return new Promise((resolve) => setTimeout(() => {
    probe.active -= 1;
    probe.completed += 1;
    resolve(value);
  }, 5));
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    formSubmission: { groupBy: () => count([{ verificationStatus: "VERIFIED", _count: { _all: 2 } }]) },
    liveChatMessage: { count: () => count(3) },
    interactionEvent: { count: () => count(4) },
    $queryRaw: () => count([{ eventType: "page_view", uniqueVisitors: 5 }]),
    commerceOrder: { count: () => count(6) },
    emailDelivery: { groupBy: () => count([{ status: "sent", _count: { _all: 7 } }]) },
  }),
}));

import DashboardKpis from "./dashboard-kpis";

beforeEach(() => { probe.active = 0; probe.peak = 0; probe.completed = 0; });

describe("Dashboard KPI read model", () => {
  it("runs six reads in two bounded groups and renders their measured result", async () => {
    const html = renderToStaticMarkup(await DashboardKpis({ vendorId: "synthetic-vendor" }));

    expect(probe.completed).toBe(6);
    expect(probe.peak).toBe(3);
    expect(html).toContain('data-dashboard-read-operation-count="6"');
    expect(html).toContain("近 7 天播放 session");
    expect(html).not.toContain("Dashboard KPI 暫時無法載入");
  });
});
