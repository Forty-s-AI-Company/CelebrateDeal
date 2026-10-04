import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { normalizeInteractionEventDraft, type FlashSaleInteractionMetadata } from "@/lib/interaction-event";
import { hashInteractionBearer } from "@/lib/live-interaction";
import type { ReservedInventoryRevision } from "@/lib/inventory-reservations";

export const FLASH_SALE_COOKIE = "celebratedeal_flash_sale";
export class FlashSaleUnavailableError extends Error {}

export function flashSaleBearerFromRequest(request: Request) {
  for (const segment of (request.headers.get("cookie") ?? "").split(";").slice(0, 100)) {
    const separator = segment.indexOf("=");
    if (separator > 0 && segment.slice(0, separator).trim() === FLASH_SALE_COOKIE) return segment.slice(separator + 1).trim();
  }
  return null;
}

export type FlashSaleQuote = {
  claimId: string;
  runId: string;
  runRevision: number;
  vendorId: string;
  liveId: string;
  productId: string;
  productRevision: number;
  priceCents: number;
  salePriceCents: number;
  currency: string;
  stockLimit: number | null;
};

/** 固定欄位順序，將使用者確認的整份伺服器報價綁定到結帳簽章。 */
export function flashSaleQuoteHash(quote: FlashSaleQuote) {
  return createHash("sha256").update(JSON.stringify([
    "flash-sale-quote-v1", quote.claimId, quote.runId, quote.runRevision,
    quote.vendorId, quote.liveId, quote.productId, quote.productRevision,
    quote.priceCents, quote.salePriceCents, quote.currency, quote.stockLimit,
  ])).digest("hex");
}

/** 優惠消失、被替換或條件變更時，必須重新確認，不能靜默改成原價。 */
export function assertFlashSaleAdmission(offerHash: string | undefined, quote: FlashSaleQuote | null) {
  if ((quote ? flashSaleQuoteHash(quote) : undefined) !== offerHash) throw new FlashSaleUnavailableError();
}

function validatedSalePrice(metadata: FlashSaleInteractionMetadata, product: { priceCents: number; currency: string }) {
  const amount = metadata.salePriceCents ?? product.priceCents;
  // 不自動四捨五入，也不允許促銷價高於目前商品價或虛構原價。
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > product.priceCents
    || (product.currency === "TWD" && amount % 100 !== 0)
    || (metadata.originalPriceCents !== undefined && metadata.originalPriceCents !== product.priceCents)) {
    throw new FlashSaleUnavailableError();
  }
  return amount;
}

/** Cookie 只帶不透明憑證；金額、期間及商品綁定全部重新讀取伺服器資料。 */
export async function resolveFlashSaleQuote(
  db: Prisma.TransactionClient,
  bearer: string | null | undefined,
  input: { vendorId: string; productId: string; now?: Date },
): Promise<FlashSaleQuote | null> {
  if (!bearer) return null;
  if (!/^[A-Za-z0-9_-]{43}$/u.test(bearer)) throw new FlashSaleUnavailableError();
  const claim = await db.liveInteractionResponse.findUnique({
    where: { claimTokenHash: hashInteractionBearer(bearer) }, include: { run: true },
  });
  if (!claim) throw new FlashSaleUnavailableError();
  // 其他商家或商品的舊 Cookie 不得影響本次購買。
  if (claim.vendorId !== input.vendorId || claim.productId !== input.productId) return null;
  if (claim.usedOrderId && claim.eventType === "flash_sale" && claim.run.eventType === "flash_sale") {
    // 已確認付款後允許一般再購；仍保留原名額核銷，付款不明時不釋放。
    const settled = await db.commerceOrder.findFirst({
      where: { id: claim.usedOrderId, vendorId: input.vendorId, paidAt: { not: null }, status: { in: ["paid", "partially_refunded", "refunded"] } },
      select: { id: true },
    });
    if (settled) return null;
    throw new FlashSaleUnavailableError();
  }
  const now = input.now ?? new Date();
  const run = claim.run;
  if (claim.eventType !== "flash_sale" || run.eventType !== "flash_sale"
    || claim.usedOrderId || !claim.expiresAt || claim.expiresAt <= now
    || run.status !== "active" || run.startsAt > now || run.endsAt <= now) {
    throw new FlashSaleUnavailableError();
  }
  const normalized = normalizeInteractionEventDraft({
    eventType: "flash_sale", triggerSec: 0, title: run.title,
    productId: claim.productId, metadata: run.configuration,
  });
  if (!normalized.success || normalized.data.metadata?.kind !== "flash_sale"
    || normalized.data.metadata.productId !== input.productId) throw new FlashSaleUnavailableError();
  const metadata = normalized.data.metadata;
  const raw = run.configuration as Record<string, unknown>;
  // Normalizer 的寬容匯入行為不能把錯誤優惠悄悄轉為原價結帳。
  for (const field of ["salePriceCents", "originalPriceCents", "stockLimit"] as const) {
    if (raw[field] !== undefined && raw[field] !== metadata[field]) throw new FlashSaleUnavailableError();
  }
  const product = await db.product.findFirst({
    where: {
      id: input.productId, vendorId: input.vendorId, isActive: true,
      fulfillmentTypeConfirmed: true, checkoutUrl: null,
      liveProducts: { some: { vendorId: input.vendorId, liveId: run.liveId } },
    },
  });
  if (!product) throw new FlashSaleUnavailableError();
  const salePriceCents = validatedSalePrice(metadata, product);
  return {
    claimId: claim.id, runId: run.id, runRevision: run.updatedAt.getTime(),
    vendorId: input.vendorId, liveId: run.liveId, productId: product.id,
    productRevision: product.revision, priceCents: product.priceCents,
    salePriceCents, currency: product.currency, stockLimit: metadata.stockLimit ?? null,
  };
}

/** 必須在訂單與商品庫存共用的 Serializable transaction 內呼叫。 */
export async function consumeFlashSaleQuote(
  tx: Prisma.TransactionClient,
  bearer: string,
  quote: FlashSaleQuote,
  orderId: string,
  now = new Date(),
  reservedRevision?: ReservedInventoryRevision,
) {
  const current = await resolveFlashSaleQuote(tx, bearer, { ...quote, now });
  // 只接受同交易庫存 helper 回傳的精確 +1 證據；其餘欄位仍逐一重驗。
  const expected = { ...quote };
  if (reservedRevision) {
    if (reservedRevision.vendorId !== quote.vendorId || reservedRevision.productId !== quote.productId
      || reservedRevision.beforeRevision !== quote.productRevision
      || reservedRevision.afterRevision !== quote.productRevision + 1) throw new FlashSaleUnavailableError();
    expected.productRevision = reservedRevision.afterRevision;
  }
  if (!current || Object.keys(quote).some((key) =>
    current[key as keyof FlashSaleQuote] !== expected[key as keyof FlashSaleQuote])) {
    throw new FlashSaleUnavailableError();
  }
  if (current.stockLimit !== null) {
    // 結果不明／晚到付款的訂單仍占名額；未確認撤銷前不釋放，避免超賣。
    const reserved = await tx.liveInteractionResponse.count({
      where: { vendorId: quote.vendorId, runId: quote.runId, eventType: "flash_sale", usedOrderId: { not: null } },
    });
    if (reserved >= current.stockLimit) throw new FlashSaleUnavailableError();
  }
  const consumed = await tx.liveInteractionResponse.updateMany({
    where: { id: quote.claimId, vendorId: quote.vendorId, runId: quote.runId, usedOrderId: null, expiresAt: { gt: now } },
    data: { usedOrderId: orderId, discountAmountCents: quote.priceCents - quote.salePriceCents },
  });
  if (consumed.count !== 1) throw new FlashSaleUnavailableError();
}
