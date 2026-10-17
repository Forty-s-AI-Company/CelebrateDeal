import { describe, expect, it, vi } from "vitest";
import { createMetricVisitClient, type MetricVisitLock } from "./live-metric-visit-client";
const eventId = "10000000-0000-4000-8000-000000000001";
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const prepared = () => json({ ok: true, prepared: true, versionId: "version" });
const receipt = () => json({ ok: true, eventId, versionId: "version" });
const lock: MetricVisitLock = async (_name, _signal, run) => run();
describe("browser visit driver", () => {
  it("prepares before collecting and coalesces repeated calls", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(prepared()).mockResolvedValueOnce(receipt());
    const client = createMetricVisitClient("v", "l", { fetcher, lock, eventId });
    const first = client.collect(); expect(client.collect()).toBe(first);
    expect(await first).toEqual({ status: "recorded", versionId: "version" });
    expect(await client.collect()).toEqual({ status: "recorded", versionId: "version" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ action: "prepare", eventId });
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ action: "visit", eventId });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: "same-origin", cache: "no-store" });
  });
  it("keeps the event ID after a lost visit response", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(prepared()).mockRejectedValueOnce(new Error("synthetic network loss"))
      .mockResolvedValueOnce(prepared()).mockResolvedValueOnce(receipt());
    const client = createMetricVisitClient("v", "l", { fetcher, lock, eventId });
    expect(await client.collect()).toEqual({ status: "unavailable", retryable: true });
    expect((await client.collect()).status).toBe("recorded");
    expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[3][1].body);
  });
  it("keeps the logical event ID after losing preparation and does not send an unprepared visit",async()=>{
    const fetcher=vi.fn().mockRejectedValueOnce(new Error('synthetic preparation response loss'))
      .mockResolvedValueOnce(prepared()).mockResolvedValueOnce(receipt());
    const client=createMetricVisitClient('v','l',{fetcher,lock,eventId});
    expect(await client.collect()).toEqual({status:'unavailable',retryable:true});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await client.collect()).status).toBe('recorded');
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({action:'visit',eventId});
  });
  it("does not retry a lost event against a different content version", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(prepared()).mockRejectedValueOnce(new Error("synthetic loss"))
      .mockResolvedValueOnce(json({ ok: true, prepared: true, versionId: "other" }));
    const client = createMetricVisitClient("v", "l", { fetcher, lock, eventId });
    await client.collect(); expect(await client.collect()).toEqual({ status: "unavailable", retryable: false });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("uses one lock name for the same tenant/live across client instances", async () => {
    const names: string[] = []; let tail = Promise.resolve(); let active = 0;
    const serial: MetricVisitLock = (name, _signal, run) => {
      names.push(name); const result = tail.then(run); tail = result.then(() => undefined, () => undefined); return result;
    };
    const fetcher = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.action === "prepare") { active++; expect(active).toBe(1); return prepared(); }
      active--; return json({ ok: true, eventId: body.eventId, versionId: "version" });
    });
    const a = createMetricVisitClient("v", "l", { fetcher, lock: serial, eventId });
    const b = createMetricVisitClient("v", "l", { fetcher, lock: serial, eventId: "10000000-0000-4000-8000-000000000002" });
    expect((await Promise.all([a.collect(), b.collect()])).every(result => result.status === "recorded")).toBe(true);
    expect(names[0]).toBe(names[1]); expect(active).toBe(0);
  });
  it.each([403, 404, 409, 429, 503])("handles prepare failure %s without sending a visit", async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));
    expect(await createMetricVisitClient("v", "l", { fetcher, lock, eventId }).collect()).toEqual({ status: "unavailable", retryable: status === 429 || status >= 500 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('retains a valid matched receipt even when the timeout fires during response parsing',async()=>{
    vi.useFakeTimers();
    try{
      const fetcher=vi.fn().mockResolvedValueOnce(prepared()).mockResolvedValueOnce({ok:true,json:async()=>{
        await vi.advanceTimersByTimeAsync(1);return {ok:true,eventId,versionId:'version'};
      }});
      const client=createMetricVisitClient('v','l',{fetcher,lock,eventId,timeoutMs:1});
      expect(await client.collect()).toEqual({status:'recorded',versionId:'version'});
      expect(await client.collect()).toEqual({status:'recorded',versionId:'version'});expect(fetcher).toHaveBeenCalledTimes(2);
    }finally{vi.useRealTimers();}
  });
  it('retries a timeout after preparation with the same event rather than permanently giving up',async()=>{
    vi.useFakeTimers();
    try{
      const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>{
        await vi.advanceTimersByTimeAsync(1);return {ok:true,prepared:true,versionId:'version'};
      }}).mockResolvedValueOnce(prepared()).mockResolvedValueOnce(receipt());
      const client=createMetricVisitClient('v','l',{fetcher,lock,eventId,timeoutMs:1});
      expect(await client.collect()).toEqual({status:'unavailable',retryable:true});expect(fetcher).toHaveBeenCalledTimes(1);
      expect((await client.collect()).status).toBe('recorded');
      expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    }finally{vi.useRealTimers();}
  });
});
