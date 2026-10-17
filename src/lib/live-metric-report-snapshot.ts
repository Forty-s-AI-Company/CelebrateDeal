import { readMetricCompletion, type StoredCompletion } from "./live-metric-completion-store";
import type { MetricScope } from "./live-core-metrics-read-model";
import { readMetricCoverage } from "./live-metric-coverage-reader";
import { Prisma, type PrismaClient } from "@prisma/client";
import { withMetricOrderRevision, MetricReadBudget, readMetricOrderPage, readMetricVisitLossPage, readMetricVisitPage, readMetricReportContext, readMetricRegistrationPage, readMetricSessionPage, readMetricSessionIntervals,
  type MetricOrderRow, type MetricVisitLossRow, type MetricVisitRow, type MetricReportContext, type MetricRegistrationRow, type MetricSessionRow, type MetricIntervalRow } from "./live-metric-report-reader";
import type { MetricReportLease } from "./live-metric-report-lease";
import { type MetricCoverage } from "./live-metric-coverage";

export type MetricViewingSnapshot = {
  scope: MetricScope;
  context: MetricReportContext;
  visitCoverage: MetricCoverage;
  registrationCoverage: MetricCoverage;
  viewingCoverage: MetricCoverage;
  orderCoverage: MetricCoverage;
  visitLosses: MetricVisitLossRow[];
  visits: MetricVisitRow[];
  orders: MetricOrderRow[];
  registrations: MetricRegistrationRow[];
  sessions: Array<{ registrationId: string; session: MetricSessionRow; intervals: MetricIntervalRow[] }>;
  deliveryComplete: boolean;
  completionProjection?: { rows: StoredCompletion[]; cohortCount: number } | null;
};
type FailureReason = "limit_exceeded" | "lease_or_scope_unavailable" | "registration_outside_cohort" | "identity_changed" | "window_not_closed";
class SnapshotUnavailable extends Error {
  constructor(readonly reason: FailureReason) { super(reason); }
}

/** Database I/O only: this does not run the CPU-heavy metric calculation.
 * All pages share one MVCC snapshot and one work budget. A failed page discards
 * the entire snapshot, while incomplete delivery remains explicit metadata.
 */
export async function loadMetricViewingSnapshot(db: Pick<PrismaClient, "$transaction">, lease: MetricReportLease,
  budget = new MetricReadBudget()): Promise<{ status: "available"; data: MetricViewingSnapshot } | { status: "unavailable"; reason: FailureReason }> {
  try {
    const data = await db.$transaction(async rawTx => withMetricOrderRevision(rawTx, lease, async tx => {
      // This timeout limits each SQL statement; the transaction timeout bounds
      // all statements together. Neither changes the immutable evidence.
      await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true)`);
      if (!budget.nextPage()) throw new SnapshotUnavailable("limit_exceeded");
      const context = await readMetricReportContext(tx, lease);
      if (context.status !== "available") throw new SnapshotUnavailable(context.reason);
      // Each metric depends on its own intake audit. A visits certificate
      // must never certify registration, playback or order history.
      const coverage = async (kind: "visits" | "registrations" | "viewing" | "orders") => {
        if (!budget.nextPage()) throw new SnapshotUnavailable("limit_exceeded");
        const audit = await readMetricCoverage(tx, lease, kind);
        if (audit.status !== "available") throw new SnapshotUnavailable(audit.reason);
        if (!budget.retain(audit.rowCount)) throw new SnapshotUnavailable("limit_exceeded");
        return audit.coverage;
      };
      const visitCoverage = await coverage("visits");
      const registrationCoverage = await coverage("registrations");
      const viewingCoverage = await coverage("viewing");
      const orderCoverage = await coverage("orders");
      const result: MetricViewingSnapshot = { scope: { vendorId: lease.vendorId, liveId: lease.liveId, contentVersionId: lease.versionId, mode: context.context.mode }, context: context.context, visitCoverage,
        registrationCoverage, viewingCoverage, orderCoverage,
        visitLosses: [], visits: [], orders: [], registrations: [], sessions: [], deliveryComplete: true };
      let afterLoss: Date | null = null;
      for (;;) {
        if (!budget.nextPage()) throw new SnapshotUnavailable("limit_exceeded");
        const page = await readMetricVisitLossPage(tx, { ...lease, after: afterLoss, take: 500 });
        if (page.status !== "available") throw new SnapshotUnavailable(page.reason);
        if (!budget.retain(page.rows.length)) throw new SnapshotUnavailable("limit_exceeded");
        result.visitLosses.push(...page.rows);
        if (!page.hasMore) break;
        afterLoss = page.next;
      }
      // A proven gap is decisive even while the collection-start audit is unknown.
      if (result.visitLosses.length) result.visitCoverage = { status: "unavailable", reason: "evidence_gap" };
      let after: { id: string; visitedAt: Date } | null = null;
      for (;;) {
        if (!budget.nextPage()) throw new SnapshotUnavailable("limit_exceeded");
        const page = await readMetricVisitPage(tx, { ...lease, after, take: 500 });
        if (page.status !== "available") throw new SnapshotUnavailable(page.reason);
        if (!budget.retain(page.rows.length)) throw new SnapshotUnavailable("limit_exceeded");
        result.visits.push(...page.rows);
        if (!page.hasMore) break;
        after = page.next;
      }
      let afterId: string | null = null;
      for (;;) {
        if (!budget.nextPage()) throw new SnapshotUnavailable("limit_exceeded");
        const page = await readMetricRegistrationPage(tx, { ...lease, afterId, take: 100 });
        if (page.status !== "available") throw new SnapshotUnavailable(page.reason);
        if (!budget.retain(page.rows.length)) throw new SnapshotUnavailable("limit_exceeded");
        for (const registration of page.rows) {
          if (!registration.identityCurrent) throw new SnapshotUnavailable("identity_changed");
          result.registrations.push(registration);
          await appendRegistrationSessions(tx, lease, registration.id, budget, result);
        }
        if (!page.hasMore) break;
        afterId = page.nextId;
      }
      let afterOrder: string | null = null;
      for (;;) {
        if (!budget.nextPage()) throw new SnapshotUnavailable("limit_exceeded");
        const page = await readMetricOrderPage(tx, { ...lease, afterId: afterOrder, take: 500 });
        if (page.status !== "available") throw new SnapshotUnavailable(page.reason);
        if (!budget.retain(page.rows.length)) throw new SnapshotUnavailable("limit_exceeded");
        result.orders.push(...page.rows);
        if (!page.hasMore) {
          result.completionProjection = await loadCompletion(tx, lease, budget);
          return result;
        }
        afterOrder = page.nextId;
      }
    }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000, maxWait: 5000 });
    return { status: "available", data };
  } catch (error) {
    if (error instanceof SnapshotUnavailable) return { status: "unavailable", reason: error.reason };
    // Infrastructure failures propagate to the job runner. They are never
    // converted into an empty cohort or a successfully calculated zero.
    throw error;
  }
}

async function appendRegistrationSessions(tx: Pick<Prisma.TransactionClient, "$queryRaw">, lease: MetricReportLease, registrationId: string,
  budget: MetricReadBudget, result: MetricViewingSnapshot) {
  let afterId: string | null = null;
  for (;;) {
    if (!budget.nextPage()) throw new SnapshotUnavailable("limit_exceeded");
    const page = await readMetricSessionPage(tx, { ...lease, registrationId, afterId, take: 100 });
    if (page.status !== "available") throw new SnapshotUnavailable(page.reason);
    if (!budget.retain(page.rows.length)) throw new SnapshotUnavailable("limit_exceeded");
    for (const session of page.rows) {
      const intervals = await readMetricSessionIntervals(tx, { ...lease, sessionId: session.id }, budget);
      if (intervals.status !== "available") throw new SnapshotUnavailable(intervals.reason);
      if (intervals.registrationId !== registrationId) throw new SnapshotUnavailable("identity_changed");
      result.sessions.push({ registrationId, session, intervals: intervals.rows });
      result.deliveryComplete &&= intervals.deliveryComplete;
    }
    if (!page.hasMore) return;
    afterId = page.nextId;
  }
}


async function loadCompletion(tx: Pick<Prisma.TransactionClient, "$queryRaw">, lease: MetricReportLease, budget: MetricReadBudget) {
  if (!budget.nextPage()) throw new SnapshotUnavailable("limit_exceeded");
  // Reserve a second query slot conservatively, including an absent manifest.
  const completion = await readMetricCompletion(tx, lease, rows => budget.nextPage() && budget.retain(rows));
  if (completion.status !== "available") throw new SnapshotUnavailable(completion.reason);
  return completion.rows === null ? null : { rows: completion.rows, cohortCount: completion.cohortCount! };
}
