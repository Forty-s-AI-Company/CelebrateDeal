import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { createServer, request as httpRequest } from 'node:http';
import { main } from './prisma-loopback-disposable-migration-runner.mjs';

const require = createRequire(import.meta.url), base = 'docs/ai-team/evidence/product-audit-20261011/WP-20/coverage';
const files = ['prisma/schema.prisma', 'prisma/migrations/20261016150000_live_metric_ingress_census/migration.sql', 'src/lib/live-metric-ingress.ts', 'src/lib/live-metric-ingress-gateway.ts', 'scripts/wp20-ingress-disposable.mjs'];
const receipt = { status: 'FAIL', stage: 'start', checks: {}, sourceHashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')])) };
try {
  const paths = JSON.parse(fs.readFileSync('node_modules/.prisma/client/index.js', 'utf8').match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1] ?? 'null');
  assert.ok(paths && Object.values(paths).every(value => value === null));
  const { PrismaClient } = require('@prisma/client');
  const bundle = await build({ stdin: { contents: 'export * from "./src/lib/live-metric-ingress.ts";export * from "./src/lib/live-metric-ingress-gateway.ts";export {issueMetricVisitPage} from "./src/lib/live-metric-visit-page.ts";export {metricVideoFingerprint} from "./src/lib/live-metric-version.ts";', resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, logLevel: 'silent' });
  const compiled = { exports: {} }; new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, compiled, compiled.exports);
  const service = compiled.exports;
  const migration = await main({ afterMigrate: async ({ databaseUrl }) => {
    const url = new URL(databaseUrl); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/celebratedeal_test');
    const db = new PrismaClient({ datasourceUrl: databaseUrl, log: [] });
    try {
      const [marker] = await db.$queryRawUnsafe("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
      assert.match(marker.marker, /^prisma-no-dotenv:[a-f0-9]{16}$/u);
      receipt.stage = 'seed';
      const vendor = await db.vendor.create({ data: { name: 'Synthetic ingress', slug: 'ingress', email: 'ingress@example.test', passwordHash: 'synthetic-unused' } });
      const video = await db.video.create({ data: { vendorId: vendor.id, title: 'Synthetic', videoUrl: 'https://example.test/synthetic.mp4', durationSec: 100, sourceType: 'url', status: 'ready' } });
      const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: 'Synthetic', slug: 'ingress', headline: 'Synthetic', fields: [
        { key: 'name', label: 'Synthetic name', type: 'text', required: true }, { key: 'email', label: 'Synthetic email', type: 'email', required: true },
      ] } });
      const template = await db.messageTemplate.create({ data: { vendorId: vendor.id, name: 'Synthetic', channel: 'email', trigger: 'registration_confirmed', subject: 'Synthetic', body: 'Synthetic confirmation', isActive: true } });
      let serial = 0;
      async function fresh() {
        const n = ++serial, [clock] = await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
        const expiresAt = new Date(+clock.now + 3600000);
        const live = await db.live.create({ data: { vendorId: vendor.id, videoId: video.id, formId: form.id, messageTemplateId: template.id, title: 'Synthetic', slug: `ingress-${n}`, status: 'ended', scheduledAt: new Date(+clock.now - 200000), startedAt: new Date(+clock.now - 200000), endedAt: new Date(+clock.now - 100000), replayEnabled: true, replayAvailableUntil: expiresAt } });
        const scope = { vendorId: vendor.id, liveId: live.id, versionId: `ingress-${n}` };
        await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt") VALUES ($1,$2,$3,$4,'replay',$5,100000,true,$6,$7)`, scope.versionId, vendor.id, live.id, video.id, service.metricVideoFingerprint(video), clock.now, expiresAt);
        return scope;
      }
      const scope = await fresh(), manifest = 'a'.repeat(64);
      receipt.stage = 'open-and-retain';
      const opened = await service.openMetricIngressRun(db, scope, manifest, 2);
      const run = { ...scope, runId: opened.runId };
      const frame = await service.admitMetricIngress(db, run, 'form');
      const frameKey = { ...run, frameId: frame.frameId };
      const [pending] = await db.$queryRawUnsafe('SELECT outcome,"httpStatus","settledAt" FROM "LiveMetricIngressFrame" WHERE id=$1', frame.frameId);
      assert.deepEqual(pending, { outcome: 'pending', httpStatus: null, settledAt: null });
      assert.ok(frame.admittedAt >= opened.openedAt);
      receipt.checks.committedAdmissionRemainsPendingWithoutBrowserOrResponse = 'PASS';
      await assert.rejects(service.openMetricIngressRun(db, scope, manifest), error => error?.meta?.code === '23505');
      await assert.rejects(service.admitMetricIngress(db, { ...run, vendorId: 'foreign' }, 'form'), error => error?.meta?.code === '23514');
      receipt.checks.oneRunPerVersionAndForeignScopeRejected = 'PASS';
      receipt.stage = 'concurrent-capacity';
      const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => service.admitMetricIngress(db, run, 'viewer')));
      assert.equal(attempts.filter(value => value.status === 'fulfilled').length, 1);
      const [count] = await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "LiveMetricIngressFrame" WHERE "runId"=$1', run.runId);
      assert.equal(count.count, 2);
      receipt.checks.eightConcurrentLastSlotAdmissionsExactlyOneCommitted = 'PASS';
      receipt.stage = 'stop-with-pending';
      const stopped = await service.stopMetricIngressRun(db, run);
      assert.deepEqual(await service.stopMetricIngressRun(db, run), stopped);
      await assert.rejects(service.admitMetricIngress(db, run, 'form'));
      await service.settleMetricIngress(db, frameKey, { outcome: 'responded', httpStatus: 200 });
      await assert.rejects(service.settleMetricIngress(db, frameKey, { outcome: 'interrupted' }));
      const [remaining] = await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "LiveMetricIngressFrame" WHERE "runId"=$1 AND outcome=\'pending\'', run.runId);
      assert.equal(remaining.count, 1);
      receipt.checks.stopClosesAdmissionIdempotentlyButRetainsPendingAndAllowsLateSettlement = 'PASS';
      receipt.stage = 'immutability';
      for (const sql of [
        `UPDATE "LiveMetricIngressRun" SET "stoppedAt"=NULL`,
        `UPDATE "LiveMetricIngressRun" SET "admissionLimit"=10000`,
        `UPDATE "LiveMetricIngressFrame" SET "routeKind"='playback'`,
        `UPDATE "LiveMetricIngressFrame" SET outcome='responded',"httpStatus"=NULL WHERE outcome='pending'`,
        `DELETE FROM "LiveMetricIngressFrame"`, `TRUNCATE "LiveMetricIngressFrame"`, `DELETE FROM "LiveMetricIngressRun"`, `TRUNCATE "LiveMetricIngressRun" CASCADE`,
      ]) await assert.rejects(db.$executeRawUnsafe(sql), error => error?.meta?.code === '23514');
      receipt.checks.noReopenMutationDeleteTruncateOrNullStatusSettlement = 'PASS';
      receipt.stage = 'primary-read-committed';
      const other = await fresh();
      await assert.rejects(db.$transaction(tx => tx.$executeRawUnsafe(`INSERT INTO "LiveMetricIngressRun" (id,"vendorId","liveId","versionId","manifestHash","admissionLimit") VALUES ($1,$2,$3,$4,$5,5)`, randomUUID(), other.vendorId, other.liveId, other.versionId, manifest), { isolationLevel: 'RepeatableRead' }), error => error?.meta?.code === '23514');
      receipt.checks.repeatableReadAdmissionRejected = 'PASS';
      receipt.stage = 'history-and-marker';
      await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVisitor" (id,"vendorId","liveId","versionId","browserHash","firstVisitedAt") VALUES ('prior-browser',$1,$2,$3,$4,clock_timestamp())`, other.vendorId, other.liveId, other.versionId, 'b'.repeat(64));
      await assert.rejects(service.openMetricIngressRun(db, other, manifest), error => error?.meta?.code === '23514');
      receipt.checks.existingSourceHistoryCannotBeRetroactivelyCensused = 'PASS';
      const rendered = await fresh();
      assert.ok(await service.issueMetricVisitPage(db, { vendorId: rendered.vendorId, liveId: rendered.liveId }, { kind: 'viewer' }));
      await assert.rejects(service.openMetricIngressRun(db, rendered, manifest), error => error?.meta?.code === '23514');
      receipt.checks.actualExistingServerPageCannotBeRetroactivelyCensused = 'PASS';
      const unmarked = await fresh();
      await db.$executeRawUnsafe('COMMENT ON DATABASE celebratedeal_test IS NULL');
      try { await assert.rejects(service.openMetricIngressRun(db, unmarked, manifest), error => error?.meta?.code === '23514'); }
      finally { assert.match(marker.marker, /^prisma-no-dotenv:[a-f0-9]{16}$/u); await db.$executeRawUnsafe(`COMMENT ON DATABASE celebratedeal_test IS '${marker.marker}'`); }
      receipt.checks.unmarkedDatabaseCannotOpenIngress = 'PASS';
      receipt.stage = 'stop-race';
      const racing = await fresh(), raceOpen = await service.openMetricIngressRun(db, racing, manifest, 8), race = { ...racing, runId: raceOpen.runId };
      let queued;
      await db.$transaction(async tx => {
        await tx.$queryRawUnsafe('SELECT id FROM "LiveMetricIngressRun" WHERE id=$1 FOR UPDATE', race.runId);
        queued = service.admitMetricIngress(db, race, 'playback').then(() => 'unexpected-admission', error => error?.meta?.code === '23514' ? 'rejected' : 'wrong-error-code');
        let blocked = false;
        for (let attempt = 0; attempt < 40; attempt++) {
          const [waiting] = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%INSERT INTO "LiveMetricIngressFrame"%'`);
          if (waiting.count > 0) { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert.equal(blocked, true);
        await tx.$executeRawUnsafe('UPDATE "LiveMetricIngressRun" SET "stoppedAt"=clock_timestamp() WHERE id=$1', race.runId);
      }, { timeout: 10000 });
      assert.equal(await queued, 'rejected');
      receipt.checks.crossConnectionAdmissionBlockedByStopNeverEscapesAfterCommit = 'PASS';
      receipt.stage = 'server-clock-and-interruption';
      const timed = await fresh(), timedOpen = await service.openMetricIngressRun(db, timed, manifest), timedRun = { ...timed, runId: timedOpen.runId };
      const timedId = randomUUID();
      await db.$executeRawUnsafe(`INSERT INTO "LiveMetricIngressFrame" (id,"vendorId","liveId","versionId","runId","routeKind","admittedAt",outcome,"settledAt","httpStatus") VALUES ($1,$2,$3,$4,$5,'landing','2100-01-01','responded','2100-01-01',200)`, timedId, timed.vendorId, timed.liveId, timed.versionId, timedRun.runId);
      const [clocked] = await db.$queryRawUnsafe('SELECT "admittedAt"<=clock_timestamp() AND outcome=\'pending\' AND "settledAt" IS NULL AND "httpStatus" IS NULL AS safe FROM "LiveMetricIngressFrame" WHERE id=$1', timedId);
      assert.equal(clocked.safe, true);
      await service.settleMetricIngress(db, { ...timedRun, frameId: timedId }, { outcome: 'interrupted' });
      receipt.checks.clientTimestampsAndPretendResponseIgnoredInterruptionRetained = 'PASS';
      await db.$executeRawUnsafe('UPDATE "LiveMetricVersion" SET "collectionEnabled"=false WHERE id=$1', timed.versionId);
      await assert.rejects(service.admitMetricIngress(db, timedRun, 'form'), error => error?.meta?.code === '23514');
      receipt.checks.collectionDisabledClosesFurtherAdmission = 'PASS';
      receipt.stage = 'private-acl';
      const acl = await db.$queryRawUnsafe(`SELECT c.relrowsecurity AS rls,NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner) AS private FROM pg_class c WHERE c.oid IN ('public."LiveMetricIngressRun"'::regclass,'public."LiveMetricIngressFrame"'::regclass)`);
      assert.equal(acl.length, 2); assert.ok(acl.every(row => row.rls && row.private));
      await db.$executeRawUnsafe('CREATE ROLE wp20_ingress_probe NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT');
      try { await assert.rejects(db.$transaction(async tx => { await tx.$executeRawUnsafe('SET LOCAL ROLE wp20_ingress_probe'); await tx.$queryRawUnsafe('SELECT * FROM "LiveMetricIngressFrame"'); })); }
      finally { await db.$executeRawUnsafe('DROP ROLE wp20_ingress_probe'); }
      receipt.checks.privateAclRlsAndUnprivilegedRoleDenied = 'PASS';
      receipt.stage = 'no-positive-proof';
      await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "LiveMetricCoverageAudit" (id,"vendorId","liveId","versionId",kind,"startAt","endAt",status,"sourceRevision","auditDigest") SELECT 'ingress-not-proof',r."vendorId",r."liveId",r."versionId",'visits',r."openedAt",r."stoppedAt",'covered',v."sourceRevision",$2 FROM "LiveMetricIngressRun" r JOIN "LiveMetricVersion" v ON v.id=r."versionId" WHERE r.id=$1`, run.runId, 'c'.repeat(64)), error => error?.meta?.code === '23514' && String(error?.message).includes('metric coverage requires trusted source proof'));
      receipt.checks.stoppedIngressDoesNotAuthorizeCoveredFlag = 'PASS';
      receipt.stage = 'actual-http';
      const manifestRoutes = [{ path: '/synthetic', method: 'GET', kind: 'form' }, { path: '/interrupted', method: 'GET', kind: 'viewer' }, { path: '/force', method: 'GET', kind: 'viewer' }, { path: '/bad-status', method: 'GET', kind: 'form' }];
      const httpScope = await fresh(), httpOpen = await service.openMetricIngressRun(db, httpScope, service.metricIngressManifestHash(manifestRoutes), 2), httpRun = { ...httpScope, runId: httpOpen.runId };
      let forwarded = 0, beforeForwardCommitted = false, observedInterruption;
      const seenInterruption = new Promise(resolve => { observedInterruption = resolve; });
      let forceSeen;
      const upstream = createServer((request, response) => {
        forwarded++;
        void db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "LiveMetricIngressFrame" WHERE "runId"=$1 AND outcome=\'pending\'', httpRun.runId).then(([row]) => {
          beforeForwardCommitted = row.count > 0;
          if (request.url === '/interrupted') { observedInterruption(); return; }
          if (request.url === '/force') { forceSeen(); return; }
          if (request.url === '/bad-status') response.statusCode = 600;
          response.end('synthetic');
        }, () => { response.statusCode = 500; response.end(); });
      });
      await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
      let gateway;
      try {
        const upstreamPort = upstream.address().port;
        await assert.rejects(service.startMetricIngressGateway(db, httpRun, upstreamPort, [{ path: '/other', method: 'GET', kind: 'form' }]));
        gateway = await service.startMetricIngressGateway(db, httpRun, upstreamPort, manifestRoutes);
        // Host/origin rejection must precede any admission or upstream request.
        const requestStatus = headers => new Promise((resolve, reject) => {
          const client = httpRequest(`${gateway.origin}/synthetic`, { headers }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
          client.on('error', reject); client.end();
        });
        assert.equal(await requestStatus({ Host: 'evil.example' }), 421);
        assert.equal(await requestStatus({ Origin: 'http://evil.example' }), 403);
        assert.equal(await requestStatus({ 'Sec-Fetch-Site': 'cross-site' }), 403);
        const [unpolluted] = await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "LiveMetricIngressFrame" WHERE "runId"=$1', httpRun.runId);
        assert.equal(unpolluted.count, 0); assert.equal(forwarded, 0);
        receipt.checks.foreignHostOriginAndFetchSiteRejectedBeforeAdmission = 'PASS';
        const unknown = await fetch(`${gateway.origin}/unknown`); assert.equal(unknown.status, 404); await unknown.arrayBuffer();
        const query = await fetch(`${gateway.origin}/synthetic?live=foreign`); assert.equal(query.status, 404); await query.arrayBuffer();
        assert.equal(forwarded, 0);
        const response = await fetch(`${gateway.origin}/synthetic`); assert.equal(response.status, 200); assert.equal(await response.text(), 'synthetic');
        assert.equal(beforeForwardCommitted, true); assert.equal(forwarded, 1);
        receipt.checks.realLoopbackHttpCommitsAdmissionBeforeForwardAndRejectsUnknownManifest = 'PASS';
        const abort = httpRequest(`${gateway.origin}/interrupted`); abort.on('error', () => undefined); abort.end();
        await seenInterruption; abort.destroy();
        let retained = false;
        for (let attempt = 0; attempt < 80; attempt++) {
          const [row] = await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "LiveMetricIngressFrame" WHERE "runId"=$1 AND outcome=\'interrupted\'', httpRun.runId);
          if (row.count === 1) { retained = true; break; } await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert.equal(retained, true);
        const full = await fetch(`${gateway.origin}/synthetic`); assert.equal(full.status, 503); await full.arrayBuffer(); assert.equal(forwarded, 2);
        receipt.checks.realHttpDisconnectRetainedAndFullAdmissionNeverReachesUpstream = 'PASS';
        assert.deepEqual(await gateway.close(), { settlementFailures: 0, admissionFailures: 1, pendingFrames: 0 });
        assert.deepEqual(await gateway.close(), { settlementFailures: 0, admissionFailures: 1, pendingFrames: 0 });
        const outcomes = await db.$queryRawUnsafe('SELECT outcome,"httpStatus" FROM "LiveMetricIngressFrame" WHERE "runId"=$1 ORDER BY outcome', httpRun.runId);
        assert.deepEqual(outcomes, [{ outcome: 'interrupted', httpStatus: null }, { outcome: 'responded', httpStatus: 200 }]);
        const [httpStopped] = await db.$queryRawUnsafe('SELECT "stoppedAt" IS NOT NULL AS stopped FROM "LiveMetricIngressRun" WHERE id=$1', httpRun.runId); assert.equal(httpStopped.stopped, true);
        gateway = null;
        const failedScope = await fresh(), failedOpen = await service.openMetricIngressRun(db, failedScope, service.metricIngressManifestHash(manifestRoutes), 2), failedRun = { ...failedScope, runId: failedOpen.runId };
        const failCommit = { $transaction: (callback, options) => db.$transaction(async tx => { const result = await callback(tx); if (result?.frameId) throw new Error('synthetic commit failure'); return result; }, options) };
        gateway = await service.startMetricIngressGateway(failCommit, failedRun, upstreamPort, manifestRoutes);
        const rejected = await fetch(`${gateway.origin}/synthetic`); assert.equal(rejected.status, 503); await rejected.arrayBuffer(); assert.equal(forwarded, 2);
        const [rolledBack] = await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "LiveMetricIngressFrame" WHERE "runId"=$1', failedRun.runId); assert.equal(rolledBack.count, 0);
        receipt.checks.realHttpCommitRollbackReturns503WithoutForwardOrFabricatedReceipt = 'PASS';
        assert.deepEqual(await gateway.close(), { settlementFailures: 0, admissionFailures: 1, pendingFrames: 0 }); gateway = null;
        const lostScope = await fresh(), lostOpen = await service.openMetricIngressRun(db, lostScope, service.metricIngressManifestHash(manifestRoutes), 2), lostRun = { ...lostScope, runId: lostOpen.runId };
        const lostAck = { $transaction: async (callback, options) => { const result = await db.$transaction(callback, options); if (result?.frameId) throw new Error('synthetic lost commit acknowledgement'); return result; } };
        gateway = await service.startMetricIngressGateway(lostAck, lostRun, upstreamPort, manifestRoutes);
        const unknownAdmission = await fetch(`${gateway.origin}/synthetic`); assert.equal(unknownAdmission.status, 503); await unknownAdmission.arrayBuffer(); assert.equal(forwarded, 2);
        assert.deepEqual(await gateway.close(), { settlementFailures: 0, admissionFailures: 1, pendingFrames: 1 }); gateway = null;
        receipt.checks.realCommittedAdmissionLostAcknowledgementRemainsPendingAndReported = 'PASS';
        for (const failSettlement of [false, true]) {
          const forcedScope = await fresh(), forcedOpen = await service.openMetricIngressRun(db, forcedScope, service.metricIngressManifestHash(manifestRoutes), 4), forcedRun = { ...forcedScope, runId: forcedOpen.runId };
          const database = failSettlement ? { $transaction: (callback, options) => db.$transaction(async tx => { const result = await callback(tx); if (result?.settledAt) throw new Error('synthetic settlement rollback'); return result; }, options) } : db;
          gateway = await service.startMetricIngressGateway(database, forcedRun, upstreamPort, manifestRoutes);
          const seen = new Promise(resolve => { forceSeen = resolve; });
          const hung = httpRequest(`${gateway.origin}/force`); hung.on('error', () => undefined); hung.end(); await seen;
          assert.deepEqual(await gateway.close(), { settlementFailures: failSettlement ? 1 : 0, admissionFailures: 0, pendingFrames: failSettlement ? 1 : 0 }); gateway = null;
          const [afterForce] = await db.$queryRawUnsafe('SELECT outcome FROM "LiveMetricIngressFrame" WHERE "runId"=$1', forcedRun.runId);
          assert.equal(afterForce.outcome, failSettlement ? 'pending' : 'interrupted');
        }
        receipt.checks.forcedShutdownWaitsForInterruptedSettlementOrReportsActualRollback = 'PASS';
        const statusScope = await fresh(), statusOpen = await service.openMetricIngressRun(db, statusScope, service.metricIngressManifestHash(manifestRoutes), 4), statusRun = { ...statusScope, runId: statusOpen.runId };
        gateway = await service.startMetricIngressGateway(db, statusRun, upstreamPort, manifestRoutes);
        const badStatus = await fetch(`${gateway.origin}/bad-status`); assert.equal(badStatus.status, 502); await badStatus.arrayBuffer();
        assert.deepEqual(await gateway.close(), { settlementFailures: 0, admissionFailures: 0, pendingFrames: 0 }); gateway = null;
        const [mapped] = await db.$queryRawUnsafe('SELECT outcome,"httpStatus" FROM "LiveMetricIngressFrame" WHERE "runId"=$1', statusRun.runId); assert.deepEqual(mapped, { outcome: 'responded', httpStatus: 502 });
        receipt.checks.nonstandardUpstreamStatusBecomes502AndActualResponseReceipt = 'PASS';
      } finally {
        if (gateway) await gateway.close();
        await new Promise(resolve => { upstream.close(resolve); upstream.closeAllConnections(); });
      }
      receipt.stage = 'parent-cascade';
      await db.$executeRawUnsafe('DELETE FROM "LiveMetricVersion" WHERE id=$1', scope.versionId);
      const [removed] = await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "LiveMetricIngressFrame" WHERE "runId"=$1', run.runId); assert.equal(removed.count, 0);
      receipt.checks.canonicalParentCascadeRemovesOnlyOwnedFixtureEvidence = 'PASS';
    } catch (error) {
      receipt.innerFailure = { name: error?.name ?? 'Error', code: typeof error?.code === 'string' ? error.code : null,
        sqlState: typeof error?.meta?.code === 'string' ? error.meta.code : null,
        assertionLine: Number(String(error?.stack ?? '').match(/wp20-ingress-disposable\.mjs:(\d+):/u)?.[1] ?? 0) };
      throw error;
    } finally { await db.$disconnect(); }
  } });
  receipt.migrationCount = migration.migrationNames.length; receipt.cleanup = migration.cleanup;
  assert.equal(migration.status, 'PASS'); receipt.status = 'PASS'; receipt.stage = 'complete';
} catch (error) {
  receipt.error = { name: error?.name ?? 'Error', code: typeof error?.code === 'string' ? error.code : null, sqlState: typeof error?.meta?.code === 'string' ? error.meta.code : null };
  const line = String(error?.stack ?? '').match(/wp20-ingress-disposable\.mjs:(\d+):/u)?.[1];
  if (line) receipt.error.assertionLine = Number(line);
}
fs.writeFileSync(`${base}/ingress-db.json`, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ status: receipt.status, stage: receipt.stage, checks: receipt.checks, error: receipt.error, migrationCount: receipt.migrationCount, cleanup: receipt.cleanup }));
if (receipt.status !== 'PASS') process.exitCode = 1;
