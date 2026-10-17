import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { main } from "./prisma-loopback-disposable-migration-runner.mjs";
const require = createRequire(import.meta.url);
const root = process.cwd();
const output = path.join(root,"docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/payment-callback-recovery-integration.json");
const receipt = { status: "FAIL", stage: "start", networkAttempts: 0, processed: 0, cleanup: null,
  scope: "Actual signed callback handler and retry service, disposable DB and synthetic digital orders; direct Request invocation, no remote provider" };
const injection = "__wp20PaymentCallbackDb";
const originalFetch = globalThis.fetch;
let migration;
try {
  const clientSource = fs.readFileSync(path.join(root,"node_modules/.prisma/client/index.js"),"utf8");
  const envPaths = JSON.parse(clientSource.match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1] ?? "null");
  assert.ok(envPaths && Object.values(envPaths).every(value => value === null));
  const prismaModule = require("@prisma/client");
  const { PrismaClient } = prismaModule;
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
      const bundle = await build({ stdin: { contents: 'export { POST } from "./src/app/api/webhooks/payments/route.ts"; export * from "./src/lib/webhook-retry.ts"; export { PaymentWebhookPayload } from "./src/lib/payment-webhooks.ts"; export { createReservedPaymentTransaction } from "./src/lib/inventory-reservations.ts"; export { createCommerceOrderForCheckout } from "./src/lib/commerce-orders.ts"; export { validateProductDeliveryDraft,protectProductDeliveryConfig } from "./src/lib/product-delivery.ts";', resolveDir: root, loader: "ts" },
        bundle:true,platform:"node",format:"cjs",packages:"external",write:false,logLevel:"silent",
        define:{"process.env.CSRF_SECRET":JSON.stringify("synthetic-wp20-payment-retry-encryption-key-32-bytes"),"process.env.SENTRY_DSN":'""',"process.env.PAYMENT_PROVIDER":'"ecpay-like"',"process.env.ECPAY_WEBHOOK_SECRET":JSON.stringify("synthetic-wp20-hmac-proof"),"process.env.VERCEL_ENV":'"development"',"process.env.NODE_ENV":'"test"' },
        plugins:[{name:"owned-db",setup(b){b.onResolve({filter:/^@\/lib\/db$/},args=>({path:args.path,namespace:"owned"}));
          b.onLoad({filter:/.*/,namespace:"owned"},()=>({contents:`export function getDb(){return globalThis.${injection}}`,loader:"js"}));}}] });
      const compiled={exports:{}};
      // Any relative DB module or direct client constructor in compiled source
      // must still bind to the same verified disposable connection.
      const ownedRequire = name => name === "@prisma/client"
        ? { ...prismaModule, PrismaClient: class { constructor(){ return db; } } }
        : require(name);
      new Function("require","module","exports",bundle.outputFiles[0].text)(ownedRequire,compiled,compiled.exports);
      const service=compiled.exports;
      receipt.stage="fixtures";
      const plan=await db.billingPlan.create({data:{name:"Synthetic retry plan",code:"wp20-retry",monthlyPriceCents:100000,transactionFeeRateBps:100}});
      const vendor=await db.vendor.create({data:{name:"Synthetic retry merchant",slug:"wp20-retry",email:"retry@example.test",passwordHash:"synthetic-unused",
        subscriptions:{create:{planId:plan.id,paymentMode:"platform",status:"active"}}}});
      const video=await db.video.create({data:{vendorId:vendor.id,title:"Synthetic",videoUrl:"https://example.test/video.mp4",durationSec:100}});
      const form=await db.registrationForm.create({data:{vendorId:vendor.id,name:"Synthetic",slug:"wp20-retry",headline:"Synthetic",fields:[]}});
      const live=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,formId:form.id,title:"Synthetic",slug:"wp20-retry",scheduledAt:new Date()}});
      const submission=await db.formSubmission.create({data:{formId:form.id,liveId:live.id,name:"Synthetic",email:"viewer@example.test",verificationStatus:"VERIFIED",verifiedAt:new Date()}});
      const product=await db.product.create({data:{vendorId:vendor.id,name:"Synthetic retry product",slug:"wp20-retry-product",priceCents:100000,inventory:20,fulfillmentType:"digital"}});
      const delivery=service.validateProductDeliveryDraft({fulfillmentType:"digital",isActive:true,title:"Synthetic delivery",destinationUrl:"https://delivery.example.com/synthetic",instructions:"Synthetic",hostConfirmed:true});
      const allowlist=await db.vendorDeliveryUrlAllowlist.create({data:{vendorId:vendor.id,hostname:delivery.destinationHostname,pathPrefix:delivery.destinationPathPrefix}});
      const configId="wp20-retry-delivery";
      await db.productDeliveryConfig.create({data:{id:configId,vendorId:vendor.id,productId:product.id,allowlistId:allowlist.id,status:"active",fulfillmentType:"digital",deliveryKind:delivery.deliveryKind,title:delivery.title,
        ...service.protectProductDeliveryConfig(delivery,{vendorId:vendor.id,productId:product.id,configId,revision:1}),activatedAt:new Date()}});
      const bodies=[];
      const call = (body, valid=true) => service.POST(new Request("http://127.0.0.1/api/webhooks/payments?provider=ecpay-like&source=notify", {
        method:"POST",headers:{"content-type":"application/json","x-ecpay-signature":valid?createHmac("sha256","synthetic-wp20-hmac-proof").update(body).digest("hex"):"invalid"},body,
      }));
      for(let i=0;i<20;i+=1){
        const orderNumber=`WP20-RETRY-${i}`,checkoutIdempotencyKey=`wp20-retry-${i}`;
        await service.createReservedPaymentTransaction({vendorId:vendor.id,productId:product.id,checkoutIdempotencyKey,
          transactionData:{vendorId:vendor.id,providerName:"ecpay-like",orderNumber,paymentMode:"platform",grossAmountCents:100000,netAmountCents:100000,currency:"TWD",status:"pending",checkoutIdempotencyKey,
            metadata:{productId:product.id,billingPurpose:"buyer_order",formSubmissionId:submission.id,sourceLiveId:live.id}},
          createCommerceOrder:(tx,payment)=>service.createCommerceOrderForCheckout(tx,{vendorId:vendor.id,productId:product.id,orderNumber,checkoutIdempotencyKey,paymentTransactionId:payment.id,totalAmountCents:100000,currency:"TWD",buyer:{name:"Synthetic",email:`buyer-${i}@example.test`},shipping:null}).then(()=>undefined)});
        bodies.push(JSON.stringify({EventId:`wp20-callback-event-${i}`,EventType:"paid",VendorSlug:vendor.slug,MerchantTradeNo:orderNumber,TradeAmt:1000,NetAmount:1000,GatewayFee:0,PlatformFee:0}));
      }
      receipt.stage="signature";
      assert.equal((await call(bodies[0],false)).status,401);
      assert.equal(await db.webhookEvent.count(),0);
      receipt.stage="concurrent-callbacks";
      const responses=await Promise.all(bodies.map(body=>call(body)));
      const statusCounts={};for(const response of responses)statusCounts[response.status]=(statusCounts[response.status]??0)+1;
      receipt.callbackStatuses=statusCounts;
      assert.ok(responses.every(response=>[200,500].includes(response.status)));
      const originalEvents=await db.webhookEvent.findMany({where:{provider:"ecpay-like"},select:{id:true,status:true,retryCount:true,maxRetries:true,nextRetryAt:true}});
      assert.equal(originalEvents.length,20);
      const failed=originalEvents.filter(event=>event.status==="failed");
      receipt.persistedFailures=failed.length;
      assert.ok(failed.length>0,"Concurrent failure path was not exercised");
      assert.ok(failed.every(event=>event.retryCount===1&&event.maxRetries===5&&event.nextRetryAt instanceof Date));
      assert.equal(failed.length,statusCounts[500]??0);
      receipt.stage="recover-persisted-failures";
      for(const event of failed){assert.equal((await service.retryWebhookEvent(event.id)).status,"processed");receipt.processed+=1;}
      const events=await db.webhookEvent.findMany({where:{provider:"ecpay-like"},select:{id:true,status:true,retryCount:true,maxRetries:true}});
      assert.equal(events.length,20);assert.ok(events.every(item=>item.status==="processed"&&item.maxRetries===5));
      assert.ok(events.every(item=>item.retryCount===(failed.some(previous=>previous.id===item.id)?2:0)));
      const eventIds=events.map(event=>event.id);
      const counts=async()=>({payments:await db.paymentTransaction.count({where:{vendorId:vendor.id,status:"paid"}}),orders:await db.commerceOrder.count({where:{vendorId:vendor.id,status:"paid"}}),entitlements:await db.commerceEntitlement.count({where:{vendorId:vendor.id}})});
      const before=await counts();assert.deepEqual(before,{payments:20,orders:20,entitlements:20});
      receipt.stage="duplicates";
      assert.deepEqual(await service.processDueWebhookRetries(20),[]);
      for(const id of eventIds) assert.equal((await service.retryWebhookEvent(id)).status,"claimed_elsewhere");
      for(const body of bodies)assert.equal((await call(body)).status,200);
      assert.deepEqual(await counts(),before);assert.equal(receipt.networkAttempts,0);
      receipt.counts=before;receipt.stage="complete";receipt.status="PASS";
    } catch(error){receipt.errorCode=typeof error?.code==="string"&&/^(?:P\d{4}|[0-9A-Z]{5})$/u.test(error.code)?error.code:"ASSERTION_OR_RUNNER_ERROR";throw new Error("wp20-payment-retry-check-failed");}
    finally {delete globalThis[injection];globalThis.fetch=originalFetch;await db.$disconnect();}
  }});
} catch {receipt.status="FAIL";}
finally {delete globalThis[injection];globalThis.fetch=originalFetch;}
receipt.cleanup=migration?.cleanup??"UNKNOWN";
if(migration?.status!=="PASS")receipt.status="FAIL";
fs.writeFileSync(output,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));process.exitCode=receipt.status==="PASS"?0:1;
