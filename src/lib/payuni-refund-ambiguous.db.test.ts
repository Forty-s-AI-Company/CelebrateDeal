import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reconcilePayUniRefund } from "@/lib/payuni-refund-reconciliation";

const db = new PrismaClient();
const suffix = crypto.randomBytes(8).toString("hex");
const vendorId = `g756_vendor_${suffix}`;

beforeAll(async () => {
  await db.vendor.create({
    data: {
      id: vendorId,
      name: "G7-56 synthetic vendor",
      slug: `g7-56-${suffix}`,
      email: `g7-56-${suffix}@example.test`,
      passwordHash: "synthetic",
    },
  });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { vendorId } });
  await db.vendor.delete({ where: { id: vendorId } });
  await db.$disconnect();
});

describe("PayUni ambiguous refund disposable PostgreSQL", () => {
  it("releases a paid transaction reservation only after a verified no-refund snapshot", async () => {
    const transactionId = `g756_tx_paid_${suffix}`;
    const refundId = `g756_refund_paid_${suffix}`;
    await db.paymentTransaction.create({
      data: {
        id: transactionId,
        vendorId,
        providerName: "payuni",
        providerTradeNo: `g756-trade-paid-${suffix}`,
        orderNumber: `G756-PAID-${suffix}`,
        grossAmountCents: 10_000,
        netAmountCents: 10_000,
        status: "paid",
      },
    });
    await db.refundRecord.create({
      data: {
        id: refundId,
        vendorId,
        paymentTransactionId: transactionId,
        providerEventId: `ambiguous:${"a".repeat(32)}`,
        monthKey: "2026-08",
        refundAmountCents: 4_000,
        status: "pending",
      },
    });

    await expect(reconcilePayUniRefund({
      db,
      transactionId,
      providerSnapshot: {
        providerTradeNo: `g756-trade-paid-${suffix}`,
        orderNumber: `G756-PAID-${suffix}`,
        grossAmountCents: 10_000,
        refundedAmountCents: 0,
        remainingRefundableAmountCents: 10_000,
        status: "paid",
      },
      actor: { id: "g7-56-finance", label: "platform_admin" },
    })).resolves.toMatchObject({ disposition: "provider_not_refunded", refundedAmountCents: 0 });

    await expect(db.refundRecord.findUnique({ where: { id: refundId } })).resolves.toMatchObject({ status: "failed" });
    await expect(db.paymentTransaction.findUnique({ where: { id: transactionId } })).resolves.toMatchObject({ status: "paid", refundedAmountCents: 0 });
    await expect(db.auditLog.count({ where: { vendorId, targetId: transactionId, action: "resolve_payuni_refund_not_processed" } })).resolves.toBe(1);
  });

  it("preserves processed partial totals while releasing only the unconfirmed reservation", async () => {
    const transactionId = `g756_tx_partial_${suffix}`;
    const processedId = `g756_refund_processed_${suffix}`;
    const pendingId = `g756_refund_pending_${suffix}`;
    await db.paymentTransaction.create({
      data: {
        id: transactionId,
        vendorId,
        providerName: "payuni",
        providerTradeNo: `g756-trade-partial-${suffix}`,
        orderNumber: `G756-PARTIAL-${suffix}`,
        grossAmountCents: 10_000,
        netAmountCents: 10_000,
        refundedAmountCents: 4_000,
        status: "partially_refunded",
      },
    });
    await db.refundRecord.createMany({
      data: [
        {
          id: processedId,
          vendorId,
          paymentTransactionId: transactionId,
          providerEventId: "verified-partial-refund",
          monthKey: "2026-08",
          refundAmountCents: 4_000,
          status: "processed",
        },
        {
          id: pendingId,
          vendorId,
          paymentTransactionId: transactionId,
          providerEventId: `ambiguous:${"b".repeat(32)}`,
          monthKey: "2026-08",
          refundAmountCents: 2_000,
          status: "pending",
        },
      ],
    });

    await expect(reconcilePayUniRefund({
      db,
      transactionId,
      providerSnapshot: {
        providerTradeNo: `g756-trade-partial-${suffix}`,
        orderNumber: `G756-PARTIAL-${suffix}`,
        grossAmountCents: 10_000,
        refundedAmountCents: 4_000,
        remainingRefundableAmountCents: 6_000,
        status: "partially_refunded",
      },
      actor: { id: "g7-56-finance", label: "platform_admin" },
    })).resolves.toMatchObject({ disposition: "provider_not_refunded", refundedAmountCents: 4_000 });

    await expect(db.refundRecord.findUnique({ where: { id: processedId } })).resolves.toMatchObject({ status: "processed" });
    await expect(db.refundRecord.findUnique({ where: { id: pendingId } })).resolves.toMatchObject({ status: "failed" });
    await expect(db.refundRecord.count({ where: { paymentTransactionId: transactionId, status: "pending" } })).resolves.toBe(0);
    await expect(db.paymentTransaction.findUnique({ where: { id: transactionId } })).resolves.toMatchObject({ status: "partially_refunded", refundedAmountCents: 4_000 });
  });

  it("keeps an in-flight request reservation locked on a no-refund provider snapshot", async () => {
    const transactionId = `g756_tx_inflight_${suffix}`;
    const refundId = `g756_refund_inflight_${suffix}`;
    await db.paymentTransaction.create({
      data: {
        id: transactionId,
        vendorId,
        providerName: "payuni",
        providerTradeNo: `g756-trade-inflight-${suffix}`,
        orderNumber: `G756-INFLIGHT-${suffix}`,
        grossAmountCents: 10_000,
        netAmountCents: 10_000,
        status: "paid",
      },
    });
    await db.refundRecord.create({
      data: {
        id: refundId,
        vendorId,
        paymentTransactionId: transactionId,
        providerEventId: `request:${"c".repeat(32)}`,
        monthKey: "2026-08",
        refundAmountCents: 4_000,
        status: "pending",
      },
    });

    await expect(reconcilePayUniRefund({
      db,
      transactionId,
      providerSnapshot: {
        providerTradeNo: `g756-trade-inflight-${suffix}`,
        orderNumber: `G756-INFLIGHT-${suffix}`,
        grossAmountCents: 10_000,
        refundedAmountCents: 0,
        remainingRefundableAmountCents: 10_000,
        status: "paid",
      },
      actor: { id: "g7-56-finance", label: "platform_admin" },
    })).rejects.toMatchObject({ reason: "local_state_ambiguous" });

    await expect(db.refundRecord.findUnique({ where: { id: refundId } })).resolves.toMatchObject({
      status: "pending",
      providerEventId: `request:${"c".repeat(32)}`,
    });
    await expect(db.auditLog.count({ where: { vendorId, targetId: transactionId, action: "resolve_payuni_refund_not_processed" } })).resolves.toBe(0);
  });
});
