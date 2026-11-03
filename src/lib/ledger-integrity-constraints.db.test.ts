import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

import { auditSnapshot } from "@/lib/audit";
import { generateSettlementForVendor } from "@/lib/billing-cycle";
import { getDb } from "@/lib/db";
import { ledgerCentsToNumber } from "@/lib/ledger-cents";

/**
 * F-062 (B04-07, DB-I02/DB-I09), F-066 (B04-12) and F-068 (B04-15) on the
 * disposable PostgreSQL built by `prisma migrate deploy`:
 * 20261103090000_ledger_aggregate_amounts_bigint,
 * 20261103090100_ledger_integrity_constraints and
 * 20261103090200_ledger_integrity_constraints_validate.
 *
 * Prisma 6 neither declares nor diffs CHECK constraints or partial indexes,
 * so every constraint is asserted twice: by its exact catalog definition and
 * by a rejected (or accepted) write. Writes go straight through Prisma, as a
 * bypassing write path would.
 */
const db = getDb();
const vendorIds: string[] = [];
const planIds: string[] = [];
const batchIds: string[] = [];
const INT4_MAX = 2_147_483_647;

afterAll(async () => {
  await db.payoutItem.deleteMany({ where: { payoutBatchId: { in: batchIds } } });
  await db.payoutBatch.deleteMany({ where: { id: { in: batchIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  await db.billingPlan.deleteMany({ where: { id: { in: planIds } } });
});

async function vendor() {
  const suffix = randomUUID();
  const created = await db.vendor.create({
    data: { name: "Ledger integrity", slug: `ledger-integrity-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  vendorIds.push(created.id);
  return created;
}

function payment(vendorId: string, data: Partial<Prisma.PaymentTransactionUncheckedCreateInput> = {}) {
  return db.paymentTransaction.create({
    data: {
      vendorId,
      providerName: "demo",
      orderNumber: `LEDGER-${randomUUID()}`,
      grossAmountCents: 10_000,
      netAmountCents: 10_000,
      status: "paid",
      ...data,
    },
  });
}

function refund(vendorId: string, paymentTransactionId: string, data: Partial<Prisma.RefundRecordUncheckedCreateInput> = {}) {
  return db.refundRecord.create({
    data: { vendorId, paymentTransactionId, monthKey: "2026-10", refundAmountCents: 1_000, status: "processed", ...data },
  });
}

let settlementMonths = 0;
function settlement(vendorId: string, data: Partial<Prisma.SettlementUncheckedCreateInput> = {}) {
  // (vendorId, monthKey) is unique: every fixture settlement gets its own month.
  settlementMonths += 1;
  return db.settlement.create({ data: { vendorId, monthKey: `${2100 + settlementMonths}-01`, ...data } });
}

async function batch(data: Partial<Prisma.PayoutBatchUncheckedCreateInput> = {}) {
  const created = await db.payoutBatch.create({
    data: { batchNumber: `LEDGER-${randomUUID()}`, batchDate: new Date("2026-10-05T00:00:00.000Z"), ...data },
  });
  batchIds.push(created.id);
  return created;
}

function payoutItem(payoutBatchId: string, vendorId: string, data: Partial<Prisma.PayoutItemUncheckedCreateInput> = {}) {
  return db.payoutItem.create({
    data: {
      payoutBatchId,
      vendorId,
      bankAccountDisplayName: "合＊",
      bankCodeDisplay: "013",
      bankAccountDisplayNumber: "****0001",
      payoutAmountCents: 1_000,
      ...data,
    },
  });
}

async function currentSchema() {
  const [row] = await db.$queryRaw<Array<{ schema: string }>>`SELECT pg_catalog.current_schema() AS schema`;
  return row!.schema;
}

describe("ledger constraint catalog", () => {
  it("keeps every ledger CHECK constraint validated with its exact definition", async () => {
    const expected: Record<string, string> = {
      PaymentTransaction_amounts_check: `CHECK ((("grossAmountCents" >= 0) AND ("gatewayFeeCents" >= 0) AND ("platformFeeCents" >= 0) AND ("netAmountCents" >= 0) AND ("refundedAmountCents" >= 0) AND ("refundedAmountCents" <= "grossAmountCents")))`,
      PaymentTransaction_status_check: `CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'expired'::text, 'partially_refunded'::text, 'refunded'::text])))`,
      PayoutBatch_amounts_check: `CHECK ((("totalAmountCents" >= 0) AND ("totalCount" >= 0)))`,
      PayoutBatch_status_check: `CHECK ((status = ANY (ARRAY['draft'::text, 'exported'::text, 'retrying'::text, 'failed'::text, 'completed'::text])))`,
      PayoutItem_amounts_check: `CHECK ((("payoutAmountCents" >= 0) AND ("retryCount" >= 0)))`,
      PayoutItem_status_check: `CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'retrying'::text])))`,
      RefundRecord_amounts_check: `CHECK ((("refundAmountCents" > 0) AND ("gatewayFeeRefundCents" >= 0) AND ("platformFeeRefundCents" >= 0)))`,
      RefundRecord_status_check: `CHECK ((status = ANY (ARRAY['pending'::text, 'processed'::text, 'failed'::text])))`,
      Settlement_amounts_check: `CHECK ((("monthlyFeeCents" >= 0) AND ("overflowFeeCents" >= 0) AND ("paymentServiceFeeCents" >= 0) AND ("transactionServiceFeeCents" >= 0) AND ("affiliateManagementFeeCents" >= 0) AND ("paymentGatewayFeeCents" >= 0) AND ("finalPayoutAmountCents" >= 0)))`,
      Settlement_status_check: `CHECK ((status = ANY (ARRAY['draft'::text, 'locked'::text, 'ready_for_payout'::text, 'paid'::text])))`,
    };
    const schema = await currentSchema();
    const rows = await db.$queryRaw<Array<{ name: string; definition: string; validated: boolean }>>`
      SELECT constraint_row.conname AS name,
             pg_catalog.pg_get_constraintdef(constraint_row.oid) AS definition,
             constraint_row.convalidated AS validated
        FROM pg_catalog.pg_constraint AS constraint_row
        INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = constraint_row.connamespace
       WHERE namespace.nspname = ${schema}
         AND constraint_row.conname = ANY(${Object.keys(expected)}::text[])
       ORDER BY constraint_row.conname
    `;
    expect(Object.fromEntries(rows.map((row) => [row.name, row.definition]))).toEqual(expected);
    expect(rows.every((row) => row.validated)).toBe(true);
  });

  it("stores aggregate amounts as bigint and defaults a payment to pending", async () => {
    const schema = await currentSchema();
    const columns = await db.$queryRaw<Array<{ table: string; column: string; type: string; default_value: string | null }>>`
      SELECT table_name AS table, column_name AS column, data_type AS type, column_default AS default_value
        FROM information_schema.columns
       WHERE table_schema = ${schema}
         AND ((table_name = 'Settlement' AND column_name LIKE '%Cents')
           OR (table_name = 'PayoutBatch' AND column_name = 'totalAmountCents')
           OR (table_name = 'PayoutItem' AND column_name = 'payoutAmountCents')
           OR (table_name = 'SettlementAdjustmentLedgerEntry' AND column_name = 'amountCents')
           OR (table_name = 'PaymentTransaction' AND column_name = 'status'))
       ORDER BY table_name, column_name
    `;
    const money = columns.filter((column) => column.column !== "status");
    expect(money.map((column) => `${column.table}.${column.column}`)).toEqual([
      "PayoutBatch.totalAmountCents",
      "PayoutItem.payoutAmountCents",
      "Settlement.adjustmentAmountCents",
      "Settlement.affiliateManagementFeeCents",
      "Settlement.carriedInCents",
      "Settlement.carriedOutCents",
      "Settlement.finalPayoutAmountCents",
      "Settlement.grossRevenueCents",
      "Settlement.monthlyFeeCents",
      "Settlement.overflowFeeCents",
      "Settlement.paymentGatewayFeeCents",
      "Settlement.paymentServiceFeeCents",
      "Settlement.payoutableAmountCents",
      "Settlement.refundAmountCents",
      "Settlement.transactionServiceFeeCents",
      "SettlementAdjustmentLedgerEntry.amountCents",
    ]);
    expect(money.every((column) => column.type === "bigint")).toBe(true);
    expect(columns.find((column) => column.column === "status")?.default_value).toBe("'pending'::text");
  });
});

describe("F-062 PaymentTransaction", () => {
  it("defaults a write that omits status to pending, never paid", async () => {
    const owner = await vendor();
    const created = await db.paymentTransaction.create({
      data: { vendorId: owner.id, providerName: "demo", grossAmountCents: 500, netAmountCents: 500 },
    });
    expect(created.status).toBe("pending");
  });

  it("accepts every status the application writes and rejects any other", async () => {
    const owner = await vendor();
    for (const status of ["pending", "paid", "failed", "expired"]) {
      await expect(payment(owner.id, { status })).resolves.toMatchObject({ status });
    }
    await expect(payment(owner.id, { status: "partially_refunded", refundedAmountCents: 1_000 })).resolves.toMatchObject({ status: "partially_refunded" });
    await expect(payment(owner.id, { status: "refunded", refundedAmountCents: 10_000 })).resolves.toMatchObject({ status: "refunded" });
    for (const status of ["PAID", "dispute_opened", "succeeded", ""]) {
      await expect(payment(owner.id, { status })).rejects.toThrow(/PaymentTransaction_status_check/);
    }
    const existing = await payment(owner.id, { status: "pending" });
    await expect(db.paymentTransaction.update({ where: { id: existing.id }, data: { status: "completed" } }))
      .rejects.toThrow(/PaymentTransaction_status_check/);
    await expect(db.paymentTransaction.findUniqueOrThrow({ where: { id: existing.id } })).resolves.toMatchObject({ status: "pending" });
  });

  it("rejects negative amounts and a refund above the gross amount", async () => {
    const owner = await vendor();
    for (const data of [
      { grossAmountCents: -1, netAmountCents: 0 },
      { gatewayFeeCents: -1 },
      { platformFeeCents: -1 },
      { netAmountCents: -1 },
      { refundedAmountCents: -1 },
      { status: "partially_refunded", refundedAmountCents: 10_001 },
    ]) {
      await expect(payment(owner.id, data)).rejects.toThrow(/PaymentTransaction_amounts_check/);
    }
    const existing = await payment(owner.id, { status: "partially_refunded", refundedAmountCents: 9_999 });
    await expect(db.paymentTransaction.update({ where: { id: existing.id }, data: { refundedAmountCents: { increment: 2 } } }))
      .rejects.toThrow(/PaymentTransaction_amounts_check/);
    await expect(payment(owner.id, { grossAmountCents: 0, netAmountCents: 0, status: "pending" })).resolves.toMatchObject({ grossAmountCents: 0 });
  });
});

describe("F-062 RefundRecord", () => {
  it("accepts pending, processed and failed refunds and rejects any other status", async () => {
    const owner = await vendor();
    const paid = await payment(owner.id);
    for (const status of ["pending", "processed", "failed"]) {
      await expect(refund(owner.id, paid.id, { status })).resolves.toMatchObject({ status });
    }
    for (const status of ["refunded", "PROCESSED", "void"]) {
      await expect(refund(owner.id, paid.id, { status })).rejects.toThrow(/RefundRecord_status_check/);
    }
  });

  it("rejects a zero or negative refund and negative fee refunds", async () => {
    const owner = await vendor();
    const paid = await payment(owner.id);
    for (const data of [{ refundAmountCents: 0 }, { refundAmountCents: -500 }, { gatewayFeeRefundCents: -1 }, { platformFeeRefundCents: -1 }]) {
      await expect(refund(owner.id, paid.id, data)).rejects.toThrow(/RefundRecord_amounts_check/);
    }
  });

  it("books a provider event at most once per payment", async () => {
    const owner = await vendor();
    const paid = await payment(owner.id);
    const other = await payment(owner.id);
    await refund(owner.id, paid.id, { providerEventId: "close-001" });
    await expect(refund(owner.id, paid.id, { providerEventId: "close-001" })).rejects.toMatchObject({ code: "P2002" });
    const second = await refund(owner.id, paid.id, { providerEventId: "close-002" });
    await expect(db.refundRecord.update({ where: { id: second.id }, data: { providerEventId: "close-001" } }))
      .rejects.toMatchObject({ code: "P2002" });
    // A serial only identifies a refund within its own trade.
    await expect(refund(owner.id, other.id, { providerEventId: "close-001" })).resolves.toMatchObject({ providerEventId: "close-001" });
    // Rows without a provider event (manual refunds) are not constrained.
    await refund(owner.id, paid.id, { providerEventId: null });
    await refund(owner.id, paid.id, { providerEventId: null });
    await expect(db.refundRecord.count({ where: { paymentTransactionId: paid.id, providerEventId: null } })).resolves.toBe(2);
  });
});

describe("F-062 Settlement, PayoutBatch and PayoutItem", () => {
  it("limits settlement statuses and keeps fees and the payout non-negative while net amounts stay signed", async () => {
    const owner = await vendor();
    for (const status of ["draft", "locked", "ready_for_payout", "paid"]) {
      await expect(settlement(owner.id, { status })).resolves.toMatchObject({ status });
    }
    for (const status of ["reviewing", "approved", "void"]) {
      await expect(settlement(owner.id, { status })).rejects.toThrow(/Settlement_status_check/);
    }
    for (const field of ["monthlyFeeCents", "overflowFeeCents", "paymentServiceFeeCents", "transactionServiceFeeCents", "affiliateManagementFeeCents", "paymentGatewayFeeCents", "finalPayoutAmountCents"] as const) {
      await expect(settlement(owner.id, { [field]: -1 })).rejects.toThrow(/Settlement_amounts_check/);
    }
    // F-039: refunds above revenue leave a negative gross and payable that
    // carry forward; a manual adjustment is signed.
    await expect(settlement(owner.id, { grossRevenueCents: -5_000, payoutableAmountCents: -5_000, adjustmentAmountCents: -100, carriedOutCents: -5_000 }))
      .resolves.toMatchObject({ grossRevenueCents: BigInt(-5_000), payoutableAmountCents: BigInt(-5_000) });
  });

  it("limits payout batch and item statuses and amounts", async () => {
    const owner = await vendor();
    for (const status of ["draft", "exported", "retrying", "failed", "completed"]) {
      await expect(batch({ status })).resolves.toMatchObject({ status });
    }
    for (const status of ["reviewing", "paid", "pending"]) {
      await expect(batch({ status })).rejects.toThrow(/PayoutBatch_status_check/);
    }
    await expect(batch({ totalAmountCents: -1 })).rejects.toThrow(/PayoutBatch_amounts_check/);
    await expect(batch({ totalCount: -1 })).rejects.toThrow(/PayoutBatch_amounts_check/);

    const target = await batch();
    for (const status of ["pending", "paid", "failed", "retrying"]) {
      await expect(payoutItem(target.id, owner.id, { status })).resolves.toMatchObject({ status });
    }
    for (const status of ["pending_review", "completed", "exported"]) {
      await expect(payoutItem(target.id, owner.id, { status })).rejects.toThrow(/PayoutItem_status_check/);
    }
    await expect(payoutItem(target.id, owner.id, { payoutAmountCents: -1 })).rejects.toThrow(/PayoutItem_amounts_check/);
    await expect(payoutItem(target.id, owner.id, { retryCount: -1 })).rejects.toThrow(/PayoutItem_amounts_check/);
  });
});

describe("F-066 one payout item per settlement", () => {
  it("rejects a second payout item for the same settlement, even from another batch", async () => {
    const owner = await vendor();
    const locked = await settlement(owner.id, { status: "ready_for_payout", lockedAt: new Date(), finalPayoutAmountCents: 1_000 });
    const first = await batch();
    const second = await batch();
    await payoutItem(first.id, owner.id, { settlementId: locked.id });
    await expect(payoutItem(first.id, owner.id, { settlementId: locked.id })).rejects.toMatchObject({ code: "P2002" });
    await expect(payoutItem(second.id, owner.id, { settlementId: locked.id })).rejects.toMatchObject({ code: "P2002" });
    const unlinked = await payoutItem(second.id, owner.id, { settlementId: null });
    await expect(db.payoutItem.update({ where: { id: unlinked.id }, data: { settlementId: locked.id } })).rejects.toMatchObject({ code: "P2002" });
    // Items without a settlement are not constrained.
    await payoutItem(second.id, owner.id, { settlementId: null });
    await expect(db.payoutItem.count({ where: { vendorId: owner.id, settlementId: null } })).resolves.toBe(2);
    await expect(db.payoutItem.count({ where: { vendorId: owner.id, settlementId: locked.id } })).resolves.toBe(1);
  });
});

describe("F-068 aggregate amounts above int4", () => {
  it("stores settlement, carry, batch and item amounts beyond NT$21,474,836 exactly", async () => {
    const owner = await vendor();
    const large = BigInt(INT4_MAX) * BigInt(1_000) + BigInt(7);
    const big = await settlement(owner.id, {
      status: "ready_for_payout",
      lockedAt: new Date(),
      grossRevenueCents: large,
      payoutableAmountCents: large,
      finalPayoutAmountCents: large,
      monthlyFeeCents: BigInt(INT4_MAX) + BigInt(1),
    });
    expect(big.finalPayoutAmountCents).toBe(large);
    expect(typeof big.finalPayoutAmountCents).toBe("bigint");
    const carry = await db.settlementAdjustmentLedgerEntry.create({
      data: { vendorId: owner.id, kind: "negative_balance_carry_forward", sourceMonthKey: "2026-08", targetMonthKey: "2026-09", amountCents: -large },
    });
    expect(carry.amountCents).toBe(-large);
    const target = await batch({ totalAmountCents: large * BigInt(2), totalCount: 2 });
    expect(target.totalAmountCents).toBe(large * BigInt(2));
    const item = await payoutItem(target.id, owner.id, { settlementId: big.id, payoutAmountCents: big.finalPayoutAmountCents });
    expect(item.payoutAmountCents).toBe(large);
    await expect(db.settlement.count({ where: { id: big.id, finalPayoutAmountCents: item.payoutAmountCents } })).resolves.toBe(1);
    // Audit snapshots serialize BigInt amounts instead of throwing.
    expect(auditSnapshot({ settlement: big, item })).toMatchObject({
      settlement: { finalPayoutAmountCents: ledgerCentsToNumber(large), monthlyFeeCents: INT4_MAX + 1 },
      item: { payoutAmountCents: ledgerCentsToNumber(large) },
    });
  });

  it("generates a monthly settlement whose revenue exceeds int4 without integer overflow", async () => {
    const suffix = randomUUID();
    const plan = await db.billingPlan.create({
      data: { name: `Ledger ${suffix}`, code: `ledger-${suffix}`, monthlyPriceCents: 99_900, transactionFeeRateBps: 100 },
    });
    planIds.push(plan.id);
    const owner = await db.vendor.create({
      data: {
        name: "Ledger large month",
        slug: `ledger-large-${suffix}`,
        email: `large-${suffix}@example.test`,
        passwordHash: "synthetic-only",
        subscriptions: { create: { planId: plan.id, paymentMode: "platform", status: "active", startedAt: new Date("2026-01-01T00:00:00.000Z") } },
      },
    });
    vendorIds.push(owner.id);
    const occurredAt = new Date("2026-09-15T04:00:00.000Z");
    // Each sale fits int4; the month (NT$30,000,000) does not.
    for (let index = 0; index < 2; index += 1) {
      await payment(owner.id, {
        purpose: "buyer_order",
        providerName: "payuni",
        paymentMode: "platform",
        grossAmountCents: 1_500_000_000,
        gatewayFeeCents: 42_000_000,
        platformFeeCents: 15_000_000,
        netAmountCents: 1_443_000_000,
        currency: "TWD",
        status: "paid",
        occurredAt,
      });
    }

    const result = await generateSettlementForVendor(owner.id, "2026-09");

    expect(result.settlement).toMatchObject({
      grossRevenueCents: BigInt(3_000_000_000),
      paymentGatewayFeeCents: BigInt(84_000_000),
      transactionServiceFeeCents: BigInt(30_000_000),
      payoutableAmountCents: BigInt(2_886_000_000),
      finalPayoutAmountCents: BigInt(2_886_000_000),
      status: "draft",
    });
    await expect(db.settlement.findUniqueOrThrow({ where: { id: result.settlement.id } }))
      .resolves.toMatchObject({ finalPayoutAmountCents: BigInt(2_886_000_000) });
  });
});
