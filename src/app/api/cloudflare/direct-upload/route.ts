import { NextResponse } from "next/server";
import { requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { createDirectUploadMapping, DirectUploadRequest } from "@/lib/cloudflare-ops";

export async function POST(request: Request) {
  if (!requireJobSecret(request)) {
    return unauthorizedJson();
  }

  const parsed = DirectUploadRequest.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
  }

  const { video, upload } = await createDirectUploadMapping(parsed.data);

  return NextResponse.json({
    ok: true,
    videoId: video.id,
    upload: {
      uid: upload.uid,
      uploadURL: upload.uploadURL,
    },
  });
}
