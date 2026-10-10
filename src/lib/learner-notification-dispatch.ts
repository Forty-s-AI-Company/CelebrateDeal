import { lockLearnerPaymentNotificationOrder, lockLearnerNotificationPurchase } from "./learner-notification-access";
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { LearnerNotificationChannel, LearnerNotificationScope, revealLearnerNotificationDestination } from "./learner-notification-contract";
import { LearnerNotificationMessage, finishLearnerNotification } from "./learner-notification-outbox";
import { decryptSensitiveValue, encryptSensitiveValue } from "./sensitive-data";
import { sendLearnerNotificationProvider, type NotificationProviderConfiguration, type NotificationProviderResult } from "./learner-notification-providers";

type Database = Pick<PrismaClient,"$transaction" | "commerceOrderItem" | "commerceOrder" | "learnerNotificationPreference" | "learnerNotificationDelivery">;
type Sender = typeof sendLearnerNotificationProvider;
const Claim = z.object({ vendorId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),claimToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict();

/** Legacy payment payloads without an exact order are deliberately ineligible. */
async function paymentSourceIsCurrent(tx: Pick<Prisma.TransactionClient, "$queryRaw">,
 scope: z.infer<typeof LearnerNotificationScope>, event: string, message: z.infer<typeof LearnerNotificationMessage>) {
 if (event !== "payment_success") return true;
 return lockLearnerPaymentNotificationOrder(tx, scope, message.paymentOrder?.id);
}

/** Hold the current booking and project/course binding through the provider
 * attempt; encrypted confirmation identifies the original authenticated buyer. */
async function consultationReminderIsCurrent(tx:Pick<Prisma.TransactionClient,"$queryRaw">,scope:z.infer<typeof LearnerNotificationScope>,booking:z.infer<typeof LearnerNotificationMessage>["consultationBooking"],consentedAt:Date|null) {
 if(!booking || booking.customerKeyHash!==scope.customerKeyHash || !consentedAt || new Date(booking.confirmedAt)>new Date() || consentedAt>new Date(booking.confirmedAt))return false;
 const active=await tx.$queryRaw<Array<{id:string}>>`SELECT b."id" FROM "ConsultationBooking" b
  JOIN "ConsultationEvent" e ON e."vendorId"=b."vendorId" AND e."id"=b."eventId"
  JOIN "SalesProject" s ON s."vendorId"=e."vendorId" AND s."id"=e."projectId"
  JOIN "SalesProjectProduct" p ON p."vendorId"=s."vendorId" AND p."projectId"=s."id"
  WHERE b."vendorId"=${scope.vendorId} AND b."id"=${booking.id} AND b."customerKeyHash"=${scope.customerKeyHash}
  AND b."status"='scheduled' AND b."startTime"=${new Date(booking.startTime)}
  AND b."startTime">clock_timestamp() AND b."startTime"<=clock_timestamp()+INTERVAL '1 hour'
  AND e."isActive"=true AND s."status"='published' AND s."publishedAt" IS NOT NULL
  AND p."productId"=${scope.productId} FOR UPDATE OF b,e,s,p`;
 return active.length===1;
}

/** Lock the exact visible reply and its original recipient through submission. */
async function discussionReplyIsCurrent(tx:Pick<Prisma.TransactionClient,"$queryRaw">,scope:z.infer<typeof LearnerNotificationScope>,reply:z.infer<typeof LearnerNotificationMessage>["discussionReply"]) {
 if(!reply || reply.customerKeyHash!==scope.customerKeyHash)return false;
 const current=await tx.$queryRaw<Array<{id:string}>>`SELECT r."id" FROM "CourseCommunityReply" r
  JOIN "CourseCommunityPost" p ON p."vendorId"=r."vendorId" AND p."productId"=r."productId" AND p."id"=r."postId"
  WHERE r."vendorId"=${scope.vendorId} AND r."productId"=${scope.productId} AND r."id"=${reply.replyId}
  AND p."id"=${reply.postId} AND p."customerKeyHash"=${scope.customerKeyHash}
  AND r."customerKeyHash"<>p."customerKeyHash" AND r."hiddenAt" IS NULL AND p."hiddenAt" IS NULL FOR UPDATE OF r,p`;
 return current.length===1;
}

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
   const message=LearnerNotificationMessage.parse(JSON.parse(decryptSensitiveValue(row.payloadEncryptedEnvelope,`learner-notification-payload-v1:${JSON.stringify([input.vendorId,row.deduplicationKey])}`)));
   const paymentCurrent = await paymentSourceIsCurrent(tx, scope, row.event, message);
   const rights=await lockLearnerNotificationPurchase(tx, scope);
   const permitted=paymentCurrent && rights && preference.enabled && preference.revision===row.consentRevision && preference.destinationVerifiedAt && preference.destinationEncryptedEnvelope && preference.destinationKeyHash && !row.dispatchedAt;
   if(!permitted){
    await tx.learnerNotificationDelivery.update({where:{id:row.id},data:{status:"suppressed",claimTokenHash:null,nextAttemptAt:null,lastErrorCode:"AUTHORIZATION_REVOKED"}});
    return {status:"suppressed"} as const;
   }
   const channel=LearnerNotificationChannel.parse(preference.channel);
   const destination=revealLearnerNotificationDestination(scope,channel,preference.destinationEncryptedEnvelope!);
   if (row.event === "live_started") {
    const session = message.liveSession;
    const active = session ? await tx.$queryRaw<Array<{id:string}>>`SELECT l."id" FROM "Live" l
      JOIN "LiveProduct" p ON p."vendorId"=l."vendorId" AND p."liveId"=l."id"
      WHERE l."vendorId"=${input.vendorId} AND l."id"=${session.id} AND l."status"='live'
      AND l."startedAt"=${new Date(session.startedAt)} AND l."endedAt" IS NULL
      AND p."productId"=${row.productId} AND p."isVisible"=true FOR UPDATE OF l,p` : [];
    if (active.length !== 1) {
      await tx.learnerNotificationDelivery.update({where:{id:row.id},data:{status:"suppressed",claimTokenHash:null,nextAttemptAt:null,lastErrorCode:"LIVE_SESSION_UNAVAILABLE"}});
      return {status:"suppressed"} as const;
    }
   }
   if (row.event === "consultation_reminder" && !await consultationReminderIsCurrent(tx,scope,message.consultationBooking,preference.consentedAt)) {
    await tx.learnerNotificationDelivery.update({where:{id:row.id},data:{status:"suppressed",claimTokenHash:null,nextAttemptAt:null,lastErrorCode:"CONSULTATION_BOOKING_UNAVAILABLE"}});
    return {status:"suppressed"} as const;
   }
   if (row.event === "discussion_reply" && !await discussionReplyIsCurrent(tx,scope,message.discussionReply)) {
    await tx.learnerNotificationDelivery.update({where:{id:row.id},data:{status:"suppressed",claimTokenHash:null,nextAttemptAt:null,lastErrorCode:"DISCUSSION_REPLY_UNAVAILABLE"}});
    return {status:"suppressed"} as const;
   }
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
