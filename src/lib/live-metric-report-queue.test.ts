import { expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { enqueueMetricReport } from "./live-metric-report-queue";
const input={vendorId:'v',liveId:'l',versionId:'ver',startAt:new Date(1000),endAt:new Date(2000)};
function fixture(existing:string|null=null,version=true){
  const tx={$queryRaw:vi.fn(async(query:Prisma.Sql)=>{
    const text=query.strings.join('');
    if(text.includes('FOR UPDATE OF v'))return version?[{sourceRevision:BigInt(7),expiresAt:new Date(3000)}]:[];
    if(text.includes('SELECT r.status'))return existing?[{status:existing}]:[];
    if(text.includes('wp20_metric_report_create'))return [{changed:1}];
    return [];
  })};
  const db={$transaction:vi.fn(async(work:(value:typeof tx)=>Promise<unknown>)=>work(tx))};return {db,tx};
}
it('creates only a scoped closed-window report with server UUID and DB-owned revision/expiry',async()=>{
  const {db,tx}=fixture();expect(await enqueueMetricReport(db as never,input)).toEqual({status:'available',created:true});
  const query=tx.$queryRaw.mock.calls.at(-1)![0];
  expect(query.values.slice(0,3)).toEqual(['v','l','ver']);expect(query.values[3]).toMatch(/^[a-f0-9-]{36}$/);
  expect(query.values.slice(-2)).toEqual([BigInt(7),new Date(3000)]);
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function),expect.objectContaining({isolationLevel:'ReadCommitted'}));
});
it.each(['queued','running','ready'])('reuses matching %s generation without resetting attempts',async status=>{
  const {db,tx}=fixture(status);expect(await enqueueMetricReport(db as never,input)).toEqual({status:'available',created:false});
  expect(tx.$queryRaw.mock.calls.some(([sql])=>sql.strings.join('').includes('wp20_metric_report_create'))).toBe(false);
});
it('does not issue a fresh retry budget for a failed current generation',async()=>{
  const {db}=fixture('failed');expect(await enqueueMetricReport(db as never,input)).toEqual({status:'unavailable',reason:'previous_failure'});
});
it('rejects unavailable scope/window without creating work',async()=>{
  const {db,tx}=fixture(null,false);expect(await enqueueMetricReport(db as never,input)).toEqual({status:'unavailable',reason:'scope_or_window_unavailable'});
  expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
});
it('freezes validated input before awaiting the version lock',async()=>{
  const {db,tx}=fixture();const mutable={...input};const original=tx.$queryRaw.getMockImplementation()!;
  tx.$queryRaw.mockImplementation(async query=>{mutable.vendorId='foreign';return original(query);});
  expect(await enqueueMetricReport(db as never,mutable)).toMatchObject({created:true});
  expect(tx.$queryRaw.mock.calls.at(-1)![0].values[0]).toBe('v');
});
it('fails closed on a failed insert and never returns SQL diagnostics',async()=>{
  const {db,tx}=fixture();tx.$queryRaw.mockRejectedValueOnce(new Error('private-sql'));
  expect(await enqueueMetricReport(db as never,input)).toEqual({status:'unavailable',reason:'enqueue_failed'});
});
it('keeps date bounds fixed if the host mutates its Date objects during a lock wait',async()=>{
  const {db,tx}=fixture();const mutable={...input,startAt:new Date(1000),endAt:new Date(2000)};
  const original=tx.$queryRaw.getMockImplementation()!;
  tx.$queryRaw.mockImplementation(async query=>{
    mutable.startAt.setTime(0);mutable.endAt.setTime(10000);return original(query);
  });
  expect(await enqueueMetricReport(db as never,mutable)).toMatchObject({created:true});
  expect(tx.$queryRaw.mock.calls.at(-1)![0].values.slice(4,6)).toEqual([new Date(1000),new Date(2000)]);
});
it('rejects malformed or unbounded input before DB access',async()=>{
  const {db}=fixture();for(const bad of [{...input,startAt:input.endAt},{...input,retentionSeconds:86401},{...input,vendorId:''}])
    await expect(enqueueMetricReport(db as never,bad)).rejects.toThrow();
  expect(db.$transaction).not.toHaveBeenCalled();
});
it.each([['P2010','23505','integrity_violation'],['P2010','55P03','contention'],['P2010','57014','contention'],['P2034',undefined,'contention']])
  ('classifies %s/%s without exposing the driver message',async(code,state,reason)=>{
    const {db}=fixture();db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('private-query-row',{
      code:code!,clientVersion:'synthetic',meta:{code:state},
    }));
    expect(await enqueueMetricReport(db as never,input)).toEqual({status:'unavailable',reason});
  });
