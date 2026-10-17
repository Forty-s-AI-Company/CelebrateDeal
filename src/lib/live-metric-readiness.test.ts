import { expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { metricCollectionReady } from "./live-metric-readiness";
const identity={vendorId:"v",liveId:"l",submissionId:"f",admissionId:"a"};
function fixture(active=true){
  const tx={$queryRaw:vi.fn(async(sql:Prisma.Sql)=>sql.strings.join('').includes('AS active')?[{active}]:[]),$executeRaw:vi.fn()};
  const db={$transaction:vi.fn(async(work:(value:typeof tx)=>Promise<unknown>)=>work(tx))};
  return {tx,db};
}
it("uses source locks, revalidates and only reads eligibility",async()=>{
  const {tx,db}=fixture();const authorize=vi.fn().mockResolvedValue(identity);const context=vi.fn().mockResolvedValue({versionId:"ver",expiresAt:new Date(90000)});
  expect(await metricCollectionReady(db as never,authorize,context)).toBe(true);
  expect(authorize.mock.calls.map(call=>call[1])).toEqual(['resolve','revalidate']);
  expect(context).toHaveBeenCalledWith(tx,identity);expect(tx.$executeRaw).not.toHaveBeenCalled();
  expect(tx.$queryRaw.mock.calls.map(([sql])=>sql.strings.join('')).some(text=>/INSERT|UPDATE\s+"/.test(text))).toBe(false);
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function),expect.objectContaining({isolationLevel:'ReadCommitted',timeout:5000}));
});
it("does not accept an identity changed after waiting",async()=>{
  const {db}=fixture();const auth=vi.fn().mockResolvedValueOnce(identity).mockResolvedValueOnce({...identity,submissionId:'other'});
  await expect(metricCollectionReady(db as never,auth,vi.fn().mockResolvedValue({versionId:'ver',expiresAt:new Date(90000)})))
    .rejects.toMatchObject({code:'not_authorized'});
});
it("returns false for expired or quota-exhausted state rather than issuing",async()=>{
  const {db,tx}=fixture(false);
  expect(await metricCollectionReady(db as never,vi.fn().mockResolvedValue(identity),vi.fn().mockResolvedValue({versionId:'ver',expiresAt:new Date(90000)}))).toBe(false);
  expect(tx.$executeRaw).not.toHaveBeenCalled();
});
