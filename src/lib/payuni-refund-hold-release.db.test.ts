import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import type { PaymentQueryResult } from "@/lib/payment-providers/types";
import { generatePaymentOrderNumber } from "@/lib/payment-order-number";
import { PayUniRefundHoldError, recordPayUniRefundHoldCheck } from "@/lib/payuni-refund-hold-release";

const db = getDb();
const vendorIds: string[] = [];
const HOUR = 60 * 60 * 1000;
const policy = { requiredConfirmations: 3, windowMs: 24 * HOUR, minIntervalMs: 6 * HOUR };
const actor = { id: "synthetic-finance-admin", label: "platform_admin" };
const reservedAt = new Date("2026-10-20T00:00:00.000Z");
const afterWindow = new Date("2026-10-21T01:00:00.000Z");
const at = (iso: string) => new Date(iso);

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
  it("counts spaced confirmations after the window and releases only by explicit action", async () => {
    const { vendor, transaction, refund, snapshot } = await heldRefund();
    const check = (release: boolean, now: Date) => recordPayUniRefundHoldCheck({
      db, transactionId: transaction.id, refundRecordId: refund.id, providerSnapshot: snapshot, actor, release, now, policy,
    });

    // Before the 24-hour window nothing counts, even a release attempt.
    await expect(check(false, at("2026-10-20T01:00:00.000Z"))).resolves.toMatchObject({ counted: false, confirmations: 0 });
    await expect(check(true, at("2026-10-20T23:59:00.000Z"))).resolves.toMatchObject({ disposition: "no_refund_confirmed", counted: false, confirmations: 0, releasable: false });
    await expect(check(false, at("2026-10-21T00:00:00.000Z"))).resolves.toMatchObject({
      counted: true, confirmations: 1, nextCountableAt: at("2026-10-21T06:00:00.000Z"),
    });
    // Within the 6-hour interval the query is audited but not counted.
    await expect(check(true, at("2026-10-21T05:59:00.000Z"))).resolves.toMatchObject({ counted: false, confirmations: 1, releasable: false });
    await expect(check(false, at("2026-10-21T06:00:00.000Z"))).resolves.toMatchObject({ counted: true, confirmations: 2 });
    await expect(db.refundRecord.findUniqueOrThrow({ where: { id: refund.id } })).resolves.toMatchObject({ status: "pending", holdReleasedAt: null });

    const releasedAt = at("2026-10-21T12:00:00.000Z");
    await expect(check(true, releasedAt)).resolves.toMatchObject({ disposition: "released", counted: true, confirmations: 3 });
    const released = await db.refundRecord.findUniqueOrThrow({ where: { id: refund.id } });
    expect(released).toMatchObject({
      status: "failed",
      holdReleasedAt: releasedAt,
      providerNoRefundCheckCount: 3,
      providerNoRefundFirstCheckedAt: at("2026-10-21T00:00:00.000Z"),
      providerNoRefundLastCheckedAt: releasedAt,
    });
    // The released reservation no longer blocks a new refund reservation.
    expect(await db.refundRecord.count({ where: { paymentTransactionId: transaction.id, status: "pending" } })).toBe(0);
    await expect(db.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } })).resolves.toMatchObject({ status: "paid", refundedAmountCents: 0 });

    const audits = await db.auditLog.findMany({ where: { vendorId: vendor.id, targetId: refund.id }, orderBy: { createdAt: "asc" } });
    expect(audits.map((row) => row.action)).toEqual([
      ...Array.from({ length: 5 }, () => "confirm_payuni_refund_no_refund"),
      "release_payuni_refund_hold",
    ]);
    expect(audits.map((row) => (row.after as { counted?: boolean }).counted)).toEqual([false, false, true, false, true, true]);
    expect(audits.every((row) => row.actorId === actor.id)).toBe(true);
  });

  it("never releases after three clicks within one minute (review M-1)", async () => {
    const { transaction, refund, snapshot } = await heldRefund();
    const base = { db, transactionId: transaction.id, refundRecordId: refund.id, providerSnapshot: snapshot, actor, policy };
    // Well past the window: two "reconcile" clicks and a release, all within a minute.
    await recordPayUniRefundHoldCheck({ ...base, release: false, now: at("2026-10-22T00:00:00.000Z") });
    await recordPayUniRefundHoldCheck({ ...base, release: false, now: at("2026-10-22T00:00:20.000Z") });
    await expect(recordPayUniRefundHoldCheck({ ...base, release: true, now: at("2026-10-22T00:00:40.000Z") }))
      .resolves.toMatchObject({ disposition: "no_refund_confirmed", confirmations: 1, releasable: false });
    await expect(db.refundRecord.findUniqueOrThrow({ where: { id: refund.id } })).resolves.toMatchObject({ status: "pending", providerNoRefundCheckCount: 1 });

    // Early confirmations right after the ambiguous refund do not carry over either.
    const early = await heldRefund();
    const earlyBase = { db, transactionId: early.transaction.id, refundRecordId: early.refund.id, providerSnapshot: early.snapshot, actor, policy };
    await recordPayUniRefundHoldCheck({ ...earlyBase, release: false, now: at("2026-10-20T00:01:00.000Z") });
    await recordPayUniRefundHoldCheck({ ...earlyBase, release: false, now: at("2026-10-20T00:02:00.000Z") });
    await expect(recordPayUniRefundHoldCheck({ ...earlyBase, release: true, now: at("2026-10-21T00:00:00.000Z") }))
      .resolves.toMatchObject({ disposition: "no_refund_confirmed", confirmations: 1, releasable: false });
  });

  it("does not release with fewer confirmations than required", async () => {
    const { transaction, refund, snapshot } = await heldRefund();
    await recordPayUniRefundHoldCheck({ db, transactionId: transaction.id, providerSnapshot: snapshot, actor, release: false, now: afterWindow, policy });
    await expect(recordPayUniRefundHoldCheck({
      db, transactionId: transaction.id, refundRecordId: refund.id, providerSnapshot: snapshot, actor, release: true,
      now: new Date(afterWindow.getTime() + 6 * HOUR), policy,
    })).resolves.toMatchObject({ disposition: "no_refund_confirmed", confirmations: 2, releasable: false });
    await expect(db.refundRecord.findUniqueOrThrow({ where: { id: refund.id } })).resolves.toMatchObject({ status: "pending" });
  });

  it("resets the streak when PayUni shows refund activity and never releases", async () => {
    const { transaction, refund, snapshot } = await heldRefund({ refundedAmountCents: 200 });
    for (let index = 0; index < 2; index += 1) {
      await recordPayUniRefundHoldCheck({
        db, transactionId: transaction.id, providerSnapshot: snapshot, actor, release: false, now: new Date(afterWindow.getTime() + index * 6 * HOUR), policy,
      });
    }
    await expect(db.refundRecord.findUniqueOrThrow({ where: { id: refund.id } })).resolves.toMatchObject({ providerNoRefundCheckCount: 2 });
    const refunded: PaymentQueryResult = { ...snapshot, refundedAmountCents: 500, remainingRefundableAmountCents: 500 };
    await expect(recordPayUniRefundHoldCheck({
      db, transactionId: transaction.id, refundRecordId: refund.id, providerSnapshot: refunded, actor, release: true,
      now: new Date(afterWindow.getTime() + 12 * HOUR), policy,
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
