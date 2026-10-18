import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { verifyCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveBuyerSupportGrant } from "@/lib/buyer-support-access";
import { issuePostPurchaseCheckoutToken, postPurchaseCheckoutHref } from "@/lib/post-purchase-upsell";
import { resolvePaidOrderPostPurchaseOffer } from "@/lib/post-purchase-upsell-access";

const RequestSchema = z.object({
  grantId: z.string().trim().min(1).max(191).regex(/^[A-Za-z0-9_-]+$/u),
  decision: z.enum(["accept", "decline"]), kind: z.enum(["upsell", "downsell"]),
}).strict();
const privateHeaders = { "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: privateHeaders });

async function choose(request: Request): Promise<Response> {
  const denied = requireSameOriginRequest(request, { requireClientHeader: true });
  if (denied) return denied;
  const parsed = RequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return json({ error: "Invalid post-purchase decision" }, 400);
  const csrf = request.headers.get("x-csrf-token");
  if (!csrf || csrf.length > 512 || !await verifyCsrfToken(csrf)) return json({ error: "Post-purchase decision forbidden" }, 403);
  const db = getDb(); const cookieStore = await cookies();
  const initialGrant = await resolveBuyerSupportGrant(db, cookieStore, parsed.data.grantId);
  if (!initialGrant || initialGrant.order.status !== "paid") return json({ error: "Post-purchase offer unavailable" }, 404);
  // A verified grant owns the decision bucket. Forged forwarded headers cannot
  // rotate its identity or bypass the bounded retry limit.
  const identity = createHash("sha256").update(initialGrant.id).digest("hex");
  const limited = await checkRateLimit(new Request(request.url, { headers: { "cf-connecting-ip": "authenticated-buyer" } }),
    `post-purchase-upsell:${identity}`, 12, 60_000);
  if (limited) return limited;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async tx => {
    const grant = await resolveBuyerSupportGrant(tx, cookieStore, parsed.data.grantId);
    if (!grant || grant.order.status !== "paid") return json({ error: "Post-purchase offer unavailable" }, 404);
    const resolved = await resolvePaidOrderPostPurchaseOffer(tx, { vendorId: grant.vendorId, orderId: grant.orderId, kind: parsed.data.kind });
    if (!resolved) return json({ error: "Post-purchase offer unavailable" }, 404);
    const offerHash = createHash("sha256").update(JSON.stringify([
      "post-purchase-decision-v1", grant.vendorId, grant.orderId, resolved.source.id,
      resolved.offer.kind, resolved.offer.productId, resolved.offer.currency, resolved.offer.amountCents,
      resolved.offer.originalPriceCents, resolved.offer.discountCents,
    ])).digest("hex");
    // ON CONFLICT DO NOTHING leaves duplicate transactions usable; a changed
    // accepted price retains its own immutable receipt instead of overwriting.
    await tx.commerceOrderEvent.createMany({ data: {
      vendorId: grant.vendorId, orderId: grant.orderId,
      dedupKey: `post_purchase_${parsed.data.decision}:${offerHash}`,
      eventType: `post_purchase_${parsed.data.decision}`, actorType: "buyer", actorId: grant.id,
      sanitizedData: { kind: resolved.offer.kind, offerProductId: resolved.offer.productId,
        amountCents: resolved.offer.amountCents, currency: resolved.offer.currency, offerHash },
    }, skipDuplicates: true });
    if (parsed.data.decision === "decline") return json({ next: parsed.data.kind === "upsell" ? "downsell" : "complete" });
    const token = issuePostPurchaseCheckoutToken({ grantId: grant.id, orderId: grant.orderId, vendorId: grant.vendorId,
      sourceProductId: resolved.source.id, productId: resolved.offer.productId, kind: resolved.offer.kind, amountCents: resolved.offer.amountCents });
    const href = postPurchaseCheckoutHref({ vendorId: grant.vendorId, offer: resolved.offer });
    return href ? json({ checkoutHref: `${href}&postPurchaseToken=${encodeURIComponent(token)}` }) : json({ error: "Post-purchase offer unavailable" }, 404);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (attempt === 2 || typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2034") throw error;
    }
  }
  return json({ error: "Post-purchase offer unavailable" }, 503);
}

export async function POST(request: Request) {
  try {
    const response = await choose(request);
    for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
    return response;
  } catch { return json({ error: "Post-purchase offer unavailable" }, 503); }
}
