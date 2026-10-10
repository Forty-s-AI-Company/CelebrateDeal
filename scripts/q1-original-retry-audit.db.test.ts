import { afterAll, afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertLocalTestDatabase } from "./local-database-safety";
import { readOriginalRetryAudit } from "./q1-original-retry-audit";
import { ensureWp4SandboxFixture, WP4_SANDBOX_FIXTURE as fixed } from "../src/lib/wp4-sandbox-fixture";
import { wp4HistoricalBuyerWhere } from "../src/lib/wp4-buyer-recovery";

// All setup and schema writes belong only to an explicitly verified loopback test DB.
assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
const db = new PrismaClient();
const source = "9acfe8d2dba62430e950cff2c0387841ab91f44b";
const prefix = `q1_audit_${randomBytes(8).toString("hex")}`;
afterEach(async () => {
  await db.auditLog.deleteMany({ where: { targetId: { startsWith: prefix } } });
  await db.webhookEvent.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.vendor.deleteMany({ where: { id: fixed.vendorId } });
  await db.user.deleteMany({ where: { id: fixed.userId } });
  await db.billingPlan.deleteMany({ where: { id: fixed.planId } });
});
afterAll(() => db.$disconnect());
async function seed() {
  await ensureWp4SandboxFixture(db);
  const payment = await db.paymentTransaction.create({ data: {
    vendorId: fixed.vendorId, providerName: "payuni", orderNumber: `${prefix}_order`,
    paymentMode: "platform", grossAmountCents: 100, netAmountCents: 100,
    currency: "TWD", status: "pending", checkoutIdempotencyKey: wp4HistoricalBuyerWhere(source).checkoutIdempotencyKey,
    metadata: { billingPurpose: "buyer_order", productId: fixed.productId,
      wp4SourceCommit: source, wp4PaymentSubmissionReserved: true },
  } });
  const event = await db.webhookEvent.create({ data: { id: `${prefix}_event`,
    provider: "payuni", eventId: `${prefix}_provider`, eventType: "paid", status: "failed",
    retryCount: 3, maxRetries: 5, payload: { normalized: { orderNumber: payment.orderNumber } },
  } });
  return { payment, event };
}
describe("original audit SQL against real migrated PostgreSQL", () => {
  it("reads exact scalar paths while excluding earlier, unrelated and foreign-tenant audit rows", async () => {
    const { event, payment } = await seed();
    const row = { targetType: "WebhookEvent", targetId: event.id,
      actorLabel: "wp4_sandbox_fixed_callback_retry", action: "webhook_retry_failed",
      before: { retryCount: 3, privatePayload: "must-not-leak" },
      after: { errorCode: "processing_timeout", status: "failed", secret: "must-not-leak" } };
    await db.auditLog.createMany({ data: [
      { ...row, vendorId: null, createdAt: new Date("2026-10-10T06:43:38Z") },
      { ...row, vendorId: null, createdAt: new Date("2026-10-10T06:43:33Z") },
      { ...row, vendorId: null, targetId: `${prefix}_different`, createdAt: new Date("2026-10-10T06:43:38Z") },
    ] });
    // The fixture owner already exists. A distinct synthetic tenant proves SQL filtering.
    const other = await db.vendor.create({ data: { id: `${prefix}_foreign`, name: "Synthetic audit tenant", slug: `${prefix}-foreign`, email: `${prefix}@invalid.example`, passwordHash: "synthetic-disabled-audit-tenant" } });
    try {
      await db.auditLog.create({ data: { ...row, vendorId: other.id, createdAt: new Date("2026-10-10T06:43:38Z") } });
      const result = await readOriginalRetryAudit(db);
      expect(result).toMatchObject({ classification: "FIXED_AUDIT_OBSERVED", fixedActorCount: 1,
        schedulerCount: 0, fixedRows: [{ errorCode: "processing_timeout", retryCountMatchesCurrent: true }],
        callbackPosts: 0, callbackReplayAuthorized: false, paymentUpdatedAfterRunStart: "UNKNOWN" });
      expect(JSON.stringify(result)).not.toMatch(/must-not-leak|q1_audit_/);
      expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "pending" });
      expect(await db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ status: "failed", retryCount: 3 });
    } finally { await db.vendor.delete({ where: { id: other.id } }); }
  });
  it("classifies a real raw-query missing column in a private scratch schema", async () => {
    await seed();
    const schema = `${prefix}_scratch`;
    // Names are generated from a fixed prefix and cryptographic hex, never caller input.
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    try {
      await db.$executeRawUnsafe(`CREATE TABLE "${schema}"."AuditLog" (LIKE public."AuditLog" INCLUDING DEFAULTS)`);
      await db.$executeRawUnsafe(`ALTER TABLE "${schema}"."AuditLog" DROP COLUMN "after"`);
      const scratch = { $transaction: async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) =>
        db.$transaction(async tx => {
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
          return fn(tx);
        }, options) } as unknown as Pick<PrismaClient, "$transaction">;
      expect(await readOriginalRetryAudit(scratch)).toEqual({ classification: "SCHEMA_UNVERIFIED" });
    } finally { await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); }
  });
});
