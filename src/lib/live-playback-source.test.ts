import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  liveViewerSession: { findUnique: vi.fn() },
  live: { findFirst: vi.fn() },
};

import { resolveEvergreenViewerSession } from "@/lib/evergreen-viewer-session";
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

  it("returns an admitted internal WHEP source for browser broadcasts", async () => {
    db.live.findFirst.mockResolvedValue(liveRecord({
      video: {
        ...liveRecord().video,
        videoUrl: "https://media.invalid/browser-live",
        sourceType: "browser_live",
        status: "ready",
      },
    }));
    await expect(resolveLivePlaybackSource(db as never, {
      vendorId: "vendor-1",
      liveId: "live-1",
      token,
      now,
    })).resolves.toEqual({ protocol: "whep", playbackUrl: "/api/live-media?direction=read" });
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

describe("resolveLivePlaybackSource for an evergreen live", () => {
  const evergreen = liveRecord({
    id: "live-1",
    vendorId: "vendor-1",
    streamMode: "vod",
    status: "scheduled",
    scheduledAt: new Date("2026-01-01T00:00:00.000Z"),
    startedAt: null,
    replayEnabled: false,
    isEvergreen: true,
    evergreenScheduleMode: "on_demand",
    evergreenIntervalMinutes: 15,
    evergreenDailyTimes: [],
    evergreenSessionStartAt: null,
    vendor: { timezone: "Asia/Taipei" },
    video: { ...liveRecord().video, durationSec: 1_800, videoUrl: "https://video.example.test/evergreen.mp4" },
  });

  function claimAt(enteredAt: Date) {
    return resolveEvergreenViewerSession({ live: evergreen as never, vendorTimezone: "Asia/Taipei", token: null, intent: "claim", now: enteredAt })!.issuedToken;
  }

  beforeEach(() => {
    vi.stubEnv("CSRF_SECRET", "synthetic-evergreen-playback-root-secret-0123");
    db.live.findFirst.mockResolvedValue(evergreen);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("serves no media without the visitor's signed session", async () => {
    await expect(resolveLivePlaybackSource(db as never, { vendorId: "vendor-1", liveId: "live-1", token, now })).resolves.toBeNull();
    await expect(resolveLivePlaybackSource(db as never, { vendorId: "vendor-1", liveId: "live-1", token, evergreenToken: "eg1.forged.value", now })).resolves.toBeNull();
  });

  it("starts media at the session's server offset, not at the shared schedule", async () => {
    const evergreenToken = claimAt(new Date(now.getTime() - 125_000));
    await expect(resolveLivePlaybackSource(db as never, { vendorId: "vendor-1", liveId: "live-1", token, evergreenToken, now }))
      .resolves.toEqual({ playbackUrl: "https://video.example.test/evergreen.mp4", playbackStartSeconds: 125 });
  });

  it("serves nothing after the session ended when replay is closed", async () => {
    const evergreenToken = claimAt(new Date(now.getTime() - 1_900_000));
    await expect(resolveLivePlaybackSource(db as never, { vendorId: "vendor-1", liveId: "live-1", token, evergreenToken, now })).resolves.toBeNull();
    db.live.findFirst.mockResolvedValue({ ...evergreen, replayEnabled: true });
    await expect(resolveLivePlaybackSource(db as never, { vendorId: "vendor-1", liveId: "live-1", token, evergreenToken, now }))
      .resolves.toEqual({ playbackUrl: "https://video.example.test/evergreen.mp4" });
  });
});
