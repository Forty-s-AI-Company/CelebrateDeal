import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { closedMetricIngressSource } from './live-metric-ingress-gateway';
import { reconcileMetricVisitSources } from './live-metric-visit-reconciliation';

/** Private publisher for the fixed owned synthetic gateway only. No caller
 * can supply completeness, counters or digests in place of a real closure.
 * Production/legacy history remains unknown and viewing is independently gated.
 */
export async function publishVisitCoverage(db: Pick<PrismaClient, '$transaction'>, gateway: object) {
  const closed = closedMetricIngressSource(gateway);
  if (!closed) return { status: 'unavailable' as const };
  const { run, receipt } = closed;
  const audit = await db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT set_config('row_security','off',true),set_config('statement_timeout','5000',true)`);
    const [frontier] = await tx.$queryRaw<{ startAt: Date; endAt: Date; sourceRevision: bigint }[]>(Prisma.sql`
      SELECT r."openedAt" AS "startAt",s."sealedAt" AS "endAt",v."sourceRevision"
      FROM "LiveMetricIngressRun" r JOIN "LiveMetricIngressSeal" s ON s."runId"=r.id
       AND s."vendorId"=r."vendorId" AND s."liveId"=r."liveId" AND s."versionId"=r."versionId"
      JOIN "LiveMetricVersion" v ON v.id=r."versionId" AND v."vendorId"=r."vendorId" AND v."liveId"=r."liveId"
      WHERE r.id=${run.runId} AND r."vendorId"=${run.vendorId} AND r."liveId"=${run.liveId}
       AND r."versionId"=${run.versionId} AND r."manifestHash"=${receipt.manifestHash}`);
    if (!frontier) return null;
    const scope = { vendorId: run.vendorId, liveId: run.liveId, versionId: run.versionId,
      startAt: frontier.startAt, endAt: frontier.endAt };
    const [eligible] = await tx.$queryRaw<{ ready: boolean }[]>(Prisma.sql`
      SELECT public.wp20_metric_visits_proof_ready(${run.vendorId},${run.liveId},${run.versionId},${run.runId},
        ${scope.startAt},${scope.endAt},${JSON.stringify(receipt)}::jsonb) AS ready`);
    if (eligible?.ready !== true) return null;
    const result = await reconcileMetricVisitSources(tx, scope);
    if (result.status !== 'available' || result.coverage.reason !== 'unknown_history') return null;
    return { scope, sourceRevision: frontier.sourceRevision, digest: result.sourceDigest };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000, maxWait: 5000 });
  if (!audit) return { status: 'incomplete' as const };
  const proofId = createHash('sha256').update(JSON.stringify(['visits-coverage-v1', run, receipt, audit.digest])).digest('hex');
  return db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true),set_config('lock_timeout','2000',true)`);
    const [version] = await tx.$queryRaw<{ sourceRevision: bigint }[]>(Prisma.sql`
      SELECT "sourceRevision" FROM "LiveMetricVersion" WHERE id=${run.versionId}
       AND "vendorId"=${run.vendorId} AND "liveId"=${run.liveId} FOR SHARE`);
    if (!version || version.sourceRevision !== audit.sourceRevision) return { status: 'source_changed' as const };
    const runs = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "LiveMetricIngressRun" WHERE id=${run.runId}
      AND "vendorId"=${run.vendorId} AND "liveId"=${run.liveId} AND "versionId"=${run.versionId} FOR SHARE`);
    if (runs.length !== 1) return { status: 'source_changed' as const };
    await tx.$queryRaw(Prisma.sql`INSERT INTO "LiveMetricCoverageAudit"
      (id,"vendorId","liveId","versionId",kind,status,"startAt","endAt","sourceRevision","auditDigest","ingressRunId","ingressProofVersion","ingressReceipt")
      VALUES (${proofId},${run.vendorId},${run.liveId},${run.versionId},'visits','covered',${audit.scope.startAt},${audit.scope.endAt},
       ${audit.sourceRevision},${audit.digest},${run.runId},1,${JSON.stringify(receipt)}::jsonb) ON CONFLICT (id) DO NOTHING`);
    return { status: 'recorded' as const, proofId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000, maxWait: 5000 });
}
