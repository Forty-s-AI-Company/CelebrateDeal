import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { readOriginalRetryAudit } from "./q1-original-retry-audit";
import { WP4_SANDBOX_FIXTURE } from "../src/lib/wp4-sandbox-fixture";

function fixture() {
  const event = { id: "private-event", vendorId: null as string | null, status: "failed", retryCount: 3, maxRetries: 5,
    updatedAt: new Date("2026-10-10T06:43:38Z"), nextRetryAt: new Date("2026-10-10T06:58:38Z"),
    errorMessage: "Payment webhook processing failed (processing_timeout)." };
  const rows = [{ action: "webhook_retry_failed", actorLabel: "wp4_sandbox_fixed_callback_retry", errorCode: "processing_timeout", status: "failed", retryCount: "3" }];
  const tx = { $executeRaw: vi.fn().mockResolvedValue(0), $queryRaw: vi.fn().mockResolvedValue(rows),
    paymentTransaction: { findMany: vi.fn().mockResolvedValue([{ id: "private-payment", orderNumber: "private-order", updatedAt: event.updatedAt }]) },
    webhookEvent: { findMany: vi.fn().mockResolvedValue([event]) } };
  const transaction = vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx));
  return { tx, event, rows, transaction, db: { $transaction: transaction } as unknown as PrismaClient };
}
describe("one original callback readonly audit classification", () => {
  it("observes a durable classified timeout without selecting raw audit blobs or identifiers", async () => {
    const { tx, db, transaction } = fixture(); const result = await readOriginalRetryAudit(db);
    expect(result).toMatchObject({ classification: "FIXED_AUDIT_OBSERVED", fixedActorCount: 1, schedulerCount: 0,
      fixedRows: [{ action: "webhook_retry_failed", errorCode: "processing_timeout", status: "failed", retryCountMatchesCurrent: true }],
      eventStatus: "failed", retryCount: 3, maxRetries: 5, storedFailure: "processing_timeout", callbackPosts: 0, callbackReplayAuthorized: false });
    expect(JSON.stringify(result)).not.toContain("private-");
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.paymentTransaction.findMany.mock.invocationCallOrder[0]!);
    expect(tx.$executeRaw.mock.calls[0]?.[0]?.join("")).toBe("SET TRANSACTION READ ONLY");
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable", timeout: 15000 });
    expect(tx.paymentTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2,
      select: { id: true, orderNumber: true }, where: expect.objectContaining({ vendorId: WP4_SANDBOX_FIXTURE.vendorId }) }));
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const query = tx.$queryRaw.mock.calls[0]?.[0] as Prisma.Sql;
    expect(query.sql).toContain(`"after"->>'errorCode'`); expect(query.sql).toContain(`"before"->>'retryCount'`);
    expect(query.sql).not.toMatch(/SELECT\s+\*|SELECT\s+"before"\s*,|SELECT\s+"after"\s*,/);
    expect(query.sql).toContain(`"targetType" = 'WebhookEvent'`); expect(query.sql).toContain("LIMIT 21");
    expect(query.values).toContain("private-event"); expect(query.values).toContain(WP4_SANDBOX_FIXTURE.vendorId);
  });
  it.each(["payment", "event"])("stops on ambiguous %s without touching audit rows", async (kind) => {
    const { db, tx, event } = fixture();
    if (kind === "payment") tx.paymentTransaction.findMany.mockResolvedValueOnce([{}, {}]);
    else tx.webhookEvent.findMany.mockResolvedValueOnce([event, event]);
    expect((await readOriginalRetryAudit(db)).classification).toBe(kind === "payment" ? "PAYMENT_AMBIGUOUS" : "EVENT_AMBIGUOUS");
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
  it("rejects a foreign tenant event before audit access", async () => {
    const { db, tx, event } = fixture(); event.vendorId = "private-other-tenant";
    expect((await readOriginalRetryAudit(db)).classification).toBe("EVENT_SCOPE_MISMATCH"); expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
  it("records scheduler interference and suppresses unknown scalar data", async () => {
    const { db, tx, rows } = fixture(); tx.$queryRaw.mockResolvedValueOnce([...rows,
      { action: "private-action", actorLabel: "wp4_sandbox_fixed_callback_retry", errorCode: "private-secret", status: "private-status", retryCount: "private-value" },
      { action: "webhook_retry_failed", actorLabel: "job:webhook-retry", errorCode: "processing_failed", status: "failed", retryCount: "4" }]);
    const result = await readOriginalRetryAudit(db); expect(result).toMatchObject({ classification: "SCHEDULER_ACTIVITY_OBSERVED", schedulerCount: 1, fixedActorCount: 2 });
    expect(JSON.stringify(result)).not.toContain("private-");
  });
  it("does not pick latest or one of too many audit rows", async () => {
    const { db, tx, rows } = fixture(); tx.$queryRaw.mockResolvedValueOnce(Array(21).fill(rows[0]));
    expect(await readOriginalRetryAudit(db)).toEqual({ classification: "AUDIT_AMBIGUOUS" });
  });
  it("keeps no audit distinct from a processing failure", async () => {
    const { db, tx } = fixture(); tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await readOriginalRetryAudit(db)).toMatchObject({ classification: "NO_FIXED_AUDIT", fixedActorCount: 0 });
  });
  it("refuses all reads when readonly transaction setup fails", async () => {
    const { db, tx } = fixture(); tx.$executeRaw.mockRejectedValueOnce(new Error("private-error"));
    expect(await readOriginalRetryAudit(db)).toEqual({ classification: "AUDIT_READ_FAILED" }); expect(tx.paymentTransaction.findMany).not.toHaveBeenCalled();
  });
  it.each(["42703", "42P01"])("classifies actual raw-query schema SQLSTATE %s without exposing meta", async (code) => {
    const { db, tx } = fixture();
    tx.$queryRaw.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("private-query", { code: "P2010", clientVersion: "test", meta: { code, message: "private-column" } }));
    expect(await readOriginalRetryAudit(db)).toEqual({ classification: "SCHEMA_UNVERIFIED" });
  });
  it("keeps unrelated P2010 closed and distinct from schema drift", async () => {
    const { db, tx } = fixture();
    tx.$queryRaw.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("private-query", { code: "P2010", clientVersion: "test", meta: { code: "40001" } }));
    expect(await readOriginalRetryAudit(db)).toEqual({ classification: "AUDIT_READ_FAILED" });
  });
  it("returns only closed schema classification for missing audit columns", async () => {
    const { db, tx } = fixture(); tx.$queryRaw.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("private-field", { code: "P2022", clientVersion: "test" }));
    expect(await readOriginalRetryAudit(db)).toEqual({ classification: "SCHEMA_UNVERIFIED" });
  });
});
