import { Prisma,type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { LearnerNotificationEvent,LearnerNotificationScope } from "./learner-notification-contract";
import { LearnerNotificationMessage,enqueueLearnerNotificationInTransaction } from "./learner-notification-outbox";
import { captureOperationalError } from "./monitoring";
import { encryptSensitiveValue,decryptSensitiveValue } from "./sensitive-data";

const Input=z.object({vendorId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),productId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),event:LearnerNotificationEvent,eventIdentity:z.string().regex(/^[A-Za-z0-9_-]{1,160}$/u),audienceCustomerKeyHash:z.string().regex(/^[A-Za-z0-9_-]{43}$/u).nullable(),occurredAt:z.date(),availableAt:z.date().optional(),message:LearnerNotificationMessage}).strict();
type SourceInput=z.infer<typeof Input>;
const purpose=(input:Pick<SourceInput,"vendorId"|"productId"|"event"|"eventIdentity">)=>`learner-notification-source-v1:${JSON.stringify([input.vendorId,input.productId,input.event,input.eventIdentity])}`;
const SourceIdentity=/^[A-Za-z0-9_-]{1,128}$/u;
export const LEARNER_NOTIFICATION_SOURCE_MAX_FAILURES=5;

/** Bound free text (product/course/live titles) by code points so a long
 * merchant-authored name never makes the notification message invalid. */
export function boundLearnerNotificationText(value:string,max:number,fallback:string){
 const text=Array.from(value.trim()).slice(0,max).join("").trim();
 return text||fallback;
}

declare const preparedSource:unique symbol;
export type PreparedLearnerNotificationSource={readonly [preparedSource]:true;readonly identity:Omit<SourceInput,"message">;readonly payloadEncryptedEnvelope:string};

function reportSkippedSource(event:unknown){
 try{
  // Fixed message only: the original error may quote private message content.
  const status=typeof event==="string" && LearnerNotificationEvent.safeParse(event).success?`skipped_${event}`:"skipped";
  captureOperationalError(new Error("Learner notification source skipped."),{source:"learner_notification_source",operation:"prepare_source",status});
 }catch{/* Monitoring can never affect the caller's domain transaction. */}
}

/** Build, validate and encrypt with no database access. A deterministic failure
 * (invalid identity/message, unavailable encryption key) is reported and the
 * notification is skipped instead of rolling back the caller's payment, live,
 * curriculum, progress or community transaction. */
export function prepareLearnerNotificationSourceEvent(raw:SourceInput):PreparedLearnerNotificationSource|null{
 try{
  const input=Input.parse(raw),{message,...identity}=input;
  const payloadEncryptedEnvelope=encryptSensitiveValue(JSON.stringify(message),purpose(input));
  return {identity,payloadEncryptedEnvelope} as unknown as PreparedLearnerNotificationSource;
 }catch{
  reportSkippedSource((raw as {event?:unknown}|null)?.event);
  return null;
 }
}

/** Only database work happens here, so genuine DB errors (serialization,
 * unique, connection) still propagate and the caller's transaction retries. */
export async function persistLearnerNotificationSourceEvent(tx:Pick<Prisma.TransactionClient,"learnerNotificationSourceEvent">,prepared:PreparedLearnerNotificationSource){
 const {identity,payloadEncryptedEnvelope}=prepared;
 return tx.learnerNotificationSourceEvent.upsert({where:{vendorId_productId_event_eventIdentity:{vendorId:identity.vendorId,productId:identity.productId,event:identity.event,eventIdentity:identity.eventIdentity}},update:{},
  create:{...identity,availableAt:identity.availableAt??identity.occurredAt,payloadEncryptedEnvelope},select:{id:true}});
}

/** Internal domain producers call inside their existing transaction. No network
 * call, public recipient override, or best-effort post-commit notification gap.
 * Returns null when the notification was skipped for a deterministic reason. */
export async function recordLearnerNotificationSourceEvent(tx:Pick<Prisma.TransactionClient,"learnerNotificationSourceEvent">,raw:SourceInput){
 const prepared=prepareLearnerNotificationSourceEvent(raw);
 return prepared?persistLearnerNotificationSourceEvent(tx,prepared):null;
}

/** A bounded page and source revision CAS commit with the exact deliveries.
 * Cursor advances even for revoked rights. New opt-ins do not receive old events.
 * Only DB serialization/unique conflicts retry; this phase never invokes providers. */
export async function materializeLearnerNotificationSourceEvent(db:Pick<PrismaClient,"$transaction">,vendorId:string,id:string){
 if(!SourceIdentity.test(vendorId) || !SourceIdentity.test(id))throw new Error("Invalid source identity.");
 for(let attempt=0;attempt<3;attempt++){
  try{return await db.$transaction(async tx=>{
   const now=new Date();
   const source=await tx.learnerNotificationSourceEvent.findFirst({where:{vendorId,id,completedAt:null,deadLetteredAt:null,availableAt:{lte:now}}});if(!source)return {status:"not_pending",queued:0} as const;
   // Defense in depth: future sources and backed-off failures never expand early.
   if(source.availableAt>now || (source.nextAttemptAt && source.nextAttemptAt>now))return {status:"not_due",queued:0} as const;
   const reserved=await tx.learnerNotificationSourceEvent.updateMany({where:{vendorId,id,revision:source.revision,completedAt:null},data:{revision:{increment:1}}});if(reserved.count!==1)return {status:"claimed_elsewhere",queued:0} as const;
   const message=LearnerNotificationMessage.parse(JSON.parse(decryptSensitiveValue(source.payloadEncryptedEnvelope,purpose({...source,event:LearnerNotificationEvent.parse(source.event)}))));
   const preferences=await tx.learnerNotificationPreference.findMany({where:{vendorId,productId:source.productId,enabled:true,destinationVerifiedAt:{not:null},consentedAt:{lte:source.occurredAt},...(source.audienceCustomerKeyHash?{customerKeyHash:source.audienceCustomerKeyHash}:{}),...(source.preferenceCursor?{id:{gt:source.preferenceCursor}}:{})},orderBy:{id:"asc"},take:21,select:{id:true,customerKeyHash:true,channel:true}});
   let queued=0;const visible=preferences.slice(0,20);
   for(const preference of visible){
    const scope=LearnerNotificationScope.parse({vendorId,productId:source.productId,customerKeyHash:preference.customerKeyHash});
    if(await enqueueLearnerNotificationInTransaction(tx,scope,{channel:preference.channel,event:source.event,eventIdentity:source.eventIdentity,message}))queued++;
   }
   await tx.learnerNotificationSourceEvent.update({where:{id:source.id},data:{preferenceCursor:visible.at(-1)?.id??source.preferenceCursor,completedAt:preferences.length<=20?new Date():null}});
   return {status:preferences.length<=20?"completed":"page_materialized",queued} as const;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
  catch(error){if(!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2002","P2034"].includes(error.code) || attempt===2)throw error;}
 }
 throw new Error("Source materialization failed.");
}

/** A failing source backs off exponentially and is dead-lettered after the
 * fifth failure, so one poison source cannot block other sources or tenants.
 * The CAS on the observed failure count keeps concurrent workers from double counting. */
export async function recordLearnerNotificationSourceFailure(db:Pick<PrismaClient,"learnerNotificationSourceEvent">,vendorId:string,id:string,now=new Date()){
 if(!SourceIdentity.test(vendorId) || !SourceIdentity.test(id))throw new Error("Invalid source identity.");
 const row=await db.learnerNotificationSourceEvent.findFirst({where:{vendorId,id,completedAt:null,deadLetteredAt:null},select:{failureCount:true}});
 if(!row)return "not_pending" as const;
 const failureCount=Math.min(row.failureCount+1,LEARNER_NOTIFICATION_SOURCE_MAX_FAILURES),dead=failureCount>=LEARNER_NOTIFICATION_SOURCE_MAX_FAILURES;
 const changed=await db.learnerNotificationSourceEvent.updateMany({where:{vendorId,id,completedAt:null,deadLetteredAt:null,failureCount:row.failureCount},
  data:{failureCount,lastErrorCode:"MATERIALIZATION_FAILED",nextAttemptAt:dead?null:new Date(now.getTime()+60_000*2**(failureCount-1)),deadLetteredAt:dead?now:null}});
 if(changed.count!==1)return "not_pending" as const;
 return dead?"dead_lettered" as const:"retry_scheduled" as const;
}
