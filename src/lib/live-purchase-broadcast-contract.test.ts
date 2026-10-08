import { describe, expect, it } from "vitest";
import { LivePurchaseBroadcastPayload, purchaseBroadcastAge } from "./live-purchase-broadcast-contract";
const card = { id: "a".repeat(64), buyerMaskedName: "合*家", productName: "合成商品", secondsAgo: 60 };
describe("purchase broadcast public contract", () => {
  it("accepts only the bounded public projection", () => {
    expect(LivePurchaseBroadcastPayload.parse({ broadcasts: [card] })).toEqual({ broadcasts: [card] });
    for (const value of [{ broadcasts: Array(9).fill(card) }, { broadcasts: [{ ...card, orderNumber: "PRIVATE" }] },
      { broadcasts: [{ ...card, id: "canonical-order-id" }] }, { broadcasts: [{ ...card, buyerEmail: "synthetic@example.test" }] },
      { broadcasts: [{ ...card, secondsAgo: -1 }] }, { broadcasts: [{ ...card, secondsAgo: 1801 }] }]) {
      expect(LivePurchaseBroadcastPayload.safeParse(value).success).toBe(false);
    }
  });
  it("labels age without invented purchase activity", () => {
    expect(purchaseBroadcastAge(0)).toBe("剛剛"); expect(purchaseBroadcastAge(59)).toBe("剛剛");
    expect(purchaseBroadcastAge(60)).toBe("1 分鐘前"); expect(purchaseBroadcastAge(1800)).toBe("30 分鐘前");
  });
});
