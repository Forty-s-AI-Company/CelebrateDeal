import { Prisma,type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { LearnerNotificationEvent,LearnerNotificationScope } from "./learner-notification-contract";
import { LearnerNotificationMessage,enqueueLearnerNotificationInTransaction } from "./learner-notification-outbox";
import { encryptSensitiveValue,decryptSensitiveValue } from "./sensitive-data";

const Input=z.object({vendorId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),productId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),event:LearnerNotificationEvent,eventIdentity:z.string().regex(/^[A-Za-z0-9_-]{1,160}$/u),audienceCustomerKeyHash:z.string().regex(/^[A-Za-z0-9_-]{43}$/u).nullable(),occurredAt:z.date(),availableAt:z.date().optional(),message:LearnerNotificationMessage}).strict();
const purpose=(input:Pick<z.infer<typeof Input>,"vendorId"|"productId"|"event"|"eventIdentity">)=>`learner-notification-source-v1:${JSON.stringify([input.vendorId,input.productId,input.event,input.eventIdentity])}`;

/** Internal domain producers call inside their existing transaction. No network
 * call, public recipient override, or best-effort post-commit notification gap. */
export async function recordLearnerNotificationSourceEvent(tx:Pick<Prisma.TransactionClient,"learnerNotificationSourceEvent">,raw:z.infer<typeof Input>){
 const input=Input.parse(raw),{message,...identity}=input;
 return tx.learnerNotificationSourceEvent.upsert({where:{vendorId_productId_event_eventIdentity:{vendorId:input.vendorId,productId:input.productId,event:input.event,eventIdentity:input.eventIdentity}},update:{},
  create:{...identity,availableAt:input.availableAt??input.occurredAt,payloadEncryptedEnvelope:encryptSensitiveValue(JSON.stringify(message),purpose(input))},select:{id:true}});
}

/** A bounded page and source revision CAS commit with the exact deliveries.
 * Cursor advances even for revoked rights. New opt-ins do not receive old events.
 * Only DB serialization/unique conflicts retry; this phase never invokes providers. */
export async function materializeLearnerNotificationSourceEvent(db:Pick<PrismaClient,"$transaction">,vendorId:string,id:string){
 if(!/^[A-Za-z0-9_-]{1,128}$/u.test(vendorId) || !/^[A-Za-z0-9_-]{1,128}$/u.test(id))throw new Error("Invalid source identity.");
 for(let attempt=0;attempt<3;attempt++){
  try{return await db.$transaction(async tx=>{
   const now=new Date();
   const source=await tx.learnerNotificationSourceEvent.findFirst({where:{vendorId,id,completedAt:null,availableAt:{lte:now}}});if(!source)return {status:"not_pending",queued:0} as const;
   // Defense in depth: future sources never expand; consent uses actual event creation.
   if(source.availableAt>now)return {status:"not_due",queued:0} as const;
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
