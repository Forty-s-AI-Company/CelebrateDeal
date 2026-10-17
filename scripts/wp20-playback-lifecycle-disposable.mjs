import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {main} from './prisma-loopback-disposable-migration-runner.mjs';
const require=createRequire(import.meta.url),output='docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/playback-lifecycle-db.json';
const receipt={status:'FAIL',stage:'start',scope:'Owned loopback synthetic DB and recorded VOD; fixture authorization, not signed Next HTTP',checks:{}};
receipt.sourceHashes=Object.fromEntries(['src/lib/live-metric-playback-controller.ts','src/lib/live-metric-collector.ts','src/lib/live-metric-readiness.ts']
 .map(path=>[path,createHash('sha256').update(fs.readFileSync(path)).digest('hex')]));
let migration;
try{
 const paths=JSON.parse(fs.readFileSync('node_modules/.prisma/client/index.js','utf8').match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1]??'null');
 assert.ok(paths&&Object.values(paths).every(value=>value===null));const {PrismaClient}=require('@prisma/client');
 migration=await main({afterMigrate:async({databaseUrl})=>{
  const url=new URL(databaseUrl);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/celebratedeal_test');
  const db=new PrismaClient({datasourceUrl:databaseUrl});let browser,server;
  try{
   const [marker]=await db.$queryRawUnsafe("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");assert.match(marker.marker,/^prisma-no-dotenv:[a-f0-9]{16}$/u);
   const exports=['resolveTrackedLivePlaybackSource:live-metric-playback-intake','issueMetricSession:live-metric-session','resolveMetricSessionContext:live-metric-version','metricVideoFingerprint:live-metric-version','metricCollectionReady:live-metric-readiness','ingestMetricIntervals:live-metric-ingestion','closeMetricSession:live-metric-close','hashLiveViewerToken:live-quota-admission'];
   const compiled=await build({stdin:{contents:exports.map(value=>{const [name,file]=value.split(':');return `export {${name}} from "./src/lib/${file}.ts";`;}).join(''),resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent'});
   const mod={exports:{}};new Function('require','module','exports',compiled.outputFiles[0].text)(require,mod,mod.exports);const service=mod.exports;
   const client=await build({stdin:{contents:'export {createPlaybackMetricController} from "./src/lib/live-metric-playback-controller.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'browser',format:'iife',globalName:'MetricLifecycle',write:false,logLevel:'silent'});
   receipt.stage='fixtures';
   const vendor=await db.vendor.create({data:{name:'Synthetic lifecycle',slug:'lifecycle',email:'lifecycle@example.test',passwordHash:'synthetic-unused'}});
   const video=await db.video.create({data:{vendorId:vendor.id,title:'Synthetic',videoUrl:'https://example.test/lifecycle.mp4',sourceType:'url',status:'ready',durationSec:4}});
   const form=await db.registrationForm.create({data:{vendorId:vendor.id,name:'Synthetic',slug:'lifecycle',headline:'Synthetic',fields:[]}});
   const [clock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");const expires=new Date(+clock.now+3600000);
   const live=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,formId:form.id,title:'Synthetic',slug:'lifecycle',status:'ended',scheduledAt:new Date(+clock.now-200000),startedAt:new Date(+clock.now-200000),endedAt:new Date(+clock.now-100000),replayEnabled:true,replayAvailableUntil:expires}});
   const submission=await db.formSubmission.create({data:{formId:form.id,liveId:live.id,name:'Synthetic',email:'lifecycle@example.test'}});
   const credential='p'.repeat(43);
   const admission=await db.liveViewerSession.create({data:{vendorId:vendor.id,liveId:live.id,tokenHash:service.hashLiveViewerToken(credential),createdAt:clock.now,lastSeenAt:clock.now,expiresAt:new Date(+clock.now+90000)}});
   await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt") VALUES ('lifecycle-version',$1,$2,$3,'replay',$4,4000,true,$5,$6)`,vendor.id,live.id,video.id,service.metricVideoFingerprint(video),new Date(+clock.now-10000),expires);
   const scope={vendorId:vendor.id,liveId:live.id},identity={...scope,submissionId:submission.id,admissionId:admission.id};
   const authorize=async()=>identity;
   const ready=()=>service.metricCollectionReady(db,authorize,service.resolveMetricSessionContext);
   assert.equal(await ready(),false);
   const [before]=await db.$queryRawUnsafe('SELECT (SELECT count(*) FROM "LiveMetricSession") AS sessions,(SELECT count(*) FROM "LiveMetricRegistration") AS registrations');
   assert.deepEqual(before,{sessions:BigInt(0),registrations:BigInt(0)});receipt.checks.unverifiedReadinessWritesNoMetrics='PASS';
   let origin,unexpected=0,denied=0,sourceRequests=0,sessionRequests=0,readinessRequests=0;const intakes=[];
   const reply=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'private, no-store'});res.end(JSON.stringify(data));};
   server=http.createServer((req,res)=>{void(async()=>{
    try{
     if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><video muted playsinline></video><script src="/bundle.js"></script>');return;}
     if(req.url==='/bundle.js'){res.writeHead(200,{'Content-Type':'application/javascript'});res.end(client.outputFiles[0].text);return;}
     const base=`/api/live-metrics/${vendor.id}/${live.id}/`;
     if(req.url===base+'sessions'&&req.method==='GET'){readinessRequests++;const value=await ready();reply(res,{ready:value},value?200:403);return;}
     if(req.url?.startsWith('/api/live-playback-source?')){sourceRequests++;const value=await service.resolveTrackedLivePlaybackSource(db,{...scope,token:credential});intakes.push(value.metricRequestId);reply(res,value);return;}
     if(req.url==='/synthetic-verify'){
      const [now]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
      await db.formSubmission.update({where:{id:submission.id},data:{verificationStatus:'VERIFIED',verifiedAt:now.now}});
      await db.$executeRawUnsafe(`UPDATE "LiveViewerSession" SET "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '180 seconds' WHERE id=$1`,admission.id);
      reply(res,{ok:true});return;
     }
     if(req.method!=='POST'||req.headers.origin!==origin||req.headers['x-celebratedeal-client']!=='web'){reply(res,{},403);return;}
     const chunks=[];let size=0;for await(const part of req){size+=part.length;if(size>16384)throw new Error('oversize');chunks.push(part);}
     const body=JSON.parse(Buffer.concat(chunks).toString());
     if(req.url===base+'sessions'){
      sessionRequests++;const result=await service.issueMetricSession(db,authorize,service.resolveMetricSessionContext,body,{requirePlaybackIntake:true,renewPlaybackIntake:true});
      const [now]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");reply(res,{ok:true,...result,serverNowAtMs:+now.now});return;
     }
     if(req.url===base+'intervals'){reply(res,{ok:true,...await service.ingestMetricIntervals(db,authorize,body,service.resolveMetricSessionContext)});return;}
     if(req.url===base+'close'){reply(res,{ok:true,...await service.closeMetricSession(db,authorize,body,service.resolveMetricSessionContext)});return;}
     throw new Error('unexpected path');
    }catch(error){if(error?.code==='not_authorized'){denied++;reply(res,{},403);}else{unexpected++;reply(res,{},503);}}
   })();});
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
   receipt.stage='browser-lifecycle';browser=await chromium.launch({headless:true});const context=await browser.newContext();
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());const page=await context.newPage();await page.goto(origin);
   const observed=await page.evaluate(async scope=>{
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
    const paint=canvas.getContext('2d'),stream=canvas.captureStream(30),chunks=[],recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});let frame=0;
    const draw=setInterval(()=>{paint.fillStyle=frame++%2?'#336699':'#669933';paint.fillRect(0,0,160,90);},33);
    recorder.ondataavailable=event=>chunks.push(event.data);const stopped=new Promise(resolve=>{recorder.onstop=resolve;});recorder.start();await wait(4000);recorder.stop();await stopped;
    clearInterval(draw);stream.getTracks().forEach(track=>track.stop());const video=document.querySelector('video'),blobUrl=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));video.src=blobUrl;
    await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('synthetic-vod-failed'));});
    const query=new URLSearchParams(scope),source=await(await fetch('/api/live-playback-source?'+query)).json();
    const controller=MetricLifecycle.createPlaybackMetricController(scope,source,video,()=>performance.now());
    try{
     await controller.tick();if(!controller.state().collector?.disabled)throw new Error('unverified must be disabled');
     await controller.tick();video.loop=true;await video.play();await fetch('/synthetic-verify');
     // Use the real browser clock/cadence. No accelerated media or server time.
     await wait(30100);await controller.tick();if(controller.state().collector?.disabled)throw new Error('verification did not recover');
     video.loop=false;await new Promise(resolve=>video.addEventListener('ended',resolve,{once:true}));
     await controller.tick();video.currentTime=0;await video.play();await controller.tick();await wait(1400);video.pause();await controller.finish();
     return {state:controller.state(),sameSource:video.src===blobUrl};
    }finally{await controller.finish();URL.revokeObjectURL(blobUrl);}
   },scope);
   receipt.stage='assert-lifecycle';
   receipt.browserDiagnostics={unexpected,denied,sourceRequests,sessionRequests,readinessRequests,sameMediaSource:observed.sameSource,
    controller:{stopped:observed.state.stopped,sourceChanged:observed.state.sourceChanged,restart:observed.state.restart,attempts:observed.state.attempts,delivery:observed.state.collector?.delivery}};
   assert.equal(unexpected,0);assert.equal(denied,1);assert.equal(sourceRequests,3);assert.equal(sessionRequests,3);assert.equal(readinessRequests,3);
   assert.equal(new Set(intakes).size,3);assert.equal(observed.sameSource,true);assert.equal(observed.state.collector.delivery.terminal,true);
   const sessions=await db.$queryRawUnsafe('SELECT s."intakeId",s.complete,s."closedAt",count(i.id) AS intervals FROM "LiveMetricSession" s LEFT JOIN "LiveMetricInterval" i ON i."sessionId"=s.id GROUP BY s.id ORDER BY s."anchorAt"');
   receipt.sessionDiagnostics=sessions.map(value=>({complete:value.complete,closed:Boolean(value.closedAt),intervals:Number(value.intervals)}));
   assert.equal(sessions.length,2);for(const session of sessions){assert.ok(session.complete&&session.closedAt);assert.ok(session.intervals>BigInt(0));}
   assert.deepEqual(sessions.map(value=>value.intakeId),intakes.slice(1));
   const [initial]=await db.$queryRawUnsafe('SELECT count(*) AS count FROM "LiveMetricPlaybackIntake" i LEFT JOIN "LiveMetricSession" s ON s."intakeId"=i.id WHERE i.id=$1 AND s.id IS NULL',intakes[0]);assert.equal(initial.count,BigInt(1));
   assert.equal(await ready(),true);receipt.checks.realBrowserVerificationRecoveryAndReplayWithoutReload='PASS';receipt.checks.oldUnmatchedIntakeRetainedAndDistinctNewSessionAnchors='PASS';
   receipt.stage='readiness-non-utc';
   // Metric evidence columns are TIMESTAMPTZ; legacy form/admission columns
   // are timestamp without timezone. Verify the actual deployed SQL types.
   const types=await db.$queryRawUnsafe(`SELECT table_name,column_name,data_type FROM information_schema.columns
    WHERE table_schema='public' AND (table_name='LiveMetricRegistration' AND column_name='verifiedAt'
      OR table_name='LiveMetricSession' AND column_name='expiresAt'
      OR table_name='FormSubmission' AND column_name='verifiedAt') ORDER BY table_name`);
   assert.deepEqual(types.map(row=>[row.table_name,row.data_type]),[
    ['FormSubmission','timestamp without time zone'],['LiveMetricRegistration','timestamp with time zone'],['LiveMetricSession','timestamp with time zone']]);
   const nonUtc={$transaction:(work,options)=>db.$transaction(async tx=>{
    await tx.$queryRawUnsafe("SELECT set_config('TimeZone','America/New_York',true)");return work(tx);
   },options)};
   const readyNonUtc=()=>service.metricCollectionReady(nonUtc,authorize,service.resolveMetricSessionContext);
   assert.equal(await readyNonUtc(),true);
   receipt.checks.actualSqlTypesAndNonUtcMatchingEpoch='PASS';
   receipt.stage='readiness-reverification-epoch';
   const verified=await db.formSubmission.findUnique({where:{id:submission.id},select:{verifiedAt:true}});
   const [newClock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
   await db.formSubmission.update({where:{id:submission.id},data:{verifiedAt:newClock.now}});
   assert.equal(await ready(),false);
   assert.equal(await readyNonUtc(),false);
   await db.formSubmission.update({where:{id:submission.id},data:{verifiedAt:verified.verifiedAt}});
   assert.equal(await ready(),true);receipt.checks.changedVerificationEpochDoesNotAllocateRecovery='PASS';
   receipt.stage='readiness-quota';
   const [registration]=await db.$queryRawUnsafe('SELECT id FROM "LiveMetricRegistration" WHERE "submissionId"=$1',submission.id);
   for(let index=0;index<62;index++){
    receipt.stage='readiness-quota-insert-'+index;
    await db.$executeRawUnsafe(`INSERT INTO "LiveMetricSession" (id,"vendorId","liveId","versionId","registrationId","admissionSessionId","anchorAt","expiresAt")
      VALUES ($1,$2,$3,'lifecycle-version',$4,$5,date_trunc('milliseconds',clock_timestamp()),clock_timestamp()+interval '60 seconds')`, 'synthetic-quota-'+index,vendor.id,live.id,registration.id,admission.id);
    receipt.stage='readiness-quota-close-'+index;
    await db.$executeRawUnsafe(`UPDATE "LiveMetricSession" SET "closedAt"=date_trunc('milliseconds',clock_timestamp()),"finalSequence"=-1,complete=true WHERE id=$1`,'synthetic-quota-'+index);
   }
   const [beforeReady]=await db.$queryRawUnsafe('SELECT count(*) AS count FROM "LiveMetricPlaybackIntake"');
   assert.equal(await ready(),false);const [afterReady]=await db.$queryRawUnsafe('SELECT count(*) AS count FROM "LiveMetricPlaybackIntake"');
   assert.equal(beforeReady.count,afterReady.count);receipt.checks.exhaustedAdmissionQuotaReturnsFalseWithoutNewIntake='PASS';
   assert.equal(await readyNonUtc(),false);receipt.checks.nonUtcQuotaParity='PASS';
   receipt.browser={sourceRequests,sessionRequests,readinessRequests,expectedAuthorizationRefusals:denied,intervals:sessions.map(value=>Number(value.intervals)),sameMediaSource:true,cadenceWaitMs:30100};
   receipt.status='PASS';receipt.stage='complete';
  }catch(error){receipt.errorType=error?.name;receipt.errorCode=/^(?:P[0-9]{4}|[0-9A-Z]{5})$/.test(error?.meta?.code??error?.code??'')?(error.meta?.code??error.code):'ASSERTION_OR_SERVICE_ERROR';
   if(['number','boolean'].includes(typeof error?.actual)&&['number','boolean'].includes(typeof error?.expected))receipt.assertion={actual:error.actual,expected:error.expected};
   throw new Error('lifecycle-check-failed');}
  finally{if(browser)await browser.close();if(server?.listening)await new Promise(resolve=>server.close(resolve));await db.$disconnect();}
 }});
}catch{receipt.errorCode??='RUNNER_ERROR';}
receipt.cleanup=migration?.cleanup??'UNKNOWN';if(migration?.status!=='PASS')receipt.status='FAIL';
fs.writeFileSync(output,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));process.exitCode=receipt.status==='PASS'?0:1;
