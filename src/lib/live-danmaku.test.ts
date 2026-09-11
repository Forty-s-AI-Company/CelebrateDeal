import { describe, expect, it } from "vitest";
import { DanmakuQueue, projectDanmaku, type DanmakuSnapshot } from "./live-danmaku-contract";

const config = { version: 1, kind: "interaction_card", answerType: "text", visibility: "public_display", options: [] };
const now = Date.now();
const item = (id: string) => ({ id, value: "666", displayName: "觀眾" as const, createdAt: new Date(now).toISOString() });
const snapshot = (ids: string[], epoch = "one", enabled = true): DanmakuSnapshot => ({ state: { enabled, epoch, since: new Date(now).toISOString() }, cursor: new Date(now).toISOString(), items: ids.map(item) });
describe("danmaku public boundary and bounded queue", () => {
  it("projects only valid public text/quick/stickers and never copies private identity", () => {
    const row = { id: "a", value: "666", createdAt: new Date(), email: "private@example.test", participantHash: "secret", displayName: "private@example.test" };
    expect(projectDanmaku(config, row)).toEqual({ id: "a", value: "666", createdAt: row.createdAt.toISOString(), displayName: "觀眾" });
    expect(projectDanmaku({ ...config, visibility: "instructor_only" }, row)).toBeNull();
    expect(projectDanmaku({ ...config, answerType: "single", options: ["666", "111"] }, row)).toBeNull();
    expect(projectDanmaku({ ...config, answerType: "quick", options: ["666", "111"] }, row)).not.toBeNull();
    expect(projectDanmaku({ ...config, answerType: "sticker" }, { ...row, value: "🔥" })).not.toBeNull();
    expect(projectDanmaku({ ...config, answerType: "sticker" }, row)).toBeNull();
    expect(projectDanmaku(config, { ...row, value: "x".repeat(161) })).toBeNull();
    expect(projectDanmaku({}, row)).toBeNull();
  });
  it("drops initial/reconnect batches and deduplicates overlapping watermarks", () => {
    const queue = new DanmakuQueue(); queue.accept(snapshot(["old"]), true, now);
    expect(queue.next(now)).toBeNull();
    queue.accept(snapshot(["a", "a"]), true, now); queue.accept(snapshot(["a"]), true, now);
    expect(queue.next(now)?.id).toBe("a"); expect(queue.next(now)).toBeNull();
    queue.clear(); queue.accept(snapshot(["a"]), true, now); expect(queue.next(now)).toBeNull();
  });
  it("clears on off, generation change and personal hiding", () => {
    const queue = new DanmakuQueue(); queue.accept(snapshot([]), true, now); queue.accept(snapshot(["a"]), true, now);
    queue.accept(snapshot([], "two", false), true, now); expect(queue.next(now)).toBeNull();
    queue.accept(snapshot(["old"], "three"), true, now); expect(queue.next(now)).toBeNull();
    queue.accept(snapshot(["b"], "three"), false, now); expect(queue.next(now)).toBeNull();
  });
  it("bounds bursts at 20 and expires waiting messages", () => {
    const queue = new DanmakuQueue(); queue.accept(snapshot([]), true, now);
    for (let batch = 0; batch < 10; batch++) queue.accept(snapshot(Array.from({ length: 20 }, (_, i) => `${batch}-${i}`)), true, now);
    let count = 0; while (queue.next(now)) count++; expect(count).toBe(20);
    queue.accept(snapshot(["expired"]), true, now); expect(queue.next(now + 10_001)).toBeNull();
  });
});
