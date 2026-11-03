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

function parse(payload: Record<string, unknown>) {
  return SignedUrlBackfillRequest.parse(payload);
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
  it("collects every distinct, well-formed uid stored on the row", () => {
    expect(backfillTargetsForVideo(videoRow({ cloudflarePlaybackId: videoUid.toUpperCase() }))).toEqual([
      { videoId: "video-1", kind: "video", uid: videoUid },
    ]);
    expect(backfillTargetsForVideo(videoRow({ cloudflareStreamUid: "not-a-uid" }))).toEqual([]);
  });

  it("updates a live input's recording setting and its recorded video, not the live input as a video", () => {
    expect(backfillTargetsForVideo(videoRow({
      cloudflareStreamUid: null,
      cloudflareLiveInputUid: liveInputUid,
      cloudflarePlaybackId: recordingUid,
    }))).toEqual([
      { videoId: "video-1", kind: "live_input", uid: liveInputUid },
      { videoId: "video-1", kind: "video", uid: recordingUid },
    ]);
  });
});

describe("backfillStreamSignedUrls", () => {
  it("only reads this vendor's Cloudflare-type videos by their stored uid columns, paginated by id", async () => {
    await backfillStreamSignedUrls(parse({ vendorId: "vendor-1", cursor: "video-0", limit: 2 }), { db: db as never });

    const query = db.video.findMany.mock.calls[0]![0];
    expect(query).toMatchObject({
      where: { vendorId: "vendor-1", sourceType: { in: ["cloudflare_stream", "cloudflare_live"] }, id: { gt: "video-0" } },
      orderBy: { id: "asc" },
      take: 2,
      select: { id: true, cloudflareStreamUid: true, cloudflarePlaybackId: true, cloudflareLiveInputUid: true },
    });
    // url-type rows and videoUrl are never consulted.
    expect(JSON.stringify(query)).not.toContain("videoUrl");
  });

  it("defaults to a dry-run lock that never contacts Cloudflare or writes an audit", async () => {
    const fetchMock = vi.fn();
    const audit = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(backfillStreamSignedUrls(parse({ vendorId: "vendor-1" }), { db: db as never, audit })).resolves.toEqual({
      mode: "lock",
      apply: false,
      allowedOrigins: null,
      scannedVideos: 1,
      results: [{ videoId: "video-1", kind: "video", uid: videoUid, status: "pending" }],
      audited: false,
      nextCursor: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses to lock videos before the app can sign tokens", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(backfillStreamSignedUrls(parse({ vendorId: "vendor-1", apply: true }), { db: db as never }))
      .rejects.toBeInstanceOf(SignedUrlBackfillNotConfiguredError);
    expect(db.video.findMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("applies requireSignedURLs and allowedOrigins, reports per-resource status and audits without tokens", async () => {
    enableSigning();
    db.video.findMany.mockResolvedValue([
      videoRow(),
      videoRow({ id: "video-2", cloudflareStreamUid: null, cloudflareLiveInputUid: liveInputUid }),
    ]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false }), { status: 404 }))
      .mockResolvedValueOnce(cloudflareOk({ uid: liveInputUid, recording: { mode: "automatic" } }))
      .mockResolvedValueOnce(cloudflareOk({ uid: liveInputUid, recording: { mode: "automatic", requireSignedURLs: true } }));
    vi.stubGlobal("fetch", fetchMock);
    const audit = vi.fn().mockResolvedValue(undefined);

    const result = await backfillStreamSignedUrls(parse({ vendorId: "vendor-1", apply: true, limit: 2 }), { db: db as never, audit });

    const results = [
      { videoId: "video-1", kind: "video", uid: videoUid, status: "not_found", providerStatus: 404 },
      { videoId: "video-2", kind: "live_input", uid: liveInputUid, status: "updated" },
    ];
    expect(result).toEqual({
      mode: "lock",
      apply: true,
      allowedOrigins: ["app.example.test"],
      scannedVideos: 2,
      results,
      audited: true,
      nextCursor: "video-2",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).toEqual({
      uid: videoUid,
      requireSignedURLs: true,
      allowedOrigins: ["app.example.test"],
    });
    expect(audit).toHaveBeenCalledWith({ vendorId: "vendor-1", mode: "lock", allowedOrigins: ["app.example.test"], results });
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(/[\w-]+\.[\w-]+\.[\w-]{20,}/);
  });

  it("unlocks without signing keys by turning signing off and clearing allowedOrigins", async () => {
    const fetchMock = vi.fn().mockResolvedValue(cloudflareOk({ uid: videoUid, requireSignedURLs: false }));
    vi.stubGlobal("fetch", fetchMock);
    const audit = vi.fn().mockResolvedValue(undefined);

    const result = await backfillStreamSignedUrls(parse({ vendorId: "vendor-1", mode: "unlock", apply: true }), { db: db as never, audit });

    expect(result).toMatchObject({ mode: "unlock", apply: true, allowedOrigins: null, audited: true });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).toEqual({ uid: videoUid, requireSignedURLs: false, allowedOrigins: [] });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ mode: "unlock" }));
  });

  it("reports a failed audit instead of hiding it", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(cloudflareOk({ uid: videoUid })));
    const result = await backfillStreamSignedUrls(parse({ vendorId: "vendor-1", mode: "unlock", apply: true }), {
      db: db as never,
      audit: vi.fn().mockRejectedValue(new Error("db down")),
    });
    expect(result.audited).toBe(false);
    expect(result.results[0]).toMatchObject({ status: "updated" });
    expect(consoleError).toHaveBeenCalledWith("stream_signed_url_backfill_audit_failed", { vendorId: "vendor-1", mode: "unlock", count: 1 });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("db down");
    consoleError.mockRestore();
  });

  it("audits the resources already changed before a configuration error aborts the batch", async () => {
    enableSigning();
    db.video.findMany.mockResolvedValue([videoRow(), videoRow({ id: "video-2", cloudflareStreamUid: recordingUid })]);
    const audit = vi.fn().mockResolvedValue(undefined);
    // The first update succeeds; then the provider credentials disappear before the second.
    vi.stubGlobal("fetch", vi.fn(async () => {
      vi.stubEnv("CLOUDFLARE_STREAM_TOKEN", undefined);
      return cloudflareOk({ uid: videoUid, requireSignedURLs: true });
    }));

    await expect(backfillStreamSignedUrls(parse({ vendorId: "vendor-1", apply: true }), { db: db as never, audit }))
      .rejects.toMatchObject({ code: "configuration" });
    expect(audit).toHaveBeenCalledWith({
      vendorId: "vendor-1",
      mode: "lock",
      allowedOrigins: ["app.example.test"],
      results: [{ videoId: "video-1", kind: "video", uid: videoUid, status: "updated" }],
    });
  });

  it("pages by id: a full batch returns its last id as the cursor, a short batch ends the scan", async () => {
    db.video.findMany.mockResolvedValueOnce([videoRow({ id: "video-a" }), videoRow({ id: "video-b" })]);
    await expect(backfillStreamSignedUrls(parse({ vendorId: "vendor-1", limit: 2 }), { db: db as never }))
      .resolves.toMatchObject({ scannedVideos: 2, nextCursor: "video-b" });

    db.video.findMany.mockResolvedValueOnce([videoRow({ id: "video-c" })]);
    await expect(backfillStreamSignedUrls(parse({ vendorId: "vendor-1", limit: 2, cursor: "video-b" }), { db: db as never }))
      .resolves.toMatchObject({ scannedVideos: 1, nextCursor: null });
    expect(db.video.findMany.mock.calls[1]![0]).toMatchObject({ where: { id: { gt: "video-b" } }, take: 2 });

    db.video.findMany.mockResolvedValueOnce([]);
    await expect(backfillStreamSignedUrls(parse({ vendorId: "vendor-1", limit: 2, cursor: "video-c" }), { db: db as never }))
      .resolves.toMatchObject({ scannedVideos: 0, results: [], nextCursor: null });
  });

  it("keeps going after a provider failure without exposing provider details", async () => {
    enableSigning();
    db.video.findMany.mockResolvedValue([videoRow(), videoRow({ id: "video-2", cloudflareStreamUid: recordingUid })]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, errors: [{ message: "provider detail" }] }), { status: 500 }))
      .mockResolvedValueOnce(cloudflareOk({ uid: recordingUid, requireSignedURLs: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await backfillStreamSignedUrls(parse({ vendorId: "vendor-1", apply: true }), { db: db as never });

    expect(result.results).toEqual([
      { videoId: "video-1", kind: "video", uid: videoUid, status: "failed", diagnostic: "provider_rejected", providerStatus: 500 },
      { videoId: "video-2", kind: "video", uid: recordingUid, status: "updated" },
    ]);
    expect(JSON.stringify(result)).not.toContain("provider detail");
  });

  it.each([
    [{ vendorId: "vendor-1", limit: 6 }],
    [{ vendorId: "" }],
    [{ vendorId: "vendor-1", uids: [videoUid] }],
    [{ vendorId: "vendor-1", mode: "delete" }],
  ])("rejects an out-of-contract request %#", (payload) => {
    expect(SignedUrlBackfillRequest.safeParse(payload).success).toBe(false);
  });
});
