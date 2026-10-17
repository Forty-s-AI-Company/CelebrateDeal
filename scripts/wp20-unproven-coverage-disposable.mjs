import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {main} from './prisma-loopback-disposable-migration-runner.mjs';
const require=createRequire(import.meta.url),base='docs/ai-team/evidence/product-audit-20261011/WP-20/coverage';
const reproduce=process.argv.includes('--reproduce');
const source='src/lib/live-metric-coverage-reader.ts';
const migrationPath='prisma/migrations/20261016130000_live_metric_unproven_coverage/migration.sql';
const receipt={status:'FAIL',stage:'start',mode:reproduce?'historical-schema-equivalent-reproduction':'verification',checks:{},sourceHashes:Object.fromEntries([source,migrationPath,'scripts/wp20-unproven-coverage-disposable.mjs'].map(file=>[file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]))};
let migration;
try{
 const paths=JSON.parse(fs.readFileSync('node_modules/.prisma/client/index.js','utf8').match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1]??'null');assert.ok(paths&&Object.values(paths).every(value=>value===null));
 const {PrismaClient}=require('@prisma/client');
 const built=await build({stdin:{contents:'export {readMetricCoverage} from "./src/lib/live-metric-coverage-reader.ts";export {claimMetricReport,finishMetricReport} from "./src/lib/live-metric-report-lease.ts";export {publishRegistrationCoverage} from "./src/lib/live-metric-registration-coverage.ts";export {publishOrderCoverage} from "./src/lib/live-metric-order-coverage.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent'});
 const compiled={exports:{}};new Function('require','module','exports',built.outputFiles[0].text)(require,compiled,compiled.exports);const service=compiled.exports;
 const legacySource=JSON.parse(fs.readFileSync(`${base}/unproven-coverage-legacy-reader-source.json`,'utf8'));
 // Snapshot text uses Python universal newlines; bind it back to the actual
 // pre-fix byte hash (LF or Windows CRLF), not an unverified edited source.
 assert.ok([legacySource.source,legacySource.source.replace(/\n/g,'\r\n')].some(text=>createHash('sha256').update(text).digest('hex')===legacySource.sha256));
 assert.equal(legacySource.sha256,JSON.parse(fs.readFileSync(`${base}/unproven-coverage-reproduction.json`,'utf8')).sourceHashes[source]);
 const legacyBuilt=await build({stdin:{contents:legacySource.source,resolveDir:process.cwd()+'/src/lib',loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent'});
 const legacy={exports:{}};new Function('require','module','exports',legacyBuilt.outputFiles[0].text)(require,legacy,legacy.exports);
 migration=await main({afterMigrate:async({databaseUrl,environment})=>{
  const url=new URL(databaseUrl);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/celebratedeal_test');
  const db=new PrismaClient({datasourceUrl:databaseUrl,log:[]});
  try{
   const [marker]=await db.$queryRawUnsafe("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");assert.match(marker.marker,/^prisma-no-dotenv:[a-f0-9]{16}$/u);
   // Target only this owned runner container, from its already-verified DB
   // marker. Inspect ID/marker only; never inspect Config.Env or raw logs.
   const name='celebratedeal-prisma-migrate-'+marker.marker.slice('prisma-no-dotenv:'.length);
   const invoke=(args,input)=>spawnSync('docker',args,{env:environment,input,encoding:'utf8',windowsHide:true,maxBuffer:1048576,timeout:45000});
   const inspected=invoke(['inspect','--format','{{.Id}}',name]);assert.equal(inspected.status,0);const containerId=inspected.stdout.trim();assert.match(containerId,/^[a-f0-9]{64}$/u);
   const label=invoke(['inspect','--format','{{index .Config.Labels "celebratedeal.marker"}}',containerId]);assert.equal(label.status,0);assert.equal(label.stdout.trim(),marker.marker);
   const sql=text=>invoke(['exec','-i',containerId,'psql','-X','--set','ON_ERROR_STOP=1','-U','postgres','-d','celebratedeal_test'],text);
   const upgrade=fs.readFileSync(migrationPath,'utf8');
   // Recreate the exact pre125 schema difference on the owned disposable DB.
   // Canonical125 migration history is untouched; this is compatibility replay,
   // not a claim of an independent populated Prisma CLI upgrade.
   assert.equal(sql('DROP TRIGGER "LiveMetricCoverageAudit_unproven_guard" ON public."LiveMetricCoverageAudit"; DROP FUNCTION public.wp20_metric_unproven_coverage_guard();').status,0);
   receipt.stage='fixtures';
   const vendor=await db.vendor.create({data:{name:'Synthetic proof',slug:'unproven-coverage',email:'proof@example.test',passwordHash:'synthetic-unused'}});
   const video=await db.video.create({data:{vendorId:vendor.id,title:'Synthetic',videoUrl:'https://example.test/synthetic.mp4',durationSec:100}});
   const [clock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
   const start=new Date(+clock.now-20000),end=new Date(+clock.now-10000),expires=new Date(+clock.now+3600000);
   const live=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,title:'Synthetic',slug:'unproven-coverage',scheduledAt:start}});
   const scope={vendorId:vendor.id,liveId:live.id,versionId:'unproven-version'};
   await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt") VALUES ($1,$2,$3,$4,'replay',$5,100000,true,$6,$7)`,scope.versionId,vendor.id,live.id,video.id,'a'.repeat(64),start,expires);
   for(const kind of ['visits','viewing'])await db.$executeRawUnsafe(`INSERT INTO "LiveMetricCoverageAudit" (id,"vendorId","liveId","versionId",kind,status,"startAt","endAt","sourceRevision","auditDigest") VALUES ($1,$2,$3,$4,$5,'covered',$6,$7,0,$8)`,kind+'-legacy',vendor.id,live.id,scope.versionId,kind,start,end,'b'.repeat(64));
   const lease={...scope,reportId:'unproven-report',workerId:'unproven-worker'};
   await db.$queryRawUnsafe('SELECT public.wp20_metric_report_create($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,0::bigint,$7::timestamptz)',vendor.id,live.id,scope.versionId,lease.reportId,start,end,expires);
   assert.equal(await service.claimMetricReport(db,lease),true);
   receipt.stage='legacy-read';
   const read=kind=>db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return service.readMetricCoverage(tx,lease,kind);},{isolationLevel:'RepeatableRead',timeout:10000});
   const readWith=(reader,selectedLease,kind)=>db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return reader(tx,selectedLease,kind);},{isolationLevel:'RepeatableRead',timeout:10000});
   receipt.observedLegacyReader={};
   for(const kind of ['visits','viewing']){
    const result=await readWith(legacy.exports.readMetricCoverage,lease,kind);receipt.observedLegacyReader[kind]={rows:result.rowCount,coverage:result.coverage};
    assert.equal(result.coverage.status,'complete');
    if(!reproduce)assert.deepEqual((await read(kind)).coverage,{status:'unavailable',reason:'unknown_history'});
   }
   const [empty]=await db.$queryRawUnsafe(`SELECT (SELECT count(*)::int FROM "LiveMetricVisitPage") AS pages,(SELECT count(*)::int FROM "LiveMetricVisitIntent") AS intents,(SELECT count(*)::int FROM "LiveMetricVisit") AS visits,(SELECT count(*)::int FROM "LiveMetricSession") AS sessions`);
   assert.deepEqual(empty,{pages:0,intents:0,visits:0,sessions:0});
   receipt.bugReproduced=true;
   if(reproduce){receipt.status='REPRODUCED';receipt.stage='complete';return;}
   receipt.checks.actualLegacyReaderTrustsUnprovenRowsCurrentReaderRejectsBothKinds='PASS';
   const unavailable={status:'unavailable',reason:'missing_data'};
   const aggregate={registrationRate:unavailable,attendanceRate:unavailable,completionRate:unavailable,averageViewingSeconds:unavailable,postCompletionOrderRate:unavailable,unattributedRegistrations:null,provisionalConversions:null};
   assert.equal(await service.finishMetricReport(db,lease,aggregate),true);
   // Supported real producers must retain positive coverage. Their facts are
   // genuinely empty, not caller-provided forged proof fields.
   const other={...scope,versionId:'supported-version'};
   await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt") VALUES ($1,$2,$3,$4,'replay',$5,100000,true,$6,$7)`,other.versionId,vendor.id,live.id,video.id,'c'.repeat(64),start,expires);
   const supportedScope={...other,startAt:start,endAt:end};
   assert.equal((await service.publishRegistrationCoverage(db,supportedScope)).status,'recorded');
   assert.equal((await service.publishOrderCoverage(db,supportedScope)).status,'recorded');
   const otherLease={...other,reportId:'supported-report',workerId:'supported-worker'};
   await db.$queryRawUnsafe('SELECT public.wp20_metric_report_create($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,0::bigint,$7::timestamptz)',vendor.id,live.id,other.versionId,otherLease.reportId,start,end,expires);
   assert.equal(await service.claimMetricReport(db,otherLease),true);
   for(const kind of ['registrations','orders'])assert.equal((await readWith(service.readMetricCoverage,otherLease,kind)).coverage.status,'complete');
   assert.equal(await service.finishMetricReport(db,otherLease,aggregate),true);
   receipt.stage='atomic-failure';
   const forced=upgrade.replace('UPDATE public."LiveMetricVersion"',"DO $$ BEGIN RAISE EXCEPTION 'synthetic upgrade rollback' USING ERRCODE='23514'; END $$;\nUPDATE public.\"LiveMetricVersion\"");
   assert.notEqual(sql(forced).status,0);
   const [rolledBack]=await db.$queryRawUnsafe("SELECT to_regprocedure('public.wp20_metric_unproven_coverage_guard()')::text AS guard");assert.equal(rolledBack.guard,null);
   const [pre]=await db.$queryRawUnsafe('SELECT status,result IS NOT NULL AS cached FROM "LiveMetricReport" WHERE id=$1',lease.reportId);assert.equal(pre.status,'ready');assert.equal(pre.cached,true);
   receipt.checks.exactMigrationForcedFailureRollsBackGateAndKeepsCachedReport='PASS';
   receipt.stage='compatibility-upgrade';assert.equal(sql(upgrade).status,0);
   const versions=await db.$queryRawUnsafe('SELECT id,"sourceRevision" FROM "LiveMetricVersion" ORDER BY id');
   assert.equal(versions.find(row=>row.id===scope.versionId).sourceRevision,BigInt(1));assert.equal(versions.find(row=>row.id===other.versionId).sourceRevision,BigInt(0));
   const [stale]=await db.$queryRawUnsafe('SELECT status,result,"leaseOwner","leaseExpiresAt" FROM "LiveMetricReport" WHERE id=$1',lease.reportId);
   assert.deepEqual(stale,{status:'stale',result:null,leaseOwner:null,leaseExpiresAt:null});
   const [untouched]=await db.$queryRawUnsafe('SELECT status,result IS NOT NULL AS cached FROM "LiveMetricReport" WHERE id=$1',otherLease.reportId);assert.equal(untouched.status,'ready');assert.equal(untouched.cached,true);
   const [retained]=await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "LiveMetricCoverageAudit" WHERE kind IN (\'visits\',\'viewing\') AND status=\'covered\'');assert.equal(retained.count,2);
   assert.equal(await service.finishMetricReport(db,lease,aggregate),false);
   receipt.checks.affectedRevisionBumpedOnceCachedResultAndLeaseInvalidatedSupportedVersionUnchangedAndRawEvidenceRetained='PASS';
   receipt.stage='post-upgrade-read';
   const post={...scope,reportId:'post-upgrade-report',workerId:'post-upgrade-worker'};
   await db.$queryRawUnsafe('SELECT public.wp20_metric_report_create($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,1::bigint,$7::timestamptz)',vendor.id,live.id,scope.versionId,post.reportId,start,end,expires);
   assert.equal(await service.claimMetricReport(db,post),true);
   for(const kind of ['visits','viewing']){
    assert.deepEqual((await readWith(service.readMetricCoverage,post,kind)).coverage,{status:'unavailable',reason:'unknown_history'});
    assert.deepEqual((await readWith(legacy.exports.readMetricCoverage,post,kind)).coverage,{status:'unavailable',reason:'unknown_history'});
    await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "LiveMetricCoverageAudit" (id,"vendorId","liveId","versionId",kind,status,"startAt","endAt","sourceRevision","auditDigest") VALUES ($1,$2,$3,$4,$5,'covered',$6,$7,1,$8)`,kind+'-rejected',vendor.id,live.id,scope.versionId,kind,start,end,'d'.repeat(64)),error=>error.meta?.code==='23514');
   }
   receipt.checks.newGateRejectsUnprovenWritesAndBothOldAndNewReadersIgnoreLegacyPositives='PASS';
   receipt.stage='negative-gaps';
   await db.$executeRawUnsafe(`INSERT INTO "LiveMetricCoverageAudit" (id,"vendorId","liveId","versionId",kind,status,"startAt","endAt","sourceRevision","auditDigest") VALUES ('preserved-gap',$1,$2,$3,'visits','gap',$4,$5,1,$6)`,vendor.id,live.id,scope.versionId,start,end,'e'.repeat(64));
   // The gap itself invalidated the running lease; a new scoped generation
   // must observe the negative evidence rather than reuse that old lease.
   const gapLease={...scope,reportId:'gap-report',workerId:'gap-worker'};
   await db.$queryRawUnsafe('SELECT public.wp20_metric_report_create($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,1::bigint,$7::timestamptz)',vendor.id,live.id,scope.versionId,gapLease.reportId,start,end,expires);
   assert.equal(await service.claimMetricReport(db,gapLease),true);
   await assert.rejects(db.$executeRawUnsafe('UPDATE "LiveMetricCoverageAudit" SET status=\'covered\' WHERE id=\'preserved-gap\''),error=>error.meta?.code==='23514');
   await assert.rejects(db.$executeRawUnsafe('UPDATE "LiveMetricCoverageAudit" SET "sourceRevision"=1 WHERE id=\'visits-legacy\''),error=>error.meta?.code==='23514');
   assert.notEqual((await readWith(legacy.exports.readMetricCoverage,gapLease,'visits')).coverage.status,'complete');
   receipt.checks.existingAppendOnlyGuardRejectsGapPromotionAndLegacyRevisionRefresh='PASS';
   assert.deepEqual((await readWith(service.readMetricCoverage,gapLease,'visits')).coverage,{status:'unavailable',reason:'evidence_gap'});
   await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "LiveMetricCoverageAudit" (id,"vendorId","liveId","versionId",kind,status,"startAt","endAt","sourceRevision","auditDigest")
    VALUES ('batch-gap',$1,$2,$3,'visits','gap',$4,$5,1,$6),('batch-unproven',$1,$2,$3,'viewing','covered',$4,$5,1,$6)`,vendor.id,live.id,scope.versionId,start,end,'f'.repeat(64)),error=>error.meta?.code==='23514');
   const [batch]=await db.$queryRawUnsafe("SELECT count(*)::int AS count FROM \"LiveMetricCoverageAudit\" WHERE id IN ('batch-gap','batch-unproven')");assert.equal(batch.count,0);
   assert.deepEqual((await readWith(service.readMetricCoverage,gapLease,'visits')).coverage,{status:'unavailable',reason:'evidence_gap'});
   receipt.checks.rejectedMixedBatchRollsBackEarlierGapAndItsLeaseInvalidation='PASS';
   const [acl]=await db.$queryRawUnsafe(`SELECT NOT p.prosecdef AS invoker,NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner) AS private FROM pg_proc p WHERE p.oid='public.wp20_metric_unproven_coverage_guard()'::regprocedure`);assert.equal(acl.invoker,true);assert.equal(acl.private,true);
   receipt.checks.negativeGapsRemainReadableAndRealRegistrationOrderProofsUnaffectedPrivateInvokerGate='PASS';
   receipt.status='PASS';receipt.stage='complete';
  }catch(error){receipt.errorType=error?.name;receipt.errorCode=/^(?:P[0-9]{4}|[0-9A-Z]{5})$/.test(error?.meta?.code??error?.code??'')?(error.meta?.code??error.code):'ASSERTION_OR_RUNNER_ERROR';throw new Error('sanitized-unproven-coverage-check-failed');}
  finally{await db.$disconnect();}
 }});
}catch{receipt.errorCode??='RUNNER_ERROR';}
receipt.cleanup=migration?.cleanup??'UNKNOWN';receipt.migrationCount=migration?.migrationNames?.length??null;
if(migration?.status!=='PASS')receipt.status='FAIL';
fs.writeFileSync(`${base}/unproven-coverage-${reproduce?'historical-reproduction':'db'}.json`,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));process.exitCode=['PASS','REPRODUCED'].includes(receipt.status)?0:1;
