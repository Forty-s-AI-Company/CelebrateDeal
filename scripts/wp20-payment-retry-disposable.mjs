import { verifyOrderSourceAudit } from "./wp20-order-source-audit-probe.mjs";
import { verifyRegistrationVendorCascade } from "./wp20-registration-vendor-cascade.mjs";
import { verifyRegistrationTruncateProtection } from "./wp20-registration-truncate-probe.mjs";
import { verifyMatchedRegistrationAudit } from "./wp20-registration-matched-audit.mjs";
import { verifyRegistrationSourceConcurrency } from "./wp20-registration-source-concurrency.mjs";
import { verifyMetricSourceInvalidation } from "./wp20-metric-source-invalidation.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { main } from "./prisma-loopback-disposable-migration-runner.mjs";
const require = createRequire(import.meta.url);
const root = process.cwd();
const output = path.join(root,"docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/payment-retry-integration.json");
const receipt = { status: "FAIL", stage: "start", networkAttempts: 0, processed: 0, cleanup: null,
  scope: "Actual retry scheduler/payment/inventory/order services, disposable DB and synthetic digital orders; no external delivery or payment provider" };
const injection = "__wp20PaymentRetryDb";
const originalFetch = globalThis.fetch;
let migration;
try {
  const clientSource = fs.readFileSync(path.join(root,"node_modules/.prisma/client/index.js"),"utf8");
  const envPaths = JSON.parse(clientSource.match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1] ?? "null");
  assert.ok(envPaths && Object.values(envPaths).every(value => value === null));
  const { PrismaClient } = require("@prisma/client");
  migration = await main({ afterMigrate: async ({ databaseUrl }) => {
    const target = new URL(databaseUrl);
    assert.equal(target.hostname,"127.0.0.1"); assert.equal(target.pathname,"/celebratedeal_test");
    target.searchParams.set("connection_limit","24");
    const db = new PrismaClient({ datasourceUrl: target.toString() });
    try {
      const [marker] = await db.$queryRawUnsafe("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
      assert.match(marker.marker,/^prisma-no-dotenv:[a-f0-9]{16}$/u);
      assert.equal(globalThis[injection],undefined); globalThis[injection]=db;
      globalThis.fetch = async () => { receipt.networkAttempts += 1; throw new Error("synthetic-network-blocked"); };
      receipt.stage="compile";
      const bundle = await build({ stdin: { contents: 'export { isDatabaseWriteConflict } from "./src/lib/database-write-conflict.ts"; export { publishOrderCoverage } from "./src/lib/live-metric-order-coverage.ts"; export { auditMetricOrderSources } from "./src/lib/live-metric-order-source-audit.ts"; export { readMetricOrderAuditPage, withMetricOrderAuditContext } from "./src/lib/live-metric-order-audit.ts"; export { publishRegistrationCoverage } from "./src/lib/live-metric-registration-coverage.ts"; export { readMetricCoverage } from "./src/lib/live-metric-coverage-reader.ts"; export { auditMetricRegistrationSources } from "./src/lib/live-metric-registration-source-audit.ts"; export { readRegistrationAuditPage, readRegistrationProjectionAuditPage } from "./src/lib/live-metric-registration-audit.ts"; export { claimMetricReport, finishMetricReport } from "./src/lib/live-metric-report-lease.ts"; export { withMetricOrderRevision, readMetricReportContext, readMetricReadyReport } from "./src/lib/live-metric-report-reader.ts"; export * from "./src/lib/webhook-retry.ts"; export { PaymentWebhookPayload } from "./src/lib/payment-webhooks.ts"; export { createReservedPaymentTransaction } from "./src/lib/inventory-reservations.ts"; export { createCommerceOrderForCheckout } from "./src/lib/commerce-orders.ts"; export { validateProductDeliveryDraft,protectProductDeliveryConfig } from "./src/lib/product-delivery.ts";', resolveDir: root, loader: "ts" },
        bundle:true,platform:"node",format:"cjs",packages:"external",write:false,logLevel:"silent",
        define:{"process.env.CSRF_SECRET":JSON.stringify("synthetic-wp20-payment-retry-encryption-key-32-bytes"),"process.env.SENTRY_DSN":'""'},
        plugins:[{name:"owned-db",setup(b){b.onResolve({filter:/^@\/lib\/db$/},args=>({path:args.path,namespace:"owned"}));
          b.onLoad({filter:/.*/,namespace:"owned"},()=>({contents:`export function getDb(){return globalThis.${injection}}`,loader:"js"}));}}] });
      const compiled={exports:{}};new Function("require","module","exports",bundle.outputFiles[0].text)(require,compiled,compiled.exports);
      const service=compiled.exports;
      receipt.stage="source-sequence-privileges";
      const sourceMigration=fs.readFileSync(path.join(root,"prisma/migrations/20261015140000_live_metric_order_source/migration.sql"),"utf8");
      const revokeBlock=sourceMigration.slice(sourceMigration.lastIndexOf("DO $$ DECLARE api_role TEXT; BEGIN"));
      assert.ok(revokeBlock.trim().endsWith("END $$;"));
      assert.equal((revokeBlock.match(/DO \$\$/gu)??[]).length,1);
      for(const role of ["anon","authenticated","service_role"]){
        await db.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
        await db.$executeRawUnsafe(`GRANT ALL ON SEQUENCE public."LiveMetricOrderSource_id_seq" TO ${role}`);
        await db.$executeRawUnsafe(`GRANT ALL ON FUNCTION public.wp20_metric_order_source_immutable() TO ${role}`);
      }
      await db.$executeRawUnsafe(revokeBlock);
      for(const role of ["anon","authenticated","service_role"]){
        const [rights]=await db.$queryRawUnsafe(`SELECT has_sequence_privilege($1,'public."LiveMetricOrderSource_id_seq"','USAGE,SELECT,UPDATE') AS sequence_access,
          has_function_privilege($1,'public.wp20_metric_order_source_immutable()','EXECUTE') AS function_access`,role);
        assert.deepEqual(rights,{sequence_access:false,function_access:false});
      }
      receipt.sourceApiPrivileges="PASS";
      receipt.stage="registration-vendor-cascade";
      receipt.registrationVendorCascade=await verifyRegistrationVendorCascade(db);
      receipt.stage="fixtures";
      const plan=await db.billingPlan.create({data:{name:"Synthetic retry plan",code:"wp20-retry",monthlyPriceCents:100000,transactionFeeRateBps:100}});
      const vendor=await db.vendor.create({data:{name:"Synthetic retry merchant",slug:"wp20-retry",email:"retry@example.test",passwordHash:"synthetic-unused",
        subscriptions:{create:{planId:plan.id,paymentMode:"platform",status:"active"}}}});
      const video=await db.video.create({data:{vendorId:vendor.id,title:"Synthetic",videoUrl:"https://example.test/video.mp4",durationSec:100}});
      const form=await db.registrationForm.create({data:{vendorId:vendor.id,name:"Synthetic",slug:"wp20-retry",headline:"Synthetic",fields:[]}});
      const live=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,formId:form.id,title:"Synthetic",slug:"wp20-retry",scheduledAt:new Date()}});
      const submission=await db.formSubmission.create({data:{formId:form.id,liveId:live.id,name:"Synthetic",email:"viewer@example.test",verificationStatus:"VERIFIED",verifiedAt:new Date()}});
      receipt.stage="registration-truncate-protection";
      receipt.registrationTruncateProtection=await verifyRegistrationTruncateProtection(db);
      receipt.stage="matched-registration-audit";
      receipt.matchedRegistrationAudit=await verifyMatchedRegistrationAudit(db,service,vendor);
      receipt.stage="registration-source-concurrency";
      receipt.registrationSourceConcurrency=await verifyRegistrationSourceConcurrency(db,service,{vendor,live,video,form});
      receipt.stage="source-invalidation-matrix";
      receipt.sourceInvalidation=await verifyMetricSourceInvalidation(db,service,{vendor,live,video,submission});
      receipt.stage="form-ownership-constraint";
      // Changing a linked form owner cascades through Live's composite FK;
      // the existing video/live tenant binding must reject a cross-tenant move.
      let ownershipCode=null;
      try {
        await db.$transaction(async tx=>{
          const other=await tx.vendor.create({data:{name:"Synthetic other",slug:"wp20-other-owner",email:"other-owner@example.test",passwordHash:"synthetic-unused"}});
          await tx.registrationForm.update({where:{id:form.id},data:{vendorId:other.id}});
          throw new Error("ownership-update-unexpectedly-accepted");
        });
      }catch(error){ownershipCode=error?.code??null;}
      assert.equal(ownershipCode,"P2003");
      assert.equal((await db.registrationForm.findUniqueOrThrow({where:{id:form.id},select:{vendorId:true}})).vendorId,vendor.id);
      assert.equal((await db.live.findUniqueOrThrow({where:{id:live.id},select:{vendorId:true}})).vendorId,vendor.id);
      receipt.linkedFormOwnership="REJECTED_BY_FOREIGN_KEY";
      receipt.stage="no-video-metric-ownership";
      let metricOwnershipCode=null;
      let metricOwnershipGuard=false;
      try {
        await db.$transaction(async tx=>{
          const other=await tx.vendor.create({data:{name:"Synthetic other",slug:"wp20-metric-other",email:"metric-other@example.test",passwordHash:"synthetic-unused"}});
          await tx.live.update({where:{id:live.id},data:{videoId:null}});
          await tx.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId",mode,fingerprint,"expiresAt") VALUES ('wp20-owner-version',$1,$2,'live',$3,clock_timestamp()+interval '1 hour')`,vendor.id,live.id,"a".repeat(64));
          // This exact statement must fail in the existing immutable metric scope guard.
          try {
            await tx.$executeRawUnsafe('UPDATE "RegistrationForm" SET "vendorId"=$1 WHERE id=$2',other.id,form.id);
          }catch(error){
            metricOwnershipCode=error?.meta?.code??null;
            metricOwnershipGuard=String(error?.meta?.message??"").includes("metric version identity is immutable");
            throw error;
          }
          throw new Error("metric-owner-update-unexpectedly-accepted");
        });
      }catch{ /* Assertions below require the specific DB rejection, not arbitrary failure. */ }
      assert.equal(metricOwnershipCode,"23514");
      assert.equal(metricOwnershipGuard,true);
      assert.equal((await db.live.findUniqueOrThrow({where:{id:live.id},select:{vendorId:true,videoId:true}})).vendorId,vendor.id);
      assert.equal((await db.live.findUniqueOrThrow({where:{id:live.id},select:{videoId:true}})).videoId,video.id);
      receipt.noVideoMetricOwnership="REJECTED_BY_IMMUTABLE_VERSION";

      receipt.stage="registration-vendor-cascade";
      receipt.registrationVendorCascade=await verifyRegistrationVendorCascade(db);
      receipt.stage="fixtures";
      const product=await db.product.create({data:{vendorId:vendor.id,name:"Synthetic retry product",slug:"wp20-retry-product",priceCents:100000,inventory:20,fulfillmentType:"digital"}});
      const delivery=service.validateProductDeliveryDraft({fulfillmentType:"digital",isActive:true,title:"Synthetic delivery",destinationUrl:"https://delivery.example.com/synthetic",instructions:"Synthetic",hostConfirmed:true});
      const allowlist=await db.vendorDeliveryUrlAllowlist.create({data:{vendorId:vendor.id,hostname:delivery.destinationHostname,pathPrefix:delivery.destinationPathPrefix}});
      const configId="wp20-retry-delivery";
      await db.productDeliveryConfig.create({data:{id:configId,vendorId:vendor.id,productId:product.id,allowlistId:allowlist.id,status:"active",fulfillmentType:"digital",deliveryKind:delivery.deliveryKind,title:delivery.title,
        ...service.protectProductDeliveryConfig(delivery,{vendorId:vendor.id,productId:product.id,configId,revision:1}),activatedAt:new Date()}});
      const eventIds=[];
      for(let i=0;i<20;i+=1){
        const orderNumber=`WP20-RETRY-${i}`,checkoutIdempotencyKey=`wp20-retry-${i}`;
        await service.createReservedPaymentTransaction({vendorId:vendor.id,productId:product.id,checkoutIdempotencyKey,
          transactionData:{vendorId:vendor.id,providerName:"demo",orderNumber,paymentMode:"platform",grossAmountCents:100000,netAmountCents:100000,currency:"TWD",status:"pending",checkoutIdempotencyKey,
            metadata:{productId:product.id,billingPurpose:"buyer_order",formSubmissionId:submission.id,sourceLiveId:live.id}},
          createCommerceOrder:(tx,payment)=>service.createCommerceOrderForCheckout(tx,{vendorId:vendor.id,productId:product.id,orderNumber,checkoutIdempotencyKey,paymentTransactionId:payment.id,totalAmountCents:100000,currency:"TWD",buyer:{name:"Synthetic",email:`buyer-${i}@example.test`},shipping:null}).then(()=>undefined)});
        const payload=service.PaymentWebhookPayload.parse({provider:"demo",eventId:`wp20-retry-event-${i}`,eventType:"paid",vendorId:vendor.id,orderNumber,grossAmountCents:100000});
        const event=await db.webhookEvent.create({data:{vendorId:vendor.id,provider:"demo",eventId:payload.eventId,eventType:"paid",status:"failed",retryCount:1,maxRetries:3,nextRetryAt:new Date(Date.now()-1000),payload:{normalized:payload}}});
        eventIds.push(event.id);
      }
      receipt.stage="role-safe-revision";
      const [ownerRevision]=await db.$queryRawUnsafe('SELECT count(*) AS revision FROM "LiveMetricOrderSource" WHERE "vendorId"=$1 AND "liveId"=$2',vendor.id,live.id);
      assert.ok(ownerRevision.revision>0n);
      const roleRollback=new Error("expected-revision-role-rollback");
      try{
        await db.$transaction(async tx=>{
          await tx.$executeRawUnsafe('CREATE ROLE wp20_revision_worker_probe NOLOGIN');
          await tx.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO wp20_revision_worker_probe');
          await tx.$executeRawUnsafe('GRANT EXECUTE ON FUNCTION public.wp20_metric_order_revision(text,text) TO wp20_revision_worker_probe');
          await tx.$executeRawUnsafe('SET LOCAL ROLE wp20_revision_worker_probe');
          const [rights]=await tx.$queryRawUnsafe(`SELECT has_table_privilege(current_user,'public."LiveMetricOrderSource"','SELECT') AS direct_access`);
          assert.equal(rights.direct_access,false);
          const [safe]=await tx.$queryRawUnsafe('SELECT public.wp20_metric_order_revision($1,$2) AS revision',vendor.id,live.id);
          assert.equal(safe.revision,ownerRevision.revision);
          const [foreign]=await tx.$queryRawUnsafe('SELECT public.wp20_metric_order_revision($1,$2) AS revision',"synthetic-foreign-vendor",live.id);
          assert.equal(foreign.revision,0n);
          await tx.$executeRawUnsafe('RESET ROLE');
          // Demonstrate the exact RLS failure mode without weakening the helper.
          await tx.$executeRawUnsafe('GRANT SELECT ON "LiveMetricOrderSource" TO wp20_revision_worker_probe');
          await tx.$executeRawUnsafe('SET LOCAL ROLE wp20_revision_worker_probe');
          const [hidden]=await tx.$queryRawUnsafe('SELECT count(*) AS revision FROM "LiveMetricOrderSource" WHERE "vendorId"=$1 AND "liveId"=$2',vendor.id,live.id);
          assert.equal(hidden.revision,0n);
          const [stillSafe]=await tx.$queryRawUnsafe('SELECT public.wp20_metric_order_revision($1,$2) AS revision',vendor.id,live.id);
          assert.equal(stillSafe.revision,ownerRevision.revision);
          throw roleRollback;
        });
      }catch(error){if(error!==roleRollback)throw error;}
      for(const role of ["anon","authenticated","service_role"]){
        const [rights]=await db.$queryRawUnsafe(`SELECT has_function_privilege($1,'public.wp20_metric_order_revision(text,text)','EXECUTE') AS allowed`,role);
        assert.equal(rights.allowed,false);
      }
      receipt.roleSafeRevision="PASS";
      receipt.stage="revision-snapshot-concurrency";
      const lease={vendorId:vendor.id,liveId:live.id,versionId:"synthetic-version",reportId:"synthetic-report",workerId:"synthetic-worker"};
      // Window caching now requires a real immutable report window. Keep the
      // report queued so the existing unavailable-lease assertion remains valid.
      const [snapshotClock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
      const snapshotStart=new Date(+snapshotClock.now-3600000),snapshotEnd=snapshotClock.now,snapshotExpiry=new Date(+snapshotClock.now+3600000);
      // Make the tested synthetic order explicitly inside this half-open window;
      // application-generated timestamps can otherwise be ahead of the DB clock.
      await db.commerceOrder.update({where:{vendorId_orderNumber:{vendorId:vendor.id,orderNumber:"WP20-RETRY-0"}},data:{createdAt:new Date(+snapshotEnd-60000)}});
      await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"collectionEnabled","collectionStartedAt","expiresAt") VALUES ($1,$2,$3,$4,'live',$5,true,$6,$7)`,lease.versionId,vendor.id,live.id,video.id,'e'.repeat(64),snapshotStart,snapshotExpiry);
      await db.$queryRawUnsafe('SELECT public.wp20_metric_report_create($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7::bigint,$8::timestamptz)',vendor.id,live.id,lease.versionId,lease.reportId,snapshotStart,snapshotEnd,BigInt(0),snapshotExpiry);
      const [snapshotRevision]=await db.$queryRawUnsafe('SELECT public.wp20_metric_order_window_revision($1,$2::timestamptz,$3::timestamptz) AS revision',vendor.id,snapshotStart,snapshotEnd);
      const beforeRevision=snapshotRevision.revision;
      let nextRevision;
      // Use the real helper and real PostgreSQL transaction; record only SQL parameters
      // for synthetic revision assertions, never print query data or connection strings.
      const observe=async (expected, during)=>db.$transaction(async tx=>{
        const calls=[];
        const reader={$queryRaw:async (...args)=>{calls.push(args[0]);return tx.$queryRaw(...args);}};
        await service.withMetricOrderRevision(reader,lease,async snapshot=>{
          const [state]=await snapshot.$queryRaw`SELECT current_setting('transaction_read_only') AS mode`;
          assert.equal(state.mode,"on");
          if(during)await during();
          assert.deepEqual(await service.readMetricReportContext(snapshot,lease),{status:"unavailable",reason:"lease_or_scope_unavailable"});
          const pageQuery=calls.at(-1);
          assert.ok(pageQuery.values.includes(expected));
          assert.equal(pageQuery.strings.join("").includes("wp20_metric_order_window_revision"),false);
          const [visible]=await snapshot.$queryRaw`SELECT public.wp20_metric_order_window_revision(${vendor.id},${snapshotStart},${snapshotEnd}) AS revision`;
          assert.equal(visible.revision,expected);
        });
      },{isolationLevel:"RepeatableRead",timeout:15000});
      await observe(beforeRevision,async()=>{
        // A separate committed connection appends an event while the read snapshot stays open.
        await db.commerceOrder.update({where:{vendorId_orderNumber:{vendorId:vendor.id,orderNumber:"WP20-RETRY-0"}},data:{status:"cancelled"}});
        const [fresh]=await db.$queryRawUnsafe('SELECT public.wp20_metric_order_window_revision($1,$2::timestamptz,$3::timestamptz) AS revision',vendor.id,snapshotStart,snapshotEnd);
        nextRevision=fresh.revision;
        assert.ok(nextRevision>beforeRevision);
      });
      await observe(nextRevision);
      // Restore this synthetic pending order so the existing recovery assertions remain unchanged.
      await db.commerceOrder.update({where:{vendorId_orderNumber:{vendorId:vendor.id,orderNumber:"WP20-RETRY-0"}},data:{status:"pending_payment"}});
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricVersion" WHERE id=$1',lease.versionId);
      receipt.revisionSnapshotConcurrency="PASS";
      receipt.stage="drain";
      const results=await service.processDueWebhookRetries(20);
      receipt.processed=results.filter(item=>item.status==="processed").length;
      assert.equal(receipt.processed,20);
      const events=await db.webhookEvent.findMany({where:{id:{in:eventIds}},select:{status:true,retryCount:true,maxRetries:true}});
      assert.equal(events.length,20);assert.ok(events.every(item=>item.status==="processed"&&item.retryCount===2&&item.maxRetries===3));
      const counts=async()=>({payments:await db.paymentTransaction.count({where:{vendorId:vendor.id,status:"paid"}}),orders:await db.commerceOrder.count({where:{vendorId:vendor.id,status:"paid"}}),entitlements:await db.commerceEntitlement.count({where:{vendorId:vendor.id}})});
      const before=await counts();assert.deepEqual(before,{payments:20,orders:20,entitlements:20});
      receipt.stage="order-source-audit";
      receipt.orderSourceAudit=await verifyOrderSourceAudit(db,service,{vendor,live,video});
      receipt.stage="duplicates";
      assert.deepEqual(await service.processDueWebhookRetries(20),[]);
      for(const id of eventIds) assert.equal((await service.retryWebhookEvent(id)).status,"claimed_elsewhere");
      assert.deepEqual(await counts(),before);assert.equal(receipt.networkAttempts,0);
      receipt.counts=before;receipt.stage="complete";receipt.status="PASS";
    } catch(error){receipt.auditReason=["scope_or_window_unavailable","limit_exceeded"].includes(error?.auditReason)?error.auditReason:null;receipt.concurrentCodes=Array.isArray(error?.concurrentCodes)?error.concurrentCodes.filter(x=>/^(?:P\d{4}|[0-9A-Z]{5}|UNKNOWN)$/.test(x)).slice(0,20):null;receipt.actualStatus=["recorded","source_changed","incomplete","unavailable","enumerated"].includes(error?.actual?.status)?error.actual.status:null;receipt.expectedStatus=["recorded","source_changed","incomplete","unavailable","enumerated"].includes(error?.expected?.status)?error.expected.status:null;receipt.failureFrames=[...String(error?.stack??" ").matchAll(/(?:wp20-[A-Za-z0-9-]+\.mjs):\d+:\d+/g)].map(match=>match[0]).slice(0,5);receipt.auditPhase=["setup","empty-proof","matched-source","race-count","race-publish","post-race-publish","coverage-read"].includes(error?.auditPhase)?error.auditPhase:null;receipt.assertion=typeof error?.actual==="number"&&typeof error?.expected==="number"?{actual:error.actual,expected:error.expected}:null;receipt.sqlState=/^[0-9A-Z]{5}$/.test(error?.meta?.code??"")?error.meta.code:null;receipt.guard=["registration coverage source mismatch","metric registration source events are immutable","metric coverage revision or range unavailable","metric coverage audit requires parent deletion","metric coverage audit is immutable","metric report input is stale","metric report window must have ended","metric report requires worker function","metric registration input is stale","metric order input is stale","metric report input is immutable","verified metric registration required","metric report","metric source must belong","function public.wp20_metric_report_create","metric writes require"].find(x=>String(error?.meta?.message??"").includes(x))??null;receipt.errorCode=typeof error?.code==="string"&&/^(?:P\d{4}|[0-9A-Z]{5})$/u.test(error.code)?error.code:"ASSERTION_OR_RUNNER_ERROR";throw new Error("wp20-payment-retry-check-failed");}
    finally {delete globalThis[injection];globalThis.fetch=originalFetch;await db.$disconnect();}
  }});
} catch {receipt.status="FAIL";}
finally {delete globalThis[injection];globalThis.fetch=originalFetch;}
receipt.cleanup=migration?.cleanup??"UNKNOWN";
if(migration?.status!=="PASS")receipt.status="FAIL";
fs.writeFileSync(output,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));process.exitCode=receipt.status==="PASS"?0:1;
