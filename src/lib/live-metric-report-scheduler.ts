import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { runMetricReportJob } from "./live-metric-report-job";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Scope = z.object({ vendorId: id, liveId: id, versionId: id }).strict();
const Limits = z.object({ jobs: z.number().int().min(1).max(4).default(1),
  admissionMilliseconds: z.number().int().min(1).max(60000).default(45000) }).strict();
type Database = Pick<PrismaClient, "$queryRaw" | "$transaction">;
type Execute = Parameters<typeof runMetricReportJob>[2];
type Project = Parameters<typeof runMetricReportJob>[3];
type JobStatus = Awaited<ReturnType<typeof runMetricReportJob>>["status"];

/** Private background tick for an already-authorized scope and queued reports.
 * The host owns authentication, allowed scopes, cadence and worker artifacts.
 * Selection is only a hint: the job's atomic DB-clock claim decides ownership.
 * No new reports, collection enablement, certificates or inline retries here.
 * Expired leases may be recovered through the existing claim's five-attempt
 * cap; exhausted/stale candidates are terminalized by that same DB function.
 * The admission budget stops NEW work; an in-flight bounded job is awaited.
 */
export async function runMetricReportSchedulerTick(db: Database, value: z.infer<typeof Scope>, execute: Execute,
  project?: Project, options: z.input<typeof Limits> = {}, signal?: AbortSignal) {
  const scope = Scope.parse(value), limits = Limits.parse(options);
  const started = performance.now();
  let candidates: { id: string }[];
  try {
    candidates = signal?.aborted ? [] : await db.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
      await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true)`);
      return tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT r.id FROM "LiveMetricReport" r
        JOIN "LiveMetricVersion" v ON v.id=r."versionId" AND v."vendorId"=r."vendorId" AND v."liveId"=r."liveId"
        WHERE r."vendorId"=${scope.vendorId} AND r."liveId"=${scope.liveId} AND r."versionId"=${scope.versionId}
          AND r."expiresAt">clock_timestamp() AND v."expiresAt">clock_timestamp()
          AND r."windowEndAt"<=clock_timestamp()
          AND (r.status='queued' OR (r.status='running' AND r."leaseExpiresAt"<=clock_timestamp()))
        ORDER BY r."createdAt",r.id LIMIT ${limits.jobs}`);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000, maxWait: 5000 });
  } catch {
    // Never expose query errors or selected report identities to scheduler logs.
    return { status: "unavailable" as const, reason: "selection_failed" as const };
  }
  const outcomes: Record<JobStatus, number> = { recorded: 0, not_claimed: 0, snapshot_unavailable: 0,
    execution_unavailable: 0, lease_lost: 0, failed: 0 };
  let attempted = 0;
  for (const candidate of candidates) {
    if (signal?.aborted || performance.now() - started >= limits.admissionMilliseconds) break;
    // Each attempt owns a fresh identity; two ticks cannot impersonate a lease.
    attempted++;
    try {
      const result = await runMetricReportJob(db, { ...scope, reportId: candidate.id, workerId: randomUUID() }, execute, project);
      outcomes[result.status]++;
    } catch {
      // The job normally sanitizes errors itself. Preserve earlier counts if
      // an unexpected dependency rejects, and defer remaining work to the host.
      outcomes.failed++;
      break;
    }
  }
  // recorded means aggregate storage succeeded, not complete source coverage.
  return { status: "processed" as const, selected: candidates.length, attempted,
    deferred: candidates.length - attempted, outcomes };
}
