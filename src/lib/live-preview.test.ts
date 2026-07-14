import { describe, expect, it } from "vitest";
import { buildLivePreview, LIVE_PREVIEW_FALLBACKS } from "./live-preview";

const products = [
  { id: "product-1", name: "清爽保濕組" },
  { id: "product-2", name: "亮白精華" },
];

describe("buildLivePreview", () => {
  it("uses stable fallback copy when the live details and product selection are empty", () => {
    expect(buildLivePreview({ title: "  ", accentCopy: "", selectedProductIds: [], products })).toEqual({
      title: LIVE_PREVIEW_FALLBACKS.title,
      accentCopy: LIVE_PREVIEW_FALLBACKS.accentCopy,
      products: [],
      productFallback: LIVE_PREVIEW_FALLBACKS.product,
    });
  });

  it("formats current values and selected products for the preview", () => {
    expect(buildLivePreview({
      title: "  夏日保養直播  ",
      accentCopy: "  前 50 名下單贈旅行組  ",
      selectedProductIds: ["product-2", "product-1"],
      products,
    })).toEqual({
      title: "夏日保養直播",
      accentCopy: "前 50 名下單贈旅行組",
      products: [
        { id: "product-2", name: "亮白精華" },
        { id: "product-1", name: "清爽保濕組" },
      ],
      productFallback: LIVE_PREVIEW_FALLBACKS.product,
    });
  });

  it("ignores product identifiers that are not available to the form", () => {
    expect(buildLivePreview({
      title: "新品直播",
      accentCopy: "直播限定",
      selectedProductIds: ["missing-product"],
      products,
    })).toMatchObject({ products: [], productFallback: LIVE_PREVIEW_FALLBACKS.product });
  });
});
