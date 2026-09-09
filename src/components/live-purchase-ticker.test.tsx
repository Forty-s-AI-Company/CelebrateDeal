import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as Array<() => void | (() => void)> }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === "function" ? value(hooks.values[index]) : value;
    }];
  },
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));
import { LivePurchaseTicker } from "./live-purchase-ticker";

function renderTicker() {
  hooks.cursor = 0;
  hooks.effects = [];
  return LivePurchaseTicker({ vendorId: "vendor", liveId: "live", enabled: true });
}

beforeEach(() => {
  vi.useFakeTimers();
  hooks.values = [];
  vi.stubGlobal("window", { setInterval, clearInterval, setTimeout, clearTimeout });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("LivePurchaseTicker", () => {
  it("restarts visibility after a single-item cycle without requiring another purchase", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ broadcasts: [{ buyerMaskedName: "王**", productName: "課程" }] }) }));
    renderTicker();
    const stopPolling = hooks.effects[0]!();
    await vi.advanceTimersByTimeAsync(0);
    renderTicker();
    const stopAnimation = hooks.effects[1]!();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(hooks.values[2]).toBe(false);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(hooks.values[2]).toBe(true);
    expect(hooks.values[1]).toBe(1);
    expect(renderTicker()).not.toBeNull();
    stopPolling?.();
    stopAnimation?.();
  });

  it("ignores a pending poll response after unmount", async () => {
    let resolveResponse!: (value: unknown) => void;
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise((resolve) => { resolveResponse = resolve; })));
    renderTicker();
    const stopPolling = hooks.effects[0]!();
    stopPolling?.();
    resolveResponse({ ok: true, json: async () => ({ broadcasts: [{ productName: "stale" }] }) });
    await vi.advanceTimersByTimeAsync(0);
    expect(hooks.values[0]).toEqual([]);
  });
});
