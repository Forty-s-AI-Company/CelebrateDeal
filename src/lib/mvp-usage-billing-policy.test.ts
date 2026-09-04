import { describe, expect, it } from "vitest";

import { MVP_USAGE_BILLING_ENABLED, usageFeeForNewBillingGeneration } from "./mvp-usage-billing-policy";

describe("MVP usage billing policy", () => {
  it("disables metered charges for every new billing generation", () => {
    expect(MVP_USAGE_BILLING_ENABLED).toBe(false);
    expect(usageFeeForNewBillingGeneration(8_750)).toBe(0);
  });
});
