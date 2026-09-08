import { describe, expect, it } from "vitest";

import { buildReferralUrl, generateReferralCard } from "./referral-card";

describe("referral card", () => {
  it("generates a dark SVG poster with an encoded referral URL", async () => {
    const referralUrl = buildReferralUrl({ baseUrl: "https://example.test/form/summer", referralCode: "A&B", campaign: "夏季活動" });
    const card = await generateReferralCard({
      participantName: "小明",
      salutation: "嗨",
      topic: "高轉換直播課",
      startsAt: "2026-09-09T11:00:00.000Z",
      referralUrl,
    });

    expect(card.svg).toContain("<svg");
    expect(card.svg).toContain("#0f172a");
    expect(card.svg).toContain("utm_source=referral_card");
    expect(card.downloadName).toBe("celebratedeal-referral-card.svg");
  });

  it("escapes authored text and URL content so SVG cannot inject markup", async () => {
    const card = await generateReferralCard({
      participantName: '<script>alert("x")</script>',
      topic: "<img src=x onerror=alert(1)>",
      referralUrl: "https://example.test/form/safe?q=%3Cscript%3E",
    });

    expect(card.svg).not.toContain("<script>");
    expect(card.svg).not.toContain("<img");
    expect(card.svg).toContain("&lt;script&gt;");
    expect(card.svg).toContain("&lt;img");
  });

  it("fails closed for non-http referral targets", async () => {
    expect(() => buildReferralUrl({ baseUrl: "javascript:alert(1)" })).toThrow();
    await expect(generateReferralCard({ participantName: "學員", topic: "活動", referralUrl: "data:text/html,bad" })).rejects.toThrow();
  });
});
