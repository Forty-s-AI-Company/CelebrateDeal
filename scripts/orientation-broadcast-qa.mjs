import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { buildIsolatedEnvironment } from "./private-chat-disposable-qa.mjs";

// Real React UI, app signaling routes, canvas capture, WebRTC and MediaMTX.
// Auth, readiness and DB are synthetic boundaries here; DB evidence runs separately.
const root = process.cwd();
const temp = path.join(root, "tmp/orientation-media");
await fs.mkdir(temp, { recursive: true });
const out = path.join(root, "docs/live-feature-handoffs");
const receipt = { status: "FAIL", boundary: "real MediaMTX + WHIP/WHEP + app routes + UI; synthetic media inputs/auth/DB", checks: [], pageErrors: [], phase: "setup" };
const require = createRequire(import.meta.url);
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
const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{PresenterStudio}from'./src/components/presenter-studio';import{LivePlayback}from'./src/components/live-playback';
const live={orientation:'portrait',id:'live-a',vendorId:'tenant-a',title:'講師與 PPT',slug:'presenter',status:'live',runtimeState:'playing',admissionRequired:true,description:null,accentCopy:null,heroImageUrl:null,brand:{name:'CelebrateDeal',logoUrl:null,primaryColor:'#2563eb',ctaColor:'#fff'},form:null,interactionEvents:[],products:[]};
createRoot(document.getElementById('root')).render(location.pathname==='/instructor'?<PresenterStudio liveId='live-a'/>:<LivePlayback live={live}/>);`, resolveDir: root, loader: "tsx" }, absWorkingDir: root, tsconfigRaw: { compilerOptions: { jsx: "react-jsx" } }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "qa-boundaries", setup(b) {
  b.onResolve({ filter: /^(next\/(navigation|image)|@\/components\/(lead-form|live-chat-panel|live-advanced-interactions|live-purchase-ticker))$/ }, args => ({ path: args.path, namespace: "fixture" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "next/navigation" ? "const router={refresh(){},back(){},push(){}};export const useRouter=()=>router;export const usePathname=()=>'/live/presenter';" : args.path === "next/image" ? "export default function Image(){return null}" : "export const LeadForm=()=>null;export const LiveChatPanel=()=>null;export const LiveAdvancedInteractions=()=>null;export const LivePurchaseTicker=()=>null;" }));
  resolveWorkspace(b);
} }] });
globalThis.__presenterQA = {
  live: { id: "live-a", vendorId: "tenant-a", videoId: "video-a", title: "測試", slug: "presenter", status: "scheduled", streamMode: "live", video: { vendorId: "tenant-a", sourceType: "browser_live", status: "ready" }, presenterLayout: { version: 1, mode: "side-by-side", corner: "bottom-right", cameraPercent: 25, orientation: "portrait" } }, sessions: new Map(), sequence: 0,
};
const backend = await build({ stdin: { contents: "export {POST as media} from './src/app/api/live-media/route';export {GET as settings,POST as save} from './src/app/api/live-presenter/route';", resolveDir: root, loader: "ts" }, absWorkingDir: root, tsconfigRaw: {}, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "server-boundaries", setup(b) {
  const mocks = {
    "@/lib/auth": "export async function getCurrentAuth(){return {vendor:{id:'tenant-a'},member:{id:'teacher-a',status:'active',role:'owner'}}}",
    "@/lib/rate-limit": "export async function checkRateLimit(){return null}",
    "@/lib/live-runtime-readiness": "export function getRuntimeLivePublishReadiness(){return {ready:true}}",
    "@/lib/live-quota-admission": "export const liveViewerTokenFromRequest=r=>r.headers.get('x-qa-viewer')||'viewer-a';export const hashLiveViewerToken=t=>t;export async function hasActiveLiveViewerSession(db,s){return s.vendorId==='tenant-a'&&s.liveId==='live-a'}",
    "@/lib/db": `const q=globalThis.__presenterQA;const matches=(row,w)=>Object.entries(w).every(([k,v])=>k==='OR'?v.some(x=>matches(row,x)):v&&typeof v==='object'?(('gt'in v)?row[k]>v.gt:('lte'in v)?row[k]<=v.lte:true):row[k]===v);
const db={live:{findFirst:async({where})=>matches(q.live,where)?{...q.live}:null,update:async({data})=>Object.assign(q.live,data),updateMany:async({where,data})=>{if(!matches(q.live,where))return{count:0};Object.assign(q.live,data);return{count:1}}},liveMediaSession:{findFirst:async({where})=>[...q.sessions.values()].find(s=>matches(s,where))||null,findMany:async({where})=>[...q.sessions.values()].filter(s=>matches(s,where)),create:async({data})=>{const row={id:'session-'+(++q.sequence),closing:false,...data};q.sessions.set(row.id,row);return row},updateMany:async({where,data})=>{let count=0;for(const s of q.sessions.values())if(matches(s,where)){Object.assign(s,data);count++}return{count}},deleteMany:async({where})=>{let count=0;for(const s of q.sessions.values())if(matches(s,where)){q.sessions.delete(s.id);count++}return{count}}},$transaction:async fn=>fn(db)};export const getDb=()=>db;`,
  };
  b.onResolve({ filter: /^@\/lib\// }, args => args.path in mocks ? { path: args.path, namespace: "fixture" } : undefined);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path] }));
  resolveWorkspace(b, true);
} }] });
const backendPath = path.join(temp, "qa-backend.cjs");
await fs.writeFile(backendPath, backend.outputFiles[0].text);
const handlers = require(backendPath);
process.env.CELEBRATEDEAL_MEDIA_ORIGIN = "http://127.0.0.1:18889";
const env = buildIsolatedEnvironment(temp);
const occupied = await fetch("http://127.0.0.1:18889/", { signal: AbortSignal.timeout(500) }).then(() => true, () => false);
if (occupied) throw new Error("MEDIA_PORT_IN_USE: refusing to use an unowned media process");
const media = spawn(path.join(root, "tmp/presenter-media/bin/mediamtx.exe"), [path.join(root, "ops/media/mediamtx.local.yml")], { cwd: temp, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let mediaFailure = ""; media.on("error", () => { mediaFailure = "MEDIA_PROCESS_FAILED"; });
media.stderr.on("data", () => { mediaFailure = "MEDIA_PROCESS_STDERR"; });
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/app.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
    if (url.pathname === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css.css); return; }
    if (url.pathname.startsWith("/api/")) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const method = req.method;
      const request = new Request(url, { method, headers: { ...req.headers, origin: url.origin }, ...(method !== "GET" ? { body: Buffer.concat(chunks) } : {}) });
      let response;
      if (url.pathname === "/api/live-presenter") response = await (method === "GET" ? handlers.settings : handlers.save)(request);
      else if (url.pathname === "/api/live-media") response = await handlers.media(request);
      else if (url.pathname === "/api/live-playback-source") response = Response.json({ playbackUrl: "/api/live-media?liveId=live-a&vendorId=tenant-a", playbackStartSeconds: 0, protocol: "whep" });
      else if (url.pathname === "/api/live-interactions/cards") response = Response.json({ card: { id: "card-a", title: "互動卡片不遮住簡報", status: "active", configuration: { version: 1, kind: "interaction_card", answerType: "text", visibility: "instructor_only", options: [] }, ownValue: null, options: [], responseCount: 0, answers: [] } });
      else response = Response.json({ ok: true, allowed: true });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<!doctype html><html lang="zh-Hant"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root" style="padding:16px"></div><script src="/app.js"></script></body></html>');
  } catch { res.statusCode = 500; res.end("QA_ROUTE_FAILED"); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
let instructor;
let viewer;
try {
  receipt.phase = "media-start";
  for (let i = 0; i < 30; i++) {
    if (media.exitCode !== null || mediaFailure) throw new Error("MEDIA_PROCESS_FAILED");
    try { await fetch("http://127.0.0.1:18889/"); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  browser = await chromium.launch({ headless: true, channel: "msedge", args: ["--autoplay-policy=no-user-gesture-required"] });
  instructor = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  viewer = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  for (const page of [instructor, viewer]) page.on("pageerror", error => receipt.pageErrors.push(error.message));
  await instructor.addInitScript(() => {
    window.qaTracks = [];
    const make = (camera) => {
      const canvas = document.createElement("canvas"); canvas.width = camera ? 640 : 1024; canvas.height = camera ? 360 : 768;
      const ctx = canvas.getContext("2d"); let frame = 0;
      const draw = () => { ctx.fillStyle = camera ? "#ee2222" : "#163ce8"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = "white"; ctx.font = "28px sans-serif"; ctx.fillText(camera ? "CAMERA" : "PPT 4:3：完整比例", 60, 100); ctx.fillText(String(frame++), 60, 150); };
      draw(); const timer = setInterval(draw, 100); const stream = canvas.captureStream(20); window.qaTracks.push(...stream.getTracks()); stream.getVideoTracks()[0].addEventListener("ended", () => clearInterval(timer));
      if (camera) { const audio = new AudioContext(); const oscillator = audio.createOscillator(); const destination = audio.createMediaStreamDestination(); oscillator.connect(destination); oscillator.start(); stream.addTrack(destination.stream.getAudioTracks()[0]); window.qaTracks.push(...destination.stream.getTracks()); }
      return Promise.resolve(stream);
    };
    navigator.mediaDevices.getUserMedia = () => make(true);
    navigator.mediaDevices.getDisplayMedia = () => make(false);
  });
  receipt.phase = "instructor";
  await instructor.goto(base + "/instructor");
  await instructor.getByRole("button", { name: "開啟攝影機與麥克風" }).click();
  await instructor.getByRole("button", { name: "分享 PPT 視窗" }).click();
  await instructor.getByRole("button", { name: "開始直播", exact: true }).click();
  await instructor.getByRole("status").filter({ hasText: "正在直播" }).waitFor({ timeout: 30_000 });
  receipt.phase = "viewer";
  await viewer.goto(base + "/viewer");
  await viewer.waitForFunction(() => document.querySelector("video")?.readyState >= 2, { timeout: 30_000 });
  await instructor.getByRole("button", { name: "連線觀眾畫面" }).click();
  await instructor.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
  receipt.checks.push("actual WHIP publish -> MediaMTX -> WHEP viewer and instructor return monitor");

  for (const page of [viewer, instructor]) {
    await page.waitForFunction(() => { const v=document.querySelector('video'); return v.videoWidth / v.videoHeight > .55 && v.videoWidth / v.videoHeight < .58; });
    const dimensions=await page.locator('video').evaluate(v=>({width:v.videoWidth,height:v.videoHeight}));
    receipt.checks.push({ name: page===viewer?'viewer native portrait':'monitor native portrait', ...dimensions });
  }
  const decoded=await viewer.locator('video').evaluate(video=>{
    const c=document.createElement('canvas');c.width=1080;c.height=1920;const x=c.getContext('2d');x.drawImage(video,0,0,1080,1920);
    const pixel=(a,b)=>[...x.getImageData(a,b,1,1).data];
    return { slide:pixel(540,400), camera:pixel(540,1300), margin:pixel(540,12), slideBottom:pixel(540,827) };
  });
  assert.ok(decoded.slide[2]>150 && decoded.slide[0]<100, 'complete slide top');
  assert.ok(decoded.camera[0]>150 && decoded.camera[2]<100, 'camera below slide');
  assert.ok(decoded.margin[2]<100, '4:3 slide contained with top margin');
  assert.ok(decoded.slideBottom[2]>150, 'bottom of complete 4:3 slide retained');
  receipt.checks.push({name:'decoded portrait regions retain 4:3 slide',decoded});
  assert.equal(await instructor.locator('canvas').evaluate(c=>c.width),1080);
  assert.equal(await instructor.locator('canvas').evaluate(c=>c.height),1920);
  await instructor.getByRole('button',{name:'保存設定',exact:true}).click();
  assert.equal(globalThis.__presenterQA.live.presenterLayout.orientation,'portrait');
  await viewer.setViewportSize({width:390,height:844});
  await viewer.screenshot({path:path.join(out,'orientation-broadcast-viewer.png'),fullPage:true});
  await instructor.screenshot({path:path.join(out,'orientation-broadcast-studio.png'),fullPage:true});
  await instructor.getByRole('button',{name:'停止傳送與釋放來源'}).click();
  assert.equal(await instructor.evaluate(()=>window.qaTracks.every(t=>t.readyState==='ended')),true);
  await instructor.reload();
  await instructor.getByText('直式 9:16：完整簡報在上', {exact:false}).waitFor();
  receipt.checks.push('portrait UI persistence and source cleanup');
  assert.deepEqual(receipt.pageErrors, []);
  receipt.status = "PASS";
} catch (error) { receipt.failure = error.message; await instructor?.screenshot({ path: path.join(out, "orientation-broadcast-failure.png"), fullPage: true }).catch(() => {}); }
finally { await browser?.close(); media.kill(); await new Promise(resolve => server.close(resolve)); await fs.writeFile(path.join(out, "orientation-broadcast-evidence.json"), JSON.stringify(receipt, null, 2)); }
console.log(JSON.stringify(receipt)); process.exitCode = receipt.status === "PASS" ? 0 : 1;
