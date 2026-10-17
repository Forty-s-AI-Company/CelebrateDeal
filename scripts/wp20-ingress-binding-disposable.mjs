import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer, request as httpRequest } from 'node:http';
import { build } from 'esbuild';
import { main } from './prisma-loopback-disposable-migration-runner.mjs';
const require = createRequire(import.meta.url), base = 'docs/ai-team/evidence/product-audit-20261011/WP-20/coverage';
const files = ['prisma/schema.prisma','prisma/migrations/20261016160000_live_metric_ingress_source_binding/migration.sql',
  'src/lib/live-metric-ingress-proof.ts','src/lib/live-metric-ingress-gateway.ts','src/lib/live-metric-visit-page.ts',
  'src/lib/live-metric-registration-page.ts','src/lib/live-metric-playback-intake.ts','scripts/wp20-ingress-binding-disposable.mjs'];
files.push('src/lib/live-metric-ingress-source.ts');
const receipt = { status: 'FAIL', stage: 'start', checks: {}, sourceHashes: Object.fromEntries(files.map(file => [file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')])) };
const safeError = error => ({ name: error?.name ?? 'Error', code: typeof error?.code === 'string' ? error.code : null, sqlState: typeof error?.meta?.code === 'string' ? error.meta.code : null,
  assertionLine: Number(String(error?.stack ?? '').match(/wp20-ingress-binding-disposable\.mjs:(\d+):/u)?.[1] ?? 0) });
try {
  const paths = JSON.parse(fs.readFileSync('node_modules/.prisma/client/index.js','utf8').match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1] ?? 'null');
  assert.ok(paths && Object.values(paths).every(value => value === null));
  const { PrismaClient } = require('@prisma/client');
  const bundle = await build({ stdin: { contents: 'export * from "./src/lib/live-metric-ingress.ts";export * from "./src/lib/live-metric-ingress-gateway.ts";export * from "./src/lib/live-metric-ingress-proof.ts";export {issueMetricVisitPage} from "./src/lib/live-metric-visit-page.ts";export {issueMetricRegistrationPage} from "./src/lib/live-metric-registration-page.ts";export {resolveTrackedLivePlaybackSource} from "./src/lib/live-metric-playback-intake.ts";export {metricVideoFingerprint} from "./src/lib/live-metric-version.ts";export {hashLiveViewerToken} from "./src/lib/live-quota-admission.ts";export {requireSameOriginRequest} from "./src/lib/api-security.ts";', resolveDir: process.cwd(), loader: 'ts' },bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent' });
  const compiled = { exports:{} }; new Function('require','module','exports',bundle.outputFiles[0].text)(require,compiled,compiled.exports); const service=compiled.exports;
  const migration = await main({ afterMigrate:async({databaseUrl})=>{
    const url=new URL(databaseUrl);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/celebratedeal_test');
    const db=new PrismaClient({datasourceUrl:databaseUrl,log:[]});
    try {
      const [marker]=await db.$queryRawUnsafe("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");assert.match(marker.marker,/^prisma-no-dotenv:[a-f0-9]{16}$/u);
      receipt.stage='seed';
      const vendor=await db.vendor.create({data:{name:'Synthetic binding',slug:'binding',email:'binding@example.test',passwordHash:'synthetic-unused'}});
      const video=await db.video.create({data:{vendorId:vendor.id,title:'Synthetic',videoUrl:'https://example.test/synthetic.mp4',durationSec:100,sourceType:'url',status:'ready'}});
      const form=await db.registrationForm.create({data:{vendorId:vendor.id,name:'Synthetic',slug:'binding',headline:'Synthetic',fields:[{key:'name',label:'Synthetic',type:'text',required:true},{key:'email',label:'Synthetic',type:'email',required:true}]}});
      const template=await db.messageTemplate.create({data:{vendorId:vendor.id,name:'Synthetic',channel:'email',trigger:'registration_confirmed',subject:'Synthetic',body:'Synthetic confirmation',isActive:true}});
      const [clock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");const expires=new Date(+clock.now+3600000);
      const live=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,formId:form.id,messageTemplateId:template.id,title:'Synthetic',slug:'binding',status:'ended',scheduledAt:new Date(+clock.now-200000),startedAt:new Date(+clock.now-200000),endedAt:new Date(+clock.now-100000),replayEnabled:true,replayAvailableUntil:expires}});
      const scope={vendorId:vendor.id,liveId:live.id,versionId:'binding-version'};
      await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt") VALUES ($1,$2,$3,$4,'replay',$5,100000,true,$6,$7)`,scope.versionId,vendor.id,live.id,video.id,service.metricVideoFingerprint(video),clock.now,expires);
      async function freshVersion(suffix){
        const other=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,formId:form.id,messageTemplateId:template.id,title:'Synthetic',slug:`binding-${suffix}`,status:'ended',scheduledAt:new Date(+clock.now-200000),startedAt:new Date(+clock.now-200000),endedAt:new Date(+clock.now-100000),replayEnabled:true,replayAvailableUntil:expires}});
        const value={vendorId:vendor.id,liveId:other.id,versionId:`binding-${suffix}`};
        await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt") VALUES ($1,$2,$3,$4,'replay',$5,100000,true,$6,$7)`,value.versionId,vendor.id,other.id,video.id,service.metricVideoFingerprint(video),clock.now,expires);return value;
      }
      receipt.stage='catalog-order';
      for(const table of ['LiveMetricVisitPage','LiveMetricPlaybackIntake']){
        const triggers=await db.$queryRawUnsafe(`SELECT tgname AS name FROM pg_trigger WHERE tgrelid=format('public.%I',$1::text)::regclass AND NOT tgisinternal AND (tgtype::int & 7)=7 ORDER BY tgname::text COLLATE "C"`,table);
        assert.ok(triggers.length>=2);assert.equal(triggers.at(-1).name,`${table}_ingress_guard`);assert.ok(triggers.some(row=>row.name===`${table}_guard`));
      }
      receipt.checks.catalogConfirmsBindingAfterAllCanonicalBeforeInsertGuards='PASS';
      const [runtimeRole]=await db.$queryRawUnsafe("SELECT current_user::regrole::oid=(SELECT proowner FROM pg_proc WHERE oid='public.wp20_metric_ingress_source_allowed(TEXT,TEXT,TEXT,TEXT,TEXT)'::regprocedure) AS owner");assert.equal(runtimeRole.owner,true);
      await db.$executeRawUnsafe('CREATE ROLE wp20_binding_probe NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT');
      try{await assert.rejects(db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE wp20_binding_probe');await tx.$queryRawUnsafe("SELECT public.wp20_metric_ingress_source_allowed('synthetic','synthetic','synthetic',NULL,'viewer')");}),error=>error?.meta?.code==='42501');}
      finally{await db.$executeRawUnsafe('DROP ROLE wp20_binding_probe');}
      receipt.checks.sourcePredicateIsPrivateAndUnprivilegedRoleCannotProbe='PASS';
      const token=randomBytes(32).toString('base64url');
      const admission=await db.liveViewerSession.create({data:{vendorId:vendor.id,liveId:live.id,tokenHash:service.hashLiveViewerToken(token),lastSeenAt:clock.now,expiresAt:expires}});
      const routes=[{path:'/form/binding',method:'GET',kind:'form'},{path:'/live/binding',method:'GET',kind:'viewer'},
        {path:'/api/live-playback-source',method:'GET',kind:'playback',query:{vendorId:vendor.id,liveId:live.id}}];
      const opened=await service.openMetricIngressRun(db,scope,service.metricIngressManifestHash(routes),30),run={...scope,runId:opened.runId};
      const key=randomBytes(32),attestor=service.createMetricIngressAttestor(run,key);
      process.env.LIVE_METRIC_INGRESS_PROFILE=JSON.stringify({...run,key:key.toString('base64url')});
      receipt.stage='db-unbound-and-kind';
      assert.equal(await service.issueMetricRegistrationPage(db,{formId:form.id,liveId:live.id}),null);
      assert.equal(await service.resolveTrackedLivePlaybackSource(db,{vendorId:vendor.id,liveId:live.id,token}),null);
      const counts=async()=>{const [row]=await db.$queryRawUnsafe(`SELECT (SELECT count(*)::int FROM "LiveMetricVisitPage" WHERE "versionId"=$1) AS pages,(SELECT count(*)::int FROM "LiveMetricPlaybackIntake" WHERE "versionId"=$1) AS intakes`,scope.versionId);return row;};
      assert.deepEqual(await counts(),{pages:0,intakes:0});receipt.checks.runOwnedPageAndPlaybackCannotBypassFrameRequirement='PASS';
      const wrong=await service.admitMetricIngress(db,run,'viewer');
      const fakeBinding={...run,frameId:wrong.frameId,kind:'form',method:'GET',target:'/form/binding',format:1};
      assert.equal(await service.issueMetricRegistrationPage(db,{formId:form.id,liveId:live.id},fakeBinding),null);
      await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "LiveMetricVisitPage" ("vendorId","liveId","versionId","eventId","expiresAt","sourceKind","sourceFormId","ingressFrameId") VALUES ($1,$2,$3,$4,$5,'registration',$6,$7)`,vendor.id,live.id,scope.versionId,randomUUID(),expires,form.id,wrong.frameId),error=>error?.meta?.code==='23514');
      await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "LiveMetricPlaybackIntake" (id,"vendorId","liveId","versionId","admissionSessionId","expiresAt","ingressFrameId") VALUES ($1,$2,$3,$4,$5,$6,$7)`,randomUUID(),vendor.id,live.id,scope.versionId,admission.id,expires,wrong.frameId),error=>error?.meta?.code==='23514');
      receipt.checks.databaseRejectsWrongKindEvenWhenTrustedCallerClaimsAnotherKind='PASS';
      receipt.stage='signed-http';
      let forwarded=0,failed=0,lastBinding=null,lateBinding=null,raceIntakeBinding=null;
      const upstream=createServer((request,response)=>{
        forwarded++;
        void (async()=>{
          const target=request.url,kind=target==='/form/binding'?'form':target==='/live/binding'?'viewer':'playback';
          const header=request.headers[service.METRIC_INGRESS_HEADER];
          const binding=service.metricIngressFromRequest(new Headers({[service.METRIC_INGRESS_HEADER]:typeof header==='string'?header:''}),{kind,method:'GET',target});
          assert.ok(binding);lastBinding=binding;
          assert.equal(request.headers['x-forwarded-host'],undefined);assert.equal(request.headers['x-forwarded-proto'],undefined);assert.equal(request.headers.forwarded,undefined);assert.equal(request.headers['x-real-ip'],undefined);
          assert.equal(request.headers['sec-fetch-site'],'same-origin');
          const originHeaders=new Headers({host:request.headers.host,origin:request.headers.origin,'x-celebratedeal-client':request.headers['x-celebratedeal-client']});
          assert.equal(service.requireSameOriginRequest(new Request(`http://${request.headers.host}${target}`,{headers:originHeaders}),{requireClientHeader:true}),null);
          if(kind==='form')assert.ok(await service.issueMetricRegistrationPage(db,{formId:form.id,liveId:live.id},binding));
          else if(kind==='viewer')assert.ok(await service.issueMetricVisitPage(db,{vendorId:vendor.id,liveId:live.id},{kind:'viewer'},binding));
          else assert.ok((await service.resolveTrackedLivePlaybackSource(db,{vendorId:vendor.id,liveId:live.id,token},binding))?.metricRequestId);
          response.setHeader(service.METRIC_INGRESS_HEADER,'synthetic-must-be-stripped');response.end('synthetic');
        })().catch(error=>{failed++;receipt.upstreamFailure=safeError(error);response.statusCode=503;response.end();});
      });
      await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));let gateway;
      try {
        gateway=await service.startMetricIngressGateway(db,run,upstream.address().port,routes,attestor);
        for(const target of ['/form/binding','/live/binding',`/api/live-playback-source?vendorId=${vendor.id}&liveId=${live.id}`]){
          const response=await new Promise((resolve,reject)=>{
            const client=httpRequest(gateway.origin+target,{headers:{[service.METRIC_INGRESS_HEADER]:'synthetic-client-forgery',Origin:gateway.origin,'x-celebratedeal-client':'web','Sec-Fetch-Site':'same-origin',Connection:'origin, sec-fetch-site','X-Forwarded-Host':'evil.example','X-Forwarded-Proto':'https',Forwarded:'host=evil.example','X-Real-Ip':'192.0.2.1'}},incoming=>{
              let body='';incoming.setEncoding('utf8');incoming.on('data',value=>{body+=value;});incoming.on('error',reject);incoming.on('end',()=>resolve({status:incoming.statusCode,privateHeader:incoming.headers[service.METRIC_INGRESS_HEADER]!==undefined,body}));
            });client.on('error',reject);client.end();
          });
          assert.equal(response.status,200);assert.equal(response.privateHeader,false);assert.equal(response.body,'synthetic');
        }
        assert.equal(failed,0);assert.equal(forwarded,3);assert.deepEqual(await counts(),{pages:2,intakes:1});
        receipt.checks.realHttpGatewaySignsAndBindsActualRegistrationViewerAndAuthorizedPlaybackServices='PASS';
        receipt.checks.clientMarkerOverwrittenAndPrivateResponseMarkerNotReturned='PASS';
        receipt.checks.validGatewayOriginPassesCanonicalUpstreamSameOriginChecks='PASS';
        receipt.checks.forwardingSpoofsRemovedAndConnectionCannotStripValidatedOriginMetadata='PASS';
        const before=forwarded;
        const bad=await fetch(`${gateway.origin}/api/live-playback-source?vendorId=foreign&liveId=${live.id}`);assert.equal(bad.status,404);await bad.arrayBuffer();assert.equal(forwarded,before);
        receipt.checks.playbackQueryCannotSelectForeignScope='PASS';
        assert.ok(lastBinding?.kind==='playback');
        assert.equal(await service.resolveTrackedLivePlaybackSource(db,{vendorId:vendor.id,liveId:live.id,token},lastBinding),null);
        assert.equal(await service.resolveTrackedLivePlaybackSource(db,{vendorId:vendor.id,liveId:live.id,token:'A'.repeat(43)},lastBinding),null);
        assert.deepEqual(await counts(),{pages:2,intakes:1});
        receipt.checks.signedFrameDoesNotReplaceCanonicalPlaybackAuthorization='PASS';
        const lateFrame=await service.admitMetricIngress(db,run,'playback'),lateRequest={kind:'playback',method:'GET',target:`/api/live-playback-source?vendorId=${vendor.id}&liveId=${live.id}`};
        lateBinding=attestor.verify(attestor.issue(lateFrame.frameId,lateRequest),lateRequest);
        const raceFrame=await service.admitMetricIngress(db,run,'playback');raceIntakeBinding=attestor.verify(attestor.issue(raceFrame.frameId,lateRequest),lateRequest);
        assert.deepEqual(await gateway.close(),{settlementFailures:0,admissionFailures:0,pendingFrames:3});gateway=null;
        receipt.checks.unansweredManualFrameRemainsUnknownAfterSignedSourcesAndStop='PASS';
      } catch(error){receipt.primaryHttpFailure=safeError(error);throw error;}
      finally {
        try{if(gateway)await gateway.close();}catch(error){receipt.shutdownFailure=safeError(error);}
        finally{await new Promise(resolve=>{upstream.close(resolve);upstream.closeAllConnections();});}
      }
      receipt.stage='one-use-and-scope';
      assert.equal(await service.issueMetricVisitPage(db,{vendorId:vendor.id,liveId:live.id},{kind:'viewer'}),null);
      assert.equal(await service.resolveTrackedLivePlaybackSource(db,{vendorId:vendor.id,liveId:live.id,token}),null);
      assert.deepEqual(await counts(),{pages:2,intakes:1});receipt.checks.stoppedRunWithoutBindingHasDefinedNullInsteadOfPersistenceOrAuthorizationError='PASS';
      const frames=await db.$queryRawUnsafe('SELECT id,"routeKind" FROM "LiveMetricIngressFrame" WHERE "runId"=$1 AND outcome=\'responded\' ORDER BY "admittedAt",id',run.runId);
      assert.equal(frames.length,3);
      const pageFrame=frames.find(row=>row.routeKind==='form');assert.ok(pageFrame);
      assert.equal(await service.issueMetricRegistrationPage(db,{formId:form.id,liveId:live.id},{...run,frameId:pageFrame.id,kind:'form',method:'GET',target:'/form/binding',format:1}),null);
      for(const sql of ['UPDATE "LiveMetricVisitPage" SET "ingressFrameId"=NULL','UPDATE "LiveMetricPlaybackIntake" SET "ingressFrameId"=NULL'])await assert.rejects(db.$executeRawUnsafe(sql),error=>error?.meta?.code==='23514');
      assert.deepEqual(await counts(),{pages:2,intakes:1});receipt.checks.frameSingleUseAndBothSourceBindingsImmutable='PASS';
      const [bound]=await db.$queryRawUnsafe(`SELECT count(*)::int AS count FROM (SELECT p."ingressFrameId" AS frame FROM "LiveMetricVisitPage" p WHERE p."versionId"=$1 UNION ALL SELECT i."ingressFrameId" FROM "LiveMetricPlaybackIntake" i WHERE i."versionId"=$1) sources JOIN "LiveMetricIngressFrame" f ON f.id=sources.frame WHERE f."vendorId"=$2 AND f."liveId"=$3 AND f."versionId"=$1 AND f."runId"=$4`,scope.versionId,vendor.id,live.id,run.runId);assert.equal(bound.count,3);
      receipt.checks.allThreeActualSourcesMatchTheSameTenantLiveVersionRun='PASS';
      const token2=randomBytes(32).toString('base64url');
      await db.liveViewerSession.create({data:{vendorId:vendor.id,liveId:live.id,tokenHash:service.hashLiveViewerToken(token2),lastSeenAt:clock.now,expiresAt:expires}});
      assert.ok(raceIntakeBinding);
      const concurrent=await Promise.all([token,token2].map(credential=>service.resolveTrackedLivePlaybackSource(db,{vendorId:vendor.id,liveId:live.id,token:credential},raceIntakeBinding)));
      assert.equal(concurrent.filter(value=>value!==null).length,1);assert.equal(concurrent.filter(value=>value===null).length,1);
      assert.deepEqual(await counts(),{pages:2,intakes:2});receipt.checks.twoDifferentAdmissionsConsumeOneFrameExactlyOnceWithDefinedNullRetry='PASS';
      receipt.stage='collection-boundary';
      await db.$executeRawUnsafe('UPDATE "LiveMetricVersion" SET "collectionEnabled"=false WHERE id=$1',scope.versionId);
      assert.ok(lateBinding);assert.equal(await service.resolveTrackedLivePlaybackSource(db,{vendorId:vendor.id,liveId:live.id,token},lateBinding),null);
      const [unbound]=await db.$queryRawUnsafe('SELECT NOT EXISTS(SELECT 1 FROM "LiveMetricPlaybackIntake" WHERE "ingressFrameId"=$1) AS unbound',lateBinding.frameId);assert.equal(unbound.unbound,true);
      assert.deepEqual(await counts(),{pages:2,intakes:2});receipt.checks.disabledCollectionBindingReturnsContextRaceWithoutChangingViewerAuthorization='PASS';
      receipt.stage='run-creation-race';
      const racing=await freshVersion('race');let queued;
      await db.$transaction(async tx=>{
        await tx.$queryRawUnsafe('SELECT id FROM "LiveMetricVersion" WHERE id=$1 FOR UPDATE',racing.versionId);
        queued=service.issueMetricVisitPage(db,{vendorId:racing.vendorId,liveId:racing.liveId},{kind:'viewer'}).then(value=>value===null?'blocked-unbound':'unexpected-source',()=> 'wrong-error');
        let blocked=false;
        for(let attempt=0;attempt<80;attempt++){
          // pg_locks/pg_blocking_pids are live, unlike pg_stat_activity's cached
          // per-transaction statistics snapshot. Observe the actual blocker.
          const [waiting]=await tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM pg_locks WHERE NOT granted AND pid<>pg_backend_pid() AND pg_backend_pid()=ANY(pg_blocking_pids(pid))`);
          if(waiting.count>0){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,25));
        }
        receipt.raceObservation={blockedByOwningTransaction:blocked};assert.equal(blocked,true);
        await tx.$executeRawUnsafe(`INSERT INTO "LiveMetricIngressRun" (id,"vendorId","liveId","versionId","manifestHash","admissionLimit") VALUES ($1,$2,$3,$4,$5,10)`,randomUUID(),racing.vendorId,racing.liveId,racing.versionId,'b'.repeat(64));
      },{timeout:10000,isolationLevel:'ReadCommitted'});
      assert.equal(await queued,'blocked-unbound');
      const [raceCount]=await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "LiveMetricVisitPage" WHERE "versionId"=$1',racing.versionId);assert.equal(raceCount.count,0);
      receipt.checks.sourceWaitingDuringRunCreationCannotCommitAnUnboundPage='PASS';
      const legacy=await freshVersion('legacy');assert.ok(await service.issueMetricVisitPage(db,{vendorId:legacy.vendorId,liveId:legacy.liveId},{kind:'viewer'}));
      receipt.checks.noRunLegacySourceStillWorksWithoutForgedBackfill='PASS';
      receipt.stage='parent-cascade';await db.$executeRawUnsafe('DELETE FROM "LiveMetricVersion" WHERE id=$1',scope.versionId);
      assert.deepEqual(await counts(),{pages:0,intakes:0});receipt.checks.deferredForeignKeysAllowCanonicalVersionCascade='PASS';
    } catch(error){receipt.innerFailure=safeError(error);throw error;} finally{await db.$disconnect();}
  }});
  receipt.migrationCount=migration.migrationNames.length;receipt.cleanup=migration.cleanup;assert.equal(migration.status,'PASS');receipt.status='PASS';receipt.stage='complete';
} catch(error){receipt.error=safeError(error);}
fs.writeFileSync(`${base}/ingress-binding-db.json`,JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({status:receipt.status,stage:receipt.stage,checks:receipt.checks,error:receipt.innerFailure??receipt.error,upstreamFailure:receipt.upstreamFailure,primaryHttpFailure:receipt.primaryHttpFailure,shutdownFailure:receipt.shutdownFailure,migrationCount:receipt.migrationCount,cleanup:receipt.cleanup}));
if(receipt.status!=='PASS')process.exitCode=1;
