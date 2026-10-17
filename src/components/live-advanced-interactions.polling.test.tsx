import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const hooks = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)>, setters: [] as Array<ReturnType<typeof vi.fn>> }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: <T,>(value: T | (() => T)) => {
    const setter = vi.fn(); hooks.setters.push(setter);
    return [typeof value === "function" ? (value as () => T)() : value, setter];
  },
  useRef: <T,>(value: T) => ({ current: value }),
  useMemo: <T,>(factory: () => T) => factory(),
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));
import { interactionRetryDelay, LiveAdvancedInteractions } from "./live-advanced-interactions";

let cleanup: Array<() => void> = [];
beforeEach(() => {
  vi.useFakeTimers();
  hooks.effects = [];
  hooks.setters = [];
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});
afterEach(() => {
  cleanup.forEach(fn => fn()); cleanup = [];
  vi.useRealTimers(); vi.unstubAllGlobals();
});

function mountPolling(scripted: boolean) {
  const wrapper = LiveAdvancedInteractions({ vendorId: "synthetic-vendor", liveId: "synthetic-live", enabled: true, currentSeconds: 1,
    events: scripted ? [{ id: "synthetic-event", eventType: "poll", triggerSec: 0, title: "Synthetic", metadata: { kind: "poll", durationSec: 60 } }] : [],
  })!;
  // Execute the actual component effects with a deterministic hook/timer harness.
  const child = wrapper.props.children as ReactElement<Record<string, unknown>>;
  (child.type as (props: Record<string, unknown>) => unknown)(child.props);
  for (const effect of hooks.effects) { const stop = effect(); if (stop) cleanup.push(stop); }
}

describe("interaction polling backoff", () => {
  it.each([409, 500, "network", 429, 503] as const)("keeps the scripted run only during explicit backoff: %s", async (status) => {
    let opens = 0;
    const scriptedRun = { id: "scripted-A" };
    const manualRun = { id: "manual-B" };
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return Response.json({ runs: [manualRun] });
      if (++opens === 1) return Response.json({ run: scriptedRun });
      if (status === "network") throw new Error("Synthetic network failure");
      return new Response(null, { status, headers: { "Retry-After": "30" } });
    }));
    mountPolling(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(hooks.setters[1]).toHaveBeenLastCalledWith(scriptedRun);
    await vi.advanceTimersByTimeAsync(2000);
    expect(hooks.setters[1]).toHaveBeenLastCalledWith(status === 429 || status === 503 ? scriptedRun : manualRun);
  });
  it.each([429, 503])("honors Retry-After for GET %i and cancels on unmount", async (status) => {
    const fetchMock = vi.fn(async () => new Response(null, { status, headers: { "Retry-After": "60" } }));
    vi.stubGlobal("fetch", fetchMock); mountPolling(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    cleanup.forEach(fn => fn()); cleanup = [];
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([429, 503])("backs off scripted POST %i while GET continues", async (status) => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? new Response(null, { status, headers: { "Retry-After": "30" } })
      : Response.json({ runs: [], spotlight: { id: "synthetic-question", body: "Synthetic", displayName: null } }));
    vi.stubGlobal("fetch", fetchMock); mountPolling(true);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method !== "POST")).toHaveLength(15);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method !== "POST")).toHaveLength(16);
  });
  it("retains the normal two-second poll after successful responses", async () => {
    const fetchMock = vi.fn(async () => Response.json({ runs: [], spotlight: null }));
    vi.stubGlobal("fetch", fetchMock); mountPolling(false);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([null, "garbage", "-1", "0"])("uses a safe fallback for invalid retry value %s", (header) => {
    expect(interactionRetryDelay(new Response(null, { status: 503, headers: header === null ? {} : { "Retry-After": header } }))).toBe(30_000);
  });
  it("supports dates and prevents timer overflow or sub-poll retries", () => {
    vi.setSystemTime(new Date("2026-10-14T00:00:00Z"));
    expect(interactionRetryDelay(new Response(null, { status: 429, headers: { "Retry-After": "Wed, 14 Oct 2026 00:01:00 GMT" } }))).toBe(60_000);
    expect(interactionRetryDelay(new Response(null, { status: 429, headers: { "Retry-After": "1" } }))).toBe(2_000);
    expect(interactionRetryDelay(new Response(null, { status: 503, headers: { "Retry-After": "Wed, 14 Oct 2037 00:00:00 GMT" } }))).toBe(60_000);
    expect(interactionRetryDelay(new Response(null, { status: 503, headers: { "Retry-After": "9999999999" } }))).toBe(60_000);
  });
});
