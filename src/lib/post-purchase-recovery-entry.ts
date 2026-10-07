import type { Prisma } from "@prisma/client";
import { resolveBuyerSupportGrant } from "@/lib/buyer-support-access";
import { assertPostPurchaseCreditReplay, PostPurchaseUnavailableError } from "@/lib/post-purchase-credit";
import type { CheckoutRecoveryRecord } from "@/lib/checkout-idempotency";

type Database = Pick<Prisma.TransactionClient, "buyerSupportOrderGrant" | "commerceOrder" | "product" | "postPurchaseCredit">;
type Cookies = { getAll(): Array<{ name: string; value: string }> };

/** A particular target grant selects a particular order; never pick latest. */
export async function resolvePostPurchaseRecoveryEntry(db: Database, cookies: Cookies, grantId: string): Promise<CheckoutRecoveryRecord> {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(grantId)) throw new PostPurchaseUnavailableError();
  const grant = await resolveBuyerSupportGrant(db, cookies, grantId);
  if (!grant) throw new PostPurchaseUnavailableError();
  const order = await db.commerceOrder.findUnique({ where: { vendorId_id: { vendorId: grant.vendorId, id: grant.orderId } },
    select: { vendorId: true, id: true, status: true, checkoutIdempotencyKey: true,
      primaryPaymentTransaction: { select: { checkoutIdempotencyKey: true, vendorId: true } },
      items: { where: { lineIndex: 0 }, select: { productId: true }, take: 2 } } });
  const item = order?.items[0];
  if (!order || !item?.productId || order.items.length !== 1 || !["pending_payment", "payment_failed", "expired"].includes(order.status)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(order.checkoutIdempotencyKey)
    || order.primaryPaymentTransaction?.vendorId !== order.vendorId
    || order.primaryPaymentTransaction.checkoutIdempotencyKey !== order.checkoutIdempotencyKey) throw new PostPurchaseUnavailableError();
  await assertPostPurchaseCreditReplay(db, cookies, { vendorId: order.vendorId, targetOrderId: order.id, productId: item.productId });
  return { vendorId: order.vendorId, productId: item.productId, idempotencyKey: order.checkoutIdempotencyKey };
}
