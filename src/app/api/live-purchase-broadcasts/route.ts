import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { maskCustomerName, type LivePurchaseBroadcastItem } from "@/lib/live-interaction";
import {
  hasActiveLiveViewerSession,
  liveViewerTokenFromRequest,
} from "@/lib/live-quota-admission";
import { checkRateLimit } from "@/lib/rate-limit";

const Identifier = z.string().trim().min(1).max(128);

async function admittedViewer(request: Request, vendorId: string, liveId: string) {
  const token = liveViewerTokenFromRequest(request);
  if (!token || !await hasActiveLiveViewerSession(getDb(), { vendorId, liveId, token })) return null;
  return { token };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const vendorId = url.searchParams.get("vendorId") ?? "";
  const liveId = url.searchParams.get("liveId") ?? "";

  if (!Identifier.safeParse(vendorId).success || !Identifier.safeParse(liveId).success) {
    return NextResponse.json({ error: "Invalid broadcast scope" }, { status: 400 });
  }

  const limited = await checkRateLimit(request, "live-purchase-broadcasts", 120, 60_000);
  if (limited) return limited;

  const viewer = await admittedViewer(request, vendorId, liveId);
  if (!viewer) {
    return NextResponse.json({ error: "Viewer admission required" }, { status: 401 });
  }

  const now = Date.now();
  const windowStart = new Date(now - 30 * 60 * 1_000);

  const liveProducts = await getDb().liveProduct.findMany({
    where: { vendorId, liveId },
    select: { productId: true },
  });
  const productIds = liveProducts.map((p) => p.productId);

  const orders = await getDb().commerceOrder.findMany({
    where: {
      vendorId,
      status: "paid",
      paidAt: { gte: windowStart },
      ...(productIds.length > 0
        ? { items: { some: { productId: { in: productIds } } } }
        : {}),
    },
    orderBy: { paidAt: "desc" },
    take: 8,
    select: {
      id: true,
      buyerMaskedName: true,
      paidAt: true,
      items: {
        take: 1,
        select: { productName: true },
      },
    },
  });

  const broadcasts: LivePurchaseBroadcastItem[] = orders.map((order) => {
    const paidAtMillis = order.paidAt ? order.paidAt.getTime() : now;
    const secondsAgo = Math.max(0, Math.floor((now - paidAtMillis) / 1_000));
    return {
      id: order.id,
      buyerMaskedName: maskCustomerName(order.buyerMaskedName),
      productName: order.items[0]?.productName ?? "熱門推薦方案",
      secondsAgo,
    };
  });

  return NextResponse.json(
    { broadcasts },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
