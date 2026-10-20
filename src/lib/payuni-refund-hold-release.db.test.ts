import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import type { PaymentQueryResult } from "@/lib/payment-providers/types";
import { generatePaymentOrderNumber } from "@/lib/payment-order-number";
import { PayUniRefundHoldError, recordPayUniRefundHoldCheck } from "@/lib/payuni-refund-hold-release";

const db = getDb();
const vendorIds: string[] = [];
const policy = { requiredConfirmations: 3, windowMs: 24 * 60 * 60 * 1000 };
const actor = { id: "synthetic-finance-admin", label: "platform_admin" };
const reservedAt = new Date("2026-10-20T00:00:00.000Z");
const afterWindow = new Date("2026-10-21T01:00:00.000Z");

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

async function heldRefund(input: { refundedAmountCents?: number } = {}) {
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Hold release", slug: `hold-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendorIds.push(vendor.id);
  const refundedAmountCents = input.refundedAmountCents ?? 0;
  const transaction = await db.paymentTransaction.create({
    data: {
      vendorId: vendor.id,
      providerName: "payuni",
      providerTradeNo: `trade-${suffix}`,
      orderNumber: generatePaymentOrderNumber(),
      grossAmountCents: 1_000,
      netAmountCents: 1_000,
      refundedAmountCents,
      status: refundedAmountCents > 0 ? "partially_refunded" : "paid",
    },
  });
  if (refundedAmountCents > 0) {
    await db.refundRecord.create({ data: { vendorId: vendor.id, paymentTransactionId: transaction.id, monthKey: "2026-10", refundAmountCents: refundedAmountCents, status: "processed", providerEventId: "close-1" } });
  }
  const refund = await db.refundRecord.create({
    data: {
      vendorId: vendor.id,
      paymentTransactionId: transaction.id,
      monthKey: "2026-10",
      refundAmountCents: 300,
      status: "pending",
      providerEventId: `ambiguous:${randomBytes(16).toString("hex")}`,
      createdAt: reservedAt,
    },
  });
  const snapshot: PaymentQueryResult = {
    providerTradeNo: transaction.providerTradeNo!,
    orderNumber: transaction.orderNumber!,
    grossAmountCents: 1_000,
    refundedAmountCents,
    remainingRefundableAmountCents: 1_000 - refundedAmountCents,
    status: refundedAmountCents > 0 ? "partially_refunded" : "paid",
  };
  return { vendor, transaction, refund, snapshot };
}

describe("PayUni refund hold release (F-046)", () => {
  it("counts consecutive no-refund confirmations and releases only by explicit action after the window", async () => {
    const { vendor, transaction, refund, snapshot } = await heldRefund();
    const check = (release: boolean, now: Date) => recordPayUniRefundHoldCheck({
      db, transactionId: transaction.id, refundRecordId: refund.id, providerSnapshot: snapshot, actor, release, now, policy,
    });

    await expect(check(false, new Date("2026-10-20T01:00:00.000Z"))).resolves.toMatchObject({ disposition: "no_refund_confirmed", confirmations: 1, releasable: false });
    // Two confirmations plus the release query reach three, but the window is not over yet.
    await expect(check(false, new Date("2026-10-20T02:00:00.000Z"))).resolves.toMatchObject({ confirmations: 2 });
    await expect(check(true, new Date("2026-10-20T03:00:00.000Z"))).resolves.toMatchObject({ disposition: "no_refund_confirmed", confirmations: 3, releasable: false });
    await expect(db.refundRecord.findUniqueOrThrow({ where: { id: refund.id } })).resolves.toMatchObject({ status: "pending", holdReleasedAt: null });

    await expect(check(true, afterWindow)).resolves.toMatchObject({ disposition: "released", confirmations: 4 });
    const released = await db.refundRecord.findUniqueOrThrow({ where: { id: refund.id } });
    expect(released).toMatchObject({
      status: "failed",
      holdReleasedAt: afterWindow,
      providerNoRefundCheckCount: 4,
      providerNoRefundFirstCheckedAt: new Date("2026-10-20T01:00:00.000Z"),
      providerNoRefundLastCheckedAt: afterWindow,
    });
    // The released reservation no longer blocks a new refund reservation.
    expect(await db.refundRecord.count({ where: { paymentTransactionId: transaction.id, status: "pending" } })).toBe(0);
    await expect(db.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } })).resolves.toMatchObject({ status: "paid", refundedAmountCents: 0 });

    const audits = await db.auditLog.findMany({ where: { vendorId: vendor.id, targetId: refund.id }, orderBy: { createdAt: "asc" } });
    expect(audits.map((row) => row.action)).toEqual([
      "confirm_payuni_refund_no_refund",
      "confirm_payuni_refund_no_refund",
      "confirm_payuni_refund_no_refund",
      "release_payuni_refund_hold",
    ]);
    expect(audits.every((row) => row.actorId === actor.id)).toBe(true);
  });

  it("does not release with fewer confirmations than required even after the window", async () => {
    const { transaction, refund, snapshot } = await heldRefund();
    await recordPayUniRefundHoldCheck({ db, transactionId: transaction.id, providerSnapshot: snapshot, actor, release: false, now: afterWindow, policy });
    await expect(recordPayUniRefundHoldCheck({
      db, transactionId: transaction.id, refundRecordId: refund.id, providerSnapshot: snapshot, actor, release: true, now: afterWindow, policy,
    })).resolves.toMatchObject({ disposition: "no_refund_confirmed", confirmations: 2, releasable: false });
    await expect(db.refundRecord.findUniqueOrThrow({ where: { id: refund.id } })).resolves.toMatchObject({ status: "pending" });
  });

  it("resets the streak when PayUni shows refund activity and never releases", async () => {
    const { transaction, refund, snapshot } = await heldRefund({ refundedAmountCents: 200 });
    for (let index = 0; index < 3; index += 1) {
      await recordPayUniRefundHoldCheck({ db, transactionId: transaction.id, providerSnapshot: snapshot, actor, release: false, now: afterWindow, policy });
    }
    const refunded: PaymentQueryResult = { ...snapshot, refundedAmountCents: 500, remainingRefundableAmountCents: 500 };
    await expect(recordPayUniRefundHoldCheck({
      db, transactionId: transaction.id, refundRecordId: refund.id, providerSnapshot: refunded, actor, release: true, now: afterWindow, policy,
    })).rejects.toMatchObject({ reason: "provider_reports_refund_activity" });
    await expect(db.refundRecord.findUniqueOrThrow({ where: { id: refund.id } })).resolves.toMatchObject({
      status: "pending", providerNoRefundCheckCount: 0, providerNoRefundFirstCheckedAt: null, providerNoRefundLastCheckedAt: null, holdReleasedAt: null,
    });
  });

  it("refuses a release aimed at another reservation or a mismatched provider trade", async () => {
    const { transaction, refund, snapshot } = await heldRefund();
    await expect(recordPayUniRefundHoldCheck({
      db, transactionId: transaction.id, refundRecordId: "other-refund", providerSnapshot: snapshot, actor, release: true, now: afterWindow, policy,
    })).rejects.toBeInstanceOf(PayUniRefundHoldError);
    await expect(recordPayUniRefundHoldCheck({
      db, transactionId: transaction.id, refundRecordId: refund.id, providerSnapshot: { ...snapshot, providerTradeNo: "someone-else" }, actor, release: true, now: afterWindow, policy,
    })).rejects.toMatchObject({ reason: "provider_ref_mismatch" });
    await expect(db.refundRecord.findUniqueOrThrow({ where: { id: refund.id } })).resolves.toMatchObject({ status: "pending", providerNoRefundCheckCount: 0 });
  });

  it("enforces the hold bookkeeping CHECK constraints in the database", async () => {
    const { refund } = await heldRefund();
    await expect(db.refundRecord.update({ where: { id: refund.id }, data: { holdReleasedAt: afterWindow } })).rejects.toThrow();
    await expect(db.refundRecord.update({ where: { id: refund.id }, data: { providerNoRefundCheckCount: 1 } })).rejects.toThrow();
  });
});
