import { describe, expect, it } from "vitest";
import { evaluateVideoCompletion, evaluatePostCompletionOrder, POST_COMPLETION_ORDER_WINDOW_MS } from "./live-metric-contract";

describe("approved unique video completion rule", () => {
  it.each([[89999, false], [90000, true], [100000, true]])("coverage %i respects the exact90percent threshold", (endMs, completed) => {
    expect(evaluateVideoCompletion(100000, [{ startMs: 0, endMs }])).toEqual({ status: "available", coveredMs: endMs, completed });
  });
  it("unions unordered overlaps without filling gaps or mutating inputs", () => {
    const intervals = Object.freeze([Object.freeze({ startMs: 60000, endMs: 90000 }), Object.freeze({ startMs: 0, endMs: 50000 }), Object.freeze({ startMs: 10000, endMs: 50000 })]);
    expect(evaluateVideoCompletion(100000, intervals)).toEqual({ status: "available", coveredMs: 80000, completed: false });
    expect(intervals[0].startMs).toBe(60000);
  });
  it("does not turn repeated viewing into completion", () => {
    expect(evaluateVideoCompletion(100000, Array(10).fill({ startMs: 0, endMs: 20000 }))).toEqual({ status: "available", coveredMs: 20000, completed: false });
  });
  it("distinguishes known zero viewing from unknown evidence", () => {
    expect(evaluateVideoCompletion(100000, [])).toEqual({ status: "available", coveredMs: 0, completed: false });
    expect(evaluateVideoCompletion(100000, null)).toEqual({ status: "unavailable", reason: "missing_data" });
    expect(evaluateVideoCompletion(null, [])).toEqual({ status: "unavailable", reason: "missing_data" });
  });
  it.each([0, -1, NaN, Infinity, 1.5])("rejects invalid duration %s", (duration) => {
    expect(evaluateVideoCompletion(duration, [])).toEqual({ status: "unavailable", reason: "invalid_data" });
  });
  it.each([{startMs:-1,endMs:50},{startMs:60,endMs:50},{startMs:0,endMs:101},{startMs:0,endMs:NaN}])("rejects malformed intervals instead of clipping evidence", (interval) => {
    expect(evaluateVideoCompletion(100, [interval])).toEqual({ status: "unavailable", reason: "invalid_data" });
  });
});

describe("approved post-completion order window", () => {
  const completedAt = 1700000000000;
  it.each([[-1,false],[0,true],[POST_COMPLETION_ORDER_WINDOW_MS,true],[POST_COMPLETION_ORDER_WINDOW_MS+1,false]])("elapsed %i has eligibility %s", (elapsed, qualifies) => {
    expect(evaluatePostCompletionOrder(completedAt, { establishedAtMs: completedAt+elapsed, cancelled: false })).toEqual({ status: "available", qualifies });
  });
  it("excludes cancelled orders", () => {
    expect(evaluatePostCompletionOrder(completedAt, { establishedAtMs: completedAt+1, cancelled: true })).toEqual({ status: "available", qualifies: false });
  });
  it("does not guess missing completion, establishment or cancellation state", () => {
    expect(evaluatePostCompletionOrder(null, { establishedAtMs: completedAt, cancelled: false }).status).toBe("unavailable");
    expect(evaluatePostCompletionOrder(completedAt, { establishedAtMs: null, cancelled: false }).status).toBe("unavailable");
    expect(evaluatePostCompletionOrder(completedAt, { establishedAtMs: completedAt, cancelled: null }).status).toBe("unavailable");
  });
  it.each([NaN, Infinity, -1, 1.2, Number.MAX_SAFE_INTEGER])("rejects invalid timestamps %s", (value) => {
    expect(evaluatePostCompletionOrder(value, { establishedAtMs: completedAt, cancelled: false })).toEqual({ status: "unavailable", reason: "invalid_data" });
    expect(evaluatePostCompletionOrder(completedAt, { establishedAtMs: value, cancelled: false })).toEqual({ status: "unavailable", reason: "invalid_data" });
  });
});

describe("runtime boundary validation", () => {
  it.each([undefined, 0, "false", {}, []])("never qualifies an unvalidated cancellation value %j", (cancelled) => {
    const order = { establishedAtMs: 1000, cancelled } as unknown as Parameters<typeof evaluatePostCompletionOrder>[1];
    expect(evaluatePostCompletionOrder(1000, order).status).toBe("unavailable");
  });
  it.each([undefined, {}, [null], [undefined], [0], new Array(3)])("does not throw on malformed interval input %j", (value) => {
    expect(evaluateVideoCompletion(1000, value as unknown as Parameters<typeof evaluateVideoCompletion>[1]).status).toBe("unavailable");
  });
});
