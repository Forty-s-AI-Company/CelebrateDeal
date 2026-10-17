import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { main } from './prisma-loopback-disposable-migration-runner.mjs';
const root=process.cwd(), require=createRequire(import.meta.url);
const receipt={status:'FAIL',stage:'start',orders:100000,ledgerEvents:1000000,constraintsAndTriggersEnabled:true};
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
   const bundle=await build({stdin:{contents:'export * from "./src/lib/live-metric-order-source-audit.ts";',resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent'});
   const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(require,compiled,compiled.exports);const service=compiled.exports;
   receipt.stage='fixture';
   const vendor=await db.vendor.create({data:{name:'Synthetic order load',slug:'order-load',email:'order-load@example.test',passwordHash:'synthetic-unused'}});
   const video=await db.video.create({data:{vendorId:vendor.id,title:'Synthetic',videoUrl:'https://example.test/synthetic.mp4',durationSec:100}});
   const [clock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
   const start=new Date(+clock.now-3600000),end=new Date(+clock.now-1000),created=new Date(+clock.now-60000);
   const live=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,title:'Synthetic',slug:'order-load',scheduledAt:start}});
   const versionId='order-load-version';
   await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"collectionEnabled","collectionStartedAt","expiresAt") VALUES ($1,$2,$3,$4,'live',$5,true,$6,$7)`,versionId,vendor.id,live.id,video.id,'b'.repeat(64),start,new Date(+clock.now+3600000));
   const setup=performance.now();
   // Deliberately unattributed synthetic orders stress inventory enumeration;
   // these are not valid paid-checkout or coverage-completeness fixtures.
   await db.$executeRawUnsafe(`INSERT INTO "CommerceOrder" (id,"vendorId","orderNumber","checkoutIdempotencyKey","checkoutIdentityHash",status,currency,"subtotalAmountCents","totalAmountCents","buyerEncryptedEnvelope","buyerMaskedName","buyerMaskedEmail","createdAt","updatedAt")
    SELECT 'order-load-'||lpad(i::text,8,'0'),$1,'LOAD-'||i::text,'load-key-'||i::text,repeat('a',43),'pending_payment','TWD',100,100,'synthetic-unused','Synthetic','synthetic@example.test',$2,$2 FROM generate_series(1,100000) i`,vendor.id,created);
   // Inflate only derived ledger rows, with FK/immutable/no-truncate guards on.
   await db.$executeRawUnsafe(`INSERT INTO "LiveMetricOrderTenantSource" ("vendorId") SELECT $1 FROM generate_series(1,900000)`,vendor.id);
   await db.$executeRawUnsafe('ANALYZE "CommerceOrder"');
   await db.$executeRawUnsafe('ANALYZE "LiveMetricOrderTenantSource"');
   const [events]=await db.$queryRawUnsafe('SELECT public.wp20_metric_order_tenant_revision($1) AS count',vendor.id);
   assert.equal(events.count,BigInt(receipt.ledgerEvents));
   receipt.setupMs=Math.round(performance.now()-setup);
   let contextReads=0,pages=0,firstQuery,lastQuery;
   const instrumented={$transaction:(callback,options)=>db.$transaction(tx=>callback({
    $executeRaw:tx.$executeRaw.bind(tx),
    $queryRaw:async query=>{
     const text=query.strings.join('');
     if(text.includes('wp20_metric_order_tenant_revision'))contextReads++;
     if(text.includes('FROM "CommerceOrder" o')){pages++;firstQuery??=query;lastQuery=query;}
     return tx.$queryRaw(query);
    },
   }),options)};
   receipt.stage='audit';const started=performance.now();
   const result=await service.auditMetricOrderSources(instrumented,{vendorId:vendor.id,liveId:live.id,versionId,startAt:start,endAt:end});
   receipt.auditMs=Math.round(performance.now()-started);receipt.auditStatus=result.status;receipt.contextReads=contextReads;receipt.pages=pages;
   assert.equal(result.status,'enumerated');assert.equal(result.count,receipt.orders);
   assert.equal(result.outcomes.missing_payment,receipt.orders);assert.equal(result.coverage,'unknown');
   assert.equal(contextReads,1);assert.equal(pages,200);
   receipt.stage='explain';
   const summarize=node=>({node:node['Node Type'],index:node['Index Name'],rows:node['Actual Rows'],loops:node['Actual Loops'],totalMs:node['Actual Total Time'],sharedHits:node['Shared Hit Blocks'],children:(node.Plans??[]).map(summarize)});
   receipt.plans=[];
   for(const query of [firstQuery,lastQuery]){
    const [row]=await db.$queryRawUnsafe('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query.text,...query.values);
    const plan=row['QUERY PLAN'][0];receipt.plans.push({planningMs:plan['Planning Time'],executionMs:plan['Execution Time'],plan:summarize(plan.Plan)});
   }
   receipt.stage='complete';receipt.status='PASS';
  }catch(error){receipt.errorCode=/^(?:P\d{4}|[0-9A-Z]{5})$/.test(error?.meta?.code??error?.code??'')?(error?.meta?.code??error.code):'ASSERTION_OR_RUNNER_ERROR';throw new Error('order-load-failed');}
  finally{await db.$disconnect();}
 }});
}catch{receipt.status='FAIL';}
receipt.cleanup=migration?.cleanup??'UNKNOWN';if(migration?.status!=='PASS')receipt.status='FAIL';
fs.writeFileSync('docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/order-source-load.json',JSON.stringify(receipt,null,2));
const {plans,...summary}=receipt;console.log(JSON.stringify({...summary,explainPlans:plans?.length??0}));process.exitCode=receipt.status==='PASS'?0:1;
