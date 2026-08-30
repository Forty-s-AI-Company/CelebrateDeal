import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { requireMerchantApiActor } from "@/lib/merchant-api-security";
import { getR2ImageConfig, headImageObject } from "@/lib/r2-images";

export const runtime = "nodejs";

const requestSchema = z.object({
  assetId: z.string().trim().min(1).max(100),
}).strict();

export async function POST(request: Request) {
  const authorization = await requireMerchantApiActor(request);
  if (authorization.response) return authorization.response;

  const parsed = requestSchema.safeParse(await readJsonBody(request, 4 * 1024));
  if (!parsed.success) return error("INVALID_COMPLETE_REQUEST", 400);

  try {
    const asset = await getDb().imageAsset.findFirst({
      where: { id: parsed.data.assetId, vendorId: authorization.actor.vendorId },
      select: { id: true, vendorId: true, objectKey: true, mimeType: true, sizeBytes: true, status: true },
    });
    // Missing and foreign assets deliberately share the same response.
    if (!asset) return error("IMAGE_ASSET_NOT_FOUND", 404);
    if (asset.status !== "pending") return error("IMAGE_ASSET_NOT_PENDING", 409);

    const config = getR2ImageConfig();
    if (!config) return error("MEDIA_STORAGE_UNAVAILABLE", 503);

    const head = await headImageObject(config, asset.objectKey);
    if (head.contentLength !== asset.sizeBytes || head.contentType !== asset.mimeType) {
      return error("IMAGE_OBJECT_MISMATCH", 409);
    }

    const updated = await getDb().imageAsset.updateMany({
      where: { id: asset.id, vendorId: authorization.actor.vendorId, status: "pending" },
      data: { status: "ready" },
    });
    if (updated.count !== 1) return error("IMAGE_ASSET_NOT_PENDING", 409);

    return NextResponse.json({ assetId: asset.id, status: "ready" });
  } catch {
    return error("IMAGE_VERIFICATION_FAILED", 502);
  }
}

function error(code: string, status: number) {
  return NextResponse.json({ error: { code } }, { status });
}
