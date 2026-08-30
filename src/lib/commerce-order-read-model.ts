import type { Prisma } from "@prisma/client";

export const commerceOrderDetailInclude = {
  items: {
    orderBy: { lineIndex: "asc" },
    include: {
      shippingFulfillment: true,
      entitlement: true,
      serviceFulfillment: true,
    },
  },
  events: { orderBy: { occurredAt: "desc" }, take: 100 },
  refunds: { orderBy: { occurredAt: "desc" } },
  supportCases: {
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      assignedMember: { include: { user: { select: { name: true } } } },
      refundHandoff: { select: { status: true } },
    },
  },
} satisfies Prisma.CommerceOrderInclude;

export type CommerceOrderDetailRecord = Prisma.CommerceOrderGetPayload<{
  include: typeof commerceOrderDetailInclude;
}>;
