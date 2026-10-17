import {randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {resolveMetricVisitContext} from './live-metric-visit-context';
import {MetricVisitorError} from './live-metric-visitor';
import {MetricVisitIntentError} from './live-metric-visit-intent';
import type {MetricIngressBinding} from './live-metric-ingress-proof';
import {canBindMetricIngressSource} from './live-metric-ingress-source';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Scope=z.object({vendorId:id,liveId:id}).strict();
const FormGate=z.object({formId:id}).strict();
const SourceGate=z.union([FormGate,z.object({kind:z.literal('viewer')}).strict()]);
const Bound=Scope.extend({versionId:id,eventId:z.string().uuid().transform(value=>value.toLowerCase())});
export const MAX_METRIC_VISIT_PAGES=10000;
class MetricVisitPageExpiredError extends MetricVisitIntentError {}

/** Uncounted render expectation, committed before exposing its nonce to a
 * browser. Aborted renders, prefetches and no-JS stay unmatched. This does NOT
 * assert that every URL or request used this renderer, or certify coverage.
 * No identity, credential or URL is persisted. Never enable/create a version.
 */
export async function issueMetricVisitPage(db:Pick<PrismaClient,'$transaction'>,value:z.infer<typeof Scope>,expectedSource?:z.infer<typeof SourceGate>,binding?:MetricIngressBinding){
 const scope=Scope.parse(value);
 const source=expectedSource===undefined?null:SourceGate.parse(expectedSource);
 const form=source&&'formId' in source?source:null;
 try{
  return await db.$transaction(async tx=>{
   await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true)`);
   // Serialize issuer admission before canonical Live/Video/version locks.
   // Trigger uses the same scope key; count/cap cannot race between issuers.
   await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(jsonb_build_array('wp20_metric_visit_page',${scope.vendorId}::text,${scope.liveId}::text)::text,0))::text`);
   if(form){
    // Metadata from a previously rendered form can be stale. Bind its exact
    // current form/live/vendor before minting a nonce, in this same transaction.
    const rows=await tx.$queryRaw<{id:string}[]>(Prisma.sql`SELECT l.id FROM "Live" l
     JOIN "RegistrationForm" f ON f.id=l."formId" AND f."vendorId"=l."vendorId"
     LEFT JOIN "SalesProject" p ON p.id=f."projectId" AND p."vendorId"=f."vendorId"
     WHERE l.id=${scope.liveId} AND l."vendorId"=${scope.vendorId} AND f.id=${form.formId} AND f."isActive"
      AND (f."projectId" IS NULL OR (p.status='published' AND p."publishedAt" IS NOT NULL)) FOR SHARE OF l,f`);
    if(rows.length!==1)throw new MetricVisitorError('SCOPE_UNAVAILABLE');
   }
   const context=await resolveMetricVisitContext(tx,scope),eventId=randomUUID();
   if(!await canBindMetricIngressSource(tx,binding,{...scope,versionId:context.versionId},form?'registration':source?'viewer':'unknown'))return null;
   const [usage]=await tx.$queryRaw<{count:bigint}[]>(Prisma.sql`SELECT count(*) AS count FROM "LiveMetricVisitPage"
    WHERE "vendorId"=${scope.vendorId} AND "liveId"=${scope.liveId} AND "versionId"=${context.versionId}`);
   if(usage.count>=BigInt(MAX_METRIC_VISIT_PAGES)){
    // Preserve a permanent gap before allowing an untracked response. Never
    // erase unmatched expectations to manufacture space or completeness.
    const [gap]=await tx.$queryRaw<{eventId:string}[]>(Prisma.sql`SELECT "eventId" FROM "LiveMetricVisitPage"
     WHERE "vendorId"=${scope.vendorId} AND "liveId"=${scope.liveId} AND "versionId"=${context.versionId}
     ORDER BY "issuedAt","eventId" LIMIT 1 FOR UPDATE`);
    if(!gap)throw new Error('Metric page quota unavailable');
    await tx.$executeRaw(Prisma.sql`UPDATE "LiveMetricVisitPage" SET "lossAt"=clock_timestamp()
     WHERE "vendorId"=${scope.vendorId} AND "liveId"=${scope.liveId} AND "versionId"=${context.versionId}
      AND "eventId"=${gap.eventId} AND "lossAt" IS NULL`);
    return null;
   }
   // Source is server-selected. Legacy rows stay unknown; a viewer render
   // must never become the denominator of a registration-page conversion.
   await tx.$executeRaw(Prisma.sql`INSERT INTO "LiveMetricVisitPage" ("vendorId","liveId","versionId","eventId","expiresAt","sourceKind","sourceFormId","ingressFrameId")
    VALUES (${scope.vendorId},${scope.liveId},${context.versionId},${eventId},${context.expiresAt},${form?'registration':source?'viewer':'unknown'},${form?.formId??null},${binding?.frameId??null})`);
   const current=await resolveMetricVisitContext(tx,scope);
   if(current.versionId!==context.versionId)throw new Error('Metric page context changed');
   await requireMetricVisitPage(tx,{...scope,versionId:context.versionId,eventId});
   return {eventId,versionId:context.versionId};
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted,timeout:10000,maxWait:5000});
 }catch(error){
  // A page without configured collection keeps its ordinary rendering. Other
  // failures cannot silently release a nonce whose expectation never committed.
  if(error instanceof MetricVisitorError&&['SCOPE_UNAVAILABLE','LIFETIME_UNAVAILABLE'].includes(error.code))return null;
  if(error instanceof MetricVisitPageExpiredError)return null;
  if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2010'&&error.meta?.code==='P2090')return null;
  throw new MetricVisitorError('PERSISTENCE_UNAVAILABLE');
 }
}

/** Transaction-owned lookup. The current canonical context supplies version;
 * the browser never selects it. Called before provisioning visitor identity.
 */
export async function requireMetricVisitPage(tx:Prisma.TransactionClient,value:z.infer<typeof Bound>){
 const scope=Bound.parse(value);
 const rows=await tx.$queryRaw<{eventId:string;active:boolean}[]>(Prisma.sql`SELECT "eventId","expiresAt">clock_timestamp() AS active FROM "LiveMetricVisitPage"
  WHERE "vendorId"=${scope.vendorId} AND "liveId"=${scope.liveId} AND "versionId"=${scope.versionId}
   AND "eventId"=${scope.eventId} FOR SHARE`);
 if(rows.length!==1)throw new MetricVisitIntentError();
 if(!rows[0].active)throw new MetricVisitPageExpiredError();
}
