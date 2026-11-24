import { afterEach, describe, expect, it, vi } from "vitest";
import { accountRateLimitKeyHash } from "@/lib/account-rate-limit";
import { CloudflareStreamError, type getStreamVideoStatus } from "@/lib/cloudflare-stream";
import {
  pollCloudflareStreamVideoReady,
  runStreamReadySync,
  STREAM_READY_SYNC_MAX_AGE_MS,
  STREAM_READY_SYNC_MIN_AGE_MS,
  streamReadyPollScope,
  syncStreamVideoReadyForOps,
  type StreamReadyThrottle,
} from "@/lib/cloudflare-stream-ready-sync";
import { createCloudflareStreamWebhookHandler } from "@/lib/cloudflare-stream-webhook-handler";
import { applyCloudflareStreamProviderState, CloudflareStreamProviderPayload } from "@/lib/cloudflare-stream-video-sync";
import { convergeCloudflareVideoTransition } from "@/lib/cloudflare-video-transition";
import { getDb } from "@/lib/db";

type StreamDetails = Awaited<ReturnType<typeof getStreamVideoStatus>>;

const createdVendorIds: string[] = [];
const throttleKeys: string[] = [];
const allowAll: StreamReadyThrottle = async () => ({ allowed: true });

afterEach(async () => {
  vi.unstubAllEnvs();
  const db = getDb();
  await db.accountRateLimitBucket.deleteMany({ where: { keyHash: { in: throttleKeys.splice(0) } } });
  await db.vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
});

function unique(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

async function createVendor() {
  const vendor = await getDb().vendor.create({
    data: {
      name: "Stream Ready Sync Vendor",
      slug: unique("stream-ready"),
      email: `${unique("stream-ready")}@example.test`,
      passwordHash: "test",
    },
  });
  createdVendorIds.push(vendor.id);
  return vendor;
}

async function createProcessingVideo({
  vendorId,
  uid = unique("cf_uid"),
  uploadedMsAgo = 10 * 60_000,
  status = "processing",
  ready = false,
}: {
  vendorId?: string;
  uid?: string;
  uploadedMsAgo?: number;
  status?: string;
  ready?: boolean;
} = {}) {
  const ownerId = vendorId ?? (await createVendor()).id;
  const db = getDb();
  const video = await db.video.create({
    data: {
      vendorId: ownerId,
      title: "Processing Video",
      sourceType: "cloudflare_stream",
      videoUrl: `https://videodelivery.net/${uid}/manifest/video.m3u8`,
      status,
      cloudflareStreamUid: uid,
      cloudflarePlaybackId: uid,
      cloudflareReadyToStream: ready,
      durationSec: 0,
      estimatedMinutes: 0,
    },
  });
  // `updatedAt` is the upload time the scan reads; Prisma would overwrite it on update.
  await db.$executeRaw`UPDATE "Video" SET "updatedAt" = ${new Date(Date.now() - uploadedMsAgo)} WHERE "id" = ${video.id}`;
  return { ...video, vendorId: ownerId, cloudflareStreamUid: uid };
}

function readyDetails(uid: string, overrides: Partial<StreamDetails> = {}): StreamDetails {
  return {
    uid,
    readyToStream: true,
    status: { state: "ready" },
    thumbnail: `https://customer-test.cloudflarestream.com/${uid}/thumbnails/thumbnail.jpg`,
    duration: 61.2,
    ...overrides,
  };
}

function fetchReturning(details: (uid: string) => StreamDetails) {
  return vi.fn(async (uid: string) => details(uid));
}

const SYNCED_FIELDS = {
  status: true,
  cloudflareReadyToStream: true,
  cloudflarePlaybackId: true,
  videoUrl: true,
  thumbnailUrl: true,
  durationSec: true,
  estimatedMinutes: true,
} as const;

async function readSynced(id: string) {
  return getDb().video.findUniqueOrThrow({ where: { id }, select: SYNCED_FIELDS });
}

function webhookRequest(payload: Record<string, unknown>) {
  return new Request("https://app.example.test/api/cloudflare/stream-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-cloudflare-stream-webhook-secret": "stream-secret" },
    body: JSON.stringify(payload),
  });
}

function stubWebhookFallback() {
  vi.stubEnv("CLOUDFLARE_STREAM_WEBHOOK_SECRET", "stream-secret");
  vi.stubEnv("VERCEL_ENV", "preview");
}

describe("pollCloudflareStreamVideoReady", () => {
  it("writes a ready answer exactly as the webhook would for the same provider state", async () => {
    stubWebhookFallback();
    const polled = await createProcessingVideo();
    const hooked = await createProcessingVideo();

    const result = await pollCloudflareStreamVideoReady({
      db: getDb(),
      video: polled,
      fetchStatus: fetchReturning((uid) => readyDetails(uid)),
    });
    const response = await createCloudflareStreamWebhookHandler()(webhookRequest(
      { ...readyDetails(hooked.cloudflareStreamUid) },
    ));

    expect(result).toEqual({ outcome: "updated" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, updated: 1 });

    const fromPoll = await readSynced(polled.id);
    const fromWebhook = await readSynced(hooked.id);
    expect(fromPoll).toEqual({
      status: "ready",
      cloudflareReadyToStream: true,
      cloudflarePlaybackId: polled.cloudflareStreamUid,
      videoUrl: `https://videodelivery.net/${polled.cloudflareStreamUid}/manifest/video.m3u8`,
      thumbnailUrl: `https://customer-test.cloudflarestream.com/${polled.cloudflareStreamUid}/thumbnails/thumbnail.jpg`,
      durationSec: 62,
      estimatedMinutes: 2,
    });
    const normalize = (row: typeof fromPoll, uid: string) => JSON.parse(JSON.stringify(row).replaceAll(uid, "<uid>"));
    expect(normalize(fromPoll, polled.cloudflareStreamUid)).toEqual(normalize(fromWebhook, hooked.cloudflareStreamUid));
  });

  it("writes nothing while Cloudflare still reports the video as not ready", async () => {
    const video = await createProcessingVideo();
    const before = await readSynced(video.id);

    const result = await pollCloudflareStreamVideoReady({
      db: getDb(),
      video,
      fetchStatus: fetchReturning((uid) => ({ uid, readyToStream: false, status: { state: "inprogress" }, duration: -1 })),
    });

    expect(result).toEqual({ outcome: "not_ready" });
    await expect(readSynced(video.id)).resolves.toEqual(before);
  });

  it.each([
    ["network", new CloudflareStreamError("network")],
    ["provider_rejected", new CloudflareStreamError("provider_rejected", 403)],
    ["configuration", new CloudflareStreamError("configuration")],
    ["internal_failure", new Error("token=super-secret https://signed.example.test/?sig=abc")],
  ] as const)("returns only the %s category and writes nothing when the provider call fails", async (code, error) => {
    const video = await createProcessingVideo();
    const before = await readSynced(video.id);

    const result = await pollCloudflareStreamVideoReady({
      db: getDb(),
      video,
      fetchStatus: vi.fn(async () => { throw error; }),
    });

    expect(result).toEqual({ outcome: "provider_error", errorCode: code });
    expect(JSON.stringify(result)).not.toMatch(/secret|signed|sig=/u);
    await expect(readSynced(video.id)).resolves.toEqual(before);
  });

  it.each([
    ["a different uid", (uid: string) => readyDetails(`${uid}_other`)],
    ["an out-of-range duration", (uid: string) => readyDetails(uid, { duration: -1 })],
    ["a duration above the webhook limit", (uid: string) => readyDetails(uid, { duration: 6 * 60 * 60 + 1 })],
  ])("rejects a ready answer with %s without writing", async (_label, details) => {
    const video = await createProcessingVideo();
    const before = await readSynced(video.id);

    const result = await pollCloudflareStreamVideoReady({ db: getDb(), video, fetchStatus: fetchReturning(details) });

    expect(result).toEqual({ outcome: "provider_error", errorCode: "invalid_response" });
    await expect(readSynced(video.id)).resolves.toEqual(before);
  });

  it("applies once when the webhook and the poll deliver the same ready state concurrently", async () => {
    stubWebhookFallback();
    const video = await createProcessingVideo();
    const handler = createCloudflareStreamWebhookHandler();
    const details = readyDetails(video.cloudflareStreamUid);

    const [pollResult, webhookResponse, secondPoll] = await Promise.all([
      pollCloudflareStreamVideoReady({ db: getDb(), video, fetchStatus: fetchReturning(() => details) }),
      handler(webhookRequest({ ...details })),
      pollCloudflareStreamVideoReady({ db: getDb(), video, fetchStatus: fetchReturning(() => details) }),
    ]);
    const webhookBody = await webhookResponse.json() as { updated: number };

    const writes = [pollResult, secondPoll].filter((result) => result.outcome === "updated").length + webhookBody.updated;
    expect(writes).toBe(1);
    expect([pollResult.outcome, secondPoll.outcome].every((outcome) => outcome === "updated" || outcome === "unchanged"))
      .toBe(true);
    await expect(readSynced(video.id)).resolves.toMatchObject({ status: "ready", cloudflareReadyToStream: true, durationSec: 62 });

    // A later webhook retry for the same state stays a no-op.
    const retry = await handler(webhookRequest({ ...details }));
    await expect(retry.json()).resolves.toMatchObject({ ok: true, updated: 0 });
  });

  it("never writes a video of another vendor, even when given that video's uid", async () => {
    const victim = await createProcessingVideo();
    const attacker = await createVendor();
    const before = await readSynced(victim.id);

    const result = await pollCloudflareStreamVideoReady({
      db: getDb(),
      video: { id: victim.id, vendorId: attacker.id, cloudflareStreamUid: victim.cloudflareStreamUid },
      fetchStatus: fetchReturning((uid) => readyDetails(uid)),
    });

    expect(result).toEqual({ outcome: "scope_mismatch" });
    await expect(readSynced(victim.id)).resolves.toEqual(before);
  });

  it("stops when one uid maps to videos of two vendors", async () => {
    const uid = unique("cf_shared");
    const first = await createProcessingVideo({ uid });
    const second = await createProcessingVideo({ uid });

    const result = await pollCloudflareStreamVideoReady({
      db: getDb(),
      video: first,
      fetchStatus: fetchReturning((value) => readyDetails(value)),
    });

    expect(result).toEqual({ outcome: "ambiguous" });
    await expect(readSynced(first.id)).resolves.toMatchObject({ status: "processing", cloudflareReadyToStream: false });
    await expect(readSynced(second.id)).resolves.toMatchObject({ status: "processing", cloudflareReadyToStream: false });
  });

  it("does not apply a ready answer for an asset the video was re-pointed away from", async () => {
    const video = await createProcessingVideo();
    const replacementUid = unique("cf_replacement");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchStatus = vi.fn(async (uid: string) => {
      await gate;
      return readyDetails(uid);
    });

    const pending = pollCloudflareStreamVideoReady({ db: getDb(), video, fetchStatus });
    // A replacement upload lands while the provider call is in flight.
    await getDb().video.update({
      where: { id: video.id },
      data: {
        cloudflareStreamUid: replacementUid,
        cloudflarePlaybackId: replacementUid,
        videoUrl: `https://videodelivery.net/${replacementUid}/manifest/video.m3u8`,
      },
    });
    release();

    await expect(pending).resolves.toEqual({ outcome: "unmapped" });
    await expect(readSynced(video.id)).resolves.toMatchObject({
      status: "processing",
      cloudflareReadyToStream: false,
      cloudflarePlaybackId: replacementUid,
    });
  });
});

describe("applyCloudflareStreamProviderState lost race", () => {
  it("settles without a second write when another delivery made the row ready between read and claim", async () => {
    const video = await createProcessingVideo();
    const payload = CloudflareStreamProviderPayload.parse(readyDetails(video.cloudflareStreamUid));
    let competing: Awaited<ReturnType<typeof applyCloudflareStreamProviderState>> | null = null;

    const result = await applyCloudflareStreamProviderState({
      db: getDb(),
      payload,
      expectedVideo: { id: video.id, vendorId: video.vendorId },
      // The competing webhook commits after this call read `processing` and before it claims.
      converge: async (options) => {
        competing = await applyCloudflareStreamProviderState({ db: getDb(), payload });
        return convergeCloudflareVideoTransition(options);
      },
    });

    expect(competing).toMatchObject({ outcome: "updated", updated: 1 });
    expect(result).toEqual({ outcome: "unchanged", status: "ready", updated: 0 });
    await expect(readSynced(video.id)).resolves.toMatchObject({ status: "ready", cloudflareReadyToStream: true, durationSec: 62 });
  });
});

describe("runStreamReadySync", () => {
  it("does nothing when Cloudflare Stream is not configured", async () => {
    await createProcessingVideo();
    const fetchStatus = vi.fn();

    await expect(runStreamReadySync({ configured: false, fetchStatus, throttle: allowAll })).resolves
      .toMatchObject({ skipped: "provider_unavailable", candidates: 0, queried: 0 });
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it("scans only processing, not-ready uploads inside the time window", async () => {
    const vendor = await createVendor();
    const eligible = await createProcessingVideo({ vendorId: vendor.id, uploadedMsAgo: 30 * 60_000 });
    const tooNew = await createProcessingVideo({ vendorId: vendor.id, uploadedMsAgo: STREAM_READY_SYNC_MIN_AGE_MS - 60_000 });
    const tooOld = await createProcessingVideo({ vendorId: vendor.id, uploadedMsAgo: STREAM_READY_SYNC_MAX_AGE_MS + 60_000 });
    const ready = await createProcessingVideo({ vendorId: vendor.id, status: "ready", ready: true });
    const errored = await createProcessingVideo({ vendorId: vendor.id, status: "error" });
    const archived = await createProcessingVideo({ vendorId: vendor.id, status: "archived" });
    const asked: string[] = [];
    const fetchStatus = vi.fn(async (uid: string) => {
      asked.push(uid);
      return readyDetails(uid);
    });

    const summary = await runStreamReadySync({ configured: true, fetchStatus, throttle: allowAll });

    // Other test files may leave rows behind; only this vendor's uploads are asserted.
    const mine = [eligible, tooNew, tooOld, ready, errored, archived].map((video) => video.cloudflareStreamUid);
    expect(asked.filter((uid) => mine.includes(uid))).toEqual([eligible.cloudflareStreamUid]);
    expect(summary.updated).toBeGreaterThanOrEqual(1);
    await expect(readSynced(eligible.id)).resolves.toMatchObject({ status: "ready", cloudflareReadyToStream: true });
    await expect(readSynced(tooNew.id)).resolves.toMatchObject({ status: "processing", cloudflareReadyToStream: false });
    await expect(readSynced(tooOld.id)).resolves.toMatchObject({ status: "processing", cloudflareReadyToStream: false });
  });

  it("stops at the batch limit, shares calls across vendors and leaves the rest for the next run", async () => {
    const busy = await createVendor();
    const quiet = await createVendor();
    for (let index = 0; index < 4; index += 1) {
      await createProcessingVideo({ vendorId: busy.id, uploadedMsAgo: (10 + index) * 60_000 });
    }
    const quietVideo = await createProcessingVideo({ vendorId: quiet.id, uploadedMsAgo: 40 * 60_000 });
    const fetchStatus = fetchReturning((uid) => ({ uid, readyToStream: false, status: { state: "inprogress" } }));

    const summary = await runStreamReadySync({ configured: true, fetchStatus, throttle: allowAll, batchLimit: 2 });

    expect(summary.queried).toBe(2);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(summary.deferred).toBe(summary.candidates - 2);
    expect(summary.notReady).toBe(2);
    // Round-robin: the quiet vendor's only upload is not starved by the busy vendor's newer ones.
    expect(fetchStatus.mock.calls.map(([uid]) => uid)).toContain(quietVideo.cloudflareStreamUid);
  });

  it("starts no new call after the deadline", async () => {
    const vendor = await createVendor();
    await createProcessingVideo({ vendorId: vendor.id });
    await createProcessingVideo({ vendorId: vendor.id });
    let clock = Date.now();
    const fetchStatus = vi.fn(async (uid: string) => {
      clock += 31_000;
      return { uid, readyToStream: false } satisfies StreamDetails;
    });

    const summary = await runStreamReadySync({ configured: true, fetchStatus, throttle: allowAll, now: () => clock, deadlineMs: 30_000 });

    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(summary.deferred).toBe(summary.candidates - 1);
  });

  it("holds each video to its back-off window across runs through the shared counter", async () => {
    const video = await createProcessingVideo({ uploadedMsAgo: 20 * 60_000 });
    throttleKeys.push(accountRateLimitKeyHash("stream_ready_poll_fast", video.id));
    const fetchStatus = fetchReturning((uid) => ({ uid, readyToStream: false }));

    await runStreamReadySync({ configured: true, fetchStatus });
    const asked = fetchStatus.mock.calls.filter(([uid]) => uid === video.cloudflareStreamUid).length;
    const second = await runStreamReadySync({ configured: true, fetchStatus });

    expect(asked).toBe(1);
    expect(fetchStatus.mock.calls.filter(([uid]) => uid === video.cloudflareStreamUid)).toHaveLength(1);
    expect(second.throttled).toBeGreaterThanOrEqual(1);
  });

  it("counts provider errors by category and fails closed when the throttle is unavailable", async () => {
    const vendor = await createVendor();
    const video = await createProcessingVideo({ vendorId: vendor.id });
    const before = await readSynced(video.id);

    const failing = await runStreamReadySync({
      configured: true,
      fetchStatus: vi.fn(async () => { throw new CloudflareStreamError("network"); }),
      throttle: allowAll,
    });
    expect(failing.providerErrors).toBeGreaterThanOrEqual(1);
    expect(failing.updated).toBe(0);

    const fetchStatus = vi.fn();
    const blind = await runStreamReadySync({
      configured: true,
      fetchStatus,
      throttle: async () => { throw new Error("database down"); },
    });
    expect(fetchStatus).not.toHaveBeenCalled();
    expect(blind.errors).toBe(blind.candidates);
    await expect(readSynced(video.id)).resolves.toEqual(before);
  });

  it("uses a slower back-off as the upload ages", () => {
    expect(streamReadyPollScope(10 * 60_000)).toBe("stream_ready_poll_fast");
    expect(streamReadyPollScope(2 * 60 * 60_000)).toBe("stream_ready_poll_medium");
    expect(streamReadyPollScope(12 * 60 * 60_000)).toBe("stream_ready_poll_slow");
  });
});

describe("syncStreamVideoReadyForOps", () => {
  it("checks Cloudflare at most once per video per window and applies a ready answer", async () => {
    const video = await createProcessingVideo({ uploadedMsAgo: 30_000 });
    throttleKeys.push(
      accountRateLimitKeyHash("stream_ready_poll_ops_video", video.id),
      accountRateLimitKeyHash("stream_ready_poll_ops_global", "all"),
    );
    const fetchStatus = fetchReturning((uid) => readyDetails(uid, { duration: 1 }));

    const first = await syncStreamVideoReadyForOps({ video, configured: true, fetchStatus });
    const second = await syncStreamVideoReadyForOps({ video, configured: true, fetchStatus });

    expect(first).toEqual({ outcome: "updated" });
    expect(second).toEqual({ outcome: "throttled" });
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(fetchStatus).toHaveBeenCalledWith(video.cloudflareStreamUid, { timeoutMs: 5_000 });
    await expect(readSynced(video.id)).resolves.toMatchObject({ status: "ready", cloudflareReadyToStream: true, durationSec: 1 });
  });

  it("makes no call when the global ops budget is spent or the throttle is unavailable", async () => {
    const video = await createProcessingVideo();
    const fetchStatus = vi.fn();

    await expect(syncStreamVideoReadyForOps({
      video,
      configured: true,
      fetchStatus,
      throttle: async (scope) => ({ allowed: scope !== "stream_ready_poll_ops_global" }),
    })).resolves.toEqual({ outcome: "throttled" });
    await expect(syncStreamVideoReadyForOps({
      video,
      configured: true,
      fetchStatus,
      throttle: async () => { throw new Error("database down"); },
    })).resolves.toEqual({ outcome: "throttle_unavailable" });
    await expect(syncStreamVideoReadyForOps({ video, configured: false, fetchStatus, throttle: allowAll }))
      .resolves.toEqual({ outcome: "provider_unavailable" });
    expect(fetchStatus).not.toHaveBeenCalled();
  });
});
