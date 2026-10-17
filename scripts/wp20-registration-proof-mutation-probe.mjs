import assert from 'node:assert/strict';
/** Fixed SQL probes run only on the synthetic matched fixture; every change rolls back. */
export async function verifyRegistrationProofMutations(db,versionId,submissionId) {
 const probes=[
  ['registration-scope-update','UPDATE "LiveMetricRegistration" SET "liveId"=\'foreign-scope\' WHERE "submissionId"=$1','23514'],
  ['capture-update','UPDATE "LiveMetricRegistrationCapture" SET "versionId"="versionId" WHERE "submissionId"=$1','23514'],
  ['capture-duplicate','INSERT INTO "LiveMetricRegistrationCapture" SELECT * FROM "LiveMetricRegistrationCapture" WHERE "submissionId"=$1','23505'],
  ['registration-duplicate',`INSERT INTO "LiveMetricRegistration" (id,"vendorId","liveId","versionId","submissionId","verifiedAt") SELECT 'duplicate-probe',"vendorId","liveId","versionId","submissionId","verifiedAt" FROM "LiveMetricRegistration" WHERE "submissionId"=$1`,'23505'],
 ];
 for(const [name,sql,expected] of probes){
  let code=null;
  await assert.rejects(db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SAVEPOINT mutation_probe');
   // Initial capture accepts only UNVERIFIED sources. Satisfy that guard
   // within the rolled-back probe so the duplicate reaches the unique key.
   if(name==='capture-duplicate') await tx.$executeRawUnsafe('UPDATE "FormSubmission" SET "verificationStatus"=$2::"FormSubmissionVerificationStatus" WHERE id=$1',submissionId,'UNVERIFIED');
   try{await tx.$executeRawUnsafe(sql,submissionId);}catch(error){code=error?.meta?.code;}
   await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT mutation_probe');
   throw new Error('mutation-probe-rollback');
  }),{message:'mutation-probe-rollback'});
  console.log(JSON.stringify({probe:name,sqlState:/^[0-9A-Z]{5}$/.test(code??'')?code:null,expected}));
  assert.equal(code,expected);
 }
 let invalidated=false;
 await assert.rejects(db.$transaction(async tx=>{
  const [before]=await tx.$queryRawUnsafe('SELECT public.wp20_metric_registration_revision("vendorId","liveId") AS "sourceRevision" FROM "LiveMetricVersion" WHERE id=$1',versionId);
  const removed=await tx.$executeRawUnsafe('DELETE FROM "LiveMetricRegistration" WHERE "submissionId"=$1',submissionId);
  const [after]=await tx.$queryRawUnsafe('SELECT public.wp20_metric_registration_revision("vendorId","liveId") AS "sourceRevision" FROM "LiveMetricVersion" WHERE id=$1',versionId);
  invalidated=removed===1 && after.sourceRevision>before.sourceRevision;
  throw new Error('mutation-probe-rollback');
 }),{message:'mutation-probe-rollback'});
 console.log(JSON.stringify({probe:'projection-delete',invalidated}));
 assert.equal(invalidated,true);
 return {status:'PASS',captureImmutable:'PASS',captureUnique:'PASS',registrationUnique:'PASS',projectionDeleteInvalidates:'PASS'};
}
