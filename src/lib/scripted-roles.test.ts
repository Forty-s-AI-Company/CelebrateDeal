import { describe, expect, it } from "vitest";
import { currentWarmup, projectWarmup, ScriptedCommandSchema } from "./scripted-roles-contract";
import { DanmakuQueue } from "./live-danmaku-contract";

const role = { vendorId: "v", name: "暖場小幫手", avatarUrl: null, isActive: true, isScheduled: true };
const event = { id: "a", role, eventType: "chat_message", triggerSec: 10, message: "🎉" };
describe("warmup projection and bounded timeline", () => {
  it("fails closed for foreign/inactive/unscheduled roles and excludes commerce events", () => {
    expect(projectWarmup(event, "v")?.value).toBe("🎉");
    expect(projectWarmup(event, "other")).toBeNull();
    expect(projectWarmup({ ...event, role: { ...role, isActive: false } }, "v")).toBeNull();
    expect(projectWarmup({ ...event, role: { ...role, isScheduled: false } }, "v")).toBeNull();
    expect(projectWarmup({ ...event, role: null }, "v")).toBeNull();
    for (const eventType of ["flash_sale", "product_spotlight", "purchase", "poll"]) expect(projectWarmup({ ...event, eventType }, "v")).toBeNull();
    expect(projectWarmup({ ...event, message: "a".repeat(161) }, "v")).toBeNull();
    expect(projectWarmup({ ...event, triggerSec: -1 }, "v")).toBeNull();
    expect(projectWarmup({ ...event, role: { ...role, avatarUrl: "https://untrusted.example/avatar.svg" } }, "v")?.avatarUrl).toBeNull();
  });
  it("selects only the current half-open window, never catches up skipped messages", () => {
    const first = projectWarmup(event, "v")!;
    const events = [first, { ...first, id: "b", triggerSec: 20 }];
    expect(currentWarmup(events, 9)).toBeNull();
    expect(currentWarmup(events, 10)?.id).toBe("a");
    expect(currentWarmup(events, 13.5)).toBeNull();
    expect(currentWarmup(events, 100)).toBeNull();
    expect(currentWarmup(events, 21)?.id).toBe("b");
    expect(currentWarmup(events, null)).toBeNull();
  });
  it("uses the same off/hidden/epoch queue boundary for roles", () => {
    const now = Date.now();
    const state = { enabled: true, epoch: "a", since: new Date(now).toISOString() };
    const snapshot = { state, cursor: state.since, items: [{ id: "role", source: "scripted_role" as const, displayName: role.name, value: "🎉", createdAt: state.since }] };
    const queue = new DanmakuQueue();
    queue.accept(snapshot, true, now); expect(queue.next(now)).toBeNull();
    queue.accept(snapshot, true, now); expect(queue.next(now)?.source).toBe("scripted_role");
    queue.accept(snapshot, true, now); expect(queue.next(now)).toBeNull();
    queue.accept({ ...snapshot, state: { ...state, epoch: "stop", enabled: false } }, true, now); expect(queue.next(now)).toBeNull();
    queue.accept(snapshot, false, now); expect(queue.next(now)).toBeNull();
    queue.accept(snapshot, true, now); queue.accept(snapshot, true, now);
    expect(queue.next(now + 3501)).toBeNull();
  });
  it("rejects tenant/source injection and unbounded commands", () => {
    const command = { action: "select", liveId: "live", scriptId: "script", scheduled: true };
    expect(ScriptedCommandSchema.safeParse(command).success).toBe(true);
    expect(ScriptedCommandSchema.safeParse({ ...command, vendorId: "other" }).success).toBe(false);
    expect(ScriptedCommandSchema.safeParse({ ...command, source: "viewer" }).success).toBe(false);
    expect(ScriptedCommandSchema.safeParse({ action: "send", liveId: "live", eventId: "a", requestId: "not-uuid" }).success).toBe(false);
  });
});
