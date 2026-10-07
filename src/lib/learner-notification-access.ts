import type { Prisma } from "@prisma/client";
import type { StudentPortalScope } from "./student-portal";
import { LearnerNotificationScope } from "./learner-notification-contract";

/** Notification consent belongs to a purchased resource, independently of its
 * learning UI. Every admission still requires a live, recipient-owned grant. */
export function learnerNotificationPurchaseWhere(session: StudentPortalScope, now = new Date()): Prisma.CommerceOrderItemWhereInput {
  return {
    vendorId: session.vendorId,
    entitlement: { is: { vendorId: session.vendorId, status: "granted", revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } },
    order: { is: { vendorId: session.vendorId, automationCustomerKeyHash: session.customerKeyHash,
      status: { in: ["paid", "partially_refunded"] } } },
  };
}

export async function hasLearnerNotificationPurchase(db: Pick<Prisma.TransactionClient, "commerceOrderItem">,
  session: StudentPortalScope, productId: string) {
  const scope = LearnerNotificationScope.parse({ vendorId: session.vendorId, customerKeyHash: session.customerKeyHash, productId });
  return !!await db.commerceOrderItem.findFirst({ where: {
    ...learnerNotificationPurchaseWhere(scope), productId: scope.productId,
    product: { is: { id: scope.productId, vendorId: scope.vendorId } },
  }, select: { id: true } });
}
