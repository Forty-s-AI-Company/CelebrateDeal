// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampPollInterval,
  errorPollInterval,
  LIVE_UPDATES_RESYNC_EVERY,
  liveUpdatesUrl,
  parseLiveUpdatesPayload,
  subscribeLiveUpdates,
  type LiveUpdatesPayload,
  type LiveUpdatesStatus,
} from "@/lib/live-updates-client";
import { useLiveUpdates } from "@/lib/use-live-updates";

const scope = { vendorId: "v1", liveId: "l1" };
const message = (id: string) => ({ id, source: "viewer", createdAt: "2026-08-17T10:00:00.000Z", body: id, actor: { name: "王小明" } });
const viewer = { canPost: false, displayName: null, reason: "verification_required" };

function okResponse(body: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => body };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    cursor: "cursor-1",
    nextPollMs: 3_000,
    chat: { messages: [message("m1")], reset: false, viewer },
    interactions: { runs: [], spotlight: null },
    ...overrides,
  };
}

const fetchMock = vi.fn();

function requestedUrls() {
  return fetchMock.mock.calls.map(([url]) => new URL(String(url), "https://app.example.test"));
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => okResponse(payload()));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("live updates payload parsing", () => {
  it("accepts the server shape and rejects scripted or malformed chat rows", () => {
    expect(parseLiveUpdatesPayload(payload())).toMatchObject({ cursor: "cursor-1", nextPollMs: 3_000 });
    expect(parseLiveUpdatesPayload(payload({ chat: { messages: [{ ...message("s1"), source: "scheduled" }], reset: false, viewer } }))).toBeNull();
    expect(parseLiveUpdatesPayload(payload({ chat: { messages: [], reset: "no", viewer } }))).toBeNull();
    expect(parseLiveUpdatesPayload(payload({ chat: { messages: [], reset: false, viewer: { canPost: true, displayName: 1, reason: null } } }))).toBeNull();
    expect(parseLiveUpdatesPayload(payload({ interactions: { runs: "none" } }))).toBeNull();
    expect(parseLiveUpdatesPayload({ cursor: 1, nextPollMs: 3_000 })).toBeNull();
    expect(parseLiveUpdatesPayload(null)).toBeNull();
  });

  it("clamps poll hints and backs off failures up to the ceiling", () => {
    expect(clampPollInterval(200)).toBe(2_000);
    expect(clampPollInterval(3_000)).toBe(3_000);
    expect(clampPollInterval(120_000)).toBe(10_000);
    expect([1, 2, 3, 8].map(errorPollInterval)).toEqual([3_000, 6_000, 10_000, 10_000]);
  });

  it("only sends since when chat is requested", () => {
    expect(liveUpdatesUrl({ ...scope, since: "abc", include: { chat: true, interactions: true } })).toBe("/api/live-updates?vendorId=v1&liveId=l1&include=chat%2Cinteractions&since=abc");
    expect(liveUpdatesUrl({ ...scope, since: "abc", include: { chat: false, interactions: true } })).toBe("/api/live-updates?vendorId=v1&liveId=l1&include=interactions");
  });
});

describe("shared live updates channel", () => {
  it("serves chat and interaction subscribers with a single request per cycle", async () => {
    const chat = vi.fn();
    const interactions = vi.fn();
    const stopChat = subscribeLiveUpdates(scope, { include: { chat: true, interactions: false }, onUpdate: chat });
    const stopInteractions = subscribeLiveUpdates(scope, { include: { chat: false, interactions: true }, onUpdate: interactions });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = requestedUrls();
    expect(url.pathname).toBe("/api/live-updates");
    expect(url.searchParams.get("include")).toBe("chat,interactions");
    expect(url.searchParams.get("since")).toBeNull();
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ headers: { "X-CelebrateDeal-Client": "web" }, cache: "no-store" });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(interactions).toHaveBeenCalledTimes(1);
    expect((chat.mock.calls[0]![0] as LiveUpdatesPayload).chat?.messages[0]?.id).toBe("m1");

    stopChat();
    stopInteractions();
  });

  it("sends the cursor from the previous response and follows the server poll hint", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(payload({ cursor: "cursor-1", nextPollMs: 2_000 })))
      .mockResolvedValueOnce(okResponse(payload({ cursor: "cursor-2", nextPollMs: 500 })))
      .mockResolvedValue(okResponse(payload({ cursor: "cursor-3", nextPollMs: 3_000 })));
    const stop = subscribeLiveUpdates(scope, { include: { chat: true, interactions: true }, onUpdate: vi.fn() });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestedUrls()[1]!.searchParams.get("since")).toBe("cursor-1");
    // A 500 ms hint is clamped up to the 2 s minimum.
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requestedUrls()[2]!.searchParams.get("since")).toBe("cursor-2");
    stop();
  });

  it("keeps delivering to other subscribers and keeps polling when one handler throws", async () => {
    const healthy = vi.fn();
    const statuses: LiveUpdatesStatus[] = [];
    const stopBad = subscribeLiveUpdates(scope, { include: { chat: true, interactions: false }, onUpdate: () => { throw new Error("boom"); }, onStatus: () => { throw new Error("boom"); } });
    const stopGood = subscribeLiveUpdates(scope, { include: { chat: false, interactions: true }, onUpdate: healthy, onStatus: (status) => statuses.push(status) });
    await vi.advanceTimersByTimeAsync(0);
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["ok"]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(healthy).toHaveBeenCalledTimes(2);
    stopBad();
    stopGood();
  });

  it("never overlaps requests and stops everything when the last subscriber leaves", async () => {
    let release: (value: unknown) => void = () => {};
    fetchMock.mockImplementationOnce((_url: string, init: { signal: AbortSignal }) => new Promise((resolve, reject) => {
      release = resolve;
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const onUpdate = vi.fn();
    const stop = subscribeLiveUpdates(scope, { include: { chat: true, interactions: false }, onUpdate });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    stop();
    release(okResponse(payload()));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("forgets the cursor once nobody listens and asks for a snapshot again", async () => {
    const stop = subscribeLiveUpdates(scope, { include: { chat: true, interactions: false }, onUpdate: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    const again = subscribeLiveUpdates(scope, { include: { chat: true, interactions: false }, onUpdate: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(requestedUrls()[1]!.searchParams.get("since")).toBeNull();
    again();
  });

  it("gives a chat subscriber that joins later a fresh snapshot instead of the shared cursor", async () => {
    const stopInteractions = subscribeLiveUpdates(scope, { include: { chat: false, interactions: true }, onUpdate: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    const late = vi.fn();
    const stopChat = subscribeLiveUpdates(scope, { include: { chat: true, interactions: false }, onUpdate: late });
    await vi.advanceTimersByTimeAsync(0);
    const last = requestedUrls().at(-1)!;
    expect(last.searchParams.get("include")).toBe("chat,interactions");
    expect(last.searchParams.get("since")).toBeNull();
    expect(late).toHaveBeenCalledTimes(1);
    stopChat();
    stopInteractions();
  });

  it(`ignores the cursor on every ${LIVE_UPDATES_RESYNC_EVERY}th poll so a late-committed row is picked up`, async () => {
    const stop = subscribeLiveUpdates(scope, { include: { chat: true, interactions: false }, onUpdate: vi.fn() });
    await vi.advanceTimersByTimeAsync(3_000 * (LIVE_UPDATES_RESYNC_EVERY + 1));
    const urls = requestedUrls();
    expect(urls.length).toBeGreaterThanOrEqual(LIVE_UPDATES_RESYNC_EVERY);
    urls.slice(0, LIVE_UPDATES_RESYNC_EVERY).forEach((url, index) => {
      const sinceExpected = index !== 0 && index !== LIVE_UPDATES_RESYNC_EVERY - 1;
      expect(url.searchParams.get("since") !== null).toBe(sinceExpected);
    });
    stop();
  });

  it("backs off after failures, recovers, and reports status to subscribers", async () => {
    const statuses: LiveUpdatesStatus[] = [];
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue(okResponse(payload()));
    const stop = subscribeLiveUpdates(scope, { include: { chat: true, interactions: true }, onUpdate: vi.fn(), onStatus: (status) => statuses.push(status) });

    await vi.advanceTimersByTimeAsync(0);
    expect(statuses).toEqual(["error"]);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(["error", "error"]);
    await vi.advanceTimersByTimeAsync(5_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(statuses).toEqual(["error", "error", "ok"]);
    stop();
  });

  it.each([401, 403])("stops polling and reports unauthorized on %i until someone subscribes again", async (status) => {
    fetchMock.mockResolvedValueOnce({ ok: false, status, json: async () => ({}) });
    const statuses: LiveUpdatesStatus[] = [];
    const stop = subscribeLiveUpdates(scope, { include: { chat: true, interactions: true }, onUpdate: vi.fn(), onStatus: (value) => statuses.push(value) });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["unauthorized"]);
    stop();

    const again = subscribeLiveUpdates(scope, { include: { chat: true, interactions: true }, onUpdate: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    again();
  });

  it("restarts from a snapshot after the server rejects the cursor", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(payload({ cursor: "stale" })))
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) })
      .mockResolvedValue(okResponse(payload({ cursor: "fresh" })));
    const stop = subscribeLiveUpdates(scope, { include: { chat: true, interactions: false }, onUpdate: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(requestedUrls()[1]!.searchParams.get("since")).toBe("stale");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(requestedUrls()[2]!.searchParams.get("since")).toBeNull();
    stop();
  });

  it("makes at most 20 requests a minute while idle and 30 while an interaction is active", async () => {
    const idle = subscribeLiveUpdates(scope, { include: { chat: true, interactions: true }, onUpdate: vi.fn() });
    await vi.advanceTimersByTimeAsync(60_000 - 1);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(20);
    idle();

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => okResponse(payload({ nextPollMs: 2_000, interactions: { runs: [{ id: "run-1" }], spotlight: null } })));
    const active = subscribeLiveUpdates(scope, { include: { chat: true, interactions: true }, onUpdate: vi.fn() });
    await vi.advanceTimersByTimeAsync(60_000 - 1);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(30);
    active();
  });
});

describe("useLiveUpdates visibility gate", () => {
  let container: HTMLDivElement;
  let root: Root;

  function Probe({ enabled, onUpdate }: { enabled: boolean; onUpdate: (value: LiveUpdatesPayload) => void }) {
    useLiveUpdates({ ...scope, enabled, chat: true, interactions: true, onUpdate });
    return null;
  }

  function setVisibility(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setVisibility("visible");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    setVisibility("visible");
  });

  it("fetches at once on mount, pauses while hidden, and fetches immediately on return", async () => {
    const onUpdate = vi.fn();
    await act(async () => { root.render(<Probe enabled onUpdate={onUpdate} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    await act(async () => { setVisibility("hidden"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => { setVisibility("visible"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not poll while disabled and stops when disabled later", async () => {
    await act(async () => { root.render(<Probe enabled={false} onUpdate={vi.fn()} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => { root.render(<Probe enabled onUpdate={vi.fn()} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { root.render(<Probe enabled={false} onUpdate={vi.fn()} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("delivers updates to the latest handler without resubscribing", async () => {
    const first = vi.fn();
    const second = vi.fn();
    await act(async () => { root.render(<Probe enabled onUpdate={first} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { root.render(<Probe enabled onUpdate={second} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
