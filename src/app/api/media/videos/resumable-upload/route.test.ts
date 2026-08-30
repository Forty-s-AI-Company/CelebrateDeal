import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_BASIC_VIDEO_UPLOAD_BYTES } from "@/lib/media-upload-limits";

const mocks = vi.hoisted(() => ({
  readJsonBody: vi.fn(),
  createResumableUploadSession: vi.fn(),
  requireMerchantApiActor: vi.fn(),
}));

vi.mock("@/lib/api-security", () => ({ readJsonBody: mocks.readJsonBody }));
vi.mock("@/lib/merchant-api-security", () => ({ requireMerchantApiActor: mocks.requireMerchantApiActor }));
vi.mock("@/lib/cloudflare-ops", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cloudflare-ops")>()),
  createResumableUploadSession: mocks.createResumableUploadSession,
}));

import { CloudflareResourceError } from "@/lib/cloudflare-ops";
import { POST } from "./route";

const validPayload = {
  videoId: "video-1",
  title: "Large launch video",
  fileName: "launch.mp4",
  mimeType: "video/mp4",
  sizeBytes: MAX_BASIC_VIDEO_UPLOAD_BYTES + 1,
  maxDurationSeconds: 600,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMerchantApiActor.mockResolvedValue({ actor: { vendorId: "session-vendor", memberId: "member-1" } });
  mocks.readJsonBody.mockResolvedValue(validPayload);
  mocks.createResumableUploadSession.mockResolvedValue({
    videoId: "video-1",
    uploadURL: "https://upload.videodelivery.net/tus/provider-uid",
    uploadTicket: "opaque-encrypted-upload-ticket",
  });
});

describe("POST /api/media/videos/resumable-upload", () => {
  it("authorizes before reading input", async () => {
    mocks.requireMerchantApiActor.mockResolvedValue({
      response: NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }),
    });

    const response = await POST(new Request("https://app.example.test/api/media/videos/resumable-upload", { method: "POST" }));

    expect(response.status).toBe(401);
    expect(mocks.readJsonBody).not.toHaveBeenCalled();
    expect(mocks.createResumableUploadSession).not.toHaveBeenCalled();
  });

  it("rejects basic-size files and client provider fields", async () => {
    mocks.readJsonBody.mockResolvedValue({ ...validPayload, sizeBytes: MAX_BASIC_VIDEO_UPLOAD_BYTES, providerUid: "forbidden" });

    const response = await POST(new Request("https://app.example.test/api/media/videos/resumable-upload", { method: "POST" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "INVALID_RESUMABLE_VIDEO_UPLOAD" } });
    expect(mocks.createResumableUploadSession).not.toHaveBeenCalled();
  });

  it("derives vendor ownership and returns only the one-time tus contract", async () => {
    const response = await POST(new Request("https://app.example.test/api/media/videos/resumable-upload", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.createResumableUploadSession).toHaveBeenCalledWith({
      vendorId: "session-vendor",
      ...validPayload,
    });
    expect(body).toMatchObject({
      videoId: "video-1",
      uploadUrl: "https://upload.videodelivery.net/tus/provider-uid",
      uploadTicket: "opaque-encrypted-upload-ticket",
      method: "TUS",
    });
    expect(body).not.toHaveProperty("uid");
    expect(body).not.toHaveProperty("streamKey");
  });

  it("fails closed for a cross-tenant existing video", async () => {
    mocks.createResumableUploadSession.mockRejectedValue(new CloudflareResourceError("video_not_found"));

    const response = await POST(new Request("https://app.example.test/api/media/videos/resumable-upload", { method: "POST" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: "VIDEO_NOT_FOUND" } });
  });

  it("does not expose provider error details", async () => {
    mocks.createResumableUploadSession.mockRejectedValue(new Error("provider-secret-detail"));

    const response = await POST(new Request("https://app.example.test/api/media/videos/resumable-upload", { method: "POST" }));
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toContain("VIDEO_RESUMABLE_UPLOAD_SETUP_FAILED");
    expect(body).not.toContain("provider-secret-detail");
  });
});
