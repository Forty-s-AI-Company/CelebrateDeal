import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { classifyPaymentWebhookFailure, paymentWebhookFailureMessage } from "./payment-webhook-errors";
import { validatePaymentWebhookInvariants } from "./payment-webhook-invariants";

describe("payment webhook failure classification", () => {
  it("classifies actual amount and currency invariant failures", () => {
    for (const input of [{ grossAmountCents: 200, currency: "TWD" }, { grossAmountCents: 100, currency: "USD" }]) {
      let failure: unknown;
      try {
        validatePaymentWebhookInvariants({ ...input, eventId: "synthetic", eventType: "paid", refundAmountCents: 0 }, {
          status: "pending", grossAmountCents: 100, currency: "TWD", refundedAmountCents: 0, refunds: [],
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(classifyPaymentWebhookFailure(failure)).toBe("amount_mismatch");
    }
  });
  it("maps typed transaction failures without trusting impostors or persisting details", () => {
    for (const [code, expected] of [["P2028", "database_transaction_failed"], ["P2034", "database_conflict"], ["P2002", "processing_failed"]]) {
      const error = new Prisma.PrismaClientKnownRequestError("private database details", { code: code!, clientVersion: "synthetic" });
      const classification = classifyPaymentWebhookFailure(error);
      expect(classification).toBe(expected);
      expect(paymentWebhookFailureMessage(classification)).not.toContain("private database details");
    }
    expect(classifyPaymentWebhookFailure({ code: "P2028" })).toBe("processing_failed");
    expect(classifyPaymentWebhookFailure(Object.assign(new Error("unknown"), { code: "P2028" }))).toBe("processing_failed");
  });
  it("maps reviewed business failures to closed operator codes", () => {
    expect(classifyPaymentWebhookFailure(new Error(
      "付款 webhook 訂單金額或幣別與既存交易不一致。",
    ))).toBe("amount_mismatch");
    expect(classifyPaymentWebhookFailure(new Error(
      "Inventory reservation tenant mismatch.",
    ))).toBe("inventory_conflict");
    expect(classifyPaymentWebhookFailure(new Error(
      "付款 webhook 事件處理權已變更。",
    ))).toBe("processing_claim_lost");
  });

  it("never includes an unknown exception message in the persisted description", () => {
    const secretBearingError = new Error("postgresql://user:password@db.example.test/private"); // secret-scan: allow-test-fixture
    const code = classifyPaymentWebhookFailure(secretBearingError);
    const message = paymentWebhookFailureMessage(code);

    expect(code).toBe("processing_failed");
    expect(message).toBe("Payment webhook processing failed (processing_failed).");
    expect(message).not.toContain(secretBearingError.message);
  });
});
