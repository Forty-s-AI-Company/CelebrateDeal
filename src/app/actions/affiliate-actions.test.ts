import { beforeEach, describe, expect, it, vi } from "vitest";

const testRuntime = vi.hoisted(() => {
  const tx = {
    affiliateCommission: {
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  };
  const db = {
    affiliateCommission: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  };
  return {
    tx,
    db,
    member: { id: "finance-admin-1", role: "finance_admin" },
    commission: {
      id: "commission-1",
      vendorId: "vendor-1",
      affiliateId: "affiliate-1",
      status: "pending",
      commissionAmountCents: 500,
    },
    updatedCommission: {
      id: "commission-1",
      vendorId: "vendor-1",
      affiliateId: "affiliate-1",
      status: "void",
      commissionAmountCents: 500,
    },
    assertServerActionSecurity: vi.fn(),
    requireFinanceAdmin: vi.fn(),
    commissionLedgerBalance: vi.fn(),
    appendCommissionLedgerEntry: vi.fn(),
    assertAffiliateCommissionTransition: vi.fn(),
    writeAuditLog: vi.fn(),
    revalidatePath: vi.fn(),
    redirect: vi.fn((path: string): never => {
      throw new Error(`redirect:${path}`);
    }),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: testRuntime.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: testRuntime.redirect }));
vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: testRuntime.requireFinanceAdmin }));
vi.mock("@/lib/audit", () => ({
  auditSnapshot: (value: unknown) => value,
  writeAuditLog: testRuntime.writeAuditLog,
}));
vi.mock("@/lib/affiliate-commission-accounting", () => ({
  appendCommissionLedgerEntry: testRuntime.appendCommissionLedgerEntry,
  commissionLedgerBalance: testRuntime.commissionLedgerBalance,
}));
vi.mock("@/lib/affiliate-commission", () => ({
  assertAffiliateCommissionTransition: testRuntime.assertAffiliateCommissionTransition,
}));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: testRuntime.assertServerActionSecurity }));
vi.mock("@/lib/db", () => ({ getDb: () => testRuntime.db }));

import { voidAffiliateCommissionAction } from "@/app/actions/affiliate-actions";

function formData({ id = "commission-1", reason = "  duplicate payout  " } = {}) {
  const value = new FormData();
  value.set("id", id);
  value.set("reason", reason);
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  testRuntime.commission.status = "pending";
  testRuntime.db.affiliateCommission.findUnique.mockResolvedValue(testRuntime.commission);
  testRuntime.requireFinanceAdmin.mockResolvedValue({ member: testRuntime.member });
  testRuntime.commissionLedgerBalance.mockResolvedValue(500);
  testRuntime.appendCommissionLedgerEntry.mockResolvedValue({ id: "ledger-reversal-1" });
  testRuntime.tx.affiliateCommission.updateMany.mockResolvedValue({ count: 1 });
  testRuntime.tx.affiliateCommission.findUniqueOrThrow.mockResolvedValue(testRuntime.updatedCommission);
  testRuntime.db.$transaction.mockImplementation(
    async (callback: (tx: typeof testRuntime.tx) => Promise<unknown>) => callback(testRuntime.tx),
  );
});

describe("voidAffiliateCommissionAction", () => {
  it("appends one immutable reversal before voiding a non-paid commission", async () => {
    await expect(voidAffiliateCommissionAction(formData())).rejects.toThrow(
      "redirect:/admin/billing/dashboard",
    );

    expect(testRuntime.assertServerActionSecurity).toHaveBeenCalledWith(expect.any(FormData));
    expect(testRuntime.commissionLedgerBalance).toHaveBeenCalledWith(testRuntime.tx, "vendor-1", "commission-1");
    expect(testRuntime.appendCommissionLedgerEntry).toHaveBeenCalledWith(testRuntime.tx, expect.objectContaining({
      vendorId: "vendor-1",
      affiliateCommissionId: "commission-1",
      entryType: "reversal",
      providerName: "admin",
      eventIdentity: "admin:void:commission-1",
      amountCents: -500,
    }));
    expect(testRuntime.tx.affiliateCommission.updateMany).toHaveBeenCalledWith({
      where: { id: "commission-1", vendorId: "vendor-1", status: "pending" },
      data: { status: "void", settledAt: expect.any(Date) },
    });
    expect(testRuntime.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "finance-admin-1",
      action: "void_affiliate_commission",
      targetId: "commission-1",
      after: { commission: testRuntime.updatedCommission, reason: "duplicate payout" },
    }));
    expect(testRuntime.revalidatePath).toHaveBeenCalledWith("/admin/billing/dashboard");
    expect(testRuntime.revalidatePath).toHaveBeenCalledWith("/affiliates/commissions");
  });

  it("does not append a reversal or rewrite a paid commission with zero ledger balance", async () => {
    testRuntime.commission.status = "paid";
    testRuntime.commissionLedgerBalance.mockResolvedValue(0);
    testRuntime.tx.affiliateCommission.findUniqueOrThrow.mockResolvedValue({
      ...testRuntime.commission,
      status: "paid",
    });

    await expect(voidAffiliateCommissionAction(formData({ reason: "paid correction" }))).rejects.toThrow(
      "redirect:/admin/billing/dashboard",
    );

    expect(testRuntime.assertAffiliateCommissionTransition).not.toHaveBeenCalled();
    expect(testRuntime.appendCommissionLedgerEntry).not.toHaveBeenCalled();
    expect(testRuntime.tx.affiliateCommission.updateMany).not.toHaveBeenCalled();
    expect(testRuntime.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      after: { commission: { ...testRuntime.commission, status: "paid" }, reason: "paid correction" },
    }));
  });

  it.each([
    ["missing", null],
    ["already void", { ...testRuntime.commission, status: "void" }],
  ])("redirects without a transaction for %s commission", async (_label, commission) => {
    testRuntime.db.affiliateCommission.findUnique.mockResolvedValue(commission);

    await expect(voidAffiliateCommissionAction(formData())).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=commission",
    );
    expect(testRuntime.db.$transaction).not.toHaveBeenCalled();
    expect(testRuntime.writeAuditLog).not.toHaveBeenCalled();
  });

  it("checks server action security before reading finance data", async () => {
    testRuntime.assertServerActionSecurity.mockRejectedValueOnce(new Error("csrf rejected"));

    await expect(voidAffiliateCommissionAction(formData())).rejects.toThrow("csrf rejected");
    expect(testRuntime.requireFinanceAdmin).not.toHaveBeenCalled();
    expect(testRuntime.db.affiliateCommission.findUnique).not.toHaveBeenCalled();
  });
});
