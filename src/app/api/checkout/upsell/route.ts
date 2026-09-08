import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveBuyerSupportGrant } from "@/lib/buyer-support-access";
import { issuePostPurchaseCheckoutToken, postPurchaseCheckoutHref } from "@/lib/post-purchase-upsell";
import { resolvePaidOrderPostPurchaseOffer } from "@/lib/post-purchase-upsell-access";

const RequestSchema = z.object({
  grantId: z.string().trim().min(1).max(191).regex(/^[A-Za-z0-9_-]+$/u),
  decision: z.enum(["accept", "decline"]),
  kind: z.enum(["upsell", "downsell"]),
}).strict();

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;
  const limited = await checkRateLimit(request, "post-purchase-upsell", 12, 60_000);
  if (limited) return limited;
  const parsed = RequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid post-purchase decision" }, { status: 400 });

  const db = getDb();
  const grant = await resolveBuyerSupportGrant(db, await cookies(), parsed.data.grantId);
  if (!grant || grant.order.status !== "paid") return NextResponse.json({ error: "Post-purchase offer unavailable" }, { status: 404 });
  const productIds = grant.order.items.map((item) => item.productId).filter((id): id is string => Boolean(id));
  const resolved = await resolvePaidOrderPostPurchaseOffer(db, {
    vendorId: grant.vendorId, status: grant.order.status, productIds, kind: parsed.data.kind,
  });
  if (!resolved) return NextResponse.json({ error: "Post-purchase offer unavailable" }, { status: 404 });

  const dedupKey = `post_purchase_${parsed.data.decision}:${parsed.data.kind}:${resolved.offer.productId}`;
  try {
    await db.commerceOrderEvent.create({
      data: {
        vendorId: grant.vendorId,
        orderId: grant.orderId,
        dedupKey,
        eventType: `post_purchase_${parsed.data.decision}`,
        actorType: "buyer",
        actorId: grant.id,
        sanitizedData: {
          kind: parsed.data.kind,
          offerProductId: resolved.offer.productId,
          amountCents: resolved.offer.amountCents,
          currency: resolved.offer.currency,
        } satisfies Prisma.InputJsonObject,
      },
    });
  } catch (error) {
    // A duplicate decision is safe to replay; every other persistence failure
    // fails closed rather than issuing a checkout handoff without an audit row.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      return NextResponse.json({ error: "Post-purchase offer unavailable" }, { status: 503 });
    }
  }

  if (parsed.data.decision === "decline") {
    if (parsed.data.kind === "upsell") return NextResponse.json({ next: "downsell" }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ next: "complete" }, { headers: { "Cache-Control": "no-store" } });
  }

  const token = issuePostPurchaseCheckoutToken({
    grantId: grant.id,
    orderId: grant.orderId,
    vendorId: grant.vendorId,
    sourceProductId: resolved.source.id,
    productId: resolved.offer.productId,
    kind: resolved.offer.kind,
    amountCents: resolved.offer.amountCents,
  });
  const href = postPurchaseCheckoutHref({ vendorId: grant.vendorId, offer: resolved.offer });
  if (!href) return NextResponse.json({ error: "Post-purchase offer unavailable" }, { status: 404 });
  return NextResponse.json({ checkoutHref: `${href}&postPurchaseToken=${encodeURIComponent(token)}` }, { headers: { "Cache-Control": "no-store" } });
}
