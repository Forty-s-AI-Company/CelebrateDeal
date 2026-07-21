import { describe, expect, it } from "vitest";
import { canTransitionPayoutItem, derivePayoutBatchStatus, PayoutItemTargetStatus } from "./payout-state";

describe("payout state machine", () => {
  it("allows only the explicit operational transitions", () => {
    expect(canTransitionPayoutItem("pending", "paid")).toBe(true);
    expect(canTransitionPayoutItem("pending", "failed")).toBe(true);
    expect(canTransitionPayoutItem("failed", "retrying")).toBe(true);
    expect(canTransitionPayoutItem("retrying", "paid")).toBe(true);
    expect(canTransitionPayoutItem("paid", "failed")).toBe(false);
    expect(canTransitionPayoutItem("unknown", "paid")).toBe(false);
    expect(PayoutItemTargetStatus.safeParse("arbitrary").success).toBe(false);
  });

  it("derives a deterministic aggregate batch status", () => {
    expect(derivePayoutBatchStatus(["paid", "paid"], "exported")).toBe("completed");
    expect(derivePayoutBatchStatus(["paid", "retrying"], "failed")).toBe("retrying");
    expect(derivePayoutBatchStatus(["paid", "failed"], "exported")).toBe("failed");
    expect(derivePayoutBatchStatus(["paid", "pending"], "exported")).toBe("exported");
  });
});
