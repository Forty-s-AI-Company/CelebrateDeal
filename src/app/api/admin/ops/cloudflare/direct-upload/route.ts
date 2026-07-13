import { NextResponse } from "next/server";
import { readJsonBody, requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { createDirectUploadMapping, DirectUploadRequest } from "@/lib/cloudflare-ops";

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
      helper: "admin_ops_cloudflare_direct_upload",
      videoId: video.id,
      status: video.status,
      playbackUrl: video.videoUrl,
      upload: {
        uid: upload.uid,
        uploadURL: upload.uploadURL,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cloudflare direct upload failed";
    return NextResponse.json(
      {
        ok: false,
        error: "Cloudflare direct upload failed",
        detail: message,
      },
      { status: 500 },
    );
  }
}
