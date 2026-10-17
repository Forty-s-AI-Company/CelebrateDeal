const { PrismaClient } = require('@prisma/client');
const { chromium, firefox } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const db = new PrismaClient();
const base = 'http://127.0.0.1:31026';
const report = { checks: [], status: 'IN_PROGRESS', cleanup: false };
let vendor, form, syntheticUser, browser, lastPage, stage = 'fixture';
(async () => {
try {
 const key = 'wp05-partner-' + Date.now();
 vendor = await db.vendor.create({ data: { name: '合成測試', slug: key, email: key+'@example.test', passwordHash: 'synthetic-unused' } });
 form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: '合成報名', slug: key, headline: '合成報名測試', fields: [{ key:'name',label:'姓名',type:'text',required:true },{key:'email',label:'Email',type:'email',required:true}] } });
 const user = await db.user.create({data:{name:'Synthetic Partner',email:key+'-user@example.test',passwordHash:'synthetic-unused',memberships:{create:{vendorId:vendor.id,role:'owner',status:'active'}}}});syntheticUser=user;
 const member=await db.vendorMember.findUniqueOrThrow({where:{vendorId_userId:{vendorId:vendor.id,userId:user.id}}});
 const team=await db.salesTeam.create({data:{vendorId:vendor.id,name:'Synthetic Team',slug:key}});
 const membership=await db.teamMembership.create({data:{vendorId:vendor.id,teamId:team.id,vendorMemberId:member.id}});
 const template=await db.teamFunnelTemplate.create({data:{vendorId:vendor.id,teamId:team.id,name:'Synthetic Template'}});
 const version=await db.teamFunnelTemplateVersion.create({data:{vendorId:vendor.id,teamId:team.id,templateId:template.id,version:1,contentOwnerMembershipId:membership.id,createdByMemberId:member.id,headline:'Synthetic Partner Page',ctaLabel:'Register'}});
 const product=await db.product.create({data:{vendorId:vendor.id,name:'Synthetic Product',slug:key,priceCents:100,inventory:10,fulfillmentTypeConfirmed:true,checkoutUrl:'https://example.test/synthetic-unused'}});
 await db.teamFunnelTemplateProductSlot.create({data:{vendorId:vendor.id,templateVersionId:version.id,productId:product.id,slotKey:'main_product'}});
 const video=await db.video.create({data:{vendorId:vendor.id,title:'Synthetic',videoUrl:base+'/synthetic-unused.mp4',sourceType:'url',status:'ready'}});
 const live=await db.live.create({data:{vendorId:vendor.id,teamId:team.id,seminarOwnerMembershipId:membership.id,formId:form.id,videoId:video.id,title:'Synthetic Webinar',slug:key,scheduledAt:new Date(Date.now()+3600000),status:'scheduled'}});
 const partner=await db.partnerFunnelPage.create({data:{vendorId:vendor.id,teamId:team.id,templateVersionId:version.id,promoterMembershipId:membership.id,contentOwnerMembershipId:membership.id,liveId:live.id,slug:key,headline:'Synthetic Partner Page',ctaLabel:'Register'}});
 await db.partnerFunnelPageShareSetting.create({data:{pageId:partner.id,accessMode:'PUBLIC',isEnabled:true}});
 for (const [engine, driver] of [['chromium',chromium],['firefox',firefox]]) {
  browser = await driver.launch();
  for (const javascript of [false,true]) {
   stage = engine + ':' + (javascript?'js':'no-js');
   const context = await browser.newContext({ javaScriptEnabled: javascript });
   await context.route('**/*', route => { const url=new URL(route.request().url()); return url.origin===base || ['data:','about:'].includes(url.protocol) ? route.continue() : route.abort(); });
   const page = await context.newPage(); lastPage=page; page.setDefaultTimeout(20000);
   page.on('request', async request => { if(new URL(request.url()).pathname==='/api/form-submissions') report.originMatches=await request.headerValue('origin')===base; });
   page.on('response', response => { if (new URL(response.url()).pathname === '/api/form-submissions') report.lastSubmissionStatus=response.status(); });
   report.currentStep='load';
   assert.equal((await page.goto(base+'/p/'+form.slug)).status(),200);
   await page.locator('input[name=name]').fill('合成使用者');
   await page.locator('input[name=email]').fill('invalid-address');
   await page.locator('form').evaluate(form => { form.noValidate=true; });
   report.currentStep='submit'; report.__registrationReturnPathPresent=await page.locator('input[name=__registrationReturnPath]').inputValue() === '/p/'+form.slug;
   await page.locator('button[type=submit]').click();
   report.currentStep='error-return';
   if (!javascript) await page.waitForURL('**registrationRetry=400');
   report.currentStep='error-message';
   await page.getByText('請確認必填欄位與資料格式後再送出。',{exact:true}).waitFor();
   assert.equal(await page.locator('input[name=name]').inputValue(),'合成使用者');
   assert.equal(await page.locator('input[name=email]').inputValue(),'invalid-address');
   assert.equal(await db.formSubmission.count({where:{formId:form.id}}),report.checks.length);
   if (!javascript) assert.ok(await db.registrationFormRetryDraft.count({where:{formId:form.id}})>0);
   if (javascript) {
    const axe = await new AxeBuilder({page}).analyze();
    report.axeFindings=axe.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)}));assert.equal(report.axeFindings.length,0);
   }
   report.currentStep='success';
   const email = engine+'-'+javascript+'@example.test';
   await page.locator('input[name=email]').fill(email);
   await page.locator('button[type=submit]').click();
   if (!javascript) await page.waitForURL('**submitted=verification_required');
   await page.getByText('請到 Email 開啟確認連結；完成確認後才會列入正式名單。',{exact:true}).waitFor();
   assert.equal(await db.formSubmission.count({where:{formId:form.id,email}}),1);
   assert.equal(await db.registrationFormRetryDraft.count({where:{formId:form.id}}),0);
   assert.equal(await db.emailDelivery.count({where:{vendorId:vendor.id,status:'sent'}}),0);
   report.checks.push({engine,javascript,error400:true,refill:true,success:true,draftCleared:true,noMailSent:true});
   await context.close();
  }
  await browser.close(); browser=null;
 }
 report.status='PASS';
} catch (error) { report.status='FAIL'; report.failedStage=stage; report.errorType=error.name; report.errorCode=error.code; if(lastPage) { const location=new URL(lastPage.url());report.lastPath=location.pathname;report.retryState=location.searchParams.get('registrationRetry');report.errorMessageCount=await lastPage.getByText('請確認必填欄位與資料格式後再送出。',{exact:true}).count();report.retentionFailureCount=await lastPage.getByText('這次資料未能送出，且未能保留欄位；請重新填寫後再試。',{exact:true}).count();report.fieldCount=await lastPage.locator('input[name=email]').count();report.draftCount=await db.registrationFormRetryDraft.count({where:{formId:form.id}}); } process.exitCode=1; }
finally {
 try {
 if(browser) await browser.close();
 if(form) await db.registrationFormRetryDraft.deleteMany({where:{formId:form.id}});
 if(vendor) { await db.emailDelivery.deleteMany({where:{vendorId:vendor.id}}); await db.analyticsEvent.deleteMany({where:{vendorId:vendor.id}}); await db.formSubmission.deleteMany({where:{formId:form.id}}); await db.partnerFunnelPage.deleteMany({where:{vendorId:vendor.id}});await db.teamFunnelTemplate.deleteMany({where:{vendorId:vendor.id}});await db.live.deleteMany({where:{vendorId:vendor.id}});await db.registrationForm.deleteMany({where:{vendorId:vendor.id}}); await db.salesTeam.deleteMany({where:{vendorId:vendor.id}});await db.vendor.delete({where:{id:vendor.id}}); }
 if(syntheticUser)await db.user.delete({where:{id:syntheticUser.id}});report.cleanup=true;
 } catch (error) { report.cleanup=false;report.cleanupError=error.code??error.name;report.cleanupModel=error.meta?.modelName;report.cleanupConstraint=error.meta?.field_name;process.exitCode=1; }
 await db.$disconnect();
 fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));
}
})();
