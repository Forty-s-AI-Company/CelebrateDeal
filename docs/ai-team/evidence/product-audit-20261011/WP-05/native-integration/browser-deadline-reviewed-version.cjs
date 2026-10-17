// Real local API/DB deadline regression; only synthetic tenant records are created.
require('tsx/cjs');
const { PrismaClient } = require('@prisma/client');
const { chromium, firefox } = require('@playwright/test');
const { createEmptyPageDocument } = require(process.cwd()+'/src/lib/funnel-page-document.ts');
const { createFunnelFlow } = require(process.cwd()+'/src/lib/funnel-flow.ts');
const { createFunnelStepPages } = require(process.cwd()+'/src/lib/funnel-step-pages.ts');
const { defaultFunnelOperations } = require(process.cwd()+'/src/lib/funnel-operations.ts');
const assert=require('node:assert/strict'); const fs=require('node:fs');
const db=new PrismaClient(); const base='http://127.0.0.1:31026';
const report={status:'IN_PROGRESS',checks:[],cleanup:false}; let vendor, form, landing, browser, stage='fixture';
const n=(type,id,children)=>({schemaVersion:1,id,type,props:{},style:{},overrides:{},visible:true,actions:[],attributes:{},...(children?{children}:{})});
(async()=>{try {
 const key='wp05-deadline-'+Date.now();
 vendor=await db.vendor.create({data:{name:'Synthetic deadline',slug:key,email:key+'@example.test',passwordHash:'synthetic-unused'}});
 const project=await db.salesProject.create({data:{vendorId:vendor.id,name:'Synthetic published',slug:key,mode:'live_course',primaryFlow:'live',status:'published',publishedAt:new Date()}});
 form=await db.registrationForm.create({data:{vendorId:vendor.id,projectId:project.id,name:'Synthetic',slug:key,headline:'Synthetic',fields:[{key:'name',label:'Name',type:'text',required:true},{key:'email',label:'Email',type:'email',required:true}]}});
 const document={...createEmptyPageDocument('synthetic-document','Synthetic'),root:[n('section','s',[n('row','r',[n('form','f',[])])])]};
 const flow=createFunnelFlow({id:'synthetic-flow',name:'Synthetic',goal:'audience',domain:'synthetic'});
 const content=createFunnelStepPages(flow,{initialPage:document}); assert.ok(content);
 landing=await db.landingPage.create({data:{vendorId:vendor.id,projectId:project.id,name:'Synthetic',slug:key,draftContent:content,status:'published',publishedAt:new Date(),draftFormId:form.id,operations:defaultFunnelOperations()}});
 const version=await db.landingPageVersion.create({data:{vendorId:vendor.id,pageId:landing.id,version:1,content,formId:form.id}});
 await db.landingPage.update({where:{id:landing.id},data:{publishedVersionId:version.id}});
 const open=()=>db.landingPage.update({where:{id:landing.id},data:{operations:defaultFunnelOperations()}});
 const close=behavior=>db.landingPage.update({where:{id:landing.id},data:{operations:{...defaultFunnelOperations(),deadline:{enabled:true,timezone:'Asia/Taipei',expiresAt:new Date(Date.now()-60000).toISOString(),behavior,redirectPath:behavior==='redirect'?'thank-you':''}}}});
 assert.ok(['chromium','firefox'].includes(process.argv[3]));
 for(const [engine,driver] of [['chromium',chromium],['firefox',firefox]].filter(([name])=>name===process.argv[3])) {
  browser=await driver.launch();
  for(const entry of ['root','step']) for(const behavior of ['closed','redirect']) {
   stage=engine+':'+entry+':'+behavior;
   await open();
   const context=await browser.newContext({javaScriptEnabled:false});
   await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
   const page=await context.newPage();page.setDefaultTimeout(20000);
   const source='/lp/'+key+(entry==='step'?'/'+flow.steps.find(s=>!s.isSystem).path:'');
   const other='/lp/'+key+(entry==='root'?'/'+flow.steps.find(s=>!s.isSystem).path:'');
   report.step='invalid-submit';
   assert.equal((await page.goto(base+source)).status(),200);
   await page.locator('input[name=name]').fill('Synthetic retained');await page.locator('input[name=email]').fill('invalid');
   await page.locator('form').evaluate(f=>{f.noValidate=true});
   await page.locator('button[type=submit]').click();await page.waitForURL('**registrationRetry=400');
   assert.equal(await page.locator('input[name=email]').inputValue(),'invalid');
   await close(behavior);
   report.step='expired-draft';await page.reload();
   await page.getByRole('heading',{name:'此活動已截止'}).waitFor();
   await page.getByText('先前送出未完成。以下保留當時填寫的內容，僅供查看。',{exact:true}).waitFor();
   assert.equal(await page.getByLabel('Email',{exact:true}).inputValue(),'invalid');
   assert.equal(await page.getByLabel('Email',{exact:true}).getAttribute('readonly'),'');
   report.controls=await page.locator('form,button,input[name]').evaluateAll(nodes=>nodes.map(n=>({tag:n.tagName,type:n.getAttribute('type'),role:n.getAttribute('role'),label:n.getAttribute('aria-label'),inMain:Boolean(n.closest('main'))})));assert.equal(await page.locator('form,input[name],button[type=submit],main button').count(),0);
   assert.equal(new URL(page.url()).pathname,source);
   assert.equal(await page.getByRole('link',{name:'前往活動指定頁面'}).count(),behavior==='redirect'?1:0);
   if(behavior==='redirect')assert.equal(await page.getByRole('link',{name:'前往活動指定頁面'}).getAttribute('href'),'/lp/'+key+'/thank-you');
   report.step='cross-path';await page.goto(base+other+'?registrationRetry=400');
   await page.getByText('無法確認先前的送出結果，也沒有可恢復的填寫內容。若您已報名，請查看確認信。',{exact:true}).waitFor();
   assert.equal(await page.locator('input,form,button[type=submit],main button').count(),0);
   // Reopen only this synthetic fixture, then obtain a real successful native receipt.
   report.step='success-before-expiry';await open();await page.goto(base+source);
   await page.locator('input[name=name]').fill('Synthetic completed');
   const email=engine+'-'+entry+'-'+behavior+'@example.test';await page.locator('input[name=email]').fill(email);
   await page.locator('button[type=submit]').click();await page.waitForURL('**submitted=verification_required');
   assert.equal(await db.formSubmission.count({where:{formId:form.id,email}}),1);
   await close(behavior);report.step='expired-success';await page.reload();
   if(behavior==='closed'){
    await page.getByRole('heading',{name:'此活動已截止'}).waitFor();
    await page.getByText('請到 Email 開啟確認連結；完成確認後才會列入正式名單。',{exact:true}).waitFor();
   } else {
    // The existing deadline contract keeps its redirect target viewable.
    assert.equal(new URL(page.url()).pathname,'/lp/'+key+'/thank-you');
    assert.equal(await page.getByRole('heading',{name:'此活動已截止'}).count(),0);
   }
   assert.equal(await page.locator('input,form,button[type=submit],main button').count(),0);
   assert.equal(await db.formSubmission.count({where:{formId:form.id,email}}),1);
   assert.equal(await db.registrationFormRetryDraft.count({where:{formId:form.id}}),0);
   // Unknown query must retain the original deadline behavior, not expose a retry view.
   report.step='normal-expiry';await page.goto(base+source+'?registrationRetry=bogus');
   if(behavior==='redirect')assert.equal(new URL(page.url()).pathname,'/lp/'+key+'/thank-you');
   else await page.getByText('目前不再接受新的瀏覽或送出資料。',{exact:true}).waitFor();
   assert.equal(await db.emailDelivery.count({where:{vendorId:vendor.id,status:'sent'}}),0);
   report.checks.push({engine,entry,behavior,native:true,readonlyDraft:true,sourceBinding:true,verifiedSuccess:behavior==='closed'?true:'configured-target-remains-viewable',noResubmit:true,normalDeadlinePreserved:true,noMailSent:true});
   await context.close();
  }
  await browser.close();browser=null;
 }
 report.status='PASS';
}catch(error){report.status='FAIL';report.stage=stage;report.errorType=error.name;report.errorCode=error.code;report.assertion={operator:error.operator,actual:typeof error.actual==='number'||typeof error.actual==='boolean'?error.actual:undefined,expected:typeof error.expected==='number'||typeof error.expected==='boolean'?error.expected:undefined};report.failureLine=error.stack?.match(/browser-deadline[.]cjs:(\d+):/)?.[1];process.exitCode=1;}
finally {try {
 if(browser)await browser.close();
 if(form)await db.registrationFormRetryDraft.deleteMany({where:{formId:form.id}});
 if(vendor){await db.funnelSubmission.deleteMany({where:{vendorId:vendor.id}});await db.landingPage.updateMany({where:{vendorId:vendor.id},data:{publishedVersionId:null}});await db.landingPageVersion.deleteMany({where:{vendorId:vendor.id}});await db.landingPage.deleteMany({where:{vendorId:vendor.id}});await db.vendor.delete({where:{id:vendor.id}});}
 report.cleanup=true;
}catch(error){report.cleanupError=error.code??error.name;process.exitCode=1;}
await db.$disconnect();fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));}})();
