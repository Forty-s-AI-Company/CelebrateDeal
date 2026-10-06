"use client";

import { useId,useRef,useState,useSyncExternalStore } from "react";
import { z } from "zod";
import { LearnerConsultationReminders } from "./learner-consultation-reminders";

const Channel=z.enum(["email","sms","whatsapp","push"]);
const Preference=z.object({channel:Channel,enabled:z.boolean(),revision:z.number().int().positive(),destinationVerifiedAt:z.string().datetime().nullable()});
const Snapshot=z.object({preferences:z.array(Preference).max(4),csrfToken:z.string().min(1).max(2048),capabilities:z.object({availableChannels:z.array(Channel).max(4),pushPublicKey:z.string().regex(/^[A-Za-z0-9_-]{87}$/u).nullable()})});
type ChannelName=z.infer<typeof Channel>;
const labels:Record<ChannelName,string>={email:"Email",sms:"SMS",whatsapp:"WhatsApp",push:"裝置推播"};
const button="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
const subscribeToHydration=()=>()=>{};
const clientHydrationSnapshot=()=>true;
const serverHydrationSnapshot=()=>false;
/** Keep the pending status copy consistent across channel operations. */
function notificationStatusText(busy:boolean,notice:string){return busy?"處理中…":notice;}

/** Contacts/proofs live only in this transient form. No localStorage, telemetry
 * or URL parameters. Durable state and consent revisions always come from API. */
export function LearnerNotificationSettings({vendorSlug,courseId}:{vendorSlug:string;courseId:string}) {
 const interactive=useSyncExternalStore(subscribeToHydration,clientHydrationSnapshot,serverHydrationSnapshot);
 const headingId=useId();
 const endpoint=`/portal/${encodeURIComponent(vendorSlug)}/learn/${encodeURIComponent(courseId)}/notifications`;
 const [snapshot,setSnapshot]=useState<z.infer<typeof Snapshot>|null>(null);
 const [channel,setChannel]=useState<ChannelName>("email");
 const [contact,setContact]=useState("");const [proof,setProof]=useState("");
 const [challenge,setChallenge]=useState<{id:string;expiresAt:string;channel:ChannelName}|null>(null);
 const [busy,setBusy]=useState(false);const [notice,setNotice]=useState("");
 const lock=useRef(false);const csrf=useRef("");
 const preference=snapshot?.preferences.find(value=>value.channel===channel);
 const available=snapshot?.capabilities.availableChannels.includes(channel)??false;

 async function refresh(){
  const response=await fetch(endpoint,{headers:{"x-celebratedeal-client":"web"},credentials:"same-origin",cache:"no-store"});
  if(!response.ok)throw new Error("目前無法讀取通知設定，請確認登入與課程權益。");
  const parsed=Snapshot.safeParse(await response.json());if(!parsed.success)throw new Error("收到的通知設定不完整，請稍後再試。");
  csrf.current=parsed.data.csrfToken;setSnapshot(parsed.data);return parsed.data;
 }
 async function action(run:()=>Promise<void>){
  if(!interactive || lock.current)return;lock.current=true;setBusy(true);setNotice("");
  try{await run();}catch(error){setNotice(error instanceof Error && error.message.startsWith("通知：")?error.message.slice(3):"目前無法完成通知設定，請重新載入後再試。");}
  finally{lock.current=false;setBusy(false);}
 }
 async function post(path:string,body:unknown){
  const send=()=>fetch(endpoint+path,{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json","x-celebratedeal-client":"web","x-csrf-token":csrf.current},body:JSON.stringify(body)});
  let response=await send();
  // Renewal retries only an explicit 403, before a mutation is accepted. Network
  // failures and uncertain POST results are never automatically replayed.
  if(response.status===403){await refresh();response=await send();}
  if(!response.ok){
   const notices:Record<number,string>={400:"請確認聯絡方式或驗證碼格式。",404:"目前沒有這門課程的權益。",409:"設定已變更或驗證碼失效，請重新載入後再試。",429:"請等一分鐘再索取驗證碼。",503:"此通知渠道目前無法使用，請稍後再試。"};
   throw new Error(`通知：${notices[response.status]??"目前無法儲存設定，請稍後再試。"}`);
  }
  return response;
 }
 async function requestProof(){
  let destination:unknown;
  if(channel==="push"){
   if(!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))throw new Error("通知：此瀏覽器不支援裝置推播。");
   const registration=await navigator.serviceWorker.getRegistration();
   if(!registration || !snapshot?.capabilities.pushPublicKey)throw new Error("通知：請先啟用此網站的 PWA，再設定裝置推播。");
   if(await Notification.requestPermission()!=="granted")throw new Error("通知：未取得推播權限，沒有開啟通知。");
   const key=Uint8Array.from(atob(snapshot.capabilities.pushPublicKey.replaceAll("-","+").replaceAll("_","/")+"="),char=>char.charCodeAt(0));
   const subscription=await registration.pushManager.getSubscription()??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
   destination=subscription.toJSON();
  }else destination=channel==="email"?{email:contact.trim()}:{phone:contact.trim()};
  const response=await post("/enroll",{channel,destination,expectedRevision:preference?.revision??0});
  const result=z.object({status:z.literal("challenge_queued"),challenge:z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),expiresAt:z.string().datetime()})}).safeParse(await response.json());
  if(!result.success)throw new Error("通知：收到的驗證請求不完整，請重新載入。");
  setChallenge({...result.data.challenge,channel});setContact("");setProof("");await refresh();setNotice("驗證碼已排入寄送佇列，請在 15 分鐘內輸入。尚未開啟通知。");
 }
 async function verify(){
  if(!challenge || challenge.channel!==channel || !/^[A-Za-z0-9_-]{43}$/u.test(proof.trim()))throw new Error("通知：請輸入完整的驗證碼。");
  const response=await post("/verify",{challengeId:challenge.id,token:proof.trim()});
  if(!z.object({status:z.literal("verified"),preference:Preference}).safeParse(await response.json()).success)throw new Error("通知：收到的驗證結果不完整，請重新載入。");
  setProof("");setChallenge(null);await refresh();setNotice("收件方式已驗證。請自行按下「開啟通知」，才會收到後續消息。");
 }
 async function toggle(){
  if(!preference)throw new Error("通知：請先驗證收件方式。");
  const response=await post("",{channel,enabled:!preference.enabled,expectedRevision:preference.revision});
  const parsed=z.object({status:z.literal("saved"),preference:Preference}).safeParse(await response.json());
  if(!parsed.success || parsed.data.preference.channel!==channel || parsed.data.preference.enabled===preference.enabled)throw new Error("通知：收到的同意狀態不完整，請重新載入。");
  await refresh();setNotice(parsed.data.preference.enabled?"已開啟此課程通知。":"已取消此課程通知。");
 }
 return <section aria-labelledby={headingId} className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
  <h2 id={headingId} className="text-xl font-bold">課程通知</h2>
  <p className="mt-2 text-sm text-slate-600">自行選擇收件方式，驗證後再開啟通知。可以隨時取消。</p>
  <button className={`${button} mt-4`} type="button" disabled={!interactive || busy} onClick={()=>void action(async()=>{await refresh();setNotice("通知設定已載入。");})}>{snapshot?"重新載入設定":"載入通知設定"}</button>
  {snapshot?<div className="mt-4 space-y-4">
   <label className="block text-sm font-semibold">通知渠道<select className="ml-3 min-h-11 rounded-lg border border-slate-300 px-3" value={channel} disabled={busy} onChange={event=>{const next=Channel.safeParse(event.target.value);if(next.success){setChannel(next.data);setContact("");setProof("");setChallenge(null);setNotice("");}}}>{Channel.options.map(value=><option key={value} value={value}>{labels[value]}</option>)}</select></label>
   <p className="text-sm text-slate-600">{preference?.enabled?"通知已開啟":preference?.destinationVerifiedAt?"已驗證，通知尚未開啟":"收件方式尚未驗證"}{!available?"；此渠道目前無法寄送新驗證碼。":""}</p>
   {channel!=="push"?<label className="block text-sm font-semibold">{channel==="email"?"Email 地址":"手機號碼，含國碼"}<input className="mt-1 block min-h-11 w-full max-w-md rounded-lg border border-slate-300 px-3" type={channel==="email"?"email":"tel"} autoComplete="off" maxLength={254} disabled={busy} value={contact} onChange={event=>setContact(event.target.value)} placeholder={channel==="email"?"name@example.com":"+886912345678"}/></label>:null}
   <button className={button} type="button" disabled={busy || !available || (channel!=="push" && !contact.trim())} onClick={()=>void action(requestProof)}>{channel==="push"?"驗證這台裝置":"寄送驗證碼"}</button>
   {challenge && challenge.channel===channel?<div className="space-y-2"><p className="text-sm text-slate-600">驗證碼有效至 {new Date(challenge.expiresAt).toLocaleTimeString("zh-TW")}。驗證碼不會顯示在本頁。</p><label className="block text-sm font-semibold">驗證碼<input className="mt-1 block min-h-11 w-full max-w-md rounded-lg border border-slate-300 px-3" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={43} value={proof} disabled={busy} onChange={event=>setProof(event.target.value)}/></label><button className={button} type="button" disabled={busy || proof.trim().length!==43} onClick={()=>void action(verify)}>確認驗證碼</button></div>:null}
   <button className={`${button} ml-2`} type="button" disabled={busy || !preference || (!preference.enabled && (!preference.destinationVerifiedAt || !available))} onClick={()=>void action(toggle)}>{preference?.enabled?"取消通知":"開啟通知"}</button>
  </div>:null}
  {snapshot?<LearnerConsultationReminders vendorSlug={vendorSlug} courseId={courseId} />:null}
  <p role="status" aria-label="課程通知狀態" aria-live="polite" className="mt-3 text-sm text-slate-700">{notificationStatusText(busy,notice)}</p>
 </section>;
}
