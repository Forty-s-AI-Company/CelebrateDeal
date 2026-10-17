import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assessMetricCoverage } from "./live-metric-coverage";
import { readMetricReportContext } from "./live-metric-report-reader";
import type { MetricReportLease } from "./live-metric-report-lease";
import {reconcileMetricVisitSources} from './live-metric-visit-reconciliation';
import {withMetricReadVisibility} from './live-metric-read-visibility';

const Kind = z.enum(["visits", "registrations", "viewing", "orders"]);
const VisitReceipt=z.object({format:z.literal(1),runId:z.string().uuid(),manifestHash:z.string().regex(/^[a-f0-9]{64}$/),
 gatewayId:z.string().uuid(),frameDigest:z.string().regex(/^[a-f0-9]{64}$/),closedAt:z.string().datetime(),
 settlementFailures:z.literal(0),admissionFailures:z.literal(0),pendingFrames:z.literal(0)}).strict();
type AuditRow = { auditDigest?:string; ingressRunId?:string|null; ingressProofVersion?:number|null;
 viewingRevision?:bigint|null; intakeRevision?:bigint|null; registrationRevision?:bigint|null;
 currentViewingRevision?:bigint; currentIntakeRevision?:bigint; currentRegistrationRevision?:bigint; ingressReceipt?:unknown; ingressEligible?:boolean; status: "covered" | "gap"; startAt: Date; endAt: Date };

/** Caller supplies the same RepeatableRead transaction used for report facts.
 * Old positive certificates expire on structural revision changes; known gaps
 * remain evidence of loss. No audit rows means unknown, never an audited zero.
 * Visits require a typed fixed-local-ingress proof and matching source digest.
 * Viewing requires terminal delivery plus immutable ledger revision bindings.
 * Legacy positive flags certify neither kind.
 */
export async function readMetricCoverage(tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  lease: MetricReportLease, value: z.infer<typeof Kind>) {
  const kind = Kind.parse(value);
  const context = await readMetricReportContext(tx, lease);
  if (context.status !== "available") return context;
  const rows = await withMetricReadVisibility(tx,()=>tx.$queryRaw<AuditRow[]>(Prisma.sql`
    WITH revisions AS MATERIALIZED (
      SELECT
        CASE WHEN ${kind} IN ('registrations','orders','viewing') THEN
          public.wp20_metric_registration_revision(${lease.vendorId},${lease.liveId}) END AS registration,
        CASE WHEN ${kind}='orders' THEN public.wp20_metric_order_window_revision(${lease.vendorId},${context.context.windowStartAt},${context.context.windowEndAt}) END AS orders,
        CASE WHEN ${kind}='viewing' THEN public.wp20_metric_viewing_revision(${lease.vendorId},${lease.liveId},${lease.versionId}) END AS viewing,
        CASE WHEN ${kind}='viewing' THEN public.wp20_metric_playback_intake_revision(${lease.vendorId},${lease.liveId},${lease.versionId}) END AS intake
    )
    SELECT a.status,a."startAt",a."endAt",a."auditDigest",a."ingressRunId",a."ingressProofVersion",a."ingressReceipt",a."viewingRevision",a."intakeRevision",a."registrationRevision",
      revisions.viewing AS "currentViewingRevision",revisions.intake AS "currentIntakeRevision",revisions.registration AS "currentRegistrationRevision",
      CASE WHEN a.kind='visits' AND a.status='covered' AND a."ingressProofVersion"=1 THEN
       public.wp20_metric_visits_proof_ready(a."vendorId",a."liveId",a."versionId",a."ingressRunId",a."startAt",a."endAt",a."ingressReceipt")
       WHEN a.kind='viewing' AND a.status='covered' AND a."ingressProofVersion"=2 THEN
        public.wp20_metric_viewing_proof_ready(a."vendorId",a."liveId",a."versionId",a."ingressRunId",a."startAt",a."endAt",a."ingressReceipt",a."viewingRevision",a."intakeRevision",a."registrationRevision")
       ELSE FALSE END AS "ingressEligible" FROM "LiveMetricCoverageAudit" a
    CROSS JOIN revisions
    JOIN "LiveMetricVersion" v ON v.id=a."versionId" AND v."vendorId"=a."vendorId" AND v."liveId"=a."liveId"
    WHERE a."vendorId"=${lease.vendorId} AND a."liveId"=${lease.liveId} AND a."versionId"=${lease.versionId}
      AND a.kind=${kind} AND (a.status='gap' OR (a.kind IN ('visits','registrations','viewing','orders') AND a."sourceRevision"=v."sourceRevision"
        AND (a.kind<>'viewing' OR (a."viewingRevision"=revisions.viewing AND a."intakeRevision"=revisions.intake AND a."registrationRevision"=revisions.registration))
        AND (a.kind<>'registrations' OR (a."registrationCount" IS NOT NULL
          AND a."registrationRevision"=revisions.registration))
        AND (a.kind<>'orders' OR (a."orderCount" IS NOT NULL AND a."orderProofVersion"=2
          AND a."orderRevision"=(CASE WHEN a."startAt"=${context.context.windowStartAt} AND a."endAt"=${context.context.windowEndAt} THEN revisions.orders ELSE public.wp20_metric_order_window_revision(a."vendorId",a."startAt",a."endAt") END)
          AND a."orderTenantRevision"=(CASE WHEN a."startAt"=${context.context.windowStartAt} AND a."endAt"=${context.context.windowEndAt} THEN revisions.orders ELSE public.wp20_metric_order_window_revision(a."vendorId",a."startAt",a."endAt") END)
          AND a."orderRegistrationRevision"=revisions.registration))))
      AND a."startAt"<${context.context.windowEndAt} AND a."endAt">${context.context.windowStartAt}
    ORDER BY a."startAt",a."endAt",a.id LIMIT 10001`));
  if (rows.length > 10000) return { status: "unavailable" as const, reason: "limit_exceeded" as const };
  // Keep the trust boundary in TS too: a future SQL regression must not turn
  // an unsupported positive flag into certified coverage. Gaps always survive.
  let accepted = rows.filter(row => row.status === "gap" || kind === "registrations" || kind === "orders");
  if(kind==='viewing')accepted=accepted.concat(rows.filter(row=>isIngressProof(row,context.context,2)
    &&typeof row.viewingRevision==='bigint'&&row.viewingRevision>=BigInt(0)&&row.viewingRevision===row.currentViewingRevision
    &&typeof row.intakeRevision==='bigint'&&row.intakeRevision>=BigInt(0)&&row.intakeRevision===row.currentIntakeRevision
    &&typeof row.registrationRevision==='bigint'&&row.registrationRevision>=BigInt(0)&&row.registrationRevision===row.currentRegistrationRevision));
  const scope = { vendorId: lease.vendorId, liveId: lease.liveId, contentVersionId: lease.versionId, mode: context.context.mode };
  const ranges = (status: AuditRow["status"]) => accepted.filter(row => row.status === status)
    .map(row => ({ scope, kind, startMs: row.startAt.getTime(), endMs: row.endAt.getTime() }));
  let coverage=assessMetricCoverage({ scope, kind, startMs: context.context.windowStartAt.getTime(),
      endMs: context.context.windowEndAt.getTime(), covered: accepted.length ? ranges("covered") : null,
      gaps: accepted.length ? ranges("gap") : null });
  const auditGap=coverage.status==='unavailable'&&coverage.reason==='evidence_gap';
  // A known negative result needs no expensive source scan. In particular,
  // an unrelated source SQL timeout must not erase this existing audit gap.
  if(kind==='visits'&&auditGap)return {status:'available' as const,rowCount:accepted.length,coverage,
    sourceReconciliation:{status:'not_read' as const,reason:'known_audit_gap' as const}};
  const sources=kind==='visits'?await reconcileMetricVisitSources(tx,{vendorId:lease.vendorId,liveId:lease.liveId,
    versionId:lease.versionId,startAt:context.context.windowStartAt,endAt:context.context.windowEndAt}):null;
  if(sources?.status==='unavailable')return sources;
  const availableSource=sources?.status==='available'?sources:null;
  if(kind==='visits'&&availableSource){
    // The SQL guard checks durable scope/frontier/receipt. Independently reject
    // legacy flags and a digest that differs from THESE same-snapshot facts.
    // This fixed local proof certifies its exact report window; do not union
    // certificates whose digests were computed for a different window.
    accepted=accepted.concat(rows.filter(row=>{
      return isIngressProof(row,context.context,1)&&row.auditDigest===availableSource.sourceDigest;
    }));
    coverage=assessMetricCoverage({scope,kind,startMs:context.context.windowStartAt.getTime(),
      endMs:context.context.windowEndAt.getTime(),covered:accepted.length?ranges('covered'):null,gaps:accepted.length?ranges('gap'):null});
  }

  // rowCount is total retained audit + source rows for the snapshot budget.
  return {status:'available' as const,rowCount:accepted.length+(availableSource?.rowCount??0),
    coverage:availableSource?.coverage.reason==='evidence_gap'?availableSource.coverage:coverage,
    ...(sources?{sourceReconciliation:sources}:{})};
}


function isIngressProof(row:AuditRow,window:{windowStartAt:Date;windowEndAt:Date},format:1|2){
 const receipt=VisitReceipt.safeParse(row.ingressReceipt);
 return row.status==='covered'&&row.ingressEligible===true&&row.ingressProofVersion===format
  &&row.startAt.getTime()===window.windowStartAt.getTime()&&row.endAt.getTime()===window.windowEndAt.getTime()
  &&receipt.success&&receipt.data.runId===row.ingressRunId&&typeof row.auditDigest==='string'&&/^[a-f0-9]{64}$/.test(row.auditDigest);
}
