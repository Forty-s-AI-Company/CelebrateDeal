import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refundPayment: vi.fn(async () => ({ providerEventId: "same-provider-trade" })),
  applyPaymentRefundAccounting: vi.fn(async (database: unknown, input: { eventIdentity: string }) => {
    void database;
    void input;
    return {};
  }),
}));

vi.mock("@/lib/payment-providers", () => ({
  getPaymentProvider: () => ({ refundPayment: mocks.refundPayment }),
}));
vi.mock("@/lib/payment-refund-accounting", () => ({
  applyPaymentRefundAccounting: mocks.applyPaymentRefundAccounting,
  calculateNetReferenceAmountCents: () => 0,
}));

import { executePayUniRefund } from "@/lib/payuni-refund-execution";

const db = new PrismaClient();
const suffix = randomBytes(8).toString("hex");
const vendorId = `refund_identity_vendor_${suffix}`;
const transactionId = `refund_identity_tx_${suffix}`;

beforeAll(async () => {
  await db.vendor.create({
    data: {
      id: vendorId,
      name: "Synthetic refund identity vendor",
      slug: `refund-identity-${suffix}`,
      email: `refund-identity-${suffix}@example.test`,
      passwordHash: "synthetic",
    },
  });
  await db.paymentTransaction.create({
    data: {
      id: transactionId,
      vendorId,
      providerName: "payuni",
      providerTradeNo: `synthetic-trade-${suffix}`,
      orderNumber: `synthetic-order-${suffix}`,
      grossAmountCents: 10_000,
      netAmountCents: 10_000,
      status: "paid",
    },
  });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { vendorId } });
  await db.refundRecord.deleteMany({ where: { paymentTransactionId: transactionId } });
  await db.paymentTransaction.delete({ where: { id: transactionId } });
  await db.vendor.delete({ where: { id: vendorId } });
  await db.$disconnect();
});

describe("PayUni refund accounting identity on disposable PostgreSQL", () => {
  it("uses distinct local reservation identities for two refunds with the same provider ID", async () => {
    mocks.refundPayment.mockClear();
    mocks.applyPaymentRefundAccounting.mockClear();
    const base = {
      db,
      transactionId,
      gatewayFeeRefundCents: 0,
      platformFeeRefundCents: 0,
      reason: "synthetic",
      monthKey: "2026-09",
      actor: { id: "synthetic-actor", label: "synthetic" },
    };

    const first = await executePayUniRefund({ ...base, refundAmountCents: 2_000 });
    const second = await executePayUniRefund({ ...base, refundAmountCents: 3_000 });

    expect(first.disposition).toBe("completed");
    expect(second.disposition).toBe("completed");
    expect(mocks.refundPayment).toHaveBeenCalledTimes(2);
    const identities = mocks.applyPaymentRefundAccounting.mock.calls.map(([, input]) => input.eventIdentity);
    expect(identities).toHaveLength(2);
    expect(new Set(identities).size).toBe(2);
    expect(identities.every((identity) => identity.startsWith("refund:payuni:"))).toBe(true);
    expect(await db.refundRecord.count({ where: { paymentTransactionId: transactionId, status: "processed", providerEventId: "same-provider-trade" } })).toBe(2);
    await expect(db.paymentTransaction.findUnique({ where: { id: transactionId } })).resolves.toMatchObject({
      status: "partially_refunded",
      refundedAmountCents: 5_000,
    });
  });
});
