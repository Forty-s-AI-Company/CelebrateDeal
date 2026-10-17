import { expect, it, vi } from "vitest";
import { createPlaybackMetricController } from "./live-metric-playback-controller";
const nonce=(n:number)=>`de305d54-75b4-431b-adb2-${String(n).padStart(12,'0')}`;
const source=(n=1)=>({playbackUrl:'https://example.test/video.mp4',metricRequestId:nonce(n),metricIssuedAtMs:1000,metricExpiresAtMs:1000000});
function fixture(){
  const state={time:0,authorized:true,sourceCalls:0,probes:0,fresh:()=>source(2)};
  const opens:string[]=[];
  const media=Object.assign(new EventTarget(),{currentTime:0,playbackRate:1,paused:false,ended:false,seeking:false,readyState:4,
    src:'https://example.test/video.mp4',play:vi.fn(),pause:vi.fn()});
  const sessions=new Map<string,{sessionId:string;anchorAtMs:number;lastSequence:number;lastElapsedMs:number}>();
  const fetcher=vi.fn<typeof fetch>(async(input,init)=>{
    const path=String(input),reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
    if(path.startsWith('/api/live-playback-source?')){state.sourceCalls++;return reply(state.fresh());}
    if(init?.method==='GET'){state.probes++;return reply({ready:state.authorized},state.authorized?200:403);}
    const body=JSON.parse(init!.body as string);
    if(path.endsWith('/sessions')){
      opens.push(body.requestId);if(!state.authorized)return reply({},403);
      let receipt=sessions.get(body.requestId);
      if(!receipt){receipt={sessionId:'session_'+sessions.size,anchorAtMs:10000+state.time,lastSequence:-1,lastElapsedMs:0};sessions.set(body.requestId,receipt);}
      return reply({ok:true,...receipt,versionId:'version',serverNowAtMs:10000+state.time,expiresAtMs:1000000,durationMs:4000});
    }
    const session=[...sessions.values()].find(value=>value.sessionId===body.sessionId)!;
    if(path.endsWith('/intervals')){const last=body.segments.at(-1);session.lastSequence=last.sequence;session.lastElapsedMs=last.endElapsedMs;
      return reply({ok:true,lastSequence:last.sequence,accepted:body.segments.length,replayed:0});}
    return reply({ok:true,sessionId:session.sessionId,finalSequence:body.finalSequence,lastSequence:session.lastSequence,
      deliveryComplete:true,appendOpen:false,closedAtMs:10000+state.time});
  });
  const create=(value:unknown=source())=>createPlaybackMetricController({vendorId:'v',liveId:'l'},value,media,()=>state.time,fetcher);
  const replay=async(c:ReturnType<typeof create>)=>{media.ended=true;media.dispatchEvent(new Event('ended'));media.ended=false;media.currentTime=0;media.dispatchEvent(new Event('playing'));await c.tick();};
  return {state,media,fetcher,opens,sessions,create,replay};
}
it("replays with a new server nonce/session without mutating media or resuming old progress",async()=>{
  const f=fixture(),c=f.create();await c.tick();f.state.time=1000;f.media.currentTime=1;f.media.dispatchEvent(new Event('timeupdate'));
  await f.replay(c);f.state.time=2000;f.media.currentTime=1;f.media.dispatchEvent(new Event('timeupdate'));await c.finish();
  expect(f.opens).toEqual([nonce(1),nonce(2)]);expect(f.sessions.size).toBe(2);expect(f.state.sourceCalls).toBe(1);
  expect([...f.sessions.values()].map(row=>row.lastSequence)).toEqual([0,0]);
  expect(f.media.src).toBe(source().playbackUrl);expect(f.media.play).not.toHaveBeenCalled();expect(f.media.pause).not.toHaveBeenCalled();
});
it("throttles failed eligibility probes without allocating new intake for an unverified viewer",async()=>{
  const f=fixture();f.state.authorized=false;const c=f.create();await c.tick();
  for(let n=0;n<60;n++){f.state.time=n*1000;await c.tick();}
  expect(f.opens).toEqual([nonce(1)]);expect(f.state.probes).toBe(2);expect(f.state.sourceCalls).toBe(0);
  f.state.authorized=true;f.state.time=60000;await c.tick();
  expect(f.opens).toEqual([nonce(1),nonce(2)]);expect(c.state().collector?.disabled).toBe(false);await c.finish();
});
it("can start tracking after an initially untracked source becomes eligible",async()=>{
  const f=fixture(),c=f.create({playbackUrl:source().playbackUrl});await c.tick();
  expect(f.opens).toEqual([nonce(2)]);expect(f.state.probes).toBe(1);await c.finish();
});
it("retains denied-probe backoff across repeated ended/playing events",async()=>{
  const f=fixture();f.state.authorized=false;const c=f.create();await c.tick();
  for(let index=0;index<10;index++){f.state.time=index*1000;await f.replay(c);}
  expect(f.state.probes).toBe(1);expect(f.state.sourceCalls).toBe(0);
  f.state.time=30000;await f.replay(c);expect(f.state.probes).toBe(2);await c.finish();
});
it("allows successive legitimate replays after successful new issuance",async()=>{
  const f=fixture(),c=f.create();await c.tick();await f.replay(c);
  f.state.fresh=()=>source(3);await f.replay(c);
  expect(f.opens).toEqual([nonce(1),nonce(2),nonce(3)]);await c.finish();
});
it("retries a temporarily unavailable source after backoff without claiming a source change",async()=>{
  const f=fixture(),c=f.create();await c.tick();const original=f.fetcher.getMockImplementation()!;
  let refused=true;
  f.fetcher.mockImplementation(async(input,init)=>String(input).startsWith('/api/live-playback-source?')&&refused
    ?new Response(null,{status:503}):original(input,init));
  await f.replay(c);expect(c.state().sourceChanged).toBe(false);expect(f.state.probes).toBe(1);
  refused=false;f.state.time=29999;await c.tick();expect(f.opens).toEqual([nonce(1)]);
  f.state.time=30000;await c.tick();expect(f.opens).toEqual([nonce(1),nonce(2)]);
  expect(f.state.probes).toBe(2);await c.finish();
});
it("does not clear the backoff when a fresh session is refused",async()=>{
  const f=fixture(),c=f.create();await c.tick();const original=f.fetcher.getMockImplementation()!;
  let refused=true;
  f.fetcher.mockImplementation(async(input,init)=>String(input).endsWith('/sessions')&&init?.method==='POST'&&refused
    ?new Response(null,{status:403}):original(input,init));
  await f.replay(c);expect(c.state().collector?.disabled).toBe(true);
  f.state.fresh=()=>source(3);refused=false;f.state.time=29999;await c.tick();expect(f.state.probes).toBe(1);
  f.state.time=30000;await c.tick();expect(f.state.probes).toBe(2);
  expect(f.opens).toEqual([nonce(1),nonce(3)]);await c.finish();
});
it.each(['readiness','source'])("aborts an in-flight %s GET on disposal",async stage=>{
  const f=fixture(),c=f.create();await c.tick();
  const original=f.fetcher.getMockImplementation()!;let signal:AbortSignal|undefined;
  f.fetcher.mockImplementation(async(input,init)=>{
    const chosen=stage==='source'?String(input).startsWith('/api/live-playback-source?'):init?.method==='GET';
    if(!chosen)return original(input,init);
    signal=init?.signal as AbortSignal;
    return new Promise<Response>((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  });
  const replay=f.replay(c);await vi.waitFor(()=>expect(signal).toBeDefined());
  await c.finish();await replay;
  expect(signal?.aborted).toBe(true);expect(f.opens).toEqual([nonce(1)]);
  expect(c.state().stopped).toBe(true);
});
it("coalesces concurrent recovery and ignores a fresh source reply after disposal",async()=>{
  const f=fixture();f.state.authorized=false;const c=f.create();await c.tick();f.state.authorized=true;
  const original=f.fetcher.getMockImplementation()!;let resolve!:(value:Response)=>void;
  f.fetcher.mockImplementation(async(input,init)=>String(input).startsWith('/api/live-playback-source?')
    ?new Promise<Response>(done=>{resolve=done;}):original(input,init));
  const a=c.tick(),b=c.tick();
  await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));
  const closing=c.finish();resolve(new Response(JSON.stringify(source(2))));await Promise.all([a,b,closing]);
  expect(f.opens).toEqual([nonce(1)]);expect(f.state.probes).toBe(1);expect(c.state().stopped).toBe(true);
});
it("does not bind a fresh nonce to an element still playing a different URL",async()=>{
  const f=fixture();f.state.fresh=()=>({...source(2),playbackUrl:'https://example.test/other.mp4'});
  const c=f.create();await c.tick();await f.replay(c);
  expect(c.state().sourceChanged).toBe(true);expect(f.opens).toEqual([nonce(1)]);await c.finish();
});
it("never invents a nonce for quota-lost/untracked recovery",async()=>{
  const f=fixture();f.state.fresh=()=>({playbackUrl:source().playbackUrl}) as ReturnType<typeof source>;
  const c=f.create();await c.tick();await f.replay(c);f.state.time=60000;await c.tick();
  expect(c.state().sourceChanged).toBe(true);expect(f.opens).toEqual([nonce(1)]);expect(f.state.sourceCalls).toBe(1);await c.finish();
});
it("does not reopen an already used server nonce",async()=>{
  const f=fixture();f.state.fresh=()=>({...source(1),metricRequestId:nonce(1).toUpperCase()});const c=f.create();await c.tick();await f.replay(c);
  expect(f.opens).toEqual([nonce(1)]);expect(c.state().restart).toBe(true);await c.finish();
});
it("never attaches sampling when initial issuance resolves after disposal",async()=>{
  const f=fixture(),listen=vi.spyOn(f.media,'addEventListener'),original=f.fetcher.getMockImplementation()!;
  let release!:()=>void;const gate=new Promise<void>(done=>{release=done;});
  f.fetcher.mockImplementation(async(input,init)=>{
    const reply=await original(input,init);if(String(input).endsWith('/sessions')&&init?.method==='POST')await gate;return reply;
  });
  const c=f.create(),opening=c.tick(),closing=c.finish();release();await Promise.all([opening,closing]);
  expect(listen.mock.calls.map(call=>call[0])).toEqual(['ended','playing']);
  expect(c.state().collector?.delivery?.terminal).toBe(true);
});
it("leaves a persistent delivery gap rather than complete close on clock regression",async()=>{
  const f=fixture(),c=f.create();await c.tick();f.state.time=-1;await c.tick();await c.finish();
  expect(c.state().collector?.delivery).toMatchObject({collectionLost:true,terminal:false});
  expect(f.fetcher.mock.calls.filter(([url])=>String(url).endsWith('/close'))).toHaveLength(0);
});
