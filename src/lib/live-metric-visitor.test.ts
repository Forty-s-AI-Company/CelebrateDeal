import { describe, expect, it, vi } from "vitest";
import { createMetricVisitorProofService } from "./live-metric-visitor-proof";
import { provisionMetricVisitor } from "./live-metric-visitor";

const scope = { vendorId: "v", liveId: "l", versionId: "version" };
const context = { ...scope, expiresAt: new Date(3000) };
const proofs = createMetricVisitorProofService(new Uint8Array(32).fill(7));
function database(version: unknown[] = [{ nowAt: new Date(1000), expiresAt: new Date(2000) }], visitors: unknown[] = []) {
  const $queryRaw = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce(version).mockResolvedValueOnce(visitors);
  const $executeRaw = vi.fn().mockResolvedValue(1);
  return { $queryRaw, $executeRaw, $transaction: vi.fn(async callback => callback({ $queryRaw, $executeRaw })) };
}
describe("server visitor provisioning", () => {
  it("persists its generated identity and caps proof lifetime at the version", async () => {
    const db = database(); const result = await provisionMetricVisitor(db, proofs, context);
    expect(result.created).toBe(true);
    expect(db.$executeRaw.mock.calls[0][0].values[0]).toBe(result.visitorId);
    expect(proofs.verify(result.proof, scope, 1999)).toBe(result.visitorId);
    expect(proofs.verify(result.proof, scope, 2000)).toBeNull();
  });
  it("does not return a proof when persistence or commit fails", async () => {
    const db = database(); db.$executeRaw.mockRejectedValue(new Error("synthetic write failure"));
    await expect(provisionMetricVisitor(db, proofs, context)).rejects.toMatchObject({ code: "PERSISTENCE_UNAVAILABLE", message: "Metric visitor persistence unavailable" });
    const commitDb = database(); commitDb.$transaction.mockImplementation(async callback => { await callback(commitDb); throw new Error("synthetic commit failure"); });
    await expect(provisionMetricVisitor(commitDb, proofs, context)).rejects.toMatchObject({ code: "PERSISTENCE_UNAVAILABLE", message: "Metric visitor persistence unavailable" });
  });
  it("reuses an existing proven identity without a write or renewal", async () => {
    const issued = proofs.issue(scope, 500, 1500); const db = database(undefined, [{ id: issued.visitorId }]);
    expect(await provisionMetricVisitor(db, proofs, context, issued.proof)).toEqual({ ...issued, expiresAtMs: 1500, cookieExpiresAtMs: 2000, created: false });
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it("rejects deleted identities instead of recreating them", async () => {
    const issued = proofs.issue(scope, 500, 1500); const db = database();
    await expect(provisionMetricVisitor(db, proofs, context, issued.proof)).rejects.toThrow("scope unavailable");
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it.each(["", "forged", proofs.issue({ ...scope, vendorId: "other" }, 500, 1500).proof])("rejects invalid proof without a new identity %#", async proof => {
    const db = database(); await expect(provisionMetricVisitor(db, proofs, context, proof)).rejects.toThrow("proof unavailable");
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it("rejects disabled scope and expired server context", async () => {
    await expect(provisionMetricVisitor(database([]), proofs, context)).rejects.toThrow("scope unavailable");
    await expect(provisionMetricVisitor(database(), proofs, { ...context, expiresAt: new Date(1000) })).rejects.toThrow("lifetime unavailable");
  });
});

it("exposes the shortened effective lifetime without renewing proof", async () => {
  const issued = proofs.issue(scope, 500, 2500);
  const db = database([{ nowAt: new Date(1000), expiresAt: new Date(1200) }], [{ id: issued.visitorId }]);
  expect(await provisionMetricVisitor(db, proofs, context, issued.proof)).toEqual({ ...issued, expiresAtMs: 1200, cookieExpiresAtMs: 1200, created: false });
  expect(db.$executeRaw).not.toHaveBeenCalled();
});
it("recovers authentic expiry without creating a different identity", async () => {
  const issued = proofs.issue(scope, 0, 1000); const db = database(undefined, [{ id: issued.visitorId }]);
  const recovered = await provisionMetricVisitor(db, proofs, context, issued.proof);
  expect(recovered.visitorId).toBe(issued.visitorId); expect(recovered.created).toBe(false);
  expect(proofs.verify(recovered.proof, scope, 1999)).toBe(issued.visitorId);
  expect(proofs.verify(recovered.proof, scope, 2000)).toBeNull();
  expect(db.$executeRaw).not.toHaveBeenCalled();
  await expect(provisionMetricVisitor(database(), proofs, context, issued.proof)).rejects.toMatchObject({ code: "VISITOR_MISSING" });
  await expect(provisionMetricVisitor(database([]), proofs, context, issued.proof)).rejects.toMatchObject({ code: "SCOPE_UNAVAILABLE" });
  await expect(provisionMetricVisitor(database(), proofs, context, "forged")).rejects.toMatchObject({ code: "PROOF_INVALID" });
});

it.each(["23514", "57014", "23505"])("sanitizes database rejection %s", async code => {
  const db = database();
  db.$executeRaw.mockRejectedValue({ code: "P2010", meta: { code, message: "synthetic SQL details" } });
  const error = await provisionMetricVisitor(db, proofs, context).catch(error => error);
  expect(error).toMatchObject({ code: "PERSISTENCE_UNAVAILABLE", message: "Metric visitor persistence unavailable" });
  expect(error).not.toHaveProperty("cause"); expect(error).not.toHaveProperty("meta");
});
it("uses scoped locks and bounded read-committed transactions", async () => {
  const issued = proofs.issue(scope, 500, 1500); const db = database(undefined, [{ id: issued.visitorId }]);
  await provisionMetricVisitor(db, proofs, context, issued.proof);
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "ReadCommitted", timeout: 10000, maxWait: 5000 });
  expect(db.$queryRaw.mock.calls[1][0].sql).toContain("FOR SHARE");
  expect(db.$queryRaw.mock.calls[1][0].values).toEqual([scope.versionId, scope.vendorId, scope.liveId]);
  expect(db.$queryRaw.mock.calls[3][0].sql).toContain("FOR KEY SHARE");
  expect(db.$queryRaw.mock.calls[3][0].values).toEqual([issued.visitorId, scope.vendorId, scope.liveId, scope.versionId]);
});

it("retains the identity only until version expiry while proof follows shorter context", async () => {
  const db = database();
  const result = await provisionMetricVisitor(db, proofs, { ...context, expiresAt: new Date(1200) });
  expect(result.expiresAtMs).toBe(1200); expect(result.cookieExpiresAtMs).toBe(2000);
  expect(proofs.verify(result.proof, scope, 1200)).toBeNull();
  const recoveredDb = database([{ nowAt: new Date(1300), expiresAt: new Date(2000) }], [{ id: result.visitorId }]);
  const recovered = await provisionMetricVisitor(recoveredDb, proofs, context, result.proof);
  expect(recovered.visitorId).toBe(result.visitorId); expect(recovered.cookieExpiresAtMs).toBe(2000);
  expect(recoveredDb.$executeRaw).not.toHaveBeenCalled();
});
