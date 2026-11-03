import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  liveViewerSession: { findUnique: vi.fn() },
  live: { findFirst: vi.fn() },
};

// Lets the F-093 fixed-session test supply the viewer's session without a registration fixture.
const fixedSessionOverride = vi.hoisted(() => ({ session: undefined as unknown }));
vi.mock("@/lib/live-fixed-sessions-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/live-fixed-sessions-store")>();
  return {
    ...actual,
    resolveViewerFixedSessionForLive: (...args: Parameters<typeof actual.resolveViewerFixedSessionForLive>) => (
      fixedSessionOverride.session === undefined
        ? actual.resolveViewerFixedSessionForLive(...args)
        : Promise.resolve(fixedSessionOverride.session)
    ),
  };
});

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

describe("resolveLivePlaybackSource with Stream signed URLs (F-093)", () => {
  // Synthetic key generated per run; never a real Cloudflare signing key.
  const signingKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
    .export({ format: "pem", type: "pkcs1" }).toString();
  const uid = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const streamUrl = `https://videodelivery.net/${uid}/manifest/video.m3u8`;
  const streamVideo = {
    ...liveRecord().video,
    videoUrl: streamUrl,
    sourceType: "cloudflare_stream",
    cloudflareReadyToStream: true,
    cloudflareStreamUid: uid,
    cloudflarePlaybackId: uid,
  };

  function tokenClaims(playbackUrl: string) {
    const segment = new URL(playbackUrl).pathname.split("/")[1]!;
    return JSON.parse(Buffer.from(segment.split(".")[1]!, "base64url").toString("utf8"));
  }

  beforeEach(() => {
    vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_PEM", signingKey);
    db.live.findFirst.mockResolvedValue(liveRecord({ video: streamVideo }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fixedSessionOverride.session = undefined;
  });

  it("selects the row's own Cloudflare uids for the signature", async () => {
    await resolveLivePlaybackSource(db as never, { vendorId: "vendor-1", liveId: "live-1", token, now });
    expect(db.live.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        video: { select: expect.objectContaining({ cloudflareStreamUid: true, cloudflarePlaybackId: true, cloudflareLiveInputUid: true }) },
      }),
    }));
  });

  it("returns a short-lived token URL instead of the stored uid for an admitted live viewer", async () => {
    const source = await resolveLivePlaybackSource(db as never, { vendorId: "vendor-1", liveId: "live-1", token, now });

    expect(source).toEqual({
      playbackUrl: expect.stringMatching(/^https:\/\/videodelivery\.net\/[\w-]+\.[\w-]+\.[\w-]+\/manifest\/video\.m3u8$/),
      expiresInSeconds: 600,
    });
    expect(source!.playbackUrl).not.toContain(uid);
    expect(tokenClaims(source!.playbackUrl)).toMatchObject({ sub: uid, exp: now.getTime() / 1_000 + 600 });
  });

  it("keeps the server start offset next to the signed URL", async () => {
    db.live.findFirst.mockResolvedValue(liveRecord({
      streamMode: "vod",
      status: "scheduled",
      scheduledAt: new Date(now.getTime() - 125_000),
      startedAt: null,
      video: { ...streamVideo, durationSec: 600 },
    }));

    await expect(resolveLivePlaybackSource(db as never, { vendorId: "vendor-1", liveId: "live-1", token, now }))
      .resolves.toMatchObject({ expiresInSeconds: 600, playbackStartSeconds: 125 });
  });

  it("lets a replay token live longer but never past replayAvailableUntil", async () => {
    const ended = {
      status: "ended",
      startedAt: new Date("2026-08-07T08:00:00.000Z"),
      endedAt: new Date("2026-08-07T09:00:00.000Z"),
      replayEnabled: true,
      video: streamVideo,
    };
    db.live.findFirst.mockResolvedValue(liveRecord({ ...ended, replayAvailableUntil: null }));
    await expect(resolveLivePlaybackSource(db as never, { vendorId: "vendor-1", liveId: "live-1", token, now }))
      .resolves.toMatchObject({ expiresInSeconds: 1_800 });

    const replayAvailableUntil = new Date(now.getTime() + 5 * 60_000);
    db.live.findFirst.mockResolvedValue(liveRecord({ ...ended, replayAvailableUntil }));
    const source = await resolveLivePlaybackSource(db as never, { vendorId: "vendor-1", liveId: "live-1", token, now });
    expect(source).toMatchObject({ expiresInSeconds: 300 });
    expect(tokenClaims(source!.playbackUrl).exp).toBe(replayAvailableUntil.getTime() / 1_000);
  });

  it("signs nothing for a viewer who has not been admitted", async () => {
    db.liveViewerSession.findUnique.mockResolvedValue(null);

    await expect(resolveLivePlaybackSource(db as never, { vendorId: "vendor-1", liveId: "live-1", token, now })).resolves.toBeNull();
    expect(db.live.findFirst).not.toHaveBeenCalled();
  });

  it("signs nothing when the admission belongs to another vendor", async () => {
    db.liveViewerSession.findUnique.mockResolvedValue({
      vendorId: "vendor-2",
      liveId: "live-1",
      expiresAt: new Date("2026-08-07T10:20:00.000Z"),
    });

    await expect(resolveLivePlaybackSource(db as never, { vendorId: "vendor-1", liveId: "live-1", token, now })).resolves.toBeNull();
  });

  it("signs nothing for a cross-tenant video", async () => {
    db.live.findFirst.mockResolvedValue(liveRecord({ video: { ...streamVideo, vendorId: "vendor-2" } }));

    await expect(resolveLivePlaybackSource(db as never, { vendorId: "vendor-1", liveId: "live-1", token, now })).resolves.toBeNull();
  });

  it("caps a fixed-session replay token at that session's own replay window", async () => {
    const sessionStart = new Date(now.getTime() - 50 * 60_000);
    db.live.findFirst.mockResolvedValue(liveRecord({
      sessionMode: "fixed_sessions",
      sessionReplayWindowHours: 1,
      streamMode: "vod",
      status: "ended",
      startedAt: null,
      endedAt: new Date(now.getTime() - 30 * 60_000),
      replayEnabled: true,
      replayAvailableUntil: null,
      video: { ...streamVideo, durationSec: 600 },
    }));
    fixedSessionOverride.session = { id: "session-1", startAt: sessionStart, status: "scheduled" };

    // Session ends at start + 10 min; the 1 h window closes 20 min from now, before the 30 min replay TTL.
    const source = await resolveLivePlaybackSource(db as never, { vendorId: "vendor-1", liveId: "live-1", token, now });
    expect(source).toMatchObject({ expiresInSeconds: 20 * 60 });
    expect(tokenClaims(source!.playbackUrl).exp).toBe(now.getTime() / 1_000 + 20 * 60);
  });

  // B1: merchant-entered url videos and URLs that disagree with the row are never signed.
  it("returns a url-type video holding a Stream URL unchanged and unsigned", async () => {
    db.live.findFirst.mockResolvedValue(liveRecord({ video: { ...streamVideo, sourceType: "url", cloudflareStreamUid: null, cloudflarePlaybackId: null } }));

    await expect(resolveLivePlaybackSource(db as never, { vendorId: "vendor-1", liveId: "live-1", token, now }))
      .resolves.toEqual({ playbackUrl: streamUrl });
  });

  it("does not sign a Stream URL whose uid is not the row's own uid", async () => {
    const foreignUrl = "https://videodelivery.net/f0e1d2c3b4a5968778695a4b3c2d1e0f/manifest/video.m3u8";
    db.live.findFirst.mockResolvedValue(liveRecord({ video: { ...streamVideo, videoUrl: foreignUrl } }));

    await expect(resolveLivePlaybackSource(db as never, { vendorId: "vendor-1", liveId: "live-1", token, now }))
      .resolves.toEqual({ playbackUrl: foreignUrl });
  });

  it("returns a merchant's external URL unchanged and without an expiry", async () => {
    db.live.findFirst.mockResolvedValue(liveRecord());

    await expect(resolveLivePlaybackSource(db as never, { vendorId: "vendor-1", liveId: "live-1", token, now }))
      .resolves.toEqual({ playbackUrl: "https://video.example.test/live.m3u8" });
  });

  it("keeps today's unsigned Stream URL when the signing keys are not configured", async () => {
    vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID", undefined);
    vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_PEM", undefined);

    await expect(resolveLivePlaybackSource(db as never, { vendorId: "vendor-1", liveId: "live-1", token, now }))
      .resolves.toEqual({ playbackUrl: streamUrl });
  });
});
