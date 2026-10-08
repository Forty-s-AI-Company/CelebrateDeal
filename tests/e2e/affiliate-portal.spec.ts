import {randomUUID} from "node:crypto";
import {assertReferralCardDownload} from "./referral-card-assertions";
import {expect,test} from "@playwright/test";
import {PrismaClient} from "@prisma/client";
import {hashPassword} from "../../src/lib/password";
import {appendCommissionLedgerEntry} from "../../src/lib/affiliate-commission-accounting";
import {formatCurrency} from "../../src/lib/format";

test.use({trace:"off",screenshot:"off",video:"off"});test.setTimeout(120000);
test("manager grants portal access; partner reads ledger refund net and loses access on revoke",async({page,browser,baseURL})=>{
 const db=new PrismaClient(),suffix=randomUUID(),password="SyntheticAffiliatePortal!";
 const vendor=await db.vendor.create({data:{name:"合成夥伴商家",slug:`affiliate-${suffix}`,email:`${suffix}@example.test`,passwordHash:hashPassword(password),tracking:{create:{}}}});
 const manager=await db.user.create({data:{email:`manager-${suffix}@example.test`,name:"合成商家管理員",passwordHash:hashPassword(password),memberships:{create:{vendorId:vendor.id,role:"admin",status:"active"}}}});
 const partner=await db.user.create({data:{email:`partner-${suffix}@example.test`,name:"合成推廣夥伴",passwordHash:hashPassword(password),memberships:{create:{id:`zz-${suffix}`,vendorId:vendor.id,role:"partner",status:"active"}}},include:{memberships:true}});
 const outsider=await db.user.create({data:{email:`outsider-${suffix}@example.test`,name:"合成未授權成員",passwordHash:hashPassword(password),memberships:{create:{vendorId:vendor.id,role:"partner",status:"active"}}}});
 const affiliate=await db.affiliate.create({data:{vendorId:vendor.id,name:"合成推廣合作",code:`SYNTH-${suffix}`.toUpperCase()}});
 // More than the old 200-member cutoff; the target sorts after all fillers.
 const fillers=Array.from({length:205},(_,i)=>({id:`aa-${suffix}-${String(i).padStart(3,"0")}`,email:`filler-${i}-${suffix}@example.test`,name:`合成成員 ${i}`,passwordHash:"synthetic-only"}));
 await db.user.createMany({data:fillers});await db.vendorMember.createMany({data:fillers.map(user=>({id:user.id,userId:user.id,vendorId:vendor.id,role:"partner",status:"active"}))});
 const form=await db.registrationForm.create({data:{vendorId:vendor.id,name:"合成推廣報名",slug:`ref-form-${suffix}`,headline:"合成推廣報名",fields:[{key:"name",label:"姓名",type:"text",required:true},{key:"email",label:"Email",type:"email",required:true}]}});
 const video=await db.video.create({data:{vendorId:vendor.id,title:"合成推廣影片",sourceType:"url",videoUrl:"https://example.test/synthetic.mp4",status:"ready",durationSec:3600}});
 const template=await db.messageTemplate.create({data:{vendorId:vendor.id,name:"合成報名通知",subject:"報名成功 {{live_title}}",body:"{{name}} 已完成報名"}});
 const script=await db.interactionScript.create({data:{vendorId:vendor.id,name:"合成推廣腳本",status:"published"}});
 const product=await db.product.create({data:{vendorId:vendor.id,name:"合成推廣商品",slug:`ref-product-${suffix}`,priceCents:10000,inventory:5}});
 const live=await db.live.create({data:{vendorId:vendor.id,title:"合成推廣場次",slug:`ref-live-${suffix}`,status:"scheduled",scheduledAt:new Date("2030-01-01"),videoId:video.id,formId:form.id,messageTemplateId:template.id,interactionScriptId:script.id,quotaPolicy:{affiliateMode:"enabled"},products:{create:{productId:product.id}}}});
 const disabled=await db.product.create({data:{vendorId:vendor.id,name:"合成停用商品",slug:`disabled-${suffix}`,priceCents:10000,isActive:false}});
 await db.live.create({data:{vendorId:vendor.id,title:"合成不可公開場次",slug:`invalid-live-${suffix}`,status:"scheduled",scheduledAt:new Date("2030-01-01"),videoId:video.id,formId:form.id,messageTemplateId:template.id,interactionScriptId:script.id,products:{create:[{productId:product.id},{productId:disabled.id}]}}});
 const commission=await db.affiliateCommission.create({data:{vendorId:vendor.id,affiliateId:affiliate.id,monthKey:"2026-10",deduplicationKey:randomUUID(),orderAmountCents:10000,commissionBaseAmountCents:10000,commissionRateBps:1000,commissionAmountCents:1000,netReferenceAmountCents:9000}});
 await db.$transaction(tx=>appendCommissionLedgerEntry(tx,{vendorId:vendor.id,affiliateCommissionId:commission.id,entryType:"opening_balance",providerName:"synthetic",eventIdentity:randomUUID(),amountCents:1000,occurredAt:new Date()}));
 const partnerContext=await browser.newContext(),outsiderContext=await browser.newContext();
 const partnerPage=await partnerContext.newPage(),outsiderPage=await outsiderContext.newPage();
 const statement=`/affiliate-portal/${vendor.slug}/${affiliate.id}`;
 async function login(target:typeof page,email:string){await target.goto(`${baseURL}/login`);await target.getByLabel("Email").fill(email);await target.getByLabel("密碼").fill(password);await target.getByRole("button",{name:"登入",exact:true}).click();await expect(target).toHaveURL(/\/dashboard$/);}
 try{
  for(const context of [page.context(),partnerContext,outsiderContext])await context.route(url=>url.origin!==new URL(baseURL!).origin,route=>route.abort());
  await login(page,manager.email);await page.goto(`/affiliates/${affiliate.id}`);await page.getByRole("link",{name:"夥伴入口授權",exact:true}).click();
  await expect(page.getByRole("link",{name:"下一頁成員",exact:true})).toBeVisible();
  await page.getByLabel("搜尋成員",{exact:true}).fill("合成推廣夥伴");await page.getByRole("button",{name:"搜尋",exact:true}).click();
  await page.getByLabel("授權成員",{exact:true}).selectOption(partner.memberships[0]!.id);await page.getByRole("button",{name:"儲存入口授權",exact:true}).click();
  await expect(page.getByRole("status")).toHaveText("夥伴入口授權已儲存。");
  expect(await db.affiliatePortalAccess.findUniqueOrThrow({where:{vendorId_affiliateId:{vendorId:vendor.id,affiliateId:affiliate.id}}})).toMatchObject({vendorMemberId:partner.memberships[0]!.id,active:true,revision:1});
  await login(partnerPage,partner.email);await partnerPage.getByRole("button",{name:"開啟工作區與帳號選單",exact:true}).click();await partnerPage.getByRole("link",{name:"夥伴入口",exact:true}).click();
  await partnerPage.getByRole("link",{name:"合成夥伴商家 · 合成推廣合作",exact:true}).click();
  await expect(partnerPage.locator('[aria-label="佣金帳本淨額"]')).toHaveText(`帳本淨額：${formatCurrency(1000)}`);
  await expect(partnerPage.getByRole("link",{name:"推廣：合成不可公開場次",exact:true})).toHaveCount(0);
  const platformBefore=await db.platformReferralClick.count();
  const promo=partnerPage.getByRole("link",{name:"推廣：合成推廣場次",exact:true});
  await expect(promo).toHaveAttribute("href",`/live/${live.slug}?ref=${encodeURIComponent(affiliate.code)}`);
  await partnerContext.grantPermissions(["clipboard-read", "clipboard-write"]);
  const shareUrl=`${baseURL}/live/${live.slug}?ref=${encodeURIComponent(affiliate.code)}`;
  await expect(partnerPage.getByLabel("合成推廣場次推廣連結",{exact:true})).toHaveValue(shareUrl);
  await partnerPage.getByRole("button",{name:"複製推廣連結",exact:true}).click();
  await expect(partnerPage.getByRole("status")).toHaveText("推廣連結已複製");
  expect(await partnerPage.evaluate(()=>navigator.clipboard.readText())).toBe(shareUrl);
  const card=await assertReferralCardDownload(partnerPage,shareUrl,[partner.email,partner.id]);
  expect(card.svg).toContain("合成推廣場次");
  await partnerPage.goto(card.destination);
  await expect(partnerPage).toHaveURL(new RegExp(`/live/${live.slug}\\?ref=`));
  // Exercise the existing real merchant tracking handler from its public page.
  // The scheduled fixture is not admitted to playback, so this asserts the
  // destination/attribution contract, not an automatic playback tracking event.
  const clickStatus=await partnerPage.evaluate(async ({vendorId,liveId,code})=>(await fetch("/api/affiliate-clicks",{method:"POST",headers:{"content-type":"application/json","x-celebratedeal-client":"web"},body:JSON.stringify({vendorId,liveId,referralCode:code,visitorId:"synthetic-partner-visitor",landingPath:location.pathname+location.search})})).status,{vendorId:vendor.id,liveId:live.id,code:affiliate.code});
  expect(clickStatus).toBe(200);expect(await db.affiliateClick.count({where:{vendorId:vendor.id,affiliateId:affiliate.id,liveId:live.id}})).toBe(1);expect(await db.platformReferralClick.count()).toBe(platformBefore);
  await partnerPage.goto(statement);
  const refund={vendorId:vendor.id,affiliateCommissionId:commission.id,entryType:"refund" as const,providerName:"synthetic",eventIdentity:randomUUID(),amountCents:-400,occurredAt:new Date()};
  await db.$transaction(tx=>appendCommissionLedgerEntry(tx,refund));await db.$transaction(tx=>appendCommissionLedgerEntry(tx,refund));
  await partnerPage.reload();await expect(partnerPage.locator('[aria-label="佣金帳本淨額"]')).toHaveText(`帳本淨額：${formatCurrency(600)}`);
  await login(outsiderPage,outsider.email);await outsiderPage.goto(statement);await expect(outsiderPage.getByRole("heading",{name:"合成推廣合作：佣金帳本",exact:true})).toHaveCount(0);
  await outsiderPage.goto(`/affiliates/${affiliate.id}/access`);await expect(outsiderPage.getByRole("button",{name:"儲存入口授權",exact:true})).toHaveCount(0);
  await db.vendorMember.update({where:{id:partner.memberships[0]!.id},data:{status:"inactive"}});
  await page.reload();await expect(page.getByLabel("授權成員",{exact:true})).toHaveValue(partner.memberships[0]!.id);
  await page.getByLabel("啟用夥伴入口",{exact:true}).uncheck();await page.getByRole("button",{name:"儲存入口授權",exact:true}).click();await expect(page.getByRole("status")).toHaveText("夥伴入口授權已儲存。");
  await db.vendorMember.update({where:{id:partner.memberships[0]!.id},data:{status:"active"}});
  await partnerPage.reload();await expect(partnerPage.getByRole("heading",{name:"合成推廣合作：佣金帳本",exact:true})).toHaveCount(0);
  expect((await db.affiliatePortalAccess.findUniqueOrThrow({where:{vendorId_affiliateId:{vendorId:vendor.id,affiliateId:affiliate.id}}})).revision).toBe(2);
 }finally{await partnerContext.close();await outsiderContext.close();await db.$disconnect();}
 // Append-only financial fixtures are removed only with the disposable DB.
});
