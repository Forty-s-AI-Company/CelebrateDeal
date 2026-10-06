import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { LearnerNotificationChannel, LearnerNotificationScope, revealLearnerNotificationDestination } from "./learner-notification-contract";
import { LearnerNotificationMessage, finishLearnerNotification } from "./learner-notification-outbox";
import { decryptSensitiveValue, encryptSensitiveValue } from "./sensitive-data";
import { sendLearnerNotificationProvider, type NotificationProviderConfiguration, type NotificationProviderResult } from "./learner-notification-providers";

type Database = Pick<PrismaClient,"$transaction" | "commerceOrderItem" | "learnerNotificationPreference" | "learnerNotificationDelivery">;
type Sender = typeof sendLearnerNotificationProvider;
const Claim = z.object({ vendorId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),claimToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict();

/** Lock exact consent, order and entitlement rows through one bounded provider
 * attempt. Refund/opt-out commits cannot overtake authorization and submission.
 * This transaction MUST NOT be automatically retried: HTTP may already have sent. */
export async function dispatchClaimedLearnerNotification(db:Database,raw:unknown,options:{ appOrigin:string; configuration:NotificationProviderConfiguration; sender?:Sender }) {
 const input=Claim.parse(raw),hash=createHash("sha256").update(input.claimToken).digest("hex");
 let attempted=false,receipt:string|undefined;
 try {
  return await db.$transaction(async tx=>{
   const locked=await tx.$queryRaw<Array<{id:string}>>`SELECT d."id" FROM "LearnerNotificationDelivery" d
    JOIN "LearnerNotificationPreference" p ON p."vendorId"=d."vendorId" AND p."productId"=d."productId" AND p."id"=d."preferenceId"
    WHERE d."vendorId"=${input.vendorId} AND d."id"=${input.id} AND d."status"='processing' AND d."claimTokenHash"=${hash}
    FOR UPDATE OF p,d`;
   if(locked.length!==1)return {status:"not_claimed"} as const;
   const row=await tx.learnerNotificationDelivery.findFirstOrThrow({where:{vendorId:input.vendorId,id:input.id}});
   const preference=await tx.learnerNotificationPreference.findFirstOrThrow({where:{vendorId:input.vendorId,productId:row.productId,id:row.preferenceId}});
   const scope=LearnerNotificationScope.parse({vendorId:input.vendorId,productId:row.productId,customerKeyHash:preference.customerKeyHash});
   const rights=await tx.$queryRaw<Array<{id:string}>>`SELECT e."id" FROM "CommerceOrderItem" i
    JOIN "CommerceOrder" o ON o."vendorId"=i."vendorId" AND o."id"=i."orderId"
    JOIN "CommerceEntitlement" e ON e."vendorId"=i."vendorId" AND e."orderItemId"=i."id"
    WHERE i."vendorId"=${scope.vendorId} AND i."productId"=${scope.productId} AND o."automationCustomerKeyHash"=${scope.customerKeyHash}
    AND o."status" IN ('paid','partially_refunded') AND e."status"='granted' AND e."revokedAt" IS NULL
    AND (e."expiresAt" IS NULL OR e."expiresAt">clock_timestamp()) ORDER BY e."id" LIMIT 1 FOR UPDATE OF o,e`;
   const permitted=rights.length>0 && preference.enabled && preference.revision===row.consentRevision && preference.destinationVerifiedAt && preference.destinationEncryptedEnvelope && preference.destinationKeyHash && !row.dispatchedAt;
   if(!permitted){
    await tx.learnerNotificationDelivery.update({where:{id:row.id},data:{status:"suppressed",claimTokenHash:null,nextAttemptAt:null,lastErrorCode:"AUTHORIZATION_REVOKED"}});
    return {status:"suppressed"} as const;
   }
   const channel=LearnerNotificationChannel.parse(preference.channel);
   const destination=revealLearnerNotificationDestination(scope,channel,preference.destinationEncryptedEnvelope!);
   const message=LearnerNotificationMessage.parse(JSON.parse(decryptSensitiveValue(row.payloadEncryptedEnvelope,`learner-notification-payload-v1:${JSON.stringify([input.vendorId,row.deduplicationKey])}`)));
   attempted=true;
   const result:NotificationProviderResult=await (options.sender??sendLearnerNotificationProvider)({channel,destination,message,appOrigin:options.appOrigin,idempotencyKey:row.deduplicationKey},options.configuration);
   if(!["sent","not_delivered","indeterminate"].includes(result.outcome))throw new Error("Invalid provider result.");
   receipt=result.providerReceipt;
   if(receipt && receipt.length>4096)throw new Error("Invalid provider receipt.");
   const retry=result.outcome==="not_delivered" && row.attemptCount<5;
   const status=result.outcome==="sent"?"sent":retry?"queued":result.outcome==="indeterminate"?"indeterminate":"failed";
   await tx.learnerNotificationDelivery.update({where:{id:row.id},data:{status,claimTokenHash:null,
    nextAttemptAt:retry?new Date(Date.now()+30000*2**(row.attemptCount-1)):null,
    dispatchedAt:result.outcome==="sent"?new Date():null,
    lastErrorCode:result.outcome==="sent"?null:result.outcome==="indeterminate"?"PROVIDER_OUTCOME_UNKNOWN":"PROVIDER_NOT_DELIVERED",
    providerReceiptEncryptedEnvelope:receipt?encryptSensitiveValue(receipt,`learner-notification-receipt-v1:${JSON.stringify([input.vendorId,input.id])}`):null}});
   return {status,providerAttempted:true} as const;
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted,maxWait:5000,timeout:25000});
 }catch{
  // A failed commit never repeats the external request. The already committed
  // processing claim can only be finalized with this exact token.
  try {
   const saved=await finishLearnerNotification(db,{...input,outcome:attempted?"indeterminate":"not_delivered",providerReceipt:receipt});
   return {status:saved?(attempted?"indeterminate":"not_delivered"):"persistence_failed",providerAttempted:attempted} as const;
  }catch{return {status:"persistence_failed",providerAttempted:attempted} as const;}
 }
}
