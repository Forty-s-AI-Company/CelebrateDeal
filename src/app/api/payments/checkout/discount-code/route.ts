import { NextResponse } from "next/server";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { DiscountCodePreviewRequestSchema } from "@/lib/commerce-checkout";
import { getDb } from "@/lib/db";
import { DISCOUNT_CODE_ERROR_CODES, resolveDiscountCodeQuote } from "@/lib/discount-codes";
import { isProductPurchasable } from "@/lib/feature-gates";
import { checkRateLimit } from "@/lib/rate-limit";
import { isVendorAvailableForPublic } from "@/lib/vendor-suspension-state";

const noStore = { "Cache-Control": "private, no-store" };

/**
 * A4-01: shows the buyer what a discount code would take off before paying.
 * Display only: the checkout POST resolves the code again and reserves the
 * use. The product and the code are both read inside the requested vendor,
 * so another vendor's code answers exactly like an unknown one.
 */
export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;
  // Tighter than checkout itself: this endpoint is the cheapest way to probe codes.
  const limited = await checkRateLimit(request, "checkout-discount-code", 10, 60_000);
  if (limited) return limited;

  const parsed = DiscountCodePreviewRequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid discount code request" }, { status: 400, headers: noStore });
  const { vendorId, productId, discountCode, orderBumpProductId } = parsed.data;
  const db = getDb();
  if (!await isVendorAvailableForPublic(db, vendorId)) return NextResponse.json({ error: "Product not available" }, { status: 404, headers: noStore });

  const product = await db.product.findFirst({
    where: { id: productId, vendorId, isActive: true, fulfillmentTypeConfirmed: true, priceCents: { gt: 0 } },
    select: { id: true, priceCents: true, currency: true, commerceDomain: true, fulfillmentType: true, vendor: true },
  });
  if (!product || !isProductPurchasable(product.vendor, product)) {
    return NextResponse.json({ error: "Product not available" }, { status: 404, headers: noStore });
  }
  const orderBump = orderBumpProductId && orderBumpProductId !== product.id
    ? await db.product.findFirst({
        where: { id: orderBumpProductId, vendorId, isActive: true, fulfillmentTypeConfirmed: true, priceCents: { gt: 0 }, currency: product.currency },
        select: { priceCents: true },
      })
    : null;

  const result = await resolveDiscountCodeQuote(db, discountCode, {
    vendorId,
    productId: product.id,
    primaryPriceCents: product.priceCents,
    additionalAmountCents: orderBump?.priceCents ?? 0,
    currency: product.currency,
    now: new Date(),
  });
  if (!result.ok) {
    return NextResponse.json({ error: "Discount code unavailable", code: DISCOUNT_CODE_ERROR_CODES[result.reason] }, { status: 409, headers: noStore });
  }
  return NextResponse.json({
    ok: true,
    code: result.quote.code,
    discountAmountCents: result.quote.discountAmountCents,
    subtotalAmountCents: result.quote.subtotalAmountCents,
    totalAmountCents: result.quote.totalAmountCents,
    currency: result.quote.currency,
  }, { headers: noStore });
}
