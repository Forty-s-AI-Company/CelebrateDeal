import { beforeEach, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
const ports = vi.hoisted(() => ({ context: vi.fn(), source: vi.fn(), canBind:vi.fn() }));
vi.mock('./live-metric-ingress-source',()=>({canBindMetricIngressSource:ports.canBind}));
vi.mock("./live-metric-version", () => ({ resolveMetricPlaybackContext: ports.context }));
vi.mock("./live-playback-source", () => ({ resolveLivePlaybackSource: ports.source }));
vi.mock("./live-quota-admission", () => ({ hashLiveViewerToken: () => "synthetic-hash" }));
import { resolveTrackedLivePlaybackSource } from "./live-metric-playback-intake";
const input = { vendorId: "v", liveId: "l", token: "a".repeat(43) };
const context = { versionId: "version", expiresAt: new Date(90000) };
beforeEach(() => { vi.resetAllMocks(); ports.context.mockResolvedValue(context); ports.source.mockResolvedValue({ playbackUrl: "https://example.test/a.mp4" });ports.canBind.mockResolvedValue(true); });
function fixture({ active = true, stored = true, total = 0, lossAt = null as Date | null, finalActive = true } = {}) {
  const events: string[] = [];
  const tx = { $executeRaw: vi.fn(async (sql: Prisma.Sql) => { events.push(sql.strings.join("").includes('INSERT') ? "insert" : "update"); return 1; }),
    $queryRaw: vi.fn(async (sql: Prisma.Sql) => {
      const text = sql.strings.join("");
      if (text.includes('"tokenHash"')) return active ? [{ id: "admission" }] : [];
      if (text.includes('AS now')) return [{ now: new Date(1000) }];
      if (text.includes('AS total')) return [{ total }];
      if (text.includes('AS active')) return [{ active: finalActive }];
      if (text.includes('ORDER BY "issuedAt"')) return [{ id: "oldest", lossAt }];
      if (text.includes('SELECT id,"issuedAt","expiresAt"')) return stored ? [{ id: sql.values[0], issuedAt: new Date(1000), expiresAt: new Date(90000) }] : [];
      return [];
    }) };
  const db = { $transaction: vi.fn(async (run: (value: typeof tx) => Promise<unknown>) => { const result = await run(tx); events.push("commit"); return result; }) };
  return { tx, db, events };
}
it("commits the expectation before releasing a source and never stores credential or URL", async () => {
  const { tx, db, events } = fixture();
  const result = await resolveTrackedLivePlaybackSource(db as never, input); events.push("response");
  expect(result).toMatchObject({ metricRequestId: expect.stringMatching(/^[a-f0-9-]{36}$/), metricIssuedAtMs: 1000, metricExpiresAtMs: 90000 });
  expect(events).toEqual(["insert", "commit", "response"]);
  const values = tx.$executeRaw.mock.calls[0][0].values;
  expect(values).not.toContain(input.token); expect(values).not.toContain("https://example.test/a.mp4");
});
it("never resolves or releases a source without a scoped active admission", async () => {
  const { db, tx } = fixture({ active: false });
  expect(await resolveTrackedLivePlaybackSource(db as never, input)).toBeNull();
  expect(ports.source).not.toHaveBeenCalled(); expect(tx.$executeRaw).not.toHaveBeenCalled();
});
it("preserves untracked playback when no configured version exists", async () => {
  ports.context.mockResolvedValue(null); const { db, tx } = fixture();
  expect(await resolveTrackedLivePlaybackSource(db as never, input)).toEqual({ playbackUrl: "https://example.test/a.mp4" });
  expect(tx.$executeRaw).not.toHaveBeenCalled(); expect(ports.context).toHaveBeenCalledTimes(2);
});
it('treats a stale collection binding as a context race while leaving canonical admission unchanged',async()=>{
 ports.context.mockResolvedValue(null);const {db,tx}=fixture();
 const binding={vendorId:'vendor',liveId:'live',versionId:'version',runId:'10000000-0000-4000-8000-000000000001',frameId:'10000000-0000-4000-8000-000000000002',kind:'playback' as const,method:'GET' as const,target:'/api/live-playback-source',format:1 as const};
 expect(await resolveTrackedLivePlaybackSource(db as never,input,binding)).toBeNull();expect(tx.$executeRaw).not.toHaveBeenCalled();
});
it("refuses changed version or newly configured collection after source resolution", async () => {
  for (const initial of [null, context]) {
    ports.context.mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...context, versionId: "new-version" });
    const { db, tx } = fixture(); expect(await resolveTrackedLivePlaybackSource(db as never, input)).toBeNull();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  }
});
it("never returns a source when the durable insert did not produce an expectation", async () => {
  const { db, events } = fixture({ stored: false });
  await expect(resolveTrackedLivePlaybackSource(db as never, input)).rejects.toThrow("Playback intake unavailable");
  expect(events).toEqual(["insert"]);
});
it("rolls back the expectation if admission expires before the source response decision", async () => {
  const { db, events } = fixture({ finalActive: false });
  await expect(resolveTrackedLivePlaybackSource(db as never, input)).rejects.toMatchObject({ code: "not_authorized" });
  expect(events).toEqual(["insert"]);
});
it("persists a bounded loss marker at quota and keeps playback without fabricating a request id", async () => {
  const { db, tx } = fixture({ total: 64 });
  expect(await resolveTrackedLivePlaybackSource(db as never, input)).toEqual({ playbackUrl: "https://example.test/a.mp4" });
  expect(tx.$executeRaw).toHaveBeenCalledTimes(1); expect(tx.$executeRaw.mock.calls[0][0].strings.join("")).toContain('SET "lossAt"');
  const again = fixture({ total: 64, lossAt: new Date(1000) });
  await resolveTrackedLivePlaybackSource(again.db as never, input); expect(again.tx.$executeRaw).not.toHaveBeenCalled();
});
