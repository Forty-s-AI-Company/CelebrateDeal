import { describe, expect, it } from "vitest";
import { createLivePreview, summarizeLivePreviewProducts } from "./live-preview";

const products = [
  { id: "product-1", name: "夏日保養組" },
  { id: "product-2", name: "清爽防曬乳" },
  { id: "product-3", name: "旅行收納包" },
];

describe("createLivePreview", () => {
  it("uses stable defaults for blank title, promotional copy, and products", () => {
    expect(createLivePreview({ title: "  ", accentCopy: "", products, selectedProductIds: [] })).toEqual({
      title: "未命名直播",
      accentCopy: "直播限定優惠",
      productNames: [],
      remainingProductCount: 0,
      emptyProductLabel: "尚未選擇主打商品",
    });
  });

  it("keeps valid form values and one selected product", () => {
    expect(createLivePreview({
      title: "週五新品導購直播",
      accentCopy: "今晚限時免運",
      products,
      selectedProductIds: ["product-2"],
    })).toEqual({
      title: "週五新品導購直播",
      accentCopy: "今晚限時免運",
      productNames: ["清爽防曬乳"],
      remainingProductCount: 0,
      emptyProductLabel: null,
    });
  });

  it("ignores selected product identifiers that do not exist", () => {
    expect(createLivePreview({
      title: "直播",
      accentCopy: "優惠",
      products,
      selectedProductIds: ["missing-product"],
    })).toMatchObject({
      productNames: [],
      remainingProductCount: 0,
      emptyProductLabel: "尚未選擇主打商品",
    });
  });
});

describe("summarizeLivePreviewProducts", () => {
  it("returns an empty summary for zero selected products", () => {
    expect(summarizeLivePreviewProducts(products, [])).toEqual({
      productNames: [],
      remainingProductCount: 0,
    });
  });

  it("shows at most two names and summarizes three or more products", () => {
    expect(summarizeLivePreviewProducts(products, ["product-1", "product-2", "product-3"])).toEqual({
      productNames: ["夏日保養組", "清爽防曬乳"],
      remainingProductCount: 1,
    });
  });

  it("counts distinct available products while preserving first selection order", () => {
    const selectedIds = ["product-2", "missing-product", "product-2", "product-1", "product-3", "product-3"];

    expect(summarizeLivePreviewProducts(products, selectedIds)).toEqual({
      productNames: ["清爽防曬乳", "夏日保養組"],
      remainingProductCount: 1,
    });
    expect(selectedIds).toEqual(["product-2", "missing-product", "product-2", "product-1", "product-3", "product-3"]);
  });

  it("does not count repeated selections of one product as additional products", () => {
    expect(summarizeLivePreviewProducts(products, ["product-1", "product-1", "product-1"])).toEqual({
      productNames: ["夏日保養組"],
      remainingProductCount: 0,
    });
  });

  it("normalizes product labels without presenting an existing selection as empty", () => {
    const namedProducts = [{ id: "trimmed", name: "  夏日保養組  " }, { id: "blank", name: " \t " }];

    expect(createLivePreview({ title: "直播", accentCopy: "優惠", products: namedProducts, selectedProductIds: ["trimmed", "blank"] })).toMatchObject({
      productNames: ["夏日保養組", "未命名商品"],
      remainingProductCount: 0,
      emptyProductLabel: null,
    });
    expect(namedProducts[0].name).toBe("  夏日保養組  ");
    expect(namedProducts[1].name).toBe(" \t ");
  });
});
