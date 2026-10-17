import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { main } from './prisma-loopback-disposable-migration-runner.mjs';

const require = createRequire(import.meta.url);
const queueMode=process.argv.includes('--queue');
const output = `docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/report-${queueMode?'queue':'scheduler'}-db.json`;
const receipt = { status: 'FAIL', stage: 'start', scope: 'Private scoped scheduler with real isolated worker; synthetic disposable database only', results: {} };
if(queueMode)receipt.sourceHashes=Object.fromEntries(['src/lib/live-metric-report-queue.ts','prisma/migrations/20261016100000_live_metric_report_queue_window/migration.sql']
  .map(file=>[file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
let migration;
try {
  const envPaths = JSON.parse(fs.readFileSync('node_modules/.prisma/client/index.js', 'utf8').match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1] ?? 'null');
  assert.ok(envPaths && Object.values(envPaths).every(value => value === null));
  const { PrismaClient } = require('@prisma/client');
  migration = await main({ afterMigrate: async ({ databaseUrl, tempRoot }) => {
    const url = new URL(databaseUrl);
    assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/celebratedeal_test');
    const db = new PrismaClient({ datasourceUrl: databaseUrl });
    try {
      const [marker] = await db.$queryRawUnsafe("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
      assert.match(marker.marker, /^prisma-no-dotenv:[a-f0-9]{16}$/u);
      const built = await build({ stdin: { contents: 'export {enqueueMetricReport} from "./src/lib/live-metric-report-queue.ts"; export {runMetricReportSchedulerTick} from "./src/lib/live-metric-report-scheduler.ts"; export {claimMetricReport,finishMetricReport} from "./src/lib/live-metric-report-lease.ts"; export {createMetricExecutor,createCompletionExecutor} from "./src/lib/live-metric-executor.ts";', resolveDir: process.cwd(), loader: 'ts' },
        bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, logLevel: 'silent' });
      const compiled = { exports: {} };
      new Function('require', 'module', 'exports', built.outputFiles[0].text)(require, compiled, compiled.exports);
      const service = compiled.exports;
      const artifact = path.join(tempRoot, 'scheduler-worker.cjs');
      await build({ entryPoints: ['src/lib/live-metric-worker.ts'], outfile: artifact, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
      const worker = service.createMetricExecutor(pathToFileURL(artifact)), project = service.createCompletionExecutor(pathToFileURL(artifact));
      let executions = 0;
      const execute = async input => { executions++; return worker(input); };
      receipt.stage = 'fixtures';
      const vendor = await db.vendor.create({ data: { name: 'Synthetic scheduler', slug: 'metric-scheduler', email: 'scheduler@example.test', passwordHash: 'synthetic-unused' } });
      const video = await db.video.create({ data: { vendorId: vendor.id, title: 'Synthetic', videoUrl: 'https://example.test/synthetic.mp4', durationSec: 100 } });
      const [clock] = await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
      const start = new Date(+clock.now - 10000), end = new Date(+clock.now - 1000), expires = new Date(+clock.now + 3600000);
      const live = await db.live.create({ data: { vendorId: vendor.id, videoId: video.id, title: 'Synthetic', slug: 'metric-scheduler', scheduledAt: start } });
      for (const [version, fingerprint] of [['scheduler-version', 'a'], ['scheduler-foreign-version', 'b']]) {
        await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt") VALUES ($1,$2,$3,$4,'replay',$5,100000,true,$6,$7)`,
          version, vendor.id, live.id, video.id, fingerprint.repeat(64), start, expires);
      }
      const scope = { vendorId: vendor.id, liveId: live.id, versionId: 'scheduler-version' };
      let windowOffset = 0;
      const create = async (id, version = scope.versionId, until = expires, windowEnd = end) => {
        const [v] = await db.$queryRawUnsafe('SELECT "sourceRevision" FROM "LiveMetricVersion" WHERE id=$1', version);
        await db.$queryRawUnsafe('SELECT public.wp20_metric_report_create($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7::bigint,$8::timestamptz)', vendor.id, live.id, version, id, new Date(+start + windowOffset++), windowEnd, v.sourceRevision, until);
      };
      await create('scheduler-one'); await create('scheduler-two'); await create('scheduler-active'); await create('scheduler-foreign', 'scheduler-foreign-version');
      assert.equal(await service.claimMetricReport(db, { ...scope, reportId: 'scheduler-active', workerId: 'synthetic-existing-worker' }), true);
      receipt.stage = 'bounded-ticks';
      const first = await service.runMetricReportSchedulerTick(db, scope, execute, project);
      assert.equal(first.status, 'processed'); assert.equal(first.selected, 1); assert.equal(first.outcomes.recorded, 1);
      receipt.results.defaultOneJobBound = 'PASS';
      const second = await service.runMetricReportSchedulerTick(db, scope, execute, project, { jobs: 4 });
      assert.equal(second.selected, 1); assert.equal(second.outcomes.recorded, 1);
      receipt.results.remainingQueueProcessed = 'PASS';
      const idle = await service.runMetricReportSchedulerTick(db, scope, execute, project, { jobs: 4 });
      assert.equal(idle.selected, 0); assert.equal(idle.attempted, 0); assert.equal(executions, 2);
      receipt.results.duplicateTickNoExecution = 'PASS';
      receipt.results.realWorker = 'PASS';
      const rows = await db.$queryRawUnsafe('SELECT id,status,result,attempts FROM "LiveMetricReport" ORDER BY id');
      for (const id of ['scheduler-one', 'scheduler-two']) {
        const row = rows.find(value => value.id === id);
        assert.equal(row.status, 'ready'); assert.equal(row.attempts, 1);
        for (const key of ['registrationRate', 'attendanceRate', 'completionRate', 'averageViewingSeconds', 'postCompletionOrderRate'])
          assert.deepEqual(row.result[key], { status: 'unavailable', reason: 'missing_data' });
      }
      receipt.results.unknownRemainsUnavailable = 'PASS';
      assert.equal(rows.find(row => row.id === 'scheduler-active').status, 'running');
      receipt.results.activeLeaseExcluded = 'PASS';
      assert.equal(rows.find(row => row.id === 'scheduler-foreign').status, 'queued');
      receipt.results.foreignVersionExcluded = 'PASS';
      receipt.stage = 'competing-ticks';
      await create('scheduler-race');
      let selections = 0, release, barrierTimer;
      const bothSelected = new Promise((resolve, reject) => {
        release = () => { clearTimeout(barrierTimer); resolve(); };
        barrierTimer = setTimeout(() => reject(new Error('synthetic selection barrier timeout')), 10000);
        barrierTimer.unref();
      });
      // Wait outside each committed selection transaction, so both schedulers
      // definitely hold the same candidate before either can enter claim.
      const racingDb = { $queryRaw: db.$queryRaw.bind(db), $transaction: async (read, options) => {
        const result = await db.$transaction(read, options);
        if (Array.isArray(result) && result.some(row => row.id === 'scheduler-race')) {
          if (++selections === 2) release();
          await bothSelected;
        }
        return result;
      } };
      const race = await Promise.all([service.runMetricReportSchedulerTick(racingDb, scope, execute, project), service.runMetricReportSchedulerTick(racingDb, scope, execute, project)]);
      assert.deepEqual(race.map(value => value.selected), [1, 1]);
      assert.equal(race.reduce((sum, value) => sum + value.outcomes.not_claimed, 0), 1);
      assert.equal(race.reduce((sum, value) => sum + (value.outcomes?.recorded ?? 0), 0), 1);
      assert.equal(executions, 3);
      const [recorded] = await db.$queryRawUnsafe('SELECT status,attempts FROM "LiveMetricReport" WHERE id=$1', 'scheduler-race');
      assert.equal(recorded.status, 'ready'); assert.equal(recorded.attempts, 1);
      receipt.results.barrierCompetingTicksExactlyOneExecution = 'PASS';
      receipt.stage = 'lease-recovery-and-cap';
      const shortClaim = async (reportId, workerId) => {
        const [result] = await db.$queryRawUnsafe(`SELECT public.wp20_metric_report_claim($1,$2,$3,$4,$5,date_trunc('milliseconds',clock_timestamp())+INTERVAL '100 milliseconds') AS changed`, scope.vendorId, scope.liveId, scope.versionId, reportId, workerId);
        assert.equal(result.changed, 1);
        await db.$queryRawUnsafe('SELECT pg_sleep(0.12)::text');
      };
      await create('scheduler-recover'); await shortClaim('scheduler-recover', 'expired-worker');
      assert.equal((await service.runMetricReportSchedulerTick(db, scope, execute, project)).outcomes.recorded, 1);
      const [recovered] = await db.$queryRawUnsafe('SELECT status,attempts FROM "LiveMetricReport" WHERE id=$1', 'scheduler-recover');
      assert.equal(recovered.status, 'ready'); assert.equal(recovered.attempts, 2);
      assert.equal(await service.finishMetricReport(db, { ...scope, reportId: 'scheduler-recover', workerId: 'expired-worker' }, rows.find(row => row.id === 'scheduler-one').result), false);
      receipt.results.expiredLeaseRecoveredOldFinishRejected = 'PASS';
      await create('scheduler-exhausted');
      for (let attempt = 0; attempt < 5; attempt++) await shortClaim('scheduler-exhausted', `synthetic-attempt-${attempt}`);
      await create('scheduler-behind-exhausted');
      const beforeCap = executions;
      const cap = await service.runMetricReportSchedulerTick(db, scope, execute, project);
      assert.equal(cap.outcomes.not_claimed, 1); assert.equal(executions, beforeCap);
      const [exhausted] = await db.$queryRawUnsafe('SELECT status,attempts,"errorCode" FROM "LiveMetricReport" WHERE id=$1', 'scheduler-exhausted');
      assert.equal(exhausted.status, 'failed'); assert.equal(exhausted.attempts, 5); assert.equal(exhausted.errorCode, 'attempt_limit');
      assert.equal((await service.runMetricReportSchedulerTick(db, scope, execute, project)).outcomes.recorded, 1);
      assert.equal(executions, beforeCap + 1);
      receipt.results.exhaustedHeadTerminalizedNextTickProgresses = 'PASS';
      receipt.stage = 'eligibility';
      await assert.rejects(create('scheduler-future-window', scope.versionId, expires, new Date(+clock.now + 60000)), error => error?.meta?.code === '23514');
      receipt.results.futureWindowRejectedByCreateGuard = 'PASS';
      const [fresh] = await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
      const shortExpiry = new Date(+fresh.now + 1000);
      await create('scheduler-expired-report', scope.versionId, shortExpiry);
      await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt") VALUES ('scheduler-expired-version',$1,$2,$3,'replay',$4,100000,true,$5,$6)`, vendor.id, live.id, video.id, 'c'.repeat(64), start, shortExpiry);
      await create('scheduler-expired-version-report', 'scheduler-expired-version', shortExpiry);
      await db.$queryRawUnsafe('SELECT pg_sleep(1.05)::text');
      assert.equal((await service.runMetricReportSchedulerTick(db, scope, execute, project)).selected, 0);
      assert.equal((await service.runMetricReportSchedulerTick(db, { ...scope, versionId: 'scheduler-expired-version' }, execute, project)).selected, 0);
      receipt.results.expiredReportAndVersionExcluded = 'PASS';
      const other = await db.vendor.create({ data: { name: 'Synthetic other tenant', slug: 'metric-other-tenant', email: 'other@example.test', passwordHash: 'synthetic-unused' } });
      const otherVideo = await db.video.create({ data: { vendorId: other.id, title: 'Synthetic', videoUrl: 'https://example.test/other.mp4', durationSec: 100 } });
      const otherLive = await db.live.create({ data: { vendorId: other.id, videoId: otherVideo.id, title: 'Synthetic', slug: 'metric-other-tenant', scheduledAt: start } });
      await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt") VALUES ('scheduler-other-tenant-version',$1,$2,$3,'replay',$4,100000,true,$5,$6)`, other.id, otherLive.id, otherVideo.id, 'd'.repeat(64), start, expires);
      const [otherVersion] = await db.$queryRawUnsafe('SELECT "sourceRevision" FROM "LiveMetricVersion" WHERE id=$1', 'scheduler-other-tenant-version');
      await db.$queryRawUnsafe('SELECT public.wp20_metric_report_create($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7::bigint,$8::timestamptz)', other.id, otherLive.id, 'scheduler-other-tenant-version', 'scheduler-other-tenant-report', start, end, otherVersion.sourceRevision, expires);
      for (const mixed of [{ ...scope, vendorId: other.id }, { ...scope, liveId: otherLive.id }, { vendorId: vendor.id, liveId: otherLive.id, versionId: 'scheduler-other-tenant-version' }])
        assert.equal((await service.runMetricReportSchedulerTick(db, mixed, execute, project)).selected, 0);
      const [untouched] = await db.$queryRawUnsafe('SELECT status,attempts FROM "LiveMetricReport" WHERE id=$1', 'scheduler-other-tenant-report');
      assert.equal(untouched.status, 'queued'); assert.equal(untouched.attempts, 0);
      receipt.results.realForeignTenantMixedScopesExcluded = 'PASS';
      if(queueMode){
        receipt.stage='queue-function-catalog';
        const definitions=await db.$queryRawUnsafe(`SELECT p.prosecdef,
          EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS "publicExecute",
          p.oid='public.wp20_metric_report_create(text,text,text,text,timestamptz,timestamptz,bigint,timestamptz)'::regprocedure AS "exactSignature",
          pg_get_functiondef(p.oid) AS definition
          FROM pg_proc p WHERE p.proname='wp20_metric_report_create' AND p.pronamespace='public'::regnamespace`);
        assert.equal(definitions.length,1);assert.equal(definitions[0].prosecdef,false);
        assert.equal(definitions[0].publicExecute,false);assert.equal(definitions[0].exactSignature,true);
        assert.match(definitions[0].definition,/"windowStartAt"\s*=\s*window_start/u);
        assert.match(definitions[0].definition,/"windowEndAt"\s*=\s*window_end/u);
        receipt.results.exactSingleInvokerSignatureRevokedPublicAclAndWindowBody='PASS';
        receipt.stage='queue-window-isolation';
        const windowA={...scope,startAt:new Date(+start+1000),endAt:new Date(+start+4000)};
        const windowB={...scope,startAt:new Date(+start+5000),endAt:new Date(+start+8000)};
        const order=await db.commerceOrder.create({data:{vendorId:vendor.id,orderNumber:'synthetic-queue',
          checkoutIdempotencyKey:'synthetic-queue',checkoutIdentityHash:'a'.repeat(43),status:'pending_payment',
          subtotalAmountCents:100,totalAmountCents:100,buyerEncryptedEnvelope:'synthetic-unused',
          buyerMaskedName:'Synthetic',buyerMaskedEmail:'queue@example.test',isTestOrder:true,createdAt:new Date(+start+2000)}});
        const [rev]=await db.$queryRawUnsafe('SELECT "sourceRevision" FROM "LiveMetricVersion" WHERE id=$1',scope.versionId);
        const original=fs.readFileSync('prisma/migrations/20261016020000_live_metric_order_window_binding/migration.sql','utf8');
        const oldCreate=original.slice(original.indexOf('CREATE OR REPLACE FUNCTION public.wp20_metric_report_create('),original.indexOf('CREATE OR REPLACE FUNCTION public.wp20_metric_report_claim('));
        const rollback=new Error('synthetic rollback');
        try{await db.$transaction(async tx=>{
          // Transactional DDL reproduces the old bug, then rolls it back along
          // with synthetic reports. No product constraint is disabled.
          await tx.$executeRawUnsafe(oldCreate);
          for(const [id,w] of [['queue-old-a',windowA],['queue-old-b',windowB]])
            await tx.$queryRawUnsafe('SELECT public.wp20_metric_report_create($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7::bigint,$8::timestamptz)',scope.vendorId,scope.liveId,scope.versionId,id,w.startAt,w.endAt,rev.sourceRevision,expires);
          const [row]=await tx.$queryRawUnsafe('SELECT status FROM "LiveMetricReport" WHERE id=$1','queue-old-a');
          assert.equal(row.status,'stale');throw rollback;
        });}catch(error){if(error!==rollback)throw error;}
        receipt.results.originalCrossWindowInvalidationReproducedAndRolledBack='PASS';
        assert.deepEqual(await service.enqueueMetricReport(db,windowA),{status:'available',created:true});
        assert.deepEqual(await service.enqueueMetricReport(db,windowB),{status:'available',created:true});
        const queryWindow=async w=>db.$queryRawUnsafe('SELECT id,status,attempts FROM "LiveMetricReport" WHERE "vendorId"=$1 AND "liveId"=$2 AND "versionId"=$3 AND "windowStartAt"=$4 AND "windowEndAt"=$5 ORDER BY "createdAt",id',scope.vendorId,scope.liveId,scope.versionId,w.startAt,w.endAt);
        assert.deepEqual((await queryWindow(windowA)).map(row=>row.status),['queued']);
        assert.deepEqual((await queryWindow(windowB)).map(row=>row.status),['queued']);
        receipt.results.differentWindowRevisionsRemainIndependent='PASS';
        const same=await Promise.all(Array.from({length:8},()=>service.enqueueMetricReport(db,windowA)));
        assert.ok(same.every(row=>row.status==='available'&&!row.created));assert.equal((await queryWindow(windowA)).length,1);
        const third={...scope,startAt:new Date(+start+1001),endAt:new Date(+start+4001)};
        const race=await Promise.all(Array.from({length:8},()=>service.enqueueMetricReport(db,third)));
        assert.equal(race.filter(row=>row.status==='available'&&row.created).length,1);
        assert.equal(race.filter(row=>row.status==='available').length,8);assert.equal((await queryWindow(third)).length,1);
        receipt.results.concurrentEnqueueCreatesExactlyOneGeneration='PASS';
        const processed=await service.runMetricReportSchedulerTick(db,scope,execute,project,{jobs:4});
        assert.equal(processed.outcomes.recorded,3);
        assert.deepEqual(await service.enqueueMetricReport(db,windowA),{status:'available',created:false});
        assert.deepEqual(await service.enqueueMetricReport(db,windowB),{status:'available',created:false});
        await db.commerceOrder.update({where:{id:order.id},data:{status:'cancelled'}});
        assert.deepEqual(await service.enqueueMetricReport(db,windowA),{status:'available',created:true});
        assert.deepEqual((await queryWindow(windowA)).map(row=>row.status).sort(),['queued','stale']);
        assert.deepEqual((await queryWindow(windowB)).map(row=>row.status),['ready']);
        receipt.results.changedWindowReplacedWithoutInvalidatingOtherReadyWindow='PASS';
        receipt.stage='queue-attempt-cap';
        const failed={...scope,startAt:new Date(+start+5001),endAt:new Date(+start+8001)};
        assert.equal((await service.enqueueMetricReport(db,failed)).created,true);
        const [failedRow]=await queryWindow(failed);
        // Exhaust exactly the existing five-attempt cap, expiring only the
        // synthetic lease between claims. A later enqueue must not reset it.
        for(let index=0;index<5;index++){
          const [claimed]=await db.$queryRawUnsafe(`SELECT public.wp20_metric_report_claim($1,$2,$3,$4,$5,clock_timestamp()+interval '50 milliseconds') AS changed`,
            scope.vendorId,scope.liveId,scope.versionId,failedRow.id,'synthetic-failure');
          assert.equal(claimed.changed,1);
          await db.$executeRawUnsafe("DO $$ BEGIN PERFORM pg_sleep(0.06); END $$");
        }
        assert.equal(await service.claimMetricReport(db,{...scope,reportId:failedRow.id,workerId:'synthetic-failure'}),false);
        assert.deepEqual(await service.enqueueMetricReport(db,failed),{status:'unavailable',reason:'previous_failure'});
        assert.equal((await queryWindow(failed)).length,1);receipt.results.failedGenerationDoesNotResetAttemptCap='PASS';
        receipt.stage='queue-non-utc';
        const [types]=await db.$queryRawUnsafe(`SELECT bool_and(data_type='timestamp with time zone') AS correct FROM information_schema.columns
          WHERE table_schema='public' AND ((table_name='LiveMetricReport' AND column_name IN ('windowStartAt','windowEndAt'))
            OR (table_name='LiveMetricVersion' AND column_name='collectionStartedAt'))`);
        assert.equal(types.correct,true);
        const nonUtcDb={$transaction:(work,options)=>db.$transaction(async tx=>{
          await tx.$queryRawUnsafe("SELECT set_config('TimeZone','America/New_York',true)");
          const result=await work(tx);const [zone]=await tx.$queryRawUnsafe("SELECT current_setting('TimeZone') AS zone");
          assert.equal(zone.zone,'UTC');return result;
        },options)};
        assert.deepEqual(await service.enqueueMetricReport(nonUtcDb,failed),{status:'unavailable',reason:'previous_failure'});
        assert.deepEqual(await service.enqueueMetricReport(nonUtcDb,windowB),{status:'available',created:false});
        assert.equal((await queryWindow(failed)).length,1);assert.equal((await queryWindow(windowB)).length,1);
        receipt.results.nonUtcFailedAndReadyGenerationParity='PASS';
        receipt.stage='queue-scope-denial';
        for(const bad of [{...windowA,vendorId:other.id},{...windowA,endAt:new Date(+expires+1)},
          {...windowA,endAt:new Date(+clock.now+60000)},{...windowA,startAt:new Date(+start-1)}])
          assert.deepEqual(await service.enqueueMetricReport(db,bad),{status:'unavailable',reason:'scope_or_window_unavailable'});
        receipt.results.foreignFutureAndPreCollectionQueueInputsDenied='PASS';
      }
      receipt.stage = 'complete'; receipt.status = 'PASS';
    } catch(error) {
      receipt.errorType=error?.name;
      receipt.errorCode=/^(?:P[0-9]{4}|[0-9A-Z]{5})$/.test(error?.meta?.code??error?.code??'')?(error.meta?.code??error.code):'ASSERTION_OR_RUNNER_ERROR';
      if(['number','boolean'].includes(typeof error?.actual)&&['number','boolean'].includes(typeof error?.expected))receipt.assertion={actual:error.actual,expected:error.expected};
      throw new Error('scheduler-check-failed');
    } finally { await db.$disconnect(); }
  } });
} catch (error) {
  receipt.errorCode = /^(?:P[0-9]{4}|[0-9A-Z]{5})$/.test(error?.meta?.code ?? error?.code ?? '') ? (error.meta?.code ?? error.code) : 'ASSERTION_OR_RUNNER_ERROR';
}
receipt.cleanup = migration?.cleanup ?? 'UNKNOWN';
receipt.migrationCount=migration?.migrationNames?.length??null;
if (migration?.status !== 'PASS') receipt.status = 'FAIL';
fs.writeFileSync(output, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
process.exitCode = receipt.status === 'PASS' ? 0 : 1;
