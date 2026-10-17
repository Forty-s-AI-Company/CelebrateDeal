import assert from 'node:assert/strict';
/** Real independent connections, synthetic sources, all triggers enabled. */
export async function verifyRegistrationSourceConcurrency(db, service, fixture) {
 const {vendor,video}=fixture;
 // Own the live/form: the payment fixture already has a verified submission.
 // A moving wall-clock window must not intermittently include that other source.
 const form=await db.registrationForm.create({data:{vendorId:vendor.id,name:'Synthetic source race',slug:'registration-source-race',headline:'Synthetic',fields:[]}});
 const live=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,formId:form.id,title:'Synthetic source race',slug:'registration-source-race',scheduledAt:new Date()}});
 const [clock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
 const start=new Date(+clock.now-20000),end=new Date(+clock.now-1000),verifiedAt=new Date(+clock.now-10000);
 const versionId='registration-race-version',ids=[];
 await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"collectionEnabled","collectionStartedAt","expiresAt") VALUES ($1,$2,$3,$4,'live',$5,true,$6,$7)`,versionId,vendor.id,live.id,video.id,'c'.repeat(64),start,new Date(+clock.now+3600000));
 const revision=async client=>(await client.$queryRawUnsafe('SELECT public.wp20_metric_registration_revision($1,$2) AS revision',vendor.id,live.id))[0].revision;
 const create=async i=>{
  const id=`registration-race-${i}`;ids.push(id);
  return db.formSubmission.create({data:{id,formId:form.id,liveId:live.id,name:'Synthetic',email:`race-${i}@example.test`,verificationStatus:'VERIFIED',verifiedAt}});
 };
 try {
  // Separate disposable connection establishment from the concurrent write
  // contract. Both phases must succeed 20/20; no retry or dropped operations.
  const connections=await Promise.allSettled(Array.from({length:20},()=>
   db.$queryRawUnsafe('SELECT pg_sleep(0.05)::text AS warmed')));
  const failedConnections=connections.filter(result=>result.status==='rejected');
  if(failedConnections.length) {
   const error=new Error('Synthetic connection preflight failed');
   error.concurrentCodes=failedConnections.map(result=>{
    const code=result.reason?.meta?.code??result.reason?.code;
    return /^(?:P\d{4}|[0-9A-Z]{5})$/.test(code??'')?code:'UNKNOWN';
   });
   throw error;
  }
  assert.equal(connections.length,20);
  const before=await revision(db),started=performance.now();
  const results=await Promise.allSettled(Array.from({length:20},(_,i)=>create(i)));
  try { assert.equal(results.filter(x=>x.status==='fulfilled').length,20); }
  catch(error) {
   error.concurrentCodes=results.filter(x=>x.status==='rejected').map(x=>{
    const code=x.reason?.meta?.code??x.reason?.code;
    return /^(?:P\d{4}|[0-9A-Z]{5})$/.test(code??'')?code:'UNKNOWN';
   });
   throw error;
  }
  assert.equal(await revision(db),before+BigInt(20));
  const concurrentMs=Math.round(performance.now()-started);
  const request={vendorId:vendor.id,liveId:live.id,versionId,startAt:start,endAt:end,afterSubmissionId:null,take:500};
  await db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
   const old=await service.readRegistrationAuditPage(tx,request);
   assert.equal(old.status,'available');assert.equal(old.rows.length,20);
   await create(20);
   const same=await service.readRegistrationAuditPage(tx,request);
   assert.equal(same.registrationRevision,old.registrationRevision);assert.equal(same.rows.length,20);
   assert.ok(await revision(db)>old.registrationRevision);
  },{isolationLevel:'RepeatableRead',timeout:15000});
  await db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
   const fresh=await service.readRegistrationAuditPage(tx,request);
   assert.equal(fresh.status,'available');assert.equal(fresh.rows.length,21);
  },{isolationLevel:'RepeatableRead',timeout:15000});
  await db.$executeRawUnsafe(`INSERT INTO "LiveMetricRegistration" (id,"vendorId","liveId","versionId","submissionId","verifiedAt") VALUES ('registration-race-projection',$1,$2,$3,'registration-race-0',$4)`,vendor.id,live.id,versionId,verifiedAt);
  await db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
   const reverse=await service.readRegistrationProjectionAuditPage(tx,request);
   assert.equal(reverse.status,'available');
   assert.deepEqual(reverse.rows,[{registrationId:'registration-race-projection',outcome:'registration_without_capture'}]);
  },{isolationLevel:'RepeatableRead',timeout:15000});
  const summary=await service.auditMetricRegistrationSources(db,{vendorId:vendor.id,liveId:live.id,versionId,startAt:start,endAt:end});
  assert.equal(summary.status,'enumerated');assert.equal(summary.count,21);
  assert.equal(summary.projectionCount,1);assert.equal(summary.projectionOutcomes.registration_without_capture,1);
  assert.equal(summary.coverage,'unknown');
  const replacement=await db.registrationForm.create({data:{vendorId:vendor.id,name:'Synthetic replacement',slug:'registration-race-replacement',headline:'Synthetic',fields:[]}});
  try {
   await db.live.update({where:{id:live.id},data:{formId:replacement.id}});
   await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const changed=await service.readRegistrationAuditPage(tx,request);
    assert.equal(changed.status,'available');assert.equal(changed.rows.length,21);
    assert.ok(changed.rows.every(row=>row.outcome==='form_mismatch'));
    const reverse=await service.readRegistrationProjectionAuditPage(tx,request);
    assert.equal(reverse.status,'available');
    assert.deepEqual(reverse.rows,[{registrationId:'registration-race-projection',outcome:'invalid_source'}]);
   },{isolationLevel:'RepeatableRead',timeout:15000});
  } finally {
   await db.live.update({where:{id:live.id},data:{formId:form.id}});
   await db.registrationForm.delete({where:{id:replacement.id}});
  }
  return {status:'PASS',submitted:20,committed:20,concurrentMs,snapshotIsolation:'PASS',nextSnapshotSeesLateSource:'PASS',oldFormRowsRemainVisible:'PASS',reverseProjectionAudit:'PASS',bidirectionalSummary:'PASS',scope:'ReadCommitted concurrent calls; not synchronized Serializable payment acceptance'};
 } finally {
  await db.formSubmission.deleteMany({where:{id:{in:ids}}});
  await db.$executeRawUnsafe('DELETE FROM "LiveMetricVersion" WHERE id=$1',versionId);
  await db.live.delete({where:{id:live.id}});
  await db.registrationForm.delete({where:{id:form.id}});
 }
}
