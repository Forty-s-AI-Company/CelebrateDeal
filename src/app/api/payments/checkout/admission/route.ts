import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import {
  CHECKOUT_ADMISSION_COOKIE,
  checkoutAdmissionCookieOptions,
  checkoutSessionTokenFromRequest,
  issueCheckoutAdmission,
} from "@/lib/checkout-admission";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { flashSaleBearerFromRequest, flashSaleQuoteHash, FlashSaleUnavailableError, resolveFlashSaleQuote } from "@/lib/live-flash-sale";
import { CommerceCheckoutRequestSchema } from "@/lib/commerce-checkout";
import { assertPostPurchaseCreditReplay, postPurchaseCreditQuoteHash, postPurchaseRequestCookies, PostPurchaseUnavailableError, resolvePostPurchaseCreditQuote } from "@/lib/post-purchase-credit";

const AdmissionRequest = z.object({
  vendorId: z.string().trim().min(1).max(128),
  productId: z.string().trim().min(1).max(128),
  idempotencyKey: z.string().uuid().optional(),
  flashSaleRunId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u).optional(),
  postPurchaseToken: CommerceCheckoutRequestSchema.shape.postPurchaseToken,
}).strict();

function checkoutMetadata(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** New quotes and immutable pending-order recovery have separate authorization. */
async function postPurchaseAdmission(request: Request, db: ReturnType<typeof getDb>, data: z.infer<typeof AdmissionRequest>,
  existing: { primaryCommerceOrder: { id: string } | null } | null, metadata: Record<string, unknown> | null) {
  const buyerCookies = postPurchaseRequestCookies(request);
  if (existing) {
    if (metadata?.postPurchaseCredit) {
      if (!existing.primaryCommerceOrder) throw new PostPurchaseUnavailableError();
      await assertPostPurchaseCreditReplay(db, buyerCookies, { vendorId: data.vendorId, productId: data.productId,
        targetOrderId: existing.primaryCommerceOrder.id, token: data.postPurchaseToken });
    } else if (data.postPurchaseToken) throw new PostPurchaseUnavailableError();
    return null;
  }
  if (!data.postPurchaseToken) return null;
  if (data.flashSaleRunId) throw new PostPurchaseUnavailableError();
  return resolvePostPurchaseCreditQuote(db, buyerCookies, { vendorId: data.vendorId, productId: data.productId, token: data.postPurchaseToken });
}

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;
  const limited = await checkRateLimit(request, "checkout-admission", 20, 60_000);
  if (limited) return limited;

  const parsed = AdmissionRequest.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid checkout admission request" }, { status: 400 });
  }
  const db = getDb();
  const existing = parsed.data.idempotencyKey
    ? await db.paymentTransaction.findUnique({
        where: {
          vendorId_checkoutIdempotencyKey: {
            vendorId: parsed.data.vendorId,
            checkoutIdempotencyKey: parsed.data.idempotencyKey,
          },
        },
        select: { status: true, metadata: true, primaryCommerceOrder: { select: { id: true } } },
      })
    : null;
  const existingMetadata = checkoutMetadata(existing?.metadata);
  if (existing && (existing.status !== "pending" || existingMetadata?.productId !== parsed.data.productId)) {
    return NextResponse.json({ error: "Checkout identity already finished or mismatched" }, { status: 409 });
  }
  let postPurchase;
  try {
    postPurchase = await postPurchaseAdmission(request, db, parsed.data, existing, existingMetadata);
  } catch (error) {
    if (error instanceof PostPurchaseUnavailableError) return NextResponse.json({ error: "Post purchase unavailable", code: "POST_PURCHASE_UNAVAILABLE" },
      { status: 409, headers: { "Cache-Control": "private, no-store" } });
    throw error;
  }

  const product = await db.product.findFirst({
    where: existing
      ? { id: parsed.data.productId, vendorId: parsed.data.vendorId }
      : {
          id: parsed.data.productId,
          vendorId: parsed.data.vendorId,
          isActive: true,
          fulfillmentTypeConfirmed: true,
          checkoutUrl: null,
          priceCents: { gt: 0 },
          inventory: { gte: 1 },
        },
    select: { id: true, vendorId: true, revision: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Product not available" }, { status: 404 });
  }

  // 重試既有訂單使用既有不可變快照；新訂單才簽署目前優惠條件。
  const offer = existing || postPurchase ? null : await resolveFlashSaleQuote(db, flashSaleBearerFromRequest(request), parsed.data).catch((error: unknown) => {
    if (error instanceof FlashSaleUnavailableError) return NextResponse.json({ error: "Flash sale changed or unavailable", code: "FLASH_SALE_UNAVAILABLE" }, { status: 409 });
    throw error;
  });
  if (offer instanceof Response) return offer;
  // URL 中的優惠 ID 只是購買意圖；實際授權仍須有同場的伺服器 claim。
  if (!existing && parsed.data.flashSaleRunId && offer?.runId !== parsed.data.flashSaleRunId) {
    return NextResponse.json({ error: "Flash sale changed or unavailable", code: "FLASH_SALE_UNAVAILABLE" }, { status: 409 });
  }
  let issued;
  try {
    issued = issueCheckoutAdmission({
      vendorId: product.vendorId,
      productId: product.id,
      productRevision: product.revision,
      ...(postPurchase ? { offerHash: postPurchaseCreditQuoteHash(postPurchase) } : offer ? { offerHash: flashSaleQuoteHash(offer) } : {}),
      idempotencyKey: parsed.data.idempotencyKey,
      existingSessionToken: checkoutSessionTokenFromRequest(request),
    });
  } catch {
    return NextResponse.json({ error: "Checkout admission unavailable" }, { status: 503 });
  }
  const secure = process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";
  const response = NextResponse.json({
    admissionToken: issued.admissionToken,
    idempotencyKey: issued.idempotencyKey,
    expiresAt: issued.expiresAt.toISOString(),
    ...(postPurchase ? { offer: { priceCents: postPurchase.checkoutAmountCents, currency: postPurchase.currency, hash: postPurchaseCreditQuoteHash(postPurchase) } }
      : offer ? { offer: { priceCents: offer.salePriceCents, currency: offer.currency, hash: flashSaleQuoteHash(offer) } } : {}),
  }, { headers: { "Cache-Control": "private, no-store" } });
  response.cookies.set(
    CHECKOUT_ADMISSION_COOKIE,
    issued.sessionToken,
    checkoutAdmissionCookieOptions({ secure }),
  );
  return response;
}
