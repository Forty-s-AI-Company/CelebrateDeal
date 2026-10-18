import { expect, it, vi } from "vitest";
import { hasLearnerNotificationPurchase } from "./learner-notification-access";

it("real portal session metadata does not invalidate a purchased-resource notification scope", async () => {
  const session = { vendorId: "vendor_a", customerKeyHash: "a".repeat(43), issuedAt: new Date(), expiresAt: new Date(Date.now() + 60000) };
  const findFirst = vi.fn().mockResolvedValue({ id: "purchased_digital_item" });
  await expect(hasLearnerNotificationPurchase({ commerceOrder: { fields: { totalAmountCents: "synthetic-total-column" } }, commerceOrderItem: { findFirst } } as never, session, "digital_product")).resolves.toBe(true);
  expect(findFirst).toHaveBeenCalledTimes(1);
});
