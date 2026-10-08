import fs from "node:fs";
import vm from "node:vm";
import {describe,expect,it,vi} from "vitest";
function worker(){
 const handlers=new Map<string,(event:unknown)=>void>();const match=vi.fn().mockResolvedValue(new Response("public offline"));const addAll=vi.fn();const network=vi.fn().mockRejectedValue(new Error("offline"));
 vm.runInNewContext(fs.readFileSync("public/portal/sw.js","utf8"),{self:{location:{origin:"https://app.example.test"},addEventListener:(name:string,handler:(event:unknown)=>void)=>handlers.set(name,handler)},caches:{open:async()=>({match,addAll})},URL,Response,fetch:network});
 return {handlers,match,addAll,network};
}
describe("portal service worker privacy boundary",()=>{
 it("starts on a canonical document inside the narrow worker scope",()=>{
  const manifest=JSON.parse(fs.readFileSync("public/portal/manifest.webmanifest","utf8"));
  expect(manifest.scope).toBe("/portal/");
  expect(manifest.start_url).toBe("/portal/start.html");
  expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
 });
 it("does not intercept RSC, API, POST, media or cross-origin traffic",()=>{const {handlers,match}=worker();for(const input of [{url:"/portal/teacher/learn/course_a/progress",method:"POST",mode:"cors",destination:""},{url:"/portal/teacher?_rsc=synthetic",method:"GET",mode:"cors",destination:""},{url:"/portal/teacher/learn/course_a/community/data",method:"GET",mode:"cors",destination:""},{url:"/portal/teacher/video.mp4",method:"GET",mode:"no-cors",destination:"video"},{url:"https://foreign.example.test/portal/offline.html",method:"GET",mode:"navigate",destination:"document"}]){const respondWith=vi.fn();handlers.get("fetch")!({request:{...input,url:new URL(input.url,"https://app.example.test").toString(),headers:new Headers()},respondWith});expect(respondWith).not.toHaveBeenCalled();}expect(match).not.toHaveBeenCalled();});
 it("returns only generic offline HTML on failed document navigation without writing authenticated content",async()=>{const {handlers,addAll}=worker();let response:Promise<Response>|undefined;handlers.get("fetch")!({request:{url:"https://app.example.test/portal/teacher/access?token=synthetic",method:"GET",mode:"navigate",destination:"document",headers:new Headers()},respondWith:(value:Promise<Response>)=>{response=value;}});const result=await response!;expect(result.status).toBe(503);expect(result.headers.get("cache-control")).toBe("no-store");expect(await result.text()).toBe("public offline");expect(addAll).not.toHaveBeenCalled();});
});

function notificationWorker(){
 const handlers=new Map<string,(event:unknown)=>void>();
 const showNotification=vi.fn().mockResolvedValue(undefined),openWindow=vi.fn().mockResolvedValue(null),matchAll=vi.fn().mockResolvedValue([]);
 vm.runInNewContext(fs.readFileSync("public/portal/sw.js","utf8"),{self:{location:{origin:"https://app.example.test"},registration:{showNotification},clients:{matchAll,openWindow},addEventListener:(name:string,handler:(event:unknown)=>void)=>handlers.set(name,handler)},URL,Response});
 async function receive(data:unknown){let pending:Promise<unknown>|undefined;handlers.get("push")!({data:{json:()=>data},waitUntil:(value:Promise<unknown>)=>{pending=value;}});await pending;}
 async function click(path:unknown){const close=vi.fn();let pending:Promise<unknown>|undefined;handlers.get("notificationclick")!({notification:{data:{path},close},waitUntil:(value:Promise<unknown>)=>{pending=value;}});await pending;expect(close).toHaveBeenCalledTimes(1);}
 return {handlers,showNotification,openWindow,matchAll,receive,click};
}

describe("received portal device notifications",()=>{
 it("shows bounded plain text and stores only a relative click path without navigating on receipt",async()=>{
  const worker=notificationWorker();await worker.receive({title:"合成通知",body:"純文字內容",path:"/portal/academy/learn/course_a/community/post_a",privateContact:"must-not-copy"});
  expect(worker.showNotification).toHaveBeenCalledWith("合成通知",{body:"純文字內容",icon:"/portal/icon-192.png",data:{path:"/portal/academy/learn/course_a/community/post_a"}});expect(worker.openWindow).not.toHaveBeenCalled();expect(worker.matchAll).not.toHaveBeenCalled();
 });
 it.each([null,{}, {title:"x".repeat(201),body:"text"},{title:"title",body:"x".repeat(2001)},{title:"",body:"text"},{title:"title",body:{html:"unsafe"}}])("malformed messages show only generic content",async data=>{
  const worker=notificationWorker();await worker.receive(data);expect(worker.showNotification).toHaveBeenCalledWith("學員通知",{body:"請登入學員中心查看最新消息。",icon:"/portal/icon-192.png",data:{path:"/portal/start.html"}});
 });
 it.each(["https://foreign.example.test", "//foreign.example.test", "/api/jobs/email-deliveries", "/portal/access?token=synthetic", "/portal/../../admin", "/portal/%2e%2e/api/jobs/email-deliveries", "/portal/academy#token", "javascript:alert(1)", "/portal/academy/learn/course_a/community/data", "/portal/academy/learn/course_a/community/%64ata", "/portal/academy/learn/course_a/notifications/enroll", "/live/slug/access", "/live/slug?token=synthetic", null])("unsafe click path falls back to public portal root",async path=>{
  const worker=notificationWorker();await worker.click(path);expect(worker.openWindow).toHaveBeenCalledWith("https://app.example.test/portal/start.html");
 });
 it("keeps the authenticated notification management link",async()=>{const worker=notificationWorker();await worker.click("/portal/academy/notifications");expect(worker.openWindow).toHaveBeenCalledWith("https://app.example.test/portal/academy/notifications");});
 it("focuses an exact existing page instead of duplicating it",async()=>{
  const worker=notificationWorker(),focus=vi.fn().mockResolvedValue(undefined);worker.matchAll.mockResolvedValue([{url:"https://app.example.test/portal/academy/learn/course_a",focus}]);await worker.click("/portal/academy/learn/course_a");expect(focus).toHaveBeenCalledTimes(1);expect(worker.openWindow).not.toHaveBeenCalled();expect(worker.matchAll).toHaveBeenCalledWith({type:"window",includeUncontrolled:true});
 });
 it("opens the exact public live link only after an explicit click",async()=>{
  const worker=notificationWorker();await worker.receive({title:"直播開始",body:"合成課程",path:"/live/synthetic-live"});expect(worker.openWindow).not.toHaveBeenCalled();await worker.click("/live/synthetic-live");expect(worker.openWindow).toHaveBeenCalledWith("https://app.example.test/live/synthetic-live");
 });
});

it("completed course payload preserves its exact certificate click destination", async () => {
 const worker = notificationWorker();
 const path = "/portal/academy/learn/course_a/certificate";
 await worker.receive({ title: "課程已完成", body: "合成課程", path });
 expect(worker.showNotification).toHaveBeenCalledWith("課程已完成", expect.objectContaining({ data: { path } }));
 expect(worker.openWindow).not.toHaveBeenCalled();
 await worker.click(path);
 expect(worker.openWindow).toHaveBeenCalledWith(`https://app.example.test${path}`);
});
