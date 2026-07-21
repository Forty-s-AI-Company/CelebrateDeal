import { describe, expect, it } from "vitest";
import { classifyPaymentWebhookFailure, paymentWebhookFailureMessage } from "./payment-webhook-errors";

describe("payment webhook failure classification", () => {
  it("maps reviewed business failures to closed operator codes", () => {
    expect(classifyPaymentWebhookFailure(new Error(
      "付款 webhook 訂單金額或幣別與既存交易不一致。",
    ))).toBe("amount_mismatch");
    expect(classifyPaymentWebhookFailure(new Error(
      "Inventory reservation tenant mismatch.",
    ))).toBe("inventory_conflict");
  });

  it("never includes an unknown exception message in the persisted description", () => {
    const secretBearingError = new Error("postgresql://user:password@db.example.test/private");
    const code = classifyPaymentWebhookFailure(secretBearingError);
    const message = paymentWebhookFailureMessage(code);

    expect(code).toBe("processing_failed");
    expect(message).toBe("Payment webhook processing failed (processing_failed).");
    expect(message).not.toContain(secretBearingError.message);
  });
});
