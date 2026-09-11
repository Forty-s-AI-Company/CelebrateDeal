import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeInteractionCardPolling } from "./interaction-card-polling";
import type { CardView } from "./interaction-card-contract";

type PollingCallbacks = Parameters<typeof observeInteractionCardPolling>[1];

const card = (id: string): CardView => ({ id, title: id, status: "active", startsAt: null, endsAt: null, ownValue: null,
  configuration: { version: 1, kind: "interaction_card", answerType: "text", visibility: "instructor_only", options: [] } });
const response = (id: string) => new Response(JSON.stringify({ card: card(id) }));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

describe("interaction card polling lifecycle", () => {
  let documentTarget: EventTarget & { hidden: boolean };
  let windowTarget: EventTarget;
  let requests: Array<ReturnType<typeof deferred<Response>> & { signal: AbortSignal }>;
  let events: string[];
  let fetcher: ReturnType<typeof vi.fn>;
  let snapshot: ReturnType<typeof vi.fn<PollingCallbacks['onSnapshot']>>;
  let invalidate: ReturnType<typeof vi.fn<PollingCallbacks['onInvalidate']>>;
  let tick: ReturnType<typeof vi.fn<PollingCallbacks['onTick']>>;
  let stop: (() => void) | undefined;
  const start = () => {
    stop = observeInteractionCardPolling({ vendorId: "vendor /", liveId: "live ?" }, { onSnapshot: snapshot, onInvalidate: invalidate, onTick: tick });
    return stop;
  };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    documentTarget = Object.assign(new EventTarget(), { hidden: false });
    windowTarget = Object.assign(new EventTarget(), { setTimeout, clearTimeout, setInterval, clearInterval });
    vi.stubGlobal("document", documentTarget); vi.stubGlobal("window", windowTarget);
    requests = []; events = []; stop = undefined;
    snapshot = vi.fn<PollingCallbacks['onSnapshot']>(() => { events.push("snapshot"); });
    invalidate = vi.fn<PollingCallbacks['onInvalidate']>(() => { events.push("invalidate"); });
    tick = vi.fn<PollingCallbacks['onTick']>();
    // 模擬請求忽略 abort 後仍不 settle，清理不得依賴 fetch 的 finally。
    fetcher = vi.fn((_url: string, options: RequestInit) => {
      const request = { ...deferred<Response>(), signal: options.signal! };
      request.signal.addEventListener("abort", () => events.push("abort"), { once: true });
      requests.push(request); events.push("fetch"); return request.promise;
    });
    vi.stubGlobal("fetch", fetcher);
  });
  afterEach(() => { stop?.(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("aborts a permanently pending GET at four seconds and recovers on the next poll", async () => {
    start();
    await vi.advanceTimersByTimeAsync(3999);
    expect(fetcher).toHaveBeenCalledOnce(); expect(requests[0]!.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(invalidate).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetcher).toHaveBeenCalledTimes(2);
    requests[1]!.resolve(response("fresh")); await vi.advanceTimersByTimeAsync(0);
    expect(snapshot).toHaveBeenCalledOnce();
    expect(snapshot.mock.calls[0]![0]).toMatchObject({ card: { id: "fresh" }, receivedAt: 4500, roundTripSeconds: 0 });
    requests[0]!.resolve(response("expired")); await vi.advanceTimersByTimeAsync(0);
    expect(snapshot).toHaveBeenCalledOnce();
  });

  it.each(["visibilitychange", "online"])("revokes the snapshot and request before refreshing on %s", async event => {
    start(); requests[0]!.resolve(response("initial")); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1500);
    events.length = 0;
    (event === "visibilitychange" ? documentTarget : windowTarget).dispatchEvent(new Event(event));
    expect(events).toEqual(["invalidate", "abort", "fetch"]);
    expect(invalidate).toHaveBeenLastCalledWith(false);
    // 僅保留輪詢、可見性時鐘與目前請求的 timeout。
    expect(vi.getTimerCount()).toBe(3);
    requests[2]!.resolve(response("new")); await vi.advanceTimersByTimeAsync(0);
    requests[1]!.resolve(response("old")); await vi.advanceTimersByTimeAsync(0);
    expect(snapshot.mock.calls.map(call => call[0].card?.id)).toEqual(["initial", "new"]);
  });

  it("cancels hidden requests and waits until visible before requesting a fresh snapshot", async () => {
    start(); documentTarget.hidden = true;
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(invalidate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetcher).toHaveBeenCalledOnce();
    documentTarget.hidden = false; documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(fetcher).toHaveBeenCalledTimes(2);
    requests[1]!.resolve(response("resumed")); await vi.advanceTimersByTimeAsync(0);
    expect(snapshot).toHaveBeenCalledOnce();
    expect(snapshot.mock.calls[0]![0].card?.id).toBe("resumed");
  });

  it("does not overwrite a new snapshot when an old response body or rejection arrives late", async () => {
    start();
    const body = deferred<{ card: CardView }>();
    requests[0]!.resolve({ ok: true, json: () => body.promise } as Response);
    await vi.advanceTimersByTimeAsync(0);
    windowTarget.dispatchEvent(new Event("online"));
    windowTarget.dispatchEvent(new Event("online"));
    requests[2]!.resolve(response("current")); await vi.advanceTimersByTimeAsync(0);
    invalidate.mockClear();
    body.resolve({ card: card("old-body") }); requests[1]!.reject(new Error("old failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(snapshot).toHaveBeenCalledOnce();
    expect(snapshot.mock.calls[0]![0].card?.id).toBe("current");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("cleans every timer, event listener and active request before pending fetch settles", async () => {
    const documentRemove = vi.spyOn(documentTarget, "removeEventListener");
    const windowRemove = vi.spyOn(windowTarget, "removeEventListener");
    const cleanup = start();
    expect(vi.getTimerCount()).toBe(3);
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
    expect(requests.every(request => request.signal.aborted)).toBe(true);
    expect(documentRemove).toHaveBeenCalledExactlyOnceWith("visibilitychange", expect.any(Function));
    expect(windowRemove).toHaveBeenCalledExactlyOnceWith("online", expect.any(Function));
    snapshot.mockClear(); invalidate.mockClear(); tick.mockClear();
    documentTarget.dispatchEvent(new Event("visibilitychange")); windowTarget.dispatchEvent(new Event("online"));
    requests[0]!.resolve(response("unmounted")); await vi.advanceTimersByTimeAsync(10000);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(snapshot).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled(); expect(tick).not.toHaveBeenCalled();
    cleanup(); expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves encoded scope, the 100ms lease clock and the 1500ms poll cadence", async () => {
    start();
    expect(fetcher.mock.calls[0]![0]).toBe("/api/live-interactions/cards?vendorId=vendor%20%2F&liveId=live%20%3F");
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ cache: "no-store", headers: { "x-celebratedeal-client": "web" } });
    requests[0]!.resolve(response("initial")); await vi.advanceTimersByTimeAsync(0);
    tick.mockClear();
    await vi.advanceTimersByTimeAsync(100);
    expect(tick).toHaveBeenCalledExactlyOnceWith(100);
    await vi.advanceTimersByTimeAsync(1399); expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
