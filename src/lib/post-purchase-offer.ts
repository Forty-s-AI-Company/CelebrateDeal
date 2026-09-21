/** 瀏覽器可用的優惠展示契約，不依賴簽章、金鑰或 Node.js 模組。 */
export type PostPurchaseOffer = {
  kind: "upsell" | "downsell";
  sourceProductId: string;
  productId: string;
  productName: string;
  currency: string;
  /** The extra amount paid now, after the original paid amount and OTO discount. */
  amountCents: number;
  originalPriceCents: number;
  discountCents: number;
};

export function formatPostPurchaseAmount(amountCents: number, currencyCode: string) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 0,
  }).format(amountCents / 100);
}
