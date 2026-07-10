import { NextResponse } from "next/server";
import { requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { createLiveInputMapping, LiveInputRequest } from "@/lib/cloudflare-ops";

export async function POST(request: Request) {
  if (!requireJobSecret(request)) {
    return unauthorizedJson();
  }

  const parsed = LiveInputRequest.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid live input request" }, { status: 400 });
  }

  const { video, liveInput } = await createLiveInputMapping(parsed.data);

  return NextResponse.json({
    ok: true,
    videoId: video.id,
    liveInput: {
      uid: liveInput.uid,
      rtmpsUrl: liveInput.rtmps?.url ?? null,
      webRTCUrl: liveInput.webRTC?.url ?? null,
      streamKeyRef: video.id,
    },
  });
}
