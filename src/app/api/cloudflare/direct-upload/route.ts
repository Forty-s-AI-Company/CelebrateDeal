import { NextResponse } from "next/server";
import { readJsonBody, requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { classifyCloudflareOperationError, createDirectUploadMapping, DirectUploadRequest } from "@/lib/cloudflare-ops";

export async function POST(request: Request) {
  if (!requireJobSecret(request)) {
    return unauthorizedJson();
  }

  const parsed = DirectUploadRequest.safeParse(await readJsonBody(request));
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
