import { expect, it, vi } from 'vitest';
import { canBindMetricIngressSource } from './live-metric-ingress-source';
const current={vendorId:'vendor',liveId:'live',versionId:'version'};
const binding={...current,runId:'10000000-0000-4000-8000-000000000001',frameId:'10000000-0000-4000-8000-000000000002',kind:'playback' as const,method:'GET' as const,target:'/api/live-playback-source',format:1 as const};
it('returns no-source without a DB call for stale scope/version or wrong kind',async()=>{
 const tx={$queryRaw:vi.fn()};
 for(const value of [{...binding,versionId:'old'},{...binding,vendorId:'foreign'}])expect(await canBindMetricIngressSource(tx as never,value,current,'playback')).toBe(false);
 expect(await canBindMetricIngressSource(tx as never,binding,current,'registration')).toBe(false);expect(tx.$queryRaw).not.toHaveBeenCalled();
});
it('uses the authoritative DB predicate for missing bindings as well as valid ones',async()=>{
 const tx={$queryRaw:vi.fn().mockResolvedValue([{allowed:false}])};
 expect(await canBindMetricIngressSource(tx as never,undefined,current,'viewer')).toBe(false);
 tx.$queryRaw.mockResolvedValueOnce([{allowed:true}]);expect(await canBindMetricIngressSource(tx as never,undefined,current,'viewer')).toBe(true);
 tx.$queryRaw.mockResolvedValueOnce([{allowed:true}]);expect(await canBindMetricIngressSource(tx as never,binding,current,'playback')).toBe(true);
});
it('does not turn infrastructure or malformed DB results into a fake no-source success',async()=>{
 const tx={$queryRaw:vi.fn().mockResolvedValue([])};
 await expect(canBindMetricIngressSource(tx as never,undefined,current,'viewer')).rejects.toThrow('source check unavailable');
 tx.$queryRaw.mockRejectedValueOnce(new Error('synthetic database failure'));
 await expect(canBindMetricIngressSource(tx as never,binding,current,'playback')).rejects.toThrow('synthetic database failure');
});
