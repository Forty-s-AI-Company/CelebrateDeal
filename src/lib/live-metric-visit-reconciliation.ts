import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {withMetricReadVisibility} from './live-metric-read-visibility';

const id=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Scope=z.object({vendorId:id,liveId:id,versionId:id,startAt:z.date(),endAt:z.date()}).strict()
 .refine(value=>+value.startAt>=0&&value.startAt<value.endAt,'Invalid visit reconciliation window');
const Page=z.object({eventId:z.string().uuid(),issuedAt:z.date(),expiresAt:z.date(),lossAt:z.date().nullable(),
 sourceKind:z.enum(['unknown','viewer','registration']),sourceFormId:id.nullable(),ingressFrameId:z.string().uuid().nullable()}).strict();
const Intent=z.object({eventId:z.string().uuid(),visitorId:id,preparedAt:z.date()}).strict();
const Fact=z.object({id:z.string().uuid(),eventId:z.string().uuid(),visitorId:id,visitedAt:z.date()}).strict();
type PageRow=z.infer<typeof Page>;
type IntentRow=z.infer<typeof Intent>;
type FactRow=z.infer<typeof Fact>;
const ContextSchema=z.object({isolation:z.string(),primary:z.boolean(),asOf:z.date(),clockAt:z.date(),sourceRevision:z.bigint().nonnegative(),
 expiresAt:z.date(),collectionEnabled:z.boolean(),collectionStartedAt:z.date().nullable()}).strict();
type Context=z.infer<typeof ContextSchema>;
type ScopeValue=z.infer<typeof Scope>;
const emptySummary=()=>({pages:0,intents:0,facts:0,versionLossMarkers:0,
 registrationFactsInWindow:0,viewerFactsInWindow:0,unknownFactsInWindow:0,orphanFactsInWindow:0,
 unpreparedRegistrationFactsInWindow:0,invalidRegistrationChronology:0,
 unacknowledgedRegistrationPages:0,expiredUnacknowledgedRegistrationPages:0,
 pendingRegistrationIntents:0,expiredRegistrationIntents:0,orphanIntents:0,nonRegistrationIntents:0,unknownPagesOverlappingWindow:0});
type Summary=ReturnType<typeof emptySummary>;
export const MAX_VISIT_RECONCILIATION_ROWS=10000;

/** Read the *whole version*, including viewer/unknown loss markers and legacy
 * orphan facts. A registration-only scan would hide shared-quota loss.
 * Returned counts/digests describe recorded sources, never all public requests
 * or a positive coverage certificate. Caller owns the authorized report lease
 * and the same RR transaction used for report facts. No source is mutated.
 */
export async function reconcileMetricVisitSources(tx:Pick<Prisma.TransactionClient,'$queryRaw'>,value:z.infer<typeof Scope>){
 const parsed=Scope.parse(value);
 // Date objects are mutable; freeze the validated window before awaiting I/O.
 const scope={...parsed,startAt:new Date(parsed.startAt),endAt:new Date(parsed.endAt)};
 return withMetricReadVisibility(tx,()=>readSources(tx,scope));
}

async function readSources(tx:Pick<Prisma.TransactionClient,'$queryRaw'>,scope:ScopeValue){
 const [context]=await tx.$queryRaw<Context[]>(Prisma.sql`SELECT current_setting('transaction_isolation') AS isolation,
  NOT pg_is_in_recovery() AS primary,date_trunc('milliseconds',transaction_timestamp()) AS "asOf",
  clock_timestamp()::timestamptz(3) AS "clockAt",v."sourceRevision",v."expiresAt",
  v."collectionEnabled",v."collectionStartedAt" FROM "LiveMetricVersion" v
  WHERE v."vendorId"=${scope.vendorId} AND v."liveId"=${scope.liveId} AND v.id=${scope.versionId}`);
 if(!context)return {status:'unavailable' as const,reason:'lease_or_scope_unavailable' as const};
 ContextSchema.parse(context);
 if(context.isolation!=='repeatable read'||context.primary!==true)throw new Error('Visit reconciliation requires primary repeatable-read snapshot');
 if(scope.endAt>context.asOf)return {status:'unavailable' as const,reason:'window_not_closed' as const};
 const pages=await tx.$queryRaw<PageRow[]>(Prisma.sql`SELECT "eventId","issuedAt","expiresAt","lossAt","sourceKind","sourceFormId","ingressFrameId"
  FROM "LiveMetricVisitPage" WHERE "vendorId"=${scope.vendorId} AND "liveId"=${scope.liveId} AND "versionId"=${scope.versionId}
  ORDER BY "eventId" LIMIT ${MAX_VISIT_RECONCILIATION_ROWS+1}`);
 if(pages.length>MAX_VISIT_RECONCILIATION_ROWS)return {status:'unavailable' as const,reason:'limit_exceeded' as const};
 const intents=await tx.$queryRaw<IntentRow[]>(Prisma.sql`SELECT "eventId","visitorId","preparedAt" FROM "LiveMetricVisitIntent"
  WHERE "vendorId"=${scope.vendorId} AND "liveId"=${scope.liveId} AND "versionId"=${scope.versionId}
  ORDER BY "eventId" LIMIT ${MAX_VISIT_RECONCILIATION_ROWS+1}`);
 if(intents.length>MAX_VISIT_RECONCILIATION_ROWS)return {status:'unavailable' as const,reason:'limit_exceeded' as const};
 const facts=await tx.$queryRaw<FactRow[]>(Prisma.sql`SELECT id,"eventId","visitorId","visitedAt" FROM "LiveMetricVisit"
  WHERE "vendorId"=${scope.vendorId} AND "liveId"=${scope.liveId} AND "versionId"=${scope.versionId}
  ORDER BY id LIMIT ${MAX_VISIT_RECONCILIATION_ROWS+1}`);
 if(facts.length>MAX_VISIT_RECONCILIATION_ROWS)return {status:'unavailable' as const,reason:'limit_exceeded' as const};
 // Validate before classification; malformed or partial DB adapters fail closed.
 for(const row of pages)Page.parse(row);
 for(const row of intents)Intent.parse(row);
 for(const row of facts)Fact.parse(row);
 const pageByEvent=new Map(pages.map(row=>[row.eventId,row]));
 const intentByEvent=new Map(intents.map(row=>[row.eventId,row]));
 if(pageByEvent.size!==pages.length||intentByEvent.size!==intents.length)throw new Error('Visit source keys are not unique');
 if(new Set(facts.map(row=>row.id)).size!==facts.length
  ||new Set(facts.map(row=>`${row.eventId}:${row.visitorId}`)).size!==facts.length)throw new Error('Visit fact keys are not unique');
 const factsByEvent=new Map<string,FactRow[]>();
 for(const row of facts){const existing=factsByEvent.get(row.eventId)??[];existing.push(row);factsByEvent.set(row.eventId,existing);}
 const summary={...emptySummary(),pages:pages.length,intents:intents.length,facts:facts.length};
 const invalidChronologyEvents=new Set<string>();
 let hasGap=false;
 for(const page of pages)hasGap=classifyPage(page,scope,context,intentByEvent,summary)||hasGap;
 for(const intent of intents)hasGap=classifyIntent(intent,scope,context,pageByEvent,factsByEvent,summary,invalidChronologyEvents)||hasGap;
 for(const fact of facts)hasGap=classifyFact(fact,scope,context,pageByEvent,intentByEvent,summary,invalidChronologyEvents)||hasGap;
 // Immutable source digest deliberately excludes asOf. Classification can
 // change when a pending lease expires without pretending a row was updated.
 const ingress=await readIngressSources(tx,scope,context,pages);
 if(ingress.status==='unavailable')return ingress;
 hasGap=hasGap||ingress.hasGap;
 const sourceDigest=createHash('sha256').update(JSON.stringify(['visit-sources-v2',scope,context.sourceRevision.toString(),
  context.collectionEnabled,context.collectionStartedAt,context.expiresAt,pages,intents,facts,ingress.sources])).digest('hex');
 return {status:'available' as const,sourceUniverse:'whole_version_recorded_only' as const,
  rowCount:pages.length+intents.length+facts.length+ingress.summary.frames+(ingress.sources?.intakes.length??0),asOf:context.asOf,sourceRevision:context.sourceRevision.toString(),sourceDigest,summary,sourceIngress:ingress.summary,
  coverage:{status:'unavailable' as const,reason:hasGap?'evidence_gap' as const:'unknown_history' as const}};
}

function classifyPage(page:PageRow,scope:ScopeValue,context:Context,intentByEvent:ReadonlyMap<string,IntentRow>,summary:Summary){
  if(page.issuedAt>=page.expiresAt||page.issuedAt>context.clockAt||page.lossAt&&page.lossAt>context.clockAt
   ||page.lossAt&&page.lossAt<page.issuedAt
   ||(page.sourceKind==='registration')!==(page.sourceFormId!==null))throw new Error('Invalid visit page source');
  // A shared-capacity loss is permanent from lossAt, even if the marked row
  // is a viewer page, its old lease expired, or it later gets acknowledged.
  const lost=page.lossAt!==null&&page.lossAt<scope.endAt;
  if(lost)summary.versionLossMarkers++;
  if(page.sourceKind==='unknown'&&page.issuedAt<scope.endAt&&page.expiresAt>scope.startAt)summary.unknownPagesOverlappingWindow++;
  if(page.sourceKind!=='registration'||page.issuedAt>=scope.endAt||page.expiresAt<=scope.startAt)return lost;
  if(!intentByEvent.has(page.eventId)){
   if(page.expiresAt<=context.asOf)summary.expiredUnacknowledgedRegistrationPages++;
   else summary.unacknowledgedRegistrationPages++;
   return true;
  }
  return lost;
}
function classifyIntent(intent:IntentRow,scope:ScopeValue,context:Context,pageByEvent:ReadonlyMap<string,PageRow>,
 factsByEvent:ReadonlyMap<string,FactRow[]>,summary:Summary,invalid:Set<string>){
  if(intent.preparedAt>context.clockAt)throw new Error('Invalid visit preparation time');
  if(intent.preparedAt>=scope.endAt)return false;
  const page=pageByEvent.get(intent.eventId);
  if(!page){summary.orphanIntents++;return false;}
  if(page.sourceKind!=='registration'){summary.nonRegistrationIntents++;return false;}
  const matched=factsByEvent.get(intent.eventId)?.find(fact=>fact.visitorId===intent.visitorId);
  if(matched&&(matched.visitedAt<intent.preparedAt||intent.preparedAt<page.issuedAt||matched.visitedAt<page.issuedAt)){
   return recordInvalidChronology(intent.eventId,invalid,summary);
  }
  // An intent has no page-lease expiry of its own. A prepared request can
  // still acknowledge later while the version lives; never use the shorter
  // page lease to erase an unanswered preparation in a later report window.
  if(!matched&&context.expiresAt>scope.startAt){
   if(context.expiresAt<=context.asOf)summary.expiredRegistrationIntents++;
   else summary.pendingRegistrationIntents++;
   return true;
  }
  return false;
}
function classifyFact(fact:FactRow,scope:ScopeValue,context:Context,pageByEvent:ReadonlyMap<string,PageRow>,
 intentByEvent:ReadonlyMap<string,IntentRow>,summary:Summary,invalid:Set<string>){
  if(fact.visitedAt>context.clockAt)throw new Error('Invalid visit fact time');
  if(fact.visitedAt<scope.startAt||fact.visitedAt>=scope.endAt)return false;
  const page=pageByEvent.get(fact.eventId),intent=intentByEvent.get(fact.eventId);
  if(!page){summary.orphanFactsInWindow++;return false;}
  if(page.sourceKind==='viewer'){summary.viewerFactsInWindow++;return false;}
  if(page.sourceKind==='unknown'){summary.unknownFactsInWindow++;return false;}
  if(!intent||intent.visitorId!==fact.visitorId){summary.unpreparedRegistrationFactsInWindow++;return true;}
  if(fact.visitedAt<page.issuedAt||intent.preparedAt<page.issuedAt||fact.visitedAt<intent.preparedAt){
   return recordInvalidChronology(fact.eventId,invalid,summary);
  }
  summary.registrationFactsInWindow++;
  return false;
}
function recordInvalidChronology(eventId:string,seen:Set<string>,summary:Summary){
 if(!seen.has(eventId)){seen.add(eventId);summary.invalidRegistrationChronology++;}
 return true;
}


const Count=z.number().int().min(0).max(MAX_VISIT_RECONCILIATION_ROWS);
const IngressRun=z.object({id:z.string().uuid(),manifestHash:z.string().regex(/^[a-f0-9]{64}$/),openedAt:z.date(),
 stoppedAt:z.date().nullable(),sealedAt:z.date().nullable(),frameCount:Count.nullable(),pageCount:Count.nullable(),playbackCount:Count.nullable()}).strict();
const IngressFrame=z.object({id:z.string().uuid(),routeKind:z.enum(['form','landing','landing_step','viewer','playback']),
 admittedAt:z.date(),outcome:z.enum(['pending','responded','interrupted']),settledAt:z.date().nullable(),
 httpStatus:z.number().int().min(200).max(599).nullable()}).strict();
const Intake=z.object({id:z.string().uuid(),ingressFrameId:z.string().uuid().nullable(),issuedAt:z.date(),lossAt:z.date().nullable()}).strict();

/** Reconcile recorded ingress one-to-one in the caller's snapshot. Even a
 * sealed, fully matched local run is NOT proof of the public request universe.
 * Keep raw source identities private; only summary counts and a digest escape.
 */
async function readIngressSources(tx:Pick<Prisma.TransactionClient,'$queryRaw'>,scope:ScopeValue,context:Context,pages:PageRow[]){
 const runs=await tx.$queryRaw<z.infer<typeof IngressRun>[]>(Prisma.sql`
  SELECT r.id,r."manifestHash",r."openedAt",r."stoppedAt",s."sealedAt",s."frameCount",s."pageCount",s."playbackCount"
  FROM "LiveMetricIngressRun" r LEFT JOIN "LiveMetricIngressSeal" s ON s."runId"=r.id
   AND s."vendorId"=r."vendorId" AND s."liveId"=r."liveId" AND s."versionId"=r."versionId"
  WHERE r."vendorId"=${scope.vendorId} AND r."liveId"=${scope.liveId} AND r."versionId"=${scope.versionId} ORDER BY r.id LIMIT 2`);
 if(runs.length>1)throw new Error('Ambiguous metric ingress scope');
 const summary={state:'no_run' as 'no_run'|'open'|'stopped'|'sealed',frames:0,pending:0,interrupted:0,failedResponses:0,
  missingSources:0,wrongKindSources:0,orphanSources:0,unboundSources:pages.filter(p=>p.ingressFrameId===null).length,
  sealCountMismatch:false};
 if(!runs.length){
  summary.orphanSources=pages.filter(p=>p.ingressFrameId!==null).length;
  return {status:'available' as const,hasGap:summary.orphanSources>0,summary,sources:null};
 }
 const run=IngressRun.parse(runs[0]);
 assertIngressRun(run,context.clockAt);
 summary.state=run.sealedAt?'sealed':run.stoppedAt?'stopped':'open';
 const frames=await tx.$queryRaw<z.infer<typeof IngressFrame>[]>(Prisma.sql`
  SELECT id,"routeKind","admittedAt",outcome,"settledAt","httpStatus" FROM "LiveMetricIngressFrame"
  WHERE "vendorId"=${scope.vendorId} AND "liveId"=${scope.liveId} AND "versionId"=${scope.versionId} AND "runId"=${run.id}
  ORDER BY id LIMIT ${MAX_VISIT_RECONCILIATION_ROWS+1}`);
 if(frames.length>MAX_VISIT_RECONCILIATION_ROWS)return {status:'unavailable' as const,reason:'limit_exceeded' as const};
 const intakes=await tx.$queryRaw<z.infer<typeof Intake>[]>(Prisma.sql`
  SELECT id,"ingressFrameId","issuedAt","lossAt" FROM "LiveMetricPlaybackIntake"
  WHERE "vendorId"=${scope.vendorId} AND "liveId"=${scope.liveId} AND "versionId"=${scope.versionId}
  ORDER BY id LIMIT ${MAX_VISIT_RECONCILIATION_ROWS+1}`);
 if(intakes.length>MAX_VISIT_RECONCILIATION_ROWS)return {status:'unavailable' as const,reason:'limit_exceeded' as const};
 for(const frame of frames)IngressFrame.parse(frame);
 for(const intake of intakes)Intake.parse(intake);
 const byFrame=new Map(frames.map(f=>[f.id,f]));
 if(byFrame.size!==frames.length||new Set(intakes.map(i=>i.id)).size!==intakes.length)throw new Error('Duplicate metric ingress source');
 const sources=new Map<string,{kind:string;issuedAt:Date}[]>();
 for(const page of pages)bind(page.ingressFrameId,page.sourceKind,page.issuedAt);
 for(const intake of intakes){
  if(intake.issuedAt>context.clockAt||intake.lossAt&&(intake.lossAt<intake.issuedAt||intake.lossAt>context.clockAt))
   throw new Error('Invalid metric playback intake time');
  if(intake.ingressFrameId===null)summary.unboundSources++;
  bind(intake.ingressFrameId,'playback',intake.issuedAt);
 }
 function bind(frameId:string|null,kind:string,issuedAt:Date){
  if(frameId===null)return;
  if(!byFrame.has(frameId)){summary.orphanSources++;return;}
  const values=sources.get(frameId)??[];values.push({kind,issuedAt});sources.set(frameId,values);
 }
 let hasGap=classifyIngressFrames(frames,run,context.clockAt,scope,sources,summary);
 summary.frames=frames.length;
 if(run.sealedAt){
  const pageCount=pages.filter(p=>p.ingressFrameId!==null&&byFrame.has(p.ingressFrameId)).length;
  const intakeCount=intakes.filter(i=>i.ingressFrameId!==null&&byFrame.has(i.ingressFrameId)).length;
  summary.sealCountMismatch=run.frameCount!==frames.length||run.pageCount!==pageCount||run.playbackCount!==intakeCount;
 }
 // Structural contradictions are fail-closed regardless of the chosen window.
 hasGap=hasGap||summary.orphanSources>0||summary.wrongKindSources>0||summary.sealCountMismatch;
 return {status:'available' as const,hasGap,summary,sources:{run,frames,intakes}};
}


type RunRow=z.infer<typeof IngressRun>;
type FrameRow=z.infer<typeof IngressFrame>;
function assertIngressRun(run:RunRow,clockAt:Date){
 if(run.openedAt>clockAt||run.stoppedAt&&(run.stoppedAt<run.openedAt||run.stoppedAt>clockAt)
  ||run.sealedAt&&(!run.stoppedAt||run.sealedAt<run.stoppedAt||run.sealedAt>clockAt)
  ||[run.frameCount,run.pageCount,run.playbackCount].some(v=>(v===null)!==(run.sealedAt===null)))
  throw new Error('Invalid metric ingress frontier');
}
function assertIngressFrame(frame:FrameRow,run:RunRow,clockAt:Date){
  const pending=frame.outcome==='pending';
  if(frame.admittedAt<run.openedAt||frame.admittedAt>clockAt
   ||run.stoppedAt&&frame.admittedAt>run.stoppedAt
   ||(pending?(frame.settledAt!==null||frame.httpStatus!==null):(!frame.settledAt||frame.settledAt<frame.admittedAt||frame.settledAt>clockAt))
   ||(frame.outcome==='responded')!==(frame.httpStatus!==null)
   ||run.sealedAt&&(pending||!!frame.settledAt&&frame.settledAt>run.sealedAt))throw new Error('Invalid metric ingress frame time');
}
function classifyIngressFrames(frames:FrameRow[],run:RunRow,clockAt:Date,scope:ScopeValue,
 sources:ReadonlyMap<string,{kind:string;issuedAt:Date}[]>,
 summary:{pending:number;interrupted:number;failedResponses:number;wrongKindSources:number;missingSources:number}){
 let hasGap=false;
 for(const frame of frames){
  assertIngressFrame(frame,run,clockAt);
  const pending=frame.outcome==='pending';
  if(pending)summary.pending++;
  if(frame.outcome==='interrupted')summary.interrupted++;
  const failed=frame.outcome==='responded'&&frame.httpStatus!==null&&frame.httpStatus>=300;
  if(failed)summary.failedResponses++;
  const matches=sources.get(frame.id)??[];
  const expected=frame.routeKind==='playback'?'playback':frame.routeKind==='viewer'?'viewer':'registration';
  const wrong=matches.length>1||matches.some(s=>s.kind!==expected);
  const missing=matches.length===0&&frame.outcome==='responded'&&!failed;
  if(wrong)summary.wrongKindSources++;
  if(missing)summary.missingSources++;
  if(matches.some(s=>s.issuedAt<frame.admittedAt||run.sealedAt&&s.issuedAt>run.sealedAt))throw new Error('Invalid metric ingress source time');
  // Counts describe all routes, but only overlapping registration requests
  // imply missing visits. Viewing/playback failures belong to their own metric.
  const overlaps=frame.admittedAt<scope.endAt&&(frame.settledAt??clockAt)>=scope.startAt;
  if(expected==='registration'&&overlaps&&(pending||failed||frame.outcome==='interrupted'||missing))hasGap=true;
 }
 return hasGap;
}
