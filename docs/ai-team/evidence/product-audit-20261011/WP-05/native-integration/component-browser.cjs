const { build } = require('esbuild');
const { chromium, firefox } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const report={status:'IN_PROGRESS',checks:[],scope:'Actual React components; synthetic HTTP submission stub, no database, no CSS/AT certification'};
let server,browser;
(async()=>{try {
 const result=await build({stdin:{contents:`
 import React from 'react';
 import {createRoot} from 'react-dom/client';
 import {LeadForm} from './src/components/lead-form';
 import {RegistrationRetryProvider} from './src/components/registration-retry-context';
 import {RegistrationClosedFeedback} from './src/components/registration-closed-feedback';
 const fields=[{key:'name',label:'姓名',required:true},{key:'email',label:'Email',type:'email',required:true}];
 const state={formId:'synthetic',sourcePath:'/form/synthetic',draft:{formId:'synthetic',sourcePath:'/form/synthetic',answers:{name:'Synthetic',email:'synthetic@example.test'},liveId:null,status:429},failed:true};
 createRoot(document.getElementById('root')).render(<RegistrationRetryProvider value={state}>{location.pathname==='/closed'?<RegistrationClosedFeedback formId="synthetic" fields={fields} destination="/done"/>:<LeadForm formId="synthetic" fields={fields} submitLabel="報名" successMessage="報名資料已收到"/>}</RegistrationRetryProvider>);
 `,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'},logLevel:'silent'});
 let writes=0;
 server=http.createServer((req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(result.outputFiles[0].text);return;}
  if(req.url==='/api/form-submissions' && req.method==='POST'){writes++;req.resume();setTimeout(()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,verificationRequired:true}));},120);return;}
  res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><html lang="zh-Hant"><head><title>合成元件測試</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 for(const [engine,driver] of [['chromium',chromium],['firefox',firefox]]) {
  browser=await driver.launch();const context=await browser.newContext();
  await context.route(url=>url.origin!==base,route=>route.abort());
  const page=await context.newPage();page.setDefaultTimeout(10000);
  await page.goto(base+'/form/synthetic?registrationRetry=429&ref=keep');
  await page.locator('form [role=status]').waitFor({state:'attached'});
  const original=await page.locator('form [role=status]').elementHandle();const before=writes;
  await page.getByRole('button',{name:'報名',exact:true}).click();
  await page.getByText('報名資料已收到',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='status');
  assert.ok(await original.evaluate(node=>node.isConnected && node===document.activeElement && node.textContent==='報名資料已收到'));
  assert.equal(writes,before+1);assert.equal(await page.locator('input').count(),0);
  const url=new URL(page.url());assert.equal(url.searchParams.has('registrationRetry'),false);assert.equal(url.searchParams.get('ref'),'keep');
  await page.goto(base+'/closed');await page.getByText('此活動已截止',{exact:true}).waitFor();
  assert.equal(await page.locator('form').count(),0);assert.equal(await page.locator('button').count(),0);
  assert.equal(await page.getByLabel('Email').inputValue(),'synthetic@example.test');assert.equal(await page.getByLabel('Email').getAttribute('readonly'),'');
  report.checks.push({engine,persistentStatus:true,successFocus:true,staleQueryRemoved:true,unrelatedQueryPreserved:true,oneSyntheticPost:true,readonlyClosedView:true});
  await context.close();await browser.close();browser=null;
 }
 report.status='PASS';
}catch(error){report.status='FAIL';report.errorType=error.name;report.errorCode=error.code;process.exitCode=1;}
finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));}})();
