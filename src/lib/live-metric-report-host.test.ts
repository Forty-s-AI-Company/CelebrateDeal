import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
const ports=vi.hoisted(()=>({enqueue:vi.fn(),tick:vi.fn(),wait:vi.fn()}));
vi.mock('./live-metric-report-queue',()=>({enqueueMetricReport:ports.enqueue}));
vi.mock('./live-metric-report-scheduler',()=>({runMetricReportSchedulerTick:ports.tick}));
vi.mock('node:timers/promises',()=>({setTimeout:ports.wait}));
import { createMetricReportHost } from './live-metric-report-host';
const entry={vendorId:'v',liveId:'l',versionId:'ver',startAt:'2026-10-01T00:00:00Z',endAt:'2026-10-02T00:00:00Z'};
const config=(entries=[entry])=>({entries,cadenceMilliseconds:1000,maxCycles:2,jobsPerCycle:2});
const tick=()=>({status:'processed',attempted:1,outcomes:{recorded:1}});
beforeEach(()=>{vi.resetAllMocks();ports.enqueue.mockResolvedValue({status:'available',created:true});ports.tick.mockResolvedValue(tick());ports.wait.mockResolvedValue(undefined);});
afterEach(()=>vi.restoreAllMocks());
const make=(value:unknown=config())=>createMetricReportHost({} as never,value,vi.fn());
it('runs cycles sequentially, groups allowed scopes, and waits a full cadence after each cycle',async()=>{
  const host=make(config([entry,{...entry,startAt:'2026-10-01T01:00:00Z'}]));
  const observe=vi.fn();const result=await host.run(new AbortController().signal,observe);
  expect(result).toEqual({status:'completed',cycles:2,created:4,recorded:2});
  expect(ports.tick).toHaveBeenCalledTimes(2);expect(ports.wait).toHaveBeenCalledTimes(1);
  expect(ports.wait.mock.calls[0][0]).toBe(1000);
  expect(ports.tick.mock.calls[0][1]).toEqual({vendorId:'v',liveId:'l',versionId:'ver'});
  expect(Object.keys(observe.mock.calls[0][0])).not.toContain('vendorId');
});
it('copies scope/window config before a caller can mutate schedule objects',async()=>{
  const original=config(),host=make(original);original.entries[0]={...entry,vendorId:'foreign'};
  await host.run(new AbortController().signal);
  expect(ports.enqueue.mock.calls[0][1]).toMatchObject({vendorId:'v',startAt:new Date(entry.startAt)});
});
it('does no work for an already stopped process',async()=>{
  const abort=new AbortController();abort.abort();
  expect(await make().run(abort.signal)).toEqual({status:'stopped',cycles:0,created:0,recorded:0});
  expect(ports.enqueue).not.toHaveBeenCalled();expect(ports.tick).not.toHaveBeenCalled();
});
it('stops before the next enqueue after waiting for an in-flight call',async()=>{
  const abort=new AbortController(),host=make(config([entry,{...entry,versionId:'later'}]));
  let resolve!:(value:unknown)=>void;ports.enqueue.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  const running=host.run(abort.signal);abort.abort();resolve({status:'available',created:true});
  expect(await running).toMatchObject({status:'stopped',created:1});
  expect(ports.enqueue).toHaveBeenCalledTimes(1);expect(ports.tick).not.toHaveBeenCalled();
});
it('interrupts cadence sleep on stop without starting a new cycle',async()=>{
  const abort=new AbortController();ports.wait.mockImplementation(async()=>{abort.abort();throw new DOMException('Aborted','AbortError');});
  expect(await make().run(abort.signal)).toMatchObject({status:'stopped',cycles:1});expect(ports.enqueue).toHaveBeenCalledTimes(1);
});
it('enforces one job budget across all allowed scopes in a cycle',async()=>{
  const value={...config([entry,{...entry,versionId:'second'}]),maxCycles:1,jobsPerCycle:1};
  expect(await make(value).run(new AbortController().signal)).toMatchObject({recorded:1});
  expect(ports.tick).toHaveBeenCalledTimes(1);
});
it('rotates scope admission between cycles to avoid starving a later scope',async()=>{
  const value={...config([entry,{...entry,versionId:'second'}]),jobsPerCycle:1};
  await make(value).run(new AbortController().signal);
  expect(ports.tick.mock.calls.map(call=>call[1].versionId)).toEqual(['ver','second']);
});
it('halts on integrity errors without inline retries and preserves committed partial counts',async()=>{
  ports.enqueue.mockResolvedValueOnce({status:'available',created:true}).mockResolvedValueOnce({status:'unavailable',reason:'integrity_violation'});
  expect(await make(config([entry,{...entry,versionId:'second'}])).run(new AbortController().signal))
    .toMatchObject({status:'halted',reason:'integrity_violation',created:1});
  expect(ports.tick).not.toHaveBeenCalled();expect(ports.wait).not.toHaveBeenCalled();
});
it('does not re-enqueue a failed generation within a cycle',async()=>{
  ports.enqueue.mockResolvedValue({status:'unavailable',reason:'previous_failure'});
  const observe=vi.fn();await make({...config(),maxCycles:1}).run(new AbortController().signal,observe);
  expect(observe.mock.calls[0][0]).toMatchObject({created:0,denied:1});
});
it('rejects overlapping runs on one host',async()=>{
  const host=make({...config(),maxCycles:1});let release!:()=>void;
  ports.enqueue.mockImplementation(()=>new Promise(done=>{release=()=>done({status:'available',created:false});}));
  const running=host.run(new AbortController().signal);
  await expect(host.run(new AbortController().signal)).rejects.toThrow('already running');release();await running;
});
it('rejects empty/duplicate/oversized or malformed configurations before work',()=>{
  for(const value of [{entries:[]},{entries:[entry,entry]},{entries:Array(17).fill(entry)},
    {...config(),cadenceMilliseconds:999},{...config(),jobsPerCycle:5},{entries:[{...entry,endAt:entry.startAt}]}])
    expect(()=>make(value)).toThrow();
  expect(ports.enqueue).not.toHaveBeenCalled();
});
it('labels an interrupted cycle as partial',async()=>{
  const abort=new AbortController(),observe=vi.fn();ports.enqueue.mockImplementation(async()=>{abort.abort();return {status:'available',created:true};});
  expect(await make().run(abort.signal,observe)).toMatchObject({status:'stopped',cycles:1});
  expect(observe.mock.calls[0][0].partial).toBe(true);
});
it('keeps completed status when stop arrives after the last complete cycle',async()=>{
  const abort=new AbortController();
  expect(await make({...config(),maxCycles:1}).run(abort.signal,()=>abort.abort())).toMatchObject({status:'completed',cycles:1});
});
it('does not label a completed last tick partial merely because its work used the admission time',async()=>{
  const clock=vi.spyOn(performance,'now').mockReturnValue(0),observe=vi.fn();
  ports.tick.mockImplementation(async()=>{clock.mockReturnValue(10000);return {...tick(),deferred:0};});
  expect(await make({...config(),maxCycles:1,admissionMilliseconds:1}).run(new AbortController().signal,observe)).toMatchObject({status:'completed'});
  expect(observe.mock.calls[0][0].partial).toBe(false);
});
it('labels a cycle partial when the admission budget actually prevents a remaining entry',async()=>{
  const clock=vi.spyOn(performance,'now').mockReturnValue(0),observe=vi.fn();
  ports.enqueue.mockImplementation(async()=>{clock.mockReturnValue(10000);return {status:'available',created:true};});
  await make({...config([entry,{...entry,versionId:'later'}]),maxCycles:1,admissionMilliseconds:1}).run(new AbortController().signal,observe);
  expect(ports.enqueue).toHaveBeenCalledTimes(1);expect(observe.mock.calls[0][0].partial).toBe(true);
});
it('keeps a cap-limited final cycle complete when time expires during its last permitted job',async()=>{
  const clock=vi.spyOn(performance,'now').mockReturnValue(0),observe=vi.fn(),abort=new AbortController();
  ports.tick.mockImplementation(async()=>{clock.mockReturnValue(10000);return {...tick(),deferred:1};});
  expect(await make({...config(),maxCycles:1,jobsPerCycle:1,admissionMilliseconds:1}).run(abort.signal,value=>{observe(value);abort.abort();}))
    .toMatchObject({status:'completed'});
  expect(observe.mock.calls[0][0].partial).toBe(false);
});
it('marks an admission-deferred tick partial when job capacity remains',async()=>{
  const clock=vi.spyOn(performance,'now').mockReturnValue(0),observe=vi.fn();
  ports.tick.mockImplementation(async()=>{clock.mockReturnValue(10000);return {...tick(),deferred:1};});
  await make({...config(),maxCycles:1,jobsPerCycle:2,admissionMilliseconds:1}).run(new AbortController().signal,observe);
  expect(observe.mock.calls[0][0].partial).toBe(true);
});
