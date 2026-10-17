import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {build} from 'esbuild';
import {main} from './prisma-loopback-disposable-migration-runner.mjs';
const require=createRequire(import.meta.url),base='docs/ai-team/evidence/product-audit-20261011/WP-20/coverage';
const paths=['src/lib/live-metric-visit-intent.ts','src/lib/live-metric-visit-collection.ts','src/lib/live-metric-visit-client.ts',
 'src/app/api/live-metrics/[vendorId]/[liveId]/visits/route.ts','prisma/schema.prisma',
 'prisma/migrations/20261016110000_live_metric_visit_intent/migration.sql'];
const receipt={status:'FAIL',stage:'start',checks:{},sourceHashes:Object.fromEntries(paths.map(file=>[file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]))};
function load(file){const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};new Function('require','module','exports',source)(name=>{assert.ok(['@prisma/client','zod','node:crypto'].includes(name));return require(name);},mod,mod.exports);return mod.exports;}
let migration;
try{
 const paths=JSON.parse(fs.readFileSync('node_modules/.prisma/client/index.js','utf8').match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1]??'null');assert.ok(paths&&Object.values(paths).every(value=>value===null));
 const {PrismaClient}=require('@prisma/client');
 const intent=load('src/lib/live-metric-visit-intent.ts'),visit=load('src/lib/live-metric-visit.ts');
 // Test-only in-memory bundling, as in the existing disposable harnesses.
 const bundled=await build({stdin:{contents:'export {issueMetricVisitPage} from "./src/lib/live-metric-visit-page.ts";export {prepareTrackedMetricVisit,collectPreparedMetricVisit} from "./src/lib/live-metric-visit-collection.ts";export {createMetricVisitorProofService} from "./src/lib/live-metric-visitor-proof.ts";export {metricVideoFingerprint} from "./src/lib/live-metric-version.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent'});
 const compiled={exports:{}};new Function('require','module','exports',bundled.outputFiles[0].text)(require,compiled,compiled.exports);const service=compiled.exports;
 migration=await main({afterMigrate:async({databaseUrl})=>{
  const url=new URL(databaseUrl);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/celebratedeal_test');
  const db=new PrismaClient({datasourceUrl:databaseUrl,log:[]});
  const prepare=value=>db.$transaction(tx=>intent.prepareMetricVisitIntent(tx,value),{isolationLevel:'ReadCommitted',timeout:10000,maxWait:5000});
  try{
   const [marker]=await db.$queryRawUnsafe("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");assert.match(marker.marker,/^prisma-no-dotenv:[a-f0-9]{16}$/u);
   receipt.stage='seed';
   const vendor=await db.vendor.create({data:{name:'Synthetic intent',slug:'visit-intent',email:'intent@example.test',passwordHash:'synthetic-unused'}});
   const video=await db.video.create({data:{vendorId:vendor.id,title:'Synthetic',videoUrl:'https://example.test/synthetic.mp4',durationSec:100,sourceType:'url',status:'ready'}});
   const form=await db.registrationForm.create({data:{vendorId:vendor.id,name:'Synthetic',slug:'visit-intent',headline:'Synthetic',fields:[
    {key:'name',label:'Synthetic name',type:'text',required:true},{key:'email',label:'Synthetic email',type:'email',required:true}]}});
   const template=await db.messageTemplate.create({data:{vendorId:vendor.id,name:'Synthetic',channel:'email',trigger:'registration_confirmed',subject:'Synthetic',body:'Synthetic confirmation',isActive:true}});
   const [clock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
   const start=new Date(+clock.now-20000),expires=new Date(+clock.now+3600000);
   const live=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,formId:form.id,messageTemplateId:template.id,title:'Synthetic',slug:'visit-intent',status:'ended',scheduledAt:new Date(+clock.now-200000),startedAt:new Date(+clock.now-200000),endedAt:new Date(+clock.now-100000),replayEnabled:true,replayAvailableUntil:expires}});
   await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt") VALUES ('intent-version',$1,$2,$3,'replay',$4,100000,true,$5,$6)`,vendor.id,live.id,video.id,service.metricVideoFingerprint(video),start,expires);
   for(const name of ['intent-a','intent-b'])await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVisitor" (id,"vendorId","liveId","versionId","browserHash","firstVisitedAt") VALUES ($1,$2,$3,'intent-version',$4,$5)`,name,vendor.id,live.id,createHash('sha256').update(name).digest('hex'),new Date(+clock.now-1000));
   const scope={vendorId:vendor.id,liveId:live.id,versionId:'intent-version',visitorId:'intent-a'},eventId='10000000-0000-4000-8000-000000000001';
   const input={...scope,eventId};
   const counts=async()=>{const [row]=await db.$queryRawUnsafe(`SELECT (SELECT count(*)::int FROM "LiveMetricVisitIntent") AS intents,(SELECT count(*)::int FROM "LiveMetricVisit") AS visits`);return row;};
   receipt.stage='durable-unmatched';await prepare(input);assert.deepEqual(await counts(),{intents:1,visits:0});
   await Promise.all(Array.from({length:8},()=>prepare(input)));assert.deepEqual(await counts(),{intents:1,visits:0});
   receipt.checks.preparationAndEightConcurrentRetriesOneUncountedExpectation='PASS';
   receipt.stage='takeover-and-rollback';
   await assert.rejects(prepare({...input,visitorId:'intent-b'}));
   await assert.rejects(prepare({...input,vendorId:'foreign'}));
   const second={...input,eventId:'10000000-0000-4000-8000-000000000002'};
   await assert.rejects(db.$transaction(async tx=>{await intent.prepareMetricVisitIntent(tx,second);throw new Error('synthetic rollback');}));
   assert.deepEqual(await counts(),{intents:1,visits:0});
   await assert.rejects(db.$transaction(tx=>intent.requireMetricVisitIntent(tx,second)));
   receipt.checks.foreignScopeIdentityTakeoverAndRollbackRejected='PASS';
   receipt.stage='actual-visit-and-lost-response';
   const collected=await visit.recordMetricVisit(db,scope,{eventId});assert.equal(collected.replayed,false);
   assert.equal((await visit.recordMetricVisit(db,scope,{eventId})).replayed,true);
   await prepare(input);assert.deepEqual(await counts(),{intents:1,visits:1});
   await prepare(second);assert.deepEqual(await counts(),{intents:2,visits:1});
   const [unmatched]=await db.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "LiveMetricVisitIntent" i LEFT JOIN "LiveMetricVisit" v
    ON v."vendorId"=i."vendorId" AND v."liveId"=i."liveId" AND v."versionId"=i."versionId" AND v."visitorId"=i."visitorId" AND v."eventId"=i."eventId" WHERE v.id IS NULL`);
   assert.equal(unmatched.count,1);receipt.checks.lostResponseRetryDoesNotDuplicateFactsAndUnansweredIntentRemains='PASS';
   const canonical='abcdefab-abcd-4abc-8abc-abcdefabcdef';await prepare({...scope,eventId:canonical});
   for(const eventId of [canonical,canonical.toUpperCase(),'aBcDeFaB-aBcD-4aBc-8aBc-aBcDeFaBcDeF']){
    await db.$transaction(tx=>intent.requireMetricVisitIntent(tx,{...scope,eventId}));
    await visit.recordMetricVisit(db,scope,{eventId});
   }
   const [cases]=await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "LiveMetricVisit" WHERE "eventId"=$1',canonical);
   assert.equal(cases.count,1);receipt.checks.lowerUpperMixedUuidOneIntentAndOneActualVisit='PASS';
   receipt.stage='immutability-and-db-clock';
   for(const query of [`UPDATE "LiveMetricVisitIntent" SET "preparedAt"="preparedAt"`,`DELETE FROM "LiveMetricVisitIntent"`,`TRUNCATE "LiveMetricVisitIntent"`])await assert.rejects(db.$executeRawUnsafe(query));
   await assert.rejects(db.$executeRawUnsafe(`DELETE FROM "LiveMetricVisitor" WHERE id='intent-a'`));
   await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Tokyo'");
    await tx.$executeRawUnsafe(`INSERT INTO "LiveMetricVisitIntent" ("vendorId","liveId","versionId","visitorId","eventId","preparedAt") VALUES ($1,$2,'intent-version','intent-a','10000000-0000-4000-8000-000000000003','2100-01-01')`,vendor.id,live.id);
    const [row]=await tx.$queryRawUnsafe(`SELECT "preparedAt",clock_timestamp() AS now FROM "LiveMetricVisitIntent" WHERE "eventId"='10000000-0000-4000-8000-000000000003'`);
    assert.ok(+row.preparedAt>=+clock.now&&+row.preparedAt<=+row.now);
   });
   receipt.checks.immutableExpectationAndVisitorRetentionServerTimestampNonUtc='PASS';
   receipt.stage='acl';
   const [acl]=await db.$queryRawUnsafe(`SELECT c.relrowsecurity AS rls,NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner) AS private FROM pg_class c WHERE c.oid='public."LiveMetricVisitIntent"'::regclass`);
   assert.equal(acl.rls,true);assert.equal(acl.private,true);
   await db.$executeRawUnsafe('CREATE ROLE wp20_intent_probe NOLOGIN');
   try{await assert.rejects(db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE wp20_intent_probe');await tx.$queryRawUnsafe('SELECT * FROM "LiveMetricVisitIntent"');}));}
   finally{await db.$executeRawUnsafe('DROP ROLE wp20_intent_probe');}
   receipt.checks.rlsPrivateAclAndUnprivilegedRoleDenied='PASS';
   receipt.stage='actual-public-composition';
   const proofs=service.createMetricVisitorProofService(new Uint8Array(32).fill(7)),publicScope={vendorId:vendor.id,liveId:live.id};
   const page=await service.issueMetricVisitPage(db,publicScope);assert.ok(page);
   const publicEvent={eventId:page.eventId};
   receipt.stage='public-prepare';const prepared=await service.prepareTrackedMetricVisit(db,proofs,publicScope,null,publicEvent);
   const visitorCount=async()=>{const [row]=await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "LiveMetricVisitor"');return row.count;};
   const beforeLost=await visitorCount(),beforeCollect=await counts();
   receipt.stage='public-lost-cookie';await assert.rejects(service.prepareTrackedMetricVisit(db,proofs,publicScope,null,publicEvent),error=>error.code==='SCOPE_UNAVAILABLE');
   assert.equal(await visitorCount(),beforeLost);assert.deepEqual(await counts(),beforeCollect);
   receipt.stage='public-missing-intent';await assert.rejects(service.collectPreparedMetricVisit(db,proofs,publicScope,{eventId:'20000000-0000-4000-8000-000000000002'},prepared.proof),error=>error.code==='SCOPE_UNAVAILABLE');
   assert.deepEqual(await counts(),beforeCollect);
   receipt.stage='public-valid-collect';const recorded=await service.collectPreparedMetricVisit(db,proofs,publicScope,publicEvent,prepared.proof);assert.equal(recorded.replayed,false);
   assert.equal((await service.collectPreparedMetricVisit(db,proofs,publicScope,publicEvent,prepared.proof)).replayed,true);
   assert.deepEqual(await counts(),{intents:beforeCollect.intents,visits:beforeCollect.visits+1});
   await assert.rejects(service.prepareTrackedMetricVisit({$transaction:async()=>{throw new Error('synthetic outage');}},proofs,publicScope,null,publicEvent),error=>error.code==='PERSISTENCE_UNAVAILABLE');
   receipt.checks.actualContextProofCompositionMissingIntentAndLostCookieRollbackAndIdempotentVisit='PASS';
   receipt.stage='cascade';await db.vendor.delete({where:{id:vendor.id}});assert.deepEqual(await counts(),{intents:0,visits:0});
   receipt.checks.vendorCascadeNoOrphans='PASS';receipt.status='PASS';receipt.stage='complete';
  }catch(error){receipt.errorType=error?.name;receipt.errorCode=['SCOPE_UNAVAILABLE','PERSISTENCE_UNAVAILABLE','PROOF_INVALID','VISITOR_MISSING'].includes(error?.code)?error.code:'ASSERTION_OR_RUNNER_ERROR';throw new Error('sanitized-visit-intent-probe-failed');}
  finally{await db.$disconnect();}
 }});
}catch(error){receipt.errorType=error?.name;receipt.errorCode=/^(?:P[0-9]{4}|[0-9A-Z]{5})$/.test(error?.meta?.code??error?.code??'')?(error.meta?.code??error.code):'ASSERTION_OR_RUNNER_ERROR';}
receipt.cleanup=migration?.cleanup??'UNKNOWN';receipt.migrationCount=migration?.migrationNames?.length??null;
if(migration?.status!=='PASS')receipt.status='FAIL';
fs.writeFileSync(`${base}/visit-intent-db.json`,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));process.exitCode=receipt.status==='PASS'?0:1;
