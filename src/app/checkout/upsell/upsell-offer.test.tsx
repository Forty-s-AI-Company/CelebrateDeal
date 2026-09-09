import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// 重新引入服務端簽章或金鑰派生模組時，Client 邊界測試必須立即失敗。
vi.mock("@/lib/post-purchase-upsell", () => { throw new Error("Client offer must not import checkout signing"); });
vi.mock("@/lib/sensitive-data", () => { throw new Error("Client offer must not import key derivation"); });

import { UpsellOffer } from "./upsell-offer";
import { formatPostPurchaseAmount, type PostPurchaseOffer } from "@/lib/post-purchase-offer";

const offer: PostPurchaseOffer = {
  kind: "upsell", sourceProductId: "basic", productId: "coaching", productName: "顧問方案",
  currency: "TWD", amountCents: 19_500, originalPriceCents: 30_000, discountCents: 500,
};

describe("browser-safe post-purchase offer", () => {
  it("formats and renders the server-resolved amount without loading signing code", () => {
    const html = renderToStaticMarkup(<UpsellOffer grantId="synthetic-grant" initialOffer={offer} />);
    expect(formatPostPurchaseAmount(19_500, "TWD")).toBe("$195");
    expect(html).toContain("$195");
    expect(html).toContain("顧問方案");
    expect(html).toContain("立即用優惠價加購");
    expect(html).toContain("已套用專屬折抵");
  });

  it("keeps the separately resolved downsell presentation", () => {
    const html = renderToStaticMarkup(<UpsellOffer grantId="synthetic-grant" initialOffer={{ ...offer, kind: "downsell", discountCents: 0 }} />);
    expect(html).toContain("選擇這個限時方案");
    expect(html).not.toContain("已套用專屬折抵");
  });
});
