import { verifyOrderCoverageGuard } from "./wp20-order-coverage-guard-probe.mjs";
import { verifyOrderTenantLedger } from "./wp20-order-tenant-ledger-probe.mjs";
import assert from 'node:assert/strict';
export async function verifyOrderSourceAudit(db,service,{vendor,live,video}) {
 // The application creates timestamps using its own clock. Close the synthetic
 // window only after every owned order timestamp is strictly in the DB's past.
 const [lag]=await db.$queryRawUnsafe(`SELECT greatest(0,extract(epoch FROM (max("createdAt") AT TIME ZONE 'UTC')-clock_timestamp()))::double precision AS seconds FROM "CommerceOrder" WHERE "vendorId"=$1`,vendor.id);
 assert.ok(lag.seconds<=2,'Synthetic app/DB clock skew exceeds bounded fixture allowance');
 await db.$queryRawUnsafe('SELECT pg_sleep($1::double precision)::text',lag.seconds+0.01);
 const [clock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
 const start=new Date(+clock.now-3600000),end=clock.now,versionId='order-audit-version';
 await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"collectionEnabled","collectionStartedAt","expiresAt") VALUES ($1,$2,$3,$4,'live',$5,true,$6,$7)`,versionId,vendor.id,live.id,video.id,'f'.repeat(64),start,new Date(+clock.now+3600000));
 const request={vendorId:vendor.id,liveId:live.id,versionId,startAt:start,endAt:end,afterId:null,take:10};
 const read=callback=>db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return callback(tx);},{isolationLevel:'RepeatableRead',timeout:15000});
 try {
  for(const isolationLevel of ['ReadCommitted','RepeatableRead']) {
   await assert.rejects(db.$transaction(tx=>service.readMetricOrderAuditPage(tx,request),{isolationLevel}),
    {message:'Order audit requires read-only repeatable-read'});
  }
  await read(async tx=>{
   const first=await service.readMetricOrderAuditPage(tx,request);
   assert.equal(first.status,'available');assert.equal(first.coverage,'unknown');assert.equal(first.rows.length,10);assert.equal(first.hasMore,true);
   const second=await service.readMetricOrderAuditPage(tx,{...request,afterId:first.nextId});
   assert.equal(second.rows.length,10);assert.equal(second.hasMore,false);
   assert.equal(new Set([...first.rows,...second.rows].map(row=>row.orderId)).size,20);
   assert.ok([...first.rows,...second.rows].every(row=>row.outcome==='missing_registration'));
   assert.deepEqual(await service.readMetricOrderAuditPage(tx,{...request,vendorId:'foreign-vendor'}),{status:'unavailable',reason:'scope_or_window_unavailable'});
  });
  await read(async tx=>{
   let contextReads=0;
   const observed={$queryRaw:async query=>{
    if(query.strings.join('').includes('wp20_metric_order_window_revision'))contextReads++;
    return tx.$queryRaw(query);
   }};
   await service.withMetricOrderAuditContext(observed,request,async snapshot=>{
    const first=await service.readMetricOrderAuditPage(snapshot,request);
    const second=await service.readMetricOrderAuditPage(snapshot,{...request,afterId:first.nextId});
    assert.equal(first.rows.length+second.rows.length,20);
   });
   assert.equal(contextReads,1);
  });
  // The attribution metadata is synthetic and restored even when assertions fail.
  const payment=await db.paymentTransaction.findFirstOrThrow({where:{vendorId:vendor.id,orderNumber:'WP20-RETRY-0'},select:{id:true,metadata:true}});
  try {
   await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:{billingPurpose:'buyer_order'}}});
   await read(async tx=>{
    const page=await service.readMetricOrderAuditPage(tx,{...request,take:500});
    assert.equal(page.rows.length,20);
    assert.equal(page.rows.filter(row=>row.outcome==='missing_attribution').length,1);
    assert.equal(page.rows.filter(row=>row.outcome==='missing_registration').length,19);
    assert.equal(page.coverage,'unknown');
   });
   const revision=async()=> (await db.$queryRawUnsafe('SELECT public.wp20_metric_order_revision($1,$2) AS scoped,public.wp20_metric_order_tenant_revision($1) AS tenant',vendor.id,live.id))[0];
   const beforeUnattributed=await revision();
   await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:{}}});
   const afterUnattributed=await revision();
   assert.equal(afterUnattributed.scoped,beforeUnattributed.scoped);
   assert.ok(afterUnattributed.tenant>beforeUnattributed.tenant);
  } finally {await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:payment.metadata}});}
  const source=await db.formSubmission.findUniqueOrThrow({where:{id:payment.metadata.formSubmissionId},select:{id:true,verifiedAt:true}});
  await db.$executeRawUnsafe(`INSERT INTO "LiveMetricRegistration" (id,"vendorId","liveId","versionId","submissionId","verifiedAt") VALUES ('order-audit-registration',$1,$2,$3,$4,$5)`,vendor.id,live.id,versionId,source.id,source.verifiedAt);
  await read(async tx=>{
   const page=await service.readMetricOrderAuditPage(tx,{...request,take:500});
   assert.equal(page.rows.length,20);assert.ok(page.rows.every(row=>row.outcome==='matched'));
   assert.equal(page.coverage,'unknown');
  });
  const auditScope={vendorId:vendor.id,liveId:live.id,versionId,startAt:start,endAt:end};
  const summary=await service.auditMetricOrderSources(db,auditScope);
  assert.equal(summary.status,'enumerated');assert.equal(summary.count,20);assert.equal(summary.outcomes.matched,20);
  assert.equal(summary.coverage,'unknown');assert.equal('rows' in summary,false);
  assert.equal((await service.auditMetricOrderSources(db,auditScope)).digest,summary.digest);
  assert.deepEqual(await service.auditMetricOrderSources(db,auditScope,{rows:19,pages:2}),{status:'unavailable',reason:'limit_exceeded'});
  try {
   for(const [metadata,outcome] of [
    [{...payment.metadata,billingPurpose:'subscription'},'other_purpose'],
    [{...payment.metadata,sourceLiveId:'another-synthetic-live'},'other_live'],
   ]) {
    await db.paymentTransaction.update({where:{id:payment.id},data:{metadata}});
    await read(async tx=>{
     const page=await service.readMetricOrderAuditPage(tx,{...request,take:500});
     assert.equal(page.rows.length,20);
     assert.equal(page.rows.filter(row=>row.outcome===outcome).length,1);
     assert.equal(page.rows.filter(row=>row.outcome==='matched').length,19);
    });
   }
  } finally {await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:payment.metadata}});}
  try {
   let observedRevision;
   await read(async tx=>{
    const before=await service.readMetricOrderAuditPage(tx,{...request,take:500});
    observedRevision=before.tenantRevision;
    assert.equal(before.rows.filter(row=>row.outcome==='matched').length,20);
    // A separate committed connection changes attribution while RR stays open.
    await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:{}}});
    const same=await service.readMetricOrderAuditPage(tx,{...request,take:500});
    assert.equal(same.tenantRevision,observedRevision);
    assert.deepEqual(same.rows,before.rows);
    const [current]=await db.$queryRawUnsafe('SELECT public.wp20_metric_order_window_revision($1,$2::timestamptz,$3::timestamptz) AS revision',vendor.id,start,end);
    assert.ok(current.revision>observedRevision);
   });
   await read(async tx=>{
    const next=await service.readMetricOrderAuditPage(tx,{...request,take:500});
    assert.equal(next.status,'available');
    assert.ok(next.tenantRevision>observedRevision);
    assert.equal(next.rows.filter(row=>row.outcome==='missing_attribution').length,1);
    assert.equal(next.rows.filter(row=>row.outcome==='matched').length,19);
   });
  } finally {await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:payment.metadata}});}
  // Run a real cancelled statement through the actual audit boundary. Keep its
  // production 2s timeout; inject only a synthetic slow query in this disposable probe.
  let cancelledStatements=0;
  const slowDatabase={$transaction:(callback,options)=>db.$transaction(tx=>callback({
   $executeRaw:tx.$executeRaw.bind(tx),
   $queryRaw:async query=>{
    if(query.strings.join('').includes('FROM "CommerceOrder" o')) {
     cancelledStatements++;
     await tx.$queryRawUnsafe('SELECT pg_sleep(3)::text');
    }
    return tx.$queryRaw(query);
   },
  }),options)};
  assert.deepEqual(await service.auditMetricOrderSources(slowDatabase,auditScope),
   {status:'unavailable',reason:'query_cancelled'});
  assert.equal(cancelledStatements,1);
  // The cancelled transaction must be gone; a fresh complete audit still works.
  const afterCancellation=await service.auditMetricOrderSources(db,auditScope);
  assert.equal(afterCancellation.status,'enumerated');
  assert.equal(afterCancellation.outcomes.matched,20);
  // Disabling collection preserves historical inventory, but must fence any
  // proof derived from the earlier source revision. Verify across real commits.
  const beforeDisable=await service.auditMetricOrderSources(db,auditScope);
  assert.equal(beforeDisable.status,'enumerated');
  try {
   await db.$executeRawUnsafe('UPDATE "LiveMetricVersion" SET "collectionEnabled"=false WHERE id=$1',versionId);
   const disabled=await service.auditMetricOrderSources(db,auditScope);
   assert.equal(disabled.status,'enumerated');
   assert.ok(disabled.sourceRevision>beforeDisable.sourceRevision);
   assert.notEqual(disabled.digest,beforeDisable.digest);
   assert.equal(disabled.outcomes.matched,20);
   assert.equal(disabled.coverage,'unknown');
  } finally {
   await db.$executeRawUnsafe('UPDATE "LiveMetricVersion" SET "collectionEnabled"=true WHERE id=$1',versionId);
  }
  const reenabled=await service.auditMetricOrderSources(db,auditScope);
  assert.equal(reenabled.status,'enumerated');
  assert.ok(reenabled.sourceRevision>beforeDisable.sourceRevision);
  assert.notEqual(reenabled.digest,beforeDisable.digest);
  const coverageGuard=await verifyOrderCoverageGuard(db,service,auditScope,reenabled);
  const tenantLedgerProtection=await verifyOrderTenantLedger(db,vendor.id);
  return {status:'PASS',coverageGuard,collectionToggleFenced:'PASS',historicalInventoryRetained:'PASS',databaseCancellation:'PASS',recoveryAfterCancellation:'PASS',tenantLedgerProtection,matchedOrders:20,boundedEnumeration:'PASS',unattributedTenantRevision:'PASS',stableDigest:'PASS',tenantSnapshotConcurrency:'PASS',oneContextPerSnapshot:'PASS',overflowRejected:'PASS',readOnlyRequired:true,exclusionsVisible:true,sourceOrders:20,missingProjectionsVisible:true,missingAttributionVisible:true,foreignScopeRejected:true,pagination:'PASS',coverage:'unknown'};
 } finally {await db.$executeRawUnsafe('DELETE FROM "LiveMetricVersion" WHERE id=$1',versionId);}
}
