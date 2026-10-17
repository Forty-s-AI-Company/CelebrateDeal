import {expect,it,vi} from 'vitest';
import {withMetricReadVisibility} from './live-metric-read-visibility';
const settings={rowSecurity:'on',statementTimeout:'1s',timeoutMs:1000,isolation:'repeatable read',primary:true,backendPid:123,transactionStartedAt:'synthetic transaction'};
const live={rowSecurity:'off',timeoutMs:1000,backendPid:123,transactionStartedAt:'synthetic transaction'};
function database(state:typeof settings=settings){return {$queryRaw:vi.fn().mockResolvedValueOnce([state]).mockResolvedValueOnce([state]).mockResolvedValueOnce([])
 .mockResolvedValueOnce([{...live,timeoutMs:state.timeoutMs===0?5000:Math.min(state.timeoutMs,5000)}]).mockResolvedValue([])};}
it.each([0,250,1000,10000])('bounds the deadline without loosening the caller %i ms value and restores settings',async timeoutMs=>{
 const tx=database({...settings,timeoutMs}),read=vi.fn().mockResolvedValue('result');
 expect(await withMetricReadVisibility(tx,read)).toBe('result');
 expect(tx.$queryRaw.mock.calls[2][0].values).toEqual([`${timeoutMs===0?5000:Math.min(timeoutMs,5000)}ms`]);
 expect(tx.$queryRaw.mock.calls[4][0].values).toEqual(['on','1s']);expect(read).toHaveBeenCalledOnce();
});
it('rejects replica/non-RR contexts and malformed metadata before changing settings or reading',async()=>{
 for(const state of [{...settings,primary:false},{...settings,isolation:'read committed'},{...settings,timeoutMs:-1}]){
  const tx=database(state),read=vi.fn();await expect(withMetricReadVisibility(tx,read)).rejects.toThrow();
  expect(tx.$queryRaw).toHaveBeenCalledOnce();expect(read).not.toHaveBeenCalled();
 }
});
it('does not mask the original read failure if the aborted transaction also rejects restoration',async()=>{
 const aborted=Object.assign(new Error('secondary restore failure'),{meta:{code:'25P02'}});
 const tx=database();tx.$queryRaw.mockReset().mockResolvedValueOnce([settings]).mockResolvedValueOnce([settings]).mockResolvedValueOnce([]).mockResolvedValueOnce([live]).mockRejectedValueOnce(aborted);
 const original=new Error('synthetic source denied');
 await expect(withMetricReadVisibility(tx,async()=>{throw original;})).rejects.toBe(original);
 expect(tx.$queryRaw).toHaveBeenCalledTimes(5);
});
it('propagates restoration failure after a successful read, preventing use of an altered transaction',async()=>{
 const tx=database();tx.$queryRaw.mockReset().mockResolvedValueOnce([settings]).mockResolvedValueOnce([settings]).mockResolvedValueOnce([]).mockResolvedValueOnce([live]).mockRejectedValueOnce(new Error('restore unavailable'));
 await expect(withMetricReadVisibility(tx,async()=>1)).rejects.toThrow('restore unavailable');
});
it('surfaces both a JavaScript failure and a non-aborted restore failure so the caller must roll back',async()=>{
 const original=new Error('synthetic JS failure'),restore=new Error('synthetic restore failure');
 const tx=database();tx.$queryRaw.mockReset().mockResolvedValueOnce([settings]).mockResolvedValueOnce([settings]).mockResolvedValueOnce([]).mockResolvedValueOnce([live]).mockRejectedValueOnce(restore);
 const error=await withMetricReadVisibility(tx,async()=>{throw original;}).catch(value=>value);
 expect(error).toBeInstanceOf(AggregateError);expect(error.errors).toEqual([original,restore]);expect(error.cause).toBe(original);
});
it('rejects simultaneous use on the same client before it can alter settings twice',async()=>{
 const tx=database();let release!:()=>void;
 const read=vi.fn(()=>new Promise<void>(done=>{release=done;}));
 const pending=withMetricReadVisibility(tx,read);await vi.waitFor(()=>expect(read).toHaveBeenCalledOnce());
 await expect(withMetricReadVisibility(tx,async()=>0)).rejects.toThrow('already active');
 release();await pending;expect(tx.$queryRaw).toHaveBeenCalledTimes(5);
});
it('also rejects a different facade aliasing the same backend transaction',async()=>{
 const tx=database();let release!:()=>void;const read=vi.fn(()=>new Promise<void>(done=>{release=done;}));
 const pending=withMetricReadVisibility(tx,read);await vi.waitFor(()=>expect(read).toHaveBeenCalledOnce());
 const alias={$queryRaw:vi.fn().mockResolvedValue([settings])};
 await expect(withMetricReadVisibility(alias,async()=>0)).rejects.toThrow('already active');
 release();await pending;expect(alias.$queryRaw).toHaveBeenCalledOnce();
});
it('shares guard state across separately evaluated server module copies',async()=>{
 const tx=database();let release!:()=>void;const read=vi.fn(()=>new Promise<void>(done=>{release=done;}));
 const pending=withMetricReadVisibility(tx,read);await vi.waitFor(()=>expect(read).toHaveBeenCalledOnce());
 try{
  vi.resetModules();const other=await import('./live-metric-read-visibility');
  const alias={$queryRaw:vi.fn().mockResolvedValue([{...settings,rowSecurity:'off'}])};
  await expect(other.withMetricReadVisibility(alias,async()=>0)).rejects.toThrow('already active');
 }finally{release();await pending;}
});
it.each([{...live,rowSecurity:'on'},{...live,backendPid:124},{...live,transactionStartedAt:'other transaction'}])('rejects nonpersistent settings or another connection/transaction',async check=>{
 const tx=database();tx.$queryRaw.mockReset().mockResolvedValueOnce([settings]).mockResolvedValueOnce([settings]).mockResolvedValueOnce([]).mockResolvedValueOnce([check]).mockResolvedValue([]);
 const read=vi.fn();await expect(withMetricReadVisibility(tx,read)).rejects.toThrow('one explicit transaction');
 expect(read).not.toHaveBeenCalled();expect(tx.$queryRaw.mock.calls.at(-1)![0].values).toEqual(['on','1s']);
});
it('uses the current settings captured under exclusivity instead of an old delayed alias snapshot',async()=>{
 const stale={...settings,rowSecurity:'off',statementTimeout:'5s',timeoutMs:5000};
 const tx=database();tx.$queryRaw.mockReset().mockResolvedValueOnce([stale]).mockResolvedValueOnce([settings])
  .mockResolvedValueOnce([]).mockResolvedValueOnce([live]).mockResolvedValue([]);
 expect(await withMetricReadVisibility(tx,async()=>1)).toBe(1);
 expect(tx.$queryRaw.mock.calls[2][0].values).toEqual(['1000ms']);
 expect(tx.$queryRaw.mock.calls.at(-1)![0].values).toEqual(['on','1s']);
});
