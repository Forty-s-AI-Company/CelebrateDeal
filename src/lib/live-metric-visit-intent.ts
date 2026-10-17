import { Prisma } from "@prisma/client";
import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Input = z.object({ vendorId: id, liveId: id, versionId: id, visitorId: id,
  eventId: z.string().uuid().transform(value => value.toLowerCase()) }).strict();
/** Deterministic absent/conflicting expectation, distinct from a DB outage. */
export class MetricVisitIntentError extends Error {
  constructor() { super("Metric visit preparation unavailable"); this.name = "MetricVisitIntentError"; }
}

/** Internal transaction only: caller resolves the current version and proven
 * visitor. Persist an expectation before preparation returns, never a visit.
 * A lost reply stays unmatched; identities cannot take over the same event.
 */
export async function prepareMetricVisitIntent(tx: Prisma.TransactionClient, value: z.infer<typeof Input>) {
  const scope = Input.parse(value);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "LiveMetricVersion" WHERE id=${scope.versionId}
    AND "vendorId"=${scope.vendorId} AND "liveId"=${scope.liveId} FOR SHARE`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "LiveMetricVisitor" WHERE id=${scope.visitorId}
    AND "vendorId"=${scope.vendorId} AND "liveId"=${scope.liveId} AND "versionId"=${scope.versionId} FOR NO KEY UPDATE`);
  await tx.$executeRaw(Prisma.sql`INSERT INTO "LiveMetricVisitIntent" ("vendorId","liveId","versionId","visitorId","eventId")
    VALUES (${scope.vendorId},${scope.liveId},${scope.versionId},${scope.visitorId},${scope.eventId})
    ON CONFLICT ("vendorId","liveId","versionId","eventId") DO NOTHING`);
  await requireMetricVisitIntent(tx, scope);
}

/** An intent is necessary for the new public collector, never sufficient proof
 * of page/source completeness. Existing internal legacy writers stay distinct.
 */
export async function requireMetricVisitIntent(tx: Prisma.TransactionClient, value: z.infer<typeof Input>) {
  const scope = Input.parse(value);
  const rows = await tx.$queryRaw<{ eventId: string }[]>(Prisma.sql`SELECT "eventId" FROM "LiveMetricVisitIntent"
    WHERE "vendorId"=${scope.vendorId} AND "liveId"=${scope.liveId} AND "versionId"=${scope.versionId}
      AND "visitorId"=${scope.visitorId} AND "eventId"=${scope.eventId}`);
  if (rows.length !== 1) throw new MetricVisitIntentError();
}
