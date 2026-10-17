import { describe, expect, it, vi } from "vitest";
import { createMetricCollector } from "./live-metric-collector";
import { createMetricHttpTransport } from "./live-metric-transport";

const requestId = "de305d54-75b4-431b-adb2-eb6b9e546014";
const receipt = { ok: true as const, sessionId: "s", versionId: "v", anchorAtMs: 10000, serverNowAtMs: 10000,
  expiresAtMs: 100000, durationMs: 60000, lastSequence: -1, lastElapsedMs: 0 };
function media() { return Object.assign(new EventTarget(), { currentTime: 0, playbackRate: 1, readyState: 4, paused: false, ended: false, seeking: false }); }
function fixture() {
  const append = vi.fn(async (rows: readonly { sequence: number }[]) => ({ ok: true as const, lastSequence: rows.at(-1)!.sequence }));
  const close = vi.fn(async () => ({ terminal: true }));
  const http = { open: vi.fn(async () => receipt), session: vi.fn(() => ({ append, close })) };
  return { http, append, close };
}
describe("metric collector lifecycle", () => {
  it("renews the same nonce without restarting the original elapsed clock or sequence", async () => {
    const f = fixture(); let time = 100; const video = media();
    f.http.open.mockResolvedValueOnce({ ...receipt, durationMs: 120000 }).mockResolvedValueOnce({ ...receipt, durationMs: 120000, serverNowAtMs: 70000, expiresAtMs: 160000 });
    const c = createMetricCollector(f.http, requestId, video, () => time);
    await c.tick(); time = 60100; await c.tick();
    time = 89100; video.currentTime = 89; video.dispatchEvent(new Event("timeupdate"));
    time = 90100; video.currentTime = 90; video.dispatchEvent(new Event("timeupdate"));
    time = 91100; video.currentTime = 91; video.dispatchEvent(new Event("timeupdate"));
    await c.finish();
    expect(f.http.open.mock.calls).toEqual([[requestId], [requestId]]);
    expect(f.append.mock.calls[0][0]).toMatchObject([
      { sequence: 0, startElapsedMs: 89000, endElapsedMs: 90000 },
      { sequence: 1, startElapsedMs: 90000, endElapsedMs: 91000 },
    ]);
    expect(c.state().delivery?.terminal).toBe(true);
  });
  it("coalesces concurrent renewals and waits for renewal before closing", async () => {
    const f = fixture(); let time = 100;
    const c = createMetricCollector(f.http, requestId, media(), () => time); await c.tick();
    let resolve!: (value: typeof receipt) => void;
    f.http.open.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    time = 60100; const a = c.tick(), b = c.tick(), end = c.finish();
    expect(f.http.open).toHaveBeenCalledTimes(2); expect(f.close).not.toHaveBeenCalled();
    resolve({ ...receipt, serverNowAtMs: 70000, expiresAtMs: 160000 });
    await Promise.all([a, b, end]); expect(f.close).toHaveBeenCalledTimes(1);
  });
  it("leaves delivery incomplete on renewal identity mismatch", async () => {
    const f = fixture(); let time = 100;
    const c = createMetricCollector(f.http, requestId, media(), () => time); await c.tick();
    f.http.open.mockResolvedValueOnce({ ...receipt, sessionId: "foreign" });
    time = 60100; await c.tick(); await c.finish();
    expect(c.state()).toMatchObject({ disabled: true, delivery: { collectionLost: true, terminal: false } });
    expect(f.close).not.toHaveBeenCalled();
  });
  it("keeps the old expiry on transient failure and abandons after that bound", async () => {
    const f = fixture(); let time = 100;
    const c = createMetricCollector(f.http, requestId, media(), () => time); await c.tick();
    f.http.open.mockRejectedValue(new Error("temporary")); time = 60100; await c.tick();
    expect(c.state().disabled).toBe(false);
    time = 90100; await c.tick(); await c.finish();
    expect(c.state().delivery?.collectionLost).toBe(true); expect(f.close).not.toHaveBeenCalled();
  });
  it("does not turn an ended and sealed delivery into loss after a late renewal failure", async () => {
    const f = fixture(); let time = 100; const video = media();
    const c = createMetricCollector(f.http, requestId, video, () => time); await c.tick();
    let reject!: (reason: Error) => void;
    f.http.open.mockImplementationOnce(() => new Promise<typeof receipt>((_resolve, no) => { reject = no; }));
    time = 60100; const pending = c.tick();
    video.ended = true; video.dispatchEvent(new Event("ended"));
    time = 90100; reject(new Error("late timeout")); await pending; await c.finish();
    expect(c.state().delivery).toMatchObject({ terminal: true, collectionLost: false });
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it("closes an in-flight issuance when the viewer leaves before it returns", async () => {
    const f = fixture(); let resolve!: (value: typeof receipt) => void;
    f.http.open.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const collector = createMetricCollector(f.http, requestId, media(), () => 100);
    const opening = collector.tick(); const closing = collector.finish(); resolve(receipt);
    await Promise.all([opening, closing]);
    expect(f.close).toHaveBeenCalledExactlyOnceWith(-1); expect(f.append).not.toHaveBeenCalled();
    expect(collector.state().stopped).toBe(true);
  });
  it("retries a lost issuance response with the identical request ID", async () => {
    const f = fixture(); f.http.open.mockRejectedValueOnce(new Error("network"));
    const collector = createMetricCollector(f.http, requestId, media(), () => 100);
    await collector.tick(); await collector.tick();
    expect(f.http.open.mock.calls).toEqual([[requestId], [requestId]]);
    await collector.finish();
  });
  it("does not repeatedly issue after unavailable collection", async () => {
    const http = { open: vi.fn(async () => null), session: vi.fn() };
    const collector = createMetricCollector(http, requestId, media(), () => 100);
    await collector.tick(); await collector.tick(); expect(http.open).toHaveBeenCalledTimes(1);
    expect(collector.state().disabled).toBe(true);
  });
  it("runs issuance, sampling, append and close through the real HTTP transport", async () => {
    const bodies: Array<{ path: string; body: Record<string, unknown> }> = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input); const body = JSON.parse(init!.body as string); bodies.push({ path, body });
      const result = path.endsWith("sessions") ? receipt : path.endsWith("intervals")
        ? { ok: true, accepted: 1, replayed: 0, lastSequence: 0 }
        : { ok: true, sessionId: "s", finalSequence: 0, lastSequence: 0, deliveryComplete: true, appendOpen: false, closedAtMs: 12000 };
      return new Response(JSON.stringify(result));
    });
    let time = 100; const video = media();
    const collector = createMetricCollector(createMetricHttpTransport("v", "l", fetcher), requestId, video, () => time);
    await collector.tick(); time = 1100; video.currentTime = 1; video.dispatchEvent(new Event("timeupdate"));
    await collector.finish();
    expect(bodies.map((value) => value.path.split("/").at(-1))).toEqual(["sessions", "intervals", "close"]);
    expect(bodies[1].body).toMatchObject({ sessionId: "s", segments: [{ sequence: 0, startElapsedMs: 0, endElapsedMs: 1000 }] });
    expect(collector.state().delivery?.terminal).toBe(true); expect(video.paused).toBe(false);
  });
});
