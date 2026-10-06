import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { LearnerNotificationChannel, revealLearnerNotificationDestination } from "./learner-notification-contract";
import { decryptSensitiveValue, encryptSensitiveValue } from "./sensitive-data";
import { sendLearnerNotificationProvider, type NotificationProviderConfiguration } from "./learner-notification-providers";

type Database = Pick<PrismaClient,"$transaction" | "learnerNotificationVerification">;
const Identity = z.object({vendorId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u)}).strict();
const hash = (value:string) => createHash("sha256").update(value).digest("hex");
const purpose = (vendorId:string,id:string) => `learner-contact-proof-v1:${JSON.stringify([vendorId,id])}`;

/** Persist a single exact attempt before HTTP. A lost worker never auto-reclaims
 * processing: acceptance may already have occurred, including after a DB rollback. */
export async function claimLearnerVerificationDelivery(db:Database,raw:unknown) {
 const identity=Identity.parse(raw),token=randomBytes(32).toString("base64url");
 const changed=await db.learnerNotificationVerification.updateMany({where:{...identity,deliveryStatus:"queued",deliveryAttemptCount:0,deliveryNextAttemptAt:{lte:new Date()}},
  data:{deliveryStatus:"processing",deliveryAttemptCount:1,deliveryClaimTokenHash:hash(token),deliveryNextAttemptAt:null}});
 return changed.count===1?{...identity,claimToken:token}:null;
}

/** Challenge sends require current purchase, but deliberately not notification
 * opt-in: the authenticated owner explicitly requested this contact/device proof.
 * Keep row locks through one bounded provider attempt, and never retry that HTTP. */
export async function dispatchLearnerVerificationDelivery(db:Database,raw:unknown,options:{appOrigin:string;configuration:NotificationProviderConfiguration;sender?:typeof sendLearnerNotificationProvider}) {
 const input=Identity.extend({claimToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/u)}).parse(raw);
 const where={vendorId:input.vendorId,id:input.id,deliveryStatus:"processing",deliveryClaimTokenHash:hash(input.claimToken)};
 let attempted=false,receipt:string|undefined;
 try {
  return await db.$transaction(async tx=>{
   const rows=await tx.$queryRaw<Array<{id:string}>>`SELECT v."id" FROM "LearnerNotificationVerification" v
    JOIN "LearnerNotificationPreference" p ON p."vendorId"=v."vendorId" AND p."productId"=v."productId" AND p."id"=v."preferenceId"
    WHERE v."vendorId"=${input.vendorId} AND v."id"=${input.id} AND v."deliveryStatus"='processing' AND v."deliveryClaimTokenHash"=${where.deliveryClaimTokenHash}
    FOR UPDATE OF p,v`;
   if(rows.length!==1)return {status:"not_claimed"} as const;
   const row=await tx.learnerNotificationVerification.findFirstOrThrow({where});
   const pref=await tx.learnerNotificationPreference.findFirstOrThrow({where:{vendorId:row.vendorId,productId:row.productId,id:row.preferenceId}});
   const rights=await tx.$queryRaw<Array<{id:string}>>`SELECT e."id" FROM "CommerceOrderItem" i
    JOIN "CommerceOrder" o ON o."vendorId"=i."vendorId" AND o."id"=i."orderId"
    JOIN "CommerceEntitlement" e ON e."vendorId"=i."vendorId" AND e."orderItemId"=i."id"
    WHERE i."vendorId"=${row.vendorId} AND i."productId"=${row.productId} AND i."fulfillmentType"='course'
    AND o."automationCustomerKeyHash"=${pref.customerKeyHash} AND o."status" IN ('paid','partially_refunded')
    AND e."status"='granted' AND e."revokedAt" IS NULL AND (e."expiresAt" IS NULL OR e."expiresAt">clock_timestamp())
    ORDER BY e."id" LIMIT 1 FOR UPDATE OF o,e`;
   if(!rights.length || row.consumedAt || row.expiresAt.getTime()<=Date.now() || pref.revision!==row.consentRevision || !row.deliveryTokenEncryptedEnvelope){
    await tx.learnerNotificationVerification.update({where:{id:row.id},data:{deliveryStatus:"suppressed",deliveryClaimTokenHash:null,deliveryTokenEncryptedEnvelope:null}});
    return {status:"suppressed"} as const;
   }
   const token=decryptSensitiveValue(row.deliveryTokenEncryptedEnvelope,purpose(row.vendorId,row.id));
   if(!/^[A-Za-z0-9_-]{43}$/u.test(token) || hash(token)!==row.tokenHash)throw new Error("Invalid durable proof.");
   const scope={vendorId:row.vendorId,productId:row.productId,customerKeyHash:pref.customerKeyHash};
   const channel=LearnerNotificationChannel.parse(pref.channel);
   const vendor=await tx.vendor.findUniqueOrThrow({where:{id:row.vendorId},select:{slug:true}});
   const destination=revealLearnerNotificationDestination(scope,channel,row.destinationEncryptedEnvelope);
   // Proof stays in the body/push payload. No URL query, recipient identifier or token in logs.
   attempted=true;
   const result=await (options.sender??sendLearnerNotificationProvider)({channel,destination,appOrigin:options.appOrigin,idempotencyKey:hash(JSON.stringify([row.vendorId,row.id,"contact-proof-v1"])),
    message:{title:"驗證通知收件方式",body:`請回到原本的課程通知設定，輸入驗證碼：${token}。15 分鐘內有效；驗證後仍需自行開啟通知。`,path:`/portal/${encodeURIComponent(vendor.slug)}/learn/${encodeURIComponent(row.productId)}`}},options.configuration);
   if(!["sent","not_delivered","indeterminate"].includes(result.outcome) || (result.providerReceipt?.length??0)>4096)throw new Error("Invalid provider outcome.");
   receipt=result.providerReceipt;
   const status=result.outcome==="sent"?"sent":result.outcome==="not_delivered"?"failed":"indeterminate";
   await tx.learnerNotificationVerification.update({where:{id:row.id},data:{deliveryStatus:status,deliveryClaimTokenHash:null,deliveryTokenEncryptedEnvelope:null,
    deliveredAt:status==="sent"?new Date():null,deliveryReceiptEncryptedEnvelope:result.providerReceipt?encryptSensitiveValue(result.providerReceipt,`learner-contact-receipt-v1:${JSON.stringify([row.vendorId,row.id])}`):null}});
   return {status} as const;
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted,maxWait:5000,timeout:25000});
 }catch{
  // An exact persisted nonce settles uncertainty without repeating the provider call.
  const status=attempted?"indeterminate":"failed";
  try{const saved=await db.learnerNotificationVerification.updateMany({where,data:{deliveryStatus:status,deliveryClaimTokenHash:null,deliveryTokenEncryptedEnvelope:null,deliveryReceiptEncryptedEnvelope:receipt?encryptSensitiveValue(receipt,`learner-contact-receipt-v1:${JSON.stringify([input.vendorId,input.id])}`):null}});
   return {status:saved.count===1?status:"persistence_failed"} as const;
  }catch{return {status:"persistence_failed"} as const;}
 }
}
