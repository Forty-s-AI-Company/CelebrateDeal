import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireFinanceAdmin: vi.fn(),
  payoutFindUnique: vi.fn(),
  payoutUpdateMany: vi.fn(),
  payoutFindUniqueAfter: vi.fn(),
  auditLogCreate: vi.fn(),
  voidPlatformReferralPayout: vi.fn(),
  syncPlatformReferralPayoutsForMonth: vi.fn(),
  createPlatformReferralPayoutBatch: vi.fn(),
  transaction: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/audit", () => ({ auditSnapshot: (value: unknown) => value }));
vi.mock("@/lib/platform-referral-payout", async () => {
  const actual = await vi.importActual<typeof import("@/lib/platform-referral-payout")>("@/lib/platform-referral-payout");
  return {
    ...actual,
    voidPlatformReferralPayout: mocks.voidPlatformReferralPayout,
    syncPlatformReferralPayoutsForMonth: mocks.syncPlatformReferralPayoutsForMonth,
    createPlatformReferralPayoutBatch: mocks.createPlatformReferralPayoutBatch,
  };
});
vi.mock("@/lib/db", () => ({ getDb: () => ({ $transaction: mocks.transaction }) }));

import { recordPlatformReferralPayoutOutcomeAction } from "./platform-referral-payout-actions";

const payout = {
  id: "platform-payout-1",
  ownerUserId: "owner-1",
  monthKey: "2026-07",
  commissionAmountCents: 500,
  adjustmentAmountCents: 0,
  finalAmountCents: 500,
  status: "batched",
  payoutBatchId: "batch-1",
};

function formData(status: string, reference = "", reason = "") {
  const data = new FormData();
  data.set("id", payout.id);
  data.set("status", status);
  data.set("outcomeReference", reference);
  data.set("outcomeReason", reason);
  return data;
}

function batchFormData(monthKey = "2026-07", batchNumber = "PRP-202607-001") {
  const data = new FormData();
  data.set("monthKey", monthKey);
  data.set("batchNumber", batchNumber);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "finance-1", role: "finance_admin" } });
  mocks.payoutFindUnique.mockResolvedValue(payout);
  mocks.payoutUpdateMany.mockResolvedValue({ count: 1 });
  mocks.payoutFindUniqueAfter.mockResolvedValue({ ...payout, status: "paid" });
  mocks.auditLogCreate.mockResolvedValue({ id: "audit-1" });
  mocks.voidPlatformReferralPayout.mockResolvedValue({ ...payout, status: "void" });
  mocks.syncPlatformReferralPayoutsForMonth.mockResolvedValue([payout]);
  mocks.createPlatformReferralPayoutBatch.mockResolvedValue({ id: "batch-1", batchNumber: "PRP-202607-001" });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    platformReferralPayout: {
      findUnique: mocks.payoutFindUnique,
      updateMany: mocks.payoutUpdateMany,
    },
    auditLog: { create: mocks.auditLogCreate },
  }));
  mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
});

describe("recordPlatformReferralPayoutOutcomeAction", () => {
  it("records paid only for a batched payout and requires a human reference", async () => {
    mocks.payoutFindUnique
      .mockResolvedValueOnce(payout)
      .mockResolvedValueOnce({ ...payout, status: "paid" });

    await expect(recordPlatformReferralPayoutOutcomeAction(formData("paid", "manual-platform-ref-2026-07"))).rejects.toThrow(
      "redirect:/admin/billing/platform-referral-payouts",
    );
    expect(mocks.payoutUpdateMany).toHaveBeenCalledWith({
      where: { id: payout.id, status: "batched", finalAmountCents: 500 },
      data: expect.objectContaining({ status: "paid", outcomeReference: "manual-platform-ref-2026-07" }),
    });
    expect(mocks.auditLogCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "mark_platform_referral_payout_paid", vendorId: null }) });
  });

  it("delegates void to the ledger-reversal domain and records an audit outcome", async () => {
    mocks.payoutFindUnique.mockResolvedValueOnce({ ...payout, status: "pending" });
    await expect(recordPlatformReferralPayoutOutcomeAction(formData("void", "", "manual owner review"))).rejects.toThrow(
      "redirect:/admin/billing/platform-referral-payouts",
    );
    expect(mocks.voidPlatformReferralPayout).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      payoutId: payout.id,
      reason: "manual owner review",
    }));
    expect(mocks.auditLogCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "mark_platform_referral_payout_void" }) });
  });

  it("rejects a paid outcome without a human reference before opening a transaction", async () => {
    await expect(recordPlatformReferralPayoutOutcomeAction(formData("paid"))).rejects.toThrow(
      "redirect:/admin/billing/platform-referral-payouts?error=invalid_outcome",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("syncs the ledger and creates a local batch with an audit record", async () => {
    const { createPlatformReferralPayoutBatchAction } = await import("./platform-referral-payout-actions");
    await expect(createPlatformReferralPayoutBatchAction(batchFormData())).rejects.toThrow(
      "redirect:/admin/billing/platform-referral-payouts",
    );
    expect(mocks.syncPlatformReferralPayoutsForMonth).toHaveBeenCalledWith(expect.anything(), { monthKey: "2026-07" });
    expect(mocks.createPlatformReferralPayoutBatch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      monthKey: "2026-07",
      batchNumber: "PRP-202607-001",
    }));
    expect(mocks.auditLogCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "create_platform_referral_payout_batch" }) });
  });

  it("rejects an invalid batch month before opening a transaction", async () => {
    const { createPlatformReferralPayoutBatchAction } = await import("./platform-referral-payout-actions");
    await expect(createPlatformReferralPayoutBatchAction(batchFormData("2026-13"))).rejects.toThrow(
      "redirect:/admin/billing/platform-referral-payouts?error=invalid_batch",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
