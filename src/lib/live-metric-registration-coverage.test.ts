import { beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const audit = vi.hoisted(() => vi.fn());
vi.mock("./live-metric-registration-source-audit", () => ({ auditMetricRegistrationSources: audit }));
import { publishRegistrationCoverage } from "./live-metric-registration-coverage";
const scope = { vendorId: "v", liveId: "l", versionId: "version", startAt: new Date(0), endAt: new Date(100) };
beforeEach(() => { audit.mockReset().mockResolvedValue({ status: "enumerated", count: 0, projectionCount: 0,
  outcomes: { matched: 0 }, projectionOutcomes: { matched: 0 }, digest: "a".repeat(64) }); });
const failDb = (error: unknown) => ({ $transaction: vi.fn().mockRejectedValue(error) }) as unknown as Parameters<typeof publishRegistrationCoverage>[0];
const sqlError = (code: string, message: string) => new Prisma.PrismaClientKnownRequestError("Database guard rejected write", {
  code: "P2010", clientVersion: "test", meta: { code, message },
});
it("reports a dedicated stale-proof guard as source_changed", async () => {
  await expect(publishRegistrationCoverage(failDb(sqlError("23514", "registration coverage source mismatch")), scope))
    .resolves.toEqual({ status: "source_changed" });
});
it.each([
  ["23514", "unrelated integrity constraint"],
  ["55P03", "registration coverage source mismatch"],
])("preserves unrelated database failures %s", async (code, message) => {
  const error = sqlError(code, message);
  await expect(publishRegistrationCoverage(failDb(error), scope)).rejects.toBe(error);
});
it("does not convert an audit infrastructure failure into a write race", async () => {
  const error = sqlError("23514", "registration coverage source mismatch");
  audit.mockRejectedValue(error);
  const db = failDb(new Error("Writer must not run"));
  await expect(publishRegistrationCoverage(db, scope)).rejects.toBe(error);
  expect(db.$transaction).not.toHaveBeenCalled();
});
