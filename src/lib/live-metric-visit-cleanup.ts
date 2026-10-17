import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Request = z.object({ vendorId: id, liveId: id, versionId: id, visitorId: id,
  before: z.date(), take: z.number().int().min(1).max(1000) }).strict();
export type MetricVisitCleanupRequest = z.infer<typeof Request>;

/** Internal maintenance only. Caller owns authorization and the explicit cutoff;
 * this establishes no retention policy and does not delete visitor identities.
 * Collection must be closed before deleting its evidence. Never lock a child
 * before the version: issuance, report finalization and cleanup share this order.
 */
export async function deleteMetricVisitBatch(db: Pick<PrismaClient, "$transaction">, value: MetricVisitCleanupRequest) {
  const input = Request.parse(value);
  return db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true)`);
    const [version] = await tx.$queryRaw<{ collectionEnabled: boolean; expiresAt: Date; now: Date }[]>(Prisma.sql`
      SELECT "collectionEnabled","expiresAt",clock_timestamp() AS now FROM "LiveMetricVersion"
      WHERE id=${input.versionId} AND "vendorId"=${input.vendorId} AND "liveId"=${input.liveId} FOR UPDATE`);
    if (!version) throw new Error("Metric cleanup scope unavailable");
    if (version.collectionEnabled && version.expiresAt > version.now) throw new Error("Metric collection must be closed");
    if (input.before > version.now) throw new Error("Metric cleanup cutoff is in the future");
    const visitor = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM "LiveMetricVisitor" WHERE id=${input.visitorId} AND "vendorId"=${input.vendorId}
        AND "liveId"=${input.liveId} AND "versionId"=${input.versionId} FOR NO KEY UPDATE`);
    if (visitor.length !== 1) throw new Error("Metric cleanup scope unavailable");
    const deleted = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      WITH batch AS (
        SELECT id FROM "LiveMetricVisit" WHERE "vendorId"=${input.vendorId} AND "liveId"=${input.liveId}
          AND "versionId"=${input.versionId} AND "visitorId"=${input.visitorId} AND "visitedAt"<${input.before}
        ORDER BY "visitedAt",id LIMIT ${input.take} FOR UPDATE
      ) DELETE FROM "LiveMetricVisit" v USING batch b WHERE v.id=b.id RETURNING v.id`);
    const remaining = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM "LiveMetricVisit" WHERE "vendorId"=${input.vendorId} AND "liveId"=${input.liveId}
        AND "versionId"=${input.versionId} AND "visitorId"=${input.visitorId} AND "visitedAt"<${input.before} LIMIT 1`);
    return { deleted: deleted.length, hasMore: remaining.length !== 0 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000, maxWait: 5000 });
}
