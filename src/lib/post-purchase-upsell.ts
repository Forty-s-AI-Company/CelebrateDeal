import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

const opaqueId = z.string().trim().min(1).max(191).regex(/^[A-Za-z0-9_-]+$/u);
const currency = z.string().regex(/^[A-Z]{3}$/u);
const cents = z.number().int().safe().nonnegative();

/**
 * This deliberately uses only server-owned product fields.  The browser never
 * supplies an offer product, discount, or price.
 */
export const PostPurchaseUpsellProductSchema = z.object({
  id: opaqueId,
  vendorId: opaqueId,
  name: z.string().trim().min(1).max(500),
  priceCents: cents.refine((value) => value > 0),
  currency,
  isActive: z.boolean(),
  fulfillmentTypeConfirmed: z.boolean(),
  inventory: z.number().int().safe().nonnegative(),
  upsellProductId: opaqueId.nullish(),
  upsellDiscountCents: cents.nullish(),
  downsellProductId: opaqueId.nullish(),
}).strict();

export type PostPurchaseUpsellProduct = z.infer<typeof PostPurchaseUpsellProductSchema>;

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

function isAvailable(product: PostPurchaseUpsellProduct) {
  return product.isActive && product.fulfillmentTypeConfirmed && product.inventory > 0;
}

/**
 * Resolves an offer exclusively from a same-tenant, currently purchasable
 * product. Any malformed or stale configuration is treated as unavailable.
 */
export function resolvePostPurchaseOffer(input: {
  source: PostPurchaseUpsellProduct;
  candidates: readonly PostPurchaseUpsellProduct[];
  kind: "upsell" | "downsell";
}): PostPurchaseOffer | null {
  const source = PostPurchaseUpsellProductSchema.safeParse(input.source);
  if (!source.success || !isAvailable(source.data)) return null;
  const targetId = input.kind === "upsell" ? source.data.upsellProductId : source.data.downsellProductId;
  if (!targetId) return null;
  const target = input.candidates
    .map((candidate) => PostPurchaseUpsellProductSchema.safeParse(candidate))
    .find((candidate) => candidate.success && candidate.data.id === targetId)?.data;
  if (!target || !isAvailable(target) || target.id === source.data.id) return null;
  if (target.vendorId !== source.data.vendorId || target.currency !== source.data.currency) return null;

  const discountCents = input.kind === "upsell" ? source.data.upsellDiscountCents ?? 0 : 0;
  // "補差價" is the target's current price minus what the buyer already paid.
  // Non-positive offers are refused; a zero-price entitlement needs a separate
  // audited grant flow and must never be silently created from this endpoint.
  const amountCents = target.priceCents - source.data.priceCents - discountCents;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return null;

  return {
    kind: input.kind,
    sourceProductId: source.data.id,
    productId: target.id,
    productName: target.name,
    currency: target.currency,
    amountCents,
    originalPriceCents: target.priceCents,
    discountCents,
  };
}

export function postPurchaseCheckoutHref(input: { vendorId: string; offer: Pick<PostPurchaseOffer, "productId"> }) {
  const vendorId = opaqueId.safeParse(input.vendorId);
  const productId = opaqueId.safeParse(input.offer.productId);
  if (!vendorId.success || !productId.success) return null;
  return `/checkout/${encodeURIComponent(vendorId.data)}/${encodeURIComponent(productId.data)}?postPurchase=1`;
}

export function formatPostPurchaseAmount(amountCents: number, currencyCode: string) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 0,
  }).format(amountCents / 100);
}

const TOKEN_VERSION = "ppu1";
const TOKEN_PURPOSE = "post-purchase-checkout";
const tokenPart = /^[A-Za-z0-9_-]{1,2048}$/u;
const tokenSignature = /^[A-Za-z0-9_-]{43}$/u;
const PostPurchaseCheckoutTokenSchema = z.object({
  grantId: opaqueId,
  orderId: opaqueId,
  vendorId: opaqueId,
  sourceProductId: opaqueId,
  productId: opaqueId,
  kind: z.enum(["upsell", "downsell"]),
  amountCents: cents.refine((value) => value > 0),
  expiresAt: z.number().int().safe(),
}).strict();

export type PostPurchaseCheckoutToken = z.infer<typeof PostPurchaseCheckoutTokenSchema>;

function tokenSignatureFor(payload: string) {
  return createHmac("sha256", deriveSensitiveDataKey(TOKEN_PURPOSE))
    .update(`${TOKEN_VERSION}.${payload}`)
    .digest("base64url");
}

/** A short-lived, signed handoff contains no buyer PII or payment credential. */
export function issuePostPurchaseCheckoutToken(input: Omit<PostPurchaseCheckoutToken, "expiresAt"> & { now?: Date }) {
  const { now, ...binding } = input;
  const parsed = PostPurchaseCheckoutTokenSchema.safeParse({
    ...binding,
    expiresAt: Math.floor(((now ?? new Date()).getTime() + 10 * 60_000) / 1_000),
  });
  if (!parsed.success) throw new Error("Invalid post-purchase checkout binding.");
  // A nonce prevents an otherwise identical offer from producing a reusable URL.
  const payload = Buffer.from(JSON.stringify({ ...parsed.data, nonce: randomBytes(12).toString("base64url") }), "utf8").toString("base64url");
  return `${TOKEN_VERSION}.${payload}.${tokenSignatureFor(payload)}`;
}

export function verifyPostPurchaseCheckoutToken(token: string, now = new Date()): PostPurchaseCheckoutToken | null {
  const [version, payload, suppliedSignature, extra] = token.split(".");
  if (version !== TOKEN_VERSION || !payload || !tokenPart.test(payload) || !suppliedSignature || !tokenSignature.test(suppliedSignature) || extra) return null;
  const expected = Buffer.from(tokenSignatureFor(payload), "utf8");
  const supplied = Buffer.from(suppliedSignature, "utf8");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const { nonce: _nonce, ...binding } = decoded;
    const parsed = PostPurchaseCheckoutTokenSchema.safeParse(binding);
    return parsed.success && parsed.data.expiresAt > Math.floor(now.getTime() / 1_000) ? parsed.data : null;
  } catch {
    return null;
  }
}
