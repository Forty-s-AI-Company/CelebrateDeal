import { verifyCompletionPublish } from "./wp20-completion-publish-probe.mjs";
import assert from "node:assert/strict";

/** Each case rolls back all synthetic source mutations after proving real ready-reader invalidation. */
export async function verifyMetricSourceInvalidation(db, service, fixture) {
  const results=[];
  for(const field of ["verificationStatus","verifiedAt","formId","liveId","liveFormId"]) {
    const rollback=new Error("synthetic-source-rollback");
    try {
      await db.$transaction(async tx=>{
        const {vendor,live,video,submission}=fixture;
        const [clock]=await tx.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
        const verified=new Date(+clock.now-10000),start=new Date(+clock.now-20000),end=new Date(+clock.now-1000),expires=new Date(+clock.now+3600000);
        await tx.formSubmission.update({where:{id:submission.id},data:{verifiedAt:verified}});
        await tx.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"collectionEnabled","collectionStartedAt","expiresAt") VALUES ('source-matrix-version',$1,$2,$3,'live',$4,true,$5,$6)`,vendor.id,live.id,video.id,"b".repeat(64),start,expires);
        await tx.$executeRawUnsafe(`INSERT INTO "LiveMetricRegistration" (id,"vendorId","liveId","versionId","submissionId","verifiedAt") VALUES ('source-matrix-registration',$1,$2,'source-matrix-version',$3,$4)`,vendor.id,live.id,submission.id,verified);
        const sourceRevision=async()=> (await tx.$queryRawUnsafe(`SELECT public.wp20_metric_registration_revision($1,$2) AS revision`,vendor.id,live.id))[0].revision;
        const beforeUncaptured=await sourceRevision();
        const uncaptured=await tx.formSubmission.create({data:{formId:submission.formId,liveId:live.id,name:"Synthetic uncaptured",email:"uncaptured@example.test",verificationStatus:"VERIFIED",verifiedAt:verified}});
        assert.ok(await sourceRevision()>beforeUncaptured);
        const beforeDelete=await sourceRevision();
        await tx.formSubmission.delete({where:{id:uncaptured.id}});
        assert.ok(await sourceRevision()>beforeDelete);
        const [version]=await tx.$queryRawUnsafe(`SELECT "sourceRevision" AS revision FROM "LiveMetricVersion" WHERE id='source-matrix-version'`);
        const lease={vendorId:vendor.id,liveId:live.id,versionId:"source-matrix-version",reportId:"source-matrix-report",workerId:"source-matrix-worker"};
        await tx.$queryRawUnsafe('SELECT public.wp20_metric_report_create($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7::bigint,$8::timestamptz)',vendor.id,live.id,lease.versionId,lease.reportId,start,end,version.revision,expires);
        assert.equal(await service.claimMetricReport(tx,lease),true);
        await verifyCompletionPublish(tx,lease,version.revision,verified);
        const metric={status:"unavailable",reason:"missing_data"};
        const aggregate={registrationRate:metric,attendanceRate:metric,completionRate:metric,averageViewingSeconds:metric,postCompletionOrderRate:metric,unattributedRegistrations:null,provisionalConversions:null};
        assert.equal(await service.finishMetricReport(tx,lease,aggregate),true);
        const scope={vendorId:lease.vendorId,liveId:lease.liveId,versionId:lease.versionId,reportId:lease.reportId};
        assert.equal((await service.readMetricReadyReport(tx,scope)).status,"available");
        await tx.$executeRawUnsafe("SAVEPOINT uncaptured_report_probe");
        await tx.formSubmission.create({data:{formId:submission.formId,liveId:live.id,name:"Synthetic late source",email:"late-source@example.test",verificationStatus:"VERIFIED",verifiedAt:verified}});
        assert.deepEqual(await service.readMetricReadyReport(tx,scope),{status:"unavailable",reason:"report_not_current"});
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT uncaptured_report_probe");
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT uncaptured_report_probe");
        assert.equal((await service.readMetricReadyReport(tx,scope)).status,"available");
        if(field==="liveFormId") await tx.live.update({where:{id:live.id},data:{formId:null}});
        else if(field==="formId") {
          const replacement=await tx.registrationForm.create({data:{vendorId:vendor.id,name:"Synthetic replacement",slug:"source-matrix-replacement",headline:"Synthetic",fields:[]}});
          await tx.formSubmission.update({where:{id:submission.id},data:{formId:replacement.id}});
        } else await tx.formSubmission.update({where:{id:submission.id},data:field==="verificationStatus"?{verificationStatus:"UNVERIFIED"}:field==="verifiedAt"?{verifiedAt:new Date(+verified+1)}:{liveId:null}});
        assert.deepEqual(await service.readMetricReadyReport(tx,scope),{status:"unavailable",reason:"report_not_current"});
        results.push({field,status:"PASS",completionPublish:"PASS",uncapturedSourceRevision:"PASS",uncapturedReadyReportInvalidation:"PASS"});
        throw rollback;
      },{timeout:15000});
    }catch(error){if(error!==rollback)throw error;}
  }
  return results;
}
