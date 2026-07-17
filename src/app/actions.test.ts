import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  findUnique: vi.fn(),
  paymentTransactionUpdate: vi.fn(),
  redirect: vi.fn(),
  refundRecordAggregate: vi.fn(),
  refundRecordCreate: vi.fn(),
  requireFinanceAdmin: vi.fn(),
  revalidatePath: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/audit", () => ({
  auditSnapshot: (value: unknown) => value,
  writeAuditLog: mocks.writeAuditLog,
}));
vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    paymentTransaction: {
      findUnique: mocks.findUnique,
      update: mocks.paymentTransactionUpdate,
    },
    refundRecord: { aggregate: mocks.refundRecordAggregate },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      paymentTransaction: { update: mocks.paymentTransactionUpdate },
      refundRecord: { create: mocks.refundRecordCreate },
    }),
  }),
}));

import { refundPaymentTransactionAction } from "./actions";

const transaction = {
  id: "payment-1",
  vendorId: "vendor-1",
  grossAmountCents: 10_000,
  refundedAmountCents: 6_000,
  gatewayFeeCents: 1_000,
  platformFeeCents: 400,
};

function refundFormData(refundAmount: string, gatewayFeeRefund = "0", platformFeeRefund = "0") {
  const formData = new FormData();
  formData.set("id", transaction.id);
  formData.set("refundAmount", refundAmount);
  formData.set("gatewayFeeRefund", gatewayFeeRefund);
  formData.set("platformFeeRefund", platformFeeRefund);
  formData.set("monthKey", "2026-07");
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
  mocks.paymentTransactionUpdate.mockResolvedValue({ ...transaction, refundedAmountCents: 10_000, status: "refunded" });
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
});

describe("refundPaymentTransactionAction", () => {
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
});
