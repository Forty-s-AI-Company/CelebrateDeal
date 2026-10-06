import { beforeEach,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({getDb:vi.fn(),find:vi.fn(),claim:vi.fn(),dispatch:vi.fn()}));
vi.mock("./db",()=>({getDb:mocks.getDb}));
vi.mock("./learner-notification-outbox",()=>({claimLearnerNotification:mocks.claim}));
vi.mock("./learner-notification-dispatch",()=>({dispatchClaimedLearnerNotification:mocks.dispatch}));
import { processDueLearnerNotifications,readLearnerNotificationProviderConfiguration } from "./learner-notification-job";
const db={learnerNotificationDelivery:{findMany:mocks.find}};
const env:NodeJS.ProcessEnv={NODE_ENV:"test",NEXT_PUBLIC_APP_URL:"https://app.example.test",LEARNER_NOTIFICATIONS_EXECUTOR_ENABLED:"true",LEARNER_NOTIFICATIONS_JOB_VENDOR_IDS:"vendor-1,vendor-2",RESEND_API_KEY:"synthetic-provider-credential",EMAIL_FROM:"synthetic@invalid.example"};
beforeEach(()=>{vi.clearAllMocks();mocks.getDb.mockReturnValue(db);mocks.find.mockResolvedValue([{vendorId:"vendor-1",id:"delivery-1"}]);mocks.claim.mockResolvedValue({claimToken:"a".repeat(43)});mocks.dispatch.mockResolvedValue({status:"sent",providerReceipt:"private-provider-receipt"});});
it("disabled executor never reads the database or dispatches",async()=>{
 expect(await processDueLearnerNotifications({...env,LEARNER_NOTIFICATIONS_EXECUTOR_ENABLED:"false"})).toEqual([]);expect(mocks.getDb).not.toHaveBeenCalled();expect(mocks.dispatch).not.toHaveBeenCalled();
});
it.each(["","foreign/id",Array.from({length:26},(_,i)=>`vendor-${i}`).join(",")])("rejects invalid or excessive approved tenant scope %s",async vendors=>{
 expect(await processDueLearnerNotifications({...env,LEARNER_NOTIFICATIONS_JOB_VENDOR_IDS:vendors})).toEqual([{status:"configuration_missing"}]);expect(mocks.getDb).not.toHaveBeenCalled();
});
it("absent configured provider never consumes a queue attempt",async()=>{
 expect(await processDueLearnerNotifications({...env,RESEND_API_KEY:undefined,EMAIL_FROM:undefined})).toEqual([{status:"configuration_missing"}]);expect(mocks.claim).not.toHaveBeenCalled();expect(mocks.getDb).not.toHaveBeenCalled();
});
it("never derives message links from an untrusted request host or HTTP origin",async()=>{
 expect(await processDueLearnerNotifications({...env,NEXT_PUBLIC_APP_URL:"http://127.0.0.1"})).toEqual([{status:"configuration_missing"}]);expect(mocks.getDb).not.toHaveBeenCalled();
});
it("selects bounded due IDs from only the approved tenants and configured channels",async()=>{
 expect(await processDueLearnerNotifications(env)).toEqual([{status:"sent"}]);
 expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({vendorId:{in:["vendor-1","vendor-2"]},status:"queued",preference:{is:{channel:{in:["email"]}}}}),take:5,select:{vendorId:true,id:true}}));
 expect(mocks.claim).toHaveBeenCalledWith(db,"vendor-1","delivery-1");
 expect(mocks.dispatch).toHaveBeenCalledWith(db,{vendorId:"vendor-1",id:"delivery-1",claimToken:"a".repeat(43)},expect.objectContaining({appOrigin:"https://app.example.test"}));
});
it("another worker claim is never replaced with a latest recipient",async()=>{
 mocks.claim.mockResolvedValue(null);expect(await processDueLearnerNotifications(env)).toEqual([{status:"claimed_elsewhere"}]);expect(mocks.dispatch).not.toHaveBeenCalled();
});
it("database errors return closed metadata without raw errors",async()=>{
 mocks.find.mockRejectedValue(new Error("private-contact-or-credential"));expect(await processDueLearnerNotifications(env)).toEqual([{status:"failed"}]);expect(mocks.dispatch).not.toHaveBeenCalled();
});
it("invalid SMS account or sender never becomes configured",()=>{
 expect(readLearnerNotificationProviderConfiguration({NODE_ENV:"test",TWILIO_ACCOUNT_SID:"invalid",TWILIO_AUTH_TOKEN:"synthetic",TWILIO_SMS_FROM:"+15005550006"})).toEqual({});
 expect(readLearnerNotificationProviderConfiguration({NODE_ENV:"test",TWILIO_ACCOUNT_SID:`AC${"0".repeat(32)}`,TWILIO_AUTH_TOKEN:"synthetic",TWILIO_SMS_FROM:"invalid"})).toEqual({});
});

it("spent invocation budget never claims another delivery",async()=>{
 const clock=vi.spyOn(Date,"now").mockReturnValue(20000);clock.mockReturnValueOnce(0);
 try{expect(await processDueLearnerNotifications(env)).toEqual([]);expect(mocks.claim).not.toHaveBeenCalled();expect(mocks.dispatch).not.toHaveBeenCalled();}
 finally{clock.mockRestore();}
});
