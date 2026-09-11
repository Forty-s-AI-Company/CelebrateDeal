import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { buildIsolatedEnvironment } from "./private-chat-disposable-qa.mjs";
const root=process.cwd();
function resolveWorkspace(b, external = false) {
  b.onResolve({ filter: /.*/ }, args => {
    if (external && !args.path.startsWith("@/") && !args.path.startsWith(".") && !path.isAbsolute(args.path)) return { path: args.path, external: true };
    const resolver = createRequire(path.isAbsolute(args.importer) ? args.importer : path.join(root, "package.json"));
    const target = args.path.startsWith("@/") ? path.join(root, "src", args.path.slice(2)) : args.path;
    try { return { path: resolver.resolve(target) }; } catch {
      if (target.startsWith(".") || path.isAbsolute(target)) for (const extension of [".ts", ".tsx"]) {
        try { return { path: resolver.resolve(path.resolve(args.resolveDir || root, target) + extension) }; } catch {}
      }
    }
  });
}
const css = await postcss([tailwind()]).process(await fs.readFile("src/app/globals.css", "utf8"), { from: path.join(root, "src/app/globals.css") });
const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{LivePlayback}from'./src/components/live-playback';
const live={id:'live-a',vendorId:'tenant-a',title:'講師與 PPT',slug:'presenter',status:'live',runtimeState:'playing',admissionRequired:false,chatEnabled:true,videoUrl:location.origin+'/video.mp4',orientation:location.search.includes('portrait')?'portrait':'landscape',description:null,accentCopy:null,heroImageUrl:null,brand:{name:'CelebrateDeal',logoUrl:null,primaryColor:'#2563eb',ctaColor:'#fff'},form:null,interactionEvents:[],products:[]};
createRoot(document.getElementById('root')).render(<LivePlayback live={live}/>);`, resolveDir: root, loader: "tsx" }, absWorkingDir: root, tsconfigRaw: { compilerOptions: { jsx: "react-jsx" } }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "qa-boundaries", setup(b) {
  b.onResolve({ filter: /^(next\/(navigation|image)|@\/components\/(lead-form|live-advanced-interactions|live-purchase-ticker))$/ }, args => ({ path: args.path, namespace: "fixture" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "next/navigation" ? "const router={refresh(){},back(){},push(){}};export const useRouter=()=>router;export const usePathname=()=>'/live/presenter';" : args.path === "next/image" ? "export default function Image(){return null}" : "export const LeadForm=()=>null;export const LiveChatPanel=()=>null;export const LiveAdvancedInteractions=()=>null;export const LivePurchaseTicker=()=>null;" }));
  resolveWorkspace(b);
} }] });

const server=http.createServer((req,res)=>{
 if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 if(req.url==='/style.css'){res.setHeader('Content-Type','text/css; charset=utf-8');res.end(css.css);return;}
 if(req.url.includes('live-chat') && req.method==='POST'){let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'message-a',source:'viewer',createdAt:new Date().toISOString(),body:JSON.parse(body).body,actor:{name:'測試觀眾'}}));});return;}
 if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url.includes('/cards')?{card:{id:'c',title:'測試卡片',configuration:{version:1,kind:'interaction_card',answerType:'text',visibility:'instructor_only',options:[]},ownValue:null}}:req.url.includes('live-chat')?{messages:[],viewer:{canPost:true,displayName:'測試觀眾',reason:null},nextCursor:null}:{ok:true,allowed:true}));return;}
 if(req.url==='/video.mp4'){res.statusCode=404;res.end();return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
await fs.mkdir(path.join(root,"tmp/mobile-viewing"),{recursive:true});
const profile=await fs.mkdtemp(path.join(root,"tmp/mobile-viewing/profile-"));
const browser=await chromium.launchPersistentContext(profile,{channel:"msedge",env:buildIsolatedEnvironment(path.join(root,'tmp/mobile-viewing'))});
const checks=[];
const evidenceDirectory=path.join(root,"docs/live-feature-handoffs");
await fs.mkdir(evidenceDirectory,{recursive:true});
const screenshots=[];
async function assertInViewport(locator,page){await locator.scrollIntoViewIfNeeded();const box=await locator.boundingBox();const viewport=page.viewportSize();assert.ok(box && box.x>=0 && box.y>=0 && box.x+box.width<=viewport.width+1 && box.y+box.height<=viewport.height+1);}
try{
 const page=await browser.newPage();
 for(const orientation of ['landscape','portrait']) for(const [width,height] of [[390,844],[844,390],[768,1024],[1440,900]]){
  await page.setViewportSize({width,height});await page.goto(`http://127.0.0.1:${server.address().port}/?${orientation}`);
  await page.getByRole('button',{name:'頁內全螢幕',exact:true}).click();
  assert.equal(await page.locator('[data-page-fullscreen="true"]').count(),1);
  const frame=await page.locator('[data-testid="persistent-live-player"]').boundingBox();
  assert.ok(Math.abs(frame.width/frame.height-(orientation==='portrait'?9/16:16/9))<0.015);
  assert.equal(await page.locator('video').evaluate(e=>getComputedStyle(e).objectFit),'contain');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(await page.locator('iframe').count(),0);
  if(width===390 || width===844){const name=`orientation-mobile-${orientation}-${width}x${height}.png`;await page.screenshot({path:path.join(evidenceDirectory,name),fullPage:true});screenshots.push(name);}
  await page.getByLabel('輸入直播留言').scrollIntoViewIfNeeded();
  assert.ok(await page.getByLabel('輸入直播留言').isVisible());
  await page.getByLabel('輸入直播留言').fill('旋轉後保留的草稿');
  await page.getByLabel('你的回答', {exact:true}).fill('卡片回答');
  await page.setViewportSize({width,height:Math.max(300,height-250)});
  await assertInViewport(page.getByRole('button',{name:'送出回答',exact:true}),page);
  await page.getByRole('button',{name:'送出回答',exact:true}).click();
  await page.getByText('已回答：卡片回答', {exact:true}).waitFor();
  await page.setViewportSize({width,height});
  await page.getByLabel('輸入直播留言').focus();
  await page.setViewportSize({width,height:Math.max(300,height-250)});

  assert.equal(await page.getByLabel('輸入直播留言').inputValue(),'旋轉後保留的草稿');
  await assertInViewport(page.getByRole('button',{name:'送出',exact:true}),page);
  await page.getByRole('button',{name:'送出',exact:true}).click({timeout:3000});
  await page.waitForFunction(()=>document.getElementById('live-chat-message').value==='');
  await page.getByRole('button',{name:'退出頁內全螢幕'}).scrollIntoViewIfNeeded();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-page-fullscreen="true"]').count(),0);
  assert.equal(await page.getByRole('button',{name:'頁內全螢幕',exact:true}).evaluate(e=>e===document.activeElement),true);
  checks.push({orientation,width,height,status:'PASS'});
 }
 for(const [orientation,mediaWidth,mediaHeight] of [['portrait',640,360],['landscape',360,640]]){
  await page.setViewportSize({width:390,height:844});
  await page.goto(`http://127.0.0.1:${server.address().port}/?${orientation}`);
  const intrinsic=await page.evaluate(async({mediaWidth,mediaHeight})=>{
   const canvas=document.createElement('canvas');canvas.width=mediaWidth;canvas.height=mediaHeight;
   const ctx=canvas.getContext('2d');const stream=canvas.captureStream(15);
   const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});const chunks=[];
   recorder.ondataavailable=e=>chunks.push(e.data);const stopped=new Promise(resolve=>recorder.onstop=resolve);
   recorder.start();
   for(let frame=0;frame<8;frame++){
    ctx.fillStyle='#0369a1';ctx.fillRect(0,0,mediaWidth,mediaHeight);
    ctx.strokeStyle='#facc15';ctx.lineWidth=16;ctx.strokeRect(8,8,mediaWidth-16,mediaHeight-16);
    ctx.fillStyle='#fff';ctx.font='bold 28px sans-serif';ctx.fillText('TOP / LEFT',24,48);ctx.fillText('BOTTOM / RIGHT',24,mediaHeight-28);
    await new Promise(resolve=>setTimeout(resolve,70));
   }
   recorder.stop();await stopped;stream.getTracks().forEach(track=>track.stop());
   const video=document.querySelector('video');const url=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));
   const ready=new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=reject;});video.src=url;video.muted=true;video.loop=true;await ready;await video.play();
   return {width:video.videoWidth,height:video.videoHeight,fit:getComputedStyle(video).objectFit};
  },{mediaWidth,mediaHeight});
  assert.equal(intrinsic.width,mediaWidth);assert.equal(intrinsic.height,mediaHeight);assert.equal(intrinsic.fit,'contain');
  const frame=await page.locator('[data-testid="persistent-live-player"]').boundingBox();
  assert.ok(Math.abs(frame.width/frame.height-(orientation==='portrait'?9/16:16/9))<0.015);
  // Temporarily hide native controls for the edge-marker screenshot only.
  await page.locator('video').evaluate(video=>{video.controls=false;});
  const name=`orientation-mismatch-${orientation}.png`;await page.screenshot({path:path.join(evidenceDirectory,name),fullPage:true});screenshots.push(name);
  checks.push({orientation,mediaWidth,mediaHeight,status:'PASS',boundary:'canvas/MediaRecorder synthetic WebM decoded by actual HTMLVideoElement'});
 }
 const receipt={status:'PASS',boundary:'real React playback/chat/card UI; synthetic API; 8 layout cases without media and 2 actual decoded synthetic WebM mismatch cases; no real mobile keyboard',assertions:['no horizontal page overflow or iframe','measured 16:9 / 9:16 frame','card send visible after reduced viewport and mock API accepted','chat send visible after reduced viewport and mock API accepted','draft retained until successful send','Escape restores focus'],checks,screenshots};
 await fs.writeFile(path.join(evidenceDirectory,'orientation-mobile-browser-evidence.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt));
}finally{await browser.close();await new Promise(r=>server.close(r));}
