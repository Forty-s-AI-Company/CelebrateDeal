import { learnerNotificationPurchaseIsCurrent } from "./learner-notification-access";
import { createHash, randomBytes } from "node:crypto";
import { type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { LearnerNotificationChannel, revealLearnerNotificationDestination } from "./learner-notification-contract";
import { LEARNER_NOTIFICATION_LOCK_TIMEOUT_SQL, LEARNER_NOTIFICATION_PRESEND_TRANSACTION } from "./learner-notification-dispatch";
import { learnerNotificationLink } from "./learner-notification-links";
import { decryptSensitiveValue, encryptSensitiveValue } from "./sensitive-data";
import { sendLearnerNotificationProvider, type NotificationProviderConfiguration, type NotificationProviderResult } from "./learner-notification-providers";

type Database = Pick<PrismaClient,"$transaction" | "learnerNotificationVerification">;
const Identity = z.object({vendorId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u)}).strict();
const hash = (value:string) => createHash("sha256").update(value).digest("hex");
const purpose = (vendorId:string,id:string) => `learner-contact-proof-v1:${JSON.stringify([vendorId,id])}`;
const receiptPurpose = (vendorId:string,id:string) => `learner-contact-receipt-v1:${JSON.stringify([vendorId,id])}`;

/** Persist a single exact attempt before HTTP. A lost worker never auto-reclaims
 * processing: acceptance may already have occurred, including after a DB rollback. */
export async function claimLearnerVerificationDelivery(db:Database,raw:unknown) {
 const identity=Identity.parse(raw),token=randomBytes(32).toString("base64url");
 const changed=await db.learnerNotificationVerification.updateMany({where:{...identity,deliveryStatus:"queued",deliveryAttemptCount:0,deliveryNextAttemptAt:{lte:new Date()}},
  data:{deliveryStatus:"processing",deliveryAttemptCount:1,deliveryClaimTokenHash:hash(token),deliveryNextAttemptAt:null}});
 return changed.count===1?{...identity,claimToken:token}:null;
}

type Prepared =
 | { status:"not_claimed" }
 | { status:"suppressed" }
 | { status:"ready"; sendToken:string; channel:LearnerNotificationChannel; destination:unknown; token:string; idempotencyKey:string };

/** Challenge sends require current purchase, but deliberately not notification
 * opt-in: the authenticated owner explicitly requested this contact/device proof.
 * Phase 1 is a short transaction that locks only the challenge row, re-checks
 * rights with plain reads and rotates the claim into a single-use send token. */
async function prepareVerificationDelivery(db:Database,input:{vendorId:string;id:string;claimToken:string}):Promise<Prepared> {
 const claim={vendorId:input.vendorId,id:input.id,deliveryStatus:"processing",deliveryClaimTokenHash:hash(input.claimToken)};
 return db.$transaction(async tx=>{
  await tx.$executeRawUnsafe(LEARNER_NOTIFICATION_LOCK_TIMEOUT_SQL);
  const rows=await tx.$queryRaw<Array<{id:string}>>`SELECT v."id" FROM "LearnerNotificationVerification" v
   WHERE v."vendorId"=${input.vendorId} AND v."id"=${input.id} AND v."deliveryStatus"='processing' AND v."deliveryClaimTokenHash"=${claim.deliveryClaimTokenHash}
   FOR UPDATE OF v`;
  if(rows.length!==1)return {status:"not_claimed"} as const;
  const row=await tx.learnerNotificationVerification.findFirstOrThrow({where:claim});
  const pref=await tx.learnerNotificationPreference.findFirstOrThrow({where:{vendorId:row.vendorId,productId:row.productId,id:row.preferenceId}});
  const rights=await learnerNotificationPurchaseIsCurrent(tx,{vendorId:row.vendorId,productId:row.productId,customerKeyHash:pref.customerKeyHash});
  if(!rights || row.consumedAt || row.expiresAt.getTime()<=Date.now() || pref.revision!==row.consentRevision || !row.deliveryTokenEncryptedEnvelope){
   await tx.learnerNotificationVerification.updateMany({where:claim,data:{deliveryStatus:"suppressed",deliveryClaimTokenHash:null,deliveryTokenEncryptedEnvelope:null}});
   return {status:"suppressed"} as const;
  }
  const token=decryptSensitiveValue(row.deliveryTokenEncryptedEnvelope,purpose(row.vendorId,row.id));
  if(!/^[A-Za-z0-9_-]{43}$/u.test(token) || hash(token)!==row.tokenHash)throw new Error("Invalid durable proof.");
  const scope={vendorId:row.vendorId,productId:row.productId,customerKeyHash:pref.customerKeyHash};
  const channel=LearnerNotificationChannel.parse(pref.channel);
  const destination=revealLearnerNotificationDestination(scope,channel,row.destinationEncryptedEnvelope);
  const sendToken=randomBytes(32).toString("base64url");
  const rotated=await tx.learnerNotificationVerification.updateMany({where:claim,data:{deliveryClaimTokenHash:hash(sendToken)}});
  if(rotated.count!==1)return {status:"not_claimed"} as const;
  return {status:"ready",sendToken,channel,destination,token,idempotencyKey:hash(JSON.stringify([row.vendorId,row.id,"contact-proof-v1"]))} as const;
 },LEARNER_NOTIFICATION_PRESEND_TRANSACTION);
}

/** One provider call outside any transaction, recorded by a CAS on the send
 * token. Never retried: an uncertain or unrecorded send is terminal. */
export async function dispatchLearnerVerificationDelivery(db:Database,raw:unknown,options:{appOrigin:string;configuration:NotificationProviderConfiguration;sender?:typeof sendLearnerNotificationProvider}) {
 const input=Identity.extend({claimToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/u)}).parse(raw);
 let prepared:Prepared;
 try { prepared=await prepareVerificationDelivery(db,input); }
 catch {
  try{const saved=await db.learnerNotificationVerification.updateMany({where:{vendorId:input.vendorId,id:input.id,deliveryStatus:"processing",deliveryClaimTokenHash:hash(input.claimToken)},data:{deliveryStatus:"failed",deliveryClaimTokenHash:null,deliveryTokenEncryptedEnvelope:null}});
   return {status:saved.count===1?"failed":"persistence_failed"} as const;
  }catch{return {status:"persistence_failed"} as const;}
 }
 if(prepared.status!=="ready")return prepared;
 // Proof stays in the body/push payload. No URL query, recipient identifier or
 // token in logs; the link is vendor-independent and resolved when opened.
 let result:NotificationProviderResult;
 try {
  result=await (options.sender??sendLearnerNotificationProvider)({channel:prepared.channel,destination:prepared.destination,appOrigin:options.appOrigin,idempotencyKey:prepared.idempotencyKey,
   message:{title:"驗證通知收件方式",body:`請回到原本的通知設定，輸入驗證碼：${prepared.token}。15 分鐘內有效；驗證後仍需自行開啟通知。`,path:learnerNotificationLink.notifications(input.vendorId)}},options.configuration);
  if(!["sent","not_delivered","indeterminate"].includes(result.outcome) || (result.providerReceipt?.length??0)>4096)result={outcome:"indeterminate",code:"OUTCOME_UNKNOWN"};
 } catch { result={outcome:"indeterminate",code:"OUTCOME_UNKNOWN"}; }
 const where={vendorId:input.vendorId,id:input.id,deliveryStatus:"processing",deliveryClaimTokenHash:hash(prepared.sendToken)};
 const receipt=result.providerReceipt?encryptSensitiveValue(result.providerReceipt,receiptPurpose(input.vendorId,input.id)):null;
 const status=result.outcome==="sent"?"sent":result.outcome==="not_delivered"?"failed":"indeterminate";
 try {
  const saved=await db.learnerNotificationVerification.updateMany({where,data:{deliveryStatus:status,deliveryClaimTokenHash:null,deliveryTokenEncryptedEnvelope:null,deliveredAt:status==="sent"?new Date():null,deliveryReceiptEncryptedEnvelope:receipt}});
  return {status:saved.count===1?status:"persistence_failed"} as const;
 } catch {
  // An exact persisted nonce settles uncertainty without repeating the provider call.
  try{const saved=await db.learnerNotificationVerification.updateMany({where,data:{deliveryStatus:"indeterminate",deliveryClaimTokenHash:null,deliveryTokenEncryptedEnvelope:null,deliveryReceiptEncryptedEnvelope:receipt}});
   return {status:saved.count===1?"indeterminate":"persistence_failed"} as const;
  }catch{return {status:"persistence_failed"} as const;}
 }
}
