import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {main} from './prisma-loopback-disposable-migration-runner.mjs';
const require=createRequire(import.meta.url),base='docs/ai-team/evidence/product-audit-20261011/WP-20/coverage';
const files=['prisma/schema.prisma','prisma/migrations/20261016170000_live_metric_ingress_source_seal/migration.sql','src/lib/live-metric-ingress-seal.ts','src/lib/live-metric-ingress.ts','src/lib/live-metric-ingress-source.ts','scripts/prisma-loopback-disposable-migration-runner.mjs','scripts/wp20-ingress-seal-disposable.mjs'];
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const receipt={status:'FAIL',stage:'start',checks:{},sourceHashes:Object.fromEntries(files.map(f=>[f,digest(f)]))};
try{
 const envPaths=JSON.parse(fs.readFileSync('node_modules/.prisma/client/index.js','utf8').match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1]??'null');assert.ok(envPaths&&Object.values(envPaths).every(value=>value===null));
 const {PrismaClient}=require('@prisma/client');
 const bundle=await build({stdin:{contents:'export * from "./src/lib/live-metric-ingress.ts";export * from "./src/lib/live-metric-ingress-seal.ts";export {issueMetricRegistrationPage} from "./src/lib/live-metric-registration-page.ts";export {metricVideoFingerprint} from "./src/lib/live-metric-version.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent',metafile:true});
 for(const f of Object.keys(bundle.metafile.inputs).filter(f=>f!=='<stdin>')){assert.ok(!f.split(/[\\/]/u).some(part=>part.startsWith('.env')));receipt.sourceHashes[f]=digest(f);}
 assert.ok(!Object.keys(bundle.metafile.inputs).includes('src/lib/db.ts'));
 const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(require,mod,mod.exports);const service=mod.exports;
 const migration=await main({afterMigrate:async({databaseUrl,tempRoot})=>{
  const url=new URL(databaseUrl);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/celebratedeal_test');
  const db=new PrismaClient({datasourceUrl:databaseUrl,log:[]});
  try{
   const [marker]=await db.$queryRawUnsafe("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");assert.equal(marker.marker,fs.readFileSync(path.join(tempRoot,'.marker'),'utf8'));
   receipt.stage='seed';
   const vendor=await db.vendor.create({data:{name:'Synthetic runtime',slug:'source-seal',email:'runtime@example.test',passwordHash:'synthetic-unused'}});
   const video=await db.video.create({data:{vendorId:vendor.id,title:'Synthetic',videoUrl:'https://example.test/synthetic.mp4',durationSec:3600,sourceType:'url',status:'ready'}});
   const form=await db.registrationForm.create({data:{vendorId:vendor.id,name:'Synthetic',slug:'source-seal',headline:'Synthetic runtime form',fields:[{key:'name',label:'Synthetic name',type:'text',required:true},{key:'email',label:'Synthetic email',type:'email',required:true}]}});
   const template=await db.messageTemplate.create({data:{vendorId:vendor.id,name:'Synthetic',channel:'email',trigger:'registration_confirmed',subject:'Synthetic',body:'Synthetic confirmation',isActive:true}});
   const [clock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now"),expires=new Date(+clock.now+7200000);
   const live=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,formId:form.id,messageTemplateId:template.id,title:'Synthetic runtime live',slug:'source-seal',status:'live',scheduledAt:new Date(+clock.now-1000),startedAt:new Date(+clock.now-1000),replayEnabled:true,replayAvailableUntil:expires}});
   const scope={vendorId:vendor.id,liveId:live.id,versionId:'source-seal-version'};
   await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt") VALUES ($1,$2,$3,$4,'live',$5,3600000,true,$6,$7)`,scope.versionId,vendor.id,live.id,video.id,service.metricVideoFingerprint(video),clock.now,expires);

   receipt.stage='seal-cases';
   const run={...scope,runId:(await service.openMetricIngressRun(db,scope,'a'.repeat(64),30)).runId};
   const seal=target=>service.sealMetricIngressSources(db,target);
   const settle=(target,frame,result)=>service.settleMetricIngress(db,{...target,frameId:frame.frameId},result);
   const reject=operation=>assert.rejects(operation,error=>error?.meta?.code==='23514');
   await assert.rejects(seal(run),/stopped run/u);receipt.checks.activeRunCannotSeal='PASS';
   const first=await service.admitMetricIngress(db,run,'form'),late=await service.admitMetricIngress(db,run,'form');
   await service.stopMetricIngressRun(db,run);
   await reject(seal(run));receipt.checks.pendingFramesCannotSeal='PASS';
   const binding=frame=>({...run,frameId:frame.frameId,kind:'form',method:'GET',target:'/form/source-seal',format:1});
   const sourceDb={registrationForm:db.registrationForm,$transaction:(callback,options)=>db.$transaction(async tx=>{
    const observed=new Proxy(tx,{get(target,name){const value=Reflect.get(target,name);if(typeof value!=='function')return value;return async(...args)=>{try{return await value.apply(target,args);}catch(error){receipt.sourceDiagnostic={name:error?.name??'Error',code:typeof error?.code==='string'?error.code:null,sqlState:typeof error?.meta?.code==='string'?error.meta.code:null};throw error;}};}});
    try{return await callback(observed);}catch(error){receipt.sourceContextDiagnostic={name:error?.name??'Error',code:typeof error?.code==='string'?error.code:null};throw error;}
   },options)};
   assert.ok(await service.issueMetricRegistrationPage(sourceDb,{formId:form.id,liveId:live.id},binding(first)));
   await settle(run,first,{outcome:'responded',httpStatus:200});
   await settle(run,late,{outcome:'interrupted'});
   const frozen=await seal(run);assert.deepEqual([frozen.frameCount,frozen.pageCount,frozen.playbackCount],[2,1,0]);
   assert.deepEqual(await seal(run),frozen);receipt.checks.idempotentSealRetainsUnmatchedInterruptedFrame='PASS';
   assert.equal(await service.issueMetricRegistrationPage(db,{formId:form.id,liveId:live.id},binding(late)),null);
   const insert=(tx,target,frame)=>tx.$executeRawUnsafe('INSERT INTO "LiveMetricVisitPage" ("vendorId","liveId","versionId","eventId","expiresAt","sourceKind","sourceFormId","ingressFrameId") VALUES ($1,$2,$3,$4,$5,\'registration\',$6,$7)',target.vendorId,target.liveId,target.versionId,randomUUID(),expires,form.id,frame.frameId);
   await reject(insert(db,run,late));receipt.checks.helperAndRawSqlCannotAppendAfterSeal='PASS';
   for(const query of ['UPDATE "LiveMetricIngressSeal" SET "pageCount"=99 WHERE "runId"=$1','DELETE FROM "LiveMetricIngressSeal" WHERE "runId"=$1'])await reject(db.$executeRawUnsafe(query,run.runId));
   await reject(db.$executeRawUnsafe('TRUNCATE "LiveMetricIngressSeal"'));receipt.checks.sealImmutableRetainedNoTruncate='PASS';
   await assert.rejects(seal({...run,vendorId:'other-vendor'}));receipt.checks.crossScopeSealRejected='PASS';
   async function fresh(suffix){
    const other=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,formId:form.id,messageTemplateId:template.id,title:'Synthetic',slug:'source-seal-'+suffix,status:'live',scheduledAt:clock.now,startedAt:clock.now}});
    const target={vendorId:vendor.id,liveId:other.id,versionId:'seal-'+suffix};
    await db.$executeRawUnsafe('INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt") VALUES ($1,$2,$3,$4,\'live\',$5,3600000,true,$6,$7)',target.versionId,vendor.id,other.id,video.id,service.metricVideoFingerprint(video),clock.now,expires);
    return {...target,runId:(await service.openMetricIngressRun(db,target,'b'.repeat(64),30)).runId};
   }
   const playback=await fresh('playback'),playbackFrame=await service.admitMetricIngress(db,playback,'playback');
   const allowed=async()=>{const [row]=await db.$queryRawUnsafe('SELECT public.wp20_metric_ingress_source_allowed($1,$2,$3,$4,$5) AS allowed',playback.vendorId,playback.liveId,playback.versionId,playbackFrame.frameId,'playback');return row.allowed;};
   assert.equal(await allowed(),true);await settle(playback,playbackFrame,{outcome:'responded',httpStatus:200});await service.stopMetricIngressRun(db,playback);await seal(playback);assert.equal(await allowed(),false);receipt.checks.validUnusedPlaybackFrameCannotBindAfterSeal='PASS';
   const empty=await fresh('empty');await service.stopMetricIngressRun(db,empty);
   const [derived]=await db.$queryRawUnsafe('INSERT INTO "LiveMetricIngressSeal" ("runId","vendorId","liveId","versionId","frameCount","pageCount","playbackCount","sealedAt") VALUES ($1,$2,$3,$4,999,999,999,\'2000-01-01\') RETURNING "frameCount","pageCount","playbackCount","sealedAt"',empty.runId,empty.vendorId,empty.liveId,empty.versionId);
   assert.deepEqual([derived.frameCount,derived.pageCount,derived.playbackCount],[0,0,0]);assert.ok(+derived.sealedAt>+clock.now-1000);receipt.checks.trustedSqlCannotForgeCountersOrTimestamp='PASS';
   receipt.stage='writer-race';
   const race=await fresh('race'),frame=await service.admitMetricIngress(db,race,'form');await settle(race,frame,{outcome:'responded',httpStatus:200});await service.stopMetricIngressRun(db,race);
   let ready,release;const started=new Promise(resolve=>{ready=resolve;}),gate=new Promise(resolve=>{release=resolve;});let blocker;
   const writer=db.$transaction(async tx=>{const [row]=await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');blocker=row.pid;await insert(tx,race,frame);ready();await gate;},{timeout:20000});
   await started;const sealing=seal(race);let waiting=false;
   try{const deadline=Date.now()+3000;while(Date.now()<deadline){const [row]=await db.$queryRawUnsafe('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))) AS waiting',blocker);if(row.waiting){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,25));}assert.ok(waiting);}
   finally{release();}
   await writer;const racedSeal=await sealing;assert.equal(racedSeal.pageCount,1);receipt.checks.sealWaitsForActualSourceTransactionCommit='PASS';
   receipt.stage='late-writer-race';const inverse=await fresh('inverse'),inverseFrame=await service.admitMetricIngress(db,inverse,'form');await settle(inverse,inverseFrame,{outcome:'responded',httpStatus:200});await service.stopMetricIngressRun(db,inverse);
   let sealReady,sealRelease;const isSealed=new Promise(resolve=>{sealReady=resolve;}),sealGate=new Promise(resolve=>{sealRelease=resolve;});let sealPid;
   const heldSeal=db.$transaction(async tx=>{const [row]=await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');sealPid=row.pid;await tx.$executeRawUnsafe('INSERT INTO "LiveMetricIngressSeal" ("runId","vendorId","liveId","versionId") VALUES ($1,$2,$3,$4)',inverse.runId,inverse.vendorId,inverse.liveId,inverse.versionId);sealReady();await sealGate;},{timeout:20000});
   await isSealed;const lateWrite=insert(db,inverse,inverseFrame).then(()=>({rejected:false}),error=>({rejected:error?.meta?.code==='23514'}));waiting=false;
   try{const deadline=Date.now()+3000;while(Date.now()<deadline){const [row]=await db.$queryRawUnsafe('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))) AS waiting',sealPid);if(row.waiting){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,25));}assert.ok(waiting);}finally{sealRelease();}
   await heldSeal;assert.equal((await lateWrite).rejected,true);receipt.checks.waitingLateRawSourceSeesCommittedSealAndRejects='PASS';
   const [priv]=await db.$queryRawUnsafe('SELECT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(\'r\',c.relowner))) a WHERE c.oid=\'public."LiveMetricIngressSeal"\'::regclass AND a.grantee<>c.relowner) AS exposed');assert.equal(priv.exposed,false);receipt.checks.sealTableOwnerOnly='PASS';
   const markerCase=await fresh('marker');await service.stopMetricIngressRun(db,markerCase);
   await reject(db.$transaction(async tx=>{await tx.$executeRawUnsafe('COMMENT ON DATABASE celebratedeal_test IS NULL');await tx.$executeRawUnsafe('INSERT INTO "LiveMetricIngressSeal" ("runId","vendorId","liveId","versionId") VALUES ($1,$2,$3,$4)',markerCase.runId,markerCase.vendorId,markerCase.liveId,markerCase.versionId);}));receipt.checks.missingDisposableMarkerRejectsAndRollsBack='PASS';
   await db.$executeRawUnsafe('CREATE ROLE wp20_seal_untrusted NOLOGIN');
   await assert.rejects(db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE wp20_seal_untrusted');await tx.$queryRawUnsafe('SELECT public.wp20_metric_ingress_source_allowed($1,$2,$3,$4,$5)',scope.vendorId,scope.liveId,scope.versionId,first.frameId,'registration');}),error=>error?.meta?.code==='42501');
   const [acl]=await db.$queryRawUnsafe("SELECT count(*)::int AS overloads,bool_and(NOT has_function_privilege('wp20_seal_untrusted',p.oid,'EXECUTE')) AS denied FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='wp20_metric_ingress_source_allowed'");assert.deepEqual(acl,{overloads:1,denied:true});receipt.checks.sourcePredicatePrivateExactSignature='PASS';
   await db.live.delete({where:{id:inverse.liveId}});const [remaining]=await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "LiveMetricIngressSeal" WHERE "runId"=$1',inverse.runId);assert.equal(remaining.count,0);receipt.checks.canonicalCascadeRemovesSeal='PASS';
  }catch(error){receipt.innerFailure={name:error?.name??'Error',code:typeof error?.code==='string'?error.code:null,sqlState:typeof error?.meta?.code==='string'?error.meta.code:null,line:Number(String(error?.stack??'').match(/wp20-ingress-seal-disposable\.mjs:(\d+):/u)?.[1]??0)};throw error;}finally{await db.$disconnect();}
 }});
 receipt.stage='cleanup';receipt.migrationCount=migration.migrationNames.length;receipt.cleanup=migration.cleanup;assert.equal(migration.status,'PASS');assert.deepEqual(migration.cleanup,{container:'PASS',tempRoot:'PASS'});
 assert.ok(Object.entries(receipt.sourceHashes).every(([f,h])=>digest(f)===h));receipt.status='PASS';receipt.stage='complete';
}catch(error){receipt.error={name:error?.name??'Error',code:typeof error?.code==='string'?error.code:null,sqlState:typeof error?.meta?.code==='string'?error.meta.code:null,line:Number(String(error?.stack??'').match(/wp20-ingress-seal-disposable\.mjs:(\d+):/u)?.[1]??0)};}
fs.writeFileSync(`${base}/ingress-seal-db.json`,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({status:receipt.status,stage:receipt.stage,checks:receipt.checks,migrationCount:receipt.migrationCount,cleanup:receipt.cleanup,error:receipt.error,innerFailure:receipt.innerFailure,sourceDiagnostic:receipt.sourceDiagnostic,sourceContextDiagnostic:receipt.sourceContextDiagnostic}));if(receipt.status!=='PASS')process.exitCode=1;
