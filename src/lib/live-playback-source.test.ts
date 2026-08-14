import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  liveViewerSession: { findUnique: vi.fn() },
  live: { findFirst: vi.fn() },
};

import { hashLiveViewerToken } from "@/lib/live-quota-admission";
import { resolveLivePlaybackSource } from "@/lib/live-playback-source";

const now = new Date("2026-08-07T10:00:00.000Z");
const token = "A".repeat(43);

beforeEach(() => {
  vi.clearAllMocks();
  db.liveViewerSession.findUnique.mockResolvedValue({
    vendorId: "vendor-1",
    liveId: "live-1",
    expiresAt: new Date("2026-08-07T10:01:00.000Z"),
  });
  db.live.findFirst.mockResolvedValue({
    video: {
      videoUrl: "https://video.example.test/live.m3u8",
      sourceType: "url",
      status: "ready",
      cloudflareReadyToStream: false,
      cloudflareLiveInputUid: null,
      liveInputStatus: null,
    },
  });
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

  it("does not expose a processing Stream mapping even when it already has a provider URL", async () => {
    db.live.findFirst.mockResolvedValue({
      video: {
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
});
