import fs from "node:fs";
import vm from "node:vm";
import {describe,expect,it,vi} from "vitest";
function worker(){
 const handlers=new Map<string,(event:unknown)=>void>();const match=vi.fn().mockResolvedValue(new Response("public offline"));const addAll=vi.fn();const network=vi.fn().mockRejectedValue(new Error("offline"));
 vm.runInNewContext(fs.readFileSync("public/portal/sw.js","utf8"),{self:{location:{origin:"https://app.example.test"},addEventListener:(name:string,handler:(event:unknown)=>void)=>handlers.set(name,handler)},caches:{open:async()=>({match,addAll})},URL,Response,fetch:network});
 return {handlers,match,addAll,network};
}
describe("portal service worker privacy boundary",()=>{
 it("does not intercept RSC, API, POST, media or cross-origin traffic",()=>{const {handlers,match}=worker();for(const input of [{url:"/portal/teacher/learn/course_a/progress",method:"POST",mode:"cors",destination:""},{url:"/portal/teacher?_rsc=synthetic",method:"GET",mode:"cors",destination:""},{url:"/portal/teacher/learn/course_a/community/data",method:"GET",mode:"cors",destination:""},{url:"/portal/teacher/video.mp4",method:"GET",mode:"no-cors",destination:"video"},{url:"https://foreign.example.test/portal/offline.html",method:"GET",mode:"navigate",destination:"document"}]){const respondWith=vi.fn();handlers.get("fetch")!({request:{...input,url:new URL(input.url,"https://app.example.test").toString(),headers:new Headers()},respondWith});expect(respondWith).not.toHaveBeenCalled();}expect(match).not.toHaveBeenCalled();});
 it("returns only generic offline HTML on failed document navigation without writing authenticated content",async()=>{const {handlers,addAll}=worker();let response:Promise<Response>|undefined;handlers.get("fetch")!({request:{url:"https://app.example.test/portal/teacher/access?token=synthetic",method:"GET",mode:"navigate",destination:"document",headers:new Headers()},respondWith:(value:Promise<Response>)=>{response=value;}});const result=await response!;expect(result.status).toBe(503);expect(result.headers.get("cache-control")).toBe("no-store");expect(await result.text()).toBe("public offline");expect(addAll).not.toHaveBeenCalled();});
});
