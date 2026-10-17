const { chromium, firefox } = require('@playwright/test');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const base = 'http://127.0.0.1:31026';
const report = {status:'IN_PROGRESS',checks:[]};
(async()=>{try {
for (const [engine,driver] of [['chromium',chromium],['firefox',firefox]]) {
 const browser=await driver.launch({headless:true});
 try {
 for (const destination of ['/password-reset/request','/register']) {
  const context=await browser.newContext();
  let release; const gate=new Promise(resolve=>{release=resolve}); let intercepted=false;
  try {
   await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==base)return route.abort();
    if(url.pathname===destination && route.request().headers()['rsc']==='1') {intercepted=true;await gate;}
    return route.continue();
   });
   const page=await context.newPage();await page.goto(base+'/login');
   await page.locator('a[href="'+destination+'"]').waitFor();
   // Poll the real route request, without reading form values or cookies.
   await page.locator('a[href="'+destination+'"]').click({noWaitAfter:true});
   await page.locator('[data-navigation-progress="active"]').waitFor({timeout:10000});
   assert.equal(intercepted,true);release();
   await page.waitForURL(base+destination,{timeout:30000});
   await page.locator('h1').waitFor();
   await page.locator('[data-navigation-progress="active"]').waitFor({state:'detached',timeout:10000});
   report.checks.push({engine,destination,delayedRsc:true,pendingVisible:true,arrival:true});
  }finally{release();await context.close();}
 }
 }finally{await browser.close();}
}
report.status='PASS';
}catch(e){report.status='FAIL';report.failure=e.name+': navigation assertion failed';process.exitCode=1;}
finally{fs.writeFileSync(process.argv[2],JSON.stringify(report));}})();
