// D-1 semantic contract; strict HTTP404 runner and its failures remain unchanged.
const {PrismaClient}=require('@prisma/client');const {chromium,firefox}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {createFunnelFlow}=require(process.cwd()+'/src/lib/funnel-flow.ts');
const {createFunnelStepPages,parseFunnelStepPages}=require(process.cwd()+'/src/lib/funnel-step-pages.ts');
const {defaultFunnelOperations}=require(process.cwd()+'/src/lib/funnel-operations.ts');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const db=new PrismaClient({datasourceUrl:'postgresql://postgres@127.0.0.1:64505/celebratedeal_ci?schema=public'});
const base='http://127.0.0.1:31024';const report={status:'IN_PROGRESS',checks:[],axe:[],restored:false};
const node=(type,id,props)=>({schemaVersion:1,id,type,props,style:{},overrides:{},visible:true,actions:[],attributes:{},...(type==='form'?{children:[]}: {})});
(async()=>{let browser,member,pref,project,landing,form;
try{
 member=await db.vendorMember.findFirstOrThrow({where:{user:{email:'demo@celebratedeal.local'},status:'active'},select:{vendorId:true,userId:true}});
 const key={userId_vendorId:{userId:member.userId,vendorId:member.vendorId}};
 pref=await db.userOnboardingPreference.findUnique({where:key,select:{selectedProjectId:true}});
 const slug=`audit-wp05-client-${Date.now()}`;
 project=await db.salesProject.create({data:{vendorId:member.vendorId,name:'合成多步驟發布',slug,mode:'live_course',primaryFlow:'live'}});
 form=await db.registrationForm.create({data:{vendorId:member.vendorId,projectId:project.id,name:'合成報名',slug,headline:'合成報名',fields:[{key:'name',label:'姓名',type:'text',required:true},{key:'email',label:'Email',type:'email',required:true}]}});
 const content=createFunnelStepPages(createFunnelFlow({id:'audit_flow',name:'合成公開頁',goal:'audience',domain:slug}));
 for(const step of content.flow.steps.filter(s=>!s.isSystem)){const row=node('row',`${step.id}_row`,{});row.children=[node('headline',`${step.id}_heading`,{text:'合成發布驗證內容',level:'h1'}),node('form',`${step.id}_form`,{label:'合成報名表'})];const section=node('section',`${step.id}_section`,{});section.children=[row];content.pages[step.id].root=[section];}assert.ok(parseFunnelStepPages(content),'FIXTURE_VALIDATION');
 landing=await db.landingPage.create({data:{vendorId:member.vendorId,projectId:project.id,name:'合成公開頁',slug,draftContent:content,draftFormId:form.id}});
 await db.userOnboardingPreference.update({where:key,data:{selectedProjectId:project.id}});
 browser=await (process.argv[2]==='firefox'?firefox:chromium).launch();const merchantContext=await browser.newContext({viewport:{width:1440,height:1000}});const publicContext=await browser.newContext();const merchant=await merchantContext.newPage();const viewer=await publicContext.newPage();
 assert.equal(await db.automationRule.count({where:{vendorId:member.vendorId,trigger:'form_registered',isActive:true}}),0,'NO_ACTIVE_AUTOMATION_REQUIRED');report.stage='login';await merchant.goto(`${base}/login`);await merchant.getByRole('button',{name:'登入',exact:true}).click();await merchant.waitForURL('**/dashboard');
 const edit=async()=>{await merchant.goto(`${base}/landing-pages/${landing.id}`);return merchant.getByRole('status',{name:'公開網址狀態'});};
 const unavailable=async(label)=>{const response=await viewer.goto(`${base}/lp/${slug}`);assert.equal(response.status(),404);const head=await viewer.request.head(`${base}/lp/${slug}`);assert.equal(head.status(),404);assert.equal((await head.body()).length,0);await viewer.getByRole('heading',{name:'404',exact:true}).waitFor();assert.equal(await viewer.getByText('合成發布驗證內容',{exact:true}).count(),0);assert.equal(await viewer.locator('form').count(),0);assert.ok((await viewer.locator('meta[name="robots"]').last().getAttribute('content')).includes('noindex'));const text=await viewer.locator('body').innerText();assert.ok(!text.includes('專案尚未發布')&&!text.includes('商家付款方式')&&!text.includes('A/B 或截止設定無效'));report.checks.push({label,httpStatus:response.status(),notFoundUi:true,noindex:true,authoredContentAbsent:true,merchantReasonsAbsent:true});};
 const axe=async(page,label,selector)=>{let builder=new AxeBuilder({page});if(selector)builder=builder.include(selector);const result=await builder.analyze();report.axe.push({label,scope:selector??'whole-page',violations:result.violations.map(v=>({id:v.id,impact:v.impact,nodeCount:v.nodes.length}))});};
 report.stage='unpublished-project';let status=await edit();await status.getByText('專案尚未發布，公開網址目前無法開啟',{exact:true}).waitFor();await axe(merchant,'merchant-diagnosis','[aria-label="公開網址狀態"]');
 await merchant.getByRole('button',{name:'發布已儲存草稿',exact:true}).click();await merchant.getByText(/Funnel 版本 v1 已儲存為發布版本。專案尚未發布/).waitFor();await unavailable('project-unpublished');
 assert.equal((await db.salesProject.findUniqueOrThrow({where:{id:project.id},select:{status:true}})).status,'draft');
 // Isolated fixture state for public rendering; original application gate stays unchanged.
 await db.salesProject.update({where:{id:project.id},data:{status:'published',publishedAt:new Date()}});
 report.stage='published-multi-step';status=await edit();await status.getByText('專案與 Funnel 均已發布，公開頁目前可開啟。',{exact:true}).waitFor();
 const response=await viewer.goto(`${base}/lp/${slug}`);assert.equal(response.status(),200);await viewer.getByText('合成發布驗證內容',{exact:true}).waitFor();await viewer.locator('form input[name="email"]').waitFor();report.checks.push({label:'published-root',httpStatus:200,authoredContent:true,formVisible:true});await axe(viewer,'published-root');

 report.stage='client-failure-matrix';
 for(const surface of ['funnel','standalone']){
  const destination=surface==='funnel'?`${base}/lp/${slug}`:`${base}/form/${slug}`;
  for(const code of [400,403,404,429,503,0]){
   assert.equal((await viewer.goto(destination)).status(),200);
   await viewer.locator('form input[name="name"]').fill('Synthetic Retry');await viewer.locator('form input[name="email"]').fill('retry@example.invalid');
   for(const box of await viewer.locator('form input[type="checkbox"]').all())await box.check();
   let calls=0,release;const held=new Promise(resolve=>{release=resolve;});
   await viewer.route('**/api/form-submissions',async route=>{calls++;await held;if(code===0)await route.abort('failed');else await route.fulfill({status:code,contentType:'application/json',body:'{"error":"synthetic internal detail"}'});});
   await viewer.locator('form').evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
   await viewer.waitForFunction(()=>document.querySelector('form')?.getAttribute('aria-busy')==='true');
   await viewer.waitForTimeout(100);assert.equal(calls,1);release();
   const alert=viewer.locator('form [role="alert"]');await alert.waitFor();assert.equal(await alert.getAttribute('aria-live'),'assertive');assert.ok(!(await alert.innerText()).includes('internal'));
   assert.equal(await viewer.locator('form input[name="name"]').inputValue(),'Synthetic Retry');assert.equal(await viewer.locator('form input[name="email"]').inputValue(),'retry@example.invalid');assert.equal(await viewer.locator('form').getAttribute('aria-busy'),'false');
   await viewer.locator('form button[type="submit"]').click();await viewer.waitForFunction(()=>document.querySelector('form')?.getAttribute('aria-busy')==='false');assert.equal(calls,2);
   await viewer.unroute('**/api/form-submissions');
   report.checks.push({label:'client-error',surface,status:code||'network',sameFrameSingleRequest:true,fieldsRetained:true,retryEnabled:true,serverDetailsAbsent:true,assertiveError:true});
  }
 }
 await viewer.goto(`${base}/lp/${slug}`);
 report.stage='actual-form-submit';
 const submit=async()=>{await viewer.locator('form input[name="name"]').fill('Synthetic Registration');await viewer.locator('form input[name="email"]').fill('wp01-submit@example.invalid');for(const box of await viewer.locator('form input[type="checkbox"]').all())await box.check();const pending=viewer.waitForResponse(r=>new URL(r.url()).pathname==='/api/form-submissions'&&r.request().method()==='POST');await viewer.locator('form button[type="submit"]').click();const response=await pending;assert.equal(response.status(),200);await viewer.waitForURL(u=>u.pathname!==`/lp/${slug}`);};
 await submit();
 const rows=await db.formSubmission.findMany({where:{formId:form.id},select:{id:true,verificationStatus:true}});assert.equal(rows.length,1);assert.equal(rows[0].verificationStatus,'UNVERIFIED');assert.equal(await db.funnelSubmission.count({where:{submissionId:rows[0].id,pageId:landing.id,vendorId:member.vendorId}}),1);
 const deliveries=await db.emailDelivery.findMany({where:{sourceFormSubmissionId:rows[0].id},select:{status:true,attemptCount:true,sentAt:true}});assert.equal(deliveries.length,1);assert.equal(deliveries[0].status,'queued');assert.equal(deliveries[0].attemptCount,0);assert.equal(deliveries[0].sentAt,null);
 await viewer.goto(`${base}/lp/${slug}`);await submit();assert.equal(await db.formSubmission.count({where:{formId:form.id}}),1);assert.equal(await db.emailDelivery.count({where:{sourceFormSubmissionId:rows[0].id}}),1);
 report.checks.push({label:'actual-browser-registration',httpStatus:200,submissionCount:1,verificationRequired:true,funnelProvenance:true,verificationDeliveryQueued:true,sendAttempts:0,duplicateSubmissionDeduplicated:true});

 for(const step of content.flow.steps.filter(s=>!s.isSystem)){const r=await viewer.goto(`${base}/lp/${slug}/${step.path}`);assert.equal(r.status(),200);await viewer.locator('form input[name="email"]').waitFor();report.checks.push({label:'published-step',path:step.path,httpStatus:200,formVisible:true});}
 report.stage='unpublish-refresh';await merchant.getByRole('button',{name:'取消發布',exact:true}).click();await merchant.getByRole('status',{name:'公開網址狀態'}).getByText('Funnel 尚未發布，公開網址目前無法開啟。',{exact:true}).waitFor();report.checks.push({label:'unpublish-without-reload',merchantReason:true});await merchant.getByRole('button',{name:'發布已儲存草稿',exact:true}).click();await merchant.getByText(/Funnel 版本 v2 已儲存為發布版本/).waitFor();report.stage='disabled-form';await db.registrationForm.update({where:{id:form.id},data:{isActive:false}});status=await edit();await status.getByText('已發布版本的報名表不存在、已停用或不屬於此專案。',{exact:true}).waitFor();await unavailable('disabled-form');await db.registrationForm.update({where:{id:form.id},data:{isActive:true}});
 report.stage='invalid-operations';await db.landingPage.update({where:{id:landing.id},data:{operations:{invalid:true}}});status=await edit();await status.getByText(/A\/B 或截止設定無效/).waitFor();await unavailable('invalid-operations');
 report.stage='expired';const operations=defaultFunnelOperations();operations.deadline={enabled:true,timezone:'Asia/Taipei',expiresAt:'2020-01-01T00:00:00Z',behavior:'closed',redirectPath:''};await db.landingPage.update({where:{id:landing.id},data:{operations}});status=await edit();await status.getByText(/但活動已截止/).waitFor();assert.equal((await viewer.goto(`${base}/lp/${slug}`)).status(),200);await viewer.getByRole('heading',{name:'此活動已截止'}).waitFor();report.checks.push({label:'expired-closed',httpStatus:200,merchantReason:true});
 report.status=report.axe.some(a=>a.violations.some(v=>['serious','critical'].includes(v.impact)))?'FAIL':'PASS';if(report.status!=='PASS')process.exitCode=1;
}catch(e){report.status='FAIL';report.errorType=e.name;report.errorCategories=['NS_BINDING_ABORTED','interrupted','Navigation','net::','Timeout','closed','ECONNREFUSED'].filter(x=>String(e.message).includes(x));report.assertionCode=e.code??null;report.stackLocation=String(e.stack).split('\n').find(line=>line.includes('browser.cjs:'))?.replace(process.cwd(),'WORKTREE');report.contextRequired=String(e.message).includes('newContext');process.exitCode=1;}
finally{try{if(member&&project){await db.userOnboardingPreference.updateMany({where:{userId:member.userId,vendorId:member.vendorId},data:{selectedProjectId:pref?.selectedProjectId??null}});if(form){const own=await db.formSubmission.findMany({where:{formId:form.id},select:{id:true}});await db.emailDelivery.deleteMany({where:{sourceFormSubmissionId:{in:own.map(x=>x.id)}}});await db.funnelSubmission.deleteMany({where:{submissionId:{in:own.map(x=>x.id)}}});await db.formSubmission.deleteMany({where:{formId:form.id}});}if(landing){await db.landingPage.update({where:{id:landing.id},data:{publishedVersionId:null}});await db.landingPage.delete({where:{id:landing.id}});}if(form)await db.registrationForm.delete({where:{id:form.id}});await db.salesProject.delete({where:{id:project.id}});report.restored=true;}}catch{report.status='FAIL';report.cleanupFailed=true;process.exitCode=1;}if(browser)await browser.close();await db.$disconnect();fs.writeFileSync(path.join(__dirname,'browser-'+(process.argv[2]||'chromium')+'-result.json'),JSON.stringify(report,null,2));}
})();
