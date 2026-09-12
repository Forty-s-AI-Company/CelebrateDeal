import type { Prisma } from "@prisma/client";

/**
 * Materializes one vendor-scoped customer identity into a trusted sales
 * project. Callers must derive every input from a server-owned source row
 * (form, consultation event, or paid order), never from a browser payload.
 */
export type SalesProjectCustomerMembershipTransaction = {
  customerCrmRecord: Pick<Prisma.TransactionClient["customerCrmRecord"], "upsert">;
  salesProjectCustomer: Pick<Prisma.TransactionClient["salesProjectCustomer"], "upsert">;
};

export async function ensureSalesProjectCustomerMembership(
  tx: SalesProjectCustomerMembershipTransaction,
  input: { vendorId: string; projectId: string | null; customerKeyHash: string | null },
) {
  if (!input.projectId || !input.customerKeyHash) return false;

  // SalesProjectCustomer intentionally references the existing vendor-wide
  // identity. Upserts make webhook and browser retries converge to one row.
  await tx.customerCrmRecord.upsert({
    where: {
      vendorId_customerKeyHash: {
        vendorId: input.vendorId,
        customerKeyHash: input.customerKeyHash,
      },
    },
    create: {
      vendorId: input.vendorId,
      customerKeyHash: input.customerKeyHash,
    },
    update: {},
  });
  await tx.salesProjectCustomer.upsert({
    where: {
      vendorId_projectId_customerKeyHash: {
        vendorId: input.vendorId,
        projectId: input.projectId,
        customerKeyHash: input.customerKeyHash,
      },
    },
    create: {
      vendorId: input.vendorId,
      projectId: input.projectId,
      customerKeyHash: input.customerKeyHash,
    },
    update: {},
  });
  return true;
}
