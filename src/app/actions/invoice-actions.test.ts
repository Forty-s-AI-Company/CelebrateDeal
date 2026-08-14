import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireVendorFinance: vi.fn(),
  writeAuditLog: vi.fn(),
  getPaymentProvider: vi.fn(),
  getCanonicalAppUrl: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
  transaction: vi.fn(),
  invoiceFindFirst: vi.fn(),
  paymentTransactionFindUnique: vi.fn(),
  paymentTransactionCreate: vi.fn(),
  paymentTransactionUpdate: vi.fn(),
  paymentTransactionUpdateMany: vi.fn(),
  checkoutReadiness: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/auth", () => ({ requireVendorFinance: mocks.requireVendorFinance }));
vi.mock("@/lib/audit", () => ({
  auditSnapshot: (value: unknown) => value,
  writeAuditLog: mocks.writeAuditLog,
}));
vi.mock("@/lib/payment-providers", () => ({ getPaymentProvider: mocks.getPaymentProvider }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: mocks.getCanonicalAppUrl }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    $transaction: mocks.transaction,
    paymentTransaction: {
      update: mocks.paymentTransactionUpdate,
      updateMany: mocks.paymentTransactionUpdateMany,
    },
  }),
}));

import { payInvoiceAction } from "@/app/actions/invoice-actions";

const invoice = {
  id: "invoice-current",
  vendorId: "vendor-current",
  invoiceNumber: "INV-2026-07-001",
  totalCents: 14385,
  status: "issued",
};

const createdTransaction = {
  id: "transaction-invoice-checkout",
  vendorId: "vendor-current",
  providerName: "payuni",
  orderNumber: "CD-20260808010101-ABC123",
  paymentMode: "platform",
  grossAmountCents: invoice.totalCents,
  netAmountCents: invoice.totalCents,
  currency: "TWD",
  status: "pending",
};

function formData() {
  const data = new FormData();
  data.set("_csrf", "valid-token");
  data.set("invoiceId", invoice.id);
  data.set("totalCents", "1");
  data.set("vendorId", "vendor-attacker");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActionSecurity.mockResolvedValue(undefined);
  mocks.requireVendorFinance.mockResolvedValue({
    vendor: { id: "vendor-current", name: "測試商家" },
    member: { id: "member-finance", role: "finance" },
  });
  mocks.invoiceFindFirst.mockResolvedValue(invoice);
  mocks.paymentTransactionFindUnique.mockResolvedValue(null);
  mocks.paymentTransactionCreate.mockResolvedValue(createdTransaction);
  mocks.paymentTransactionUpdate.mockResolvedValue(createdTransaction);
  mocks.paymentTransactionUpdateMany.mockResolvedValue({ count: 1 });
  mocks.getCanonicalAppUrl.mockReturnValue("http://localhost:31023");
  mocks.checkoutReadiness.mockReturnValue("ready");
  mocks.getPaymentProvider.mockReturnValue({
    id: "payuni",
    checkoutReadiness: mocks.checkoutReadiness,
    createCheckoutSession: vi.fn().mockResolvedValue({
      provider: "payuni",
      mode: "form_post",
      checkoutUrl: null,
      formAction: "https://sandbox-api.payuni.com.tw/api/upp",
      formMethod: "POST",
      formPayload: { MerchantID: "synthetic", TradeInfo: "synthetic" },
      nextAction: "submit_provider_form",
      externalRequired: true,
    }),
  });
  mocks.transaction.mockImplementation(async (callback) => callback({
    invoice: { findFirst: mocks.invoiceFindFirst },
    paymentTransaction: {
      findUnique: mocks.paymentTransactionFindUnique,
      create: mocks.paymentTransactionCreate,
      update: mocks.paymentTransactionUpdate,
    },
  }));
});

describe("payInvoiceAction", () => {
  it("uses the server invoice total, stores a checkout snapshot, and redirects to the scoped detail page", async () => {
    await expect(payInvoiceAction(formData())).rejects.toThrow(
      "redirect:/billing/invoices/invoice-current?status=checkout&transactionId=transaction-invoice-checkout",
    );

    expect(mocks.paymentTransactionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: "vendor-current",
        providerName: "payuni",
        paymentMode: "platform",
        grossAmountCents: invoice.totalCents,
        netAmountCents: invoice.totalCents,
        status: "pending",
        checkoutIdempotencyKey: "invoice-payment:v1:vendor-current:invoice-current",
      }),
    });
    expect(mocks.paymentTransactionCreate.mock.calls[0]?.[0].data).not.toHaveProperty("totalCents", 1);
    expect(mocks.paymentTransactionUpdate).toHaveBeenCalledWith({
      where: { id: createdTransaction.id },
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          billingPurpose: "invoice_payment",
          invoiceId: invoice.id,
          invoiceTotalCents: invoice.totalCents,
          checkoutSession: expect.objectContaining({ provider: "payuni", mode: "form_post" }),
        }),
      }),
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "start_invoice_payment_checkout",
      targetId: invoice.id,
      after: expect.objectContaining({ transactionId: createdTransaction.id, provider: "payuni" }),
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/billing/invoices/invoice-current");
  });

  it("reuses a matching pending checkout without creating or calling the provider again", async () => {
    const existing = {
      ...createdTransaction,
      id: "transaction-existing",
      metadata: {
        billingPurpose: "invoice_payment",
        invoiceId: invoice.id,
        invoiceTotalCents: invoice.totalCents,
        checkoutSession: {
          provider: "payuni",
          mode: "form_post",
          formAction: "https://sandbox-api.payuni.com.tw/api/upp",
          nextAction: "submit_provider_form",
        },
      },
    };
    mocks.paymentTransactionFindUnique.mockResolvedValue(existing);
    mocks.getPaymentProvider.mockImplementation(() => {
      throw new Error("provider temporarily unavailable");
    });

    await expect(payInvoiceAction(formData())).rejects.toThrow(
      "redirect:/billing/invoices/invoice-current?status=checkout&transactionId=transaction-existing",
    );

    expect(mocks.paymentTransactionCreate).not.toHaveBeenCalled();
    expect(mocks.getPaymentProvider).not.toHaveBeenCalled();
  });

  it("does not create a payment transaction for a paid invoice", async () => {
    mocks.invoiceFindFirst.mockResolvedValue({ ...invoice, status: "paid" });

    await expect(payInvoiceAction(formData())).rejects.toThrow(
      "redirect:/billing/invoices/invoice-current?status=paid",
    );
    expect(mocks.paymentTransactionCreate).not.toHaveBeenCalled();
  });

  it("does not create a payment transaction when the provider cannot start checkout", async () => {
    mocks.checkoutReadiness.mockReturnValueOnce("unavailable");

    await expect(payInvoiceAction(formData())).rejects.toThrow(
      "redirect:/billing/invoices/invoice-current?error=checkout",
    );

    expect(mocks.paymentTransactionCreate).not.toHaveBeenCalled();
    expect(mocks.paymentTransactionUpdate).not.toHaveBeenCalled();
  });

  it("does not call the provider again while another request is writing the checkout snapshot", async () => {
    mocks.paymentTransactionFindUnique.mockResolvedValue({
      ...createdTransaction,
      id: "transaction-in-progress",
      metadata: {
        billingPurpose: "invoice_payment",
        invoiceId: invoice.id,
        invoiceTotalCents: invoice.totalCents,
      },
    });

    await expect(payInvoiceAction(formData())).rejects.toThrow(
      "redirect:/billing/invoices/invoice-current?error=checkout_in_progress",
    );

    expect(mocks.paymentTransactionCreate).not.toHaveBeenCalled();
    expect(mocks.getPaymentProvider).not.toHaveBeenCalled();
  });

  it("marks the transaction failed when checkout snapshot persistence fails", async () => {
    mocks.paymentTransactionUpdate.mockRejectedValueOnce(new Error("snapshot write failed"));

    await expect(payInvoiceAction(formData())).rejects.toThrow(
      "redirect:/billing/invoices/invoice-current?error=checkout",
    );

    expect(mocks.paymentTransactionUpdateMany).toHaveBeenCalledWith({
      where: { id: createdTransaction.id, status: "pending" },
      data: { status: "failed", checkoutIdempotencyKey: null },
    });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("bounds serialization conflicts and redirects to a safe invoice conflict state", async () => {
    mocks.transaction.mockRejectedValue({ code: "P2034" });

    await expect(payInvoiceAction(formData())).rejects.toThrow(
      "redirect:/billing/invoices/invoice-current?error=conflict",
    );

    expect(mocks.transaction).toHaveBeenCalledTimes(3);
    expect(mocks.paymentTransactionCreate).not.toHaveBeenCalled();
  });
});
