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

const AdmissionRequest = z.object({
  vendorId: z.string().trim().min(1).max(128),
  productId: z.string().trim().min(1).max(128),
  idempotencyKey: z.string().uuid().optional(),
}).strict();

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
        select: { status: true, metadata: true },
      })
    : null;
  const existingMetadata = existing?.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
    ? existing.metadata as Record<string, unknown>
    : null;
  if (existing && (existing.status !== "pending" || existingMetadata?.productId !== parsed.data.productId)) {
    return NextResponse.json({ error: "Checkout identity already finished or mismatched" }, { status: 409 });
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

  let issued;
  try {
    issued = issueCheckoutAdmission({
      vendorId: product.vendorId,
      productId: product.id,
      productRevision: product.revision,
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
  }, { headers: { "Cache-Control": "private, no-store" } });
  response.cookies.set(
    CHECKOUT_ADMISSION_COOKIE,
    issued.sessionToken,
    checkoutAdmissionCookieOptions({ secure }),
  );
  return response;
}
