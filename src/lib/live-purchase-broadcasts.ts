import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { hasActiveLiveViewerSession } from "./live-quota-admission";
import { maskCustomerName, type LivePurchaseBroadcastItem } from "./live-interaction";
import { EVERGREEN_ACTIVATION_SELECT, isActiveEvergreenLive } from "./evergreen-activation";

const Identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
export const LivePurchaseBroadcastQuery = z.object({ vendorId: Identifier, liveId: Identifier }).strict();
type Database = Pick<PrismaClient, "$transaction">;

export class LivePurchaseBroadcastAccessDenied extends Error {}

/** Read one consistent, bounded snapshot. Only server-attributed, unrefunded
 * paid purchases of this live's visible products become public display cards.
 * An empty product list must never widen the query to the entire merchant.
 *
 * An active evergreen Live gets no ticker: each visitor's session reveals
 * offers at its own offset, and a shared ticker would name products their
 * session has not reached yet. (Reveal is presentation only; it never
 * authorizes or blocks a purchase, and checkout keeps its own server checks.) */
export async function listLivePurchaseBroadcasts(db: Database, input: {
  vendorId: string; liveId: string; admissionToken: string | null; now?: Date;
}): Promise<LivePurchaseBroadcastItem[]> {
  const scope = LivePurchaseBroadcastQuery.parse({ vendorId: input.vendorId, liveId: input.liveId });
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime()) || !input.admissionToken || !/^[A-Za-z0-9_-]{43}$/u.test(input.admissionToken)) {
    throw new LivePurchaseBroadcastAccessDenied();
  }
  const admissionToken = input.admissionToken;
  return db.$transaction(async tx => {
    if (!await hasActiveLiveViewerSession(tx as unknown as PrismaClient, { ...scope, token: admissionToken, now })) {
      throw new LivePurchaseBroadcastAccessDenied();
    }
    const live = await tx.live.findFirst({
      where: { id: scope.liveId, vendorId: scope.vendorId },
      select: { id: true, ...EVERGREEN_ACTIVATION_SELECT, video: { select: { durationSec: true } } },
    });
    if (!live) throw new LivePurchaseBroadcastAccessDenied();
    if (isActiveEvergreenLive(live, { now })) return [];
    const product = await tx.liveProduct.findFirst({ where: { ...scope, isVisible: true }, select: { id: true } });
    if (!product) return [];
    // A relational predicate includes every visible product without loading an
    // unbounded ID list or silently dropping the 101st product.
    const visibleItem = { vendorId: scope.vendorId,
      product: { vendorId: scope.vendorId, liveProducts: { some: { ...scope, isVisible: true } } } };
    const orders = await tx.commerceOrder.findMany({
      where: {
        vendorId: scope.vendorId, status: "paid", isTestOrder: false,
        paidAmountCents: { gt: 0 }, refundedAmountCents: 0,
        paidAt: { gte: new Date(now.getTime() - 30 * 60_000), lte: now },
        primaryPaymentTransaction: {
          vendorId: scope.vendorId, status: "paid", refundedAmountCents: 0,
          metadata: { path: ["sourceLiveId"], equals: scope.liveId },
        },
        items: { some: visibleItem },
      },
      select: {
        id: true, buyerMaskedName: true, paidAt: true,
        items: { where: visibleItem,
          select: { productName: true }, orderBy: { lineIndex: "asc" }, take: 1 },
      },
      orderBy: [{ paidAt: "desc" }, { id: "desc" }], take: 8,
    });
    return orders.flatMap(order => order.paidAt && order.items[0] ? [{
      // Do not publish canonical order IDs or payment identifiers to viewers.
      id: createHash("sha256").update(JSON.stringify(["live-purchase-card", scope.vendorId, scope.liveId, order.id])).digest("hex"),
      buyerMaskedName: maskCustomerName(order.buyerMaskedName),
      productName: order.items[0].productName,
      secondsAgo: Math.floor((now.getTime() - order.paidAt.getTime()) / 1_000),
    }] : []);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
