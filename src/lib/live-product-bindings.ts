import type { Prisma } from "@prisma/client";

/** Replace bindings inside the caller's already-authorized lifecycle transaction.
 * Sequential writes preserve submitted order and the original first-item pin. */
export async function replaceLiveProductBindings(
  tx: Pick<Prisma.TransactionClient, "liveProduct">,
  input: { vendorId: string; liveId: string; productIds: readonly string[] },
) {
  await tx.liveProduct.deleteMany({
    where: { vendorId: input.vendorId, liveId: input.liveId },
  });
  for (const [index, productId] of input.productIds.entries()) {
    await tx.liveProduct.create({
      data: {
        vendorId: input.vendorId,
        liveId: input.liveId,
        productId,
        sortOrder: index + 1,
        isPinned: index === 0,
      },
    });
  }
}
