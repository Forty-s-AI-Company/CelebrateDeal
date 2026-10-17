import { Prisma } from "@prisma/client";
import { beforeEach, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("./live-metric-order-audit", () => ({ readMetricOrderAuditPage: read, withMetricOrderAuditContext: (tx: unknown, _scope: unknown, callback: (tx: unknown) => unknown) => callback(tx) }));
import { auditMetricOrderSources } from "./live-metric-order-source-audit";
const scope = { vendorId: "v", liveId: "l", versionId: "version", startAt: new Date(0), endAt: new Date(100) };
const page = (id: string, more: boolean) => ({ status: "available", sourceRevision: BigInt(1), orderRevision: BigInt(2),
  registrationRevision: BigInt(3), tenantRevision: BigInt(4), rows: [{ orderId: id, outcome: "missing_attribution" }], hasMore: more, nextId: id });
const database = () => {
  const tx = { $executeRaw: vi.fn(), $queryRaw: vi.fn() };
  const transaction = vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(tx));
  return { db: { $transaction: transaction } as unknown as Parameters<typeof auditMetricOrderSources>[0], transaction };
};
beforeEach(() => { read.mockReset(); });
it("aggregates pages in one transaction without certifying coverage or exposing order ids", async () => {
  read.mockResolvedValueOnce(page("a", true)).mockResolvedValueOnce(page("b", false));
  const { db, transaction } = database();
  const result = await auditMetricOrderSources(db, scope);
  expect(result).toMatchObject({ status: "enumerated", count: 2, coverage: "unknown", outcomes: { missing_attribution: 2 } });
  expect(result).not.toHaveProperty("rows"); expect(transaction).toHaveBeenCalledTimes(1);
  expect(read.mock.calls[1][1].afterId).toBe("a");
});
it.each([{ rows: 1, pages: 2 }, { rows: 2, pages: 1 }])("discards partial results at budget %j", async limits => {
  read.mockResolvedValueOnce(page("a", true)).mockResolvedValueOnce(page("b", false));
  expect(await auditMetricOrderSources(database().db, scope, limits)).toEqual({ status: "unavailable", reason: "limit_exceeded" });
});
it("rejects a repeated cursor", async () => {
  read.mockResolvedValue(page("a", true));
  await expect(auditMetricOrderSources(database().db, scope)).rejects.toThrow("cursor did not advance");
});
it("rejects a revision change across pages", async () => {
  read.mockResolvedValueOnce(page("a", true)).mockResolvedValueOnce({ ...page("b", false), orderRevision: BigInt(4) });
  await expect(auditMetricOrderSources(database().db, scope)).rejects.toThrow("snapshot revision changed");
});

const knownError = (code: string, meta: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError("synthetic internal diagnostic", { code, clientVersion: "test", meta });
it.each([
  [knownError("P2010", { code: "57014" }), "query_cancelled"],
  [knownError("P2028", { error: "A query cannot be executed on an expired transaction." }), "transaction_expired"],
])("discards partial audit after cancellation or expiry", async (error, reason) => {
  read.mockResolvedValueOnce(page("a", true)).mockRejectedValueOnce(error);
  expect(await auditMetricOrderSources(database().db, scope)).toEqual({ status: "unavailable", reason });
});
it.each([
  knownError("P2010", { code: "42501" }),
  knownError("P2028", { error: "Transaction not found" }),
  new Error("expired transaction"),
])("preserves unrelated failures", async error => {
  read.mockRejectedValueOnce(error);
  await expect(auditMetricOrderSources(database().db, scope)).rejects.toBe(error);
});
