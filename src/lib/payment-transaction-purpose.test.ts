import { describe, expect, it } from "vitest";

import { paymentTransactionPurposeFor } from "@/lib/payment-transaction-purpose";

describe("paymentTransactionPurposeFor (F-038, review m-3)", () => {
  it.each(["buyer_order", "platform_subscription", "invoice_payment"] as const)("marks every demo %s as demo", (purpose) => {
    expect(paymentTransactionPurposeFor("demo", purpose)).toBe("demo");
    expect(paymentTransactionPurposeFor("payuni", purpose)).toBe(purpose);
  });
});
