import { NextResponse } from "next/server";
import { readJsonBody, requireOpsSmokeSecret, unauthorizedJson } from "@/lib/api-security";
import { bindOpsSmokeVendor } from "@/lib/ops-smoke";
import { classifyCloudflareOperationError, createLiveInputMapping, LiveInputRequest } from "@/lib/cloudflare-ops";

export async function POST(request: Request) {
  if (!requireOpsSmokeSecret(request)) {
    return unauthorizedJson();
  }

  const bound = bindOpsSmokeVendor(await readJsonBody(request));
  if (!bound.ok) return bound.response;
  const parsed = LiveInputRequest.safeParse(bound.payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid live input request" }, { status: 400 });
  }

  try {
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
  } catch (error) {
    const diagnostic = classifyCloudflareOperationError(error);
    return NextResponse.json(
      { ok: false, error: "Cloudflare live input failed", diagnostic: diagnostic.code },
      { status: diagnostic.status },
    );
  }
}
