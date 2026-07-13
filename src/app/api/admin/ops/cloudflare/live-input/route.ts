import { NextResponse } from "next/server";
import { readJsonBody, requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { createLiveInputMapping, LiveInputRequest } from "@/lib/cloudflare-ops";

export async function POST(request: Request) {
  if (!requireJobSecret(request)) {
    return unauthorizedJson();
  }

  const parsed = LiveInputRequest.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid live input request" }, { status: 400 });
  }

  try {
    const { video, liveInput } = await createLiveInputMapping(parsed.data);
    return NextResponse.json({
      ok: true,
      helper: "admin_ops_cloudflare_live_input",
      videoId: video.id,
      status: video.status,
      playbackUrl: video.videoUrl,
      liveInput: {
        uid: liveInput.uid,
        rtmpsUrl: liveInput.rtmps?.url ?? null,
        webRTCUrl: liveInput.webRTC?.url ?? null,
        streamKeyRef: video.id,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cloudflare live input failed";
    return NextResponse.json(
      {
        ok: false,
        error: "Cloudflare live input failed",
        detail: message,
      },
      { status: 500 },
    );
  }
}
