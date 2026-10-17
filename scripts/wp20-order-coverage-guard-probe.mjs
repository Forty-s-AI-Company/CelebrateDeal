import { verifyOrderWindowSource } from "./wp20-order-window-source-probe.mjs";
import { createHash } from "node:crypto";
import assert from 'node:assert/strict';
/** Test only: direct synthetic proof rows exercise storage guards, not a producer. */
export async function verifyOrderCoverageGuard(db,service,scope,audit) {
 const insert=(id,revision,tenantRevision,registrationRevision,count,kind='orders',status='covered')=>
  db.$executeRawUnsafe(`INSERT INTO "LiveMetricCoverageAudit"
   (id,"vendorId","liveId","versionId",kind,status,"startAt","endAt","sourceRevision","auditDigest",
    "orderRevision","orderTenantRevision","orderRegistrationRevision","orderCount","orderProofVersion")
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CASE WHEN $14::integer IS NULL THEN NULL ELSE 2 END)`,
   id,scope.vendorId,scope.liveId,scope.versionId,kind,status,scope.startAt,scope.endAt,
   audit.sourceRevision,audit.digest,revision,tenantRevision,registrationRevision,count);
 const valid=[audit.orderRevision,audit.tenantRevision,audit.registrationRevision,audit.count];
 let priorReport;
 const coverage=async suffix=>{
  if(priorReport) await db.$executeRawUnsafe(`UPDATE "LiveMetricReport" SET status='stale',result=NULL,"leaseOwner"=NULL,"leaseExpiresAt"=NULL WHERE id=$1`,priorReport);
  const [version]=await db.$queryRawUnsafe('SELECT "sourceRevision","expiresAt" FROM "LiveMetricVersion" WHERE id=$1',scope.versionId);
  const lease={vendorId:scope.vendorId,liveId:scope.liveId,versionId:scope.versionId,reportId:'order-proof-report-'+suffix,workerId:'order-proof-worker'};
  await db.$queryRawUnsafe('SELECT public.wp20_metric_report_create($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7::bigint,$8::timestamptz)',scope.vendorId,scope.liveId,scope.versionId,lease.reportId,scope.startAt,scope.endAt,version.sourceRevision,version.expiresAt);
  priorReport=lease.reportId;
  assert.equal(await service.claimMetricReport(db,lease),true);
  return db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
   return service.readMetricCoverage(tx,lease,'orders');
  },{isolationLevel:'RepeatableRead',timeout:10000});
 };
 await insert('order-legacy-positive',null,null,null,null);
 assert.deepEqual((await coverage('legacy')).coverage,{status:'unavailable',reason:'unknown_history'});
 await insert('order-proof-guard-valid',...valid);
 assert.deepEqual((await coverage('valid')).coverage,{status:'complete'});
 let rejected=0;
 for(let i=0;i<4;i++) {
  const partial=[...valid];partial[i]=null;
  await assert.rejects(insert('order-proof-partial-'+i,...partial),error=>
   error?.meta?.code==='23514'&&String(error.meta.message).includes('order coverage source mismatch'));
  rejected++;
 }
 for(let i=0;i<3;i++) {
  const stale=[...valid];stale[i]+=BigInt(1);
  await assert.rejects(insert('order-proof-mismatch-'+i,...stale),error=>
   error?.meta?.code==='23514'&&String(error.meta.message).includes('order coverage source mismatch'));
  rejected++;
 }
 for(const [kind,status] of [['registrations','covered'],['orders','gap']]) {
  await assert.rejects(insert('order-proof-wrong-'+kind+'-'+status,...valid,kind,status),error=>
   error?.meta?.code==='23514'&&String(error.meta.message).includes('order coverage source mismatch'));
  rejected++;
 }
 const [rows]=await db.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "LiveMetricCoverageAudit"
  WHERE "versionId"=$1 AND id LIKE 'order-proof-%'`,scope.versionId);
 assert.equal(rows.count,1);
 const [payment]=await db.$queryRawUnsafe(`SELECT p.id,p.metadata FROM "PaymentTransaction" p
  JOIN "CommerceOrder" o ON o."primaryPaymentTransactionId"=p.id AND o."vendorId"=p."vendorId"
  WHERE o."vendorId"=$1 LIMIT 1`,scope.vendorId);
 assert.ok(payment);
 try {
  // An unrelated metadata key changes only the conservative tenant fence.
  await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:{...payment.metadata,syntheticAuditProbe:1}}});
  const changed=await service.auditMetricOrderSources(db,scope);
  assert.ok(changed.orderRevision>audit.orderRevision);
  assert.ok(changed.tenantRevision>audit.tenantRevision);
  assert.deepEqual((await coverage('tenant-changed')).coverage,{status:'unavailable',reason:'unknown_history'});
 } finally {await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:payment.metadata}});}
 assert.deepEqual((await coverage('restored')).coverage,{status:'unavailable',reason:'unknown_history'});
 const published=await service.publishOrderCoverage(db,scope);
 assert.equal(published.status,'recorded');
 assert.deepEqual(await service.publishOrderCoverage(db,scope),published);
 assert.deepEqual((await coverage('producer')).coverage,{status:'complete'});
 try {
  await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:{}}});
  assert.deepEqual(await service.publishOrderCoverage(db,scope),{status:'incomplete'});
 } finally {await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:payment.metadata}});}
 let transactions=0;
 const racingDb={$transaction:async(callback,options)=>{
  const result=await db.$transaction(callback,options);
  if(++transactions===1) await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:{...payment.metadata,syntheticAuditRace:1}}});
  return result;
 }};
 try {
  assert.deepEqual(await service.publishOrderCoverage(racingDb,scope),{status:'source_changed'});
 } finally {await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:payment.metadata}});}
 let insertInjected=false;
 const proofCount=async()=>{
  const [row]=await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "LiveMetricCoverageAudit" WHERE "versionId"=$1',scope.versionId);
  return row.count;
 };
 const beforeInsertRace=await proofCount();
 const insertRaceDb={$transaction:(callback,options)=>db.$transaction(tx=>callback(new Proxy(tx,{
  get(target,key){
   if(key==='$queryRaw') return async query=>{
    if(!insertInjected&&query.strings.join('').includes('INSERT INTO "LiveMetricCoverageAudit"')) {
     insertInjected=true;
     await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:{...payment.metadata,syntheticInsertRace:1}}});
    }
    return target.$queryRaw(query);
   };
   const member=Reflect.get(target,key);return typeof member==='function'?member.bind(target):member;
  },
 })),options)};
 try {
  assert.deepEqual(await service.publishOrderCoverage(insertRaceDb,scope),{status:'source_changed'});
  assert.equal(insertInjected,true);
  assert.equal(await proofCount(),beforeInsertRace);
 } finally {await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:payment.metadata}});}
 const refreshed=await service.publishOrderCoverage(db,scope);
 assert.equal(refreshed.status,'recorded');assert.notEqual(refreshed.proofId,published.proofId);
 assert.deepEqual((await coverage('after-insert-race')).coverage,{status:'complete'});
 const lease={vendorId:scope.vendorId,liveId:scope.liveId,versionId:scope.versionId,reportId:priorReport,workerId:'order-proof-worker'};
 const unavailable={status:'unavailable',reason:'missing_data'};
 const aggregate={registrationRate:unavailable,attendanceRate:unavailable,completionRate:unavailable,
  averageViewingSeconds:unavailable,postCompletionOrderRate:unavailable,unattributedRegistrations:null,provisionalConversions:null};
 assert.equal(await service.finishMetricReport(db,lease,aggregate),true);
 const readyScope={vendorId:scope.vendorId,liveId:scope.liveId,versionId:scope.versionId,reportId:priorReport};
 assert.equal((await service.readMetricReadyReport(db,readyScope)).status,'available');
 try {
  await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:{...payment.metadata,syntheticReadyRace:1}}});
  assert.equal((await service.readMetricReadyReport(db,readyScope)).status,'unavailable');
 } finally {await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:payment.metadata}});}
 assert.equal((await service.readMetricReadyReport(db,readyScope)).status,'unavailable');
 for(const phase of ['claim','finish']) {
  const [version]=await db.$queryRawUnsafe('SELECT "sourceRevision","expiresAt" FROM "LiveMetricVersion" WHERE id=$1',scope.versionId);
  const pending={...lease,reportId:'order-tenant-stale-'+phase};
  await db.$queryRawUnsafe('SELECT public.wp20_metric_report_create($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7::bigint,$8::timestamptz)',scope.vendorId,scope.liveId,scope.versionId,pending.reportId,scope.startAt,scope.endAt,version.sourceRevision,version.expiresAt);
  if(phase==='finish') assert.equal(await service.claimMetricReport(db,pending),true);
  try {
   await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:{...payment.metadata,syntheticLifecycleRace:phase}}});
   const accepted=phase==='claim'?await service.claimMetricReport(db,pending):await service.finishMetricReport(db,pending,aggregate);
   assert.equal(accepted,false);
   const [stale]=await db.$queryRawUnsafe('SELECT status,result,"leaseOwner" FROM "LiveMetricReport" WHERE id=$1',pending.reportId);
   assert.deepEqual(stale,{status:'stale',result:null,leaseOwner:null});
  } finally {await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:payment.metadata}});}
 }
 const emptyScope={...scope,endAt:new Date(scope.startAt.getTime()+1)};
 const emptyAudit=await service.auditMetricOrderSources(db,emptyScope);
 assert.equal(emptyAudit.status,'enumerated');assert.equal(emptyAudit.count,0);
 const emptyProof=await service.publishOrderCoverage(db,emptyScope);
 assert.equal(emptyProof.status,'recorded');
 const [emptyRow]=await db.$queryRawUnsafe('SELECT "orderCount" FROM "LiveMetricCoverageAudit" WHERE id=$1',emptyProof.proofId);
 assert.equal(emptyRow.orderCount,0);
 const secondEmptyScope={...scope,endAt:new Date(scope.startAt.getTime()+2)};
 const secondEmpty=await service.publishOrderCoverage(db,secondEmptyScope);
 assert.equal(secondEmpty.status,'recorded');assert.notEqual(secondEmpty.proofId,emptyProof.proofId);
 // Deliberately seed a conflicting synthetic proof as the disposable owner.
 // This is not a valid producer output and must never be reported as recorded.
 const collisionScope={...scope,endAt:new Date(scope.startAt.getTime()+3)};
 const collisionAudit=await service.auditMetricOrderSources(db,collisionScope);
 assert.equal(collisionAudit.status,'enumerated');assert.equal(collisionAudit.count,0);
 const collisionId=createHash('sha256').update(JSON.stringify({format:'order-coverage-window-v3',kind:'orders',
  vendorId:collisionScope.vendorId,liveId:collisionScope.liveId,versionId:collisionScope.versionId,
  startAt:collisionScope.startAt,endAt:collisionScope.endAt,digest:collisionAudit.digest})).digest('hex');
 await db.$executeRawUnsafe(`INSERT INTO "LiveMetricCoverageAudit"
  (id,"vendorId","liveId","versionId",kind,status,"startAt","endAt","sourceRevision","auditDigest",
   "orderRevision","orderTenantRevision","orderRegistrationRevision","orderCount","orderProofVersion")
  VALUES ($1,$2,$3,$4,'orders','covered',$5,$6,$7,$8,$9,$10,$11,1,2)`,
  collisionId,scope.vendorId,scope.liveId,scope.versionId,collisionScope.startAt,collisionScope.endAt,
  collisionAudit.sourceRevision,collisionAudit.digest,collisionAudit.orderRevision,collisionAudit.tenantRevision,collisionAudit.registrationRevision);
 assert.deepEqual(await service.publishOrderCoverage(db,collisionScope),{status:'conflict'});
 const [collisionRow]=await db.$queryRawUnsafe('SELECT "orderCount" FROM "LiveMetricCoverageAudit" WHERE id=$1',collisionId);
 assert.equal(collisionRow.orderCount,1);
 const exclusions=[];
 try {
  for(const [metadata,outcome] of [
   [{...payment.metadata,billingPurpose:'subscription'},'other_purpose'],
   [{...payment.metadata,sourceLiveId:'synthetic-other-live'},'other_live'],
  ]) {
   await db.paymentTransaction.update({where:{id:payment.id},data:{metadata}});
   const classified=await service.auditMetricOrderSources(db,scope);
   assert.equal(classified.status,'enumerated');assert.equal(classified.count,20);
   assert.equal(classified.outcomes[outcome],1);assert.equal(classified.outcomes.matched,19);
   assert.equal((await service.publishOrderCoverage(db,scope)).status,'recorded');
   exclusions.push(outcome);
  }
 } finally {await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:payment.metadata}});}
 // Characterize the unresolved liveness finding without weakening a fence:
 // a committed order wholly after the report window currently invalidates it.
 assert.equal((await service.publishOrderCoverage(db,scope)).status,'recorded');
 assert.deepEqual((await coverage('outside-window-baseline')).coverage,{status:'complete'});
 const outsideLease={...lease,reportId:priorReport};
 assert.equal(await service.finishMetricReport(db,outsideLease,aggregate),true);
 const outsideReady={vendorId:scope.vendorId,liveId:scope.liveId,versionId:scope.versionId,reportId:priorReport};
 assert.equal((await service.readMetricReadyReport(db,outsideReady)).status,'available');
 await db.$executeRawUnsafe(`INSERT INTO "CommerceOrder"
  (id,"vendorId","orderNumber","checkoutIdempotencyKey","checkoutIdentityHash",status,currency,
   "subtotalAmountCents","totalAmountCents","buyerEncryptedEnvelope","buyerMaskedName","buyerMaskedEmail","createdAt","updatedAt")
  VALUES ('outside-window-liveness-order',$1,'OUTSIDE-WINDOW','outside-window-liveness-key',repeat('a',43),'pending_payment','TWD',100,100,
   'synthetic-unused','Synthetic','synthetic@example.test',$2,$2)`,scope.vendorId,new Date(scope.endAt.getTime()+60000));
 const historical=await service.auditMetricOrderSources(db,scope);
 assert.equal(historical.status,'enumerated');assert.equal(historical.count,20);
 assert.equal(historical.outcomes.matched,20);
 assert.equal((await service.readMetricReadyReport(db,outsideReady)).status,'available');
 const windowSource=await verifyOrderWindowSource(db,scope,service);
 return {status:'PASS',windowSource,outsideWindowLiveness:'PASS_WINDOW_ISOLATED',forcedProofConflict:'PASS',separateEmptyWindows:'PASS',auditedEmptyProof:'PASS',explicitExclusions:exclusions,claimTenantFence:'PASS',finishTenantFence:'PASS',readyReportTenantFence:'PASS',revisionToInsertRace:'PASS',raceWritesNothing:'PASS',reauditRecovers:'PASS',producerMatched:'PASS',producerIdempotent:'PASS',producerIncompleteRejected:'PASS',auditToPublishRace:'PASS',validStored:1,invalidRejected:rejected,noRejectedRowsPersisted:true,
  legacyPositiveIgnored:true,tenantOnlyChangeInvalidates:true,restoringFactsDoesNotRevive:true,
  scope:'Storage/reader plus actual matched producer, incomplete refusal and audit-to-publish race; full WP remains incomplete'};
}
