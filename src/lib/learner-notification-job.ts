import { getDb } from "./db";
import { getCanonicalAppUrl } from "./app-url";
import { claimLearnerNotification } from "./learner-notification-outbox";
import { dispatchClaimedLearnerNotification } from "./learner-notification-dispatch";
import { claimLearnerVerificationDelivery, dispatchLearnerVerificationDelivery } from "./learner-verification-delivery";
import type { NotificationProviderConfiguration } from "./learner-notification-providers";
import { LearnerPhoneDestination } from "./learner-notification-contract";

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

/** One existing authorized email job also drains this queue. Explicit tenant
 * scope and an execution flag prevent an unconfigured run from sending globally.
 * Return status only, never recipient IDs, tokens, payloads or provider responses. */
export async function processDueLearnerNotifications(env:NodeJS.ProcessEnv=process.env):Promise<Array<{status:string}>> {
 if(env.LEARNER_NOTIFICATIONS_EXECUTOR_ENABLED!=="true")return [];
 const vendors=(env.LEARNER_NOTIFICATIONS_JOB_VENDOR_IDS??"").split(",").map(value=>value.trim()).filter(Boolean);
 if(vendors.length<1 || vendors.length>25 || vendors.some(value=>!/^[A-Za-z0-9_-]{1,128}$/u.test(value)))return [{status:"configuration_missing"}];
 const configuration=readLearnerNotificationProviderConfiguration(env);
 const channels=Object.keys(configuration);
 if(channels.length===0)return [{status:"configuration_missing"}];
 let appOrigin:string;
 try{appOrigin=getCanonicalAppUrl(env);if(new URL(appOrigin).protocol!=="https:")return [{status:"configuration_missing"}];}
 catch{return [{status:"configuration_missing"}];}
 const db=getDb(),results:Array<{status:string}>=[],deadline=Date.now()+20000;
 try{
  // Reserve one bounded challenge slot; both queues share the invocation deadline.
  const proofs=await db.learnerNotificationVerification.findMany({where:{vendorId:{in:vendors},deliveryStatus:"queued",deliveryAttemptCount:0,deliveryNextAttemptAt:{lte:new Date()},preference:{is:{channel:{in:channels}}}},orderBy:[{createdAt:"asc"},{id:"asc"}],take:1,select:{vendorId:true,id:true}});
  for(const row of proofs){
   if(Date.now()>=deadline)break;
   const claim=await claimLearnerVerificationDelivery(db,row);
   if(!claim){results.push({status:"claimed_elsewhere"});continue;}
   const outcome=await dispatchLearnerVerificationDelivery(db,claim,{appOrigin,configuration});results.push({status:outcome.status});
  }
  const due=await db.learnerNotificationDelivery.findMany({where:{vendorId:{in:vendors},status:"queued",attemptCount:{lt:5},nextAttemptAt:{lte:new Date()},preference:{is:{channel:{in:channels}}}},orderBy:[{createdAt:"asc"},{id:"asc"}],take:5,select:{vendorId:true,id:true}});
  for(const row of due){
   if(Date.now()>=deadline)break;
   const claim=await claimLearnerNotification(db,row.vendorId,row.id);
   if(!claim){results.push({status:"claimed_elsewhere"});continue;}
   const result=await dispatchClaimedLearnerNotification(db,{vendorId:row.vendorId,id:row.id,claimToken:claim.claimToken},{appOrigin,configuration});
   results.push({status:result.status});
  }
 }catch{results.push({status:"failed"});}
 return results;
}
