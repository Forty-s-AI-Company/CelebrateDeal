import { describe, expect, it, vi } from "vitest";
import {
  PayUniRefundReconciliationError,
  reconcilePayUniRefund,
  validatePayUniRefundSnapshot,
} from "@/lib/payuni-refund-reconciliation";
import type { PaymentQueryResult } from "@/lib/payment-providers/types";

const snapshot: PaymentQueryResult = {
  providerTradeNo: "trade-1",
  orderNumber: "CD-RECON-001",
  grossAmountCents: 168_000,
  refundedAmountCents: 168_000,
  remainingRefundableAmountCents: 0,
  status: "refunded",
};

const requestReservationId = `request:${"a".repeat(32)}`;

function fakeDb(initial: {
  transaction?: Record<string, unknown>;
  refunds?: Array<Record<string, unknown>>;
} = {}) {
  const transaction = initial.transaction ?? {
    id: "tx-1",
    vendorId: "vendor-1",
    providerName: "payuni",
    providerTradeNo: "trade-1",
    orderNumber: "CD-RECON-001",
    grossAmountCents: 168_000,
    refundedAmountCents: 84_000,
    status: "partially_refunded",
    refundReason: null,
    refundedAt: null,
  };
  const refunds = initial.refunds ?? [
    { id: "refund-processed", refundAmountCents: 84_000, status: "processed", providerEventId: "close-1" },
    { id: "refund-pending", refundAmountCents: 84_000, status: "pending", providerEventId: requestReservationId },
  ];
  const auditLogs: Array<Record<string, unknown>> = [];
  const tx = {
    paymentTransaction: {
      findUnique: vi.fn(async () => transaction),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(transaction, data)),
    },
    refundRecord: {
      findMany: vi.fn(async () => refunds.filter((refund) => refund.status === "pending")),
      aggregate: vi.fn(async () => ({
        _sum: {
          refundAmountCents: refunds
            .filter((refund) => refund.status === "pending" || refund.status === "processed")
            .reduce((sum, refund) => sum + Number(refund.refundAmountCents), 0),
        },
      })),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const refund = refunds.find((candidate) => candidate.id === where.id);
        if (refund) Object.assign(refund, data);
        return refund;
      }),
    },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { auditLogs.push(data); }) },
  };
  const db = { ...tx, $transaction: vi.fn(async <T>(callback: (value: typeof tx) => Promise<T>) => callback(tx)) };
  return { db, tx, transaction, refunds, auditLogs };
}

describe("PayUni refund reconciliation", () => {
  it("requires a matching terminal provider snapshot", () => {
    expect(() => validatePayUniRefundSnapshot(
      { providerName: "payuni", providerTradeNo: "trade-1", orderNumber: "CD-RECON-001", grossAmountCents: 168_000 },
      snapshot,
    )).not.toThrow();
    expect(() => validatePayUniRefundSnapshot(
      { providerName: "payuni", providerTradeNo: "other", orderNumber: "CD-RECON-001", grossAmountCents: 168_000 },
      snapshot,
    )).toThrowError(PayUniRefundReconciliationError);
    expect(() => validatePayUniRefundSnapshot(
      { providerName: "payuni", providerTradeNo: "trade-1", orderNumber: "CD-RECON-001", grossAmountCents: 168_000 },
      { ...snapshot, status: "partially_refunded", refundedAmountCents: 84_000, remainingRefundableAmountCents: 84_000 },
    )).not.toThrow();
  });

  it("processes the pending reservation and writes one audit inside the transaction", async () => {
    const { db, tx, refunds, transaction, auditLogs } = fakeDb();
    const result = await reconcilePayUniRefund({
      db: db as never,
      transactionId: "tx-1",
      providerSnapshot: snapshot,
      actor: { id: "admin-1", label: "platform_admin" },
      now: new Date("2026-08-02T00:00:00.000Z"),
    });

    expect(result).toEqual({ disposition: "reconciled", transactionId: "tx-1", processedRefundRecordCount: 1, refundedAmountCents: 168_000 });
    expect(refunds[1]?.status).toBe("processed");
    expect(refunds[1]?.providerEventId).toMatch(/^reconcile:payuni:[a-f0-9]{64}$/);
    expect(transaction.status).toBe("refunded");
    expect(transaction.refundedAmountCents).toBe(168_000);
    expect(tx.refundRecord.update).toHaveBeenCalledOnce();
    expect(tx.paymentTransaction.update).toHaveBeenCalledOnce();
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]?.action).toBe("reconcile_payuni_refund");
  });

  it("is idempotent after the local terminal state is already complete", async () => {
    const { db, tx, auditLogs } = fakeDb({
      transaction: {
        id: "tx-1", vendorId: "vendor-1", providerName: "payuni", providerTradeNo: "trade-1", orderNumber: "CD-RECON-001",
        grossAmountCents: 168_000, refundedAmountCents: 168_000, status: "refunded", refundReason: null, refundedAt: new Date(),
      },
      refunds: [{ id: "refund-processed", refundAmountCents: 168_000, status: "processed", providerEventId: "close-1" }],
    });

    await expect(reconcilePayUniRefund({
      db: db as never,
      transactionId: "tx-1",
      providerSnapshot: snapshot,
      actor: { id: "admin-1", label: "platform_admin" },
    })).resolves.toMatchObject({ disposition: "already_reconciled" });
    expect(tx.refundRecord.update).not.toHaveBeenCalled();
    expect(tx.paymentTransaction.update).not.toHaveBeenCalled();
    expect(auditLogs).toHaveLength(0);
  });

  it("fails closed when provider and local reservation totals disagree", async () => {
    const { db, tx } = fakeDb({
      refunds: [{ id: "refund-pending", refundAmountCents: 42_000, status: "pending", providerEventId: requestReservationId }],
    });

    await expect(reconcilePayUniRefund({
      db: db as never,
      transactionId: "tx-1",
      providerSnapshot: snapshot,
      actor: { id: "admin-1", label: "platform_admin" },
    })).rejects.toThrowError(PayUniRefundReconciliationError);
    expect(tx.refundRecord.update).not.toHaveBeenCalled();
    expect(tx.paymentTransaction.update).not.toHaveBeenCalled();
  });

  it.each([
    ["unpaid", { status: "failed" }],
    ["already partially processed with a terminal flag", { status: "refunded", refundedAmountCents: 84_000 }],
  ])("rejects local %s state without writes", async (_label, transactionPatch) => {
    const { db, tx, transaction, refunds, auditLogs } = fakeDb({ transaction: { ...fakeDb().transaction, ...transactionPatch } });
    await expect(reconcilePayUniRefund({
      db: db as never,
      transactionId: "tx-1",
      providerSnapshot: snapshot,
      actor: { id: "admin-1", label: "platform_admin" },
    })).rejects.toThrowError(PayUniRefundReconciliationError);
    expect(tx.refundRecord.update).not.toHaveBeenCalled();
    expect(tx.paymentTransaction.update).not.toHaveBeenCalled();
    expect(auditLogs).toHaveLength(0);
    expect(transaction.status).toBe(transactionPatch.status);
    expect(refunds[1]?.status).toBe("pending");
  });

  it("rejects multiple pending reservations and non-request identities", async () => {
    const multiple = fakeDb({
      refunds: [
        { id: "refund-pending-a", refundAmountCents: 42_000, status: "pending", providerEventId: requestReservationId },
        { id: "refund-pending-b", refundAmountCents: 42_000, status: "pending", providerEventId: requestReservationId },
      ],
    });
    await expect(reconcilePayUniRefund({
      db: multiple.db as never,
      transactionId: "tx-1",
      providerSnapshot: snapshot,
      actor: { id: "admin-1", label: "platform_admin" },
    })).rejects.toThrowError(PayUniRefundReconciliationError);
    expect(multiple.tx.refundRecord.update).not.toHaveBeenCalled();

    const nonRequest = fakeDb({ refunds: [{ id: "refund-pending", refundAmountCents: 84_000, status: "pending", providerEventId: "close-1" }] });
    await expect(reconcilePayUniRefund({
      db: nonRequest.db as never,
      transactionId: "tx-1",
      providerSnapshot: snapshot,
      actor: { id: "admin-1", label: "platform_admin" },
    })).rejects.toThrowError(PayUniRefundReconciliationError);
    expect(nonRequest.tx.refundRecord.update).not.toHaveBeenCalled();
  });
});

describe("FIN-01 refund reconciliation boundary coverage", () => {
  it("classifies a missing transaction without entering a write path", async () => {
    const { db, tx } = fakeDb();
    tx.paymentTransaction.findUnique.mockResolvedValueOnce(null as never);

    await expect(reconcilePayUniRefund({
      db: db as never,
      transactionId: "missing-transaction",
      providerSnapshot: snapshot,
      actor: { id: "admin-1", label: "platform_admin" },
    })).rejects.toMatchObject({ reason: "transaction_not_found" });
    expect(tx.refundRecord.update).not.toHaveBeenCalled();
    expect(tx.paymentTransaction.update).not.toHaveBeenCalled();
  });

  it("rejects a non-PayUni transaction before querying local reservations", async () => {
    const { db, tx } = fakeDb({
      transaction: { ...fakeDb().transaction, providerName: "demo" },
    });

    await expect(reconcilePayUniRefund({
      db: db as never,
      transactionId: "tx-1",
      providerSnapshot: snapshot,
      actor: { id: "admin-1", label: "platform_admin" },
    })).rejects.toMatchObject({ reason: "provider_mismatch" });
    expect(tx.refundRecord.findMany).not.toHaveBeenCalled();
    expect(tx.refundRecord.update).not.toHaveBeenCalled();
  });

  it("rejects a provider order reference mismatch without mutating local state", async () => {
    const { db, tx } = fakeDb();

    await expect(reconcilePayUniRefund({
      db: db as never,
      transactionId: "tx-1",
      providerSnapshot: { ...snapshot, orderNumber: "forged-order" },
      actor: { id: "admin-1", label: "platform_admin" },
    })).rejects.toMatchObject({ reason: "provider_ref_mismatch" });
    expect(tx.refundRecord.update).not.toHaveBeenCalled();
    expect(tx.paymentTransaction.update).not.toHaveBeenCalled();
  });

  it("rejects a pending reservation with an invalid request identity", async () => {
    const { db, tx } = fakeDb({
      refunds: [{ id: "refund-pending", refundAmountCents: 84_000, status: "pending", providerEventId: "request:short" }],
    });

    await expect(reconcilePayUniRefund({
      db: db as never,
      transactionId: "tx-1",
      providerSnapshot: snapshot,
      actor: { id: "admin-1", label: "platform_admin" },
    })).rejects.toMatchObject({ reason: "local_state_ambiguous" });
    expect(tx.refundRecord.update).not.toHaveBeenCalled();
  });
});

describe("FIN-07 refund reconciliation closure", () => {
  it("accepts a verified partial provider snapshot and reconciles one pending reservation", async () => {
    const partialSnapshot: PaymentQueryResult = {
      ...snapshot,
      status: "partially_refunded",
      refundedAmountCents: 84_000,
      remainingRefundableAmountCents: 84_000,
    };
    const { db, tx, transaction, refunds } = fakeDb({
      transaction: { ...fakeDb().transaction, status: "paid", refundedAmountCents: 0 },
      refunds: [{ id: "refund-pending", refundAmountCents: 84_000, status: "pending", providerEventId: requestReservationId }],
    });

    expect(() => validatePayUniRefundSnapshot(transaction as never, partialSnapshot)).not.toThrow();
    await expect(reconcilePayUniRefund({
      db: db as never,
      transactionId: "tx-1",
      providerSnapshot: partialSnapshot,
      actor: { id: "admin-1", label: "platform_admin" },
      now: new Date("2026-08-02T00:00:00.000Z"),
    })).resolves.toEqual({
      disposition: "reconciled",
      transactionId: "tx-1",
      processedRefundRecordCount: 1,
      refundedAmountCents: 84_000,
    });
    expect(refunds[0]?.status).toBe("processed");
    expect(tx.refundRecord.update).toHaveBeenCalledOnce();
    expect(tx.paymentTransaction.update).toHaveBeenCalledOnce();
  });

  it("does not treat a terminal transaction with an incomplete processed ledger as already reconciled", async () => {
    const { db, tx } = fakeDb({
      transaction: { ...fakeDb().transaction, status: "refunded", refundedAmountCents: 168_000 },
      refunds: [{ id: "refund-processed", refundAmountCents: 84_000, status: "processed", providerEventId: "close-1" }],
    });

    await expect(reconcilePayUniRefund({
      db: db as never,
      transactionId: "tx-1",
      providerSnapshot: snapshot,
      actor: { id: "admin-1", label: "platform_admin" },
    })).rejects.toMatchObject({ reason: "local_amount_mismatch" });
    expect(tx.refundRecord.update).not.toHaveBeenCalled();
    expect(tx.paymentTransaction.update).not.toHaveBeenCalled();
  });

  it("is idempotent after a partial reconciliation with matching processed totals", async () => {
    const partialSnapshot: PaymentQueryResult = {
      ...snapshot,
      status: "partially_refunded",
      refundedAmountCents: 84_000,
      remainingRefundableAmountCents: 84_000,
    };
    const { db, tx, auditLogs } = fakeDb({
      transaction: { ...fakeDb().transaction, status: "partially_refunded", refundedAmountCents: 84_000 },
      refunds: [{ id: "refund-processed", refundAmountCents: 84_000, status: "processed", providerEventId: "close-1" }],
    });

    await expect(reconcilePayUniRefund({
      db: db as never,
      transactionId: "tx-1",
      providerSnapshot: partialSnapshot,
      actor: { id: "admin-1", label: "platform_admin" },
    })).resolves.toMatchObject({ disposition: "already_reconciled", refundedAmountCents: 84_000 });
    expect(tx.refundRecord.update).not.toHaveBeenCalled();
    expect(tx.paymentTransaction.update).not.toHaveBeenCalled();
    expect(auditLogs).toHaveLength(0);
  });
});
