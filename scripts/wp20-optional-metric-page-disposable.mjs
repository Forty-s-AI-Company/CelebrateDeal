import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { main } from './prisma-loopback-disposable-migration-runner.mjs';
import { verifyNextMetricRuntime } from './wp20-optional-metric-page-probe.mjs';
const require=createRequire(import.meta.url),base='docs/ai-team/evidence/product-audit-20261011/WP-20/coverage';
const paths=['scripts/wp20-optional-metric-page-probe.mjs','scripts/wp20-optional-metric-page-disposable.mjs','src/lib/live-metric-ingress-gateway.ts','src/lib/live-metric-ingress-proof.ts','src/lib/live-metric-ingress-source.ts','src/components/metric-registration-visit.tsx','src/app/form/[slug]/page.tsx','src/app/(viewer)/live/[slug]/page.tsx','src/app/api/live-metrics/[vendorId]/[liveId]/visits/route.ts','prisma/schema.prisma'];
paths.push('src/lib/optional-metric-page.ts','src/lib/live-metric-ingress-seal.ts','scripts/prisma-loopback-disposable-migration-runner.mjs','prisma/migrations/20261016170000_live_metric_ingress_source_seal/migration.sql');
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const receipt={status:'FAIL',stage:'start',sourceHashes:Object.fromEntries(paths.map(file=>[file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]))};
try{
 const envPaths=JSON.parse(fs.readFileSync('node_modules/.prisma/client/index.js','utf8').match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1]??'null');assert.ok(envPaths&&Object.values(envPaths).every(value=>value===null));
 const {PrismaClient}=require('@prisma/client');
 const bundle=await build({stdin:{contents:'export * from "./src/lib/live-metric-ingress.ts";export * from "./src/lib/live-metric-ingress-seal.ts";export * from "./src/lib/live-metric-ingress-gateway.ts";export * from "./src/lib/live-metric-ingress-proof.ts";export {metricVideoFingerprint} from "./src/lib/live-metric-version.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent',metafile:true});
 for(const file of Object.keys(bundle.metafile.inputs).filter(file=>file!=='<stdin>')){assert.ok(!file.split(/[\\/]/u).some(part=>part.startsWith('.env')));receipt.sourceHashes[file]=digest(file);}
 assert.ok(!Object.keys(bundle.metafile.inputs).includes('src/lib/db.ts'));
 const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(require,mod,mod.exports);const service=mod.exports;
 const migration=await main({afterMigrate:async({databaseUrl,environment,tempRoot})=>{
  const url=new URL(databaseUrl);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/celebratedeal_test');
  const db=new PrismaClient({datasourceUrl:databaseUrl,log:[]});
  try{
   receipt.stage='seed';
   const [marker]=await db.$queryRawUnsafe("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");assert.equal(marker.marker,fs.readFileSync(path.join(tempRoot,'.marker'),'utf8'));
   const vendor=await db.vendor.create({data:{name:'Synthetic runtime',slug:'next-runtime',email:'runtime@example.test',passwordHash:'synthetic-unused'}});
   const video=await db.video.create({data:{vendorId:vendor.id,title:'Synthetic',videoUrl:'https://example.test/synthetic.mp4',durationSec:3600,sourceType:'url',status:'ready'}});
   const form=await db.registrationForm.create({data:{vendorId:vendor.id,name:'Synthetic',slug:'next-runtime',headline:'Synthetic runtime form',fields:[{key:'name',label:'Synthetic name',type:'text',required:true},{key:'email',label:'Synthetic email',type:'email',required:true}]}});
   const template=await db.messageTemplate.create({data:{vendorId:vendor.id,name:'Synthetic',channel:'email',trigger:'registration_confirmed',subject:'Synthetic',body:'Synthetic confirmation',isActive:true}});
   const [clock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now"),expires=new Date(+clock.now+7200000);
   const live=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,formId:form.id,messageTemplateId:template.id,title:'Synthetic runtime live',slug:'next-runtime',status:'live',scheduledAt:new Date(+clock.now-1000),startedAt:new Date(+clock.now-1000),replayEnabled:true,replayAvailableUntil:expires}});
   const scope={vendorId:vendor.id,liveId:live.id,versionId:'next-runtime-version'};
   await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt") VALUES ($1,$2,$3,$4,'live',$5,3600000,false,NULL,$6)`,scope.versionId,vendor.id,live.id,video.id,service.metricVideoFingerprint(video),expires);
   const routes=[{path:'/form/next-runtime',method:'GET',kind:'form'},{path:'/live/next-runtime',method:'GET',kind:'viewer'}];
   receipt.stage='runtime';receipt.runtime=await verifyNextMetricRuntime({db,databaseUrl,environment,tempRoot,service,scope,routes,formSlug:form.slug,liveSlug:live.slug});
   assert.equal(receipt.runtime.status,'PASS');
   receipt.stage='cleanup';
  }catch(error){receipt.innerFailure={name:error?.name??'Error',code:typeof error?.code==='string'?error.code:null};throw error;}finally{await db.$disconnect();}
 }});
 receipt.migrationCount=migration.migrationNames.length;receipt.cleanup=migration.cleanup;assert.equal(migration.status,'PASS');assert.deepEqual(migration.cleanup,{container:'PASS',tempRoot:'PASS'});assert.ok(Object.entries(receipt.sourceHashes).every(([file,hash])=>digest(file)===hash));receipt.postRunHashesMatch=true;receipt.status='PASS';receipt.stage='complete';
}catch(error){receipt.error={name:error?.name??'Error',code:typeof error?.code==='string'?error.code:null};}
fs.writeFileSync(`${base}/optional-metric-page-db.json`,JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({status:receipt.status,stage:receipt.stage,runtime:receipt.runtime,migrationCount:receipt.migrationCount,cleanup:receipt.cleanup,error:receipt.error}));
if(receipt.status!=='PASS')process.exitCode=1;
