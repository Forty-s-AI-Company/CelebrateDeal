import {createHash} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {closedMetricIngressSource} from './live-metric-ingress-gateway';
import {auditMetricViewingSources} from './live-metric-viewing-source-audit';

/** Fixed isolated source publisher. A terminal session closes delivery without
 * waiting for its admission lease to expire. Revisions bind the full existing
 * audit; callers cannot substitute flags, counts, receipt objects or digests.
 */
export async function publishViewingCoverage(db:Pick<PrismaClient,'$transaction'>,gateway:object){
 const closed=closedMetricIngressSource(gateway);
 if(!closed)return {status:'unavailable' as const};
 const {run,receipt}=closed;
 const frontier=await db.$transaction(async tx=>{
  await tx.$queryRaw(Prisma.sql`SELECT set_config('row_security','off',true),set_config('statement_timeout','5000',true)`);
  const [row]=await tx.$queryRaw<{startAt:Date;endAt:Date}[]>(Prisma.sql`
   SELECT r."openedAt" AS "startAt",s."sealedAt" AS "endAt" FROM "LiveMetricIngressRun" r
   JOIN "LiveMetricIngressSeal" s ON s."runId"=r.id AND s."vendorId"=r."vendorId" AND s."liveId"=r."liveId" AND s."versionId"=r."versionId"
   WHERE r.id=${run.runId} AND r."vendorId"=${run.vendorId} AND r."liveId"=${run.liveId} AND r."versionId"=${run.versionId}
    AND r."manifestHash"=${receipt.manifestHash}`);
  return row??null;
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:10000,maxWait:5000});
 if(!frontier)return {status:'incomplete' as const};
 const scope={vendorId:run.vendorId,liveId:run.liveId,versionId:run.versionId,startAt:frontier.startAt,endAt:frontier.endAt};
 const audit=await auditMetricViewingSources(db,scope);
 if(audit.status!=='enumerated'||!completeDelivery(audit))return {status:'incomplete' as const};
 const proofId=createHash('sha256').update(JSON.stringify(['viewing-coverage-v1',run,receipt,audit.digest])).digest('hex');
 try{return await db.$transaction(async tx=>{
  await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true),set_config('lock_timeout','2000',true)`);
  const [version]=await tx.$queryRaw<{sourceRevision:bigint}[]>(Prisma.sql`SELECT "sourceRevision" FROM "LiveMetricVersion"
   WHERE id=${run.versionId} AND "vendorId"=${run.vendorId} AND "liveId"=${run.liveId} FOR SHARE`);
  if(!version||version.sourceRevision!==audit.sourceRevision)return {status:'source_changed' as const};
  const runs=await tx.$queryRaw<{id:string}[]>(Prisma.sql`SELECT id FROM "LiveMetricIngressRun" WHERE id=${run.runId}
   AND "vendorId"=${run.vendorId} AND "liveId"=${run.liveId} AND "versionId"=${run.versionId} FOR SHARE`);
  if(runs.length!==1)return {status:'source_changed' as const};
  // Cheap revision comparison first; the INSERT guard is the sole full
  // source eligibility scan, so a large audit is not scanned twice per write.
  const [current]=await tx.$queryRaw<{viewing:bigint;intake:bigint;registration:bigint}[]>(Prisma.sql`SELECT
   public.wp20_metric_viewing_revision(${run.vendorId},${run.liveId},${run.versionId}) AS viewing,
   public.wp20_metric_playback_intake_revision(${run.vendorId},${run.liveId},${run.versionId}) AS intake,
   public.wp20_metric_registration_revision(${run.vendorId},${run.liveId}) AS registration`);
  if(!current||current.viewing!==audit.viewingRevision||current.intake!==audit.intake.revision||current.registration!==audit.registrationRevision)
   return {status:'source_changed' as const};
  const inserted=await tx.$queryRaw<{id:string}[]>(Prisma.sql`INSERT INTO "LiveMetricCoverageAudit"
   (id,"vendorId","liveId","versionId",kind,status,"startAt","endAt","sourceRevision","auditDigest","ingressRunId","ingressProofVersion","ingressReceipt","viewingRevision","intakeRevision","registrationRevision")
   VALUES (${proofId},${run.vendorId},${run.liveId},${run.versionId},'viewing','covered',${scope.startAt},${scope.endAt},${audit.sourceRevision},${audit.digest},
    ${run.runId},2,${JSON.stringify(receipt)}::jsonb,${audit.viewingRevision},${audit.intake.revision},${audit.registrationRevision}) ON CONFLICT (id) DO NOTHING RETURNING id`);
  if(inserted.length===1)return {status:'recorded' as const,proofId};
  // A conflicting ID is not evidence that the intended proof was stored.
  const [existing]=await tx.$queryRaw<{matches:boolean}[]>(Prisma.sql`SELECT
   ("vendorId"=${run.vendorId} AND "liveId"=${run.liveId} AND "versionId"=${run.versionId} AND kind='viewing' AND status='covered'
    AND "startAt"=${scope.startAt} AND "endAt"=${scope.endAt} AND "sourceRevision"=${audit.sourceRevision} AND "auditDigest"=${audit.digest}
    AND "ingressRunId"=${run.runId} AND "ingressProofVersion"=2 AND "ingressReceipt"=${JSON.stringify(receipt)}::jsonb
    AND "viewingRevision"=${audit.viewingRevision} AND "intakeRevision"=${audit.intake.revision} AND "registrationRevision"=${audit.registrationRevision}) AS matches
   FROM "LiveMetricCoverageAudit" WHERE id=${proofId}`);
  return existing?.matches===true?{status:'recorded' as const,proofId}:{status:'conflict' as const};
 },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted,timeout:10000,maxWait:5000});
 }catch(error){
  if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2010'&&error.meta?.code==='23514'
   &&typeof error.meta.message==='string'&&['metric coverage requires trusted source proof','registration coverage source mismatch'].some(message=>error.meta!.message===message||error.meta!.message===`ERROR: ${message}`))
   return {status:'source_changed' as const};
  throw error;
 }
}

type Enumerated=Extract<Awaited<ReturnType<typeof auditMetricViewingSources>>,{status:'enumerated'}>;
function completeDelivery(audit:Enumerated){
 return audit.outcomes.closed_contiguous===audit.sessionCount
  &&Object.entries(audit.outcomes).every(([kind,count])=>kind==='closed_contiguous'||count===0)
  &&audit.intake.history==='intake_enabled'&&audit.intake.quotaLosses===0
  &&audit.intake.outcomes.closed_session===audit.intake.count
  &&Object.entries(audit.intake.outcomes).every(([kind,count])=>kind==='closed_session'||count===0)
  &&audit.issuance.history==='ledger_enabled'&&audit.issuance.removedCount===BigInt(0)
  &&audit.issuance.issuedCount===BigInt(audit.sessionCount);
}
