import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAuth: vi.fn(),
  videoFindFirst: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentAuth: mocks.getCurrentAuth }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ video: { findFirst: mocks.videoFindFirst } }),
}));

import { GET } from "@/app/api/media/videos/status/route";

function request(id = "video-1") {
  return new Request(`https://app.example.test/api/media/videos/status?id=${encodeURIComponent(id)}`, {
    headers: {
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAuth.mockResolvedValue({
    vendor: { id: "vendor-1" },
    member: { id: "member-1", role: "manager", status: "active" },
  });
  mocks.videoFindFirst.mockResolvedValue({
    id: "video-1",
    vendorId: "vendor-1",
    sourceType: "url",
    cloudflareStreamUid: null,
    cloudflarePlaybackId: null,
    cloudflareLiveInputUid: null,
    status: "processing",
    cloudflareReadyToStream: false,
    durationSec: 92,
    estimatedMinutes: 2,
    thumbnailUrl: "https://cdn.example.test/thumb.jpg",
    videoUrl: "https://cdn.example.test/video.m3u8",
  });
});

describe("GET /api/media/videos/status", () => {
  it("returns a tenant-scoped safe provider snapshot", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      video: {
        resourceId: "video-1",
        status: "processing",
        cloudflareReadyToStream: false,
        durationSec: 92,
        estimatedMinutes: 2,
        thumbnailUrl: "https://cdn.example.test/thumb.jpg",
        videoUrl: "https://cdn.example.test/video.m3u8",
      },
    });
    expect(mocks.videoFindFirst).toHaveBeenCalledWith({
      where: { id: "video-1", vendorId: "vendor-1" },
      select: {
        vendorId: true,
        sourceType: true,
        cloudflareStreamUid: true,
        cloudflarePlaybackId: true,
        cloudflareLiveInputUid: true,
        id: true,
        status: true,
        cloudflareReadyToStream: true,
        durationSec: true,
        estimatedMinutes: true,
        thumbnailUrl: true,
        videoUrl: true,
      },
    });
  });

  describe("with Stream signing configured (F-093)", () => {
    const uid = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("returns a signed Cloudflare thumbnail and keeps the stored video URL", async () => {
      // Synthetic key generated per run; never a real Cloudflare signing key.
      vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID", "0123456789abcdef0123456789abcdef");
      vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_PEM", generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
        .export({ format: "pem", type: "pkcs1" }).toString());
      const videoUrl = `https://videodelivery.net/${uid}/manifest/video.m3u8`;
      mocks.videoFindFirst.mockResolvedValue({
        id: "video-1",
        vendorId: "vendor-1",
        sourceType: "cloudflare_stream",
        cloudflareStreamUid: uid,
        cloudflarePlaybackId: uid,
        cloudflareLiveInputUid: null,
        status: "ready",
        cloudflareReadyToStream: true,
        durationSec: 92,
        estimatedMinutes: 2,
        thumbnailUrl: `https://videodelivery.net/${uid}/thumbnails/thumbnail.jpg`,
        videoUrl,
      });

      const body = await (await GET(request())).json();

      expect(body.video.thumbnailUrl).toMatch(/^https:\/\/videodelivery\.net\/[\w-]+\.[\w-]+\.[\w-]+\/thumbnails\/thumbnail\.jpg$/);
      expect(body.video.videoUrl).toBe(videoUrl);
    });
  });

  it("does not disclose foreign or missing videos", async () => {
    mocks.videoFindFirst.mockResolvedValue(null);

    const response = await GET(request("foreign-video"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: "VIDEO_NOT_FOUND" } });
  });

  it("rejects inactive or non-merchant sessions before querying", async () => {
    mocks.getCurrentAuth.mockResolvedValue({
      vendor: { id: "vendor-1" },
      member: { id: "member-1", role: "viewer", status: "active" },
    });

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(mocks.videoFindFirst).not.toHaveBeenCalled();
  });
});
