import { describe, expect, it } from "vitest";

import {
  generateDirectorTimelineScript,
  generateFunnelSalesCopy,
  generateLeadClosingInsights,
} from "@/lib/ai-funnel-assistant";

describe("ai funnel assistant fallback", () => {
  it("generates structured sales copy deterministically", () => {
    const input = { topic: "高客單成交", painPoints: ["名單很多但不成交"], targetAudience: "教練" };
    expect(generateFunnelSalesCopy(input)).toEqual(generateFunnelSalesCopy(input));
    const result = generateFunnelSalesCopy(input);
    expect(result.heroHeadline).toContain("高客單成交");
    expect(result.painPoints).toHaveLength(1);
    expect(result.valuePropositions).toHaveLength(3);
    expect(result.faqs).toHaveLength(3);
  });

  it("keeps untrusted copy as text and strips control characters", () => {
    const result = generateFunnelSalesCopy({ topic: "<script>alert(1)</script>\u0000", painPoints: [], targetAudience: "學員" });
    expect(result.heroHeadline).not.toContain("&lt;");
    expect(result.heroHeadline).not.toContain("\u0000");
    expect(result.heroHeadline).toContain("<script>");
  });

  it("creates bounded timeline interaction beats", () => {
    const result = generateDirectorTimelineScript({ durationMinutes: 90, topic: "成交" });
    expect(result.durationMinutes).toBe(90);
    expect(result.nodes.length).toBeGreaterThanOrEqual(5);
    expect(result.nodes.some((node) => node.type === "poll")).toBe(true);
    expect(result.nodes.some((node) => node.type === "offer")).toBe(true);
    expect(result.nodes.every((node) => node.minute < node.endMinute && node.endMinute <= 90)).toBe(true);
  });

  it("returns exactly three consultative lead openings", () => {
    const result = generateLeadClosingInsights({ watchedSeconds: 1200, bookingAnswers: ["提升轉換率"] });
    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions[0]).toContain("提升轉換率");
    expect(result.suggestions.join(" ")).not.toContain("undefined");
  });
});
