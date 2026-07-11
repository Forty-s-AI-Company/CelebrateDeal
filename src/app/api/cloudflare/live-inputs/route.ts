import { NextResponse } from "next/server";
import { requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { createLiveInputMapping, LiveInputRequest } from "@/lib/cloudflare-ops";
import { auditEntitlementDenial, VendorEntitlementError } from "@/lib/entitlements";

export async function POST(request: Request) {
  if (!requireJobSecret(request)) {
    return unauthorizedJson();
  }

  const parsed = LiveInputRequest.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid live input request" }, { status: 400 });
  }

  let result: Awaited<ReturnType<typeof createLiveInputMapping>>;
  try {
    result = await createLiveInputMapping(parsed.data);
  } catch (error) {
    if (!(error instanceof VendorEntitlementError)) throw error;
    await auditEntitlementDenial({ vendorId: parsed.data.vendorId, actorLabel: "cloudflare_job", error });
    return NextResponse.json({ error: "Vendor subscription or quota does not allow live input", reason: error.reason }, { status: 402 });
  }
  const { video, liveInput } = result;

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
