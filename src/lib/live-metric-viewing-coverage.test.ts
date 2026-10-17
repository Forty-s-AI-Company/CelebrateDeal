import {beforeEach,expect,it,vi} from 'vitest';
import {Prisma} from '@prisma/client';
import {publishViewingCoverage} from './live-metric-viewing-coverage';
const ports=vi.hoisted(()=>({closed:vi.fn(),audit:vi.fn()}));
vi.mock('./live-metric-ingress-gateway',()=>({closedMetricIngressSource:ports.closed}));
vi.mock('./live-metric-viewing-source-audit',()=>({auditMetricViewingSources:ports.audit}));
const run={vendorId:'vendor',liveId:'live',versionId:'version',runId:'10000000-0000-4000-8000-000000000001'};
const receipt={format:1,runId:run.runId,manifestHash:'a'.repeat(64),gatewayId:'20000000-0000-4000-8000-000000000001',frameDigest:'b'.repeat(64),closedAt:'2026-10-15T00:00:00.000Z',settlementFailures:0,admissionFailures:0,pendingFrames:0};
const scope={vendorId:run.vendorId,liveId:run.liveId,versionId:run.versionId,startAt:new Date(1000),endAt:new Date(3000)};
const result=()=>({status:'enumerated',sourceRevision:BigInt(1),registrationRevision:BigInt(2),viewingRevision:BigInt(3),digest:'c'.repeat(64),sessionCount:1,
 outcomes:{closed_contiguous:1,open_session:0},intake:{history:'intake_enabled',quotaLosses:0,revision:BigInt(4),count:1,outcomes:{closed_session:1,pending_session:0}},
 issuance:{history:'ledger_enabled',issuedCount:BigInt(1),removedCount:BigInt(0)}});
function database(ready=true,revision=BigInt(1)){
 const read={$queryRaw:vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{startAt:scope.startAt,endAt:scope.endAt}])};
 const write={$queryRaw:vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{sourceRevision:revision}]).mockResolvedValueOnce([{id:run.runId}]).mockResolvedValueOnce([{viewing:ready?BigInt(3):BigInt(99),intake:BigInt(4),registration:BigInt(2)}]).mockResolvedValueOnce([{id:"stored"}])};
 const db={$transaction:vi.fn().mockImplementationOnce(callback=>callback(read)).mockImplementationOnce(callback=>callback(write))};return{db,read,write};
}
beforeEach(()=>{vi.resetAllMocks();ports.closed.mockReturnValue({run,receipt});ports.audit.mockResolvedValue(result());});
it('rejects caller-built metadata without touching persistence',async()=>{
 ports.closed.mockReturnValue(null);const{db}=database();expect(await publishViewingCoverage(db as never,{run,receipt})).toEqual({status:'unavailable'});expect(db.$transaction).not.toHaveBeenCalled();
});
it.each(['open','loss','history','missing_intake','removed','issued_count','unknown_outcome'])('never publishes incomplete %s sources',async kind=>{
 const audit=result();
 if(kind==='open')audit.outcomes.open_session=1;
 if(kind==='loss')audit.intake.quotaLosses=1;
 if(kind==='history')audit.issuance.history='unknown';
 if(kind==='missing_intake')audit.intake.outcomes.pending_session=1;
 if(kind==='removed')audit.issuance.removedCount=BigInt(1);
 if(kind==='issued_count')audit.issuance.issuedCount=BigInt(2);
 if(kind==='unknown_outcome')Object.assign(audit.outcomes,{future_unknown_category:1});
 ports.audit.mockResolvedValue(audit);const{db,write}=database();expect(await publishViewingCoverage(db as never,{})).toEqual({status:'incomplete'});expect(write.$queryRaw).not.toHaveBeenCalled();
});
it('does not turn a partial audit or an absent seal into a proof',async()=>{
 const first=database();ports.audit.mockResolvedValue({status:'unavailable',reason:'limit_exceeded'});expect(await publishViewingCoverage(first.db as never,{})).toEqual({status:'incomplete'});
 const second=database();second.read.$queryRaw.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([]);expect(await publishViewingCoverage(second.db as never,{})).toEqual({status:'incomplete'});
});
it.each(['revision','eligibility'])('rejects a changed %s in the write transaction',async kind=>{
 const{db,write}=database(kind!=='eligibility',kind==='revision'?BigInt(99):BigInt(1));
 expect(await publishViewingCoverage(db as never,{})).toEqual({status:'source_changed'});expect(write.$queryRaw).toHaveBeenCalledTimes(kind==='revision'?2:4);
});
it('publishes the internally audited revision tuple only after current SQL eligibility',async()=>{
 const{db,write}=database();expect(await publishViewingCoverage(db as never,{})).toMatchObject({status:'recorded'});expect(ports.audit).toHaveBeenCalledWith(db,scope);
 const values=write.$queryRaw.mock.calls[4][0].values;expect(values).toContain(BigInt(3));expect(values).toContain(BigInt(4));expect(values).toContain(BigInt(2));expect(values).toContain('c'.repeat(64));expect(values).toContain(JSON.stringify(receipt));
});
it('propagates an independent guard failure rather than reporting a positive write',async()=>{
 const{db,write}=database();write.$queryRaw.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{sourceRevision:BigInt(1)}]).mockResolvedValueOnce([{id:run.runId}]).mockResolvedValueOnce([{viewing:BigInt(3),intake:BigInt(4),registration:BigInt(2)}]).mockRejectedValueOnce(new Error('Synthetic guard rejection'));
 await expect(publishViewingCoverage(db as never,{})).rejects.toThrow('Synthetic guard rejection');
});

it.each([true,false])('checks existing stored metadata after a proof-ID conflict: match=%s',async matches=>{
 const{db,write}=database();write.$queryRaw.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{sourceRevision:BigInt(1)}])
  .mockResolvedValueOnce([{id:run.runId}]).mockResolvedValueOnce([{viewing:BigInt(3),intake:BigInt(4),registration:BigInt(2)}])
  .mockResolvedValueOnce([]).mockResolvedValueOnce([{matches}]);
 expect(await publishViewingCoverage(db as never,{})).toMatchObject({status:matches?'recorded':'conflict'});
});
it.each(['metric coverage requires trusted source proof','registration coverage source mismatch'])('maps only the recognized %s guard race to source_changed',async message=>{
 const{db,write}=database();write.$queryRaw.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{sourceRevision:BigInt(1)}])
  .mockResolvedValueOnce([{id:run.runId}]).mockResolvedValueOnce([{viewing:BigInt(3),intake:BigInt(4),registration:BigInt(2)}])
  .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Synthetic',{code:'P2010',clientVersion:'synthetic',meta:{code:'23514',message}}));
 expect(await publishViewingCoverage(db as never,{})).toEqual({status:'source_changed'});
});
