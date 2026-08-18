import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  liveViewerSession: { findUnique: vi.fn() },
  live: { findFirst: vi.fn() },
};

import { hashLiveViewerToken } from "@/lib/live-quota-admission";
import { resolveLivePlaybackSource } from "@/lib/live-playback-source";

const now = new Date("2026-08-07T10:00:00.000Z");
const token = "A".repeat(43);

function liveRecord(overrides: Record<string, unknown> = {}) {
  return {
    streamMode: "live",
    scheduledAt: new Date("2026-08-07T09:59:00.000Z"),
    status: "live",
    startedAt: new Date("2026-08-07T09:59:00.000Z"),
    endedAt: null,
    replayAvailableUntil: null,
    replayEnabled: true,
    video: {
      vendorId: "vendor-1",
      durationSec: null,
      videoUrl: "https://video.example.test/live.m3u8",
      sourceType: "url",
      status: "ready",
      cloudflareReadyToStream: false,
      cloudflareLiveInputUid: null,
      liveInputStatus: null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.liveViewerSession.findUnique.mockResolvedValue({
    vendorId: "vendor-1",
    liveId: "live-1",
    expiresAt: new Date("2026-08-07T10:20:00.000Z"),
  });
  db.live.findFirst.mockResolvedValue(liveRecord());
});

describe("resolveLivePlaybackSource", () => {
  it("returns a source only for the matching unexpired session", async () => {
    await expect(resolveLivePlaybackSource(db as never, {
      vendorId: "vendor-1",
      liveId: "live-1",
      token,
      now,
    })).resolves.toEqual({ playbackUrl: "https://video.example.test/live.m3u8" });

    expect(db.liveViewerSession.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashLiveViewerToken(token) },
      select: { vendorId: true, liveId: true, expiresAt: true },
    });
    expect(db.live.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "live-1", vendorId: "vendor-1" }),
      select: expect.objectContaining({
        video: expect.objectContaining({
          select: expect.objectContaining({ vendorId: true }),
        }),
      }),
    }));
  });

  it.each([
    ["missing session", null],
    ["expired session", { vendorId: "vendor-1", liveId: "live-1", expiresAt: new Date("2026-08-07T09:59:59.000Z") }],
    ["cross-vendor session", { vendorId: "vendor-2", liveId: "live-1", expiresAt: new Date("2026-08-07T10:01:00.000Z") }],
    ["cross-live session", { vendorId: "vendor-1", liveId: "live-2", expiresAt: new Date("2026-08-07T10:01:00.000Z") }],
  ])("fails closed for %s", async (_label, session) => {
    db.liveViewerSession.findUnique.mockResolvedValue(session);

    await expect(resolveLivePlaybackSource(db as never, {
      vendorId: "vendor-1",
      liveId: "live-1",
      token,
      now,
    })).resolves.toBeNull();
    expect(db.live.findFirst).not.toHaveBeenCalled();
  });

  it("does not return an unsafe or missing stored URL", async () => {
    db.live.findFirst.mockResolvedValue({
      video: {
        vendorId: "vendor-1",
        videoUrl: "javascript:alert(1)",
        sourceType: "url",
        status: "ready",
        cloudflareReadyToStream: false,
        cloudflareLiveInputUid: null,
        liveInputStatus: null,
      },
    });
    await expect(resolveLivePlaybackSource(db as never, {
      vendorId: "vendor-1",
      liveId: "live-1",
      token,
      now,
    })).resolves.toBeNull();
  });

  it("fails closed when the live points to a cross-tenant video", async () => {
    db.live.findFirst.mockResolvedValue(liveRecord({
      video: {
        ...liveRecord().video,
        vendorId: "vendor-2",
      },
    }));

    await expect(resolveLivePlaybackSource(db as never, {
      vendorId: "vendor-1",
      liveId: "live-1",
      token,
      now,
    })).resolves.toBeNull();
  });

  it("does not expose a processing Stream mapping even when it already has a provider URL", async () => {
    db.live.findFirst.mockResolvedValue({
      video: {
        vendorId: "vendor-1",
        videoUrl: "https://videodelivery.net/unready/manifest/video.m3u8",
        sourceType: "cloudflare_stream",
        status: "processing",
        cloudflareReadyToStream: false,
        cloudflareLiveInputUid: null,
        liveInputStatus: null,
      },
    });

    await expect(resolveLivePlaybackSource(db as never, {
      vendorId: "vendor-1",
      liveId: "live-1",
      token,
      now,
    })).resolves.toBeNull();
  });

  it.each([
    ["T 前", new Date("2026-08-07T09:59:59.999Z"), null],
    ["T", new Date("2026-08-07T10:00:00.000Z"), { playbackUrl: "https://video.example.test/live.m3u8", playbackStartSeconds: 0 }],
    ["T+duration", new Date("2026-08-07T10:10:00.000Z"), { playbackUrl: "https://video.example.test/live.m3u8" }],
  ])("applies the canonical VOD gate at %s", async (_label, clock, expected) => {
    db.live.findFirst.mockResolvedValue(liveRecord({
      streamMode: "vod",
      status: "scheduled",
      scheduledAt: new Date("2026-08-07T10:00:00.000Z"),
      startedAt: null,
      video: {
        ...liveRecord().video,
        durationSec: 600,
      },
    }));

    await expect(resolveLivePlaybackSource(db as never, {
      vendorId: "vendor-1",
      liveId: "live-1",
      token,
      now: clock,
    })).resolves.toEqual(expected);
  });

  it("rejects an unknown mode, an invalid VOD duration, and a replay deadline at now", async () => {
    const base = {
      streamMode: "vod",
      status: "scheduled",
      scheduledAt: new Date("2026-08-07T10:00:00.000Z"),
      startedAt: null,
      video: { ...liveRecord().video, durationSec: 600 },
    };

    for (const override of [
      { streamMode: "preview" },
      { video: { ...base.video, durationSec: 0 } },
      { replayAvailableUntil: new Date("2026-08-07T10:10:00.000Z") },
    ]) {
      db.live.findFirst.mockResolvedValue(liveRecord({ ...base, ...override }));
      await expect(resolveLivePlaybackSource(db as never, {
        vendorId: "vendor-1",
        liveId: "live-1",
        token,
        now: new Date("2026-08-07T10:10:00.000Z"),
      })).resolves.toBeNull();
    }
  });

  it("allows a live input only from its startedAt", async () => {
    const startedAt = new Date("2026-08-07T10:01:00.000Z");
    db.live.findFirst.mockResolvedValue(liveRecord({ startedAt }));

    await expect(resolveLivePlaybackSource(db as never, {
      vendorId: "vendor-1",
      liveId: "live-1",
      token,
      now: startedAt,
    })).resolves.toEqual({ playbackUrl: "https://video.example.test/live.m3u8" });
  });
});
