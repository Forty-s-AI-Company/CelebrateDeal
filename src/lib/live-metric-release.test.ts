import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdmissionReleaseRegistry, releaseAfterMetricClose } from "./live-metric-release";

afterEach(() => vi.useRealTimers());
describe("metric close before admission release", () => {
  it("releases once when two same-scope owners leave together", async () => {
    const registry = createAdmissionReleaseRegistry(); const a = registry.acquire("same"); const b = registry.acquire("same");
    const release = vi.fn(async () => undefined);
    await Promise.all([a(async () => undefined, release), b(async () => undefined, release)]);
    expect(release).toHaveBeenCalledOnce();
  });
  it("suppresses old pending release when the same scope remounts", async () => {
    const registry = createAdmissionReleaseRegistry();
    const oldOwner = registry.acquire("vendor/live");
    let finish!: () => void; const release = vi.fn(async () => undefined);
    const pending = oldOwner(() => new Promise<void>((resolve) => { finish = resolve; }), release);
    const newOwner = registry.acquire("vendor/live");
    finish(); await pending; expect(release).not.toHaveBeenCalled();
    await newOwner(async () => undefined, release); expect(release).toHaveBeenCalledOnce();
  });
  it("suppresses an older release even when the replacement has already unmounted", async () => {
    const registry = createAdmissionReleaseRegistry(); const oldOwner = registry.acquire("same");
    let finish!: () => void; const oldRelease = vi.fn(async () => undefined);
    const pending = oldOwner(() => new Promise<void>((resolve) => { finish = resolve; }), oldRelease);
    const newOwner = registry.acquire("same"); const newRelease = vi.fn(async () => undefined);
    await newOwner(async () => undefined, newRelease);
    finish(); await pending; expect(oldRelease).not.toHaveBeenCalled(); expect(newRelease).toHaveBeenCalledOnce();
  });
  it("keeps separate scopes independent and cleanup idempotent", async () => {
    const registry = createAdmissionReleaseRegistry(); const a = registry.acquire("a"); const b = registry.acquire("b");
    const close = vi.fn(async () => undefined); const release = vi.fn(async () => undefined);
    await Promise.all([a(close, release), a(close, release)]);
    expect(close).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
    await b(close, release); expect(release).toHaveBeenCalledTimes(2);
  });
  it("captures the old cleanup immediately and releases only after it finishes", async () => {
    let finish!: () => void;
    const old = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    let current = old;
    const release = vi.fn(async () => undefined);
    const task = releaseAfterMetricClose(() => current(), release);
    current = vi.fn(async () => undefined);
    expect(old).toHaveBeenCalledOnce(); expect(current).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
    finish(); await task; expect(release).toHaveBeenCalledOnce(); expect(current).not.toHaveBeenCalled();
  });
  it("bounds a hanging close and does not release twice on late completion", async () => {
    vi.useFakeTimers(); let finish!: () => void;
    const release = vi.fn(async () => undefined);
    const task = releaseAfterMetricClose(() => new Promise<void>((resolve) => { finish = resolve; }), release);
    await vi.advanceTimersByTimeAsync(9999); expect(release).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await task; expect(release).toHaveBeenCalledOnce();
    finish(); await Promise.resolve(); expect(release).toHaveBeenCalledOnce();
  });
  it.each(["sync", "async"])("still releases after %s cleanup failure", async (kind) => {
    const release = vi.fn(async () => undefined);
    await releaseAfterMetricClose(() => { if (kind === "sync") throw new Error("failure"); return Promise.reject(new Error("failure")); }, release);
    expect(release).toHaveBeenCalledOnce();
  });
  it("contains release failures", async () => {
    await expect(releaseAfterMetricClose(async () => undefined, async () => { throw new Error("network"); })).resolves.toBeUndefined();
  });
});
