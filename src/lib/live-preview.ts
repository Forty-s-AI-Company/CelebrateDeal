export const LIVE_PREVIEW_DEFAULTS = {
  title: "未命名直播",
  accentCopy: "直播限定優惠",
  noProducts: "尚未選擇主打商品",
  unnamedProduct: "未命名商品",
} as const;

export type LivePreviewProduct = {
  id: string;
  name: string;
};

export type LivePreview = {
  title: string;
  accentCopy: string;
  productNames: string[];
  remainingProductCount: number;
  emptyProductLabel: string | null;
};

function valueOrDefault(value: string, fallback: string) {
  return value.trim() || fallback;
}

export function summarizeLivePreviewProducts(
  products: LivePreviewProduct[],
  selectedProductIds: string[],
) {
  const productsById = new Map(products.map((product) => [product.id, product]));
  // 先去重再計算摘要，避免重複 ID 佔用顯示名額或灌大剩餘件數。
  const selectedProducts = [...new Set(selectedProductIds)]
    .map((productId) => productsById.get(productId))
    .filter((product): product is LivePreviewProduct => Boolean(product));

  return {
    productNames: selectedProducts.slice(0, 2).map((product) => valueOrDefault(product.name, LIVE_PREVIEW_DEFAULTS.unnamedProduct)),
    remainingProductCount: Math.max(0, selectedProducts.length - 2),
  };
}

export function createLivePreview({
  title,
  accentCopy,
  products,
  selectedProductIds,
}: {
  title: string;
  accentCopy: string;
  products: LivePreviewProduct[];
  selectedProductIds: string[];
}): LivePreview {
  const productSummary = summarizeLivePreviewProducts(products, selectedProductIds);

  return {
    title: valueOrDefault(title, LIVE_PREVIEW_DEFAULTS.title),
    accentCopy: valueOrDefault(accentCopy, LIVE_PREVIEW_DEFAULTS.accentCopy),
    ...productSummary,
    emptyProductLabel: productSummary.productNames.length === 0 ? LIVE_PREVIEW_DEFAULTS.noProducts : null,
  };
}
