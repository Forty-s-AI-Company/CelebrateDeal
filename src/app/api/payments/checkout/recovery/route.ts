import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { CommerceCheckoutRecoveryResponseSchema } from "@/lib/commerce-checkout";
import { safeParseCustomCheckoutFields } from "@/lib/commerce-custom-checkout";
import { getDb } from "@/lib/db";
import { FunnelCheckoutReferenceSchema } from "@/lib/funnel-commerce";
import { checkRateLimit } from "@/lib/rate-limit";

const RecoveryRequest = z.object({
  vendorId: z.string().trim().min(1).max(128),
  productId: z.string().trim().min(1).max(128),
  idempotencyKey: z.string().uuid(),
}).strict();

const recoveryOrderSelect = {
  id: true,
  vendorId: true,
  checkoutIdempotencyKey: true,
  totalAmountCents: true,
  currency: true,
  items: {
    select: {
      productId: true,
      productName: true,
      productSlug: true,
      fulfillmentType: true,
      unitPriceCents: true,
      lineIndex: true,
      nonSensitiveSnapshot: true,
    },
    orderBy: { lineIndex: "asc" },
  },
} as const satisfies Prisma.CommerceOrderSelect;
type RecoveryOrder = Prisma.CommerceOrderGetPayload<{ select: typeof recoveryOrderSelect }>;

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function recoverySnapshotResponse(
  order: RecoveryOrder | null,
  metadata: Record<string, unknown>,
  input: z.infer<typeof RecoveryRequest>,
) {
  const { vendorId, productId, idempotencyKey } = input;
  const primaryItem = order?.items.find((item) => item.lineIndex === 0);
  const bumpItem = order?.items.find((item) => item.lineIndex === 1);
  const bumpId = typeof metadata.orderBumpProductId === "string" ? metadata.orderBumpProductId : null;
  if (
    !order || order.vendorId !== vendorId || order.checkoutIdempotencyKey !== idempotencyKey
    || !primaryItem || primaryItem.productId !== productId
    || order.items.length !== (bumpId ? 2 : 1)
    || (bumpId !== null && bumpItem?.productId !== bumpId)
  ) {
    return NextResponse.json({ error: "Checkout recovery unavailable" }, { status: 503 });
  }

  const snapshot = metadataObject(primaryItem.nonSensitiveSnapshot);
  if (!Array.isArray(snapshot.customCheckoutFields)) {
    return NextResponse.json({ error: "Checkout recovery unavailable" }, { status: 503 });
  }
  const customCheckoutFields = safeParseCustomCheckoutFields(snapshot.customCheckoutFields);
  if (!customCheckoutFields.success) {
    return NextResponse.json({ error: "Checkout recovery unavailable" }, { status: 503 });
  }
  const savedFunnel = metadata.funnel ? metadataObject(metadata.funnel) : null;
  const funnel = savedFunnel ? FunnelCheckoutReferenceSchema.safeParse({
    slug: savedFunnel.slug,
    stepId: savedFunnel.stepId,
    expectedVersion: savedFunnel.version,
    expectedProductRevision: savedFunnel.productRevision,
    ...(bumpId ? { expectedOrderBumpRevision: savedFunnel.orderBumpRevision } : {}),
  }) : null;
  if (funnel && !funnel.success) {
    return NextResponse.json({ error: "Checkout recovery unavailable" }, { status: 503 });
  }

  // Only immutable, non-sensitive terms leave this endpoint. No buyer details,
  // custom answers, invoice request or provider form payload are returned.
  const response = CommerceCheckoutRecoveryResponseSchema.safeParse({
    vendorId,
    productId,
    productName: primaryItem.productName,
    fulfillmentType: primaryItem.fulfillmentType,
    customCheckoutFields: customCheckoutFields.data,
    priceCents: order.totalAmountCents - (bumpItem?.unitPriceCents ?? 0),
    currency: order.currency,
    ...(bumpItem && bumpId ? { orderBump: {
      productId: bumpId,
      sku: bumpItem.productSlug,
      title: bumpItem.productName,
      description: "原訂單已包含此加購商品",
      priceCents: bumpItem.unitPriceCents,
    } } : {}),
    ...(funnel?.success ? { funnel: funnel.data } : {}),
    ...(savedFunnel && typeof savedFunnel.agreementLabel === "string" ? { agreementLabel: savedFunnel.agreementLabel } : {}),
    initialOrderBumpSelected: Boolean(bumpId),
  });
  if (!response.success) {
    return NextResponse.json({ error: "Checkout recovery unavailable" }, { status: 503 });
  }
  return NextResponse.json(response.data, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;
  const limited = await checkRateLimit(request, "checkout-recovery", 20, 60_000);
  if (limited) return limited;

  const parsed = RecoveryRequest.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid checkout recovery request" }, { status: 400 });
  const { vendorId, productId, idempotencyKey } = parsed.data;
  const transaction = await getDb().paymentTransaction.findUnique({
    where: { vendorId_checkoutIdempotencyKey: { vendorId, checkoutIdempotencyKey: idempotencyKey } },
    select: { status: true, metadata: true, primaryCommerceOrder: { select: recoveryOrderSelect } },
  });
  const metadata = metadataObject(transaction?.metadata);
  if (!transaction || metadata.productId !== productId) {
    return NextResponse.json({ error: "Checkout recovery not found" }, { status: 404 });
  }
  if (transaction.status !== "pending") {
    return NextResponse.json({ error: "Checkout request already finished" }, { status: 409 });
  }
  return recoverySnapshotResponse(transaction.primaryCommerceOrder, metadata, parsed.data);
}
