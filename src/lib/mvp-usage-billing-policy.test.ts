import { describe, expect, it } from "vitest";

import { MVP_USAGE_BILLING_ENABLED, usageFeeForNewBillingGeneration } from "./mvp-usage-billing-policy";

describe("MVP usage billing policy", () => {
  it("enables metered charges for every new billing generation", () => {
    expect(MVP_USAGE_BILLING_ENABLED).toBe(true);
    expect(usageFeeForNewBillingGeneration(8_750)).toBe(8_750);
  });

  it("never turns an invalid negative calculated fee into a credit", () => {
    expect(usageFeeForNewBillingGeneration(-1)).toBe(0);
  });
});
