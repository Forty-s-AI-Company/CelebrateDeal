import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  calculateSettlement: vi.fn(),
  findUnique: vi.fn(),
  headers: vi.fn(),
  invoiceUpsert: vi.fn(),
  paymentTransactionUpdate: vi.fn(),
  redirect: vi.fn(),
  refundRecordAggregate: vi.fn(),
  refundRecordCreate: vi.fn(),
  requireFinanceAdmin: vi.fn(),
  requireVendorOwner: vi.fn(),
  revalidatePath: vi.fn(),
  sendPasswordResetLink: vi.fn(),
  settlementFindUnique: vi.fn(),
  settlementUpsert: vi.fn(),
  transaction: vi.fn(),
  userCreate: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  vendorFindUnique: vi.fn(),
  vendorMemberFindUnique: vi.fn(),
  vendorMemberUpsert: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/audit", () => ({
  auditSnapshot: (value: unknown) => value,
  writeAuditLog: mocks.writeAuditLog,
}));
vi.mock("@/lib/auth", () => ({
  requireFinanceAdmin: mocks.requireFinanceAdmin,
  requireVendorOwner: mocks.requireVendorOwner,
}));
vi.mock("@/lib/billing", () => ({
  calculateSettlement: mocks.calculateSettlement,
  invoiceNumber: (vendorSlug: string, monthKey: string) => `${vendorSlug}-${monthKey}`,
}));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/password-reset", () => ({ sendPasswordResetLink: mocks.sendPasswordResetLink }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    paymentTransaction: {
      findUnique: mocks.findUnique,
      update: mocks.paymentTransactionUpdate,
    },
    refundRecord: { aggregate: mocks.refundRecordAggregate },
    settlement: { findUnique: mocks.settlementFindUnique },
    $transaction: mocks.transaction,
    user: { create: mocks.userCreate, findUnique: mocks.userFindUnique, update: mocks.userUpdate },
    vendor: { findUnique: mocks.vendorFindUnique },
    vendorMember: { findUnique: mocks.vendorMemberFindUnique, upsert: mocks.vendorMemberUpsert },
  }),
}));

import { createVendorMemberAction, generateSettlementAction, refundPaymentTransactionAction } from "./actions";

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

function vendorMemberFormData({
  name = "王小明",
  email = "member@example.com",
  role = "accountant",
}: {
  name?: string;
  email?: string;
  role?: string;
} = {}) {
  const formData = new FormData();
  formData.set("name", name);
  formData.set("email", email);
  formData.set("role", role);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActionSecurity.mockResolvedValue(undefined);
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "finance-1", role: "finance_admin" } });
  mocks.requireVendorOwner.mockResolvedValue({
    user: { id: "owner-1" },
    member: { role: "owner" },
    vendor: { id: "vendor-1" },
  });
  mocks.headers.mockResolvedValue({
    get: (name: string) => (name === "x-forwarded-for" ? "203.0.113.10, 198.51.100.1" : "CelebrateDeal test"),
  });
  mocks.sendPasswordResetLink.mockResolvedValue({ token: "one-time-reset-token", resetUrl: "https://app.test/password-reset/confirm?token=one-time-reset-token" });
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

describe("createVendorMemberAction", () => {
  it("creates a member and sends a one-time password setup invitation without auditing the token or password", async () => {
    const newUser = { id: "user-2", email: "member@example.com", name: "王小明", status: "active", platformRole: "none" };
    const savedMember = { id: "member-2", userId: newUser.id, role: "accountant", status: "active", user: newUser };
    mocks.userFindUnique.mockResolvedValue(null);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      user: { create: mocks.userCreate, update: mocks.userUpdate },
      vendorMember: { upsert: mocks.vendorMemberUpsert },
    }));
    mocks.userCreate.mockResolvedValue(newUser);
    mocks.userUpdate.mockResolvedValue(newUser);
    mocks.vendorMemberUpsert.mockResolvedValue(savedMember);

    const formData = vendorMemberFormData();
    const suppliedInitialPassword = "initial-password-must-not-be-sent";
    formData.set("password", suppliedInitialPassword);
    await expect(createVendorMemberAction(formData)).rejects.toThrow("redirect:/settings/security?updated=member");

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledWith(formData);
    expect(mocks.requireVendorOwner).toHaveBeenCalledOnce();
    expect(mocks.userCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: newUser.email,
        name: newUser.name,
        passwordHash: expect.any(String),
      }),
    });
    expect(mocks.vendorMemberUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        vendorId: "vendor-1",
        userId: newUser.id,
        role: "accountant",
        status: "active",
      }),
    }));
    expect(mocks.sendPasswordResetLink).toHaveBeenCalledWith({
      email: newUser.email,
      appUrl: "http://localhost:31023",
      ipAddress: "203.0.113.10",
      userAgent: "CelebrateDeal test",
    });

    const generatedPasswordHash = mocks.userCreate.mock.calls[0]?.[0].data.passwordHash;
    const auditEntries = JSON.stringify(mocks.writeAuditLog.mock.calls);
    expect(auditEntries).not.toContain("one-time-reset-token");
    expect(auditEntries).not.toContain(generatedPasswordHash);
    expect(auditEntries).not.toContain("passwordHash");
    expect(auditEntries).not.toContain(suppliedInitialPassword);
    expect(JSON.stringify(mocks.sendPasswordResetLink.mock.calls)).not.toContain(suppliedInitialPassword);
  });

  it("re-enables an inactive membership and sends a new invitation", async () => {
    const existingUser = { id: "user-2", email: "member@example.com", name: "原本姓名", status: "inactive", platformRole: "none" };
    const inactiveMember = {
      id: "member-2",
      userId: existingUser.id,
      role: "accountant",
      status: "inactive",
      user: { ...existingUser, passwordHash: "existing-password-hash" },
    };
    const savedMember = { ...inactiveMember, role: "admin", status: "active", deactivatedAt: null };
    mocks.userFindUnique.mockResolvedValue(existingUser);
    mocks.vendorMemberFindUnique.mockResolvedValue(inactiveMember);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      user: { create: mocks.userCreate, update: mocks.userUpdate },
      vendorMember: { upsert: mocks.vendorMemberUpsert },
    }));
    mocks.userUpdate.mockResolvedValue(existingUser);
    mocks.vendorMemberUpsert.mockResolvedValue(savedMember);

    await expect(createVendorMemberAction(vendorMemberFormData({ role: "admin" }))).rejects.toThrow("redirect:/settings/security?updated=member");

    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.vendorMemberUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ role: "admin", status: "active", deactivatedAt: null }),
    }));
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: existingUser.id },
      data: { name: existingUser.name, status: "active" },
    });
    expect(mocks.sendPasswordResetLink).toHaveBeenCalledWith(expect.objectContaining({ email: existingUser.email }));
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "reactivate_vendor_member" }));
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain("existing-password-hash");
  });

  it("keeps the membership update but reports an invitation delivery failure without auditing secrets", async () => {
    const newUser = { id: "user-2", email: "member@example.com", name: "王小明", status: "active", platformRole: "none" };
    const savedMember = { id: "member-2", userId: newUser.id, role: "accountant", status: "active", user: newUser };
    mocks.userFindUnique.mockResolvedValue(null);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      user: { create: mocks.userCreate, update: mocks.userUpdate },
      vendorMember: { upsert: mocks.vendorMemberUpsert },
    }));
    mocks.userCreate.mockResolvedValue(newUser);
    mocks.userUpdate.mockResolvedValue(newUser);
    mocks.vendorMemberUpsert.mockResolvedValue(savedMember);
    mocks.sendPasswordResetLink.mockRejectedValueOnce(new Error("email delivery failed"));

    await expect(createVendorMemberAction(vendorMemberFormData())).rejects.toThrow(
      "redirect:/settings/security?error=member_invitation",
    );

    expect(mocks.writeAuditLog).toHaveBeenLastCalledWith(expect.objectContaining({
      action: "vendor_member_invitation_email_failed",
      after: { email: newUser.email, role: "accountant", status: "active" },
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/security");
    const auditEntries = JSON.stringify(mocks.writeAuditLog.mock.calls);
    expect(auditEntries).not.toContain("one-time-reset-token");
    expect(auditEntries).not.toContain("passwordHash");
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
