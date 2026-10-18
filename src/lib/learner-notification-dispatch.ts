import { learnerPaymentNotificationOrderIsCurrent, learnerNotificationPurchaseIsCurrent } from "./learner-notification-access";
import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { LearnerNotificationChannel, LearnerNotificationScope, revealLearnerNotificationDestination } from "./learner-notification-contract";
import { LearnerNotificationMessage, finishLearnerNotification } from "./learner-notification-outbox";
import { decryptSensitiveValue } from "./sensitive-data";
import { sendLearnerNotificationProvider, type NotificationProviderConfiguration, type NotificationProviderResult } from "./learner-notification-providers";

type Database = Pick<PrismaClient,"$transaction" | "commerceOrderItem" | "commerceOrder" | "learnerNotificationPreference" | "learnerNotificationDelivery">;
type Sender = typeof sendLearnerNotificationProvider;
type Scope = z.infer<typeof LearnerNotificationScope>;
type Message = z.infer<typeof LearnerNotificationMessage>;
const Claim = z.object({ vendorId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),claimToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict();
const tokenHash = (token:string) => createHash("sha256").update(token).digest("hex");
/** Every pre-send transaction is short and bounded: it never waits long on a
 * row lock and never holds one across the provider call. */
export const LEARNER_NOTIFICATION_PRESEND_TRANSACTION = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 10000 } as const;
export const LEARNER_NOTIFICATION_LOCK_TIMEOUT_SQL = "SET LOCAL lock_timeout = '2s'";

/** Legacy payment payloads without an exact order are deliberately ineligible. */
async function paymentSourceIsCurrent(tx: Pick<Prisma.TransactionClient, "$queryRaw">, scope: Scope, event: string, message: Message) {
 if (event !== "payment_success") return true;
 return learnerPaymentNotificationOrderIsCurrent(tx, scope, message.paymentOrder?.id);
}

/** Current booking and project/course binding; encrypted confirmation
 * identifies the original authenticated buyer. Plain read, no row locks. */
async function consultationReminderIsCurrent(tx:Pick<Prisma.TransactionClient,"$queryRaw">,scope:Scope,booking:Message["consultationBooking"],consentedAt:Date|null) {
 if(!booking || booking.customerKeyHash!==scope.customerKeyHash || !consentedAt || new Date(booking.confirmedAt)>new Date() || consentedAt>new Date(booking.confirmedAt))return false;
 const active=await tx.$queryRaw<Array<{id:string}>>`SELECT b."id" FROM "ConsultationBooking" b
  JOIN "ConsultationEvent" e ON e."vendorId"=b."vendorId" AND e."id"=b."eventId"
  JOIN "SalesProject" s ON s."vendorId"=e."vendorId" AND s."id"=e."projectId"
  JOIN "SalesProjectProduct" p ON p."vendorId"=s."vendorId" AND p."projectId"=s."id"
  WHERE b."vendorId"=${scope.vendorId} AND b."id"=${booking.id} AND b."customerKeyHash"=${scope.customerKeyHash}
  AND b."status"='scheduled' AND b."startTime"=${new Date(booking.startTime)}
  AND b."startTime">clock_timestamp() AND b."startTime"<=clock_timestamp()+INTERVAL '1 hour'
  AND e."isActive"=true AND s."status"='published' AND s."publishedAt" IS NOT NULL
  AND p."productId"=${scope.productId} LIMIT 1`;
 return active.length===1;
}

/** The exact visible reply and its original recipient. Plain read, no row locks. */
async function discussionReplyIsCurrent(tx:Pick<Prisma.TransactionClient,"$queryRaw">,scope:Scope,reply:Message["discussionReply"]) {
 if(!reply || reply.customerKeyHash!==scope.customerKeyHash)return false;
 const current=await tx.$queryRaw<Array<{id:string}>>`SELECT r."id" FROM "CourseCommunityReply" r
  JOIN "CourseCommunityPost" p ON p."vendorId"=r."vendorId" AND p."productId"=r."productId" AND p."id"=r."postId"
  WHERE r."vendorId"=${scope.vendorId} AND r."productId"=${scope.productId} AND r."id"=${reply.replyId}
  AND p."id"=${reply.postId} AND p."customerKeyHash"=${scope.customerKeyHash}
  AND r."customerKeyHash"<>p."customerKeyHash" AND r."hiddenAt" IS NULL AND p."hiddenAt" IS NULL LIMIT 1`;
 return current.length===1;
}

/** The exact active live session and its visible course binding. Plain read. */
async function liveSessionIsCurrent(tx:Pick<Prisma.TransactionClient,"$queryRaw">,vendorId:string,productId:string,session:Message["liveSession"]) {
 if(!session)return false;
 const active=await tx.$queryRaw<Array<{id:string}>>`SELECT l."id" FROM "Live" l
  JOIN "LiveProduct" p ON p."vendorId"=l."vendorId" AND p."liveId"=l."id"
  WHERE l."vendorId"=${vendorId} AND l."id"=${session.id} AND l."status"='live'
  AND l."startedAt"=${new Date(session.startedAt)} AND l."endedAt" IS NULL
  AND p."productId"=${productId} AND p."isVisible"=true LIMIT 1`;
 return active.length===1;
}

type Prepared =
 | { status:"not_claimed" }
 | { status:"suppressed" }
 | { status:"ready"; sendToken:string; channel:LearnerNotificationChannel; destination:unknown; message:Message; idempotencyKey:string };

/** Phase 1, short transaction: verify the exact claim, re-check consent, rights
 * and the event's current domain state with plain reads, then rotate the claim
 * to a single-use send token. Only the delivery row itself is locked, briefly. */
async function prepareClaimedDelivery(db:Database,input:z.infer<typeof Claim>):Promise<Prepared> {
 const hash=tokenHash(input.claimToken);
 return db.$transaction(async tx=>{
  await tx.$executeRawUnsafe(LEARNER_NOTIFICATION_LOCK_TIMEOUT_SQL);
  const locked=await tx.$queryRaw<Array<{id:string}>>`SELECT d."id" FROM "LearnerNotificationDelivery" d
   WHERE d."vendorId"=${input.vendorId} AND d."id"=${input.id} AND d."status"='processing' AND d."claimTokenHash"=${hash}
   FOR UPDATE OF d`;
  if(locked.length!==1)return {status:"not_claimed"} as const;
  const claim={vendorId:input.vendorId,id:input.id,status:"processing",claimTokenHash:hash};
  const suppress=async (lastErrorCode:string)=>{
   await tx.learnerNotificationDelivery.updateMany({where:claim,data:{status:"suppressed",claimTokenHash:null,nextAttemptAt:null,lastErrorCode}});
   return {status:"suppressed"} as const;
  };
  const row=await tx.learnerNotificationDelivery.findFirstOrThrow({where:{vendorId:input.vendorId,id:input.id}});
  const preference=await tx.learnerNotificationPreference.findFirstOrThrow({where:{vendorId:input.vendorId,productId:row.productId,id:row.preferenceId}});
  const scope=LearnerNotificationScope.parse({vendorId:input.vendorId,productId:row.productId,customerKeyHash:preference.customerKeyHash});
  const message=LearnerNotificationMessage.parse(JSON.parse(decryptSensitiveValue(row.payloadEncryptedEnvelope,`learner-notification-payload-v1:${JSON.stringify([input.vendorId,row.deduplicationKey])}`)));
  const paymentCurrent=await paymentSourceIsCurrent(tx,scope,row.event,message);
  const rights=await learnerNotificationPurchaseIsCurrent(tx,scope);
  const permitted=paymentCurrent && rights && preference.enabled && preference.revision===row.consentRevision && preference.destinationVerifiedAt && preference.destinationEncryptedEnvelope && preference.destinationKeyHash && !row.dispatchedAt;
  if(!permitted)return suppress("AUTHORIZATION_REVOKED");
  if(row.event==="live_started" && !await liveSessionIsCurrent(tx,input.vendorId,row.productId,message.liveSession))return suppress("LIVE_SESSION_UNAVAILABLE");
  if(row.event==="consultation_reminder" && !await consultationReminderIsCurrent(tx,scope,message.consultationBooking,preference.consentedAt))return suppress("CONSULTATION_BOOKING_UNAVAILABLE");
  if(row.event==="discussion_reply" && !await discussionReplyIsCurrent(tx,scope,message.discussionReply))return suppress("DISCUSSION_REPLY_UNAVAILABLE");
  const channel=LearnerNotificationChannel.parse(preference.channel);
  const destination=revealLearnerNotificationDestination(scope,channel,preference.destinationEncryptedEnvelope!);
  // The original claim token can no longer start a send: a concurrent or replayed
  // dispatcher finds no row, and only this send token can record the outcome.
  const sendToken=randomBytes(32).toString("base64url");
  const rotated=await tx.learnerNotificationDelivery.updateMany({where:claim,data:{claimTokenHash:tokenHash(sendToken),claimedAt:new Date()}});
  if(rotated.count!==1)return {status:"not_claimed"} as const;
  return {status:"ready",sendToken,channel,destination,message,idempotencyKey:row.deduplicationKey} as const;
 },LEARNER_NOTIFICATION_PRESEND_TRANSACTION);
}

/** Three phases: (1) a short eligibility/claim transaction, (2) one provider
 * call outside any transaction, (3) a short CAS on the send token to record the
 * outcome. No CommerceOrder/Entitlement/Live/SalesProject/Consultation lock is
 * held across HTTP. A processing row is never auto-reclaimed, and an uncertain
 * or unrecorded send is terminal: the provider is never called twice. */
export async function dispatchClaimedLearnerNotification(db:Database,raw:unknown,options:{ appOrigin:string; configuration:NotificationProviderConfiguration; sender?:Sender }) {
 const input=Claim.parse(raw);
 let prepared:Prepared;
 try { prepared=await prepareClaimedDelivery(db,input); }
 catch {
  // Nothing was sent; a lock timeout or transient fault returns the original
  // claim to the bounded retry schedule.
  try {
   const saved=await finishLearnerNotification(db,{...input,outcome:"not_delivered"});
   return {status:saved?"not_delivered":"persistence_failed",providerAttempted:false} as const;
  } catch { return {status:"persistence_failed",providerAttempted:false} as const; }
 }
 if(prepared.status!=="ready")return prepared;
 let result:NotificationProviderResult;
 try {
  result=await (options.sender??sendLearnerNotificationProvider)({channel:prepared.channel,destination:prepared.destination,message:prepared.message,appOrigin:options.appOrigin,idempotencyKey:prepared.idempotencyKey},options.configuration);
  if(!["sent","not_delivered","indeterminate"].includes(result.outcome) || (result.providerReceipt?.length??0)>4096)result={outcome:"indeterminate",code:"OUTCOME_UNKNOWN"};
 } catch { result={outcome:"indeterminate",code:"OUTCOME_UNKNOWN"}; }
 const finish={vendorId:input.vendorId,id:input.id,claimToken:prepared.sendToken};
 try {
  if(await finishLearnerNotification(db,{...finish,outcome:result.outcome,providerReceipt:result.providerReceipt})){
   const retry=result.outcome==="not_delivered";
   return {status:result.outcome==="sent"?"sent":retry?"not_delivered":"indeterminate",providerAttempted:true} as const;
  }
  return {status:"persistence_failed",providerAttempted:true} as const;
 } catch {
  // A failed commit never repeats the external request; the send token settles
  // the row as indeterminate.
  try {
   const saved=await finishLearnerNotification(db,{...finish,outcome:"indeterminate",providerReceipt:result.providerReceipt});
   return {status:saved?"indeterminate":"persistence_failed",providerAttempted:true} as const;
  } catch { return {status:"persistence_failed",providerAttempted:true} as const; }
 }
}
