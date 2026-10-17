import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { readMetricReportContext, withMetricOrderRevision } from "./live-metric-report-reader";
const scope = { vendorId: "vendor", liveId: "live", versionId: "version", reportId: "report", workerId: "worker" };
const report = { isolation: "repeatable read", windowStartAt: new Date(0), windowEndAt: new Date(10), mode: "replay", durationMs: 10, collectionEnabled: true, collectionStartedAt: new Date(0) };
describe("transaction-scoped order revision", () => {
  it("reuses one count only inside the owned facade and retains lease checks", async () => {
    const query = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ isolation: "repeatable read", readOnly: "on", revision: BigInt(7) }]).mockResolvedValue([report]);
    const original = { $queryRaw: query };
    let captured: Pick<Prisma.TransactionClient, "$queryRaw"> = original;
    await withMetricOrderRevision(original, scope, async snapshot => {
      captured = snapshot;
      await readMetricReportContext(snapshot, scope);
      await readMetricReportContext(snapshot, scope);
      await readMetricReportContext(snapshot, { ...scope, liveId: "other" });
    });
    const sql = (index: number) => query.mock.calls[index][0].strings.join("");
    expect(sql(0)).toBe("SET TRANSACTION READ ONLY");
    expect(sql(1)).toContain("wp20_metric_order_window_revision");
    for (const index of [2, 3]) {
      expect(sql(index)).not.toContain("wp20_metric_order_window_revision");
      expect(query.mock.calls[index][0].values).toContain(BigInt(7));
      expect(sql(index)).toContain('r."leaseExpiresAt">clock_timestamp()');
    }
    expect(sql(4)).toContain("wp20_metric_order_window_revision");
    await readMetricReportContext(captured, scope);
    await readMetricReportContext(original, scope);
    expect(sql(5)).toContain("wp20_metric_order_window_revision");
    expect(sql(6)).toContain("wp20_metric_order_window_revision");
  });
  it.each(["read committed", "serializable"])("rejects %s rather than caching unstable input", async isolation => {
    const query = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ isolation, readOnly: "on", revision: BigInt(1) }]);
    const read = vi.fn();
    await expect(withMetricOrderRevision({ $queryRaw: query }, scope, read)).rejects.toThrow("read-only repeatable-read");
    expect(read).not.toHaveBeenCalled();
  });
  it("removes cached state after a callback failure", async () => {
    const query = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ isolation: "repeatable read", readOnly: "on", revision: BigInt(2) }]).mockResolvedValue([report]);
    let captured: Pick<Prisma.TransactionClient, "$queryRaw"> = { $queryRaw: query };
    await expect(withMetricOrderRevision(captured, scope, async snapshot => { captured = snapshot; throw new Error("synthetic"); })).rejects.toThrow("synthetic");
    await readMetricReportContext(captured, scope);
    expect(query.mock.calls[2][0].strings.join("")).toContain("wp20_metric_order_window_revision");
  });
});

it.each([{ reportId: "another-report" }, { versionId: "another-version" }])("does not reuse a window revision across report identity %j", async changed => {
  const query = vi.fn().mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ isolation: "repeatable read", readOnly: "on", revision: BigInt(7) }])
    .mockResolvedValue([report]);
  await withMetricOrderRevision({ $queryRaw: query }, scope, async snapshot => {
    await readMetricReportContext(snapshot, { ...scope, ...changed });
  });
  const page = query.mock.calls[2][0];
  expect(page.strings.join("")).toContain("wp20_metric_order_window_revision");
  expect(page.values).not.toContain(BigInt(7));
});
it("requires an existing report window before entering the cached callback", async () => {
  const query = vi.fn().mockResolvedValue([]), read = vi.fn();
  await expect(withMetricOrderRevision({ $queryRaw: query }, scope, read)).rejects.toThrow("read-only repeatable-read");
  expect(read).not.toHaveBeenCalled();
});
