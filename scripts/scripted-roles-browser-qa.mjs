import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';

// Real client components, synthetic HTTP boundary, no external service or credentials.
const root = process.cwd();
const out = path.join(root, 'docs/live-feature-handoffs');
const bundle = await build({ stdin: { contents: `
import React,{useRef} from 'react'; import {createRoot} from 'react-dom/client';
import {LiveDanmaku,InstructorDanmakuSwitch} from './src/components/live-danmaku';
import {LiveInteractionCard} from './src/components/live-interaction-card';
import {LiveViewingShell} from './src/components/live-viewing-shell';
function Viewer(){const videoRef=useRef(null);return <LiveViewingShell checkout={false} orientation="portrait" className="bg-slate-950 text-white"><video ref={videoRef} src="/media.webm" muted controls playsInline className="live-viewing-player" aria-label="播放器"/><LiveDanmaku enabled vendorId="tenant-a" liveId="live-a" videoRef={videoRef}/></LiveViewingShell>}
createRoot(document.getElementById('root')).render(location.pathname.startsWith('/instructor') ? <InstructorDanmakuSwitch liveId="live-a"/> :
<Viewer/>);`, resolveDir: root, loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', jsx: 'automatic', absWorkingDir: root,
  tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
  plugins: [{ name: 'resolve', setup(builder) { builder.onResolve({ filter: /.*/ }, args => {
    const resolver = createRequire(path.isAbsolute(args.importer) ? args.importer : path.join(root, 'package.json'));
    const target = args.path.startsWith('@/') ? path.join(root, 'src', args.path.slice(2)) : args.path;
    try { return { path: resolver.resolve(target) }; } catch {
      if (target.startsWith('.') || path.isAbsolute(target)) for (const extension of ['.ts', '.tsx']) { try { return { path: resolver.resolve(path.resolve(args.resolveDir || root, target) + extension) }; } catch {} }
    }
  }); } }], define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' } });
const globals = await fs.readFile(path.join(root, 'src/app/globals.css'), 'utf8');
const css = await postcss([tailwind()]).process(globals.replace('@import "tailwindcss";', '@import "tailwindcss" source(none); @source "./src/components/live-danmaku.tsx"; @source "./src/components/scripted-roles-control.tsx"; @source "./src/components/live-interaction-card.tsx"; @source "./src/components/live-viewing-shell.tsx"; @source "./src/components/live-playback.tsx";'), { from: path.join(root, 'danmaku-qa.css') });
let state = { enabled: false, epoch: 'off', since: new Date().toISOString() };
let warm = null; let current = null; let offline = false; let serial = 0; let media;
const requests=[]; const commands=[];
const events=[{id:'event-a',triggerSec:0,value:'歡迎加入 👋',displayName:'小暖',avatarUrl:null}];
const bump=()=>{state={...state,epoch:String(++serial),since:new Date().toISOString()};current=null;};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 if(url.pathname==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css.css);return;}
 if(url.pathname==='/media.webm'){res.setHeader('Content-Type','video/webm');res.end(media);return;}
 if(url.pathname.startsWith('/api/')){
 res.setHeader('Content-Type','application/json');
 if(url.pathname.endsWith('/scripted')){
  if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const command=JSON.parse(raw);commands.push(command.action);
   if(command.action==='select'){warm={scriptId:'script-a',enabled:true,scheduled:command.scheduled,manual:null};bump();}
   if(command.action==='stop'){warm={...warm,enabled:false,scheduled:false};bump();}
   if(command.action==='send'){current={...events[0],id:`manual:${command.requestId}`,source:'scripted_role',createdAt:new Date().toISOString()};}
   res.end('{"ok":true}');return;
  }
  res.end(JSON.stringify({state:warm,scripts:[{id:'script-a',name:'開場腳本'}],events:warm?events:[],canSchedule:true}));return;
 }
 if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;state.enabled=JSON.parse(raw).enabled;bump();res.end(JSON.stringify({state}));return;}
 if(url.searchParams.get('mode')==='instructor'){res.end(JSON.stringify({state}));return;}
 requests.push({position:url.searchParams.get('positionSeconds'),cursor:url.searchParams.has('cursor')});
 if(offline){res.statusCode=503;res.end('{}');return;}
 // 合成 feed 只提供目前短期事件；不使用真人資料或實際授權。
 const valid=state.enabled&&warm?.enabled&&url.searchParams.has('cursor')&&url.searchParams.get('epoch')===state.epoch;
 res.end(JSON.stringify({state,cursor:new Date().toISOString(),items:valid&&current&&Date.now()-Date.parse(current.createdAt)<3500?[current]:[]}));return;
 }
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="margin:0"><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const evidence=path.join(out,'scripted-roles-browser-evidence.json');
const receipt={boundary:'real React/Edge and decoded canvas MediaRecorder WebM; synthetic HTTP API/auth; viewport not physical phone; no production service',status:'FAIL',checks:[],pageErrors:0};
try{receipt.previousAttempts=[JSON.parse(await fs.readFile(evidence,'utf8'))];}catch{}
let browser;
async function until(check){const deadline=Date.now()+15000;while(!check()){if(Date.now()>deadline)throw new Error('Synthetic request observation timed out');await new Promise(r=>setTimeout(r,100));}}
try{
 browser=await chromium.launch({headless:true,channel:'msedge'});
 const maker=await browser.newPage();media=Buffer.from(await maker.evaluate(async()=>{
 const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');const stream=canvas.captureStream(10);const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});const chunks=[];recorder.ondataavailable=e=>chunks.push(e.data);const stopped=new Promise(r=>recorder.onstop=r);recorder.start();const timer=setInterval(()=>{ctx.fillStyle='#172033';ctx.fillRect(0,0,320,180);ctx.fillStyle='white';ctx.fillText('Synthetic warmup QA',20,90)},100);await new Promise(r=>setTimeout(r,6100));recorder.stop();await stopped;clearInterval(timer);stream.getTracks().forEach(t=>t.stop());return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));}));await maker.close();
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const viewer=await context.newPage();const manager=await context.newPage();
 for(const page of [viewer,manager])page.on('pageerror',error=>{receipt.pageErrors++;receipt.pageErrorMessages??=[];receipt.pageErrorMessages.push(error.message)});
 await viewer.goto(base);await manager.goto(`${base}/instructor`);
 await manager.getByRole('button',{name:'開啟全場彈幕'}).click();await manager.getByRole('button',{name:'載入手動暖場'}).click();await manager.getByText('手動暖場已載入',{exact:true}).waitFor();
 await manager.getByRole('button',{name:'預覽',exact:true}).click();await manager.getByLabel('暖場預覽').waitFor();assert.equal(commands.filter(x=>x==='send').length,0);receipt.checks.push('preview stays local and does not send');
 await viewer.getByText('公開卡片回答與暖場角色會在這裡出現').waitFor();
 await manager.getByRole('button',{name:'手動發送',exact:true}).click();await viewer.locator('.danmaku-message').waitFor();assert.match(await viewer.locator('.danmaku-message').innerText(),/暖場角色／預設互動.*小暖：歡迎加入/);
 await viewer.screenshot({path:path.join(out,`scripted-roles-mobile-${Date.now()}.png`)});assert.equal(await viewer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await viewer.locator('.danmaku-message').waitFor({state:'hidden'});current={...current,createdAt:new Date().toISOString()};
 let count=requests.length;await until(()=>requests.length>=count+2);assert.equal(await viewer.locator('.danmaku-message').count(),0);receipt.checks.push('source label, mobile no overflow, repeated event id not displayed again');
 await manager.getByRole('button',{name:'手動發送',exact:true}).click();await viewer.locator('.danmaku-message').waitFor();await manager.getByRole('button',{name:'停止並停用當前腳本'}).click();await viewer.locator('.danmaku-message').waitFor({state:'hidden'});receipt.checks.push('stop command clears a currently visible new manual message');await manager.getByText('暖場腳本已停用',{exact:true}).waitFor();assert.equal(warm.enabled,false);assert.equal(await viewer.locator('.danmaku-message').count(),0);
 await viewer.getByRole('button',{name:'隱藏彈幕'}).click();await manager.getByRole('button',{name:'關閉全場彈幕'}).click();await manager.getByRole('button',{name:'開啟全場彈幕'}).click();await viewer.reload();await viewer.getByRole('button',{name:'顯示彈幕'}).waitFor();await viewer.getByRole('button',{name:'顯示彈幕'}).click();receipt.checks.push('stop and global switch clear display; personal hidden preference survives reopen and reload');
 await manager.getByRole('button',{name:'載入手動暖場'}).click();await manager.getByText('手動暖場已載入',{exact:true}).waitFor();offline=true;await viewer.getByText('全場彈幕尚未開啟或正在同步').waitFor();current={...events[0],id:'offline-only',source:'scripted_role',createdAt:new Date(Date.now()-5000).toISOString()};offline=false;await viewer.getByText('公開卡片回答與暖場角色會在這裡出現').waitFor();count=requests.length;await until(()=>requests.length>=count+2);assert.equal(await viewer.locator('.danmaku-message').count(),0);receipt.checks.push('disconnected event not replayed on reconnect');
 await manager.getByRole('button',{name:'啟用播放時間排程'}).click();await manager.getByText('播放時間排程已啟用',{exact:true}).waitFor();
 await viewer.waitForFunction(()=>document.querySelector('video').readyState>=1);await viewer.locator('video').evaluate(v=>v.play());count=requests.length;await until(()=>requests.slice(count).some(r=>r.position!==null));await viewer.locator('video').evaluate(v=>v.pause());count=requests.length;await until(()=>requests.length>=count+2);assert.equal(requests.at(-1).position,null);
 await viewer.locator('video').evaluate(v=>{v.currentTime=2;});await viewer.waitForFunction(()=>!document.querySelector('video').seeking);assert.equal(await viewer.locator('.danmaku-message').count(),0);await viewer.locator('video').evaluate(v=>v.play());count=requests.length;await until(()=>requests.slice(count).some(r=>Number(r.position)>=2));receipt.checks.push('actual HTML video play sends currentTime; pause omits position; seek clears display and resumed position follows media');
 await manager.screenshot({path:path.join(out,`scripted-roles-controls-${Date.now()}.png`)});assert.equal(await manager.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(receipt.pageErrors,0);receipt.status='PASS';
}catch(error){receipt.error=error.message;}finally{await browser?.close();await new Promise(r=>server.close(r));await fs.writeFile(evidence,JSON.stringify(receipt,null,2));}
console.log(JSON.stringify(receipt));process.exitCode=receipt.status==='PASS'?0:1;
