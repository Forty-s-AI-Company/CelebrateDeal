import { describe, expect, it, vi } from "vitest";
import { createMetricDelivery, type DeliverySegment } from "./live-metric-delivery";

const point = (elapsedMs: number) => ({ elapsedMs, mediaMs: elapsedMs, rate: 1, playing: true });
function transport() {
  return { append: vi.fn(async (rows: readonly DeliverySegment[]) => ({ ok: true as const, lastSequence: rows.at(-1)!.sequence })),
    close: vi.fn(async () => ({ terminal: true })) };
}
function populate(queue: ReturnType<typeof createMetricDelivery>, count: number) {
  for (let i = 0; i <= count; i++) queue.sample(point(i * 1000));
}

describe("metric delivery queue", () => {
  it("closes when finish races an empty flush", async () => {
    const t = transport(); const q = createMetricDelivery(t);
    await Promise.all([q.flush(), q.finish()]);
    expect(t.close).toHaveBeenCalledExactlyOnceWith(-1);
  });
  it("closes when finish arrives after the append continuation but before pending cleanup", async () => {
    let acknowledge!: (reply: { ok: true; lastSequence: number }) => void;
    const t = transport();
    t.append.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
    const q = createMetricDelivery(t); populate(q, 1);
    const flushing = q.flush(); await Promise.resolve();
    acknowledge({ ok: true, lastSequence: 0 });
    await Promise.resolve();
    await q.finish(); await flushing;
    expect(t.close).toHaveBeenCalledExactlyOnceWith(0);
    expect(q.state()).toMatchObject({ terminal: true, queued: 0 });
  });
  it("serializes concurrent flush and finish, batches at 20, closes only after all acknowledgements", async () => {
    const t = transport(); const q = createMetricDelivery(t); populate(q, 45);
    await Promise.all([q.flush(), q.flush(), q.finish()]);
    expect(t.append.mock.calls.map(([rows]) => rows.length)).toEqual([20, 20, 5]);
    expect(t.close).toHaveBeenCalledExactlyOnceWith(44);
    expect(q.state()).toMatchObject({ queued: 0, terminal: true });
  });
  it("retries the identical payload after an ambiguous network outcome", async () => {
    const t = transport(); t.append.mockRejectedValueOnce(new Error("network"));
    const q = createMetricDelivery(t); populate(q, 2);
    await q.finish(); expect(t.close).not.toHaveBeenCalled();
    expect(q.state().queued).toBe(2);
    await q.flush(); expect(t.append.mock.calls[1][0]).toEqual(t.append.mock.calls[0][0]);
    expect(q.state().terminal).toBe(true);
  });
  it("drains the retained prefix but never closes a capacity-truncated session as complete", async () => {
    const t = transport(); const q = createMetricDelivery(t, 20); populate(q, 25);
    expect(q.state()).toMatchObject({ queued: 20, finalSequence: 19, capacityReached: true, sealed: true });
    await q.flush(); await q.finish(); await q.flush();
    expect(t.append.mock.calls.flatMap(([rows]) => rows.map(row => row.sequence)))
      .toEqual(Array.from({ length: 20 }, (_, index) => index));
    expect(t.close).not.toHaveBeenCalled();
    expect(q.state()).toMatchObject({ queued: 0, finalSequence: 19, capacityReached: true, sealed: true, terminal: false });
  });
  it("can close an exactly full queue when no segment was lost", async () => {
    const t = transport(); const q = createMetricDelivery(t, 20); populate(q, 20);
    await q.finish();
    expect(t.close).toHaveBeenCalledExactlyOnceWith(19);
    expect(q.state()).toMatchObject({ queued: 0, capacityReached: false, terminal: true });
  });
  it("replays the retained prefix after network failure without clearing the overflow signal", async () => {
    const t = transport(); t.append.mockRejectedValueOnce(new Error("network"));
    const q = createMetricDelivery(t, 20); populate(q, 21);
    await q.finish();
    expect(q.state()).toMatchObject({ queued: 20, capacityReached: true, terminal: false });
    await q.flush();
    expect(t.append.mock.calls[1][0]).toEqual(t.append.mock.calls[0][0]);
    expect(t.close).not.toHaveBeenCalled();
    expect(q.state()).toMatchObject({ queued: 0, capacityReached: true, terminal: false });
  });
  it("rejects a mismatched acknowledgement without falsely closing", async () => {
    const t = transport(); t.append.mockResolvedValueOnce({ ok: true, lastSequence: 9 });
    const q = createMetricDelivery(t); populate(q, 2); await q.finish();
    expect(q.state()).toMatchObject({ rejected: true, queued: 2, terminal: false });
    expect(t.close).not.toHaveBeenCalled();
  });
  it("resets sampling across seeks, pauses and source changes", async () => {
    const t = transport(); const q = createMetricDelivery(t);
    q.sample(point(0)); q.reset(); q.sample(point(1000)); q.sample(point(2000));
    await q.finish(); expect(t.append.mock.calls[0][0]).toEqual([
      { sequence: 0, startElapsedMs: 1000, endElapsedMs: 2000, mediaStartMs: 1000, mediaEndMs: 2000, rate: 1 },
    ]);
  });
  it("retries an unacknowledged close without collecting further segments", async () => {
    const t = transport(); t.close.mockRejectedValueOnce(new Error("network"));
    const q = createMetricDelivery(t); await q.finish(); q.sample(point(0)); q.sample(point(1000));
    await q.flush(); expect(t.close.mock.calls).toEqual([[-1], [-1]]);
    expect(t.append).not.toHaveBeenCalled();
  });
  it("drains retained evidence but never certifies closure after lease loss", async () => {
    const t = transport(); const q = createMetricDelivery(t); populate(q, 2);
    await q.abandon(); await q.finish(); await q.flush();
    expect(t.append).toHaveBeenCalled(); expect(t.close).not.toHaveBeenCalled();
    expect(q.state()).toMatchObject({ queued: 0, collectionLost: true, sealed: true, terminal: false });
  });
});
