const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const esbuild=require('esbuild'),postcss=require('postcss'),tailwind=require('@tailwindcss/postcss');
const {chromium,firefox}=require('@playwright/test'),AxeBuilder=require('@axe-core/playwright').default;
const root=process.cwd(),out=path.join(root,'docs/ai-team/evidence/product-audit-20261011/WP-15'),assets=path.join(root,'.ai-team/tmp/wp15-dashboard');
const report={status:'IN_PROGRESS',scope:'Real client components and app CSS, synthetic server-action/report adapters; not authenticated full-app E2E',checks:[],cleanup:false};let server,browser;
(async()=>{try{
 fs.mkdirSync(assets,{recursive:true});
 await esbuild.build({entryPoints:[path.join(out,'dashboard-browser-entry.jsx')],outfile:path.join(assets,'bundle.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'synthetic-boundaries',setup(build){
 build.onResolve({filter:/^wp15-kpi$/},()=>({path:'wp15-kpi',namespace:'presentation'}));
 build.onLoad({filter:/.*/,namespace:'presentation'},()=>{
 const source=fs.readFileSync(path.join(root,'src/app/(app)/dashboard/dashboard-kpis.tsx'),'utf8');
 const start=source.indexOf('function DashboardKpiContent('),end=source.indexOf('export default async function DashboardKpis');
 assert(start>0&&end>start);
 return {loader:'tsx',resolveDir:root,contents:'import {Card} from "@/components/ui";\nexport '+source.slice(start,end)};
 });
 build.onResolve({filter:/^@\/components\/csrf-field$/},args=>({path:args.path,namespace:'synthetic'}));
 build.onResolve({filter:/^next\/(link|navigation|image)$/},args=>({path:args.path,namespace:'synthetic'}));
 build.onResolve({filter:/^@\/app\/actions(?:\/.*)?$/},args=>({path:args.path,namespace:'synthetic'}));
 build.onLoad({filter:/.*/,namespace:'synthetic'},args=>({loader:'jsx',resolveDir:root,contents:args.path==='@/components/csrf-field'?'export const CsrfField=()=>null;':args.path==='next/link'?'import React from "react";export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}':args.path==='next/image'?'import React from "react";export default function Image({fill,priority,unoptimized,src,alt,...props}){return <img src={src} alt={alt} {...props}/>}':args.path==='next/navigation'?'export const usePathname=()=>"/dashboard";export const useRouter=()=>({push:()=>{},refresh:()=>{}});':'const unavailable=async()=>({status:"error",message:"合成介面不執行寫入"});export const logoutAction=unavailable,controlOnboardingGuideAction=unavailable,createConsultationBookingAction=unavailable,getConsultationSlots=unavailable,landingPageAction=unavailable,readFunnelOperations=unavailable,updateFunnelOperations=unavailable,createFunnelAutomationRuleAction=unavailable,listFunnelAutomationRulesAction=unavailable,setFunnelAutomationRuleEnabledAction=unavailable,updateFunnelAutomationRuleAction=unavailable;'}));
 }}]});
 const css=await postcss([tailwind()]).process(fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8'),{from:path.join(root,'src/app/globals.css')});fs.writeFileSync(path.join(assets,'style.css'),css.css);
 const fixtures={generatedAt:'2026-10-13T00:00:00.000Z',experiments:[],statsTruncated:false,stats:[],sources:[],leadsTruncated:false,leads:[{id:'synthetic_lead',pageId:'synthetic',stepId:'opt_in',submissionId:'synthetic_registration',createdAt:'2026-10-14T00:00:00.000Z',verificationStatus:'UNVERIFIED'}],salesTruncated:false,sales:[{id:'synthetic_order',orderNumber:'SYNTHETIC-001',stepId:'opt_in',paidAt:'2026-10-14T00:00:00.000Z',currency:'TWD',paidAmountCents:10000,refundedAmountCents:0,status:'paid',paymentStatus:'paid',paymentId:'synthetic_payment'}]};
 server=http.createServer((req,res)=>{const url=new URL(req.url,'http://127.0.0.1:31031');if(url.pathname==='/api/funnel/operations/reports'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(fixtures));return;}const filename={'/bundle.js':'bundle.js','/style.css':'style.css'}[url.pathname];if(filename){res.setHeader('Content-Type',filename.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(path.join(assets,filename)));return;}if(url.pathname!=='/'){res.writeHead(404);res.end();return;}res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><title>合成介面驗證</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(31031,'127.0.0.1',resolve)});
 for(const [engine,driver] of [['chromium',chromium],['firefox',firefox]]){
 browser=await driver.launch({headless:true});
 for(const viewport of [{name:'desktop',width:1280,height:900},{name:'mobile',width:390,height:844}]){
 const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height}});
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const page=await context.newPage();await page.goto('http://127.0.0.1:31031/');
 await page.getByRole('heading',{name:'營運總覽',exact:true}).waitFor();
 const nav=page.getByRole('navigation',{name:viewport.name==='desktop'?'主要導覽':'行動版主要導覽',exact:true});
 assert.equal(await nav.isVisible(),true);
 assert.equal(await nav.getByRole('link',{name:'營運總覽',exact:true}).count(),1);
 const primary=page.getByRole('link',{name:'建立直播',exact:true});
 const rect=await primary.boundingBox();assert(rect&&rect.y>=0&&rect.y+rect.height<=viewport.height);assert(rect.height>=44);
 const disclosure=page.locator('main details').filter({has:page.locator('summary').filter({hasText:'目前指標尚無活動資料'})});
 const summary=disclosure.locator('summary');assert.equal(await disclosure.getAttribute('open'),null);
 for(const state of ['collapsed','expanded','recollapsed','active']){
 if(state==='expanded'||state==='recollapsed'){await summary.focus();await page.keyboard.press('Enter');}
 if(state==='expanded'){assert.notEqual(await disclosure.getAttribute('open'),null);assert.equal(await page.getByRole('heading',{name:'近 7 天轉換漏斗'}).isVisible(),true);}
 if(state==='recollapsed'){assert.equal(await disclosure.getAttribute('open'),null);assert.equal(await summary.evaluate(el=>el===document.activeElement),true);}
 if(state==='active'){await page.getByRole('button',{name:'切換合成活動資料'}).click();assert.equal(await summary.count(),0);}
 const result=await new AxeBuilder({page}).analyze();const serious=result.violations.filter(x=>['serious','critical'].includes(x.impact)).map(x=>({id:x.id,impact:x.impact,nodes:x.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));
 report.checks.push({engine,viewport:viewport.name,state,primaryBounds:rect,a11ySerious:serious});
 }
 await context.close();
 }await browser.close();browser=null;}
 assert.equal(report.checks.flatMap(x=>x.a11ySerious).length,0);report.status='PASS';
 }catch(error){report.status='FAIL';report.errorType=error.name;report.errorSummary=String(error.message).slice(0,600);process.exitCode=1;}finally{if(browser)await browser.close();if(server?.listening)await new Promise(resolve=>server.close(resolve));report.cleanup=true;fs.writeFileSync(path.join(out,'dashboard-browser-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,stage:report.stage,checks:report.checks.length}));}})();
