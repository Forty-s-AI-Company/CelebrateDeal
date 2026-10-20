import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import {
  approveSettlementAdjustment,
  financeSecondApprovalThresholdCents,
  rejectSettlementAdjustment,
  submitSettlementAdjustment,
} from "@/lib/settlement-adjustment";

const db = getDb();
const vendorIds: string[] = [];
const threshold = 5_000_000;
const requester = { id: "synthetic-admin-a", label: "platform_admin" };
const approver = { id: "synthetic-admin-b", label: "platform_admin" };

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

async function settlement(payoutableAmountCents = 1_000_000) {
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Adjustment", slug: `adjustment-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendorIds.push(vendor.id);
  return db.settlement.create({
    data: { vendorId: vendor.id, monthKey: "2026-09", payoutableAmountCents, finalPayoutAmountCents: payoutableAmountCents },
  });
}

describe("settlement adjustment second approval (F-049)", () => {
  it("defaults the threshold to NT$50,000 and accepts only integer overrides", () => {
    expect(financeSecondApprovalThresholdCents({})).toBe(5_000_000);
    expect(financeSecondApprovalThresholdCents({ FINANCE_SECOND_APPROVAL_THRESHOLD_CENTS: "100000" })).toBe(100_000);
    expect(financeSecondApprovalThresholdCents({ FINANCE_SECOND_APPROVAL_THRESHOLD_CENTS: "5e6" })).toBe(5_000_000);
    expect(financeSecondApprovalThresholdCents({ FINANCE_SECOND_APPROVAL_THRESHOLD_CENTS: "-1" })).toBe(5_000_000);
  });

  it("applies an adjustment at the threshold immediately with an audit row", async () => {
    const row = await settlement();
    await expect(submitSettlementAdjustment(db, { settlementId: row.id, amountCents: threshold, reason: "補發活動獎勵", actor: requester, thresholdCents: threshold }))
      .resolves.toMatchObject({ outcome: "applied", settlement: { adjustmentAmountCents: threshold, finalPayoutAmountCents: 6_000_000, adjustmentReason: "補發活動獎勵" } });
    const audit = await db.auditLog.findFirstOrThrow({ where: { vendorId: row.vendorId, targetId: row.id } });
    expect(audit).toMatchObject({ action: "update_settlement_adjustment", actorId: requester.id });
  });

  it("holds a larger adjustment until a different admin approves it", async () => {
    const row = await settlement(10_000_000);
    await expect(submitSettlementAdjustment(db, { settlementId: row.id, amountCents: -(row.payoutableAmountCents + 100), reason: "超額追回", actor: requester, thresholdCents: threshold }))
      .rejects.toMatchObject({ code: "negative_payout" });
    const submitted = await submitSettlementAdjustment(db, { settlementId: row.id, amountCents: -(threshold + 100), reason: "退款追回", actor: requester, thresholdCents: threshold });
    expect(submitted.outcome).toBe("pending_approval");
    if (submitted.outcome !== "pending_approval") throw new Error("expected a pending request");
    await expect(db.settlement.findUniqueOrThrow({ where: { id: row.id } })).resolves.toMatchObject({ adjustmentAmountCents: 0, finalPayoutAmountCents: 10_000_000 });

    await expect(approveSettlementAdjustment(db, { requestId: submitted.request.id, actor: requester })).rejects.toMatchObject({ code: "same_approver" });
    // A regenerated settlement can shrink before approval: the payable would go negative, so approval fails closed.
    await db.settlement.update({ where: { id: row.id }, data: { payoutableAmountCents: 1_000_000, finalPayoutAmountCents: 1_000_000 } });
    await expect(approveSettlementAdjustment(db, { requestId: submitted.request.id, actor: approver })).rejects.toMatchObject({ code: "negative_payout" });
    await expect(db.settlementAdjustmentRequest.findUniqueOrThrow({ where: { id: submitted.request.id } })).resolves.toMatchObject({ status: "pending" });
  });

  it("approves a pending request by a second admin and records both people", async () => {
    const row = await settlement(10_000_000);
    const submitted = await submitSettlementAdjustment(db, { settlementId: row.id, amountCents: 6_000_000, reason: "年度保證金退還", actor: requester, thresholdCents: threshold });
    if (submitted.outcome !== "pending_approval") throw new Error("expected a pending request");

    const approved = await approveSettlementAdjustment(db, { requestId: submitted.request.id, actor: approver });
    expect(approved.settlement).toMatchObject({ adjustmentAmountCents: 6_000_000, finalPayoutAmountCents: 16_000_000, reviewedBy: approver.id, adjustmentReason: "年度保證金退還" });
    await expect(db.settlementAdjustmentRequest.findUniqueOrThrow({ where: { id: submitted.request.id } }))
      .resolves.toMatchObject({ status: "approved", requestedBy: requester.id, reviewedBy: approver.id });
    await expect(approveSettlementAdjustment(db, { requestId: submitted.request.id, actor: approver })).rejects.toMatchObject({ code: "not_pending" });
    const actions = (await db.auditLog.findMany({ where: { vendorId: row.vendorId, targetId: row.id }, orderBy: { createdAt: "asc" } })).map((entry) => entry.action);
    expect(actions).toEqual(["request_settlement_adjustment", "approve_settlement_adjustment"]);
  });

  it("supersedes, rejects and refuses locked settlements", async () => {
    const row = await settlement(10_000_000);
    const first = await submitSettlementAdjustment(db, { settlementId: row.id, amountCents: 7_000_000, reason: "first", actor: requester, thresholdCents: threshold });
    const second = await submitSettlementAdjustment(db, { settlementId: row.id, amountCents: 8_000_000, reason: "second", actor: requester, thresholdCents: threshold });
    if (first.outcome !== "pending_approval" || second.outcome !== "pending_approval") throw new Error("expected pending requests");
    await expect(db.settlementAdjustmentRequest.findUniqueOrThrow({ where: { id: first.request.id } })).resolves.toMatchObject({ status: "superseded", reviewedBy: requester.id });

    await rejectSettlementAdjustment(db, { requestId: second.request.id, actor: requester });
    await expect(db.settlementAdjustmentRequest.findUniqueOrThrow({ where: { id: second.request.id } })).resolves.toMatchObject({ status: "rejected" });

    const third = await submitSettlementAdjustment(db, { settlementId: row.id, amountCents: 9_000_000, reason: "third", actor: requester, thresholdCents: threshold });
    if (third.outcome !== "pending_approval") throw new Error("expected a pending request");
    await db.settlement.update({ where: { id: row.id }, data: { lockedAt: new Date(), status: "locked" } });
    await expect(approveSettlementAdjustment(db, { requestId: third.request.id, actor: approver })).rejects.toMatchObject({ code: "locked" });
    await expect(submitSettlementAdjustment(db, { settlementId: row.id, amountCents: 1, reason: "late", actor: requester, thresholdCents: threshold }))
      .rejects.toMatchObject({ code: "locked" });
  });

  it("enforces one pending request, a reason and the second approver in the database", async () => {
    const row = await settlement();
    const base = { vendorId: row.vendorId, settlementId: row.id, amountCents: 6_000_000, requestedBy: requester.id };
    const pending = await db.settlementAdjustmentRequest.create({ data: { ...base, reason: "pending" } });
    await expect(db.settlementAdjustmentRequest.create({ data: { ...base, reason: "second pending" } })).rejects.toMatchObject({ code: "P2002" });
    await expect(db.settlementAdjustmentRequest.update({ where: { id: pending.id }, data: { status: "approved", reviewedBy: requester.id, reviewedAt: new Date() } }))
      .rejects.toThrow();
    await expect(db.settlementAdjustmentRequest.update({ where: { id: pending.id }, data: { reason: "   " } })).rejects.toThrow();
    await expect(db.settlementAdjustmentRequest.update({ where: { id: pending.id }, data: { status: "rejected" } })).rejects.toThrow();
  });

  it("binds a request to a settlement of the same vendor", async () => {
    const [own, foreign] = [await settlement(), await settlement()];
    await expect(db.settlementAdjustmentRequest.create({
      data: { vendorId: own.vendorId, settlementId: foreign.id, amountCents: 1, reason: "cross tenant", requestedBy: requester.id },
    })).rejects.toThrow();
  });
});
