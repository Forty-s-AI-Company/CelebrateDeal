import { Prisma } from "@prisma/client";
import type { StudentPortalScope } from "./student-portal";
import { LearnerNotificationScope } from "./learner-notification-contract";

/** Download/course grants retain their expiry contract. Physical/service items
 * have no entitlement: only a fully paid, unrefunded owned order admits consent. */
export function learnerNotificationPurchaseWhere(session: StudentPortalScope,
  db: Pick<Prisma.TransactionClient, "commerceOrder">, now = new Date()): Prisma.CommerceOrderItemWhereInput {
  return {
    vendorId: session.vendorId,
    order: { is: { vendorId: session.vendorId, automationCustomerKeyHash: session.customerKeyHash,
      status: { in: ["paid", "partially_refunded"] } } },
    OR: [
      { fulfillmentType: { in: ["course", "digital"] }, entitlement: { is: {
        vendorId: session.vendorId, status: "granted", revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      } } },
      { fulfillmentType: { in: ["physical", "service"] }, order: { is: {
        status: "paid", refundedAmountCents: 0, paidAmountCents: { equals: db.commerceOrder.fields.totalAmountCents },
      } } },
    ],
  };
}

export async function hasLearnerNotificationPurchase(db: Pick<Prisma.TransactionClient, "commerceOrderItem" | "commerceOrder">,
  session: StudentPortalScope, productId: string) {
  const scope = LearnerNotificationScope.parse({ vendorId: session.vendorId, customerKeyHash: session.customerKeyHash, productId });
  return !!await db.commerceOrderItem.findFirst({ where: {
    ...learnerNotificationPurchaseWhere(scope, db), productId: scope.productId,
    product: { is: { id: scope.productId, vendorId: scope.vendorId } },
  }, select: { id: true } });
}

/** Payment notifications retain their original order identity. Lock that order
 * through submission so a refund cannot commit between authorization and HTTP. */
export async function lockLearnerPaymentNotificationOrder(
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  scope: StudentPortalScope & { productId: string },
  orderId: string | undefined,
) {
  const identity = LearnerNotificationScope.parse({ vendorId: scope.vendorId, customerKeyHash: scope.customerKeyHash, productId: scope.productId });
  if (!orderId || !/^[A-Za-z0-9_-]{1,128}$/u.test(orderId)) return false;
  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT o."id" FROM "CommerceOrder" o
    WHERE o."id"=${orderId} AND o."vendorId"=${identity.vendorId}
      AND o."automationCustomerKeyHash"=${identity.customerKeyHash}
      AND o."status"='paid' AND o."refundedAmountCents"=0
      AND o."paidAmountCents"=o."totalAmountCents"
      AND EXISTS (SELECT 1 FROM "CommerceOrderItem" i WHERE i."orderId"=o."id"
        AND i."vendorId"=o."vendorId" AND i."productId"=${identity.productId})
    FOR UPDATE OF o`);
  return rows.length === 1;
}

/** Lock only actual purchase rows; separate INNER JOIN branches avoid nullable
 * entitlement locks and serialize refund/revocation with the bounded send. */
export async function lockLearnerNotificationPurchase(db: Pick<Prisma.TransactionClient, "$queryRaw">,
  scope: StudentPortalScope & { productId: string }) {
  const identity = LearnerNotificationScope.parse({ vendorId: scope.vendorId, customerKeyHash: scope.customerKeyHash, productId: scope.productId });
  const grant = await db.$queryRaw<Array<{ id: string }>>`SELECT e."id" FROM "CommerceOrderItem" i
    JOIN "CommerceOrder" o ON o."vendorId"=i."vendorId" AND o."id"=i."orderId"
    JOIN "CommerceEntitlement" e ON e."vendorId"=i."vendorId" AND e."orderItemId"=i."id"
    WHERE i."vendorId"=${identity.vendorId} AND i."productId"=${identity.productId}
      AND i."fulfillmentType" IN ('course','digital') AND o."automationCustomerKeyHash"=${identity.customerKeyHash}
      AND o."status" IN ('paid','partially_refunded') AND e."status"='granted' AND e."revokedAt" IS NULL
      AND (e."expiresAt" IS NULL OR e."expiresAt">clock_timestamp()) ORDER BY e."id" LIMIT 1 FOR UPDATE OF o,e`;
  if (grant.length) return true;
  const purchase = await db.$queryRaw<Array<{ id: string }>>`SELECT o."id" FROM "CommerceOrder" o
    WHERE o."vendorId"=${identity.vendorId} AND o."automationCustomerKeyHash"=${identity.customerKeyHash}
      AND o."status"='paid' AND o."refundedAmountCents"=0 AND o."paidAmountCents"=o."totalAmountCents"
      AND EXISTS (SELECT 1 FROM "CommerceOrderItem" i WHERE i."vendorId"=o."vendorId" AND i."orderId"=o."id"
        AND i."productId"=${identity.productId} AND i."fulfillmentType" IN ('physical','service'))
    ORDER BY o."id" LIMIT 1 FOR UPDATE OF o`;
  return purchase.length === 1;
}
