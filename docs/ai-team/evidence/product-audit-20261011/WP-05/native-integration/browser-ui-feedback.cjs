const { PrismaClient } = require('@prisma/client');
const { chromium, firefox } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const db = new PrismaClient();
const base = 'http://127.0.0.1:31026';
const report = { checks: [], status: 'IN_PROGRESS', cleanup: false };
let vendor, form, browser, lastPage, stage = 'fixture';
(async () => {
try {
 const key = 'wp05-native-' + Date.now();
 vendor = await db.vendor.create({ data: { name: '合成測試', slug: key, email: key+'@example.test', passwordHash: 'synthetic-unused' } });
 form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: '合成報名', slug: key, headline: '合成報名測試', fields: [{ key:'name',label:'姓名',type:'text',required:true },{key:'email',label:'Email',type:'email',required:true}] } });
 for (const [engine, driver] of [['chromium',chromium],['firefox',firefox]]) {
  browser = await driver.launch();
  for (const javascript of [false,true]) {
   stage = engine + ':' + (javascript?'js':'no-js');
   const context = await browser.newContext({ javaScriptEnabled: javascript });
   await context.route(url => url.origin !== base && !['data:','about:'].includes(url.protocol), route => route.abort());
   const page = await context.newPage(); lastPage=page; page.setDefaultTimeout(20000);
   if(engine==='chromium'){const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');cdp.on('Network.responseReceivedExtraInfo',event=>{if(event.blockedCookies?.length)report.blockedCookieReasons=event.blockedCookies.map(item=>item.blockedReasons);});}
   report.browserClockDelta=Math.round((await page.evaluate(()=>Date.now())-Date.now())/1000);
   page.on('request', async request => { if(new URL(request.url()).searchParams.has('submitted')) report.redirectCarriesProof=(await request.headerValue('cookie')??'').includes('celebratedeal_registration_result='); if(new URL(request.url()).pathname==='/api/form-submissions') report.originMatches=await request.headerValue('origin')===base; });
   page.on('response', async response => { if (new URL(response.url()).pathname === '/api/form-submissions') { report.lastSubmissionStatus=response.status(); const resultHeader=(await response.headersArray()).find(h=>h.name.toLowerCase()==='set-cookie' && h.value.includes('celebratedeal_registration_result=')); report.resultCookieIssued=Boolean(resultHeader); if(resultHeader){report.resultSecure=/; Secure(?:;|$)/i.test(resultHeader.value);report.resultMaxAge=Number(resultHeader.value.match(/Max-Age=([0-9]+)/i)?.[1]);const expiry=resultHeader.value.match(/Expires=([^;]+)/i)?.[1];report.resultExpiryDelta=expiry?Math.round((Date.parse(expiry)-Date.now())/1000):null;} report.responseNoStore=(await response.headerValue('cache-control'))==='no-store'; } });
   report.currentStep='load';
   assert.equal((await page.goto(base+'/form/'+form.slug)).status(),200);
   await page.locator('input[name=name]').fill('合成使用者');
   await page.locator('input[name=email]').fill('invalid-address');
   await page.locator('form').evaluate(form => { form.noValidate=true; });
   report.currentStep='submit'; report.__registrationReturnPathPresent=await page.locator('input[name=__registrationReturnPath]').inputValue() === '/form/'+form.slug;
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
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'alert');
    const axe = await new AxeBuilder({page}).analyze();
    assert.equal(axe.violations.filter(v=>['serious','critical'].includes(v.impact)).length,0);
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
   const fresh = await browser.newContext({ javaScriptEnabled: javascript });
   try {
    await fresh.route(url => url.origin !== base && !['data:','about:'].includes(url.protocol), route => route.abort());
    const copied = await fresh.newPage();
    await copied.goto(base+'/form/'+form.slug+'?submitted=verification_required');
    const emailInput = copied.locator('input[name=email]');
    await emailInput.waitFor(); assert.equal(await emailInput.isEnabled(),true);
    assert.equal(await copied.getByText('請到 Email 開啟確認連結；完成確認後才會列入正式名單。',{exact:true}).count(),0);
    await copied.goto(base+'/form/'+form.slug+'?registrationRetry=400');
    await copied.getByText('目前沒有可恢復的填寫內容，無法確認先前的送出結果。若您已報名，請先查看確認信，避免重複送出；若尚未報名，請重新填寫。',{exact:true}).waitFor();
    assert.equal(await copied.getByText('請確認必填欄位與資料格式後再送出。',{exact:true}).count(),0);
    assert.equal(await copied.locator('input[name=email]').isEnabled(),true);
    await copied.reload();
    await copied.getByText('目前沒有可恢復的填寫內容，無法確認先前的送出結果。若您已報名，請先查看確認信，避免重複送出；若尚未報名，請重新填寫。',{exact:true}).waitFor();

   } finally { await fresh.close(); }
   report.checks.push({engine,javascript,error400:true,refill:true,success:true,draftCleared:true,noMailSent:true,sharedSuccessUrlEditable:true,sharedErrorUrlUnconfirmed:true,reloadedErrorUrlUnconfirmed:true,jsErrorFocus:javascript?true:"NOT_APPLICABLE"});
   await context.close();
  }
  await browser.close(); browser=null;
 }
 report.status='PASS';
} catch (error) { report.status='FAIL'; report.failedStage=stage; report.errorType=error.name; report.errorCode=error.code; if(lastPage) {report.resultStored=(await lastPage.context().cookies(base)).some(item=>item.name.includes('registration_result'));  const location=new URL(lastPage.url());report.lastPath=location.pathname;report.lastOriginMatches=location.origin===base;report.retryState=location.searchParams.get('registrationRetry');report.errorMessageCount=await lastPage.getByText('請確認必填欄位與資料格式後再送出。',{exact:true}).count();report.retentionFailureCount=await lastPage.getByText('目前沒有可恢復的填寫內容，無法確認先前的送出結果。若您已報名，請先查看確認信，避免重複送出；若尚未報名，請重新填寫。',{exact:true}).count();report.fieldCount=await lastPage.locator('input[name=email]').count();report.draftCount=await db.registrationFormRetryDraft.count({where:{formId:form.id}}); } process.exitCode=1; }
finally {
 try {
 if(browser) await browser.close();
 if(form) await db.registrationFormRetryDraft.deleteMany({where:{formId:form.id}});
 if(vendor) { await db.emailDelivery.deleteMany({where:{vendorId:vendor.id}}); await db.analyticsEvent.deleteMany({where:{vendorId:vendor.id}}); await db.formSubmission.deleteMany({where:{formId:form.id}}); await db.registrationForm.deleteMany({where:{vendorId:vendor.id}}); await db.vendor.delete({where:{id:vendor.id}}); }
 report.cleanup=true;
 } catch (error) { report.cleanup=false;report.cleanupError=error.code??error.name;process.exitCode=1; }
 await db.$disconnect();
 fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));
}
})();
