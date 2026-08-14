import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readJsonBody: vi.fn(),
  imageAssetCreate: vi.fn(),
  requireMerchantApiActor: vi.fn(),
  getR2ImageConfig: vi.fn(),
  createImageObjectKey: vi.fn(),
  createImagePutPresignedUrl: vi.fn(),
  publicUrlForObject: vi.fn(),
}));

vi.mock("@/lib/api-security", () => ({ readJsonBody: mocks.readJsonBody }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ imageAsset: { create: mocks.imageAssetCreate } }) }));
vi.mock("@/lib/merchant-api-security", () => ({ requireMerchantApiActor: mocks.requireMerchantApiActor }));
vi.mock("@/lib/r2-images", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/r2-images")>()),
  getR2ImageConfig: mocks.getR2ImageConfig,
  createImageObjectKey: mocks.createImageObjectKey,
  createImagePutPresignedUrl: mocks.createImagePutPresignedUrl,
  publicUrlForObject: mocks.publicUrlForObject,
}));

import { POST } from "./route";

const validPayload = {
  fileName: "banner.png",
  mimeType: "image/png",
  sizeBytes: 1_024,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMerchantApiActor.mockResolvedValue({ actor: { vendorId: "session-vendor", memberId: "member-1" } });
  mocks.readJsonBody.mockResolvedValue(validPayload);
  mocks.getR2ImageConfig.mockReturnValue({ bucket: "media-assets" });
  mocks.createImageObjectKey.mockReturnValue("images/server-key.png");
  mocks.publicUrlForObject.mockReturnValue("https://assets.example.test/images/server-key.png");
  mocks.imageAssetCreate.mockResolvedValue({ id: "asset-1" });
  mocks.createImagePutPresignedUrl.mockResolvedValue({ uploadUrl: "https://r2.example.test/signed", expiresIn: 600 });
});

describe("POST /api/media/images/presign", () => {
  it("does not read a body when merchant authorization fails", async () => {
    mocks.requireMerchantApiActor.mockResolvedValue({
      response: NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }),
    });

    const response = await POST(new Request("https://app.example.test/api/media/images/presign", { method: "POST" }));

    expect(response.status).toBe(401);
    expect(mocks.readJsonBody).not.toHaveBeenCalled();
    expect(mocks.imageAssetCreate).not.toHaveBeenCalled();
  });

  it("rejects invalid image bodies without creating an asset", async () => {
    mocks.readJsonBody.mockResolvedValue({ ...validPayload, mimeType: "image/svg+xml" });

    const response = await POST(new Request("https://app.example.test/api/media/images/presign", { method: "POST" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "INVALID_IMAGE_UPLOAD" } });
    expect(mocks.imageAssetCreate).not.toHaveBeenCalled();
  });

  it("returns 503 without persistence when R2 configuration is unavailable", async () => {
    mocks.getR2ImageConfig.mockReturnValue(null);

    const response = await POST(new Request("https://app.example.test/api/media/images/presign", { method: "POST" }));

    expect(response.status).toBe(503);
    expect(mocks.imageAssetCreate).not.toHaveBeenCalled();
  });

  it("creates a pending asset for the session tenant and returns only safe upload fields", async () => {
    const response = await POST(new Request("https://app.example.test/api/media/images/presign", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.imageAssetCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ vendorId: "session-vendor", status: "pending", objectKey: "images/server-key.png" }),
    }));
    expect(body).toEqual({
      assetId: "asset-1",
      uploadUrl: "https://r2.example.test/signed",
      publicUrl: "https://assets.example.test/images/server-key.png",
      method: "PUT",
      headers: { "content-type": "image/png" },
      expiresIn: 600,
    });
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
