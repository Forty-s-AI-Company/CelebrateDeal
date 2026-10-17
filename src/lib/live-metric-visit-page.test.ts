import {beforeEach,expect,it,vi} from 'vitest';
import {issueMetricVisitPage,requireMetricVisitPage} from './live-metric-visit-page';
import {MetricVisitorError} from './live-metric-visitor';
import {Prisma} from '@prisma/client';
vi.mock('./live-metric-ingress-source',()=>({canBindMetricIngressSource:vi.fn().mockResolvedValue(true)}));
const mocks=vi.hoisted(()=>({context:vi.fn()}));
vi.mock('./live-metric-visit-context',()=>({resolveMetricVisitContext:mocks.context}));
const scope={vendorId:'v',liveId:'l'},context={...scope,versionId:'version',expiresAt:new Date(2000)};
function database(){const tx={$queryRaw:vi.fn().mockImplementation(async query=>query.strings.join('').includes('count(*)')?[{count:BigInt(0)}]:[{eventId:'synthetic',active:true}]),$executeRaw:vi.fn().mockResolvedValue(1)};
 return {tx,db:{$transaction:vi.fn(async callback=>callback(tx))}};}
beforeEach(()=>{vi.clearAllMocks();mocks.context.mockResolvedValue(context);});
it('returns a server nonce only after the outer transaction commits',async()=>{
 const {db,tx}=database();let release!:()=>void;const gate=new Promise<void>(done=>{release=done;});
 db.$transaction.mockImplementation(async callback=>{const result=await callback(tx);await gate;return result;});
 let returned=false;const pending=issueMetricVisitPage(db,scope).then(result=>{returned=true;return result;});
 await vi.waitFor(()=>expect(tx.$executeRaw).toHaveBeenCalledTimes(1));expect(returned).toBe(false);release();
 expect(await pending).toMatchObject({versionId:'version',eventId:expect.stringMatching(/^[a-f0-9-]{36}$/u)});
 expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function),{isolationLevel:'ReadCommitted',timeout:10000,maxWait:5000});
});
it('does not mint an expectation for unconfigured/unavailable public collection',async()=>{
 const {db,tx}=database();mocks.context.mockRejectedValueOnce(new MetricVisitorError('SCOPE_UNAVAILABLE'));
 expect(await issueMetricVisitPage(db,scope)).toBeNull();expect(tx.$executeRaw).not.toHaveBeenCalled();
});
it('does not release a nonce on insert or commit failure',async()=>{
 const first=database();first.tx.$executeRaw.mockRejectedValueOnce(new Error('synthetic database detail'));
 await expect(issueMetricVisitPage(first.db,scope)).rejects.toMatchObject({code:'PERSISTENCE_UNAVAILABLE'});
 const second=database();second.db.$transaction.mockImplementation(async callback=>{await callback(second.tx);throw new Error('synthetic commit');});
 await expect(issueMetricVisitPage(second.db,scope)).rejects.toMatchObject({code:'PERSISTENCE_UNAVAILABLE'});
});
it('rolls back when the version changes or the page lifetime expires before return',async()=>{
 mocks.context.mockResolvedValueOnce(context).mockResolvedValueOnce({...context,versionId:'changed'});
 await expect(issueMetricVisitPage(database().db,scope)).rejects.toMatchObject({code:'PERSISTENCE_UNAVAILABLE'});
 const {db,tx}=database();tx.$queryRaw.mockImplementation(async query=>query.strings.join('').includes('count(*)')?[{count:BigInt(0)}]:[{eventId:'synthetic',active:false}]);
 expect(await issueMetricVisitPage(db,scope)).toBeNull();
});
it('records the permanent quota gap and returns no nonce instead of adding or deleting page rows',async()=>{
 const {db,tx}=database();tx.$queryRaw.mockImplementation(async query=>query.strings.join('').includes('count(*)')?[{count:BigInt(10000)}]:[{eventId:'existing',active:true}]);
 expect(await issueMetricVisitPage(db,scope)).toBeNull();expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
 expect(tx.$executeRaw.mock.calls[0][0].strings.join('')).toContain('UPDATE "LiveMetricVisitPage"');
 expect(tx.$executeRaw.mock.calls[0][0].strings.join('')).toContain('"lossAt" IS NULL');
});
it('maps only the dedicated lifetime rejection to unavailable while unrelated database errors fail closed',async()=>{
 for(const code of ['P2090','23514']){
  const {db,tx}=database();tx.$executeRaw.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('synthetic private detail',{code:'P2010',clientVersion:'synthetic',meta:{code}}));
  if(code==='P2090')expect(await issueMetricVisitPage(db,scope)).toBeNull();
  else await expect(issueMetricVisitPage(db,scope)).rejects.toMatchObject({code:'PERSISTENCE_UNAVAILABLE'});
 }
});
it('rejects injected scope before opening a transaction',async()=>{
 const {db}=database();await expect(issueMetricVisitPage(db,{...scope,eventId:'client-selected'} as never)).rejects.toThrow();expect(db.$transaction).not.toHaveBeenCalled();
});
it('requires exactly one current version-bound page and never writes identity',async()=>{
 const {tx}=database();await requireMetricVisitPage(tx as never,{...scope,versionId:'version',eventId:'10000000-0000-4000-8000-000000000001'});
 expect(tx.$executeRaw).not.toHaveBeenCalled();tx.$queryRaw.mockResolvedValueOnce([]);
 await expect(requireMetricVisitPage(tx as never,{...scope,versionId:'version',eventId:'10000000-0000-4000-8000-000000000001'})).rejects.toMatchObject({name:'MetricVisitIntentError'});
});
it('rejects stale or cross-form binding before context resolution or page insertion',async()=>{
 const {db,tx}=database();tx.$queryRaw.mockImplementation(async query=>query.strings.join('').includes('JOIN "RegistrationForm"')?[]:[{eventId:'synthetic',active:true}]);
 expect(await issueMetricVisitPage(db,scope,{formId:'wrong-form'})).toBeNull();
 expect(mocks.context).not.toHaveBeenCalled();expect(tx.$executeRaw).not.toHaveBeenCalled();
});
