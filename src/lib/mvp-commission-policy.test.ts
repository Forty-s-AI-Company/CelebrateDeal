import { describe, expect, it } from "vitest";
import { mvpCommissionPolicy, type CommissionAccrualKind } from "@/lib/mvp-commission-policy";

describe("mvpCommissionPolicy", () => {
  it("在首發預設下停用所有新的佣金 accrual", () => {
    const kinds: CommissionAccrualKind[] = ["affiliate", "team_course", "platform_referral"];

    expect(kinds.map((kind) => mvpCommissionPolicy.allowsNewAccrual(kind))).toEqual([false, false, false]);
  });
});
