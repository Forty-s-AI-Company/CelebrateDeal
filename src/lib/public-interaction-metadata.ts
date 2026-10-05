import { normalizeInteractionEventDraft, type InteractionEventDraft } from "@/lib/interaction-event";

/** 公開頁只傳送標準化欄位，商品互動必須限定在本場直播。 */
export function publicInteractionMetadata(event: InteractionEventDraft, liveProductIds: ReadonlySet<string>) {
  const result = normalizeInteractionEventDraft(event);
  if (!result.success || !result.data.metadata) return {};
  const metadata = result.data.metadata;
  if ((metadata.kind === "flash_sale" || metadata.kind === "flash_voucher")
    && metadata.productId && !liveProductIds.has(metadata.productId)) return {};
  return { metadata };
}
