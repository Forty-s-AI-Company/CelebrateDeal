import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { main } from './prisma-loopback-disposable-migration-runner.mjs';
const root=process.cwd(), require=createRequire(import.meta.url);
const receipt={status:'FAIL',stage:'start',people:50000,constraintsAndTriggersEnabled:true};
let migration;
try {
 const source=fs.readFileSync(path.join(root,'node_modules/.prisma/client/index.js'),'utf8');
 const envPaths=JSON.parse(source.match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1]??'null');
 assert.ok(envPaths&&Object.values(envPaths).every(x=>x===null));
 const {PrismaClient}=require('@prisma/client');
 migration=await main({afterMigrate:async({databaseUrl})=>{
  const target=new URL(databaseUrl);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.pathname,'/celebratedeal_test');
  const db=new PrismaClient({datasourceUrl:databaseUrl});
  try {
   const [marker]=await db.$queryRawUnsafe("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
   assert.match(marker.marker,/^prisma-no-dotenv:[a-f0-9]{16}$/u);
   const bundle=await build({stdin:{contents:'export * from "./src/lib/live-metric-registration-source-audit.ts";export * from "./src/lib/live-metric-registration-audit.ts";export * from "./src/lib/live-metric-completion-store.ts";export * from "./src/lib/live-metric-report-lease.ts";',resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent'});
   const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(require,compiled,compiled.exports);const service=compiled.exports;
   receipt.stage='fixture';
   const vendor=await db.vendor.create({data:{name:'Synthetic load',slug:'completion-load',email:'completion-load@example.test',passwordHash:'synthetic-unused'}});
   const video=await db.video.create({data:{vendorId:vendor.id,title:'Synthetic',videoUrl:'https://example.test/synthetic.mp4',durationSec:100}});
   const form=await db.registrationForm.create({data:{vendorId:vendor.id,name:'Synthetic',slug:'completion-load',headline:'Synthetic',fields:[]}});
   const [clock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
   const verified=new Date(+clock.now-100000),start=new Date(+clock.now-110000),end=new Date(+clock.now-1000),expiry=new Date(+clock.now+3600000);
   const live=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,formId:form.id,title:'Synthetic',slug:'completion-load',scheduledAt:start}});
   const versionId='completion-load-version';
   await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt") VALUES ($1,$2,$3,$4,'live',$5,100000,true,$6,$7)`,versionId,vendor.id,live.id,video.id,'a'.repeat(64),start,expiry);
   const setupStarted=performance.now();
   for(let offset=0;offset<receipt.people;offset+=1000){
    await db.formSubmission.createMany({data:Array.from({length:1000},(_,i)=>({id:`load-sub-${offset+i}`,formId:form.id,liveId:live.id,name:'Synthetic',email:`load-${offset+i}@example.test`,verificationStatus:'VERIFIED',verifiedAt:verified}))});
    await db.$executeRawUnsafe(`INSERT INTO "LiveMetricRegistration" (id,"vendorId","liveId","versionId","submissionId","verifiedAt") SELECT 'load-reg-'||i::text,$1,$2,$3,'load-sub-'||i::text,$4 FROM generate_series($5::integer,$6::integer) i`,vendor.id,live.id,versionId,verified,offset,offset+999);
   }
   receipt.setupMs=Math.round(performance.now()-setupStarted);
   const [version]=await db.$queryRawUnsafe('SELECT "sourceRevision" FROM "LiveMetricVersion" WHERE id=$1',versionId);
   const lease={vendorId:vendor.id,liveId:live.id,versionId,reportId:'completion-load-report',workerId:'completion-load-worker'};
   await db.$queryRawUnsafe('SELECT public.wp20_metric_report_create($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7::bigint,$8::timestamptz)',vendor.id,live.id,versionId,lease.reportId,start,end,version.sourceRevision,expiry);
   assert.equal(await service.claimMetricReport(db,lease),true);
   const scope={vendorId:vendor.id,liveId:live.id,contentVersionId:versionId,mode:'live'};
   const projection={status:'available',cohortCount:receipt.people,rows:Array.from({length:receipt.people},(_,i)=>({scope,personId:`load-reg-${i}`,firstCompletedAtMs:+verified+90000}))};
   receipt.stage='source-audit';
   await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const request={vendorId:vendor.id,liveId:live.id,versionId,startAt:start,endAt:end,afterSubmissionId:null,take:500};
    const page=await service.readRegistrationAuditPage(tx,request);
    assert.equal(page.status,'available');assert.equal(page.coverage,'unknown');assert.equal(page.rows.length,500);assert.equal(page.hasMore,true);
    // These deliberately lack initial capture: a capture-only scan would miss all of them.
    assert.ok(page.rows.every(row=>row.outcome==='missing_capture'));
    assert.deepEqual(await service.readRegistrationAuditPage(tx,{...request,vendorId:'foreign-vendor'}),{status:'unavailable',reason:'scope_or_window_unavailable'});
    receipt.authoritativeMissingCaptureAudit='PASS';
   },{isolationLevel:'RepeatableRead',timeout:10000});
   const auditStarted=performance.now();
   const enumeration=await service.auditMetricRegistrationSources(db,{vendorId:vendor.id,liveId:live.id,versionId,startAt:start,endAt:end});
   assert.equal(enumeration.status,'enumerated');assert.equal(enumeration.count,receipt.people);
   assert.equal(enumeration.outcomes.missing_capture,receipt.people);assert.equal(enumeration.coverage,'unknown');
   assert.equal(enumeration.projectionCount,receipt.people);
   assert.equal(enumeration.projectionOutcomes.registration_without_capture,receipt.people);
   assert.match(enumeration.digest,/^[a-f0-9]{64}$/u);
   receipt.fullSourceAuditMs=Math.round(performance.now()-auditStarted);
   receipt.fullSourceAudit='PASS';
   receipt.stage='publish';const publishStarted=performance.now();
   assert.equal(await service.publishMetricCompletion(db,lease,version.sourceRevision,scope,projection),true);
   receipt.publishMs=Math.round(performance.now()-publishStarted);
   const [stored]=await db.$queryRawUnsafe('SELECT "rowCount","cohortCount",jsonb_array_length(rows) AS actual FROM "LiveMetricCompletionProjection" WHERE "reportId"=$1',lease.reportId);
   assert.deepEqual(stored,{rowCount:receipt.people,cohortCount:receipt.people,actual:receipt.people});
   receipt.stage='complete';receipt.status='PASS';
  }catch(error){receipt.errorCode=/^(?:P\d{4}|[0-9A-Z]{5})$/.test(error?.meta?.code??error?.code??'')?(error?.meta?.code??error.code):'ASSERTION_OR_RUNNER_ERROR';throw new Error('completion-load-failed');}
  finally{await db.$disconnect();}
 }});
}catch{receipt.status='FAIL';}
receipt.cleanup=migration?.cleanup??'UNKNOWN';if(migration?.status!=='PASS')receipt.status='FAIL';
fs.writeFileSync('docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/completion-publish-load.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));process.exitCode=receipt.status==='PASS'?0:1;
