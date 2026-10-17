import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { MetricReportLease } from "./live-metric-report-lease";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Request = z.object({ vendorId: id, liveId: id, versionId: id, reportId: id, workerId: id,
  sessionId: id, afterSequence: z.number().int().min(-1).max(2_147_483_647), take: z.number().int().min(1).max(500) }).strict();
type ReadRequest = MetricReportLease & { sessionId: string; afterSequence: number; take: number };
export type MetricIntervalRow = { sequence: number; wallStartAt: Date; wallEndAt: Date; mediaStartMs: number; mediaEndMs: number };
type SessionState = { isolation: string; registrationId: string; lastSequence: number; complete: boolean; closedAt: Date | null };
const CohortRequest = Request.omit({ sessionId: true, afterSequence: true }).extend({ afterId: id.nullable() }).strict();
export type MetricRegistrationRow = { id: string; visitorId: string | null; verifiedAt: Date; identityCurrent: boolean };
export type MetricSessionRow = { id: string; anchorAt: Date; expiresAt: Date; closedAt: Date | null; complete: boolean; lastSequence: number };
const SessionPageRequest = CohortRequest.extend({ registrationId: id }).strict();
const LossRequest = CohortRequest.omit({ afterId: true }).extend({ after: z.date().nullable() }).strict();
export type MetricVisitLossRow = { visitedAt: Date };

/** The composite key makes timestamps unique within this exact version scope.
 * Read loss provenance under the same report lease/MVCC snapshot as live facts.
 */
export async function readMetricVisitLossPage(tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  value: MetricReportLease & { after: Date | null; take: number }) {
  const input = LossRequest.parse(value);
  const report = await reportSnapshot(tx, input);
  if (!report) return { status: "unavailable" as const, reason: "lease_or_scope_unavailable" as const };
  const cursor = input.after === null ? Prisma.empty : Prisma.sql`AND "visitedAt">${input.after}`;
  const rows = await tx.$queryRaw<MetricVisitLossRow[]>(Prisma.sql`
    SELECT "visitedAt" FROM "LiveMetricVisitLoss" WHERE "vendorId"=${input.vendorId} AND "liveId"=${input.liveId}
      AND "versionId"=${input.versionId} AND "visitedAt">=${report.windowStartAt} AND "visitedAt"<${report.windowEndAt} ${cursor}
    ORDER BY "visitedAt" LIMIT ${input.take + 1}`);
  const page = rows.slice(0, input.take);
  return { status: "available" as const, rows: page, hasMore: rows.length > input.take, next: page.at(-1)?.visitedAt ?? input.after };
}
export type MetricVisitRow = { id: string; visitorId: string; visitedAt: Date };
type VisitCursor = { id: string; visitedAt: Date };
const VisitRequest = CohortRequest.omit({ afterId: true }).extend({
  after: z.object({ id: z.string().uuid(), visitedAt: z.date() }).strict().nullable(),
}).strict();

/** Registration-page facts only, with server-selected source and the same
 * prepared first-party visitor. Unknown/legacy and viewer page visits cannot
 * establish a registration denominator. Preserve repeated facts for the
 * metric calculation's browser deduplication. No browser hashes leave here.
 */
export async function readMetricVisitPage(tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  value: MetricReportLease & { after: VisitCursor | null; take: number }) {
  const input = VisitRequest.parse(value);
  const report = await reportSnapshot(tx, input);
  if (!report) return { status: "unavailable" as const, reason: "lease_or_scope_unavailable" as const };
  const cursor = input.after === null ? Prisma.empty : Prisma.sql`AND (v."visitedAt",v.id)>(${input.after.visitedAt},${input.after.id})`;
  const rows = await tx.$queryRaw<MetricVisitRow[]>(Prisma.sql`
    SELECT v.id,v."visitorId",v."visitedAt" FROM "LiveMetricVisit" v
    JOIN "LiveMetricVisitPage" p ON p."vendorId"=v."vendorId" AND p."liveId"=v."liveId"
      AND p."versionId"=v."versionId" AND p."eventId"=v."eventId" AND p."sourceKind"='registration'
      AND p."sourceFormId" IS NOT NULL
    JOIN "LiveMetricVisitIntent" i ON i."vendorId"=v."vendorId" AND i."liveId"=v."liveId"
      AND i."versionId"=v."versionId" AND i."eventId"=v."eventId" AND i."visitorId"=v."visitorId"
    WHERE v."vendorId"=${input.vendorId} AND v."liveId"=${input.liveId} AND v."versionId"=${input.versionId}
      AND v."visitedAt">=${report.windowStartAt} AND v."visitedAt"<${report.windowEndAt} ${cursor}
    ORDER BY v."visitedAt",v.id LIMIT ${input.take + 1}`);
  const page = rows.slice(0, input.take);
  const last = page.at(-1);
  return { status: "available" as const, rows: page, hasMore: rows.length > input.take,
    next: last ? { id: last.id, visitedAt: last.visitedAt } : input.after };
}
export type MetricReportContext = {
  sourceRevision?: bigint;
  windowStartAt: Date; windowEndAt: Date; mode: "live" | "replay";
  durationMs: number | null; collectionEnabled: boolean; collectionStartedAt: Date | null;
};
const LeaseRequest = z.object({ vendorId: id, liveId: id, versionId: id, reportId: id, workerId: id }).strict();

type ReadClient = Pick<Prisma.TransactionClient, "$queryRaw">;
const snapshotRevisions = new WeakMap<ReadClient, { vendorId: string; liveId: string; versionId: string; reportId: string; revision: bigint }>();

/** Own a fresh facade for exactly one read-only RR callback. The private cache
 * cannot be supplied by callers, reused on the original client, or survive the
 * callback. Lease expiry is still checked against the DB clock on every page.
 */
export async function withMetricOrderRevision<T>(tx: ReadClient, value: MetricReportLease,
  read: (snapshot: ReadClient) => Promise<T>): Promise<T> {
  const scope = LeaseRequest.parse(value);
  await tx.$queryRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
  const [state] = await tx.$queryRaw<{ isolation: string; readOnly: string; revision: bigint }[]>(Prisma.sql`
    SELECT current_setting('transaction_isolation') AS isolation,
      current_setting('transaction_read_only') AS "readOnly",
      public.wp20_metric_order_window_revision(${scope.vendorId},r."windowStartAt",r."windowEndAt") AS revision
      FROM "LiveMetricReport" r WHERE r.id=${scope.reportId} AND r."vendorId"=${scope.vendorId}
        AND r."liveId"=${scope.liveId} AND r."versionId"=${scope.versionId}`);
  if (!state || state.isolation !== "repeatable read" || state.readOnly !== "on"
    || typeof state.revision !== "bigint" || state.revision < BigInt(0)) throw new Error("Metric revision requires read-only repeatable-read snapshot");
  const snapshot: ReadClient = { $queryRaw: tx.$queryRaw.bind(tx) };
  snapshotRevisions.set(snapshot, { vendorId: scope.vendorId, liveId: scope.liveId, versionId: scope.versionId, reportId: scope.reportId, revision: state.revision });
  try { return await read(snapshot); }
  finally { snapshotRevisions.delete(snapshot); }
}

function orderRevision(tx: ReadClient, scope: Pick<MetricReportLease, "vendorId" | "liveId" | "versionId" | "reportId">) {
  const cached = snapshotRevisions.get(tx);
  return cached && cached.vendorId === scope.vendorId && cached.liveId === scope.liveId && cached.versionId === scope.versionId && cached.reportId === scope.reportId
    ? Prisma.sql`${cached.revision}::bigint`
    : Prisma.sql`public.wp20_metric_order_window_revision(r."vendorId",r."windowStartAt",r."windowEndAt")`;
}


/** Read configuration in the same MVCC snapshot as the facts. Collection start
 * is provenance only: it does not prove uninterrupted or complete collection.
 */
export async function readMetricReportContext(tx: Pick<Prisma.TransactionClient, "$queryRaw">, value: MetricReportLease) {
  const report = await reportSnapshot(tx, LeaseRequest.parse(value));
  if (!report) return { status: "unavailable" as const, reason: "lease_or_scope_unavailable" as const };
  const { windowStartAt, windowEndAt, mode, durationMs, collectionEnabled, collectionStartedAt, sourceRevision } = report;
  return { status: "available" as const, context: { windowStartAt, windowEndAt, mode, durationMs, collectionEnabled, collectionStartedAt, sourceRevision } };
}

export type MetricOrderRow = { id: string; registrationId: string; establishedAt: Date; cancelled: boolean };

/** Resolve only server-owned checkout attribution, never buyer PII. Read the
 * current order state in the report snapshot so cancellations cannot be mixed
 * with historical paid events. Drafts are not established orders.
 */
export async function readMetricOrderPage(tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  value: MetricReportLease & { afterId: string | null; take: number }) {
  const input = CohortRequest.parse(value);
  const report = await reportSnapshot(tx, input);
  if (!report) return { status: "unavailable" as const, reason: "lease_or_scope_unavailable" as const };
  const cursor = input.afterId === null ? Prisma.empty : Prisma.sql`AND o.id>${input.afterId}`;
  const rows = await tx.$queryRaw<MetricOrderRow[]>(Prisma.sql`
    SELECT o.id,g.id AS "registrationId",o."createdAt" AT TIME ZONE 'UTC' AS "establishedAt",
      (o.status='cancelled') AS cancelled
    FROM "CommerceOrder" o JOIN "PaymentTransaction" p ON p.id=o."primaryPaymentTransactionId" AND p."vendorId"=o."vendorId"
    JOIN "LiveMetricRegistration" g ON g."vendorId"=o."vendorId" AND g."liveId"=${input.liveId}
      AND g."versionId"=${input.versionId} AND g."submissionId"=p.metadata->>'formSubmissionId'
    JOIN "FormSubmission" f ON f.id=g."submissionId" AND f."liveId"=g."liveId"
    JOIN "RegistrationForm" form ON form.id=f."formId" AND form."vendorId"=g."vendorId"
    JOIN "Live" l ON l.id=g."liveId" AND l."vendorId"=g."vendorId" AND l."formId"=f."formId"
    WHERE o."vendorId"=${input.vendorId} AND p.metadata->>'sourceLiveId'=${input.liveId}
      AND p.metadata->>'billingPurpose'='buyer_order' AND o.status<>'draft'
      AND f."verificationStatus"='VERIFIED' AND g."verifiedAt"=f."verifiedAt" AT TIME ZONE 'UTC'
      AND g."verifiedAt">=${report.windowStartAt} AND g."verifiedAt"<${report.windowEndAt}
      AND o."createdAt">=(${report.windowStartAt}::timestamptz AT TIME ZONE 'UTC')
      AND o."createdAt"<(${report.windowEndAt}::timestamptz AT TIME ZONE 'UTC') ${cursor}
    ORDER BY o.id LIMIT ${input.take + 1}`);
  const page = rows.slice(0, input.take);
  return { status: "available" as const, rows: page, hasMore: rows.length > input.take, nextId: page.at(-1)?.id ?? input.afterId };
}

/** Enumerate all potentially overlapping sessions, including incomplete ones.
 * The worker must account for unknown delivery, not filter it into zero views.
 */
export async function readMetricSessionPage(tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  value: MetricReportLease & { registrationId: string; afterId: string | null; take: number }) {
  const input = SessionPageRequest.parse(value);
  const report = await reportSnapshot(tx, input);
  if (!report) return { status: "unavailable" as const, reason: "lease_or_scope_unavailable" as const };
  const [registration] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM "LiveMetricRegistration" WHERE id=${input.registrationId} AND "vendorId"=${input.vendorId}
      AND "liveId"=${input.liveId} AND "versionId"=${input.versionId}
      AND "verifiedAt">=${report.windowStartAt} AND "verifiedAt"<${report.windowEndAt}`);
  if (!registration) return { status: "unavailable" as const, reason: "registration_outside_cohort" as const };
  const cursor = input.afterId === null ? Prisma.empty : Prisma.sql`AND id>${input.afterId}`;
  const rows = await tx.$queryRaw<MetricSessionRow[]>(Prisma.sql`
    SELECT id,"anchorAt","expiresAt","closedAt",complete,"lastSequence" FROM "LiveMetricSession"
    WHERE "vendorId"=${input.vendorId} AND "liveId"=${input.liveId} AND "versionId"=${input.versionId}
      AND "registrationId"=${input.registrationId} AND "anchorAt"<${report.windowEndAt} AND "expiresAt">${report.windowStartAt} ${cursor}
    ORDER BY id ASC LIMIT ${input.take + 1}`);
  const page = rows.slice(0, input.take);
  return { status: "available" as const, rows: page, hasMore: rows.length > input.take, nextId: page.at(-1)?.id ?? input.afterId };
}

async function reportSnapshot(tx: Pick<Prisma.TransactionClient, "$queryRaw">, input: MetricReportLease) {
  const [report] = await tx.$queryRaw<(MetricReportContext & { isolation: string })[]>(Prisma.sql`
    SELECT current_setting('transaction_isolation') AS isolation,r."windowStartAt",r."windowEndAt",
      v.mode,v."durationMs",v."collectionEnabled",v."collectionStartedAt",r."inputRevision" AS "sourceRevision"
    FROM "LiveMetricReport" r JOIN "LiveMetricVersion" v ON v.id=r."versionId" AND v."vendorId"=r."vendorId" AND v."liveId"=r."liveId"
    WHERE r.id=${input.reportId} AND r."vendorId"=${input.vendorId} AND r."liveId"=${input.liveId} AND r."versionId"=${input.versionId}
      AND r.status='running' AND r."leaseOwner"=${input.workerId} AND r."leaseExpiresAt">clock_timestamp()
      AND r."expiresAt">clock_timestamp() AND r."inputRevision"=v."sourceRevision"
      AND r."inputRegistrationRevision"=public.wp20_metric_registration_revision(r."vendorId",r."liveId")
      AND r."inputOrderTenantRevision"=${orderRevision(tx, input)}
      AND r."inputOrderRevision"=${orderRevision(tx, input)}`);
  if (report && report.isolation !== "repeatable read") throw new Error("Metric reader requires repeatable-read snapshot");
  return report ?? null;
}

/** Enumerate the report's verified-at cohort, not every registration ever seen.
 * Keep contradicted identity facts visible to the adapter as an invalidation
 * signal; silently excluding them would change the denominator.
 */
export async function readMetricRegistrationPage(tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  value: MetricReportLease & { afterId: string | null; take: number }) {
  const input = CohortRequest.parse(value);
  const report = await reportSnapshot(tx, input);
  if (!report) return { status: "unavailable" as const, reason: "lease_or_scope_unavailable" as const };
  const cursor = input.afterId === null ? Prisma.empty : Prisma.sql`AND g.id>${input.afterId}`;
  const rows = await tx.$queryRaw<MetricRegistrationRow[]>(Prisma.sql`
    SELECT g.id,g."visitorId",g."verifiedAt",
      coalesce(f."verificationStatus"='VERIFIED' AND f."verifiedAt"=(g."verifiedAt" AT TIME ZONE 'UTC')
        AND f."liveId"=g."liveId" AND f."formId"=l."formId",false) AS "identityCurrent"
    FROM "LiveMetricRegistration" g
    JOIN "Live" l ON l.id=g."liveId" AND l."vendorId"=g."vendorId"
    LEFT JOIN "FormSubmission" f ON f.id=g."submissionId"
    WHERE g."vendorId"=${input.vendorId} AND g."liveId"=${input.liveId} AND g."versionId"=${input.versionId}
      AND g."verifiedAt">=${report.windowStartAt} AND g."verifiedAt"<${report.windowEndAt} ${cursor}
    ORDER BY g.id ASC LIMIT ${input.take + 1}`);
  const page = rows.slice(0, input.take);
  return { status: "available" as const, rows: page, hasMore: rows.length > input.take, nextId: page.at(-1)?.id ?? input.afterId };
}

/** Shared by all sessions in one report, not reset per person/page. These are
 * work limits, not sampling or truncation rules. The caller must also bound the
 * database transaction timeout because a budget cannot cancel an active query.
 */
export class MetricReadBudget {
  private rows = 0;
  private pages = 0;
  private readonly started: number;
  constructor(private readonly limits = { rows: 1_000_000, pages: 4000, milliseconds: 30000 }, private readonly now = () => performance.now()) {
    if (!Number.isSafeInteger(limits.rows) || limits.rows < 1 || limits.rows > 1_000_000
      || !Number.isSafeInteger(limits.pages) || limits.pages < 1 || limits.pages > 4000
      || !Number.isSafeInteger(limits.milliseconds) || limits.milliseconds < 1 || limits.milliseconds > 30000) throw new Error("Invalid metric read budget");
    this.started = now();
  }
  active() { const elapsed = this.now() - this.started; return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < this.limits.milliseconds; }
  nextPage() { if (!this.active() || this.pages >= this.limits.pages) return false; this.pages++; return true; }
  retain(count: number) {
    if (!Number.isSafeInteger(count) || count < 0 || !this.active() || count > this.limits.rows - this.rows) return false;
    this.rows += count; return true;
  }
}

export async function readMetricSessionIntervals(tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  value: Omit<ReadRequest, "afterSequence" | "take">, budget: MetricReadBudget) {
  const rows: MetricIntervalRow[] = [];
  let afterSequence = -1;
  while (budget.nextPage()) {
    const page = await readMetricIntervalPage(tx, { ...value, afterSequence, take: 500 });
    if (page.status !== "available") return page;
    if (!budget.retain(page.rows.length)) break;
    rows.push(...page.rows);
    if (!page.hasMore) return { status: "available" as const, rows, registrationId: page.registrationId, deliveryComplete: page.deliveryComplete };
    afterSequence = page.nextSequence;
  }
  // Do not leak a prefix as if it represented all viewing for this session.
  return { status: "unavailable" as const, reason: "limit_exceeded" as const };
}

/** Read one indexed session/sequence page inside the worker's repeatable-read
 * snapshot. Never use OFFSET or an unbounded cohort query. Claim/finish happen
 * in separate read-committed transactions, as required by the write guards.
 */
export async function readMetricIntervalPage(tx: Pick<Prisma.TransactionClient, "$queryRaw">, value: ReadRequest) {
  const input = Request.parse(value);
  const [session] = await tx.$queryRaw<SessionState[]>(Prisma.sql`
    SELECT current_setting('transaction_isolation') AS isolation, s."registrationId",s."lastSequence",s.complete,s."closedAt"
    FROM "LiveMetricSession" s
    JOIN "LiveMetricReport" r ON r."vendorId"=s."vendorId" AND r."liveId"=s."liveId" AND r."versionId"=s."versionId"
    JOIN "LiveMetricVersion" v ON v.id=r."versionId" AND v."vendorId"=r."vendorId" AND v."liveId"=r."liveId"
    WHERE s.id=${input.sessionId} AND s."vendorId"=${input.vendorId} AND s."liveId"=${input.liveId} AND s."versionId"=${input.versionId}
      AND r.id=${input.reportId} AND r.status='running' AND r."leaseOwner"=${input.workerId}
      AND r."leaseExpiresAt">clock_timestamp() AND r."expiresAt">clock_timestamp()
      AND r."inputRevision"=v."sourceRevision"
      AND r."inputRegistrationRevision"=public.wp20_metric_registration_revision(r."vendorId",r."liveId")
      AND r."inputOrderTenantRevision"=${orderRevision(tx, input)}
      AND r."inputOrderRevision"=${orderRevision(tx, input)}`);
  if (!session) return { status: "unavailable" as const, reason: "lease_or_scope_unavailable" as const };
  if (session.isolation !== "repeatable read") throw new Error("Metric reader requires repeatable-read snapshot");
  if (input.afterSequence > session.lastSequence) throw new Error("Metric cursor exceeds snapshot");
  const rows = await tx.$queryRaw<MetricIntervalRow[]>(Prisma.sql`
    SELECT sequence,"wallStartAt","wallEndAt","mediaStartMs","mediaEndMs" FROM "LiveMetricInterval"
    WHERE "sessionId"=${input.sessionId} AND "vendorId"=${input.vendorId} AND "liveId"=${input.liveId} AND "versionId"=${input.versionId}
      AND sequence>${input.afterSequence} ORDER BY sequence ASC LIMIT ${input.take + 1}`);
  if (rows.length > input.take + 1 || rows.some((row, index) => row.sequence !== input.afterSequence + index + 1)) throw new Error("Metric interval snapshot is inconsistent");
  const hasMore = rows.length > input.take;
  const page = rows.slice(0, input.take);
  const nextSequence = page.at(-1)?.sequence ?? input.afterSequence;
  if (!hasMore && nextSequence !== session.lastSequence) throw new Error("Metric interval snapshot is incomplete");
  return { status: "available" as const, registrationId: session.registrationId, rows: page, nextSequence, hasMore,
    // Complete pagination and complete delivery are different facts.
    deliveryComplete: session.complete && session.closedAt !== null };
}

/** Read only a current completed aggregate for an already-authorized scope.
 * This is not an HTTP authorization boundary. Stored status alone is insufficient
 * because Serializable payment writes invalidate generation without touching reports.
 */
export async function readMetricReadyReport(db: Pick<Prisma.TransactionClient, "$queryRaw">,
  value: Omit<MetricReportLease, "workerId">) {
  const input = LeaseRequest.omit({ workerId: true }).parse(value);
  const [report] = await db.$queryRaw<{ result: Prisma.JsonValue }[]>(Prisma.sql`
    SELECT r.result FROM "LiveMetricReport" r
    JOIN "LiveMetricVersion" v ON v.id=r."versionId" AND v."vendorId"=r."vendorId" AND v."liveId"=r."liveId"
    WHERE r.id=${input.reportId} AND r."vendorId"=${input.vendorId} AND r."liveId"=${input.liveId}
      AND r."versionId"=${input.versionId} AND r.status='ready' AND r."expiresAt">clock_timestamp()
      AND r."inputRevision"=v."sourceRevision"
      AND r."inputRegistrationRevision"=public.wp20_metric_registration_revision(r."vendorId",r."liveId")
      AND r."inputOrderTenantRevision"=public.wp20_metric_order_window_revision(r."vendorId",r."windowStartAt",r."windowEndAt")
      AND r."inputOrderRevision"=public.wp20_metric_order_window_revision(r."vendorId",r."windowStartAt",r."windowEndAt")`);
  return report ? { status: "available" as const, result: report.result }
    : { status: "unavailable" as const, reason: "report_not_current" as const };
}
