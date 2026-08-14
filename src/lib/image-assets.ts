import { getDb } from "@/lib/db";

type ImageAssetReader = Pick<ReturnType<typeof getDb>, "imageAsset">;

export class ImageAssetReferenceError extends Error {
  constructor() {
    super("Image asset is unavailable for the current vendor.");
    this.name = "ImageAssetReferenceError";
  }
}

export async function resolveReadyImageAsset(
  db: ImageAssetReader,
  input: { vendorId: string; assetId: string | null },
) {
  if (!input.assetId) return null;
  if (input.assetId.length > 128) throw new ImageAssetReferenceError();
  const asset = await db.imageAsset.findFirst({
    where: { id: input.assetId, vendorId: input.vendorId, status: "ready" },
    select: { id: true, publicUrl: true },
  });
  if (!asset) throw new ImageAssetReferenceError();
  return asset;
}
