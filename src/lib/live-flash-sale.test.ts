import { describe, expect, it } from "vitest";
import { assertFlashSaleAdmission, flashSaleQuoteHash, FlashSaleUnavailableError, type FlashSaleQuote } from "./live-flash-sale";

const quote: FlashSaleQuote = {
  claimId: "claim", runId: "run", runRevision: 1, vendorId: "vendor", liveId: "live",
  productId: "product", productRevision: 2, priceCents: 2000, salePriceCents: 1000, currency: "TWD", stockLimit: 5,
};

describe("signed flash sale quote binding", () => {
  it("accepts unchanged quotes independent of object property order and normal purchases", () => {
    const hash = flashSaleQuoteHash(quote);
    const reordered = Object.fromEntries(Object.entries(quote).reverse()) as FlashSaleQuote;
    expect(() => assertFlashSaleAdmission(hash, reordered)).not.toThrow();
    expect(() => assertFlashSaleAdmission(undefined, null)).not.toThrow();
  });

  it.each(Object.keys(quote) as (keyof FlashSaleQuote)[])("rejects changed %s after admission", (field) => {
    const value = quote[field];
    const changed = { ...quote, [field]: typeof value === "number" ? value + 1 : `${value}-other` };
    expect(() => assertFlashSaleAdmission(flashSaleQuoteHash(quote), changed)).toThrow(FlashSaleUnavailableError);
  });

  it("rejects missing cookies, offers added after admission and null versus finite limits", () => {
    expect(() => assertFlashSaleAdmission(flashSaleQuoteHash(quote), null)).toThrow(FlashSaleUnavailableError);
    expect(() => assertFlashSaleAdmission(undefined, quote)).toThrow(FlashSaleUnavailableError);
    expect(() => assertFlashSaleAdmission(flashSaleQuoteHash(quote), { ...quote, stockLimit: null })).toThrow(FlashSaleUnavailableError);
  });
});
