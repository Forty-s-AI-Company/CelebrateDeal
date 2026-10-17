require('tsx/cjs');
const {PrismaClient}=require('@prisma/client');
const {chromium,firefox}=require('@playwright/test');
const {createEmptyPageDocument,parsePageDocument}=require(process.cwd()+'/src/lib/funnel-page-document.ts');
const {createFunnelFlow}=require(process.cwd()+'/src/lib/funnel-flow.ts');
const {createFunnelStepPages}=require(process.cwd()+'/src/lib/funnel-step-pages.ts');
const AxeBuilder=require('@axe-core/playwright').default;const assert=require('node:assert/strict');const fs=require('node:fs');
const db=new PrismaClient();const base='http://127.0.0.1:31026';
const report={status:'IN_PROGRESS',checks:[],cleanup:false};let vendor,form,browser,stage='fixture';const pages=[];
const n=(type,id,children)=>({schemaVersion:1,id,type,props:{},style:{},overrides:{},visible:true,actions:[],attributes:{},...(children?{children}:{})});
(async()=>{try{
 const key='wp05-webinar-'+Date.now();
 vendor=await db.vendor.create({data:{name:'Synthetic',slug:key,email:key+'@example.test',passwordHash:'synthetic-unused'}});
 const project=await db.salesProject.create({data:{vendorId:vendor.id,name:'Synthetic published fixture',slug:key,mode:'live_course',primaryFlow:'live',status:'published',publishedAt:new Date()}});
 form=await db.registrationForm.create({data:{vendorId:vendor.id,projectId:project.id,name:'Synthetic',slug:key,headline:'Synthetic registration',fields:[{key:'name',label:'Name',type:'text',required:true},{key:'email',label:'Email',type:'email',required:true}]}});
 const document={...createEmptyPageDocument('synthetic-document','Synthetic'),root:[n('section','s',[n('row','r',[n('form','f',[])])])]};assert.ok(parsePageDocument(document));
 const flow=createFunnelFlow({id:'synthetic-flow',name:'Synthetic',goal:'webinar',domain:'synthetic'});assert.ok(flow);
 flow.webinar={timezone:'Asia/Taipei',startsAt:new Date(Date.now()+3600000).toISOString(),endsAt:new Date(Date.now()+7200000).toISOString(),replayEndsAt:null};const content=createFunnelStepPages(flow);assert.ok(content);
 const video=await db.video.create({data:{vendorId:vendor.id,title:'Synthetic video',sourceType:'url',videoUrl:base+'/synthetic-unused.mp4',status:'ready'}});const live=await db.live.create({data:{vendorId:vendor.id,projectId:project.id,formId:form.id,videoId:video.id,title:'Synthetic webinar',slug:key,scheduledAt:new Date(Date.now()+3600000),status:'scheduled'}});
 for(const [kind,value] of [['root',content],['step',content]]) {
  const page=await db.landingPage.create({data:{vendorId:vendor.id,projectId:project.id,name:'Synthetic',slug:key+'-'+kind,draftContent:value,status:'published',publishedAt:new Date(),draftFormId:form.id,draftLiveId:live.id}});pages.push(page);
  const version=await db.landingPageVersion.create({data:{vendorId:vendor.id,pageId:page.id,version:1,content:value,formId:form.id,liveId:live.id}});
  await db.landingPage.update({where:{id:page.id},data:{publishedVersionId:version.id}});
 }
 for(const [engine,driver] of [['chromium',chromium],['firefox',firefox]]) {
  browser=await driver.launch();
  for(const [index,fixture] of pages.entries()) {
   stage=engine+':'+(index?'step':'root');
   const context=await browser.newContext({javaScriptEnabled:true});
   await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
   const page=await context.newPage();page.setDefaultTimeout(20000);
   const source='/lp/'+fixture.slug+(index?'/'+flow.steps.find(x=>!x.isSystem).path:'');
   report.step='load';assert.equal((await page.goto(base+source)).status(),200);
   await page.locator('input[name=name]').fill('Synthetic preserved');await page.locator('input[name=email]').fill('invalid');
   await page.locator('form').evaluate(form=>{form.noValidate=true});
   report.step='error';await page.locator('form button').click();await page.waitForURL('**registrationRetry=400');
   assert.equal(new URL(page.url()).pathname,source);
   await page.getByText('請確認必填欄位與資料格式後再送出。',{exact:true}).waitFor();
   assert.equal(await page.locator('input[name=name]').inputValue(),'Synthetic preserved');assert.equal(await page.locator('input[name=email]').inputValue(),'invalid');
   const axe=await new AxeBuilder({page}).analyze();assert.equal(axe.violations.filter(v=>['serious','critical'].includes(v.impact)).length,0);report.step='success';const email=engine+'-'+index+'@example.test';await page.locator('input[name=email]').fill(email);await page.locator('form button').click();await page.waitForURL('**submitted=verification_required');
   assert.equal(await db.formSubmission.count({where:{formId:form.id,email}}),1);
   assert.equal(await db.registrationFormRetryDraft.count({where:{formId:form.id}}),0);
   assert.equal(await db.emailDelivery.count({where:{vendorId:vendor.id,status:'sent'}}),0);
   report.checks.push({engine,entry:index?'step':'root',javascript:true,native303:true,refill:true,success:true,draftCleared:true,noMailSent:true});
   await context.close();
  }
  await browser.close();browser=null;
 }
 report.status='PASS';
}catch(error){report.status='FAIL';report.stage=stage;report.errorType=error.name;report.errorCode=error.code;process.exitCode=1;}
finally{try{
 if(browser)await browser.close();
 if(form)await db.registrationFormRetryDraft.deleteMany({where:{formId:form.id}});
 if(vendor){await db.funnelSubmission.deleteMany({where:{vendorId:vendor.id}});await db.landingPage.updateMany({where:{vendorId:vendor.id},data:{publishedVersionId:null}});await db.landingPageVersion.deleteMany({where:{vendorId:vendor.id}});await db.landingPage.deleteMany({where:{vendorId:vendor.id}});await db.vendor.delete({where:{id:vendor.id}});}
 report.cleanup=true;
}catch(error){report.cleanupError=error.code??error.name;process.exitCode=1;}
await db.$disconnect();fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));}})();
