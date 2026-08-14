import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readJsonBody: vi.fn(),
  imageAssetFindFirst: vi.fn(),
  imageAssetUpdateMany: vi.fn(),
  requireMerchantApiActor: vi.fn(),
  getR2ImageConfig: vi.fn(),
  headImageObject: vi.fn(),
}));

vi.mock("@/lib/api-security", () => ({ readJsonBody: mocks.readJsonBody }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ imageAsset: {
  findFirst: mocks.imageAssetFindFirst,
  updateMany: mocks.imageAssetUpdateMany,
} }) }));
vi.mock("@/lib/merchant-api-security", () => ({ requireMerchantApiActor: mocks.requireMerchantApiActor }));
vi.mock("@/lib/r2-images", () => ({
  getR2ImageConfig: mocks.getR2ImageConfig,
  headImageObject: mocks.headImageObject,
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMerchantApiActor.mockResolvedValue({ actor: { vendorId: "session-vendor", memberId: "member-1" } });
  mocks.readJsonBody.mockResolvedValue({ assetId: "asset-1" });
  mocks.imageAssetFindFirst.mockResolvedValue({
    id: "asset-1",
    vendorId: "session-vendor",
    objectKey: "images/server-key.png",
    mimeType: "image/png",
    sizeBytes: 1_024,
    status: "pending",
  });
  mocks.getR2ImageConfig.mockReturnValue({ bucket: "media-assets" });
  mocks.headImageObject.mockResolvedValue({ contentLength: 1_024, contentType: "image/png" });
  mocks.imageAssetUpdateMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/media/images/complete", () => {
  it("does not read a body before merchant authorization", async () => {
    mocks.requireMerchantApiActor.mockResolvedValue({
      response: NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    });

    const response = await POST(new Request("https://app.example.test/api/media/images/complete", { method: "POST" }));

    expect(response.status).toBe(403);
    expect(mocks.readJsonBody).not.toHaveBeenCalled();
  });

  it("fails closed for an asset outside the session tenant", async () => {
    mocks.imageAssetFindFirst.mockResolvedValue(null);

    const response = await POST(new Request("https://app.example.test/api/media/images/complete", { method: "POST" }));

    expect(response.status).toBe(404);
    expect(mocks.imageAssetFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "asset-1", vendorId: "session-vendor" },
    }));
    expect(mocks.headImageObject).not.toHaveBeenCalled();
  });

  it("does not mark ready when R2 HEAD metadata differs", async () => {
    mocks.headImageObject.mockResolvedValue({ contentLength: 1_025, contentType: "image/png" });

    const response = await POST(new Request("https://app.example.test/api/media/images/complete", { method: "POST" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: "IMAGE_OBJECT_MISMATCH" } });
    expect(mocks.imageAssetUpdateMany).not.toHaveBeenCalled();
  });

  it("only marks the verified session asset ready", async () => {
    const response = await POST(new Request("https://app.example.test/api/media/images/complete", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ assetId: "asset-1", status: "ready" });
    expect(mocks.imageAssetUpdateMany).toHaveBeenCalledWith({
      where: { id: "asset-1", vendorId: "session-vendor", status: "pending" },
      data: { status: "ready" },
    });
  });

  it("does not expose raw R2 failures", async () => {
    mocks.headImageObject.mockRejectedValue(new Error("provider-secret-response"));

    const response = await POST(new Request("https://app.example.test/api/media/images/complete", { method: "POST" }));
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toContain("IMAGE_VERIFICATION_FAILED");
    expect(body).not.toContain("provider-secret-response");
  });

  it("does not expose raw database failures", async () => {
    mocks.imageAssetFindFirst.mockRejectedValue(new Error("database-secret-response"));

    const response = await POST(new Request("https://app.example.test/api/media/images/complete", { method: "POST" }));
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toContain("IMAGE_VERIFICATION_FAILED");
    expect(body).not.toContain("database-secret-response");
  });
});
