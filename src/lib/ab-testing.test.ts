import { describe, expect, it, vi } from "vitest";
import { abVariantCookieName, assignAbVariant, calculateAbMetrics, deterministicBucket, loadAbMetrics, recordAbEvent } from "@/lib/ab-testing";

describe("A/B split testing", () => {
  it("keeps the same visitor in the same deterministic bucket", () => {
    const first = deterministicBucket("launch-page", "visitor_12345678");
    expect(deterministicBucket("launch-page", "visitor_12345678")).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(10_000);
  });

  it("distributes a representative visitor set close to 50/50", () => {
    const assignments = Array.from({ length: 2_000 }, (_, index) => assignAbVariant({ id: "launch", variantAWeight: 0.5 }, `visitor_${index.toString().padStart(8, "0")}`));
    const aRatio = assignments.filter((variant) => variant === "A").length / assignments.length;
    expect(aRatio).toBeGreaterThan(0.46);
    expect(aRatio).toBeLessThan(0.54);
  });

  it("preserves a valid cookie assignment and scopes cookie names by experiment", () => {
    expect(assignAbVariant({ id: "launch" }, "visitor_12345678", "B")).toBe("B");
    expect(abVariantCookieName("launch")).toMatch(/^cd_ab_[a-f0-9]{20}$/u);
    expect(abVariantCookieName("launch")).not.toBe(abVariantCookieName("other"));
  });

  it("calculates conversion rates and rejects impossible counters", () => {
    expect(calculateAbMetrics([{ variant: "A", exposures: 40, conversions: 5 }, { variant: "B", exposures: 0, conversions: 0 }]))
      .toEqual([{ variant: "A", exposures: 40, conversions: 5, conversionRate: 12.5 }, { variant: "B", exposures: 0, conversions: 0, conversionRate: 0 }]);
    expect(() => calculateAbMetrics([{ variant: "A", exposures: 1, conversions: 2 }])).toThrow();
  });

  it("records and aggregates tenant-scoped exposure and conversion events", async () => {
    const store = { analyticsEvent: { create: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([{ eventType: "ab_exposure", payload: { variant: "A" } }, { eventType: "ab_conversion", payload: { variant: "A" } }]) } };
    await recordAbEvent(store, { vendorId: "vendor-1", experimentId: "launch", visitorId: "visitor_12345678", variant: "A", type: "exposure" });
    await expect(loadAbMetrics(store, { vendorId: "vendor-1", experimentId: "launch" })).resolves.toEqual([{ variant: "A", exposures: 1, conversions: 1, conversionRate: 100 }, { variant: "B", exposures: 0, conversions: 0, conversionRate: 0 }]);
    expect(store.analyticsEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1" }) }));
  });
});
