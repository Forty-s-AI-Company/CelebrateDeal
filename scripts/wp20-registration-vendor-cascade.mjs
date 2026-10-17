import assert from 'node:assert/strict';
/** Own synthetic vendor only. The enclosing disposable runner destroys the DB on failure. */
export async function verifyRegistrationVendorCascade(db) {
 const vendor=await db.vendor.create({data:{name:'Synthetic cascade',slug:'registration-cascade',email:'cascade@example.test',passwordHash:'synthetic-unused'}});
 const video=await db.video.create({data:{vendorId:vendor.id,title:'Synthetic',videoUrl:'https://example.test/cascade.mp4',durationSec:100}});
 const form=await db.registrationForm.create({data:{vendorId:vendor.id,name:'Synthetic',slug:'registration-cascade',headline:'Synthetic',fields:[]}});
 const live=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,formId:form.id,title:'Synthetic',slug:'registration-cascade',scheduledAt:new Date()}});
 const [clock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
 const start=new Date(+clock.now-10000),end=new Date(+clock.now-1000),expiry=new Date(+clock.now+3600000),versionId='vendor-cascade-version';
 await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"collectionEnabled","collectionStartedAt","expiresAt") VALUES ($1,$2,$3,$4,'live',$5,true,$6,$7)`,versionId,vendor.id,live.id,video.id,'e'.repeat(64),start,expiry);
 const submission=await db.formSubmission.create({data:{formId:form.id,liveId:live.id,name:'Synthetic',email:'cascade-source@example.test',verificationStatus:'UNVERIFIED'}});
 await db.$executeRawUnsafe(`INSERT INTO "LiveMetricRegistrationCapture" ("submissionId","vendorId","liveId","versionId") VALUES ($1,$2,$3,$4)`,submission.id,vendor.id,live.id,versionId);
 const verifiedAt=new Date(+clock.now-5000);
 await db.formSubmission.update({where:{id:submission.id},data:{verificationStatus:'VERIFIED',verifiedAt}});
 await db.$executeRawUnsafe(`INSERT INTO "LiveMetricRegistration" (id,"vendorId","liveId","versionId","submissionId","verifiedAt") VALUES ('vendor-cascade-registration',$1,$2,$3,$4,$5)`,vendor.id,live.id,versionId,submission.id,verifiedAt);
 const [v]=await db.$queryRawUnsafe('SELECT "sourceRevision" FROM "LiveMetricVersion" WHERE id=$1',versionId);
 await db.$queryRawUnsafe('SELECT public.wp20_metric_report_create($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7::bigint,$8::timestamptz)',vendor.id,live.id,versionId,'vendor-cascade-report',start,end,v.sourceRevision,expiry);
 const [before]=await db.$queryRawUnsafe('SELECT COUNT(*)::integer AS count FROM "LiveMetricRegistrationSource" WHERE "vendorId"=$1',vendor.id);
 assert.ok(before.count>=2);
 await db.vendor.delete({where:{id:vendor.id}});
 for(const table of ['LiveMetricRegistrationSource','LiveMetricVersion','LiveMetricRegistration','LiveMetricRegistrationCapture','LiveMetricReport']) {
  const [remaining]=await db.$queryRawUnsafe(`SELECT COUNT(*)::integer AS count FROM "${table}" WHERE "vendorId"=$1`,vendor.id);
  assert.equal(remaining.count,0);
 }
 assert.equal(await db.formSubmission.count({where:{id:submission.id}}),0);
 assert.equal(await db.live.count({where:{id:live.id}}),0);
 return {status:'PASS',vendorDeleted:true,metricOrphans:0,sourceOrphans:0};
}
