import type { CoreMetricsInput } from "./live-core-metrics-read-model";
import type { MetricViewingSnapshot } from "./live-metric-report-snapshot";

/** Pure conversion for the isolated calculator worker. Scope comes from the
 * leased snapshot, never from a second caller-selected tenant. Coverage and
 * delivery are separate requirements; neither can stand in for the other.
 */
export function metricSnapshotInput(snapshot: MetricViewingSnapshot): CoreMetricsInput {
  const { scope, context } = snapshot;
  const registrationsComplete = snapshot.registrationCoverage.status === "complete";
  const viewingComplete = registrationsComplete && snapshot.viewingCoverage.status === "complete" && snapshot.deliveryComplete;
  if (snapshot.registrations.some(row => !row.identityCurrent)) throw new Error("Metric snapshot identity unavailable");
  const people = new Set(snapshot.registrations.map(row => row.id));
  if (snapshot.sessions.some(row => !people.has(row.registrationId))) throw new Error("Metric snapshot identity unavailable");
  const projection = snapshot.completionProjection ?? null;
  if (projection && (projection.cohortCount !== people.size || projection.rows.some(row => !people.has(row.personId))))
    throw new Error("Metric completion cohort unavailable");
  return {
    scope, startMs: context.windowStartAt.getTime(), endMs: context.windowEndAt.getTime(), durationMs: context.durationMs,
    visits: snapshot.visitCoverage.status === "complete" ? snapshot.visits.map(row => ({ scope, browserId: row.visitorId, visitedAtMs: row.visitedAt.getTime() })) : null,
    registrations: registrationsComplete ? snapshot.registrations.map(row => ({ scope, personId: row.id,
      browserId: row.visitorId, verifiedAtMs: row.verifiedAt.getTime() })) : null,
    viewing: viewingComplete ? snapshot.sessions.flatMap(row => row.intervals.map(interval => ({ scope,
      personId: row.registrationId, wallStartMs: interval.wallStartAt.getTime(), wallEndMs: interval.wallEndAt.getTime(),
      mediaStartMs: interval.mediaStartMs, mediaEndMs: interval.mediaEndMs }))) : null,
    // Completion requires durable first-crossing provenance from the SAME
    // snapshot. A certificate alone cannot turn absence into [].
    completions: viewingComplete && projection ? projection.rows.map(row => ({ scope, ...row })) : null,
    orders: snapshot.orderCoverage.status === "complete" ? snapshot.orders.map(row => ({ scope, personId: row.registrationId,
      establishedAtMs: row.establishedAt.getTime(), cancelled: row.cancelled })) : null,
  };
}
