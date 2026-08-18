import { describe, expect, it, vi } from "vitest";

import {
  reconcileLiveRuntimeState,
  resolveLiveRuntime,
  resolveLiveRuntimeState,
  type LiveRuntimeCandidate,
} from "@/lib/live-runtime-state";

const scheduledAt = new Date("2026-08-18T10:00:00.000Z");
const now = new Date("2026-08-18T10:02:00.000Z");

function vod(overrides: Partial<LiveRuntimeCandidate> = {}): LiveRuntimeCandidate {
  return {
    streamMode: "vod",
    scheduledAt,
    status: "scheduled",
    startedAt: null,
    endedAt: null,
    replayAvailableUntil: null,
    replayEnabled: true,
    video: { durationSec: 600 },
    ...overrides,
  };
}

function liveInput(overrides: Partial<LiveRuntimeCandidate> = {}): LiveRuntimeCandidate {
  return {
    streamMode: "live",
    scheduledAt,
    status: "scheduled",
    startedAt: null,
    endedAt: null,
    replayAvailableUntil: null,
    replayEnabled: true,
    video: null,
    ...overrides,
  };
}

describe("live runtime state", () => {
  it("uses one VOD timeline for waiting, playing, and replay", () => {
    expect(resolveLiveRuntimeState(vod(), new Date("2026-08-18T09:59:59.999Z"))).toBe("waiting");
    expect(resolveLiveRuntime(vod(), scheduledAt)).toEqual({
      state: "playing",
      playbackStartSeconds: 0,
    });
    expect(resolveLiveRuntime(vod({ status: "live" }), now)).toEqual({
      state: "playing",
      playbackStartSeconds: 120,
    });
    expect(resolveLiveRuntime(vod({ status: "live" }), new Date("2026-08-18T10:10:00.000Z"))).toEqual({
      state: "replay",
      playbackStartSeconds: null,
    });
  });

  it("clamps a late VOD join to the valid playback interval", () => {
    expect(resolveLiveRuntime(vod(), new Date("2026-08-18T10:00:00.250Z"))).toEqual({
      state: "playing",
      playbackStartSeconds: 0.25,
    });
    expect(resolveLiveRuntime(vod(), new Date("2026-08-18T10:09:59.999Z")).playbackStartSeconds)
      .toBeLessThanOrEqual(600);
  });

  it("treats an expiry timestamp equal to now as expired", () => {
    const afterEnd = new Date("2026-08-18T10:10:00.000Z");
    expect(resolveLiveRuntime(vod({ status: "ended", endedAt: afterEnd, replayAvailableUntil: afterEnd }), afterEnd))
      .toEqual({ state: "unavailable", playbackStartSeconds: null });
    expect(resolveLiveRuntime(vod({ status: "ended", endedAt: afterEnd }), afterEnd))
      .toEqual({ state: "replay", playbackStartSeconds: null });
  });

  it.each([undefined, null])("fails closed when replayEnabled is %s", (replayEnabled) => {
    expect(resolveLiveRuntimeState(vod({
      status: "ended",
      endedAt: now,
      replayEnabled,
    }), now)).toBe("unavailable");
  });

  it("requires a valid persisted VOD endedAt and never treats an early marker as replay", () => {
    expect(resolveLiveRuntimeState(vod({ status: "ended", endedAt: null }), now)).toBe("unavailable");
    expect(resolveLiveRuntimeState(vod({
      status: "ended",
      endedAt: new Date("2026-08-18T10:09:59.999Z"),
    }), now)).toBe("unavailable");
    expect(resolveLiveRuntimeState(vod({
      status: "ended",
      endedAt: new Date("2026-08-18T10:11:00.000Z"),
    }), new Date("2026-08-18T10:11:00.000Z"))).toBe("replay");
  });

  it.each([
    ["unknown stream mode", vod({ streamMode: "hybrid" })],
    ["invalid duration", vod({ video: { durationSec: 0 } })],
    ["fractional duration", vod({ video: { durationSec: 1.5 } })],
    ["invalid status", vod({ status: "draft" })],
    ["invalid schedule", vod({ scheduledAt: new Date("invalid") })],
  ])("fails closed for %s", (_label, candidate) => {
    expect(resolveLiveRuntimeState(candidate, now)).toBe("unavailable");
  });

  it("requires both live status and a startedAt marker for Live Input playback", () => {
    expect(resolveLiveRuntimeState(liveInput(), now)).toBe("waiting");
    expect(resolveLiveRuntimeState(liveInput({ status: "live" }), now)).toBe("unavailable");
    expect(resolveLiveRuntimeState(liveInput({
      status: "live",
      startedAt: new Date("2026-08-18T10:01:00.000Z"),
    }), now)).toBe("playing");
    expect(resolveLiveRuntimeState(liveInput({
      status: "live",
      startedAt: new Date("2026-08-18T10:01:00.000Z"),
      endedAt: now,
    }), now)).toBe("replay");
    expect(resolveLiveRuntimeState(liveInput({
      status: "ended",
      startedAt: new Date("2026-08-18T10:01:00.000Z"),
      endedAt: now,
      replayEnabled: false,
    }), now)).toBe("unavailable");
    expect(resolveLiveRuntimeState(liveInput({ status: "ended", endedAt: now }), now)).toBe("unavailable");
  });

  it("does not expose replay for a malformed lifecycle window", () => {
    expect(resolveLiveRuntimeState(liveInput({
      status: "ended",
      startedAt: new Date("2026-08-18T10:01:00.000Z"),
      endedAt: new Date("2026-08-18T10:02:00.000Z"),
      replayAvailableUntil: new Date("2026-08-18T10:01:59.000Z"),
    }), now)).toBe("unavailable");
  });

  it.each([
    ["replay disabled", { replayEnabled: false, replayAvailableUntil: null }],
    ["replay deadline expired", { replayEnabled: true, replayAvailableUntil: new Date("2026-08-18T10:10:00.000Z") }],
  ])("reconciles a naturally completed VOD even when %s", async (_label, replay) => {
    const completionAt = new Date("2026-08-18T10:10:00.000Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      live: {
        findFirst: vi.fn().mockResolvedValue({
          id: "live-1",
          vendorId: "vendor-1",
          ...vod({ status: "live", ...replay }),
          video: { id: "video-1", durationSec: 600 },
        }),
        updateMany,
      },
    };

    await expect(reconcileLiveRuntimeState(db as never, {
      vendorId: "vendor-1",
      liveId: "live-1",
      now: new Date("2026-08-18T10:11:00.000Z"),
    })).resolves.toMatchObject({ state: "unavailable", updated: true, updateCount: 1 });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "ended", endedAt: completionAt },
    }));
  });

  it("changes a non-ended status without replacing a valid existing endedAt marker", async () => {
    const persistedEndedAt = new Date("2026-08-18T10:10:30.000Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      live: {
        findFirst: vi.fn().mockResolvedValue({
          id: "live-1",
          vendorId: "vendor-1",
          ...vod({ status: "live", endedAt: persistedEndedAt }),
          video: { id: "video-1", durationSec: 600 },
        }),
        updateMany,
      },
    };

    await expect(reconcileLiveRuntimeState(db as never, {
      vendorId: "vendor-1",
      liveId: "live-1",
      now: new Date("2026-08-18T10:11:00.000Z"),
    })).resolves.toMatchObject({ state: "replay", updated: true });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "ended" } }));
    expect(updateMany.mock.calls[0]?.[0].data).not.toHaveProperty("endedAt");
  });

  it("fences reconciliation on the related video id and duration", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const db = {
      live: {
        findFirst: vi.fn().mockResolvedValue({
          id: "live-1",
          vendorId: "vendor-1",
          ...vod({ status: "live" }),
          video: { id: "video-1", durationSec: 600 },
        }),
        updateMany,
      },
    };

    await expect(reconcileLiveRuntimeState(db as never, {
      vendorId: "vendor-1",
      liveId: "live-1",
      now: new Date("2026-08-18T10:11:00.000Z"),
    })).resolves.toMatchObject({ state: "replay", updated: false, updateCount: 0 });
    expect(db.live.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        video: { select: { id: true, durationSec: true } },
      }),
    }));
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        video: { is: { id: "video-1", durationSec: 600 } },
      }),
    }));
  });
});
