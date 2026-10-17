import { beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const audit = vi.hoisted(() => vi.fn());
vi.mock("./live-metric-order-source-audit", () => ({ auditMetricOrderSources: audit }));
import { publishOrderCoverage } from "./live-metric-order-coverage";
const scope = { vendorId: "v", liveId: "l", versionId: "version", startAt: new Date(0), endAt: new Date(100) };
beforeEach(() => { audit.mockReset().mockResolvedValue({ status: "enumerated", count: 0, projectionCount: 0,
  outcomes: { matched: 0, other_purpose: 0, other_live: 0, outside_cohort: 0 }, digest: "a".repeat(64) }); });
const failDb = (error: unknown) => ({ $transaction: vi.fn().mockRejectedValue(error) }) as unknown as Parameters<typeof publishOrderCoverage>[0];
const sqlError = (code: string, message: string) => new Prisma.PrismaClientKnownRequestError("Database guard rejected write", {
  code: "P2010", clientVersion: "test", meta: { code, message },
});
it("reports a dedicated stale-proof guard as source_changed", async () => {
  await expect(publishOrderCoverage(failDb(sqlError("23514", "order coverage source mismatch")), scope))
    .resolves.toEqual({ status: "source_changed" });
});
it.each([
  ["23514", "unrelated integrity constraint"],
  ["55P03", "order coverage source mismatch"],
])("preserves unrelated database failures %s", async (code, message) => {
  const error = sqlError(code, message);
  await expect(publishOrderCoverage(failDb(error), scope)).rejects.toBe(error);
});
it("does not convert an audit infrastructure failure into a write race", async () => {
  const error = sqlError("23514", "order coverage source mismatch");
  audit.mockRejectedValue(error);
  const db = failDb(new Error("Writer must not run"));
  await expect(publishOrderCoverage(db, scope)).rejects.toBe(error);
  expect(db.$transaction).not.toHaveBeenCalled();
});

it.each(["missing_payment", "missing_attribution", "invalid_source", "missing_registration", "identity_mismatch"])("does not publish incomplete %s inventory", async outcome => {
  audit.mockResolvedValue({ status: "enumerated", count: 1,
    outcomes: { matched: 0, other_purpose: 0, other_live: 0, outside_cohort: 0, [outcome]: 1 } });
  const db = failDb(new Error("Writer must not run"));
  expect(await publishOrderCoverage(db, scope)).toEqual({ status: "incomplete" });
  expect(db.$transaction).not.toHaveBeenCalled();
});
it("does not write an interrupted audit", async () => {
  audit.mockResolvedValue({ status: "unavailable", reason: "query_cancelled" });
  const db = failDb(new Error("Writer must not run"));
  expect(await publishOrderCoverage(db, scope)).toEqual({ status: "unavailable" });
  expect(db.$transaction).not.toHaveBeenCalled();
});

const writerDb = (matches: boolean) => {
  const tx = { $queryRaw: vi.fn().mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ sourceRevision: BigInt(1) }])
    .mockResolvedValueOnce([{ registration: BigInt(2), orders: BigInt(3), tenant: BigInt(4) }])
    .mockResolvedValueOnce([]).mockResolvedValueOnce(matches ? [{ id: "stored" }] : []) };
  return { $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) } as unknown as Parameters<typeof publishOrderCoverage>[0];
};
const emptyAudit = () => ({ status: "enumerated", count: 0,
  sourceRevision: BigInt(1), registrationRevision: BigInt(2), orderRevision: BigInt(3), tenantRevision: BigInt(4),
  outcomes: { matched: 0, other_purpose: 0, other_live: 0, outside_cohort: 0 }, digest: "a".repeat(64) });
it("does not report recorded when the persisted proof does not match", async () => {
  audit.mockResolvedValue(emptyAudit());
  expect(await publishOrderCoverage(writerDb(false), scope)).toEqual({ status: "conflict" });
});
it("explicitly binds scope even when two audits supply the same digest", async () => {
  audit.mockResolvedValue(emptyAudit());
  const first = await publishOrderCoverage(writerDb(true), scope);
  const second = await publishOrderCoverage(writerDb(true), { ...scope, endAt: new Date(200) });
  expect(first.status).toBe("recorded"); expect(second.status).toBe("recorded");
  if (first.status === "recorded" && second.status === "recorded") expect(first.proofId).not.toBe(second.proofId);
});
