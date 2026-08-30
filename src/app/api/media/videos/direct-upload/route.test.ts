import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readJsonBody: vi.fn(),
  createDirectUploadMapping: vi.fn(),
  requireMerchantApiActor: vi.fn(),
}));

vi.mock("@/lib/api-security", () => ({ readJsonBody: mocks.readJsonBody }));
vi.mock("@/lib/merchant-api-security", () => ({ requireMerchantApiActor: mocks.requireMerchantApiActor }));
vi.mock("@/lib/cloudflare-ops", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cloudflare-ops")>()),
  createDirectUploadMapping: mocks.createDirectUploadMapping,
}));

import { CloudflareResourceError } from "@/lib/cloudflare-ops";
import { POST } from "./route";
import { MAX_BASIC_VIDEO_UPLOAD_BYTES } from "@/lib/media-upload-limits";

const validPayload = {
  videoId: "video-1",
  title: "Launch video",
  fileName: "launch.mp4",
  mimeType: "video/mp4",
  sizeBytes: 1_024,
  maxDurationSeconds: 120,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMerchantApiActor.mockResolvedValue({ actor: { vendorId: "session-vendor", memberId: "member-1" } });
  mocks.readJsonBody.mockResolvedValue(validPayload);
  mocks.createDirectUploadMapping.mockResolvedValue({
    video: { id: "video-1" },
    upload: {
      uid: "provider-uid",
      uploadURL: "https://upload.videodelivery.net/direct",
      streamKey: "provider-stream-key",
    },
  });
});

describe("POST /api/media/videos/direct-upload", () => {
  it("does not read a body before merchant authorization", async () => {
    mocks.requireMerchantApiActor.mockResolvedValue({
      response: NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }),
    });

    const response = await POST(new Request("https://app.example.test/api/media/videos/direct-upload", { method: "POST" }));

    expect(response.status).toBe(401);
    expect(mocks.readJsonBody).not.toHaveBeenCalled();
    expect(mocks.createDirectUploadMapping).not.toHaveBeenCalled();
  });

  it("rejects unknown fields and invalid video MIME types", async () => {
    mocks.readJsonBody.mockResolvedValue({ ...validPayload, mimeType: "video/unknown", providerUid: "forbidden" });

    const response = await POST(new Request("https://app.example.test/api/media/videos/direct-upload", { method: "POST" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "INVALID_VIDEO_UPLOAD" } });
    expect(mocks.createDirectUploadMapping).not.toHaveBeenCalled();
  });

  it("requires resumable upload above Cloudflare basic POST limit", async () => {
    mocks.readJsonBody.mockResolvedValue({ ...validPayload, sizeBytes: MAX_BASIC_VIDEO_UPLOAD_BYTES + 1 });

    const response = await POST(new Request("https://app.example.test/api/media/videos/direct-upload", { method: "POST" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "REQUIRES_RESUMABLE" } });
    expect(mocks.createDirectUploadMapping).not.toHaveBeenCalled();
  });

  it("derives the vendor from the session and returns no provider UID or stream key", async () => {
    const response = await POST(new Request("https://app.example.test/api/media/videos/direct-upload", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.createDirectUploadMapping).toHaveBeenCalledWith({
      vendorId: "session-vendor",
      videoId: "video-1",
      title: "Launch video",
      maxDurationSeconds: 120,
    });
    expect(body).toEqual({
      videoId: "video-1",
      uploadUrl: "https://upload.videodelivery.net/direct",
      method: "POST",
      maxBytes: MAX_BASIC_VIDEO_UPLOAD_BYTES,
    });
    expect(JSON.stringify(body)).not.toContain("provider-uid");
    expect(JSON.stringify(body)).not.toContain("provider-stream-key");
  });

  it("fails closed for a cross-tenant existing video", async () => {
    mocks.createDirectUploadMapping.mockRejectedValue(new CloudflareResourceError("video_not_found"));

    const response = await POST(new Request("https://app.example.test/api/media/videos/direct-upload", { method: "POST" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: "VIDEO_NOT_FOUND" } });
  });

  it("does not expose raw Cloudflare errors", async () => {
    mocks.createDirectUploadMapping.mockRejectedValue(new Error("cloudflare-secret-response"));

    const response = await POST(new Request("https://app.example.test/api/media/videos/direct-upload", { method: "POST" }));
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toContain("VIDEO_UPLOAD_SETUP_FAILED");
    expect(body).not.toContain("cloudflare-secret-response");
  });
});
