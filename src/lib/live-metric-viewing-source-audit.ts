import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { inspectPlaybackIntakes } from "./live-metric-playback-intake-audit";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Scope = z.object({ vendorId: id, liveId: id, versionId: id, startAt: z.date(), endAt: z.date() }).strict()
  .refine(value => value.startAt < value.endAt, "Invalid viewing audit window");
type Context = { isolation: string; readOnly: string; sourceRevision: bigint; registrationRevision: bigint; durationMs: number | null;
  viewingRevision: bigint; epochStartedAt: Date | null; issuedCount: bigint; removedCount: bigint; primary: boolean;
  intakeRevision: bigint; playbackEpochStartedAt: Date | null; asOf: Date };
export type ViewingSessionFact = {
  sessionId: string; verifiedAt: Date; identityCurrent: boolean; anchorAt: Date; expiresAt: Date;
  closedAt: Date | null; complete: boolean; lastSequence: number; finalSequence: number | null; lastElapsedMs: number;
};
type Row = ViewingSessionFact & { intervalId: string | null; sequence: number | null; wallStartAt: Date | null;
  wallEndAt: Date | null; mediaStartMs: number | null; mediaEndMs: number | null };
export type ViewingDeliverySummary = { intervalCount: number; contiguous: boolean; lastWallEndMs: number };
/** Delivery closure is not video completion and never certifies collection coverage. */
export function classifyViewingDelivery(session: ViewingSessionFact, summary: ViewingDeliverySummary, startAt: Date, endAt: Date) {
  if (!session.identityCurrent) return "identity_mismatch" as const;
  if (session.verifiedAt < startAt || session.verifiedAt >= endAt) return "outside_cohort" as const;
  if (session.closedAt === null) return "open_session" as const;
  if (!session.complete) return "incomplete_session" as const;
  if (session.finalSequence === null || session.finalSequence !== session.lastSequence) return "final_sequence_mismatch" as const;
  if (!summary.contiguous || summary.intervalCount !== session.lastSequence + 1) return "interval_gap" as const;
  if (summary.lastWallEndMs - +session.anchorAt !== session.lastElapsedMs
    || +session.closedAt < summary.lastWallEndMs || session.closedAt > session.expiresAt) return "progress_mismatch" as const;
  return "closed_contiguous" as const;
}
type AuditCursor = { sessionId: string; sequence: number };
function sameCursor(cursor: AuditCursor | null, row: Row) {
  return cursor !== null && cursor.sessionId === row.sessionId && cursor.sequence === (row.sequence ?? -1);
}
type ActiveSession = { fact: ViewingSessionFact; summary: ViewingDeliverySummary; nextSequence: number };
function appendInterval(active: ActiveSession, row: Row, durationMs: number | null) {
  active.summary.intervalCount++;
  const start = row.wallStartAt?.getTime(), end = row.wallEndAt?.getTime();
  if (row.sequence !== active.nextSequence || start === undefined || end === undefined || end <= start
    || start < active.summary.lastWallEndMs || end > +row.expiresAt || row.mediaStartMs === null || row.mediaEndMs === null
    || row.mediaStartMs < 0 || row.mediaEndMs <= row.mediaStartMs
    || (durationMs !== null && row.mediaEndMs > durationMs)) active.summary.contiguous = false;
  if (end !== undefined) active.summary.lastWallEndMs = end;
  active.nextSequence = (row.sequence ?? -1) + 1;
}
/** Inspect all overlapping issued sessions, including open/incomplete and
 * outside-cohort ones. No PII, no writer and no positive coverage certificate.
 * Session issuance closure and a write-time source fence are still required.
 */
export async function auditMetricViewingSources(db: Pick<PrismaClient, "$transaction">, value: z.infer<typeof Scope>,
  options: Partial<{ rows: number; pages: number; pageSize: number; milliseconds: number }> = {}) {
  const scope = Scope.parse(value);
  const limits = { rows: 1_000_000, pages: 2000, pageSize: 500, milliseconds: 20000, ...options };
  for (const [key, maximum] of [["rows", 1_000_000], ["pages", 2000], ["pageSize", 500], ["milliseconds", 23000]] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > maximum) throw new Error("Invalid viewing audit limits");
  }
  const started = performance.now();
  try {
    return await db.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
      await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true)`);
      const [context] = await tx.$queryRaw<Context[]>(Prisma.sql`
        SELECT current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS "readOnly",
          v."sourceRevision",public.wp20_metric_registration_revision(v."vendorId",v."liveId") AS "registrationRevision",v."durationMs",
          p."viewingRevision",p."epochStartedAt",p."issuedCount",p."removedCount",NOT pg_is_in_recovery() AS primary,
          public.wp20_metric_playback_intake_revision(v."vendorId",v."liveId",v.id) AS "intakeRevision",
          v."playbackIntakeStartedAt" AS "playbackEpochStartedAt",clock_timestamp() AS "asOf"
        FROM "LiveMetricVersion" v JOIN "Live" l ON l.id=v."liveId" AND l."vendorId"=v."vendorId"
        CROSS JOIN LATERAL public.wp20_metric_viewing_provenance(v."vendorId",v."liveId",v.id,${scope.startAt},${scope.endAt}) p
        WHERE v.id=${scope.versionId} AND v."vendorId"=${scope.vendorId} AND v."liveId"=${scope.liveId}
          AND v."collectionStartedAt"<=${scope.startAt} AND v."expiresAt">=${scope.endAt} AND ${scope.endAt}<=clock_timestamp()`);
      if (!context) return { status: "unavailable" as const, reason: "scope_or_window_unavailable" as const };
      if (!context.primary) return { status: "unavailable" as const, reason: "replica_not_supported" as const };
      if (context.isolation !== "repeatable read" || context.readOnly !== "on") throw new Error("Viewing audit requires read-only repeatable-read");
      const digest = createHash("sha256").update(JSON.stringify({ format: "viewing-source-inspection-v4", ...scope }));
      const intake = await inspectPlaybackIntakes(tx, scope, { asOf: context.asOf, expectedRevision: context.intakeRevision,
        epochStartedAt: context.playbackEpochStartedAt }, { ...limits, outOfTime: () => performance.now() - started >= limits.milliseconds });
      if (intake.status !== "enumerated") return intake;
      const outcomes = { closed_contiguous: 0, identity_mismatch: 0, outside_cohort: 0, open_session: 0,
        incomplete_session: 0, final_sequence_mismatch: 0, interval_gap: 0, progress_mismatch: 0 };
      let sessionCount = 0, intervalCount = 0, chargedRows = intake.count;
      let cursor: AuditCursor | null = null;
      let active: ActiveSession | null = null;
      const finish = () => { if (active) outcomes[classifyViewingDelivery(active.fact, active.summary, scope.startAt, scope.endAt)]++; };
      for (let page = intake.pagesUsed; page < limits.pages; page++) {
        if (performance.now() - started >= limits.milliseconds) return { status: "unavailable" as const, reason: "limit_exceeded" as const };
        const rows: Row[] = await tx.$queryRaw<Row[]>(Prisma.sql`
          SELECT * FROM public.wp20_metric_viewing_page(${scope.vendorId},${scope.liveId},${scope.versionId},${scope.startAt}::timestamptz,${scope.endAt}::timestamptz,
            ${cursor?.sessionId ?? null}::text,${cursor?.sequence ?? -1}::int,${limits.pageSize + 1}::int)`);
        if (performance.now() - started >= limits.milliseconds) return { status: "unavailable" as const, reason: "limit_exceeded" as const };
        const selected = rows.slice(0, limits.pageSize);
        for (const row of selected) {
          if (active === null || active.fact.sessionId !== row.sessionId) {
            finish();sessionCount++;chargedRows++;
            active = { fact: row, summary: { intervalCount: 0, contiguous: true, lastWallEndMs: +row.anchorAt }, nextSequence: 0 };
          }
          if (row.intervalId !== null) {
            intervalCount++;chargedRows++;appendInterval(active, row, context.durationMs);
          }
          if (chargedRows > limits.rows) return { status: "unavailable" as const, reason: "limit_exceeded" as const };
          digest.update(JSON.stringify([row.sessionId,row.verifiedAt,row.identityCurrent,row.anchorAt,row.expiresAt,row.closedAt,row.complete,
            row.lastSequence,row.finalSequence,row.lastElapsedMs,row.intervalId,row.sequence,row.wallStartAt,row.wallEndAt,row.mediaStartMs,row.mediaEndMs]) + "\n");
        }
        if (rows.length <= limits.pageSize) {
          finish();
          const sourceDigest = digest.update(JSON.stringify([context.sourceRevision.toString(),context.registrationRevision.toString(),
            context.viewingRevision.toString(),context.epochStartedAt,context.issuedCount.toString(),context.removedCount.toString(),context.durationMs,intake.digest])).digest("hex");
          return { status: "enumerated" as const, coverage: "unknown" as const, sourceRevision: context.sourceRevision,
            registrationRevision: context.registrationRevision, sessionCount, intervalCount, outcomes,
            viewingRevision: context.viewingRevision,
            intake,
            // Epoch proves when logging began, not that playback intake or
            // browser delivery was complete. Removed issuances stay visible.
            issuance: { countCompleteness: "recorded_only" as const, epochStartedAt: context.epochStartedAt, history: context.epochStartedAt !== null && scope.startAt >= context.epochStartedAt
              ? "ledger_enabled" as const : "unknown" as const, issuedCount: context.issuedCount, removedCount: context.removedCount },
            digest: sourceDigest,
            classification: { asOf: context.asOf, digest: createHash("sha256").update(JSON.stringify([
              sourceDigest,intake.classificationDigest,context.asOf,outcomes])).digest("hex") } };
        }
        const last = selected.at(-1);
        if (!last || sameCursor(cursor, last)) throw new Error("Viewing audit cursor did not advance");
        cursor = { sessionId: last.sessionId, sequence: last.sequence ?? -1 };
      }
      return { status: "unavailable" as const, reason: "limit_exceeded" as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000, maxWait: 5000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010" && error.meta?.code === "57014") {
      return { status: "unavailable" as const, reason: "query_cancelled" as const };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028"
      && typeof error.meta?.error === "string" && error.meta.error.includes("expired transaction")) {
      return { status: "unavailable" as const, reason: "transaction_expired" as const };
    }
    throw error;
  }
}
