import { describe, expect, it } from "vitest";
import { redactSensitivePayload, redactedJsonSnapshot } from "@/lib/redaction";

describe("sensitive payload redaction", () => {
  it("redacts credentials, payment data, and common buyer PII keys recursively", () => {
    const privateValues = {
      authorization: "Bearer private-token",
      BuyerEmail: "buyer-private@example.test",
      buyerName: "王小明",
      ShippingAddress: "臺北市中正區私密地址",
      customer: { phone: "+886912345678" },
      CardLastFour: "4242",
    };

    const redacted = redactSensitivePayload({
      ...privateValues,
      orderNumber: "CD-ORDER-001",
      eventType: "paid",
      nested: [{ recipientName: "陳小華", status: "processed" }],
    });
    const serialized = JSON.stringify(redacted);

    for (const value of [
      privateValues.authorization,
      privateValues.BuyerEmail,
      privateValues.buyerName,
      privateValues.ShippingAddress,
      privateValues.customer.phone,
      privateValues.CardLastFour,
      "陳小華",
    ]) {
      expect(serialized).not.toContain(value);
    }
    expect(redacted).toMatchObject({
      orderNumber: "CD-ORDER-001",
      eventType: "paid",
      nested: [{ recipientName: expect.stringContaining("[redacted"), status: "processed" }],
    });
  });

  it("returns a JSON-safe snapshot without changing non-sensitive reconciliation fields", () => {
    expect(redactedJsonSnapshot({
      EventId: "evt-1",
      MerTradeNo: "CD-001",
      TradeAmt: 1990,
      BuyerEmail: "buyer@example.test",
    })).toEqual({
      EventId: "evt-1",
      MerTradeNo: "CD-001",
      TradeAmt: 1990,
      BuyerEmail: "[redacted length=18]",
    });
  });
});
