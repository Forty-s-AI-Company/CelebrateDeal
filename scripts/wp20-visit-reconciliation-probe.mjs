import assert from 'node:assert/strict';

/** Only called inside the owned, marker-verified disposable harness. No host
 * credentials or raw logs. The outer harness owns container cleanup. */
export async function runVisitReconciliationProbe({db,service,vendor,video,form,template,clock,start,expires}){
 const checks={};let live;let futureLive;let stage='create-fixture';
 const read=callback=>db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return callback(tx);
 },{isolationLevel:'RepeatableRead',timeout:30000,maxWait:5000});
 try{
  live=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,formId:form.id,messageTemplateId:template.id,title:'Synthetic reconciliation',slug:'visit-reconciliation-loss',status:'ended',scheduledAt:new Date(+clock.now-200000),startedAt:new Date(+clock.now-200000),endedAt:new Date(+clock.now-100000),replayEnabled:true,replayAvailableUntil:expires}});
  const scope={vendorId:vendor.id,liveId:live.id,versionId:'reconciliation-version'};
  await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt")
   VALUES ($1,$2,$3,$4,'replay',$5,100000,true,$6,$7)`,scope.versionId,vendor.id,live.id,video.id,service.metricVideoFingerprint(video),start,expires);
  // The first, unclassified page expires before the report. It must still
  // carry permanent loss when the shared version quota is exhausted later.
  await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVisitPage" ("vendorId","liveId","versionId","eventId","expiresAt")
   SELECT $1,$2,$3,'50000000-0000-4000-8000-'||lpad(to_hex(n),12,'0'),
    CASE WHEN n=1 THEN clock_timestamp()+interval '1 second' ELSE $4::timestamptz END FROM generate_series(1,10000) n`,vendor.id,live.id,scope.versionId,expires);
  const firstEvent='50000000-0000-4000-8000-000000000001';
  const [old]=await db.$queryRawUnsafe('SELECT "expiresAt" FROM "LiveMetricVisitPage" WHERE "eventId"=$1',firstEvent);
  await db.$queryRawUnsafe(`SELECT pg_sleep(GREATEST(0,extract(epoch FROM ($1::timestamptz-clock_timestamp())))+0.02)::text`,old.expiresAt);
  const [now]=await db.$queryRawUnsafe('SELECT clock_timestamp() AS now');
  const window={...scope,startAt:new Date(+old.expiresAt+1),endAt:now.now};assert.ok(window.startAt<window.endAt);
  const leaseFor=async(endAt,workerId)=>{
   const queued=await service.enqueueMetricReport(db,{...scope,startAt:window.startAt,endAt});
   try{assert.equal(queued.status,'available');}catch(error){error.queueReason=queued.reason;throw error;}
   const [report]=await db.$queryRawUnsafe('SELECT id FROM "LiveMetricReport" WHERE "versionId"=$1 AND "windowEndAt"=$2 AND status=\'queued\' ORDER BY "createdAt" DESC LIMIT 1',scope.versionId,endAt);
   const lease={...scope,reportId:report.id,workerId};assert.equal(await service.claimMetricReport(db,lease),true);return lease;
  };
  stage='baseline-report';
  const beforeLease=await leaseFor(window.endAt,'reconciliation-before');
  const baseline=await read(tx=>service.readMetricCoverage(tx,beforeLease,'visits'));
  assert.equal(baseline.status,'available');assert.equal(baseline.coverage.reason,'unknown_history');
  assert.equal(baseline.sourceReconciliation.summary.versionLossMarkers,0);
  assert.equal(baseline.sourceReconciliation.rowCount,10000);
  checks.fullUnknownSourceSetIsNotCertifiedAsKnownZero='PASS';
  // Commit a real quota loss between pages and intents reads. RR must retain
  // the prior view in every source query, without locking source writers out.
  stage='concurrent-snapshot';let committed=false;
  const frozen=await read(tx=>service.reconcileMetricVisitSources({$queryRaw:async query=>{
   const rows=await tx.$queryRaw(query);
   if(!committed&&query.strings.join('').includes('FROM "LiveMetricVisitPage"')){
    assert.equal(await service.issueMetricRegistrationPage(db,{formId:form.id,liveId:live.id}),null);committed=true;
   }
   return rows;
  }},window));
  assert.equal(committed,true);assert.equal(frozen.status,'available');
  assert.equal(frozen.sourceDigest,baseline.sourceReconciliation.sourceDigest);assert.equal(frozen.summary.versionLossMarkers,0);
  const refreshed=await read(tx=>service.reconcileMetricVisitSources(tx,window));
  assert.notEqual(refreshed.sourceDigest,frozen.sourceDigest);assert.equal(refreshed.summary.versionLossMarkers,0);
  checks.realConcurrentQuotaLossPreservesWholeSourceRepeatableReadSnapshot='PASS';
  stage='expired-marker';
  const [marker]=await db.$queryRawUnsafe('SELECT "sourceKind","lossAt","expiresAt" FROM "LiveMetricVisitPage" WHERE "eventId"=$1',firstEvent);
  assert.equal(marker.sourceKind,'unknown');assert.ok(marker.lossAt>marker.expiresAt);
  await db.$queryRawUnsafe('SELECT pg_sleep(0.01)::text');
  const [later]=await db.$queryRawUnsafe('SELECT clock_timestamp() AS now');
  stage='loss-report';const lossLease=await leaseFor(later.now,'reconciliation-after');
  const withLoss=await read(tx=>service.readMetricCoverage(tx,lossLease,'visits'));
  assert.equal(withLoss.status,'available');assert.equal(withLoss.coverage.reason,'evidence_gap');
  assert.equal(withLoss.sourceReconciliation.summary.versionLossMarkers,1);
  assert.equal(withLoss.sourceReconciliation.summary.registrationFactsInWindow,0);
  checks.actualReportCoverageReadsExpiredUnknownPagePermanentLoss='PASS';
  stage='boundary-report';const boundaryLease=await leaseFor(marker.lossAt,'reconciliation-boundary');
  const boundary=await read(tx=>service.readMetricCoverage(tx,boundaryLease,'visits'));
  assert.equal(boundary.coverage.reason,'unknown_history');assert.equal(boundary.sourceReconciliation.summary.versionLossMarkers,0);
  checks.exclusiveWindowEndDoesNotPullFutureQuotaLossBackward='PASS';
  stage='caller-settings';
  await read(async tx=>{
   await tx.$executeRawUnsafe("SET LOCAL statement_timeout='1000ms'");
   const [before]=await tx.$queryRawUnsafe("SELECT current_setting('row_security') AS rls,current_setting('statement_timeout') AS timeout");
   await service.reconcileMetricVisitSources(tx,window);
   const [after]=await tx.$queryRawUnsafe("SELECT current_setting('row_security') AS rls,current_setting('statement_timeout') AS timeout");
   assert.deepEqual(after,before);
  });
  checks.actualCallerDeadlineAndRlsSettingsRestored='PASS';
  stage='future-snapshot-window';
  futureLive=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,formId:form.id,messageTemplateId:template.id,title:'Synthetic snapshot bound',slug:'visit-reconciliation-future',status:'ended',scheduledAt:new Date(+clock.now-200000),startedAt:new Date(+clock.now-200000),endedAt:new Date(+clock.now-100000),replayEnabled:true,replayAvailableUntil:expires}});
  await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt")
   VALUES ('reconciliation-future',$1,$2,$3,'replay',$4,100000,true,$5,$6)`,vendor.id,futureLive.id,video.id,service.metricVideoFingerprint(video),start,expires);
  await read(async tx=>{
   const [begin]=await tx.$queryRawUnsafe('SELECT transaction_timestamp() AS started');
   const endAt=new Date(+begin.started+2000);
   const pending=await service.issueMetricRegistrationPage(db,{formId:form.id,liveId:futureLive.id});assert.ok(pending);
   const [issued]=await db.$queryRawUnsafe('SELECT "issuedAt" FROM "LiveMetricVisitPage" WHERE "eventId"=$1',pending.eventId);
   assert.ok(issued.issuedAt>begin.started&&issued.issuedAt<endAt);
   await tx.$queryRawUnsafe('SELECT pg_sleep(GREATEST(0,extract(epoch FROM ($1::timestamptz-clock_timestamp())))+0.02)::text',endAt);
   const result=await service.reconcileMetricVisitSources(tx,{vendorId:vendor.id,liveId:futureLive.id,versionId:'reconciliation-future',startAt:start,endAt});
   assert.deepEqual(result,{status:'unavailable',reason:'window_not_closed'});
  });
  await db.live.delete({where:{id:futureLive.id}});futureLive=null;
  checks.wallClockPastEndCannotCloseEarlierRepeatableReadSnapshot='PASS';
  // Demonstrate that SELECT+RLS can silently hide every source. The product
  // reconciliation must reject this role instead of calling that audited zero.
  stage='rls-filter';await db.$executeRawUnsafe('CREATE ROLE wp20_reconciliation_probe NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT');
  try{
   await db.$executeRawUnsafe('GRANT SELECT ON "LiveMetricVersion","LiveMetricVisitPage","LiveMetricVisitIntent","LiveMetricVisit" TO wp20_reconciliation_probe');
   await db.$executeRawUnsafe('CREATE POLICY wp20_reconciliation_version_probe ON "LiveMetricVersion" FOR SELECT TO wp20_reconciliation_probe USING (true)');
   await db.$executeRawUnsafe(`CREATE POLICY wp20_reconciliation_page_probe ON "LiveMetricVisitPage" FOR SELECT TO wp20_reconciliation_probe USING ("sourceKind"='registration')`);
   const hidden=await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET LOCAL ROLE wp20_reconciliation_probe');
    const [row]=await tx.$queryRawUnsafe('SELECT count(*)::int AS count FROM "LiveMetricVisitPage" WHERE "versionId"=$1',scope.versionId);return row.count;
   });assert.equal(hidden,0);
   await assert.rejects(db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET LOCAL ROLE wp20_reconciliation_probe');
    return service.reconcileMetricVisitSources(tx,{...window,endAt:later.now});
   },{isolationLevel:'RepeatableRead'}),error=>error.meta?.code==='42501');
   checks.rlsFilteredEmptySourcesAreExplicitlyRejected='PASS';
  }finally{
   await db.$executeRawUnsafe('DROP POLICY IF EXISTS wp20_reconciliation_version_probe ON "LiveMetricVersion"');
   await db.$executeRawUnsafe('DROP POLICY IF EXISTS wp20_reconciliation_page_probe ON "LiveMetricVisitPage"');
   await db.$executeRawUnsafe('REVOKE ALL ON "LiveMetricVersion","LiveMetricVisitPage","LiveMetricVisitIntent","LiveMetricVisit" FROM wp20_reconciliation_probe');
   await db.$executeRawUnsafe('DROP ROLE wp20_reconciliation_probe');
  }
  stage='oversized-source-with-audit-gap';
  const proofs=service.createMetricVisitorProofService(new Uint8Array(32).fill(9));
  const prepared=await service.prepareTrackedMetricVisit(db,proofs,{vendorId:scope.vendorId,liveId:scope.liveId},null,{eventId:'50000000-0000-4000-8000-000000000002'});
  await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVisitIntent" ("vendorId","liveId","versionId","visitorId","eventId")
   SELECT $1,$2,$3,$4,'60000000-0000-4000-8000-'||lpad(to_hex(n),12,'0') FROM generate_series(1,10000) n`,scope.vendorId,scope.liveId,scope.versionId,prepared.visitorId);
  assert.deepEqual(await read(tx=>service.reconcileMetricVisitSources(tx,{...window,endAt:later.now})),{status:'unavailable',reason:'limit_exceeded'});
  await db.$executeRawUnsafe(`INSERT INTO "LiveMetricCoverageAudit" (id,"vendorId","liveId","versionId",kind,status,"startAt","endAt","sourceRevision","auditDigest")
   SELECT 'reconciliation-real-loss',$1,$2,$3,'visits','gap',$4,$5,v."sourceRevision",$6 FROM "LiveMetricVersion" v WHERE v.id=$3`,scope.vendorId,scope.liveId,scope.versionId,marker.lossAt,later.now,withLoss.sourceReconciliation.sourceDigest);
  const oversizedLease=await leaseFor(later.now,'reconciliation-oversized');
  const oversized=await read(tx=>service.readMetricCoverage(tx,oversizedLease,'visits'));
  assert.equal(oversized.status,'available');assert.equal(oversized.coverage.reason,'evidence_gap');
  assert.deepEqual(oversized.sourceReconciliation,{status:'not_read',reason:'known_audit_gap'});
  assert.equal(oversized.rowCount,1);
  checks.knownAuditGapSurvivesActualSourceLimitWithoutPrefix='PASS';
  return checks;
 }catch(error){
  error.probeStage=stage;
  if(['scope_or_window_unavailable','previous_failure','contention','integrity_violation','enqueue_failed'].includes(error.queueReason))error.probeQueueReason=error.queueReason;
  const known=['Invalid visit page source','Invalid visit preparation time','Invalid visit fact time',
   'Visit source keys are not unique','Visit fact keys are not unique','Visit reconciliation requires primary repeatable-read snapshot'];
  if(known.includes(error.message))error.probeReason=known.indexOf(error.message);
  throw error;
 }
 finally{if(futureLive)await db.live.delete({where:{id:futureLive.id}});if(live)await db.live.delete({where:{id:live.id}});}
}
