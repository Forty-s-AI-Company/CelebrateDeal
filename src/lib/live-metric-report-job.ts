import type { PrismaClient } from "@prisma/client";
import { claimMetricReport, finishMetricReport, type MetricReportLease } from "./live-metric-report-lease";
import { loadMetricViewingSnapshot } from "./live-metric-report-snapshot";
import { metricSnapshotInput } from "./live-metric-snapshot-input";
import { publishMetricCompletion } from "./live-metric-completion-store";
import type { createCompletionExecutor, createMetricExecutor } from "./live-metric-executor";

type Database = Pick<PrismaClient, "$queryRaw" | "$transaction">;
type Executor = ReturnType<typeof createMetricExecutor>;

/** Internal single-job orchestration; caller authenticates and chooses a scoped
 * queued report. Supply the bounded worker executor, never a browser callback.
 * No automatic retries or synchronous computation fallback. Unfinished leases
 * expire through the existing DB-clock protocol so later attempts can recover.
 */
export async function runMetricReportJob(db: Database, value: MetricReportLease, execute: Executor, project?: ReturnType<typeof createCompletionExecutor>) {
  const lease = { ...value };
  let stage: "claim" | "snapshot" | "conversion" | "execution" | "projection" | "publish" | "reload" | "finish" = "claim";
  try {
    if (!await claimMetricReport(db, lease)) return { status: "not_claimed" as const };
    stage = "snapshot";
    let snapshot = await loadMetricViewingSnapshot(db, lease);
    if (snapshot.status !== "available") return { status: "snapshot_unavailable" as const, reason: snapshot.reason };
    stage = "conversion";
    let input = metricSnapshotInput(snapshot.data);
    if (project && input.completions === null && input.registrations !== null && input.viewing !== null && input.durationMs !== null) {
      const sourceRevision = snapshot.data.context.sourceRevision;
      if (typeof sourceRevision !== "bigint") throw new Error("Missing snapshot revision");
      stage = "projection";
      const candidate = await project(input);
      if (candidate.status !== "available") return { status: "execution_unavailable" as const, reason: candidate.reason };
      if (candidate.projection.status === "available") {
        stage = "publish";
        if (!await publishMetricCompletion(db, lease, sourceRevision, input.scope, candidate.projection)) return { status: "lease_lost" as const };
        stage = "reload";
        snapshot = await loadMetricViewingSnapshot(db, lease);
        if (snapshot.status !== "available") return { status: "snapshot_unavailable" as const, reason: snapshot.reason };
        input = metricSnapshotInput(snapshot.data);
        if (input.completions === null || snapshot.data.context.sourceRevision !== sourceRevision) return { status: "lease_lost" as const };
      }
    }
    stage = "execution";
    const result = await execute(input);
    if (result.status !== "available") return { status: "execution_unavailable" as const, reason: result.reason };
    stage = "finish";
    // Finish revalidates the lease and source revision after expensive work.
    // Only aggregate output is persisted; raw person/browser facts stay private.
    if (!await finishMetricReport(db, lease, result.metrics)) return { status: "lease_lost" as const };
    return { status: "recorded" as const };
  } catch {
    // Failure summaries carry no database errors, identities or worker payloads.
    return { status: "failed" as const, stage };
  }
}
