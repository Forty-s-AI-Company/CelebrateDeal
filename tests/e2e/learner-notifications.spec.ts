import { hashPassword } from "../../src/lib/password";
import { randomUUID } from "node:crypto";
import { expect,test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { automationCustomerKeyHash } from "../../src/lib/automation-workflow";
import { protectCommerceOrderPii } from "../../src/lib/commerce-order-pii";
import { reconcileCommerceOrderRefund } from "../../src/lib/commerce-orders";
import { grantCommerceEntitlement } from "../../src/lib/commerce-order-fulfillment";
import { createStudentPortalAccessToken } from "../../src/lib/student-portal-auth";
import { saveLearnerNotificationConsent } from "../../src/lib/learner-notification-preferences";
import { protectLearnerNotificationDestination } from "../../src/lib/learner-notification-contract";

test("actual portal worker receives a synthetic device message and keeps authenticated traffic out of cache",async({page,context,baseURL})=>{
 test.setTimeout(120000);
 if(!baseURL)throw new Error("Owned loopback browser origin required");
 await context.grantPermissions(["notifications"],{origin:baseURL});
 const session=await context.newCDPSession(page);let registrationId:string|undefined;
 session.on("ServiceWorker.workerRegistrationUpdated",({registrations})=>{
  for(const registration of registrations)if(registration.scopeURL===`${baseURL}/portal/`&&!registration.isDeleted)registrationId=registration.registrationId;
 });
 await session.send("ServiceWorker.enable");
 // Observe the application's own registration call without initiating one or
 // retaining browser errors, URLs, account data, or provider credentials.
 await page.addInitScript(()=>{
  const state={attempted:false,accepted:false,error:"none"};
  Object.defineProperty(window,"portalWorkerProbe",{value:state});
  const original=navigator.serviceWorker.register.bind(navigator.serviceWorker);
  navigator.serviceWorker.register=(...args)=>{
   state.attempted=true;
   return original(...args).then(result=>{state.accepted=true;return result;},error=>{
    state.error=["TypeError","SecurityError","InvalidStateError","AbortError"].includes(error?.name)?error.name:"other";
    throw error;
   });
  };
 });
 try{
  await page.goto(`${baseURL}/portal/`);await expect(page.getByRole("heading",{name:"你的學習中心",exact:true})).toBeVisible();
  await expect(page).toHaveURL(`${baseURL}/portal/start/welcome`);
  expect(await page.evaluate(()=>window.isSecureContext)).toBe(true);
  const workerScript=await page.request.get(`${baseURL}/portal/sw.js`);expect(workerScript.status()).toBe(200);expect(workerScript.headers()["content-type"]).toContain("javascript");
  for(const asset of ["/portal/offline.html","/portal/manifest.webmanifest","/portal/icon-192.png","/portal/icon-512.png"])expect((await page.request.get(`${baseURL}${asset}`)).status()).toBe(200);
  await expect.poll(()=>page.evaluate(()=>navigator.serviceWorker.controller?.scriptURL??null)).toBe(`${baseURL}/portal/sw.js`);
  await expect.poll(()=>registrationId).toBeTruthy();
  const manifest=await page.locator('link[rel="manifest"]').getAttribute("href");expect(manifest).toBe("/portal/manifest.webmanifest");
  const manifestData=await (await page.request.get(`${baseURL}${manifest}`)).json();
  expect(manifestData.scope).toBe("/portal/");expect(manifestData.start_url).toBe("/portal/start/welcome");
  // This is browser-local CDP delivery of a synthetic payload, never a receipt
  // from Google/Apple/Mozilla or any configured external push provider.
  await session.send("ServiceWorker.deliverPushMessage",{origin:baseURL,registrationId:registrationId!,data:JSON.stringify({title:"合成裝置通知",body:"只驗證本機 worker 接收",path:"/portal/academy/learn/course_a/community/post_a"})});
  await expect.poll(()=>page.evaluate(async()=>{
   const registration=await navigator.serviceWorker.ready;
   const messages=await registration.getNotifications();
   return messages.map(message=>({title:message.title,body:message.body,data:message.data}));
  })).toEqual([{title:"合成裝置通知",body:"只驗證本機 worker 接收",data:{path:"/portal/academy/learn/course_a/community/post_a"}}]);
  const cachePaths=await page.evaluate(async()=>{
   const names=(await caches.keys()).filter(name=>name.startsWith("celebratedeal-portal-public-"));
   return (await Promise.all(names.map(async name=>(await (await caches.open(name)).keys()).map(request=>new URL(request.url).pathname)))).flat().sort();
  });
  expect(cachePaths).toEqual(["/portal/icon-192.png","/portal/icon-512.png","/portal/manifest.webmanifest","/portal/offline.html"]);
  const originalUrl=page.url();await context.setOffline(true);
  const privateResults=await page.evaluate(async()=>{
   const request=async(path:string,options?:RequestInit)=>{try{const response=await fetch(path,options);return {networkFailed:false,status:response.status};}catch{return {networkFailed:true};}};
   return Promise.all([request("/portal/synthetic/learn/course_a/community/data"),request("/portal/synthetic?_rsc=synthetic",{headers:{rsc:"1"}}),request("/portal/synthetic/learn/course_a/progress",{method:"POST",body:"{}"})]);
  });
  expect(privateResults).toEqual([{networkFailed:true},{networkFailed:true},{networkFailed:true}]);expect(page.url()).toBe(originalUrl);
  const offline=await page.goto(`${baseURL}/portal/synthetic/learn/course_a`);expect(offline?.status()).toBe(503);await expect(page.getByRole("heading",{name:"目前沒有網路連線",exact:true})).toBeVisible();
  await context.setOffline(false);await page.goto(`${baseURL}/portal/`);await expect(page.getByRole("heading",{name:"你的學習中心",exact:true})).toBeVisible();
  expect(await page.evaluate(async()=>(await (await caches.open("celebratedeal-portal-public-v1")).keys()).map(request=>new URL(request.url).pathname).sort())).toEqual(cachePaths);
 }finally{
  const probe=await page.evaluate(()=>Reflect.get(window,"portalWorkerProbe")).catch(()=>null);
  if(probe&&typeof probe.attempted==="boolean"&&typeof probe.accepted==="boolean"&&["none","TypeError","SecurityError","InvalidStateError","AbortError","other"].includes(probe.error)){
   console.log(`::notice::portal-worker attempted=${probe.attempted} accepted=${probe.accepted} error=${probe.error}`);
  }
  await context.setOffline(false);
  await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration("/portal/");if(registration)for(const notification of await registration.getNotifications())notification.close();}).catch(()=>undefined);
  await session.detach();
 }
});

// Match the disposable runner's full Chromium for native notification APIs.
test.use({channel:"chromium",trace:"off",screenshot:"off",video:"off"});
test("purchasing learner withdraws real notification consent and reloads; foreign course and CSRF are refused",async({page,baseURL})=>{
 test.setTimeout(120000);
 const db=new PrismaClient(),suffix=randomUUID();
 const vendor=await db.vendor.create({data:{name:"Synthetic notifications academy",slug:`notification-ui-${suffix}`,email:`owner-${suffix}@invalid.example`,passwordHash:"synthetic-login-disabled"}});
 const foreign=await db.vendor.create({data:{name:"Synthetic foreign academy",slug:`notification-foreign-${suffix}`,email:`foreign-${suffix}@invalid.example`,passwordHash:"synthetic-login-disabled"}});
 try{
  const product=await db.product.create({data:{vendorId:vendor.id,name:"通知設定瀏覽器課程",slug:randomUUID(),priceCents:1000,commerceDomain:"course",fulfillmentType:"course"}});
  const lesson=await db.courseLesson.create({data:{vendorId:vendor.id,productId:product.id,title:"保留講師原文",chapterTitle:"原文章節",position:1,durationSeconds:100,publishedAt:new Date()}});
  const foreignProduct=await db.product.create({data:{vendorId:foreign.id,name:"Foreign course",slug:randomUUID(),priceCents:1000,commerceDomain:"course",fulfillmentType:"course"}});
  const orderId=randomUUID(),email=`learner-${suffix}@invalid.example`,customerKeyHash=automationCustomerKeyHash(vendor.id,email);
  const pii=protectCommerceOrderPii({buyer:{name:"Synthetic learner",email},shipping:null},{vendorId:vendor.id,orderId});
  await db.commerceOrder.create({data:{id:orderId,vendorId:vendor.id,orderNumber:orderId,checkoutIdempotencyKey:randomUUID(),checkoutIdentityHash:pii.checkoutIdentityHash,automationCustomerKeyHash:customerKeyHash,status:"paid",subtotalAmountCents:1000,totalAmountCents:1000,paidAmountCents:1000,buyerEncryptedEnvelope:pii.buyerEncrypted,buyerMaskedName:pii.buyerNameMasked,buyerMaskedEmail:pii.buyerEmailMasked}});
  const item=await db.commerceOrderItem.create({data:{vendorId:vendor.id,orderId,productId:product.id,lineIndex:0,productName:product.name,productSlug:product.slug,commerceDomain:"course",fulfillmentType:"course",unitPriceCents:1000,quantity:1,lineTotalCents:1000,nonSensitiveSnapshot:{}}});
  const entitlement=await db.commerceEntitlement.create({data:{vendorId:vendor.id,orderItemId:item.id}});
  await db.$transaction(tx=>grantCommerceEntitlement(tx,{vendorId:vendor.id,entitlementId:entitlement.id,expectedRevision:entitlement.revision,actor:{id:"synthetic-notification-browser-fixture"}}));
  const protectedContact=protectLearnerNotificationDestination({vendorId:vendor.id,productId:product.id,customerKeyHash},"email",{email});
  // Explicit synthetic, already-verified fixture: this browser test proves real
  // preference HTTP/DB persistence, never external contact/device delivery.
  const preference=await db.learnerNotificationPreference.create({data:{vendorId:vendor.id,productId:product.id,customerKeyHash,channel:"email",enabled:true,consentedAt:new Date(),destinationVerifiedAt:new Date(),destinationEncryptedEnvelope:protectedContact.encryptedEnvelope,destinationKeyHash:protectedContact.destinationKeyHash}});
  const token=await createStudentPortalAccessToken(db,{vendorId:vendor.id,email,purpose:"magic_link"});
  await page.goto(`${baseURL}/portal/${vendor.slug}/access?token=${encodeURIComponent(token)}`);await expect(page).toHaveURL(new RegExp(`/portal/${vendor.slug}$`));
  await page.goto(`/portal/${vendor.slug}/learn/${product.id}`);
  // Locale changes product copy only; the exact learner/course session and
  // paid progress write remain the same across the real server-action reload.
  await page.getByRole("combobox",{name:"語言",exact:true}).selectOption("en");
  await page.getByRole("button",{name:"套用",exact:true}).click();
  await expect(page.getByText("Learning progress",{exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:product.name,exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Mark complete",exact:true}).click();
  await expect.poll(async()=>Boolean((await db.courseLessonProgress.findFirst({where:{vendorId:vendor.id,productId:product.id,lessonId:lesson.id,customerKeyHash}}))?.completedAt)).toBe(true);
  await page.reload();await expect(page.getByRole("button",{name:"Marked complete",exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"保留講師原文",exact:true})).toBeVisible();
  const englishSettings=page.getByRole("region",{name:"Course notifications",exact:true});
  await englishSettings.getByRole("button",{name:"Load notification settings",exact:true}).click();
  await expect(englishSettings.getByRole("button",{name:"Cancel notifications",exact:true})).toBeEnabled();
  await expect(englishSettings.getByRole("region",{name:"Appointment reminders",exact:true})).toBeVisible();
  await page.getByRole("combobox",{name:"Language",exact:true}).selectOption("zh-TW");
  await page.getByRole("button",{name:"Apply",exact:true}).click();
  // Await the accepted locale and the persisted lesson state before loading
  // another client region after the server-action navigation.
  await expect(page.getByRole("button",{name:"已標記完成",exact:true})).toBeVisible();
  await expect(page.getByText("學習進度",{exact:true})).toBeVisible();
  const settings=page.getByRole("region",{name:"課程通知"});
  await expect(settings).toBeVisible();
  const [settingsResponse]=await Promise.all([
   page.waitForResponse(response=>response.request().method()==="GET"&&new URL(response.url()).pathname===`/portal/${vendor.slug}/learn/${product.id}/notifications`),
   settings.getByRole("button",{name:"載入通知設定"}).click(),
  ]);
  expect(settingsResponse.status()).toBe(200);
  await expect(settings.getByRole("button",{name:"取消通知"})).toBeEnabled();
  await expect(settings.getByText("通知已開啟",{exact:false})).toBeVisible();
  const project=await db.salesProject.create({data:{vendorId:vendor.id,name:"Synthetic consultation course",slug:randomUUID(),mode:"consulting",primaryFlow:"consultation",status:"published",publishedAt:new Date()}});
  await db.salesProjectProduct.create({data:{vendorId:vendor.id,projectId:project.id,productId:product.id}});
  const calendar=await db.consultationEvent.create({data:{vendorId:vendor.id,projectId:project.id,title:"合成學員課程預約",timezone:"UTC",weeklySchedule:[],intakeFormFields:[],isActive:true}});
  const startTime=new Date(Date.now()+24*3600000);
  const booking=await db.consultationBooking.create({data:{vendorId:vendor.id,eventId:calendar.id,customerKeyHash,startTime,endTime:new Date(startTime.getTime()+1800000),clientName:"Synthetic learner",clientEmail:email,clientPhone:"0900000000"}});
  const another=await db.consultationBooking.create({data:{vendorId:vendor.id,eventId:calendar.id,customerKeyHash:automationCustomerKeyHash(vendor.id,`another-${suffix}@invalid.example`),startTime:new Date(startTime.getTime()+3600000),endTime:new Date(startTime.getTime()+5400000),clientName:"Synthetic other learner",clientEmail:`another-${suffix}@invalid.example`,clientPhone:"0900000000"}});
  const reminders=settings.getByRole("region",{name:"預約提醒"});await reminders.getByRole("button",{name:"查看我的預約"}).click();await expect(reminders.getByRole("heading",{name:calendar.title})).toBeVisible();
  const reminderPath=`/portal/${vendor.slug}/learn/${product.id}/notifications/reminders`;
  const refusedReminder=await page.evaluate(async({path,ownId,foreignId,start,foreignStart})=>{
    const get=await fetch(path,{headers:{"x-celebratedeal-client":"web"},cache:"no-store"});const snapshot=await get.json() as {bookings:Array<{id:string}>;csrfToken:string};
    const send=(id:string,csrf:string,extra:Record<string,string>={},expectedStart=start)=>fetch(path,{method:"POST",headers:{"content-type":"application/json","x-celebratedeal-client":"web","x-csrf-token":csrf},body:JSON.stringify({bookingId:id,expectedStartTime:expectedStart,...extra})});
    return {ownVisible:snapshot.bookings.some(row=>row.id===ownId),foreignVisible:snapshot.bookings.some(row=>row.id===foreignId),csrf:(await send(ownId,"invalid")).status,foreign:(await send(foreignId,snapshot.csrfToken,{},foreignStart)).status,override:(await send(ownId,snapshot.csrfToken,{vendorId:"foreign"})).status};
  },{path:reminderPath,ownId:booking.id,foreignId:another.id,start:startTime.toISOString(),foreignStart:another.startTime.toISOString()});
  expect(refusedReminder).toEqual({ownVisible:true,foreignVisible:false,csrf:403,foreign:404,override:400});expect(await db.learnerNotificationSourceEvent.count({where:{vendorId:vendor.id,event:"consultation_reminder"}})).toBe(0);
  await reminders.getByRole("button",{name:"開啟這筆預約提醒"}).click();await expect(reminders.getByRole("status",{name:"預約提醒狀態"})).toContainText("已確認這筆預約");
  const source=await db.learnerNotificationSourceEvent.findFirstOrThrow({where:{vendorId:vendor.id,productId:product.id,event:"consultation_reminder"}});expect(source.audienceCustomerKeyHash).toBe(customerKeyHash);expect(source.availableAt.getTime()).toBe(startTime.getTime()-3600000);expect(source.payloadEncryptedEnvelope).not.toContain(email);
  await page.reload();await settings.getByRole("button",{name:"載入通知設定"}).click();await reminders.getByRole("button",{name:"查看我的預約"}).click();await expect(reminders.getByRole("button",{name:"已確認預約提醒"})).toBeDisabled();expect(await db.learnerNotificationSourceEvent.count({where:{vendorId:vendor.id,event:"consultation_reminder"}})).toBe(1);
  await page.getByRole("combobox",{name:"語言",exact:true}).selectOption("en");
  await page.getByRole("button",{name:"套用",exact:true}).click();
  await expect(page.getByRole("button",{name:"Marked complete",exact:true})).toBeVisible();
  await englishSettings.getByRole("button",{name:"Load notification settings",exact:true}).click();
  const englishReminders=englishSettings.getByRole("region",{name:"Appointment reminders",exact:true});
  await englishReminders.getByRole("button",{name:"View my appointments",exact:true}).click();
  await expect(englishReminders.getByRole("heading",{name:calendar.title,exact:true})).toBeVisible();
  await expect(englishReminders.getByRole("button",{name:"Appointment reminder confirmed",exact:true})).toBeDisabled();
  expect(await db.learnerNotificationSourceEvent.count({where:{vendorId:vendor.id,event:"consultation_reminder"}})).toBe(1);
  expect((await db.learnerNotificationPreference.findUniqueOrThrow({where:{id:preference.id}})).revision).toBe(1);
  await page.getByRole("combobox",{name:"Language",exact:true}).selectOption("zh-TW");
  await page.getByRole("button",{name:"Apply",exact:true}).click();
  await expect(page.getByRole("button",{name:"已標記完成",exact:true})).toBeVisible();
  await settings.getByRole("button",{name:"載入通知設定",exact:true}).click();
  const path=`/portal/${vendor.slug}/learn/${product.id}/notifications`;
  const refused=await page.evaluate(async(path)=>{const response=await fetch(path,{method:"POST",headers:{"content-type":"application/json","x-celebratedeal-client":"web","x-csrf-token":"invalid"},body:JSON.stringify({channel:"email",enabled:false,expectedRevision:1})});return response.status;},path);
  expect(refused).toBe(403);expect((await db.learnerNotificationPreference.findUniqueOrThrow({where:{id:preference.id}})).enabled).toBe(true);
  await settings.getByRole("button",{name:"取消通知"}).click();await expect(settings.getByRole("status",{name:"課程通知狀態"})).toHaveText("已取消此課程通知。");
  const saved=await db.learnerNotificationPreference.findUniqueOrThrow({where:{id:preference.id}});expect(saved.enabled).toBe(false);expect(saved.revision).toBe(2);
  await page.reload();await settings.getByRole("button",{name:"載入通知設定"}).click();await expect(settings.getByText("已驗證，通知尚未開啟",{exact:false})).toBeVisible();
  // No approved external provider exists in this isolated browser process.
  await expect(settings.getByRole("button",{name:"開啟通知"})).toBeDisabled();
  expect((await saveLearnerNotificationConsent(db,{vendorId:vendor.id,customerKeyHash},product.id,{channel:"email",enabled:true,expectedRevision:2})).status).toBe("saved");
  await db.$transaction(tx=>reconcileCommerceOrderRefund(tx,{vendorId:vendor.id,orderId,providerName:"synthetic",eventIdentity:randomUUID(),amountCents:1000,occurredAt:new Date()}));
  await page.goto(`/portal/${vendor.slug}`);await page.getByRole("link",{name:"通知設定",exact:true}).click();
  await expect(page.getByRole("heading",{name:product.name})).toBeVisible();await settings.getByRole("button",{name:"載入通知設定"}).click();
  await expect(settings.getByRole("button",{name:"取消通知"})).toBeEnabled();await settings.getByRole("button",{name:"取消通知"}).click();await expect(settings.getByRole("status",{name:"課程通知狀態"})).toHaveText("已取消此課程通知。");
  expect((await db.learnerNotificationPreference.findUniqueOrThrow({where:{id:preference.id}})).revision).toBe(4);
  await page.reload();await settings.getByRole("button",{name:"載入通知設定"}).click();await expect(settings.getByRole("button",{name:"開啟通知"})).toBeDisabled();
  const reenable=await page.evaluate(async(path)=>{const response=await fetch(path,{headers:{"x-celebratedeal-client":"web"},cache:"no-store"});const state=await response.json();return (await fetch(path,{method:"POST",headers:{"content-type":"application/json","x-celebratedeal-client":"web","x-csrf-token":state.csrfToken},body:JSON.stringify({channel:"email",enabled:true,expectedRevision:4})})).status;},path);expect(reenable).toBe(404);
  const foreignStatus=await page.evaluate(async(path)=>(await fetch(path,{headers:{"x-celebratedeal-client":"web"},cache:"no-store"})).status,`/portal/${vendor.slug}/learn/${foreignProduct.id}/notifications`);
  expect(foreignStatus).toBe(404);expect(await db.learnerNotificationPreference.count({where:{vendorId:foreign.id}})).toBe(0);
  await page.getByRole("combobox",{name:"語言",exact:true}).selectOption("en");
  await page.getByRole("button",{name:"套用",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Notification settings",exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:product.name,exact:true})).toBeVisible();
  await englishSettings.getByRole("button",{name:"Load notification settings",exact:true}).click();
  await expect(englishSettings.getByRole("button",{name:"Enable notifications",exact:true})).toBeDisabled();
  expect((await db.learnerNotificationPreference.findUniqueOrThrow({where:{id:preference.id}})).revision).toBe(4);
 }finally{await db.vendor.deleteMany({where:{id:{in:[vendor.id,foreign.id]}}});await db.$disconnect();}
});


test("real manager starts course-linked live, reloads and ends it without republishing the source",async({page})=>{
 // Multiple cold owner navigations share a bounded journey budget; assertion limits stay unchanged.
 test.setTimeout(120000);
 const db=new PrismaClient(),suffix=randomUUID(),password="SyntheticLiveNotificationManager!";
 const vendor=await db.vendor.create({data:{name:"Synthetic live notifications",slug:`notify-live-${suffix}`,email:`owner-${suffix}@invalid.example`,passwordHash:hashPassword(password),tracking:{create:{}}}});
 let userId:string|undefined;
 try{
  const user=await db.user.create({data:{email:`manager-${suffix}@invalid.example`,name:"Synthetic manager",passwordHash:hashPassword(password),status:"active",memberships:{create:{vendorId:vendor.id,role:"admin",status:"active"}}}});userId=user.id;
  const product=await db.product.create({data:{vendorId:vendor.id,name:"Synthetic live course",slug:randomUUID(),priceCents:1000,commerceDomain:"course",fulfillmentType:"course",fulfillmentTypeConfirmed:true,isActive:true}});
  const video=await db.video.create({data:{vendorId:vendor.id,title:"Synthetic media",sourceType:"url",status:"ready",videoUrl:"https://media.example.test/notification-live.mp4",durationSec:100}});
  const form=await db.registrationForm.create({data:{vendorId:vendor.id,name:"Synthetic registration",slug:randomUUID(),headline:"Synthetic registration",fields:[{key:"name",label:"姓名",type:"text",required:true},{key:"email",label:"Email",type:"email",required:true}]}});
  const registration=await db.messageTemplate.create({data:{vendorId:vendor.id,name:"Synthetic registration message",channel:"email",trigger:"registration_confirmed",subject:"{{live_title}}",body:"{{name}} {{unsubscribe_url}}",isActive:true}});
  const reminder=await db.messageTemplate.create({data:{vendorId:vendor.id,name:"Synthetic reminder",channel:"email",trigger:"live_reminder",subject:"{{live_title}}",body:"{{live_url}} {{unsubscribe_url}}",isActive:true}});
  const script=await db.interactionScript.create({data:{vendorId:vendor.id,name:"Synthetic published script",status:"published"}});
  const live=await db.live.create({data:{vendorId:vendor.id,title:"Actual manager notification live",slug:randomUUID(),scheduledAt:new Date(Date.now()+3600000),status:"scheduled",streamMode:"vod",videoId:video.id,formId:form.id,messageTemplateId:registration.id,liveReminderTemplateId:reminder.id,interactionScriptId:script.id,products:{create:{productId:product.id}}}});
  await page.route("https://media.example.test/**",route=>route.abort());
  await page.goto("/login");await page.getByLabel("Email").fill(user.email);await page.getByLabel("密碼").fill(password);await page.getByRole("button",{name:"登入",exact:true}).click();await expect(page).toHaveURL(/\/dashboard$/u);
  const path=`/lives/${live.id}/edit`;
  await page.goto(path);await page.getByRole("button",{name:/桌機／手機預覽發布/u}).click();
  const start=page.getByRole("button",{name:"開始直播",exact:true});await expect(start).toBeEnabled();
  page.once("dialog",dialog=>dialog.accept());await start.click();
  await expect.poll(async()=>(await db.live.findUniqueOrThrow({where:{id:live.id}})).status).toBe("live");
  await expect.poll(()=>db.learnerNotificationSourceEvent.count({where:{vendorId:vendor.id,productId:product.id,event:"live_started"}})).toBe(1);
  const source=await db.learnerNotificationSourceEvent.findFirstOrThrow({where:{vendorId:vendor.id,productId:product.id,event:"live_started"}});expect(source.audienceCustomerKeyHash).toBeNull();expect(source.payloadEncryptedEnvelope).not.toContain(live.title);
  const beforeSave=(await db.live.findUniqueOrThrow({where:{id:live.id}})).updatedAt.toISOString();
  await page.reload();await page.getByRole("button",{name:/桌機／手機預覽發布/u}).click();await expect(page.getByRole("button",{name:"儲存變更",exact:true})).toBeEnabled();await page.getByRole("button",{name:"儲存變更",exact:true}).click();
  await expect.poll(async()=>(await db.live.findUniqueOrThrow({where:{id:live.id}})).updatedAt.toISOString()).not.toBe(beforeSave);
  await expect.poll(()=>db.learnerNotificationSourceEvent.count({where:{vendorId:vendor.id,productId:product.id,event:"live_started"}})).toBe(1);
  await page.reload();await page.getByRole("button",{name:/桌機／手機預覽發布/u}).click();const end=page.getByRole("button",{name:"結束直播",exact:true});await expect(end).toBeEnabled();page.once("dialog",dialog=>dialog.accept());await end.click();
  await expect.poll(async()=>(await db.live.findUniqueOrThrow({where:{id:live.id}})).status).toBe("ended");expect(await db.learnerNotificationSourceEvent.count({where:{vendorId:vendor.id,productId:product.id,event:"live_started"}})).toBe(1);
 }finally{await db.vendor.delete({where:{id:vendor.id}});if(userId)await db.user.delete({where:{id:userId}});await db.$disconnect();}
});


test("two purchasing learners post and reply; notification opens exact thread and revoked access is refused",async({browser,baseURL})=>{
 test.setTimeout(120000);
 const db=new PrismaClient(),suffix=randomUUID();
 const vendor=await db.vendor.create({data:{name:"Synthetic discussion academy",slug:`notify-discuss-${suffix}`,email:`owner-${suffix}@invalid.example`,passwordHash:"synthetic-login-disabled"}});
 const authorContext=await browser.newContext(),replyContext=await browser.newContext();
 try{
  const product=await db.product.create({data:{vendorId:vendor.id,name:"合成討論通知課程",slug:randomUUID(),priceCents:1000,commerceDomain:"course",fulfillmentType:"course"}});
  async function purchase(email:string){
   const orderId=randomUUID(),customerKeyHash=automationCustomerKeyHash(vendor.id,email);
   const pii=protectCommerceOrderPii({buyer:{name:"Synthetic learner",email},shipping:null},{vendorId:vendor.id,orderId});
   await db.commerceOrder.create({data:{id:orderId,vendorId:vendor.id,orderNumber:orderId,checkoutIdempotencyKey:randomUUID(),checkoutIdentityHash:pii.checkoutIdentityHash,automationCustomerKeyHash:customerKeyHash,status:"paid",subtotalAmountCents:1000,totalAmountCents:1000,paidAmountCents:1000,buyerEncryptedEnvelope:pii.buyerEncrypted,buyerMaskedName:pii.buyerNameMasked,buyerMaskedEmail:pii.buyerEmailMasked}});
   const item=await db.commerceOrderItem.create({data:{vendorId:vendor.id,orderId,productId:product.id,lineIndex:0,productName:product.name,productSlug:product.slug,commerceDomain:"course",fulfillmentType:"course",unitPriceCents:1000,quantity:1,lineTotalCents:1000,nonSensitiveSnapshot:{}}});
   const entitlement=await db.commerceEntitlement.create({data:{vendorId:vendor.id,orderItemId:item.id}});
   await db.$transaction(tx=>grantCommerceEntitlement(tx,{vendorId:vendor.id,entitlementId:entitlement.id,expectedRevision:entitlement.revision,actor:{id:"synthetic-discussion-browser-fixture"}}));
   return {orderId,customerKeyHash,token:await createStudentPortalAccessToken(db,{vendorId:vendor.id,email,purpose:"magic_link"})};
  }
  const author=await purchase(`author-${suffix}@invalid.example`),replier=await purchase(`reply-${suffix}@invalid.example`);
  const a=await authorContext.newPage(),b=await replyContext.newPage();
  for(const [page,learner] of [[a,author],[b,replier]] as const){await page.goto(`${baseURL}/portal/${vendor.slug}/access?token=${encodeURIComponent(learner.token)}`);await expect(page).toHaveURL(new RegExp(`/portal/${vendor.slug}$`));}
  await a.goto(`${baseURL}/portal/${vendor.slug}/learn/${product.id}`);await a.getByRole("link",{name:"學員討論",exact:true}).click();
  const post=a.getByRole("form",{name:"發布心得"});await post.getByLabel("顯示名稱").fill("合成原作者");await post.getByLabel("分享學習心得").fill("合成需要討論的課程心得");await post.getByRole("button",{name:"發布心得"}).click();await expect(a.getByText("合成需要討論的課程心得",{exact:true})).toBeVisible();
  const parent=await db.courseCommunityPost.findFirstOrThrow({where:{vendorId:vendor.id,productId:product.id,customerKeyHash:author.customerKeyHash}});
  await b.goto(`${baseURL}/portal/${vendor.slug}/learn/${product.id}/community`);await b.getByRole("button",{name:/查看討論/u}).click();
  const form=b.getByRole("form",{name:"回覆討論"});await form.getByLabel("顯示名稱").fill("合成回覆學員");await form.getByLabel("回覆內容").fill("合成回答內容");await form.getByRole("button",{name:"送出回覆"}).click();await expect(b.getByRole("region",{name:"完整討論"}).getByText("合成回答內容",{exact:true})).toBeVisible();
  await expect.poll(()=>db.learnerNotificationSourceEvent.count({where:{vendorId:vendor.id,productId:product.id,event:"discussion_reply"}})).toBe(1);
  const source=await db.learnerNotificationSourceEvent.findFirstOrThrow({where:{vendorId:vendor.id,productId:product.id,event:"discussion_reply"}});expect(source.audienceCustomerKeyHash).toBe(author.customerKeyHash);expect(source.payloadEncryptedEnvelope).not.toContain("合成回答內容");
  const link=`${baseURL}/portal/${vendor.slug}/learn/${product.id}/community/${parent.id}`;
  await a.goto(link);await expect(a.getByRole("region",{name:"完整討論"}).getByText("合成回答內容",{exact:true})).toBeVisible();await a.reload();await expect(a.getByRole("region",{name:"完整討論"})).toBeVisible();
  await a.getByRole("combobox",{name:"語言",exact:true}).selectOption("en");
  await a.getByRole("button",{name:"套用",exact:true}).click();
  await expect(a).toHaveURL(link);
  await expect(a.getByRole("region",{name:"Full discussion"}).getByText("合成回答內容",{exact:true})).toBeVisible();
  await expect(a.getByRole("form",{name:"Reply to discussion"})).toBeVisible();
  await a.reload();await expect(a.getByRole("region",{name:"Full discussion"})).toBeVisible();
  await a.getByRole("combobox",{name:"Language",exact:true}).selectOption("zh-TW");
  await a.getByRole("button",{name:"Apply",exact:true}).click();
  await expect(a.getByRole("region",{name:"完整討論"})).toBeVisible();
  expect(await db.learnerNotificationSourceEvent.count({where:{vendorId:vendor.id,event:"discussion_reply"}})).toBe(1);
  // Next.js streamed notFound pages can have HTTP 200. The data boundary must
  // still return exact 404, while the rendered page must expose no thread.
  async function expectUnavailable(){
   await a.goto(link);await expect(a.getByRole("heading",{name:"404",exact:true})).toBeVisible();await expect(a.getByRole("region",{name:"完整討論"})).toHaveCount(0);await expect(a.getByText("合成回答內容",{exact:true})).toHaveCount(0);
   const response=await a.evaluate(async(path)=>{const result=await fetch(path,{headers:{"x-celebratedeal-client":"web"},cache:"no-store"});return {status:result.status,body:await result.json(),cache:result.headers.get("cache-control")};},`/portal/${vendor.slug}/learn/${product.id}/community/data?postId=${parent.id}`);
   expect(response).toEqual({status:404,body:{error:"not_found"},cache:"private, no-store"});
  }
  await db.courseCommunityPost.update({where:{vendorId_productId_id:{vendorId:vendor.id,productId:product.id,id:parent.id}},data:{hiddenAt:new Date()}});await expectUnavailable();
  await db.courseCommunityPost.update({where:{vendorId_productId_id:{vendorId:vendor.id,productId:product.id,id:parent.id}},data:{hiddenAt:null}});
  await db.$transaction(tx=>reconcileCommerceOrderRefund(tx,{vendorId:vendor.id,orderId:author.orderId,providerName:"synthetic",eventIdentity:randomUUID(),amountCents:1000,occurredAt:new Date()}));await expectUnavailable();
 }finally{await authorContext.close();await replyContext.close();await db.vendor.delete({where:{id:vendor.id}});await db.$disconnect();}
});
