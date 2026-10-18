import { getCanonicalAppUrl } from "./app-url";
import { readLearnerNotificationProviderConfiguration } from "./learner-notification-job";

/** Only public channel availability and the public VAPID key leave the server.
 * Recipient scope and execution configuration are selected by the server session. */
export function getLearnerNotificationCapabilities(vendorId:string,env:NodeJS.ProcessEnv=process.env) {
 const unavailable={availableChannels:[] as string[],pushPublicKey:null as string|null};
 if(env.LEARNER_NOTIFICATIONS_EXECUTOR_ENABLED!=="true")return unavailable;
 const approved=(env.LEARNER_NOTIFICATIONS_JOB_VENDOR_IDS??"").split(",").map(value=>value.trim()).filter(Boolean);
 if(approved.length<1 || approved.length>25 || approved.some(value=>!/^[A-Za-z0-9_-]{1,128}$/u.test(value)) || !approved.includes(vendorId))return unavailable;
 try{if(new URL(getCanonicalAppUrl(env)).protocol!=="https:")return unavailable;}catch{return unavailable;}
 const configuration=readLearnerNotificationProviderConfiguration(env);
 const pushPublicKey=configuration.push && /^[A-Za-z0-9_-]{87}$/u.test(configuration.push.publicKey)?configuration.push.publicKey:null;
 return {availableChannels:Object.keys(configuration).filter(channel=>channel!=="push" || !!pushPublicKey),pushPublicKey};
}
