/**
 * F-041 read-only preflight: lists every stored record whose currency is not
 * TWD. Checkout, PayUni, refunds and monthly settlement only support New
 * Taiwan Dollars and now refuse anything else; this inventory shows what an
 * operator still has to resolve by hand. It never changes data:
 *
 * - the whole read runs in one `SET TRANSACTION READ ONLY` repeatable-read
 *   snapshot, so PostgreSQL itself rejects any write;
 * - only identifiers, tenant ids, currency codes and counts are printed, never
 *   buyer data, names, prices or amounts.
 *
 * Usage (DATABASE_URL must be injected by the approved shell; this script
 * does not read .env files and never targets a database on its own):
 *
 *   node --import tsx scripts/non-twd-currency-preflight.ts
 *
 * Exit code 0 = no non-TWD records, 1 = non-TWD records found (resolve before
 * launch), 2 = configuration or database failure.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";

const TWD = "TWD";
const NOT_TWD = { currency: { not: TWD } } as const;
/** Upper bound for listed product ids; the counts are always complete. */
const MAX_LISTED_PRODUCTS = 500;

type CurrencyGroup = { vendorId: string; currency: string; count: number };
export type NonTwdCurrencyInventory = {
  products: { total: number; listed: Array<{ vendorId: string; productId: string; currency: string; isActive: boolean }> };
  groups: Record<string, CurrencyGroup[]>;
  refundsOfNonTwdPayments: number;
  total: number;
};

type Grouped = { vendorId: string; currency: string; _count: { _all: number } };
const groups = (rows: Grouped[]): CurrencyGroup[] => rows
  .map((row) => ({ vendorId: row.vendorId, currency: row.currency, count: row._count._all }))
  .sort((a, b) => a.vendorId.localeCompare(b.vendorId) || a.currency.localeCompare(b.currency));

/** Reads the inventory inside a database-enforced read-only snapshot. */
export async function readNonTwdCurrencyInventory(db: Pick<PrismaClient, "$transaction">): Promise<NonTwdCurrencyInventory> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const by: ["vendorId", "currency"] = ["vendorId", "currency"];
    const count = { _all: true } as const;
    const productTotal = await tx.product.count({ where: NOT_TWD });
    const products = await tx.product.findMany({
      where: NOT_TWD,
      select: { id: true, vendorId: true, currency: true, isActive: true },
      orderBy: [{ vendorId: "asc" }, { id: "asc" }],
      take: MAX_LISTED_PRODUCTS,
    });
    // Sequential reads inside one snapshot; each result is bound before
    // grouping so Prisma's groupBy generics are not inferred from `groups`.
    const paymentTransactions = await tx.paymentTransaction.groupBy({ by, where: NOT_TWD, _count: count });
    const commerceOrders = await tx.commerceOrder.groupBy({ by, where: NOT_TWD, _count: count });
    const electronicInvoices = await tx.electronicInvoice.groupBy({ by, where: NOT_TWD, _count: count });
    const postPurchaseCredits = await tx.postPurchaseCredit.groupBy({ by, where: NOT_TWD, _count: count });
    const courseAllocations = await tx.courseCommissionAllocation.groupBy({ by, where: NOT_TWD, _count: count });
    const voucherGrants = await tx.automationVoucherGrant.groupBy({ by, where: NOT_TWD, _count: count });
    const affiliateSnapshots = await tx.merchantAffiliateCheckoutSnapshot.groupBy({ by, where: NOT_TWD, _count: count });
    const platformReferrals = await tx.platformReferralCommission.groupBy({ by, where: NOT_TWD, _count: count });
    const grouped: Record<string, CurrencyGroup[]> = {
      PaymentTransaction: groups(paymentTransactions),
      CommerceOrder: groups(commerceOrders),
      ElectronicInvoice: groups(electronicInvoices),
      PostPurchaseCredit: groups(postPurchaseCredits),
      CourseCommissionAllocation: groups(courseAllocations),
      AutomationVoucherGrant: groups(voucherGrants),
      MerchantAffiliateCheckoutSnapshot: groups(affiliateSnapshots),
      PlatformReferralCommission: groups(platformReferrals),
    };
    const refundsOfNonTwdPayments = await tx.refundRecord.count({ where: { paymentTransaction: NOT_TWD } });
    const total = productTotal + refundsOfNonTwdPayments
      + Object.values(grouped).flat().reduce((sum, group) => sum + group.count, 0);
    return {
      products: {
        total: productTotal,
        listed: products.map((product) => ({ vendorId: product.vendorId, productId: product.id, currency: product.currency, isActive: product.isActive })),
      },
      groups: grouped,
      refundsOfNonTwdPayments,
      total,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
}

export async function main(env: Record<string, string | undefined> = process.env) {
  if (!env.DATABASE_URL) {
    console.error(JSON.stringify({ status: "BLOCKED", reason: "DATABASE_URL must be injected; .env files are not read." }));
    return 2;
  }
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const inventory = await readNonTwdCurrencyInventory(db);
    console.log(JSON.stringify({
      schemaVersion: "celebratedeal-non-twd-currency-preflight/v1",
      status: inventory.total === 0 ? "CLEAN" : "NON_TWD_RECORDS_FOUND",
      databaseWrites: false,
      ...inventory,
    }, null, 2));
    return inventory.total === 0 ? 0 : 1;
  } catch {
    // Never print the connection string or a driver message that may echo it.
    console.error(JSON.stringify({ status: "FAILED", reason: "database read failed" }));
    return 2;
  } finally {
    await db.$disconnect().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; });
}
