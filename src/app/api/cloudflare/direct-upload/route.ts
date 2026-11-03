import { NextResponse } from "next/server";
import { readJsonBody, requireOpsSmokeSecret, unauthorizedJson } from "@/lib/api-security";
import { bindOpsSmokeVendor } from "@/lib/ops-smoke";
import { classifyCloudflareOperationError, createDirectUploadMapping, DirectUploadRequest } from "@/lib/cloudflare-ops";

export async function POST(request: Request) {
  if (!requireOpsSmokeSecret(request)) {
    return unauthorizedJson();
  }

  const bound = bindOpsSmokeVendor(await readJsonBody(request));
  if (!bound.ok) return bound.response;
  const parsed = DirectUploadRequest.safeParse(bound.payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
  }

  try {
    const { video, upload } = await createDirectUploadMapping(parsed.data);

    return NextResponse.json({
      ok: true,
      videoId: video.id,
      upload: {
        uid: upload.uid,
        uploadURL: upload.uploadURL,
      },
    });
  } catch (error) {
    const diagnostic = classifyCloudflareOperationError(error);
    return NextResponse.json(
      { ok: false, error: "Cloudflare direct upload failed", diagnostic: diagnostic.code },
      { status: diagnostic.status },
    );
  }
}
