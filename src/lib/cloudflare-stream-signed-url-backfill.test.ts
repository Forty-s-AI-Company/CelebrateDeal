import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backfillStreamSignedUrls,
  backfillTargetsForVideo,
  SignedUrlBackfillNotConfiguredError,
  SignedUrlBackfillRequest,
} from "@/lib/cloudflare-stream-signed-url-backfill";

// Synthetic key generated per run; never a real Cloudflare signing key.
const signingKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
  .export({ format: "pem", type: "pkcs1" }).toString();

const videoUid = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const recordingUid = "b1b2c3d4e5f60718293a4b5c6d7e8f90";
const liveInputUid = "c1b2c3d4e5f60718293a4b5c6d7e8f90";

function videoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "video-1",
    videoUrl: `https://videodelivery.net/${videoUid}/manifest/video.m3u8`,
    cloudflareStreamUid: videoUid,
    cloudflarePlaybackId: null,
    cloudflareLiveInputUid: null,
    ...overrides,
  };
}

const db = { video: { findMany: vi.fn() } };

function cloudflareOk(result: Record<string, unknown>) {
  return new Response(JSON.stringify({ success: true, result }), { status: 200 });
}

function enableSigning() {
  vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID", "0123456789abcdef0123456789abcdef");
  vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_PEM", signingKey);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-fixture-account");
  vi.stubEnv("CLOUDFLARE_STREAM_TOKEN", "test-fixture-token");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID", undefined);
  vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_PEM", undefined);
  vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_JWK", undefined);
  db.video.findMany.mockResolvedValue([videoRow()]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("backfillTargetsForVideo", () => {
  it("collects every distinct, well-formed video uid", () => {
    expect(backfillTargetsForVideo(videoRow({ cloudflarePlaybackId: videoUid.toUpperCase() }))).toEqual([
      { videoId: "video-1", kind: "video", uid: videoUid },
    ]);
    expect(backfillTargetsForVideo(videoRow({ cloudflareStreamUid: "not-a-uid", videoUrl: "https://video.example.test/a.m3u8" }))).toEqual([]);
  });

  it("updates a live input's recording setting and its recorded video, not the live input as a video", () => {
    expect(backfillTargetsForVideo(videoRow({
      cloudflareStreamUid: null,
      cloudflareLiveInputUid: liveInputUid,
      cloudflarePlaybackId: recordingUid,
      videoUrl: `https://videodelivery.net/${liveInputUid}/manifest/video.m3u8`,
    }))).toEqual([
      { videoId: "video-1", kind: "live_input", uid: liveInputUid },
      { videoId: "video-1", kind: "video", uid: recordingUid },
    ]);
  });
});

describe("backfillStreamSignedUrls", () => {
  it("only reads the requested vendor's videos, paginated by id", async () => {
    await backfillStreamSignedUrls(SignedUrlBackfillRequest.parse({ vendorId: "vendor-1", cursor: "video-0", limit: 2 }), db as never);

    expect(db.video.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ vendorId: "vendor-1", id: { gt: "video-0" } }),
      orderBy: { id: "asc" },
      take: 2,
    }));
  });

  it("defaults to a dry run that never contacts Cloudflare", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(backfillStreamSignedUrls(SignedUrlBackfillRequest.parse({ vendorId: "vendor-1" }), db as never)).resolves.toEqual({
      apply: false,
      allowedOrigins: null,
      scannedVideos: 1,
      results: [{ videoId: "video-1", kind: "video", uid: videoUid, status: "pending" }],
      nextCursor: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to lock videos before the app can sign tokens", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(backfillStreamSignedUrls(SignedUrlBackfillRequest.parse({ vendorId: "vendor-1", apply: true }), db as never))
      .rejects.toBeInstanceOf(SignedUrlBackfillNotConfiguredError);
    expect(db.video.findMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("applies requireSignedURLs and allowedOrigins and reports per-resource status", async () => {
    enableSigning();
    db.video.findMany.mockResolvedValue([
      videoRow(),
      videoRow({ id: "video-2", cloudflareStreamUid: null, cloudflareLiveInputUid: liveInputUid, videoUrl: `https://videodelivery.net/${liveInputUid}/manifest/video.m3u8` }),
    ]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false }), { status: 404 }))
      .mockResolvedValueOnce(cloudflareOk({ uid: liveInputUid, recording: { requireSignedURLs: true } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await backfillStreamSignedUrls(SignedUrlBackfillRequest.parse({ vendorId: "vendor-1", apply: true, limit: 2 }), db as never);

    expect(result).toEqual({
      apply: true,
      allowedOrigins: ["app.example.test"],
      scannedVideos: 2,
      results: [
        { videoId: "video-1", kind: "video", uid: videoUid, status: "not_found", providerStatus: 404 },
        { videoId: "video-2", kind: "live_input", uid: liveInputUid, status: "updated" },
      ],
      nextCursor: "video-2",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).toEqual({
      uid: videoUid,
      requireSignedURLs: true,
      allowedOrigins: ["app.example.test"],
    });
  });

  it("keeps going after a provider failure without exposing provider details", async () => {
    enableSigning();
    db.video.findMany.mockResolvedValue([videoRow(), videoRow({ id: "video-2", cloudflareStreamUid: recordingUid, videoUrl: "https://video.example.test/x.m3u8" })]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, errors: [{ message: "provider detail" }] }), { status: 500 }))
      .mockResolvedValueOnce(cloudflareOk({ uid: recordingUid, requireSignedURLs: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await backfillStreamSignedUrls(SignedUrlBackfillRequest.parse({ vendorId: "vendor-1", apply: true }), db as never);

    expect(result.results).toEqual([
      { videoId: "video-1", kind: "video", uid: videoUid, status: "failed", diagnostic: "provider_rejected", providerStatus: 500 },
      { videoId: "video-2", kind: "video", uid: recordingUid, status: "updated" },
    ]);
    expect(JSON.stringify(result)).not.toContain("provider detail");
  });

  it.each([
    [{ vendorId: "vendor-1", limit: 11 }],
    [{ vendorId: "" }],
    [{ vendorId: "vendor-1", uids: [videoUid] }],
  ])("rejects an out-of-contract request %#", (payload) => {
    expect(SignedUrlBackfillRequest.safeParse(payload).success).toBe(false);
  });
});
