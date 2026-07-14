export const LIVE_PREVIEW_FALLBACKS = {
  title: "您的直播標題將顯示在這裡",
  accentCopy: "直播限定優惠，敬請期待",
  product: "尚未選擇主打商品",
} as const;

export type LivePreviewProduct = {
  id: string;
  name: string;
};

export type LivePreviewData = {
  title: string;
  accentCopy: string;
  products: LivePreviewProduct[];
  productFallback: string;
};

export function buildLivePreview({
  title,
  accentCopy,
  selectedProductIds,
  products,
}: {
  title: string;
  accentCopy: string;
  selectedProductIds: readonly string[];
  products: readonly LivePreviewProduct[];
}): LivePreviewData {
  const productsById = new Map(products.map((product) => [product.id, product]));
  const seenProductIds = new Set<string>();
  const selectedProducts = selectedProductIds.flatMap((productId) => {
    if (seenProductIds.has(productId)) return [];

    seenProductIds.add(productId);
    const product = productsById.get(productId);
    return product ? [{ id: product.id, name: product.name.trim() || LIVE_PREVIEW_FALLBACKS.product }] : [];
  });

  return {
    title: title.trim() || LIVE_PREVIEW_FALLBACKS.title,
    accentCopy: accentCopy.trim() || LIVE_PREVIEW_FALLBACKS.accentCopy,
    products: selectedProducts,
    productFallback: LIVE_PREVIEW_FALLBACKS.product,
  };
}
