import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { buildCommissionDeduplicationKey } from "@/lib/affiliate-commission";
import { Prisma } from "@prisma/client";

const createdVendorIds: string[] = [];
const createdPayoutBatchIds: string[] = [];

afterEach(async () => {
  const db = getDb();
  try {
    await db.vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
  } catch (error) {
    if (!(error instanceof Error) || !/append-only|foreign key constraint|RESTRICT setting/i.test(error.message)) throw error;
  }
  await db.payoutBatch.deleteMany({ where: { id: { in: createdPayoutBatchIds.splice(0) } } });
});

async function vendorFixture(label: string) {
  const suffix = `${Date.now()}-${label}-${Math.random().toString(36).slice(2, 9)}`;
  const vendor = await getDb().vendor.create({
    data: {
      name: `Tenant Invariant ${label}`,
      slug: `tenant-invariant-${suffix}`,
      email: `tenant-invariant-${suffix}@example.test`,
      passwordHash: "test-only",
    },
  });
  createdVendorIds.push(vendor.id);

  const [affiliate, transaction, settlement] = await Promise.all([
    getDb().affiliate.create({
      data: {
        vendorId: vendor.id,
        name: `Affiliate ${label}`,
        code: `TENANT${suffix}`.replaceAll("-", "").toUpperCase(),
        commissionRateBps: 500,
      },
    }),
    getDb().paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "test",
        orderNumber: `TENANT-ORDER-${suffix}`,
        grossAmountCents: 10_000,
        netAmountCents: 10_000,
        status: "paid",
      },
    }),
    getDb().settlement.create({
      data: {
        vendorId: vendor.id,
        monthKey: `${label}-${suffix}`,
      },
    }),
  ]);

  return { vendor, affiliate, transaction, settlement };
}

describe("tenant-bound financial foreign keys", () => {
  it("accepts same-tenant ledgers and rejects four cross-tenant bindings", async () => {
    const db = getDb();
    const [tenantA, tenantB] = await Promise.all([
      vendorFixture("a"),
      vendorFixture("b"),
    ]);
    const payoutBatch = await db.payoutBatch.create({
      data: {
        batchNumber: `TENANT-BATCH-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        batchDate: new Date(),
      },
    });
    createdPayoutBatchIds.push(payoutBatch.id);

    await expect(db.refundRecord.create({
      data: {
        vendorId: tenantA.vendor.id,
        paymentTransactionId: tenantA.transaction.id,
        monthKey: "same-tenant",
        refundAmountCents: 100,
      },
    })).resolves.toMatchObject({ vendorId: tenantA.vendor.id });
    await expect(db.affiliateCommission.create({
      data: {
        vendorId: tenantA.vendor.id,
        affiliateId: tenantA.affiliate.id,
        monthKey: "same-tenant",
        deduplicationKey: buildCommissionDeduplicationKey({
          affiliateId: tenantA.affiliate.id,
          sourceType: "product",
          idempotencyToken: "same-tenant-fixture",
        }),
      },
    })).resolves.toMatchObject({ vendorId: tenantA.vendor.id });
    await expect(db.affiliatePayout.create({
      data: {
        vendorId: tenantA.vendor.id,
        affiliateId: tenantA.affiliate.id,
        monthKey: "same-tenant",
        outcomeReference: "synthetic-affiliate-transfer-ref",
      },
    })).resolves.toMatchObject({ vendorId: tenantA.vendor.id, outcomeReference: "synthetic-affiliate-transfer-ref" });
    await expect(db.payoutItem.create({
      data: {
        payoutBatchId: payoutBatch.id,
        vendorId: tenantA.vendor.id,
        settlementId: tenantA.settlement.id,
        bankAccountDisplayName: "T＊＊＊",
        bankCodeDisplay: "000",
        bankAccountDisplayNumber: "****0000",
        payoutAmountCents: 100,
      },
    })).resolves.toMatchObject({ vendorId: tenantA.vendor.id });

    const foreignKeyError = { code: "P2003" };
    await expect(db.refundRecord.create({
      data: {
        vendorId: tenantB.vendor.id,
        paymentTransactionId: tenantA.transaction.id,
        monthKey: "cross-tenant",
        refundAmountCents: 100,
      },
    })).rejects.toMatchObject(foreignKeyError);
    await expect(db.affiliateCommission.create({
      data: {
        vendorId: tenantA.vendor.id,
        affiliateId: tenantB.affiliate.id,
        monthKey: "cross-tenant",
        deduplicationKey: buildCommissionDeduplicationKey({
          affiliateId: tenantB.affiliate.id,
          sourceType: "product",
          idempotencyToken: "cross-tenant-fixture",
        }),
      },
    })).rejects.toMatchObject(foreignKeyError);
    await expect(db.affiliatePayout.create({
      data: {
        vendorId: tenantA.vendor.id,
        affiliateId: tenantB.affiliate.id,
        monthKey: "cross-tenant",
      },
    })).rejects.toMatchObject(foreignKeyError);
    await expect(db.payoutItem.create({
      data: {
        payoutBatchId: payoutBatch.id,
        vendorId: tenantA.vendor.id,
        settlementId: tenantB.settlement.id,
        bankAccountDisplayName: "T＊＊＊",
        bankCodeDisplay: "000",
        bankAccountDisplayNumber: "****0000",
        payoutAmountCents: 100,
      },
    })).rejects.toMatchObject(foreignKeyError);
  }, 20_000);

  it("enforces commission-rate bounds and vendor-scoped canonical identity", async () => {
    const db = getDb();
    const [tenant, otherTenant] = await Promise.all([
      vendorFixture("commission"),
      vendorFixture("commission-other"),
    ]);
    const sourceId = `commission-source-${Date.now()}`;

    await expect(db.affiliate.update({
      where: { id: tenant.affiliate.id },
      data: { commissionRateBps: 10_001 },
    })).rejects.toThrow();

    const commissionData = {
      vendorId: tenant.vendor.id,
      affiliateId: tenant.affiliate.id,
      monthKey: "2026-07",
      sourceType: "webhook",
      sourceId,
      deduplicationKey: buildCommissionDeduplicationKey({
        affiliateId: tenant.affiliate.id,
        sourceType: "webhook",
        sourceId,
      }),
      orderNumber: `order-${sourceId}`,
      orderAmountCents: 10_000,
      commissionRateBps: 500,
      commissionAmountCents: 500,
    };
    await expect(db.affiliateCommission.create({ data: commissionData })).resolves.toMatchObject({
      sourceId,
    });
    await expect(db.affiliateCommission.create({ data: commissionData })).rejects.toMatchObject({
      code: "P2002",
    });

    // The same external token/key is scoped by vendor in the database, so a
    // different tenant is not accidentally deduplicated with this one.
    await expect(db.affiliateCommission.create({
      data: {
        ...commissionData,
        vendorId: otherTenant.vendor.id,
        affiliateId: otherTenant.affiliate.id,
      },
    })).resolves.toMatchObject({ vendorId: otherTenant.vendor.id });

    const secondAffiliate = await db.affiliate.create({
      data: {
        vendorId: tenant.vendor.id,
        name: "Second beneficiary",
        code: `SECOND${Date.now()}`,
        commissionRateBps: 500,
      },
    });
    await expect(db.affiliateCommission.create({
      data: {
        ...commissionData,
        affiliateId: secondAffiliate.id,
        deduplicationKey: buildCommissionDeduplicationKey({
          affiliateId: secondAffiliate.id,
          sourceType: "webhook",
          sourceId,
        }),
      },
    })).resolves.toMatchObject({ affiliateId: secondAffiliate.id });
  }, 20_000);

  it("rejects cross-tenant ledger relations and direct mutation of an accounting entry", async () => {
    const db = getDb();
    const [tenantA, tenantB] = await Promise.all([vendorFixture("ledger-a"), vendorFixture("ledger-b")]);
    const sourceId = `ledger-${Date.now()}`;
    const commission = await db.affiliateCommission.create({
      data: {
        vendorId: tenantA.vendor.id,
        affiliateId: tenantA.affiliate.id,
        monthKey: "2026-07",
        sourceType: "webhook",
        sourceId,
        deduplicationKey: buildCommissionDeduplicationKey({ affiliateId: tenantA.affiliate.id, sourceType: "webhook", sourceId }),
        orderAmountCents: 1000,
        commissionRateBps: 500,
        commissionAmountCents: 50,
      },
    });
    const entry = await db.affiliateCommissionLedgerEntry.create({
      data: { vendorId: tenantA.vendor.id, affiliateCommissionId: commission.id, entryType: "accrual", deduplicationKey: `test-ledger-${Date.now()}`, providerName: "test", eventIdentity: `event-${Date.now()}`, amountCents: 50, occurredAt: new Date() },
    });
    await expect(db.affiliateCommissionLedgerEntry.create({
      data: { vendorId: tenantB.vendor.id, affiliateCommissionId: commission.id, entryType: "accrual", deduplicationKey: `cross-${Date.now()}`, providerName: "test", eventIdentity: "cross", amountCents: 50, occurredAt: new Date() },
    })).rejects.toMatchObject({ code: "P2003" });
    await expect(db.$executeRaw(Prisma.sql`UPDATE "AffiliateCommissionLedgerEntry" SET "amountCents" = 1 WHERE "id" = ${entry.id}`)).rejects.toThrow("append-only");
    await expect(db.$executeRaw(Prisma.sql`DELETE FROM "AffiliateCommissionLedgerEntry" WHERE "id" = ${entry.id}`)).rejects.toThrow("append-only");
  }, 20_000);

  it("exposes the named ledger constraints, indexes, and append-only triggers in PostgreSQL catalog", async () => {
    const db = getDb();
    const constraints = await db.$queryRaw<Array<{ name: string }>>(Prisma.sql`
      SELECT conname AS name
      FROM pg_constraint
      WHERE conrelid = '"AffiliateCommissionLedgerEntry"'::regclass
    `);
    const indexes = await db.$queryRaw<Array<{ name: string }>>(Prisma.sql`
      SELECT indexname AS name
      FROM pg_indexes
      WHERE tablename = 'AffiliateCommissionLedgerEntry'
    `);
    const triggers = await db.$queryRaw<Array<{ name: string }>>(Prisma.sql`
      SELECT tgname AS name
      FROM pg_trigger
      WHERE tgrelid = '"AffiliateCommissionLedgerEntry"'::regclass
        AND NOT tgisinternal
    `);

    expect(constraints.map((item) => item.name)).toEqual(expect.arrayContaining([
      "AffiliateCommissionLedgerEntry_amount_direction",
      "AffiliateCommissionLedgerEntry_deduplicationKey_nonblank",
      // PostgreSQL identifiers are limited to 63 bytes; the catalog stores
      // the deterministic truncated spelling of this named composite FK.
      "AffiliateCommissionLedgerEntry_vendorId_affiliateCommissionId_f",
    ]));
    expect(indexes.map((item) => item.name)).toEqual(expect.arrayContaining([
      "AffiliateCommissionLedgerEntry_vendorId_deduplicationKey_key",
      "AffiliateCommissionLedger_v_c_created_idx",
    ]));
    expect(triggers.map((item) => item.name)).toEqual(expect.arrayContaining([
      "AffiliateCommissionLedgerEntry_reject_update",
      "AffiliateCommissionLedgerEntry_reject_delete",
    ]));
  }, 20_000);
});
