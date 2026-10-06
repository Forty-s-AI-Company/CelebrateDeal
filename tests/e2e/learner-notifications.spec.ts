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

test.use({trace:"off",screenshot:"off",video:"off"});
test("purchasing learner withdraws real notification consent and reloads; foreign course and CSRF are refused",async({page,baseURL})=>{
 const db=new PrismaClient(),suffix=randomUUID();
 const vendor=await db.vendor.create({data:{name:"Synthetic notifications academy",slug:`notification-ui-${suffix}`,email:`owner-${suffix}@invalid.example`,passwordHash:"synthetic-login-disabled"}});
 const foreign=await db.vendor.create({data:{name:"Synthetic foreign academy",slug:`notification-foreign-${suffix}`,email:`foreign-${suffix}@invalid.example`,passwordHash:"synthetic-login-disabled"}});
 try{
  const product=await db.product.create({data:{vendorId:vendor.id,name:"通知設定瀏覽器課程",slug:randomUUID(),priceCents:1000,commerceDomain:"course",fulfillmentType:"course"}});
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
  const settings=page.getByRole("region",{name:"課程通知"});
  await expect(settings).toBeVisible();await settings.getByRole("button",{name:"載入通知設定"}).click();
  await expect(settings.getByRole("button",{name:"取消通知"})).toBeEnabled();
  await expect(settings.getByText("通知已開啟",{exact:false})).toBeVisible();
  const path=`/portal/${vendor.slug}/learn/${product.id}/notifications`;
  const refused=await page.evaluate(async(path)=>{const response=await fetch(path,{method:"POST",headers:{"content-type":"application/json","x-celebratedeal-client":"web","x-csrf-token":"invalid"},body:JSON.stringify({channel:"email",enabled:false,expectedRevision:1})});return response.status;},path);
  expect(refused).toBe(403);expect((await db.learnerNotificationPreference.findUniqueOrThrow({where:{id:preference.id}})).enabled).toBe(true);
  await settings.getByRole("button",{name:"取消通知"}).click();await expect(settings.getByRole("status")).toHaveText("已取消此課程通知。");
  const saved=await db.learnerNotificationPreference.findUniqueOrThrow({where:{id:preference.id}});expect(saved.enabled).toBe(false);expect(saved.revision).toBe(2);
  await page.reload();await settings.getByRole("button",{name:"載入通知設定"}).click();await expect(settings.getByText("已驗證，通知尚未開啟",{exact:false})).toBeVisible();
  // No approved external provider exists in this isolated browser process.
  await expect(settings.getByRole("button",{name:"開啟通知"})).toBeDisabled();
  expect((await saveLearnerNotificationConsent(db,{vendorId:vendor.id,customerKeyHash},product.id,{channel:"email",enabled:true,expectedRevision:2})).status).toBe("saved");
  await db.$transaction(tx=>reconcileCommerceOrderRefund(tx,{vendorId:vendor.id,orderId,providerName:"synthetic",eventIdentity:randomUUID(),amountCents:1000,occurredAt:new Date()}));
  await page.goto(`/portal/${vendor.slug}`);await page.getByRole("link",{name:"通知設定",exact:true}).click();
  await expect(page.getByRole("heading",{name:product.name})).toBeVisible();await settings.getByRole("button",{name:"載入通知設定"}).click();
  await expect(settings.getByRole("button",{name:"取消通知"})).toBeEnabled();await settings.getByRole("button",{name:"取消通知"}).click();await expect(settings.getByRole("status")).toHaveText("已取消此課程通知。");
  expect((await db.learnerNotificationPreference.findUniqueOrThrow({where:{id:preference.id}})).revision).toBe(4);
  await page.reload();await settings.getByRole("button",{name:"載入通知設定"}).click();await expect(settings.getByRole("button",{name:"開啟通知"})).toBeDisabled();
  const reenable=await page.evaluate(async(path)=>{const response=await fetch(path,{headers:{"x-celebratedeal-client":"web"},cache:"no-store"});const state=await response.json();return (await fetch(path,{method:"POST",headers:{"content-type":"application/json","x-celebratedeal-client":"web","x-csrf-token":state.csrfToken},body:JSON.stringify({channel:"email",enabled:true,expectedRevision:4})})).status;},path);expect(reenable).toBe(404);
  const foreignStatus=await page.evaluate(async(path)=>(await fetch(path,{headers:{"x-celebratedeal-client":"web"},cache:"no-store"})).status,`/portal/${vendor.slug}/learn/${foreignProduct.id}/notifications`);
  expect(foreignStatus).toBe(404);expect(await db.learnerNotificationPreference.count({where:{vendorId:foreign.id}})).toBe(0);
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
