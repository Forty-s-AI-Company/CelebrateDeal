import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireFinanceAdmin: vi.fn(),
  coursePayoutFindUnique: vi.fn(),
  coursePayoutUpdateMany: vi.fn(),
  courseCommissionAllocationFindMany: vi.fn(),
  courseCommissionLedgerEntryAggregate: vi.fn(),
  courseCommissionLedgerEntryFindUnique: vi.fn(),
  courseCommissionLedgerEntryCreate: vi.fn(),
  coursePayoutFindUniqueAfter: vi.fn(),
  auditLogCreate: vi.fn(),
  transaction: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/audit", () => ({ auditSnapshot: (value: unknown) => value }));
vi.mock("@/lib/billing", () => ({
  monthRange: () => ({ start: new Date("2026-07-01T00:00:00.000Z"), end: new Date("2026-08-01T00:00:00.000Z") }),
}));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ $transaction: mocks.transaction }),
}));

import { recordCoursePayoutOutcomeAction } from "./course-payout-actions";

const payout = {
  id: "course-payout-1",
  vendorId: "vendor-1",
  recipientMembershipId: "membership-f",
  monthKey: "2026-07",
  commissionAmountCents: 500,
  adjustmentAmountCents: 0,
  finalAmountCents: 500,
  status: "pending",
};

function formData(status: string, reference = "", reason = "") {
  const data = new FormData();
  data.set("id", payout.id);
  data.set("status", status);
  data.set("outcomeReference", reference);
  data.set("outcomeReason", reason);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "finance-1", role: "finance_admin" } });
  mocks.coursePayoutFindUnique.mockResolvedValue(payout);
  mocks.coursePayoutUpdateMany.mockResolvedValue({ count: 1 });
  mocks.courseCommissionAllocationFindMany.mockResolvedValue([{ id: "allocation-f" }]);
  mocks.courseCommissionLedgerEntryAggregate.mockResolvedValue({ _sum: { amountCents: 500 } });
  mocks.courseCommissionLedgerEntryFindUnique.mockResolvedValue(null);
  mocks.courseCommissionLedgerEntryCreate.mockResolvedValue({ id: "ledger-1" });
  mocks.coursePayoutFindUniqueAfter.mockResolvedValue({ ...payout, status: "paid" });
  mocks.auditLogCreate.mockResolvedValue({ id: "audit-1" });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    coursePayout: {
      findUnique: mocks.coursePayoutFindUnique,
      updateMany: mocks.coursePayoutUpdateMany,
      findUniqueAfter: mocks.coursePayoutFindUniqueAfter,
    },
    courseCommissionAllocation: { findMany: mocks.courseCommissionAllocationFindMany },
    courseCommissionLedgerEntry: {
      aggregate: mocks.courseCommissionLedgerEntryAggregate,
      findUnique: mocks.courseCommissionLedgerEntryFindUnique,
      create: mocks.courseCommissionLedgerEntryCreate,
    },
    auditLog: { create: mocks.auditLogCreate },
  }));
  mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
});

describe("recordCoursePayoutOutcomeAction", () => {
  it("records a paid outcome only after exact ledger reconciliation and reference validation", async () => {
    mocks.coursePayoutFindUnique
      .mockResolvedValueOnce(payout)
      .mockResolvedValueOnce({ ...payout, status: "paid" });

    await expect(recordCoursePayoutOutcomeAction(formData("paid", "manual-ref-2026-07"))).rejects.toThrow(
      "redirect:/admin/billing/course-payouts",
    );

    expect(mocks.coursePayoutUpdateMany).toHaveBeenCalledWith({
      where: { id: payout.id, status: "pending", finalAmountCents: 500 },
      data: expect.objectContaining({ status: "paid", outcomeReference: "manual-ref-2026-07" }),
    });
    expect(mocks.courseCommissionLedgerEntryCreate).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "mark_course_payout_paid" }) });
  });

  it("voids a pending course payout with one immutable reversal per positive allocation balance", async () => {
    mocks.coursePayoutFindUnique
      .mockResolvedValueOnce(payout)
      .mockResolvedValueOnce({ ...payout, status: "void" });

    await expect(recordCoursePayoutOutcomeAction(formData("void", "", "recipient verification failed"))).rejects.toThrow(
      "redirect:/admin/billing/course-payouts",
    );

    expect(mocks.courseCommissionLedgerEntryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        courseCommissionAllocationId: "allocation-f",
        entryType: "reversal",
        amountCents: -500,
        eventIdentity: "course-payout:void:course-payout-1:allocation-f",
      }),
    });
    expect(mocks.auditLogCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "mark_course_payout_void" }) });
  });

  it("rejects a paid outcome without a human reference before opening a transaction", async () => {
    await expect(recordCoursePayoutOutcomeAction(formData("paid"))).rejects.toThrow(
      "redirect:/admin/billing/course-payouts?error=invalid_outcome",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
