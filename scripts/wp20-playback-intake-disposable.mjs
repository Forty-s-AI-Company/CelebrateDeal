import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { main } from './prisma-loopback-disposable-migration-runner.mjs';
const require = createRequire(import.meta.url);
const renewalMode = process.argv.includes('--renewal');
const auditMode = process.argv.includes('--audit');
const output = `docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/${auditMode?'viewing-intake-audit':`playback-${renewalMode?'renewal':'intake'}`}-db.json`;
const receipt = { status: 'FAIL', stage: 'start', scope: 'Actual playback intake/context/session services, owned disposable synthetic DB', checks: {} };
let migration;
try {
  const paths = JSON.parse(fs.readFileSync('node_modules/.prisma/client/index.js', 'utf8').match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1] ?? 'null');
  assert.ok(paths && Object.values(paths).every(value => value === null));
  const { PrismaClient } = require('@prisma/client');
  migration = await main({ afterMigrate: async ({ databaseUrl }) => {
    const url = new URL(databaseUrl); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/celebratedeal_test');
    const db = new PrismaClient({ datasourceUrl: databaseUrl });
    try {
      const [marker] = await db.$queryRawUnsafe("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
      assert.match(marker.marker, /^prisma-no-dotenv:[a-f0-9]{16}$/u);
      receipt.stage = 'bundle';
      const built = await build({ stdin: { contents: 'export {resolveTrackedLivePlaybackSource} from "./src/lib/live-metric-playback-intake.ts";export {issueMetricSession} from "./src/lib/live-metric-session.ts";export {metricVideoFingerprint,resolveMetricSessionContext} from "./src/lib/live-metric-version.ts";export {resolveLivePlaybackSource} from "./src/lib/live-playback-source.ts";export {ingestMetricIntervals} from "./src/lib/live-metric-ingestion.ts";export {closeMetricSession} from "./src/lib/live-metric-close.ts";export {hashLiveViewerToken} from "./src/lib/live-quota-admission.ts";', loader: 'ts', resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, logLevel: 'silent' });
      const compiled = { exports: {} }; new Function('require', 'module', 'exports', built.outputFiles[0].text)(require, compiled, compiled.exports);
      const service = compiled.exports;
      receipt.stage = 'fixtures';
      const vendor = await db.vendor.create({ data: { name: 'Synthetic intake', slug: 'playback-intake', email: 'intake@example.test', passwordHash: 'synthetic-unused' } });
      const video = await db.video.create({ data: { vendorId: vendor.id, title: 'Synthetic', videoUrl: 'https://example.test/synthetic.mp4', durationSec: 4, sourceType: 'url', status: 'ready' } });
      const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: 'Synthetic', slug: 'playback-intake', headline: 'Synthetic', fields: [] } });
      const [clock] = await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
      const expires = new Date(+clock.now + 3600000), admissionExpires = new Date(+clock.now + (renewalMode?20000:90000));
      const live = await db.live.create({ data: { vendorId: vendor.id, videoId: video.id, formId: form.id, title: 'Synthetic', slug: 'playback-intake', status: 'ended', scheduledAt: new Date(+clock.now - 200000), startedAt: new Date(+clock.now - 200000), endedAt: new Date(+clock.now - 100000), replayEnabled: true, replayAvailableUntil: expires } });
      const submission = await db.formSubmission.create({ data: { formId: form.id, liveId: live.id, name: 'Synthetic', email: 'intake@example.test', verificationStatus: 'VERIFIED', verifiedAt: new Date(+clock.now - 5000) } });
      const token = 'p'.repeat(43);
      const admission = await db.liveViewerSession.create({ data: { vendorId: vendor.id, liveId: live.id, tokenHash: service.hashLiveViewerToken(token), createdAt: new Date(+clock.now - 2000), lastSeenAt: clock.now, expiresAt: admissionExpires } });
      const scope = { vendorId: vendor.id, liveId: live.id };
      // With no collection version, the canonical source still works untracked.
      const canonical=await service.resolveLivePlaybackSource(db,{...scope,token,now:clock.now});assert.ok(canonical);assert.deepEqual(await service.resolveTrackedLivePlaybackSource(db, { ...scope, token }),canonical);
      receipt.checks.unconfiguredPlaybackPreserved = 'PASS';
      await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt") VALUES ('playback-intake-version',$1,$2,$3,'replay',$4,4000,true,$5,$6)`, vendor.id, live.id, video.id, service.metricVideoFingerprint(video), new Date(+clock.now - 10000), expires);
      const [epoch] = await db.$queryRawUnsafe('SELECT "playbackIntakeStartedAt" AS started FROM "LiveMetricVersion" WHERE id=$1', 'playback-intake-version'); assert.ok(epoch.started >= clock.now);
      receipt.stage = 'intake-before-source';
      const lost = await service.resolveTrackedLivePlaybackSource(db, { ...scope, token });
      assert.match(lost.metricRequestId, /^[a-f0-9-]{36}$/u);
      const [stored] = await db.$queryRawUnsafe('SELECT id,"issuedAt","expiresAt" FROM "LiveMetricPlaybackIntake" WHERE id=$1', lost.metricRequestId);
      assert.equal(stored.id, lost.metricRequestId); assert.equal(+stored.issuedAt, lost.metricIssuedAtMs); assert.equal(+stored.expiresAt, lost.metricExpiresAtMs);
      assert.ok(stored.expiresAt <= admissionExpires);
      const [empty] = await db.$queryRawUnsafe('SELECT count(*) AS count FROM "LiveMetricSession" WHERE "versionId"=$1', 'playback-intake-version'); assert.equal(empty.count, BigInt(0));
      receipt.checks.committedBeforeSourceAndLostReplyRetained = 'PASS';
      const source = await service.resolveTrackedLivePlaybackSource(db, { ...scope, token }); assert.notEqual(source.metricRequestId, lost.metricRequestId);
      const identity = { ...scope, submissionId: submission.id, admissionId: admission.id };
      const issue = (requestId, actor = identity) => service.issueMetricSession(db, async () => actor, service.resolveMetricSessionContext, { requestId }, { requirePlaybackIntake: true, renewPlaybackIntake: renewalMode });
      const session = await issue(source.metricRequestId); assert.deepEqual(await issue(source.metricRequestId), session);
      const [bound] = await db.$queryRawUnsafe('SELECT "intakeId","anchorAt","expiresAt" FROM "LiveMetricSession" WHERE id=$1', session.sessionId);
      assert.equal(bound.intakeId, source.metricRequestId); assert.ok(+bound.anchorAt >= source.metricIssuedAtMs); assert.ok(+bound.expiresAt <= source.metricExpiresAtMs);
      receipt.checks.canonicalSessionBindingIdempotentAndBounded = 'PASS';
      await assert.rejects(issue(randomUUID()), error => error.code === 'not_authorized');
      assert.equal(await service.resolveTrackedLivePlaybackSource(db, { ...scope, vendorId: 'synthetic-other', token }), null);
      const other = await db.liveViewerSession.create({ data: { vendorId: vendor.id, liveId: live.id, tokenHash: service.hashLiveViewerToken('q'.repeat(43)), createdAt: new Date(+clock.now - 2000), lastSeenAt: clock.now, expiresAt: admissionExpires } });
      await assert.rejects(issue(source.metricRequestId, { ...identity, admissionId: other.id }), error => error.code === 'not_authorized');
      receipt.checks.missingIntakeForeignScopeAndAdmissionRejected = 'PASS';
      receipt.stage = 'browser-db-bridge';
      const clientBundle=await build({stdin:{contents:'export {createPlaybackMetricCollector} from "./src/lib/live-metric-playback-collector.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'browser',format:'iife',globalName:'PlaybackIntakeBrowser',write:false,logLevel:'silent'});
      let browser,origin,lastSource,firstBrowserReceipt,lastBrowserReceipt,sessionRequests=0,transportFailures=0;
      const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'private, no-store'});res.end(JSON.stringify(value));};
      const server=http.createServer((req,res)=>{void(async()=>{
       try{
        if(req.url==='/bundle.js'){res.writeHead(200,{'Content-Type':'application/javascript'});res.end(clientBundle.outputFiles[0].text);return;}
        if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><video muted playsinline></video><script src="/bundle.js"></script>');return;}
        if(req.url==='/source'){lastSource=await service.resolveTrackedLivePlaybackSource(db,{...scope,token});json(res,lastSource);return;}
        if(req.url==='/synthetic-admission-renewal'&&renewalMode){
         await db.$executeRawUnsafe(`UPDATE "LiveViewerSession" SET "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '90 seconds' WHERE id=$1`,admission.id);
         json(res,{ok:true});return;
        }
        if(req.method!=='POST'||req.headers.origin!==origin||req.headers['x-celebratedeal-client']!=='web'){json(res,{error:'rejected'},403);return;}
        const chunks=[];let size=0;for await(const part of req){size+=part.length;if(size>16384)throw new Error('oversize');chunks.push(part);}
        const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const base=`/api/live-metrics/${vendor.id}/${live.id}/`;
        if(req.url===base+'sessions'){
         sessionRequests++;assert.equal(body.requestId,lastSource.metricRequestId);
         const value=await issue(body.requestId);firstBrowserReceipt??=value;lastBrowserReceipt=value;
         const [clockNow]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");json(res,{ok:true,...value,serverNowAtMs:+clockNow.now});return;
        }
        if(req.url===base+'intervals'){json(res,{ok:true,...await service.ingestMetricIntervals(db,async()=>identity,body,service.resolveMetricSessionContext)});return;}
        if(req.url===base+'close'){json(res,{ok:true,...await service.closeMetricSession(db,async()=>identity,body,service.resolveMetricSessionContext)});return;}
        json(res,{error:'not found'},404);
       }catch{transportFailures++;json(res,{error:'fixture request failed'},503);}
      })();});
      try{
       await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
       browser=await chromium.launch({headless:true});const context=await browser.newContext();
       await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
       const page=await context.newPage();await page.goto(origin);
       const observed=await page.evaluate(async ({scope,renewalMode})=>{
        const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
        const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const paint=canvas.getContext('2d');let frame=0;
        const stream=canvas.captureStream(30),chunks=[],recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
        recorder.ondataavailable=event=>chunks.push(event.data);const stopped=new Promise(resolve=>{recorder.onstop=resolve;});
        const draw=setInterval(()=>{paint.fillStyle=frame++%2?'#336699':'#669933';paint.fillRect(0,0,160,90);},33);
        recorder.start();await wait(4000);recorder.stop();await stopped;clearInterval(draw);stream.getTracks().forEach(track=>track.stop());
        const video=document.querySelector('video'),url=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));video.src=url;
        await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('synthetic-vod-failed'));});
        const source=await(await fetch('/source')).json();
        const collector=PlaybackIntakeBrowser.createPlaybackMetricCollector(scope,source,video,()=>performance.now());
        if(!collector)throw new Error('missing server intake');
        try{await collector.tick();if(renewalMode){await fetch('/synthetic-admission-renewal');await collector.tick();}await video.play();await wait(2400);video.pause();await collector.finish();return collector.state();}
        finally{URL.revokeObjectURL(url);}
       },{scope,renewalMode});
       receipt.browser={transportFailures,sessionRequests,stopped:observed.stopped,disabled:observed.disabled,delivery:observed.delivery};
       assert.equal(transportFailures,0);assert.equal(sessionRequests,renewalMode?2:1);assert.equal(observed.delivery.terminal,true);assert.ok(observed.delivery.finalSequence>=0);
       if(renewalMode){
        assert.equal(lastBrowserReceipt.sessionId,firstBrowserReceipt.sessionId);assert.equal(lastBrowserReceipt.anchorAtMs,firstBrowserReceipt.anchorAtMs);
        assert.ok(lastBrowserReceipt.expiresAtMs>firstBrowserReceipt.expiresAtMs);
        const [lease]=await db.$queryRawUnsafe('SELECT "renewalCount","expiresAt" FROM "LiveMetricPlaybackIntake" WHERE id=$1',lastSource.metricRequestId);
        assert.equal(lease.renewalCount,BigInt(1));assert.equal(+lease.expiresAt,lastBrowserReceipt.expiresAtMs);
        receipt.checks.sameBrowserIntakeSessionAnchorRenewedAndRevisionAdvanced='PASS';
       }
       const [persisted]=await db.$queryRawUnsafe('SELECT s.complete,s."closedAt",count(i.id) AS intervals FROM "LiveMetricSession" s LEFT JOIN "LiveMetricInterval" i ON i."sessionId"=s.id WHERE s."intakeId"=$1 GROUP BY s.id',lastSource.metricRequestId);
       assert.equal(persisted.complete,true);assert.ok(persisted.closedAt);assert.ok(persisted.intervals>BigInt(0));
       receipt.browser={sessionRequests,intervals:Number(persisted.intervals),terminal:true,media:'generated recorded VOD; live captureStream/WHEP NOT_VERIFIED',fixtureAuthorization:'fixed synthetic server identity; Next signed HTTP auth not covered'};
       receipt.checks.realBrowserServerUuidSamplingAppendCloseDb='PASS';
      }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
      receipt.stage = 'quota-loss';
      const [priorIntakes]=await db.$queryRawUnsafe('SELECT count(*) AS count FROM "LiveMetricPlaybackIntake" WHERE "versionId"=$1','playback-intake-version');
      for (let i = Number(priorIntakes.count); i < 64; i++) assert.ok((await service.resolveTrackedLivePlaybackSource(db, { ...scope, token })).metricRequestId);
      assert.equal((await service.resolveTrackedLivePlaybackSource(db, { ...scope, token })).metricRequestId, undefined);
      const [quota] = await db.$queryRawUnsafe('SELECT count(*) AS count,count("lossAt") AS losses FROM "LiveMetricPlaybackIntake" WHERE "versionId"=$1', 'playback-intake-version');
      assert.deepEqual(quota, { count: BigInt(64), losses: BigInt(1) });
      const revision = async () => { const [row] = await db.$queryRawUnsafe('SELECT public.wp20_metric_playback_intake_revision($1,$2,$3) AS revision', vendor.id, live.id, 'playback-intake-version'); return row.revision; };
      assert.equal(await revision(), BigInt(renewalMode?66:65));
      assert.equal((await service.resolveTrackedLivePlaybackSource(db, { ...scope, token })).playbackUrl, video.videoUrl); assert.equal(await revision(), BigInt(renewalMode?66:65));
      // The quota loss describes later untracked playback, not revocation of an
      // already-issued nonce. An earlier valid outstanding request still binds.
      assert.ok((await issue(lost.metricRequestId)).sessionId);
      receipt.checks.quotaPersistsOnePermanentGapWithoutBlockingPlayback = 'PASS';
      if(auditMode){
        receipt.stage='viewing-intake-audit';
        const auditBundle=await build({stdin:{contents:'export {auditMetricViewingSources} from "./src/lib/live-metric-viewing-source-audit.ts";export {inspectPlaybackIntakes} from "./src/lib/live-metric-playback-intake-audit.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent'});
        const auditModule={exports:{}};new Function('require','module','exports',auditBundle.outputFiles[0].text)(require,auditModule,auditModule.exports);
        const [auditClock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp())-interval '1 millisecond' AS now");
        const auditScope={...scope,versionId:'playback-intake-version',startAt:new Date(+clock.now-10000),endAt:auditClock.now};
        const audit=await auditModule.exports.auditMetricViewingSources(db,auditScope);
        assert.equal(audit.status,'enumerated');assert.equal(audit.coverage,'unknown');assert.equal(audit.intake.count,64);
        assert.equal(audit.intake.quotaLosses,1);assert.equal(audit.intake.countCompleteness,'recorded_only');
        assert.equal(audit.intake.history,'unknown');assert.equal(audit.intake.outcomes.closed_session,1);
        assert.equal(audit.intake.outcomes.open_session,2);assert.equal(audit.intake.outcomes.pending_session,61);
        const smallPages=await auditModule.exports.auditMetricViewingSources(db,auditScope,{pageSize:1});
        assert.equal(smallPages.digest,audit.digest);
        assert.deepEqual(await auditModule.exports.auditMetricViewingSources(db,auditScope,{rows:64}),{status:'unavailable',reason:'limit_exceeded'});
        receipt.checks.sameSnapshotIntakesSessionsQuotaLossAndSharedBudget='PASS';
        await db.$executeRawUnsafe(`UPDATE "LiveViewerSession" SET "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '90 seconds' WHERE id=$1`,other.id);
        let inserted=false;
        const snapshotDb={$transaction:(work,options)=>db.$transaction(async tx=>work(new Proxy(tx,{get(target,key){
          if(key==='$queryRaw')return async(...args)=>{
            const rows=await target.$queryRaw(...args);
            if(!inserted&&args[0]?.strings?.join('').includes('current_setting')){
              inserted=true;assert.ok((await service.resolveTrackedLivePlaybackSource(db,{...scope,token:'q'.repeat(43)})).metricRequestId);
            }
            return rows;
          };
          const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
        }})),options)};
        const during=await auditModule.exports.auditMetricViewingSources(snapshotDb,auditScope);
        assert.equal(inserted,true);assert.equal(during.intake.count,64);
        const after=await auditModule.exports.auditMetricViewingSources(db,auditScope);
        assert.equal(after.intake.count,65);assert.equal(after.intake.outcomes.future_intake,1);assert.notEqual(after.digest,during.digest);
        receipt.checks.concurrentNewIntakeInvisibleWithinRrThenChangesNextDigest='PASS';
        receipt.stage='intake-visibility';
        const tables='"LiveMetricPlaybackIntake","LiveMetricSession","LiveMetricRegistration","Live","FormSubmission","RegistrationForm"';
        await db.$executeRawUnsafe('CREATE ROLE wp20_intake_visibility_probe NOLOGIN');
        const functions='public.wp20_metric_playback_intake_page(text,text,text,text,integer),public.wp20_metric_viewing_page(text,text,text,timestamptz,timestamptz,text,integer,integer)';
        const [formRls]=await db.$queryRawUnsafe(`SELECT relrowsecurity AS enabled FROM pg_class WHERE oid='public."FormSubmission"'::regclass`);
        const roleInspect=()=>db.$transaction(async tx=>{
          await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');await tx.$executeRawUnsafe('SET LOCAL ROLE wp20_intake_visibility_probe');
          const [visible]=await tx.$queryRawUnsafe('SELECT (SELECT count(*)::int FROM "LiveMetricSession") AS sessions,(SELECT count(*)::int FROM "FormSubmission") AS identities');
          const result=await auditModule.exports.inspectPlaybackIntakes(tx,auditScope,{asOf:after.intake.asOf,expectedRevision:after.intake.revision,epochStartedAt:after.intake.epochStartedAt},
            {rows:1000,pages:1000,pageSize:100,outOfTime:()=>false});
          const sessionRows=await tx.$queryRawUnsafe('SELECT * FROM public.wp20_metric_viewing_page($1,$2,$3,$4::timestamptz,$5::timestamptz,NULL::text,-1,501)',vendor.id,live.id,'playback-intake-version',auditScope.startAt,auditScope.endAt);
          return {visible,result,sessionRows};
        },{isolationLevel:'RepeatableRead'});
        try{
          await db.$executeRawUnsafe(`GRANT SELECT ON ${tables} TO wp20_intake_visibility_probe`);
          await assert.rejects(roleInspect(),error=>error?.meta?.code==='42501');
          await db.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION ${functions} TO wp20_intake_visibility_probe`);
          await db.$executeRawUnsafe('CREATE POLICY wp20_intake_audit_intake_probe ON "LiveMetricPlaybackIntake" FOR SELECT TO wp20_intake_visibility_probe USING (true)');
          const hiddenSession=await roleInspect();assert.equal(hiddenSession.visible.sessions,0);
          assert.equal(hiddenSession.result.digest,after.intake.digest);assert.equal(hiddenSession.result.classificationDigest,after.intake.classificationDigest);
          assert.equal(hiddenSession.result.outcomes.closed_session,1);assert.equal(hiddenSession.result.outcomes.open_session,2);
          const ownerRows=await db.$queryRawUnsafe('SELECT * FROM public.wp20_metric_viewing_page($1,$2,$3,$4::timestamptz,$5::timestamptz,NULL::text,-1,501)',vendor.id,live.id,'playback-intake-version',auditScope.startAt,auditScope.endAt);
          assert.deepEqual(hiddenSession.sessionRows,ownerRows);
          await db.$executeRawUnsafe('CREATE POLICY wp20_intake_audit_session_probe ON "LiveMetricSession" FOR SELECT TO wp20_intake_visibility_probe USING (true)');
          if(!formRls.enabled)await db.$executeRawUnsafe('ALTER TABLE "FormSubmission" ENABLE ROW LEVEL SECURITY');
          const hiddenIdentity=await roleInspect();assert.equal(hiddenIdentity.visible.sessions,3);assert.equal(hiddenIdentity.visible.identities,0);
          assert.equal(hiddenIdentity.result.digest,after.intake.digest);assert.equal(hiddenIdentity.result.outcomes.identity_mismatch,0);
          assert.deepEqual(hiddenIdentity.sessionRows,ownerRows);
          receipt.checks.privateDefinerKeepsSessionAndIdentityJoinsAuthoritative='PASS';
          receipt.checks.privatePageExecutionDeniedWithoutGrant='PASS';
        }finally{
          await db.$executeRawUnsafe('DROP POLICY IF EXISTS wp20_intake_audit_intake_probe ON "LiveMetricPlaybackIntake"');
          await db.$executeRawUnsafe('DROP POLICY IF EXISTS wp20_intake_audit_session_probe ON "LiveMetricSession"');
          if(!formRls.enabled)await db.$executeRawUnsafe('ALTER TABLE "FormSubmission" DISABLE ROW LEVEL SECURITY');
          await db.$executeRawUnsafe(`REVOKE ALL ON FUNCTION ${functions} FROM wp20_intake_visibility_probe`);
          await db.$executeRawUnsafe(`REVOKE ALL ON ${tables} FROM wp20_intake_visibility_probe`);
          await db.$executeRawUnsafe('DROP ROLE wp20_intake_visibility_probe');
        }
        receipt.checks.rlsFilteringCannotShiftOutcomeCounts='PASS';
        receipt.intakeInspection={count:after.intake.count,quotaLosses:after.intake.quotaLosses,outcomes:after.intake.outcomes,coverage:after.coverage};
      }
      receipt.stage = 'immutability';
      for (const sql of ['UPDATE "LiveMetricPlaybackIntake" SET "expiresAt"="expiresAt"', 'DELETE FROM "LiveMetricPlaybackIntake"', 'TRUNCATE "LiveMetricPlaybackIntake" CASCADE', 'UPDATE "LiveMetricPlaybackIntake" SET "lossAt"=NULL WHERE "lossAt" IS NOT NULL', 'UPDATE "LiveMetricVersion" SET "playbackIntakeStartedAt"=NULL'])
        await assert.rejects(db.$executeRawUnsafe(sql), error => error?.meta?.code === '23514');
      await assert.rejects(db.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "intakeId"=NULL WHERE id=$1', session.sessionId), error => error?.meta?.code === '23514');
      // Exercise the actual database guard, independently of service options.
      for (const [sql, value] of [
        ['UPDATE "LiveMetricSession" SET "expiresAt"=$2 WHERE id=$1', new Date(source.metricExpiresAtMs + 1000)],
        ['UPDATE "LiveMetricSession" SET "anchorAt"=$2 WHERE id=$1', new Date(+bound.anchorAt + 1)],
        ['UPDATE "LiveMetricSession" SET "admissionSessionId"=$2 WHERE id=$1', other.id],
      ]) await assert.rejects(db.$executeRawUnsafe(sql, session.sessionId, value), error => error?.meta?.code === '23514');
      await db.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "expiresAt"="expiresAt" WHERE id=$1', session.sessionId);
      receipt.checks.boundSessionUpdatesCannotChangeIdentityAnchorOrExceedIntake = 'PASS';
      const timestampColumns=await db.$queryRawUnsafe(`SELECT attname,format_type(atttypid,atttypmod) AS type
        FROM pg_attribute WHERE attrelid='public."LiveMetricSession"'::regclass AND attname IN ('anchorAt','expiresAt') ORDER BY attname`);
      assert.deepEqual(timestampColumns.map(row=>row.type),['timestamp(3) with time zone','timestamp(3) with time zone']);
      for (const timezone of ['Asia/Tokyo','America/Los_Angeles']) {
        await db.$transaction(async tx=>{
          await tx.$queryRawUnsafe("SELECT set_config('TimeZone',$1,true)",timezone);
          await tx.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "expiresAt"=$2::timestamptz WHERE id=$1',session.sessionId,new Date(source.metricExpiresAtMs));
        });
        await assert.rejects(db.$transaction(async tx=>{
          await tx.$queryRawUnsafe("SELECT set_config('TimeZone',$1,true)",timezone);
          await tx.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "expiresAt"=$2::timestamptz WHERE id=$1',session.sessionId,new Date(source.metricExpiresAtMs+1));
        }),error=>error?.meta?.code==='23514');
      }
      receipt.checks.timestamptzCatalogAndNonUtcBoundUpdates = 'PASS';
      receipt.checks.intakeEpochLossAndSessionBindingImmutable = 'PASS';
      // The disposable owner alone can create this synthetic probe role. Reuse
      // the migration's exact ACL assertion rather than mirroring its logic.
      receipt.stage = 'column-acl';
      const migrationSql=fs.readFileSync('prisma/migrations/20261016070000_live_metric_playback_intake/migration.sql','utf8');
      const aclBlock=migrationSql.slice(migrationSql.lastIndexOf('DO $$ DECLARE api_role'),migrationSql.lastIndexOf('COMMIT;')).trim();
      assert.ok(aclBlock.includes('pg_attribute'));
      await db.$executeRawUnsafe('CREATE ROLE wp20_intake_column_probe NOLOGIN');
      try {
        await db.$executeRawUnsafe('GRANT SELECT(id) ON "LiveMetricPlaybackIntake" TO wp20_intake_column_probe');
        await assert.rejects(db.$executeRawUnsafe(aclBlock), error => error?.meta?.code === '23514');
      } finally {
        await db.$executeRawUnsafe('REVOKE SELECT(id) ON "LiveMetricPlaybackIntake" FROM wp20_intake_column_probe');
        await db.$executeRawUnsafe('DROP ROLE wp20_intake_column_probe');
      }
      await db.$executeRawUnsafe(aclBlock);
      receipt.checks.unexpectedColumnGrantRejectedAndProbeRoleCleaned = 'PASS';
      if(renewalMode){
        receipt.stage='expired-renewal';
        await db.$executeRawUnsafe(`UPDATE "LiveViewerSession" SET "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 second' WHERE id=$1`,other.id);
        const expiredSource=await service.resolveTrackedLivePlaybackSource(db,{...scope,token:'q'.repeat(43)});
        const expiredIdentity={...identity,admissionId:other.id};
        const expiredSession=await issue(expiredSource.metricRequestId,expiredIdentity);
        await assert.rejects(db.$executeRawUnsafe('UPDATE "LiveMetricPlaybackIntake" SET "renewalCount"="renewalCount"+1 WHERE id=$1',expiredSource.metricRequestId),error=>error?.meta?.code==='23514');
        // pg_sleep returns PostgreSQL void, which Prisma cannot deserialize.
        // Execute it inside a DO block; keep the actual database-clock wait.
        receipt.stage='expired-renewal:wait';
        await db.$executeRawUnsafe('DO $$ BEGIN PERFORM pg_sleep(1.1); END $$');
        receipt.stage='expired-renewal:reject-resurrection';
        await db.$executeRawUnsafe(`UPDATE "LiveViewerSession" SET "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '90 seconds' WHERE id=$1`,other.id);
        await assert.rejects(issue(expiredSource.metricRequestId,expiredIdentity),error=>error.code==='not_authorized');
        await assert.rejects(db.$executeRawUnsafe(`UPDATE "LiveMetricPlaybackIntake" SET "expiresAt"=clock_timestamp()+interval '30 seconds' WHERE id=$1`,expiredSource.metricRequestId),error=>error?.meta?.code==='23514');
        const [unchanged]=await db.$queryRawUnsafe('SELECT i."renewalCount",s."expiresAt" FROM "LiveMetricPlaybackIntake" i JOIN "LiveMetricSession" s ON s."intakeId"=i.id WHERE s.id=$1',expiredSession.sessionId);
        assert.equal(unchanged.renewalCount,BigInt(0));assert.equal(+unchanged.expiresAt,expiredSession.expiresAtMs);
        receipt.checks.expiredSessionAndIntakeCannotResurrectAfterAdmissionRenewal='PASS';
        receipt.checks.renewalCounterCannotBeForged='PASS';
        receipt.stage='renewal-lock-wait';
        await db.$executeRawUnsafe(`UPDATE "LiveViewerSession" SET "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 second' WHERE id=$1`,other.id);
        const waitingSource=await service.resolveTrackedLivePlaybackSource(db,{...scope,token:'q'.repeat(43)});
        const waitingSession=await issue(waitingSource.metricRequestId,expiredIdentity);
        await db.$executeRawUnsafe(`UPDATE "LiveViewerSession" SET "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '90 seconds' WHERE id=$1`,other.id);
        let unlock,locked;
        const release=new Promise(resolve=>{unlock=resolve;});
        const acquired=new Promise(resolve=>{locked=resolve;});
        const blocker=db.$transaction(async tx=>{
          await tx.$queryRawUnsafe('SELECT id FROM "LiveMetricPlaybackIntake" WHERE id=$1 FOR UPDATE',waitingSource.metricRequestId);
          locked();await release;
        },{timeout:5000,maxWait:5000});
        let waiting;
        try{
          await acquired;
          waiting=issue(waitingSource.metricRequestId,expiredIdentity).then(()=>({code:'UNEXPECTED_SUCCESS'}),error=>({code:error.code}));
          let observedWait=false;
          for(let attempt=0;attempt<40;attempt++){
            const [state]=await db.$queryRawUnsafe(`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname=current_database()
              AND wait_event_type='Lock' AND query LIKE '%LiveMetricPlaybackIntake%'`);
            if(state.waiting>0){observedWait=true;break;}
            await new Promise(resolve=>setTimeout(resolve,10));
          }
          assert.equal(observedWait,true);
          await db.$executeRawUnsafe('DO $$ BEGIN PERFORM pg_sleep(1.1); END $$');
        }finally{unlock();await blocker;}
        assert.equal((await waiting).code,'evidence_rejected');
        const [afterWait]=await db.$queryRawUnsafe('SELECT i."renewalCount",s."expiresAt" FROM "LiveMetricPlaybackIntake" i JOIN "LiveMetricSession" s ON s."intakeId"=i.id WHERE s.id=$1',waitingSession.sessionId);
        assert.equal(afterWait.renewalCount,BigInt(0));assert.equal(+afterWait.expiresAt,waitingSession.expiresAtMs);
        receipt.checks.renewalWaitingAcrossOldExpiryRollsBack='PASS';
        receipt.stage='database-session-renewal-guards';
        await db.$executeRawUnsafe(`UPDATE "LiveViewerSession" SET "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '120 seconds' WHERE id=$1`,admission.id);
        const [unbound]=await db.$queryRawUnsafe(`SELECT i.id FROM "LiveMetricPlaybackIntake" i
          WHERE i."admissionSessionId"=$1 AND NOT EXISTS(SELECT 1 FROM "LiveMetricSession" s WHERE s."intakeId"=i.id) LIMIT 1`,admission.id);
        assert.ok(unbound);
        for(const intake of [unbound.id,lastSource.metricRequestId]){
          await assert.rejects(db.$executeRawUnsafe(`UPDATE "LiveMetricPlaybackIntake" SET "expiresAt"="expiresAt"+interval '1 second' WHERE id=$1`,intake),error=>error?.meta?.code==='23514');
        }
        await assert.rejects(db.$executeRawUnsafe(`UPDATE "LiveMetricSession" SET "expiresAt"="expiresAt"-interval '1 millisecond' WHERE id=$1`,lastBrowserReceipt.sessionId),error=>error?.meta?.code==='23514');
        await assert.rejects(db.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "closedAt"=NULL WHERE id=$1',lastBrowserReceipt.sessionId),error=>error?.meta?.code==='23514');
        await assert.rejects(db.$executeRawUnsafe(`UPDATE "LiveMetricSession" SET "expiresAt"="expiresAt"-interval '1 millisecond' WHERE id=$1`,session.sessionId),error=>error?.meta?.code==='23514');
        // Deliberately renew only the intake, creating a legitimate longer
        // bound against which an expired session's raw UPDATE must still fail.
        await db.$executeRawUnsafe(`UPDATE "LiveViewerSession" SET "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 second' WHERE id=$1`,other.id);
        const splitSource=await service.resolveTrackedLivePlaybackSource(db,{...scope,token:'q'.repeat(43)});
        const splitSession=await issue(splitSource.metricRequestId,expiredIdentity);
        await db.$executeRawUnsafe(`UPDATE "LiveViewerSession" SET "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '90 seconds' WHERE id=$1`,other.id);
        await db.$executeRawUnsafe(`UPDATE "LiveMetricPlaybackIntake" SET "expiresAt"=clock_timestamp()+interval '30 seconds' WHERE id=$1`,splitSource.metricRequestId);
        await db.$executeRawUnsafe('DO $$ BEGIN PERFORM pg_sleep(1.1); END $$');
        await assert.rejects(db.$executeRawUnsafe(`UPDATE "LiveMetricSession" SET "expiresAt"=clock_timestamp()+interval '10 seconds' WHERE id=$1`,splitSession.sessionId),error=>error?.meta?.code==='23514');
        const [split]=await db.$queryRawUnsafe('SELECT i."renewalCount",s."expiresAt" FROM "LiveMetricPlaybackIntake" i JOIN "LiveMetricSession" s ON s."intakeId"=i.id WHERE s.id=$1',splitSession.sessionId);
        assert.equal(split.renewalCount,BigInt(1));assert.equal(+split.expiresAt,splitSession.expiresAtMs);
        receipt.checks.databaseRejectsUnboundClosedExpiredAndShortenedLeases='PASS';
        receipt.checks.existingSessionGuardRejectsReopeningClosedSession='PASS';
        receipt.stage='concurrent-canonical-renewals';
        const concurrentSource=await service.resolveTrackedLivePlaybackSource(db,{...scope,token:'q'.repeat(43)});
        const concurrentOriginal=await issue(concurrentSource.metricRequestId,expiredIdentity);
        await db.$executeRawUnsafe(`UPDATE "LiveViewerSession" SET "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '120 seconds' WHERE id=$1`,other.id);
        const concurrent=await Promise.all([issue(concurrentSource.metricRequestId,expiredIdentity),issue(concurrentSource.metricRequestId,expiredIdentity)]);
        assert.equal(concurrent[0].sessionId,concurrentOriginal.sessionId);assert.deepEqual(concurrent[0],concurrent[1]);
        assert.equal(concurrent[0].anchorAtMs,concurrentOriginal.anchorAtMs);assert.ok(concurrent[0].expiresAtMs>concurrentOriginal.expiresAtMs);
        const [concurrentCounter]=await db.$queryRawUnsafe('SELECT "renewalCount" FROM "LiveMetricPlaybackIntake" WHERE id=$1',concurrentSource.metricRequestId);
        assert.equal(concurrentCounter.renewalCount,BigInt(1));
        receipt.checks.concurrentCanonicalRenewalsSerializeAndExtendOnlyOnce='PASS';
      }
      receipt.stage = 'retention';
      const retainedRevision=await revision();
      await db.$executeRawUnsafe('DELETE FROM "LiveViewerSession" WHERE id=$1', admission.id);
      assert.equal(await revision(), retainedRevision);
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricVersion" WHERE id=$1', 'playback-intake-version');
      const [remaining] = await db.$queryRawUnsafe('SELECT count(*) AS count FROM "LiveMetricPlaybackIntake"'); assert.equal(remaining.count, BigInt(0));
      receipt.checks.admissionDeletionRetainsIntakeVersionCascadeCleans = 'PASS';
      receipt.status = 'PASS'; receipt.stage = 'complete';
    } catch (error) {
      receipt.errorType=['AssertionError','MetricIngestError','TypeError','PrismaClientKnownRequestError'].includes(error?.name)?error.name:'OTHER';
      receipt.differingKeys=error?.actual&&error?.expected&&typeof error.actual==='object'&&typeof error.expected==='object'?{actual:Object.keys(error.actual),expected:Object.keys(error.expected)}:null;
      receipt.errorCode = /^(?:P[0-9]{4}|[0-9A-Z]{5})$/.test(error?.meta?.code ?? error?.code ?? '') ? (error.meta?.code ?? error.code) : 'ASSERTION_OR_SERVICE_ERROR';
      throw new Error('playback-intake-check-failed');
    } finally { await db.$disconnect(); }
  } });
} catch { receipt.errorCode ??= 'RUNNER_ERROR'; }
receipt.cleanup = migration?.cleanup ?? 'UNKNOWN'; if (migration?.status !== 'PASS') receipt.status = 'FAIL';
fs.writeFileSync(output, JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt)); process.exitCode = receipt.status === 'PASS' ? 0 : 1;
