import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { main } from './prisma-loopback-disposable-migration-runner.mjs';
const require=createRequire(import.meta.url),base='docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/';
const receipt={status:'FAIL',stage:'start',scope:'Owned disposable source-fence upgrade reproduction; no report completeness claim'};
let migration;
try {
 const paths=JSON.parse(fs.readFileSync('node_modules/.prisma/client/index.js','utf8').match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1]??'null');
 assert.ok(paths&&Object.values(paths).every(x=>x===null));
 const {PrismaClient}=require('@prisma/client');
 const oldSource=fs.readFileSync('prisma/migrations/20261016030000_live_metric_order_payment_serialization/migration.sql','utf8');
 const newSource=fs.readFileSync('prisma/migrations/20261016050000_live_metric_order_upgrade_snapshot_fence/migration.sql','utf8');
 const oldFunction=oldSource.match(/CREATE FUNCTION public\.wp20_metric_order_payment_lock\(\)[\s\S]*?END \$\$;/u)?.[0]?.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
 const newFunction=newSource.match(/CREATE OR REPLACE FUNCTION public\.wp20_metric_order_payment_lock\(\)[\s\S]*?END \$\$;/u)?.[0];
 const upgradeTouch=newSource.match(/DO \$upgrade_touch\$[\s\S]*?END \$upgrade_touch\$;/u)?.[0];
 assert.ok(oldFunction&&newFunction&&upgradeTouch);
 migration=await main({afterMigrate:async({databaseUrl})=>{
  const url=new URL(databaseUrl);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/celebratedeal_test');
  const db=new PrismaClient({datasourceUrl:databaseUrl});
  try {
   const [marker]=await db.$queryRawUnsafe("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");assert.match(marker.marker,/^prisma-no-dotenv:[a-f0-9]{16}$/u);
   receipt.stage='fixtures';
   const vendor=await db.vendor.create({data:{name:'Synthetic upgrade',slug:'upgrade-snapshot',email:'upgrade@example.test',passwordHash:'synthetic-unused'}});
   const video=await db.video.create({data:{vendorId:vendor.id,title:'Synthetic',videoUrl:'https://example.test/synthetic.mp4',durationSec:100}});
   const live=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,title:'Synthetic',slug:'upgrade-snapshot',scheduledAt:new Date()}});
   const [clock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
   const start=new Date(+clock.now-10800000),middle=new Date(+clock.now-7200000),end=new Date(+clock.now-3600000);
   await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"collectionEnabled","collectionStartedAt","expiresAt") VALUES ('upgrade-version',$1,$2,$3,'live',$4,true,$5,$6)`,vendor.id,live.id,video.id,'d'.repeat(64),start,new Date(+clock.now+3600000));
   const payment=await db.paymentTransaction.create({data:{vendorId:vendor.id,providerName:'synthetic-upgrade',status:'pending',metadata:{syntheticBeforeUpgrade:1}}});
   for(const [id,date,link] of [['upgrade-old',new Date(+start+1000),payment.id],['upgrade-new',new Date(+middle+1000),null]])await db.commerceOrder.create({data:{id,vendorId:vendor.id,primaryPaymentTransactionId:link,orderNumber:id,checkoutIdempotencyKey:id,checkoutIdentityHash:'a'.repeat(43),status:'pending_payment',subtotalAmountCents:100,totalAmountCents:100,buyerEncryptedEnvelope:'synthetic-unused',buyerMaskedName:'Synthetic',buyerMaskedEmail:'synthetic@example.test',createdAt:date}});
   const revision=async()=> (await db.$queryRawUnsafe('SELECT public.wp20_metric_order_window_revision($1,$2::timestamptz,$3::timestamptz) AS revision',vendor.id,middle,end))[0].revision;
   // Reinstall only the known115 function, without disabling a trigger or guard.
   await db.$executeRawUnsafe(oldFunction);
   let beforeCommit,afterCommit,writeCode=null;
   receipt.stage='pre-upgrade-snapshot';
   try {
    await db.$transaction(async oldTx=>{
     await oldTx.$queryRawUnsafe('SELECT metadata FROM "PaymentTransaction" WHERE id=$1',payment.id);
     await db.$transaction(async writer=>{
      await writer.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=NULL WHERE id=$1','upgrade-old');
      await writer.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=$1 WHERE id=$2',payment.id,'upgrade-new');
     });
     // Execute117's lock/function/payment-touch/bump protocol atomically.
     await db.$transaction(async upgrade=>{
      await upgrade.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
      await upgrade.$executeRawUnsafe("SET LOCAL statement_timeout='30s'");
      await upgrade.$executeRawUnsafe("SET LOCAL row_security=off");
      await upgrade.$executeRawUnsafe('LOCK TABLE public."PaymentTransaction",public."CommerceOrder" IN SHARE ROW EXCLUSIVE MODE');
      await upgrade.$executeRawUnsafe(newFunction);
      await upgrade.$executeRawUnsafe(upgradeTouch);
      await upgrade.$executeRawUnsafe('UPDATE public."LiveMetricVersion" SET "sourceRevision"="sourceRevision"+1');
     },{timeout:15000});
     const [version]=await db.$queryRawUnsafe('SELECT "sourceRevision" FROM "LiveMetricVersion" WHERE id=$1','upgrade-version');
     assert.equal(version.sourceRevision,1n);receipt.versionBumped=true;
     beforeCommit=await revision();
     await oldTx.paymentTransaction.update({where:{id:payment.id},data:{metadata:{syntheticAfterUpgrade:1}}});
    },{isolationLevel:'RepeatableRead',timeout:30000});
   } catch(error) {
    writeCode=error?.meta?.code??error?.code;
    if(!['40001','P2034'].includes(writeCode))throw error;
   }
   afterCommit=await revision();
   receipt.oldSnapshotWriteAborted=writeCode!==null;receipt.writeCode=writeCode;
   receipt.destinationRevisionIncreased=typeof beforeCommit==='bigint'&&afterCommit>beforeCommit;
   receipt.stage='upgrade-invalidation';
   assert.ok(receipt.oldSnapshotWriteAborted||receipt.destinationRevisionIncreased,'old pre-upgrade snapshot must abort or invalidate destination window');
   receipt.stage='rls-fail-closed';
   const beforeGuard=await db.paymentTransaction.findUniqueOrThrow({where:{id:payment.id}});
   await assert.rejects(db.$transaction(async guarded=>{
    await guarded.$executeRawUnsafe('CREATE ROLE wp20_upgrade_rls_probe NOLOGIN');
    await guarded.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO wp20_upgrade_rls_probe');
    await guarded.$executeRawUnsafe('GRANT SELECT,UPDATE ON "PaymentTransaction","CommerceOrder" TO wp20_upgrade_rls_probe');
    await guarded.$executeRawUnsafe('ALTER TABLE "PaymentTransaction" FORCE ROW LEVEL SECURITY');
    await guarded.$executeRawUnsafe('SET LOCAL ROLE wp20_upgrade_rls_probe');
    await guarded.$executeRawUnsafe('SET LOCAL row_security=off');
    await guarded.$executeRawUnsafe(upgradeTouch);
   },{timeout:10000}),error=>error?.meta?.code==='42501');
   assert.deepEqual(await db.paymentTransaction.findUniqueOrThrow({where:{id:payment.id}}),beforeGuard);
   const [rlsState]=await db.$queryRawUnsafe(`SELECT relforcerowsecurity AS forced,
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wp20_upgrade_rls_probe') AS probe_role
    FROM pg_class WHERE oid='public."PaymentTransaction"'::regclass`);
   assert.deepEqual(rlsState,{forced:false,probe_role:false});
   receipt.rlsFilteredTouchRejected=true;receipt.rlsFailureRollback=true;
   receipt.stage='touch-count-fail-closed';
   await assert.rejects(db.$transaction(async guarded=>{
    // Fault injection: an extra test-only trigger silently skips UPDATE rows.
    // The real117 row-count guard must reject the whole operation, not certify it.
    await guarded.$executeRawUnsafe(`CREATE FUNCTION public.wp20_upgrade_skip_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`);
    await guarded.$executeRawUnsafe('CREATE TRIGGER wp20_upgrade_skip_probe BEFORE UPDATE ON "PaymentTransaction" FOR EACH ROW EXECUTE FUNCTION public.wp20_upgrade_skip_probe()');
    await guarded.$executeRawUnsafe('SET LOCAL row_security=off');
    await guarded.$executeRawUnsafe(upgradeTouch);
   },{timeout:10000}),error=>error?.meta?.code==='23514'&&String(error?.meta?.message??'').includes('payment upgrade source touch incomplete'));
   assert.deepEqual(await db.paymentTransaction.findUniqueOrThrow({where:{id:payment.id}}),beforeGuard);
   const [probeState]=await db.$queryRawUnsafe(`SELECT
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public."PaymentTransaction"'::regclass AND tgname='wp20_upgrade_skip_probe') AS trigger_exists,
    to_regprocedure('public.wp20_upgrade_skip_probe()') IS NOT NULL AS function_exists`);
   assert.deepEqual(probeState,{trigger_exists:false,function_exists:false});
   receipt.incompleteTouchRejected=true;receipt.incompleteTouchRollback=true;
   receipt.status='PASS';receipt.stage='complete';
  } finally {await db.$disconnect();}
 }});
} catch(error) {receipt.errorCode=/^(?:P[0-9]{4}|[0-9A-Z]{5})$/.test(error?.meta?.code??error?.code??'')?(error.meta?.code??error.code):'ASSERTION_OR_RUNNER_ERROR';}
receipt.cleanup=migration?.cleanup??'UNKNOWN';if(migration?.status!=='PASS')receipt.status='FAIL';
fs.writeFileSync(base+'order-upgrade-snapshot-result.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));process.exitCode=receipt.status==='PASS'?0:1;
