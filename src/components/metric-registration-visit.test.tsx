import {MetricVisitorError} from '@/lib/live-metric-visitor';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {withMetricRegistrationVisit} from './metric-registration-visit';
import {LiveMetricVisit} from './live-metric-visit';
import {createMetricIngressAttestor,METRIC_INGRESS_HEADER} from '@/lib/live-metric-ingress-proof';
const mocks=vi.hoisted(()=>({issue:vi.fn(),db:{synthetic:true},getDb:vi.fn(),connection:vi.fn(),headers:vi.fn()}));
vi.mock('next/headers',()=>({headers:mocks.headers}));
vi.mock('@/lib/db',()=>({getDb:mocks.getDb}));
vi.mock('next/server',()=>({connection:mocks.connection}));
vi.mock('@/lib/live-metric-registration-page',async original=>({...await original<typeof import('@/lib/live-metric-registration-page')>(),issueMetricRegistrationPage:mocks.issue}));
beforeEach(()=>{vi.clearAllMocks();mocks.getDb.mockReturnValue(mocks.db);vi.stubEnv('LIVE_METRIC_VISITOR_KEYRING','synthetic-enabled');vi.stubEnv('LIVE_METRIC_INGRESS_PROFILE','');});
afterEach(()=>vi.unstubAllEnvs());
it('waits for committed server page before exposing its identifiers and preserves the original form',async()=>{
 const child=<form action='/synthetic'/>;let release!:(value:unknown)=>void;
 mocks.issue.mockImplementationOnce(()=>new Promise(done=>{release=done;}));let returned=false;
 const pending=withMetricRegistrationVisit(child,{formId:'form',liveId:'live'}).then(value=>{returned=true;return value;});
 expect(returned).toBe(false);await vi.waitFor(()=>expect(mocks.issue).toHaveBeenCalledWith(mocks.db,{formId:'form',liveId:'live'}));
 expect(mocks.connection.mock.invocationCallOrder[0]).toBeLessThan(mocks.getDb.mock.invocationCallOrder[0]);
 release({vendorId:'vendor',liveId:'live',eventId:'server-event',versionId:'version'});
 const result=await pending;
 expect(result).not.toBe(child);
 if(result&&typeof result==='object'&&'props' in result){
  const children=(result.props as {children:unknown[]}).children;
  expect(children[1]).toBe(child);
  expect(children[0]).toMatchObject({type:LiveMetricVisit,props:{vendorId:'vendor',liveId:'live',eventId:'server-event'}});
 }else throw new Error('Expected collector composition');
});
it('skips ambiguous/unbound or disabled configuration without querying DB',async()=>{
 const child=<form/>;
 for(const scope of [{formId:'form'},{liveId:'live'},{formId:'x'.repeat(129),liveId:'live'},{formId:'form',liveId:'bad/identifier'}]){
  const result=await withMetricRegistrationVisit(child,scope);expect(result.props.children).toEqual([null,child]);
 }
 vi.stubEnv('LIVE_METRIC_VISITOR_KEYRING','');expect((await withMetricRegistrationVisit(child,{formId:'form',liveId:'live'})).props.children).toEqual([null,child]);
 expect(mocks.issue).not.toHaveBeenCalled();expect(mocks.getDb).not.toHaveBeenCalled();expect(mocks.connection).not.toHaveBeenCalled();
});
it('retains the child when collection unavailable and propagates persistence failure',async()=>{
 const child=<form/>;mocks.issue.mockResolvedValueOnce(null);
 expect((await withMetricRegistrationVisit(child,{formId:'form',liveId:'live'})).props.children).toEqual([null,child]);
 mocks.issue.mockRejectedValueOnce(new Error('synthetic persistence failure'));
 await expect(withMetricRegistrationVisit(child,{formId:'form',liveId:'live'})).rejects.toThrow('synthetic persistence failure');
});
it('passes verified per-request binding to the real registration issuance boundary',async()=>{
 const run={vendorId:'vendor',liveId:'live',versionId:'version',runId:'10000000-0000-4000-8000-000000000001'},key=new Uint8Array(32).fill(8);
 const entry={kind:'form' as const,target:'/form/synthetic'},frameId='10000000-0000-4000-8000-000000000002';
 const service=createMetricIngressAttestor(run,key);
 vi.stubEnv('LIVE_METRIC_INGRESS_PROFILE',JSON.stringify({...run,key:Buffer.from(key).toString('base64url')}));
 mocks.headers.mockResolvedValue(new Headers({[METRIC_INGRESS_HEADER]:service.issue(frameId,{...entry,method:'GET'})}));
 mocks.issue.mockResolvedValue(null);
 await withMetricRegistrationVisit(<form/>,{formId:'form',liveId:'live'},entry);
 expect(mocks.issue).toHaveBeenCalledWith(mocks.db,{formId:'form',liveId:'live'},expect.objectContaining({...run,frameId,kind:'form'}));
 mocks.headers.mockResolvedValue(new Headers());mocks.issue.mockClear();
 await expect(withMetricRegistrationVisit(<form/>,{formId:'form',liveId:'live'},entry)).rejects.toThrow('binding unavailable');
 expect(mocks.issue).not.toHaveBeenCalled();
});

it('retains the original form without a collector after typed metric persistence failure',async()=>{
 const child=<form action='/api/form-submissions'><input name='email'/></form>;
 mocks.issue.mockRejectedValueOnce(new MetricVisitorError('PERSISTENCE_UNAVAILABLE'));
 const result=await withMetricRegistrationVisit(child,{formId:'form',liveId:'live'});
 expect(result.props.children).toEqual([null,child]);
});
