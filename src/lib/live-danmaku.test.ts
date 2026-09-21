import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { CardError } from "./interaction-card";
import { DanmakuQueue, projectDanmaku, type DanmakuSnapshot } from "./live-danmaku-contract";
import { readDanmaku, setDanmaku } from "./live-danmaku";

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

type FakeTransaction = {
  $queryRaw: ReturnType<typeof vi.fn>;
  $executeRaw: ReturnType<typeof vi.fn>;
  liveInteractionResponse: { findMany: ReturnType<typeof vi.fn> };
};
type FakeDatabase = {
  $transaction: ReturnType<typeof vi.fn>;
  tx: FakeTransaction;
  executeRaw: ReturnType<typeof vi.fn>;
  queryRaw: ReturnType<typeof vi.fn>;
};

function fakeDatabase(rows: Array<{ danmakuState: unknown }>, responseRows: unknown[] = []): FakeDatabase {
  const executeRaw = vi.fn();
  const queryRaw = vi.fn()
    .mockResolvedValueOnce(rows)
    .mockResolvedValueOnce([{ now: new Date("2026-01-01T00:00:10.000Z") }]);
  const tx = {
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
    liveInteractionResponse: { findMany: vi.fn().mockResolvedValue(responseRows) },
  };
  return {
    $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    tx,
    executeRaw,
    queryRaw,
  };
}

describe("danmaku database boundary", () => {
  it("returns the stored state without writing when enabled is unchanged", async () => {
    const state = { enabled: true, epoch: "epoch-1", since: "2026-01-01T00:00:00.000Z" };
    const db = fakeDatabase([{ danmakuState: state }]);
    await expect(setDanmaku(db as unknown as PrismaClient, { vendorId: "vendor-1", liveId: "live-1" }, true)).resolves.toEqual(state);
    expect(db.executeRaw).not.toHaveBeenCalled();
  });

  it("updates the epoch and watermark when toggling the state", async () => {
    const db = fakeDatabase([{ danmakuState: { enabled: false, epoch: "old", since: "2026-01-01T00:00:00.000Z" } }]);
    const result = await setDanmaku(db as unknown as PrismaClient, { vendorId: "vendor-1", liveId: "live-1" }, true);
    expect(result).toMatchObject({ enabled: true, since: "2026-01-01T00:00:10.000Z" });
    expect(result.epoch).not.toBe("old");
    expect(db.executeRaw).toHaveBeenCalledOnce();
  });

  it("fails closed when the live row is outside the vendor scope", async () => {
    const db = fakeDatabase([]);
    await expect(setDanmaku(db as unknown as PrismaClient, { vendorId: "wrong-vendor", liveId: "live-1" }, true)).rejects.toBeInstanceOf(CardError);
  });

  it("returns a fresh snapshot for disabled, initial and generation-mismatch reads", async () => {
    const disabled = fakeDatabase([{ danmakuState: { enabled: false, epoch: "e", since: "2026-01-01T00:00:00.000Z" } }]);
    await expect(readDanmaku(disabled as unknown as PrismaClient, { vendorId: "vendor-1", liveId: "live-1" }, "cursor", "e")).resolves.toMatchObject({ items: [] });
    expect(disabled.tx.liveInteractionResponse.findMany).not.toHaveBeenCalled();

    const enabled = { enabled: true, epoch: "e", since: "2026-01-01T00:00:00.000Z" };
    const initial = fakeDatabase([{ danmakuState: enabled }]);
    await expect(readDanmaku(initial as unknown as PrismaClient, { vendorId: "vendor-1", liveId: "live-1" })).resolves.toMatchObject({ items: [] });
    const reconnect = fakeDatabase([{ danmakuState: enabled }]);
    await expect(readDanmaku(reconnect as unknown as PrismaClient, { vendorId: "vendor-1", liveId: "live-1" }, "cursor", "other")).resolves.toMatchObject({ items: [] });
  });

  it("reads a scoped continuation batch and projects only public items", async () => {
    const now = new Date("2026-01-01T00:00:10.000Z");
    const db = fakeDatabase([
      { danmakuState: { enabled: true, epoch: "e", since: "2026-01-01T00:00:00.000Z" } },
      // The second query is the clock query; fakeDatabase supplies it.
    ], [
      { id: "public", value: "666", createdAt: new Date("2026-01-01T00:00:05.000Z"), run: { configuration: { ...config } } },
      { id: "private", value: "hidden", createdAt: now, run: { configuration: { ...config, visibility: "instructor_only" } } },
    ]);
    const result = await readDanmaku(db as unknown as PrismaClient, { vendorId: "vendor-1", liveId: "live-1" }, "2026-01-01T00:00:01.000Z", "e");
    expect(result.items).toEqual([{ id: "public", value: "666", displayName: "觀眾", createdAt: "2026-01-01T00:00:05.000Z" }]);
    expect(db.tx.liveInteractionResponse.findMany).toHaveBeenCalledOnce();
  });
});
