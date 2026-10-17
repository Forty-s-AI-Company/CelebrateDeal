import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { startMetricIngressGateway } from './live-metric-ingress-gateway';
const ports=vi.hoisted(()=>({admit:vi.fn(),settle:vi.fn(),stop:vi.fn()}));
vi.mock('./live-metric-ingress',async original=>({...await original<typeof import('./live-metric-ingress')>(),admitMetricIngress:ports.admit,settleMetricIngress:ports.settle,stopMetricIngressRun:ports.stop}));
const run={vendorId:'vendor',liveId:'live',versionId:'version',runId:'10000000-0000-4000-8000-000000000001'};
const routes=[{path:'/synthetic',method:'GET' as const,kind:'form' as const}];
const activeServers:ReturnType<typeof createServer>[]=[];
function database(){const tx={$queryRaw:vi.fn(async query=>String(query.strings.join('')).includes('count(*)')?[{count:0}]:[{id:run.runId}])};return{$transaction:vi.fn(async callback=>callback(tx))};}
beforeEach(()=>{vi.clearAllMocks();ports.admit.mockResolvedValue({...run,frameId:'10000000-0000-4000-8000-000000000002'});ports.settle.mockResolvedValue({settledAt:new Date()});ports.stop.mockResolvedValue({stoppedAt:new Date()});});
afterEach(async()=>{for(const server of activeServers.splice(0))await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});});
it.each([0,999,120001,Infinity,1.5])('rejects an unbounded or invalid upstream budget before touching the database: %s',async upstreamTimeoutMs=>{
 const db=database();await expect(startMetricIngressGateway(db as never,run,3000,routes,undefined,{upstreamTimeoutMs})).rejects.toThrow();expect(db.$transaction).not.toHaveBeenCalled();
});
it('keeps the default budget and permits an explicit bounded development budget',async()=>{
 for(const options of [undefined,{upstreamTimeoutMs:120000}]){
  const gateway=await startMetricIngressGateway(database() as never,run,3000,routes,undefined,options);
  try{expect(gateway.diagnostics()).toEqual({upstreamTimeoutMs:options?.upstreamTimeoutMs??15000,socketTimeouts:0,errors:{}});}
  finally{await gateway.close();}
 }
});
it('reports a real socket timeout as a bounded diagnostic and settles the 502 response',async()=>{
 const upstream=createServer(()=>undefined);activeServers.push(upstream);
 await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));const address=upstream.address();if(!address||typeof address==='string')throw new Error('Missing owned port');
 const gateway=await startMetricIngressGateway(database() as never,run,address.port,routes,undefined,{upstreamTimeoutMs:1000});
 try{
  const response=await fetch(gateway.origin+'/synthetic');expect(response.status).toBe(502);await response.arrayBuffer();
  expect(gateway.diagnostics().socketTimeouts).toBe(1);
  expect(Object.keys(gateway.diagnostics().errors).every(value=>['ECONNRESET','ECONNREFUSED','ETIMEDOUT','HPE_INVALID_HEADER_TOKEN','HPE_UNEXPECTED_CONTENT_LENGTH','OTHER'].includes(value))).toBe(true);
 }finally{await gateway.close();}
 expect(ports.settle).toHaveBeenCalledWith(expect.anything(),expect.objectContaining(run),{outcome:'responded',httpStatus:502});
},15000);

// The browser-facing metric gateway never accepts another proxy's proof.
it('strips client-supplied trusted-edge proof and IP before its owned upstream',async()=>{
 let observed:Record<string,unknown>={};
 const upstream=createServer((request,response)=>{observed={...request.headers};response.writeHead(200);response.end('synthetic');});activeServers.push(upstream);
 await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));const address=upstream.address();if(!address||typeof address==='string')throw new Error('Missing owned port');
 const gateway=await startMetricIngressGateway(database() as never,run,address.port,routes);
 try{
  const response=await fetch(gateway.origin+'/synthetic',{headers:{'cf-connecting-ip':'192.0.2.99','true-client-ip':'192.0.2.99','x-vercel-forwarded-for':'192.0.2.99','x-celebratedeal-live-chat-ingress':'synthetic-fake-proof','x-forwarded-for':'192.0.2.99','x-real-ip':'192.0.2.99'}});
  expect(response.status).toBe(200);await response.arrayBuffer();
  for(const name of ['cf-connecting-ip','true-client-ip','x-vercel-forwarded-for','x-celebratedeal-live-chat-ingress','x-forwarded-for','x-real-ip'])expect(observed[name]).toBeUndefined();
 }finally{await gateway.close();}
});

it('only the real attested, successfully closed gateway mints an isolated source receipt',async()=>{
 const {closedMetricIngressSource}=await import('./live-metric-ingress-gateway');
 const {createMetricIngressAttestor}=await import('./live-metric-ingress-proof');
 const attestor=createMetricIngressAttestor(run,Buffer.alloc(32,17));
 const tx={$queryRaw:vi.fn(async query=>String(query.strings.join('')).includes('count(*)')
  ?[{count:0,frameDigest:'a'.repeat(64),closedAt:new Date(5000)}]:[{id:run.runId}])};
 const gateway=await startMetricIngressGateway({$transaction:vi.fn(async callback=>callback(tx))} as never,run,3000,routes,attestor);
 expect(closedMetricIngressSource(gateway)).toBeNull();
 expect(closedMetricIngressSource({...gateway})).toBeNull();
 await gateway.close();
 const receipt=closedMetricIngressSource(gateway);
 expect(receipt).toMatchObject({run,receipt:{format:1,runId:run.runId,frameDigest:'a'.repeat(64),pendingFrames:0,admissionFailures:0,settlementFailures:0}});
 if(!receipt)throw new Error('Missing synthetic receipt');
 receipt.run.vendorId='altered';receipt.receipt.frameDigest='altered';
 expect(closedMetricIngressSource(gateway)).toMatchObject({run,receipt:{frameDigest:'a'.repeat(64)}});
});
it('an admission failure cannot mint a usable source receipt even after pending frames drain',async()=>{
 const {closedMetricIngressSource}=await import('./live-metric-ingress-gateway');
 const {createMetricIngressAttestor}=await import('./live-metric-ingress-proof');
 const tx={$queryRaw:vi.fn(async query=>String(query.strings.join('')).includes('count(*)')
  ?[{count:0,frameDigest:'a'.repeat(64),closedAt:new Date(5000)}]:[{id:run.runId}])};
 const gateway=await startMetricIngressGateway({$transaction:vi.fn(async callback=>callback(tx))} as never,run,3000,routes,createMetricIngressAttestor(run,Buffer.alloc(32,17)));
 ports.admit.mockRejectedValueOnce(new Error('Synthetic admission refusal'));
 const response=await fetch(gateway.origin+'/synthetic');expect(response.status).toBe(503);await response.arrayBuffer();
 expect(await gateway.close()).toMatchObject({admissionFailures:1,pendingFrames:0});
 expect(closedMetricIngressSource(gateway)).toBeNull();
});

it.each(['stop','pending','no_attestor','digest','clock'])('a %s closure failure never creates a usable source receipt',async failure=>{
 const {closedMetricIngressSource}=await import('./live-metric-ingress-gateway');
 const {createMetricIngressAttestor}=await import('./live-metric-ingress-proof');
 const tx={$queryRaw:vi.fn(async query=>String(query.strings.join('')).includes('count(*)')
  ?[{count:failure==='pending'?1:0,frameDigest:failure==='digest'?'invalid':'a'.repeat(64),closedAt:failure==='clock'?new Date(NaN):new Date(5000)}]:[{id:run.runId}])};
 const attestor=failure==='no_attestor'?undefined:createMetricIngressAttestor(run,Buffer.alloc(32,17));
 const gateway=await startMetricIngressGateway({$transaction:vi.fn(async callback=>callback(tx))} as never,run,3000,routes,attestor);
 if(failure==='stop')ports.stop.mockRejectedValueOnce(new Error('Synthetic stop failure'));
 if(failure==='stop')await expect(gateway.close()).rejects.toThrow('database stop failed');else await gateway.close();
 expect(closedMetricIngressSource(gateway)).toBeNull();
});
it('a source receipt is unavailable when a terminal frame settlement fails',async()=>{
 const {closedMetricIngressSource}=await import('./live-metric-ingress-gateway');
 const {createMetricIngressAttestor}=await import('./live-metric-ingress-proof');
 const upstream=createServer((_request,response)=>{response.writeHead(200);response.end('synthetic');});activeServers.push(upstream);
 await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));const address=upstream.address();if(!address||typeof address==='string')throw new Error('Missing owned port');
 const tx={$queryRaw:vi.fn(async query=>String(query.strings.join('')).includes('count(*)')?[{count:0,frameDigest:'a'.repeat(64),closedAt:new Date(5000)}]:[{id:run.runId}])};
 const gateway=await startMetricIngressGateway({$transaction:vi.fn(async callback=>callback(tx))} as never,run,address.port,routes,createMetricIngressAttestor(run,Buffer.alloc(32,17)));
 ports.settle.mockRejectedValueOnce(new Error('Synthetic settlement failure'));
 const response=await fetch(gateway.origin+'/synthetic');await response.arrayBuffer();
 expect(await gateway.close()).toMatchObject({settlementFailures:1});expect(closedMetricIngressSource(gateway)).toBeNull();
});
