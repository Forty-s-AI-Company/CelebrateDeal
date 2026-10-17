import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { CompletionProjection, MetricScope } from "./live-core-metrics-read-model";
import type { MetricReportLease } from "./live-metric-report-lease";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const leaseSchema = z.object({ vendorId: id, liveId: id, versionId: id, reportId: id, workerId: id }).strict();
const factSchema = z.object({ personId: id, firstCompletedAtMs: z.number().int().min(0).max(8_640_000_000_000_000) }).strict();
const factsSchema = z.array(factSchema).max(1_000_000).superRefine((rows, context) => {
  if (new Set(rows.map(row => row.personId)).size !== rows.length) context.addIssue({ code: "custom", message: "Duplicate completion person" });
});
type Database = Pick<Prisma.TransactionClient, "$queryRaw">;
export type StoredCompletion = z.infer<typeof factSchema>;

/** Internal writer: caller must establish complete registration/viewing coverage
 * and delivery before calculating candidates. The DB rechecks lease/revision;
 * a worker result alone is not permission to certify missing source history.
 */
export async function publishMetricCompletion(db: Pick<PrismaClient, "$transaction">, value: MetricReportLease, sourceRevision: bigint,
  scope: MetricScope, projection: CompletionProjection): Promise<boolean> {
  const lease = leaseSchema.parse(value);
  if (typeof sourceRevision !== "bigint" || sourceRevision < BigInt(0)) throw new Error("Invalid completion source revision");
  if (scope.vendorId !== lease.vendorId || scope.liveId !== lease.liveId || scope.contentVersionId !== lease.versionId
    || !["live", "replay"].includes(scope.mode)) throw new Error("Completion scope mismatch");
  if (projection.status !== "available") return false;
  const cohortCount = z.number().int().min(0).max(1_000_000).parse(projection.cohortCount);
  if (projection.rows.some(row => row.scope.vendorId !== scope.vendorId || row.scope.liveId !== scope.liveId
    || row.scope.contentVersionId !== scope.contentVersionId || row.scope.mode !== scope.mode)) throw new Error("Completion scope mismatch");
  const rows = factsSchema.parse(projection.rows.map(row => ({ personId: row.personId, firstCompletedAtMs: row.firstCompletedAtMs })));
  if (rows.length > cohortCount) throw new Error("Completion cohort mismatch");
  // Serialize before opening the transaction so payload conversion holds no locks.
  const payload = JSON.stringify(rows);
  return db.$transaction(async tx => {
    // SET LOCAL applies before the publish statement starts and expires on rollback.
    await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true), set_config('lock_timeout','2000',true)`);
    const [result] = await tx.$queryRaw<{ changed: number }[]>(Prisma.sql`
      SELECT public.wp20_metric_completion_publish(${lease.vendorId},${lease.liveId},${lease.versionId},${lease.reportId},${lease.workerId},
        ${sourceRevision}::bigint,${cohortCount}::integer,${payload}::jsonb) AS changed`);
    return result?.changed === 1;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000, maxWait: 5000 });
}

/** Read in the same RR snapshot as viewing facts. null is missing provenance;
 * [] is a stored complete empty projection, never inferred from a missing row.
 */
export async function readMetricCompletion(tx: Database, value: MetricReportLease, reserve: (rows: number) => boolean = () => true) {
  const lease = leaseSchema.parse(value);
  const [record] = await tx.$queryRaw<{ isolation: string; rowCount: number | null; cohortCount: number | null }[]>(Prisma.sql`
    SELECT current_setting('transaction_isolation') AS isolation,p."rowCount",p."cohortCount"
    FROM "LiveMetricReport" r JOIN "LiveMetricVersion" v ON v.id=r."versionId" AND v."vendorId"=r."vendorId" AND v."liveId"=r."liveId"
    LEFT JOIN "LiveMetricCompletionProjection" p ON p."reportId"=r.id AND p."sourceRevision"=r."inputRevision" AND p."algorithmVersion"=1
    WHERE r.id=${lease.reportId} AND r."vendorId"=${lease.vendorId} AND r."liveId"=${lease.liveId} AND r."versionId"=${lease.versionId}
      AND r.status='running' AND r."leaseOwner"=${lease.workerId} AND r."leaseExpiresAt">clock_timestamp() AND r."expiresAt">clock_timestamp()
      AND r."inputRevision"=v."sourceRevision" AND r."inputRegistrationRevision"=public.wp20_metric_registration_revision(r."vendorId",r."liveId")
      AND r."inputOrderTenantRevision"=public.wp20_metric_order_window_revision(r."vendorId",r."windowStartAt",r."windowEndAt")
      AND r."inputOrderRevision"=public.wp20_metric_order_window_revision(r."vendorId",r."windowStartAt",r."windowEndAt")`);
  if (!record) return { status: "unavailable" as const, reason: "lease_or_scope_unavailable" as const };
  if (record.isolation !== "repeatable read") throw new Error("Completion reader requires repeatable-read snapshot");
  // Reserve the shared budget before transferring or parsing the JSON payload.
  const rowCount = record.rowCount === null ? 0 : z.number().int().min(0).max(1_000_000).parse(record.rowCount);
  if (!reserve(rowCount + 1)) return { status: "unavailable" as const, reason: "limit_exceeded" as const };
  if (record.cohortCount === null) return { status: "available" as const, rows: null, cohortCount: null };
  const cohortCount = z.number().int().min(0).max(1_000_000).parse(record.cohortCount);
  const [payload] = await tx.$queryRaw<{ rows: unknown }[]>(Prisma.sql`
    SELECT rows FROM "LiveMetricCompletionProjection" WHERE "reportId"=${lease.reportId}`);
  const rows = factsSchema.parse(payload?.rows);
  if (rows.length !== rowCount) throw new Error("Completion row count mismatch");
  if (rows.length > cohortCount) throw new Error("Completion cohort mismatch");
  return { status: "available" as const, rows, cohortCount };
}
