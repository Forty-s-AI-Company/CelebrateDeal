import { beforeEach,describe, expect, it, vi } from "vitest";
import { readMetricCoverage } from "./live-metric-coverage-reader";
const source=vi.hoisted(()=>vi.fn());
vi.mock('./live-metric-visit-reconciliation',()=>({reconcileMetricVisitSources:source}));
vi.mock('./live-metric-read-visibility',()=>({withMetricReadVisibility:async(_tx:unknown,read:()=>Promise<unknown>)=>read()}));
beforeEach(()=>{source.mockReset().mockResolvedValue({status:'available',rowCount:0,coverage:{status:'unavailable',reason:'unknown_history'}});});
const lease = { vendorId: "v", liveId: "l", versionId: "version", reportId: "r", workerId: "w" };
const context = { isolation: "repeatable read", mode: "replay", windowStartAt: new Date(1000), windowEndAt: new Date(3000) };
const range = (status: string, start: number, end: number) => ({ status, startAt: new Date(start), endAt: new Date(end) });
describe("same-snapshot durable coverage reader", () => {
  it('includes whole-version source gaps and counts the bounded source rows in the snapshot budget',async()=>{
    source.mockResolvedValueOnce({status:'available',rowCount:7,coverage:{status:'unavailable',reason:'evidence_gap'}});
    const $queryRaw=vi.fn().mockResolvedValueOnce([context]).mockResolvedValueOnce([]);
    expect(await readMetricCoverage({$queryRaw},lease,'visits')).toMatchObject({rowCount:7,coverage:{reason:'evidence_gap'}});
  });
  it('does not return partial source reconciliation without audit gap evidence',async()=>{
    source.mockResolvedValueOnce({status:'unavailable',reason:'limit_exceeded'});
    const $queryRaw=vi.fn().mockResolvedValueOnce([context]).mockResolvedValueOnce([]);
    expect(await readMetricCoverage({$queryRaw},lease,'visits')).toEqual({status:'unavailable',reason:'limit_exceeded'});
    expect($queryRaw).toHaveBeenCalledTimes(2);
  });
  it('preserves known audit gaps when source reconciliation exceeds its bound',async()=>{
    source.mockResolvedValueOnce({status:'unavailable',reason:'limit_exceeded'});
    const $queryRaw=vi.fn().mockResolvedValueOnce([context]).mockResolvedValueOnce([range('gap',1500,1600)]);
    expect(await readMetricCoverage({$queryRaw},lease,'visits')).toMatchObject({status:'available',rowCount:1,
      coverage:{reason:'evidence_gap'},sourceReconciliation:{status:'not_read',reason:'known_audit_gap'}});
    expect(source).not.toHaveBeenCalled();
  });
  it("never certifies absent history", async () => {
    const $queryRaw = vi.fn().mockResolvedValueOnce([context]).mockResolvedValueOnce([]);
    expect(await readMetricCoverage({ $queryRaw }, lease, "visits")).toMatchObject({ status: "available", rowCount: 0, coverage: { status: "unavailable", reason: "unknown_history" } });
  });
  it("unions audited ranges and preserves gaps", async () => {
    for (const gap of [false, true]) {
      const rows = [range("covered", 1000, 2000), range("covered", 2000, 3000), ...(gap ? [range("gap", 1500, 1501)] : [])];
      const $queryRaw = vi.fn().mockResolvedValueOnce([context]).mockResolvedValueOnce(rows);
      expect((await readMetricCoverage({ $queryRaw }, lease, "registrations"))).toMatchObject({ coverage: gap ? { status: "unavailable", reason: "evidence_gap" } : { status: "complete" } });
    }
  });
  it("rejects oversized audits and missing leases without returning prefixes", async () => {
    const $queryRaw = vi.fn().mockResolvedValueOnce([context]).mockResolvedValueOnce(Array(10001).fill(range("covered", 1000, 3000)));
    expect(await readMetricCoverage({ $queryRaw }, lease, "registrations")).toEqual({ status: "unavailable", reason: "limit_exceeded" });
    const missing = vi.fn().mockResolvedValue([]);
    expect(await readMetricCoverage({ $queryRaw: missing }, lease, "visits")).toEqual({ status: "unavailable", reason: "lease_or_scope_unavailable" });
    expect(missing).toHaveBeenCalledOnce();
  });
  it.each(['visits','viewing'] as const)('rejects unsupported %s positives even if a backend returns them, while preserving gaps',async kind=>{
    for(const gap of [false,true]){
      const rows=[range('covered',1000,3000),...(gap?[range('gap',1500,1501)]:[])];
      const $queryRaw=vi.fn().mockResolvedValueOnce([context]).mockResolvedValueOnce(rows);
      expect(await readMetricCoverage({$queryRaw},lease,kind)).toMatchObject({rowCount:gap?1:0,
        coverage:{status:'unavailable',reason:gap?'evidence_gap':'unknown_history'}});
    }
  });
  it("requires repeatable-read isolation and propagates storage failures", async () => {
    await expect(readMetricCoverage({ $queryRaw: vi.fn().mockResolvedValue([{ ...context, isolation: "read committed" }]) }, lease, "visits")).rejects.toThrow("repeatable-read");
    const failure = new Error("synthetic-storage-failure");
    await expect(readMetricCoverage({ $queryRaw: vi.fn().mockResolvedValueOnce([context]).mockRejectedValueOnce(failure) }, lease, "visits")).rejects.toBe(failure);
  });
});

it('accepts only typed visits proof matching the current snapshot digest and rejects legacy or forged metadata',async()=>{
 const runId='10000000-0000-4000-8000-000000000001';
 const receipt={format:1,runId,manifestHash:'a'.repeat(64),gatewayId:'20000000-0000-4000-8000-000000000001',frameDigest:'b'.repeat(64),closedAt:'2026-10-15T00:00:00.000Z',settlementFailures:0,admissionFailures:0,pendingFrames:0};
 const proof={...range('covered',1000,3000),auditDigest:'c'.repeat(64),ingressRunId:runId,ingressProofVersion:1,ingressReceipt:receipt,ingressEligible:true};
 for(const override of [null,{ingressProofVersion:null},{auditDigest:'d'.repeat(64)},{ingressEligible:false},
  {ingressReceipt:{...receipt,admissionFailures:1}},{ingressRunId:'30000000-0000-4000-8000-000000000001'},{auditDigest:undefined}]){
  source.mockResolvedValueOnce({status:'available',rowCount:1,sourceDigest:'c'.repeat(64),coverage:{status:'unavailable',reason:'unknown_history'}});
  const $queryRaw=vi.fn().mockResolvedValueOnce([context]).mockResolvedValueOnce([{...proof,...override}]);
  expect(await readMetricCoverage({$queryRaw},lease,'visits')).toMatchObject({coverage:override?{reason:'unknown_history'}:{status:'complete'}});
 }
});
it('a current source gap overrides an otherwise matching typed visits proof',async()=>{
 source.mockResolvedValueOnce({status:'available',rowCount:1,sourceDigest:'c'.repeat(64),coverage:{status:'unavailable',reason:'evidence_gap'}});
 const $queryRaw=vi.fn().mockResolvedValueOnce([context]).mockResolvedValueOnce([]);
 expect(await readMetricCoverage({$queryRaw},lease,'visits')).toMatchObject({coverage:{reason:'evidence_gap'}});
});

it.each([[500,3500],[1000,2500]])('does not accept a typed visits digest computed for a different proof window %s..%s',async(start,end)=>{
 const runId='10000000-0000-4000-8000-000000000001';
 const receipt={format:1,runId,manifestHash:'a'.repeat(64),gatewayId:'20000000-0000-4000-8000-000000000001',frameDigest:'b'.repeat(64),closedAt:'2026-10-15T00:00:00.000Z',settlementFailures:0,admissionFailures:0,pendingFrames:0};
 const proof={...range('covered',start,end),auditDigest:'c'.repeat(64),ingressRunId:runId,ingressProofVersion:1,ingressReceipt:receipt,ingressEligible:true};
 source.mockResolvedValueOnce({status:'available',rowCount:1,sourceDigest:'c'.repeat(64),coverage:{status:'unavailable',reason:'unknown_history'}});
 const $queryRaw=vi.fn().mockResolvedValueOnce([context]).mockResolvedValueOnce([proof]);
 expect(await readMetricCoverage({$queryRaw},lease,'visits')).toMatchObject({coverage:{reason:'unknown_history'}});
});

it('accepts only current terminal-viewing proofs with all non-null revision bindings',async()=>{
 const runId='10000000-0000-4000-8000-000000000001';
 const receipt={format:1,runId,manifestHash:'a'.repeat(64),gatewayId:'20000000-0000-4000-8000-000000000001',frameDigest:'b'.repeat(64),closedAt:'2026-10-15T00:00:00.000Z',settlementFailures:0,admissionFailures:0,pendingFrames:0};
 const proof={...range('covered',1000,3000),auditDigest:'c'.repeat(64),ingressRunId:runId,ingressProofVersion:2,ingressReceipt:receipt,ingressEligible:true,
  viewingRevision:BigInt(1),intakeRevision:BigInt(2),registrationRevision:BigInt(3),currentViewingRevision:BigInt(1),currentIntakeRevision:BigInt(2),currentRegistrationRevision:BigInt(3)};
 for(const changed of [null,{viewingRevision:null},{intakeRevision:null},{registrationRevision:null},{currentViewingRevision:BigInt(4)},
  {currentIntakeRevision:BigInt(4)},{currentRegistrationRevision:BigInt(4)},{ingressProofVersion:1},{ingressEligible:false},{ingressReceipt:{...receipt,pendingFrames:1}}]){
  const $queryRaw=vi.fn().mockResolvedValueOnce([context]).mockResolvedValueOnce([{...proof,...changed}]);
  expect(await readMetricCoverage({$queryRaw},lease,'viewing')).toMatchObject({coverage:changed?{reason:'unknown_history'}:{status:'complete'}});
 }
});
it('retains a known viewing gap ahead of a current typed proof',async()=>{
 const $queryRaw=vi.fn().mockResolvedValueOnce([context]).mockResolvedValueOnce([range('gap',1500,2000)]);
 expect(await readMetricCoverage({$queryRaw},lease,'viewing')).toMatchObject({coverage:{reason:'evidence_gap'}});
});
