import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

/** Owned disposable-only role/policy fault injection, never a deployed grant. */
export async function runAuditVisibilityProbe({db,service,vendor,video,form,template,clock,start,expires,createPoolClient}){
 let live;const checks={};
 const read=callback=>db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return callback(tx);
 },{isolationLevel:'RepeatableRead',timeout:30000,maxWait:5000});
 try{
  live=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,formId:form.id,messageTemplateId:template.id,title:'Synthetic audit visibility',slug:'audit-visibility',status:'ended',scheduledAt:new Date(+clock.now-200000),startedAt:new Date(+clock.now-200000),endedAt:new Date(+clock.now-100000),replayEnabled:true,replayAvailableUntil:expires}});
  const scope={vendorId:vendor.id,liveId:live.id,versionId:'audit-visibility-version'};
  await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt")
   VALUES ($1,$2,$3,$4,'replay',$5,100000,true,$6,$7)`,scope.versionId,vendor.id,live.id,video.id,service.metricVideoFingerprint(video),start,expires);
  const [now]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
  const window={...scope,startAt:start,endAt:now.now};
  // Inject explicit synthetic missing-source evidence. Positive records below
  // must still come from real producers, never caller-fabricated proof fields.
  for(const kind of ['registrations','orders']){
   await db.$executeRawUnsafe(`INSERT INTO "LiveMetricCoverageAudit" (id,"vendorId","liveId","versionId",kind,status,"startAt","endAt","sourceRevision","auditDigest")
    SELECT $1,$2,$3,$4,$5,'gap',$6,$7,v."sourceRevision",$8 FROM "LiveMetricVersion" v WHERE v.id=$4`,
   `audit-visibility-${kind}-gap`,scope.vendorId,scope.liveId,scope.versionId,kind,start,window.endAt,createHash('sha256').update('synthetic-missing-source:'+kind).digest('hex'));
  }
  assert.equal((await service.publishRegistrationCoverage(db,window)).status,'recorded');
  assert.equal((await service.publishOrderCoverage(db,window)).status,'recorded');
  checks.realEmptyRegistrationAndOrderPublishersProduceCurrentProofs='PASS';
  assert.equal((await service.enqueueMetricReport(db,window)).status,'available');
  const [report]=await db.$queryRawUnsafe('SELECT id FROM "LiveMetricReport" WHERE "versionId"=$1',scope.versionId);
  const lease={...scope,reportId:report.id,workerId:'audit-visibility-worker'};
  assert.equal(await service.claimMetricReport(db,lease),true);
  for(const kind of ['registrations','orders'])assert.equal((await read(tx=>service.readMetricCoverage(tx,lease,kind))).coverage.reason,'evidence_gap');
  checks.ownerSeesGapDespiteValidPositiveProofs='PASS';
  await read(async tx=>{
   await tx.$executeRawUnsafe("SET LOCAL statement_timeout='750ms'");
   const [before]=await tx.$queryRawUnsafe("SELECT current_setting('row_security') AS rls,current_setting('statement_timeout') AS timeout");
   const results=await Promise.allSettled(['registrations','orders'].map(kind=>service.readMetricCoverage(tx,lease,kind)));
   assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
   const rejected=results.find(result=>result.status==='rejected');assert.match(rejected.reason.message,/already active/);
   const [after]=await tx.$queryRawUnsafe("SELECT current_setting('row_security') AS rls,current_setting('statement_timeout') AS timeout");assert.deepEqual(after,before);
  });
  checks.concurrentOwnerReadsRejectOverlapAndRestoreSettings='PASS';
  await read(async tx=>{
   let entered,release;const started=new Promise(done=>{entered=done;}),finish=new Promise(done=>{release=done;});
   const pending=service.withMetricReadVisibility(tx,async()=>{entered();await finish;});
   await Promise.race([started,pending.then(()=>{throw new Error('guard callback did not wait');})]);
   try{await assert.rejects(service.otherBundleVisibility({$queryRaw:tx.$queryRaw.bind(tx)},async()=>0),/already active/);}
   finally{release();await pending;}
  });
  checks.separateServerBundleCopiesShareActualTransactionGuard='PASS';
  await read(async tx=>{
   await tx.$executeRawUnsafe("SET LOCAL statement_timeout='750ms'");
   const [before]=await tx.$queryRawUnsafe("SELECT current_setting('row_security') AS rls,current_setting('statement_timeout') AS timeout");
   let entered,release,seen,resume;let deferred=false;
   const started=new Promise(done=>{entered=done;}),finish=new Promise(done=>{release=done;});
   const snapshotTaken=new Promise(done=>{seen=done;});
   const pending=service.withMetricReadVisibility(tx,async()=>{entered();await finish;});
   await Promise.race([started,pending.then(()=>{throw new Error('guard callback did not wait');})]);
   const alias={$queryRaw:async query=>{
    const rows=await tx.$queryRaw(query);
    if(!deferred&&query.strings.join('').includes(' AS isolation')){
     deferred=true;seen();return new Promise(done=>{resume=()=>done(rows);});
    }
    return rows;
   }};
   const delayed=service.otherBundleVisibility(alias,async()=>1);
   await Promise.race([snapshotTaken,delayed.then(()=>{throw new Error('alias metadata did not wait');})]);
   release();await pending;resume();assert.equal(await delayed,1);
   const [after]=await tx.$queryRawUnsafe("SELECT current_setting('row_security') AS rls,current_setting('statement_timeout') AS timeout");assert.deepEqual(after,before);
  });
  checks.delayedAliasMetadataCannotRestoreAnotherGuardTemporarySettings='PASS';
  await assert.rejects(read(async tx=>{
   await tx.$executeRawUnsafe("SET LOCAL statement_timeout='10000ms'");
   const original=new Error('synthetic JavaScript failure');let injected=false;
   const facade={$queryRaw:query=>{
    if(query.values.length===2&&query.values[0]==='on'){injected=true;return Promise.reject(new Error('synthetic restore transport failure'));}
    return tx.$queryRaw(query);
   }};
   const error=await service.withMetricReadVisibility(facade,async()=>{throw original;}).catch(value=>value);
   assert.ok(error instanceof AggregateError);assert.equal(error.cause,original);assert.equal(injected,true);assert.equal(error.errors.length,2);
   throw new Error('synthetic restore rollback');
  }),/synthetic restore rollback/);
  checks.healthyTransactionRestoreFailureIsSurfacedAndRolledBack='PASS';
  await db.$executeRawUnsafe('CREATE ROLE wp20_audit_visibility_probe NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT');
  try{
   await db.$executeRawUnsafe('GRANT SELECT ON "LiveMetricVersion","LiveMetricReport","LiveMetricCoverageAudit" TO wp20_audit_visibility_probe');
   await db.$executeRawUnsafe('GRANT EXECUTE ON FUNCTION public.wp20_metric_registration_revision(text,text),public.wp20_metric_order_window_revision(text,timestamptz,timestamptz) TO wp20_audit_visibility_probe');
   await db.$executeRawUnsafe('CREATE POLICY wp20_audit_visibility_version ON "LiveMetricVersion" FOR SELECT TO wp20_audit_visibility_probe USING (true)');
   await db.$executeRawUnsafe('CREATE POLICY wp20_audit_visibility_report ON "LiveMetricReport" FOR SELECT TO wp20_audit_visibility_probe USING (true)');
   await db.$executeRawUnsafe(`CREATE POLICY wp20_audit_visibility_rows ON "LiveMetricCoverageAudit" FOR SELECT TO wp20_audit_visibility_probe USING (status='covered')`);
   const roleRead=callback=>read(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE wp20_audit_visibility_probe');return callback(tx);});
   const visible=await roleRead(tx=>tx.$queryRawUnsafe('SELECT status,count(*)::int AS count FROM "LiveMetricCoverageAudit" WHERE "versionId"=$1 GROUP BY status',scope.versionId));
   assert.deepEqual(visible,[{status:'covered',count:2}]);
   for(const kind of ['registrations','orders']){
    assert.equal((await roleRead(tx=>service.readLegacyMetricCoverage(tx,lease,kind))).coverage.status,'complete');
    await assert.rejects(roleRead(tx=>service.readMetricCoverage(tx,lease,kind)),error=>error.meta?.code==='42501');
   }
   checks.exactPriorReaderFalselyCompletesWhenRlsHidesGap='REPRODUCED';
   checks.guardedAuditReaderRejectsFilteredRegistrationAndOrderProofs='PASS';
   for(const alias of [false,true]){
    await assert.rejects(roleRead(async tx=>{
     const other=alias?{$queryRaw:tx.$queryRaw.bind(tx)}:tx;
     const results=await Promise.allSettled([service.readMetricCoverage(tx,lease,'registrations'),service.readMetricCoverage(other,lease,'orders')]);
     assert.equal(results.filter(result=>result.status==='fulfilled').length,0);
     assert.ok(results.every(result=>result.status==='rejected'&&(result.reason.meta?.code==='42501'||/already active/.test(result.reason.message))));
     throw new Error('synthetic concurrency rollback');
    }),/synthetic concurrency rollback/);
   }
   checks.concurrentFilteredRoleAndAliasedTransactionNeverComplete='PASS';
   const pooled=createPoolClient();
   try{
    await pooled.$executeRawUnsafe('SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await pooled.$executeRawUnsafe('SET row_security=off');await pooled.$executeRawUnsafe("SET statement_timeout='5000ms'");
    // Even when settings happen to match, autocommit transactions differ.
    await assert.rejects(service.readMetricCoverage(pooled,lease,'registrations'),/one explicit transaction/);
    await pooled.$executeRawUnsafe('SET row_security=on');await pooled.$executeRawUnsafe('SET ROLE wp20_audit_visibility_probe');
    assert.equal((await service.readLegacyMetricCoverage(pooled,lease,'registrations')).coverage.status,'complete');
    await assert.rejects(service.readMetricCoverage(pooled,lease,'registrations'),/one explicit transaction/);
    const [state]=await pooled.$queryRawUnsafe("SELECT current_setting('row_security') AS rls");assert.equal(state.rls,'on');
    checks.autocommitDefaultRepeatableReadAndMatchingSettingsAreRejected='PASS';
   }finally{await pooled.$disconnect();}
  }finally{
   await db.$executeRawUnsafe('DROP POLICY IF EXISTS wp20_audit_visibility_rows ON "LiveMetricCoverageAudit"');
   await db.$executeRawUnsafe('DROP POLICY IF EXISTS wp20_audit_visibility_report ON "LiveMetricReport"');
   await db.$executeRawUnsafe('DROP POLICY IF EXISTS wp20_audit_visibility_version ON "LiveMetricVersion"');
   await db.$executeRawUnsafe('REVOKE EXECUTE ON FUNCTION public.wp20_metric_registration_revision(text,text),public.wp20_metric_order_window_revision(text,timestamptz,timestamptz) FROM wp20_audit_visibility_probe');
   await db.$executeRawUnsafe('REVOKE ALL ON "LiveMetricVersion","LiveMetricReport","LiveMetricCoverageAudit" FROM wp20_audit_visibility_probe');
   await db.$executeRawUnsafe('DROP ROLE wp20_audit_visibility_probe');
  }
  await read(async tx=>{
   await tx.$executeRawUnsafe("SET LOCAL statement_timeout='750ms'");
   const [before]=await tx.$queryRawUnsafe("SELECT current_setting('row_security') AS rls,current_setting('statement_timeout') AS timeout");
   await service.readMetricCoverage(tx,lease,'registrations');
   const [after]=await tx.$queryRawUnsafe("SELECT current_setting('row_security') AS rls,current_setting('statement_timeout') AS timeout");
   assert.deepEqual(after,before);
  });
  for(const kind of ['registrations','orders'])assert.equal((await read(tx=>service.readMetricCoverage(tx,lease,kind))).coverage.reason,'evidence_gap');
  checks.auditReadRestoresStricterCallerSettingsAndPoliciesCleaned='PASS';
  return checks;
 }finally{if(live)await db.live.delete({where:{id:live.id}});}
}
