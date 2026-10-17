const { PrismaClient } = require('@prisma/client');
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const db = new PrismaClient();
const base = 'http://127.0.0.1:31026';
const report = { status:'IN_PROGRESS',checks:[],cleanup:false };
let vendor,form,browser,stage='fixture';
(async()=>{try {
 const key='wp05-status-'+Date.now();
 vendor=await db.vendor.create({data:{name:'Synthetic',slug:key,email:key+'@example.test',passwordHash:'synthetic-unused'}});
 form=await db.registrationForm.create({data:{vendorId:vendor.id,name:'Synthetic',slug:key,headline:'Synthetic registration',fields:[{key:'name',label:'Name',type:'text',required:true},{key:'email',label:'Email',type:'email',required:true}]}});
 await db.blacklist.create({data:{vendorId:vendor.id,identifier:'blocked@example.test',identifierType:'email',reason:'synthetic browser fixture'}});
 browser=await chromium.launch();
 const context=await browser.newContext({javaScriptEnabled:false});
 await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 const page=await context.newPage();page.setDefaultTimeout(15000);
 for(const status of [403,404,429]) {
  stage=String(status);
  await page.goto(base+'/form/'+form.slug);
  const email=status===403?'blocked@example.test':'synthetic@example.test';
  await page.locator('input[name=name]').fill('Synthetic preserved');
  await page.locator('input[name=email]').fill(email);
  if(status===404) await page.locator('form').evaluate(form=>{const input=document.createElement('input');input.type='hidden';input.name='liveId';input.value='synthetic-missing-live';form.append(input);});
  if(status===429) {
   // Consume this local server's real limiter with invalid JSON; never write registrations.
   for(let i=0;i<10;i++) await context.request.post(base+'/api/form-submissions',{headers:{origin:base,'x-celebratedeal-client':'web'},data:{formId:form.id,payload:{name:'Synthetic',email:'invalid'}}});
  }
  const submitted = page.waitForResponse(response=>new URL(response.url()).pathname==='/api/form-submissions' && response.request().method()==='POST');
  await page.locator('button[type=submit]').click();
  const redirected = await submitted;
  assert.equal(redirected.status(),303);
  if(status===429){const wait=await redirected.headerValue('retry-after');assert.match(wait??'',/^\d{1,8}$/);assert.ok(Number(wait)>0 && Number(wait)<=60);}

  await page.waitForURL('**registrationRetry='+status);
  const message=status===403?'這次送出未通過安全檢查，請重新整理頁面後再試。':status===429?'送出次數太頻繁，請稍候一分鐘再試。':'這張表單目前無法接收資料，請稍後再試。';
  await page.getByText(message,{exact:true}).waitFor();
  assert.equal(await page.locator('input[name=name]').inputValue(),'Synthetic preserved');
  assert.equal(await page.locator('input[name=email]').inputValue(),email);
  assert.equal(await db.formSubmission.count({where:{formId:form.id}}),0);
  assert.ok(await db.registrationFormRetryDraft.count({where:{formId:form.id}})>0);
  report.checks.push({status,native303:true,visibleAlert:true,refill:true,noSubmission:true,draftSaved:true,retryAfterPreserved:status===429?true:"NOT_APPLICABLE"});
 }
 report.status='PASS';
} catch(error){report.status='FAIL';report.stage=stage;report.errorType=error.name;process.exitCode=1;}
finally {try {
 if(browser) await browser.close();
 if(form) {await db.registrationFormRetryDraft.deleteMany({where:{formId:form.id}});await db.formSubmission.deleteMany({where:{formId:form.id}});}
 if(vendor) await db.vendor.delete({where:{id:vendor.id}});
 report.cleanup=true;
} catch(error){report.cleanupError=error.code??error.name;process.exitCode=1;}
await db.$disconnect();fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));}
})();
