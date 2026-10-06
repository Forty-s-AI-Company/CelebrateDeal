import { isValidElement,type ReactNode } from "react";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
const hooks=vi.hoisted(()=>({states:[] as unknown[],refs:[] as Array<{current:unknown}>,stateIndex:0,refIndex:0,hydrated:true}));
// Drive the actual handlers with persistent hook slots, following this repo's
// media-handler test pattern. Browser rendering is verified separately.
vi.mock("react",async importOriginal=>({...await importOriginal<typeof import("react")>(),
 useId:()=>"synthetic-notification-heading",
 useSyncExternalStore:()=>hooks.hydrated,
 useState:(initial:unknown)=>{const index=hooks.stateIndex++;if(!(index in hooks.states))hooks.states[index]=initial;return [hooks.states[index],(next:unknown)=>{hooks.states[index]=typeof next==="function"?next(hooks.states[index]):next;}];},
 useRef:(initial:unknown)=>{const index=hooks.refIndex++;if(!hooks.refs[index])hooks.refs[index]={current:initial};return hooks.refs[index];}
}));
import { LearnerNotificationSettings } from "./learner-notification-settings";
import type { StudentPortalLocale } from "@/lib/student-portal-locale";
function find(node:ReactNode,type:string,text?:string):Record<string,unknown>|undefined{
 if(Array.isArray(node)){for(const child of node){const result=find(child,type,text);if(result)return result;}}
 else if(isValidElement<{children?:ReactNode}>(node)){if(node.type===type && (text===undefined || node.props.children===text))return node.props;return find(node.props.children,type,text);}
}
function render(locale?:StudentPortalLocale){hooks.stateIndex=0;hooks.refIndex=0;return LearnerNotificationSettings({vendorSlug:"academy",courseId:"course-1",locale});}
const pref=(revision=1,verified=false,enabled=false)=>({channel:"email",enabled,revision,destinationVerifiedAt:verified?"2026-10-07T00:00:00.000Z":null});
const snapshot=(revision=1,verified=false,enabled=false)=>({preferences:[pref(revision,verified,enabled)],csrfToken:"synthetic-csrf",capabilities:{availableChannels:["email"],pushPublicKey:null}});
const fetchMock=vi.fn();
beforeEach(()=>{hooks.states=[];hooks.refs=[];vi.clearAllMocks();vi.stubGlobal("fetch",fetchMock);fetchMock.mockResolvedValue(Response.json(snapshot()));});
afterEach(()=>vi.unstubAllGlobals());
function click(text:string){const props=find(render(),"button",text);expect(props).toBeDefined();(props!.onClick as ()=>void)();}
function change(type:string,value:string){(find(render(),type)!.onChange as (event:{target:{value:string}})=>void)({target:{value}});}
async function idle(){await vi.waitFor(()=>expect(find(render(),"button","重新載入設定")!.disabled).toBe(false));}
async function load(){click("載入通知設定");await idle();}
it("initial render does not send requests or obtain push permission",()=>{render();expect(fetchMock).not.toHaveBeenCalled();});
it("does not accept a notification action before hydration attaches its handlers",async()=>{
 hooks.hydrated=false;
 try{expect(find(render(),"button","載入通知設定")!.disabled).toBe(true);click("載入通知設定");await Promise.resolve();expect(fetchMock).not.toHaveBeenCalled();}
 finally{hooks.hydrated=true;}
});
it("reads only the exact course with the actual same-origin client contract",async()=>{await load();expect(fetchMock).toHaveBeenCalledWith("/portal/academy/learn/course-1/notifications",expect.objectContaining({credentials:"same-origin",cache:"no-store",headers:{"x-celebratedeal-client":"web"}}));expect(find(render(),"button","開啟通知")!.disabled).toBe(true);});
it("enrollment and proof do not opt in until the learner separately consents",async()=>{
 await load();change("input","synthetic@invalid.example");
 fetchMock.mockReset().mockResolvedValueOnce(Response.json({status:"challenge_queued",challenge:{id:"challenge-1",expiresAt:"2026-10-07T00:15:00.000Z"}},{status:202})).mockResolvedValueOnce(Response.json(snapshot(2)));
 click("寄送驗證碼");await idle();expect(find(render(),"input")!.value).toBe("");
 const enrolled=JSON.parse(fetchMock.mock.calls[0][1].body);expect(enrolled).toEqual({channel:"email",destination:{email:"synthetic@invalid.example"},expectedRevision:1});
 const tree=render();const verification=find(tree,"button","確認驗證碼");expect(verification).toBeDefined();
 // Find the proof input by walking the input list rather than hook positions.
 function inputs(node:ReactNode):Record<string,unknown>[] {if(Array.isArray(node))return node.flatMap(inputs);if(isValidElement<{children?:ReactNode}>(node))return node.type==="input"?[node.props]:inputs(node.props.children);return [];}
 (inputs(render())[1].onChange as (event:{target:{value:string}})=>void)({target:{value:"b".repeat(43)}});
 fetchMock.mockReset().mockResolvedValueOnce(Response.json({status:"verified",preference:pref(3,true)})).mockResolvedValueOnce(Response.json(snapshot(3,true)));
 click("確認驗證碼");await idle();expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({challengeId:"challenge-1",token:"b".repeat(43)});expect(find(render(),"button","開啟通知")!.disabled).toBe(false);expect(fetchMock.mock.calls.filter(call=>call[1]?.method==="POST")).toHaveLength(1);
 fetchMock.mockReset().mockResolvedValueOnce(Response.json({status:"saved",preference:pref(4,true,true)})).mockResolvedValueOnce(Response.json(snapshot(4,true,true)));
 click("開啟通知");await idle();expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({channel:"email",enabled:true,expectedRevision:3});expect(find(render(),"button","取消通知")!.disabled).toBe(false);
});
it("unconfigured channel still permits withdrawal of an existing consent",async()=>{
 fetchMock.mockResolvedValue(Response.json({...snapshot(5,true,true),capabilities:{availableChannels:[],pushPublicKey:null}}));await load();expect(find(render(),"button","取消通知")!.disabled).toBe(false);
 fetchMock.mockReset().mockResolvedValueOnce(Response.json({status:"saved",preference:pref(6,true,false)})).mockResolvedValueOnce(Response.json({...snapshot(6,true,false),capabilities:{availableChannels:[],pushPublicKey:null}}));click("取消通知");await idle();expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({channel:"email",enabled:false,expectedRevision:5});expect(find(render(),"button","開啟通知")!.disabled).toBe(true);
});
it("network uncertainty is not replayed and duplicate clicks admit one mutation",async()=>{
 await load();change("input","synthetic@invalid.example");let reject:(error:Error)=>void=()=>{};fetchMock.mockReset().mockImplementation(()=>new Promise((_resolve,no)=>{reject=no;}));click("寄送驗證碼");click("寄送驗證碼");expect(fetchMock).toHaveBeenCalledTimes(1);reject(new Error("private-network"));await idle();expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("explicit CSRF refusal renews once then resends the identical mutation",async()=>{
 await load();change("input","synthetic@invalid.example");fetchMock.mockReset().mockResolvedValueOnce(Response.json({error:"forbidden"},{status:403})).mockResolvedValueOnce(Response.json({...snapshot(),csrfToken:"renewed-synthetic"})).mockResolvedValueOnce(Response.json({status:"challenge_queued",challenge:{id:"challenge-1",expiresAt:"2026-10-07T00:15:00.000Z"}},{status:202})).mockResolvedValueOnce(Response.json(snapshot(2)));
 click("寄送驗證碼");await idle();expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[2][1].body);expect(fetchMock.mock.calls[2][1].headers["x-csrf-token"]).toBe("renewed-synthetic");
});
it("malformed snapshot cannot enable consent or preserve an injected contact",async()=>{fetchMock.mockResolvedValue(Response.json({...snapshot(),preferences:[{...pref(),enabled:"true"}]}));click("載入通知設定");await vi.waitFor(()=>expect(find(render(),"button","載入通知設定")!.disabled).toBe(false));expect(find(render(),"button","開啟通知")).toBeUndefined();});

it.each(["sms","whatsapp"])("%s enrollment keeps E164 contact in bounded POST body only",async channel=>{
 fetchMock.mockResolvedValue(Response.json({...snapshot(),preferences:[],capabilities:{availableChannels:[channel],pushPublicKey:null}}));await load();change("select",channel);change("input","+886912345678");
 fetchMock.mockReset().mockResolvedValueOnce(Response.json({status:"challenge_queued",challenge:{id:"challenge-1",expiresAt:"2026-10-07T00:15:00.000Z"}},{status:202})).mockResolvedValueOnce(Response.json({...snapshot(),preferences:[],capabilities:{availableChannels:[channel],pushPublicKey:null}}));click("寄送驗證碼");await idle();expect(fetchMock.mock.calls[0][0]).toBe("/portal/academy/learn/course-1/notifications/enroll");expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({channel,destination:{phone:"+886912345678"},expectedRevision:0});
});
it("push with no existing service worker requests no permission or server mutation",async()=>{
 fetchMock.mockResolvedValue(Response.json({...snapshot(),preferences:[],capabilities:{availableChannels:["push"],pushPublicKey:"a".repeat(87)}}));await load();change("select","push");fetchMock.mockClear();const permission=vi.fn();const registration=vi.fn().mockResolvedValue(undefined);vi.stubGlobal("navigator",{serviceWorker:{getRegistration:registration}});vi.stubGlobal("window",{PushManager:{},Notification:{}});vi.stubGlobal("Notification",{requestPermission:permission});click("驗證這台裝置");await idle();expect(registration).toHaveBeenCalledTimes(1);expect(permission).not.toHaveBeenCalled();expect(fetchMock).not.toHaveBeenCalled();
});
it("native push subscription is enrolled only after explicit permission",async()=>{
 const state={...snapshot(),preferences:[],capabilities:{availableChannels:["push"],pushPublicKey:"a".repeat(87)}};fetchMock.mockResolvedValue(Response.json(state));await load();change("select","push");
 const destination={endpoint:"https://fcm.googleapis.com/fcm/send/synthetic",expirationTime:null,keys:{p256dh:"a".repeat(87),auth:"b".repeat(22)}};const subscribe=vi.fn();const permission=vi.fn().mockResolvedValue("granted");vi.stubGlobal("navigator",{serviceWorker:{getRegistration:vi.fn().mockResolvedValue({pushManager:{getSubscription:vi.fn().mockResolvedValue({toJSON:()=>destination}),subscribe}})}});vi.stubGlobal("window",{PushManager:{},Notification:{}});vi.stubGlobal("Notification",{requestPermission:permission});
 fetchMock.mockReset().mockResolvedValueOnce(Response.json({status:"challenge_queued",challenge:{id:"challenge-1",expiresAt:"2026-10-07T00:15:00.000Z"}},{status:202})).mockResolvedValueOnce(Response.json(state));click("驗證這台裝置");await idle();expect(permission).toHaveBeenCalledTimes(1);expect(subscribe).not.toHaveBeenCalled();expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({channel:"push",destination,expectedRevision:0});
});

it("English withdrawal keeps the exact consent revision and HTTP identity",async()=>{
 fetchMock.mockResolvedValueOnce(Response.json(snapshot(7,true,true)));
 const loadButton=find(render("en"),"button","Load notification settings");
 expect(loadButton?.disabled).toBe(false);
 (loadButton!.onClick as ()=>void)();
 await vi.waitFor(()=>expect(find(render("en"),"button","Reload settings")?.disabled).toBe(false));
 expect(find(render("en"),"h2","Course notifications")).toBeDefined();
 fetchMock.mockReset().mockResolvedValueOnce(Response.json({status:"saved",preference:pref(8,true,false)})).mockResolvedValueOnce(Response.json(snapshot(8,true,false)));
 (find(render("en"),"button","Cancel notifications")!.onClick as ()=>void)();
 await vi.waitFor(()=>expect(find(render("en"),"button","Reload settings")?.disabled).toBe(false));
 expect(fetchMock.mock.calls[0][0]).toBe("/portal/academy/learn/course-1/notifications");
 expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({channel:"email",enabled:false,expectedRevision:7});
 expect(fetchMock.mock.calls[0][1].headers["x-csrf-token"]).toBe("synthetic-csrf");
 expect(find(render("en"),"p","Notifications cancelled for this course.")).toBeDefined();
});
