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

 assert.ok(['chromium','firefox'].includes(process.argv[3]));
 const expected={referralCode:'synthetic-ref',shareCode:'tls1.'+'a'.repeat(32),landingPageId:'synthetic-page'};
 for(const [engine,driver] of [['chromium',chromium],['firefox',firefox]].filter(([name])=>name===process.argv[3])){
  browser=await driver.launch();
  for(const entry of ['form','p'])for(const javascript of [false,true]){
   stage=engine+':'+entry+':'+javascript;
   const context=await browser.newContext({javaScriptEnabled:javascript});
   await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
   const page=await context.newPage();lastPage=page;page.setDefaultTimeout(20000);
   let hydrationErrors=0;const bodies=[];
   page.on('console',m=>{if(['warning','error'].includes(m.type())&&/hydration|hydrated|server rendered HTML/i.test(m.text())){hydrationErrors++;report.hydrationConsoleType=m.type();report.hydrationPreamble=m.text().slice(0,300).replace(/https?:[^ ]+/g,'[URL]').replace(/tls1\.[A-Za-z0-9_-]+/g,'[synthetic-code]');report.hydrationDiagnostic=m.text().split('\n').filter(line=>/^\s*[+-]/.test(line)).map(line=>line.replace(/tls1\.[A-Za-z0-9_-]+/g,'[synthetic-code]').replace(/"[^"]*"/g,'"[redacted]"').replace(/[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+/g,'[synthetic-email]')).slice(0,15);}});
   page.on('pageerror',e=>{if(/hydration|hydrated|server rendered HTML/i.test(e.message)){hydrationErrors++;report.hydrationErrorCategory=e.name;report.hydrationErrorDiff=e.message.split('\n').filter(line=>/^\s*[+-]/.test(line)).map(line=>line.replace(/tls1\.[A-Za-z0-9_-]+/g,'[synthetic-code]').replace(/"[^"]*"/g,'"[redacted]"')).slice(0,15);}});
   page.on('request',req=>{
    if(new URL(req.url()).pathname!='/api/form-submissions')return;
    const content=req.headers()['content-type']??'';
    const raw=req.postData()??'';
    const body=content.includes('application/json')?JSON.parse(raw):Object.fromEntries(new URLSearchParams(raw));
    const matched=Object.entries(expected).every(([field,value])=>body[field]===value);
    const separate=!content.includes('application/json')||Object.keys(expected).every(field=>!Object.hasOwn(body.payload,field));
    bodies.push({matched,separate,json:content.includes('application/json')});
   });
   const source='/'+entry+'/'+form.slug;
   const query=new URLSearchParams({ref:expected.referralCode,share:expected.shareCode,lp:expected.landingPageId});
   assert.equal((await page.goto(base+source+'?'+query)).status(),200);
   for(const [field,value]of Object.entries(expected))assert.equal(await page.locator('input[name='+field+']').inputValue(),value);
   await page.locator('input[name=name]').fill('Synthetic retained');
   await page.locator('input[name=email]').fill('invalid-address');
   await page.locator('form').evaluate(f=>{f.noValidate=true});
   for(let attempt=0;attempt<2;attempt++){
    report.currentStep='invalid-post-'+attempt;
    // Reload creates a fresh form; deliberately bypass client validity for each invalid-contact API test.
    await page.locator('form').evaluate(f=>{f.noValidate=true});
    const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/form-submissions');
    await page.locator('button[type=submit]').click();await response;
    if(!javascript)await page.waitForURL('**registrationRetry=400');
    await page.getByText('請確認必填欄位與資料格式後再送出。',{exact:true}).waitFor();
    for(const [field,value]of Object.entries(expected))assert.equal(await page.locator('input[name='+field+']').inputValue(),value);
    assert.equal(await page.locator('input[name=name]').inputValue(),'Synthetic retained');
    if(!javascript){for(const key of ['ref','share','lp'])assert.equal(new URL(page.url()).searchParams.has(key),false);await page.reload();}
   }
   report.transportDiagnostics={bodyCount:bodies.length,allMatched:bodies.every(body=>body.matched&&body.separate),hydrationErrors};assert.equal(bodies.length,2);assert.ok(bodies.every(body=>body.matched&&body.separate));assert.equal(hydrationErrors,0);
   assert.equal(await db.formSubmission.count({where:{formId:form.id}}),0);
   report.checks.push({engine,entry,javascript,initialServerFields:true,twoActualPostPayloadsMatch:true,metadataExcludedFromAnswers:true,retainedAfterFailure:true,reloadPreserved:!javascript,hydrationErrors:0,noAcceptedInvalidRegistration:true});
   await context.close();
  }
  await browser.close();browser=null;
 }
 report.status='PASS';
} catch (error) { report.status='FAIL'; report.failedStage=stage; report.errorType=error.name; report.errorCode=error.code;report.failureLine=error.stack?.match(/browser-attribution[.]cjs:(\d+):/)?.[1]; if(lastPage) { const location=new URL(lastPage.url());report.lastPath=location.pathname;report.retryState=location.searchParams.get('registrationRetry');report.errorMessageCount=await lastPage.getByText('請確認必填欄位與資料格式後再送出。',{exact:true}).count();report.retentionFailureCount=await lastPage.getByText('這次資料未能送出，且未能保留欄位；請重新填寫後再試。',{exact:true}).count();report.fieldCount=await lastPage.locator('input[name=email]').count();report.draftCount=await db.registrationFormRetryDraft.count({where:{formId:form.id}}); } process.exitCode=1; }
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
