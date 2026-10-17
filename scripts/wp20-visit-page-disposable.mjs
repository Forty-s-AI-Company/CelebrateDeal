import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {build} from 'esbuild';
import {main} from './prisma-loopback-disposable-migration-runner.mjs';
import {runVisitReconciliationProbe} from './wp20-visit-reconciliation-probe.mjs';
import {runAuditVisibilityProbe} from './wp20-audit-visibility-probe.mjs';
const require=createRequire(import.meta.url),base='docs/ai-team/evidence/product-audit-20261011/WP-20/coverage';
const auditVisibilityMode=process.argv.includes('--audit-visibility');
const reconciliationMode=auditVisibilityMode||process.argv.includes('--visit-reconciliation');
const sourceMode=reconciliationMode||process.argv.includes('--registration-sources');
const registrationMode=sourceMode||process.argv.includes('--registration-surfaces');
const paths=['src/lib/live-metric-visit-intent.ts','src/lib/live-metric-visit-collection.ts','src/lib/live-metric-visit-client.ts',
 'scripts/wp20-visit-page-disposable.mjs',
 'src/lib/live-metric-visit-page.ts','src/components/live-metric-visit.tsx','src/app/(viewer)/live/[slug]/page.tsx',
 'prisma/migrations/20261016120000_live_metric_visit_page/migration.sql',
 'src/app/api/live-metrics/[vendorId]/[liveId]/visits/route.ts','prisma/schema.prisma',
 'prisma/migrations/20261016110000_live_metric_visit_intent/migration.sql'];
if(registrationMode)paths.push('src/lib/funnel-flow.ts','src/lib/funnel-step-pages.ts','src/lib/funnel-webinar.ts','src/lib/live-metric-registration-page.ts','src/lib/live-metric-registration-surface.ts','src/components/metric-registration-visit.tsx',
 'src/app/form/[slug]/page.tsx','src/app/lp/[slug]/page.tsx','src/app/lp/[slug]/[stepPath]/page.tsx');
const receipt={status:'FAIL',stage:'start',checks:{},sourceHashes:Object.fromEntries(paths.map(file=>[file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]))};
if(sourceMode)for(const file of ['src/lib/live-metric-report-reader.ts','src/lib/live-metric-report-queue.ts','src/lib/live-metric-report-lease.ts','prisma/migrations/20261016140000_live_metric_registration_visit_source/migration.sql'])receipt.sourceHashes[file]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if(reconciliationMode)for(const file of ['src/lib/live-metric-coverage-reader.ts','src/lib/live-metric-visit-reconciliation.ts','scripts/wp20-visit-reconciliation-probe.mjs'])receipt.sourceHashes[file]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if(auditVisibilityMode)for(const file of ['src/lib/live-metric-read-visibility.ts','scripts/wp20-audit-visibility-probe.mjs','src/lib/live-metric-registration-coverage.ts','src/lib/live-metric-order-coverage.ts'])receipt.sourceHashes[file]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function load(file){const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};new Function('require','module','exports',source)(name=>{assert.ok(['@prisma/client','zod','node:crypto'].includes(name));return require(name);},mod,mod.exports);return mod.exports;}
let migration;
try{
 const paths=JSON.parse(fs.readFileSync('node_modules/.prisma/client/index.js','utf8').match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1]??'null');assert.ok(paths&&Object.values(paths).every(value=>value===null));
 const {PrismaClient}=require('@prisma/client');
 const intent=load('src/lib/live-metric-visit-intent.ts'),visit=load('src/lib/live-metric-visit.ts');
 // Test-only in-memory bundling, as in the existing disposable harnesses.
 const bundled=await build({stdin:{contents:'export {issueMetricRegistrationPage} from "./src/lib/live-metric-registration-page.ts";export {issueMetricVisitPage,requireMetricVisitPage} from "./src/lib/live-metric-visit-page.ts";export {prepareTrackedMetricVisit,collectPreparedMetricVisit} from "./src/lib/live-metric-visit-collection.ts";export {createMetricVisitorProofService} from "./src/lib/live-metric-visitor-proof.ts";export {metricVideoFingerprint} from "./src/lib/live-metric-version.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent'});
 const compiled={exports:{}};new Function('require','module','exports',bundled.outputFiles[0].text)(require,compiled,compiled.exports);const service=compiled.exports;
 if(registrationMode){
  const templateBundle=await build({stdin:{contents:'export {createFunnelFlow} from "./src/lib/funnel-flow.ts";export {createFunnelStepPages} from "./src/lib/funnel-step-pages.ts";export {metricWebinarRegistrationScope} from "./src/lib/live-metric-registration-surface.ts";export {readMetricVisitPage} from "./src/lib/live-metric-report-reader.ts";export {enqueueMetricReport} from "./src/lib/live-metric-report-queue.ts";export {claimMetricReport} from "./src/lib/live-metric-report-lease.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent'});
  const templateModule={exports:{}};new Function('require','module','exports',templateBundle.outputFiles[0].text)(require,templateModule,templateModule.exports);Object.assign(service,templateModule.exports);
 }
 if(reconciliationMode){
  const reconciliationBundle=await build({stdin:{contents:'export {reconcileMetricVisitSources} from "./src/lib/live-metric-visit-reconciliation.ts";export {readMetricCoverage} from "./src/lib/live-metric-coverage-reader.ts";export {withMetricReadVisibility} from "./src/lib/live-metric-read-visibility.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent'});
  const mod={exports:{}};new Function('require','module','exports',reconciliationBundle.outputFiles[0].text)(require,mod,mod.exports);Object.assign(service,mod.exports);
 }
 if(auditVisibilityMode){
  const legacy=JSON.parse(fs.readFileSync(`${base}/audit-visibility-legacy-reader.json`,'utf8'));
  assert.equal(createHash('sha256').update(legacy.source).digest('hex'),legacy.byteHash);
  assert.equal(legacy.byteHash,JSON.parse(fs.readFileSync(`${base}/visit-reconciliation-final-review-source.json`,'utf8')).files['src/lib/live-metric-coverage-reader.ts']);
  const old=await build({stdin:{contents:legacy.source+'\nexport {withMetricReadVisibility as otherBundleVisibility} from "./live-metric-read-visibility";',resolveDir:process.cwd()+'/src/lib',loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent'});
  const mod={exports:{}};new Function('require','module','exports',old.outputFiles[0].text)(require,mod,mod.exports);service.readLegacyMetricCoverage=mod.exports.readMetricCoverage;service.otherBundleVisibility=mod.exports.otherBundleVisibility;
  const publishers=await build({stdin:{contents:'export {publishRegistrationCoverage} from "./src/lib/live-metric-registration-coverage.ts";export {publishOrderCoverage} from "./src/lib/live-metric-order-coverage.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent'});
  const pub={exports:{}};new Function('require','module','exports',publishers.outputFiles[0].text)(require,pub,pub.exports);Object.assign(service,pub.exports);
 }
 migration=await main({afterMigrate:async({databaseUrl})=>{
  const url=new URL(databaseUrl);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/celebratedeal_test');
  const db=new PrismaClient({datasourceUrl:databaseUrl,log:[]});
  const prepare=value=>db.$transaction(tx=>intent.prepareMetricVisitIntent(tx,value),{isolationLevel:'ReadCommitted',timeout:10000,maxWait:5000});
  try{
   const [marker]=await db.$queryRawUnsafe("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");assert.match(marker.marker,/^prisma-no-dotenv:[a-f0-9]{16}$/u);
   // Preserve the diagnosed SDK transport limitation as a boolean only.
   try{await db.$queryRawUnsafe('SELECT pg_advisory_xact_lock(1976101512::bigint)');receipt.advisoryVoidUnsupported=false;}
   catch(error){receipt.advisoryVoidUnsupported=error?.code==='P2010'&&String(error?.message).includes('void');}
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
    receipt.clockCheck={afterInitialClock:+row.preparedAt>=+clock.now,beforeReadClock:+row.preparedAt<=+row.now,
     elapsedFromInitialMs:+row.preparedAt-+clock.now,elapsedToReadMs:+row.now-+row.preparedAt};
    assert.ok(receipt.clockCheck.afterInitialClock&&receipt.clockCheck.beforeReadClock);
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
   receipt.stage='page-before-browser';
   let registrationScope={formId:form.id,liveId:live.id};
   if(registrationMode){
    // Use the real template constructors, not a hand-written step flag.
    const flow=service.createFunnelFlow({id:'webinar',name:'Synthetic',goal:'webinar',domain:'synthetic'});
    const state=service.createFunnelStepPages(flow),now=+clock.now;
    state.flow.webinar={timezone:'UTC',startsAt:new Date(now-60000).toISOString(),endsAt:new Date(now+60000).toISOString(),replayEndsAt:new Date(now+120000).toISOString()};
    const step=state.flow.steps.find(value=>value.type==='webinar_registration_page');assert.equal(step.isSystem,false);
    registrationScope=service.metricWebinarRegistrationScope(state,step.id,{form:{id:form.id},live:{id:live.id}},now);
    assert.deepEqual(registrationScope,{formId:form.id,liveId:live.id});
    assert.deepEqual(service.metricWebinarRegistrationScope(state,state.flow.steps.find(value=>value.type==='webinar_broadcast_page').id,{form:{id:form.id},live:{id:live.id}},now),{});
   }
   const issueSurface=()=>registrationMode?service.issueMetricRegistrationPage(db,registrationScope):service.issueMetricVisitPage(db,publicScope);
   const beforePage=await counts(),page=await issueSurface();assert.ok(page);
   assert.deepEqual(await counts(),beforePage);
   const pages=async()=>{const [row]=await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "LiveMetricVisitPage"');return row.count;};
   assert.equal(await pages(),1);
   if(registrationMode)receipt.checks.realWebinarTemplateRegistrationScopeIssuesExactlyOneUncountedPage='PASS';
   // Response lost/no JS/prefetch: another issued page must remain unmatched.
   const lost=await issueSurface();assert.notEqual(lost.eventId,page.eventId);assert.equal(await pages(),2);
   const countVisitors=async()=>{const [row]=await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "LiveMetricVisitor"');return row.count;};
   const visitorsBefore=await countVisitors();
   await assert.rejects(service.prepareTrackedMetricVisit(db,proofs,publicScope,null,{eventId:'20000000-0000-4000-8000-000000000099'}),error=>error.code==='SCOPE_UNAVAILABLE');
   assert.equal(await countVisitors(),visitorsBefore);
   assert.equal(await service.issueMetricVisitPage(db,{...publicScope,vendorId:'foreign'}),null);assert.equal(await pages(),2);
   const rollbackDb={$transaction:(callback,options)=>db.$transaction(async tx=>{await callback(tx);throw new Error('synthetic outer rollback');},options)};
   await assert.rejects(service.issueMetricVisitPage(rollbackDb,publicScope),error=>error.code==='PERSISTENCE_UNAVAILABLE');assert.equal(await pages(),2);
   receipt.checks.pageCommittedBeforeBrowserUnknownNonceRejectedBeforeIdentityAndRollbackRetainsNoPage='PASS';
   if(registrationMode){
    receipt.stage='registration-binding';const before=await pages();
    const wrongForm=await db.registrationForm.create({data:{vendorId:vendor.id,name:'Synthetic other',slug:'registration-other',headline:'Synthetic',fields:form.fields}});
    assert.equal(await service.issueMetricRegistrationPage(db,{formId:wrongForm.id,liveId:live.id}),null);
    const foreign=await db.vendor.create({data:{name:'Synthetic foreign',slug:'registration-foreign',email:'foreign@example.test',passwordHash:'synthetic-unused'}});
    const foreignForm=await db.registrationForm.create({data:{vendorId:foreign.id,name:'Synthetic foreign',slug:'registration-foreign',headline:'Synthetic',fields:form.fields}});
    assert.equal(await service.issueMetricRegistrationPage(db,{formId:foreignForm.id,liveId:live.id}),null);
    await db.registrationForm.update({where:{id:form.id},data:{isActive:false}});
    assert.equal(await issueSurface(),null);await db.registrationForm.update({where:{id:form.id},data:{isActive:true}});
    assert.equal(await pages(),before);
    receipt.checks.actualRegistrationSameVendorWrongFormForeignVendorAndInactiveRejectedWithoutPage='PASS';
    // A binding edit after the initial owner hint but before issuance must be
    // rejected by the real locked SQL recheck, not by a mocked context.
    let changed=false;
    const racingDb={$transaction:db.$transaction.bind(db),registrationForm:{findFirst:async args=>{
     const found=await db.registrationForm.findFirst(args);
     await db.live.update({where:{id:live.id},data:{formId:wrongForm.id}});changed=true;return found;
    }}};
    assert.equal(await service.issueMetricRegistrationPage(racingDb,{formId:form.id,liveId:live.id}),null);assert.equal(changed,true);
    await db.live.update({where:{id:live.id},data:{formId:form.id}});assert.equal(await pages(),before);
    const draftProject=await db.salesProject.create({data:{vendorId:vendor.id,name:'Synthetic draft',slug:'metric-draft',mode:'live_course',primaryFlow:'live'}});
    await db.registrationForm.update({where:{id:form.id},data:{projectId:draftProject.id}});assert.equal(await issueSurface(),null);
    const foreignProject=await db.salesProject.create({data:{vendorId:foreign.id,name:'Synthetic foreign',slug:'metric-foreign',mode:'live_course',primaryFlow:'live',status:'published',publishedAt:new Date()}});
    await assert.rejects(db.registrationForm.update({where:{id:form.id},data:{projectId:foreignProject.id}}),error=>error.code==='P2003');
    await db.registrationForm.update({where:{id:form.id},data:{projectId:null}});assert.equal(await pages(),before);
    receipt.checks.draftProjectMetricGateAndForeignProjectCompositeFkRejected='PASS';
    let locked=false;
    const lockedDb={registrationForm:db.registrationForm,$transaction:(callback,options)=>db.$transaction(async tx=>{
     const result=await callback(new Proxy(tx,{get(target,key){
      if(key==='$queryRaw')return async query=>{
       const rows=await target.$queryRaw(query);
       if(!locked&&query.strings.join('').includes('JOIN "RegistrationForm"')){
        locked=true;
        for(const statement of [()=>db.$transaction(async writer=>{await writer.$executeRawUnsafe("SET LOCAL lock_timeout='100ms'");await writer.$executeRawUnsafe('UPDATE "Live" SET "formId"=$1 WHERE id=$2',wrongForm.id,live.id);}),
         ()=>db.$transaction(async writer=>{await writer.$executeRawUnsafe("SET LOCAL lock_timeout='100ms'");await writer.$executeRawUnsafe('UPDATE "RegistrationForm" SET "isActive"=false WHERE id=$1',form.id);})])await assert.rejects(statement(),error=>error.meta?.code==='55P03');
       }return rows;
      };
      const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
     }}));
     assert.ok(result);throw new Error('synthetic outer rollback after lock check');
    },options)};
    await assert.rejects(service.issueMetricRegistrationPage(lockedDb,{formId:form.id,liveId:live.id}),error=>error.code==='PERSISTENCE_UNAVAILABLE');
    assert.equal(locked,true);assert.equal(await pages(),before);
    receipt.checks.liveAndFormMutationsBlockedThroughIssuanceAndOuterRollbackNoNonce='PASS';
    await db.vendor.delete({where:{id:foreign.id}});
    receipt.checks.formReassignmentAfterOwnerLookupFailsTransactionalRecheck='PASS';
   }
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
   receipt.stage='page-immutability';
   for(const query of ['UPDATE "LiveMetricVisitPage" SET "issuedAt"="issuedAt"','DELETE FROM "LiveMetricVisitPage"','TRUNCATE "LiveMetricVisitPage"'])await assert.rejects(db.$executeRawUnsafe(query));
   const [unmatchedPage]=await db.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "LiveMetricVisitPage" p LEFT JOIN "LiveMetricVisitIntent" i
    ON i."vendorId"=p."vendorId" AND i."liveId"=p."liveId" AND i."versionId"=p."versionId" AND i."eventId"=p."eventId" WHERE i."eventId" IS NULL`);
   assert.equal(unmatchedPage.count,1);
   const [pageAcl]=await db.$queryRawUnsafe(`SELECT c.relrowsecurity AS rls,NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner) AS private FROM pg_class c WHERE c.oid='public."LiveMetricVisitPage"'::regclass`);
   assert.equal(pageAcl.rls,true);assert.equal(pageAcl.private,true);
   await db.$executeRawUnsafe('CREATE ROLE wp20_page_probe NOLOGIN');
   try{await assert.rejects(db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE wp20_page_probe');await tx.$queryRawUnsafe('SELECT * FROM "LiveMetricVisitPage"');}));}
   finally{await db.$executeRawUnsafe('DROP ROLE wp20_page_probe');}
   receipt.checks.unmatchedPageImmutableRlsAndPrivateProbeRoleDenied='PASS';
   receipt.stage='page-expiry-race';
   const shortLive=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,formId:form.id,messageTemplateId:template.id,title:'Synthetic expiry',slug:'visit-page-expiry',status:'ended',scheduledAt:new Date(+clock.now-200000),startedAt:new Date(+clock.now-200000),endedAt:new Date(+clock.now-100000),replayEnabled:true,replayAvailableUntil:expires}});
   await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt") VALUES ('page-expiry-version',$1,$2,$3,'replay',$4,100000,true,$5,clock_timestamp()+interval '2 seconds')`,vendor.id,shortLive.id,video.id,service.metricVideoFingerprint(video),start);
   let insertDelayed=false;
   const delayedDb={$transaction:(callback,options)=>db.$transaction(tx=>callback(new Proxy(tx,{get(target,key){
    if(key==='$executeRaw')return async query=>{
     if(query.strings.join('').includes('INSERT INTO "LiveMetricVisitPage"')){insertDelayed=true;await target.$queryRawUnsafe('SELECT pg_sleep(2.1)::text');}
     return target.$executeRaw(query);
    };
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
   }})),options)};
   assert.equal(await service.issueMetricVisitPage(delayedDb,{vendorId:vendor.id,liveId:shortLive.id}),null);assert.equal(insertDelayed,true);assert.equal(await pages(),2);
   receipt.checks.actualVersionExpiresBetweenContextAndInsertReturnsNullWithoutPage='PASS';
   if(sourceMode){
    receipt.stage='registration-source-selection';
    const sourceLive=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,formId:form.id,messageTemplateId:template.id,title:'Synthetic source',slug:'registration-source',status:'ended',scheduledAt:new Date(+clock.now-200000),startedAt:new Date(+clock.now-200000),endedAt:new Date(+clock.now-100000),replayEnabled:true,replayAvailableUntil:expires}});
    await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt")
     VALUES ('source-version',$1,$2,$3,'replay',$4,100000,true,$5,$6)`,vendor.id,sourceLive.id,video.id,service.metricVideoFingerprint(video),start,expires);
    const target={vendorId:vendor.id,liveId:sourceLive.id};
    receipt.stage='registration-source-issue';
    const good=await service.issueMetricRegistrationPage(db,{formId:form.id,liveId:sourceLive.id});assert.ok(good);
    const viewer=await service.issueMetricVisitPage(db,target,{kind:'viewer'});assert.ok(viewer);
    const [tags]=await db.$queryRawUnsafe(`SELECT (SELECT "sourceKind" FROM "LiveMetricVisitPage" WHERE "eventId"=$1) AS registration,
     (SELECT "sourceKind" FROM "LiveMetricVisitPage" WHERE "eventId"=$2) AS viewer`,good.eventId,viewer.eventId);
    assert.deepEqual(tags,{registration:'registration',viewer:'viewer'});
    receipt.stage='registration-source-unknown-default';
    const rawEvent='40000000-0000-4000-8000-000000000001';
    await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVisitPage" ("vendorId","liveId","versionId","eventId","expiresAt") VALUES ($1,$2,'source-version',$3,$4)`,vendor.id,sourceLive.id,rawEvent,expires);
    const [legacy]=await db.$queryRawUnsafe('SELECT "sourceKind","sourceFormId" FROM "LiveMetricVisitPage" WHERE "eventId"=$1',rawEvent);
    assert.deepEqual(legacy,{sourceKind:'unknown',sourceFormId:null});
    const unspecified=await service.issueMetricVisitPage(db,target);assert.ok(unspecified);
    const [neutral]=await db.$queryRawUnsafe('SELECT "sourceKind","sourceFormId" FROM "LiveMetricVisitPage" WHERE "eventId"=$1',unspecified.eventId);
    assert.deepEqual(neutral,{sourceKind:'unknown',sourceFormId:null});
    receipt.stage='registration-source-rejection-guards';
    await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "LiveMetricVisitPage" ("vendorId","liveId","versionId","eventId","expiresAt","sourceKind","sourceFormId")
     VALUES ($1,$2,'source-version','40000000-0000-4000-8000-000000000099',$3,'registration','wrong-form')`,vendor.id,sourceLive.id,expires),error=>error.meta?.code==='23514');
    await assert.rejects(db.$executeRawUnsafe(`UPDATE "LiveMetricVisitPage" SET "sourceKind"='registration',"sourceFormId"=$1 WHERE "eventId"=$2`,form.id,rawEvent),error=>error.meta?.code==='23514');
    await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "LiveMetricVisitPage" ("vendorId","liveId","versionId","eventId","expiresAt","sourceKind")
     VALUES ($1,$2,'source-version','40000000-0000-4000-8000-000000000098',$3,'registration')`,vendor.id,sourceLive.id,expires),error=>error.meta?.code==='23514');
    receipt.checks.serverSourceTagsLegacyUnknownBindingAndImmutableClassification='PASS';
    const first=await service.prepareTrackedMetricVisit(db,proofs,target,null,{eventId:good.eventId});
    await service.collectPreparedMetricVisit(db,proofs,target,{eventId:good.eventId},first.proof);
    await assert.rejects(db.$executeRawUnsafe('INSERT INTO "LiveMetricVisitPage" SELECT * FROM "LiveMetricVisitPage" WHERE "eventId"=$1',good.eventId),error=>error.meta?.code==='23505');
    await assert.rejects(db.$executeRawUnsafe('INSERT INTO "LiveMetricVisitIntent" SELECT * FROM "LiveMetricVisitIntent" WHERE "eventId"=$1',good.eventId),error=>error.meta?.code==='23505');
    for(const event of [viewer.eventId,rawEvent]){
     const prepared=await service.prepareTrackedMetricVisit(db,proofs,target,first.proof,{eventId:event});
     await service.collectPreparedMetricVisit(db,proofs,target,{eventId:event},prepared.proof);
    }
    const unprepared=await service.issueMetricRegistrationPage(db,{formId:form.id,liveId:sourceLive.id});assert.ok(unprepared);
    const [identity]=await db.$queryRawUnsafe('SELECT "visitorId" FROM "LiveMetricVisitIntent" WHERE "eventId"=$1',good.eventId);
    await visit.recordMetricVisit(db,{...target,versionId:'source-version',visitorId:identity.visitorId},{eventId:unprepared.eventId});
    await db.$queryRawUnsafe('SELECT pg_sleep(0.01)::text');
    const [readClock]=await db.$queryRawUnsafe('SELECT clock_timestamp() AS now');
    const queued=await service.enqueueMetricReport(db,{...target,versionId:'source-version',startAt:start,endAt:readClock.now});
    assert.equal(queued.status,'available');
    const [report]=await db.$queryRawUnsafe('SELECT id FROM "LiveMetricReport" WHERE "versionId"=$1','source-version');
    const lease={...target,versionId:'source-version',reportId:report.id,workerId:'source-worker'};assert.equal(await service.claimMetricReport(db,lease),true);
    await db.$transaction(async tx=>{
     const result=await service.readMetricVisitPage(tx,{...lease,after:null,take:1});
     assert.equal(result.status,'available');assert.equal(result.rows.length,1);assert.equal(result.hasMore,false);
     const [expected]=await tx.$queryRawUnsafe('SELECT id FROM "LiveMetricVisit" WHERE "eventId"=$1',good.eventId);
     assert.equal(result.rows[0].id,expected.id);
     const empty=await service.readMetricVisitPage(tx,{...lease,after:result.next,take:1});assert.equal(empty.rows.length,0);
     if(reconciliationMode){
      const reconciled=await service.readMetricCoverage(tx,lease,'visits');
      assert.equal(reconciled.status,'available');assert.equal(reconciled.coverage.reason,'evidence_gap');
      assert.equal(reconciled.sourceReconciliation.summary.registrationFactsInWindow,1);
      assert.equal(reconciled.sourceReconciliation.summary.viewerFactsInWindow,1);
      assert.equal(reconciled.sourceReconciliation.summary.unknownFactsInWindow,1);
      assert.equal(reconciled.sourceReconciliation.summary.unpreparedRegistrationFactsInWindow,1);
      assert.equal(reconciled.sourceReconciliation.rowCount,12);
      receipt.checks.actualReportReconcilesRegistrationViewerUnknownAndUnpreparedFacts='PASS';
     }
    },{isolationLevel:'RepeatableRead'});
    receipt.checks.actualReportLeaseReaderExcludesViewerLegacyAndUnpreparedRegistration='PASS';
    receipt.checks.pageAndPreparedIntentUniqueKeysPreventJoinMultiplication='PASS';
    await db.live.delete({where:{id:sourceLive.id}});assert.equal(await pages(),2);
   }
   if(reconciliationMode){
    receipt.stage='visit-reconciliation';
    try{Object.assign(receipt.checks,await runVisitReconciliationProbe({db,service,vendor,video,form,template,clock,start,expires}));}
    catch(error){
     if(/^[a-z-]+$/.test(error.probeStage??''))receipt.probeStage=error.probeStage;
     if(Number.isInteger(error.probeReason))receipt.probeReason=error.probeReason;
     if(['scope_or_window_unavailable','previous_failure','contention','integrity_violation','enqueue_failed'].includes(error.probeQueueReason))receipt.probeQueueReason=error.probeQueueReason;
     const primitive=value=>typeof value==='number'||typeof value==='boolean'||['available','unavailable','unknown_history','evidence_gap','unknown','viewer','registration'].includes(value);
     if(primitive(error.actual)&&primitive(error.expected))receipt.assertion={actual:error.actual,expected:error.expected};
     throw error;
    }
    assert.equal(await pages(),2);
   }
   if(auditVisibilityMode){
    receipt.stage='audit-visibility';
    const createPoolClient=()=>{const target=new URL(databaseUrl);assert.equal(target.hostname,'127.0.0.1');target.searchParams.set('connection_limit','1');return new PrismaClient({datasourceUrl:target.toString(),log:[]});};
    Object.assign(receipt.checks,await runAuditVisibilityProbe({db,service,vendor,video,form,template,clock,start,expires,createPoolClient}));assert.equal(await pages(),2);
   }
   receipt.stage='page-quota';
   await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVisitPage" ("vendorId","liveId","versionId","eventId","expiresAt")
    SELECT $1,$2,'intent-version','30000000-0000-4000-8000-'||lpad(to_hex(n),12,'0'),$3::timestamptz FROM generate_series(1,9997) n`,vendor.id,live.id,expires);
   assert.equal(await pages(),9999);
   const nearCap=await Promise.all(Array.from({length:8},()=>service.issueMetricVisitPage(db,publicScope)));
   assert.equal(nearCap.filter(value=>value!==null).length,1);assert.equal(nearCap.filter(value=>value===null).length,7);assert.equal(await pages(),10000);
   assert.equal(await service.issueMetricVisitPage(db,publicScope),null);assert.equal(await pages(),10000);
   const [losses]=await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "LiveMetricVisitPage" WHERE "lossAt" IS NOT NULL');assert.equal(losses.count,1);
   await assert.rejects(db.$executeRawUnsafe('UPDATE "LiveMetricVisitPage" SET "lossAt"=NULL WHERE "lossAt" IS NOT NULL'),error=>error.meta?.code==='23514');
   await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "LiveMetricVisitPage" ("vendorId","liveId","versionId","eventId","expiresAt") VALUES ($1,$2,'intent-version','30000000-0000-4000-8000-ffffffffffff',$3)`,vendor.id,live.id,expires),error=>error.meta?.code==='P2091');
   receipt.checks.tenThousandCapEightParallelLastSlotOneSuccessAndPermanentUnresettableGap='PASS';
   receipt.stage='cascade';await db.vendor.delete({where:{id:vendor.id}});assert.deepEqual(await counts(),{intents:0,visits:0});
   assert.equal(await pages(),0);
   receipt.checks.vendorCascadeNoOrphans='PASS';receipt.status='PASS';receipt.stage='complete';
  }catch(error){
   receipt.errorType=error?.name;receipt.errorCode=['SCOPE_UNAVAILABLE','PERSISTENCE_UNAVAILABLE','PROOF_INVALID','VISITOR_MISSING'].includes(error?.code)||/^P[0-9]{4}$/.test(error?.code??'')?error.code:'ASSERTION_OR_RUNNER_ERROR';
   if(/^[0-9A-Z]{5}$/.test(error?.meta?.code??''))receipt.sqlState=error.meta.code;
   if(error?.name==='AssertionError'){
    const frame=String(error.stack??'').match(/wp20-(visit-page-disposable|visit-reconciliation-probe|audit-visibility-probe)\.mjs:(\d+):/u);
    if(frame)receipt.assertionLocation={file:frame[1],line:Number(frame[2])};
   }
   throw new Error('sanitized-visit-intent-probe-failed');
  }
  finally{await db.$disconnect();}
 }});
}catch(error){receipt.errorType=error?.name;receipt.errorCode=/^(?:P[0-9]{4}|[0-9A-Z]{5})$/.test(error?.meta?.code??error?.code??'')?(error.meta?.code??error.code):'ASSERTION_OR_RUNNER_ERROR';}
receipt.cleanup=migration?.cleanup??'UNKNOWN';receipt.migrationCount=migration?.migrationNames?.length??null;
if(migration?.status!=='PASS')receipt.status='FAIL';
fs.writeFileSync(`${base}/${auditVisibilityMode?'audit-visibility':reconciliationMode?'visit-reconciliation':sourceMode?'registration-source':registrationMode?'registration-surface':'visit-page'}-db.json`,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));process.exitCode=receipt.status==='PASS'?0:1;
