import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectMetricVisit, prepareMetricVisit, collectPreparedMetricVisit, prepareTrackedMetricVisit } from "./live-metric-visit-collection";
import { createMetricVisitorProofService } from "./live-metric-visitor-proof";
import { MetricVisitorError } from "./live-metric-visitor";
import { MetricVisitIntentError } from "./live-metric-visit-intent";

const mocks = vi.hoisted(() => ({ context: vi.fn(), provision: vi.fn(), record: vi.fn(), intent: vi.fn(), requireIntent: vi.fn(), page: vi.fn() }));
vi.mock("./live-metric-visit-page", () => ({requireMetricVisitPage:mocks.page}));
vi.mock("./live-metric-visit-intent", async original => ({...await original<typeof import('./live-metric-visit-intent')>(),prepareMetricVisitIntent:mocks.intent,requireMetricVisitIntent:mocks.requireIntent}));
vi.mock("./live-metric-visit-context", () => ({ resolveMetricVisitContext: mocks.context }));
vi.mock("./live-metric-visitor", async original => ({ ...await original<typeof import("./live-metric-visitor")>(), provisionMetricVisitor: mocks.provision }));
vi.mock("./live-metric-visit", () => ({ recordMetricVisit: mocks.record }));
const scope = { vendorId: "v", liveId: "l" };
const context = { ...scope, versionId: "version", expiresAt: new Date(2000) };
const event = { eventId: "10000000-0000-4000-8000-000000000001" };
const proofs = createMetricVisitorProofService(new Uint8Array(32).fill(7));
const visitor = { visitorId: "visitor", proof: "synthetic-proof", created: true, expiresAtMs: 2000 };
function database() {
  const tx = { $queryRaw: vi.fn().mockResolvedValue([{ now: new Date(1000) }]) };
  return { tx, db: { $transaction: vi.fn(async callback => callback(tx)) } };
}
beforeEach(() => { vi.clearAllMocks(); mocks.context.mockResolvedValue(context); mocks.provision.mockResolvedValue(visitor); mocks.record.mockResolvedValue({ ...event, visitedAtMs: 1000, replayed: false }); });
describe("atomic public visit collection", () => {
  it("binds every operation to one bounded transaction", async () => {
    const { db, tx } = database();
    mocks.provision.mockImplementation(async bound => { expect(await bound.$transaction(async (client: unknown) => client)).toBe(tx); return visitor; });
    mocks.record.mockImplementation(async bound => { expect(await bound.$transaction(async (client: unknown) => client)).toBe(tx); return { ...event, visitedAtMs: 1000, replayed: false }; });
    expect(await collectMetricVisit(db, proofs, scope, event)).toEqual({ ...visitor, ...event, visitedAtMs: 1000, replayed: false, versionId: "version" });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "ReadCommitted", timeout: 10000, maxWait: 5000 });
    expect(mocks.context).toHaveBeenCalledWith(tx, scope);
    expect(mocks.record).toHaveBeenCalledWith(expect.anything(), { ...scope, versionId: "version", visitorId: "visitor" }, event);
  });
  it("returns nothing if the final visit write or outer commit fails", async () => {
    mocks.record.mockRejectedValueOnce(new Error("synthetic SQL details"));
    await expect(collectMetricVisit(database().db, proofs, scope, event)).rejects.toMatchObject({ code: "PERSISTENCE_UNAVAILABLE" });
    const { db, tx } = database();
    db.$transaction.mockImplementation(async callback => { await callback(tx); throw new Error("synthetic commit failure"); });
    await expect(collectMetricVisit(db, proofs, scope, event)).rejects.toMatchObject({ code: "PERSISTENCE_UNAVAILABLE" });
  });
  it("does not provision if current public context is denied", async () => {
    mocks.context.mockRejectedValueOnce(new MetricVisitorError("SCOPE_UNAVAILABLE"));
    await expect(collectMetricVisit(database().db, proofs, scope, event)).rejects.toMatchObject({ code: "SCOPE_UNAVAILABLE" });
    expect(mocks.provision).not.toHaveBeenCalled(); expect(mocks.record).not.toHaveBeenCalled();
  });
  it("rejects client-provided version identity and timestamp before querying", async () => {
    const { db } = database();
    await expect(collectMetricVisit(db, proofs, scope, { ...event, versionId: "foreign" })).rejects.toThrow();
    await expect(collectMetricVisit(db, proofs, scope, { ...event, visitedAtMs: 1000 })).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("uncounted visitor preparation", () => {
  it("prepares a persisted proof without recording a visit", async () => {
    const { db, tx } = database();
    mocks.provision.mockImplementation(async (bound, _proofs, resolved, proof) => {
      expect(await bound.$transaction(async (client: unknown) => client)).toBe(tx);
      expect(resolved).toBe(context); expect(proof).toBeNull(); return visitor;
    });
    expect(await prepareMetricVisit(db, proofs, scope)).toEqual({ ...visitor, versionId: "version" });
    expect(mocks.record).not.toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
  it("reuses the retained proof and never returns before commit", async () => {
    const { db, tx } = database();
    const retainedProof = proofs.issue({ ...scope, versionId: "version" }, 500, 1500).proof;
    db.$transaction.mockImplementation(async callback => { await callback(tx); throw new Error("synthetic commit failure"); });
    await expect(prepareMetricVisit(db, proofs, scope, retainedProof)).rejects.toMatchObject({ code: "PERSISTENCE_UNAVAILABLE" });
    expect(mocks.provision).toHaveBeenCalledWith(expect.anything(), proofs, context, retainedProof);
    expect(mocks.record).not.toHaveBeenCalled();
  });
});

it.each([null, undefined, "", {}, "x".repeat(2049)])("public collection rejects missing or malformed retained proof %#", async proof => {
  const { db } = database();
  await expect(collectPreparedMetricVisit(db, proofs, scope, event, proof)).rejects.toMatchObject({ code: "PROOF_INVALID" });
  expect(db.$transaction).not.toHaveBeenCalled();
});

it("replaces only an authenticated same-live old version during preparation", async () => {
  const old = proofs.issue({ ...scope, versionId: "old-version" }, 100, 500).proof;
  await prepareMetricVisit(database().db, proofs, scope, old);
  expect(mocks.provision).toHaveBeenCalledWith(expect.anything(), proofs, context, null);
  expect(mocks.record).not.toHaveBeenCalled();
});
it("refuses forged or other-live version transitions", async () => {
  const foreign = proofs.issue({ ...scope, liveId: "other", versionId: "old" }, 100, 2000).proof;
  for (const proof of [foreign, "forged"]) await expect(prepareMetricVisit(database().db, proofs, scope, proof)).rejects.toMatchObject({ code: "PROOF_INVALID" });
  expect(mocks.provision).not.toHaveBeenCalled();
});
it("commits a bound expectation before returning preparation and never counts it as a visit",async()=>{
  const {db,tx}=database();await prepareMetricVisit(db,proofs,scope,null,event);
  expect(mocks.intent).toHaveBeenCalledWith(tx,{...scope,versionId:'version',visitorId:'visitor',...event});
  expect(mocks.record).not.toHaveBeenCalled();
  mocks.intent.mockRejectedValueOnce(new Error('synthetic intent failure'));
  await expect(prepareMetricVisit(db,proofs,scope,null,event)).rejects.toMatchObject({code:'PERSISTENCE_UNAVAILABLE'});
});
it("public collection requires the prepared same-event identity before recording",async()=>{
  const {db,tx}=database();await collectPreparedMetricVisit(db,proofs,scope,event,'synthetic-proof');
  expect(mocks.requireIntent).toHaveBeenCalledWith(tx,{...scope,versionId:'version',visitorId:'visitor',...event});
  mocks.record.mockClear();mocks.requireIntent.mockRejectedValueOnce(new Error('missing intent'));
  await expect(collectPreparedMetricVisit(db,proofs,scope,event,'synthetic-proof')).rejects.toMatchObject({code:'PERSISTENCE_UNAVAILABLE'});
  expect(mocks.record).not.toHaveBeenCalled();
});
it.each([undefined,null,{eventId:'not-a-uuid'},{...event,preparedAt:1000}])('public prepare rejects malformed or missing events without a transaction %#',async value=>{
 const {db}=database();await expect(prepareTrackedMetricVisit(db,proofs,scope,null,value)).rejects.toMatchObject({code:'SCOPE_UNAVAILABLE'});
 expect(db.$transaction).not.toHaveBeenCalled();
});
it('normalizes the same event before intent checks and actual visit writes',async()=>{
 const {db}=database(),eventId='abcdefab-abcd-4abc-8abc-abcdefabcdef';
 await prepareTrackedMetricVisit(db,proofs,scope,null,{eventId:eventId.toUpperCase()});
 expect(mocks.intent).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({eventId}));
 await collectPreparedMetricVisit(db,proofs,scope,{eventId:eventId.toUpperCase()},'synthetic-proof');
 expect(mocks.requireIntent).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({eventId}));
 expect(mocks.record).toHaveBeenCalledWith(expect.anything(),expect.anything(),{eventId});
});
it('maps deterministic intent conflicts and absence to nonretryable sanitized scope errors',async()=>{
 mocks.intent.mockRejectedValueOnce(new MetricVisitIntentError());
 await expect(prepareTrackedMetricVisit(database().db,proofs,scope,null,event)).rejects.toMatchObject({code:'SCOPE_UNAVAILABLE'});
 mocks.requireIntent.mockRejectedValueOnce(new MetricVisitIntentError());
 await expect(collectPreparedMetricVisit(database().db,proofs,scope,event,'synthetic-proof')).rejects.toMatchObject({code:'SCOPE_UNAVAILABLE'});
 expect(mocks.record).not.toHaveBeenCalled();
});
it('public preparation requires the server page event before provisioning identity',async()=>{
 const {db,tx}=database();await prepareTrackedMetricVisit(db,proofs,scope,null,event);
 expect(mocks.page).toHaveBeenCalledWith(tx,{...scope,versionId:'version',...event});
 expect(mocks.page.mock.invocationCallOrder[0]).toBeLessThan(mocks.provision.mock.invocationCallOrder[0]);
 mocks.provision.mockClear();mocks.page.mockRejectedValueOnce(new MetricVisitIntentError());
 await expect(prepareTrackedMetricVisit(db,proofs,scope,null,event)).rejects.toMatchObject({code:'SCOPE_UNAVAILABLE'});
 expect(mocks.provision).not.toHaveBeenCalled();
});
