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

import { createPayoutBatchAction } from "./actions";

function payoutFormData(settlementId: string) {
  const formData = new FormData();
  formData.append("settlementIds", settlementId);
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
