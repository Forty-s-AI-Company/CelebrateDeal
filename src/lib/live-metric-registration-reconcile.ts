import { performance } from "node:perf_hooks";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { materializeMetricRegistration, MetricRegistrationError } from "./live-metric-registration-capture";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const MetricRegistrationReconcileRequest = z.object({ vendorId: id, liveId: id, versionId: id,
  afterSubmissionId: id.nullable(), take: z.number().int().min(1).max(20) }).strict();
type Database = Pick<PrismaClient, "$transaction">;

/** Internal scheduler boundary; caller must authorize the supplied scope.
 * Each pass visits captures, including unresolved/terminal ones, in stable key
 * order. Continue with nextSubmissionId while hasMore, then start a NEW pass
 * from null later so late verifications and failed writes are reconsidered.
 * A completed page/pass is never proof of complete collection or zero loss.
 */
export async function reconcileMetricRegistrations(db: Database, value: z.infer<typeof MetricRegistrationReconcileRequest>) {
  const parsed = MetricRegistrationReconcileRequest.safeParse(value);
  if (!parsed.success) throw new MetricRegistrationError("INVALID_INPUT");
  const input = parsed.data;
  const started = performance.now();
  let candidates: { submissionId: string }[];
  try {
    candidates = await db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true)`);
      const cursor = input.afterSubmissionId === null ? Prisma.empty : Prisma.sql`AND "submissionId">${input.afterSubmissionId}`;
      return tx.$queryRaw<{ submissionId: string }[]>(Prisma.sql`
        SELECT "submissionId" FROM "LiveMetricRegistrationCapture"
        WHERE "vendorId"=${input.vendorId} AND "liveId"=${input.liveId} AND "versionId"=${input.versionId}
          ${cursor} ORDER BY "submissionId" ASC LIMIT ${input.take + 1}`);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 7000, maxWait: 3000 });
  } catch { throw new MetricRegistrationError("PERSISTENCE_UNAVAILABLE"); }
  const page = candidates.slice(0, input.take);
  const outcomes: Record<string, number> = {};
  let processed = 0, retryable = 0, terminalGaps = 0;
  let nextSubmissionId = input.afterSubmissionId;
  for (const candidate of page) {
    // One already-started projection may use its bounded 10s transaction plus
    // 5s acquisition wait. Never start another after the 20s batch deadline.
    if (performance.now() - started >= 20000) break;
    try {
      const result = await materializeMetricRegistration(db, {
        vendorId: input.vendorId, liveId: input.liveId, submissionId: candidate.submissionId,
      }, input.versionId);
      outcomes[result.status] = (outcomes[result.status] ?? 0) + 1;
      if (result.retryable) retryable++;
      else if (result.status !== "recorded") terminalGaps++;
    } catch {
      outcomes.persistence_unavailable = (outcomes.persistence_unavailable ?? 0) + 1;
      retryable++;
    }
    // Advance even over failures: a bad row cannot starve the rest of a pass.
    // A new pass must revisit it; this cursor is NOT an acceptance watermark.
    nextSubmissionId = candidate.submissionId;
    processed++;
  }
  return { status: processed < page.length ? "budget_exhausted" as const : "batch_complete" as const,
    processed, retryable, terminalGaps, outcomes, nextSubmissionId,
    hasMore: processed < page.length || candidates.length > input.take,
    coverage: "unknown" as const };
}
