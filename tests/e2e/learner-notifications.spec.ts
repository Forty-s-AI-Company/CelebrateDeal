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
