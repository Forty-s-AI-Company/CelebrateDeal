import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  calculateSettlement: vi.fn(),
  findUnique: vi.fn(),
  invoiceUpsert: vi.fn(),
  paymentTransactionUpdate: vi.fn(),
  redirect: vi.fn(),
  refundRecordAggregate: vi.fn(),
  refundRecordCreate: vi.fn(),
  requireFinanceAdmin: vi.fn(),
  revalidatePath: vi.fn(),
  settlementFindUnique: vi.fn(),
  settlementUpsert: vi.fn(),
  transaction: vi.fn(),
  vendorFindUnique: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/audit", () => ({
  auditSnapshot: (value: unknown) => value,
  writeAuditLog: mocks.writeAuditLog,
}));
vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/billing", () => ({
  calculateSettlement: mocks.calculateSettlement,
  invoiceNumber: (vendorSlug: string, monthKey: string) => `${vendorSlug}-${monthKey}`,
}));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    paymentTransaction: {
      findUnique: mocks.findUnique,
      update: mocks.paymentTransactionUpdate,
    },
    refundRecord: { aggregate: mocks.refundRecordAggregate },
    settlement: { findUnique: mocks.settlementFindUnique },
    $transaction: mocks.transaction,
    vendor: { findUnique: mocks.vendorFindUnique },
  }),
}));

import { generateSettlementAction, refundPaymentTransactionAction } from "./actions";

const transaction = {
  id: "payment-1",
  vendorId: "vendor-1",
  grossAmountCents: 10_000,
  refundedAmountCents: 6_000,
  gatewayFeeCents: 1_000,
  platformFeeCents: 400,
};

function refundFormData(
  refundAmount: string,
  gatewayFeeRefund = "0",
  platformFeeRefund = "0",
  monthKey = "2026-07",
) {
  const formData = new FormData();
  formData.set("id", transaction.id);
  formData.set("refundAmount", refundAmount);
  formData.set("gatewayFeeRefund", gatewayFeeRefund);
  formData.set("platformFeeRefund", platformFeeRefund);
  formData.set("monthKey", monthKey);
  return formData;
}

function settlementFormData(monthKey: string) {
  const formData = new FormData();
  formData.set("vendorId", "vendor-1");
  formData.set("monthKey", monthKey);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActionSecurity.mockResolvedValue(undefined);
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "finance-1", role: "finance_admin" } });
  mocks.findUnique.mockResolvedValue(transaction);
  mocks.refundRecordAggregate.mockResolvedValue({
    _sum: { gatewayFeeRefundCents: 0, platformFeeRefundCents: 0 },
  });
  mocks.vendorFindUnique.mockResolvedValue({ id: "vendor-1", slug: "vendor" });
  mocks.settlementFindUnique.mockResolvedValue(null);
  mocks.calculateSettlement.mockResolvedValue({
    monthlyFeeCents: 1_000,
    overflowFeeCents: 200,
    paymentServiceFeeCents: 300,
    transactionServiceFeeCents: 400,
    affiliateManagementFeeCents: 500,
    paymentGatewayFeeCents: 600,
    grossRevenueCents: 10_000,
    payoutableAmountCents: 8_000,
  });
  mocks.paymentTransactionUpdate.mockResolvedValue({ ...transaction, refundedAmountCents: 10_000, status: "refunded" });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    paymentTransaction: {
      findUnique: mocks.findUnique,
      update: mocks.paymentTransactionUpdate,
    },
    refundRecord: {
      aggregate: mocks.refundRecordAggregate,
      create: mocks.refundRecordCreate,
    },
  }));
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
});

describe("generateSettlementAction", () => {
  it("rejects an invalid settlement month before database access or side effects", async () => {
    await expect(generateSettlementAction(settlementFormData("2026-13"))).rejects.toThrow(
      "redirect:/admin/billing/settlements?error=missing",
    );

    expect(mocks.vendorFindUnique).not.toHaveBeenCalled();
    expect(mocks.settlementFindUnique).not.toHaveBeenCalled();
    expect(mocks.calculateSettlement).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.settlementUpsert).not.toHaveBeenCalled();
    expect(mocks.invoiceUpsert).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("generates a settlement and invoice for a valid settlement month", async () => {
    const settlement = { id: "settlement-1" };
    mocks.settlementUpsert.mockResolvedValue(settlement);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      settlement: { upsert: mocks.settlementUpsert },
      invoice: { upsert: mocks.invoiceUpsert },
    }));

    await expect(generateSettlementAction(settlementFormData("2026-12"))).rejects.toThrow(
      "redirect:/admin/billing/settlements",
    );

    expect(mocks.calculateSettlement).toHaveBeenCalledWith("vendor-1", "2026-12");
    expect(mocks.settlementUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId_monthKey: { vendorId: "vendor-1", monthKey: "2026-12" } },
      create: expect.objectContaining({ monthKey: "2026-12" }),
    }));
    expect(mocks.invoiceUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ monthKey: "2026-12" }),
    }));
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "generate_settlement",
      targetId: settlement.id,
    }));
  });
});

describe("refundPaymentTransactionAction", () => {
  it("rejects an invalid settlement month without creating a refund, updating the transaction, or writing an audit log", async () => {
    await expect(refundPaymentTransactionAction(refundFormData("1", "0", "0", "2026-13"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund",
    );

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.refundRecordCreate).not.toHaveBeenCalled();
    expect(mocks.paymentTransactionUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("writes a valid settlement month to the RefundRecord", async () => {
    await expect(refundPaymentTransactionAction(refundFormData("1", "0", "0", "2026-12"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard",
    );

    expect(mocks.refundRecordCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ monthKey: "2026-12" }),
    });
  });

  it("rejects a refund that exceeds the remaining refundable amount without writing records or updating the transaction", async () => {
    await expect(refundPaymentTransactionAction(refundFormData("40.01"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund",
    );

    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: transaction.id } });
    expect(mocks.refundRecordCreate).not.toHaveBeenCalled();
    expect(mocks.paymentTransactionUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("records a refund equal to the remaining refundable amount and marks the transaction refunded", async () => {
    await expect(refundPaymentTransactionAction(refundFormData("40"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard",
    );

    expect(mocks.refundRecordCreate).toHaveBeenCalledWith({
      data: {
        vendorId: transaction.vendorId,
        paymentTransactionId: transaction.id,
        monthKey: "2026-07",
        refundAmountCents: 4_000,
        gatewayFeeRefundCents: 0,
        platformFeeRefundCents: 0,
        reason: null,
      },
    });
    expect(mocks.paymentTransactionUpdate).toHaveBeenCalledWith({
      where: { id: transaction.id },
      data: expect.objectContaining({
        status: "refunded",
        refundedAmountCents: transaction.grossAmountCents,
      }),
    });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it.each([
    ["gateway", "-0.01", "0"],
    ["platform", "0", "-0.01"],
  ])("rejects a refund with a negative %s fee without writing records or updating the transaction", async (_feeType, gatewayFeeRefund, platformFeeRefund) => {
    await expect(refundPaymentTransactionAction(refundFormData("1", gatewayFeeRefund, platformFeeRefund))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund",
    );

    expect(mocks.refundRecordAggregate).not.toHaveBeenCalled();
    expect(mocks.refundRecordCreate).not.toHaveBeenCalled();
    expect(mocks.paymentTransactionUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects a fee refund that exceeds the remaining fee balance without writing records or updating the transaction", async () => {
    mocks.refundRecordAggregate.mockResolvedValue({
      _sum: { gatewayFeeRefundCents: 600, platformFeeRefundCents: 100 },
    });

    await expect(refundPaymentTransactionAction(refundFormData("1", "4.01", "0"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund",
    );

    expect(mocks.refundRecordAggregate).toHaveBeenCalledWith({
      where: { paymentTransactionId: transaction.id, status: "processed" },
      _sum: { gatewayFeeRefundCents: true, platformFeeRefundCents: true },
    });
    expect(mocks.refundRecordCreate).not.toHaveBeenCalled();
    expect(mocks.paymentTransactionUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("records fee refunds that exactly equal the remaining fee balances", async () => {
    mocks.refundRecordAggregate.mockResolvedValue({
      _sum: { gatewayFeeRefundCents: 600, platformFeeRefundCents: 100 },
    });

    await expect(refundPaymentTransactionAction(refundFormData("1", "4", "3"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard",
    );

    expect(mocks.refundRecordCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        gatewayFeeRefundCents: 400,
        platformFeeRefundCents: 300,
      }),
    });
    expect(mocks.paymentTransactionUpdate).toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalled();
  });

  it("rolls back all writes and returns the refund error when PostgreSQL rejects a stale serializable transaction", async () => {
    const attemptedRefundRecords: unknown[] = [];
    const attemptedPaymentTransactions: unknown[] = [];
    const committedRefundRecords: unknown[] = [];
    const committedPaymentTransactions: unknown[] = [];

    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const stagedRefundRecords: unknown[] = [];
      const stagedPaymentTransactions: unknown[] = [];
      await callback({
        paymentTransaction: {
          findUnique: mocks.findUnique,
          update: async (args: unknown) => {
            attemptedPaymentTransactions.push(args);
            stagedPaymentTransactions.push(args);
            return { ...transaction, refundedAmountCents: 10_000, status: "refunded" };
          },
        },
        refundRecord: {
          aggregate: mocks.refundRecordAggregate,
          create: async (args: unknown) => {
            attemptedRefundRecords.push(args);
            stagedRefundRecords.push(args);
          },
        },
      });

      // PostgreSQL detects that the transaction read stale data at commit time.
      const shouldAbortAtCommit = () => true;
      if (shouldAbortAtCommit()) {
        throw Object.assign(new Error("serialization failure"), { code: "P2034" });
      }

      // A successful transaction would commit staged writes here.
      committedRefundRecords.push(...stagedRefundRecords);
      committedPaymentTransactions.push(...stagedPaymentTransactions);
    });

    await expect(refundPaymentTransactionAction(refundFormData("40"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund",
    );

    expect(attemptedRefundRecords).toHaveLength(3);
    expect(attemptedPaymentTransactions).toHaveLength(3);
    expect(committedRefundRecords).toEqual([]);
    expect(committedPaymentTransactions).toEqual([]);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("retries a P2034 serialization conflict and writes an audit log only after the successful commit", async () => {
    const attemptedRefundRecords: unknown[] = [];
    const attemptedPaymentTransactions: unknown[] = [];
    const committedRefundRecords: unknown[] = [];
    const committedPaymentTransactions: unknown[] = [];
    const events: string[] = [];
    let transactionAttempts = 0;

    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionAttempts += 1;
      const stagedRefundRecords: unknown[] = [];
      const stagedPaymentTransactions: unknown[] = [];
      const result = await callback({
        paymentTransaction: {
          findUnique: mocks.findUnique,
          update: async (args: unknown) => {
            attemptedPaymentTransactions.push(args);
            stagedPaymentTransactions.push(args);
            return { ...transaction, refundedAmountCents: 10_000, status: "refunded" };
          },
        },
        refundRecord: {
          aggregate: mocks.refundRecordAggregate,
          create: async (args: unknown) => {
            attemptedRefundRecords.push(args);
            stagedRefundRecords.push(args);
          },
        },
      });

      if (transactionAttempts === 1) {
        throw Object.assign(new Error("serialization failure"), { code: "P2034" });
      }

      committedRefundRecords.push(...stagedRefundRecords);
      committedPaymentTransactions.push(...stagedPaymentTransactions);
      events.push("committed");
      return result;
    });
    mocks.writeAuditLog.mockImplementation(async () => {
      events.push("audit");
    });

    await expect(refundPaymentTransactionAction(refundFormData("40"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard",
    );

    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(attemptedRefundRecords).toHaveLength(2);
    expect(attemptedPaymentTransactions).toHaveLength(2);
    expect(committedRefundRecords).toHaveLength(1);
    expect(committedPaymentTransactions).toHaveLength(1);
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["committed", "audit"]);
  });
});
