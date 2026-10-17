import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

type Scope = { vendorId: string; liveId: string; versionId: string; startAt: Date; endAt: Date };
export type PlaybackIntakeFact = {
  id: string; issuedAt: Date; expiresAt: Date; lossAt: Date | null; renewalCount: bigint;
  sessionId: string | null; verifiedAt: Date | null; identityCurrent: boolean;
  closedAt: Date | null; complete: boolean | null;
};
export function classifyPlaybackIntake(row: PlaybackIntakeFact, scope: Pick<Scope, "startAt" | "endAt">, asOf: Date) {
  if (row.issuedAt >= scope.endAt) return "future_intake" as const;
  if (row.sessionId === null) {
    if (row.expiresAt <= scope.startAt) return "pre_window_expired" as const;
    return row.expiresAt > asOf ? "pending_session" as const : "missing_session" as const;
  }
  if (!row.identityCurrent || row.verifiedAt === null) return "identity_mismatch" as const;
  if (row.verifiedAt < scope.startAt || row.verifiedAt >= scope.endAt) return "outside_cohort" as const;
  if (row.closedAt === null) return "open_session" as const;
  return row.complete ? "closed_session" as const : "incomplete_session" as const;
}

/** Called ONLY inside the viewing audit's read-only primary RR transaction.
 * Enumerate the entire version, not just current sessions or unexpired leases.
 * A permanent quota loss still matters after its original intake expires.
 * The private authoritative revision detects RLS-filtered intake rows. This
 * proves visibility of recorded rows, never the universe of playback URLs.
 */
export async function inspectPlaybackIntakes(tx: Prisma.TransactionClient, scope: Scope,
  context: { asOf: Date; expectedRevision: bigint; epochStartedAt: Date | null },
  limits: { rows: number; pages: number; pageSize: number; outOfTime: () => boolean }) {
  const digest = createHash("sha256").update(JSON.stringify({ format: "playback-intake-inspection-v1", ...scope }));
  const outcomes = { future_intake: 0, pre_window_expired: 0, pending_session: 0, missing_session: 0, identity_mismatch: 0,
    outside_cohort: 0, open_session: 0, incomplete_session: 0, closed_session: 0 };
  let count = 0, quotaLosses = 0, revision = BigInt(0), cursor: string | null = null;
  let earliestLossAt: Date | null = null;
  for (let page = 0; page < limits.pages; page++) {
    if (limits.outOfTime()) return { status: "unavailable" as const, reason: "limit_exceeded" as const };
    const rows: PlaybackIntakeFact[] = await tx.$queryRaw<PlaybackIntakeFact[]>(Prisma.sql`
      SELECT * FROM public.wp20_metric_playback_intake_page(${scope.vendorId},${scope.liveId},${scope.versionId},${cursor}::text,${limits.pageSize + 1}::int)`);
    if (limits.outOfTime()) return { status: "unavailable" as const, reason: "limit_exceeded" as const };
    for (const row of rows.slice(0, limits.pageSize)) {
      if (++count > limits.rows) return { status: "unavailable" as const, reason: "limit_exceeded" as const };
      if (typeof row.renewalCount !== "bigint" || row.renewalCount < BigInt(0)) throw new Error("Invalid intake revision contribution");
      revision += BigInt(1) + row.renewalCount + (row.lossAt === null ? BigInt(0) : BigInt(1));
      outcomes[classifyPlaybackIntake(row, scope, context.asOf)]++;
      if (row.lossAt !== null && row.lossAt < scope.endAt) {
        quotaLosses++;
        if (earliestLossAt === null || row.lossAt < earliestLossAt) earliestLossAt = row.lossAt;
      }
      digest.update(JSON.stringify([row.id,row.issuedAt,row.expiresAt,row.lossAt,row.renewalCount.toString(),
        row.sessionId,row.verifiedAt,row.identityCurrent,row.closedAt,row.complete]) + "\n");
    }
    if (rows.length <= limits.pageSize) {
      if (revision !== context.expectedRevision) return { status: "unavailable" as const, reason: "intake_source_not_visible" as const };
      const sourceDigest = digest.update(JSON.stringify([revision.toString(),context.epochStartedAt])).digest("hex");
      return { status: "enumerated" as const, countCompleteness: "recorded_only" as const, outcomeScope: "whole_version" as const,
        count, quotaLosses, earliestLossAt, outcomes, revision, epochStartedAt: context.epochStartedAt,
        history: context.epochStartedAt !== null && context.epochStartedAt <= scope.startAt ? "intake_enabled" as const : "unknown" as const,
        pagesUsed: page + 1, asOf: context.asOf, digest: sourceDigest,
        classificationDigest: createHash("sha256").update(JSON.stringify([sourceDigest,context.asOf,outcomes,quotaLosses,earliestLossAt])).digest("hex") };
    }
    const last: PlaybackIntakeFact | undefined = rows[limits.pageSize - 1];
    if (!last || last.id === cursor) throw new Error("Intake audit cursor did not advance");
    cursor = last.id;
  }
  return { status: "unavailable" as const, reason: "limit_exceeded" as const };
}
