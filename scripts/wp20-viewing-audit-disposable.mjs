import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { main } from './prisma-loopback-disposable-migration-runner.mjs';
const require=createRequire(import.meta.url),output='docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/viewing-source-audit-db.json';
const receipt={status:'FAIL',stage:'start',scope:'Actual private read-only viewing inspection; no positive proof or UI claim'};let migration;
try {
 const envPaths=JSON.parse(fs.readFileSync('node_modules/.prisma/client/index.js','utf8').match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1]??'null');assert.ok(envPaths&&Object.values(envPaths).every(x=>x===null));
 const {PrismaClient}=require('@prisma/client');
 migration=await main({afterMigrate:async({databaseUrl})=>{
  const url=new URL(databaseUrl);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/celebratedeal_test');
  const db=new PrismaClient({datasourceUrl:databaseUrl});
  try {
   const [marker]=await db.$queryRawUnsafe("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");assert.match(marker.marker,/^prisma-no-dotenv:[a-f0-9]{16}$/u);
   const built=await build({stdin:{contents:'export {auditMetricViewingSources} from "./src/lib/live-metric-viewing-source-audit.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent'});
   const compiled={exports:{}};new Function('require','module','exports',built.outputFiles[0].text)(require,compiled,compiled.exports);const service=compiled.exports;
   const [fk]=await db.$queryRawUnsafe(`SELECT convalidated AS validated,condeferrable AS deferrable,pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid='public."LiveMetricSession"'::regclass AND conname='LiveMetricSession_vendorId_liveId_versionId_registrationId_fkey'`);
   assert.equal(fk?.validated,true);assert.equal(fk.deferrable,false);
   assert.match(fk.definition,/FOREIGN KEY \("vendorId", "liveId", "versionId", "registrationId"\) REFERENCES "LiveMetricRegistration"/u);
   receipt.sameScopeRegistrationFk='VALIDATED_NOT_DEFERRABLE';
   receipt.stage='fixtures';
   const vendor=await db.vendor.create({data:{name:'Synthetic viewing',slug:'viewing-audit',email:'viewing@example.test',passwordHash:'synthetic-unused'}});
   const video=await db.video.create({data:{vendorId:vendor.id,title:'Synthetic',videoUrl:'https://example.test/synthetic.mp4',durationSec:100}});
   const form=await db.registrationForm.create({data:{vendorId:vendor.id,name:'Synthetic',slug:'viewing-audit',headline:'Synthetic',fields:[]}});
   const [clock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");const anchor=new Date(+clock.now-1000),expires=new Date(+clock.now+3600000);
   const live=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,formId:form.id,title:'Synthetic',slug:'viewing-audit',scheduledAt:anchor}});
   const verifiedAt=new Date(+clock.now-5000);
   const submission=await db.formSubmission.create({data:{formId:form.id,liveId:live.id,name:'Synthetic',email:'viewing@example.test',verificationStatus:'VERIFIED',verifiedAt}});
   const admission=await db.liveViewerSession.create({data:{vendorId:vendor.id,liveId:live.id,tokenHash:'a'.repeat(64),createdAt:new Date(+clock.now-2000),lastSeenAt:clock.now,expiresAt:expires}});
   await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt") VALUES ('viewing-audit-version',$1,$2,$3,'replay',$4,100000,true,$5,$6)`,vendor.id,live.id,video.id,'a'.repeat(64),new Date(+clock.now-10000),expires);
   await db.$executeRawUnsafe(`INSERT INTO "LiveMetricRegistration" (id,"vendorId","liveId","versionId","submissionId","verifiedAt") VALUES ('viewing-audit-registration',$1,$2,'viewing-audit-version',$3,$4)`,vendor.id,live.id,submission.id,verifiedAt);
   for(const id of ['viewing-closed','viewing-empty','viewing-open'])await db.$executeRawUnsafe(`INSERT INTO "LiveMetricSession" (id,"vendorId","liveId","versionId","registrationId","admissionSessionId","anchorAt","expiresAt") VALUES ($1,$2,$3,'viewing-audit-version','viewing-audit-registration',$4,$5,$6)`,id,vendor.id,live.id,admission.id,anchor,expires);
   for(let sequence=0;sequence<2;sequence++)await db.$executeRawUnsafe(`INSERT INTO "LiveMetricInterval" (id,"vendorId","liveId","versionId","sessionId",sequence,"payloadHash","wallStartAt","wallEndAt","mediaStartMs","mediaEndMs") VALUES ($1,$2,$3,'viewing-audit-version','viewing-closed',$4,$5,$6,$7,$8,$9)`, 'viewing-interval-'+sequence,vendor.id,live.id,sequence,'b'.repeat(64),new Date(+anchor+sequence*10),new Date(+anchor+(sequence+1)*10),sequence*10,(sequence+1)*10);
   await db.$executeRawUnsafe(`UPDATE "LiveMetricSession" SET "finalSequence"="lastSequence","closedAt"=date_trunc('milliseconds',clock_timestamp()),complete=true WHERE id IN ('viewing-closed','viewing-empty')`);
   await db.$queryRawUnsafe('SELECT pg_sleep(0.005)::text');
   const [end]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
   const scope={vendorId:vendor.id,liveId:live.id,versionId:'viewing-audit-version',startAt:new Date(+clock.now-10000),endAt:end.now};
   receipt.stage='enumeration';
   const one=await service.auditMetricViewingSources(db,scope,{pageSize:1});
   assert.equal(one.status,'enumerated');assert.equal(one.coverage,'unknown');assert.equal(one.sessionCount,3);assert.equal(one.intervalCount,2);
   assert.equal(one.outcomes.closed_contiguous,2);assert.equal(one.outcomes.open_session,1);
   const full=await service.auditMetricViewingSources(db,scope);assert.deepEqual(full,one);
   assert.deepEqual(await service.auditMetricViewingSources(db,scope,{rows:1}),{status:'unavailable',reason:'limit_exceeded'});
   assert.deepEqual(await service.auditMetricViewingSources(db,{...scope,vendorId:'synthetic-foreign'}),{status:'unavailable',reason:'scope_or_window_unavailable'});
   receipt.stage='snapshot-race';let injected=false;
   const racingDb={$transaction:(read,options)=>db.$transaction(tx=>read(new Proxy(tx,{get(target,key){
    if(key==='$queryRaw')return async query=>{
     const rows=await target.$queryRaw(query);
     if(!injected&&query.strings.join('').includes('FROM "LiveMetricSession"')){
      injected=true;await db.$executeRawUnsafe(`UPDATE "LiveMetricSession" SET "finalSequence"=-1,"closedAt"=date_trunc('milliseconds',clock_timestamp()),complete=true WHERE id='viewing-open'`);
     }return rows;
    };
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
   }})),options)};
   const old=await service.auditMetricViewingSources(racingDb,scope,{pageSize:1});assert.equal(old.outcomes.open_session,1);assert.equal(injected,true);
   const fresh=await service.auditMetricViewingSources(db,scope);assert.equal(fresh.outcomes.open_session,0);assert.equal(fresh.outcomes.closed_contiguous,3);assert.notEqual(fresh.digest,old.digest);
   receipt.stage='identity-revocation';
   await db.formSubmission.update({where:{id:submission.id},data:{verificationStatus:'UNVERIFIED'}});
   const revoked=await service.auditMetricViewingSources(db,scope);assert.equal(revoked.outcomes.identity_mismatch,3);assert.equal(revoked.coverage,'unknown');
   receipt.results={sessionCount:one.sessionCount,intervalCount:one.intervalCount,openVisible:true,emptyClosedVisible:true,pageSizeIndependentDigest:true,repeatableReadSnapshot:true,freshSnapshotSeesClose:true,revocationVisible:true,partialBudgetDiscarded:true,foreignScopeDenied:true,coverage:'unknown'};
   receipt.stage='complete';receipt.status='PASS';
  } finally {await db.$disconnect();}
 }});
} catch(error){receipt.errorCode=/^(?:P[0-9]{4}|[0-9A-Z]{5})$/.test(error?.meta?.code??error?.code??'')?(error.meta?.code??error.code):'ASSERTION_OR_RUNNER_ERROR';}
receipt.cleanup=migration?.cleanup??'UNKNOWN';if(migration?.status!=='PASS')receipt.status='FAIL';fs.writeFileSync(output,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));process.exitCode=receipt.status==='PASS'?0:1;
