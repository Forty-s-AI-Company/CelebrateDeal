import { verifyRegistrationProofMutations } from "./wp20-registration-proof-mutation-probe.mjs";
import assert from 'node:assert/strict';
/** Exercise the real lifecycle with an isolated synthetic live, not forged audit rows. */
export async function verifyMatchedRegistrationAudit(db, service, vendor) {
 const form=await db.registrationForm.create({data:{vendorId:vendor.id,name:'Synthetic matched audit',slug:'matched-audit',headline:'Synthetic',fields:[]}});
 const video=await db.video.create({data:{vendorId:vendor.id,title:'Synthetic matched audit',videoUrl:'https://example.test/matched.mp4',durationSec:100}});
 const [clock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
 const start=new Date(+clock.now-1000),expires=new Date(+clock.now+3600000);
 const live=await db.live.create({data:{vendorId:vendor.id,formId:form.id,videoId:video.id,title:'Synthetic matched audit',slug:'matched-audit',scheduledAt:start}});
 const versionId='matched-audit-version';
 let phase='setup',raceAuditReason=null;
 try {
  await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"collectionEnabled","collectionStartedAt","expiresAt") VALUES ($1,$2,$3,$4,'live',$5,true,$6,$7)`,versionId,vendor.id,live.id,video.id,'d'.repeat(64),start,expires);
  // An audited empty source is distinguishable from missing historical evidence.
  const [emptyClock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
  const emptyScope={vendorId:vendor.id,liveId:live.id,versionId,startAt:start,endAt:emptyClock.now};
  phase='empty-proof';
  const emptyProof=await service.publishRegistrationCoverage(db,emptyScope);
  assert.equal(emptyProof.status,'recorded');
  const [emptyRow]=await db.$queryRawUnsafe('SELECT "registrationCount" FROM "LiveMetricCoverageAudit" WHERE id=$1',emptyProof.proofId);
  assert.equal(emptyRow.registrationCount,0);
  phase='matched-source';
  const submission=await db.formSubmission.create({data:{formId:form.id,liveId:live.id,name:'Synthetic',email:'matched@example.test',verificationStatus:'UNVERIFIED'}});
  await db.$executeRawUnsafe(`INSERT INTO "LiveMetricRegistrationCapture" ("submissionId","vendorId","liveId","versionId") VALUES ($1,$2,$3,$4)`,submission.id,vendor.id,live.id,versionId);
  const [verified]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
  await db.formSubmission.update({where:{id:submission.id},data:{verificationStatus:'VERIFIED',verifiedAt:verified.now}});
  await db.$executeRawUnsafe(`INSERT INTO "LiveMetricRegistration" (id,"vendorId","liveId","versionId","submissionId","verifiedAt") VALUES ('matched-audit-registration',$1,$2,$3,$4,$5)`,vendor.id,live.id,versionId,submission.id,verified.now);
  // Let DB time move beyond the verified timestamp before closing the half-open window.
  await db.$executeRawUnsafe('DO $$ BEGIN PERFORM pg_sleep(0.005); END $$');
  const [end]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
  const scope={vendorId:vendor.id,liveId:live.id,versionId,startAt:start,endAt:end.now};
  const result=await service.auditMetricRegistrationSources(db,scope);
  assert.equal(result.status,'enumerated');assert.equal(result.count,1);assert.equal(result.projectionCount,1);
  assert.equal(result.outcomes.matched,1);assert.equal(result.projectionOutcomes.matched,1);
  assert.equal(Object.values(result.outcomes).reduce((a,b)=>a+b,0),1);
  assert.equal(Object.values(result.projectionOutcomes).reduce((a,b)=>a+b,0),1);
  assert.equal(result.coverage,'unknown');
  const repeated=await service.auditMetricRegistrationSources(db,scope);
  assert.equal(repeated.digest,result.digest);
  // Force a committed source change after the audit snapshot closes and before
  // the publisher starts its write transaction. This is a real DB race boundary.
  let transactions=0;
  const racingDb={$transaction:async (callback,options)=>{
   const answer=await db.$transaction(callback,options);
   if(transactions===0&&answer?.status==='unavailable') raceAuditReason=answer.reason;
   if (++transactions===1) await db.formSubmission.update({where:{id:submission.id},data:{verificationStatus:'UNVERIFIED'}});
   return answer;
  }};
  phase='race-count';
  const proofCount=async()=>{const [row]=await db.$queryRawUnsafe('SELECT COUNT(*)::integer AS count FROM "LiveMetricCoverageAudit" WHERE "versionId"=$1',versionId);return row.count;};
  const countBeforeRace=await proofCount();
  phase='race-publish';
  assert.deepEqual(await service.publishRegistrationCoverage(racingDb,scope),{status:'source_changed'});
  assert.equal(await proofCount(),countBeforeRace);
  await db.formSubmission.update({where:{id:submission.id},data:{verificationStatus:'VERIFIED'}});
  phase='post-race-publish';
  // Commit a new authoritative source after the publisher's revision SELECT,
  // immediately before INSERT; the DB guard must reject it without leaking an error.
  let injected=false;
  const insertRaceDb={$transaction:(callback,options)=>db.$transaction(tx=>callback(new Proxy(tx,{
   get(target,key){
    if(key==='$queryRaw') return async query=>{
     if(!injected && query.strings.join('').includes('INSERT INTO "LiveMetricCoverageAudit"')){
      injected=true;
      await db.formSubmission.create({data:{formId:form.id,liveId:live.id,name:'Synthetic race',email:'race@example.test',verificationStatus:'VERIFIED',verifiedAt:verified.now}});
     }
     return target.$queryRaw(query);
    };
    const member=Reflect.get(target,key);return typeof member==='function'?member.bind(target):member;
   }
  })),options)};
  const beforeInsertRace=await proofCount();
  assert.deepEqual(await service.publishRegistrationCoverage(insertRaceDb,scope),{status:'source_changed'});
  assert.equal(injected,true);assert.equal(await proofCount(),beforeInsertRace);
  await db.formSubmission.deleteMany({where:{liveId:live.id,email:'race@example.test'}});
  const proof=await service.publishRegistrationCoverage(db,scope);
  assert.equal(proof.status,'recorded');
  assert.deepEqual(await service.publishRegistrationCoverage(db,scope),proof);
  const mutationProtection=await verifyRegistrationProofMutations(db,versionId,submission.id);
  phase='coverage-read';
  const coverage=async id=>{
   const [v]=await db.$queryRawUnsafe('SELECT "sourceRevision" FROM "LiveMetricVersion" WHERE id=$1',versionId);
   const lease={vendorId:vendor.id,liveId:live.id,versionId,reportId:id,workerId:'matched-audit-worker'};
   await db.$queryRawUnsafe('SELECT public.wp20_metric_report_create($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7::bigint,$8::timestamptz)',vendor.id,live.id,versionId,id,start,end.now,v.sourceRevision,expires);
   assert.equal(await service.claimMetricReport(db,lease),true);
   return db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return service.readMetricCoverage(tx,lease,'registrations');
   },{isolationLevel:'RepeatableRead',timeout:10000});
  };
  assert.deepEqual((await coverage('matched-audit-before-revoke')).coverage,{status:'complete'});
  // Commit a projection deletion, then create a fresh report. Invalidating only
  // the old report is insufficient: the new reader must reject the old proof.
  assert.equal(await db.$executeRawUnsafe('DELETE FROM "LiveMetricRegistration" WHERE id=$1','matched-audit-registration'),1);
  assert.deepEqual((await coverage('matched-audit-after-projection-delete')).coverage,{status:'unavailable',reason:'unknown_history'});
  assert.deepEqual(await service.publishRegistrationCoverage(db,scope),{status:'incomplete'});
  await db.$executeRawUnsafe(`INSERT INTO "LiveMetricRegistration" (id,"vendorId","liveId","versionId","submissionId","verifiedAt") VALUES ('matched-audit-registration',$1,$2,$3,$4,$5)`,vendor.id,live.id,versionId,submission.id,verified.now);
  // Recreating facts does not revive the previous proof; a new audit is required.
  assert.deepEqual((await coverage('matched-audit-after-projection-recreate')).coverage,{status:'unavailable',reason:'unknown_history'});
  const refreshedProof=await service.publishRegistrationCoverage(db,scope);
  assert.equal(refreshedProof.status,'recorded');assert.notEqual(refreshedProof.proofId,proof.proofId);
  // Retire the existing synthetic report before making another report for the same window.
  await db.$executeRawUnsafe('UPDATE "LiveMetricReport" SET status=$2,result=NULL,"leaseOwner"=NULL,"leaseExpiresAt"=NULL WHERE id=$1','matched-audit-after-projection-recreate','stale');
  assert.deepEqual((await coverage('matched-audit-after-proof-refresh')).coverage,{status:'complete'});
  // Current source identity changes must make the persisted projection visibly invalid.
  await db.formSubmission.update({where:{id:submission.id},data:{verificationStatus:'UNVERIFIED'}});
  const changed=await service.auditMetricRegistrationSources(db,scope);
  assert.equal(changed.status,'enumerated');assert.equal(changed.count,0);
  assert.equal(changed.projectionCount,1);assert.equal(changed.projectionOutcomes.invalid_source,1);
  assert.ok(changed.registrationRevision>result.registrationRevision);
  assert.notEqual(changed.digest,result.digest);
  assert.deepEqual(await service.publishRegistrationCoverage(db,scope),{status:'incomplete'});
  assert.deepEqual((await coverage('matched-audit-after-revoke')).coverage,{status:'unavailable',reason:'unknown_history'});
  return {status:'PASS',mutationProtection,matchedBothDirections:'PASS',stableDigest:'PASS',revokedSourceDetected:'PASS',privateProofPublish:'PASS',emptySourceProof:'PASS',auditToPublishRace:'PASS',revisionToInsertRace:'PASS',staleProofRejected:'PASS',projectionProofLifecycle:'PASS',coverage:'complete before revoke; unknown after revoke'};
 } catch(error) { error.auditPhase=phase; error.auditReason=raceAuditReason; throw error; } finally {
  await db.$executeRawUnsafe('DELETE FROM "LiveMetricVersion" WHERE id=$1',versionId);
  await db.live.delete({where:{id:live.id}});
  await db.registrationForm.delete({where:{id:form.id}});
  await db.video.delete({where:{id:video.id}});
 }
}
