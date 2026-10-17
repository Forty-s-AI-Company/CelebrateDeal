import { expect, it, vi } from "vitest";
import { readMetricOrderAuditPage, withMetricOrderAuditContext } from "./live-metric-order-audit";
const request = { vendorId: "v", liveId: "l", versionId: "version", startAt: new Date(0), endAt: new Date(100), afterId: null, take: 10 };
const settings = [{ isolation: "repeatable read", readOnly: "on" }];
const context = [{ sourceRevision: BigInt(1), orderRevision: BigInt(2), registrationRevision: BigInt(3), tenantRevision: BigInt(4) }];
it("counts once for same-scope pages and discards the facade cache on exit", async () => {
  const query = vi.fn().mockResolvedValueOnce(settings).mockResolvedValueOnce(context).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  const tx = { $queryRaw: query } as unknown as Parameters<typeof readMetricOrderAuditPage>[0];
  let escaped = tx;
  await withMetricOrderAuditContext(tx, request, async snapshot => {
    escaped = snapshot;
    await readMetricOrderAuditPage(snapshot, request);
    await readMetricOrderAuditPage(snapshot, { ...request, afterId: "cursor" });
  });
  expect(query).toHaveBeenCalledTimes(4);
  query.mockResolvedValueOnce(settings).mockResolvedValueOnce(context).mockResolvedValueOnce([]);
  await readMetricOrderAuditPage(escaped, request);
  expect(query).toHaveBeenCalledTimes(7);
});
it("never reuses a cached scope for a different tenant or time window", async () => {
  for (const changed of [{ ...request, vendorId: "foreign" }, { ...request, endAt: new Date(200) }]) {
    const query = vi.fn().mockResolvedValueOnce(settings).mockResolvedValueOnce(context).mockResolvedValueOnce(settings).mockResolvedValueOnce([]);
    const tx = { $queryRaw: query } as unknown as Parameters<typeof readMetricOrderAuditPage>[0];
    await withMetricOrderAuditContext(tx, request, async snapshot => {
      expect(await readMetricOrderAuditPage(snapshot, changed)).toEqual({ status: "unavailable", reason: "scope_or_window_unavailable" });
    });
    expect(query).toHaveBeenCalledTimes(4);
  }
});
it("does not enter the callback on a writable transaction", async () => {
  const tx = { $queryRaw: vi.fn().mockResolvedValue([{ isolation: "repeatable read", readOnly: "off" }]) } as unknown as Parameters<typeof readMetricOrderAuditPage>[0];
  const callback = vi.fn();
  await expect(withMetricOrderAuditContext(tx, request, callback)).rejects.toThrow("read-only repeatable-read");
  expect(callback).not.toHaveBeenCalled();
});
