import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { main } from './prisma-loopback-disposable-migration-runner.mjs';
const require=createRequire(import.meta.url),output='docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/order-upgrade-load-result.json';
const receipt={status:'FAIL',stage:'start',linkedPayments:100000,scope:'Synthetic117 touch cost and bounded competing writer; not Production scale certification or producer completeness'};
const save=()=>fs.writeFileSync(output,JSON.stringify(receipt,null,2));
const stage=value=>{receipt.stage=value;save();console.log(JSON.stringify({stage:value}));};
function docker(args,environment,input='') {
 return new Promise(resolve=>{
  const child=spawn('docker',args,{env:environment,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.on('data',x=>{if(stdout.length<8192)stdout+=x.toString('utf8');});
  child.stderr.on('data',x=>{if(stderr.length<8192)stderr+=x.toString('utf8');});
  child.on('error',()=>resolve({exitCode:null,stdout:'',stderr:'runner-start-failed'}));
  child.on('close',code=>resolve({exitCode:code,stdout,stderr}));child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
let migration;
try {
 const paths=JSON.parse(fs.readFileSync('node_modules/.prisma/client/index.js','utf8').match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1]??'null');assert.ok(paths&&Object.values(paths).every(x=>x===null));
 const {PrismaClient}=require('@prisma/client');
 const migrationSql=fs.readFileSync('prisma/migrations/20261016050000_live_metric_order_upgrade_snapshot_fence/migration.sql','utf8');
 migration=await main({afterMigrate:async({databaseUrl,environment,tempRoot})=>{
  const url=new URL(databaseUrl);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/celebratedeal_test');url.searchParams.set('connection_limit','4');
  const db=new PrismaClient({datasourceUrl:url.toString()});
  try {
   const [marker]=await db.$queryRawUnsafe("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");assert.match(marker.marker,/^prisma-no-dotenv:[a-f0-9]{16}$/u);
   const container=path.basename(tempRoot);assert.match(container,/^celebratedeal-prisma-migrate-[a-f0-9]{16}$/u);
   const ownership=await docker(['inspect','--format','{{ index .Config.Labels "celebratedeal.marker" }}',container],environment);
   assert.equal(ownership.exitCode,0);assert.equal(ownership.stdout.trim(),marker.marker);
   stage('fixtures');
   const vendor=await db.vendor.create({data:{name:'Synthetic upgrade load',slug:'upgrade-load',email:'upgrade-load@example.test',passwordHash:'synthetic-unused'}});
   const video=await db.video.create({data:{vendorId:vendor.id,title:'Synthetic',videoUrl:'https://example.test/synthetic.mp4',durationSec:100}});
   const live=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,title:'Synthetic',slug:'upgrade-load',scheduledAt:new Date()}});
   const [clock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");const created=new Date(+clock.now-60000);
   await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"collectionEnabled","collectionStartedAt","expiresAt") VALUES ('upgrade-load-version',$1,$2,$3,'live',$4,true,$5,$6)`,vendor.id,live.id,video.id,'a'.repeat(64),created,new Date(+clock.now+3600000));
   const setup=performance.now();
   await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout='180s'");
    stage('fixtures-payments');
    await tx.$executeRawUnsafe(`INSERT INTO "PaymentTransaction" (id,"vendorId","providerName",status,"grossAmountCents","netAmountCents",currency,metadata,"occurredAt","createdAt")
     SELECT 'upgrade-payment-'||lpad(i::text,8,'0'),$1,'synthetic-upgrade-load','paid',100,100,'TWD','{"syntheticLoad":true}'::jsonb,$2,$2 FROM generate_series(1,100000) i`,vendor.id,created);
    stage('fixtures-linked-orders');
    await tx.$executeRawUnsafe(`INSERT INTO "CommerceOrder" (id,"vendorId","primaryPaymentTransactionId","orderNumber","checkoutIdempotencyKey","checkoutIdentityHash",status,currency,"subtotalAmountCents","totalAmountCents","paidAmountCents","paidAt","buyerEncryptedEnvelope","buyerMaskedName","buyerMaskedEmail","createdAt","updatedAt")
     SELECT 'upgrade-order-'||lpad(i::text,8,'0'),$1,'upgrade-payment-'||lpad(i::text,8,'0'),'UPGRADE-'||i,'upgrade-key-'||i,repeat('a',43),'paid','TWD',100,100,100,$2,'synthetic-unused','Synthetic','synthetic@example.test',$2,$2 FROM generate_series(1,100000) i`,vendor.id,created);
   },{timeout:300000});receipt.setupMs=Math.round(performance.now()-setup);
   await db.$executeRawUnsafe('ANALYZE "PaymentTransaction"');await db.$executeRawUnsafe('ANALYZE "CommerceOrder"');
   const facts=async()=> (await db.$queryRawUnsafe(`SELECT count(*)::integer AS count,md5(string_agg(md5(to_jsonb(p)::text),'' ORDER BY id)) AS digest,min(xmin::text) AS xmin,count(DISTINCT xmin::text)::integer AS transactions FROM "PaymentTransaction" p WHERE "vendorId"=$1`,vendor.id))[0];
   const sources=async()=> (await db.$queryRawUnsafe(`SELECT
    (SELECT count(*)::integer FROM "LiveMetricOrderWindowSource" WHERE "vendorId"=$1) AS window,
    (SELECT count(*)::integer FROM "LiveMetricOrderTenantSource" WHERE "vendorId"=$1) AS tenant,
    (SELECT count(*)::integer FROM "LiveMetricOrderSource" WHERE "vendorId"=$1) AS scoped,
    (SELECT count(*)::integer FROM "LiveMetricCoverageAudit" WHERE "vendorId"=$1) AS audits`,vendor.id))[0];
   const before=await facts(),beforeSources=await sources();assert.equal(before.count,receipt.linkedPayments);assert.equal(before.transactions,1);
   const [walBefore]=await db.$queryRawUnsafe('SELECT pg_current_wal_insert_lsn()::text AS lsn');
   stage('literal117-sql');let finished=false;
   const started=performance.now();
   const execution=docker(['exec','-i','-e','PGAPPNAME=wp20-upgrade-load',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-U','postgres','-d','celebratedeal_test','-f','-'],environment,migrationSql).then(value=>{finished=true;return value;});
   let writerStarted=false;
   while(!finished){
    const [state]=await db.$queryRawUnsafe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.application_name='wp20-upgrade-load' AND l.relation='public."PaymentTransaction"'::regclass AND l.mode='ShareRowExclusiveLock' AND l.granted) AS held`);
    if(state.held&&!writerStarted){
     writerStarted=true;receipt.tableLockObserved=true;const writerStart=performance.now();
     await assert.rejects(db.$transaction(async tx=>{
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout='150ms'");
      await tx.$executeRawUnsafe('UPDATE "PaymentTransaction" SET metadata=metadata WHERE id=$1','upgrade-payment-00000001');
     },{timeout:5000}),error=>error?.meta?.code==='55P03');
     receipt.writerWaitMs=Math.round(performance.now()-writerStart);assert.ok(receipt.writerWaitMs<2000);
    }
    if(!finished)await db.$queryRawUnsafe('SELECT pg_sleep(0.025)::text');
   }
   const result=await execution;receipt.migrationMs=Math.round(performance.now()-started);receipt.lockHoldUpperBoundMs=receipt.migrationMs;
   receipt.sqlExitCode=result.exitCode;receipt.sqlStatementTimeout=/57014/.test(result.stderr);
   assert.equal(result.exitCode,0);assert.equal(writerStarted,true);assert.ok(receipt.migrationMs<35000);
   const [wal]=await db.$queryRawUnsafe('SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(),$1::pg_lsn)::text AS bytes',walBefore.lsn);receipt.walBytes=Number(wal.bytes);
   const after=await facts();assert.equal(after.count,before.count);assert.equal(after.digest,before.digest);
   const [oldRows]=await db.$queryRawUnsafe('SELECT count(*)::integer AS count FROM "PaymentTransaction" WHERE "vendorId"=$1 AND xmin::text=$2',vendor.id,before.xmin);assert.equal(oldRows.count,0);
   assert.deepEqual(await sources(),beforeSources);
   const [version]=await db.$queryRawUnsafe('SELECT "sourceRevision" FROM "LiveMetricVersion" WHERE id=$1','upgrade-load-version');assert.equal(version.sourceRevision,1n);
   receipt.allRowsMvccChanged=true;receipt.allPaymentFieldsUnchanged=true;receipt.sourceEventDeltaZero=true;receipt.versionBumped=true;
   receipt.triggerQueuePeakMemory='NOT_MEASURED';receipt.productionScale='UNKNOWN_NOT_ACCESSED';receipt.status='PASS';stage('complete');
  } finally {await db.$disconnect();}
 }});
} catch(error){receipt.errorCode=/^(?:P[0-9]{4}|[0-9A-Z]{5})$/.test(error?.meta?.code??error?.code??'')?(error.meta?.code??error.code):'ASSERTION_OR_RUNNER_ERROR';}
receipt.cleanup=migration?.cleanup??'UNKNOWN';if(migration?.status!=='PASS')receipt.status='FAIL';save();console.log(JSON.stringify(receipt));process.exitCode=receipt.status==='PASS'?0:1;
