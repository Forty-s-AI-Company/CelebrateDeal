import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireFinanceAdmin: vi.fn(),
  writeAuditLog: vi.fn(),
  payoutBatchNumber: vi.fn(),
}));

let database: PrismaClient;
let readBarrier: (() => void) | undefined;
let rejectReadBarrier: ((reason?: unknown) => void) | undefined;
let readBarrierPromise: Promise<void> | undefined;
let readBarrierTimeout: ReturnType<typeof setTimeout> | undefined;
let settlementReads = 0;
let lockSettlementReadBarrierEnabled = false;
let lockSettlementReads = 0;
let releaseLockSettlementReads: (() => void) | undefined;
let lockSettlementReadBarrierPromise: Promise<void> | undefined;

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()), cookies: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE: "test-session",
  LEGACY_VENDOR_COOKIE: "test-vendor",
  authenticateUser: vi.fn(),
  createUserSession: vi.fn(),
  markCurrentSessionMfaVerified: vi.fn(),
  requireAuth: vi.fn(),
  requireFinanceAdmin: mocks.requireFinanceAdmin,
  requireVendorManager: vi.fn(),
  revokeCurrentSession: vi.fn(),
  sessionCookieOptions: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ auditSnapshot: (value: unknown) => value, writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/billing", () => ({
  calculateSettlement: vi.fn(),
  invoiceNumber: vi.fn(),
  payoutBatchNumber: mocks.payoutBatchNumber,
}));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/db", () => ({
  // Real PostgreSQL delegates are deliberately retained. findMany alone is
  // wrapped to hold both action callers after they read the eligible row.
  getDb: () => ({
    settlement: {
      findUnique: async (...args: Parameters<PrismaClient["settlement"]["findUnique"]>) => {
        const row = await database.settlement.findUnique(...args);
        if (lockSettlementReadBarrierEnabled && args[0]?.where && "id" in args[0].where) {
          lockSettlementReads += 1;
          if (lockSettlementReads === 2) releaseLockSettlementReads?.();
          await lockSettlementReadBarrierPromise;
        }
        return row;
      },
      findMany: async (...args: Parameters<PrismaClient["settlement"]["findMany"]>) => {
        const rows = await database.settlement.findMany(...args);
        settlementReads += 1;
        if (settlementReads === 2) {
          if (readBarrierTimeout) clearTimeout(readBarrierTimeout);
          readBarrier?.();
        }
        await readBarrierPromise;
        return rows;
      },
      updateMany: database.settlement.updateMany.bind(database.settlement),
    },
    payoutBatch: { create: database.payoutBatch.create.bind(database.payoutBatch) },
    payoutItem: { create: database.payoutItem.create.bind(database.payoutItem) },
    $transaction: database.$transaction.bind(database),
  }),
}));

import { createPayoutBatchAction, lockSettlementAction } from "./actions";

function payoutFormData(settlementId: string) {
  const formData = new FormData();
  formData.append("settlementIds", settlementId);
  return formData;
}

function lockSettlementFormData(settlementId: string) {
  const formData = new FormData();
  formData.append("id", settlementId);
  return formData;
}

function redirectUrl(outcome: PromiseSettledResult<unknown>) {
  expect(outcome.status).toBe("rejected");
  const reason = (outcome as PromiseRejectedResult).reason;
  expect(reason).toBeInstanceOf(Error);
  return (reason as Error).message.replace(/^redirect:/, "");
}

describe("createPayoutBatchAction PostgreSQL conditional settlement claim", () => {
  const createdVendorIds: string[] = [];

  beforeAll(() => {
    expect(process.env.WP18_DISPOSABLE_SCHEMA).toMatch(/^wp18_[a-z0-9_]+$/);
    database = new PrismaClient({ log: [] });
  });

  afterEach(async () => {
    // Payout batches are not vendor-owned; delete them explicitly after the
    // vendor cascade has removed fixture settlements and payout items.
    await database.payoutBatch.deleteMany({ where: { batchNumber: { startsWith: "PB-WP18-" } } });
    if (createdVendorIds.length > 0) {
      await database.vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
    }
    vi.clearAllMocks();
    if (readBarrierTimeout) clearTimeout(readBarrierTimeout);
    readBarrier = undefined;
    rejectReadBarrier = undefined;
    readBarrierPromise = undefined;
    readBarrierTimeout = undefined;
    settlementReads = 0;
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  it("gives one reader the settlement and redirects the other safely to conflict", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const vendor = await database.vendor.create({
      data: {
        name: "WP18 Synthetic Vendor",
        slug: `wp18-${suffix}`,
        email: `wp18-${suffix}@invalid.test`,
        passwordHash: "synthetic-password-hash",
      },
    });
    createdVendorIds.push(vendor.id);
    await database.paymentAccount.create({
      data: {
        vendorId: vendor.id,
        mode: "platform",
        providerName: "synthetic",
        accountLabel: "WP18 Synthetic Platform Account",
        status: "active",
        bankAccountLegacyName: "Synthetic Merchant",
        bankCodeLegacy: "000",
        bankAccountLegacyNumber: "1234567890",
      },
    });
    const settlement = await database.settlement.create({
      data: {
        vendorId: vendor.id,
        monthKey: "2099-12",
        lockedAt: new Date(),
        lockedBy: "wp18-synthetic-admin",
        finalPayoutAmountCents: 12_345,
        status: "locked",
      },
    });

    mocks.assertServerActionSecurity.mockResolvedValue(undefined);
    mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "wp18-synthetic-admin", role: "finance_admin" } });
    mocks.writeAuditLog.mockResolvedValue(undefined);
    mocks.payoutBatchNumber
      .mockReturnValueOnce("PB-WP18-A")
      .mockReturnValueOnce("PB-WP18-B");

    readBarrierPromise = new Promise<void>((resolve, reject) => {
      readBarrier = resolve;
      rejectReadBarrier = reject;
    });
    readBarrierTimeout = setTimeout(() => {
      rejectReadBarrier?.(new Error("WP-18 payout settlement read barrier timed out"));
    }, 2_000);

    const outcomes = await Promise.allSettled([
      createPayoutBatchAction(payoutFormData(settlement.id)),
      createPayoutBatchAction(payoutFormData(settlement.id)),
    ]);

    expect(settlementReads).toBe(2);
    expect(mocks.payoutBatchNumber.mock.results.map((result) => result.value).sort()).toEqual([
      "PB-WP18-A",
      "PB-WP18-B",
    ]);
    expect(outcomes.map(redirectUrl).sort()).toEqual([
      "/admin/billing/payouts",
      "/admin/billing/payouts?error=conflict",
    ]);
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "create_payout_batch" }));

    const [batches, items, claimedSettlement] = await Promise.all([
      database.payoutBatch.findMany({ where: { batchNumber: { startsWith: "PB-WP18-" } } }),
      database.payoutItem.findMany({ where: { vendorId: vendor.id } }),
      database.settlement.findUniqueOrThrow({ where: { id: settlement.id } }),
    ]);
    expect(batches).toHaveLength(1);
    expect(items).toHaveLength(1);
    expect(claimedSettlement.payoutBatchId).toBe(batches[0]?.id);
    expect(items[0]).toMatchObject({
      payoutBatchId: batches[0]?.id,
      settlementId: settlement.id,
      payoutAmountCents: settlement.finalPayoutAmountCents,
    });
    expect(batches[0]).toMatchObject({ totalCount: 1, totalAmountCents: settlement.finalPayoutAmountCents });
    // The only vendor-owned item is the winner's item, so no loser-created or
    // otherwise unbound payout item can remain after transaction rollback.
    expect(await database.payoutItem.count({ where: { vendorId: vendor.id } })).toBe(1);
  }, 15_000);
});

describe("lockSettlementAction PostgreSQL AffiliatePayout writer concurrency", () => {
  const createdVendorIds: string[] = [];

  beforeAll(() => {
    expect(process.env.WP18_DISPOSABLE_SCHEMA).toMatch(/^wp18_[a-z0-9_]+$/);
    database = new PrismaClient({ log: [] });
  });

  it("creates exactly one merchant self-pay AffiliatePayout when two locks race", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const vendor = await database.vendor.create({
      data: {
        name: "FIN04 Synthetic Vendor",
        slug: `fin04-${suffix}`,
        email: `fin04-${suffix}@invalid.test`,
        passwordHash: "synthetic-password-hash",
      },
    });
    createdVendorIds.push(vendor.id);
    const affiliate = await database.affiliate.create({
      data: {
        vendorId: vendor.id,
        name: "FIN04 Synthetic Affiliate",
        code: `FIN04-${suffix}`,
        commissionRateBps: 1000,
      },
    });
    const settlement = await database.settlement.create({
      data: {
        vendorId: vendor.id,
        monthKey: "2099-11",
        payoutableAmountCents: 9_000,
        finalPayoutAmountCents: 9_000,
        status: "draft",
      },
    });
    const commission = await database.affiliateCommission.create({
      data: {
        vendorId: vendor.id,
        affiliateId: affiliate.id,
        monthKey: settlement.monthKey,
        sourceType: "product",
        deduplicationKey: `fin04-commission-${suffix}`,
        commissionAmountCents: 750,
        status: "approved",
      },
    });
    await database.affiliateCommissionLedgerEntry.create({
      data: {
        vendorId: vendor.id,
        affiliateCommissionId: commission.id,
        entryType: "accrual",
        deduplicationKey: `fin04-ledger-${suffix}`,
        providerName: "synthetic",
        eventIdentity: `fin04-event-${suffix}`,
        amountCents: 750,
        occurredAt: new Date("2099-11-15T00:00:00.000Z"),
      },
    });

    mocks.assertServerActionSecurity.mockResolvedValue(undefined);
    mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "fin04-synthetic-admin", role: "finance_admin" } });
    mocks.writeAuditLog.mockResolvedValue(undefined);
    lockSettlementReadBarrierEnabled = true;
    lockSettlementReadBarrierPromise = new Promise<void>((resolve) => { releaseLockSettlementReads = resolve; });

    const outcomes = await Promise.allSettled([
      lockSettlementAction(lockSettlementFormData(settlement.id)),
      lockSettlementAction(lockSettlementFormData(settlement.id)),
    ]);

    expect(lockSettlementReads).toBe(2);
    expect(outcomes.map(redirectUrl).sort()).toEqual([
      "/admin/billing/settlements",
      "/admin/billing/settlements?error=conflict",
    ]);
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);

    const [payouts, savedSettlement, savedCommission] = await Promise.all([
      database.affiliatePayout.findMany({ where: { vendorId: vendor.id, affiliateId: affiliate.id, monthKey: settlement.monthKey } }),
      database.settlement.findUniqueOrThrow({ where: { id: settlement.id } }),
      database.affiliateCommission.findUniqueOrThrow({ where: { id: commission.id } }),
    ]);
    expect(payouts).toHaveLength(1);
    expect(payouts[0]).toMatchObject({
      vendorId: vendor.id,
      affiliateId: affiliate.id,
      monthKey: settlement.monthKey,
      commissionAmountCents: 750,
      adjustmentAmountCents: 0,
      finalAmountCents: 750,
      status: "pending",
      payoutItemId: null,
    });
    expect(savedSettlement.lockedAt).not.toBeNull();
    expect(savedCommission.status).toBe("locked");
  }, 15_000);

  afterEach(async () => {
    if (createdVendorIds.length > 0) {
      await database.vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
    }
    vi.clearAllMocks();
    lockSettlementReadBarrierEnabled = false;
    lockSettlementReads = 0;
    releaseLockSettlementReads = undefined;
    lockSettlementReadBarrierPromise = undefined;
  });

  afterAll(async () => {
    await database.$disconnect();
  });
});
