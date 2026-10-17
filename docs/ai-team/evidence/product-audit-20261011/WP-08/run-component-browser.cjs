const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const esbuild=require('esbuild'),postcss=require('postcss'),tailwind=require('@tailwindcss/postcss');
const {chromium,firefox}=require('@playwright/test'),AxeBuilder=require('@axe-core/playwright').default;
const root=process.cwd(),out=path.join(root,'docs/ai-team/evidence/product-audit-20261011/WP-08'),assets=path.join(root,'.ai-team/tmp/wp08-component');
const report={status:'IN_PROGRESS',scope:'Real client components and app CSS, synthetic server-action/report adapters; not authenticated full-app E2E',checks:[],cleanup:false};let server,browser;
(async()=>{try{
 fs.mkdirSync(assets,{recursive:true});
 await esbuild.build({entryPoints:[path.join(out,'browser-component-entry.tsx')],outfile:path.join(assets,'bundle.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'synthetic-boundaries',setup(build){
 build.onResolve({filter:/^next\/(link|navigation|image)$/},args=>({path:args.path,namespace:'synthetic'}));
 build.onResolve({filter:/^@\/app\/actions(?:\/.*)?$/},args=>({path:args.path,namespace:'synthetic'}));
 build.onLoad({filter:/.*/,namespace:'synthetic'},args=>({loader:'jsx',resolveDir:root,contents:args.path==='next/link'?'import React from "react";export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}':args.path==='next/image'?'import React from "react";export default function Image({fill,priority,unoptimized,src,alt,...props}){return <img src={src} alt={alt} {...props}/>}':args.path==='next/navigation'?'export const useRouter=()=>({push:()=>{},refresh:()=>{}});':'const unavailable=async()=>({status:"error",message:"合成介面不執行寫入"});export const createConsultationBookingAction=unavailable,getConsultationSlots=unavailable,landingPageAction=unavailable,readFunnelOperations=unavailable,updateFunnelOperations=unavailable,createFunnelAutomationRuleAction=unavailable,listFunnelAutomationRulesAction=unavailable,setFunnelAutomationRuleEnabledAction=unavailable,updateFunnelAutomationRuleAction=unavailable;'}));
 }}]});
 const css=await postcss([tailwind()]).process(fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8'),{from:path.join(root,'src/app/globals.css')});fs.writeFileSync(path.join(assets,'style.css'),css.css);
 const fixtures={generatedAt:'2026-10-13T00:00:00.000Z',experiments:[],statsTruncated:false,stats:[],sources:[],leadsTruncated:false,leads:[{id:'synthetic_lead',pageId:'synthetic',stepId:'opt_in',submissionId:'synthetic_registration',createdAt:'2026-10-14T00:00:00.000Z',verificationStatus:'UNVERIFIED'}],salesTruncated:false,sales:[{id:'synthetic_order',orderNumber:'SYNTHETIC-001',stepId:'opt_in',paidAt:'2026-10-14T00:00:00.000Z',currency:'TWD',paidAmountCents:10000,refundedAmountCents:0,status:'paid',paymentStatus:'paid',paymentId:'synthetic_payment'}]};
 server=http.createServer((req,res)=>{const url=new URL(req.url,'http://127.0.0.1:31028');if(url.pathname==='/api/funnel/operations/reports'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(fixtures));return;}const filename={'/bundle.js':'bundle.js','/style.css':'style.css'}[url.pathname];if(filename){res.setHeader('Content-Type',filename.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(path.join(assets,filename)));return;}if(url.pathname!=='/'){res.writeHead(404);res.end();return;}res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><title>合成介面驗證</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(31028,'127.0.0.1',resolve)});
 for(const [engine,driver] of [['chromium',chromium],['firefox',firefox]]){browser=await driver.launch();const context=await browser.newContext();await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:31028'?route.continue():route.abort());
 for(const viewport of [{name:'desktop',width:1280,height:900},{name:'mobile',width:390,height:844}]) for(const mode of ['step','popup','operations']){report.stage=engine+':'+viewport.name+':'+mode;const page=await context.newPage();await page.setViewportSize({width:viewport.width,height:viewport.height});await page.goto('http://127.0.0.1:31028/?mode='+mode);
 if(mode!=='operations'){
 await page.getByRole('tab',{name:'動作',exact:true}).click();const select=page.locator(mode==='step'?'select:has(option[value=step_alpha])':'select:has(option[value=popup_alpha])');
 assert.deepEqual(await select.locator('option').allTextContents(),['請選擇',...(mode==='step'?['報名頁','感謝頁']:['活動提醒','優惠通知'])]);
 const value=mode==='step'?'step_beta':'popup_beta';await select.selectOption(value);await page.getByRole('button',{name:'套用動作',exact:true}).click();
 const action=await page.evaluate(()=>window.lastSyntheticCommand.patch.actions[0]);assert.equal(action[mode==='step'?'stepId':'popupId'],value);
 }else{await page.getByRole('button',{name:'成效統計',exact:true}).click();await page.getByText('瀏覽次數為伺服器公開頁交付紀錄',{exact:false}).waitFor();await page.getByRole('button',{name:'報名名單',exact:true}).click();await page.getByRole('cell',{name:'尚未驗證',exact:true}).waitFor();assert.equal(await page.getByRole('cell',{name:'合成網站',exact:true}).count(),1);}
 const scan=async state=>{const a11y=await new AxeBuilder({page}).analyze();const serious=a11y.violations.filter(x=>['serious','critical'].includes(x.impact)).map(x=>({id:x.id,impact:x.impact,nodes:x.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));report.checks.push({engine,viewport:viewport.name,mode,state,behavior:'PASS',a11ySerious:serious});};
 await scan(mode==='operations'?'leads':'applied-action');
 if(mode!=='operations'){
  await page.getByRole('button',{name:'移除合成目標',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'套用動作',exact:true}).isDisabled(),true);
  await page.getByText(mode==='popup'?'原彈出視窗已不存在，請重新選擇':'原步驟已不存在，請重新選擇',{exact:true}).count().then(count=>assert.equal(count,1));
  await scan('missing-target');
  await page.getByRole('button',{name:'模擬復原動作',exact:true}).click();
  const restored=page.locator('select').filter({has:page.locator('option[value="'+(mode==='popup'?'popup_beta':'step_beta')+'"]')});
  assert.equal(await restored.inputValue(),mode==='popup'?'popup_beta':'step_beta');
  assert.equal(await page.getByRole('button',{name:'套用動作',exact:true}).isEnabled(),true);
  await scan('same-node-action-restored');
 }

 if(mode==='operations'){
 for(const [tab,expected] of [['銷售紀錄','已付款 / 已付款'],['A/B 測試','建立 A/B 實驗'],['截止設定','啟用截止時間'],['頁面設定','網址路徑']]){await page.getByRole('button',{name:tab,exact:true}).click();await page.getByText(expected,{exact:false}).first().waitFor();await scan(tab);}
 await page.getByRole('button',{name:'網站設定',exact:true}).click();await page.getByRole('dialog',{name:'網站設定',exact:true}).waitFor();await scan('網站設定');await page.getByRole('button',{name:'關閉 網站設定',exact:true}).click();
 await page.getByRole('button',{name:'新增步驟',exact:true}).click();await page.getByRole('dialog',{name:'新增步驟',exact:true}).waitFor();await scan('新增步驟');await page.getByRole('button',{name:'關閉新增步驟',exact:true}).click();
 if(engine==='chromium')await page.screenshot({path:path.join(out,'component-'+viewport.name+'.png'),fullPage:true});
 }
 await page.close();
 }await context.close();await browser.close();browser=null;}
 assert.equal(report.checks.flatMap(x=>x.a11ySerious).length,0);report.status='PASS';
 }catch(error){report.status='FAIL';report.errorType=error.name;report.errorSummary=String(error.message).slice(0,600);process.exitCode=1;}finally{if(browser)await browser.close();if(server?.listening)await new Promise(resolve=>server.close(resolve));report.cleanup=true;fs.writeFileSync(path.join(out,'component-browser-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,stage:report.stage,checks:report.checks.length}));}})();
