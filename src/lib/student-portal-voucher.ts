import type { Prisma } from "@prisma/client";
import { CustomCheckoutFieldsSchema } from "@/lib/commerce-custom-checkout-fields";

/** Match native checkout readiness in both listing and atomic bearer rotation. */
export function studentPortalVoucherProductWhere(vendorId: string): Prisma.ProductWhereInput {
  return {
    vendorId, isActive: true, fulfillmentTypeConfirmed: true, priceCents: { gt: 0 }, inventory: { gt: 0 },
    AND: [
      { OR: [{ checkoutUrl: null }, { checkoutUrl: "" }] },
      { OR: [
        { fulfillmentType: "physical" },
        ...(["digital", "service", "course"] as const).map((fulfillmentType) => ({
          fulfillmentType, deliveryConfig: { is: { status: "active" as const, fulfillmentType } },
        })),
      ] },
    ],
  };
}

export function studentPortalVoucherFieldsReady(value: unknown) {
  return CustomCheckoutFieldsSchema.safeParse(value ?? []).success;
}
