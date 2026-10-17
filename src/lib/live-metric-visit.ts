import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { randomUUID } from "node:crypto";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Scope = z.object({ vendorId: id, liveId: id, versionId: id, visitorId: id }).strict();
const Request = z.object({ eventId: z.string().uuid().transform(value => value.toLowerCase()) }).strict();
export type MetricVisitScope = z.infer<typeof Scope>;
export type MetricVisitReceipt = { eventId: string; visitedAtMs: number; replayed: boolean };

/** Internal persistence boundary, not HTTP authorization. The caller must
 * resolve the content version and proven first-party visitor on the
 * server. Never pass request-provided identity/scope or a client timestamp.
 * Existing visitor identities only; this cannot enable collection or provision
 * browser identities, and does not infer consent or collection coverage.
 */
export async function recordMetricVisit(db: Pick<PrismaClient, "$transaction">,
  trustedScope: MetricVisitScope, value: unknown): Promise<MetricVisitReceipt> {
  const scope = Scope.parse(trustedScope);
  const request = Request.parse(value);
  return db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true)`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "LiveMetricVersion" WHERE id=${scope.versionId}
      AND "vendorId"=${scope.vendorId} AND "liveId"=${scope.liveId} FOR SHARE`);
    // Serialize retries for one visitor; version first matches report creation.
    const visitors = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM "LiveMetricVisitor" WHERE id=${scope.visitorId} AND "vendorId"=${scope.vendorId}
        AND "liveId"=${scope.liveId} AND "versionId"=${scope.versionId} FOR NO KEY UPDATE`);
    if (visitors.length !== 1) throw new Error("Metric visit scope unavailable");
    const receiptQuery = Prisma.sql`
      SELECT "visitedAt" FROM "LiveMetricVisit" WHERE "eventId"=${request.eventId} AND "vendorId"=${scope.vendorId}
        AND "liveId"=${scope.liveId} AND "versionId"=${scope.versionId} AND "visitorId"=${scope.visitorId}`;
    // A committed receipt remains readable after collection closes. This does
    // not write new evidence, extend retention, or resurrect a deleted event.
    const [existing] = await tx.$queryRaw<{ visitedAt: Date }[]>(receiptQuery);
    if (existing) return { eventId: request.eventId, visitedAtMs: existing.visitedAt.getTime(), replayed: true };
    // New events still pass the database collection/lifetime guard.
    // DO NOTHING preserves the first server timestamp and avoids UPDATE side effects.
    const inserted = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      INSERT INTO "LiveMetricVisit" (id,"eventId","vendorId","liveId","versionId","visitorId","visitedAt")
      VALUES (${randomUUID()},${request.eventId},${scope.vendorId},${scope.liveId},${scope.versionId},${scope.visitorId},clock_timestamp()::timestamptz(3))
      ON CONFLICT ("vendorId","liveId","versionId","visitorId","eventId") DO NOTHING RETURNING id`);
    const [stored] = await tx.$queryRaw<{ visitedAt: Date }[]>(receiptQuery);
    if (!stored) throw new Error("Metric visit scope unavailable");
    return { eventId: request.eventId, visitedAtMs: stored.visitedAt.getTime(), replayed: inserted.length === 0 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000, maxWait: 5000 });
}
