import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readJsonBody: vi.fn(),
  completeResumableUploadMapping: vi.fn(),
  requireMerchantApiActor: vi.fn(),
}));

vi.mock("@/lib/api-security", () => ({ readJsonBody: mocks.readJsonBody }));
vi.mock("@/lib/merchant-api-security", () => ({ requireMerchantApiActor: mocks.requireMerchantApiActor }));
vi.mock("@/lib/cloudflare-ops", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cloudflare-ops")>()),
  completeResumableUploadMapping: mocks.completeResumableUploadMapping,
}));

import {
  CloudflareResourceError,
  CloudflareUploadFailedError,
  CloudflareUploadNotCompleteError,
  CloudflareUploadTicketError,
} from "@/lib/cloudflare-ops";
import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMerchantApiActor.mockResolvedValue({ actor: { vendorId: "session-vendor", memberId: "member-1" } });
  mocks.readJsonBody.mockResolvedValue({ uploadTicket: "opaque-encrypted-upload-ticket" });
  mocks.completeResumableUploadMapping.mockResolvedValue({ video: { id: "video-1" } });
});

describe("POST /api/media/videos/resumable-upload/complete", () => {
  it("authorizes before reading the opaque completion ticket", async () => {
    mocks.requireMerchantApiActor.mockResolvedValue({
      response: NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }),
    });

    const response = await POST(new Request("https://app.example.test/api/media/videos/resumable-upload/complete", { method: "POST" }));

    expect(response.status).toBe(401);
    expect(mocks.readJsonBody).not.toHaveBeenCalled();
    expect(mocks.completeResumableUploadMapping).not.toHaveBeenCalled();
  });

  it("binds completion to the authenticated vendor without accepting a provider uid", async () => {
    const response = await POST(new Request("https://app.example.test/api/media/videos/resumable-upload/complete", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ videoId: "video-1", status: "processing" });
    expect(mocks.completeResumableUploadMapping).toHaveBeenCalledWith({
      vendorId: "session-vendor",
      uploadTicket: "opaque-encrypted-upload-ticket",
    });
  });

  it("rejects malformed, expired, or cross-tenant tickets without provider detail", async () => {
    mocks.completeResumableUploadMapping.mockRejectedValue(new CloudflareUploadTicketError());

    const response = await POST(new Request("https://app.example.test/api/media/videos/resumable-upload/complete", { method: "POST" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "INVALID_UPLOAD_TICKET" } });
  });

  it("fails closed when a replacement video no longer belongs to the tenant", async () => {
    mocks.completeResumableUploadMapping.mockRejectedValue(new CloudflareResourceError("video_not_found"));

    const response = await POST(new Request("https://app.example.test/api/media/videos/resumable-upload/complete", { method: "POST" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: "VIDEO_NOT_FOUND" } });
  });

  it("keeps the local Video unchanged while provider bytes are still pending", async () => {
    mocks.completeResumableUploadMapping.mockRejectedValue(new CloudflareUploadNotCompleteError());

    const response = await POST(new Request("https://app.example.test/api/media/videos/resumable-upload/complete", { method: "POST" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: "VIDEO_UPLOAD_NOT_COMPLETE" } });
  });

  it("does not publish a provider asset that failed processing", async () => {
    mocks.completeResumableUploadMapping.mockRejectedValue(new CloudflareUploadFailedError());

    const response = await POST(new Request("https://app.example.test/api/media/videos/resumable-upload/complete", { method: "POST" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: "VIDEO_UPLOAD_FAILED" } });
  });
});
