import { describe, expect, it } from "vitest";
import {
  affiliateLeaderboard,
  conversionRate,
  interactionCountsByRun,
  maskedQuestionAuthor,
  pollAnalytics,
} from "@/lib/live-engagement-analytics";

describe("live engagement analytics read model", () => {
  it("builds poll percentages from database groupBy rows", () => {
    const counts = interactionCountsByRun([
      { runId: "poll-1", value: "option-a", _count: { _all: 3 } },
      { runId: "poll-1", value: "option-b", _count: { _all: 1 } },
      { runId: "poll-2", value: '["option-a","option-b"]', _count: { _all: 2 } },
    ]);
    expect(pollAnalytics({
      id: "poll-1",
      title: "備援標題",
      configuration: { question: "你喜歡哪一款？", options: [{ id: "option-a", label: "A" }, { id: "option-b", label: "B" }] },
    }, counts.get("poll-1") ?? new Map())).toEqual({
      id: "poll-1",
      question: "你喜歡哪一款？",
      totalVotes: 4,
      choices: [
        { id: "option-a", label: "A", votes: 3, percentage: 75 },
        { id: "option-b", label: "B", votes: 1, percentage: 25 },
      ],
    });
    expect(counts.get("poll-2")).toEqual(new Map([["option-a", 2], ["option-b", 2]]));
  });

  it("calculates voucher CVR and handles an empty claim denominator", () => {
    expect(conversionRate(3, 8)).toBe(37.5);
    expect(conversionRate(2, 0)).toBe(0);
  });

  it("masks question authors at the analytics boundary", () => {
    expect(maskedQuestionAuthor("張小芬")).toBe("張*芬");
    expect(maskedQuestionAuthor(null)).toBe("熱門學員");
  });

  it("ranks confirmed affiliate revenue and separates pending orders", () => {
    expect(affiliateLeaderboard([
      { promoterMembershipId: "p-1", promoterName: "小林", promoterCode: "LIN", status: "paid", grossAmountCents: 20_000 },
      { promoterMembershipId: "p-1", promoterName: "小林", promoterCode: "LIN", status: "pending", grossAmountCents: 99_900 },
      { promoterMembershipId: "p-2", promoterName: null, promoterCode: "MAY", status: "paid", grossAmountCents: 30_000 },
    ])).toEqual([
      { promoterMembershipId: "p-2", name: "MAY", confirmedOrders: 1, pendingOrders: 0, confirmedGrossCents: 30_000 },
      { promoterMembershipId: "p-1", name: "小林", confirmedOrders: 1, pendingOrders: 1, confirmedGrossCents: 20_000 },
    ]);
  });
});
