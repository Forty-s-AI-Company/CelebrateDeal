import { NextResponse } from "next/server";
import { z } from "zod";
import { createDirectCreatorUpload } from "@/lib/cloudflare-stream";

const DirectUploadRequest = z.object({
  maxDurationSeconds: z.number().int().positive().max(60 * 60 * 6).default(60 * 60),
});

export async function POST(request: Request) {
  const parsed = DirectUploadRequest.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
  }

  const upload = await createDirectCreatorUpload(parsed.data.maxDurationSeconds);
  return NextResponse.json({ ok: true, upload });
}
