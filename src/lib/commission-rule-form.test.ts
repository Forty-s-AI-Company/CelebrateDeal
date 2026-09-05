import { describe, expect, it } from "vitest";
import { parseCommissionRuleForm } from "@/lib/commission-rule-form";

function form(input: {
  thresholds?: string[];
  rates?: string[];
  bonuses?: string[];
  cap?: string;
} = {}) {
  const data = new FormData();
  data.set("currency", "twd");
  data.set("maxTotalRateBps", input.cap ?? "2000");
  for (const value of input.thresholds ?? ["0", "1000"]) data.append("tierMinAmount", value);
  for (const value of input.rates ?? ["800", "1000"]) data.append("tierRateBps", value);
  for (const value of input.bonuses ?? ["300", "200"]) data.append("uplineBonusRateBps", value);
  return data;
}

describe("commission rule form contract", () => {
  it("normalizes currency and converts whole currency units to cents", () => {
    expect(parseCommissionRuleForm(form())).toEqual({
      currency: "TWD",
      maxTotalRateBps: 2000,
      tiers: [
        { minMonthlySalesCents: 0, rateBps: 800 },
        { minMonthlySalesCents: 100_000, rateBps: 1000 },
      ],
      uplineLevels: [
        { level: 1, bonusRateBps: 300 },
        { level: 2, bonusRateBps: 200 },
      ],
    });
  });

  it("rejects partial rows, unsafe money and cap overflow", () => {
    expect(() => parseCommissionRuleForm(form({ thresholds: ["0", "100"], rates: ["800", ""] }))).toThrow("同時填寫");
    expect(() => parseCommissionRuleForm(form({ thresholds: ["0", String(Number.MAX_SAFE_INTEGER)], rates: ["800", "1000"] }))).toThrow("金額過大");
    expect(() => parseCommissionRuleForm(form({ cap: "1200" }))).toThrow("超過上限");
  });
});
