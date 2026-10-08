import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { reconcilePayUniRefund } from "@/lib/payuni-refund-reconciliation";
import { payUniPaymentProvider } from "@/lib/payment-providers/payuni";

const db = new PrismaClient();
const suffix = crypto.randomBytes(8).toString("hex");
const vendorId = `g756_vendor_${suffix}`;

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

/** Real adapter, encrypted synthetic transport, and real disposable database. */
async function observeCreditRefund(transaction: Parameters<NonNullable<typeof payUniPaymentProvider.queryPayment>>[0]["transaction"], refundStatus: string) {
  const key = "12345678901234567890123456789012";
  const iv = "1234567890123456";
  vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("PAYUNI_SANDBOX_MERCHANT_ID", "TESTMER");
  vi.stubEnv("PAYUNI_SANDBOX_HASH_KEY", key);
  vi.stubEnv("PAYUNI_SANDBOX_HASH_IV", iv);
  const plaintext = new URLSearchParams({ Status: "SUCCESS", Result: JSON.stringify({
    MerTradeNo: transaction.orderNumber, TradeNo: transaction.providerTradeNo, TradeAmt: "100",
    TradeStatus: "1", PaymentType: "1", DataSource: "A", RefundStatus: refundStatus,
    RefundAmt: "20", RemainAmt: "40",
  }) }).toString();
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(iv));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("base64");
  const envelope = Buffer.from(`${encrypted}:::${cipher.getAuthTag().toString("base64")}`).toString("hex");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new URLSearchParams({ EncryptInfo: envelope,
    HashInfo: crypto.createHash("sha256").update(`${key}${envelope}${iv}`).digest("hex").toUpperCase() }).toString())));
  return payUniPaymentProvider.queryPayment!({ transaction });
}

async function partialReservation(tag: string) {
  const transaction = await db.paymentTransaction.create({ data: {
    id: `contract_tx_${tag}_${suffix}`, vendorId, providerName: "payuni", providerTradeNo: `contract-trade-${tag}-${suffix}`,
    orderNumber: `CQ-${tag}-${suffix}`, grossAmountCents: 10_000, netAmountCents: 10_000,
    refundedAmountCents: 4_000, status: "partially_refunded",
  } });
  await db.refundRecord.createMany({ data: [
    { id: `contract_processed_${tag}_${suffix}`, vendorId, paymentTransactionId: transaction.id,
      providerEventId: `verified-${tag}-${suffix}`, monthKey: "2026-10", refundAmountCents: 4_000, status: "processed" },
    { id: `contract_pending_${tag}_${suffix}`, vendorId, paymentTransactionId: transaction.id,
      providerEventId: `ambiguous:${"d".repeat(32)}`, monthKey: "2026-10", refundAmountCents: 2_000, status: "pending" },
  ] });
  return transaction;
}

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
  it.each(["1", "8"])("does not process a reserved refund from CREDIT pending status %s", async (status) => {
    const transaction = await partialReservation(status);
    await expect(observeCreditRefund(transaction, status).then(providerSnapshot => reconcilePayUniRefund({
      db, transactionId: transaction.id, providerSnapshot, actor: { id: "synthetic-finance", label: "platform_admin" },
    }))).rejects.toMatchObject({ category: "provider_response" });
    await expect(db.refundRecord.count({ where: { paymentTransactionId: transaction.id, status: "pending" } })).resolves.toBe(1);
    await expect(db.paymentTransaction.findUnique({ where: { id: transaction.id } })).resolves.toMatchObject({
      status: "partially_refunded", refundedAmountCents: 4_000 });
    await expect(db.auditLog.count({ where: { targetId: transaction.id } })).resolves.toBe(0);
  });
  it("reconciles only the reserved delta from cumulative balance and remains idempotent", async () => {
    const transaction = await partialReservation("2");
    const providerSnapshot = await observeCreditRefund(transaction, "2");
    expect(providerSnapshot.refundedAmountCents).toBe(6_000);
    const input = { db, transactionId: transaction.id, providerSnapshot,
      actor: { id: "synthetic-finance", label: "platform_admin" } };
    await expect(reconcilePayUniRefund(input)).resolves.toMatchObject({ disposition: "reconciled", processedRefundRecordCount: 1 });
    await expect(reconcilePayUniRefund(input)).resolves.toMatchObject({ disposition: "already_reconciled", processedRefundRecordCount: 0 });
    await expect(db.paymentTransaction.findUnique({ where: { id: transaction.id } })).resolves.toMatchObject({
      status: "partially_refunded", refundedAmountCents: 6_000 });
    await expect(db.refundRecord.count({ where: { paymentTransactionId: transaction.id, status: "processed" } })).resolves.toBe(2);
    await expect(db.refundRecord.count({ where: { paymentTransactionId: transaction.id, status: "pending" } })).resolves.toBe(0);
    await expect(db.auditLog.count({ where: { targetId: transaction.id, action: "reconcile_payuni_refund" } })).resolves.toBe(1);
  });
  it("keeps an ambiguous reservation locked when a cumulative provider snapshot still says paid", async () => {
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
    })).rejects.toMatchObject({ reason: "local_state_ambiguous" });

    await expect(db.refundRecord.findUnique({ where: { id: refundId } })).resolves.toMatchObject({ status: "pending" });
    await expect(db.paymentTransaction.findUnique({ where: { id: transactionId } })).resolves.toMatchObject({ status: "paid", refundedAmountCents: 0 });
    await expect(db.auditLog.count({ where: { vendorId, targetId: transactionId, action: "resolve_payuni_refund_not_processed" } })).resolves.toBe(0);
  });

  it("preserves processed partial totals and the ambiguous remaining reservation", async () => {
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
    })).rejects.toMatchObject({ reason: "local_state_ambiguous" });

    await expect(db.refundRecord.findUnique({ where: { id: processedId } })).resolves.toMatchObject({ status: "processed" });
    await expect(db.refundRecord.findUnique({ where: { id: pendingId } })).resolves.toMatchObject({ status: "pending" });
    await expect(db.refundRecord.count({ where: { paymentTransactionId: transactionId, status: "pending" } })).resolves.toBe(1);
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
