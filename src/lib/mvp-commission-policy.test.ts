import { describe, expect, it } from "vitest";
import { mvpCommissionPolicy, type CommissionAccrualKind } from "@/lib/mvp-commission-policy";

describe("mvpCommissionPolicy", () => {
  it("在第二階段允許所有已支援的佣金 accrual", () => {
    const kinds: CommissionAccrualKind[] = ["affiliate", "team_course", "platform_referral"];

    expect(kinds.map((kind) => mvpCommissionPolicy.allowsNewAccrual(kind))).toEqual([true, true, true]);
  });
});
