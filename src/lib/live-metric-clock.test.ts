import { describe, expect, it } from "vitest";
import { createMetricClock } from "./live-metric-clock";

const receipt = { anchorAtMs: 10000, serverNowAtMs: 15000, expiresAtMs: 30000, lastElapsedMs: 1000 };
describe("database to monotonic metric clock", () => {
  it("extends only expiry while preserving the original elapsed mapping and uncertainty", () => {
    let now = 1300;
    const clock = createMetricClock(receipt, 100, 300, () => now)!;
    expect(clock.elapsedMs()).toBe(6000);
    expect(clock.extendExpiry(60000)).toBe(true);
    expect(clock.elapsedMs()).toBe(6000); expect(clock.uncertaintyMs).toBe(200);
    expect(clock.remainingMs()).toBe(43800);
    expect(clock.extendExpiry(59999)).toBe(false); expect(clock.extendExpiry(NaN)).toBe(false);
    now = 20000; expect(clock.elapsedMs()).toBe(24700);
  });
  it("cannot renew a permanently invalid monotonic clock", () => {
    const clock = createMetricClock(receipt, 100, 300, () => 200)!;
    expect(clock.elapsedMs()).toBeNaN(); expect(clock.extendExpiry(60000)).toBe(false);
  });
  it("preserves an old session anchor on retry without using browser wall time", () => {
    let now = 300;
    const clock = createMetricClock(receipt, 100, 300, () => now)!;
    expect(clock.uncertaintyMs).toBe(200); expect(clock.elapsedMs()).toBe(5000);
    now = 1300; expect(clock.elapsedMs()).toBe(6000);
  });
  it("stops before the lease could have expired in transit or suspension", () => {
    const clock = createMetricClock(receipt, 100, 300, () => 15100)!;
    expect(clock.elapsedMs()).toBeNaN();
  });
  it("permanently rejects a backwards monotonic clock", () => {
    let now = 299; const clock = createMetricClock(receipt, 100, 300, () => now)!;
    expect(clock.elapsedMs()).toBeNaN(); now = 400; expect(clock.elapsedMs()).toBeNaN();
  });
  it("rejects a database clock behind persisted evidence", () => {
    expect(createMetricClock({ ...receipt, lastElapsedMs: 6000 }, 100, 300, () => 300)).toBeNull();
  });
  it("rejects invalid timing and expired receipts", () => {
    expect(createMetricClock(receipt, 400, 300, () => 300)).toBeNull();
    expect(createMetricClock({ ...receipt, expiresAtMs: 15000 }, 100, 300, () => 300)).toBeNull();
  });
});
