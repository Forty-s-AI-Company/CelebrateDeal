import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  live: { findFirst: vi.fn() },
  vendorUsageLimit: { findUnique: vi.fn() },
  streamUsageMonthlyCounter: { findUnique: vi.fn() },
  streamUsageLedgerEntry: { aggregate: vi.fn() },
  liveViewerSession: { findUnique: vi.fn(), create: vi.fn() },
};

vi.mock("@/lib/live-fixed-sessions-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/live-fixed-sessions-store")>();
  // Delegates to the real resolver unless a test supplies the viewer's own fixed session.
  return { ...actual, resolveViewerFixedSessionForLive: vi.fn(actual.resolveViewerFixedSessionForLive) };
});

import { resolveEvergreenViewerSession } from "@/lib/evergreen-viewer-session";
import { resolveViewerFixedSessionForLive } from "@/lib/live-fixed-sessions-store";
import { resolveLiveWaitingSource } from "@/lib/live-waiting-source";

const now = new Date("2026-11-27T10:00:00.000Z");

const waitingVideo = {
  vendorId: "vendor-1",
  sourceType: "url",
  status: "ready",
  durationSec: 24,
  cloudflareReadyToStream: false,
  cloudflareLiveInputUid: null,
  liveInputStatus: null,
  videoUrl: "https://video.example.test/waiting-loop.mp4",
  cloudflareStreamUid: null,
  cloudflarePlaybackId: null,
};

function liveRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "live-1",
    vendorId: "vendor-1",
    videoId: "main-1",
    waitingVideoId: "loop-1",
    streamMode: "vod",
    // Starts in 30 minutes: the shared runtime is "waiting".
    scheduledAt: new Date("2026-11-27T10:30:00.000Z"),
    status: "scheduled",
    startedAt: null,
    endedAt: null,
    replayAvailableUntil: null,
    replayEnabled: true,
    isEvergreen: false,
    evergreenScheduleMode: "just_in_time",
    evergreenIntervalMinutes: 15,
    evergreenDailyTimes: [],
    evergreenSessionStartAt: null,
    sessionMode: "single",
    sessionRegistrationCutoffMinutes: 0,
    sessionReplayWindowHours: null,
    vendor: { timezone: "Asia/Taipei" },
    video: {
      vendorId: "vendor-1",
      durationSec: 1_800,
      sourceType: "url",
      status: "ready",
      cloudflareReadyToStream: false,
      cloudflareLiveInputUid: null,
      liveInputStatus: null,
    },
    form: { vendorId: "vendor-1", isActive: true, fields: [
      { key: "name", label: "姓名", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
    ] },
    messageTemplate: { vendorId: "vendor-1", channel: "email", trigger: "registration_confirmed", isActive: true, subject: "報名成功", body: "{{name}} {{unsubscribe_url}}" },
    interactionScript: null,
    products: [],
    waitingVideo,
    ...overrides,
  };
}

const input = { vendorId: "vendor-1", liveId: "live-1", now };

beforeEach(() => {
  vi.clearAllMocks();
  db.live.findFirst.mockResolvedValue(liveRecord());
  db.vendorUsageLimit.findUnique.mockResolvedValue(null);
  db.streamUsageMonthlyCounter.findUnique.mockResolvedValue(null);
  db.streamUsageLedgerEntry.aggregate.mockResolvedValue({ _sum: { watchSeconds: 0 } });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveLiveWaitingSource", () => {
  it("serves only this Live's bound waiting video while the room is waiting", async () => {
    await expect(resolveLiveWaitingSource(db as never, input))
      .resolves.toEqual({ playbackUrl: "https://video.example.test/waiting-loop.mp4" });

    const query = db.live.findFirst.mock.calls[0]![0];
    // The Live is looked up by its id and vendor together, behind the public availability gate.
    expect(query.where).toMatchObject({ id: "live-1", vendorId: "vendor-1", waitingVideoId: { not: null } });
    expect(query.where.vendor).toBeDefined();
    // The video comes only through the Live's own relation; no video id is ever taken from the request.
    expect(query.select.waitingVideo.select).toMatchObject({ vendorId: true, videoUrl: true, sourceType: true });
    expect(JSON.stringify(query)).not.toContain("videoId\":\"");
    // No admission or usage write: the waiting room takes no viewer capacity.
    expect(db.liveViewerSession.findUnique).not.toHaveBeenCalled();
    expect(db.liveViewerSession.create).not.toHaveBeenCalled();
  });

  it("refuses a waiting video of another vendor even if a row was returned", async () => {
    db.live.findFirst.mockResolvedValue(liveRecord({ waitingVideo: { ...waitingVideo, vendorId: "vendor-2" } }));
    await expect(resolveLiveWaitingSource(db as never, input)).resolves.toBeNull();
    db.live.findFirst.mockResolvedValue(liveRecord({ vendorId: "vendor-2" }));
    await expect(resolveLiveWaitingSource(db as never, input)).resolves.toBeNull();
  });

  it("serves nothing without a bound video, for an unknown Live or for a Live that is not publish-ready", async () => {
    db.live.findFirst.mockResolvedValue(liveRecord({ waitingVideo: null }));
    await expect(resolveLiveWaitingSource(db as never, input)).resolves.toBeNull();
    db.live.findFirst.mockResolvedValue(null);
    await expect(resolveLiveWaitingSource(db as never, input)).resolves.toBeNull();
    db.live.findFirst.mockResolvedValue(liveRecord({ form: { vendorId: "vendor-1", isActive: false, fields: [] } }));
    await expect(resolveLiveWaitingSource(db as never, input)).resolves.toBeNull();
  });

  it("refuses live inputs, browser broadcasts and unready uploads as a waiting loop", async () => {
    for (const video of [
      { ...waitingVideo, sourceType: "cloudflare_live", cloudflareLiveInputUid: "a".repeat(32), liveInputStatus: "created" },
      { ...waitingVideo, sourceType: "browser_live" },
      { ...waitingVideo, sourceType: "cloudflare_stream", cloudflareReadyToStream: false },
      { ...waitingVideo, status: "processing" },
      { ...waitingVideo, videoUrl: "javascript:alert(1)" },
    ]) {
      db.live.findFirst.mockResolvedValue(liveRecord({ waitingVideo: video }));
      await expect(resolveLiveWaitingSource(db as never, input)).resolves.toBeNull();
    }
    // A soft-archived video keeps playing for an existing binding, like the main video.
    db.live.findFirst.mockResolvedValue(liveRecord({ waitingVideo: { ...waitingVideo, status: "archived" } }));
    await expect(resolveLiveWaitingSource(db as never, input)).resolves.not.toBeNull();
  });

  it("serves only a loop of a known length up to 5 minutes", async () => {
    for (const durationSec of [null, 0, 301, 3_600, 24.5]) {
      db.live.findFirst.mockResolvedValue(liveRecord({ waitingVideo: { ...waitingVideo, durationSec } }));
      await expect(resolveLiveWaitingSource(db as never, input)).resolves.toBeNull();
    }
    for (const durationSec of [1, 300]) {
      db.live.findFirst.mockResolvedValue(liveRecord({ waitingVideo: { ...waitingVideo, durationSec } }));
      await expect(resolveLiveWaitingSource(db as never, input)).resolves.not.toBeNull();
    }
  });

  it("never serves the Live's own main video as the unmetered waiting loop", async () => {
    db.live.findFirst.mockResolvedValue(liveRecord({ videoId: "loop-1", waitingVideoId: "loop-1" }));
    await expect(resolveLiveWaitingSource(db as never, input)).resolves.toBeNull();
  });

  it("serves the loop only within 60 minutes of the viewer's start; earlier visitors keep the poster", async () => {
    const at = (minutesAhead: number) => liveRecord({ scheduledAt: new Date(now.getTime() + minutesAhead * 60_000) });
    db.live.findFirst.mockResolvedValue(at(61));
    await expect(resolveLiveWaitingSource(db as never, input)).resolves.toBeNull();
    db.live.findFirst.mockResolvedValue(at(60));
    await expect(resolveLiveWaitingSource(db as never, input)).resolves.not.toBeNull();
    db.live.findFirst.mockResolvedValue(at(1));
    await expect(resolveLiveWaitingSource(db as never, input)).resolves.not.toBeNull();
    // A day ahead: refused before any usage read.
    db.live.findFirst.mockResolvedValue(at(24 * 60));
    db.vendorUsageLimit.findUnique.mockClear();
    await expect(resolveLiveWaitingSource(db as never, input)).resolves.toBeNull();
    expect(db.vendorUsageLimit.findUnique).not.toHaveBeenCalled();
  });

  it("refuses a self-reported URL that points at Cloudflare Stream, whatever length it claims (review m-A)", async () => {
    const uid = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
    for (const videoUrl of [
      `https://videodelivery.net/${uid}/manifest/video.m3u8`,
      `https://customer-abc123.cloudflarestream.com/${uid}/manifest/video.m3u8`,
      `https://videodelivery.net/${uid}/manifest/video.m3u8?clientBandwidthHint=10`,
      `https://iframe.videodelivery.net/${uid}`,
    ]) {
      db.live.findFirst.mockResolvedValue(liveRecord({ waitingVideo: { ...waitingVideo, durationSec: 60, videoUrl } }));
      await expect(resolveLiveWaitingSource(db as never, input), videoUrl).resolves.toBeNull();
    }
  });

  it("serves a self-reported URL only when it is a direct .mp4, .webm or .mov file (#736 m-1)", async () => {
    for (const videoUrl of [
      "https://video.example.test/loop.m3u8",
      "https://video.example.test/manifest/video.mpd",
      "https://video.example.test/redirect?to=loop.mp4",
    ]) {
      db.live.findFirst.mockResolvedValue(liveRecord({ waitingVideo: { ...waitingVideo, videoUrl } }));
      await expect(resolveLiveWaitingSource(db as never, input), videoUrl).resolves.toBeNull();
    }
    for (const videoUrl of ["https://video.example.test/loop.webm", "https://video.example.test/loop.mov?v=1"]) {
      db.live.findFirst.mockResolvedValue(liveRecord({ waitingVideo: { ...waitingVideo, videoUrl } }));
      await expect(resolveLiveWaitingSource(db as never, input), videoUrl).resolves.toEqual({ playbackUrl: videoUrl });
    }
  });

  it("uses the viewer's own fixed session, not Live.scheduledAt, for the 60-minute window (NIT 3)", async () => {
    // The shared start is 30 minutes ahead (inside the window) ...
    const fixedLive = liveRecord({ sessionMode: "fixed_sessions", scheduledAt: new Date(now.getTime() + 30 * 60_000) });
    db.live.findFirst.mockResolvedValue(fixedLive);
    const ownSession = vi.mocked(resolveViewerFixedSessionForLive);
    // ... but this viewer's session starts in 90 minutes: poster only.
    ownSession.mockResolvedValueOnce({ id: "session-late", startAt: new Date(now.getTime() + 90 * 60_000), status: "open" } as never);
    await expect(resolveLiveWaitingSource(db as never, { ...input, registrationToken: "synthetic" })).resolves.toBeNull();
    // Their session 30 minutes ahead is served.
    ownSession.mockResolvedValueOnce({ id: "session-soon", startAt: new Date(now.getTime() + 30 * 60_000), status: "open" } as never);
    await expect(resolveLiveWaitingSource(db as never, { ...input, registrationToken: "synthetic" }))
      .resolves.toEqual({ playbackUrl: "https://video.example.test/waiting-loop.mp4" });
  });

  describe("a manually started live show (OBS or browser broadcast, review m-B)", () => {
    const manual = (minutesSinceStart: number, overrides: Record<string, unknown> = {}) => liveRecord({
      streamMode: "live",
      scheduledAt: new Date(now.getTime() - minutesSinceStart * 60_000),
      ...overrides,
    });

    it("keeps serving the loop for 30 minutes after the start while the host has not gone live", async () => {
      for (const minutes of [0, 1, 29]) {
        db.live.findFirst.mockResolvedValue(manual(minutes));
        await expect(resolveLiveWaitingSource(db as never, input), `${minutes} min late`).resolves.not.toBeNull();
      }
      for (const minutes of [30, 31, 120]) {
        db.live.findFirst.mockResolvedValue(manual(minutes));
        await expect(resolveLiveWaitingSource(db as never, input), `${minutes} min late`).resolves.toBeNull();
      }
    });

    it("stops once the host is live", async () => {
      db.live.findFirst.mockResolvedValue(manual(5, { status: "live", startedAt: new Date(now.getTime() - 60_000) }));
      await expect(resolveLiveWaitingSource(db as never, input)).resolves.toBeNull();
    });

    it("keeps the 60-second grace for a scheduled pre-recorded show", async () => {
      // Same lateness as above, but VOD: the main video plays from the start.
      db.live.findFirst.mockResolvedValue(liveRecord({ streamMode: "vod", scheduledAt: new Date(now.getTime() - 5 * 60_000) }));
      await expect(resolveLiveWaitingSource(db as never, input)).resolves.toBeNull();
    });
  });

  it("stops answering once the show starts: the main video takes over", async () => {
    db.live.findFirst.mockResolvedValue(liveRecord({
      scheduledAt: new Date("2026-11-27T09:59:00.000Z"),
    }));
    await expect(resolveLiveWaitingSource(db as never, input)).resolves.toBeNull();
    db.live.findFirst.mockResolvedValue(liveRecord({
      status: "ended",
      scheduledAt: new Date("2026-11-27T08:00:00.000Z"),
      endedAt: new Date("2026-11-27T08:30:00.000Z"),
    }));
    await expect(resolveLiveWaitingSource(db as never, input)).resolves.toBeNull();
  });

  it("serves nothing when the vendor's entitlement is revoked or its included Stream minutes are used up", async () => {
    db.vendorUsageLimit.findUnique.mockResolvedValue({ entitlementStatus: "revoked", streamMinutesLimit: 0, streamMinutesUsed: 0, resetAt: null });
    await expect(resolveLiveWaitingSource(db as never, input)).resolves.toBeNull();

    db.vendorUsageLimit.findUnique.mockResolvedValue({ entitlementStatus: "active", streamMinutesLimit: 10, streamMinutesUsed: 0, resetAt: null });
    db.streamUsageMonthlyCounter.findUnique.mockResolvedValue({ watchSeconds: 600 });
    await expect(resolveLiveWaitingSource(db as never, input)).resolves.toBeNull();

    db.streamUsageMonthlyCounter.findUnique.mockResolvedValue({ watchSeconds: 599 });
    await expect(resolveLiveWaitingSource(db as never, input)).resolves.not.toBeNull();
  });

  describe("an evergreen Live", () => {
    const evergreen = liveRecord({
      isEvergreen: true,
      evergreenScheduleMode: "just_in_time",
      evergreenIntervalMinutes: 30,
      scheduledAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    beforeEach(() => {
      vi.stubEnv("CSRF_SECRET", "synthetic-evergreen-waiting-root-secret-0123");
      db.live.findFirst.mockResolvedValue(evergreen);
    });

    it("serves nothing before the visitor has an assigned session", async () => {
      await expect(resolveLiveWaitingSource(db as never, input)).resolves.toBeNull();
      await expect(resolveLiveWaitingSource(db as never, { ...input, evergreenToken: "eg1.forged.value" })).resolves.toBeNull();
    });

    it("uses the visitor's own evergreen session, not Live.scheduledAt, for the 60-minute window (NIT 3)", async () => {
      // 18:07 Taipei. Live.scheduledAt is 23 minutes ahead, but the daily session is at 20:00 (113 minutes ahead).
      const enteredAt = new Date("2026-11-27T10:07:00.000Z");
      const daily = (time: string) => liveRecord({
        isEvergreen: true,
        evergreenScheduleMode: "recurring_daily",
        evergreenDailyTimes: [time],
        scheduledAt: new Date("2026-11-27T10:30:00.000Z"),
      });
      const late = daily("20:00");
      const lateSession = resolveEvergreenViewerSession({ live: late as never, vendorTimezone: "Asia/Taipei", token: null, intent: "claim", now: enteredAt });
      expect(lateSession?.sessionStartAt.toISOString()).toBe("2026-11-27T12:00:00.000Z");
      db.live.findFirst.mockResolvedValue(late);
      await expect(resolveLiveWaitingSource(db as never, { ...input, now: enteredAt, evergreenToken: lateSession!.issuedToken }))
        .resolves.toBeNull();

      // Control: a 18:30 session is inside the window and served.
      const soon = daily("18:30");
      const soonSession = resolveEvergreenViewerSession({ live: soon as never, vendorTimezone: "Asia/Taipei", token: null, intent: "claim", now: enteredAt });
      db.live.findFirst.mockResolvedValue(soon);
      await expect(resolveLiveWaitingSource(db as never, { ...input, now: enteredAt, evergreenToken: soonSession!.issuedToken }))
        .resolves.toEqual({ playbackUrl: "https://video.example.test/waiting-loop.mp4" });
    });

    it("serves the loop while the visitor's own session is still ahead", async () => {
      // 18:07 Taipei: the visitor's just-in-time session starts at the next half hour.
      const enteredAt = new Date("2026-11-27T10:07:00.000Z");
      const session = resolveEvergreenViewerSession({ live: evergreen as never, vendorTimezone: "Asia/Taipei", token: null, intent: "claim", now: enteredAt });
      expect(session?.issuedToken).toBeTruthy();
      expect(session?.runtimeState).toBe("waiting");
      await expect(resolveLiveWaitingSource(db as never, { ...input, now: enteredAt, evergreenToken: session!.issuedToken }))
        .resolves.toEqual({ playbackUrl: "https://video.example.test/waiting-loop.mp4" });
    });
  });

  describe("with Stream signed URLs (F-093)", () => {
    // Synthetic key generated per run; never a real Cloudflare signing key.
    const signingKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
      .export({ format: "pem", type: "pkcs1" }).toString();
    const uid = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

    beforeEach(() => {
      vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID", "0123456789abcdef0123456789abcdef");
      vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_PEM", signingKey);
    });

    it("caps the token at the viewer's start plus 60 seconds", async () => {
      db.live.findFirst.mockResolvedValue(liveRecord({
        scheduledAt: new Date(now.getTime() + 3 * 60_000),
        waitingVideo: {
          ...waitingVideo,
          sourceType: "cloudflare_stream",
          cloudflareReadyToStream: true,
          videoUrl: `https://videodelivery.net/${uid}/manifest/video.m3u8`,
          cloudflareStreamUid: uid,
          cloudflarePlaybackId: uid,
        },
      }));
      const source = await resolveLiveWaitingSource(db as never, input);
      expect(source?.expiresInSeconds).toBe(3 * 60 + 60);
      const claims = JSON.parse(Buffer.from(new URL(source!.playbackUrl).pathname.split("/")[1]!.split(".")[1]!, "base64url").toString("utf8"));
      expect(claims.exp).toBe(now.getTime() / 1_000 + 3 * 60 + 60);
    });

    it("caps the token at the start plus 30 minutes for a manually started live show (review m-B)", async () => {
      db.live.findFirst.mockResolvedValue(liveRecord({
        streamMode: "live",
        // The host is 25 minutes late: 5 minutes of the 30-minute grace remain.
        scheduledAt: new Date(now.getTime() - 25 * 60_000),
        waitingVideo: {
          ...waitingVideo,
          sourceType: "cloudflare_stream",
          cloudflareReadyToStream: true,
          videoUrl: `https://videodelivery.net/${uid}/manifest/video.m3u8`,
          cloudflareStreamUid: uid,
          cloudflarePlaybackId: uid,
        },
      }));
      const source = await resolveLiveWaitingSource(db as never, input);
      expect(source?.expiresInSeconds).toBe(5 * 60);
      const claims = JSON.parse(Buffer.from(new URL(source!.playbackUrl).pathname.split("/")[1]!.split(".")[1]!, "base64url").toString("utf8"));
      expect(claims.exp).toBe(now.getTime() / 1_000 + 5 * 60);
    });

    it("returns a short-lived token URL for the bound uid with its lifetime, so the player renews here", async () => {
      db.live.findFirst.mockResolvedValue(liveRecord({
        waitingVideo: {
          ...waitingVideo,
          sourceType: "cloudflare_stream",
          cloudflareReadyToStream: true,
          videoUrl: `https://videodelivery.net/${uid}/manifest/video.m3u8`,
          cloudflareStreamUid: uid,
          cloudflarePlaybackId: uid,
        },
      }));
      const source = await resolveLiveWaitingSource(db as never, input);
      expect(source).toEqual({
        playbackUrl: expect.stringMatching(/^https:\/\/videodelivery\.net\/[\w-]+\.[\w-]+\.[\w-]+\/manifest\/video\.m3u8$/),
        expiresInSeconds: 600,
      });
      expect(source!.playbackUrl).not.toContain(uid);
      const claims = JSON.parse(Buffer.from(new URL(source!.playbackUrl).pathname.split("/")[1]!.split(".")[1]!, "base64url").toString("utf8"));
      expect(claims).toMatchObject({ sub: uid });
    });

    it("never signs a uid that is not the bound row's own", async () => {
      const other = "f".repeat(32);
      db.live.findFirst.mockResolvedValue(liveRecord({
        waitingVideo: {
          ...waitingVideo,
          sourceType: "cloudflare_stream",
          cloudflareReadyToStream: true,
          videoUrl: `https://videodelivery.net/${other}/manifest/video.m3u8`,
          cloudflareStreamUid: uid,
          cloudflarePlaybackId: uid,
        },
      }));
      await expect(resolveLiveWaitingSource(db as never, input))
        .resolves.toEqual({ playbackUrl: `https://videodelivery.net/${other}/manifest/video.m3u8` });
    });
  });
});
