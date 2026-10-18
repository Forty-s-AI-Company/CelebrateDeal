import { beforeEach,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({getDb:vi.fn(),find:vi.fn(),claim:vi.fn(),dispatch:vi.fn(),proofFind:vi.fn(),proofClaim:vi.fn(),proofDispatch:vi.fn(),sourceFind:vi.fn(),materialize:vi.fn(),sourceFailure:vi.fn(),capture:vi.fn(),count:vi.fn()}));
vi.mock("./db",()=>({getDb:mocks.getDb}));
vi.mock("./monitoring",()=>({captureOperationalError:mocks.capture}));
vi.mock("./learner-notification-outbox",()=>({claimLearnerNotification:mocks.claim}));
vi.mock("./learner-notification-dispatch",()=>({dispatchClaimedLearnerNotification:mocks.dispatch}));
vi.mock("./learner-verification-delivery",()=>({claimLearnerVerificationDelivery:mocks.proofClaim,dispatchLearnerVerificationDelivery:mocks.proofDispatch}));
vi.mock("./learner-notification-source-events",()=>({materializeLearnerNotificationSourceEvent:mocks.materialize,recordLearnerNotificationSourceFailure:mocks.sourceFailure}));
import { fairVendorBatch,LEARNER_NOTIFICATION_JOB_LIMITS,processDueLearnerNotifications,readLearnerNotificationProviderConfiguration } from "./learner-notification-job";
const db={learnerNotificationSourceEvent:{findMany:mocks.sourceFind,count:mocks.count},learnerNotificationDelivery:{findMany:mocks.find,count:mocks.count},learnerNotificationVerification:{findMany:mocks.proofFind,count:mocks.count}};
const env:NodeJS.ProcessEnv={NODE_ENV:"test",NEXT_PUBLIC_APP_URL:"https://app.example.test",LEARNER_NOTIFICATIONS_EXECUTOR_ENABLED:"true",LEARNER_NOTIFICATIONS_JOB_VENDOR_IDS:"vendor-1,vendor-2",RESEND_API_KEY:"synthetic-provider-credential",EMAIL_FROM:"synthetic@invalid.example"};
type Row={vendorId:string;id:string};
const forVendor=(rows:Record<string,Row[]>)=>async({where}:{where:{vendorId:string}})=>rows[where.vendorId]??[];
beforeEach(()=>{vi.clearAllMocks();mocks.sourceFind.mockResolvedValue([]);mocks.materialize.mockResolvedValue({status:"completed"});mocks.proofFind.mockResolvedValue([]);mocks.proofClaim.mockResolvedValue(null);mocks.getDb.mockReturnValue(db);mocks.count.mockResolvedValue(0);
 mocks.find.mockImplementation(forVendor({"vendor-1":[{vendorId:"vendor-1",id:"delivery-1"}]}));mocks.claim.mockResolvedValue({claimToken:"a".repeat(43)});mocks.dispatch.mockResolvedValue({status:"sent",providerReceipt:"private-provider-receipt"});});
it("disabled executor never reads the database or dispatches",async()=>{
 expect(await processDueLearnerNotifications({...env,LEARNER_NOTIFICATIONS_EXECUTOR_ENABLED:"false"})).toEqual({results:[],backlog:null});expect(mocks.getDb).not.toHaveBeenCalled();expect(mocks.dispatch).not.toHaveBeenCalled();
});
it.each(["","foreign/id",Array.from({length:26},(_,i)=>`vendor-${i}`).join(",")])("rejects invalid or excessive approved tenant scope %s",async vendors=>{
 expect(await processDueLearnerNotifications({...env,LEARNER_NOTIFICATIONS_JOB_VENDOR_IDS:vendors})).toEqual({results:[{status:"configuration_missing"}],backlog:null});expect(mocks.getDb).not.toHaveBeenCalled();
});
it("absent configured provider never consumes a queue attempt",async()=>{
 expect(await processDueLearnerNotifications({...env,RESEND_API_KEY:undefined,EMAIL_FROM:undefined})).toEqual({results:[{status:"configuration_missing"}],backlog:null});expect(mocks.claim).not.toHaveBeenCalled();expect(mocks.getDb).not.toHaveBeenCalled();
});
it("never derives message links from an untrusted request host or HTTP origin",async()=>{
 expect(await processDueLearnerNotifications({...env,NEXT_PUBLIC_APP_URL:"http://127.0.0.1"})).toEqual({results:[{status:"configuration_missing"}],backlog:null});expect(mocks.getDb).not.toHaveBeenCalled();
});
it("reads each approved tenant's due queue separately with the configured channels only",async()=>{
 const summary=await processDueLearnerNotifications(env);expect(summary.results).toEqual([{status:"sent"}]);
 for(const vendorId of ["vendor-1","vendor-2"])expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({vendorId,status:"queued",preference:{is:{channel:{in:["email"]}}}}),take:LEARNER_NOTIFICATION_JOB_LIMITS.deliveries.perVendor,select:{vendorId:true,id:true}}));
 expect(mocks.claim).toHaveBeenCalledWith(db,"vendor-1","delivery-1");
 expect(mocks.dispatch).toHaveBeenCalledWith(db,{vendorId:"vendor-1",id:"delivery-1",claimToken:"a".repeat(43)},expect.objectContaining({appOrigin:"https://app.example.test"}));
});
it("another worker claim is never replaced with a latest recipient",async()=>{
 mocks.claim.mockResolvedValue(null);expect((await processDueLearnerNotifications(env)).results).toEqual([{status:"claimed_elsewhere"}]);expect(mocks.dispatch).not.toHaveBeenCalled();
});
it("a failing selection returns closed metadata and does not stop the other phases",async()=>{
 mocks.sourceFind.mockRejectedValue(new Error("private-contact-or-credential"));
 const summary=await processDueLearnerNotifications(env);
 expect(summary.results).toEqual([{status:"failed"},{status:"sent"}]);expect(JSON.stringify(summary)).not.toContain("private");
 expect(mocks.capture).toHaveBeenCalledWith(expect.any(Error),{source:"learner_notification_job",operation:"select_sources",status:"failed"});
});
it("a poison source backs off without blocking other tenants, proofs or deliveries",async()=>{
 mocks.sourceFind.mockImplementation(forVendor({"vendor-1":[{vendorId:"vendor-1",id:"poison"}],"vendor-2":[{vendorId:"vendor-2",id:"healthy"}]}));
 mocks.materialize.mockImplementation(async(_db:unknown,_vendor:string,id:string)=>{if(id==="poison")throw new Error("private payload corruption");return {status:"completed"};});
 mocks.sourceFailure.mockResolvedValue("retry_scheduled");
 const summary=await processDueLearnerNotifications(env);
 expect(summary.results).toEqual([{status:"retry_scheduled"},{status:"completed"},{status:"sent"}]);
 expect(mocks.sourceFailure).toHaveBeenCalledWith(db,"vendor-1","poison");
 expect(mocks.capture).toHaveBeenCalledWith(expect.any(Error),{source:"learner_notification_job",operation:"materialize_source",status:"retry_scheduled"});
 for(const vendorId of ["vendor-1","vendor-2"])expect(mocks.sourceFind).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({vendorId,completedAt:null,deadLetteredAt:null,OR:[{nextAttemptAt:null},{nextAttemptAt:{lte:expect.any(Date)}}]})}));
});
it("a dead-lettered source reports its terminal status",async()=>{
 mocks.sourceFind.mockImplementation(forVendor({"vendor-1":[{vendorId:"vendor-1",id:"poison"}]}));mocks.materialize.mockRejectedValue(new Error("synthetic"));mocks.sourceFailure.mockResolvedValue("dead_lettered");
 expect((await processDueLearnerNotifications(env)).results[0]).toEqual({status:"dead_lettered"});
});
it("a throwing dispatch is isolated to its own delivery",async()=>{
 mocks.find.mockImplementation(forVendor({"vendor-1":[{vendorId:"vendor-1",id:"delivery-1"}],"vendor-2":[{vendorId:"vendor-2",id:"delivery-2"}]}));
 mocks.dispatch.mockImplementation(async(_db:unknown,{id}:{id:string})=>{if(id==="delivery-1")throw new Error("private");return {status:"sent"};});
 expect((await processDueLearnerNotifications(env)).results.map(row=>row.status).sort()).toEqual(["failed","sent"]);
});
it("spent invocation budget never claims another delivery",async()=>{
 const clock=vi.spyOn(Date,"now").mockReturnValue(20000);clock.mockReturnValueOnce(0);
 try{expect((await processDueLearnerNotifications(env)).results).toEqual([]);expect(mocks.claim).not.toHaveBeenCalled();expect(mocks.dispatch).not.toHaveBeenCalled();}
 finally{clock.mockRestore();}
});
it("drains challenges in their own vendor-fair batch through the same approved tenant/provider boundary",async()=>{
 mocks.proofFind.mockImplementation(forVendor({"vendor-2":[{vendorId:"vendor-2",id:"proof-1"}]}));mocks.proofClaim.mockResolvedValue({vendorId:"vendor-2",id:"proof-1",claimToken:"b".repeat(43)});mocks.proofDispatch.mockResolvedValue({status:"sent"});
 expect((await processDueLearnerNotifications(env)).results).toEqual([{status:"sent"},{status:"sent"}]);
 expect(mocks.proofFind).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({vendorId:"vendor-2",deliveryStatus:"queued",deliveryAttemptCount:0,preference:{is:{channel:{in:["email"]}}}}),take:LEARNER_NOTIFICATION_JOB_LIMITS.proofs.perVendor,select:{vendorId:true,id:true}}));
 expect(mocks.proofDispatch).toHaveBeenCalledWith(db,{vendorId:"vendor-2",id:"proof-1",claimToken:"b".repeat(43)},expect.objectContaining({appOrigin:"https://app.example.test"}));
});
it("claimed challenge is never replaced or replayed",async()=>{
 mocks.proofFind.mockImplementation(forVendor({"vendor-2":[{vendorId:"vendor-2",id:"proof-1"}]}));
 expect((await processDueLearnerNotifications(env)).results).toEqual([{status:"claimed_elsewhere"},{status:"sent"}]);expect(mocks.proofDispatch).not.toHaveBeenCalled();
});
it("one tenant's large proof backlog cannot starve another tenant",async()=>{
 const flood=Array.from({length:LEARNER_NOTIFICATION_JOB_LIMITS.proofs.perVendor},(_,i)=>({vendorId:"vendor-1",id:`flood-${i}`}));
 mocks.proofFind.mockImplementation(forVendor({"vendor-1":flood,"vendor-2":[{vendorId:"vendor-2",id:"quiet"}]}));
 mocks.proofClaim.mockImplementation(async(_db:unknown,row:Row)=>({...row,claimToken:"b".repeat(43)}));mocks.proofDispatch.mockResolvedValue({status:"sent"});
 await processDueLearnerNotifications(env);
 const claimed=mocks.proofClaim.mock.calls.map(([,row])=>(row as Row).id);
 expect(claimed).toContain("quiet");expect(claimed.indexOf("quiet")).toBeLessThan(2);
});
it("materializes bounded exact domain sources using the same approved tenant scope and reports backlog",async()=>{
 mocks.sourceFind.mockImplementation(forVendor({"vendor-1":[{vendorId:"vendor-1",id:"source-1"}]}));mocks.count.mockResolvedValueOnce(3).mockResolvedValueOnce(4).mockResolvedValueOnce(5);
 const summary=await processDueLearnerNotifications(env);
 expect(summary).toEqual({results:[{status:"completed"},{status:"sent"}],backlog:{sources:3,proofs:4,deliveries:5}});
 expect(mocks.sourceFind).toHaveBeenCalledWith(expect.objectContaining({orderBy:[{availableAt:"asc"},{id:"asc"}],take:LEARNER_NOTIFICATION_JOB_LIMITS.sources.perVendor,select:{vendorId:true,id:true}}));expect(mocks.materialize).toHaveBeenCalledWith(db,"vendor-1","source-1");
 for(const call of mocks.count.mock.calls)expect(call[0].where.vendorId).toEqual({in:["vendor-1","vendor-2"]});
});
it("a failing backlog count leaves the processed results intact",async()=>{
 mocks.count.mockRejectedValue(new Error("private"));expect(await processDueLearnerNotifications(env)).toEqual({results:[{status:"sent"}],backlog:null});
});
it("invalid SMS account or sender never becomes configured",()=>{
 expect(readLearnerNotificationProviderConfiguration({NODE_ENV:"test",TWILIO_ACCOUNT_SID:"invalid",TWILIO_AUTH_TOKEN:"synthetic",TWILIO_SMS_FROM:"+15005550006"})).toEqual({});
 expect(readLearnerNotificationProviderConfiguration({NODE_ENV:"test",TWILIO_ACCOUNT_SID:`AC${"0".repeat(32)}`,TWILIO_AUTH_TOKEN:"synthetic",TWILIO_SMS_FROM:"invalid"})).toEqual({});
});
it("fair batching interleaves vendors, caps each vendor and bounds the batch",()=>{
 const a=["a1","a2","a3","a4"],b=["b1"],c=["c1","c2"];
 expect(fairVendorBatch([a,b,c],10,10)).toEqual(["a1","b1","c1","a2","c2","a3","a4"]);
 expect(fairVendorBatch([a,b,c],4,10)).toEqual(["a1","b1","c1","a2"]);
 expect(fairVendorBatch([a,b,c],10,2)).toEqual(["a1","b1","c1","a2","c2"]);
 expect(fairVendorBatch([[],[]],10,10)).toEqual([]);
 expect(LEARNER_NOTIFICATION_JOB_LIMITS).toMatchObject({sources:{batch:20},proofs:{batch:25},deliveries:{batch:50}});
});
