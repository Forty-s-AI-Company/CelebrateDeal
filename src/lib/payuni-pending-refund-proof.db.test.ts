import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";
import { readPendingRefundProof } from "./payuni-pending-refund-proof";
import { WP4_SANDBOX_FIXTURE } from "./wp4-sandbox-fixture";

assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
assertLocalTestDatabase("DIRECT_URL", process.env.DIRECT_URL);
const db = new PrismaClient();
const source = "a".repeat(40);
const suffix = randomUUID();
const ids: string[] = [];

beforeAll(async () => {
  await db.vendor.upsert({ where: { id: WP4_SANDBOX_FIXTURE.vendorId }, update: {}, create: {
    id: WP4_SANDBOX_FIXTURE.vendorId, name: "Synthetic refund proof vendor", slug: WP4_SANDBOX_FIXTURE.vendorSlug,
    email: WP4_SANDBOX_FIXTURE.vendorEmail, passwordHash: "synthetic-disabled-login",
  } });
});
afterAll(async () => {
  await db.webhookEvent.deleteMany({ where: { eventId: { startsWith: `refund-proof-${suffix}-` } } });
  await db.paymentTransaction.deleteMany({ where: { id: { in: ids }, vendorId: WP4_SANDBOX_FIXTURE.vendorId } });
  await db.$disconnect();
});
async function fixture({ callback = true, terminal = false, foreignSource = false } = {}) {
  const id = `refund-proof-${suffix}-${ids.length}`;
  ids.push(id);
  const payment = await db.paymentTransaction.create({ data: {
    id, vendorId: WP4_SANDBOX_FIXTURE.vendorId, providerName: "payuni", orderNumber: `${id}-order`, providerTradeNo: `${id}-trade`,
    grossAmountCents: 100, netAmountCents: 100, status: terminal ? "refunded" : "paid", refundedAmountCents: terminal ? 100 : 0,
    metadata: { billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4SourceCommit: foreignSource ? "b".repeat(40) : source },
  } });
  if (callback) await db.webhookEvent.create({ data: {
    vendorId: payment.vendorId, provider: "payuni", eventId: id, eventType: "paid", status: "processed",
    payload: { normalized: { orderNumber: payment.orderNumber, providerTradeNo: payment.providerTradeNo, grossAmountCents: 100 } },
  } });
  return payment;
}
describe("exact pending refund evidence on real disposable PostgreSQL", () => {
  it("does not borrow a processed callback from another transaction", async () => {
    await fixture();
    const target = await fixture({ callback: false });
    const proof = await readPendingRefundProof(db, target.id, source);
    expect(proof?.paymentCallbackMatched).toBe(false);
    expect(proof?.refundPersistencePassed).toBe(false);
  });
  it("rejects a transaction from another source even in the synthetic tenant", async () => {
    const target = await fixture({ foreignSource: true });
    expect(await readPendingRefundProof(db, target.id, source)).toBeNull();
  });
  it("requires exactly one processed full refund with a provider identity", async () => {
    const target = await fixture({ terminal: true });
    expect((await readPendingRefundProof(db, target.id, source))?.refundPersistencePassed).toBe(false);
    const refund = await db.refundRecord.create({ data: { vendorId: target.vendorId, paymentTransactionId: target.id,
      monthKey: "2026-10", refundAmountCents: 100, status: "pending", providerEventId: "synthetic-provider-refund" } });
    expect((await readPendingRefundProof(db, target.id, source))?.refundPersistencePassed).toBe(false);
    await db.refundRecord.update({ where: { id: refund.id }, data: { status: "processed" } });
    expect((await readPendingRefundProof(db, target.id, source))?.refundPersistencePassed).toBe(true);
    await db.refundRecord.create({ data: { vendorId: target.vendorId, paymentTransactionId: target.id,
      monthKey: "2026-10", refundAmountCents: 1, status: "failed", providerEventId: "synthetic-extra-refund" } });
    const proof = await readPendingRefundProof(db, target.id, source);
    expect(proof?.refundRecordCount).toBe(2);
    expect(proof?.refundPersistencePassed).toBe(false);
  });
});
