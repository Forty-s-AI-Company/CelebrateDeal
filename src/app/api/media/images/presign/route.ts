import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { requireMerchantApiActor } from "@/lib/merchant-api-security";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  createImageObjectKey,
  createImagePutPresignedUrl,
  getR2ImageConfig,
  isSupportedImageUpload,
  publicUrlForObject,
} from "@/lib/r2-images";

export const runtime = "nodejs";

const requestSchema = z.object({
  fileName: z.string().trim().min(1).max(255).refine((value) => !/[\u0000-\u001f]/.test(value)),
  mimeType: z.enum(ALLOWED_IMAGE_MIME_TYPES),
  sizeBytes: z.number().int().positive(),
}).strict();

export async function POST(request: Request) {
  const authorization = await requireMerchantApiActor(request);
  if (authorization.response) return authorization.response;

  const parsed = requestSchema.safeParse(await readJsonBody(request, 8 * 1024));
  if (!parsed.success || !isSupportedImageUpload(parsed.data.mimeType, parsed.data.sizeBytes)) {
    return error("INVALID_IMAGE_UPLOAD", 400);
  }

  const config = getR2ImageConfig();
  if (!config) return error("MEDIA_STORAGE_UNAVAILABLE", 503);

  const objectKey = createImageObjectKey(parsed.data.mimeType);
  const publicUrl = publicUrlForObject(config, objectKey);

  try {
    const asset = await getDb().imageAsset.create({
      data: {
        vendorId: authorization.actor.vendorId,
        objectKey,
        originalFilename: parsed.data.fileName,
        mimeType: parsed.data.mimeType,
        sizeBytes: parsed.data.sizeBytes,
        publicUrl,
        status: "pending",
      },
      select: { id: true },
    });
    const signed = await createImagePutPresignedUrl({
      config,
      objectKey,
      mimeType: parsed.data.mimeType,
    });

    return NextResponse.json({
      assetId: asset.id,
      uploadUrl: signed.uploadUrl,
      publicUrl,
      method: "PUT",
      headers: { "content-type": parsed.data.mimeType },
      expiresIn: signed.expiresIn,
    });
  } catch {
    // Database and signer failures remain indistinguishable to the browser.
    return error("IMAGE_UPLOAD_SETUP_FAILED", 502);
  }
}

function error(code: string, status: number) {
  return NextResponse.json({ error: { code } }, { status });
}
