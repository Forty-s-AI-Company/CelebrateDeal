import { materializeLearnerNotificationSourceEvent, recordLearnerNotificationSourceFailure } from "./learner-notification-source-events";
import { getDb } from "./db";
import { getCanonicalAppUrl } from "./app-url";
import { claimLearnerNotification } from "./learner-notification-outbox";
import { dispatchClaimedLearnerNotification } from "./learner-notification-dispatch";
import { claimLearnerVerificationDelivery, dispatchLearnerVerificationDelivery } from "./learner-verification-delivery";
import type { NotificationProviderConfiguration } from "./learner-notification-providers";
import { LearnerPhoneDestination } from "./learner-notification-contract";
import { captureOperationalError } from "./monitoring";

/** Configuration comes only from the approved server process. No browser input
 * can change a provider endpoint, sender, VAPID key or tenant execution scope. */
export function readLearnerNotificationProviderConfiguration(env:NodeJS.ProcessEnv=process.env):NotificationProviderConfiguration {
 const config:NotificationProviderConfiguration={};
 if(env.RESEND_API_KEY && env.EMAIL_FROM)config.email={enabled:true};
 if(env.TWILIO_ACCOUNT_SID && /^AC[a-fA-F0-9]{32}$/u.test(env.TWILIO_ACCOUNT_SID) && env.TWILIO_AUTH_TOKEN && LearnerPhoneDestination.safeParse({phone:env.TWILIO_SMS_FROM}).success)
  config.sms={accountSid:env.TWILIO_ACCOUNT_SID,authToken:env.TWILIO_AUTH_TOKEN,from:env.TWILIO_SMS_FROM!};
 if(env.WHATSAPP_CLOUD_API_VERSION && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_NOTIFICATION_TEMPLATE && env.WHATSAPP_TEMPLATE_LANGUAGE)
  config.whatsapp={version:env.WHATSAPP_CLOUD_API_VERSION,phoneNumberId:env.WHATSAPP_PHONE_NUMBER_ID,accessToken:env.WHATSAPP_ACCESS_TOKEN,templateName:env.WHATSAPP_NOTIFICATION_TEMPLATE,language:env.WHATSAPP_TEMPLATE_LANGUAGE};
 if(env.WEB_PUSH_VAPID_SUBJECT && env.WEB_PUSH_VAPID_PUBLIC_KEY && env.WEB_PUSH_VAPID_PRIVATE_KEY)
  config.push={subject:env.WEB_PUSH_VAPID_SUBJECT,publicKey:env.WEB_PUSH_VAPID_PUBLIC_KEY,privateKey:env.WEB_PUSH_VAPID_PRIVATE_KEY};
 return config;
}

/** Per-run budgets. Each phase is vendor-fair: queues are read per approved
 * tenant and interleaved round-robin, with a per-vendor cap, so one learner or
 * tenant cannot starve the others. Proofs have their own batch because a code
 * expires in 15 minutes. */
export const LEARNER_NOTIFICATION_JOB_LIMITS={
 sources:{batch:20,perVendor:10},
 proofs:{batch:25,perVendor:10},
 deliveries:{batch:50,perVendor:25},
 concurrency:5,
 deadlineMs:20000,
} as const;

export type LearnerNotificationJobSummary={
 results:Array<{status:string}>;
 /** Remaining due work after this run, per phase; null when it could not be counted. */
 backlog:{sources:number;proofs:number;deliveries:number}|null;
};

/** Round-robin interleave of per-vendor queues: every vendor gets one turn per
 * round, no vendor exceeds `perVendor`, and the result never exceeds `batch`. */
export function fairVendorBatch<T>(queues:ReadonlyArray<ReadonlyArray<T>>,batch:number,perVendor:number):T[] {
 const selected:T[]=[];
 for(let round=0;round<perVendor && selected.length<batch;round++){
  let progressed=false;
  for(const queue of queues){
   if(selected.length>=batch)break;
   const row=queue[round];
   if(row!==undefined){selected.push(row);progressed=true;}
  }
  if(!progressed)break;
 }
 return selected;
}

function report(error:unknown,operation:string,status:string){
 try{captureOperationalError(error,{source:"learner_notification_job",operation,status});}catch{/* monitoring is best effort */}
}

/** Run with bounded concurrency; no new item starts after the deadline. */
async function runBounded<T>(items:readonly T[],deadline:number,run:(item:T)=>Promise<{status:string}>,onError:(error:unknown)=>{status:string}) {
 const results:Array<{status:string}|undefined>=new Array(items.length);
 let next=0;
 async function worker(){
  for(;;){
   if(Date.now()>=deadline)return;
   const index=next++;if(index>=items.length)return;
   try{results[index]=await run(items[index]!);}catch(error){results[index]=onError(error);}
  }
 }
 await Promise.all(Array.from({length:Math.min(LEARNER_NOTIFICATION_JOB_LIMITS.concurrency,items.length)},worker));
 return results.filter((value):value is {status:string}=>value!==undefined);
}

/** One existing authorized email job also drains this queue. Explicit tenant
 * scope and an execution flag prevent an unconfigured run from sending globally.
 * Each phase has its own error boundary: a failing source backs off and is
 * dead-lettered without blocking proofs, deliveries or other tenants.
 * Return status and counts only, never recipient IDs, tokens, payloads or provider responses. */
export async function processDueLearnerNotifications(env:NodeJS.ProcessEnv=process.env):Promise<LearnerNotificationJobSummary> {
 const empty=(status?:string):LearnerNotificationJobSummary=>({results:status?[{status}]:[],backlog:null});
 if(env.LEARNER_NOTIFICATIONS_EXECUTOR_ENABLED!=="true")return empty();
 const vendors=[...new Set((env.LEARNER_NOTIFICATIONS_JOB_VENDOR_IDS??"").split(",").map(value=>value.trim()).filter(Boolean))];
 if(vendors.length<1 || vendors.length>25 || vendors.some(value=>!/^[A-Za-z0-9_-]{1,128}$/u.test(value)))return empty("configuration_missing");
 const configuration=readLearnerNotificationProviderConfiguration(env);
 const channels=Object.keys(configuration);
 if(channels.length===0)return empty("configuration_missing");
 let appOrigin:string;
 try{appOrigin=getCanonicalAppUrl(env);if(new URL(appOrigin).protocol!=="https:")return empty("configuration_missing");}
 catch{return empty("configuration_missing");}
 const db=getDb(),results:Array<{status:string}>=[],deadline=Date.now()+LEARNER_NOTIFICATION_JOB_LIMITS.deadlineMs;
 const limits=LEARNER_NOTIFICATION_JOB_LIMITS;
 const sourceDue=(now:Date)=>({completedAt:null,deadLetteredAt:null,availableAt:{lte:now},OR:[{nextAttemptAt:null},{nextAttemptAt:{lte:now}}]});
 const proofDue=(now:Date)=>({deliveryStatus:"queued",deliveryAttemptCount:0,deliveryNextAttemptAt:{lte:now},preference:{is:{channel:{in:channels}}}});
 const deliveryDue=(now:Date)=>({status:"queued",attemptCount:{lt:5},nextAttemptAt:{lte:now},preference:{is:{channel:{in:channels}}}});

 // Phase 1: domain sources. DB-only; a failure is recorded on that source alone.
 try{
  const now=new Date();
  const queues=await Promise.all(vendors.map(vendorId=>db.learnerNotificationSourceEvent.findMany({where:{vendorId,...sourceDue(now)},orderBy:[{availableAt:"asc"},{id:"asc"}],take:limits.sources.perVendor,select:{vendorId:true,id:true}})));
  for(const source of fairVendorBatch(queues,limits.sources.batch,limits.sources.perVendor)){
   if(Date.now()>=deadline)break;
   try{results.push({status:(await materializeLearnerNotificationSourceEvent(db,source.vendorId,source.id)).status});}
   catch(error){
    let status="failed";
    try{status=await recordLearnerNotificationSourceFailure(db,source.vendorId,source.id);}catch{status="failed";}
    report(error,"materialize_source",status);
    results.push({status});
   }
  }
 }catch(error){report(error,"select_sources","failed");results.push({status:"failed"});}

 // Phase 2: contact proofs, with their own batch so codes are sent before expiry.
 try{
  const now=new Date();
  const queues=await Promise.all(vendors.map(vendorId=>db.learnerNotificationVerification.findMany({where:{vendorId,...proofDue(now)},orderBy:[{createdAt:"asc"},{id:"asc"}],take:limits.proofs.perVendor,select:{vendorId:true,id:true}})));
  results.push(...await runBounded(fairVendorBatch(queues,limits.proofs.batch,limits.proofs.perVendor),deadline,async row=>{
   const claim=await claimLearnerVerificationDelivery(db,row);
   if(!claim)return {status:"claimed_elsewhere"};
   return {status:(await dispatchLearnerVerificationDelivery(db,claim,{appOrigin,configuration})).status};
  },error=>{report(error,"dispatch_proof","failed");return {status:"failed"};}));
 }catch(error){report(error,"select_proofs","failed");results.push({status:"failed"});}

 // Phase 3: notification deliveries.
 try{
  const now=new Date();
  const queues=await Promise.all(vendors.map(vendorId=>db.learnerNotificationDelivery.findMany({where:{vendorId,...deliveryDue(now)},orderBy:[{createdAt:"asc"},{id:"asc"}],take:limits.deliveries.perVendor,select:{vendorId:true,id:true}})));
  results.push(...await runBounded(fairVendorBatch(queues,limits.deliveries.batch,limits.deliveries.perVendor),deadline,async row=>{
   const claim=await claimLearnerNotification(db,row.vendorId,row.id);
   if(!claim)return {status:"claimed_elsewhere"};
   return {status:(await dispatchClaimedLearnerNotification(db,{vendorId:row.vendorId,id:row.id,claimToken:claim.claimToken},{appOrigin,configuration})).status};
  },error=>{report(error,"dispatch_delivery","failed");return {status:"failed"};}));
 }catch(error){report(error,"select_deliveries","failed");results.push({status:"failed"});}

 // Remaining due work, so operators can see a growing queue before codes expire.
 let backlog:LearnerNotificationJobSummary["backlog"]=null;
 try{
  const now=new Date(),vendorId={in:vendors};
  const [sources,proofs,deliveries]=await Promise.all([
   db.learnerNotificationSourceEvent.count({where:{vendorId,...sourceDue(now)}}),
   db.learnerNotificationVerification.count({where:{vendorId,...proofDue(now)}}),
   db.learnerNotificationDelivery.count({where:{vendorId,...deliveryDue(now)}}),
  ]);
  backlog={sources,proofs,deliveries};
 }catch(error){report(error,"count_backlog","failed");}
 return {results,backlog};
}
