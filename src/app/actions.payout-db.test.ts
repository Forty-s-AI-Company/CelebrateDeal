import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireFinanceAdmin: vi.fn(),
  requireVendorFinance: vi.fn(),
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
  requireVendorFinance: mocks.requireVendorFinance,
  requireVendorManager: vi.fn(),
  requireVendorManagerContext: vi.fn(),
  revokeCurrentSession: vi.fn(),
  sessionCookieOptions: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({
  auditSnapshot: (value: unknown) => value,
  requestAuditMeta: vi.fn(async () => ({ ipAddress: null, userAgent: null })),
  writeAuditLog: mocks.writeAuditLog,
}));
vi.mock("@/lib/billing", () => ({
  calculateSettlement: vi.fn(),
  invoiceNumber: vi.fn(),
  monthRange: (monthKey: string) => {
    const start = new Date(`${monthKey}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return { start, end };
  },
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
    payoutItem: {
      create: database.payoutItem.create.bind(database.payoutItem),
      findUnique: database.payoutItem.findUnique.bind(database.payoutItem),
    },
    $transaction: database.$transaction.bind(database),
  }),
}));

import {
  createPayoutBatchAction,
  lockSettlementAction,
  recordAffiliatePayoutOutcomeAction,
  updatePayoutItemStatusAction,
} from "./actions";

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

function affiliatePayoutOutcomeFormData(id: string, outcomeReference = "affiliate-transfer-ref-db-2026-08") {
  const formData = new FormData();
  formData.set("id", id);
  formData.set("status", "paid");
  formData.set("outcomeReference", outcomeReference);
  formData.set("reason", "synthetic merchant transfer confirmed");
  return formData;
}

function platformPayoutOutcomeFormData(id: string) {
  const formData = new FormData();
  formData.set("id", id);
  formData.set("status", "paid");
  formData.set("outcomeReference", "platform-transfer-ref-db-2026-08");
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
        referralCode: `FIN04-${suffix}`,
        orderNumber: `FIN04-ORDER-${suffix}`,
        orderAmountCents: 10_000,
        commissionBaseAmountCents: 10_000,
        netReferenceAmountCents: 10_000,
        commissionRateBps: 1000,
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
      grossSalesAmountCents: 10_000,
      netReferenceAmountCents: 10_000,
      status: "pending",
      payoutItemId: null,
    });
    expect(savedSettlement.lockedAt).not.toBeNull();
    expect(savedCommission.status).toBe("locked");
  }, 15_000);

  it("persists a paid affiliate payout outcome reference in the tenant schema with its note", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const vendor = await database.vendor.create({
      data: {
        name: "FIN84 Synthetic Vendor",
        slug: `fin84-${suffix}`,
        email: `fin84-${suffix}@invalid.test`,
        passwordHash: "synthetic-password-hash",
      },
    });
    createdVendorIds.push(vendor.id);
    const affiliate = await database.affiliate.create({
      data: {
        vendorId: vendor.id,
        name: "FIN84 Synthetic Affiliate",
        code: `FIN84-${suffix}`,
        commissionRateBps: 1000,
      },
    });
    const commission = await database.affiliateCommission.create({
      data: {
        vendorId: vendor.id,
        affiliateId: affiliate.id,
        monthKey: "2099-12",
        sourceType: "product",
        referralCode: `FIN84-${suffix}`,
        orderNumber: `FIN84-ORDER-${suffix}`,
        orderAmountCents: 10_000,
        commissionBaseAmountCents: 10_000,
        netReferenceAmountCents: 10_000,
        commissionRateBps: 1000,
        deduplicationKey: `fin84-commission-${suffix}`,
        commissionAmountCents: 750,
        status: "locked",
      },
    });
    await database.affiliateCommissionLedgerEntry.create({
      data: {
        vendorId: vendor.id,
        affiliateCommissionId: commission.id,
        entryType: "accrual",
        deduplicationKey: `fin84-ledger-${suffix}`,
        providerName: "synthetic",
        eventIdentity: `fin84-event-${suffix}`,
        amountCents: 750,
        occurredAt: new Date("2099-12-15T00:00:00.000Z"),
      },
    });
    const payout = await database.affiliatePayout.create({
      data: {
        vendorId: vendor.id,
        affiliateId: affiliate.id,
        monthKey: commission.monthKey,
        commissionAmountCents: 750,
        finalAmountCents: 750,
        status: "pending",
      },
    });

    mocks.assertServerActionSecurity.mockResolvedValue(undefined);
    mocks.requireVendorFinance.mockResolvedValue({ vendor, member: { id: "fin84-synthetic-finance", role: "owner" } });

    await expect(recordAffiliatePayoutOutcomeAction(affiliatePayoutOutcomeFormData(payout.id))).rejects.toThrow(
      "redirect:/affiliates/commissions",
    );

    await expect(database.affiliatePayout.findUniqueOrThrow({ where: { id: payout.id } })).resolves.toMatchObject({
      status: "paid",
      outcomeReference: "affiliate-transfer-ref-db-2026-08",
      outcomeReason: "synthetic merchant transfer confirmed",
    });
    await expect(database.affiliateCommission.findUniqueOrThrow({ where: { id: commission.id } })).resolves.toMatchObject({ status: "paid" });
  }, 15_000);

  it("settles the vendor payout without marking the separate merchant affiliate payout paid", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const vendor = await database.vendor.create({
      data: {
        name: "G7 Synthetic Vendor",
        slug: `g7-${suffix}`,
        email: `g7-${suffix}@invalid.test`,
        passwordHash: "synthetic-password-hash",
      },
    });
    createdVendorIds.push(vendor.id);
    const affiliate = await database.affiliate.create({
      data: {
        vendorId: vendor.id,
        name: "G7 Synthetic Affiliate",
        code: `G7-${suffix}`,
        commissionRateBps: 1000,
      },
    });
    const payoutBatch = await database.payoutBatch.create({
      data: {
        batchNumber: `PB-G7-${suffix}`,
        batchDate: new Date("2099-10-31T00:00:00.000Z"),
        totalAmountCents: 9_000,
        totalCount: 1,
        status: "exported",
      },
    });
    const settlement = await database.settlement.create({
      data: {
        vendorId: vendor.id,
        monthKey: "2099-10",
        payoutableAmountCents: 9_000,
        finalPayoutAmountCents: 9_000,
        lockedAt: new Date("2099-10-31T00:00:00.000Z"),
        lockedBy: "g7-synthetic-admin",
        payoutBatchId: payoutBatch.id,
        status: "ready_for_payout",
      },
    });
    const payoutItem = await database.payoutItem.create({
      data: {
        payoutBatchId: payoutBatch.id,
        vendorId: vendor.id,
        settlementId: settlement.id,
        bankAccountDisplayName: "Synthetic Merchant",
        bankCodeDisplay: "000",
        bankAccountDisplayNumber: "***7890",
        payoutAmountCents: 9_000,
        status: "pending",
      },
    });
    const commission = await database.affiliateCommission.create({
      data: {
        vendorId: vendor.id,
        affiliateId: affiliate.id,
        monthKey: settlement.monthKey,
        sourceType: "product",
        referralCode: `G7-${suffix}`,
        orderNumber: `G7-ORDER-${suffix}`,
        orderAmountCents: 10_000,
        commissionBaseAmountCents: 10_000,
        netReferenceAmountCents: 10_000,
        commissionRateBps: 1000,
        deduplicationKey: `g7-commission-${suffix}`,
        commissionAmountCents: 750,
        status: "locked",
      },
    });
    await database.affiliateCommissionLedgerEntry.create({
      data: {
        vendorId: vendor.id,
        affiliateCommissionId: commission.id,
        entryType: "accrual",
        deduplicationKey: `g7-ledger-${suffix}`,
        providerName: "synthetic",
        eventIdentity: `g7-event-${suffix}`,
        amountCents: 750,
        occurredAt: new Date("2099-10-15T00:00:00.000Z"),
      },
    });
    const affiliatePayout = await database.affiliatePayout.create({
      data: {
        vendorId: vendor.id,
        affiliateId: affiliate.id,
        monthKey: settlement.monthKey,
        commissionAmountCents: 750,
        finalAmountCents: 750,
        status: "pending",
      },
    });

    mocks.assertServerActionSecurity.mockResolvedValue(undefined);
    mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "g7-synthetic-admin", role: "finance_admin" } });
    mocks.writeAuditLog.mockResolvedValue(undefined);

    await expect(updatePayoutItemStatusAction(platformPayoutOutcomeFormData(payoutItem.id))).rejects.toThrow(
      "redirect:/admin/billing/payouts",
    );

    const [savedItem, savedBatch, savedSettlement, savedCommission, savedAffiliatePayout] = await Promise.all([
      database.payoutItem.findUniqueOrThrow({ where: { id: payoutItem.id } }),
      database.payoutBatch.findUniqueOrThrow({ where: { id: payoutBatch.id } }),
      database.settlement.findUniqueOrThrow({ where: { id: settlement.id } }),
      database.affiliateCommission.findUniqueOrThrow({ where: { id: commission.id } }),
      database.affiliatePayout.findUniqueOrThrow({ where: { id: affiliatePayout.id } }),
    ]);
    expect(savedItem).toMatchObject({ status: "paid", outcomeReference: "platform-transfer-ref-db-2026-08" });
    expect(savedBatch).toMatchObject({ status: "completed" });
    expect(savedSettlement).toMatchObject({ status: "paid" });
    expect(savedCommission).toMatchObject({ status: "locked" });
    expect(savedAffiliatePayout).toMatchObject({ status: "pending", outcomeReference: null, paidAt: null });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "mark_payout_paid" }));
  }, 15_000);

  it("rolls back a paid item when its settlement is not eligible for that payout batch", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const vendor = await database.vendor.create({
      data: {
        name: "G7 Invalid Settlement Vendor",
        slug: `g7-invalid-${suffix}`,
        email: `g7-invalid-${suffix}@invalid.test`,
        passwordHash: "synthetic-password-hash",
      },
    });
    createdVendorIds.push(vendor.id);
    const payoutBatch = await database.payoutBatch.create({
      data: {
        batchNumber: `PB-G7-INVALID-${suffix}`,
        batchDate: new Date("2099-09-30T00:00:00.000Z"),
        totalAmountCents: 8_000,
        totalCount: 1,
        status: "exported",
      },
    });
    const settlement = await database.settlement.create({
      data: {
        vendorId: vendor.id,
        monthKey: "2099-09",
        payoutableAmountCents: 8_000,
        finalPayoutAmountCents: 8_000,
        status: "locked",
        lockedAt: new Date("2099-09-30T00:00:00.000Z"),
        lockedBy: "g7-synthetic-admin",
        payoutBatchId: payoutBatch.id,
      },
    });
    const payoutItem = await database.payoutItem.create({
      data: {
        payoutBatchId: payoutBatch.id,
        vendorId: vendor.id,
        settlementId: settlement.id,
        bankAccountDisplayName: "Synthetic Merchant",
        bankCodeDisplay: "000",
        bankAccountDisplayNumber: "***7890",
        payoutAmountCents: 8_000,
        status: "pending",
      },
    });

    mocks.assertServerActionSecurity.mockResolvedValue(undefined);
    mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "g7-synthetic-admin", role: "finance_admin" } });
    mocks.writeAuditLog.mockResolvedValue(undefined);

    await expect(updatePayoutItemStatusAction(platformPayoutOutcomeFormData(payoutItem.id))).rejects.toThrow(
      "redirect:/admin/billing/payouts?error=invalid_transition",
    );

    await expect(database.payoutItem.findUniqueOrThrow({ where: { id: payoutItem.id } })).resolves.toMatchObject({
      status: "pending",
      outcomeReference: null,
      paidAt: null,
    });
    await expect(database.payoutBatch.findUniqueOrThrow({ where: { id: payoutBatch.id } })).resolves.toMatchObject({ status: "exported" });
    await expect(database.settlement.findUniqueOrThrow({ where: { id: settlement.id } })).resolves.toMatchObject({ status: "locked", paidAt: null });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  }, 15_000);

  afterEach(() => {
    // AffiliateCommissionLedgerEntry is intentionally append-only. The
    // marker-gated disposable schema is the cleanup boundary for these
    // fixtures; do not issue DELETE against the immutable ledger trigger.
    if (createdVendorIds.length > 0) {
      createdVendorIds.splice(0);
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
