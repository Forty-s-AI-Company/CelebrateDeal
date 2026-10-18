import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const probe = vi.hoisted(() => ({ active: 0, peak: 0, completed: 0, empty: false }));

function count<T>(value: T): Promise<T> {
  if (probe.empty) value = (typeof value === "number" ? 0 : []) as T;
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

beforeEach(() => { probe.active = 0; probe.peak = 0; probe.completed = 0; probe.empty = false; });

describe("Dashboard KPI read model", () => {
  it("runs six reads in two bounded groups and renders their measured result", async () => {
    const html = renderToStaticMarkup(await DashboardKpis({ vendorId: "synthetic-vendor" }));

    expect(html).not.toContain("<details");
    expect(probe.completed).toBe(6);
    expect(probe.peak).toBe(3);
    expect(html).toContain('data-dashboard-read-operation-count="6"');
    expect(html).toContain("近 7 天播放 session");
    expect(html).not.toContain("Dashboard KPI 暫時無法載入");
  });
});

describe("Dashboard KPI presentation", () => {
  it("collapses empty metrics without removing metric names or issuing extra reads", async () => {
    probe.empty = true;
    const html = renderToStaticMarkup(await DashboardKpis({ vendorId: "synthetic-vendor" }));
    expect(html).toContain("<details");
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
    expect(html).toContain("目前指標尚無活動資料，展開查看全部指標");
    expect(html).toContain("近 7 天報名");
    expect(html).toContain("近 7 天轉換漏斗");
    expect(probe.completed).toBe(6);
  });

  it("keeps load failures visible instead of treating them as zero activity", async () => {
    const html = renderToStaticMarkup(await DashboardKpis({ vendorId: "synthetic-vendor", diagnosticFailureScope: "analytics" }));
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("<details");
    expect(html).not.toContain("目前指標尚無活動資料");
  });
});
