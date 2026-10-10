import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { readProcessingPreconditions } from "./q1-processing-preconditions";
import { WP4_SANDBOX_FIXTURE as fixed } from "../src/lib/wp4-sandbox-fixture";

function fixture() {
  const payment = { id: "synthetic:payment", vendorId: fixed.vendorId, providerName: "payuni", orderNumber: "fixed-order" };
  const reservation = { vendorId: fixed.vendorId, productId: fixed.productId, quantity: 1,
    items: [{ productId: fixed.productId, quantity: 1 }] as unknown };
  const scalar = { provider: "payuni", eventIdentity: "payuni:fixed", eventIdentityType: "string", occurredAt: "2026-10-10T00:00:00Z", occurredAtType: "string" as string | null };
  const tx = { $executeRaw: vi.fn().mockResolvedValue(0),
    paymentTransaction: { findMany: vi.fn().mockResolvedValueOnce([payment]).mockResolvedValueOnce([{ id: payment.id }]) },
    webhookEvent: { findMany: vi.fn().mockResolvedValue([{ id: "synthetic:event", vendorId: null }]) },
    inventoryReservation: { findMany: vi.fn().mockResolvedValue([reservation]) },
    $queryRaw: vi.fn().mockResolvedValueOnce([scalar]).mockResolvedValueOnce([{ platformSubscriptionId: false,
      formSubmissionId: false, affiliateClickId: false, referralCode: true }]) };
  const transaction = vi.fn(async (fn: (value: typeof tx) => Promise<unknown>, options: object) => { expect(options).toBeDefined(); return fn(tx); });
  const db = { $transaction: transaction } as unknown as Pick<PrismaClient, "$transaction">;
  return { db, tx, transaction, reservation, scalar, payment };
}

describe("original processing preconditions", () => {
  it("uses original validators, bounded exact selectors and a readonly transaction without disclosing values", async () => {
    const { db, tx, transaction } = fixture();
    const result = await readProcessingPreconditions(db);
    expect(result).toMatchObject({ classification: "PROCESSING_PRECONDITIONS_OBSERVED", scopeSiblingCount: "ONE",
      fixedPaymentIsSoleScopeRow: true, reservationSnapshotClass: "VALID", eventIdentityOpaque: true,
      paymentIdOpaque: true, vendorIdOpaque: true, occurredAtClass: "VALID", callbackPosts: 0, databaseWrites: false,
      callbackReplayAuthorized: false, metadataHints: { referralCode: true } });
    expect(JSON.stringify(result)).not.toMatch(/synthetic:|fixed-order|payuni:fixed|2026-10/);
    expect(tx.$executeRaw.mock.calls[0]![0].join("")).toBe("SET TRANSACTION READ ONLY");
    expect(transaction.mock.calls[0]![1]).toEqual({ isolationLevel: "Serializable", timeout: 15000 });
    expect(tx.paymentTransaction.findMany.mock.calls[0]![0]).toMatchObject({ take: 2,
      where: { vendorId: fixed.vendorId, providerName: "payuni", grossAmountCents: 100, currency: "TWD" } });
  });
  it.each([null, [], [{ productId: fixed.productId, quantity: 0 }], [{ productId: "other", quantity: 1 }]])("classifies reservation shape %j", async items => {
    const { db, reservation } = fixture(); reservation.items = items;
    expect(await readProcessingPreconditions(db)).toMatchObject({ reservationSnapshotClass: items === null ? "NULL_LEGACY" : "INVALID" });
  });
  it.each(["x".repeat(192), "control\u0001", " trailing ", ""])("rejects invalid event identifier without exporting it", async id => {
    const { db, scalar } = fixture(); scalar.eventIdentity = id;
    const result = await readProcessingPreconditions(db);
    expect(result).toMatchObject({ eventIdentityOpaque: false });
    expect(JSON.stringify(result)).not.toContain("eventIdentity\"");
  });
  it.each([[null, null, "ABSENT"], ["null", null, "INVALID"], ["string", "not-a-date", "INVALID"],
    ["number", "1", "INVALID"], ["string", "2026-10-10T00:00:00Z", "VALID"]])("classifies timestamp type %s", async (type, value, expected) => {
    const { db, scalar } = fixture(); scalar.occurredAtType = type; scalar.occurredAt = value as string;
    expect(await readProcessingPreconditions(db)).toMatchObject({ occurredAtClass: expected });
  });
  it.each([{ rows: [] }, { rows: [{ id: "different" }] }, { rows: [{ id: "synthetic:payment" }, { id: "different" }] }])("detects a non-sole scope row $rows", async ({ rows }) => {
    const { db, tx } = fixture(); tx.paymentTransaction.findMany.mockReset().mockResolvedValueOnce([{ id: "synthetic:payment", vendorId: fixed.vendorId, providerName: "payuni", orderNumber: "fixed-order" }]).mockResolvedValueOnce(rows);
    expect(await readProcessingPreconditions(db)).toMatchObject({ fixedPaymentIsSoleScopeRow: false,
      scopeSiblingCount: rows.length === 0 ? "ZERO" : rows.length === 1 ? "ONE" : "MANY" });
  });
  it("refuses foreign event scope", async () => {
    const { db, tx } = fixture(); tx.webhookEvent.findMany.mockResolvedValue([{ id: "event", vendorId: "foreign" }]);
    expect(await readProcessingPreconditions(db)).toMatchObject({ classification: "EVENT_SCOPE_MISMATCH" });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
  it("does not query any rows if the readonly boundary fails", async () => {
    const { db, tx } = fixture(); tx.$executeRaw.mockRejectedValue(new Error("private"));
    expect(await readProcessingPreconditions(db)).toMatchObject({ classification: "PRECONDITIONS_READ_FAILED", callbackPosts: 0 });
    expect(tx.paymentTransaction.findMany).not.toHaveBeenCalled();
  });
  it("keeps actual Prisma raw schema errors sanitized", async () => {
    const { db, tx } = fixture(); tx.$queryRaw.mockReset().mockRejectedValue(new Prisma.PrismaClientKnownRequestError("private", { code: "P2010", clientVersion: "test", meta: { code: "42703", message: "private" } }));
    expect(await readProcessingPreconditions(db)).toMatchObject({ classification: "SCHEMA_UNVERIFIED" });
  });
});
