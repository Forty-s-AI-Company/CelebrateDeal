import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { CardError } from "./interaction-card";
import { commandWarmup, instructorWarmup, readWarmup, warmupEvents, StoredDanmakuSchema } from "./scripted-roles";

const scope = { vendorId: "vendor-1", liveId: "live-1" };
const now = new Date("2026-01-01T00:00:10.000Z");
const event = {
  id: "event-1", triggerSec: 5, eventType: "chat_message", message: " 歡迎參加 ",
  role: { vendorId: "vendor-1", name: "小編", avatarUrl: null, isActive: true, isScheduled: true },
};
const stored = {
  enabled: true, epoch: "epoch-1", since: "2026-01-01T00:00:00.000Z",
  scripted: { scriptId: "script-1", enabled: true, scheduled: false, manual: null },
};

type FakeTx = {
  $queryRaw: ReturnType<typeof vi.fn>;
  $executeRaw: ReturnType<typeof vi.fn>;
  interactionScript: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  interactionEvent: { findMany: ReturnType<typeof vi.fn> };
  live: { findFirst: ReturnType<typeof vi.fn> };
};

function fakeTx(options: { rows?: unknown[]; events?: unknown[]; script?: unknown; live?: unknown; now?: Date } = {}) {
  const tx: FakeTx = {
    $queryRaw: vi.fn()
      .mockResolvedValueOnce(options.rows ?? [{ danmakuState: stored }])
      .mockResolvedValue([{ now: options.now ?? now }]),
    $executeRaw: vi.fn(),
    interactionScript: {
      findFirst: vi.fn().mockResolvedValue(options.script === undefined ? { id: "script-1" } : options.script),
      findMany: vi.fn().mockResolvedValue([{ id: "script-1", name: "直播腳本" }]),
    },
    interactionEvent: { findMany: vi.fn().mockResolvedValue(options.events ?? [event]) },
    live: { findFirst: vi.fn().mockResolvedValue(options.live === undefined ? { streamMode: "vod", video: { vendorId: "vendor-1", durationSec: 120 }, isEvergreen: false, evergreenSessionStartAt: null } : options.live) },
  };
  return tx;
}

function fakeDb(tx: FakeTx) {
  return {
    $transaction: vi.fn(async (callback: (value: FakeTx) => unknown) => callback(tx)),
    $queryRaw: tx.$queryRaw,
    live: tx.live,
    interactionScript: tx.interactionScript,
  } as unknown as PrismaClient;
}

describe("scripted roles persistence boundary", () => {
  it("loads only published vendor-owned events and fails closed on missing or oversized scripts", async () => {
    const tx = fakeTx({ events: [event, { ...event, id: "event-2", role: null }] });
    await expect(warmupEvents(tx as never, "vendor-1", "script-1")).resolves.toEqual([{ id: "event-1", triggerSec: 5, value: "歡迎參加", displayName: "小編", avatarUrl: null }]);
    await expect(warmupEvents(fakeTx({ script: null }) as never, "vendor-1", "script-1")).rejects.toBeInstanceOf(CardError);
    await expect(warmupEvents(fakeTx({ events: Array.from({ length: 101 }, (_, index) => ({ ...event, id: `event-${index}` })) }) as never, "vendor-1", "script-1")).rejects.toBeInstanceOf(CardError);
  });

  it("returns instructor controls and computes scheduling eligibility", async () => {
    const tx = fakeTx({ rows: [{ danmakuState: stored }] });
    const db = fakeDb(tx);
    await expect(instructorWarmup(db, scope)).resolves.toMatchObject({ state: stored.scripted, events: [{ id: "event-1" }], canSchedule: true });
    await expect(instructorWarmup(fakeDb(fakeTx({ live: null })), scope)).rejects.toBeInstanceOf(CardError);
    const noState = fakeTx({ rows: [{ danmakuState: { enabled: true, epoch: "e", since: stored.since } }] });
    await expect(instructorWarmup(fakeDb(noState), scope)).resolves.toMatchObject({ state: null, events: [] });
    const badScript = fakeTx({ rows: [{ danmakuState: stored }] });
    badScript.interactionScript.findFirst.mockResolvedValue(null);
    await expect(instructorWarmup(fakeDb(badScript), scope)).resolves.toMatchObject({ events: [] });
  });

  it("handles stop, select and send commands with exact conflict boundaries", async () => {
    const stopTx = fakeTx();
    await expect(commandWarmup(fakeDb(stopTx), "vendor-1", { action: "stop", liveId: "live-1" })).resolves.toBeUndefined();
    expect(stopTx.$executeRaw).toHaveBeenCalledOnce();

    const selectTx = fakeTx({ events: [event] });
    await expect(commandWarmup(fakeDb(selectTx), "vendor-1", { action: "select", liveId: "live-1", scriptId: "script-1", scheduled: false })).resolves.toBeUndefined();
    await expect(commandWarmup(fakeDb(fakeTx({ events: [] })), "vendor-1", { action: "select", liveId: "live-1", scriptId: "script-1", scheduled: false })).rejects.toBeInstanceOf(CardError);
    await expect(commandWarmup(fakeDb(fakeTx({ events: [event], live: { streamMode: "live", video: { vendorId: "vendor-1", durationSec: 120 }, isEvergreen: false } })), "vendor-1", { action: "select", liveId: "live-1", scriptId: "script-1", scheduled: true })).rejects.toBeInstanceOf(CardError);

    const disabled = fakeTx({ rows: [{ danmakuState: { ...stored, enabled: false } }] });
    await expect(commandWarmup(fakeDb(disabled), "vendor-1", { action: "send", liveId: "live-1", eventId: "event-1", requestId: "11111111-1111-4111-8111-111111111111" })).rejects.toBeInstanceOf(CardError);
    const missing = fakeTx({ events: [] });
    await expect(commandWarmup(fakeDb(missing), "vendor-1", { action: "send", liveId: "live-1", eventId: "missing", requestId: "22222222-2222-4222-8222-222222222222" })).rejects.toBeInstanceOf(CardError);
  });

  it("reads manual and scheduled warmup without persisting participant data", async () => {
    const manualState = StoredDanmakuSchema.parse({ ...stored, scripted: { ...stored.scripted, manual: { eventId: "event-1", requestId: "33333333-3333-4333-8333-333333333333", at: "2026-01-01T00:00:08.000Z" } } });
    const manualTx = fakeTx({ events: [event] });
    await expect(readWarmup(manualTx as never, scope, manualState, now)).resolves.toMatchObject({ item: { id: "warmup:manual:33333333-3333-4333-8333-333333333333", source: "scripted_role" } });
    const off = StoredDanmakuSchema.parse({ ...stored, scripted: { ...stored.scripted, enabled: false } });
    await expect(readWarmup(fakeTx() as never, scope, off, now)).resolves.toEqual({ epoch: "epoch-1", item: null });
    const missingLive = fakeTx({ events: [event], live: null });
    await expect(readWarmup(missingLive as never, scope, manualState, now)).resolves.toMatchObject({ item: null });
    const scheduled = StoredDanmakuSchema.parse({ ...stored, scripted: { ...stored.scripted, scheduled: true } });
    const scheduledNow = new Date("2026-01-01T00:00:06.000Z");
    const scheduledTx = fakeTx({ now: scheduledNow, events: [event], live: { streamMode: "vod", video: { vendorId: "vendor-1", durationSec: 120 }, isEvergreen: true, evergreenSessionStartAt: new Date("2026-01-01T00:00:00.000Z") } });
    await expect(readWarmup(scheduledTx as never, scope, scheduled, scheduledNow, 5)).resolves.toMatchObject({ item: { source: "scripted_role" } });
  });
});
