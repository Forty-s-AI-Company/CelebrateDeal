import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { decryptSensitiveValue } from "./sensitive-data";
import { recordLearnerNotificationSourceEvent, materializeLearnerNotificationSourceEvent, prepareLearnerNotificationSourceEvent, recordLearnerNotificationSourceFailure, boundLearnerNotificationText } from "./learner-notification-source-events";
import { captureOperationalError } from "./monitoring";
vi.mock("./monitoring", () => ({ captureOperationalError: vi.fn() }));
import { enqueueLearnerNotificationInTransaction } from "./learner-notification-outbox";
vi.mock("./learner-notification-outbox", async original => ({ ...await original<typeof import("./learner-notification-outbox")>(), enqueueLearnerNotificationInTransaction: vi.fn() }));
const input={vendorId:"vendor",productId:"course",event:"lesson_published" as const,eventIdentity:"published_1",audienceCustomerKeyHash:null,occurredAt:new Date("2026-10-01T00:00:00Z"),message:{title:"Lesson",body:"Synthetic private title",path:"/portal/vendor/learn/course"}};
async function fixture(){
 let source:Record<string,unknown>={};
 const tx={learnerNotificationSourceEvent:{upsert:vi.fn(async ({create}:{create:Record<string,unknown>})=>{source={id:"source",...create,revision:1,completedAt:null,preferenceCursor:null};return {id:"source"};}),findFirst:vi.fn(async()=>source),updateMany:vi.fn(async()=>({count:1})),update:vi.fn(async()=>({}))},learnerNotificationPreference:{findMany:vi.fn(async()=>[] as Array<{id:string;customerKeyHash:string;channel:string}>)}};
 await recordLearnerNotificationSourceEvent(tx as never,input);
 const db={$transaction:vi.fn(async (run:(store:typeof tx)=>unknown)=>run(tx))};return {tx,db,source};
}
beforeEach(()=>{vi.mocked(captureOperationalError).mockReset();vi.stubEnv("CSRF_SECRET","synthetic-source-events-encryption-key-32-bytes");vi.mocked(enqueueLearnerNotificationInTransaction).mockReset();vi.mocked(enqueueLearnerNotificationInTransaction).mockResolvedValue({id:"delivery",status:"queued"});});
afterEach(()=>vi.unstubAllEnvs());
describe("domain source security and bounded consumption",()=>{
 it("skips and reports publication IDs that cannot enter delivery deduplication without writing",async()=>{const f=await fixture();expect(await recordLearnerNotificationSourceEvent(f.tx as never,{...input,eventIdentity:"lesson:date"})).toBeNull();expect(f.tx.learnerNotificationSourceEvent.upsert).toHaveBeenCalledTimes(1);expect(captureOperationalError).toHaveBeenCalledWith(expect.objectContaining({message:"Learner notification source skipped."}),{source:"learner_notification_source",operation:"prepare_source",status:"skipped_lesson_published"});});
 it("encrypts private content with the exact tenant/course/event binding",async()=>{const f=await fixture();const purpose=`learner-notification-source-v1:${JSON.stringify([input.vendorId,input.productId,input.event,input.eventIdentity])}`;expect(String(f.source.payloadEncryptedEnvelope)).not.toContain(input.message.body);expect(JSON.parse(decryptSensitiveValue(String(f.source.payloadEncryptedEnvelope),purpose))).toEqual(input.message);expect(()=>decryptSensitiveValue(String(f.source.payloadEncryptedEnvelope),purpose+"foreign")).toThrow();});
 it.each([["../vendor","source"],["vendor","../source"]])("rejects malformed source scope %s %s before a transaction",async(vendor,id)=>{const f=await fixture();await expect(materializeLearnerNotificationSourceEvent(f.db as never,vendor,id)).rejects.toThrow();expect(f.db.$transaction).not.toHaveBeenCalled();});
 it("cannot expand a missing or foreign source",async()=>{const f=await fixture();f.tx.learnerNotificationSourceEvent.findFirst.mockResolvedValueOnce(null as never);expect(await materializeLearnerNotificationSourceEvent(f.db as never,"foreign","source")).toEqual({status:"not_pending",queued:0});expect(f.tx.learnerNotificationPreference.findMany).not.toHaveBeenCalled();expect(f.tx.learnerNotificationSourceEvent.findFirst).toHaveBeenCalledWith({where:{vendorId:"foreign",id:"source",completedAt:null,deadLetteredAt:null,availableAt:{lte:expect.any(Date)}}});});
 it("does not expand a lost revision claim",async()=>{const f=await fixture();f.tx.learnerNotificationSourceEvent.updateMany.mockResolvedValueOnce({count:0});expect((await materializeLearnerNotificationSourceEvent(f.db as never,"vendor","source")).status).toBe("claimed_elsewhere");expect(enqueueLearnerNotificationInTransaction).not.toHaveBeenCalled();});
 it("persists at most twenty recipients and leaves a resumable page",async()=>{const f=await fixture();f.tx.learnerNotificationPreference.findMany.mockResolvedValueOnce(Array.from({length:21},(_,i)=>({id:`pref${i}`,customerKeyHash:"a".repeat(43),channel:"email"})));expect(await materializeLearnerNotificationSourceEvent(f.db as never,"vendor","source")).toEqual({status:"page_materialized",queued:20});expect(enqueueLearnerNotificationInTransaction).toHaveBeenCalledTimes(20);expect(f.tx.learnerNotificationSourceEvent.update).toHaveBeenCalledWith({where:{id:"source"},data:{preferenceCursor:"pref19",completedAt:null}});});
 it("filters exact audience, prior consent and persisted cursor; revoked recipients still advance",async()=>{const f=await fixture();f.source.audienceCustomerKeyHash="a".repeat(43);f.source.preferenceCursor="prior";f.tx.learnerNotificationPreference.findMany.mockResolvedValueOnce([{id:"next",customerKeyHash:"a".repeat(43),channel:"email"}]);vi.mocked(enqueueLearnerNotificationInTransaction).mockResolvedValueOnce(null);expect((await materializeLearnerNotificationSourceEvent(f.db as never,"vendor","source")).queued).toBe(0);expect(f.tx.learnerNotificationPreference.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({customerKeyHash:"a".repeat(43),id:{gt:"prior"},consentedAt:{lte:input.occurredAt}}),take:21}));expect(f.tx.learnerNotificationSourceEvent.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({preferenceCursor:"next",completedAt:expect.any(Date)})}));});
 it("completes an empty audience without changing an existing cursor",async()=>{const f=await fixture();f.source.preferenceCursor="prior";expect((await materializeLearnerNotificationSourceEvent(f.db as never,"vendor","source")).status).toBe("completed");expect(f.tx.learnerNotificationSourceEvent.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({preferenceCursor:"prior"})}));});
 it.each(["P2002","P2034"])("retries only a bounded DB conflict %s",async code=>{const f=await fixture();f.db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("synthetic conflict",{code,clientVersion:"synthetic"}));expect((await materializeLearnerNotificationSourceEvent(f.db as never,"vendor","source")).status).toBe("completed");expect(f.db.$transaction).toHaveBeenCalledTimes(2);});
 it("exhausts DB conflict retries without unbounded looping",async()=>{const f=await fixture();f.db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("synthetic conflict",{code:"P2034",clientVersion:"synthetic"}));await expect(materializeLearnerNotificationSourceEvent(f.db as never,"vendor","source")).rejects.toThrow();expect(f.db.$transaction).toHaveBeenCalledTimes(3);});
 it.each([new Error("synthetic non-DB failure"),new Prisma.PrismaClientKnownRequestError("synthetic other DB failure",{code:"P2010",clientVersion:"synthetic"})])("does not retry corruption or unrelated DB failures",async error=>{const f=await fixture();f.db.$transaction.mockRejectedValueOnce(error);await expect(materializeLearnerNotificationSourceEvent(f.db as never,"vendor","source")).rejects.toThrow();expect(f.db.$transaction).toHaveBeenCalledTimes(1);});
 it("rejects swapped ciphertext without expanding recipients or persisting cursor",async()=>{const f=await fixture();f.source.vendorId="foreign";await expect(materializeLearnerNotificationSourceEvent(f.db as never,"vendor","source")).rejects.toThrow();expect(f.tx.learnerNotificationPreference.findMany).not.toHaveBeenCalled();expect(f.tx.learnerNotificationSourceEvent.update).not.toHaveBeenCalled();});
 it("keeps consent cutoff at creation when delivery is scheduled later",async()=>{const f=await fixture();const availableAt=new Date(input.occurredAt.getTime()+3600000);await recordLearnerNotificationSourceEvent(f.tx as never,{...input,availableAt});expect(f.tx.learnerNotificationSourceEvent.upsert).toHaveBeenLastCalledWith(expect.objectContaining({create:expect.objectContaining({occurredAt:input.occurredAt,availableAt})}));});
 it("cannot reserve a future source returned by a stale adapter",async()=>{const f=await fixture();f.source.availableAt=new Date(Date.now()+3600000);expect(await materializeLearnerNotificationSourceEvent(f.db as never,"vendor","source")).toEqual({status:"not_due",queued:0});expect(f.tx.learnerNotificationSourceEvent.updateMany).not.toHaveBeenCalled();expect(enqueueLearnerNotificationInTransaction).not.toHaveBeenCalled();});
 it("skips invalid scheduled dates before inserting",async()=>{const f=await fixture();expect(await recordLearnerNotificationSourceEvent(f.tx as never,{...input,availableAt:new Date(NaN)})).toBeNull();expect(f.tx.learnerNotificationSourceEvent.upsert).toHaveBeenCalledTimes(1);});
 it("an over-long path (e.g. an encoded 80-character CJK slug) is skipped instead of throwing out of the caller's transaction",async()=>{
  const f=await fixture();const legacyPath=`/portal/${encodeURIComponent("課".repeat(80))}/notifications`;expect(legacyPath.length).toBeGreaterThan(512);
  expect(await recordLearnerNotificationSourceEvent(f.tx as never,{...input,message:{...input.message,path:legacyPath}})).toBeNull();
  expect(f.tx.learnerNotificationSourceEvent.upsert).toHaveBeenCalledTimes(1);expect(captureOperationalError).toHaveBeenCalledTimes(1);
 });
 it("an unavailable encryption key is a deterministic skip, never a thrown error",async()=>{
  vi.stubEnv("CSRF_SECRET","short");vi.stubEnv("JOB_SECRET","");
  expect(prepareLearnerNotificationSourceEvent(input)).toBeNull();expect(captureOperationalError).toHaveBeenCalledTimes(1);
 });
 it("monitoring failure cannot escape into the caller's transaction",async()=>{
  vi.mocked(captureOperationalError).mockImplementationOnce(()=>{throw new Error("monitoring down");});
  expect(prepareLearnerNotificationSourceEvent({...input,eventIdentity:"bad:identity"})).toBeNull();
 });
 it("database errors from the write still propagate so the caller retries",async()=>{
  const f=await fixture();const conflict=new Prisma.PrismaClientKnownRequestError("synthetic serialization",{code:"P2034",clientVersion:"synthetic"});
  f.tx.learnerNotificationSourceEvent.upsert.mockRejectedValueOnce(conflict);
  await expect(recordLearnerNotificationSourceEvent(f.tx as never,{...input,eventIdentity:"db_retry"})).rejects.toBe(conflict);
  expect(captureOperationalError).not.toHaveBeenCalled();
 });
 it("bounds merchant-authored text by code points without splitting surrogate pairs",()=>{
  expect(boundLearnerNotificationText("😀".repeat(2001),2000,"fallback")).toBe("😀".repeat(2000));
  expect(boundLearnerNotificationText("   ",2000,"fallback")).toBe("fallback");
 });
 it("backs off a failing source and dead-letters it on the fifth failure with a CAS on the failure count",async()=>{
  const findFirst=vi.fn(),updateMany=vi.fn().mockResolvedValue({count:1});const db={learnerNotificationSourceEvent:{findFirst,updateMany}};const now=new Date("2026-10-18T00:00:00Z");
  findFirst.mockResolvedValueOnce({failureCount:0});
  expect(await recordLearnerNotificationSourceFailure(db as never,"vendor","source",now)).toBe("retry_scheduled");
  expect(updateMany).toHaveBeenLastCalledWith({where:{vendorId:"vendor",id:"source",completedAt:null,deadLetteredAt:null,failureCount:0},data:{failureCount:1,lastErrorCode:"MATERIALIZATION_FAILED",nextAttemptAt:new Date(now.getTime()+60000),deadLetteredAt:null}});
  findFirst.mockResolvedValueOnce({failureCount:4});
  expect(await recordLearnerNotificationSourceFailure(db as never,"vendor","source",now)).toBe("dead_lettered");
  expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({data:{failureCount:5,lastErrorCode:"MATERIALIZATION_FAILED",nextAttemptAt:null,deadLetteredAt:now}}));
  findFirst.mockResolvedValueOnce({failureCount:1});updateMany.mockResolvedValueOnce({count:0});
  expect(await recordLearnerNotificationSourceFailure(db as never,"vendor","source",now)).toBe("not_pending");
  findFirst.mockResolvedValueOnce(null);
  expect(await recordLearnerNotificationSourceFailure(db as never,"vendor","source",now)).toBe("not_pending");
  await expect(recordLearnerNotificationSourceFailure(db as never,"../vendor","source",now)).rejects.toThrow();
 });
 it("a backed-off source is not expanded before its retry time",async()=>{const f=await fixture();f.source.nextAttemptAt=new Date(Date.now()+60000);expect(await materializeLearnerNotificationSourceEvent(f.db as never,"vendor","source")).toEqual({status:"not_due",queued:0});expect(f.tx.learnerNotificationSourceEvent.updateMany).not.toHaveBeenCalled();});
});
