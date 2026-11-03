import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDirectUploadMapping: vi.fn(),
  videoFindFirst: vi.fn(),
}));

vi.mock("@/lib/cloudflare-ops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cloudflare-ops")>();
  return { ...actual, createDirectUploadMapping: mocks.createDirectUploadMapping };
});

vi.mock("@/lib/db", () => ({
  getDb: () => ({ video: { findFirst: mocks.videoFindFirst } }),
}));

import { GET, POST } from "./route";

const smokeSecret = "test-fixture-ops-smoke-secret-0123456789abcdef";
const jobSecret = "test-fixture-job-secret-0123456789";

function authorizedRequest(payload: Record<string, unknown>) {
  return new Request("https://app.example.test/api/admin/ops/cloudflare/direct-upload", {
    method: "POST",
    headers: {
      authorization: `Bearer ${smokeSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

function requestWithJsonSpy(authorization?: string) {
  const json = vi.fn();
  return {
    request: {
      headers: new Headers(authorization ? { authorization } : undefined),
      json,
    } as unknown as Request,
    json,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPS_SMOKE_SECRET", smokeSecret);
  vi.stubEnv("JOB_SECRET", jobSecret);
  vi.stubEnv("SMOKE_VENDOR_ID", "vendor-1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/ops/cloudflare/direct-upload", () => {
  it.each([
    { name: "is missing", authorization: undefined },
    { name: "is invalid", authorization: "Bearer test-fixture-wrong-ops-smoke-secret" },
  ])("returns 401 without reading the body or creating an upload when OPS_SMOKE_SECRET $name", async ({ authorization }) => {
    const { request, json } = requestWithJsonSpy(authorization);

    const response = await POST(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.createDirectUploadMapping).not.toHaveBeenCalled();
  });

  it("returns 401 without reading the body or creating an upload when OPS_SMOKE_SECRET is not configured", async () => {
    vi.stubEnv("OPS_SMOKE_SECRET", undefined);
    const { request, json } = requestWithJsonSpy(`Bearer ${smokeSecret}`);

    const response = await POST(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.createDirectUploadMapping).not.toHaveBeenCalled();
  });

  it.each([
    { name: "the shared JOB_SECRET", configured: smokeSecret },
    { name: "JOB_SECRET while OPS_SMOKE_SECRET is unset", configured: undefined },
  ])("rejects $name without reading the body or creating an upload", async ({ configured }) => {
    vi.stubEnv("OPS_SMOKE_SECRET", configured);
    const { request, json } = requestWithJsonSpy(`Bearer ${jobSecret}`);

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(mocks.createDirectUploadMapping).not.toHaveBeenCalled();
  });

  it("refuses a vendorId other than the configured smoke vendor before any upload", async () => {
    const response = await POST(authorizedRequest({ vendorId: "vendor-other", title: "Cross-tenant upload" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Vendor is not permitted for smoke operations" });
    expect(mocks.createDirectUploadMapping).not.toHaveBeenCalled();
  });

  it("returns 503 without creating an upload when no smoke vendor is configured", async () => {
    vi.stubEnv("SMOKE_VENDOR_ID", undefined);

    const response = await POST(authorizedRequest({ vendorId: "vendor-1", title: "Unbound upload" }));

    expect(response.status).toBe(503);
    expect(mocks.createDirectUploadMapping).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid payload after OPS_SMOKE_SECRET authorization", async () => {
    const response = await POST(authorizedRequest({ maxDurationSeconds: 0 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid upload request" });
    expect(mocks.createDirectUploadMapping).not.toHaveBeenCalled();
  });

  it("uses the configured smoke vendor when the caller omits vendorId", async () => {
    vi.stubEnv("SMOKE_VENDOR_ID", "vendor-preview");
    mocks.createDirectUploadMapping.mockResolvedValue({
      video: { id: "video-1", status: "processing", videoUrl: "https://videodelivery.net/video-1/manifest/video.m3u8" },
      upload: { uid: "upload-1", uploadURL: "https://upload.videodelivery.net/upload-1" },
    });

    const response = await POST(authorizedRequest({ title: "Preview smoke" }));

    expect(response.status).toBe(200);
    expect(mocks.createDirectUploadMapping).toHaveBeenCalledWith({
      vendorId: "vendor-preview",
      title: "Preview smoke",
      maxDurationSeconds: 3600,
    });
  });

  it("returns only the allowed upload fields without a plaintext upload key", async () => {
    mocks.createDirectUploadMapping.mockResolvedValue({
      video: {
        id: "video-1",
        status: "processing",
        videoUrl: "https://videodelivery.net/video-1/manifest/video.m3u8",
      },
      upload: {
        uid: "upload-1",
        uploadURL: "https://upload.example.test/upload-1",
        streamKey: "test-fixture-plaintext-upload-key",
      },
    });

    const response = await POST(
      authorizedRequest({
        vendorId: "vendor-1",
        title: "Test upload",
        maxDurationSeconds: 120,
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      helper: "admin_ops_cloudflare_direct_upload",
      videoId: "video-1",
      status: "processing",
      playbackUrl: "https://videodelivery.net/video-1/manifest/video.m3u8",
      upload: {
        uid: "upload-1",
        uploadURL: "https://upload.example.test/upload-1",
      },
    });
    expect(JSON.stringify(body)).not.toContain("test-fixture-plaintext-upload-key");
    expect(mocks.createDirectUploadMapping).toHaveBeenCalledWith({
      vendorId: "vendor-1",
      title: "Test upload",
      maxDurationSeconds: 120,
    });
  });

  it("returns a closed diagnostic without exposing raw external errors", async () => {
    mocks.createDirectUploadMapping.mockRejectedValue(new Error("provider-token-and-response"));

    const response = await POST(authorizedRequest({ vendorId: "vendor-1", title: "Test upload" }));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain('"diagnostic":"internal_failure"');
    expect(body).not.toContain("provider-token-and-response");
  });
});

describe("GET /api/admin/ops/cloudflare/direct-upload", () => {
  it("returns 401 without querying status when OPS_SMOKE_SECRET is invalid", async () => {
    const response = await GET(new Request(
      "https://app.example.test/api/admin/ops/cloudflare/direct-upload?videoId=video-1",
    ));

    expect(response.status).toBe(401);
    expect(mocks.videoFindFirst).not.toHaveBeenCalled();
  });

  it("rejects the shared JOB_SECRET without querying status", async () => {
    const response = await GET(new Request(
      "https://app.example.test/api/admin/ops/cloudflare/direct-upload?videoId=video-1",
      { headers: { authorization: `Bearer ${jobSecret}` } },
    ));

    expect(response.status).toBe(401);
    expect(mocks.videoFindFirst).not.toHaveBeenCalled();
  });

  it("returns 503 without querying status when no smoke vendor is configured", async () => {
    vi.stubEnv("SMOKE_VENDOR_ID", undefined);
    const response = await GET(new Request(
      "https://app.example.test/api/admin/ops/cloudflare/direct-upload?videoId=video-1",
      { headers: { authorization: `Bearer ${smokeSecret}` } },
    ));

    expect(response.status).toBe(503);
    expect(mocks.videoFindFirst).not.toHaveBeenCalled();
  });

  it("does not reveal a video owned by another vendor", async () => {
    mocks.videoFindFirst.mockResolvedValue(null);
    const response = await GET(new Request(
      "https://app.example.test/api/admin/ops/cloudflare/direct-upload?videoId=video-of-other-vendor",
      { headers: { authorization: `Bearer ${smokeSecret}` } },
    ));

    expect(response.status).toBe(404);
    expect(mocks.videoFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "video-of-other-vendor", vendorId: "vendor-1" },
    }));
  });

  it("returns a bounded webhook-updated video status", async () => {
    mocks.videoFindFirst.mockResolvedValue({
      status: "ready",
      cloudflareReadyToStream: true,
      durationSec: 10,
      cloudflareStreamUid: "must-not-be-returned",
    });
    const response = await GET(new Request(
      "https://app.example.test/api/admin/ops/cloudflare/direct-upload?videoId=video-1",
      { headers: { authorization: `Bearer ${smokeSecret}` } },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      video: { status: "ready", readyToStream: true, durationSec: 10 },
    });
    expect(mocks.videoFindFirst).toHaveBeenCalledWith({
      where: { id: "video-1", vendorId: "vendor-1" },
      select: expect.objectContaining({ status: true, cloudflareReadyToStream: true, durationSec: true }),
    });
  });

  it("adds a short-lived signed playback URL for a ready Cloudflare video once signing is configured (F-093)", async () => {
    const uid = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
    vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_PEM", generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
      .export({ format: "pem", type: "pkcs1" }).toString());
    mocks.videoFindFirst.mockResolvedValue({
      vendorId: "vendor-1",
      sourceType: "cloudflare_stream",
      videoUrl: `https://videodelivery.net/${uid}/manifest/video.m3u8`,
      cloudflareStreamUid: uid,
      cloudflarePlaybackId: uid,
      cloudflareLiveInputUid: null,
      status: "ready",
      cloudflareReadyToStream: true,
      durationSec: 1,
    });
    const response = await GET(new Request(
      "https://app.example.test/api/admin/ops/cloudflare/direct-upload?videoId=video-1",
      { headers: { authorization: `Bearer ${smokeSecret}` } },
    ));

    const body = await response.json();
    expect(body.video.playbackUrl).toMatch(/^https:\/\/videodelivery\.net\/[\w-]+\.[\w-]+\.[\w-]+\/manifest\/video\.m3u8$/);
    expect(body.video.playbackUrl).not.toContain(uid);
  });
});
