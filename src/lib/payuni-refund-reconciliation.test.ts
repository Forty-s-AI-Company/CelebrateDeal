import { describe, expect, it, vi } from "vitest";

const accountingMocks = vi.hoisted(() => ({
  applyPaymentRefundAccounting: vi.fn(async () => ({
    affiliateCommission: null,
    courseRefundAllocations: [],
    commerceOrderRefund: null,
  })),
}));
const projectionMocks = vi.hoisted(() => ({ applyPlatformRefundProjection: vi.fn(async () => ({ subscription: null, invoice: null })) }));

vi.mock("@/lib/payment-refund-accounting", () => ({
  applyPaymentRefundAccounting: accountingMocks.applyPaymentRefundAccounting,
  calculateNetReferenceAmountCents: ({
    netAmountCents,
    refundedAmountCents,
    gatewayFeeRefundCents,
    platformFeeRefundCents,
  }: Record<string, number>) => Math.max(
    0,
    netAmountCents - refundedAmountCents + gatewayFeeRefundCents + platformFeeRefundCents,
  ),
}));
vi.mock("@/lib/platform-refund-projection", () => ({
  applyPlatformRefundProjection: projectionMocks.applyPlatformRefundProjection,
}));
import {
  PayUniRefundReconciliationError,
  type RefundReconciliationDiagnostics,
  reconcilePayUniRefund,
  validatePayUniRefundSnapshot,
} from "@/lib/payuni-refund-reconciliation";
import type { PaymentQueryResult } from "@/lib/payment-providers/types";
import { Prisma } from "@prisma/client";

const snapshot: PaymentQueryResult = {
  providerTradeNo: "trade-1",
  orderNumber: "CD-RECON-001",
  grossAmountCents: 168_000,
  refundedAmountCents: 168_000,
  remainingRefundableAmountCents: 0,
  status: "refunded",
};

const paidSnapshot: PaymentQueryResult = {
  ...snapshot,
  refundedAmountCents: 0,
  remainingRefundableAmountCents: 168_000,
  status: "paid",
};

const requestReservationId = `request:${"a".repeat(32)}`;
const ambiguousReservationId = `ambiguous:${"a".repeat(32)}`;

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
  it("records a fixed start-stage bucket for a P2028 without replacing the error", async () => {
    const diagnostics: RefundReconciliationDiagnostics = { stage: "TRANSACTION_START" };
    const error = new Prisma.PrismaClientKnownRequestError("synthetic-secret", { code: "P2028", clientVersion: "test" });
    const db = { $transaction: vi.fn().mockRejectedValue(error) };

    await expect(reconcilePayUniRefund({
      db: db as never,
      transactionId: "tx-1",
      providerSnapshot: snapshot,
      actor: { id: "admin-1", label: "platform_admin" },
      diagnostics,
    })).rejects.toBe(error);
    expect(diagnostics.transactionFailure).toMatchObject({ stage: "TRANSACTION_START", elapsedBucket: "LT_5S" });
  });

  it.each([
    [4_999, "LT_5S"], [5_000, "FROM_5S_TO_15S"], [14_999, "FROM_5S_TO_15S"], [15_000, "GE_15S"],
  ] as const)("uses fixed elapsed bucket at %sms", async (elapsed, elapsedBucket) => {
    const clock = vi.spyOn(performance, "now").mockReturnValueOnce(10_000).mockReturnValueOnce(10_000 + elapsed);
    const diagnostics: RefundReconciliationDiagnostics = { stage: "TRANSACTION_START" };
    const error = new Prisma.PrismaClientKnownRequestError("synthetic-secret", { code: "P2028", clientVersion: "test" });
    try {
      await expect(reconcilePayUniRefund({
        db: { $transaction: vi.fn().mockRejectedValue(error) } as never,
        transactionId: "tx-1", providerSnapshot: snapshot, actor: { id: "admin-1", label: "test" }, diagnostics,
      })).rejects.toBe(error);
      expect(diagnostics.transactionFailure).toEqual({ stage: "TRANSACTION_START", elapsedBucket });
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps a mid-stage PAYMENT_ACCOUNTING P2028 and original error", async () => {
    const { db } = fakeDb();
    const error = new Prisma.PrismaClientKnownRequestError("synthetic-secret", { code: "P2028", clientVersion: "test" });
    accountingMocks.applyPaymentRefundAccounting.mockRejectedValueOnce(error);
    const diagnostics: RefundReconciliationDiagnostics = { stage: "TRANSACTION_START" };

    await expect(reconcilePayUniRefund({
      db: db as never, transactionId: "tx-1", providerSnapshot: snapshot,
      actor: { id: "admin-1", label: "test" }, diagnostics,
    })).rejects.toBe(error);
    expect(diagnostics.transactionFailure).toMatchObject({ stage: "PAYMENT_ACCOUNTING" });
  });

  it("marks COMMIT as the last attempted stage when the transaction rejects", async () => {
    const { db } = fakeDb();
    const error = new Prisma.PrismaClientKnownRequestError("synthetic-secret", { code: "P2028", clientVersion: "test" });
    const originalTransaction = db.$transaction;
    db.$transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      await originalTransaction(callback);
      throw error;
    }) as typeof db.$transaction;
    const diagnostics: RefundReconciliationDiagnostics = { stage: "TRANSACTION_START" };

    await expect(reconcilePayUniRefund({
      db: db as never, transactionId: "tx-1", providerSnapshot: snapshot,
      actor: { id: "admin-1", label: "test" }, diagnostics,
    })).rejects.toBe(error);
    expect(diagnostics.transactionFailure).toMatchObject({ stage: "COMMIT" });
  });

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
    expect(() => validatePayUniRefundSnapshot(
      { providerName: "payuni", providerTradeNo: "trade-1", orderNumber: "CD-RECON-001", grossAmountCents: 168_000 },
      paidSnapshot,
    )).not.toThrow();
  });

  it("releases one ambiguous pending reservation when PayUni proves no refund occurred", async () => {
    accountingMocks.applyPaymentRefundAccounting.mockClear();
    const { db, tx, refunds, transaction, auditLogs } = fakeDb({
      transaction: { ...fakeDb().transaction, status: "paid", refundedAmountCents: 0 },
      refunds: [{ id: "refund-pending", refundAmountCents: 84_000, status: "pending", providerEventId: ambiguousReservationId }],
    });

    await expect(reconcilePayUniRefund({
      db: db as never,
      transactionId: "tx-1",
      providerSnapshot: paidSnapshot,
      actor: { id: "admin-1", label: "platform_admin" },
      now: new Date("2026-08-02T00:00:00.000Z"),
    })).resolves.toEqual({
      disposition: "provider_not_refunded",
      transactionId: "tx-1",
      processedRefundRecordCount: 0,
      refundedAmountCents: 0,
    });
    expect(refunds[0]?.status).toBe("failed");
    expect(transaction.status).toBe("paid");
    expect(tx.paymentTransaction.update).not.toHaveBeenCalled();
    expect(accountingMocks.applyPaymentRefundAccounting).not.toHaveBeenCalled();
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]?.action).toBe("resolve_payuni_refund_not_processed");
  });

  it("keeps an in-flight request reservation locked when PayUni currently reports no refund", async () => {
    accountingMocks.applyPaymentRefundAccounting.mockClear();
    const { db, tx, refunds, auditLogs } = fakeDb({
      transaction: { ...fakeDb().transaction, status: "paid", refundedAmountCents: 0 },
      refunds: [{ id: "refund-in-flight", refundAmountCents: 84_000, status: "pending", providerEventId: requestReservationId }],
    });

    await expect(reconcilePayUniRefund({
      db: db as never,
      transactionId: "tx-1",
      providerSnapshot: paidSnapshot,
      actor: { id: "admin-2", label: "platform_admin" },
    })).rejects.toMatchObject({ reason: "local_state_ambiguous" });

    expect(refunds[0]?.status).toBe("pending");
    expect(tx.refundRecord.update).not.toHaveBeenCalled();
    expect(tx.paymentTransaction.update).not.toHaveBeenCalled();
    expect(accountingMocks.applyPaymentRefundAccounting).not.toHaveBeenCalled();
    expect(auditLogs).toHaveLength(0);
  });

  it("processes the pending reservation and writes one audit inside the transaction", async () => {
    accountingMocks.applyPaymentRefundAccounting.mockClear();
    projectionMocks.applyPlatformRefundProjection.mockClear();
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
    expect(projectionMocks.applyPlatformRefundProjection).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ status: "refunded", refundedAmountCents: 168_000 }),
      expect.any(Date),
    );
    expect(accountingMocks.applyPaymentRefundAccounting).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        transactionId: "tx-1",
        refundRecordId: "refund-pending",
        refundAmountCents: 84_000,
        isFullRefund: true,
      }),
    );
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]?.action).toBe("reconcile_payuni_refund");
  });

  it("is idempotent after the local terminal state is already complete", async () => {
    projectionMocks.applyPlatformRefundProjection.mockClear();
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
    expect(projectionMocks.applyPlatformRefundProjection).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ status: "refunded", refundedAmountCents: 168_000 }),
      expect.any(Date),
    );
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
  it("keeps consecutive partial refunds on one PayUni trade independently idempotent", async () => {
    accountingMocks.applyPaymentRefundAccounting.mockClear();
    const firstRequestId = `request:${"b".repeat(32)}`;
    const secondRequestId = `request:${"c".repeat(32)}`;
    const { db, refunds } = fakeDb({
      transaction: { ...fakeDb().transaction, status: "paid", refundedAmountCents: 0 },
      refunds: [{ id: "refund-first", refundAmountCents: 84_000, status: "pending", providerEventId: firstRequestId }],
    });
    const partialSnapshot: PaymentQueryResult = {
      ...snapshot,
      status: "partially_refunded",
      refundedAmountCents: 84_000,
      remainingRefundableAmountCents: 84_000,
    };

    await reconcilePayUniRefund({
      db: db as never,
      transactionId: "tx-1",
      providerSnapshot: partialSnapshot,
      actor: { id: "admin-1", label: "platform_admin" },
      now: new Date("2026-08-02T00:00:00.000Z"),
    });
    refunds.push({ id: "refund-second", refundAmountCents: 84_000, status: "pending", providerEventId: secondRequestId });
    await reconcilePayUniRefund({
      db: db as never,
      transactionId: "tx-1",
      providerSnapshot: snapshot,
      actor: { id: "admin-1", label: "platform_admin" },
      now: new Date("2026-08-03T00:00:00.000Z"),
    });

    const accountingCalls = accountingMocks.applyPaymentRefundAccounting.mock.calls as unknown as Array<
      [unknown, { eventIdentity: string }]
    >;
    const eventIdentities = accountingCalls.map(([, input]) => input.eventIdentity);
    expect(eventIdentities).toHaveLength(2);
    expect(eventIdentities[0]).toMatch(/^reconcile:payuni:[a-f0-9]{64}$/);
    expect(eventIdentities[1]).toMatch(/^reconcile:payuni:[a-f0-9]{64}$/);
    expect(eventIdentities[0]).not.toBe(eventIdentities[1]);
    expect(refunds).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "refund-first", status: "processed" }),
      expect.objectContaining({ id: "refund-second", status: "processed" }),
    ]));
  });

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
    projectionMocks.applyPlatformRefundProjection.mockClear();

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
    expect(projectionMocks.applyPlatformRefundProjection).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ status: "partially_refunded", refundedAmountCents: 84_000 }),
      expect.any(Date),
    );
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
    projectionMocks.applyPlatformRefundProjection.mockClear();
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
    expect(projectionMocks.applyPlatformRefundProjection).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ status: "partially_refunded", refundedAmountCents: 84_000 }),
      expect.any(Date),
    );
    expect(auditLogs).toHaveLength(0);
  });
});
