import { describe, expect, it } from "vitest";
import { calculateAnalyticsFunnel } from "./analytics-funnel";

describe("calculateAnalyticsFunnel", () => {
  it("calculates each stage as a percentage of views", () => {
    expect(calculateAnalyticsFunnel({ views: 80, productClicks: 20, ctaClicks: 6, submissions: 3 })).toEqual([
      { key: "views", label: "觀看", count: 80, percentage: 100 },
      { key: "productClicks", label: "商品點擊", count: 20, percentage: 25 },
      { key: "ctaClicks", label: "CTA 點擊", count: 6, percentage: 7.5 },
      { key: "submissions", label: "名單", count: 3, percentage: 3.8 },
    ]);
  });

  it("returns stable 0% ratios when there are no views", () => {
    const funnel = calculateAnalyticsFunnel({ views: 0, productClicks: 4, ctaClicks: 2, submissions: 1 });

    expect(funnel.map((step) => step.percentage)).toEqual([0, 0, 0, 0]);
    expect(funnel.map((step) => step.count)).toEqual([0, 4, 2, 1]);
  });
});
