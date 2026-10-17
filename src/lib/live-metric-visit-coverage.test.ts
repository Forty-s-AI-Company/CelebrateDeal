import {beforeEach,expect,it,vi} from 'vitest';
import {publishVisitCoverage} from './live-metric-visit-coverage';
const dependencies=vi.hoisted(()=>({closed:vi.fn(),reconcile:vi.fn()}));
vi.mock('./live-metric-ingress-gateway',()=>({closedMetricIngressSource:dependencies.closed}));
vi.mock('./live-metric-visit-reconciliation',()=>({reconcileMetricVisitSources:dependencies.reconcile}));
const run={vendorId:'vendor',liveId:'live',versionId:'version',runId:'10000000-0000-4000-8000-000000000001'};
const receipt={format:1,runId:run.runId,manifestHash:'a'.repeat(64),gatewayId:'20000000-0000-4000-8000-000000000001',frameDigest:'b'.repeat(64),closedAt:'2026-10-15T00:00:00.000Z',settlementFailures:0,admissionFailures:0,pendingFrames:0};
const frontier={startAt:new Date(1000),endAt:new Date(3000),sourceRevision:BigInt(1)};
function database(ready=true,revision=BigInt(1)){
 const read={$queryRaw:vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([frontier]).mockResolvedValueOnce([{ready}])};
 const write={$queryRaw:vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{sourceRevision:revision}]).mockResolvedValueOnce([{id:run.runId}]).mockResolvedValueOnce([])};
 const db={$transaction:vi.fn().mockImplementationOnce(callback=>callback(read)).mockImplementationOnce(callback=>callback(write))};
 return{db,read,write};
}
beforeEach(()=>{vi.resetAllMocks();dependencies.closed.mockReturnValue({run,receipt});dependencies.reconcile.mockResolvedValue({status:'available',sourceDigest:'c'.repeat(64),coverage:{status:'unavailable',reason:'unknown_history'}});});
it('does not query persistence or accept arbitrary caller metadata without a real gateway receipt',async()=>{
 dependencies.closed.mockReturnValue(null);const {db}=database();
 expect(await publishVisitCoverage(db as never,{receipt})).toEqual({status:'unavailable'});expect(db.$transaction).not.toHaveBeenCalled();
});
it.each(['missing_source','limit','known_gap'])('does not publish after %s',async reason=>{
 const {db,write}=database(reason!=='missing_source');
 if(reason==='limit')dependencies.reconcile.mockResolvedValue({status:'unavailable',reason:'limit_exceeded'});
 if(reason==='known_gap')dependencies.reconcile.mockResolvedValue({status:'available',sourceDigest:'c'.repeat(64),coverage:{status:'unavailable',reason:'evidence_gap'}});
 expect(await publishVisitCoverage(db as never,{})).toEqual({status:'incomplete'});expect(write.$queryRaw).not.toHaveBeenCalled();
});
it('uses the same read transaction, rechecks revision and publishes only internally computed proof',async()=>{
 const {db,read,write}=database();expect(await publishVisitCoverage(db as never,{})).toMatchObject({status:'recorded'});
 expect(dependencies.reconcile).toHaveBeenCalledWith(read,{vendorId:run.vendorId,liveId:run.liveId,versionId:run.versionId,startAt:frontier.startAt,endAt:frontier.endAt});
 expect(write.$queryRaw).toHaveBeenCalledTimes(4);
 const query=write.$queryRaw.mock.calls[3][0];expect(query.values).toContain('c'.repeat(64));expect(query.values).toContain(JSON.stringify(receipt));
});
it('never publishes a proof when version revision changed between audit and write',async()=>{
 const {db,write}=database(true,BigInt(2));expect(await publishVisitCoverage(db as never,{})).toEqual({status:'source_changed'});
 expect(write.$queryRaw).toHaveBeenCalledTimes(2);
});
it('propagates independent DB guard failure without pretending publication succeeded',async()=>{
 const {db,write}=database();write.$queryRaw.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{sourceRevision:BigInt(1)}]).mockResolvedValueOnce([{id:run.runId}]).mockRejectedValueOnce(new Error('Synthetic guard rejection'));
 await expect(publishVisitCoverage(db as never,{})).rejects.toThrow('Synthetic guard rejection');
});
