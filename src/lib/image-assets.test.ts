import { describe, expect, it, vi } from "vitest";
import { ImageAssetReferenceError, resolveReadyImageAsset } from "./image-assets";

function db(findFirst = vi.fn()) {
  return { imageAsset: { findFirst } } as never;
}

describe("resolveReadyImageAsset", () => {
  it("does not query when an optional asset is absent", async () => {
    const findFirst = vi.fn();
    await expect(resolveReadyImageAsset(db(findFirst), { vendorId: "vendor-1", assetId: null })).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("returns only a ready asset owned by the current vendor", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "asset-1", publicUrl: "https://media.example.test/asset.webp" });
    await expect(resolveReadyImageAsset(db(findFirst), { vendorId: "vendor-1", assetId: "asset-1" })).resolves.toEqual({
      id: "asset-1",
      publicUrl: "https://media.example.test/asset.webp",
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "asset-1", vendorId: "vendor-1", status: "ready" },
      select: { id: true, publicUrl: true },
    });
  });

  it("fails closed for missing, cross-vendor, pending, or oversized references", async () => {
    await expect(resolveReadyImageAsset(db(vi.fn().mockResolvedValue(null)), { vendorId: "vendor-1", assetId: "asset-1" })).rejects.toBeInstanceOf(ImageAssetReferenceError);
    await expect(resolveReadyImageAsset(db(), { vendorId: "vendor-1", assetId: "x".repeat(129) })).rejects.toBeInstanceOf(ImageAssetReferenceError);
  });
});
