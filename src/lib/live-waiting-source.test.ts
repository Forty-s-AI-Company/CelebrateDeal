import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  live: { findFirst: vi.fn() },
  vendorUsageLimit: { findUnique: vi.fn() },
  streamUsageMonthlyCounter: { findUnique: vi.fn() },
  streamUsageLedgerEntry: { aggregate: vi.fn() },
  liveViewerSession: { findUnique: vi.fn(), create: vi.fn() },
};

import { resolveEvergreenViewerSession } from "@/lib/evergreen-viewer-session";
import { resolveLiveWaitingSource } from "@/lib/live-waiting-source";

const now = new Date("2026-11-27T10:00:00.000Z");

const waitingVideo = {
  vendorId: "vendor-1",
  sourceType: "url",
  status: "ready",
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
