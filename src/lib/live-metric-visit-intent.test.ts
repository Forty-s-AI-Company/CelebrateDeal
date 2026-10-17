import {expect,it,vi} from 'vitest';
import {prepareMetricVisitIntent,requireMetricVisitIntent} from './live-metric-visit-intent';
const input={vendorId:'v',liveId:'l',versionId:'version',visitorId:'visitor',eventId:'10000000-0000-4000-8000-000000000001'};
function transaction(){return {$queryRaw:vi.fn().mockResolvedValue([{eventId:input.eventId}]),$executeRaw:vi.fn().mockResolvedValue(1)};}
it('rejects client timestamps and extra scope properties before issuing SQL',async()=>{
 const tx=transaction();await expect(prepareMetricVisitIntent(tx as never,{...input,preparedAt:1000} as never)).rejects.toThrow();
 expect(tx.$queryRaw).not.toHaveBeenCalled();expect(tx.$executeRaw).not.toHaveBeenCalled();
});
it('does not return preparation if persistence fails or a conflicting identity owns the event',async()=>{
 const tx=transaction();tx.$executeRaw.mockRejectedValueOnce(new Error('synthetic write failure'));
 await expect(prepareMetricVisitIntent(tx as never,input)).rejects.toThrow('synthetic write failure');
 const other=transaction();other.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
 await expect(prepareMetricVisitIntent(other as never,input)).rejects.toThrow('preparation unavailable');
});
it('rejects missing and duplicate visible intent rows',async()=>{
 for(const rows of [[],[{eventId:input.eventId},{eventId:input.eventId}]]){
  const tx=transaction();tx.$queryRaw.mockResolvedValue(rows);
  await expect(requireMetricVisitIntent(tx as never,input)).rejects.toThrow('preparation unavailable');
 }
});
it('accepts exactly one bound expectation without writing a visit or changing its timestamp',async()=>{
 const tx=transaction();await requireMetricVisitIntent(tx as never,input);expect(tx.$executeRaw).not.toHaveBeenCalled();
});
